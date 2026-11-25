import { compareMembership, liveError, result } from './client.js';
import { calculationNote, geographyNote, reviewModel, thresholdNote } from './detail-model.js';
import { reviewMap } from './review-map.js';
import { reviewMarkdown } from './review-markdown.js';
import { branch, el, option, principal, sourceReceipts, styled, table } from './view.js';

const PAGE = 24;
const emptyEvidence = () => ({ Nodes: new Map(), Operators: new Map(), DataCenters: new Map() });

function button(label, listener) {
  const node = el('button', label);
  node.type = 'button';
  node.addEventListener('click', listener);
  return node;
}

function link(cell) {
  if (!cell || typeof cell !== 'object') return cell;
  const anchor = el('a', cell.label);
  anchor.href = cell.url;
  return anchor;
}

function renderTable(model) {
  return model.rows.length ? table(model.headers, model.rows.map(row => row.map(link))) : el('p', 'None.');
}

function disclose(label, ...children) {
  return el('details', el('summary', label), ...children);
}

function saveFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = el('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function markdownEditor(model, draft, context) {
  const vote = el('input');
  vote.value = draft.vote ?? '?';
  const tldr = el('textarea');
  tldr.rows = 3;
  tldr.value = draft.tldr ?? '';
  const mapImage = el('input');
  mapImage.type = 'url';
  const inputHash = model.calculation?.inputHash;
  mapImage.disabled = !inputHash;
  mapImage.value = inputHash && context.mapImage?.inputHash === inputHash ? context.mapImage.url : '';
  const previewVote = el('p');
  const previewTldr = el('p');
  const raw = el('textarea');
  raw.readOnly = true;
  raw.rows = 12;
  raw.setAttribute('aria-label', 'Generated Markdown');
  const status = styled('p', 'status');
  status.setAttribute('role', 'status');
  function update() {
    Object.assign(draft, { vote: vote.value, tldr: tldr.value });
    if (inputHash) context.mapImage = { inputHash, url: mapImage.value };
    raw.value = reviewMarkdown(model, { ...draft, mapImage: mapImage.value });
    previewVote.replaceChildren(el('strong', 'VOTE'), ' ' + (vote.value.trim() || '?'));
    previewTldr.replaceChildren(el('strong', 'TLDR'), ' ' + tldr.value.trim());
  }
  for (const input of [vote, tldr, mapImage]) input.addEventListener('input', update);
  update();

  const preview = styled('article', 'markdown-preview', el('h4', 'Proposal ' + model.ids.map(id => '#' + id).join(' + ') + ' Review'),
    previewVote, previewTldr, el('p', model.membership), el('p', link(model.subnetLink), ' · Registry ' + model.version),
    el('ul', [...model.consequences, ...model.notes].map(note => el('li', note))),
    model.tables.map(row => disclose(row.title, renderTable(row))),
    model.dimensions.map(row => disclose(row.label + ' distribution', el('p', row.note), renderTable(row.table))),
    el('p', 'Use the exported PNG and the forum’s image upload to include the map.'));
  return styled('section', 'detail-section', el('h3', 'Review Markdown'),
    styled('div', 'markdown-fields', el('label', 'VOTE', vote), el('label', 'TLDR', tldr),
      el('label', 'Uploaded map image URL (optional)', mapImage)),
    styled('div', 'actions', button('Copy Markdown', async event => {
      const copyButton = event.currentTarget;
      try {
        await navigator.clipboard.writeText(raw.value);
        status.textContent = 'Review Markdown copied.';
      } catch {
        const source = raw.closest('details');
        const wasOpen = source.open;
        source.open = true;
        raw.focus();
        raw.select();
        if (document.execCommand('copy')) {
          source.open = wasOpen;
          copyButton.focus();
          status.textContent = 'Review Markdown copied.';
        } else {
          status.textContent = 'Select and copy the generated Markdown from the field.';
        }
      }
    }), button('Download Markdown', () => saveFile('proposal-' + model.ids.join('-') + '-review.md', raw.value, 'text/markdown;charset=utf-8'))),
    status, disclose('Review preview', preview), disclose('Generated Markdown source', raw));
}

function describeClaims(claim) {
  return disclose('Proposer statement for #' + claim.id,
    claim.title ? el('p', el('strong', claim.title)) : null,
    el('p', 'The statement comes from the observed Governance proposal. Health and decommissioning remain proposer claims. The comparison uses Registry labels and the one-third threshold. Where shown, the aggregate tests node operator as the sixth dimension.'),
    claim.truncated ? el('p', 'The statement excerpt is truncated.') : null,
    styled('pre', 'claim-text', claim.summary));
}

function showComparison(container, model, draft, context, comparisonReady) {
  const comparison = model.tables.find(row => row.title === 'Decentralisation and concentration');
  const distances = model.tables.find(row => row.title === 'Geographic distances');
  const claims = model.tables.find(row => row.title === 'Proposer claims and independent calculation');
  container.replaceChildren(
    el('p', el('strong', model.membership), ' · ', link(model.subnetLink)),
    model.consequences.length ? styled('div', 'notice', el('h4', 'What changes'),
      el('ul', model.consequences.map(note => el('li', note)))) : null,
    comparison ? styled('section', 'detail-section', el('h3', comparison.title), el('p', thresholdNote),
      renderTable(comparison), model.dimensions.map(row => disclose(row.label + ' distribution', el('p', row.note), renderTable(row.table)))) : null,
    distances ? styled('section', 'detail-section', el('h3', distances.title), el('p', geographyNote), renderTable(distances)) : null,
    claims ? styled('section', 'detail-section', el('h3', claims.title), renderTable(claims)) : null,
    model.claim ? describeClaims(model.claim) : null,
    comparisonReady ? reviewMap(model) : null,
    disclose('Member records and registration', model.notes.filter(note => note.startsWith('Subnet type ')).map(note => el('p', note)),
      ...model.tables.filter(row => row.title.endsWith(' nodes')).map(row => disclose(row.title + ' (' + row.rows.length + ')', renderTable(row)))),
    markdownEditor(model, draft, context),
  );
}

// Request-local browser state indexed by the selected comparison. It is discarded
// on a new preview, and no stale response may update another scenario.
export function mountMembershipDetails(actor, live, localReplica) {
  const section = styled('section', 'card', el('h2', 'Detailed consequences'));
  const status = styled('p', 'status');
  status.setAttribute('role', 'status');
  const output = el('div');
  const progress = el('progress');
  progress.setAttribute('aria-label', 'Detailed Registry reads');
  progress.hidden = true;
  const advanced = disclose('Advanced detailed source evidence');
  advanced.hidden = true;
  let selected;
  let running;
  const states = new Map();
  const draft = {};
  const version = live.outcome.Ok.report.manifest.registry_version;
  const load = button('Load detailed analysis', start);
  load.className = 'primary';
  section.append(el('p', 'Read node registrations, operators and data centers at the preview’s pinned Registry version. The membership preview is available while these reads run.'),
    load, status, progress, output, advanced);

  function active(context) {
    return section.isConnected && selected === context;
  }

  async function readStage(client, context, type, ids) {
    const map = context.evidence[type];
    const unique = [...new Map(ids.map(id => [id.toText?.() ?? id, id])).entries()];
    const remaining = unique.filter(([key]) => !map.has(key) || 'Unavailable' in map.get(key)[1]);
    for (let offset = 0; offset < remaining.length; offset += PAGE) {
      if (!active(context)) return;
      const page = remaining.slice(offset, offset + PAGE);
      status.textContent = type + ' · ' + (offset + 1) + '–' + (offset + page.length) + ' of ' + remaining.length + ' records';
      try {
        const response = result(await client.membership_detail_page(version, { [type]: page.map(([, id]) => id) }));
        context.receipts.push([type, response]);
        if ('Err' in response.outcome) throw new Error(liveError(response.outcome.Err));
        const records = response.outcome.Ok[type];
        if (option(response.registry_version) !== version || records?.length !== page.length) {
          throw new Error('Source page does not match the selected snapshot.');
        }
        for (const record of records) {
          const stamp = record.Present?.stamp ?? record.Deleted ?? option(record.Unavailable?.stamp ?? []);
          if (stamp && stamp.mutation_version > version) throw new Error('A record is newer than the pinned version.');
        }
        page.forEach(([key, id], index) => map.set(key, [id, records[index]]));
        const unavailable = records.filter(record => 'Unavailable' in record).length;
        if (unavailable) context.failures.push(type + ' · ' + unavailable + ' records unavailable in page ' + (Math.floor(offset / PAGE) + 1));
      } catch (error) {
        context.failures.push(type + ' page ' + (Math.floor(offset / PAGE) + 1) + ' · ' + error.message);
      }
    }
  }

  async function calculate(client, context) {
    if (active(context)) status.textContent = 'Waiting for the replicated comparison…';
    const { before, state, rules, scenario, subnet } = context;
    const evidence = {
      Nodes: new Map(context.evidence.Nodes),
      Operators: new Map(context.evidence.Operators),
      DataCenters: new Map(context.evidence.DataCenters),
    };
    const calculated = await compareMembership(client, {
      registry_version: version,
      preview_revision: live.outcome.Ok.report.revision,
      subnet: scenario.subnets.find(([id]) => principal(id) === subnet)[0],
      before: before.members, after: state.members, kind: rules.kind,
      nodes: [...evidence.Nodes.values()], operators: [...evidence.Operators.values()],
      data_centers: [...evidence.DataCenters.values()],
    });
    context.calculation = { ...calculated, evidence };
  }

  async function start() {
    if (!selected || running || !selected.rules) return;
    const context = selected;
    running = context;
    context.failures = [];
    refreshStatus();
    try {
      const client = await actor();
      const { evidence, before, state } = context;
      await readStage(client, context, 'Nodes', [...before.members, ...state.members]);
      if (!active(context)) return;
      const operators = [...evidence.Nodes.values()].flatMap(([, row]) => row.Present?.value.operator ?? []);
      await readStage(client, context, 'Operators', operators);
      if (!active(context)) return;
      const centers = [...evidence.Operators.values()].map(([, row]) => row.Present?.value.data_center.toLowerCase())
        .filter(id => id && new TextEncoder().encode(id).length <= 128);
      // Publish the non-geographic grouping before waiting for the optional DC stage.
      await calculate(client, context);
      if (!active(context)) return;
      if (centers.length) {
        refresh();
        await readStage(client, context, 'DataCenters', centers);
        if (!active(context)) return;
        await calculate(client, context);
      }
      context.done = true;
    } catch (error) {
      context.failures.push(error.message);
    } finally {
      running = undefined;
      if (section.isConnected) refresh();
    }
  }

  function refreshStatus() {
    const waiting = Boolean(running);
    load.disabled = waiting || !selected?.rules;
    load.hidden = !selected || (selected.done && !selected.failures.length);
    load.textContent = selected?.failures.length ? 'Retry unavailable detailed reads' : 'Load detailed analysis';
    progress.hidden = !waiting;
    if (waiting) status.textContent = running === selected ? 'Reading pinned Registry evidence…' : 'Waiting for the previous page to finish.';
    else if (selected?.failures.length) status.textContent = selected.failures.join(' · ');
    else if (selected?.done) status.textContent = 'Detailed analysis loaded. Coverage is reported for each dimension.';
    else if (selected && !selected.rules) status.textContent = 'This preview did not supply the pinned subnet settings needed for the detailed analysis.';
    else status.textContent = '';
  }

  function refresh() {
    refreshStatus();
    const calculation = selected?.calculation;
    advanced.hidden = !selected?.receipts.length && !calculation;
    advanced.replaceChildren(el('summary', 'Advanced detailed source evidence'),
      calculation ? el('div',
        el('p', 'Replicated comparison · analysis v' + calculation.analysis_version + ' · ' + calculation.instructions + ' instructions'),
        el('p', 'Calculation input SHA-256 ', el('code', calculation.inputHash)),
        el('p', calculationNote),
        button('Download calculation input (Candid)', () => saveFile(
          'calculation-' + calculation.inputHash + '.didbin', calculation.bytes, 'application/octet-stream')),
      ) : null,
      ...((selected?.receipts ?? []).map(([type, response]) => disclose(type + ' page', sourceReceipts(response)))));
    if (!selected) {
      output.replaceChildren(el('p', 'The selected scenario has no membership state to analyse.'));
      return;
    }
    const { scenario, subnet, state, rules, failures } = selected;
    const model = reviewModel(live, scenario, subnet, state, rules, calculation?.comparison, calculation?.evidence ?? emptyEvidence(), failures);
    if (calculation) model.calculation = calculation;
    if (localReplica) {
      model.notes.unshift('Local replica review. Observation times reflect the local reads; check the original source manifest when using captured evidence.');
    }
    showComparison(output, model, draft, selected, Boolean(calculation) && (selected.done || model.members.some(node => node.point)));
  }

  return { section, select(scenario, subnet, index, label) {
    const view = scenario.subnets.find(([id]) => principal(id) === subnet)?.[1];
    const state = index === 0 ? view?.baseline : option(view?.after_steps[index - 1] ?? []);
    const key = branch(scenario.id) + '/' + subnet + '/' + index;
    if (!state) selected = undefined;
    else {
      if (!states.has(key)) {
        const rules = option(live.outcome.Ok.subnet_rules ?? [])?.find(row => principal(row.subnet) === subnet);
        states.set(key, { scenario, subnet, state: { ...state, label }, before: view.baseline, rules,
          evidence: emptyEvidence(), failures: [], receipts: [] });
      }
      selected = states.get(key);
    }
    refresh();
  } };
}
