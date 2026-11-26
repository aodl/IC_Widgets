import { compareMembership, liveError, result } from './client.js';
import { branch, option, principal, words } from './view.js';

const PAGE = 24;
const STAGES = { Nodes: 'node registrations', Operators: 'registered operators and providers', DataCenters: 'registered locations' };

export function serializeCalls() {
  let tail = Promise.resolve();
  return (active, run) => {
    const call = tail.then(() => active() ? run() : undefined);
    tail = call.catch(() => {});
    return call;
  };
}

export const emptyEvidence = () => ({ Nodes: new Map(), Operators: new Map(), DataCenters: new Map() });
export const recordKey = id => id.toText?.() ?? id;
const entries = ids => [...new Map(ids.map(id => [recordKey(id), id]))];
const present = row => row?.[1].Present?.value;
const dcKey = row => present(row)?.data_center.toLowerCase();

export function comparisonEvidence(store, ids) {
  const out = emptyEvidence();
  for (const [key] of entries(ids)) {
    const row = store.Nodes.get(key);
    if (row) out.Nodes.set(key, row);
    const operator = option(present(row)?.operator ?? [])?.toText();
    if (store.Operators.has(operator)) out.Operators.set(operator, store.Operators.get(operator));
    const center = dcKey(store.Operators.get(operator));
    if (store.DataCenters.has(center)) out.DataCenters.set(center, store.DataCenters.get(center));
  }
  return out;
}

export function readFailures(evidence) {
  return Object.entries(evidence).flatMap(([type, rows]) => [...rows].flatMap(([key, [, record]]) =>
    record.Unavailable ? [{ type, key, reason: record.Unavailable.reason }] : []));
}

const membership = context => [...context.before.members, ...context.state.members];

export function affectedNodes(context, scope) {
  if (!scope) return [];
  const subnet = principal(context.subnet);
  const view = context.scenario.subnets.find(([id]) => principal(id) === subnet)[1];
  const touched = new Set();
  let previous = new Set(view.baseline.members.map(principal));
  for (const [index, { requested }] of context.scenario.steps.entries()) {
    const directed = requested.Add ?? requested.Change;
    const requestedHere = directed && principal(directed.subnet) === subnet
      ? [...(directed.nodes ?? directed.add), ...(directed.remove ?? [])]
      : (requested.Remove?.nodes ?? []).filter(node => previous.has(principal(node)));
    for (const node of requestedHere) touched.add(principal(node));
    const state = option(view.after_steps[index]);
    if (!state) continue;
    for (const node of [...state.added, ...state.removed]) touched.add(principal(node));
    previous = new Set(state.members.map(principal));
  }
  return scope.nodes.filter(node => touched.has(principal(node)));
}

export function reviewContexts(report, rules) {
  return report.scenarios.flatMap(scenario => scenario.subnets.flatMap(([subnet, view]) =>
    [view.baseline, ...view.after_steps.map(option)].map((state, index) => ({
      key: branch(scenario.id) + '/' + principal(subnet) + '/' + index,
      subnet, scenario, index, state, before: view.baseline,
      rules: rules.find(row => principal(row.subnet) === principal(subnet)),
      draft: {}, failures: [],
      status: state ? 'pending' : 'blocked',
    }))));
}

export function createReviewSession({ live, contexts, policyId, active, call, updated, progress, compare = compareMembership }) {
  const { report, review_context } = live.outcome.Ok;
  const token = option(review_context ?? []);
  const version = report.manifest.registry_version;
  const required = contexts.filter(context => context.index && context.rules && context.state);
  const records = emptyEvidence();
  const receipts = [];
  let selected;
  let running;
  let stopped = false;
  let policy;
  let policyFailure;
  let final;
  let consistency;
  let work = 'idle';
  let stage;

  const valid = () => active() && !stopped;
  const pending = context => context?.status === 'pending' && context.rules && context.state;
  const outstanding = () => required.filter(pending);
  const update = () => { if (active()) updated(selected); };
  const plannedContexts = () => [...new Set([...required, ...(selected?.state && selected.rules ? [selected] : [])])];
  const send = (next, counts) => {
    const changed = stage !== next;
    stage = next;
    if (active()) progress({ work, stage, counts, remaining: outstanding().length, consistency,
      selectedReady: selected?.status === 'available' || selected?.status === 'partial' });
    if (changed) update();
  };
  function section() {
    return { records, policy, policyFailure, final, consistency, work, stage };
  }

  async function read(type, ids) {
    const map = records[type];
    const keys = entries(ids);
    const missing = keys.filter(([key]) => !map.has(key));
    const counts = { planned: keys.length, settled: keys.length - missing.length, present: 0, absent: 0, failed: 0, inFlight: 0 };
    const count = record => {
      if (record.Present) counts.present++;
      else if (record.Unavailable) counts.failed++;
      else counts.absent++;
    };
    for (const [key] of keys) if (map.has(key)) count(map.get(key)[1]);
    for (let offset = 0; offset < missing.length; offset += PAGE) {
      if (!valid()) return;
      const page = missing.slice(offset, offset + PAGE);
      counts.inFlight = page.length;
      send(type, { ...counts });
      let found;
      try {
        const reply = await call(valid, client => client.membership_detail_page(version, { [type]: page.map(([, id]) => id) }));
        if (!reply || !valid()) return;
        const response = result(reply);
        receipts.push({ type, response });
        if ('Err' in response.outcome) throw new Error(liveError(response.outcome.Err));
        found = response.outcome.Ok[type];
        if (option(response.registry_version) !== version || found?.length !== page.length) {
          throw new Error('Source page does not match the pinned snapshot.');
        }
        for (const record of found) {
          const stamp = record.Present?.stamp ?? record.Deleted ?? option(record.Unavailable?.stamp ?? []);
          if (stamp && stamp.mutation_version > version) throw new Error('A record is newer than the pinned version.');
        }
      } catch (error) {
        if (!valid()) return;
        found = page.map(() => ({ Unavailable: { stamp: [], reason: error.message } }));
        receipts.push({ type, error: error.message, keys: page.map(([key]) => key) });
      }
      page.forEach(([key, id], index) => {
        map.set(key, [id, found[index]]);
        count(found[index]);
      });
      counts.settled += page.length;
      counts.inFlight = 0;
      send(type, { ...counts });
      update();
    }
  }

  async function observePolicy() {
    if (!token || policy || !valid()) return;
    send('Policy');
    try {
      const reply = await call(valid, client => client.membership_target_topology(token, policyId === undefined ? [] : [policyId]));
      if (!reply || !valid()) return;
      const response = result(reply);
      receipts.push({ type: 'Policy', response });
      if ('Err' in response.outcome) throw new Error(liveError(response.outcome.Err));
      if (option(response.registry_version) !== version) throw new Error('Policy context does not match the pinned Registry snapshot.');
      policy = response.outcome.Ok;
    } catch (error) {
      if (valid()) policyFailure = error.message;
    }
    update();
  }

  async function calculate(context) {
    const evidence = comparisonEvidence(records, membership(context));
    const input = {
      registry_version: version, preview_revision: report.revision, subnet: context.subnet,
      before: context.before.members, after: context.state.members, kind: context.rules.kind,
      nodes: [...evidence.Nodes.values()], operators: [...evidence.Operators.values()],
      data_centers: [...evidence.DataCenters.values()],
    };
    try {
      const calculation = await call(valid, client => compare(client, input, valid, policy ? [token, policy.digest] : []));
      if (!calculation || !valid()) return;
      context.calculation = { ...calculation, evidence };
      context.failures = readFailures(evidence);
      context.status = context.failures.length ? 'partial' : 'available';
    } catch (error) {
      if (!valid()) return;
      context.failures = [...readFailures(evidence), { reason: error.message }];
      context.status = 'unavailable';
    }
    update();
  }

  async function verifyLifecycle() {
    if (!token || !valid()) return;
    send('Lifecycle');
    try {
      const reply = await call(valid, client => client.finalize_membership_review(token));
      if (!reply || !valid()) return;
      const response = result(reply);
      receipts.push({ type: 'Lifecycle', response });
      if ('Err' in response.outcome) {
        consistency = { blocked: 'ProposalChanged' in response.outcome.Err, reason: liveError(response.outcome.Err) };
        return;
      }
      if (option(response.registry_version) !== version) throw new Error('Governance recheck belongs to a different review.');
      final = response.outcome.Ok;
    } catch (error) {
      if (valid()) consistency = { blocked: false, reason: error.message };
    }
  }

  function start() {
    if (running || !valid()) return;
    if (!plannedContexts().some(pending)) {
      if (work === 'idle') { work = 'settled'; send('Blocked'); update(); }
      return;
    }
    work = 'running';
    final = undefined;
    consistency = undefined;
    const ids = plannedContexts().flatMap(membership);
    send('Nodes');
    const run = async () => {
      await read('Nodes', ids);
      if (!valid()) return;
      const operators = entries(ids).flatMap(([key]) => present(records.Nodes.get(key))?.operator ?? []);
      await read('Operators', operators);
      if (!valid()) return;
      const centers = entries(operators).map(([key]) => dcKey(records.Operators.get(key)))
        .filter(key => key && new TextEncoder().encode(key).length <= 128);
      await read('DataCenters', centers);
      if (!valid()) return;
      await observePolicy();
      if (!valid()) return;
      const comparisons = plannedContexts().filter(pending);
      let settled = 0;
      while (valid() && comparisons.some(pending)) {
        const next = comparisons.includes(selected) && pending(selected) ? selected : comparisons.find(pending);
        send('Comparison', { settled, planned: comparisons.length });
        await calculate(next);
        settled++;
      }
      await verifyLifecycle();
    };
    running = run().catch(error => {
      for (const context of plannedContexts().filter(pending)) context.status = 'unavailable';
      consistency = { blocked: false, reason: error.message };
    }).finally(() => {
      running = undefined;
      if (!active()) return;
      if (stopped) {
        work = 'stopped';
        send('Stopped');
      } else if (plannedContexts().some(pending) && !consistency?.blocked) {
        start();
        return;
      } else {
        const missing = plannedContexts().some(context => context.status !== 'available'
          || context.calculation?.comparison.selected?.distances.unknown_nodes
          || policy && !option(context.calculation?.target_rows ?? [])?.length
          || option(context.calculation?.target_rows ?? [])?.some(row =>
            ['ExceptionUnresolved', 'IdentityUnresolved', 'DataIncomplete'].includes(branch(row.assessment))))
          || contexts.some(context => context.index && context.status === 'blocked')
          || policyFailure || !option(policy?.motion ?? [])?.rule.length || policy?.nns_issue.length
          || live.outcome.Ok.listed_subnets < (option(live.outcome.Ok.total_listed_subnets ?? []) ?? Infinity)
          || !!consistency;
        work = 'settled';
        send(consistency?.blocked ? 'Blocked' : missing ? 'Gaps' : 'Finished');
      }
      update();
    });
  }

  return {
    receipts,
    section,
    select(context) {
      selected = context;
      update();
      start();
    },
    stop() {
      if (stopped || work === 'settled') return;
      stopped = true;
      work = running ? 'stopping' : 'stopped';
      send('Stopped');
      update();
    },
    retry() {
      if (running || consistency?.blocked) return;
      const retryPolicy = policyFailure || option(policy?.motion ?? [])?.retryable || policy?.nns_retryable;
      const failures = readFailures(records);
      const retryComparison = plannedContexts().some(context => context.status === 'unavailable');
      if (!retryPolicy && !failures.length && !retryComparison && !consistency) return;
      for (const { type, key } of failures) records[type].delete(key);
      if (retryPolicy) { policy = undefined; policyFailure = undefined; }
      for (const context of plannedContexts()) {
        context.calculation = undefined;
        context.status = 'pending';
      }
      stopped = false;
      start();
    },
    async settled() { while (running) await running; },
  };
}

export const stageLabel = type => ({
  ...STAGES, Policy: 'Target Topology policy and NNS role', Lifecycle: 'Final Governance check',
})[type] ?? words(type);
