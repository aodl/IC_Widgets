export function el(tag, ...children) {
  const item = document.createElement(tag);
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) item.append(child instanceof Node ? child : String(child));
  }
  return item;
}

export function styled(tag, className, ...children) {
  const item = el(tag, ...children);
  item.className = className;
  return item;
}

export const branch = value => Object.keys(value)[0];
export const option = value => value[0];
export const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export const principal = id => id.toText();
export const proposalIds = ids => Array.from(ids, id => `#${id}`).join(' + ');
export const number = value => value.toLocaleString('en-US');
export const time = nanos => new Date(Number(nanos / 1_000_000n)).toISOString().replace('T', ' ').replace(/(?:\.000)?Z$/, ' UTC');
export const words = value => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

const details = (label, ...content) => el('details', el('summary', label), ...content);

export function table(headers, rows, rowClasses = []) {
  return styled('div', 'table-wrap',
    el('table', el('thead', el('tr', headers.map(label => {
      const heading = el('th', label);
      heading.scope = 'col';
      return heading;
    }))),
      el('tbody', rows.map((row, index) => styled('tr', rowClasses[index] ?? '', row.map(cell => el('td', cell)))))));
}

export function sourceReceipts(result, { replay = false } = {}) {
  const version = option(result.registry_version);
  return details('Source receipts',
    version === undefined ? null : el('p', `Pinned Registry version ${number(version)}`),
    el('p', `${number(result.usage.calls)} source calls · ${number(result.usage.source_bytes)} reply bytes`),
    el('p', `${number((result.usage.finished_at - result.usage.started_at) / 1_000_000n)} ms source stage · ${number(result.usage.instructions)} instructions · ${number(result.usage.peak_batch_reservation)} cycles peak batch reservation`),
    table(['Observation', 'Source read', replay ? 'Local replay delivery' : 'Observed at', 'Reply'], result.receipts.map(row => [
      row.id, el('span', row.method, ' ', el('code', row.item), el('br'), el('code', principal(row.source))),
      time(row.observed_at),
      option(row.reply_hash) ? el('code', hex(option(row.reply_hash))) : option(row.reject) ?? 'Unavailable',
    ])));
}

export function renderPerformance(history, filter, section) {
  if (!history.samples.length) {
    section.replaceChildren(el('p', 'No blockmaking samples are available for this period.'));
    return;
  }
  const select = el('select', history.samples.map((sample, index) => {
    const item = el('option', time(sample.timestamp_nanos));
    item.value = String(index);
    return item;
  }));
  select.value = String(history.samples.length - 1);
  const output = el('div');
  function draw() {
    const sample = history.samples[Number(select.value)];
    const observed = new Map(sample.node_metrics.map(row => [principal(row.node_id), row]));
    const nodes = filter ?? sample.node_metrics.map(row => row.node_id);
    output.replaceChildren(
      el('p', filter ? `${observed.size} of ${nodes.length} selected nodes have counter rows in this sample.`
        : `${observed.size} counter rows in this sample. Unchanged rows can be omitted.`),
      nodes.length ? table(['Node', 'Proposed blocks, cumulative', 'Blockmaking failures, cumulative'], nodes.map(id => {
        const row = observed.get(principal(id));
        return [el('code', principal(id)), row ? number(row.num_blocks_proposed_total) : 'No row in sample',
          row ? number(row.num_block_failures_total) : 'No row in sample'];
      })) : null,
    );
  }
  select.addEventListener('change', draw);
  section.replaceChildren(el('label', 'Sample time', select), output);
  draw();
}

export function action(label, run) {
  const item = el('button', label);
  item.type = 'button';
  item.addEventListener('click', run);
  return item;
}

export function saveFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = el('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function deltaNode(delta) {
  if (!delta?.before) return el('span', delta?.text ?? 'Unavailable');
  const display = el('span', delta.before, styled('span', delta.direction > 0 ? 'delta-up' : delta.direction < 0 ? 'delta-down' : '',
    ' → ' + delta.after));
  display.setAttribute('aria-label', delta.accessible);
  display.setAttribute('role', 'img');
  return display;
}
