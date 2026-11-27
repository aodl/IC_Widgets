import { Principal } from '@icp-sdk/core/principal';
import { dashboardLink } from './dashboard.js';
import { liveError, result } from './client.js';
import { nodeMap } from './map-interaction.js';
import { subnetSnapshot } from './node-snapshot.js';
import { subnetInput } from './view-inputs.js';
import { el, number, sourceReceipts, styled, time } from './view.js';

export function mountSubnetOverview({ call, performance, replay, publish }) {
  const form = document.querySelector('#subnet-search');
  const host = document.querySelector('#subnet-result');
  const status = document.querySelector('#subnet-status');
  const field = form.elements.subnet;
  let generation = 0;
  let map;
  let pending;

  function invalidate() {
    ++generation;
    map?.dispose();
    map = undefined;
    host.replaceChildren();
    status.textContent = '';
    if (publish) publish();
    else performance.scope(undefined);
  }

  field.addEventListener('input', invalidate);
  form.addEventListener('submit', event => {
    event.preventDefault();
    load(field.value);
  });

  function load(value) {
    invalidate();
    let input;
    try {
      input = subnetInput(value);
    } catch (error) {
      status.textContent = error.message;
      publish?.(undefined, undefined, error.message);
      return;
    }
    const ticket = generation;
    const active = () => ticket === generation;
    status.textContent = 'Reading the pinned Registry membership and registered locations…';
    pending = (async () => {
      try {
        const reply = await call(active, client => client.subnet_snapshot_on_demand(Principal.fromText(input.value)));
        if (!active() || !reply) return;
        const response = result(reply);
        if ('Err' in response.outcome) {
          status.textContent = liveError(response.outcome.Err);
          host.replaceChildren(sourceReceipts(response, { replay: !!replay }));
          publish?.(undefined, undefined, status.textContent);
          return;
        }
        const { selection, members, countries, version } = subnetSnapshot(response, replay);
        if (selection.subnet !== input.value) throw new Error('The subnet response does not match the requested principal.');
        const clock = time(response.usage.finished_at);
        const detail = replay
          ? 'Historical replay · locally observed ' + clock
          : 'Registry evidence observed ' + clock;
        if (!publish) map = nodeMap({ existing: true });
        host.replaceChildren(styled('section', 'map-card',
          el('h2', 'Subnet ', dashboardLink('subnet', selection.subnet)),
          el('p', number(members.length) + ' members · Registry ' + number(version)),
          el('p', detail), map?.section, sourceReceipts(response, { replay: !!replay })));
        map?.update({ key: selection.revision, members, countries });
        if (publish) publish(selection, { members, countries });
        else performance.scope(selection);
        status.textContent = 'Subnet loaded.';
      } catch (error) {
        if (active()) {
          status.textContent = error.message;
          publish?.(undefined, undefined, error.message);
        }
      }
    })();
  }
  return { clear: invalidate, load, settled: () => pending };
}
