// Test independent certified widgets using the disposable historical replay replica.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request } from 'node:http';
import { Cbor } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { verifyRequestResponsePair } from '@dfinity/response-verification';
import { localCanisters } from './verify-embedded-frontend.mjs';
import { idlFactory } from './src/reviewer.did.js';

const [project, output] = process.argv.slice(2);
if (!project || !output) throw new Error('Usage: node web/browser-composed-view.mjs <disposable project> <output>');
const directory = resolve(output);
await mkdir(directory, { recursive: true });
const aliases = ['nx_host', 'nx_membership', 'nx_membership_second', 'nx_subnet', 'nx_map', 'nx_performance'];
const [host, ...widgets] = await Promise.all(aliases.map(alias => localCanisters(resolve(project), alias)));
const producerOrigins = new Set(widgets.slice(0, 3).map(widget => widget.origin));
const mapOrigin = widgets[3].origin;
const performanceOrigin = widgets[4].origin;
const local = 'http://127.0.0.1:' + host.port;
const root = Cbor.decode(new Uint8Array(await (await fetch(local + '/api/v2/status')).arrayBuffer())).root_key;
const transport = new Set(['access-control-allow-origin', 'access-control-expose-headers', 'connection', 'date',
  'keep-alive', 'set-cookie', 'transfer-encoding', 'vary', 'x-ic-canister-id', 'x-request-id']);
const allowed = new Set(), certified = [];

async function verify(canister, path) {
  const origin = new URL(canister.origin);
  const reply = await new Promise((resolve, reject) => {
    const req = request(local + path, { headers: { host: origin.host, 'accept-encoding': 'identity' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status_code: response.statusCode, body: Buffer.concat(chunks),
        headers: response.rawHeaders.filter((_, index) => index % 2 === 0)
          .map((name, index) => [name.toLowerCase(), response.rawHeaders[2 * index + 1]])
          .filter(([name]) => !transport.has(name)),
      }));
    });
    req.setTimeout(15_000, () => req.destroy(new Error('Gateway response timed out.')));
    req.on('error', reject);
    req.end();
  });
  let proof;
  try {
    proof = verifyRequestResponsePair({ method: 'GET', url: path, headers: [], body: [], certificate_version: [2] },
      reply, Principal.fromText(canister.frontend).toUint8Array(), BigInt(Date.now()) * 1_000_000n,
      300_000_000_000n, root, 2);
  } catch (error) {
    throw new Error(origin.origin + path + ' returned ' + reply.status_code + '. Certificate verification '
      + error.code + ' ' + error.message + '. Headers: ' + reply.headers.map(([key]) => key).join(', '));
  }
  assert.equal(proof.verificationVersion, 2);
  assert.equal(proof.response.statusCode, 200);
  assert.deepEqual(Buffer.from(proof.response.body), reply.body);
  allowed.add(origin.origin + path);
  const csp = new Map(reply.headers).get('content-security-policy');
  certified.push({ url: origin.origin + path, status: proof.response.statusCode, csp });
  return reply.body.toString();
}

for (const path of ['/', '/app.js', '/styles.css', '/bridge.js', '/composition.js', '/storage.js', '/catalogue.json']) {
  await verify(host, path);
}
for (const widget of widgets) {
  const html = await verify(widget, '/embed');
  assert.ok(certified.at(-1).csp.endsWith('frame-ancestors ' + host.origin));
  const assets = [...html.matchAll(/(?:src|href)="\.\/((?:app|styles)\.[a-f0-9]{64}\.[a-z]+)"/g)];
  assert.equal(assets.length, 2);
  for (const [, name] of assets) await verify(widget, '/' + name);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(45_000);
  const denied = [], errors = [], calls = [];
  const origins = new Set([...producerOrigins, performanceOrigin]);
  const reviewers = new Set([host.reviewer, execFileSync('dfx', ['canister', 'id', '--network', 'local', 'reviewer_second'], {
    cwd: resolve(project), env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
  }).trim()]);
  const performanceArgs = idlFactory({ IDL }).fieldsAsObject().node_performance_on_demand.argTypes;
  await page.route('**/*', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (allowed.has(req.url()) && req.method() === 'GET') return route.continue();
    const protocol = /^\/api\/v[234]\/canister\/([-a-z0-9]+)\/(?:call|read_state)$/.exec(url.pathname);
    if (origins.has(url.origin) && ((reviewers.has(protocol?.[1]) && req.method() === 'POST')
        || (url.pathname === '/api/v2/status' && req.method() === 'GET'))) return route.continue();
    denied.push(req.url());
    return route.abort();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/call')) return;
    const { content } = Cbor.decode(new Uint8Array(request.postDataBuffer()));
    const value = { origin: url.origin, method: content.method_name };
    if (value.method === 'node_performance_on_demand') {
      const [subnet, , filter] = IDL.decode(performanceArgs, content.arg);
      Object.assign(value, { subnet: subnet.toText(), nodes: filter[0]?.map(id => id.toText()) ?? null });
    }
    calls.push(value);
  });
  const expected = JSON.parse(await readFile(new URL('../tests/source-fixture/data/historical/expected.json', import.meta.url), 'utf8'));
  const catalogue = JSON.parse(await readFile(resolve(project, 'nexus-catalogue.json'), 'utf8'));
  await page.goto(host.origin);
  const membership = page.frameLocator('iframe[title="Membership"]');
  const overview = page.frameLocator('iframe[title="Subnet overview"]');
  const performance = page.frameLocator('iframe[title="Performance"]');
  const map = page.frameLocator('iframe[title="IC Node Map"]');
  const verifiedViews = [];
  const sorted = values => [...values].sort();

  async function view(name, fixture, id) {
    const oracle = expected.cases[fixture];
    const [subnet, baseline] = Object.entries(oracle.baselines)[0];
    const state = id && oracle.scenarios.A[0][subnet];
    const represented = new Set([...baseline, ...(state?.members ?? [])]);
    const filter = [...represented];
    const start = id ? calls.length : 0;
    const tab = page.getByRole('button', { name, exact: true });
    if (await tab.getAttribute('aria-pressed') !== 'true') await tab.click();
    const producer = id ? membership : overview;
    await producer.locator(id ? '#report-status' : '#subnet-status').getByText(
      id ? 'Data loading complete' : 'Subnet loaded.', { exact: true }).waitFor({ timeout: 150_000 });
    await performance.locator('#performance-context').getByText(new RegExp(
      (id ? 'Proposal #' + id + '.*Before and proposed members' : 'Existing members') + '.*' + filter.length + ' nodes')).waitFor();
    await performance.getByText('Source receipts', { exact: true }).waitFor();
    assert.equal(await producer.locator('.map-frame').count(), 0);
    assert.equal(await page.locator('iframe[title="IC Node Map"]').getAttribute('src'), mapOrigin + '/embed');
    await map.locator('.map-pin').first().waitFor();
    const located = await map.locator('.map-pin').evaluateAll(pins => pins.flatMap(pin => pin.dataset.nodes.split(' ')));
    const unmapped = await map.locator('summary[data-node]').evaluateAll(rows => rows.map(row => row.dataset.node));
    assert.deepEqual(sorted([...located, ...unmapped]), sorted(represented));
    const observedCalls = calls.slice(start);
    const reads = observedCalls.filter(row => row.method === 'node_performance_on_demand');
    assert.equal(reads.length, 1);
    const metrics = reads[0];
    assert.equal(metrics.subnet, subnet);
    assert.deepEqual(sorted(metrics.nodes), sorted(filter));
    const sourceRead = observedCalls.findLastIndex(row => row.method
      === (id ? 'finalize_membership_review' : 'subnet_snapshot_on_demand'));
    assert.ok(sourceRead >= 0 && observedCalls.indexOf(metrics) > sourceRead);
    assert.equal(metrics.origin, performanceOrigin);
    assert.notEqual(observedCalls[sourceRead].origin, metrics.origin);
    assert.equal(await performance.getByLabel('Performance scope').isVisible(), false);
    await map.locator('.map-section').screenshot({ path: resolve(directory, (id ?? 'existing-subnet') + '-map.png') });
    await page.screenshot({ path: resolve(directory, (id ?? 'existing-subnet') + '-workspace.png'), fullPage: true });
    const count = calls.length;
    await map.locator('.map-pin').first().focus();
    await page.keyboard.press('Enter');
    await map.getByRole('region', { name: 'Map location details' }).waitFor();
    assert.equal(calls.length, count);
    let explicitProposed;
    if (id === '144940') {
      const start = calls.length;
      await producer.getByLabel('Connected Performance scope').selectOption('proposed-membership');
      await performance.locator('#performance-context').getByText(/Proposed members.*5 nodes/).waitFor();
      await performance.getByText('Source receipts', { exact: true }).waitFor();
      const scopedReads = calls.slice(start).filter(row => row.method === 'node_performance_on_demand');
      assert.equal(scopedReads.length, 1);
      explicitProposed = scopedReads[0];
      assert.deepEqual(sorted(explicitProposed.nodes), sorted(state.members));
    }
    verifiedViews.push({ name, subnet, before: baseline.length, proposed: state?.members.length ?? null,
      added: state?.added.length ?? null, removed: state?.removed.length ?? null,
      represented: represented.size, metrics, explicitProposed });
  }
  // The initial view runs automatically. Open the workspace from a fresh page so
  // the same input is never submitted twice during verification.
  await view('Existing subnet', 'nns-144954-recorded-open');
  await view('Recorded review', 'nns-144954-recorded-open', '144954');
  await view('Multiple changes', 'multiple-changes', '144940');
  await page.getByRole('button', { name: 'Save dashboard' }).click();
  await page.getByText('Dashboard saved in this browser.', { exact: true }).waitFor();
  const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('network-nexus.dashboard.v1.' + id)), catalogue.dashboard.id);
  assert.deepEqual(saved.views.map(view => view.inputs[0].value), catalogue.dashboard.views.map(view => view.inputs[0].value));
  const settledCalls = calls.length;
  await page.getByRole('textbox', { name: 'proposals', exact: true }).fill('');
  await page.getByRole('button', { name: 'Apply proposals', exact: true }).click();
  await map.locator('#map-widget-status').getByText('Waiting for resolved map evidence.').waitFor();
  assert.equal(await map.locator('.map-frame').count(), 0);
  assert.equal(await performance.getByRole('button', { name: 'Read blockmaking samples' }).isDisabled(), true);
  assert.equal(calls.length, settledCalls);
  assert.deepEqual(denied, []);
  assert.deepEqual(errors, []);
  const summary = { host: host.origin, mapOrigin, certified, views: verifiedViews, calls, denied };
  await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('Verified ' + certified.length + ' certified responses, the same map origin in all views, and exact finite Performance requests.');

} finally {
  await browser.close();
}
