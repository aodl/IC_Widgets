import assert from 'node:assert/strict';
import test from 'node:test';
import { affectedNodes, createReviewSession, serializeCalls } from '../src/review-session.js';
import { shortIds } from '../src/detail-model.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const id = value => ({ toText: () => value });
const present = value => ({ Present: { value, stamp: { mutation_version: 5n } } });

test('a shared-slot request settles before the latest eligible request is sent', async () => {
  const invoke = serializeCalls();
  const hold = deferred();
  const accepted = deferred();
  const calls = [];
  let current = true;
  const first = invoke(() => true, async () => {
    calls.push('accepted');
    accepted.resolve();
    await hold.promise;
    throw new Error('replica rejected');
  });
  const irrelevant = invoke(() => current, () => calls.push('obsolete'));
  const latest = invoke(() => true, () => calls.push('latest'));
  current = false;
  await accepted.promise;
  assert.deepEqual(calls, ['accepted']);
  hold.resolve();
  await assert.rejects(first, /replica rejected/);
  await Promise.all([irrelevant, latest]);
  assert.deepEqual(calls, ['accepted', 'latest']);
});

function fixture({ firstPage, comparison, firstOrder = 'AThenB', reject = () => false, finalize } = {}) {
  const recorded = [];
  const render = [];
  const updates = [];
  const a = id('node-a');
  const b = id('node-b');
  const provider = id('provider');
  const operator = id('operator');
  const subnet = id('subnet');
  const context = (order, members) => ({
    key: order, scenario: { id: { [order]: null } }, subnet, index: 1, rules: { kind: 2 },
    before: { members: [a] }, state: { members }, status: 'pending', failures: [],
  });
  const one = context(firstOrder, [b]);
  const two = context('BThenA', [a, b]);
  const client = {
    membership_context_detail_page(_token, keys) {
      return this.membership_detail_page(5n, keys);
    },
    membership_target_topology() {
      return { Ok: { registry_version: [5n], outcome: { Ok: { digest: [], motion: [], nns_issue: [] } } } };
    },
    finalize_membership_review: finalize,
    async membership_detail_page(version, keys) {
      const [[kind, values]] = Object.entries(keys);
      recorded.push({ kind, values });
      if (recorded.length === 1 && firstPage) await firstPage();
      if (reject(kind)) throw new Error('source unavailable');
      return { Ok: { registry_version: [version], outcome: { Ok: { [kind]: values.map(() => ({
        Nodes: present({ operator: [operator] }),
        Operators: present({ provider: [provider], data_center: 'known' }),
        DataCenters: present({ registered_owner: 'owner' }),
      })[kind]) } } } };
    },
  };
  const serialize = serializeCalls();
  const session = createReviewSession({
    live: { outcome: { Ok: { review_context: finalize ? [[7]] : [],
      report: { manifest: { registry_version: 5n }, revision: [9] } } } },
    contexts: [one, two], active: () => true, call: (active, run) => serialize(active, () => run(client)),
    compare: async (_, input) => {
      recorded.push({ kind: 'comparison', values: input.after });
      await comparison?.();
      return { inputHash: input.after.length + '-' + input.data_centers.length, comparison: {} };
    },
    updated: ctx => render.push(ctx?.key), progress: state => updates.push(state),
  });
  return { session, recorded, render, updates, one, two };
}

test('switching orders during a source page prioritizes the selected order and reuses its evidence', async () => {
  const hold = deferred();
  const began = deferred();
  const { session, recorded, render, one, two } = fixture({ firstPage: () => { began.resolve(); return hold.promise; } });
  session.select(one);
  await began.promise;
  session.select(two);
  const switched = render.length;
  hold.resolve();
  await session.settled();
  assert.ok(render.slice(switched).every(key => key === two.key));
  assert.deepEqual(recorded.filter(row => row.kind !== 'comparison').map(row => row.kind), ['Nodes', 'Operators', 'DataCenters']);
  assert.equal(recorded.find(row => row.kind === 'comparison').values.length, 2);
  assert.equal(one.status, 'available');
  assert.equal(two.status, 'available');
  const calls = recorded.length;
  session.select(one);
  await session.settled();
  assert.equal(recorded.length, calls);
});

test('progress counts settled records and stays active until both ordered comparisons settle', async () => {
  const hold = deferred();
  const began = deferred();
  const { session, updates, one } = fixture({ firstPage: () => {
    began.resolve();
    return hold.promise;
  } });
  session.select(one);
  await began.promise;
  assert.deepEqual(updates.at(-1).counts, { planned: 2, settled: 0, present: 0, absent: 0, failed: 0, inFlight: 2 });
  hold.resolve();
  await session.settled();
  assert.ok(updates.some(state => state.stage === 'Nodes' && state.counts?.settled === 2));
  assert.ok(updates.some(state => state.stage === 'Comparison' && state.remaining === 1 && state.work === 'running'));
  assert.equal(updates.at(-1).work, 'settled');
});

test('retry targets failed metadata, keeps successful observations and copies accepted inputs', async () => {
  let fails = true;
  const { session, recorded, one } = fixture({ reject: kind => fails && kind === 'DataCenters' });
  session.select(one);
  await session.settled();
  assert.equal(one.status, 'partial');
  const old = one.calculation.evidence;
  assert.equal(old.DataCenters.get('known')[1].Unavailable.reason, 'source unavailable');
  fails = false;
  const before = recorded.length;
  session.retry();
  await session.settled();
  assert.deepEqual(recorded.slice(before).map(row => row.kind), ['DataCenters', 'comparison', 'comparison']);
  assert.equal(one.status, 'available');
  assert.ok(old.DataCenters.get('known')[1].Unavailable);
  assert.ok(one.calculation.evidence.DataCenters.get('known')[1].Present);
});

test('a confirmed Governance change blocks later enrichment for the same preview', async () => {
  const { session, recorded, one, two } = fixture({
    finalize: async () => ({ Ok: { outcome: { Err: { ProposalChanged: { id: 7n } } } } }),
  });
  two.subnet = id('another subnet');
  session.select(one);
  await session.settled();
  assert.equal(session.section().stage, 'Blocked');
  assert.equal(session.section().consistency.blocked, true);
  const calls = recorded.length;
  session.select(two);
  await session.settled();
  assert.equal(recorded.length, calls);
  assert.equal(session.section().stage, 'Blocked');
  assert.equal(two.calculation, undefined);
});

test('stop waits for the accepted page and schedules no follow-up calls', async () => {
  const hold = deferred();
  const began = deferred();
  const { session, recorded, one } = fixture({ firstPage: () => { began.resolve(); return hold.promise; } });
  session.select(one);
  await began.promise;
  session.stop();
  assert.equal(session.section().work, 'stopping');
  hold.resolve();
  await session.settled();
  assert.equal(session.section().work, 'stopped');
  assert.deepEqual(recorded.map(row => row.kind), ['Nodes']);
});

test('stop leaves an accepted comparison out of the stopped workspace', async () => {
  const hold = deferred();
  const began = deferred();
  const { session, recorded, one } = fixture({ comparison: () => { began.resolve(); return hold.promise; } });
  session.select(one);
  await began.promise;
  session.stop();
  hold.resolve();
  await session.settled();
  assert.equal(one.calculation, undefined);
  assert.deepEqual(recorded.map(row => row.kind), ['Nodes', 'Operators', 'DataCenters', 'comparison']);
});

test('shortened principals remain distinct when both ends collide', () => {
  const ids = ['kaoz3-abbbbbbbbbbbbb-4qe', 'kaoz3-bbbbbbbbbbbbb-4qe'];
  const labels = shortIds(ids);
  assert.notEqual(labels.get(ids[0]), labels.get(ids[1]));
  assert.ok(ids.every(key => labels.get(key).includes('…')));
});

test('the affected Performance scope includes transient nodes but excludes untouched members and other subnets', () => {
  const [retained, outgoing, incoming, unrelated, subnet, otherSubnet] =
    ['retained', 'outgoing', 'incoming', 'unrelated', 'subnet', 'other subnet'].map(id);
  const baseline = { members: [retained, outgoing] };
  const context = { subnet, scenario: {
    steps: [
      { requested: { Change: { subnet, add: [incoming], remove: [outgoing] } } },
      { requested: { Remove: { nodes: [incoming, unrelated] } } },
      { requested: { Add: { subnet: otherSubnet, nodes: [unrelated] } } },
    ],
    subnets: [[subnet, { baseline, after_steps: [
      [{ members: [retained, incoming], added: [incoming], removed: [outgoing] }],
      [{ members: [retained], added: [], removed: [outgoing] }],
      [],
    ] }]],
  } };
  assert.deepEqual(affectedNodes(context, { nodes: [retained, outgoing, incoming, unrelated] }), [outgoing, incoming]);
  assert.deepEqual(affectedNodes(context, undefined), []);
});
