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
const publicUrl = process.env.NEXUS_REPLAY_PUBLIC_URL;
const url = new URL(publicUrl ?? 'http://' + id + '.localhost:' + port);
if (publicUrl && url.protocol !== 'https:') throw new Error('Public replay URL requires HTTPS.');
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true,
  hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
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
const checkHitTargets = async () => {
  const mapTop = await page.locator('.map-frame').evaluate(map => Math.round(map.getBoundingClientRect().top + scrollY));
  assert.ok(mapTop < page.viewportSize().height, 'The map starts below the first viewport.');
  await page.locator('.map-frame').scrollIntoViewIfNeeded();
  const result = await page.locator('.map-pin:visible').evaluateAll(nodes => ({
    count: nodes.length,
    minimumTarget: Math.min(...nodes.map(node => node.getBoundingClientRect().width)),
    maximumDisplacement: Math.ceil(Math.max(...nodes.map(node => Math.hypot(
      parseFloat(node.style.left) - Number(node.dataset.anchorX),
      parseFloat(node.style.top) - Number(node.dataset.anchorY))))),
    allHit: nodes.every(node => {
      const { left, top, width, height } = node.getBoundingClientRect();
      return document.elementFromPoint(left + width / 2, top + height / 2) === node && node.tabIndex === 0;
    }),
  }));
  assert.equal(result.count, 41);
  assert.equal(result.allHit, true);
  assert.ok(result.minimumTarget >= 24);
  mapChecks.push({ width: page.viewportSize().width, mapTop, ...result });
};
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
  assert.equal(count('membership_target_topology'), 0);
  assert.equal(count('membership_registry_role'), 1);
  assert.equal(count('compare_membership_context'), 1);
  assert.equal(count('compare_membership_details'), 0);
  assert.equal(count('finalize_membership_review'), 1);
  await page.getByText('40 members · 39 retained · 1 incoming · 1 outgoing', { exact: true }).waitFor();
  await page.getByText(/Target subnet checked; assignments in the other 95 listed subnets were not checked/).waitFor();
  await page.getByText(/41 nodes across both states · 41\/41 located · 41 shown/).waitFor();
  await page.locator('#local-notice').getByText(/Historical replay · Recorded Open proposal · Registry 66,013/).waitFor();
  await page.getByText(/Recorded status: Open · Original Governance observation 2026-11-25 13:08:13.589 UTC/).waitFor();
  await page.getByText(/No Target Topology limits have been assumed/).waitFor();
  assert.equal(await page.getByRole('columnheader', { name: /^(Rule|Assessment)$/ }).count(), 0);
  assert.doesNotMatch(await page.locator('.topology-card').innerText(), /Matches target|Exception unresolved|Identity unresolved|143190/);
  for (const [name, value] of [
    ['Data center · sh1', '2 → 3'], ['Data center · zh2', '1 → 0'],
    ['Registered owner name · Digital Realty', '2 → 3'], ['Registered owner name · Everyware', '1 → 0'],
    ['Recorded country label · SE', '2 → 3'], ['Recorded country label · CH', '3 → 2'],
    ['Node provider · bvcsg…mqe', '3'],
  ]) {
    const row = page.locator('.topology-card').getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
    assert.equal((await row.getByRole('cell').last().textContent()).trim(), value);
  }
  const marker = role => page.locator('.map-pin.role-' + role + ':visible');
  assert.equal(await marker('retained').count(), 39);
  assert.equal(await marker('added').count(), 1);
  assert.equal(await marker('removed').count(), 1);
  assert.equal(new Set(await page.locator('.map-pin').evaluateAll(rows => rows.map(row => row.dataset.marker))).size, 41);
  const incoming = marker('added');
  const incomingId = await incoming.getAttribute('data-marker');
  await incoming.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Full node principal').inputValue(), incomingId);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.marker), incomingId);
  await page.getByRole('button', { name: 'Focus changes', exact: true }).click();
  assert.ok(await incoming.isVisible());
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await checkHitTargets();
  await capture('recorded-desktop');
  await resize(390, 844);
  const sh1 = page.locator('.map-pin[aria-label*=" · sh1 · "]:visible');
  assert.equal(await sh1.count(), 3);
  await checkHitTargets();
  const targets = [...await sh1.all(), marker('removed')];
  for (const target of targets) {
    const id = await target.getAttribute('data-marker');
    const dimensions = await target.boundingBox();
    assert.ok(dimensions.width >= 24 && dimensions.height >= 24);
    await target.tap();
    assert.equal(await page.getByLabel('Full node principal').inputValue(), id);
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  await incoming.focus();
  await resize(320, 700);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.marker), incomingId);
  await checkHitTargets();
  await marker('removed').tap();
  assert.equal(await page.getByLabel('Full node principal').inputValue(), await marker('removed').getAttribute('data-marker'));
  await page.getByRole('button', { name: 'Close details' }).click();
  await capture('recorded-320');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('recorded-mobile');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: 'Sources & details', exact: true }).click();
  await page.getByText('Method and exact inputs', { exact: true }).click();
  const wire = await download('Download calculation input (Candid)', 'recorded-calculation.didbin');
  const digest = createHash('sha256').update(wire).digest('hex');
  await exportButton().click();
  await page.getByRole('checkbox', { name: /Retained/ }).uncheck();
  assert.equal(await marker('retained').count(), 0);
  const markdown = (await download('Download Markdown', 'recorded-review.md')).toString('utf8');
  await page.evaluate(() => {
    const clipboard = navigator.clipboard;
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = async value => {
      await write(value);
      window.copiedReview = value;
    };
    const exec = document.execCommand.bind(document);
    document.execCommand = (command, ...args) => {
      const field = document.activeElement;
      const selected = field.value?.slice(field.selectionStart, field.selectionEnd);
      const copied = exec(command, ...args);
      if (copied && command === 'copy') window.copiedReview = selected;
      return copied;
    };
  });
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  await page.getByText('Review Markdown copied.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.copiedReview), markdown);
  assert.ok(markdown.includes(digest));
  assert.match(markdown, /Recorded status: Open.*Original Governance observation 2026-11-25 13:08:13\.589 UTC.*Local replay served/);
  assert.match(markdown, /Original Registry observations/);
  assert.match(markdown, /Synthetic NNS-role supplement/);
  assert.match(markdown, /Filter: Incoming, Outgoing/);
  assert.doesNotMatch(markdown, /Matches target|Exception unresolved|Identity unresolved|143190/);
  const png = await download('Export map PNG', 'recorded-map.png');
  const checkPixels = await page.evaluate(async base64 => {
    const raster = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/png' }));
    const bitmap = document.createElement('canvas');
    bitmap.width = raster.width;
    bitmap.height = raster.height;
    const context = bitmap.getContext('2d');
    context.drawImage(raster, 0, 0);
    const map = document.querySelector('.map-frame');
    const factor = raster.width / map.clientWidth;
    const header = raster.height - Math.ceil(map.clientHeight * factor);
    return [...map.querySelectorAll('button:not([hidden])')].map(button => ({
      role: button.className.split(' ').at(-1),
      pixel: [...context.getImageData((parseFloat(button.style.left) - 8) * factor,
        header + (parseFloat(button.style.top) - 5) * factor, 1, 1).data].slice(0, 3),
    }));
  }, png.toString('base64'));
  assert.deepEqual(Object.fromEntries(checkPixels.map(row => [row.role, row.pixel])),
    { 'role-removed': [173, 38, 63], 'role-added': [8, 119, 72] });
  await page.getByRole('checkbox', { name: /Retained/ }).check();

  await select('multiple-changes');
  await review();
  await settled();
  await page.getByText('5 members · 3 retained · 2 incoming · 2 outgoing', { exact: true }).waitFor();
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
  await page.locator('.review-summary').getByText(/3 → 4 members/).waitFor();
  await order.selectOption('BThenA');
  await step.selectOption('1');
  await page.locator('.review-summary').getByText(/3 → 2 members/).waitFor();
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
    await page.getByText(/41 locations pending/).waitFor();
    assert.equal(await page.getByText(/Unmapped nodes/).isVisible(), false);
    await capture('loading-locations');
  } finally {
    releaseLocations();
  }
  await settled();
  await page.unroute(detailRoute, waitForLocation);
  await page.getByText(/41 nodes across both states · 38\/41 located/).waitFor();
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
    assert.ok(await tab.getByRole('button', { name: 'Export review', exact: true }).isEnabled());
    await tab.close();
  }

  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const summary = { cases: ['recorded', 'multiple changes', 'paired orders', 'executed terminal', 'rejected terminal',
    'failed terminal', 'held locations', 'subnet A→B→A', 'independent browser contexts'],
    mapChecks, recordedDigest: digest, reviewerMethods: [...calls.values()], nonLocalRequests: external.length };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
