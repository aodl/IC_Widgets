import { Principal } from '@icp-sdk/core/principal';
import { liveError, result } from './client.js';
import { scenarioName } from './detail-model.js';
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
  let review;
  let generation = 0;
  let following = false;

  function presetNodes() {
    const { context, scope } = review;
    return ({
      incoming: context.state.added,
      outgoing: context.state.removed,
      selected: context.state.members,
      affected: scope?.nodes,
    })[preset.value];
  }

  function applyScope() {
    generation++;
    output.replaceChildren();
    const nodes = following && review ? presetNodes() : undefined;
    if (following && review) subnetField.value = principal(review.context.subnet);
    subnetField.readOnly = following;
    choices.hidden = !following;
    const affected = preset.querySelector('[value=affected]');
    affected.disabled = following && !review?.scope?.nodes.length;
    if (affected.disabled && preset.value === 'affected') preset.value = 'selected';
    summary.textContent = !following ? 'Independent subnet scope.' : !review ? 'Following review. Waiting for a resolved membership state.'
      : scenarioName(review.context.scenario) + ' · ' + (review.context.index ? 'After #' + review.context.scenario.steps[review.context.index - 1].proposal : 'Baseline')
        + ' · Registry ' + number(review.version) + ' · ' + number((nodes ?? presetNodes())?.length ?? 0) + ' nodes.';
    submit.disabled = following && (!review || !presetNodes()?.length);
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
    const filter = following ? presetNodes() : undefined;
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
      review = next;
      if (following) applyScope();
    },
  };
}
