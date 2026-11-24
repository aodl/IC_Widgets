import { connect, identity, liveError, result } from './client.js';
import { mountPerformance } from './performance.js';
import { branch, el, principal, renderScenario, reviewHeader, scenarioLabel, sourceReceipts, styled } from './view.js';

const search = document.querySelector('#search');
const submit = search.querySelector('button');
const reportStatus = document.querySelector('#report-status');
const reportContainer = document.querySelector('#report');
document.querySelector('#local-notice').hidden = !LOCAL_REPLICA;
document.querySelector('#browser-principal').textContent = identity.getPrincipal().toText();

let connection;
function actor() {
  connection ??= connect().catch(error => {
    connection = undefined;
    throw error;
  });
  return connection;
}

const linkPerformance = mountPerformance(actor);

function showStatus(message, error = false) {
  reportStatus.textContent = message;
  reportStatus.classList.toggle('error', error);
}

function idsForSearch() {
  const ids = [...new FormData(search).values()].map(value => value.trim()).filter(Boolean).map(BigInt);
  if (!ids.length || ids.some(id => id < 1n || id > 18_446_744_073_709_551_615n)
    || new Set(ids).size !== ids.length) {
    throw new Error('Choose one or two distinct positive proposal IDs.');
  }
  return ids;
}

search.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true;
  reportContainer.replaceChildren();
  try {
    const ids = idsForSearch();
    showStatus('Reading Governance and pinned Registry evidence…');
    const live = result(await (await actor()).review_on_demand(ids));
    if ('Err' in live.outcome) {
      showStatus(liveError(live.outcome.Err), true);
      reportContainer.append(sourceReceipts(live));
      return;
    }
    showStatus('');
    renderReport(live);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

function selectControl(label, entries) {
  const select = el('select', entries.map(([value, label]) => {
    const item = el('option', label);
    item.value = value;
    return item;
  }));
  select.setAttribute('aria-label', label);
  return [el('label', label, select), select];
}

function renderReport(live) {
  const { report, scopes } = live.outcome.Ok;
  const [scenarioLabelControl, scenarioSelect] = selectControl('Scenario',
    report.scenarios.map(scenario => [branch(scenario.id), scenarioLabel(scenario.id)]));
  const [subnetLabel, subnetSelect] = selectControl('Subnet', []);
  const [stateLabel, stateSelect] = selectControl('Registered state', []);
  const overview = el('div');
  const link = el('button', 'Use this scope in Node Performance');
  link.type = 'button';
  let scenario;
  let scope;

  function updateStateOptions() {
    const subview = scenario.subnets.find(([id]) => principal(id) === subnetSelect.value);
    scope = scopes.find(row => branch(row.scenario) === branch(scenario.id)
      && principal(row.subnet) === subnetSelect.value);
    const entries = [
      ['0', 'Baseline'],
      ...scenario.steps.map((step, index) => [String(index + 1),
        `After proposal #${step.proposal}${index + 1 === scenario.steps.length ? ' (final step)' : ''}`]),
    ];
    stateSelect.replaceChildren(...selectControl('state', entries)[1].children);
    const latest = subview?.[1].after_steps.findLastIndex(state => state.length) ?? -1;
    stateSelect.value = String(latest + 1);
    stateSelect.disabled = !subview;
    link.hidden = !scope;
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

  scenarioSelect.addEventListener('change', updateScenario);
  subnetSelect.addEventListener('change', updateStateOptions);
  stateSelect.addEventListener('change', draw);
  link.addEventListener('click', () => linkPerformance(scope, report.manifest.registry_version));
  reportContainer.replaceChildren(
    reviewHeader(report, live.outcome.Ok),
    styled('section', 'card', el('h2', 'Membership and topology'),
      styled('div', 'controls', scenarioLabelControl, subnetLabel, stateLabel), overview, link,
      sourceReceipts(live)),
  );
  updateScenario();
}
