import { countryComparison, countryToken } from './country-presentation.js';
import { branch, hex, number, option, principal, time, words } from './view.js';

export const lifecycle = { 1: 'Open', 2: 'Rejected', 3: 'Adopted', 4: 'Executed', 5: 'Failed' };
export const scenarioName = scenario => Array.from(scenario.proposal_ids, id => 'Proposal #' + id).join(' then ');
export const calculationNote = 'The replicated calculation digest identifies the exact submitted evidence and scope. Source receipts identify the separate Registry and Governance observations.';
export const thresholdNote = "How many of the largest registered groups together contain more than one-third of the subnet's nodes? Each state uses floor(N / 3) + 1. Recorded groups do not establish independent ownership, subnet safety, execution validity or Target Topology compliance.";
export const geographyNote = 'Positions use the registered data-center coordinates. The dotted halo indicates multiple node identities at the same coordinates.';
export const criteriaNote = 'No current Target Topology thresholds, exceptions or applicability are assumed.';
export const absent = 'Not recorded on-chain';
export const roles = {
  Added: { label: 'Add', color: '#087748' },
  Removed: { label: 'Remove', color: '#ad263f' },
  Retained: { label: 'Unchanged', color: '#315e80' },
};
export const comparisonCaption = 'Arrows show before → proposed; a single value is unchanged.';
export const distributionTables = [
  { key: 'distinct', title: 'Different groups represented', help: 'How many different registered groups have at least one member in this subnet?' },
  { key: 'largest', title: 'Largest group size', help: 'The most subnet nodes sharing one value, such as one provider or one country label. Several groups may tie.' },
  { key: 'coefficient', title: 'Nakamoto coefficients', help: thresholdNote },
];
export const distanceTitle = 'Distances between registered node locations';
export const distanceHelp = 'Straight-line geographic distances calculated from registered data-center coordinates, counting each pair of nodes once. These are not measured network latency or health.';
export const metrics = {
  RegisteredContinent: { label: 'Continent', help: 'The continent label in the registered location.' },
  RegisteredCountry: { label: 'Country', help: 'The country label in the registered location. Different spellings remain separate.' },
  DataCenter: { label: 'Data center', help: 'The facility ID recorded for a node.' },
  RegisteredOwner: { label: 'Data center owner', help: 'The owner name stored for a data center.' },
  Provider: { label: 'Provider', help: 'The provider principal recorded for a node.' },
  Operator: { label: 'Operator', help: 'The operator principal recorded for a node.' },
};

export function shortIds(ids) {
  const unique = [...new Set(ids)];
  return new Map(unique.map(id => {
    let length = 5;
    const label = (value, size) => value.length > size + 4 ? value.slice(0, size) + '…' + value.slice(-3) : value;
    while (unique.some(other => other !== id && label(other, length) === label(id, length))) length++;
    return [id, label(id, length)];
  }));
}

export function metricDelta(before, after, { beforePartial = false, afterPartial = false, kilometres = false, neutral = false } = {}) {
  if (kilometres) {
    before = before === undefined ? undefined : before / 1000;
    after = after === undefined ? undefined : after / 1000;
  }
  let places = kilometres ? 1 : 0;
  if (kilometres && before !== after && before !== undefined && after !== undefined) {
    while (places < 3 && before.toFixed(places) === after.toFixed(places)) places++;
  }
  const display = (value, partial) => value === undefined ? undefined
    : (partial ? '≥' : '') + (kilometres ? value.toLocaleString('en-US', {
      minimumFractionDigits: value === 0 ? 0 : places, maximumFractionDigits: places,
    }) + ' km' : String(value));
  const a = display(before, beforePartial);
  const b = display(after, afterPartial);
  if (a === undefined && b === undefined) return { text: 'Unavailable from recorded evidence' };
  if (a === undefined) return { text: b + ' · Before unavailable' };
  if (b === undefined) return { text: a + ' before · Proposed unavailable' };
  if (a === b) return { text: before === after ? a : 'About ' + a + ' in both states', after: b };
  return {
    text: a + ' → ' + b, before: a, after: b, direction: neutral || beforePartial || afterPartial ? 0 : Math.sign(after - before),
    accessible: (beforePartial ? 'At least ' + a.slice(1) : a) + ' before, '
      + (afterPartial ? 'at least ' + b.slice(1) : b) + ' proposed',
  };
}

function recordState(record, missing, work) {
  if (record?.Present) return undefined;
  if (record?.Unavailable) return 'Could not load · ' + record.Unavailable.reason;
  if (record) return absent;
  if (work === 'running' || work === 'stopping' || work === 'idle') return missing;
  if (work === 'stopped') return 'Not loaded · Review stopped';
  return 'Not checked by this review';
}

export function memberEvidence(evidence, id, role, { work }) {
  const nodeRecord = evidence.Nodes.get(id)?.[1];
  const node = nodeRecord?.Present?.value;
  const operatorId = option(node?.operator ?? [])?.toText();
  const operatorRecord = evidence.Operators.get(operatorId)?.[1];
  const operator = operatorRecord?.Present?.value;
  const provider = option(operator?.provider ?? [])?.toText();
  const dc = operator?.data_center.toLowerCase() || undefined;
  const dcRecord = evidence.DataCenters.get(dc)?.[1];
  const center = dcRecord?.Present?.value;
  const coordinates = option(center?.coordinates ?? []);
  const point = coordinates && Math.abs(coordinates.latitude_e7) <= 900_000_000
    && Math.abs(coordinates.longitude_e7) <= 1_800_000_000 ? {
      lat: coordinates.latitude_e7 / 10_000_000, lon: coordinates.longitude_e7 / 10_000_000,
    } : undefined;
  const nodeIssue = recordState(nodeRecord, 'Loading node records', work);
  const operatorIssue = nodeIssue ?? (!operatorId ? absent : recordState(operatorRecord,
    'Loading operator records', work));
  const centerIssue = operatorIssue ?? (!dc ? absent : recordState(dcRecord,
    'Loading data centers', work));
  return {
    id, role, dc, provider, operatorId, owner: center?.registered_owner.trim(), region: center?.registered_region, point,
    nodeIssue, operatorIssue, centerIssue,
    locationIssue: point ? undefined : centerIssue ?? (coordinates ? 'Registered coordinates are invalid' : absent),
    locationPending: !point && ['idle', 'running', 'stopping'].includes(work)
      && (!nodeRecord || (operatorId && !operatorRecord) || (dc && !dcRecord)),
  };
}

function groups(distribution) {
  return distribution.groups.map(([group, count]) => ({
    label: group.Principal ? principal(group.Principal) : group.RegisteredLabel, count,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const coefficient = row => row?.unknown ? undefined : option(option(row?.greater_than_one_third ?? [])?.groups_to_reach ?? []);

export function compositionRows(before, after) {
  return Object.entries(metrics).flatMap(([key, definition]) => {
    const old = before.get(key);
    const next = after.get(key);
    if (!old || !next) return [];
    const prior = new Map(groups(old).map(item => [item.label, item.count]));
    const proposed = new Map(groups(next).map(item => [item.label, item.count]));
    return [...new Set([...prior.keys(), ...proposed.keys()])].sort((a, b) => a.localeCompare(b)).map(group => ({
      key, group, ...definition, prior: prior.get(group) ?? 0, proposed: proposed.get(group) ?? 0,
      delta: metricDelta(prior.get(group) ?? 0, proposed.get(group) ?? 0,
        { beforePartial: !!old.unknown, afterPartial: !!next.unknown }),
    }));
  });
}

export function compositionDimensions(before, after) {
  return Object.entries(metrics).map(([key, definition]) => {
    const old = before.get(key);
    const next = after.get(key);
    if (!old || !next) return { key, ...definition };
    const partial = { beforePartial: !!old.unknown, afterPartial: !!next.unknown };
    const ties = row => groups(row).filter(group => group.count === option(row.largest ?? []));
    const threshold = row => option(row.greater_than_one_third ?? [])?.nodes_required;
    return { key, ...definition,
      distinct: metricDelta(old.groups.length, next.groups.length, partial),
      largest: metricDelta(option(old.largest ?? []) ?? 0, option(next.largest ?? []) ?? 0, partial),
      coefficient: metricDelta(coefficient(old), coefficient(next)),
      unknown: metricDelta(old.unknown, next.unknown),
      partial: partial.beforePartial || partial.afterPartial,
      thresholds: [threshold(old), threshold(next)],
      ties: [ties(old), ties(next)],
    };
  });
}

export function distanceSummary(before, after) {
  if (!before || !after) return undefined;
  const coverage = row => number(row.valid_pairs) + ' of ' + number(row.total_pairs);
  const partial = before.valid_pairs < before.total_pairs || after.valid_pairs < after.total_pairs;
  const a = coverage(before), b = coverage(after);
  return {
    columns: [['Shortest', 'minimum_metres'], ['Average', 'mean_metres'], ['Longest', 'maximum_metres']].map(([label, key]) => {
      const metres = [option(before[key]), option(after[key])];
      return { label, metres, delta: metricDelta(...metres, { kilometres: true, neutral: partial }) };
    }),
    coverage: (a === b ? a + ' pairs before and proposed' : a + ' pairs before · ' + b + ' pairs proposed')
      + (partial ? ' · known pairs only' : '') + '.',
  };
}

export const nodeHeaders = ['Action', 'Node', 'Data center', 'Data center owner', 'Provider', 'Operator', 'Country'];
export function nodeFields(node) {
  return [
    { value: node.id, principal: true, entity: 'node' },
    { value: node.dc, issue: node.operatorIssue, entity: 'center' },
    { value: node.owner, issue: node.centerIssue },
    { value: node.provider, issue: node.operatorIssue, principal: true, entity: 'provider' },
    { value: node.operatorId, issue: node.nodeIssue, principal: true },
    { value: countryToken(node.region), issue: node.centerIssue, country: true },
  ].map(field => ({ ...field, text: field.value || field.issue || absent }));
}

export function roleCounts(nodes) {
  const counts = { Added: 0, Removed: 0, Retained: 0 };
  for (const { role } of nodes) counts[role]++;
  return counts;
}

export function roleSummary(nodes) {
  return Object.entries(roleCounts(nodes)).map(([role, count]) => roles[role].label + ' ' + count).join(' · ');
}

export function membershipSites(nodes) {
  const sites = new Map();
  const unknown = nodes.filter(node => !node.dc);
  for (const node of nodes) {
    if (!node.dc) continue;
    if (!sites.has(node.dc)) sites.set(node.dc, []);
    sites.get(node.dc).push(node);
  }
  return new Map([...sites].map(([id, nodes]) => {
    const { Added, Removed, Retained } = roleCounts(nodes);
    const before = Removed + Retained, after = Added + Retained;
    const partial = { beforePartial: unknown.some(node => node.role !== 'Added'),
      afterPartial: unknown.some(node => node.role !== 'Removed') };
    return [id, { id, nodes, before, after, changed: !!(Added || Removed), partial: partial.beforePartial || partial.afterPartial,
      count: metricDelta(before, after, partial) }];
  }));
}

function membershipSummary(members, before, after, replacement) {
  const removed = members.filter(node => node.role === 'Removed'), added = members.filter(node => node.role === 'Added');
  const paired = replacement && removed.length === 1 && added.length === 1 && removed[0].dc && added[0].dc;
  const sites = [...membershipSites(members).values()].filter(site => site.changed);
  const siteNotes = sites.length <= 2 ? sites.filter(site => !site.partial && site.before !== site.after).map(site =>
    site.after === 0 ? site.id + ' loses its last subnet member.' : site.id + ' membership changes ' + site.count.text + '.') : [];
  return [paired ? 'Replace one node at ' + removed[0].dc + ' with one at ' + added[0].dc + '.'
    : added.length || removed.length ? 'Add ' + added.length + ' and remove ' + removed.length + ' nodes.' : 'Membership is unchanged.',
  before === after ? 'The subnet remains at ' + after + ' nodes.' : 'Subnet size: ' + metricDelta(before, after).text + ' members.',
  ...siteNotes, paired && added[0].provider && added[0].provider === removed[0].provider
    ? 'Both changed nodes have the same registered provider.' : ''].filter(Boolean).join(' ');
}

export function reviewReadiness(context, { work, final, consistency, stage }) {
  const calculation = consistency?.blocked ? 'Invalidated'
    : context?.calculation && ['stale', 'pending'].includes(context.status) ? 'Previous result retained'
    : context?.calculation ? 'Complete'
    : context?.status === 'outside' ? 'Outside this review’s work budget'
    : context?.status === 'unavailable' ? 'Failed'
    : ['running', 'stopping', 'idle'].includes(work) ? 'Pending' : 'Unavailable';
  const governance = consistency?.blocked ? 'Review invalidated by final check'
    : consistency ? 'Final verification failed'
    : final ? 'Final verification passed'
    : stage === 'Lifecycle' && work === 'running' ? 'Final verification in progress'
    : ['running', 'idle'].includes(work) ? 'Final verification pending' : 'Final verification not completed';
  return { calculation, governance };
}

export function assignmentCoverage(live, context) {
  const { listed_subnets: checked, total_listed_subnets } = live.outcome.Ok;
  const total = option(total_listed_subnets ?? []);
  if (total === undefined) return 'Checked ' + checked + ' listed subnet memberships. Assignments outside that scope remain unverified.';
  if (checked >= total) return 'Checked all ' + total + ' listed subnet memberships. Full execution validity remains unverified.';
  const outside = total - checked;
  const targeted = checked === 1 && context?.scenario.steps.some(step => step.requested.Add || step.requested.Change);
  return (targeted ? 'Target subnet checked' : checked + ' of ' + total + ' listed subnets checked')
    + '; assignments in the other ' + outside + ' listed ' + (outside === 1 ? 'subnet were' : 'subnets were') + ' not checked.';
}

export function reviewModel(live, context, evidence, section, replay) {
  const { report } = live.outcome.Ok;
  const version = report.manifest.registry_version;
  const calculation = context.calculation;
  const comparison = calculation?.comparison;
  const selected = comparison?.selected ?? context.state;
  const subnet = principal(context.subnet);
  const { final, consistency, work } = section;
  const previousAccepted = !!calculation && (context.status === 'pending' || context.status === 'stale');
  const members = Object.entries({ Removed: selected.removed, Added: selected.added, Retained: selected.retained })
    .flatMap(([role, ids]) => ids.map(id => memberEvidence(evidence, principal(id), role, section)));
  const labels = shortIds(members.map(node => node.id));
  for (const node of members) node.label = labels.get(node.id);
  const count = metricDelta(context.before.member_count, selected.member_count).text;
  const membership = count + ' ' + (selected.member_count === 1 ? 'member' : 'members') + ' · ' + roleSummary(members);
  const before = new Map(comparison?.baseline.distributions.map(([key, row]) => [branch(key), row]));
  const after = new Map(comparison?.selected.distributions.map(([key, row]) => [branch(key), row]));
  const composition = compositionRows(before, after);
  const dimensions = compositionDimensions(before, after);
  const countries = countryComparison(composition, dimensions.find(item => item.key === 'RegisteredCountry'));
  const distances = distanceSummary(comparison?.baseline.distances, comparison?.selected.distances);
  const coverage = assignmentCoverage(live, context);
  const evidenceNotes = [];
  const fields = { Nodes: 'node registration', Operators: 'operator and provider', DataCenters: 'data-center location and owner' };
  const failedReads = Object.entries(evidence).flatMap(([type, entries]) => {
    const failed = [...entries.values()].filter(([, row]) => row.Unavailable).length;
    return failed ? [failed + ' ' + fields[type] + ' ' + (failed === 1 ? 'read failed' : 'reads failed') + '.'] : [];
  });
  evidenceNotes.push(...failedReads);
  if (section.roleFailure || section.role?.retryable) evidenceNotes.push('The pinned NNS role could not be loaded.');
  else if (section.role && !option(section.role.nns_subnet)) evidenceNotes.push(option(section.role.issue) ?? 'The pinned NNS role is unavailable.');
  if (calculation && members.some(node => !node.point)) {
    const missing = members.filter(node => !node.point).length;
    evidenceNotes.push(missing + (missing === 1 ? ' node has' : ' nodes have') + ' no usable registered coordinates.');
  }
  if ([...before.values(), ...after.values()].some(row => row.unknown)) {
    evidenceNotes.push('Some members lack grouping evidence. A partial count is a recorded minimum. An unrecorded group is zero only when grouping evidence is complete.');
  }
  if (section.outside) evidenceNotes.push(section.outside
    + (section.outside === 1 ? ' affected subnet is' : ' affected subnets are') + ' outside the enriched scope.');
  const notes = [coverage, ...evidenceNotes,
    'Proposed membership is conditional on the pinned evidence. Full execution validity remains unverified.',
    consistency?.reason].filter(Boolean);
  return {
    members, composition, dimensions, countries, distances, membership, version,
    summary: membershipSummary(members, context.before.member_count, selected.member_count,
      context.scenario.steps.length === 1 && !!context.scenario.steps[0].requested.Change), subnet, coverage, evidenceNotes, notes, calculation, replay,
    beforeCount: context.before.member_count, selectedCount: selected.member_count,
    step: context.index, order: branch(context.scenario.id), scenario: scenarioName(context.scenario),
    stateLabel: context.index ? 'After proposal #' + context.scenario.steps[context.index - 1].proposal : 'Registered baseline',
    ids: Array.from(context.scenario.proposal_ids, String), previewRevision: hex(report.revision),
    governance: final ?? report.manifest.proposals, finalVerified: !!final && !previousAccepted && !consistency, work,
    previousAccepted, readiness: reviewReadiness(context, section),
  };
}

const utc = value => value ? value.replace('T', ' ').replace(/Z$/, ' UTC') : undefined;

export function replayLabel(replay) {
  const label = replay.activity ? 'Synthetic scenario' : 'Historical replay';
  return [replay.bundled ? 'Bundled test case · ' + label : label, replay.lifecycleLabel, 'Registry ' + number(BigInt(replay.registryVersion))].filter(Boolean).join(' · ');
}

export function replayRegistryText(replay) {
  return replay.registryFrom ? 'Original Registry observations ' + utc(replay.registryFrom)
    + ' to ' + utc(replay.registryTo) + '.' : 'Original Registry observation times unavailable for this replay.';
}

export function governanceText(proposal, replay, delivery = false) {
  const status = lifecycle[proposal.lifecycle_status] ?? words(String(proposal.lifecycle_status));
  if (!replay) return '#' + proposal.id + ' · ' + status + ' observed ' + time(proposal.observed_at_nanos);
  const capture = replay.actionEvidence.find(row => row.id === String(proposal.id));
  const when = utc(capture?.at);
  const origin = capture?.kind === 'recorded-governance-reply' ? 'Original Governance observation'
    : 'Original indexed observation';
  const label = replay.lifecycleLabel?.startsWith('Constructed') ? 'Constructed status: ' : 'Recorded status: ';
  return '#' + proposal.id + ' · ' + label + status + ' · '
    + (capture?.kind === 'synthetic-governance-action' ? 'Synthetic Governance action'
      : when ? origin + ' ' + when : 'Original observation time unavailable')
    + (delivery ? (replay.bundled ? ' · Fixture backend observed ' : ' · Local replay served ') + time(proposal.observed_at_nanos) : '');
}
