import { Principal } from '@icp-sdk/core/principal';
import { liveError, result } from './client.js';
import { number, principal, renderPerformance, scenarioLabel, sourceReceipts } from './view.js';

export function mountPerformance(getActor) {
  const form = document.querySelector('#performance-form');
  const submit = form.querySelector('button');
  const subnetField = form.elements.subnet;
  const status = document.querySelector('#performance-status');
  const output = document.querySelector('#performance-result');
  const context = document.querySelector('#performance-context');
  const clear = document.querySelector('#clear-performance-context');
  let scope;
  let generation = 0;

  function reset() {
    generation++;
    output.replaceChildren();
    status.textContent = '';
  }

  function clearScope() {
    reset();
    scope = undefined;
    context.hidden = true;
    clear.hidden = true;
  }

  clear.addEventListener('click', clearScope);
  subnetField.addEventListener('input', clearScope);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    reset();
    const ticket = generation;
    const filter = scope?.nodes;
    submit.disabled = true;
    try {
      const subnet = Principal.fromText(subnetField.value.trim());
      const days = form.elements.days.valueAsNumber;
      const start = BigInt(Date.now() - days * 86_400_000) * 1_000_000n;
      status.textContent = 'Reading blockmaking evidence…';
      const data = result(await (await getActor()).node_performance_on_demand(
        subnet, start, filter ? [filter] : [],
      ));
      if (ticket !== generation) return;
      if ('Err' in data.outcome) {
        status.textContent = liveError(data.outcome.Err);
        output.append(sourceReceipts(data));
        return;
      }
      status.textContent = '';
      renderPerformance(data.outcome.Ok, filter, output);
      output.append(sourceReceipts(data));
    } catch (error) {
      if (ticket === generation) status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  return (selection, version) => {
    reset();
    scope = selection;
    subnetField.value = principal(selection.subnet);
    context.textContent = `Filtered to ${number(selection.nodes.length)} nodes · ${scenarioLabel(selection.scenario)} · Registry ${number(version)}.`;
    context.hidden = false;
    clear.hidden = false;
    subnetField.focus();
  };
}
