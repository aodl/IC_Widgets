import { readMapScene } from './composed-scope.js';
import { nodeMap } from './map-interaction.js';
import { number } from './view.js';
import { acceptNexusHost } from './widget-frame.js';

const host = document.querySelector('main');
const status = document.querySelector('#map-widget-status');
let map, kind;
acceptNexusHost(EMBED_WIDGET.host, ({ scene }) => {
  try {
    if (scene?.kind !== 'ready') {
      clear(scene?.reason ?? 'Waiting for resolved map evidence.');
      return;
    }
    const value = readMapScene(scene);
    if (kind !== value.kind) {
      map?.dispose();
      kind = value.kind;
      map = nodeMap({ existing: kind === 'existing' });
      host.replaceChildren(status, map.section);
    }
    status.textContent = value.label + ' · Registry ' + number(BigInt(value.registryVersion));
    map.update({ key: [value.subnet, value.kind, scene.revision].join('/'), members: value.members, countries: value.countries });
  } catch (error) {
    clear(error.message);
  }
});

function clear(message) {
  map?.dispose();
  map = kind = undefined;
  host.replaceChildren(status);
  status.textContent = message;
}
