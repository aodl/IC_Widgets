import { cachedActivity, readActivity } from './activity-cache.js';
import { mountActivityNavigator } from './activity-navigator.js';
import { connect } from './client.js';
import { inspectionSubjectProfile } from './view-inputs.js';
import { option, styled } from './view.js';
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
  initial: cachedActivity(),
  read: readActivity,
  open(id, subnet, _, row) {
    const deadline = option(row.deadline);
    choose({ kind: 'proposals', proposalIds: [String(id)], ...(subnet && { subnet }) }, {
      proposal: String(id),
      title: (option(row.title) ?? '').slice(0, 400),
      observed: String(row.observed_at),
      ...(deadline && { deadline: String(deadline) }),
    });
  },
  inspectSubnet(subnet) {
    choose({ kind: 'subnet', subnet });
  },
});

function choose(value, display) {
  selection = { kind: 'ready', profile: inspectionSubjectProfile, value, revision: JSON.stringify(value),
    ...(display && { display }) };
  publish?.({ subject: selection });
}

document.body.classList.add('embedded', 'embed-activity');
const main = document.querySelector('main');
if (LOCAL_REPLICA) main.append(styled('p', 'local-note', 'Disposable rehearsal · fixture discovery, not live Governance.'));
main.append(navigator.section);
acceptNexusHost(EMBED_WIDGET.host, (_, output) => {
  publish = output;
  if (selection) publish({ subject: selection });
  if (navigator.section.hidden) navigator.show();
});
