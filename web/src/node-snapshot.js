import { countryComparison, countryToken } from './country-presentation.js';
import { memberEvidence, metricDelta, shortIds } from './detail-model.js';
import { hex, option } from './view.js';

export const nodeSelectionProfile = Object.freeze({ id: 'urn:ic-widgets:node-selection', major: 1 });

function receipt(row) {
  return Object.freeze({
    canister: row.source.toText(), method: row.method, item: row.item, observedAtNanos: String(row.observed_at),
    argumentSha256: hex(row.argument_hash), replySha256: option(row.reply_hash) ? hex(row.reply_hash[0]) : null,
    rejection: option(row.reject) ?? null,
  });
}

export function nodeSelection({ kind, subnet, revision, registryVersion, selected, incoming = [], outgoing = [],
  affected = [], label, observation, coverage }) {
  const nodes = items => Object.freeze(Array.from(items, id => id.toText?.() ?? id));
  return Object.freeze({
    profile: nodeSelectionProfile, kind, subnet, revision, registryVersion: String(registryVersion), label,
    nodes: Object.freeze({ selected: nodes(selected), incoming: nodes(incoming), outgoing: nodes(outgoing), affected: nodes(affected) }),
    observation, coverage,
  });
}

export function proposalNodeSelection(model, context, affected, receipts) {
  return nodeSelection({
    kind: 'comparison', subnet: model.subnet, revision: model.calculation.inputHash, registryVersion: model.version,
    selected: model.calculation.comparison.selected.members, incoming: model.calculation.comparison.selected.added,
    outgoing: model.calculation.comparison.selected.removed, affected, label: model.scenario + ' · ' + model.stateLabel,
    observation: Object.freeze({ kind: model.replay ? 'replay' : 'replicated',
      originalRegistryFrom: model.replay?.registryFrom ?? null, originalRegistryTo: model.replay?.registryTo ?? null,
      originalGovernance: Object.freeze((model.replay?.actionEvidence ?? []).map(row => Object.freeze({ ...row }))), previewRevision: model.previewRevision,
      proposalOrder: Object.freeze([...model.ids]), order: model.order, step: context.index,
      governance: Object.freeze(model.governance.map(row => Object.freeze({ id: String(row.id), status: row.lifecycle_status,
        observedAtNanos: String(row.observed_at_nanos) }))), receipts: Object.freeze(receipts.flatMap(live => live.receipts.map(receipt))) }),
    coverage: Object.freeze({ membership: 'finite comparison', notes: Object.freeze([...model.notes]),
      mapped: model.members.filter(node => node.point).length, represented: model.members.length }),
  });
}

export function subnetSnapshot(response, replay) {
  const { subnet, membership, nodes, operators, data_centers: centers } = response.outcome.Ok;
  const provenance = membership.Present.stamp;
  const ids = membership.Present.value.members;
  const version = option(response.registry_version);
  const evidence = {
    Nodes: new Map(nodes.map(([id, record]) => [id.toText(), [id, record]])),
    Operators: new Map(operators.map(([id, record]) => [id.toText(), [id, record]])),
    DataCenters: new Map(centers.map(([id, record]) => [id, [id, record]])),
  };
  const abbreviations = shortIds(ids.map(id => id.toText()));
  const members = Object.freeze(ids.map(id => {
    const key = id.toText();
    return Object.freeze({ ...memberEvidence(evidence, key, 'Retained', { work: 'settled' }), label: abbreviations.get(key) });
  }));
  const counts = new Map();
  for (const node of members) {
    const token = countryToken(node.region);
    if (token) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const missing = members.length - [...counts.values()].reduce((total, count) => total + count, 0);
  const countries = countryComparison([...counts].map(([token, count]) =>
    ({ key: 'RegisteredCountry', group: token, prior: count, proposed: count,
      delta: metricDelta(count, count, { beforePartial: !!missing, afterPartial: !!missing }) })),
  { distinct: true, partial: !!missing });
  const start = String(response.usage.started_at);
  const selection = nodeSelection({
    kind: 'existing', subnet: subnet.toText(), registryVersion: version, selected: ids,
    revision: String(version) + '/' + start + '/' + hex(option(provenance.value_hash) ?? []), label: 'Registered subnet membership',
    observation: Object.freeze({ kind: replay ? 'replay' : 'replicated', originalRegistryFrom: replay?.registryFrom ?? null, originalRegistryTo: replay?.registryTo ?? null,
      startedAtNanos: start, finishedAtNanos: String(response.usage.finished_at),
      receipts: Object.freeze(response.receipts.map(receipt)) }),
    coverage: Object.freeze({ membership: 'finite Registry roster', mapped: members.filter(node => node.point).length,
      represented: members.length, missingCountry: missing }),
  });
  return Object.freeze({ selection, members, countries, version });
}
