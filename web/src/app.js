import { connect, identity, liveError, result } from './client.js';
import { mountReviewWorkspace } from './membership-details.js';
import { mountPerformance } from './performance.js';
import { reviewMap } from './review-map.js';
import { reviewContexts, serializeCalls } from './review-session.js';
import { el, option, sourceReceipts, styled } from './view.js';

const search = document.querySelector('#search');
const reportStatus = document.querySelector('#report-status');
const elapsed = document.querySelector('#review-elapsed');
const stop = document.querySelector('#stop-review');
const reportContainer = document.querySelector('#report');
const access = document.querySelector('#pilot-access');
document.querySelector('#local-notice').hidden = !LOCAL_REPLICA;
const browserPrincipal = document.querySelector('#browser-principal');
browserPrincipal.textContent = identity.getPrincipal().toText();
document.querySelector('#copy-principal').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(browserPrincipal.textContent);
    document.querySelector('#access-status').textContent = 'Principal copied.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(browserPrincipal);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#access-status').textContent = 'Principal selected for copying.';
  }
});

let generation = 0;
let connection;
let current;
let previewTask;
let timer;
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

function status(message, working = false, error = false) {
  if (reportStatus.textContent !== message) reportStatus.textContent = message;
  reportStatus.classList.toggle('error', error);
  stop.hidden = !working;
  if (working && timer === undefined) {
    const began = Date.now();
    const tick = () => { elapsed.textContent = Math.floor((Date.now() - began) / 1000) + ' s elapsed'; };
    tick();
    timer = setInterval(tick, 1000);
  }
  if (!working && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

function idsForSearch() {
  const ids = [...new FormData(search).values()].map(value => value.trim()).filter(Boolean).map(BigInt);
  if (!ids.length || ids.some(id => id < 1n || id > 18_446_744_073_709_551_615n)
    || new Set(ids).size !== ids.length) {
    throw new Error('Choose one or two distinct positive proposal IDs.');
  }
  return ids;
}

stop.addEventListener('click', () => {
  if (current) current.session.stop();
  else generation++;
  status('Review stopped. Any accepted call can finish before the next request.');
});

search.addEventListener('submit', event => {
  event.preventDefault();
  let ids;
  try {
    ids = idsForSearch();
  } catch (error) {
    status(error.message, false, true);
    return;
  }
  const ticket = ++generation;
  const active = () => generation === ticket;
  current?.session.stop();
  current = undefined;
  performance.scope(undefined);
  performance.visible(false);
  const map = reviewMap((...args) => current?.inspect(...args), active);
  const mapHost = map.section;
  map.update();
  reportContainer.replaceChildren(styled('div', 'workspace waiting-workspace',
    styled('section', 'review-header', el('h2', ids.length === 1 ? 'Proposal #' + ids[0] : 'Proposals ' + ids.map(id => '#' + id).join(' + '))),
    styled('div', 'review-grid', styled('div', 'map-card', mapHost))));
  clearInterval(timer);
  timer = undefined;
  status('Reading proposal and membership…', true);
  previewTask = (async () => {
    try {
      const response = await remote(active, client => client.review_on_demand(ids));
      if (!active() || !response) return;
      const live = result(response);
      if ('Err' in live.outcome) {
        status('Simulation unavailable. ' + liveError(live.outcome.Err), false, true);
        map.update(undefined, [], 'The map needs supported membership evidence for this review.');
        reportContainer.append(styled('section', 'card', el('h3', 'Evidence'), sourceReceipts(live)));
        return;
      }
      const body = live.outcome.Ok;
      const contexts = reviewContexts(body.report, option(body.subnet_rules ?? []) ?? []);
      const phase = (message, working) => {
        if (active()) status(message, working ?? /^(Reading|Membership available|Checking)|comparing proposal orders/.test(message));
      };
      current = mountReviewWorkspace({ live, contexts, map, mapHost, active, call: remote,
        phase, performance, local: LOCAL_REPLICA });
      reportContainer.replaceChildren(current.section);
      current.start();
    } catch (error) {
      if (!active()) return;
      map.update(undefined, [], 'The map needs supported membership evidence for this review.');
      if (/authorized principal/.test(error.message)) {
        access.open = true;
        status('Pilot authorization required. Share the browser principal in Pilot access, then select Review again.', false, true);
      } else status(error.message, false, true);
    }
  })();
});

const independent = document.querySelector('#open-performance');
independent.addEventListener('click', () => {
  if (current) {
    current.section.querySelector('.review-nav').lastElementChild.click();
  } else {
    if (!performance.section.isConnected) document.querySelector('main').append(performance.section);
    performance.visible(true);
  }
  performance.section.scrollIntoView({ block: 'nearest' });
  performance.section.querySelector('h2').focus({ preventScroll: true });
});
