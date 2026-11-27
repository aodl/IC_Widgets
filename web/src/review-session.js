import { compareMembership, liveError, result } from './client.js';
import { branch, option, principal, words } from './view.js';

const PAGE = 24;
const NODE_BUDGET = 256;
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

export function createReviewSession({ live, contexts, active, call, updated, progress, compare = compareMembership }) {
  const { report, review_context } = live.outcome.Ok;
  const token = option(review_context ?? []);
  const version = report.manifest.registry_version;
  const records = emptyEvidence();
  const requested = new Set();
  const receipts = [];
  let selected;
  let running;
  let stopped = false;
  let role;
  let roleFailure;
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
    if (active()) progress({ work, stage, counts, remaining: plannedContexts().filter(pending).length, consistency,
      selectedReady: selected?.status === 'available' || selected?.status === 'partial' });
    if (changed) update();
  };
  function section() {
    return { records, role, roleFailure, final, consistency, work, stage, outside: outside(),
      retryable: work === 'settled' && !consistency?.blocked && !!retryPlan() };
  }

  function outside() {
    return new Set(contexts.filter(context => supported(context) && ['pending', 'outside'].includes(context.status))
      .filter(context => work === 'settled' || !selected || principal(context.subnet) !== principal(selected.subnet))
      .map(context => principal(context.subnet))).size;
  }

  function retryPlan() {
    const retryRole = roleFailure || role?.retryable;
    const affected = plannedContexts();
    const failures = affected.flatMap(context => readFailures(comparisonEvidence(records, membership(context))));
    const retryComparison = affected.some(context => ['stale', 'unavailable'].includes(context.status));
    return retryRole || failures.length || retryComparison || consistency ? { retryRole, affected, failures, retryComparison } : undefined;
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
        const reply = await call(inScope, client => client.membership_context_detail_page(token, arguments_));
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
  }

  async function observeRole() {
    if (role || roleFailure || !valid()) return;
    send('Role');
    try {
      const reply = await call(valid, client => client.membership_registry_role(token));
      if (!reply || !valid()) return;
      const response = result(reply);
      receipts.push({ type: 'Role', response });
      if ('Err' in response.outcome) throw new Error(liveError(response.outcome.Err));
      if (option(response.registry_version) !== version) throw new Error('Registry role does not match the pinned snapshot.');
      role = response.outcome.Ok;
    } catch (error) {
      if (valid()) roleFailure = error.message;
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
      const calculation = await call(valid, client => compare(client, input, valid, token));
      if (!calculation || !valid()) return;
      context.calculation = { ...calculation, evidence };
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
        return;
      }
      if (option(response.registry_version) !== version) throw new Error('Governance recheck belongs to a different review.');
      final = response.outcome.Ok;
    } catch (error) {
      if (valid()) consistency = { blocked: false, reason: error.message };
    }
  }

  function start() {
    if (running || !valid() || consistency?.blocked) return;
    const scope = plannedContexts();
    if (!scope.some(pending) && !needsFinal) {
      if (work === 'idle') { work = 'settled'; send('Blocked'); update(); }
      return;
    }
    if (!token) {
      work = 'settled';
      consistency = { blocked: true, reason: 'The evidence-bound review session is unavailable.' };
      send('Blocked');
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
      if (checkOnly) {
        await observeRole();
        return verifyLifecycle();
      }
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
      await observeRole();
      if (!inScope()) return;
      let settled = 0;
      while (inScope() && comparisons.some(pending)) {
        const next = comparisons.includes(selected) && pending(selected) ? selected : comparisons.find(pending);
        send('Comparison', { settled, planned: comparisons.length });
        await calculate(next);
        settled++;
      }
      if (!inScope()) return;
      await verifyLifecycle();
    };
    running = run().then(async () => {
      // Returning to a calculated subnet can abandon enrichment without a new
      // comparison. Still settle the final Governance gate for the visible result.
      if (valid() && !inScope() && !plannedContexts().some(pending)
          && selected?.calculation && !final && !consistency) {
        await verifyLifecycle();
      }
    }).catch(error => {
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
        work = 'settled';
        send(consistency?.blocked ? 'Blocked' : consistency ? 'Provisional' : 'Finished');
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
      const plan = retryPlan();
      if (!plan) return;
      const { retryRole, affected, failures, retryComparison } = plan;
      for (const { type, key } of failures) records[type].delete(key);
      if (retryRole) { role = undefined; roleFailure = undefined; }
      if (failures.length || retryComparison) {
        for (const context of affected) if (context.status !== 'outside') context.status = 'pending';
      } else needsFinal = true;
      stopped = false;
      start();
    },
    async settled() { while (running) await running; },
  };
}

export const stageLabel = type => ({
  ...STAGES, Role: 'Pinned Registry role', Lifecycle: 'Final Governance check',
})[type] ?? words(type);
