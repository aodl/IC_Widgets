import { connect, result } from './client.js';
import { branch, el, hex, number, option, principal, proposalIds, renderPerformance, renderScenario, reviewHeader, scenarioLabel, styled } from './view.js';

const search = document.querySelector('#search');
const catalog = document.querySelector('#catalog');
const catalogStatus = document.querySelector('#catalog-status');
const reportStatus = document.querySelector('#report-status');
const reportContainer = document.querySelector('#report');
document.querySelector('#local-notice').hidden = !LOCAL_REPLICA;

let actor;
let entries;
let catalogRequest;
let catalogGeneration = 0;
let reportGeneration = 0;

function showStatus(item, message, error = false) {
  item.textContent = message;
  item.classList.toggle('error', error);
}

function idsForSearch() {
  const raw = [...new FormData(search).values()].map(value => value.trim()).filter(Boolean);
  const ids = raw.map(id => BigInt(id));
  if (ids.some(id => id < 1n || id > 18_446_744_073_709_551_615n) || new Set(ids).size !== ids.length) {
    throw new Error('Choose distinct proposal IDs in the positive nat64 range.');
  }
  return ids;
}

function renderCatalog(ids) {
  const matching = entries.filter(row => !ids.length
    || (ids.length === row.proposals.length && ids.every(id => row.proposals.includes(id))));
  catalog.replaceChildren(...matching.map(row => {
    const label = `${proposalIds(row.proposals)} · Registry ${number(row.registry_version)}`;
    const button = el('button', label, option(row.hypothetical_executed) ? ' · Hypothetical' : '', ` · ${hex(row.revision).slice(0, 10)}`);
    button.type = 'button';
    button.addEventListener('click', () => loadReport(row.revision));
    return el('li', button);
  }));
  showStatus(catalogStatus, matching.length
    ? `${number(matching.length)} completed ${matching.length === 1 ? 'review' : 'reviews'}`
    : 'No completed review matches. A controller can prepare one from the archived evidence.');
}

async function updateCatalog(ids, refresh = false) {
  const ticket = ++catalogGeneration;
  try {
    if (!entries || refresh) {
      showStatus(catalogStatus, 'Reading completed reviews…');
      catalogRequest ??= (async () => {
        actor ??= await connect();
        return actor.list_completed_reviews();
      })().finally(() => { catalogRequest = undefined; });
      const rows = await catalogRequest;
      if (ticket !== catalogGeneration) return;
      entries = rows;
    }
    renderCatalog(ids);
  } catch (error) {
    if (ticket === catalogGeneration) showStatus(catalogStatus, error.message, true);
  }
}

search.addEventListener('submit', event => {
  event.preventDefault();
  try { void updateCatalog(idsForSearch()); }
  catch (error) { showStatus(catalogStatus, error.message, true); }
});
document.querySelector('#browse').addEventListener('click', () => {
  search.reset();
  void updateCatalog([], true);
});

async function loadReport(revision) {
  const ticket = ++reportGeneration;
  reportContainer.replaceChildren();
  showStatus(reportStatus, 'Reading review…');
  try {
    const report = result(await actor.read_membership_review(revision));
    if (ticket !== reportGeneration) return;
    showStatus(reportStatus, '');
    renderReport(report);
  } catch (error) {
    if (ticket === reportGeneration) showStatus(reportStatus, error.message, true);
  }
}

function selectControl(label, entries) {
  const select = el('select', entries.map(([value, label]) => {
    const item = el('option', label);
    item.value = value;
    return item;
  }));
  select.setAttribute('aria-label', label);
  return [el('label', label, select), select];
}

function renderReport(report) {
  const [scenarioLabelControl, scenarioSelect] = selectControl('Scenario',
    report.scenarios.map(scenario => [branch(scenario.id), scenarioLabel(scenario.id)]));
  const [subnetLabel, subnetSelect] = selectControl('Subnet', []);
  const [stateLabel, stateSelect] = selectControl('Registered state', []);
  const overview = el('div');
  const performance = el('div');
  const performanceStatus = styled('p', 'status');
  performanceStatus.role = 'status';
  const load = el('button', 'Load blockmaking sample');
  const more = el('button', 'Next scoped page');
  more.hidden = true;

  let scenario;
  let subnet;
  let performanceGeneration = 0;
  let cursor;
  let sampleTimestamp;

  function updateStateOptions() {
    const subview = scenario.subnets.find(([id]) => principal(id) === subnetSelect.value);
    subnet = subview?.[0];
    const entries = [
      ['0', 'Baseline'],
      ...scenario.steps.map((step, index) => [String(index + 1),
        `After proposal #${step.proposal}${index + 1 === scenario.steps.length ? ' (final step)' : ''}`]),
    ];
    stateSelect.replaceChildren(...selectControl('state', entries)[1].children);
    const latest = subview?.[1].after_steps.findLastIndex(state => state.length) ?? -1;
    stateSelect.value = String(latest + 1);
    stateSelect.disabled = !subview;
    performanceGeneration++;
    cursor = undefined;
    sampleTimestamp = undefined;
    performance.replaceChildren();
    showStatus(performanceStatus, subnet ? '' : 'A resolved subnet scope is unavailable.');
    load.disabled = !subnet;
    more.hidden = true;
    draw();
  }

  function updateScenario() {
    const currentSubnet = subnetSelect.value;
    scenario = report.scenarios.find(row => branch(row.id) === scenarioSelect.value);
    const entries = scenario.subnets.map(([id]) => [principal(id), principal(id)]);
    subnetSelect.replaceChildren(...selectControl('subnet', entries)[1].children);
    if (entries.some(([id]) => id === currentSubnet)) subnetSelect.value = currentSubnet;
    subnetSelect.disabled = !entries.length;
    updateStateOptions();
  }

  function draw() { renderScenario(report, scenario, subnetSelect.value, Number(stateSelect.value), overview); }

  async function readPerformance(next, timestamp) {
    if (!subnet) return;
    const ticket = ++performanceGeneration;
    load.disabled = true;
    more.disabled = true;
    showStatus(performanceStatus, 'Reading the scoped archive…');
    try {
      const page = result(await actor.read_membership_performance({
        scope: { revision: report.revision, scenario: scenario.id, subnet, roles: [], nodes: [], cursor: next ? [next] : [] },
        timestamp: timestamp === undefined ? [] : [timestamp],
      }));
      if (ticket !== performanceGeneration) return;
      renderPerformance(page, performance);
      const nodePage = page.scope.Nodes;
      const after = nodePage && option(nodePage.next);
      cursor = after ? { after, selection: nodePage.selection } : undefined;
      sampleTimestamp = option(page.sample)?.timestamp_nanos;
      more.hidden = !cursor;
      showStatus(performanceStatus, '');
    } catch (error) {
      if (ticket === performanceGeneration) showStatus(performanceStatus, error.message, true);
    } finally {
      if (ticket === performanceGeneration) {
        load.disabled = false;
        more.disabled = false;
      }
    }
  }

  scenarioSelect.addEventListener('change', updateScenario);
  subnetSelect.addEventListener('change', updateStateOptions);
  stateSelect.addEventListener('change', draw);
  load.addEventListener('click', () => readPerformance());
  more.addEventListener('click', () => readPerformance(cursor, sampleTimestamp));
  reportContainer.replaceChildren(
    reviewHeader(report),
    styled('section', 'card', el('h2', 'Membership and topology'),
      styled('div', 'controls', scenarioLabelControl, subnetLabel, stateLabel), overview),
    styled('section', 'card', el('h2', 'Node performance'),
      styled('p', 'muted', 'Archived blockmaking observations from this subnet, filtered to the scenario’s resolved node scope. Sparse samples can omit unchanged rows.'),
      styled('div', 'actions', load, more), performanceStatus, performance),
  );
  updateScenario();
}

void updateCatalog([]);
