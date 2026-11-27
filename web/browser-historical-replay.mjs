import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cbor, requestIdOf } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { build } from 'esbuild';
import { idlFactory } from './src/reviewer.did.js';

const [project, output] = process.argv.slice(2);
if (!project || !output) throw new Error('Usage: node web/browser-historical-replay.mjs <local project> <output>');
const config = JSON.parse(await readFile(resolve(project, 'dfx.json'), 'utf8'));
const port = config.networks.local.bind.match(/^127\.0\.0\.1:(\d+)$/)?.[1];
if (!port || config.networks.local.type !== 'ephemeral') throw new Error('An isolated local replay project is required.');
const data = JSON.parse(await readFile(resolve(project, 'replays.json'), 'utf8'));
const id = execFileSync('dfx', ['canister', 'id', '--network', 'local', 'frontend'], {
  cwd: project, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
}).trim();
const publicUrl = process.env.NEXUS_REPLAY_PUBLIC_URL;
const url = new URL(publicUrl ?? process.env.NEXUS_REPLAY_LOCAL_URL ?? 'http://' + id + '.localhost:' + port);
if (publicUrl ? url.protocol !== 'https:' : url.protocol !== 'http:' || !/^(?:127\.0\.0\.1|[-a-z0-9]+\.localhost)$/.test(url.hostname)) {
  throw new Error('Use the isolated loopback replay or a public HTTPS replay.');
}
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true,
  hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
await page.addInitScript(() => {
  const clipboard = navigator.clipboard;
  if (clipboard) {
    const writeText = clipboard.writeText.bind(clipboard);
    clipboard.writeText = async text => {
      await writeText(text);
      window.reviewCopy = text;
    };
  }
  const execute = document.execCommand.bind(document);
  document.execCommand = (...args) => {
    const field = document.activeElement;
    const copied = execute(...args);
    if (copied && args[0] === 'copy' && field instanceof HTMLTextAreaElement) {
      window.reviewCopy = field.value.slice(field.selectionStart, field.selectionEnd);
    }
    return copied;
  };
});
const external = [];
const errors = [];
const calls = new Map();
let backendRequests = 0;
const methods = idlFactory({ IDL }).fieldsAsObject();
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin === url.origin) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname.startsWith('/api/')) backendRequests++;
  if (!/\/canister\/[^/]+\/call$/.test(request.url())) return;
  const { content } = Cbor.decode(new Uint8Array(request.postDataBuffer()));
  calls.set(Buffer.from(requestIdOf(content)).toString('hex'), content.method_name);
});
const count = method => [...calls.values()].filter(name => name === method).length;
const review = () => page.getByRole('button', { name: 'Review', exact: true }).click();
const exportButton = () => page.getByRole('button', { name: 'Generate review', exact: true });
const settled = () => page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 120000 });
const select = async name => {
  await page.getByLabel('Replay scenario').selectOption(name);
  await page.waitForURL('**/?case=' + name);
  await page.locator('#local-notice').getByText(/Historical replay/).waitFor();
  const metadata = data.cases.find(row => row.id === name);
  assert.equal(await page.locator('input[name=first]').inputValue(), metadata.proposalIds[0]);
  await page.getByText(metadata.purpose, { exact: true }).waitFor();
};
const capture = name => page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
const resize = async (width, height) => {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(documentWidth <= width, 'Viewport ' + width + 'px overflows to ' + documentWidth + 'px');
};
const mapChecks = [];
const frame = page.locator('.map-frame');
const popup = page.getByRole('region', { name: 'Map location details' });
const marker = name => frame.getByRole('button', { name: new RegExp('^' + name + ' ·') }).first();
const point = async target => {
  const { x, y, width, height } = await target.boundingBox();
  return { x: x + width / 2, y: y + height / 2 };
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const closePopup = () => popup.getByRole('button', { name: 'Close map details' }).click();
const nodeTableLayout = async (container, width) => {
  const changed = container.locator('.node-changes tbody tr');
  const other = container.locator('.other-nodes');
  assert.equal(await other.evaluate(details => details.open), false);
  assert.equal(await changed.count(), 2);
  await other.locator('summary').first().click();
  const rows = other.locator('tbody tr');
  assert.equal(await rows.count(), 39);
  assert.ok(await rows.evaluateAll(items => items.every(row => row.cells[0].lastElementChild.textContent === ''
    && Array.from(row.cells).every(cell => getComputedStyle(cell).backgroundColor === 'rgba(0, 0, 0, 0)'))));
  const geometry = locator => locator.first().evaluate(row => Array.from(row.cells).map(cell =>
    [cell.getBoundingClientRect().x, cell.getBoundingClientRect().width]));
  assert.deepEqual(await geometry(changed), await geometry(rows), 'Node tables should align at ' + width + ' px');
  assert.equal(await rows.first().getByRole('link').count(), 3);
  if (width === 1366) {
    await other.locator('summary').first().evaluate(summary => window.scrollTo(0,
      window.scrollY + summary.getBoundingClientRect().top - 175));
    await page.screenshot({ path: resolve(output, 'recorded-other-nodes.png') });
  }
  await other.locator('summary').first().click();
};
const download = async (button, filename) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const target = resolve(output, filename);
  await (await pending).saveAs(target);
  return readFile(target);
};

async function verifyMixedLocation() {
  const example = await browser.newPage({ viewport: { width: 390, height: 744 } });
  const assets = fileURLToPath(new URL('.', import.meta.url));
  const { outputFiles } = await build({
    bundle: true, write: false, target: 'es2022',
    stdin: { resolveDir: assets, contents: "import { nodeMap } from './src/map-interaction.js'; window.nodeMap = nodeMap;" },
  });
  try {
    await example.route('**/*', route => { external.push(route.request().url()); return route.abort(); });
    await example.setContent('<main aria-label="Synthetic mixed-provider location"></main>');
    await example.addStyleTag({ path: resolve(assets, 'styles.css') });
    await example.addScriptTag({ content: outputFiles[0].text });
    await example.evaluate(() => {
      const map = window.nodeMap();
      document.querySelector('main').append(map.section);
      const point = { lat: 59.3, lon: 18.1 };
      const region = 'Europe,SE,Stockholm';
      map.update({ key: 'synthetic-mixed-location', members: [
        { id: 'sample-node-1', label: 'Node 1', role: 'Added', dc: 'one', owner: 'Owner A', provider: 'sample-first-provider', point, region },
        { id: 'sample-node-2', label: 'Node 2', role: 'Retained', dc: 'one', owner: 'Owner A', provider: 'sample-other-provider', point, region },
        { id: 'sample-node-3', label: 'Node 3', role: 'Removed', dc: 'two', centerIssue: 'Could not load owner', point, region },
      ] });
    });
    const pin = example.locator('.map-pin');
    assert.equal(await pin.count(), 1);
    await pin.focus();
    const tooltip = example.getByRole('tooltip');
    await tooltip.getByText(/Providers:.*1 node.*1 node/).waitFor();
    await tooltip.getByText(/Could not load owner/).waitFor();
    assert.equal(await tooltip.getByRole('link').count(), 0);
    await example.keyboard.press('Enter');
    const popup = example.getByRole('region', { name: 'Map location details' });
    assert.equal(await popup.getByRole('link', { name: /^(one|two)$/ }).count(), 2);
    assert.deepEqual(await popup.locator('a[href*="/network/provider/"]').evaluateAll(links => links.map(link => link.href.split('/').pop())),
      ['sample-first-provider', 'sample-other-provider']);
    assert.equal(await popup.locator('[data-map-node]').count(), 3);
  } finally {
    await example.close();
  }
}

try {
  await page.goto(url.toString());
  await select('nns-144954-recorded-open');
  await review();
  await settled();
  assert.equal(count('begin_membership_review'), 1);
  assert.equal(count('membership_target_topology'), 0);
  assert.equal(count('membership_registry_role'), 1);
  assert.equal(count('compare_membership_context'), 1);
  assert.equal(count('compare_membership_details'), 0);
  assert.equal(count('finalize_membership_review'), 1);
  await page.getByText('40 members · Add 1 · Remove 1 · Unchanged 39', { exact: true }).waitFor();
  await page.getByText(/Target subnet checked; assignments in the other 95 listed subnets were not checked/).waitFor();
  await page.getByText('41 unique nodes across both states · 41/41 located', { exact: true }).waitFor();
  assert.equal(await page.locator('.map-pin').count(), 39);
  const replicatedTables = [
    ['6', '24', '39 → 38', '39 → 38', '38', '39 → 38'],
    ['17', '3', '2 → 3', '2 → 3', '3', '2 → 3'],
    ['1', '5', '13 → 12', '13 → 12', '12', '13 → 12'],
    ['0 km', '7,367.0 km → 7,361.8 km', '19,461.4 km'],
  ];
  assert.deepEqual(await page.locator('.topology-card:not(.node-changes) tbody').evaluateAll(tables =>
    tables.map(table => [...table.querySelectorAll('td')].map(cell => cell.textContent))), replicatedTables);
  await page.getByText('780 of 780 pairs before and proposed.', { exact: true }).waitFor();
  await page.getByText('Node threshold · 14', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sources & details' }).click();
  await page.getByText('Recorded distributions and maximum ties', { exact: true }).click();
  await page.locator('.inspector summary').filter({ hasText: /^Country$/ }).click();
  for (const [state, tokens] of [
    ['before', ['CH', 'HK', 'IN', 'KR', 'US', 'ZA']], ['proposed', ['HK', 'IN', 'KR', 'SE', 'US', 'ZA']],
  ]) {
    const row = page.getByText(new RegExp('^Largest known groups ' + state + ' ·')).filter({ has: page.locator('[data-recorded-country]') });
    assert.deepEqual(await row.locator('[data-recorded-country]').evaluateAll(items => items.map(item => item.dataset.recordedCountry)), tokens);
  }
  const country = token => page.locator('.inspector tr').filter({ has: page.locator('[data-recorded-country=' + token + ']') });
  await country('SE').getByText('2 → 3', { exact: true }).waitFor();
  await country('CH').getByText('3 → 2', { exact: true }).waitFor();
  await country('HK').locator('canvas[data-drawn]').waitFor();
  await country('IM').locator('canvas[data-drawn]').waitFor();
  await page.getByText('Method and exact inputs', { exact: true }).click();
  const wire = await download('Download calculation input (Candid)', 'recorded-calculation.didbin');
  const digest = createHash('sha256').update(wire).digest('hex');
  await page.getByRole('button', { name: 'Close details' }).click();
  const sourceCalls = calls.size;
  const localRequests = backendRequests;
  assert.equal(count('membership_context_detail_page'), 6);
  const recordedMethods = [...calls.values()];
  const sh = marker('sh1'), zh = marker('zh2');
  assert.equal(await page.locator('.node-table summary', { hasText: 'Full ID' }).count(), 0);
  assert.equal(await page.locator('.node-table tbody').getByRole('button', { name: /Inspect|Details/ }).count(), 0);
  const countrySort = page.locator('.map-card .node-changes th').filter({ has: page.getByRole('button', { name: /^Country/ }) });
  const changedCountry = () => page.locator('.map-card .node-changes tbody [data-recorded-country]')
    .evaluateAll(labels => labels.map(label => label.dataset.recordedCountry));
  await countrySort.getByRole('button').click();
  assert.equal(await countrySort.getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(await changedCountry(), ['SE', 'CH']);
  await countrySort.getByRole('button').click();
  assert.equal(await countrySort.getAttribute('aria-sort'), 'descending');
  assert.deepEqual(await changedCountry(), ['CH', 'SE']);
  const shNodes = new Set(await sh.getAttribute('data-nodes').then(nodes => nodes.split(' ')));
  assert.equal(shNodes.size, 3);
  await frame.scrollIntoViewIfNeeded();
  const startScroll = await page.evaluate(() => scrollY);
  const shPoint = await point(sh);
  await page.mouse.move(shPoint.x, shPoint.y);
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Stockholm' });
  await tooltip.waitFor();
  await tooltip.getByText('Data center owner: Digital Realty').waitFor();
  await tooltip.getByText('Provider: bvcsg…mqe').waitFor();
  await tooltip.getByText('Subnet members: 2 → 3').waitFor();
  await tooltip.locator('[data-recorded-country=SE] canvas[data-drawn]').waitFor();
  assert.equal(await tooltip.getByRole('link').count(), 0);
  await tooltip.hover();
  await page.waitForTimeout(230);
  assert.ok(await tooltip.isVisible());
  await sh.focus();
  await page.keyboard.press('Escape');
  assert.ok(!await tooltip.isVisible());
  await page.keyboard.press('Enter');
  await popup.getByText('sh1 · Stockholm, Sweden', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => scrollY), startScroll);
  await popup.getByText('Subnet members: 2 → 3', { exact: true }).waitFor();
  await popup.getByText('Data center owner: Digital Realty', { exact: true }).waitFor();
  const providerHref = 'https://dashboard.internetcomputer.org/network/provider/';
  const provider = popup.getByRole('link', { name: 'bvcsg…mqe', exact: true });
  assert.equal(await provider.getAttribute('href'), providerHref + (await provider.getAttribute('title')));

  await popup.locator('.map-country-count').getByText('2 → 3', { exact: true }).waitFor();
  await popup.locator('.map-country-count [data-recorded-country=SE] canvas[data-drawn]').waitFor();
  assert.equal(await popup.getByRole('link', { name: 'sh1', exact: true }).getAttribute('href'),
    'https://dashboard.internetcomputer.org/network/centers/sh1');
  assert.match(await popup.getByRole('link', { name: 'bvcsg…mqe' }).getAttribute('href'), /\/network\/provider\/bvcsg-[a-z0-9-]+-mqe$/);
  for (const node of await popup.locator('[data-map-node]').all()) {
    const id = await node.getAttribute('data-map-node');
    await node.click();
    assert.ok(shNodes.has(id));
    assert.equal(await popup.getByLabel('Full node principal').inputValue(), id);
    assert.equal(await popup.getByRole('link', { name: 'Node dashboard' }).getAttribute('href'),
      'https://dashboard.internetcomputer.org/network/nodes/' + id);
    const providerDetails = popup.getByRole('link', { name: await provider.getAttribute('title'), exact: true });
    assert.equal(await providerDetails.getAttribute('href'), await provider.getAttribute('href'));
    await node.click();
  }
  assert.ok(!await page.locator('.inspector').isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await sh.evaluate(node => document.activeElement === node), true);
  assert.equal(await page.evaluate(() => scrollY), startScroll);

  const beforeZoom = await point(sh);
  const beforeSecond = await point(zh);
  await page.mouse.move(beforeZoom.x, beforeZoom.y);
  await page.mouse.wheel(0, -250);
  await page.waitForFunction(({ key, old }) => {
    const marker = [...document.querySelectorAll('.map-pin')].find(node => node.dataset.location === key);
    return Math.abs(marker.getBoundingClientRect().left + 14 - old) > 3;
  }, { key: await zh.getAttribute('data-location'), old: beforeSecond.x });
  const wheelError = gap(await point(sh), beforeZoom);
  assert.ok(wheelError <= 1, 'Wheel anchor error: ' + wheelError);
  const beforeDrag = await point(sh);
  await page.mouse.move(beforeDrag.x, beforeDrag.y);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 40, beforeDrag.y + 25, { steps: 6 });
  await page.mouse.up();
  assert.ok(gap(await point(sh), { x: beforeDrag.x + 40, y: beforeDrag.y + 25 }) <= 1);
  assert.ok(!await popup.isVisible());
  await frame.focus();
  const beforeKey = await point(sh);
  await page.keyboard.press('ArrowRight');
  assert.ok(gap(await point(sh), { x: beforeKey.x - 32, y: beforeKey.y }) <= 1);
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  await page.keyboard.press('ArrowLeft');
  const displaced = await point(sh);
  await page.mouse.move(displaced.x, displaced.y);
  await page.mouse.down();
  await page.mouse.move(beforeZoom.x, beforeZoom.y, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, 250);
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('.map-frame').dataset.mapScale) - 1) < .01);
  assert.ok(gap(await point(sh), beforeZoom) <= 1);

  for (const [width, height] of [[1366, 900], [768, 900], [390, 844], [320, 700]]) {
    await resize(width, height);
    await nodeTableLayout(page.locator('.map-card'), width);
    const rowColors = await page.locator('.node-changes tbody tr').evaluateAll(rows =>
      rows.map(row => [row.className, [...row.cells].map(cell => getComputedStyle(cell).backgroundColor)]));
    assert.ok(rowColors.length >= 2 && rowColors.every(([name, cells]) =>
      cells.every(color => color === (name === 'node-row-added' ? 'rgb(236, 247, 237)' : 'rgb(252, 240, 239)'))));
    await page.locator('.node-changes [data-recorded-country=SE] canvas[data-drawn]').waitFor();
    const expectedSummary = await sh.getAttribute('data-nodes');
    assert.deepEqual(new Set(expectedSummary.split(' ')), shNodes);
    assert.equal(await page.locator('.map-pin:visible').count(), 39);
    assert.match(await frame.getAttribute('data-changed-site-labels'), /sh1 · 2 → 3 nodes.*zh2 · 1 → 0 nodes/);
    assert.equal(await page.getByRole('button', { name: 'Focus changes' }).count(), 0);
    assert.equal(await page.locator('.map-help, .country-legend').count(), 0);
    const values = await page.locator('.topology-card:not(.node-changes) tbody').evaluateAll(tables =>
      tables.map(table => [...table.querySelectorAll('td')].map(cell => cell.textContent)));
    assert.deepEqual(values, replicatedTables);
    await page.evaluate(() => scrollTo(0, 0));
    await capture(width === 1366 ? 'recorded-desktop' : width === 390 ? 'recorded-mobile' : 'recorded-' + width);
    mapChecks.push({ width, locations: 39, identities: 41 });
  }

  await resize(390, 844);
  await frame.scrollIntoViewIfNeeded();
  let where;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, touches = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: touches });
  const input = (anchor, dx, dy, id) => ({ x: anchor.x + dx, y: anchor.y + dy, id });
  where = await point(sh);
  await touch('touchStart', [input(where, 0, 0, 1)]);
  await touch('touchMove', [input(where, 32, 20, 1)]);
  await touch('touchEnd');
  assert.ok(gap(await point(sh), input(where, 32, 20, 1)) <= 2);
  assert.ok(!await popup.isVisible());
  where = await point(sh);
  const initialSeparation = gap(await point(zh), where);
  await touch('touchStart', [input(where, -22, 0, 1)]);
  await touch('touchStart', [input(where, -22, 0, 1), input(where, 22, 0, 2)]);
  await touch('touchMove', [input(where, -42, 12, 1), input(where, 64, 12, 2)]);
  await touch('touchEnd');
  const pinchError = gap(await point(sh), input(where, 11, 12, 1));
  assert.ok(pinchError <= 2, 'Pinch midpoint error: ' + pinchError);
  assert.ok(gap(await point(zh), await point(sh)) > initialSeparation * 2);
  assert.ok(!await popup.isVisible());
  where = await point(sh);
  await touch('touchStart', [input(where, 0, 0, 1)]);
  await touch('touchMove', [input(where, 5, 12, 1)]);
  await touch('touchCancel');
  assert.ok(!await popup.isVisible());
  where = await point(sh);
  await page.touchscreen.tap(where.x, where.y);
  assert.ok(await popup.isVisible());
  assert.equal(await popup.locator('[data-map-node]').count(), 3);
  await popup.getByRole('button', { name: /Add kaoz3/ }).tap();
  assert.match(await popup.getByLabel('Full node principal').inputValue(), /^kaoz3/);
  const inside = await popup.boundingBox(), boundary = await frame.boundingBox();
  assert.ok(inside.width <= boundary.width && inside.height <= boundary.height);
  await frame.screenshot({ path: resolve(output, 'recorded-mobile-popover.png') });
  await closePopup();
  await resize(320, 700);
  await frame.scrollIntoViewIfNeeded();
  where = await point(zh);
  await page.touchscreen.tap(where.x, where.y);
  await popup.getByRole('heading', { name: 'Choose a location' }).waitFor();
  await popup.getByRole('button', { name: /^zh2 ·/ }).tap();
  assert.match(await popup.innerText(), /Subnet members: 1 → 0/);
  await popup.locator('.map-country-count').getByText('3 → 2', { exact: true }).waitFor();
  await popup.getByRole('button', { name: /Remove tg4ec/ }).tap();
  assert.match(await popup.getByLabel('Full node principal').inputValue(), /^tg4ec/);
  await closePopup();
  assert.equal(calls.size, sourceCalls);
  assert.equal(backendRequests, localRequests);
  mapChecks.push({ wheelError, pinchError, toleranceCssPixels: 2 });

  // Generate after panning and zooming. The report must use its own all-role scene.
  await exportButton().click();
  const reportRows = page.locator('.markdown-preview :is(.node-row-added, .node-row-removed)');
  await nodeTableLayout(page.locator('.markdown-preview'), 320);
  const reportSort = page.locator('.markdown-preview').getByRole('combobox', { name: 'Sort node changes' });
  await reportSort.selectOption({ label: 'Country (A–Z)' });
  assert.deepEqual(await page.locator('.markdown-preview .node-changes [data-recorded-country]').evaluateAll(labels =>
    labels.map(label => label.dataset.recordedCountry)), ['SE', 'CH']);
  assert.equal(await reportRows.count(), 2);
  assert.ok(await reportRows.evaluateAll(rows => rows.every(row => [...row.cells].every(cell =>
    getComputedStyle(cell).backgroundColor === (row.className === 'node-row-added' ? 'rgb(236, 247, 237)' : 'rgb(252, 240, 239)')))));
  const bundle = resolve(output, 'recorded-review.zip');
  await download('Download review', 'recorded-review.zip');
  assert.equal(execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf8' }), 'review.md\nmap.png\n');
  const markdown = execFileSync('unzip', ['-p', bundle, 'review.md'], { encoding: 'utf8' });
  const png = execFileSync('unzip', ['-p', bundle, 'map.png']);
  await writeFile(resolve(output, 'review.md'), markdown);
  await writeFile(resolve(output, 'map.png'), png);
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  await page.getByText('Review Markdown copied.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.reviewCopy), markdown);
  assert.ok(markdown.includes(digest));
  assert.match(markdown, /Recorded status: Open.*Original Governance observation 2026-11-25 13:08:13\.589 UTC.*Local replay served/);
  assert.match(markdown, /Original Registry observations/);
  assert.match(markdown, /Synthetic NNS-role supplement/);
  assert.match(markdown, /41 unique nodes across both states · 41\/41 located/);
  assert.match(markdown, /Other Nodes \(39\)/);
  assert.equal(markdown.split('\n').filter(line => line.startsWith('|  | [')).length, 39);
  assert.match(markdown, /\[#144954\]\(https:\/\/dashboard\.internetcomputer\.org\/proposal\/144954\)/);
  assert.match(markdown, /\[tdb26-[a-z0-9-]+\]\(https:\/\/dashboard\.internetcomputer\.org\/network\/subnets\/tdb26-/);
  assert.match(markdown, /\[sh1\]\(https:\/\/dashboard\.internetcomputer\.org\/network\/centers\/sh1\)/);
  assert.match(markdown, /\[kaoz3-[a-z0-9-]+\]\(https:\/\/dashboard\.internetcomputer\.org\/network\/nodes\/kaoz3-/);
  assert.doesNotMatch(markdown, /country count increased|country count decreased/i);
  assert.match(markdown, /🇸🇪 Sweden \(SE\) \| 2 → 3/);
  assert.match(markdown, /🇨🇭 Switzerland \(CH\) \| 3 → 2/);
  assert.match(markdown, /Europe,SE,Stockholm/);
  assert.match(markdown, /7367029 \| 7361847/);
  assert.match(markdown, /\]\(map\.png\)/);
  assert.doesNotMatch(markdown, /## Reviewer (vote|summary)|Full recorded distribution|Matches target|143190/);
  const colors = await page.evaluate(async base64 => {
    const raster = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/png' }));
    const bitmap = document.createElement('canvas');
    bitmap.width = raster.width;
    bitmap.height = raster.height;
    const context = bitmap.getContext('2d');
    context.drawImage(raster, 0, 0);
    const data = context.getImageData(0, 230, bitmap.width, bitmap.height - 230).data;
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      const role = [[8, 119, 72], [173, 38, 63], [49, 94, 128], [191, 226, 196], [237, 201, 200]].findIndex(rgb => rgb.every((value, j) => data[i + j] === value));
      if (role >= 0) counts[role]++;
    }
    return counts;
  }, png.toString('base64'));
  assert.ok(colors.every(count => count > 20) && colors[2] > 1000, JSON.stringify(colors));
  assert.equal(calls.size, sourceCalls);
  assert.equal(backendRequests, localRequests);
  await resize(1366, 900);
  await verifyMixedLocation();

  const oracle = JSON.parse(await readFile(new URL('../tests/source-fixture/data/historical/expected.json', import.meta.url), 'utf8'));
  const [subnetId, baselineNodes] = Object.entries(oracle.cases['nns-144954-recorded-open'].baselines)[0];
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await page.locator('#performance-mode').selectOption('follow');
  await page.locator('#performance-context').getByText(/Proposal #144954.*40 nodes/).waitFor();
  await page.getByRole('button', { name: 'Subnet overview', exact: true }).click();
  await page.locator('#subnet-search input').fill(subnetId);
  const beforeSnapshot = calls.size;
  await page.getByRole('button', { name: 'Load subnet', exact: true }).click();
  await page.getByText('40 registered members · 40/40 located', { exact: true }).waitFor({ timeout: 120000 });
  const onlineMap = page.locator('#subnet-result');
  const snapshotPins = onlineMap.locator('.map-pin');
  assert.deepEqual(await snapshotPins.evaluateAll(pins => pins.flatMap(pin => pin.dataset.nodes.split(' ')).sort()),
    [...baselineNodes].sort());
  assert.deepEqual([...calls.values()].slice(beforeSnapshot), ['subnet_snapshot_on_demand']);
  const mapRequests = backendRequests;
  const shBefore = marker('sh1');
  assert.equal((await shBefore.getAttribute('data-nodes')).split(' ').length, 2);
  await resize(390, 744);
  await shBefore.focus();
  await page.keyboard.press('Enter');
  const existingPopup = onlineMap.getByRole('region', { name: 'Map location details' });
  await existingPopup.getByText('Subnet members: 2').waitFor();
  assert.equal(await existingPopup.locator('[data-map-node]').count(), 2);
  await existingPopup.locator('.map-country-count [data-recorded-country=SE] canvas[data-drawn]').waitFor();
  await page.keyboard.press('Escape');
  await capture('existing-subnet-390');
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await page.locator('#performance-context').getByText(/Registered subnet membership.*40 nodes/).waitFor();
  assert.equal(await page.locator('#performance-form input[name=subnet]').inputValue(), subnetId);
  assert.equal(backendRequests, mapRequests);
  await page.locator('#subnet-search input').fill('');
  await page.locator('#performance-context').getByText(/Waiting for resolved/).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Read blockmaking samples' }).isDisabled());
  await page.getByRole('button', { name: 'Proposal review', exact: true }).click();
  await resize(1366, 900);

  if (data.cases.length > 1) {
    await select('multiple-changes');
    await review();
    await settled();
    await page.getByText('5 members · Add 2 · Remove 2 · Unchanged 3', { exact: true }).waitFor();
    const changed = page.locator('.node-changes tbody a[href*="/network/nodes/"]');
    assert.equal(await changed.count(), 4);
    assert.equal(await page.locator('.other-nodes tbody tr').count(), 3);
    const expected = JSON.parse(await readFile(new URL('../tests/source-fixture/data/historical/expected.json', import.meta.url), 'utf8'));
    const state = Object.values(expected.cases['multiple-changes'].scenarios.A[0])[0];
    const ids = await changed.evaluateAll(links => links.map(link => new URL(link.href).pathname.split('/').pop()));
    assert.deepEqual(ids.sort(), [...state.added, ...state.removed].sort());
    for (const id of ids) {
      const pin = frame.locator('.map-pin[data-nodes~="' + id + '"]');
      await pin.focus();
      await page.keyboard.press('Enter');
      await popup.locator('[data-map-node="' + id + '"]').click();
      assert.equal(await popup.getByLabel('Full node principal').inputValue(), id);
      await page.keyboard.press('Escape');
    }
    await capture('constructed-multiple');

    await select('unequal-change');
    await review();
    await settled();
    await page.getByText(/Add 4 · Remove 1/).waitFor();
    assert.equal(await page.locator('.node-changes tbody a[href*="/network/nodes/"]').count(), 5);

    await select('separate-add-remove');
    await review();
    await settled();
    const order = page.getByLabel('Proposal order');
    const step = page.getByLabel('Membership state');
    await order.selectOption('AThenB');
    await step.selectOption('1');
    await page.locator('.review-summary > strong').filter({ hasText: /3 → 4 members/ }).waitFor();
    const scopeReport = async (name, scenario) => {
      await exportButton().click();
      await download('Download review', name);
      const archive = resolve(output, name);
      const markdown = execFileSync('unzip', ['-p', archive, 'review.md'], { encoding: 'utf8' });
      assert.match(markdown, scenario);
      const hash = /Calculation input SHA-256 `([a-f0-9]{64})`/.exec(markdown)?.[1];
      assert.ok(hash, 'Report must carry the accepted input digest');
      const image = execFileSync('unzip', ['-p', archive, 'map.png']);
      await page.getByRole('button', { name: 'Close details' }).click();
      return { hash, image };
    };
    const a = await scopeReport('order-a-step-1.zip', /Proposal #85612 then Proposal #85622.*Step 1 of 2/);
    await order.selectOption('BThenA');
    await step.selectOption('1');
    await page.locator('.review-summary > strong').filter({ hasText: /3 → 2 members/ }).waitFor();
    const b = await scopeReport('order-b-step-1.zip', /Proposal #85622 then Proposal #85612.*Step 1 of 2/);
    assert.notEqual(a.hash, b.hash);
    assert.notDeepEqual(a.image, b.image);
    await order.selectOption('AThenB');
    await step.selectOption('1');
    const again = await scopeReport('order-a-return.zip', /Proposal #85612 then Proposal #85622.*Step 1 of 2/);
    assert.deepEqual(again, a);
    await capture('constructed-intermediate');

    for (const [name, label, note] of [
      ['nns-144954-executed', 'Executed', /historical before-state is unavailable/],
      ['rejected-139792', 'Rejected', /proposal ended at the vote/],
      ['failed-140988', 'Failed', /recorded an execution error/],
    ]) {
      const detailCalls = count('membership_context_detail_page');
      await select(name);
      await review();
      const outcome = page.locator('.terminal-outcome');
      await outcome.getByText(label, { exact: true }).waitFor();
      await outcome.getByText(note).waitFor();
      assert.equal(await exportButton().count(), 0);
      assert.equal(await page.locator('.review-grid, .topology-card').count(), 0);
      assert.equal(count('membership_context_detail_page'), detailCalls);
      if (label === 'Failed') {
        await outcome.getByText('Indexed execution error', { exact: true }).click();
        await outcome.getByText(/Nodes that should be removed do not belong/).waitFor();
      }
      if (label === 'Executed') await outcome.getByText(/Execution recorded at 2026-11-26 07:45:57 UTC/).waitFor();
      await capture(label.toLowerCase() + '-terminal');
    }

    await select('nns-144954-missing-gps');
    let showPending;
    let releaseLocations;
    const pending = new Promise(resolve => { showPending = resolve; });
    const hold = new Promise(resolve => { releaseLocations = resolve; });
    let intercepted = false;
    const detailRoute = /\/api\/v4\/canister\/[^/]+\/call$/;
    const waitForLocation = async route => {
      const { content } = Cbor.decode(new Uint8Array(route.request().postDataBuffer()));
      if (!intercepted && content.method_name === 'membership_context_detail_page') {
        const [, keys] = IDL.decode(methods.membership_context_detail_page.argTypes, content.arg);
        if ('DataCenters' in keys) {
          intercepted = true;
          showPending();
          await hold;
        }
      }
      await route.fallback();
    };
    await page.route(detailRoute, waitForLocation);
    try {
      await review();
      await Promise.race([pending, page.locator('#review-counts').getByText(/^0 of 39 records settled/).waitFor()]);
      await page.getByText(/41 locations loading/).waitFor();
      assert.equal(await page.getByText(/Unmapped nodes/).isVisible(), false);
      await capture('loading-locations');
    } finally {
      releaseLocations();
    }
    await settled();
    await page.unroute(detailRoute, waitForLocation);
    await page.getByText(/41 unique nodes across both states · 38\/41 located/).waitFor();
    await capture('missing-locations');

    await select('untargeted-two-subnets');
    await review();
    await settled();
    const subnet = page.getByLabel('Subnet', { exact: true });
    const initial = await subnet.inputValue();
    const finalChecks = count('finalize_membership_review');
    const comparisons = count('compare_membership_context');
    let pendingOther;
    let releaseOther;
    const other = new Promise(resolve => { pendingOther = resolve; });
    const holdOther = new Promise(resolve => { releaseOther = resolve; });
    let trapped = false;
    await page.route(detailRoute, async route => {
      const { content } = Cbor.decode(new Uint8Array(route.request().postDataBuffer()));
      if (!trapped && content.method_name === 'membership_context_detail_page') {
        trapped = true;
        pendingOther();
        await holdOther;
      }
      await route.fallback();
    });
    try {
      await subnet.selectOption({ index: 1 });
      await Promise.race([other, page.locator('#review-counts').getByText(/records settled/).waitFor()]);
      await subnet.selectOption(initial);
      assert.ok(await exportButton().isDisabled());
    } finally {
      releaseOther();
    }
    await settled();
    assert.equal(await subnet.inputValue(), initial);
    assert.equal(count('finalize_membership_review'), finalChecks + 1);
    assert.equal(count('compare_membership_context'), comparisons);
    assert.ok(await exportButton().isEnabled());

    const first = await browser.newPage();
    const second = await browser.newPage();
    let holdFirst;
    let releaseFirst;
    const ready = new Promise(resolve => { holdFirst = resolve; });
    const paused = new Promise(resolve => { releaseFirst = resolve; });
    const senders = new Set();
    for (const tab of [first, second]) {
      tab.on('pageerror', error => errors.push(error.message));
      await tab.route('**/*', route => {
        if (new URL(route.request().url()).origin === url.origin) return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      await tab.route(detailRoute, async route => {
        const { content } = Cbor.decode(new Uint8Array(route.request().postDataBuffer()));
        if (content.method_name === 'begin_membership_review') {
          senders.add(Buffer.from(content.sender).toString('hex'));
        }
        if (tab === first && content.method_name === 'membership_context_detail_page') {
          holdFirst();
          await paused;
        }
        return route.fallback();
      });
    }
    const concurrencyUrl = new URL('/?case=multiple-changes', url);
    const start = async tab => {
      await tab.goto(concurrencyUrl.toString());
      await tab.getByRole('button', { name: 'Review', exact: true }).click();
    };
    const tabFinished = tab => tab.locator('#report-status').getByText('Data loading complete', { exact: true })
      .waitFor({ timeout: 120000 });
    try {
      await start(first);
      await Promise.race([ready, first.locator('#review-counts').getByText(/records settled/).waitFor()]);
      await start(second);
      await tabFinished(second);
    } finally {
      releaseFirst();
    }
    await tabFinished(first);
    assert.equal(senders.size, 2);
    for (const tab of [first, second]) {
      assert.ok(await tab.getByRole('button', { name: 'Generate review', exact: true }).isEnabled());
      await tab.close();
    }
  }

  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const summary = { cases: ['recorded', 'existing subnet view and shared finite Performance inputs', 'synthetic mixed-provider co-location',
    ...(data.cases.length > 1 ? ['multiple changes', 'unequal changes', 'paired orders', 'executed terminal', 'rejected terminal',
      'failed terminal', 'held locations', 'subnet A→B→A', 'independent browser contexts'] : [])],
    mapChecks, mapPngPalettePixels: colors, recordedDigest: digest, recordedMethods, reviewerMethods: [...calls.values()], nonLocalRequests: external.length };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error('Review status:', await page.locator('#report-status').textContent({ timeout: 2000 }).catch(() => page.url()));
  await capture('failure');
  throw error;
} finally {
  await browser.close();
}
