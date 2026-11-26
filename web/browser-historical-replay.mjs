import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Cbor, requestIdOf } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
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
const url = new URL('http://' + id + '.localhost:' + port);
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const external = [];
const errors = [];
const calls = new Map();
const methods = idlFactory({ IDL }).fieldsAsObject();
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin === url.origin) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (!/\/canister\/[^/]+\/call$/.test(request.url())) return;
  const { content } = Cbor.decode(new Uint8Array(request.postDataBuffer()));
  calls.set(Buffer.from(requestIdOf(content)).toString('hex'), content.method_name);
});
const count = method => [...calls.values()].filter(name => name === method).length;
const review = () => page.getByRole('button', { name: 'Review', exact: true }).click();
const exportButton = () => page.getByRole('button', { name: 'Export review', exact: true });
const settled = () => page.locator('#report-status').getByText('Finished with gaps', { exact: true }).waitFor({ timeout: 120000 });
const select = async name => {
  await page.getByLabel('Replay scenario').selectOption(name);
  await page.waitForURL('**/?case=' + name);
  await page.getByText(/Development replay/).waitFor();
  const metadata = data.cases.find(row => row.id === name);
  assert.equal(await page.locator('input[name=first]').inputValue(), metadata.proposalIds[0]);
};
const capture = name => page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
const download = async (button, filename) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const target = resolve(output, filename);
  await (await pending).saveAs(target);
  return readFile(target);
};

try {
  await page.goto(url.toString());
  await select('nns-144954-recorded-open');
  await review();
  await settled();
  assert.equal(count('begin_membership_review'), 1);
  assert.equal(count('membership_target_topology'), 1);
  assert.equal(count('finalize_membership_review'), 1);
  await page.getByText('40 members · +1 added · −1 removed', { exact: true }).waitFor();
  await page.getByText(/1 of 96 listed subnets checked/).waitFor();
  await page.getByText('41 nodes across both states · 41/41 mapped', { exact: true }).waitFor();
  await page.getByText(/Compared with adopted motion #143190.*later amendments have not been verified/).waitFor();
  await capture('recorded-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture('recorded-mobile');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: 'Sources & details', exact: true }).click();
  await page.getByText('Method and exact inputs', { exact: true }).click();
  const wire = await download('Download calculation input (Candid)', 'recorded-calculation.didbin');
  const digest = createHash('sha256').update(wire).digest('hex');
  await exportButton().click();
  const markdown = (await download('Download Markdown', 'recorded-review.md')).toString('utf8');
  assert.ok(markdown.includes(digest));
  assert.match(markdown, /Development replay.*Captured Registry 66,013.*synthetic NNS role/);
  assert.match(markdown, /Current policy applicability and later amendments have not been verified/);
  await download('Export map PNG', 'recorded-map.png');

  await select('multiple-changes');
  await review();
  await settled();
  await page.getByText('5 members · +2 added · −2 removed', { exact: true }).waitFor();
  const changed = page.locator('.changed-nodes button');
  assert.equal(await changed.count(), 4);
  const expected = JSON.parse(await readFile(new URL('../tests/source-fixture/data/historical/expected.json', import.meta.url), 'utf8'));
  const state = Object.values(expected.cases['multiple-changes'].scenarios.A[0])[0];
  const ids = [];
  for (let index = 0; index < 4; index++) {
    await changed.nth(index).click();
    ids.push(await page.getByLabel('Full node principal').inputValue());
  }
  assert.deepEqual(ids.sort(), [...state.added, ...state.removed].sort());
  await page.getByRole('button', { name: 'Close details' }).click();
  await capture('constructed-multiple');

  await select('separate-add-remove');
  await review();
  await settled();
  const order = page.getByLabel('Proposal order');
  const step = page.getByLabel('Membership state');
  await order.selectOption('AThenB');
  await step.selectOption('1');
  await page.locator('.review-summary').getByText(/4 \(\+1\) members/).waitFor();
  await order.selectOption('BThenA');
  await step.selectOption('1');
  await page.locator('.review-summary').getByText(/2 \(−1\) members/).waitFor();
  await capture('constructed-intermediate');

  await select('nns-144954-executed');
  await review();
  await page.getByText(/historical before-state is unavailable/).waitFor();
  assert.ok(await exportButton().isDisabled());
  await capture('executed-terminal');

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
    await page.getByText(/41 locations pending/).waitFor();
    assert.equal(await page.getByText(/Unmapped nodes/).isVisible(), false);
    await capture('loading-locations');
  } finally {
    releaseLocations();
  }
  await settled();
  await page.unroute(detailRoute, waitForLocation);
  await page.getByText('41 nodes across both states · 38/41 mapped', { exact: true }).waitFor();
  await capture('missing-locations');

  await select('untargeted-two-subnets');
  await review();
  await settled();
  const subnet = page.getByLabel('Subnet', { exact: true });
  const initial = await subnet.inputValue();
  const finalChecks = count('finalize_membership_review');
  const comparisons = count('compare_membership_with_policy');
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
  assert.equal(count('compare_membership_with_policy'), comparisons);
  assert.ok(await exportButton().isEnabled());

  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const summary = { cases: ['recorded', 'multiple changes', 'paired orders', 'executed terminal', 'held locations', 'subnet A→B→A'],
    recordedDigest: digest, reviewerMethods: [...calls.values()], nonLocalRequests: external.length };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
