import { assessments, calculationNote, geographyNote, governanceText, groupKey, lifecycle, metrics, metricDelta, policyApplicabilityNote, reviewModel, scenarioName, shortIds, thresholdNote } from './detail-model.js';
import { terminalOutcome } from './terminal-outcome.js';
import { markdownEditor } from './review-export.js';
import { help } from './review-help.js';
import { action, saveFile } from './review-map.js';
import { affectedNodes, comparisonEvidence, createReviewSession, readFailures, stageLabel } from './review-session.js';
import { branch, el, hex, number, option, principal, sourceReceipts, styled, table, time, words } from './view.js';

const disclosure = (title, ...content) => el('details', el('summary', title), ...content);
const roleNames = { Added: '+ Added', Removed: '− Removed', Retained: '• Retained' };

function replace(node, ...children) {
  const name = item => item.getAttribute('aria-label') || item.textContent.trim();
  const focused = node.contains(document.activeElement) ? name(document.activeElement) : undefined;
  const open = new Set([...node.querySelectorAll('details[open] > summary')].map(name));
  node.replaceChildren(...children.flat().filter(child => child != null));
  for (const summary of node.querySelectorAll('details > summary')) summary.parentElement.open = open.has(name(summary));
  if (focused) [...node.querySelectorAll('button, input, summary, select, textarea, [tabindex="-1"]')]
    .find(item => name(item) === focused)?.focus({ preventScroll: true });
}

function selector(label, entries, value, changed) {
  const select = el('select', entries.map(([key, title]) => Object.assign(el('option', title), { value: key })));
  select.value = value;
  select.setAttribute('aria-label', label);
  select.addEventListener('change', () => changed(select.value));
  return el('label', label, select);
}

function deltaNode(delta) {
  return el('span', delta.value, delta.change
    ? styled('span', delta.direction > 0 ? 'delta-up' : 'delta-down', ' (' + delta.change + ')') : null);
}

const breachLabel = change => change === 'Improved' ? 'Improved · still exceeds the cap' : words(change) + ' breach';

function nodeButton(node, click) {
  return action([roleNames[node.role], node.label, node.dc, node.region?.split(',')[2]?.trim()].filter(Boolean).join(' · '), click);
}

function policyEvidence(model, state, policyId) {
  const snapshot = state.policy;
  const motion = option(snapshot?.motion ?? []);
  const rule = option(motion?.rule ?? []);
  const stamp = option(snapshot?.nns_mutation_version ?? []);
  const roleStatus = state.work === 'stopped' ? 'NNS role not loaded · Review stopped.'
    : state.work === 'settled' ? 'NNS role evidence unavailable.' : 'NNS role evidence pending.';
  return el('div',
    el('p', model?.policyText ?? (policyId ? 'Policy motion #' + policyId : 'Configured reference motion')),
    state.policyFailure ? el('p', state.policyFailure) : null,
    stamp === undefined ? el('p', option(snapshot?.nns_issue ?? []) ?? roleStatus)
      : el('p', 'Registry nns_subnet_id · Mutation version ' + number(stamp), el('br'),
        el('code', principal(option(snapshot.nns_subnet)))),
    motion && el('div',
      option(motion.observed_at) !== undefined ? el('p', 'Governance ' + (lifecycle[option(motion.status)] ?? 'observation')
        + ' · ' + time(option(motion.observed_at))) : null,
      option(motion.raw_hash) ? el('p', 'Governance reply SHA-256 ', el('code', hex(option(motion.raw_hash)))) : null,
      rule ? el('div', el('p', 'Adopted table row'), el('pre', rule.clause),
        el('p', option(rule.exception) ?? 'The NNS row has numeric group caps.'),
        el('p', 'SEV designation ' + (rule.sev_designated ? 'yes' : 'no') + '. This is a designation of the subnet.')) : null,
      option(motion.raw) ? action('Download Governance policy reply', () =>
        saveFile('policy-' + motion.id + '.didbin', new Uint8Array(option(motion.raw)), 'application/octet-stream')) : null));
}

function evidenceView(live, state, session, context, model, policyId) {
  const { report, assignments } = live.outcome.Ok;
  const records = report.manifest.registry.map(([key, value]) => {
    const kind = branch(key);
    const record = branch(value);
    const stamp = record === 'Unavailable' ? option(value.Unavailable.stamp) : value[record];
    return [
      words(kind), el('code', key[kind]?.toText?.() ?? key[kind] ?? '—'),
      ({ Present: 'Recorded', MissingAtBaseline: 'Not recorded on-chain at the pin', Deleted: 'Deleted', Unavailable: 'Could not load' })[record],
      stamp?.mutation_version ?? '—', stamp?.page_observation ?? '—',
    ];
  });
  const calculation = model?.calculation;
  return el('div',
    model?.notes.map(note => el('p', note)),
    disclosure('Policy and pinned Registry role', policyEvidence(model, state, policyId)),
    disclosure('Governance observations',
      el('p', 'Before detailed enrichment'),
      report.manifest.proposals.map(proposal => el('p', governanceText(proposal), el('br'),
        'Executable payload SHA-256 ', el('code', hex(proposal.payload_hash)))),
      state.final ? el('div', el('p', 'After comparisons'), state.final.map(proposal => el('p', governanceText(proposal)))) : null),
    disclosure('Assignment evidence', table(['Node', 'Observed assignment'], assignments.map(([id, row]) => [
      el('code', principal(id)), row.ListedSubnet ? principal(row.ListedSubnet) : ({
        ApiBoundary: 'Registered API boundary node', NodeAbsent: 'Node record absent',
        UnknownOutsideListedSubnets: 'No assignment found in the checked records',
      })[branch(row)],
    ]))),
    disclosure('Registry keys and records', table(['Record', 'Key', 'Coverage', 'Mutation', 'Observation'], records)),
    disclosure('Receipts and timings', sourceReceipts(live), session.receipts.map(entry => entry.response
      ? disclosure(stageLabel(entry.type), sourceReceipts(entry.response))
      : el('p', stageLabel(entry.type) + ' · ' + entry.error, el('br'), el('code', entry.keys.join(', '))))),
    disclosure('Method and exact inputs', el('p', thresholdNote), el('p', geographyNote), el('p', calculationNote),
      el('p', 'Preview revision ', el('code', hex(report.revision))),
      calculation ? el('p', 'Calculation input SHA-256 ', el('code', calculation.inputHash)) : null,
      calculation && model.finalVerified && model.work === 'settled' ? action('Download calculation input (Candid)', () =>
        saveFile('calculation-' + calculation.inputHash + '.didbin', calculation.bytes, 'application/octet-stream')) : null),
    disclosure('Proposal statements and decoded steps',
      context?.scenario.steps.map(step => el('p', '#' + step.proposal + ' · ' + words(branch(step.requested))
        + ' · ' + branch(step.outcome), step.findings.map(finding => el('small', ' · ' + words(branch(finding.code)))))),
      (option(live.outcome.Ok.proposal_text ?? []) ?? []).map(proposal => el('div', el('h4', 'Proposal #' + proposal.id),
        styled('pre', 'claim-text', proposal.summary)))),
    (context?.failures ?? []).map(item => el('p', item.type ? stageLabel(item.type) + ' · ' + item.key + ' · ' : '', item.reason)));
}

export function mountReviewWorkspace({ live, contexts, map, mapHost, active, call, policyId, progress, performance, local }) {
  const body = live.outcome.Ok;
  const { report } = body;
  const { proposals, registry_version: version } = report.manifest;
  const contextLine = styled('div', 'proposal-meta');
  const controls = styled('div', 'controls review-controls');
  const limit = styled('p', 'coverage-notice');
  const summary = styled('div', 'review-summary');
  const topology = styled('section', 'topology-card');
  const tableBody = el('tbody');
  const topologyStatus = styled('p', 'muted topology-status');
  const topologyTable = el('table', el('thead', el('tr',
    el('th', 'Measure'),
    el('th', 'Nodes ', help('Proposed state', 'Membership conditional on applying the decoded change to the pinned Registry snapshot.')),
    el('th', 'Rule ', help('Rule', 'The selected Governance motion supplies an exact size target or a group cap. Some rules depend on unresolved exceptions or identities.')),
    el('th', 'Assessment ', help('Assessment', 'What the selected rule and registered evidence establish. Assignment and execution checks have separate coverage.')))), tableBody);
  topology.append(el('h3', 'Target Topology ', help('Target Topology', 'The intended composition under the selected NNS motion. Full execution validity is a separate question.')),
    topologyStatus, styled('div', 'table-wrap', topologyTable));
  const inspector = styled('section', 'card inspector');
  inspector.hidden = true;
  const pane = styled('section', 'card review-pane');
  pane.hidden = true;
  const tools = styled('div', 'actions review-tools');
  const header = styled('section', 'review-header',
    el('h2', proposals.length === 1 ? 'Proposal #' + proposals[0].id : 'Proposals ' + proposals.map(row => '#' + row.id).join(' + ')),
    contextLine, controls, limit, summary);
  const grid = styled('div', 'review-grid', styled('div', 'map-card', mapHost), topology);
  const section = styled('div', 'workspace', header, grid, tools, inspector, pane);
  const session = createReviewSession({ live, contexts, policyId, active, call, progress, updated: render });
  const exportReview = action('Export review', () => inspect({ type: 'export' }));
  const retry = action('Retry failed evidence', () => session.retry());
  tools.append(action('Sources & details', () => inspect({ type: 'sources' })), exportReview, retry);

  let selected;
  let model;
  let inspection;
  let trigger;
  let scenario = report.scenarios.find(row => branch(row.id) === 'AThenB') ?? report.scenarios[0];
  let subnet;

  function choose(next) {
    const activeElement = document.activeElement;
    selected = next;
    inspection = undefined;
    trigger = undefined;
    const wire = next && body.scopes.find(row => branch(row.scenario) === branch(next.scenario.id) && principal(row.subnet) === principal(next.subnet));
    performance.scope(next?.state ? { context: next, affected: affectedNodes(next, wire), version } : undefined);
    session.select(next);
    if (activeElement instanceof HTMLSelectElement) controls.querySelector('select[aria-label="' +
      activeElement.getAttribute('aria-label') + '"]')?.focus({ preventScroll: true });
  }

  function chooseScope(index) {
    const candidates = contexts.filter(row => row.scenario === scenario);
    const subnets = [...new Set(candidates.map(row => principal(row.subnet)))];
    if (!subnets.includes(subnet)) subnet = subnets[0];
    const steps = candidates.filter(row => principal(row.subnet) === subnet && row.index);
    const next = steps.find(row => row.index === index) ?? steps.at(-1);
    const labels = shortIds(subnets);
    replace(controls,
      report.scenarios.length > 1 ? selector('Proposal order',
        report.scenarios.map(row => [branch(row.id), scenarioName(row)]), branch(scenario.id), id => {
          scenario = report.scenarios.find(row => branch(row.id) === id);
          chooseScope();
        }) : null,
      subnets.length > 1 ? selector('Subnet', subnets.map(id => [id, labels.get(id)]), subnet, id => {
        subnet = id;
        chooseScope();
      }) : null,
      steps.length > 1 ? selector('Membership state', steps.map(row => [String(row.index), 'After #'
        + scenario.steps[row.index - 1].proposal + (row.state ? '' : ' · Blocked')]), String(next.index), key => chooseScope(Number(key))) : null);
    choose(next);
  }

  function inspect(selection, title) {
    if (!inspector.contains(document.activeElement)) trigger = document.activeElement;
    inspection = Array.isArray(selection) ? { type: 'nodes', ids: selection, title } : selection;
    const ids = selectionIds();
    if (ids.length) map.highlight(ids);
    else map.highlight([]);
    if (document.activeElement?.dataset.marker) trigger = document.activeElement;
    renderInspector();
    inspector.querySelector('h3')?.focus();
  }

  function close() {
    inspection = undefined;
    inspector.hidden = true;
    if (trigger?.isConnected) trigger.focus();
    else tools.querySelector('button')?.focus();
    map.highlight([]);
  }
  inspector.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  function selectionIds() {
    if (inspection?.type === 'nodes') return inspection.ids;
    if ((inspection?.type === 'metric' || inspection?.type === 'group') && model) {
      const row = model.topology.find(row => row.key === inspection.key);
      const group = inspection.group ?? row?.group;
      const previousOnly = group && !row.groups.some(item => item.label === group);
      return (group ? model.members.filter(node => node.role !== (previousOnly ? 'Added' : 'Removed') && groupKey(node, row.key) === group)
        : model.members.filter(node => row?.key === 'Size' && node.role !== 'Retained')).map(node => node.id);
    }
    return [];
  }

  function groupCount(groups, unknown, group) {
    return groups.find(row => row.label === group)?.count ?? (unknown ? undefined : 0);
  }

  function nodeDetails(node) {
    const id = Object.assign(el('input'), { value: node.id, readOnly: true });
    id.setAttribute('aria-label', 'Full node principal');
    const copied = el('p');
    copied.setAttribute('role', 'status');
    const field = (label, value) => el('div', el('dt', label), el('dd', value));
    return el('div', el('p', roleNames[node.role]), id, action('Copy node ID', async () => {
      id.select();
      try { await navigator.clipboard.writeText(node.id); copied.textContent = 'Node ID copied.'; }
      catch { copied.textContent = document.execCommand('copy') ? 'Node ID copied.' : 'Select and copy the node ID.'; }
    }), copied, el('dl',
      field('Data center', node.dc || node.operatorIssue || 'Not recorded on-chain'),
      field('Registered owner', node.owner || node.centerIssue || 'Not recorded on-chain'),
      field('Registered region', node.region || node.centerIssue || 'Not recorded on-chain'),
      field('Node provider', node.provider || node.operatorIssue || 'Not recorded on-chain'),
      field('Node operator', node.operatorId || node.nodeIssue || 'Not recorded on-chain'),
      field('Coordinates', node.point ? node.point.lat + ', ' + node.point.lon : node.locationIssue)));
  }

  function metricDetails(row) {
    if (!row.ready) return el('p', row.evidence);
    const options = [...new Set([...row.groupRows, ...row.groups, ...row.beforeGroups].map(group => group.label))];
    const majorityBefore = option(row.old?.greater_than_one_third ?? []);
    const majorityAfter = option(row.next?.greater_than_one_third ?? []);
    const groupsCurrent = option(majorityAfter?.groups_to_reach ?? []);
    const label = row.key === 'Provider' ? shortIds(options) : new Map();
    const selectedGroup = inspection.group ?? row.group;
    const selectedAssessment = row.groupRows.find(group => group.label === selectedGroup);
    const a = selectedGroup ? groupCount(row.beforeGroups, row.old?.unknown, selectedGroup) : row.previous;
    const b = selectedGroup ? groupCount(row.groups, row.missing, selectedGroup) : row.current;
    const share = row.key !== 'Size' && b !== undefined && model.selectedCount
      ? metricDelta(a === undefined || !model.beforeCount ? undefined : 100 * a / model.beforeCount,
        100 * b / model.selectedCount, { percentage: true }) : undefined;
    const selectedBreach = option(selectedAssessment?.breach ?? []);
    const status = selectedAssessment ? assessments[branch(selectedAssessment.assessment)] : row.assessment;
    return el('div', el('p', row.help), el('p', selectedGroup ? (label.get(selectedGroup) ?? selectedGroup) + ' · ' : '', deltaNode(metricDelta(a, b))),
      el('p', status + (row.evidence ? ' · ' + row.evidence : '')),
      share ? el('p', 'Recorded group share ', deltaNode(share)) : null,
      selectedBreach ? el('p', breachLabel(branch(selectedBreach))) : null,
      groupsCurrent !== undefined ? el('p', 'Nakamoto coefficient ',
        help('Nakamoto coefficient', thresholdNote), ' · ',
        deltaNode(metricDelta(option(majorityBefore?.groups_to_reach ?? []), groupsCurrent)),
        ' groups · Threshold ' + majorityAfter.nodes_required + ' nodes') : null,
      options.length ? disclosure('Recorded groups (' + options.length + ')',
        table(['Group', 'Members', 'Assessment'], options.map(group => {
          const prior = groupCount(row.beforeGroups, row.old?.unknown, group);
          const current = groupCount(row.groups, row.missing, group);
          const assessment = row.groupRows.find(item => item.label === group);
          const change = option(assessment?.breach ?? []);
          return [action(label.get(group) ?? group, () => inspect({ type: 'group', key: row.key, group })),
            current === undefined ? 'Data incomplete' : deltaNode(metricDelta(prior, current)),
            assessment ? assessments[branch(assessment.assessment)] + (change ? ' · ' + breachLabel(branch(change)) : '') : 'Not assessed'];
        }))) : null);
  }

  function renderInspector() {
    inspector.hidden = !inspection;
    if (!inspection) return;
    const state = session.section();
    const row = model?.topology.find(row => row.key === inspection.key);
    const nodes = model?.members.filter(node => selectionIds().includes(node.id)) ?? [];
    let title = inspection.title ?? (inspection.type === 'sources' ? 'Sources & details'
      : inspection.type === 'export' ? 'Export review' : inspection.group ?? row?.label ?? 'Members');
    const heading = el('h3', title);
    heading.tabIndex = -1;
    let content;
    if (inspection.type === 'sources') content = [evidenceView(live, state, session, selected, model, policyId),
      model?.members.length ? disclosure('Members and registrations (' + model.members.length + ')',
        styled('div', 'actions', model.members.map(node => nodeButton(node, () => inspect([node.id], node.label))))) : null];
    else if (inspection.type === 'export') content = exportReview.disabled
      ? el('p', 'Export requires a settled comparison and verified final Governance observations.')
      : markdownEditor(model, selected.draft, map.exportButton);
    else if (inspection.type === 'nodes' && nodes.length === 1) content = nodeDetails(nodes[0]);
    else {
      const first = row && metricDetails(row);
      content = [first, nodes.length ? el('div', el('h4', 'Selected members'),
        styled('div', 'actions', nodes.map(node => nodeButton(node, () => inspect([node.id], node.label))))) : null];
    }
    const readiness = ({ Finished: 'Finished', Gaps: 'Finished with gaps', Provisional: 'Provisional · Governance check failed',
      Stopped: state.work === 'stopping' ? 'Stopping' : 'Stopped', Blocked: 'Review blocked' })[state.stage] ?? 'Review in progress';
    replace(inspector, styled('div', 'inspector-heading', heading, action('Close details', close)),
      styled('p', 'inspector-readiness', readiness), content);
  }

  function render() {
    const state = session.section();
    const source = option(state.policy?.motion ?? []);
    const canSimulate = selected?.state && !state.consistency?.blocked;
    const evidence = canSimulate ? selected.calculation?.evidence ?? comparisonEvidence(state.records,
      [...selected.before.members, ...selected.state.members]) : undefined;
    model = canSimulate ? reviewModel(live, selected, evidence, state, policyId, local) : undefined;
    const policyLine = model?.policyText ?? (source ? 'Motion #' + source.id : policyId ? 'Motion #' + policyId + ' selected' : 'Configured reference motion');
    const title = (option(body.proposal_text ?? []) ?? []).map(row => option(row.title)).filter(Boolean).join(' · ');
    replace(contextLine, title ? el('span', title) : null,
      el('span', (state.final ?? proposals).map(governanceText).join(' · ')));
    const nns = option(state.policy?.nns_subnet ?? []);
    const selectedSubnet = selected ? principal(selected.subnet) : undefined;
    const subnetLabel = selectedSubnet && (nns?.toText() === selectedSubnet ? 'NNS · ' : 'Subnet · ') + shortIds([selectedSubnet]).get(selectedSubnet);
    const checked = body.listed_subnets;
    const total = option(body.total_listed_subnets ?? []);
    const partial = total === undefined || checked < total;
    replace(limit, el('strong', partial ? 'Assignment checks are partial' : 'Scoped execution checks'),
      ' · ' + checked + ' of ' + (total ?? 'an unknown number of') + ' listed subnets checked. ',
      partial ? 'Assignments elsewhere remain unverified.' : 'Full execution validity remains unverified.',
      model?.topology.some(row => row.assessment.endsWith('unresolved')) ? el('span', ' · Some policy checks remain unresolved.') : null);
    const changed = model?.members.filter(node => node.role !== 'Retained') ?? [];
    const steps = selected?.scenario.steps.slice(0, selected.index) ?? [];
    const terminal = model ? [] : proposals.filter(proposal => steps.some(step => step.proposal === proposal.id))
      .flatMap(proposal => {
        const outcome = terminalOutcome(proposal);
        return outcome ? [el('p', el('strong', '#' + proposal.id + ' · ' + outcome.label), ' · ' + outcome.explanation)] : [];
      });
    grid.hidden = terminal.length > 0;
    limit.hidden = grid.hidden;
    exportReview.hidden = grid.hidden;
    replace(summary,
      model ? el('strong', model.membership) : terminal.length ? terminal : el('strong', 'Proposed membership unavailable'),
      subnetLabel && !terminal.length ? el('span', subnetLabel + ' · Registry ' + number(version), ' ',
        help('Registry snapshot', 'The version used for every Registry record in this review. Governance has its own observation times.')) : null,
      changed.length ? styled('div', 'actions changed-nodes', changed.map(node => nodeButton(node, () => inspect([node.id], node.label)))) : null,
      state.consistency?.reason ? el('p', state.consistency.blocked ? state.consistency.reason
        : 'Provisional · ' + state.consistency.reason) : null,
      model?.previousAccepted ? el('p', 'Previous accepted comparison · ' + (state.work === 'running' ? 'Retry in progress' : 'Replacement unavailable')) : null,
      selected?.status === 'outside' ? el('p', 'Detail checks are outside this review’s work budget.') : null);
    topologyStatus.textContent = policyLine + (source ? ' · ' + policyApplicabilityNote : '');
    topology.setAttribute('aria-busy', String(state.work === 'running' || state.work === 'stopping'));
    const rows = model?.topology ?? [];
    replace(tableBody, rows.length ? rows.map(row => el('tr',
      el('td', styled('span', 'measure-label', action(row.label, () => inspect({ type: 'metric', key: row.key })), help(row.label, metrics[row.key].help)),
        row.groupLabel ? styled('small', 'group-label', row.groupLabel) : null,
        row.departures.map(group => el('small', action(group.label, () => inspect({ type: 'group', key: row.key, group: group.label })),
          ' · ', deltaNode(group.delta), ' · Last member leaves this subnet')),
        row.sharedProvider ? el('small', 'Added and removed nodes share ', action(row.sharedProvider.label ?? row.sharedProvider.id,
          () => inspect({ type: 'group', key: row.key, group: row.sharedProvider.id }))) : null),
      el('td', row.ready ? [deltaNode(row.delta), row.evidence ? el('small', row.evidence) : null] : row.evidence),
      el('td', row.limit), el('td',
        styled('span', row.assessment.endsWith('unresolved') || row.assessment === 'Exceeds limit' ? 'assessment-warning' : '', row.assessment),
        row.breach ? el('small', breachLabel(row.breach)) : null,
        row.groupRows.slice(1).some(group => group.breach.length) ? el('small', 'Additional group changes in details') : null)))
      : el('tr', Object.assign(el('td', 'A proposed membership state is unavailable.'), { colSpan: 4 })));
    map.update(model, selectionIds(), state.consistency?.blocked ? 'Review blocked · Governance changed'
      : 'Map unavailable · Required membership evidence');
    exportReview.disabled = !model?.calculation || !model.finalVerified || state.work !== 'settled';
    retry.hidden = state.work !== 'settled' || !!state.consistency?.blocked || !(readFailures(state.records).length
      || state.policyFailure || source?.retryable || state.policy?.nns_retryable || state.consistency || ['stale', 'unavailable'].includes(selected?.status));
    if (inspection) renderInspector();
  }

  return { section, session, start: chooseScope, inspect, openPerformance() {
    if (!pane.contains(performance.section)) pane.replaceChildren(performance.section);
    pane.hidden = false;
    performance.visible(true);
  } };
}
