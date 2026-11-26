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
  const principal = (await page.locator('#browser-principal').textContent()).trim();
  assert.match(dfx('canister', 'call', '--network', 'local', 'reviewer', 'set_on_demand_caller',
    '(opt principal "' + principal + '")'), /Ok/);
  await page.locator('#report-status').evaluate(node => {
    window.reviewPhases = [];
    new MutationObserver(() => window.reviewPhases.push([node.textContent, performance.now()]))
      .observe(node, { childList: true });
  });
  const began = Date.now();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('heading', { name: 'World map' }).waitFor();
  await page.getByText('40 members · +1 added · −1 removed', { exact: true }).waitFor();
  await page.getByRole('list', { name: 'Review stages' }).getByText(/Membership · Ready/).waitFor();
  const previewMs = Date.now() - began;
  await page.locator('#report-status').getByText('Finished with gaps', { exact: true }).waitFor({ timeout: 120000 });
  const reviewMs = Date.now() - began;
  const observedPhases = await page.evaluate(() => window.reviewPhases);
  const stageTime = prefix => {
    const index = observedPhases.findIndex(([label]) => label.startsWith(prefix));
    assert.ok(index >= 0 && observedPhases[index + 1]);
    return Math.round(observedPhases[index + 1][1] - observedPhases[index][1]);
  };
  const policyMs = stageTime('Locations and policy · Checking');
  const finalCheckMs = stageTime('Comparison · Checking Governance again');
  const elapsed = await page.locator('#review-elapsed').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#review-elapsed').textContent(), elapsed);
  assert.equal(count('begin_membership_review'), 1);
  assert.equal(count('membership_context_detail_page'), 6);
  assert.equal(count('membership_target_topology'), 1);
  assert.equal(count('compare_membership_with_policy'), 1);
  assert.equal(count('finalize_membership_review'), 1);
  await page.getByText(/1 of 96 listed subnets checked/).waitFor();
  await page.getByText('41 nodes across both states · 41/41 mapped', { exact: true }).waitFor();
  await page.locator('.topology-status').getByText('Compared with adopted motion #143190').waitFor();
  const topology = page.locator('.topology-card');
  const measure = name => topology.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
  assert.match(await measure('Subnet size').textContent(), /40.*40 target.*Matches target/);
  assert.match(await measure('Data center').textContent(), /3 \(\+1\).*1 cap.*Exception unresolved/);
  assert.match(await measure('Registered DC owner').textContent(), /3 \(\+1\).*Identity unresolved/);
  assert.match(await measure('Country label').textContent(), /3 cap.*Identity unresolved/);
  assert.match(await measure('Data center').textContent(), /sh1.*zh2.*0 \(−1\).*Last member/);
  assert.match(await measure('Registered DC owner').textContent(), /Digital Realty/);
  assert.match(await measure('Node provider').textContent(), /Added and removed nodes share/);
  assert.equal(await page.getByRole('button', { name: 'Before', exact: true }).count(), 0);

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
  const info = topology.getByRole('button', { name: 'About Data center' });
  await info.hover();
  await page.getByRole('tooltip').hover();
  await page.getByRole('tooltip').getByText(/registered facility/).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await info.focus();
  await page.getByRole('tooltip').waitFor();
  await page.keyboard.press('Escape');
  await info.click();
  await page.getByRole('tooltip').waitFor();
  await page.keyboard.press('Escape');
  const row = topology.getByRole('button', { name: 'Data center', exact: true });
  await row.focus();
  await page.keyboard.press('Enter');
  const inspector = page.locator('.inspector');
  await inspector.getByText(/12 \(−1\) groups · Threshold 14 nodes/).waitFor();
  await inspector.getByText(/7.5% \(\+2.5 percentage points\)/).waitFor();
  assert.equal(await inspector.getByRole('button', { name: / · sh1 · Stockholm$/ }).count(), 3);
  assert.ok(await page.locator('.map-pin[aria-pressed=true]').count() > 0);
  await inspector.getByRole('button', { name: /kaoz3/ }).click();
  assert.match(await inspector.getByLabel('Full node principal').inputValue(), /^kaoz3-.*-4qe$/);
  await inspector.getByRole('button', { name: 'Copy node ID' }).click();
  await inspector.getByText('Node ID copied.').waitFor();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Sources & details', exact: true }).click();
  await page.getByText('Policy and pinned Registry role', { exact: true }).click();
  await page.getByText(/Registry nns_subnet_id · Mutation version 66,013/).waitFor();
  const policyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Governance policy reply' }).click();
  await (await policyDownload).saveAs(resolve(output, '143190-governance.didbin'));
  const policyHash = createHash('sha256').update(await readFile(resolve(output, '143190-governance.didbin'))).digest('hex');
  assert.equal(policyHash, '9f2e78492a227992e5b413eca5f38e6a7eaa31f109ab164d400ea3f954d28053');
  const sourceUsage = await inspector.locator('p').filter({ hasText: /source calls ·.* reply bytes|ms source stage ·.* instructions/ }).allTextContents();
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
  for (const fact of [hash, policyHash, 'Changed Nakamoto coefficients', 'Proposer comparison', 'zh2 0 (−1)', 'Digital Realty', 'Finished with gaps', '40 members', '3 (+1)', 'Exception unresolved', 'Assignment coverage 1 of 96']) {
    assert.ok(md.includes(fact), 'Markdown missing ' + fact);
  }
  const png = await readFile(resolve(output, '144954-map.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 620]);

  await page.locator('#open-performance').click();
  await page.getByText('Independent subnet scope.', { exact: true }).waitFor();
  const agent = await HttpAgent.create({ host: 'http://127.0.0.1:4966', shouldFetchRootKey: true });
  const subnet = (await agent.getSubnetIdFromCanister(reviewer)).toText();
  await page.getByLabel('Subnet principal').fill(subnet);
  await page.getByRole('button', { name: 'Read blockmaking samples' }).click();
  await page.locator('#performance-result').getByText('Source receipts', { exact: true }).waitFor();
  assert.match(await page.locator('#performance-result').textContent(), /node_metrics_history/);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ previewMs, reviewMs, policyMs, finalCheckMs, positions, hash, policyHash, sourceUsage,
    methods: [...calls.values()], keyboardInspector: true, externalOrigins: external }, null, 2));
} finally {
  await browser.close();
}
