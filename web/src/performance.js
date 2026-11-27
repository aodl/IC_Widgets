import { Principal } from '@icp-sdk/core/principal';
import { liveError, result } from './client.js';
import { nodeSelectionProfile } from './node-snapshot.js';
import { el, number, principal, renderPerformance, sourceReceipts } from './view.js';

export function mountPerformance(call) {
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
  let following = false;

  function applyScope() {
    generation++;
    output.replaceChildren();
    if (following && selection) subnetField.value = selection.subnet;
    subnetField.readOnly = following;
    choices.hidden = !following || selection?.kind === 'existing';
    for (const option of preset.options) {
      option.disabled = option.value !== 'selected' && !selection?.nodes[option.value].length;
    }
    if (preset.selectedOptions[0]?.disabled) preset.value = 'selected';
    const nodes = following && selection ? selection.nodes[preset.value] : undefined;
    summary.textContent = !following ? 'Independent subnet scope.' : !selection ? 'Waiting for resolved membership evidence.'
      : selection.label + ' · Registry ' + number(BigInt(selection.registryVersion)) + ' · ' + number(nodes.length)
        + (nodes.length === 1 ? ' node.' : ' nodes.');
    submit.disabled = following && !nodes?.length;
    status.textContent = submit.disabled ? 'Choose a populated membership filter or use independent scope.' : '';
  }

  mode.addEventListener('change', () => {
    following = mode.value === 'follow';
    applyScope();
  });
  preset.addEventListener('change', applyScope);
  subnetField.addEventListener('input', applyScope);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const ticket = ++generation;
    const filter = following ? selection.nodes[preset.value].map(id => Principal.fromText(id)) : undefined;
    output.replaceChildren();
    submit.disabled = true;
    try {
      const subnet = Principal.fromText(subnetField.value.trim());
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
  });

  return {
    section,
    visible(show) { section.hidden = !show; },
    scope(next) {
      if (next && (next.profile.id !== nodeSelectionProfile.id || next.profile.major !== nodeSelectionProfile.major)) {
        throw new Error('Unsupported node selection profile.');
      }
      selection = next;
      if (following) applyScope();
    },
  };
}
