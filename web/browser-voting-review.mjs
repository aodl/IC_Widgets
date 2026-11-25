// Run with Node after deploying fixture/reviewer/frontend to an isolated local DFX project.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpAgent } from '@icp-sdk/core/agent';

const [project, output] = process.argv.slice(2);
if (!project || !output) throw new Error('Usage: node browser-voting-review.mjs <local DFX project> <output>');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const dfx = (...args) => execFileSync('dfx', args, {
  cwd: project, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
}).trim();
const frontend = dfx('canister', 'id', '--network', 'local', 'frontend');
const reviewer = dfx('canister', 'id', '--network', 'local', 'reviewer');
const host = 'http://' + frontend + '.localhost:4966';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = [];
  const hosts = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => hosts.add(new URL(request.url()).hostname));
  await page.goto(host);
  await page.locator('input[name=first]').fill('144954');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByText('on-demand access requires an authorized principal').waitFor();
  const publicId = (await page.locator('#browser-principal').textContent()).trim();
  assert.match(publicId, /^[a-z2-7-]+$/);
  assert.match(dfx('canister', 'call', '--network', 'local', 'reviewer', 'set_on_demand_caller',
    '(opt principal "' + publicId + '")'), /Ok/);

  let started = Date.now();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('heading', { name: 'Proposal #144954', exact: true }).waitFor({ timeout: 120000 });
  const previewMs = Date.now() - started;
  await page.getByText('40 → 40 members (1 added, 1 removed, 39 retained)', { exact: true }).first().waitFor();
  await page.getByText(/Checked 1 of 96 listed subnet memberships/).waitFor();
  await page.getByRole('button', { name: 'Load detailed analysis' }).focus();
  started = Date.now();
  await page.keyboard.press('Enter');
  await page.getByText('Detailed analysis loaded. Coverage is reported for each dimension.', { exact: true }).waitFor({ timeout: 180000 });
  const detailMs = Date.now() - started;
  const concentration = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Decentralisation and concentration', exact: true }) }).last();
  const row = concentration.getByRole('row').filter({ hasText: 'Registered data-center owner' });
  assert.match(await row.textContent(), /13 \/ 14 nodes → 12 \/ 14 nodes/);
  await page.getByText('10.33 → 9.83', { exact: true }).first().waitFor();
  await page.getByText('3.2655 → 3.2078', { exact: true }).first().waitFor();
  await page.getByText(/The last member registered at zh2 leaves this subnet/).first().waitFor();
  await page.screenshot({ path: resolve(output, '144954-desktop.png'), fullPage: true });

  const map = page.locator('.map-section');
  await map.scrollIntoViewIfNeeded();
  assert.ok(await map.locator('.map-pin').count() > 5);
  const changed = map.getByRole('button', { name: /Removed 1/ }).first();
  await changed.focus();
  await page.keyboard.press('Enter');
  await map.getByText(/tg4ec-/).first().waitFor();
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await map.getByRole('button', { name: 'Pan east' }).click();
  await map.getByRole('button', { name: 'Reset map' }).click();
  await map.getByLabel('Retained', { exact: true }).uncheck();
  assert.ok(await map.locator('.map-pin').count() <= 2);
  await map.getByLabel('Retained', { exact: true }).check();
  const mapPromise = page.waitForEvent('download');
  await map.getByRole('button', { name: 'Export map PNG' }).click();
  await (await mapPromise).saveAs(resolve(output, '144954-map.png'));
  const png = await readFile(resolve(output, '144954-map.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 620]);
  assert.ok(png.length > 50_000);
  await map.screenshot({ path: resolve(output, '144954-map-panel.png') });

  await page.getByLabel('VOTE', { exact: true }).fill('?');
  await page.getByLabel('TLDR', { exact: true }).fill(
    'Registry 66,013 supports the registered zh2 → sh1 swap in tdb26 (40 → 40 members). Data-center and registered-owner concentration rise, while assignments outside the checked subnet remain unverified.');
  await page.getByText('Review preview', { exact: true }).click();
  await page.getByRole('heading', { name: 'Proposal #144954 Review' }).waitFor();
  const mdPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  await (await mdPromise).saveAs(resolve(output, '144954-review.md'));
  const md = await readFile(resolve(output, '144954-review.md'), 'utf8');
  assert.match(md, /\*\*VOTE\*\*: \?/);
  assert.match(md, /13 \/ 14 nodes → 12 \/ 14 nodes/);
  assert.match(md, /Everyware/);
  assert.match(md, /Reproduced with node operator as sixth dimension/);
  assert.match(md, /Assignments outside the checked subnets remain unverified/);
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  await page.getByText('Review Markdown copied.').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), md);

  const phase = page.getByLabel('Membership state', { exact: true });
  await phase.selectOption('0');
  await page.getByText('40 → 40 members (0 added, 0 removed, 40 retained)', { exact: true }).first().waitFor();
  await phase.selectOption('1');
  await page.getByText('40 → 40 members (1 added, 1 removed, 39 retained)', { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 400, height: 830 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: resolve(output, '144954-mobile.png'), fullPage: true });

  await page.getByRole('button', { name: 'Use this scope in Node Performance' }).click();
  assert.match(await page.locator('#performance-context').textContent(), /Filtered to 41 nodes.*66,013/);
  await page.getByRole('button', { name: 'Clear node filter' }).click();
  const agent = await HttpAgent.create({ host: 'http://127.0.0.1:4966', shouldFetchRootKey: true });
  const subnet = (await agent.getSubnetIdFromCanister(reviewer)).toText();
  await page.getByLabel('Subnet principal').fill(subnet);
  await page.getByRole('button', { name: 'Read blockmaking samples' }).click();
  await page.locator('#performance-result').getByText('Source receipts', { exact: true }).waitFor();
  assert.match(await page.locator('#performance-result').textContent(), /node_metrics_history/);
  assert.deepEqual(errors, []);
  assert.ok([...hosts].every(host => host.endsWith('localhost') || host === '127.0.0.1'));
  console.log(JSON.stringify({ previewMs, detailMs, mapBytes: png.length, markdownBytes: Buffer.byteLength(md),
    desktopWidth: 1360, mobileWidth: 400, keyboard: true, localRequestsOnly: true, independentPerformance: true }, null, 2));
} finally {
  await browser.close();
}
