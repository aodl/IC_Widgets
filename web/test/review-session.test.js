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

function fixture({ firstPage, comparison, firstOrder = 'AThenB', reject = () => false } = {}) {
  const recorded = [];
  const render = [];
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
    live: { outcome: { Ok: { report: { manifest: { registry_version: 5n }, revision: [9] } } } },
    contexts: [one, two], active: () => true, call: (active, run) => serialize(active, () => run(client)),
    compare: async (_, input) => {
      recorded.push({ kind: 'comparison', values: input.after });
      await comparison?.();
      return { inputHash: input.after.length + '-' + input.data_centers.length, comparison: {} };
    },
    updated: ctx => render.push(ctx.key), phase() {},
  });
  return { session, recorded, render, one, two };
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

test('selecting a cached state leaves no queued reads for an obsolete independent context', async () => {
  const hold = deferred();
  const began = deferred();
  const { session, recorded, one, two } = fixture({ firstOrder: 'A', firstPage: () => {
    began.resolve();
    return hold.promise;
  } });
  two.status = 'available';
  session.select(one);
  await began.promise;
  session.select(two);
  hold.resolve();
  await session.settled();
  assert.deepEqual(recorded.map(row => row.kind), ['Nodes']);

  session.select(one);
  await session.settled();
  assert.equal(one.status, 'available');
  assert.equal(recorded.filter(row => row.kind === 'Nodes').length, 1);
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
  assert.deepEqual(recorded.slice(before).map(row => row.kind), ['DataCenters', 'comparison']);
  assert.equal(one.status, 'available');
  assert.ok(old.DataCenters.get('known')[1].Unavailable);
  assert.ok(one.calculation.evidence.DataCenters.get('known')[1].Present);
});

test('stop waits for the accepted page and schedules no follow-up calls', async () => {
  const hold = deferred();
  const began = deferred();
  const { session, recorded, one } = fixture({ firstPage: () => { began.resolve(); return hold.promise; } });
  session.select(one);
  await began.promise;
  session.stop();
  hold.resolve();
  await session.settled();
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
  assert.deepEqual(recorded.map(row => row.kind), ['Nodes', 'Operators', 'comparison']);
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
