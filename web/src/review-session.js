import { compareMembership, liveError, result } from './client.js';
import { branch, option, principal, words } from './view.js';

const PAGE = 24;
const NODE_BUDGET = 256;
const STAGES = { Nodes: 'node registrations', Operators: 'registered operators and providers', DataCenters: 'registered locations' };
export const reviewStages = {
  Preview: 'Membership', Nodes: 'Nodes', Operators: 'Operators', DataCenters: 'Locations',
  Policy: 'Policy', Comparison: 'Comparison', Lifecycle: 'Governance',
};

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
  const records = emptyEvidence();
  const requested = new Set();
  const receipts = [];
  const phases = { Preview: 'ready' };
  let selected;
  let running;
  let stopped = false;
  let policy;
  let policyFailure;
  let final;
  let consistency;
  let work = 'idle';
  let stage;
  let needsFinal = false;

  const valid = () => active() && !stopped;
  const pending = context => context?.status === 'pending' && context.rules && context.state;
  const supported = context => context?.index && context.rules && context.state;
  const update = () => { if (active()) updated(selected); };
  const plannedContexts = () => {
    if (!supported(selected)) return [];
    // Initial work stays in the selected subnet. The independent and ordered
    // steps for that subnet share a single record graph.
    return [selected, ...contexts.filter(context => context !== selected && supported(context)
      && principal(context.subnet) === principal(selected.subnet))];
  };
  const send = (next, counts) => {
    const changed = stage !== next;
    stage = next;
    if (next in reviewStages && (changed || phases[next] === undefined)) phases[next] = 'active';
    if (active()) progress({ work, stage, counts, remaining: plannedContexts().filter(pending).length, consistency,
      phases: { ...phases }, coverage: coverage(),
      selectedReady: selected?.status === 'available' || selected?.status === 'partial' });
    if (changed) update();
  };
  function section() {
    return { records, policy, policyFailure, final, consistency, work, stage, outside: outside() };
  }

  function outside() {
    return new Set(contexts.filter(context => supported(context) && ['pending', 'outside'].includes(context.status))
      .filter(context => work === 'settled' || !selected || principal(context.subnet) !== principal(selected.subnet))
      .map(context => principal(context.subnet))).size;
  }

  function coverage() {
    const evidence = Object.values(records).flatMap(map => [...map.values()].map(([, record]) => record));
    return { absent: evidence.filter(record => record.Missing !== undefined || record.Deleted).length,
      failed: evidence.filter(record => record.Unavailable).length, outside: outside() };
  }

  async function read(type, ids, inScope) {
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
    send(type, { ...counts });
    for (let offset = 0; offset < missing.length; offset += PAGE) {
      if (!inScope()) return;
      const page = missing.slice(offset, offset + PAGE);
      counts.inFlight = page.length;
      send(type, { ...counts });
      let found;
      try {
        const arguments_ = { [type]: page.map(([, id]) => id) };
        const reply = await call(inScope, client => token
          ? client.membership_context_detail_page(token, arguments_) : client.membership_detail_page(version, arguments_));
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
        found = page.map(() => ({ Unavailable: { stamp: [], reason: error.message }, unbound: true }));
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
    phases[type] = counts.failed ? 'failed' : 'ready';
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
      phases.Policy = policy.nns_retryable || option(policy.motion)?.retryable ? 'failed' : 'ready';
    } catch (error) {
      if (valid()) { policyFailure = error.message; phases.Policy = 'failed'; }
    }
    update();
  }

  async function calculate(context) {
    const evidence = comparisonEvidence(records, membership(context));
    const submitted = type => [...evidence[type].values()].filter(([, record]) => !record.unbound);
    const input = {
      registry_version: version, preview_revision: report.revision, subnet: context.subnet,
      before: context.before.members, after: context.state.members, kind: context.rules.kind,
      nodes: submitted('Nodes'), operators: submitted('Operators'), data_centers: submitted('DataCenters'),
    };
    try {
      const calculation = await call(valid, client => compare(client, input, valid,
        token ? [token, policy?.digest ?? new Uint8Array(32)] : []));
      if (!calculation || !valid()) return;
      context.calculation = { ...calculation, evidence, policy };
      context.failures = readFailures(evidence);
      context.status = context.failures.length ? 'partial' : 'available';
    } catch (error) {
      if (!valid()) return;
      context.failures = [...readFailures(evidence), { reason: error.message }];
      context.status = context.calculation ? 'stale' : 'unavailable';
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
        const error = response.outcome.Err;
        const incompatible = error.InvalidEvidence && ['InvalidCapture', 'UnsupportedAction', 'MalformedPayload'].includes(branch(error.InvalidEvidence));
        consistency = { blocked: 'ProposalChanged' in error || !!incompatible, reason: liveError(error) };
        phases.Lifecycle = 'failed';
        return;
      }
      if (option(response.registry_version) !== version) throw new Error('Governance recheck belongs to a different review.');
      final = response.outcome.Ok;
      phases.Lifecycle = 'ready';
    } catch (error) {
      if (valid()) { consistency = { blocked: false, reason: error.message }; phases.Lifecycle = 'failed'; }
    }
  }

  function start() {
    if (running || !valid() || consistency?.blocked) return;
    const scope = plannedContexts();
    if (!scope.some(pending) && !needsFinal) {
      if (work === 'idle') { work = 'settled'; send('Blocked'); update(); }
      return;
    }
    work = 'running';
    final = undefined;
    consistency = undefined;
    const comparisons = [];
    const ids = [];
    const accepted = new Set(requested);
    for (const context of scope) {
      if (!pending(context)) continue;
      const additions = entries(membership(context)).filter(([key]) => !accepted.has(key));
      if (comparisons.length >= 6 || accepted.size + additions.length > NODE_BUDGET) {
        context.status = 'outside';
        continue;
      }
      for (const [key] of additions) accepted.add(key);
      comparisons.push(context);
      ids.push(...membership(context));
    }
    for (const key of accepted) requested.add(key);
    // A lifecycle-only retry preserves the accepted calculation and skips reads.
    const checkOnly = needsFinal && !comparisons.length;
    const subnet = selected?.subnet;
    const inScope = () => valid() && !!selected && principal(selected.subnet) === principal(subnet);
    needsFinal = false;
    const run = async () => {
      if (checkOnly) return verifyLifecycle();
      if (!comparisons.length) return;
      await read('Nodes', ids, inScope);
      if (!inScope()) return;
      const operators = entries(ids).flatMap(([key]) => present(records.Nodes.get(key))?.operator ?? []);
      await read('Operators', operators, inScope);
      if (!inScope()) return;
      const centers = entries(operators).map(([key]) => dcKey(records.Operators.get(key)))
        .filter(key => key && new TextEncoder().encode(key).length <= 128);
      await read('DataCenters', centers, inScope);
      if (!inScope()) return;
      await observePolicy();
      if (!inScope()) return;
      let settled = 0;
      while (inScope() && comparisons.some(pending)) {
        const next = comparisons.includes(selected) && pending(selected) ? selected : comparisons.find(pending);
        send('Comparison', { settled, planned: comparisons.length });
        await calculate(next);
        settled++;
      }
      if (!inScope()) return;
      phases.Comparison = comparisons.some(row => ['stale', 'unavailable'].includes(row.status)) ? 'failed' : 'ready';
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
        for (const name of Object.keys(reviewStages)) if (!phases[name] || phases[name] === 'active') phases[name] = 'stopped';
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
          || outside() || contexts.some(context => context.status === 'outside')
          || policyFailure || !option(policy?.motion ?? [])?.rule.length || policy?.nns_issue.length
          || live.outcome.Ok.listed_subnets < (option(live.outcome.Ok.total_listed_subnets ?? []) ?? Infinity)
          || !!consistency;
        work = 'settled';
        send(consistency?.blocked ? 'Blocked' : consistency ? 'Provisional' : missing ? 'Gaps' : 'Finished');
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
      const affected = plannedContexts();
      const failures = affected.flatMap(context => readFailures(comparisonEvidence(records, membership(context))));
      const retryComparison = affected.some(context => ['stale', 'unavailable'].includes(context.status));
      if (!retryPolicy && !failures.length && !retryComparison && !consistency) return;
      for (const { type, key } of failures) records[type].delete(key);
      if (retryPolicy) { policy = undefined; policyFailure = undefined; }
      if (retryPolicy || failures.length || retryComparison) {
        for (const context of affected) if (context.status !== 'outside') context.status = 'pending';
      } else needsFinal = true;
      stopped = false;
      start();
    },
    async settled() { while (running) await running; },
  };
}

export const stageLabel = type => ({
  ...STAGES, Policy: 'Target Topology policy and NNS role', Lifecycle: 'Final Governance check',
})[type] ?? words(type);
