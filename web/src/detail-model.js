import { branch, hex, number, option, principal, time, words } from './view.js';

export const lifecycle = { 1: 'Open', 2: 'Rejected', 3: 'Adopted', 4: 'Executed', 5: 'Failed' };
export const scenarioName = scenario => Array.from(scenario.proposal_ids, id => 'Proposal #' + id).join(' then ');
export const calculationNote = 'The replicated calculation digest identifies the exact submitted evidence and scope. Source receipts identify the separate Registry and Governance observations.';
export const thresholdNote = 'The Nakamoto coefficient counts the fewest largest groups that together exceed one third of the subnet. It requires complete recorded grouping. This statistic uses recorded labels and does not establish independent ownership.';
export const geographyNote = 'The map uses registered data-center coordinates. They do not measure physical presence, health or latency. Region labels are split on commas and trimmed. No alias or country-equivalence conversion is applied.';
export const policyApplicabilityNote = 'Current policy applicability and later amendments have not been verified.';
const absent = 'Not recorded on-chain';

export const metrics = {
  Size: { label: 'Subnet size', help: 'The number of members in the selected state. A Target Topology size is an exact target.' },
  DataCenter: { label: 'Data center', help: 'A registered facility. The named group is selected from the facility-level assessments.' },
  RegisteredOwner: { label: 'Registered DC owner', help: 'The owner name declared in the Registry. The policy’s data-center provider is a separate identity for which this review has no verified mapping.' },
  Provider: { label: 'Node provider', help: 'The provider principal registered for a node. A node provider can be distinct from the company that provides the facility.' },
  RegisteredCountry: { label: 'Country label', help: 'The recorded country token in the Registry region string. The token does not establish canonical country identity.' },
};
export const assessments = {
  MatchesTarget: 'Matches target', DiffersFromTarget: 'Differs from target', WithinLimit: 'Within limit', AtLimit: 'At limit',
  ExceedsLimit: 'Exceeds limit', ExceptionUnresolved: 'Exception unresolved', IdentityUnresolved: 'Identity unresolved',
  DataIncomplete: 'Data incomplete',
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

function signed(value) {
  return (value < 0 ? '−' : '+') + Math.abs(value);
}

export function metricDelta(before, after, { percentage = false } = {}) {
  if (after === undefined) return { value: absent, change: '', text: absent };
  const rounded = value => Number(value.toFixed(percentage ? 2 : 0));
  const value = rounded(after) + (percentage ? '%' : '');
  const difference = before === undefined ? 0 : rounded(after - before);
  const change = difference === 0 ? '' : signed(difference) + (percentage ? ' percentage points' : '');
  return { value, change, direction: Math.sign(difference), text: change ? value + ' (' + change + ')' : value };
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

const groupName = group => group.Principal ? principal(group.Principal) : group.RegisteredLabel;
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

function policyDescription(policy, selectedId, subnet, running, failure) {
  if (!policy) return failure ? 'Could not load policy evidence'
    : running ? 'Waiting for policy evidence' : selectedId ? 'Policy evidence not loaded' : 'Pilot policy evidence not loaded';
  const motion = option(policy.motion);
  if (!motion) return 'No policy motion selected';
  if (option(motion.issue)) return 'Motion #' + motion.id + ' · ' + option(motion.issue);
  if (!option(policy.nns_subnet)) return 'Motion #' + motion.id + ' · NNS role unresolved';
  if (principal(option(policy.nns_subnet)) !== subnet) return 'Motion #' + motion.id + ' · This subnet’s policy role is unsupported';
  return 'Compared with adopted motion #' + motion.id;
}

export function reviewModel(live, context, evidence, section, policyId, local) {
  const { report, listed_subnets, total_listed_subnets } = live.outcome.Ok;
  const version = report.manifest.registry_version;
  const calculation = context.calculation;
  const comparison = calculation?.comparison;
  const selected = comparison?.selected ?? context.state;
  const subnet = principal(context.subnet);
  const { policyFailure, final, consistency, work } = section;
  const policy = calculation ? calculation.policy : section.policy;
  const previousAccepted = !!calculation && (context.status === 'pending' || context.status === 'stale');
  const running = work === 'running' || work === 'idle' || work === 'stopping';
  const partial = listed_subnets < (option(total_listed_subnets ?? []) ?? Infinity);
  const members = Object.entries({ Removed: selected.removed, Added: selected.added, Retained: selected.retained })
    .flatMap(([role, ids]) => ids.map(id => memberEvidence(evidence, principal(id), role, section)));
  const labels = shortIds(members.map(node => node.id));
  for (const node of members) node.label = labels.get(node.id);
  const count = metricDelta(context.before.member_count, selected.member_count).text;
  const membership = count + ' members' + (selected.added.length ? ' · +' + selected.added.length + ' added' : '')
    + (selected.removed.length ? ' · −' + selected.removed.length + ' removed' : '');
  const target = new Map((option(calculation?.target_rows ?? []) ?? []).map(row => [branch(row.metric), row]));
  const before = new Map(comparison?.baseline.distributions.map(([key, row]) => [branch(key), row]));
  const after = new Map(comparison?.selected.distributions.map(([key, row]) => [branch(key), row]));
  const source = option(policy?.motion ?? []);
  const rule = option(source?.rule ?? []);
  const policyText = policyDescription(policy, policyId, subnet, running, policyFailure);
  const incoming = members.filter(node => node.role === 'Added');
  const outgoing = members.filter(node => node.role === 'Removed');
  const sharedProvider = incoming.length === 1 && outgoing.length === 1 && incoming[0].provider
    && incoming[0].provider === outgoing[0].provider ? incoming[0].provider : undefined;
  const topology = Object.entries(metrics).map(([key, definition]) => {
    const row = target.get(key);
    const old = before.get(key);
    const next = after.get(key);
    const groupRows = (option(row?.groups ?? []) ?? []).map(item => ({ ...item, label: groupName(item.group) }));
    const beforeGroups = old ? groups(old) : [];
    const afterGroups = next ? groups(next) : [];
    const group = groupRows[0]?.label ?? afterGroups[0]?.label;
    const groupLabels = key === 'Provider' ? shortIds([...afterGroups, ...beforeGroups].map(item => item.label)) : new Map();
    const previous = key === 'Size' ? context.before.member_count : row ? option(row.before) : option(old?.largest ?? []);
    const current = key === 'Size' ? selected.member_count : row ? option(row.after) : option(next?.largest ?? []);
    const missing = next?.unknown ?? 0;
    const ready = key === 'Size' || !!calculation;
    const limit = !row ? '—' : key === 'Size' ? row.limit + ' target'
      : (key === 'RegisteredOwner' ? 'DC provider · ' : '') + row.limit + ' cap'
        + (key !== 'RegisteredCountry' && option(rule?.exception ?? []) ? ' · exception' : '');
    return {
      key, ...definition, old, next, previous, current, missing, ready, limit, group, groupRows,
      groupLabel: groupLabels.get(group) ?? group, groupLabels,
      sharedProvider: key === 'Provider' && sharedProvider ? { id: sharedProvider, label: groupLabels.get(sharedProvider) } : undefined,
      departures: key === 'DataCenter' && next?.unknown === 0 ? beforeGroups.filter(item => !afterGroups.some(next => next.label === item.label))
        .slice(0, 2).map(item => ({ label: item.label, delta: metricDelta(item.count, 0) })) : [],
      delta: current === undefined && missing ? { value: 'Data incomplete', text: 'Data incomplete', change: '' } : metricDelta(previous, current),
      evidence: ready ? (missing ? missing + ' members missing grouping evidence' : '')
        : work === 'stopped' ? 'Not loaded · Review stopped'
          : running ? (section.stage === 'DataCenters' && ['RegisteredOwner', 'RegisteredCountry'].includes(key)
            ? 'Loading data centers' : 'Waiting for comparison') : 'Could not calculate',
      assessment: row ? assessments[branch(row.assessment)]
        : running ? 'Pending' : work === 'stopped' ? 'Not assessed · Review stopped' : 'Not assessed',
      breach: option(row?.breach ?? []) && branch(option(row.breach)),
      beforeGroups, groups: afterGroups,
    };
  }).sort((a, b) => priority(a) - priority(b));
  const notes = [
    'Registry snapshot ' + number(version) + '. Governance has separate observation times.',
    'Assignment coverage ' + listed_subnets + ' of ' + (option(total_listed_subnets ?? []) ?? 'an unknown number of') + ' listed subnets.',
    partial ? 'Assignments outside checked subnets remain unverified.' : null,
    'Proposed membership is conditional on the pinned evidence. Full execution validity remains unverified.',
    consistency?.reason ?? null,
    local,
  ].filter(Boolean);
  if (members.some(node => !node.point) && !running) notes.push('Some members lack usable registered coordinates.');
  if (topology.some(row => row.missing)) notes.push('Recorded groups count members with known evidence. Members with missing evidence may increase those counts.');
  if (section.outside) notes.push(section.outside + (section.outside === 1 ? ' affected subnet is' : ' affected subnets are') + ' outside the enriched scope.');
  if (topology.some(row => row.assessment === 'Identity unresolved')) notes.push('Registered country labels and owner names cannot establish canonical country or policy-defined DC provider identity.');
  if (source) notes.push(policyApplicabilityNote);
  const publishing = publishingEvidence(live, context, subnet, before, after);
  return {
    members, topology, membership, version, subnet, policyText, policy, rule, source, notes, calculation,
    beforeCount: context.before.member_count, selectedCount: selected.member_count,
    scope: context.scenario, scenario: scenarioName(context.scenario),
    stateLabel: context.index ? 'After proposal #' + context.scenario.steps[context.index - 1].proposal : 'Registered baseline',
    ids: Array.from(context.scenario.proposal_ids, String), previewRevision: hex(report.revision),
    governance: final ?? report.manifest.proposals, finalVerified: !!final && !previousAccepted && !consistency, work,
    previousAccepted, publishing,
    gaps: section.stage === 'Gaps' || !!consistency || partial || topology.some(row => !row.ready || row.missing
      || row.assessment.endsWith('unresolved') || row.assessment === 'Not assessed'),
  };
}

function priority(row) {
  if (row.breach === 'New') return 0;
  if (row.breach === 'Worsened') return 1;
  if (row.assessment === 'Exceeds limit') return 2;
  if (row.assessment.endsWith('unresolved') || row.assessment === 'Data incomplete') return 3;
  if (row.breach === 'Resolved') return 4;
  return row.key === 'Size' ? 5 : 6;
}

export function governanceText(proposal) {
  return '#' + proposal.id + ' ' + (lifecycle[proposal.lifecycle_status] ?? words(String(proposal.lifecycle_status)))
    + ' observed ' + time(proposal.observed_at_nanos);
}
