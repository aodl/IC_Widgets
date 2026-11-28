import { mountActivityNavigator } from './activity-navigator.js';
import { activeReplay, bundledCase, connect, liveError, replays, result, testCases } from './client.js';
import { proposalHeading } from './dashboard.js';
import { replayLabel } from './detail-model.js';
import { mountReviewWorkspace } from './membership-details.js';
import { mountPerformance } from './performance.js';
import { nodeMap } from './map-interaction.js';
import { mountSubnetOverview } from './subnet-overview.js';
import { proposalInput, proposalInputProfile, readInspectionSubject, subnetInputProfile } from './view-inputs.js';
import { comparisonFilterLabels, composedOutputs, hasProfile, readNodeFilter } from './composed-scope.js';
import { acceptNexusHost } from './widget-frame.js';
import { reviewContexts, serializeCalls } from './review-session.js';
import { showTestCatalogue } from './case-catalogue.js';
import { acceptScopedActivity, nextActivityAttempt, reviewCheckSummary, reviewChecksView } from './review-checks.js';
import { terminalOutcome, terminalSummary } from './terminal-outcome.js';
import { action, branch, el, hex, option, principal, sourceReceipts, styled, time } from './view.js';

const search = document.querySelector('#search');
const widget = EMBED_WIDGET;
const inspectorWidget = widget?.view === 'inspector';
const compositionFixture = LOCAL_REPLICA && inspectorWidget ? { compositionFixture: true } : undefined;
const connectedReview = inspectorWidget || widget?.view === 'proposal';
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
let activeView = 'proposal';
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
    if (activeView === 'subnet') {
      await overview.settled();
      if (activeView === 'subnet') return remote(active, run);
      continue;
    }
    const task = previewTask;
    await task;
    const session = current?.session;
    await session?.settled();
    if (task === previewTask && session === current?.session) return remote(active, run);
  }
}, { connected: widget?.view === 'performance' });
performance.visible(true);
let publishScope;
let latestOutputs;
function publishOutputs(outputs) {
  latestOutputs = outputs;
  publishScope?.(outputs);
}
function publishEvidence(selection, scene, issue, filterScope, deferFilter) {
  const state = issue ? { kind: 'unavailable', retryable: true, reason: issue.slice(0, 240) }
    : { kind: 'waiting', message: 'Waiting for accepted membership evidence' };
  const outputs = selection ? composedOutputs(selection, scene, filterScope) : { filter: state, scene: { ...state } };
  if (selection && deferFilter) outputs.filter = { kind: 'loading', message: 'Waiting for the inspector’s cross-proposal search' };
  publishOutputs(outputs);
}
const overview = mountSubnetOverview({ call: remote, performance, replay: compositionFixture ?? activeReplay,
  publish: (inspectorWidget || widget?.view === 'subnet') ? publishEvidence : undefined });
const connectedFilter = el('select', Object.entries(comparisonFilterLabels).map(([value, label]) =>
  Object.assign(el('option', label), { value })));
const connectedFilterControl = el('label', 'Connected Performance scope', connectedFilter);
connectedFilterControl.hidden = true;
let connectedEvidence;
let filterDeferred = false;
connectedFilter.addEventListener('change', () => {
  if (connectedEvidence) publishEvidence(...connectedEvidence, undefined, connectedFilter.value, filterDeferred);
});
const membershipPerformance = connectedReview ? { ...performance, filterControl: connectedFilterControl,
  scope(selection, scene, deferFilter) {
    filterDeferred = !!deferFilter;
    connectedEvidence = selection ? [selection, scene] : undefined;
    connectedFilterControl.hidden = !selection;
    publishEvidence(selection, scene, undefined, connectedFilter.value, filterDeferred);
  },
  releaseFilter() {
    if (!filterDeferred || !connectedEvidence) return;
    filterDeferred = false;
    publishEvidence(...connectedEvidence, undefined, connectedFilter.value);
  },
} : performance;

const phases = {
  Preview: 'Proposal and membership · Reading pinned evidence',
  Nodes: 'Registered nodes · Loading node records',
  Operators: 'Registered nodes · Loading operator records',
  DataCenters: 'Loading data centers',
  Role: 'Reading the pinned Registry role',
  Comparison: 'Comparison · Calculating supported states',
  Lifecycle: 'Comparison · Checking Governance again',
  Finished: 'Membership calculation complete', Provisional: 'Provisional · Governance check failed',
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
  return proposalInput(fields.get('first'), fields.get('second')).value.map(BigInt);
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
  try {
    startReview(idsForSearch());
  } catch (error) {
    document.querySelector('#search-error').textContent = error.message;
  }
});

const drafts = new Map();
const recentReviews = new Map();
const recentFor = 5 * 60_000;
function draftFor(report, context) {
  const key = JSON.stringify([report.manifest.proposals.map(row => [String(row.id), hex(row.payload_hash)]),
    principal(context.subnet), branch(context.scenario.id), context.index]);
  const draft = drafts.get(key) ?? {};
  drafts.delete(key);
  drafts.set(key, draft);
  while (drafts.size > 12) drafts.delete(drafts.keys().next().value);
  return draft;
}

function activityHint(input, proposal) {
  const hint = input?.display;
  if (!hint || hint.proposal !== proposal || typeof hint.title !== 'string' || hint.title.length > 400
      || typeof hint.observed !== 'string' || !/^\d{1,19}$/.test(hint.observed)) return;
  const deadline = typeof hint.deadline === 'string' && /^\d{1,11}$/.test(hint.deadline)
    ? time(BigInt(hint.deadline) * 1_000_000_000n) : undefined;
  return { title: hint.title, label: ['Activity queue · observed ' + time(BigInt(hint.observed)),
    deadline && 'Recorded voting deadline ' + deadline].filter(Boolean).join(' · ') };
}

function startReview(ids, discovered, preferredSubnet, hint) {
  document.querySelector('#search-error').textContent = '';
  const key = JSON.stringify([ids.map(String), preferredSubnet]);
  const previous = connectedReview ? recentReviews.get(key) : undefined;
  const recent = previous && Date.now() - previous.saved < recentFor ? previous : undefined;
  let prior;
  function rememberReview(snapshot) {
    recentReviews.delete(key);
    recentReviews.set(key, { ...snapshot, saved: Date.now() });
    while (recentReviews.size > 4) recentReviews.delete(recentReviews.keys().next().value);
    prior?.remove();
  }
  const ticket = ++generation;
  const active = () => generation === ticket;
  current?.session.stop();
  current?.dispose();
  currentMap?.dispose();
  current = undefined;
  const thisRequest = request = { ids, discovered, segment: Date.now(), elapsed: 0, stopped: false };
  performance.scope(undefined);
  performance.visible(false);
  const map = currentMap = connectedReview ? undefined : nodeMap();
  const mapHost = map?.section;
  map?.update();
  reportContainer.replaceChildren(styled('div', 'workspace waiting-workspace',
    styled('section', 'review-header', el('h2', proposalHeading(ids)),
      hint?.title ? styled('p', 'proposal-title', hint.title) : null,
      hint ? styled('p', 'muted', hint.label) : null),
    mapHost ? styled('div', 'review-grid', styled('div', 'map-card', mapHost)) : null));
  if (recent) {
    prior = styled('section', 'card recent-review',
      el('h3', 'Previous accepted review · rechecking current evidence'),
      el('p', recent.title), el('p', recent.comparison), el('p', recent.summary),
      el('small', 'Registry ' + recent.registry + ' · Last verified ' + recent.observed.join(', ')));
    reportContainer.prepend(prior);
  }
  clearInterval(timer);
  timer = undefined;
  status({ work: 'running', stage: 'Preview' });
  previewTask = (async () => {
    const waiting = () => active() && !thisRequest.stopped;
    try {
      let response = await remote(waiting, client => client.begin_membership_review(ids));
      if (response?.Err === 'another on-demand request is running' && waiting()) {
        reportStatus.textContent = 'Waiting to start Membership while the reviewer finishes another request…';
        await new Promise(resolve => setTimeout(resolve, 1800));
        if (waiting()) response = await remote(waiting, client => client.begin_membership_review(ids));
      }
      if (!active() || !response || thisRequest.stopped) return;
      const live = result(response);
      if ('Err' in live.outcome) {
        status({ work: 'settled', stage: 'Blocked', reason: liveError(live.outcome.Err) });
        unavailable(liveError(live.outcome.Err));
        map?.update(undefined, 'Map unavailable · Required membership evidence');
        reportContainer.append(styled('section', 'card', el('h3', 'Evidence'), sourceReceipts(live)));
        return;
      }
      const body = live.outcome.Ok;
      const proposals = body.report.manifest.proposals;
      const reviewReplay = compositionFixture ? {
        ...compositionFixture, activity: true, registryVersion: String(body.report.manifest.registry_version),
      } : activeReplay;
      if (proposals.length && proposals.every(terminalOutcome)) {
        map?.dispose();
        const titles = option(body.proposal_text ?? []) ?? [];
        const indexedFailure = (FIXTURE_REPLAY || bundledCase) && activeReplay?.proposalIds.length === 1 ? activeReplay.failureReason : undefined;
        reportContainer.replaceChildren(styled('section', 'card terminal-outcome',
          proposals.map(proposal => terminalSummary(proposal,
            option(titles.find(row => row.id === proposal.id)?.title ?? []),
            (FIXTURE_REPLAY || bundledCase) && activeReplay?.proposalIds[0] === String(proposal.id) ? indexedFailure : undefined, reviewReplay)),
          sourceReceipts(live, { replay: !!activeReplay })));
        if (thisRequest.discovered || !activeReplay || activeReplay.activity) {
          const checks = el('div');
          reportContainer.append(checks);
          let observation;
          const accept = next => {
            if (!active()) return;
            observation = acceptScopedActivity(observation, next, proposals);
            checks.replaceChildren(reviewChecksView(reviewCheckSummary([], undefined, observation)));
          };
          thisRequest.acceptActivity = accept;
          if (thisRequest.discovered) accept(thisRequest.discovered);
          else {
            const attempt = nextActivityAttempt();
            void (async () => {
              try {
                const reply = await remote(active, client => client.subnet_activity(proposals.map(row => row.id), []));
                if (!reply || !active()) return;
                const response = result(reply);
                accept('Err' in response.outcome ? { response, attempt, error: liveError(response.outcome.Err) } : { response, attempt });
              } catch (error) {
                accept({ attempt, error: error.message });
              }
            })();
          }
        }
        status({ work: 'settled', stage: 'Observed' });
        unavailable('This proposal has a terminal outcome.');
        return;
      }
      const contexts = reviewContexts(body.report, option(body.subnet_rules ?? []) ?? []);
      if (inspectorWidget && preferredSubnet && !contexts.some(row => row.index && row.subnet.toText() === preferredSubnet)) {
        const reason = 'Accepted Membership evidence does not identify the requested target subnet.';
        status({ work: 'settled', stage: 'Blocked', reason });
        unavailable(reason);
        reportContainer.append(styled('section', 'card', el('h3', 'Evidence'), sourceReceipts(live)));
        return;
      }
      current = mountReviewWorkspace({ live, contexts, map, mapHost, active, call: remote,
        progress: state => {
          if (!active()) return;
          status(state);
          if (['Blocked', 'Stopped', 'Provisional'].includes(state.stage)) {
            unavailable(state.reason);
            if (prior?.isConnected) prior.querySelector('h3').textContent = 'Previous accepted review · current verification unavailable';
          }
        }, performance: membershipPerformance, replay: reviewReplay, discovered: thisRequest.discovered, preferredSubnet,
        draftFor: connectedReview ? draftFor : undefined, rememberReview: connectedReview ? rememberReview : undefined });
      thisRequest.acceptActivity = current.acceptActivity;
      // Keep the previous result visible only while a matching executable proposal
      // is being recalculated. This snapshot can never supply a map, filter, or export.
      if (prior && recent.payloads.every((hash, i) => proposals[i] && hex(proposals[i].payload_hash) === hash)) {
        reportContainer.replaceChildren(prior, current.section);
      } else reportContainer.replaceChildren(current.section);
      current.start();
      void current.loadActivity();
    } catch (error) {
      if (!active() || thisRequest.stopped) return;
      if (prior?.isConnected) prior.querySelector('h3').textContent = 'Previous accepted review · current verification unavailable';
      map?.update(undefined, 'The map needs supported membership evidence for this review.');
      status({ work: 'settled', stage: 'Blocked', reason: error.message });
      reportContainer.append(action('Retry selected review', () => startReview(ids, discovered, preferredSubnet, hint)));
      unavailable(error.message);
    } finally {
      if (active() && thisRequest.stopped) {
        map?.update(undefined, 'Not loaded · Review stopped');
        status({ work: 'stopped', stage: 'Stopped' });
      }
    }
  })();
}

const switches = {
  proposal: document.querySelector('#proposal-view'),
  subnet: document.querySelector('#subnet-view'),
};
function changeView(view, focus = true, reset = false) {
  if (activeView === view && !reset) return;
  activeView = view;
  for (const [name, button] of Object.entries(switches)) button.setAttribute('aria-pressed', String(view === name));
  generation++;
  request = undefined;
  current?.session.stop();
  current?.dispose();
  currentMap?.dispose();
  current = currentMap = undefined;
  clearInterval(timer);
  timer = undefined;
  document.querySelector('main').append(performance.section);
  performance.visible(false);
  overview.clear();
  performance.scope(undefined);
  performance.useIndependent();
  reportContainer.replaceChildren();
  status({ work: 'settled' });
  elapsed.textContent = '';
  document.querySelector('#proposal-search').hidden = view !== 'proposal';
  document.querySelector('#subnet-overview').hidden = view !== 'subnet';
  if (focus) (view === 'proposal' ? search.elements.first : document.querySelector('#subnet-search input')).focus();
}
for (const [view, button] of Object.entries(switches)) button.addEventListener('click', () => changeView(view));

const independent = document.querySelector('#open-performance');
independent.addEventListener('click', () => {
  if (current) {
    current.openPerformance();
  } else {
    if (activeView === 'subnet') performance.useMembership();
    if (!performance.section.isConnected) document.querySelector('main').append(performance.section);
    performance.visible(true);
  }
  performance.section.scrollIntoView({ block: 'nearest' });
  performance.section.querySelector('h2').focus({ preventScroll: true });
});

function unavailable(reason) {
  publishEvidence(undefined, undefined, reason ?? 'Membership evidence is unavailable.');
}

if (widget) {
  document.body.classList.add('embedded', 'embed-' + widget.view);
  document.querySelector('.masthead').hidden = true;
  document.querySelector('#view-switch').hidden = true;
  if (inspectorWidget) {
    if (LOCAL_REPLICA) notice.textContent = 'Disposable rehearsal · fixture evidence, not live observations.';
    search.hidden = true;
    document.querySelector('#subnet-search').hidden = true;
    performance.visible(false);
    let subjectKey;
    acceptNexusHost(widget.host, (values, publish) => {
      const input = values.subject;
      let subject, issue;
      try {
        if (input?.kind === 'ready') subject = readInspectionSubject(input);
        if (input?.kind === 'unavailable') issue = input.reason;
      } catch (error) {
        issue = error.message;
      }
      const key = subject && JSON.stringify(subject);
      if (key && key === subjectKey) {
        publishScope = publish;
        if (latestOutputs) publish(latestOutputs);
        return;
      }
      subjectKey = key;
      publishScope = undefined;
      connectedEvidence = undefined;
      connectedFilter.value = 'membership-union';
      changeView(subject?.kind === 'subnet' ? 'subnet' : 'proposal', false, true);
      publishScope = publish;
      if (!subject) {
        reportStatus.textContent = issue ?? 'Select a proposal or subnet to inspect.';
        publishEvidence(undefined, undefined, issue);
        return;
      }
      const loading = { kind: 'loading', message: 'Resolving authoritative membership evidence' };
      publishOutputs({ scene: loading, filter: loading });
      if (subject.kind === 'subnet') overview.load(subject.subnet);
      else startReview(subject.proposalIds.map(BigInt), undefined, subject.subnet,
        activityHint(input, subject.proposalIds.length === 1 ? subject.proposalIds[0] : undefined));
    });
  } else if (widget.view === 'performance') {
    document.querySelector('#proposal-search').hidden = true;
    acceptNexusHost(widget.host, values => {
      const input = values.filter;
      let selection;
      try {
        if (input?.kind === 'ready') selection = readNodeFilter(input);
        performance.follow(selection, input?.kind === 'unavailable' ? input.reason : input?.message);
      } catch (error) {
        performance.follow(undefined, error.message);
      }
    });
  } else if (widget.view === 'subnet') {
    document.querySelector('#proposal-search').hidden = true;
    document.querySelector('#subnet-overview').hidden = false;
    document.querySelector('#subnet-search').hidden = true;
    performance.visible(false);
    acceptNexusHost(widget.host, (values, publish) => {
      publishScope = undefined;
      overview.clear();
      publishScope = publish;
      if (values.subnet?.kind !== 'ready') {
        publishEvidence(undefined, undefined, values.subnet?.reason);
        return;
      }
      if (!hasProfile(values.subnet, subnetInputProfile) || typeof values.subnet.value !== 'string') {
        unavailable('A subnet principal is required.');
        return;
      }
      overview.load(values.subnet.value);
    });
  } else {
    performance.visible(false);
    search.hidden = true;
    acceptNexusHost(widget.host, (values, publish) => {
      publishScope = undefined;
      generation++;
      current?.session.stop();
      current?.dispose();
      currentMap?.dispose();
      current = currentMap = undefined;
      reportContainer.replaceChildren();
      clearInterval(timer);
      timer = undefined;
      status({ work: 'settled' });
      publishScope = publish;
      const anchor = values.proposals;
      if (anchor?.kind !== 'ready') {
        reportStatus.textContent = 'Waiting for proposal IDs.';
        return;
      }
      try {
        if (!hasProfile(anchor, proposalInputProfile)
          || !Array.isArray(anchor.value) || anchor.value.length > 2 || anchor.value.some(id => typeof id !== 'string')) {
          throw new Error('The view must supply one or two proposal IDs.');
        }
        const input = proposalInput(anchor.value[0] ?? '', anchor.value[1] ?? '');
        [search.elements.first.value, search.elements.second.value = ''] = input.value;
        startReview(input.value.map(BigInt));
      } catch (error) {
        reportStatus.textContent = error.message;
        unavailable(error.message);
      }
    });
  }
}

if (testCases.length) {
  showTestCatalogue(testCases, bundledCase);
  if (bundledCase?.asset) {
    search.elements.first.value = bundledCase.proposalIds[0];
    search.elements.second.value = bundledCase.proposalIds[1] ?? '';
    search.elements.first.readOnly = true;
    search.elements.second.readOnly = true;
    if (bundledCase.proposalIds[1]) document.querySelector('#review-options').open = true;
    performance.visible(false);
  }
}

if (!widget && !bundledCase && !FIXTURE_REPLAY && !location.pathname.startsWith('/test-cases')) {
  const button = el('button', 'Subnet Activity');
  button.type = 'button';
  const narrow = matchMedia('(width < 68rem)');
  let listPosition, listScroll;
  const back = action('Back to subnet list', () => {
    layout.classList.remove('activity-inspecting');
    window.scrollTo(0, listPosition ?? 0);
    navigator.section.scrollTop = listScroll ?? 0;
    const target = navigator.section.querySelector('.activity-selection-focus') ?? button;
    target.focus({ preventScroll: true });
  });
  const navigator = mountActivityNavigator(remote, {
    open(id, subnet, observation) {
      changeView('proposal', false);
      search.elements.first.value = String(id);
      search.elements.second.value = '';
      startReview([id], observation, subnet);
    },
    inspectSubnet(subnet) {
      changeView('subnet', false);
      overview.load(subnet);
    },
    showReview() {
      if (!layout.classList.contains('activity-inspecting')) {
        listPosition = window.scrollY;
        listScroll = navigator.section.scrollTop;
      }
      layout.classList.add('activity-inspecting');
      if (narrow.matches) {
        back.focus({ preventScroll: true });
        window.scrollTo(0, layout.offsetTop);
      }
    },
    references: () => activeView === 'proposal' ? current?.references : undefined,
    refreshed(observation) {
      if (activeView !== 'proposal' || !request || request.stopped) return;
      if (!request.discovered || request.discovered.attempt < observation.attempt) request.discovered = observation;
      request.acceptActivity?.(observation);
    },
  });
  back.classList.add('activity-back');
  const searchShell = document.querySelector('#proposal-search');
  const reviewArea = styled('div', 'activity-review', back);
  const layout = styled('div', 'activity-layout', navigator.section, reviewArea);
  searchShell.before(layout);
  reviewArea.append(searchShell, reportContainer, document.querySelector('#subnet-overview'));
  document.querySelector('.masthead-row').append(button);
  button.addEventListener('click', () => {
    layout.classList.remove('activity-inspecting');
    navigator.show();
  });
}
