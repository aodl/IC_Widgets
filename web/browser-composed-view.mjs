// Test independent certified widgets using the disposable historical replay replica.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
const aliases = ['nx_host', 'nx_membership', 'nx_membership_second', 'nx_performance'];
const [host, ...widgets] = await Promise.all(aliases.map(alias => localCanisters(resolve(project), alias)));
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
  const origins = new Set(widgets.map(widget => widget.origin));
  const reviewers = new Set([host.reviewer, execFileSync('dfx', ['canister', 'id', '--network', 'local', 'reviewer_4'], {
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
      Object.assign(value, { subnet: subnet.toText(), nodes: filter[0].map(id => id.toText()) });
    }
    calls.push(value);
  });
  await page.goto(host.origin);
  const membership = page.frameLocator('iframe[title="Membership"]');
  const performance = page.frameLocator('iframe[title="Performance"]');
  async function review(id, members) {
    await membership.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 150_000 });
    await performance.locator('#performance-context').getByText(new RegExp('Proposal #' + id + '.*' + members + ' nodes')).waitFor();
    await performance.getByText('Source receipts', { exact: true }).waitFor();
    const samples = calls.filter(row => row.method === 'node_performance_on_demand').at(-1);
    assert.ok(samples);
    assert.equal(samples.nodes.length, members);
    assert.equal(new Set(samples.nodes).size, members);
    const final = calls.findLastIndex(row => row.method === 'finalize_membership_review');
    assert.ok(final >= 0 && calls.indexOf(samples) > final);
    assert.equal(samples.origin, widgets[2].origin);
    assert.notEqual(calls[final].origin, samples.origin);
  }
  await review('144954', 40);
  await page.screenshot({ path: resolve(directory, 'nexus-composed-replay.png'), fullPage: true });
  await page.getByRole('button', { name: 'Multiple changes', exact: true }).click();
  await review('144940', 5);
  await page.getByRole('button', { name: 'Save dashboard' }).click();
  await page.getByText('Dashboard saved in this browser.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Multiple changes', exact: true }).waitFor();
  assert.deepEqual(denied, []);
  assert.deepEqual(errors, []);
  const summary = { host: host.origin, certified, cases: ['144954', '144940'], calls, denied };
  await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('Verified ' + certified.length + ' certified responses, two independently framed reviews and automatic finite Performance requests.');
} finally {
  await browser.close();
}
