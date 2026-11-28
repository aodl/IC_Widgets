import { dashboardLink, dashboardUrl } from './dashboard.js';
import { branch, el, option, styled, time } from './view.js';

export const transitionAssumption = 'Conservative availability model. The fault budget is floor((N − 1) / 3). Model departing nodes unavailable in the before-state and incoming nodes still synchronizing in the proposed state. The smaller margin applies. A margin below one triggers a warning. The cumulative case keeps all earlier arrivals unavailable while they remain in the subnet. These conditional margins do not establish global assignment, execution validity or actual liveness.';

const lifecycle = {
  Open: 'Open',
  Other: 'Decided',
  AdoptedPendingExecution: 'Adopted · awaiting execution',
};
const roles = {
  Incoming: 'incoming', Outgoing: 'outgoing', NewSubnetMember: 'new subnet member',
  RegistryRemoval: 'Registry removal', BoundaryAddition: 'API boundary addition',
  BoundaryRemoval: 'API boundary removal', BoundaryVersionTarget: 'API boundary version target',
  Textual: 'exact textual principal reference',
  RecoveryReplacement: 'recovery replacement', HostosVersionTarget: 'HostOS deployment target',
};
const preconditions = {
  EstablishedInCheckedScope: 'Established within the checked membership scope',
  IncompleteAssignmentCoverage: 'Incoming assignments could not be established across the Registry roster',
  Rejected: 'Modeled preconditions failed or the proposal cannot be applied',
  Skipped: 'An earlier step prevented validation',
};
const actionNames = {
  1: 'Create subnet', 2: 'Add nodes to subnet', 13: 'Remove nodes from subnets', 18: 'Remove Registry nodes',
  6: 'Recover subnet', 41: 'Update node HostOS', 51: 'Deploy HostOS to nodes',
  31: 'Change subnet membership', 43: 'Add API boundary nodes', 44: 'Remove API boundary nodes',
  46: 'Change API boundary version', 47: 'Deploy API boundary version',
};

const actionName = row => {
  const value = option(row.function);
  return row.motion ? 'Motion' : value === undefined ? 'Governance action (see proposal)'
    : actionNames[value] ?? 'NNS function ' + value;
};

const line = (text, proposal) => ({
  text, ...(proposal === undefined ? {} : { proposal: String(proposal), label: '#' + proposal, url: dashboardUrl('proposal', String(proposal)) }),
});

function marginText(margin) {
  return margin.remaining < 0 ? 'Warning · modeled fault budget exceeded by ' + -margin.remaining
    : margin.remaining === 0 ? 'Warning · zero margin. One further fault would exceed the modeled budget'
      : margin.remaining + (margin.remaining === 1 ? ' additional fault tolerable · ' : ' additional faults tolerable · ') + margin.further_faults_to_exceed + ' would exceed the modeled budget';
}

const side = value => value.members + ' members, budget ' + value.fault_budget + ', modeled unavailable '
  + value.modeled_unavailable + ', remaining ' + value.remaining;

function integrity(row) {
  const duplicate = (label, ids) => label + (ids.length ? ids.map(id => id.toText()).join(', ') : 'none');
  const overlap = row.overlap.length ? 'Add and Remove overlap · removal wins under the upstream simulation'
    : 'Add and Remove are disjoint';
  const overview = [overlap, 'Add duplicates ' + row.add_duplicates.length, 'Remove duplicates '
    + row.remove_duplicates.length, 'Membership preconditions · ' + preconditions[branch(row.preconditions)]].join(' · ');
  const margins = row.transitions.flatMap(item => {
    const margin = option(item.margin);
    const prefix = row.transitions.length > 1 ? item.subnet.toText() + ' · ' : '';
    const cumulative = option(item.cumulative_margin);
    return [prefix + (margin ? 'Conditional step margin · ' + marginText(margin) : 'Reconfiguration resilience margin unavailable'),
      ...(cumulative ? [prefix + 'Cumulative unsynchronized arrivals · ' + marginText(cumulative)] : [])];
  });
  return { margins, title: 'Step ' + (row.step + 1) + ' · Proposal #' + row.proposal,
    overview, details: [
      line(duplicate('Duplicate Add principals · ', row.add_duplicates)),
      line(duplicate('Duplicate Remove principals · ', row.remove_duplicates)),
      line(duplicate('Overlapping principals · ', row.overlap)),
      ...row.transitions.flatMap(item => {
        const margin = option(item.margin);
        return margin ? [line(item.subnet.toText() + ' · Before · ' + side(margin.before) + ' · Proposed · ' + side(margin.proposed))] : [];
      }),
    ],
    alert: branch(row.preconditions) !== 'EstablishedInCheckedScope' || row.add_duplicates.length > 0 || row.remove_duplicates.length > 0 || row.overlap.length > 0
      || row.transitions.some(item => (option(item.margin)?.remaining ?? 0) < 1 || (option(item.cumulative_margin)?.remaining ?? 1) < 1),
  };
}

export function interactionChecks(observation) {
  const { outcome, usage, receipts } = observation?.response ?? {};
  const timing = usage ? [
    ...(receipts.length ? ['Sources ' + [...new Set(receipts.map(row => row.source.toText()))].join(', ') + ' · ' + usage.calls + ' admitted reads'] : []),
    'Discovery observed ' + time(usage.started_at) + ' to ' + time(usage.finished_at),
  ] : [];
  if (!outcome?.Ok) return { overview: observation?.error
    ? 'Governance check incomplete · ' + observation.error : 'Governance check pending.', observations: timing, findings: [], proposals: [] };
  const { coverage, complete, matches, proposals } = outcome.Ok;
  const byId = new Map(proposals.map(row => [String(row.id), row]));
  const findings = matches.map(match => {
    const other = byId.get(String(match.other));
    const role = branch(match.other_role);
    const observed = other ? lifecycle[branch(other.lifecycle)] + ' · ' + actionName(other) + ' · topic ' + other.topic
      + ' · observed ' + time(other.observed_at) : 'Proposal details unavailable';
    const explanation = role === 'Textual' ? 'The principal appears in proposal text. Inspect its context.'
      : 'The same node appears in both executable instructions. Review how the proposed actions could interact.';
    return line(match.node.toText() + ' · ' + roles[branch(match.requested_role)] + ' in #' + match.proposal
      + ' · ' + observed + ' · ' + roles[role] + ' in the other proposal. ' + explanation, match.other);
  });
  return {
    overview: (observation.stale ? 'Previous Governance observation · refresh failed' : complete ? 'Governance check complete within the supported evidence' : 'Governance check incomplete')
      + ' · ' + findings.length + (findings.length === 1 ? ' reference found' : ' references found'),
    observations: [
      ...timing,
      'Pagination ' + (coverage.pagination_complete ? 'complete' : 'incomplete') + ' · ' + coverage.pages + ' pages'
        + (coverage.oldest_listed.length ? ' · oldest listed #' + coverage.oldest_listed[0] : '')
        + ' · Open ' + coverage.open_listed + ' · Adopted awaiting execution ' + coverage.adopted_listed,
      'Title, summary and supported motion text checked for ' + coverage.textual_checked + ' proposals' + ' · Supported actions decoded ' + coverage.executable_decoded
        + ' · Hydrated ' + coverage.hydrated + ' · Lifecycle changed ' + coverage.changed_lifecycle,
      'Unsupported actions ' + coverage.unsupported_actions + ' · Missing payloads ' + coverage.missing_payloads
        + ' · Malformed payloads ' + coverage.malformed_payloads + ' · Omitted findings ' + coverage.omitted_matches,
      ...coverage.issues,
    ],
    findings,
    proposals: proposals.map(row => ({ ...row, action: actionName(row), observedLifecycle: lifecycle[branch(row.lifecycle)] })),
  };
}

export function reviewCheckSummary(rows, order, observation) {
  const { overview, observations, findings } = interactionChecks(observation);
  return { instructions: (rows ?? []).filter(row => branch(row.scenario) === order).map(integrity),
    assumption: transitionAssumption, interactions: { overview, observations, findings } };
}

const renderLine = row => row.proposal ? [row.text, ' ', dashboardLink('proposal', row.proposal, 'Other proposal ' + row.label)] : row.text;

export function reviewChecksView(checks) {
  const { instructions, interactions } = checks;
  const groups = new Map();
  for (const finding of interactions.findings) {
    if (!groups.has(finding.proposal)) groups.set(finding.proposal, []);
    groups.get(finding.proposal).push(finding);
  }
  const items = [...groups.values()].map(rows => rows.length === 1 ? el('li', renderLine(rows[0]))
    : el('li', el('details', el('summary', dashboardLink('proposal', rows[0].proposal, rows[0].label),
      ' · ' + rows.length + ' references'), el('ul', rows.map(row => el('li', row.text))))));
  const visibleFindings = items.slice(0, 3);
  const moreFindings = items.slice(3);
  return styled('section', 'review-checks card', el('h3', 'Review checks'),
    instructions.length ? instructions.map(row => styled('div', row.alert ? 'check-warning' : 'check-status',
      el('strong', row.title), el('p', row.overview), row.margins.map(margin => el('p', el('strong', margin))),
      el('details', el('summary', 'Reconfiguration resilience and instructions'),
        el('p', checks.assumption), el('ul', row.details.map(item => el('li', renderLine(item)))))))
      : el('p', 'Instruction integrity and resilience are unavailable for this review.'),
    el('p', el('strong', interactions.overview)),
    visibleFindings.length ? el('ul', visibleFindings) : null,
    moreFindings.length ? el('details', el('summary', 'More related proposals (' + moreFindings.length + ')'),
      el('ul', moreFindings)) : null,
    interactions.observations.length ? el('details', el('summary', 'Governance discovery coverage'),
      el('ul', interactions.observations.map(text => el('li', text)))) : null);
}

export function scopedActivity(observation, ids) {
  const accepted = observation?.response?.outcome?.Ok;
  if (!accepted || !ids.every(id => accepted.proposals.some(row => row.id === id))) return undefined;
  return { stale: observation.stale, response: { ...observation.response, outcome: { Ok: {
    ...accepted, matches: accepted.matches.filter(match => ids.includes(match.proposal)),
  } } } };
}
