import { boundaryNote, countryLabel } from './country-presentation.js';
import { dashboardLink, proposalHeading } from './dashboard.js';
import { assignmentCoverage, calculationNote, comparisonCaption, criteriaNote, distanceHelp, distanceTitle, distributionTables,
  geographyNote, governanceText, metricDelta, replayRegistryText, reviewModel, reviewReadiness,
  roles, scenarioName, shortIds, thresholdNote } from './detail-model.js';
import { terminalOutcome } from './terminal-outcome.js';
import { markdownEditor } from './review-export.js';
import { help } from './review-help.js';
import { nodeDetails } from './map-interaction.js';
import { nodeTables } from './node-table.js';
import { reportSnapshot } from './review-markdown.js';
import { affectedNodes, comparisonEvidence, createReviewSession, stageLabel } from './review-session.js';
import { action, branch, deltaNode, el, hex, number, option, principal, saveFile, styled, table, time, words } from './view.js';

const disclosure = (title, ...content) => el('details', el('summary', title), ...content);
const subnetTypes = { 1: 'Application subnet', 2: 'System subnet', 4: 'Verified application subnet', 5: 'Cloud Engine subnet' };

function replace(node, ...children) {
  const name = item => item.getAttribute('aria-label') || item.textContent.trim();
  const focused = node.contains(document.activeElement) ? name(document.activeElement) : undefined;
  const open = new Set([...node.querySelectorAll('details[open] > summary')].map(name));
  node.replaceChildren(...children.flat().filter(child => child != null));
  for (const summary of node.querySelectorAll('details > summary')) summary.parentElement.open = open.has(name(summary));
  if (focused) [...node.querySelectorAll('a, button, input, summary, select, textarea, [tabindex="-1"]')]
    .find(item => name(item) === focused)?.focus({ preventScroll: true });
}

function selector(label, entries, value, changed) {
  const select = el('select', entries.map(([key, title]) => Object.assign(el('option', title), { value: key })));
  select.value = value;
  select.setAttribute('aria-label', label);
  select.addEventListener('change', () => changed(select.value));
  return el('label', label, select);
}

function nodeButton(node, click) {
  return action([roles[node.role].label, node.label, node.dc, node.region?.split(',')[2]?.trim(),
    node.locationPending ? 'Location pending' : !node.point ? 'Unlocated' : null].filter(Boolean).join(' · '), click);
}

function registryRole(state, replay) {
  const role = state.role;
  const id = option(role?.nns_subnet ?? []);
  return el('div', replay?.roleSupplement ? el('p', 'Synthetic NNS-role supplement · ' + replay.roleSupplement) : null,
    id ? el('p', 'Registry nns_subnet_id · Mutation version ' + number(option(role.mutation_version)), el('br'),
      dashboardLink('subnet', principal(id), el('code', principal(id))))
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
      words(kind), (() => {
        const id = key[kind]?.toText?.() ?? key[kind];
        const entity = { Subnet: 'subnet', Node: 'node', DataCenter: 'center' }[kind];
        return dashboardLink(entity, id, el('code', id ?? '—'));
      })(),
      ({ Present: 'Recorded', MissingAtBaseline: 'Not recorded on-chain at the pin', Deleted: 'Deleted', Unavailable: 'Could not load' })[record],
      stamp?.mutation_version ?? '—', stamp?.page_observation ?? '—',
    ];
  });
  const calculation = model?.calculation;
  return el('div',
    model?.notes.map(note => el('p', note)),
    context ? el('p', 'Selected subnet ', dashboardLink('subnet', principal(context.subnet), el('code', principal(context.subnet)))) : null,
    replay ? el('p', replayRegistryText(replay)) : null,
    disclosure('Pinned Registry role', registryRole(state, replay)),
    disclosure('Governance observations',
      el('p', 'Before detailed enrichment'),
      report.manifest.proposals.map(proposal => el('p', governanceText(proposal, replay, true), el('br'),
        'Executable payload SHA-256 ', el('code', hex(proposal.payload_hash)))),
      state.final ? el('div', el('p', 'After comparisons'), state.final.map(proposal => el('p', governanceText(proposal, replay, true)))) : null),
    disclosure('Assignment evidence', table(['Node', 'Observed assignment'], assignments.map(([id, row]) => [
      dashboardLink('node', principal(id), el('code', principal(id))),
      row.ListedSubnet ? dashboardLink('subnet', principal(row.ListedSubnet)) : ({
        ApiBoundary: 'Registered API boundary node', NodeAbsent: 'Node record absent',
        UnknownOutsideListedSubnets: 'No assignment found in the checked records',
      })[branch(row)],
    ]))),
    disclosure('Registry keys and records', table(['Record', 'Key', 'Coverage', 'Mutation', 'Observation'], records)),
    reviewReceipts(live, session, replay),
    disclosure('Method and exact inputs', el('p', thresholdNote), el('p', geographyNote + ' ' + boundaryNote), el('p', calculationNote),
      el('p', 'Preview revision ', el('code', hex(report.revision))),
      calculation ? el('p', 'Calculation input SHA-256 ', el('code', calculation.inputHash)) : null,
      calculation && model.finalVerified && model.work === 'settled' ? action('Download calculation input (Candid)', () =>
        saveFile('calculation-' + calculation.inputHash + '.didbin', calculation.bytes, 'application/octet-stream')) : null),
    disclosure('Proposal statements and decoded steps',
      context?.scenario.steps.map(step => el('p', dashboardLink('proposal', step.proposal, '#' + step.proposal), ' · ' + words(branch(step.requested))
        + ' · ' + (branch(step.outcome) === 'Applied' ? 'Applied in simulation' : words(branch(step.outcome))), step.findings.map(finding => el('small', ' · ' + words(branch(finding.code)))))),
      (option(live.outcome.Ok.proposal_text ?? []) ?? []).map(proposal => el('div', el('h4', proposalHeading([proposal.id])),
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
  const nodes = styled('div', 'review-node-tables');
  const verification = el('div');
  const topology = styled('section', 'topology-card');
  const narrow = matchMedia('(max-width: 44rem)');
  const inspector = styled('section', 'card inspector');
  inspector.hidden = true;
  const pane = styled('section', 'card review-pane');
  pane.hidden = true;
  const tools = styled('div', 'actions review-tools');
  const header = styled('section', 'review-header',
    el('h2', proposalHeading(proposals.map(row => row.id))),
    contextLine, controls, verification, summary, limit);
  const grid = styled('div', 'review-grid', styled('div', 'map-card', mapHost, nodes), topology);
  const section = styled('div', 'workspace', header, grid, tools, inspector, pane);
  const session = createReviewSession({ live, contexts, active, call, progress, updated: render });
  const exportReview = action('Generate review', () => {
    if (exportReview.disabled || !active()) return;
    const snapshot = reportSnapshot(model, [{ response: live }, ...session.receipts]);
    inspect({ type: 'export', snapshot });
  });
  const retry = action('Retry failed evidence', () => session.retry());
  tools.append(exportReview, action('Sources & details', () => inspect({ type: 'sources' })), retry);
  narrow.addEventListener('change', renderTables);

  let selected;
  let model;
  let inspection;
  let trigger;
  let scenario = report.scenarios.find(row => branch(row.id) === 'AThenB') ?? report.scenarios[0];
  let subnet;

  function choose(next) {
    const activeElement = document.activeElement;
    if (next !== selected) nodes.querySelector('.other-nodes')?.removeAttribute('open');
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
    renderInspector();
    inspector.querySelector('h3')?.focus();
  }

  function close() {
    inspection = undefined;
    inspector.hidden = true;
    (trigger?.isConnected ? trigger : tools.querySelector('button'))?.focus({ preventScroll: true });
  }
  inspector.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  function comparisonTable(headers, values) {
    if (!narrow.matches) return table(headers, [values]);
    return styled('div', 'table-wrap', el('table',
      el('thead', el('tr', ['Dimension', 'Value'].map(text => Object.assign(el('th', text), { scope: 'col' })))),
      el('tbody', headers.map((label, index) => el('tr', Object.assign(el('th', label), { scope: 'row' }), el('td', values[index]))))));
  }

  function distributions() {
    if (!model?.calculation) return null;
    return disclosure('Recorded distributions and maximum ties', model.dimensions.map(item => {
      const rows = model.composition.filter(row => row.key === item.key);
      const label = token => item.key === 'RegisteredCountry' ? countryLabel(token, undefined, true)
        : dashboardLink({ DataCenter: 'center', Provider: 'provider' }[item.key], token);
      const tied = list => list.length ? list.flatMap((group, i) => [i ? ', ' : '', label(group.label)]) : 'Unavailable';
      return disclosure(item.label, el('p', item.help),
        item.partial ? el('p', 'Members with missing grouping · ', deltaNode(item.unknown)) : null,
        el('p', 'Largest known groups before · ', tied(item.ties[0])),
        el('p', 'Largest known groups proposed · ', tied(item.ties[1])),
        table(['Recorded group', 'Subnet members'], rows.map(row => [label(row.group), deltaNode(row.delta)])));
    }));
  }

  function renderTables() {
    nodes.hidden = !model;
    replace(nodes, model ? nodeTables(model.members, { inspect: node => inspect([node.id], node.label) }) : null);

    const state = session.section();
    const loading = !model?.calculation && ['running', 'idle', 'stopping'].includes(state.work);
    topology.setAttribute('aria-busy', String(loading));
    replace(topology, el('h3', 'Decentralisation'),
      !model?.calculation ? el('p', loading ? 'Loading' : state.work === 'stopped'
        ? 'Not loaded · Review stopped' : 'Could not calculate from the available evidence') : [
        el('p', comparisonCaption),
        distributionTables.map(({ key, title, help: explanation }) => el('section', el('h4', title, ' ', help(title, explanation)),
          comparisonTable(model.dimensions.map(item => item.label), model.dimensions.map(item => deltaNode(item[key]))),
          key === 'coefficient' ? (() => {
            const values = model.dimensions.find(item => item.thresholds?.some(value => value !== undefined))?.thresholds;
            return values ? el('p', 'Node threshold · ', deltaNode(metricDelta(...values))) : null;
          })() : null)),
        model.dimensions.some(item => item.partial) ? el('p', '≥ marks a recorded minimum. ',
          model.dimensions.filter(item => item.partial).map(item => item.label + ' members with missing grouping: ' + item.unknown.text).join(' · ')) : null,
        model.distances ? el('section', el('h4', distanceTitle, ' ', help(distanceTitle, distanceHelp)),
          comparisonTable(model.distances.columns.map(column => column.label), model.distances.columns.map(column => deltaNode(column.delta))),
          el('p', model.distances.coverage)) : null,
        styled('p', 'muted topology-status', criteriaNote),
      ].flat());
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
    const { type, snapshot } = inspection;
    const node = model?.members.find(node => inspection.ids?.includes(node.id));
    const title = inspection.title ?? (type === 'sources' ? 'Sources & details' : 'Generate review');
    const heading = el('h3', title);
    heading.tabIndex = -1;
    let content;
    if (type === 'sources') content = [model?.members.length ? disclosure('Nodes in this review (' + model.members.length + ')',
        styled('div', 'actions', model.members.map(node => nodeButton(node, () => inspect([node.id], node.label))))) : null,
      distributions(), evidenceView(live, state, session, selected, model, replay)];
    else if (type === 'export') {
      const isCurrent = () => active() && !exportReview.disabled && inspection?.snapshot === snapshot
        && model?.calculation?.inputHash === snapshot.scope.inputHash && model?.step === snapshot.scope.step
        && model?.order === snapshot.scope.order && model?.subnet === snapshot.scope.subnet;
      content = isCurrent() ? (inspection.editor ??= markdownEditor(snapshot, selected.draft, isCurrent))
        : el('p', 'Generate the review again after the selected calculation and final Governance verification settle.');
    }
    else if (node) content = [el('p', roles[node.role].label), nodeDetails(node)];
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
      model ? [el('strong', model.membership), el('p', model.summary)] : terminal.length ? terminal : el('strong', 'Proposed membership unavailable'),
      subnetLabel && !terminal.length ? el('span', dashboardLink('subnet', selectedSubnet, subnetLabel), ' · Registry ' + number(version), ' ',
        model ? '· ' + (model.ids.length > 1 ? model.scenario + ' · ' : '') + model.stateLabel + ' ' : '',
        help('Registry snapshot', 'The version used for every Registry record in this review. Governance has its own observation times.')) : null,
      state.consistency?.reason ? el('p', state.consistency.blocked ? state.consistency.reason
        : 'Provisional · ' + state.consistency.reason) : null,
      model?.previousAccepted ? el('p', 'Previous accepted comparison · ' + (state.work === 'running' ? 'Retry in progress' : 'Replacement unavailable')) : null,
      selected?.status === 'outside' ? el('p', 'Detail checks are outside this review’s work budget.') : null);
    replace(verification, selected?.state ? readinessLine(state) : null);
    renderTables();
    map.update(model, state.consistency?.blocked ? 'Review blocked · Governance changed'
      : 'Map unavailable · Required membership evidence');
    exportReview.disabled = !model?.calculation || !model.finalVerified || state.work !== 'settled';
    retry.hidden = !state.retryable;
    if (inspection) renderInspector();
    else inspector.hidden = true;
  }

  return { section, session, dispose: () => narrow.removeEventListener('change', renderTables), start: chooseScope, inspect, openPerformance() {
    if (!pane.contains(performance.section)) pane.replaceChildren(performance.section);
    pane.hidden = false;
    performance.visible(true);
  } };
}
