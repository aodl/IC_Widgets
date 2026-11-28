import { Principal } from '@icp-sdk/core/principal';
import { comparisonFilterLabels, maxFilterSize, performanceNodes } from './composed-scope.js';
import { liveError, result } from './client.js';
import { nodeSelectionProfile } from './node-snapshot.js';
import { el, number, principal, renderPerformance, sourceReceipts } from './view.js';

export function mountPerformance(call, { connected = false } = {}) {
  const section = document.querySelector('#performance');
  const form = document.querySelector('#performance-form');
  const submit = form.querySelector('button');
  const subnetField = form.elements.subnet;
  const status = document.querySelector('#performance-status');
  const output = document.querySelector('#performance-result');
  const summary = document.querySelector('#performance-context');
  const mode = document.querySelector('#performance-mode');
  const choices = document.querySelector('#performance-presets');
  const preset = document.querySelector('#performance-preset');
  let selection;
  let generation = 0;
  let following = connected;
  let scopeKey;
  let cancelDelay;
  const observations = new Map();
  const freshFor = 120_000;
  const nodeIds = () => connected ? selection?.nodeIds : performanceNodes(selection, preset.value);
  preset.replaceChildren(...Object.entries(comparisonFilterLabels).map(([value, label]) =>
    Object.assign(el('option', label), { value })));

  function applyScope() {
    generation++;
    cancelDelay?.();
    output.replaceChildren();
    if (following) subnetField.value = selection?.subnet ?? '';
    subnetField.readOnly = following;
    choices.hidden = connected || !following || selection?.kind === 'existing';
    const nodes = following ? nodeIds() : undefined;
    const scope = following && selection ? ' · ' + (comparisonFilterLabels[connected ? selection.scope : preset.value] ?? 'Existing') : '';
    summary.textContent = !following ? 'Independent subnet scope.' : !selection ? 'Waiting for resolved membership evidence.'
      : selection.label + scope + ' · Registry ' + number(BigInt(selection.registryVersion)) + ' · ' + number(nodes.length)
        + (nodes.length === 1 ? ' node.' : ' nodes.');
    submit.disabled = following && (!nodes?.length || nodes.length > maxFilterSize);
    submit.textContent = 'Read blockmaking samples';
    status.textContent = nodes?.length > maxFilterSize ? 'This finite filter exceeds 256 nodes. Select a narrower scope.' : submit.disabled ? (connected ? (selection ? 'The connected filter is empty.' : '')
      : 'Choose a populated membership filter or use independent scope.') : '';
  }

  mode.addEventListener('change', () => {
    if (connected) return;
    following = mode.value === 'follow';
    applyScope();
  });
  preset.addEventListener('change', applyScope);
  subnetField.addEventListener('input', applyScope);
  form.elements.days.addEventListener('input', applyScope);

  submit.addEventListener('click', () => void readPerformance());
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    void readPerformance();
  });

  function pause(delay) {
    return new Promise(resolve => {
      const timer = setTimeout(done, delay);
      function done() {
        clearTimeout(timer);
        cancelDelay = undefined;
        resolve();
      }
      cancelDelay = done;
    });
  }

  function display(data, filter) {
    status.textContent = 'Err' in data.outcome ? liveError(data.outcome.Err) : '';
    if ('Ok' in data.outcome) renderPerformance(data.outcome.Ok, filter, output);
    output.append(sourceReceipts(data));
  }

  async function readPerformance(automatic = false) {
    if (submit.disabled || !form.reportValidity()) return;
    const ticket = ++generation;
    const active = () => ticket === generation;
    output.replaceChildren();
    submit.disabled = true;
    try {
      const filter = following ? nodeIds()?.map(id => Principal.fromText(id)) : undefined;
      if (following && !filter?.length) return;
      const subnet = Principal.fromText(following ? selection.subnet : subnetField.value.trim());
      const days = form.elements.days.valueAsNumber;
      const key = JSON.stringify([subnet.toText(), days, filter?.map(id => id.toText()).sort()]);
      const previous = observations.get(key);
      if (automatic && previous && Date.now() - previous.observed < freshFor) {
        display(previous.data, filter);
        return;
      }
      const start = BigInt(Date.now() - days * 86_400_000) * 1_000_000n;
      status.textContent = 'Waiting for the review’s source calls to settle…';
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await call(active, client => {
          status.textContent = 'Reading blockmaking evidence…';
          return client.node_performance_on_demand(subnet, start, filter ? [filter] : []);
        });
        if (!active() || !response) return;
        if (response.Err === 'another on-demand request is running') {
          if (attempt === 0) {
            status.textContent = 'Performance is waiting while the reviewer handles another request. Retrying shortly…';
            await pause(4000);
            if (!active()) return;
            continue;
          }
          status.textContent = 'Performance is temporarily unavailable because the reviewer is busy. You can retry this filter.';
          submit.textContent = 'Retry blockmaking samples';
          return;
        }
        const data = result(response);
        if ('Ok' in data.outcome) {
          observations.delete(key);
          observations.set(key, { observed: Date.now(), data });
          while (observations.size > 4) observations.delete(observations.keys().next().value);
          submit.textContent = 'Refresh blockmaking samples';
        } else submit.textContent = 'Retry blockmaking samples';
        display(data, filter);
        return;
      }
    } catch (error) {
      if (active()) {
        status.textContent = error.message;
        submit.textContent = 'Retry blockmaking samples';
      }
    } finally {
      if (active()) submit.disabled = false;
    }
  }

  if (connected) {
    mode.value = 'follow';
    mode.closest('label').hidden = true;
    applyScope();
  }
  return {
    section,
    visible(show) { section.hidden = !show; },
    useIndependent() {
      if (connected || !following) return;
      following = false;
      mode.value = 'independent';
      subnetField.value = '';
      applyScope();
    },
    useMembership() {
      if (following) return;
      following = true;
      mode.value = 'follow';
      applyScope();
    },
    follow(next, issue) {
      const key = JSON.stringify([next, issue]);
      if (key === scopeKey) return;
      scopeKey = key;
      selection = next;
      applyScope();
      if (issue) status.textContent = issue;
      if (selection) void readPerformance(true);
    },
    scope(next) {
      if (next && (next.profile.id !== nodeSelectionProfile.id || next.profile.major !== nodeSelectionProfile.major)) {
        throw new Error('Unsupported node selection profile.');
      }
      selection = next;
      applyScope();
    },
  };
}
