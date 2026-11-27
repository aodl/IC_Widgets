import { activeReplay, connect, liveError, replays, result } from './client.js';
import { proposalHeading } from './dashboard.js';
import { replayLabel } from './detail-model.js';
import { mountReviewWorkspace } from './membership-details.js';
import { mountPerformance } from './performance.js';
import { reviewMap } from './map-interaction.js';
import { reviewContexts, serializeCalls } from './review-session.js';
import { terminalOutcome, terminalSummary } from './terminal-outcome.js';
import { el, option, sourceReceipts, styled } from './view.js';

const search = document.querySelector('#search');
const reportStatus = document.querySelector('#report-status');
const elapsed = document.querySelector('#review-elapsed');
const stop = document.querySelector('#stop-review');
const reportContainer = document.querySelector('#report');
const progressRow = document.querySelector('#review-progress');
const progressBar = progressRow.querySelector('progress');
const progressCounts = document.querySelector('#review-counts');
const notice = document.querySelector('#local-notice');
notice.hidden = !LOCAL_REPLICA;
if (FIXTURE_REPLAY && activeReplay) {
  notice.textContent = replayLabel(activeReplay) + (activeReplay.roleSupplement ? ' · Synthetic NNS-role supplement' : '');
  const selector = el('select', replays.cases.map(row => Object.assign(el('option', row.name), { value: row.id })));
  selector.value = activeReplay.id;
  const label = el('label', 'Replay scenario', selector);
  label.className = 'local-note replay-selector';
  notice.after(label, styled('p', 'local-note replay-purpose', activeReplay.purpose));
  selector.addEventListener('change', () => {
    const next = new URL(location.href);
    next.searchParams.set('case', selector.value);
    location.assign(next);
  });
  search.elements.first.value = activeReplay.proposalIds[0];
  search.elements.second.value = activeReplay.proposalIds[1] ?? '';
}

let generation = 0;
let connection;
let current;
let currentMap;
let previewTask;
let timer;
let request;
const serialize = serializeCalls();
function remote(active, run) {
  return serialize(active, async () => {
    connection ??= connect().catch(error => {
      connection = undefined;
      throw error;
    });
    const client = await connection;
    return active() ? run(client) : undefined;
  });
}
const performance = mountPerformance(async (active, run) => {
  while (active()) {
    const task = previewTask;
    await task;
    const session = current?.session;
    await session?.settled();
    if (task === previewTask && session === current?.session) return remote(active, run);
  }
});
performance.visible(true);

const phases = {
  Preview: 'Proposal and membership · Reading pinned evidence',
  Nodes: 'Registered nodes · Loading node records',
  Operators: 'Registered nodes · Loading operator records',
  DataCenters: 'Loading data centers',
  Role: 'Reading the pinned Registry role',
  Comparison: 'Comparison · Calculating supported states',
  Lifecycle: 'Comparison · Checking Governance again',
  Finished: 'Data loading complete', Provisional: 'Provisional · Governance check failed',
  Observed: 'Proposal outcome recorded', Blocked: 'Could not produce a review', Stopped: 'Stopped',
};

function status({ work, stage, counts, reason, remaining, selectedReady }) {
  const working = work === 'running' || work === 'stopping';
  const label = work === 'stopping' ? 'Stopping · Waiting for an accepted call to settle' : phases[stage];
  const message = [label, reason].filter(Boolean).join(' · ');
  if (reportStatus.textContent !== message) reportStatus.textContent = message;
  reportStatus.classList.toggle('error', stage === 'Blocked');
  reportStatus.classList.toggle('review-finished', ['Finished', 'Provisional', 'Observed'].includes(stage));
  stop.hidden = work !== 'running';
  progressRow.hidden = !working;
  progressBar.setAttribute('aria-label', label ?? 'Current review phase');
  if (counts?.planned) {
    progressBar.max = counts.planned;
    progressBar.value = counts.settled;
  } else progressBar.removeAttribute('value');
  const tally = counts?.planned ? counts.settled + ' of ' + counts.planned + (stage === 'Comparison' ? ' comparisons settled'
    : ' records settled · ' + counts.present + ' present · ' + counts.absent + ' absent · ' + counts.failed + ' failed') : '';
  progressCounts.textContent = tally + (stage === 'Comparison' && selectedReady && remaining ? ' · Selected comparison is ready' : '');
  const tick = () => {
    if (request) {
      const running = request.segment === undefined ? 0 : Date.now() - request.segment;
      elapsed.textContent = Math.floor((request.elapsed + running) / 1000) + ' s elapsed';
    }
  };
  if (working && timer === undefined) {
    request.segment ??= Date.now();
    tick();
    timer = setInterval(tick, 1000);
  }
  if (!working && timer !== undefined) {
    request.elapsed += Date.now() - request.segment;
    request.segment = undefined;
    tick();
    clearInterval(timer);
    timer = undefined;
  }
}

function idsForSearch() {
  const fields = new FormData(search);
  const ids = ['first', 'second'].map(name => fields.get(name).trim()).filter(Boolean).map(BigInt);
  const valid = id => id >= 1n && id <= 18_446_744_073_709_551_615n;
  if (!ids.length || ids.some(id => !valid(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Choose one or two distinct positive proposal IDs.');
  }
  return ids;
}

stop.addEventListener('click', () => {
  if (current) current.session.stop();
  else if (request) {
    request.stopped = true;
    status({ work: 'stopping', stage: 'Stopped' });
  }
});

search.addEventListener('submit', event => {
  event.preventDefault();
  let fields;
  try {
    fields = idsForSearch();
  } catch (error) {
    document.querySelector('#search-error').textContent = error.message;
    return;
  }
  document.querySelector('#search-error').textContent = '';
  const ids = fields;
  const ticket = ++generation;
  const active = () => generation === ticket;
  current?.session.stop();
  current?.dispose();
  currentMap?.dispose();
  current = undefined;
  const thisRequest = request = { segment: Date.now(), elapsed: 0, stopped: false };
  performance.scope(undefined);
  performance.visible(false);
  const map = currentMap = reviewMap();
  const mapHost = map.section;
  map.update();
  reportContainer.replaceChildren(styled('div', 'workspace waiting-workspace',
    styled('section', 'review-header', el('h2', proposalHeading(ids))),
    styled('div', 'review-grid', styled('div', 'map-card', mapHost))));
  clearInterval(timer);
  timer = undefined;
  status({ work: 'running', stage: 'Preview' });
  previewTask = (async () => {
    try {
      const response = await remote(() => active() && !thisRequest.stopped, client => client.begin_membership_review(ids));
      if (!active() || !response || thisRequest.stopped) return;
      const live = result(response);
      if ('Err' in live.outcome) {
        status({ work: 'settled', stage: 'Blocked', reason: liveError(live.outcome.Err) });
        map.update(undefined, 'Map unavailable · Required membership evidence');
        reportContainer.append(styled('section', 'card', el('h3', 'Evidence'), sourceReceipts(live)));
        return;
      }
      const body = live.outcome.Ok;
      const proposals = body.report.manifest.proposals;
      if (proposals.length && proposals.every(terminalOutcome)) {
        map.dispose();
        const titles = option(body.proposal_text ?? []) ?? [];
        const indexedFailure = FIXTURE_REPLAY && activeReplay?.proposalIds.length === 1 ? activeReplay.failureReason : undefined;
        reportContainer.replaceChildren(styled('section', 'card terminal-outcome',
          proposals.map(proposal => terminalSummary(proposal,
            option(titles.find(row => row.id === proposal.id)?.title ?? []),
            FIXTURE_REPLAY && activeReplay?.proposalIds[0] === String(proposal.id) ? indexedFailure : undefined, activeReplay)),
          sourceReceipts(live, { replay: !!activeReplay })));
        status({ work: 'settled', stage: 'Observed' });
        return;
      }
      const contexts = reviewContexts(body.report, option(body.subnet_rules ?? []) ?? []);
      current = mountReviewWorkspace({ live, contexts, map, mapHost, active, call: remote,
        progress: state => { if (active()) status(state); }, performance, replay: activeReplay });
      reportContainer.replaceChildren(current.section);
      current.start();
    } catch (error) {
      if (!active() || thisRequest.stopped) return;
      map.update(undefined, 'The map needs supported membership evidence for this review.');
      status({ work: 'settled', stage: 'Blocked', reason: error.message });
    } finally {
      if (active() && thisRequest.stopped) {
        map.update(undefined, 'Not loaded · Review stopped');
        status({ work: 'stopped', stage: 'Stopped' });
      }
    }
  })();
});

const independent = document.querySelector('#open-performance');
independent.addEventListener('click', () => {
  if (current) {
    current.openPerformance();
  } else {
    if (!performance.section.isConnected) document.querySelector('main').append(performance.section);
    performance.visible(true);
  }
  performance.section.scrollIntoView({ block: 'nearest' });
  performance.section.querySelector('h2').focus({ preventScroll: true });
});
