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
const aliases = ['nx_host', 'nx_membership', 'nx_membership_second', 'nx_subnet', 'nx_map', 'nx_performance', 'nx_activity', 'nx_inspector'];
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
  const page = await browser.newPage({ viewport: { width: 1348, height: 926 }, serviceWorkers: 'block', acceptDownloads: true });
  const timings = {};
  const workflow = {};
  const now = () => globalThis.performance.now();
  const measure = start => Math.round(now() - start);
  const activeFrame = name => '#current > section:not([hidden]) iframe[title="' + name + '"]';
  page.setDefaultTimeout(45_000);
  const denied = [], errors = [], calls = [];
  let rejectActivity = false;
  let holdMembership;
  const origins = new Set([...producerOrigins, performanceOrigin, widgets[5].origin, widgets[6].origin]);
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
        || (url.pathname === '/api/v2/status' && req.method() === 'GET'))) {
      if (rejectActivity && url.origin === widgets[5].origin && url.pathname.endsWith('/call')
          && Cbor.decode(new Uint8Array(req.postDataBuffer())).content.method_name === 'subnet_activity') {
        return route.fulfill({ status: 403, body: 'Simulated discovery failure' });
      }
      if (holdMembership && url.origin === widgets[6].origin && url.pathname.endsWith('/call')
          && Cbor.decode(new Uint8Array(req.postDataBuffer())).content.method_name === 'begin_membership_review') {
        const held = holdMembership;
        holdMembership = undefined;
        held.arrived();
        return held.release.then(() => route.continue());
      }
      return route.continue();
    }
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
  const membership = page.frameLocator(activeFrame('Membership'));
  const overview = page.frameLocator(activeFrame('Subnet overview'));
  const performance = page.frameLocator(activeFrame('Performance'));
  const map = page.frameLocator(activeFrame('IC Node Map'));
  const verifiedViews = [];
  async function performanceSettled() {
    await performance.locator('#performance-form button:not([disabled])').waitFor();
    return performance.locator('#performance-status').textContent();
  }
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
      id ? 'Membership calculation complete' : 'Subnet loaded.', { exact: true }).waitFor({ timeout: 150_000 });
    await performance.locator('#performance-context').getByText(new RegExp(
      (id ? 'Proposal #' + id + '.*All related nodes' : 'Existing') + '.*' + filter.length + ' nodes')).waitFor();
    const performanceStatus = await performanceSettled();
    assert.equal(await producer.locator('.map-frame').count(), 0);
    assert.equal(await page.locator(activeFrame('IC Node Map')).getAttribute('src'), mapOrigin + '/embed');
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
      await performance.locator('#performance-context').getByText(/Proposed.*5 nodes/).waitFor();
      await performanceSettled();
      const scopedReads = calls.slice(start).filter(row => row.method === 'node_performance_on_demand');
      assert.equal(scopedReads.length, 1);
      explicitProposed = scopedReads[0];
      assert.deepEqual(sorted(explicitProposed.nodes), sorted(state.members));
    }
    verifiedViews.push({ name, subnet, before: baseline.length, proposed: state?.members.length ?? null,
      added: state?.added.length ?? null, removed: state?.removed.length ?? null,
      represented: represented.size, metrics, performanceStatus, explicitProposed });
  }
  // The initial view runs automatically. Open the workspace from a fresh page so
  // the same input is never submitted twice during verification.
  await view('Existing subnet', 'nns-144954-recorded-open');
  await view('Recorded review', 'nns-144954-recorded-open', '144954');
  await view('Multiple changes', 'multiple-changes', '144940');
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  await page.getByRole('button', { name: 'Save dashboard' }).click();
  await page.getByText('Dashboard saved in this browser.', { exact: true }).waitFor();
  const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('network-nexus.dashboard.v1.' + id)), catalogue.dashboard.id);
  assert.deepEqual(saved.views.map(view => view.inputs), catalogue.dashboard.views.map(view => view.inputs));
  const settledCalls = calls.length;
  await page.getByRole('textbox', { name: 'proposals', exact: true }).fill('');
  await page.getByRole('button', { name: 'Apply proposals', exact: true }).click();
  await map.locator('#map-widget-status').getByText('Waiting for resolved map evidence.').waitFor();
  assert.equal(await map.locator('.map-frame').count(), 0);
  assert.equal(await performance.getByRole('button', { name: 'Read blockmaking samples' }).isDisabled(), true);
  assert.equal(calls.length, settledCalls);
  function fixture(id) {
    execFileSync('dfx', ['canister', 'call', '--network', 'local', '--candid', 'fixture.did',
      'fixture', 'load_composition_case', '(' + JSON.stringify(id) + ')'], {
      cwd: resolve(project), env: { ...process.env, DFX_IDENTITY: 'codex_local' }, stdio: 'pipe',
    });
  }
  fixture('nns-144954-recorded-open');
  const activity = page.frameLocator(activeFrame('Subnet Activity'));
  const inspector = page.frameLocator(activeFrame('Membership inspector'));
  const activityWidget = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Subnet Activity', exact: true }) });
  const scope = inspector.getByLabel('Connected Performance scope');
  const activityViews = [];

  function membershipStatus() {
    return inspector.locator('#report-status').getByText('Membership calculation complete', { exact: true });
  }

  async function review(id) {
    const control = activity.locator('button').filter({ hasText: new RegExp('^Review #' + id + '$') });
    if (!await control.first().isVisible()) {
      const group = activity.locator('details').filter({ has: control });
      if (await group.count()) await group.first().locator(':scope > summary').click();
    }
    await control.first().click();
  }

  async function inspectCurrent(subnet) {
    await activity.getByRole('button', { name: 'All subnets', exact: true }).click();
    const row = activity.locator('summary').filter({ hasText: subnet.slice(0, 11) }).first();
    if (!await row.locator('..').getByRole('button', { name: 'Inspect current membership' }).isVisible()) await row.click();
    await row.locator('..').getByRole('button', { name: 'Inspect current membership' }).click();
  }

  async function assertConnected(start, fixtureName, id, target) {
    const oracle = expected.cases[fixtureName];
    const subnet = target ?? Object.keys(oracle.baselines)[0];
    const baseline = oracle.baselines[subnet];
    const state = id && oracle.scenarios.A[0][subnet];
    const members = [...new Set([...baseline, ...(state?.members ?? [])])];
    if (id) await membershipStatus().waitFor({ timeout: 150_000 });
    else await inspector.locator('#subnet-status').getByText('Subnet loaded.', { exact: true }).waitFor({ timeout: 150_000 });
    const sample = members[0];
    await map.locator('[data-nodes~="' + sample + '"], summary[data-node="' + sample + '"]').first().waitFor({ state: 'attached' });
    const located = await map.locator('.map-pin').evaluateAll(pins => pins.flatMap(pin => pin.dataset.nodes.split(' ')));
    const unmapped = await map.locator('summary[data-node]').evaluateAll(rows => rows.map(row => row.dataset.node));
    assert.deepEqual(sorted([...located, ...unmapped]), sorted(members));
    assert.equal(await inspector.locator('.map-frame').count(), 0);
    assert.equal(await activity.locator('.map-frame, #report, #performance').count(), 0);
    await performance.locator('#performance-context').getByText(new RegExp((id ? 'Proposal #' + id + '.*All related nodes' : 'Existing')
      + '.*' + members.length + ' nodes')).waitFor();
    const performanceStatus = await performanceSettled();
    const reads = calls.slice(start).filter(row => row.method === 'node_performance_on_demand');
    assert.equal(reads.length, 1);
    assert.equal(reads[0].subnet, subnet);
    assert.deepEqual(sorted(reads[0].nodes), sorted(members));
    assert.equal(reads[0].origin, performanceOrigin);
    assert.equal(await page.locator(activeFrame('IC Node Map')).getAttribute('src'), mapOrigin + '/embed');
    activityViews.push({ id: id ?? 'current-subnet', existing: baseline.length, proposed: state?.members.length, metrics: reads[0], performanceStatus });
    return { subnet, state };
  }

  const dashboardSettings = page.getByText('Dashboard settings', { exact: true });
  if (await dashboardSettings.isVisible()) await dashboardSettings.click();
  await page.getByRole('textbox', { name: 'New dashboard name' }).fill('Guest review workspace');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Create dashboard', exact: true }).click();
  await page.getByText('This view is empty. Open Edit dashboard to add widgets.').waitFor();
  const viewSettings = page.getByText('View settings', { exact: true });
  if (await viewSettings.isVisible()) await viewSettings.click();
  await page.getByRole('textbox', { name: 'New view name' }).fill('Subnet proposal review');
  await page.getByRole('button', { name: 'Create view', exact: true }).click();
  await page.locator('#current > section:not([hidden])').getByLabel('Layout').selectOption('three-column');
  const cold = now();
  await page.locator('#current > section:not([hidden])').getByLabel('Add widget').selectOption('activity');
  await activity.getByText('Checking Governance proposals and resolving affected subnets against the Registry.').waitFor();
  timings.initialProgressMs = measure(cold);
  await page.screenshot({ path: resolve(directory, 'activity-cold-arrival.png') });
  await activity.getByText(/1 distinct observed Membership proposal/).waitFor();
  timings.coldDiscoveryMs = measure(cold);
  for (const definition of ['inspector', 'map', 'performance']) {
    await page.locator('#current > section:not([hidden])').getByLabel('Add widget').selectOption(definition);
  }
  async function connect(title, port, source) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await card.getByText('Widget settings', { exact: true }).click();
    await card.getByLabel('Input ' + port, { exact: true }).selectOption({ label: source });
  }
  await connect('Membership inspector', 'subject', 'Subnet Activity · subject');
  await connect('IC Node Map', 'scene', 'Membership inspector · scene');
  await connect('Performance', 'filter', 'Membership inspector · filter');
  await page.getByRole('button', { name: 'Save dashboard' }).click();
  await page.getByText('Dashboard saved in this browser.', { exact: true }).waitFor();
  await activity.getByText(/1 distinct observed Membership proposal/).waitFor();
  const arrival = now();
  const beforeWarm = calls.length;
  await page.reload();
  await page.getByLabel('Dashboard', { exact: true }).getByRole('option', { name: 'Guest review workspace' }).waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('button', { name: 'Subnet proposal review' }).getAttribute('aria-pressed'), 'true');
  await activity.getByText(/1 distinct observed Membership proposal/).waitFor();
  timings.warmArrivalMs = measure(arrival);
  assert.equal(calls.length, beforeWarm);
  assert.equal(await page.locator('#current > section:not([hidden]) .widgets.three-column').count(), 1);
  await page.screenshot({ path: resolve(directory, 'activity-warm-arrival.png') });
  await inspector.getByText('Select a proposal or subnet to inspect.', { exact: true }).waitFor();
  assert.equal(calls.filter(row => row.origin === widgets[6].origin && row.method === 'begin_membership_review').length, 0);
  let start = calls.length;
  const selectionStarted = now();
  await activity.locator('.activity-direct button').first().click();
  await inspector.getByRole('heading', { name: 'Proposer’s stated purpose' }).first().waitFor();
  timings.firstPurposeMs = measure(selectionStarted);
  await membershipStatus().waitFor();
  timings.membershipReadyMs = measure(selectionStarted);
  const { subnet } = await assertConnected(start, 'nns-144954-recorded-open', '144954');
  timings.performanceSettledMs = measure(selectionStarted);
  const stable = calls.length;
  const framesBefore = await page.locator('#current > section:not([hidden]) iframe').evaluateAll(frames => frames.map((frame, index) => {
    frame.dataset.reconcileProof = String(index);
    return [frame.title, frame.dataset.reconcileProof];
  }).sort());
  const viewTab = page.getByRole('button', { name: 'Subnet proposal review', exact: true });
  await viewTab.click();
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  await page.getByText('Dashboard settings', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Dashboard name', exact: true }).fill('Daily review');
  await page.getByRole('button', { name: 'Rename dashboard' }).click();
  await page.getByText('View settings', { exact: true }).click();
  await page.getByRole('textbox', { name: 'View name', exact: true }).fill('Daily queue');
  await page.getByRole('button', { name: 'Rename view' }).click();
  const layout = page.locator('#current > section:not([hidden])').getByLabel('Layout');
  await layout.selectOption('two-column');
  await layout.selectOption('three-column');
  const mapCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'IC Node Map', exact: true }) });
  const inspectorCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Membership inspector', exact: true }) });
  await mapCard.getByText('Widget settings').click();
  await mapCard.getByRole('button', { name: 'Move earlier' }).click();
  await inspectorCard.getByText('Widget settings').click();
  await inspectorCard.getByRole('button', { name: 'Move earlier' }).click();
  await page.getByRole('button', { name: 'Save dashboard' }).click();
  await page.getByText('Dashboard saved in this browser.', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(directory, 'dashboard-editing.png'), fullPage: true });
  await page.getByRole('button', { name: 'Done editing' }).click();
  assert.deepEqual(await page.locator('#current > section:not([hidden]) iframe').evaluateAll(frames =>
    frames.map(frame => [frame.title, frame.dataset.reconcileProof]).sort()), framesBefore);
  assert.equal(calls.length, stable);
  workflow.presentationEditCalls = calls.length - stable;
  assert.equal(await membershipStatus().count(), 1);
  assert.equal(await activity.getByText(/Selected #144954/).count(), 1);
  workflow.activityCoverage = await activity.locator('details').first().textContent();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, 'activity-review-desktop.png') });
  const retryStart = calls.length;
  await performance.locator('#performance-form button').click();
  await performanceSettled();
  console.log('Retained frames across presentation edits.');
  const retryCalls = calls.slice(retryStart);
  assert.deepEqual(retryCalls.map(call => call.method), ['node_performance_on_demand']);
  assert.equal(retryCalls[0].nodes.length, 41);
  const desktop = page.viewportSize();
  await page.setViewportSize({ ...desktop, height: 1900 });
  await page.screenshot({ path: resolve(directory, 'activity-review-desktop.png'), fullPage: true });
  await page.locator(activeFrame('IC Node Map')).evaluate(frame => frame.scrollIntoView({ block: 'center' }));
  await map.locator('.map-section').screenshot({ path: resolve(directory, 'activity-review-map.png') });
  await page.setViewportSize(desktop);
  start = calls.length;
  const refreshStarted = now();
  await activity.getByRole('button', { name: 'Refresh discovery' }).click();
  await activity.getByRole('button', { name: 'Refresh discovery' }).waitFor();
  timings.activityRefreshMs = measure(refreshStarted);
  assert.equal(calls.slice(start).filter(row => row.method === 'begin_membership_review').length, 0);
  assert.equal(await membershipStatus().count(), 1);
  rejectActivity = true;
  await activity.getByRole('button', { name: 'Refresh discovery' }).click();
  await activity.getByText(/Discovery failed.*Showing the previous observation/).waitFor();
  assert.equal(await membershipStatus().count(), 1);
  rejectActivity = false;
  await activity.getByRole('button', { name: 'Retry discovery' }).click();
  await activity.getByRole('button', { name: 'Refresh discovery' }).waitFor();

  await inspector.getByRole('button', { name: 'Generate review', exact: true }).first().click();
  await inspector.getByRole('textbox', { name: 'Reviewer summary' }).fill('Review conclusion from the embedded rehearsal.');
  await inspector.getByRole('button', { name: 'Copy Markdown' }).click();
  const copied = inspector.getByText('Review Markdown copied.');
  const fallback = inspector.getByText('Select and copy the generated Markdown from the field.');
  await copied.or(fallback).waitFor();
  if (await copied.count()) {
    workflow.clipboard = 'Copied and read back';
    await page.context().grantPermissions(['clipboard-read'], { origin: host.origin });
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Review conclusion from the embedded rehearsal/);
  } else {
    workflow.clipboard = 'Manual copy fallback selected the exact text';
    const selected = await inspector.getByRole('textbox', { name: 'Generated Markdown' }).evaluate(field =>
      field.value.slice(field.selectionStart, field.selectionEnd));
    assert.match(selected, /Review conclusion from the embedded rehearsal/);
  }
  await page.screenshot({ path: resolve(directory, 'review-export-editor.png'), fullPage: true });
  const download = page.waitForEvent('download');
  console.log('Verified clipboard action:', workflow.clipboard);
  await inspector.getByRole('button', { name: 'Download review', exact: true }).click();
  const archive = resolve(directory, 'activity-review-144954.zip');
  await (await download).saveAs(archive);
  const markdown = execFileSync('unzip', ['-p', archive, 'review.md'], { encoding: 'utf8' });
  assert.match(markdown, /Disposable composition rehearsal · fixture evidence/);
  assert.match(markdown, /40 members · Add 1 · Remove 1 · Unchanged 39/);
  assert.match(markdown, /map\.png/);
  assert.match(markdown, /Review conclusion from the embedded rehearsal/);
  assert.equal(execFileSync('unzip', ['-p', archive, 'map.png']).subarray(1, 4).toString(), 'PNG');

  start = calls.length;
  await inspectCurrent(subnet);
  await assertConnected(start, 'nns-144954-recorded-open');
  await page.setViewportSize({ ...desktop, height: 1900 });
  await page.screenshot({ path: resolve(directory, 'activity-current-desktop.png'), fullPage: true });
  await page.setViewportSize(desktop);

  fixture('multiple-changes');
  await activity.getByRole('button', { name: 'Refresh discovery' }).click();
  await activity.getByRole('button', { name: 'Refresh discovery' }).waitFor();
  start = calls.length;
  await review('144940');
  const { state } = await assertConnected(start, 'multiple-changes', '144940');
  start = calls.length;
  await scope.selectOption('proposed-membership');
  await performance.locator('#performance-context').getByText(/Proposed.*5 nodes/).waitFor();
  await performanceSettled();
  const explicit = calls.slice(start).filter(row => row.method === 'node_performance_on_demand');
  assert.equal(explicit.length, 1);
  assert.deepEqual(sorted(explicit[0].nodes), sorted(state.members));

  await page.setViewportSize({ width: 900, height: 850 });
  await page.screenshot({ path: resolve(directory, 'review-tablet.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Jump to widget' }).getByRole('button', { name: 'Membership inspector' }).click();
  await page.screenshot({ path: resolve(directory, 'dashboard-mobile.png') });
  await activityWidget.screenshot({ path: resolve(directory, 'activity-review-mobile.png') });
  await page.locator(activeFrame('IC Node Map')).evaluate(frame => frame.scrollIntoView({ block: 'center' }));
  await map.locator('.map-section').screenshot({ path: resolve(directory, 'activity-map-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);

  fixture('untargeted-two-subnets');
  await activity.getByRole('button', { name: 'Refresh discovery' }).click();
  await activity.getByText(/1 distinct observed Membership proposals · 2 confirmed affected subnets/).waitFor();
  await activity.getByRole('button', { name: 'Undecided', exact: true }).click();
  const targetButtons = activity.locator('.activity-direct button');
  const [firstTarget, secondTarget] = Object.keys(expected.cases['untargeted-two-subnets'].baselines);
  const secondButton = targetButtons.filter({ hasText: secondTarget.slice(0, 11) });
  const firstButton = targetButtons.filter({ hasText: firstTarget.slice(0, 11) });
  start = calls.length;
  await secondButton.click();
  await assertConnected(start, 'untargeted-two-subnets', '132102', secondTarget);
  start = calls.length;
  await firstButton.click();
  await assertConnected(start, 'untargeted-two-subnets', '132102', firstTarget);

  let arrived, release, timer;
  const held = new Promise((resolve, reject) => {
    arrived = resolve;
    timer = setTimeout(() => reject(new Error('No superseded review request was observed.')), 15_000);
  });
  holdMembership = { arrived, release: new Promise(resolve => { release = resolve; }) };
  try {
    const revisit = now();
    await secondButton.click();
    await inspector.getByText('Previous accepted review · rechecking current evidence').waitFor();
    timings.repeatSummaryMs = measure(revisit);
    await held;
    await map.locator('#map-widget-status').getByText('Waiting for resolved map evidence.').waitFor();
    assert.equal(await performance.getByRole('button', { name: 'Read blockmaking samples' }).isDisabled(), true);
    start = calls.length;
    await inspectCurrent(firstTarget);
  } finally {
    clearTimeout(timer);
    holdMembership = undefined;
    release();
  }
  await assertConnected(start, 'untargeted-two-subnets', undefined, firstTarget);

  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  await activityWidget.getByText('Widget settings', { exact: true }).click();
  await activityWidget.getByRole('button', { name: 'Reconnect widget' }).click();
  await inspector.getByText('Select a proposal or subnet to inspect.', { exact: true }).waitFor();
  await map.locator('#map-widget-status').getByText('Waiting for resolved map evidence.').waitFor();
  assert.equal(await performance.getByRole('button', { name: 'Read blockmaking samples' }).isDisabled(), true);
  await activityWidget.getByRole('button', { name: 'Remove widget' }).click();
  assert.equal(await activityWidget.count(), 0);
  await page.getByRole('button', { name: 'Save dashboard' }).click();
  await page.getByText('Dashboard saved in this browser.', { exact: true }).waitFor();
  const guest = await page.evaluate(() => {
    const id = localStorage.getItem('network-nexus.last-dashboard');
    return JSON.parse(localStorage.getItem('network-nexus.dashboard.v1.' + id));
  });
  const savedView = guest.views.find(view => view.title === 'Daily queue');
  assert.deepEqual(savedView.widgets.map(row => row.definition), ['inspector', 'map', 'performance']);
  assert.equal(savedView.bindings.length, 2);
  assert.deepEqual(savedView.inputs, []);
  assert.deepEqual(denied, []);
  assert.deepEqual(errors, []);
  const summary = { timings, workflow, host: host.origin, mapOrigin, certified, views: verifiedViews, activityViews, explicitProposed: explicit[0], calls, denied };
  await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('Verified ' + certified.length + ' certified responses, the same map origin in all views, and exact finite Performance requests.');

} finally {
  await browser.close();
}
