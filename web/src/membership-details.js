import { calculationNote, geographyNote, groupMembers, lifecycle, proposalUrl, reviewModel, scenarioName, shortIds, thresholdNote } from './detail-model.js';
import { markdownEditor } from './review-export.js';
import { action, saveFile } from './review-map.js';
import { affectedNodes, createReviewSession, emptyEvidence, stageLabel } from './review-session.js';
import { branch, el, hex, number, option, principal, sourceReceipts, styled, table, time, words } from './view.js';

const modes = ['Nodes', 'Concentration', 'Claims', 'Evidence', 'Export review', 'Performance'];
const roles = { Added: '+ Added', Removed: '− Removed', Retained: '• Retained' };
function replace(node, ...children) {
  const name = item => item.getAttribute('aria-label') || item.textContent.trim();
  const focused = node.contains(document.activeElement) ? name(document.activeElement) : undefined;
  const open = new Set([...node.querySelectorAll('details[open] > summary')].map(name));
  node.replaceChildren(...children.flat().filter(child => child != null));
  for (const summary of node.querySelectorAll('details > summary')) {
    summary.parentElement.open = open.has(name(summary));
  }
  if (focused) [...node.querySelectorAll('button, input, summary, select, textarea, a[href], [tabindex="-1"]')]
    .find(item => name(item) === focused)?.focus({ preventScroll: true });
}
const disclosure = (title, ...contents) => el('details', el('summary', title), ...contents);

function link(label, url) {
  const anchor = el('a', label);
  anchor.href = url;
  return anchor;
}

function renderTable(model) {
  return model?.rows.length ? table(model.headers, model.rows.map(row => row.map(cell =>
    cell && typeof cell === 'object' ? link(cell.label, cell.url) : cell))) : el('p', 'No records available.');
}

function selectControl(label, values, run) {
  const select = el('select', values.map(([value, label]) => {
    const item = el('option', label);
    item.value = value;
    return item;
  }));
  select.setAttribute('aria-label', label);
  select.addEventListener('change', () => run(select.value));
  return Object.assign(el('label', label === 'Membership state' ? 'Step' : label, select), { select });
}

function stepSummary(context) {
  if (!context) return el('p', 'No affected subnet was established.');
  const lines = context.scenario.steps.map(step => {
    const kind = branch(step.requested);
    const payload = step.requested[kind];
    const adds = payload.add ?? (kind === 'Add' ? payload.nodes : []);
    const removes = payload.remove ?? (kind === 'Remove' ? payload.nodes : []);
    return el('li', el('strong', '#' + step.proposal + ' · ' + words(kind)), ' · ' + branch(step.outcome),
      adds.length ? el('p', 'Requested additions ', el('code', adds.map(principal).join(', '))) : null,
      removes.length ? el('p', 'Requested removals ', el('code', removes.map(principal).join(', '))) : null);
  });
  return el('ol', lines);
}

function detailBlock(live, context, session, model) {
  const { report, assignments, listed_subnets } = live.outcome.Ok;
  const manifest = report.manifest;
  const labels = { Unavailable: 'Evidence unavailable', Deleted: 'Record deleted', Present: 'Record present' };
  const calc = model?.calculation;
  const findingRows = context?.scenario.steps.flatMap(step => step.findings.map(row => [
    '#' + step.proposal, words(branch(row.severity)), words(branch(row.code)),
    row.nodes.map(principal).join(', ') || '—', row.subnets.map(principal).join(', ') || '—',
    row.registry.map(key => {
      const kind = branch(key);
      return [words(kind), key[kind]?.toText?.() ?? key[kind]].filter(value => value != null).join(' ');
    }).join(', ') || '—',
  ])) ?? [];
  const refs = manifest.registry.map(([key, evidence]) => {
    const tag = branch(key);
    const kind = branch(evidence);
    const value = key[tag];
    const stamp = kind === 'Unavailable' ? option(evidence[kind].stamp) : evidence[kind];
    return [
      words(tag), value?.toText?.() ?? value ?? '—',
      kind === 'MissingAtBaseline' ? (tag === 'ApiBoundary' ? 'Confirmed absent at baseline' : 'Absent at baseline') : labels[kind] ?? words(kind),
      stamp?.mutation_version ?? '—', stamp?.page_observation ?? '—',
    ];
  });
  return el('div', el('h3', 'Coverage and provenance'),
    el('p', 'Pinned Registry version ' + number(manifest.registry_version)),
    el('p', 'Checked ' + number(listed_subnets) + ' of ' + (option(live.outcome.Ok.total_listed_subnets ?? []) ?? 'an unknown number of') +
      ' listed subnet memberships. Membership, hardware and API-boundary checks apply to the captured scope.'),
    context?.failures.length ? el('ul', context.failures.map(item => el('li',
      (item.type ? stageLabel(item.type) + ' · ' + item.key + ' · ' : '') + item.reason))) : null,
    disclosure('Candidate assignments', table(['Node', 'Assignment observation'], assignments.map(([node, item]) => [
      el('code', principal(node)), item.ListedSubnet ? principal(item.ListedSubnet) : ({
        ApiBoundary: 'Registered API boundary node',
        UnknownOutsideListedSubnets: 'No assignment found in the checked records',
        NodeAbsent: 'Node record absent at baseline',
      })[branch(item)],
    ]))),
    findingRows.length ? disclosure('Simulation findings',
      table(['Proposal', 'Severity', 'Finding', 'Nodes', 'Subnets', 'Registry keys'], findingRows)) : null,
    disclosure('Method and exact inputs', el('p', thresholdNote), el('p', geographyNote), el('p', calculationNote),
      el('p', 'Preview revision ', el('code', hex(report.revision))),
      manifest.proposals.map(proposal => el('p', '#' + proposal.id + ' payload ', el('code', hex(proposal.payload_hash)),
        el('br'), 'Governance reply ', el('code', hex(proposal.raw_hash)))),
      calc ? el('div', el('p', 'Replicated comparison · analysis v' + calc.analysis_version + ' · ' + calc.instructions + ' instructions'),
        el('p', 'Calculation input SHA-256 ', el('code', calc.inputHash)),
        action('Download calculation input (Candid)', () => saveFile('calculation-' + calc.inputHash + '.didbin', calc.bytes, 'application/octet-stream'))) : null),
    disclosure('Registry references', table(['Kind', 'Key', 'Evidence', 'Mutation', 'Observation'], refs)),
    disclosure('Review session source receipts and timings', sourceReceipts(live),
      session.receipts.map(({ type, response, error, keys }) => response
        ? disclosure(stageLabel(type), sourceReceipts(response))
        : el('p', stageLabel(type) + ' · ' + error, el('br'), el('code', keys.join(', '))))));
}

export function mountReviewWorkspace({ live, contexts, map, mapHost, active, call, phase, performance, local }) {
  const { report, proposal_text, listed_subnets, total_listed_subnets } = live.outcome.Ok;
  const { proposals, registry_version: version } = report.manifest;
  const header = styled('section', 'review-header');
  const overview = styled('section', 'review-overview', el('h3', 'What changes'));
  const inspector = styled('section', 'inspector');
  inspector.hidden = true;
  const pane = styled('section', 'card review-pane');
  const nav = styled('nav', 'review-nav');
  nav.setAttribute('aria-label', 'Review views');
  const primary = styled('div', 'review-grid', styled('div', 'map-card', mapHost),
    styled('aside', 'findings-card', overview, inspector));
  const section = styled('div', 'workspace', header, primary, nav, pane);
  let current;
  let model;
  let selectedView = 'Nodes';
  let selection;
  let scenario = report.scenarios.find(row => branch(row.id) === 'AThenB') ?? report.scenarios[0];
  let subnet;
  let trigger;
  let renderedMap;
  let renderedPane;
  let renderedInspector;

  const session = createReviewSession({ live, contexts, active, call, phase, updated: render });
  const retry = action('Retry unavailable evidence', () => session.retry());
  retry.hidden = true;
  const scopeLimit = styled('p', 'coverage-notice');
  header.append(el('h2', proposals.length === 1 ? 'Proposal #' + proposals[0].id
    : 'Proposals ' + proposals.map(row => '#' + row.id).join(' + ')),
  styled('div', 'proposal-meta', proposals.map(row => el('span',
    link(option((option(proposal_text ?? []) ?? []).find(t => t.id === row.id)?.title ?? []) ?? '#' + row.id, proposalUrl(row.id)),
    ' · ' + (lifecycle[row.lifecycle_status] ?? 'Status ' + row.lifecycle_status) + ' observed ' + time(row.observed_at_nanos)))),
  scopeLimit);
  const controls = styled('div', 'controls review-controls');
  const membership = styled('div', 'review-summary');
  header.append(controls, membership);

  function show(view, moveFocus = false) {
    selectedView = view;
    for (const button of nav.children) button.setAttribute('aria-pressed', String(button.textContent === view));
    performance.visible(view === 'Performance');
    renderPane();
    if (moveFocus) nav.querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
  }

  function showEvidence() {
    show('Evidence', true);
    nav.scrollIntoView({ block: 'nearest' });
  }
  for (const view of modes) nav.append(action(view, () => show(view)));
  scopeLimit.append(styled('strong', 'coverage-heading',
    option(total_listed_subnets ?? []) === listed_subnets ? 'Scoped execution checks' : 'Assignment checks are partial'),
  ' · Checked ' + listed_subnets + ' of ' + (option(total_listed_subnets ?? []) ?? 'an unknown number of') + ' listed subnets. ',
  option(total_listed_subnets ?? []) === listed_subnets ? 'Full execution validity remains unverified. ' : 'Incoming assignments elsewhere remain unverified. ',
  action('Coverage', showEvidence));

  function choose(next, resetSelection = true) {
    current = next;
    if (resetSelection) {
      selection = undefined;
      trigger = undefined;
      renderedMap = renderedPane = renderedInspector = undefined;
    }
    const scope = current && live.outcome.Ok.scopes.find(row => branch(row.scenario) === branch(current.scenario.id) &&
      principal(row.subnet) === principal(current.subnet));
    performance.scope(current?.state ? { context: current, affected: affectedNodes(current, scope), version } : undefined);
    session.select(next);
    if (!next) render(undefined);
  }

  function chooseScope() {
    const candidates = contexts.filter(c => c.scenario === scenario);
    const subnets = [...new Set(candidates.map(c => principal(c.subnet)))];
    if (!subnets.includes(subnet)) subnet = subnets[0];
    const phases = candidates.filter(c => principal(c.subnet) === subnet);
    const activePhase = phases.at(-1);
    drawControls(phases);
    choose(activePhase);
  }

  function drawControls(phases) {
    const focused = controls.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    controls.replaceChildren();
    if (report.scenarios.length > 1) {
      const order = selectControl('Proposal order', report.scenarios.map(row => [branch(row.id), scenarioName(row) +
        ' · ' + row.steps.map(step => words(branch(step.requested)).toLowerCase()).join(' then ')]), key => {
        scenario = report.scenarios.find(row => branch(row.id) === key);
        chooseScope();
      });
      order.select.value = branch(scenario.id);
      controls.append(order);
    }
    const subnets = [...new Set(contexts.filter(c => c.scenario === scenario).map(c => principal(c.subnet)))];
    const labels = shortIds(subnets);
    if (subnets.length > 1) {
      const control = selectControl('Subnet', subnets.map(id => [id, labels.get(id)]), key => {
        subnet = key;
        chooseScope();
      });
      control.select.value = subnet;
      controls.append(control);
    } else if (subnet) {
      // tdb26 is the NNS system subnet. Other subnet names remain registry identities.
      controls.append(link((subnet === 'tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe' ? 'NNS · ' : 'Subnet · ') + labels.get(subnet),
        'https://dashboard.internetcomputer.org/subnet/' + subnet));
    }
    if (phases.length > 1) {
      const control = selectControl('Membership state', phases.map(c => [String(c.index),
        c.index === 0 ? 'Baseline' : 'After #' + c.scenario.steps[c.index - 1].proposal +
          (c.state ? '' : ' · simulation unavailable')]), key => {
        choose(phases.find(c => c.index === Number(key)));
      });
      control.select.value = String(phases.at(-1).index);
      controls.append(control);
    }
    if (focused) [...controls.querySelectorAll('select')].find(select => select.getAttribute('aria-label') === focused)?.focus();
  }

  function inspect(ids, title, moveFocus = true) {
    if (!inspector.contains(document.activeElement)) trigger = document.activeElement;
    selection = { ids, title };
    map.highlight(ids);
    if (document.activeElement?.dataset.marker) trigger = document.activeElement;
    renderInspector();
    if (moveFocus) inspector.querySelector('h3')?.focus();
  }

  function closeInspector() {
    selection = undefined;
    inspector.hidden = true;
    if (trigger?.isConnected) trigger.focus();
    else overview.querySelector('button')?.focus();
    map.highlight([]);
  }
  inspector.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeInspector();
  });

  function nodeCard(node, chooseNode = true) {
    return styled('article', 'node-card', styled('span', 'node-role role-' + node.role.toLowerCase(), roles[node.role]),
      el('strong', node.label), el('span', [node.dc, node.region?.split(',')[2]?.trim()].filter(Boolean).join(' · ') ||
        'Registered location unavailable'), chooseNode ? action('Details · ' + node.label, () => inspect([node.id], node.label)) : null);
  }

  function renderInspector() {
    renderedInspector = current?.calculation;
    inspector.hidden = !selection || !model;
    if (inspector.hidden) return;
    const rows = model.members.filter(node => selection.ids.includes(node.id));
    const title = el('h3', selection.title);
    title.tabIndex = -1;
    let content = rows.map(node => nodeCard(node));
    if (rows.length === 1) {
      const node = rows[0];
      const copyStatus = el('p');
      copyStatus.setAttribute('role', 'status');
      const fullId = el('input');
      fullId.value = node.id;
      fullId.readOnly = true;
      fullId.setAttribute('aria-label', 'Full node principal');
      content = [
        nodeCard(node, false), fullId, action('Copy node ID', async () => {
          fullId.select();
          try { await navigator.clipboard.writeText(node.id); copyStatus.textContent = 'Node ID copied.'; }
          catch { copyStatus.textContent = document.execCommand('copy') ? 'Node ID copied.' : 'Copy the selected node ID.'; }
        }), ' ', link('Dashboard node record', node.row[0].url), copyStatus,
        el('dl', ['Registered owner', 'Registered region', 'Provider', 'Operator', 'Reward type', 'SEV chip ID', 'Evidence gaps'].map((label, index) =>
          el('div', el('dt', label), el('dd', node.row[index + 2]?.label ?? node.row[index + 2])))),
        !node.point ? el('p', 'This node has no usable registered coordinates. It remains part of the analytical scope.') : null,
      ];
    }
    replace(inspector, styled('div', 'inspector-heading', title, action('Close details', closeInspector)),
      el('p', rows.length + (rows.length === 1 ? ' node' : ' nodes') + ' selected. Subnet totals and review exports keep the full selected state.'),
      ...content, action('Evidence for this comparison', showEvidence));
  }

  function findingCard(finding) {
    const item = action(finding.title, () => inspect(finding.ids, finding.title));
    item.className = 'finding-select';
    return styled('article', 'finding-card', item, el('p', finding.explanation),
      finding.metrics.length ? el('ul', finding.metrics.map(metric => {
        const [before, after] = metric.coefficient;
        return el('li', metric.name + ' ' + metric.label + ' · ' + metric.before + ' → ' + metric.after,
          finding.kind !== 'last-member' && before !== undefined && after !== undefined && before !== after
            ? ' · coefficient ' + before + ' → ' + after : '');
      })) : null);
  }

  function render(next) {
    model = next?.state ? reviewModel(live, next.scenario, principal(next.subnet),
      { ...next.state, label: next.index ? 'After proposal #' + next.scenario.steps[next.index - 1].proposal : 'Baseline' },
      next.rules, next.calculation?.comparison, next.calculation?.evidence ?? emptyEvidence(), next.failures) : undefined;
    if (model) {
      model.calculation = next.calculation;
      if (local) model.notes.unshift('Local replica review. Observation times describe the local reads.');
    }
    const historical = proposals.some(row => scenario?.proposal_ids.includes(row.id) &&
      (row.lifecycle_status === 4 || row.executed_at_seconds.length));
    const blockers = scenario?.steps.flatMap((step, index) => step.findings.filter(row => 'Error' in row.severity)
      .map(row => ({ step, index, row }))) ?? [];
    const placement = model?.placement ?? [];
    const removed = placement.find(node => node.role === 'Removed');
    const added = placement.find(node => node.role === 'Added');
    const location = node => node?.region?.split(',')[2]?.trim() || node?.dc || node?.label;
    replace(membership,
      el('strong', model ? model.membership : 'Simulation unavailable'),
      removed && added && placement.length === 2 ? el('span', 'Registered replacement · ' + location(removed) + ' → ' + location(added)) : null,
      historical ? styled('p', 'notice warning', 'Governance observed execution. The actual historical before-state is unavailable here.' +
        (next?.state ? ' This view uses the pinned Registry snapshot.' : '')) : null,
      blockers.length ? styled('ul', 'notice warning', blockers.map(({ step, index, row }) => el('li',
        (next?.state && index >= next.index ? 'Later step blocked' : 'Simulation blocked') +
        ' · #' + step.proposal + ' · ' + words(branch(row.code))))) : null);
    const orders = report.findings.some(row => 'DifferentIntermediateStates' in row.code);
    const primaryFindings = model?.findings.filter(row => ['size', 'concentration', 'last-member'].includes(row.kind)) ?? [];
    const quiet = model?.findings.filter(row => row.kind === 'context') ?? [];
    const key = [...primaryFindings, ...quiet].slice(0, 3);
    replace(overview, el('h3', 'What changes'),
      orders ? styled('p', 'order-note', 'The two orders have different intermediate memberships. Inspect each step with the proposal order and membership controls.') : null,
      session.pendingOrders() ? styled('p', 'muted', session.pendingOrders() + ' order comparisons still pending.') : null,
      ...key.map(findingCard),
      !key.length ? el('p', model?.calculation ? 'No primary finding in the available membership and group evidence.' :
        next?.state ? 'Membership is available. Registered group findings appear as comparisons arrive.' : 'Required membership evidence did not establish a resulting state.') : null,
      model?.findings.length ? action('All consequences', () => {
        show('Concentration');
        const list = pane.querySelector('.all-consequences');
        list.open = true;
        list.querySelector('summary').focus();
      }) : null,
      next?.calculation && model.members.some(node => !node.point) ? el('p', model.members.filter(node => !node.point).length + ' nodes lack usable registered coordinates in Changes. Other figures retain their stated coverage.') : null,
      retry);
    retry.hidden = !['partial', 'unavailable'].includes(next?.status);
    if (!renderedMap || renderedMap.calculation !== next?.calculation) {
      map.update(model, selection?.ids, 'The map needs a resolved membership state.');
      renderedMap = { calculation: next?.calculation };
    }
    if (!selection || next?.calculation !== renderedInspector) renderInspector();
    renderPane();
    const comparing = session.pendingOrders() > 0 && !session.isStopped();
    if (next?.status === 'available') phase('Analysis loaded' + (listed_subnets < (option(total_listed_subnets ?? []) ?? Infinity) ? ' · assignment checks remain partial' : '') +
      (comparing ? ' · comparing proposal orders' : ''), comparing);
    if (next?.status === 'partial') phase('Some evidence unavailable. Showing the last accepted calculation.', comparing);
    if (next?.status === 'unavailable') phase('Detailed comparison unavailable. Membership is available.', comparing);
    if (next?.status === 'blocked' || !next?.rules) phase('Detailed comparison unavailable for this state.', comparing);
    if (next?.status === 'pending' && next.rules) {
      if (session.isStopped()) phase('Review stopped. Select Review to start a new run.', false);
      else phase(next.calculation ? 'Membership available. Continuing the selected comparison.' :
        'Membership available. Preparing the selected comparison.', true);
    }
  }

  function renderPane() {
    if (!section.isConnected && !current) return;
    const lookup = title => model?.tables.find(row => row.title === title);
    if (selectedView === 'Performance') {
      if (!pane.contains(performance.section)) replace(pane, performance.section);
      pane.hidden = false;
      return;
    }
    const signature = [selectedView, current, current?.calculation, current?.status,
      selectedView === 'Evidence' ? session.receipts.length : 0];
    if (renderedPane?.every((value, i) => signature[i] === value) && !pane.contains(performance.section)) return;
    renderedPane = signature;
    pane.hidden = false;
    if (selectedView === 'Evidence') {
      replace(pane, detailBlock(live, current, session, model));
    } else if (selectedView === 'Nodes') {
      const list = model?.members ?? [];
      replace(pane, el('h3', 'Nodes'),
        styled('div', 'node-list', list.filter(node => node.role !== 'Retained').map(node => nodeCard(node))),
        list.length ? disclosure('All ' + list.length + ' nodes in Changes', styled('div', 'node-list', list.map(node => nodeCard(node)))) : null,
        disclosure('Requested payload and simulation steps', stepSummary(current)));
    } else if (selectedView === 'Claims') {
      const statements = option(proposal_text ?? []) ?? [];
      const departures = model?.findings.filter(row => row.kind === 'last-member') ?? [];
      replace(pane, el('h3', 'Proposer claims'),
        el('p', 'These claims are compared with registered facts where the selected scenario supports it. Physical decommissioning and health remain unverified.'),
        statements.map(row => {
          const motivation = row.summary.match(/^\s*Motivation:[ \t]*([^\r\n]+)/mi)?.[1]?.trim();
          return motivation ? el('p', el('strong', 'Proposal #' + row.id + ' motivation'), ' · ', el('q', motivation)) : null;
        }),
        departures.length ? el('ul', departures.map(row => el('li', row.title + '. ' + row.explanation))) : null,
        lookup('Proposer claims and independent calculation') ? renderTable(lookup('Proposer claims and independent calculation')) : null,
        statements.map(row => disclosure('Proposal #' + row.id + ' statement',
          styled('pre', 'claim-text', row.summary), row.truncated ? el('p', 'The captured statement was truncated.') : null)));
    } else if (selectedView === 'Concentration') {
      const summary = lookup('Decentralisation and concentration');
      const showFaultBudget = model?.dimensions.some(row => [row.before, row.after].some(side => {
        const third = option(side.greater_than_one_third);
        const fault = option(side.fault_budget_plus_one);
        return third && fault && third.nodes_required !== fault.nodes_required;
      }));
      replace(pane, el('h3', 'Concentration'),
        summary ? renderTable(showFaultBudget ? summary : { headers: summary.headers.filter((_, i) => i !== 5),
          rows: summary.rows.map(row => row.filter((_, i) => i !== 5)) }) : el('p', 'No accepted comparison yet.'),
        model?.findings.length ? Object.assign(disclosure('All consequences (' + model.findings.length + ')',
          ...model.findings.map(findingCard)), { className: 'all-consequences' }) : null,
        ...(model?.dimensions ?? []).map(dimension => disclosure(dimension.label + ' distribution', el('p', dimension.note),
          table(dimension.table.headers, dimension.table.rows.map(([group, ...cells]) => {
            const key = group.label ?? group;
            const ids = groupMembers(model.members, dimension.key, key).map(node => node.id);
            const label = dimension.labels.get(key) ?? key;
            return [ids.length ? action(label, () => inspect(ids, dimension.label + ' · ' + label)) : label, ...cells];
          })))),
        lookup('Geographic distances') ? disclosure('Geographic distances', el('p', geographyNote), renderTable(lookup('Geographic distances'))) : null);
    } else {
      replace(pane, model?.calculation && current?.status !== 'pending'
        ? markdownEditor(model, current.draft, map.exportButton)
        : el('p', 'Export is available after a comparison has settled. The export uses the full selected scenario and step.'));
    }
  }

  for (const button of nav.children) button.setAttribute('aria-pressed', String(button.textContent === selectedView));
  // The parent mounts the workspace before selections issue any remote work.
  return { section, start: chooseScope, inspect, session };
}
