import { branch, hex, option, principal, scenarioLabel, time, words } from './view.js';

export const proposalUrl = id => 'https://dashboard.internetcomputer.org/proposal/' + id;
const registryUrl = (kind, id) => 'https://dashboard.internetcomputer.org/' + kind + '/' + encodeURIComponent(id);
const link = (label, url) => ({ label: String(label), url });
const nodeLink = id => link(id, registryUrl('node', id));
const names = {
  RegisteredContinent: 'Registered continent',
  RegisteredCountry: 'Registered country',
  DataCenter: 'Data center',
  RegisteredOwner: 'Registered data-center owner',
  Provider: 'Node provider',
  Operator: 'Node operator',
  RegisteredArea: 'Registered area (locality label)',
};
export const eligibility = 'Registration and hardware fields describe Registry entries. They provide no health, uptime, hardware attestation, or proof of decommissioning.';
export const thresholdNote = 'The Nakamoto coefficient counts the fewest groups that together exceed one third of the subnet. The separate f + 1 column uses f = floor((members − 1)/3). A coefficient requires complete coverage for that dimension. Registered ownership labels do not establish common control.';
export const geographyNote = 'Distances use great-circle distances between registered data-center coordinates, weighted by node pairs. Pairs at the same coordinate count as zero. Missing coordinates are excluded and coverage is shown. Registered locations do not establish physical location or network latency.';
const lifecycle = { 1: 'Open', 2: 'Rejected', 3: 'Adopted', 4: 'Executed', 5: 'Failed' };
const kinds = { 1: 'Application', 2: 'System', 4: 'Verified Application', 5: 'Cloud Engine' };
const rewards = ['Unspecified', 'Type 0', 'Type 1', 'Type 2', 'Type 3', 'Type 3.1', 'Type 1.1',
  'Type 4', 'Type 4.1', 'Type 4.2', 'Type 4.3', 'Type 4.4', 'Type 4.5'];
const unknown = 'Unavailable';
const signed = value => value > 0 ? '+' + value : String(value);
const ratio = ([a, b]) => (a / b).toFixed(2);
const formatPair = (before, after) => before + ' → ' + after;

const groups = row => new Map(row.groups.map(([group, count]) => [
  group.Principal ? principal(group.Principal) : group.RegisteredLabel, count,
]));
const threshold = (row, rule) => option(row[rule]);
const coefficient = (row, rule = 'greater_than_one_third') => option(threshold(row, rule)?.groups_to_reach ?? []);
const share = (count, members) => members ? (100 * count / members).toFixed(1) + '%' : unknown;
const largest = (row, members) => {
  const count = option(row.largest);
  return count === undefined ? unknown : count + ' (' + share(count, members) + ')' + (row.unknown ? ' known' : '');
};
const formatThreshold = (row, rule) => {
  const value = threshold(row, rule);
  return value ? (option(value.groups_to_reach) ?? unknown) + ' / ' + value.nodes_required + ' nodes' : 'Not modelled';
};
const difference = (a, b) => a === undefined || b === undefined ? unknown : signed(b - a);
const value = record => record?.Present?.value;
const recordStatus = record => record ? words(branch(record)) : 'Not read';

export function memberEvidence(evidence, id, role) {
  const nodeRecord = evidence.Nodes.get(id)?.[1];
  const node = value(nodeRecord);
  const operatorId = option(node?.operator ?? [])?.toText();
  const operatorRecord = evidence.Operators.get(operatorId)?.[1];
  const operator = value(operatorRecord);
  const provider = option(operator?.provider ?? [])?.toText();
  const dc = operator?.data_center.toLowerCase() || undefined;
  const dcRecord = evidence.DataCenters.get(dc)?.[1];
  const center = value(dcRecord);
  const point = option(center?.coordinates ?? []);
  const reward = option(node?.reward_type ?? []);
  const missing = [
    !node && 'node record ' + recordStatus(nodeRecord).toLowerCase(),
    node && !operatorId && 'operator ID unavailable',
    operatorId && !operator && 'operator record ' + recordStatus(operatorRecord).toLowerCase(),
    operator && !provider && 'provider ID unavailable',
    operator && !dc && 'data-center ID unavailable',
    dc && !center && 'data-center record ' + recordStatus(dcRecord).toLowerCase(),
    center && !point && 'GPS unavailable',
  ].filter(Boolean);
  return {
    id, role, dc, provider, operatorId, owner: center?.registered_owner.trim(),
    region: center?.registered_region, point: point && {
      lat: point.latitude_e7 / 10_000_000, lon: point.longitude_e7 / 10_000_000,
    },
    row: [
      nodeLink(id), dc ? link(dc, registryUrl('center', dc)) : unknown,
      center?.registered_owner.trim() || unknown, center?.registered_region || unknown,
      provider ? link(provider, registryUrl('provider', provider)) : unknown,
      operatorId ?? unknown,
      node ? (rewards[reward] ?? (reward === undefined ? unknown : 'Code ' + reward)) : recordStatus(nodeRecord),
      node ? (node.has_chip_id ? 'Registered' : 'Absent') : unknown, missing.join('; ') || '—',
    ],
  };
}

function proposalClaimRows(text, dimensions) {
  const found = [...text.summary.matchAll(/^\s*(node_provider|data_center|data_center_owner|area|country|continent|city|node_operator):\s*(\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?)/gm)];
  const claims = {
    node_provider: 'Provider', data_center: 'DataCenter', data_center_owner: 'RegisteredOwner',
    country: 'RegisteredCountry', continent: 'RegisteredContinent', area: 'RegisteredArea',
    city: 'RegisteredArea', node_operator: 'Operator',
  };
  const rows = found.map(([, name, claimedBefore, claimedAfter]) => {
    const row = dimensions.find(row => row.key === claims[name]);
    const a = coefficient(row.before);
    const b = coefficient(row.after);
    const result = a === undefined || b === undefined ? 'Coverage insufficient'
      : a === Number(claimedBefore) && b === Number(claimedAfter) ? 'Matches under this grouping'
        : 'Differs under this grouping';
    return [name, formatPair(claimedBefore, claimedAfter), formatPair(a ?? unknown, b ?? unknown), result];
  });
  const fields = ['node_provider', 'data_center', 'data_center_owner', 'area', 'country'];
  const fitsPublishedDimensions = found.length === fields.length && fields.every(key => found.some(([, name]) => name === key));
  if (fitsPublishedDimensions) {
    const features = [...fields.map(key => claims[key]), 'Operator'].map(key => dimensions.find(row => row.key === key));
    const scores = ['before', 'after'].map(side => features.map(row => coefficient(row[side])));
    const aggregate = (pattern, label, decimals, transform) => {
      const claim = text.summary.match(pattern);
      if (!claim) return;
      const computed = scores.map(side => side.every(value => value > 0)
        ? (side.reduce((sum, value) => sum + transform(value), 0) / side.length).toFixed(decimals) : unknown);
      const [a, b] = computed;
      const status = a === unknown || b === unknown ? 'Coverage insufficient'
        : Number(a) === Number(claim[1]) && Number(b) === Number(claim[2])
          ? 'Reproduced with node operator as sixth dimension' : 'Differs with node operator as sixth dimension';
      rows.push([label, formatPair(claim[1], claim[2]), formatPair(a, b), status]);
    };
    aggregate(/Mean Nakamoto comparison:\*?\*?\s*(\d+\.\d+)\s*->\s*(\d+\.\d+)/i, 'Mean coefficient', 2, value => value);
    aggregate(/average log2[^\n]*?\bfrom\s+(\d+\.\d+)\s+to\s+(\d+\.\d+)/i, 'Mean log₂ coefficient', 4, Math.log2);
  }
  return rows;
}

function dimension(key, before, after, beforeCount, afterCount) {
  const a = groups(before);
  const b = groups(after);
  const rows = [...new Set([...a.keys(), ...b.keys()])].map(label => ({
    label, was: a.get(label) ?? 0, now: b.get(label) ?? 0,
  })).sort((x, y) => Math.max(y.now, y.was) - Math.max(x.now, x.was) || x.label.localeCompare(y.label));
  const change = difference(coefficient(before), coefficient(after));
  const changes = rows.filter(row => row.was !== row.now);
  const summary = changes.length ? changes.slice(0, 4).map(row => row.label + ' ' + formatPair(row.was, row.now)).join('; ')
    + (changes.length > 4 ? '; and ' + (changes.length - 4) + ' more' : '') : 'Known group counts unchanged';
  return {
    key, before, after, label: names[key], changes,
    summary: [names[key], formatPair(a.size, b.size), formatPair(largest(before, beforeCount), largest(after, afterCount)),
      formatPair(formatThreshold(before, 'greater_than_one_third'), formatThreshold(after, 'greater_than_one_third')),
      change, formatPair(formatThreshold(before, 'fault_budget_plus_one'), formatThreshold(after, 'fault_budget_plus_one')),
      formatPair(before.unknown, after.unknown)],
    table: {
      title: names[key], headers: ['Group', 'Before (share)', 'After (share)', 'Node change'],
      rows: [
        ...rows.map(({ label, was, now }) => [
          key === 'Provider' ? link(label, registryUrl('provider', label))
            : key === 'DataCenter' ? link(label, registryUrl('center', label)) : label,
          was + ' (' + share(was, beforeCount) + ')', now + ' (' + share(now, afterCount) + ')', signed(now - was),
        ]),
        ['Unknown', before.unknown, after.unknown, signed(after.unknown - before.unknown)],
      ],
    },
    note: summary + '. Known group sizes (min / mean / max), ' + formatPair(
      [option(before.smallest) ?? unknown, before.mean_ratio.length ? ratio(before.mean_ratio[0]) : unknown, option(before.largest) ?? unknown].join(' / '),
      [option(after.smallest) ?? unknown, after.mean_ratio.length ? ratio(after.mean_ratio[0]) : unknown, option(after.largest) ?? unknown].join(' / '),
    ) + '.',
  };
}

export function reviewModel(live, scenario, subnet, state, rules, comparison, evidence, failures) {
  const { report, listed_subnets: checked, assignments } = live.outcome.Ok;
  const { registry_version: version, proposals } = report.manifest;
  const scope = option(live.outcome.Ok.total_listed_subnets) ?? unknown;
  const selected = comparison?.selected ?? state;
  const ids = Array.from(scenario.proposal_ids, String);
  const view = scenario.subnets.find(([id]) => principal(id) === subnet)[1];
  const members = [
    ...selected.removed.map(id => memberEvidence(evidence, principal(id), 'Removed')),
    ...selected.added.map(id => memberEvidence(evidence, principal(id), 'Added')),
    ...selected.retained.map(id => memberEvidence(evidence, principal(id), 'Retained')),
  ];
  const membership = view.baseline.member_count + ' → ' + selected.member_count + ' members'
    + ' (' + selected.added.length + ' added, ' + selected.removed.length + ' removed, ' + selected.retained.length + ' retained)';
  const notes = [
    'Hypothetical membership; execution validity remains unverified. Assignments outside the checked subnets remain unverified.',
    'Membership evidence checked ' + checked + ' of ' + scope + ' listed subnets.',
  ];
  const candidates = new Set();
  const steps = scenario.steps.map(step => {
    const action = branch(step.requested);
    const request = step.requested[action];
    const adds = (request.add ?? (action === 'Add' ? request.nodes : [])).map(principal);
    const removes = (request.remove ?? (action === 'Remove' ? request.nodes : [])).map(principal);
    for (const id of [...adds, ...removes]) candidates.add(id);
    return [link('#' + step.proposal, proposalUrl(step.proposal)), words(action), words(branch(step.outcome)),
      adds.join(', ') || '—', removes.join(', ') || '—'];
  });
  const finding = row => [
    words(branch(row.severity)), words(branch(row.code)), option(row.proposal)?.toString() ?? '—',
    row.nodes.map(principal).join(', ') || '—', row.subnets.map(principal).join(', ') || '—',
  ];
  const relevant = [...report.findings, ...scenario.findings, ...scenario.steps.flatMap(step => step.findings)];
  const tables = [
    { title: 'Governance observations', headers: ['Proposal', 'Status', 'Observed (UTC)', 'Function'],
      rows: proposals.filter(p => ids.includes(String(p.id))).map(row => [
        link('#' + row.id, proposalUrl(row.id)), lifecycle[row.lifecycle_status] ?? row.lifecycle_status, time(row.observed_at_nanos), row.function,
      ]) },
    { title: 'Requested changes', headers: ['Proposal', 'Action', 'Simulation', 'Requested additions', 'Requested removals'], rows: steps },
    { title: 'Simulation findings', headers: ['Severity', 'Finding', 'Proposal', 'Nodes', 'Subnets'], rows: relevant.map(finding) },
    { title: 'Candidate assignments at baseline', headers: ['Node', 'Evidence'], rows: assignments.filter(([node]) => candidates.has(principal(node))).map(([node, item]) => [
      nodeLink(principal(node)), item.ListedSubnet ? link(principal(item.ListedSubnet), registryUrl('subnet', principal(item.ListedSubnet))) : ({
        ApiBoundary: 'API boundary assignment', NodeAbsent: 'Node registration absent',
        UnknownOutsideListedSubnets: 'Assignment outside checked records unverified',
      })[branch(item)],
    ]) },
  ];
  const dimensions = [];
  const consequences = [];
  let claim;
  if (comparison) {
    const b = new Map(comparison.baseline.distributions.map(([kind, row]) => [branch(kind), row]));
    const a = new Map(comparison.selected.distributions.map(([kind, row]) => [branch(kind), row]));
    b.set('RegisteredArea', comparison.registered_area_before);
    a.set('RegisteredArea', comparison.registered_area_after);
    for (const key of Object.keys(names)) dimensions.push(dimension(key, b.get(key), a.get(key), comparison.baseline.member_count, selected.member_count));
    dimensions.forEach(row => {
      const x = coefficient(row.before);
      const y = coefficient(row.after);
      const oldShare = option(row.before.largest) / comparison.baseline.member_count;
      const newShare = option(row.after.largest) / selected.member_count;
      const known = row.before.unknown === 0 && row.after.unknown === 0;
      if (x !== undefined && y !== undefined && x !== y) {
        consequences.push(row.label + ' needs ' + (y < x ? 'fewer' : 'more') + ' groups to exceed one third (' + formatPair(x, y) + '). ' + row.note.split('. Known group sizes')[0] + '.');
      }
      if (known && newShare > oldShare) consequences.push(row.label + ' largest share rises from ' + share(option(row.before.largest), comparison.baseline.member_count) + ' to ' + share(option(row.after.largest), selected.member_count) + '.');
    });
    const dc = dimensions.find(row => row.key === 'DataCenter');
    if (!dc.before.unknown && !dc.after.unknown) {
      for (const row of dc.changes.filter(row => row.was > 0 && row.now === 0)) {
        consequences.push('The last member registered at ' + row.label + ' leaves this subnet in the selected state. This is scoped to the subnet.');
      }
    }
    const db = comparison.baseline.distances;
    const da = selected.distances;
    const km = value => value.length ? (value[0] / 1000).toFixed(3) : unknown;
    tables.push({
      title: 'Decentralisation and concentration',
      headers: ['Dimension', 'Known groups', 'Largest group', 'Nakamoto / threshold', 'Δ Nakamoto', 'f + 1 groups / threshold', 'Unknown members'],
      rows: dimensions.map(row => row.summary),
    }, {
      title: 'Geographic distances',
      headers: ['Coverage and statistic', 'Before', 'Selected state'],
      rows: [
        ['Mapped members', db.known_nodes, da.known_nodes],
        ['Unmapped members', db.unknown_nodes, da.unknown_nodes],
        ['Geolocated pairs', db.valid_pairs + ' / ' + db.total_pairs, da.valid_pairs + ' / ' + da.total_pairs],
        ...[['minimum_metres', 'Shortest (km)'], ['mean_metres', 'Mean (km)'], ['maximum_metres', 'Longest (km)']]
          .map(([key, label]) => [label, km(db[key]), km(da[key])]),
      ],
    });
    if (dimensions.some(row => row.before.unknown || row.after.unknown)) notes.push('Some group assignments are unknown. Known counts and shares can understate concentrations.');
    const text = option(live.outcome.Ok.proposal_text ?? [])?.find(p => String(p.id) === ids[0]);
    const claimsMatchScope = ids.length === 1 && selected.added.length + selected.removed.length > 0
      && scenario.steps[0].requested.Change?.subnet.toText() === subnet;
    if (text?.summary && claimsMatchScope) {
      const rows = proposalClaimRows(text, dimensions);
      claim = { id: text.id, title: option(text.title), summary: text.summary, truncated: text.truncated };
      if (rows.length) tables.push({
        title: 'Proposer claims and independent calculation',
        headers: ['Proposer dimension', 'Claimed coefficient', 'Registry calculation', 'Comparison'], rows,
      });
    }
  }
  if (!comparison) notes.push('Detailed Registry calculations have not loaded.');
  if (rules) notes.push('Subnet type ' + (kinds[rules.kind] ?? rules.kind) + '. SEV ' + (rules.sev_enabled ? 'enabled; registered chip identity required by the modeled check.' : 'disabled at the pinned baseline.'));
  notes.push(eligibility);
  if (failures.length) notes.push('Detailed source pages unavailable (' + failures.length + '). Affected fields remain unknown.');
  for (const role of ['Added', 'Removed', 'Retained']) tables.push({
    title: role + ' nodes',
    headers: ['Node', 'Data center', 'Registered owner', 'Registered region', 'Provider', 'Operator', 'Reward type', 'SEV chip ID', 'Evidence gaps'],
    rows: members.filter(row => row.role === role).map(row => row.row),
  });

  return {
    ids, subnet, subnetLink: link(subnet, registryUrl('subnet', subnet)), version, membership,
    scenario: scenarioLabel(scenario.id), notes, dimensions, consequences, members, tables, claim,
    stateLabel: state.label,
    payloads: proposals.filter(p => ids.includes(String(p.id))).map(p => '#' + p.id + ' SHA-256 ' + hex(p.payload_hash)),
  };
}
