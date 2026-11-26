import { assignmentCoverage, calculationNote, criteriaNote, geographyNote, governanceText, groupKey, metrics, metricDelta, replayRegistryText, reviewModel, reviewReadiness, scenarioName, shortIds, thresholdNote } from './detail-model.js';
import { terminalOutcome } from './terminal-outcome.js';
import { markdownEditor } from './review-export.js';
import { help } from './review-help.js';
import { action, saveFile } from './review-map.js';
import { affectedNodes, comparisonEvidence, createReviewSession, stageLabel } from './review-session.js';
import { branch, el, hex, number, option, principal, styled, table, time, words } from './view.js';

const disclosure = (title, ...content) => el('details', el('summary', title), ...content);
const roleNames = { Added: '+ Incoming', Removed: '− Outgoing', Retained: '• Retained' };
const subnetTypes = { 1: 'Application subnet', 2: 'System subnet', 4: 'Verified application subnet', 5: 'Cloud Engine subnet' };

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
  if (!delta.before) return el('span', delta.text);
  const display = el('span', delta.before, styled('span', delta.direction > 0 ? 'delta-up' : delta.direction < 0 ? 'delta-down' : '',
    ' → ' + delta.after));
  display.setAttribute('aria-label', delta.accessible);
  display.setAttribute('role', 'img');
  return display;
}

function nodeButton(node, click) {
  return action([roleNames[node.role], node.label, node.dc, node.region?.split(',')[2]?.trim(),
    node.locationPending ? 'Location pending' : !node.point ? 'Unlocated' : null].filter(Boolean).join(' · '), click);
}

function registryRole(state, replay) {
  const role = state.role;
  const id = option(role?.nns_subnet ?? []);
  return el('div', replay?.roleSupplement ? el('p', 'Synthetic NNS-role supplement · ' + replay.roleSupplement) : null,
    id ? el('p', 'Registry nns_subnet_id · Mutation version ' + number(option(role.mutation_version)), el('br'), el('code', principal(id)))
      : el('p', state.roleFailure ?? option(role?.issue ?? []) ?? (state.work === 'settled' ? 'NNS role unavailable.' : 'NNS role pending.')));
}

function reviewReceipts(live, session, replay) {
  const stages = [{ type: 'Membership', response: live }, ...session.receipts];
  const rows = stages.flatMap(({ type, response, error, keys }) => response
    ? response.receipts.map(row => [
      stageLabel(type) + ' · ' + row.id, el('span', row.method, ' ', el('code', row.item), el('br'), el('code', principal(row.source))),
      time(row.observed_at), option(row.reply_hash) ? el('code', hex(option(row.reply_hash))) : option(row.reject) ?? 'Unavailable',
    ]) : [[stageLabel(type), keys.join(', '), '—', error]]);
  return disclosure('Source receipts and timings',
    table(['Stage', 'Source read', replay ? 'Local replay delivery' : 'Observed at', 'Reply SHA-256 or issue'], rows),
    table(['Stage', 'Calls', 'Reply bytes', 'Elapsed ms', 'Instructions', 'Peak cycles reserved'],
      stages.filter(row => row.response).map(({ type, response: { usage } }) => [stageLabel(type), usage.calls, usage.source_bytes,
        (usage.finished_at - usage.started_at) / 1_000_000n, usage.instructions, usage.peak_batch_reservation])));
}

function evidenceView(live, state, session, context, model, replay) {
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
    context ? el('p', 'Selected subnet ', el('code', principal(context.subnet))) : null,
    replay ? el('p', replayRegistryText(replay)) : null,
    disclosure('Pinned Registry role', registryRole(state, replay)),
    disclosure('Governance observations',
      el('p', 'Before detailed enrichment'),
      report.manifest.proposals.map(proposal => el('p', governanceText(proposal, replay, true), el('br'),
        'Executable payload SHA-256 ', el('code', hex(proposal.payload_hash)))),
      state.final ? el('div', el('p', 'After comparisons'), state.final.map(proposal => el('p', governanceText(proposal, replay, true)))) : null),
    disclosure('Assignment evidence', table(['Node', 'Observed assignment'], assignments.map(([id, row]) => [
      el('code', principal(id)), row.ListedSubnet ? principal(row.ListedSubnet) : ({
        ApiBoundary: 'Registered API boundary node', NodeAbsent: 'Node record absent',
        UnknownOutsideListedSubnets: 'No assignment found in the checked records',
      })[branch(row)],
    ]))),
    disclosure('Registry keys and records', table(['Record', 'Key', 'Coverage', 'Mutation', 'Observation'], records)),
    reviewReceipts(live, session, replay),
    disclosure('Method and exact inputs', el('p', thresholdNote), el('p', geographyNote), el('p', calculationNote),
      el('p', 'Preview revision ', el('code', hex(report.revision))),
      calculation ? el('p', 'Calculation input SHA-256 ', el('code', calculation.inputHash)) : null,
      calculation && model.finalVerified && model.work === 'settled' ? action('Download calculation input (Candid)', () =>
        saveFile('calculation-' + calculation.inputHash + '.didbin', calculation.bytes, 'application/octet-stream')) : null),
    disclosure('Proposal statements and decoded steps',
      context?.scenario.steps.map(step => el('p', '#' + step.proposal + ' · ' + words(branch(step.requested))
        + ' · ' + (branch(step.outcome) === 'Applied' ? 'Applied in simulation' : words(branch(step.outcome))), step.findings.map(finding => el('small', ' · ' + words(branch(finding.code)))))),
      (option(live.outcome.Ok.proposal_text ?? []) ?? []).map(proposal => el('div', el('h4', 'Proposal #' + proposal.id),
        styled('pre', 'claim-text', proposal.summary)))),
    (context?.failures ?? []).map(item => el('p', item.type ? stageLabel(item.type) + ' · ' + item.key + ' · ' : '', item.reason)));
}

export function mountReviewWorkspace({ live, contexts, map, mapHost, active, call, progress, performance, replay }) {
  const body = live.outcome.Ok;
  const { report } = body;
  const { proposals, registry_version: version } = report.manifest;
  const contextLine = styled('div', 'proposal-meta');
  const controls = styled('div', 'controls review-controls');
  const limit = styled('p', 'coverage-notice');
  const summary = styled('div', 'review-summary');
  const changedNodes = styled('div', 'actions changed-nodes');
  changedNodes.hidden = true;
  const verification = el('div');
  const topology = styled('section', 'topology-card');
  const tableBody = el('tbody');

  const topologyTable = el('table', el('thead', el('tr',
    el('th', 'Registered group'),
    el('th', 'Before → proposed ', help('Proposed membership', 'Membership produced by applying the decoded action to the selected Registry snapshot.')))), tableBody);
  const navigation = styled('div', 'controls composition-navigation', selector('Composition dimension',
    [['overview', 'Overview'], ...Object.entries(metrics).map(([key, info]) => [key, info.label])], 'overview', key => {
      dimension = key;
      render();
    }));
  const compositionSummary = styled('div', 'composition-summary');
  topology.append(el('h3', 'Subnet composition'), styled('p', 'muted topology-status', criteriaNote),
    navigation, compositionSummary, styled('div', 'table-wrap', topologyTable));
  const inspector = styled('section', 'card inspector');
  inspector.hidden = true;
  const pane = styled('section', 'card review-pane');
  pane.hidden = true;
  const tools = styled('div', 'actions review-tools');
  const header = styled('section', 'review-header',
    el('h2', proposals.length === 1 ? 'Proposal #' + proposals[0].id : 'Proposals ' + proposals.map(row => '#' + row.id).join(' + ')),
    contextLine, controls, limit, summary);
  const grid = styled('div', 'review-grid', styled('div', 'map-card', mapHost, changedNodes, verification), topology);
  const section = styled('div', 'workspace', header, grid, tools, inspector, pane);
  const session = createReviewSession({ live, contexts, active, call, progress, updated: render });
  const exportReview = action('Export review', () => inspect({ type: 'export' }));
  const retry = action('Retry failed evidence', () => session.retry());
  tools.append(action('Sources & details', () => inspect({ type: 'sources' })), exportReview, retry);

  let selected;
  let model;
  let inspection;
  let trigger;
  let scenario = report.scenarios.find(row => branch(row.id) === 'AThenB') ?? report.scenarios[0];
  let subnet;
  let dimension = 'overview';

  function choose(next) {
    const activeElement = document.activeElement;
    selected = next;
    dimension = 'overview';
    navigation.querySelector('select').value = dimension;
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
    if (inspection?.type === 'group' && model) {
      return model.members.filter(node => groupKey(node, inspection.key) === inspection.group).map(node => node.id);
    }
    return [];
  }

  function pendingLabel(state, key) {
    if (state.work === 'settled') return 'Could not calculate from the available evidence';
    if (state.work === 'stopped') return 'Not loaded · Review stopped';
    if (state.stage === 'DataCenters' && ['DataCenter', 'RegisteredOwner', 'RegisteredCountry', 'RegisteredContinent'].includes(key)) return 'Loading data centers';
    return 'Waiting for composition calculation';
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
    const share = metricDelta(row.a === undefined || !model.beforeCount ? undefined : 100 * row.a / model.beforeCount,
      row.b === undefined || !model.selectedCount ? undefined : 100 * row.b / model.selectedCount,
      { percentage: true, beforePartial: !!row.old.unknown, afterPartial: !!row.next.unknown });
    return el('div', el('p', row.help), row.identity === 'principal' ? el('p', el('code', row.group)) : null,
      el('p', 'Recorded members ', deltaNode(row.delta)),
      el('p', 'Recorded group share ', deltaNode(share), ' · Subnet size ', deltaNode(metricDelta(model.beforeCount, model.selectedCount))),
      row.old.unknown || row.next.unknown ? el('p', 'Members with unknown grouping · '
        + metricDelta(row.old.unknown, row.next.unknown).text) : null,
      row.note ? el('p', row.note) : null,
      coefficientLine(model.dimensions.find(item => item.key === row.key)));
  }

  function coefficientLine(item) {
    return el('p', 'Nakamoto coefficient ', help('Nakamoto coefficient', thresholdNote), ' · ', deltaNode(item.coefficient));
  }

  function dimensionSummary(item) {
    return [
      el('p', 'Distinct recorded groups · ', deltaNode(item.distinct),
        item.old.unknown || item.next.unknown ? ' · Grouping incomplete' : ''),
      item.tied > 1 ? el('p', item.tied + ' recorded groups are tied at ' + item.maximum + ' members in the proposed state'
        + (item.next.unknown ? ' among known records.' : '.')) : null,
    ];
  }

  function readinessLine(state) {
    const result = reviewReadiness(selected, state);
    return styled('p', 'review-outcomes', state.stage === 'Provisional' ? 'Data loading complete · ' : '',
      'Calculation · ', el('strong', result.calculation),
      ' · Governance · ', el('strong', result.governance));
  }

  function renderInspector() {
    inspector.hidden = !inspection;
    if (!inspection) return;
    const state = session.section();
    const row = model?.composition.find(row => row.key === inspection.key && row.group === inspection.group);
    const nodes = model?.members.filter(node => selectionIds().includes(node.id)) ?? [];
    let title = inspection.title ?? (inspection.type === 'sources' ? 'Sources & details'
      : inspection.type === 'export' ? 'Export review' : row?.groupLabel ?? metrics[inspection.key]?.label ?? 'Nodes in this review');
    const heading = el('h3', title);
    heading.tabIndex = -1;
    let content;
    if (inspection.type === 'sources') content = [model?.members.length ? disclosure('Nodes in this review (' + model.members.length + ')',
        styled('div', 'actions', model.members.map(node => nodeButton(node, () => inspect([node.id], node.label))))) : null,
      evidenceView(live, state, session, selected, model, replay)];
    else if (inspection.type === 'export') content = exportReview.disabled
      ? el('p', 'Export requires a settled comparison and verified final Governance observations.')
      : markdownEditor(model, selected.draft, map);
    else if (inspection.type === 'nodes' && nodes.length === 1) content = nodeDetails(nodes[0]);
    else {
      const item = model?.dimensions.find(item => item.key === inspection.key);
      const first = row ? metricDetails(row) : item ? el('div', el('p', item.help), dimensionSummary(item), coefficientLine(item))
        : inspection.key ? el('p', pendingLabel(state, inspection.key)) : null;
      content = [first, nodes.length ? el('div', el('h4', 'Nodes in this group'),
        styled('div', 'actions', nodes.map(node => nodeButton(node, () => inspect([node.id], node.label))))) : null];
    }
    const readiness = ({ Finished: 'Data loading complete', Provisional: 'Provisional · Governance check failed',
      Stopped: state.work === 'stopping' ? 'Stopping' : 'Stopped', Blocked: 'Review blocked' })[state.stage] ?? 'Review in progress';
    replace(inspector, styled('div', 'inspector-heading', heading, action('Close details', close)),
      styled('p', 'inspector-readiness', readiness), selected?.state ? readinessLine(state) : null, content);
  }

  function render() {
    const state = session.section();
    const canSimulate = selected?.state && !state.consistency?.blocked;
    const evidence = canSimulate ? selected.calculation?.evidence ?? comparisonEvidence(state.records,
      [...selected.before.members, ...selected.state.members]) : undefined;
    model = canSimulate ? reviewModel(live, selected, evidence, state, replay) : undefined;
    const title = (option(body.proposal_text ?? []) ?? []).map(row => option(row.title)).filter(Boolean).join(' · ');
    replace(contextLine, title ? el('span', title) : null,
      el('span', (state.final ?? proposals).map(row => governanceText(row, replay)).join(' · ')));
    const nns = option(state.role?.nns_subnet ?? []);
    const selectedSubnet = selected ? principal(selected.subnet) : undefined;
    const kind = selected?.rules?.kind;
    const subnetLabel = selectedSubnet && (nns?.toText() === selectedSubnet ? 'NNS' : subnetTypes[kind] ?? 'Subnet')
      + ' · ' + shortIds([selectedSubnet]).get(selectedSubnet);
    replace(limit, el('span', assignmentCoverage(live, selected), ' ',
      help('Assignment coverage', 'Which subnet memberships were checked for the nodes involved. Assignments outside that scope remain unverified.')),
      model?.evidenceNotes.map(note => el('span', ' ', note)));
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
    changedNodes.hidden = !changed.length;
    replace(changedNodes, changed.map(node => nodeButton(node, () => inspect([node.id], node.label))));
    replace(summary,
      model ? el('strong', model.membership) : terminal.length ? terminal : el('strong', 'Proposed membership unavailable'),
      subnetLabel && !terminal.length ? el('span', subnetLabel + ' · Registry ' + number(version), ' ',
        help('Registry snapshot', 'The version used for every Registry record in this review. Governance has its own observation times.')) : null,
      state.consistency?.reason ? el('p', state.consistency.blocked ? state.consistency.reason
        : 'Provisional · ' + state.consistency.reason) : null,
      model?.previousAccepted ? el('p', 'Previous accepted comparison · ' + (state.work === 'running' ? 'Retry in progress' : 'Replacement unavailable')) : null,
      selected?.status === 'outside' ? el('p', 'Detail checks are outside this review’s work budget.') : null);
    replace(verification, selected?.state ? readinessLine(state) : null);
    topology.setAttribute('aria-busy', String(!model?.calculation && (state.work === 'running' || state.work === 'stopping')));
    navigation.hidden = !model?.calculation;
    const rows = model?.composition ?? [];
    const displayed = rows.filter(row => dimension === 'overview' ? row.featured : row.key === dimension);
    const item = model?.dimensions.find(item => item.key === dimension);
    const changedCoefficients = model?.dimensions.filter(item => item.coefficientChanged) ?? [];
    replace(compositionSummary, item ? [...dimensionSummary(item), coefficientLine(item)]
      : changedCoefficients.length ? styled('div', 'composition-coefficients',
        el('span', 'Changed Nakamoto coefficients ', help('Nakamoto coefficient', thresholdNote)),
        changedCoefficients.map(item => action(item.label + ' · ' + item.coefficient.text,
          () => inspect({ type: 'metric', key: item.key })))) : null);
    replace(tableBody, displayed.length ? displayed.map(row => el('tr',
      el('td', styled('span', 'measure-label',
        action(row.label + ' · ' + row.groupLabel, () => inspect({ type: 'group', key: row.key, group: row.group })),
        help(row.label, row.help)), row.note ? el('small', row.note) : null),
      el('td', deltaNode(row.delta)))) : model && !model.calculation ? Object.entries(metrics).map(([key, info]) => el('tr',
        el('td', styled('span', 'measure-label', action(info.label, () => inspect({ type: 'metric', key })), help(info.label, info.help))),
      el('td', pendingLabel(state, key)))) : el('tr', Object.assign(el('td', !model
          ? 'A proposed membership state is unavailable.' : rows.length && dimension === 'overview'
            ? 'Choose a dimension to see its recorded groups.' : 'No groups have recorded evidence for this selection.'), { colSpan: 2 })));
    map.update(model, selectionIds(), state.consistency?.blocked ? 'Review blocked · Governance changed'
      : 'Map unavailable · Required membership evidence');
    exportReview.disabled = !model?.calculation || !model.finalVerified || state.work !== 'settled';
    retry.hidden = !state.retryable;
    if (inspection) renderInspector();
  }

  return { section, session, start: chooseScope, inspect, openPerformance() {
    if (!pane.contains(performance.section)) pane.replaceChildren(performance.section);
    pane.hidden = false;
    performance.visible(true);
  } };
}
