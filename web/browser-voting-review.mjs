// Run against the isolated local DFX project loaded with load_voting_reference.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Cbor, HttpAgent, requestIdOf } from '@icp-sdk/core/agent';

const [project, output] = process.argv.slice(2);
if (!project || !output) throw new Error('Usage: node browser-voting-review.mjs <local DFX project> <output>');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const dfx = (...args) => execFileSync('dfx', args, {
  cwd: project, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
}).trim();
const frontend = dfx('canister', 'id', '--network', 'local', 'frontend');
const reviewer = dfx('canister', 'id', '--network', 'local', 'reviewer');
const url = 'http://' + frontend + '.localhost:4966';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = [];
  const hosts = new Set();
  const calls = new Map();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    hosts.add(new URL(request.url()).hostname);
    if (!request.url().endsWith('/canister/' + reviewer + '/call')) return;
    const { content } = Cbor.decode(new Uint8Array(request.postDataBuffer()));
    calls.set(Buffer.from(requestIdOf(content)).toString('hex'), content.method_name);
  });
  const count = method => [...calls.values()].filter(value => value === method).length;
  await page.goto(url);
  await page.locator('input[name=first]').fill('144954');
  const review = page.getByRole('button', { name: 'Review', exact: true });
  await review.click();
  await page.getByText(/Pilot authorization required/).waitFor();
  const principal = (await page.locator('#browser-principal').textContent()).trim();
  assert.match(principal, /^[a-z2-7-]+$/);
  assert.match(dfx('canister', 'call', '--network', 'local', 'reviewer', 'set_on_demand_caller',
    '(opt principal "' + principal + '")'), /Ok/);
  await page.getByText('Pilot access', { exact: true }).click();
  calls.clear();
  const began = Date.now();
  await review.click();
  const map = page.locator('.map-section');
  await map.getByRole('heading', { name: 'World map' }).waitFor();
  await page.getByText('40 → 40 members (1 added, 1 removed, 39 retained)', { exact: true }).waitFor();
  const previewMs = Date.now() - began;
  await page.getByText(/Analysis loaded · assignment checks remain partial/).waitFor({ timeout: 120000 });
  const reviewMs = Date.now() - began;
  assert.equal(count('review_on_demand'), 1);
  assert.equal(count('membership_detail_page'), 6);
  assert.equal(count('compare_membership_details'), 2);
  assert.equal(await page.getByRole('button', { name: 'Load detailed analysis' }).count(), 0);
  await page.getByText(/Checked 1 of 96 listed subnets/).waitFor();
  await page.getByText('Changes · 41 distinct nodes · 41/41 mapped', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Provider distribution unchanged' }).waitFor();
  await page.getByText(/Registered replacement · Zurich → Stockholm/).waitFor();
  const departure = await page.getByRole('button', { name: 'Last zh2 member leaves' }).locator('..').textContent();
  assert.match(departure, /Zurich 2 → 1/);
  assert.match(departure, /Switzerland 3 → 2/);
  assert.ok(await map.getByRole('button', { name: /Removed 1/ }).count());
  assert.ok(await map.getByRole('button', { name: /Added 1/ }).count());

  const positions = {};
  for (const [width, height] of [[1366, 900], [1024, 900], [390, 844], [320, 700]]) {
    await page.setViewportSize({width, height});
    const overflow = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= window.innerWidth) return [];
      return [document.documentElement.scrollWidth, ...[...document.querySelectorAll('body *')]
        .filter(node => node.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 12).map(node => `${node.tagName}.${node.className} ${node.getBoundingClientRect().right}`)];
    });
    assert.deepEqual(overflow, [], `Page content overflows at ${width}px`);
    positions[width] = Math.round(await map.locator('canvas').evaluate(canvas => canvas.getBoundingClientRect().top + scrollY));
    assert.ok(positions[width] < height, `The map starts below the first viewport at ${width}px (${positions[width]}px)`);
    if (width === 1366 || width === 390) {
      await page.screenshot({ path: resolve(output, '144954-' + (width === 1366 ? 'desktop' : 'mobile') + '.png'), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  const finding = page.getByRole('button', { name: 'Concentration increases at sh1', exact: true });
  await finding.focus();
  await page.keyboard.press('Enter');
  const inspector = page.locator('.inspector');
  await inspector.getByText(/3 nodes selected/).waitFor();
  assert.equal(await inspector.locator('.node-card').count(), 3);
  assert.ok(await inspector.getByRole('heading').evaluate(heading => {
    const rect = heading.getBoundingClientRect();
    return document.activeElement === heading && rect.top >= 0 && rect.bottom <= innerHeight;
  }));
  await inspector.getByRole('button', { name: /Details · kaoz3/ }).focus();
  await page.keyboard.press('Enter');
  assert.match(await inspector.getByLabel('Full node principal').inputValue(), /^kaoz3-.*-4qe$/);
  await inspector.getByRole('button', { name: 'Copy node ID' }).click();
  await inspector.getByText(/copied/).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await inspector.isVisible(), false);
  await map.getByRole('button', { name: 'Before', exact: true }).click();
  await page.getByText('Before · 40 members · 40/40 mapped', { exact: true }).waitFor();
  await map.getByRole('button', { name: 'After', exact: true }).click();
  await page.getByText('After · 40 members · 40/40 mapped', { exact: true }).waitFor();
  await map.getByRole('button', { name: 'Changes', exact: true }).click();
  assert.equal(count('membership_detail_page'), 6);

  await page.getByRole('button', { name: 'Concentration', exact: true }).click();
  const owner = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Registered data-center owner', exact: true }) });
  assert.match(await owner.textContent(), /39 → 38.*13 \/ 14 nodes → 12 \/ 14 nodes/);
  await page.getByText('Data center distribution', { exact: true }).click();
  await page.getByRole('button', { name: 'sh1', exact: true }).click();
  await inspector.getByText(/3 nodes selected/).waitFor();
  assert.match(await owner.textContent(), /39 → 38/);
  await inspector.getByRole('button', {name:'Close details'}).click();
  await page.getByRole('button', { name: 'All consequences', exact: true }).click();
  assert.ok(await page.locator('.all-consequences').evaluate(details => details.open && details.contains(document.activeElement)));
  await page.getByRole('button', { name: 'Claims', exact: true }).click();
  await page.getByText('Decommissioning of DC zh2', { exact: true }).waitFor();
  await page.locator('.review-pane').getByText(/Last zh2 member leaves.*Zurich 2 → 1/).waitFor();
  await page.getByRole('button', { name: 'Coverage', exact: true }).click();
  await page.locator('.review-pane > div > p').filter({ hasText: /^Pinned Registry version 66,013$/ }).waitFor();
  const sourceUsage = await page.locator('.review-pane p').filter({
    hasText: /source calls ·.* reply bytes|ms source stage ·.* instructions/,
  }).allTextContents();
  assert.equal(sourceUsage.length, 14);
  await page.getByText('Registry references', { exact: true }).click();
  await page.getByText('Confirmed absent at baseline', { exact: true }).first().waitFor();
  await page.getByText('Method and exact inputs', { exact: true }).click();
  const inputDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download calculation input (Candid)' }).click();
  const file = await inputDownload;
  await file.saveAs(resolve(output, '144954-calculation.didbin'));
  const hash = createHash('sha256').update(await readFile(resolve(output, '144954-calculation.didbin'))).digest('hex');
  assert.equal(file.suggestedFilename(), 'calculation-' + hash + '.didbin');

  await map.getByRole('button', {name:'Focus changes', exact:true}).click();
  await page.getByRole('button', { name: 'Export review', exact: true }).click();
  const imageDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export map PNG' }).click();
  const pngFile = await imageDownload;
  assert.match(pngFile.suggestedFilename(), /144954.*66013/);
  await pngFile.saveAs(resolve(output, '144954-map.png'));
  const png = await readFile(resolve(output, '144954-map.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 620]);
  const example = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  await (await example).saveAs(resolve(output, '144954-review.md'));
  await page.getByLabel('VOTE', { exact: true }).fill('Example assessment');
  await page.getByLabel('TLDR', { exact: true }).fill('Review concentration and assignment coverage.');
  await page.getByLabel('Uploaded map image URL (optional)', { exact: true }).fill('https://example.test/144954.png');
  const mdDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  const md = await readFile(await (await mdDownload).path(), 'utf8');
  assert.ok(md.includes(hash) && md.includes('40 → 40 members') && md.includes('13 / 14 nodes → 12 / 14 nodes'));
  assert.match(md, /Assignments outside the checked subnets remain unverified/);
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  await page.getByText('Review Markdown copied.').waitFor();
  await page.getByLabel('TLDR', { exact:true }).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
  assert.equal(await page.getByLabel('TLDR', { exact:true }).inputValue(), md);
  await page.getByLabel('TLDR', { exact:true }).fill('Review concentration and assignment coverage.');
  const phase = page.getByLabel('Membership state', {exact:true});
  await phase.selectOption('0');
  await page.getByText(/Analysis loaded · assignment checks remain partial/).waitFor();
  assert.equal(await page.getByLabel('VOTE', {exact:true}).inputValue(), '?');
  assert.equal(await page.getByLabel('Uploaded map image URL (optional)', {exact:true}).inputValue(), '');
  await phase.selectOption('1');
  assert.equal(await page.getByLabel('VOTE', {exact:true}).inputValue(), 'Example assessment');
  assert.equal(await page.getByLabel('Uploaded map image URL (optional)', {exact:true}).inputValue(), 'https://example.test/144954.png');
  assert.equal(count('membership_detail_page'), 6);
  assert.equal(count('compare_membership_details'), 3);

  await page.getByRole('navigation', {name:'Review views'}).getByRole('button', {name:'Performance',exact:true}).click();
  await page.getByLabel('Performance scope').selectOption('follow');
  await page.getByLabel('Node filter').selectOption('incoming');
  await page.getByText(/After #144954 · Registry 66,013 · 1 node\./).waitFor();
  await phase.selectOption('0');
  await page.getByText(/Baseline · Registry 66,013 · 0 nodes/).waitFor();
  await page.getByLabel('Performance scope').selectOption('independent');
  const agent = await HttpAgent.create({ host: 'http://127.0.0.1:4966', shouldFetchRootKey: true });
  const subnet = (await agent.getSubnetIdFromCanister(reviewer)).toText();
  await page.getByLabel('Subnet principal').fill(subnet);
  await page.getByRole('button', { name: 'Read blockmaking samples' }).click();
  await page.locator('#performance-result').getByText('Source receipts', { exact: true }).waitFor();
  assert.match(await page.locator('#performance-result').textContent(), /node_metrics_history/);

  await page.getByRole('button', { name: 'Export review', exact: true }).click();
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    const click = HTMLAnchorElement.prototype.click;
    window.pngDownloads = 0;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith('.png')) window.pngDownloads++;
      return click.call(this);
    };
    HTMLCanvasElement.prototype.toBlob = function (complete, ...args) {
      toBlob.call(this, blob => { window.finishPngExport = () => complete(blob); }, ...args);
    };
  });
  await page.getByRole('button', { name: 'Export map PNG' }).click();
  await page.waitForFunction(() => typeof window.finishPngExport === 'function');
  await page.locator('input[name=first]').fill('999999');
  await review.click();
  await page.getByRole('heading', { name: 'Proposal #999999' }).waitFor();
  assert.equal(await page.evaluate(() => { window.finishPngExport(); return window.pngDownloads; }), 0);
  await page.getByText(/Simulation unavailable.*999999/).waitFor();
  assert.equal(await page.getByLabel('VOTE', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  assert.ok([...hosts].every(host => host.endsWith('localhost') || host === '127.0.0.1'));
  console.log(JSON.stringify({ previewMs, reviewMs, positions, hash, mobileNoOverflow: true,
    detailPages: count('membership_detail_page'), sourceUsage, keyboardInspector: true,
    exportConsistent: true, supersededPngDiscarded: true, independentPerformance: true }, null, 2));
} finally {
  await browser.close();
}
