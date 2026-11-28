import { mountActivityNavigator } from './activity-navigator.js';
import { connect } from './client.js';
import { inspectionSubjectProfile } from './view-inputs.js';
import { styled } from './view.js';
import { acceptNexusHost } from './widget-frame.js';

let connection, selection, publish;
const navigator = mountActivityNavigator(async (active, run) => {
  connection ??= connect().catch(error => {
    connection = undefined;
    throw error;
  });
  const client = await connection;
  if (active()) return run(client);
}, {
  loadOnShow: false,
  open(id, subnet) {
    choose({ kind: 'proposals', proposalIds: [String(id)], ...(subnet && { subnet }) });
  },
  inspectSubnet(subnet) {
    choose({ kind: 'subnet', subnet });
  },
});

function choose(value) {
  selection = { kind: 'ready', profile: inspectionSubjectProfile, value, revision: JSON.stringify(value) };
  publish?.({ subject: selection });
}

const main = document.querySelector('main');
if (LOCAL_REPLICA) main.append(styled('p', 'local-note', 'Disposable rehearsal · fixture discovery, not live Governance.'));
main.append(navigator.section);
acceptNexusHost(EMBED_WIDGET.host, (_, output) => {
  publish = output;
  if (selection) publish({ subject: selection });
  if (navigator.section.hidden) navigator.show();
});
