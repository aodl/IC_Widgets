import { branch, hex, number, option, principal, time, words } from './view.js';

export const lifecycle = { 1: 'Open', 2: 'Rejected', 3: 'Adopted', 4: 'Executed', 5: 'Failed' };
export const scenarioName = scenario => Array.from(scenario.proposal_ids, id => 'Proposal #' + id).join(' then ');
export const calculationNote = 'The replicated calculation digest identifies the exact submitted evidence and scope. Source receipts identify the separate Registry and Governance observations.';
export const thresholdNote = 'The Nakamoto coefficient counts the fewest largest groups that together exceed one third of the subnet. It requires complete recorded grouping. This statistic uses recorded labels and does not establish independent ownership.';
export const geographyNote = 'The map uses registered data-center coordinates. They do not measure physical presence, health or latency. Region labels are split on commas and trimmed. No alias or country-equivalence conversion is applied.';
export const criteriaNote = 'No Target Topology limits have been assumed. Apply the policy and exceptions relevant to your review.';
const absent = 'Not recorded on-chain';

export const metrics = {
  DataCenter: { label: 'Data center', help: 'The facility ID recorded for a node. Nodes with the same ID are counted together.' },
  RegisteredOwner: { label: 'Registered owner name', help: 'The owner name stored for a data center. Matching names are grouped. This does not prove corporate independence.' },
  Provider: { label: 'Node provider', help: 'The provider principal recorded for a node. The provider and data-center owner can be different.' },
  RegisteredCountry: { label: 'Recorded country label', help: 'The country text in the registered location. Different spellings remain separate.' },
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

export function metricDelta(before, after, { percentage = false, beforePartial = false, afterPartial = false } = {}) {
  let places = percentage ? 2 : 0;
  if (percentage && before !== after && before !== undefined && after !== undefined) {
    while (places < 6 && before.toFixed(places) === after.toFixed(places)) places++;
  }
  const display = (value, partial) => value === undefined ? undefined
    : (partial ? '≥' : '') + Number(value.toFixed(places)) + (percentage ? '%' : '');
  const a = display(before, beforePartial);
  const b = display(after, afterPartial);
  if (a === undefined && b === undefined) return { text: 'Unavailable from recorded evidence' };
  if (a === undefined) return { text: b + ' · Before unavailable' };
  if (b === undefined) return { text: a + ' before · Proposed unavailable' };
  if (a === b) return { text: before === after ? a : 'About ' + a + ' in both states', after: b };
  return {
    text: a + ' → ' + b, before: a, after: b, direction: Math.sign(after - before),
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

export function memberEvidence(evidence, id, role, { work, stage }) {
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
  const nodeIssue = recordState(nodeRecord, stage === 'Nodes' ? 'Loading node records' : 'Waiting for node records', work);
  const operatorIssue = nodeIssue ?? (!operatorId ? absent : recordState(operatorRecord,
    stage === 'Operators' ? 'Loading operator records' : 'Waiting for operator records', work));
  const centerIssue = operatorIssue ?? (!dc ? absent : recordState(dcRecord,
    stage === 'DataCenters' ? 'Loading data centers' : 'Waiting for data centers', work));
  return {
    id, role, dc, provider, operatorId, owner: center?.registered_owner.trim(), region: center?.registered_region, point,
    nodeIssue, operatorIssue, centerIssue,
    locationIssue: point ? undefined : centerIssue ?? (coordinates ? 'Registered coordinates are invalid' : 'Coordinates ' + absent.toLowerCase()),
    locationPending: !point && ['idle', 'running', 'stopping'].includes(work)
      && (!nodeRecord || (operatorId && !operatorRecord) || (dc && !dcRecord)),
  };
}

export function groupKey(node, dimension) {
  if (dimension === 'RegisteredCountry') return node.region?.split(',')[1]?.trim() || undefined;
  return ({ RegisteredOwner: node.owner, DataCenter: node.dc, Provider: node.provider })[dimension] || undefined;
}

function groups(distribution) {
  return distribution.groups.map(([group, count]) => ({
    label: group.Principal ? principal(group.Principal) : group.RegisteredLabel, count,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const coefficient = row => option(option(row?.greater_than_one_third ?? [])?.groups_to_reach ?? []);

function publishingEvidence(live, context, subnet, before, after) {
  const dimensions = { data_center: ['DataCenter', 'Data center'], data_center_owner: ['RegisteredOwner', 'Registered DC owner'],
    node_provider: ['Provider', 'Node provider'], node_operator: ['Operator', 'Node operator'],
    country: ['RegisteredCountry', 'Recorded country label'] };
  const changes = Object.values(dimensions).flatMap(([key, label]) => {
    const a = coefficient(before.get(key));
    const b = coefficient(after.get(key));
    return a !== undefined && b !== undefined && a !== b ? [[label, metricDelta(a, b).text]] : [];
  });
  const source = (option(live.outcome.Ok.proposal_text ?? []) ?? []).find(row => row.id === context.scenario.proposal_ids[0]);
  const heading = 'Decentralization Nakamoto coefficient changes for subnet `' + subnet + '`:';
  const summary = source?.summary.split(heading)[1]?.split('\n\n')[0];
  const claims = !summary || context.scenario.proposal_ids.length !== 1 || !context.index ? []
    : [...summary.matchAll(/^\s*(\w+)\s*:\s*(\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?)/gm)].flatMap(([, name, proposedBefore, proposedAfter]) => {
      if (!dimensions[name]) return [];
      const [key, label] = dimensions[name];
      const a = coefficient(before.get(key));
      const b = coefficient(after.get(key));
      return [[label, metricDelta(Number(proposedBefore), Number(proposedAfter)).text,
        a === undefined || b === undefined ? 'Grouping evidence incomplete' : metricDelta(a, b).text,
        a === undefined || b === undefined ? 'Unverified' : a === Number(proposedBefore) && b === Number(proposedAfter) ? 'Agrees' : 'Differs']];
    });
  return { changes, claims };
}

export function compositionRows(before, after, sharedProvider) {
  return Object.entries(metrics).flatMap(([key, definition]) => {
    const old = before.get(key);
    const next = after.get(key);
    if (!old || !next) return [];
    const prior = new Map(groups(old).map(item => [item.label, item.count]));
    const proposed = new Map(groups(next).map(item => [item.label, item.count]));
    const labels = [...new Set([...prior.keys(), ...proposed.keys()])];
    const names = key === 'Provider' ? shortIds(labels) : new Map();
    const largest = proposed.keys().next().value;
    return labels.map(group => {
      const a = prior.get(group) ?? (old.unknown ? undefined : 0);
      const b = proposed.get(group) ?? (next.unknown ? undefined : 0);
      const changed = (prior.get(group) ?? 0) !== (proposed.get(group) ?? 0);
      const shared = key === 'Provider' && group === sharedProvider;
      const last = key === 'DataCenter' && a > 0 && b === 0;
      const note = last ? 'Last member leaves this subnet' : shared ? 'Incoming and outgoing nodes share this provider' : '';
      return { key, group, groupLabel: names.get(group) ?? group, ...definition, a, b, old, next, changed, note,
        delta: metricDelta(a, b, { beforePartial: !!old.unknown, afterPartial: !!next.unknown }),
        featured: changed || group === largest || shared };
    }).sort((a, b) => Number(b.changed) - Number(a.changed)
      || (b.b ?? -1) - (a.b ?? -1) || a.group.localeCompare(b.group));
  });
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
  const membership = count + ' ' + (selected.member_count === 1 ? 'member' : 'members') + ' · '
    + selected.retained.length + ' retained · ' + selected.added.length + ' incoming · ' + selected.removed.length + ' outgoing';
  const before = new Map(comparison?.baseline.distributions.map(([key, row]) => [branch(key), row]));
  const after = new Map(comparison?.selected.distributions.map(([key, row]) => [branch(key), row]));
  const incoming = members.filter(node => node.role === 'Added');
  const outgoing = members.filter(node => node.role === 'Removed');
  const sharedProvider = incoming.length === 1 && outgoing.length === 1 && incoming[0].provider
    && incoming[0].provider === outgoing[0].provider ? incoming[0].provider : undefined;
  const composition = compositionRows(before, after, sharedProvider);
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
  const publishing = publishingEvidence(live, context, subnet, before, after);
  return {
    members, composition, membership, version, subnet, coverage, evidenceNotes, notes, calculation, replay,
    beforeCount: context.before.member_count, selectedCount: selected.member_count,
    scope: context.scenario, scenario: scenarioName(context.scenario),
    stateLabel: context.index ? 'After proposal #' + context.scenario.steps[context.index - 1].proposal : 'Registered baseline',
    ids: Array.from(context.scenario.proposal_ids, String), previewRevision: hex(report.revision),
    governance: final ?? report.manifest.proposals, finalVerified: !!final && !previousAccepted && !consistency, work,
    previousAccepted, publishing,
  };
}

const utc = value => value ? value.replace('T', ' ').replace(/Z$/, ' UTC') : undefined;

export function replayLabel(replay) {
  return ['Historical replay', replay.lifecycleLabel, 'Registry ' + number(replay.registryVersion)].filter(Boolean).join(' · ');
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
    + (when ? origin + ' ' + when : 'Original observation time unavailable')
    + (delivery ? ' · Local replay served ' + time(proposal.observed_at_nanos) : '');
}
