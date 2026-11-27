import { comparisonCaption, distanceTitle, distributionTables, governanceText, nodeFields, nodeHeaders, replayLabel, roles } from './detail-model.js';
import { drawMap, fitLocations, mapCoverage, mapProjection, mapScene, siteLabel } from './review-map.js';
import { reportScope, reviewMarkdown } from './review-markdown.js';
import { action, el, number, saveFile, styled, table } from './view.js';

function reportMap(snapshot) {
  const view = { width: 1120, height: 550 };
  const projection = mapProjection(view, fitLocations(snapshot.geography.locations, view));
  const scene = mapScene(snapshot.geography, projection.project, view);
  const lines = [
    'Proposal review · ' + snapshot.scope.ids.map(id => '#' + id).join(' + '),
    reportScope(snapshot),
    'Registry ' + number(snapshot.version) + ' · Subnet ' + snapshot.scope.subnet,
    snapshot.replay && replayLabel(snapshot.replay),
    snapshot.membership + ' · ' + mapCoverage(snapshot.geography),
    'Calculation input SHA-256 ' + snapshot.scope.inputHash,
  ].filter(Boolean);
  const header = 24 * lines.length + 52;
  const image = el('canvas');
  image.width = view.width;
  image.height = header + view.height + (scene.overflow.length ? (Math.ceil(scene.overflow.length / 4) + 1) * 25 + 12 : 0);
  image.setAttribute('role', 'img');
  image.setAttribute('aria-label', 'Report map. ' + mapCoverage(snapshot.geography));
  const ctx = image.getContext('2d');
  ctx.fillStyle = '#f7fbfb';
  ctx.fillRect(0, 0, image.width, image.height);
  ctx.fillStyle = '#132637';
  lines.forEach((line, index) => {
    ctx.font = index === 0 ? 'bold 22px system-ui' : '15px system-ui';
    ctx.fillText(line, 18, 27 + 24 * index, image.width - 36);
  });
  Object.values(roles).forEach(({ label, color }, index) => {
    const x = 24 + index * 118;
    ctx.beginPath();
    ctx.arc(x, header - 20, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#132637';
    ctx.fillText(label, x + 12, header - 15);
  });
  ctx.fillText('Dotted halo: co-located nodes · Registered coordinates · Natural Earth', 392, header - 15);
  ctx.save();
  ctx.translate(0, header);
  ctx.beginPath();
  ctx.rect(0, 0, view.width, view.height);
  ctx.clip();
  drawMap(ctx, scene, projection.project);
  ctx.restore();
  if (scene.overflow.length) {
    ctx.fillText('Changed sites outside map labels', 18, header + view.height + 25);
    scene.overflow.forEach((site, index) => ctx.fillText(siteLabel(site),
      18 + index % 4 * 276, header + view.height + 50 + Math.floor(index / 4) * 25, 260));
  }
  return image;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

// A standards-compatible stored ZIP. Markdown is small and PNG is already compressed.
export function reviewZip(files) {
  const encoder = new TextEncoder();
  const entries = [], directory = [];
  let offset = 0, directorySize = 0;
  for (const [name, bytes] of files) {
    const filename = encoder.encode(name);
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(12, 33, true);
    local.setUint32(14, crc ^ 0xffffffff, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, filename.length, true);
    entries.push(local.buffer, filename, bytes);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    new Uint8Array(central.buffer, 6, 24).set(new Uint8Array(local.buffer, 4, 24));
    central.setUint32(42, offset, true);
    directory.push(central.buffer, filename);
    directorySize += central.byteLength + filename.length;
    offset += local.byteLength + filename.length + bytes.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...entries, ...directory, end.buffer], { type: 'application/zip' });
}

export function markdownEditor(snapshot, draft, isCurrent) {
  const image = reportMap(snapshot);
  const png = new Promise(resolve => image.toBlob(resolve, 'image/png'));
  const vote = Object.assign(el('input'), { value: draft.vote ?? '' });
  const summary = Object.assign(el('textarea'), { rows: 3, value: draft.summary ?? '' });
  const attribution = Object.assign(el('input'), { value: draft.attribution ?? '' });
  const raw = Object.assign(el('textarea'), { readOnly: true, rows: 14 });
  raw.setAttribute('aria-label', 'Generated Markdown');
  const reviewer = el('div');
  const source = el('details', el('summary', 'Generated Markdown source'), raw);
  const status = styled('p', 'status');
  status.setAttribute('role', 'status');
  function update() {
    Object.assign(draft, { vote: vote.value, summary: summary.value, attribution: attribution.value });
    raw.value = reviewMarkdown(snapshot, draft);
    reviewer.replaceChildren(...[['Reviewer vote', vote], ['Reviewer summary', summary], ['Reviewer attribution', attribution]]
      .filter(([, input]) => input.value.trim()).map(([label, input]) => el('p', el('strong', label), ' · ', input.value.trim())));
  }
  for (const input of [vote, summary, attribution]) input.addEventListener('input', update);
  update();
  const nodeRow = node => nodeFields(node).map(field => field.text);
  const changed = snapshot.members.filter(node => node.role !== 'Retained');
  const unchanged = snapshot.members.filter(node => node.role === 'Retained');
  const preview = styled('article', 'markdown-preview',
    el('h4', 'Proposal review · ' + snapshot.scope.ids.map(id => '#' + id).join(' + ')),
    el('p', reportScope(snapshot)), reviewer, el('h4', 'Summary'), el('p', snapshot.summary), el('p', snapshot.membership),
    el('h4', 'Evidence scope'), el('p', 'Pinned Registry ' + number(snapshot.version) + ' · Subnet ' + snapshot.scope.subnet),
    snapshot.governance.map(item => el('p', governanceText(item, snapshot.replay, true))),
    snapshot.notes.map(note => el('p', note)),
    el('h4', 'Map'), image, el('h4', 'Node changes'),
    changed.length ? table(nodeHeaders, changed.map(node => [roles[node.role].label, ...nodeRow(node)]))
      : el('p', 'No membership changes in the selected comparison.'),
    el('h4', 'Decentralisation'), el('p', comparisonCaption),
    distributionTables.flatMap(({ key, title }) => [
      el('h5', title), table(['Dimension', 'Members'], snapshot.dimensions.map(item => [item.label, item[key]?.text ?? 'Unavailable'])),
    ]),
    snapshot.distances ? el('div', el('h5', distanceTitle), el('p', snapshot.distances.coverage),
      table(['Distance', 'Value'], snapshot.distances.columns.map(item => [item.label, item.delta.text]))) : null,
    el('details', el('summary', 'Unchanged nodes (' + unchanged.length + ')'), table(nodeHeaders.slice(1), unchanged.map(nodeRow))),
    el('details', el('summary', 'Sources and calculation'), el('p', 'Calculation input SHA-256 ', el('code', snapshot.scope.inputHash)),
      table(['Method', 'Item', 'Canister', snapshot.replay ? 'Replay delivery time' : 'Observed at', 'Reply SHA-256 or issue'], snapshot.sources)));
  return styled('section', 'detail-section',
    styled('div', 'actions',
      action('Copy Markdown', async event => {
        if (!isCurrent()) return;
        const copyButton = event.currentTarget;
        try {
          await navigator.clipboard.writeText(raw.value);
          status.textContent = 'Review Markdown copied.';
        } catch {
          const wasOpen = source.open;
          source.open = true;
          raw.focus({ preventScroll: true });
          raw.select();
          if (document.execCommand('copy')) {
            source.open = wasOpen;
            copyButton.focus({ preventScroll: true });
            status.textContent = 'Review Markdown copied.';
          } else status.textContent = 'Select and copy the generated Markdown from the field.';
        }
      }),
      action('Download review', async () => {
        const markdown = raw.value;
        const map = await png;
        if (!isCurrent()) return;
        if (!map) { status.textContent = 'Could not generate the map image.'; return; }
        const bytes = new Uint8Array(await map.arrayBuffer());
        if (!isCurrent()) return;
        const content = reviewZip([['review.md', new TextEncoder().encode(markdown)], ['map.png', bytes]]);
        saveFile('proposal-' + snapshot.scope.ids.join('-') + '-step-' + snapshot.scope.step + '-review.zip', content, 'application/zip');
      }), el('span', 'Attach map.png when posting.')), status,
    el('details', el('summary', 'Reviewer commentary (optional)'),
      styled('div', 'markdown-fields', el('label', 'Reviewer vote', vote), el('label', 'Reviewer summary', summary),
        el('label', 'Reviewer attribution', attribution))),
    preview, source);
}
