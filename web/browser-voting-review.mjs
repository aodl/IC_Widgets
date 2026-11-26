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
const config = JSON.parse(await readFile(resolve(project, 'dfx.json'), 'utf8'));
const port = config.networks?.local?.bind?.split(':').at(-1) ?? '4966';
const url = 'http://' + frontend + '.localhost:' + port;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = [];
  const external = [];
  const calls = new Map();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    if (host.endsWith('.localhost') || host === '127.0.0.1') return route.continue();
    external.push(host);
    return route.abort();
  });
  page.on('request', request => {
    if (!request.url().endsWith('/canister/' + reviewer + '/call')) return;
    const { content } = Cbor.decode(new Uint8Array(request.postDataBuffer()));
    calls.set(Buffer.from(requestIdOf(content)).toString('hex'), content.method_name);
  });
  const count = method => [...calls.values()].filter(value => value === method).length;
  await page.goto(url);
  await page.locator('input[name=first]').fill('144954');
  await page.locator('#report-status').evaluate(node => {
    window.reviewPhases = [];
    new MutationObserver(() => window.reviewPhases.push([node.textContent, performance.now()]))
      .observe(node, { childList: true });
  });
  const began = Date.now();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('heading', { name: 'World map' }).waitFor();
  await page.getByText('40 members · 39 retained · 1 incoming · 1 outgoing', { exact: true }).waitFor();
  const previewMs = Date.now() - began;
  await page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 120000 });
  const reviewMs = Date.now() - began;
  const observedPhases = await page.evaluate(() => window.reviewPhases);
  const stageTime = prefix => {
    const index = observedPhases.findIndex(([label]) => label.startsWith(prefix));
    assert.ok(index >= 0 && observedPhases[index + 1]);
    return Math.round(observedPhases[index + 1][1] - observedPhases[index][1]);
  };
  const roleMs = stageTime('Reading the pinned Registry role');
  const finalCheckMs = stageTime('Comparison · Checking Governance again');
  const elapsed = await page.locator('#review-elapsed').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#review-elapsed').textContent(), elapsed);
  assert.equal(count('begin_membership_review'), 1);
  assert.equal(count('membership_context_detail_page'), 6);
  assert.equal(count('membership_target_topology'), 0);
  assert.equal(count('compare_membership_context'), 1);
  assert.equal(count('finalize_membership_review'), 1);
  await page.getByText(/assignments in the other 95 listed subnets were not checked/).waitFor();
  await page.getByText(/41 nodes across both states · 41\/41 located/).waitFor();
  const topology = page.locator('.topology-card');
  await topology.getByText(/No Target Topology limits have been assumed/).waitFor();
  const group = name => topology.getByRole('button', { name, exact: true });
  assert.match(await group('Data center · sh1').locator('xpath=ancestor::tr').textContent(), /2 → 3/);
  assert.match(await group('Data center · zh2').locator('xpath=ancestor::tr').textContent(), /Last member.*1 → 0/);
  assert.equal(await page.locator('.map-pin:visible').count(), 41);

  const positions = {};
  for (const [width, height] of [[1366, 900], [1024, 900], [390, 844], [320, 700]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow at ' + width);
    positions[width] = Math.round(await page.locator('canvas').evaluate(canvas => canvas.getBoundingClientRect().top + scrollY));
    if ([1366, 390, 320].includes(width)) {
      await page.screenshot({ path: resolve(output, '144954-' + width + '.png'), fullPage: true });
    }
    assert.ok(positions[width] < height, 'Map starts at ' + positions[width] + 'px in a ' + width + '×' + height + ' viewport');
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  const info = topology.getByRole('button', { name: 'About Data center' }).first();
  await info.hover();
  await page.getByRole('tooltip').hover();
  await page.getByRole('tooltip').getByText(/facility ID/).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await info.focus();
  await page.getByRole('tooltip').waitFor();
  await page.keyboard.press('Escape');
  await info.click();
  await page.getByRole('tooltip').waitFor();
  await page.keyboard.press('Escape');
  const row = group('Data center · sh1');
  await row.focus();
  await page.keyboard.press('Enter');
  const inspector = page.locator('.inspector');
  await inspector.getByText(/Nakamoto coefficient.*13 → 12/).waitFor();
  await inspector.getByText(/5% → 7.5%/).waitFor();
  assert.equal(await inspector.getByRole('button', { name: / · sh1 · Stockholm$/ }).count(), 3);
  assert.ok(await page.locator('.map-pin[aria-pressed=true]').count() > 0);
  await inspector.getByRole('button', { name: /kaoz3/ }).click();
  assert.match(await inspector.getByLabel('Full node principal').inputValue(), /^kaoz3-.*-4qe$/);
  await inspector.getByRole('button', { name: 'Copy node ID' }).click();
  await inspector.getByText('Node ID copied.').waitFor();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Sources & details', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Pinned Registry role$/ }).click();
  await page.getByText(/Registry nns_subnet_id · Mutation version 66,013/).waitFor();
  await page.getByText('Source receipts and timings', { exact: true }).click();
  const sourceUsage = await inspector.getByRole('table').last().innerText();
  await page.getByText('Method and exact inputs', { exact: true }).click();
  const inputDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download calculation input (Candid)' }).click();
  const input = await inputDownload;
  await input.saveAs(resolve(output, '144954-calculation.didbin'));
  const hash = createHash('sha256').update(await readFile(resolve(output, '144954-calculation.didbin'))).digest('hex');
  assert.equal(input.suggestedFilename(), 'calculation-' + hash + '.didbin');
  await page.getByRole('button', { name: 'Focus changes', exact: true }).click();
  await page.getByRole('button', { name: 'Export review', exact: true }).click();
  for (const [label, name] of [['Export map PNG', '144954-map.png'], ['Download Markdown', '144954-review.md']]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    await (await download).saveAs(resolve(output, name));
  }
  const md = await readFile(resolve(output, '144954-review.md'), 'utf8');
  for (const fact of [hash, 'Changed Nakamoto coefficients', 'Proposer comparison', 'zh2 | 1 → 0', 'Digital Realty',
    'Data loading complete', '40 members', '2 → 3', 'assignments in the other 95 listed subnets were not checked']) {
    assert.ok(md.includes(fact), 'Markdown missing ' + fact);
  }
  const png = await readFile(resolve(output, '144954-map.png'));
  assert.ok(png.readUInt32BE(16) >= 1080);
  assert.ok(png.readUInt32BE(20) > 340);

  await page.locator('#open-performance').click();
  await page.getByText('Independent subnet scope.', { exact: true }).waitFor();
  const agent = await HttpAgent.create({ host: 'http://127.0.0.1:' + port, shouldFetchRootKey: true });
  const subnet = (await agent.getSubnetIdFromCanister(reviewer)).toText();
  await page.getByLabel('Subnet principal').fill(subnet);
  await page.getByRole('button', { name: 'Read blockmaking samples' }).click();
  await page.locator('#performance-result').getByText('Source receipts', { exact: true }).waitFor();
  assert.match(await page.locator('#performance-result').textContent(), /node_metrics_history/);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ previewMs, reviewMs, roleMs, finalCheckMs, positions, hash, sourceUsage,
    methods: [...calls.values()], keyboardInspector: true, externalOrigins: external }, null, 2));
} finally {
  await browser.close();
}
