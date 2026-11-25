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

export function createReviewSession({ live, contexts, active, call, updated, phase, compare = compareMembership }) {
  const { report } = live.outcome.Ok;
  const { registry_version: version } = report.manifest;
  const records = emptyEvidence();
  const receipts = [];
  const paired = contexts.filter(c => c.index > 0 && c.rules && c.state && ['AThenB', 'BThenA'].includes(branch(c.scenario.id)));
  let selected;
  let running;
  let stopped = false;
  const valid = () => active() && !stopped;
  const pending = c => c?.status === 'pending' && c.rules && c.state;

  function publish(context) {
    if (active() && selected === context) updated(context);
  }

  async function read(type, ids, context) {
    const map = records[type];
    const missing = entries(ids).filter(([key]) => !map.has(key));
    for (let offset = 0; offset < missing.length; offset += PAGE) {
      if (!valid() || selected !== context && pending(selected)) return false;
      const page = missing.slice(offset, offset + PAGE);
      if (selected === context) phase('Membership available. Reading ' + STAGES[type] + ' · ' + (offset + page.length) + ' of ' + missing.length + ' requested records');
      try {
        const reply = await call(() => valid() && (selected === context || !pending(selected)),
          client => client.membership_detail_page(version, { [type]: page.map(([, id]) => id) }));
        if (!reply || !active()) return false;
        const response = result(reply);
        receipts.push({ type, response });
        if ('Err' in response.outcome) throw new Error(liveError(response.outcome.Err));
        const found = response.outcome.Ok[type];
        if (option(response.registry_version) !== version || found?.length !== page.length) {
          throw new Error('Source page does not match the selected snapshot.');
        }
        for (const record of found) {
          const stamp = record.Present?.stamp ?? record.Deleted ?? option(record.Unavailable?.stamp ?? []);
          if (stamp && stamp.mutation_version > version) throw new Error('A record is newer than the pinned version.');
        }
        page.forEach(([key, id], index) => map.set(key, [id, found[index]]));
      } catch (error) {
        if (!active()) return false;
        page.forEach(([key, id]) => map.set(key, [id, { Unavailable: { stamp: [], reason: error.message } }]));
        receipts.push({ type, error: error.message, keys: page.map(([key]) => key) });
      }
    }
    return valid();
  }

  async function calculate(context) {
    const evidence = comparisonEvidence(records, membership(context));
    // These maps contain only records used by this comparison. Subsequent reads
    // replace entries in the session store and cannot change this snapshot.
    const input = {
      registry_version: version, preview_revision: report.revision, subnet: context.subnet,
      before: context.before.members, after: context.state.members, kind: context.rules.kind,
      nodes: [...evidence.Nodes.values()], operators: [...evidence.Operators.values()],
      data_centers: [...evidence.DataCenters.values()],
    };
    if (selected === context) phase('Checking the replicated comparison');
    const relevant = () => valid() && (selected === context || !pending(selected));
    const calculation = await call(relevant, client => compare(client, input, relevant));
    if (!calculation || !valid()) return false;
    context.calculation = { ...calculation, evidence };
    context.failures = readFailures(evidence);
    publish(context);
    return true;
  }

  async function enrich(context) {
    const scope = paired.filter(c => principal(c.subnet) === principal(context.subnet));
    const ids = [context, ...scope].flatMap(membership);
    if (!await read('Nodes', ids, context)) return;
    const operators = entries(ids).flatMap(([key]) => present(records.Nodes.get(key))?.operator ?? []);
    if (!await read('Operators', operators, context)) return;
    const centers = entries(operators).map(([key]) => dcKey(records.Operators.get(key)))
      .filter(key => key && new TextEncoder().encode(key).length <= 128);
    // Publish a useful comparison while geography is still loading. Reusing a
    // fully read store skips this intermediate calculation.
    if (selected === context && !context.calculation && centers.some(key => !records.DataCenters.has(key))) {
      try {
        if (!await calculate(context)) return;
      } catch (error) {
        // The final input is different and gets its own single calculation.
        context.failures = [{ reason: error.message }];
      }
    }
    if (!await read('DataCenters', centers, context)) return;
    if (!await calculate(context)) return;
    context.status = context.failures.length ? 'partial' : 'available';
  }

  function start() {
    if (running || !valid()) return;
    running = (async () => {
      while (valid()) {
        const next = pending(selected) ? selected : paired.find(pending);
        if (!next) break;
        try {
          await enrich(next);
        } catch (error) {
          const failures = readFailures(comparisonEvidence(records, membership(next)));
          next.failures = [...failures, { reason: error.message }];
          next.status = next.calculation ? 'partial' : 'unavailable';
        }
        publish(next);
        if (selected && next !== selected && active()) updated(selected);
      }
    })().finally(() => { running = undefined; });
  }

  return {
    receipts,
    select(context) {
      selected = context;
      publish(context);
      start();
    },
    stop() {
      stopped = true;
      if (selected) publish(selected);
    },
    retry() {
      if (!selected || !['partial', 'unavailable'].includes(selected.status)) return;
      for (const { type, key } of selected.failures) {
        if (records[type]?.get(key)?.[1].Unavailable) records[type].delete(key);
      }
      selected.status = 'pending';
      stopped = false;
      publish(selected);
      start();
    },
    settled: () => running ?? Promise.resolve(),
    isStopped: () => stopped,
    pendingOrders: () => paired.filter(pending).length,
  };
}

export const stageLabel = type => STAGES[type] ?? words(type);
