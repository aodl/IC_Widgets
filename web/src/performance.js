import { Principal } from '@icp-sdk/core/principal';
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
  const nodeIds = () => connected ? selection?.nodeIds
    : selection?.nodes[selection.kind === 'existing' ? 'selected' : preset.value];

  function applyScope() {
    generation++;
    output.replaceChildren();
    if (following && selection) subnetField.value = selection.subnet;
    subnetField.readOnly = following;
    choices.hidden = connected || !following || selection?.kind === 'existing';
    const nodes = following ? nodeIds() : undefined;
    const scope = connected && selection?.scope === 'proposed-membership' ? ' · Proposed members'
      : connected && selection?.scope === 'existing-membership' ? ' · Existing members' : '';
    summary.textContent = !following ? 'Independent subnet scope.' : !selection ? 'Waiting for resolved membership evidence.'
      : selection.label + scope + ' · Registry ' + number(BigInt(selection.registryVersion)) + ' · ' + number(nodes.length)
        + (nodes.length === 1 ? ' node.' : ' nodes.');
    submit.disabled = following && !nodes?.length;
    status.textContent = submit.disabled ? (connected ? (selection ? 'The connected filter is empty.' : '')
      : 'Choose a populated membership filter or use independent scope.') : '';
  }

  mode.addEventListener('change', () => {
    if (connected) return;
    following = mode.value === 'follow';
    applyScope();
  });
  preset.addEventListener('change', applyScope);
  subnetField.addEventListener('input', applyScope);

  form.addEventListener('submit', event => {
    event.preventDefault();
    readPerformance();
  });

  async function readPerformance() {
    if (submit.disabled || !form.checkValidity()) return;
    const ticket = ++generation;
    const filter = following ? nodeIds()?.map(id => Principal.fromText(id)) : undefined;
    if (following && !filter?.length) return;
    output.replaceChildren();
    submit.disabled = true;
    try {
      const subnet = Principal.fromText(following ? selection.subnet : subnetField.value.trim());
      const days = form.elements.days.valueAsNumber;
      const start = BigInt(Date.now() - days * 86_400_000) * 1_000_000n;
      status.textContent = 'Waiting for the review’s source calls to settle…';
      const response = await call(() => ticket === generation, client => {
        status.textContent = 'Reading blockmaking evidence…';
        return client.node_performance_on_demand(subnet, start, filter ? [filter] : []);
      });
      if (ticket !== generation || !response) return;
      const data = result(response);
      status.textContent = 'Err' in data.outcome ? liveError(data.outcome.Err) : '';
      if ('Ok' in data.outcome) renderPerformance(data.outcome.Ok, filter, output);
      output.append(sourceReceipts(data));
    } catch (error) {
      if (ticket === generation) status.textContent = error.message;
    } finally {
      if (ticket === generation) submit.disabled = false;
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
    follow(next, issue) {
      selection = next;
      applyScope();
      if (issue) status.textContent = issue;
      readPerformance();
    },
    scope(next) {
      if (next && (next.profile.id !== nodeSelectionProfile.id || next.profile.major !== nodeSelectionProfile.major)) {
        throw new Error('Unsupported node selection profile.');
      }
      selection = next;
      if (following) applyScope();
    },
  };
}
