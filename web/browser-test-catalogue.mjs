import assert from 'node:assert/strict';
import { Cbor } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from './src/reviewer.did.js';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { testCatalogue } from './test-cases/catalogue.mjs';
import { verifyEmbeddedGateway } from './verify-embedded-frontend.mjs';

const [project, output] = process.argv.slice(2);
if (!project || !output) throw new Error('Usage: node web/browser-test-catalogue.mjs <disposable project> <output>');
const catalogue = await testCatalogue();
const gateway = await verifyEmbeddedGateway(resolve(project), undefined, catalogue);
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP '
    + new URL(gateway.origin).hostname + ' 127.0.0.1, MAP * ~NOTFOUND'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  const allowed = new Set(gateway.observed.filter(row => row.method === 'GET' && row.status === 200).map(row => row.path));
  const rejected = [], errors = [], testData = [], reviewerRequests = [];
  const performanceRequests = [];
  const performanceArgs = idlFactory({ IDL }).fieldsAsObject().node_performance_on_demand.argTypes;
  let live = false;
  let failDiscovery = false;
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === gateway.origin && !url.search && request.method() === 'GET' && allowed.has(url.pathname)) {
      if (url.pathname.startsWith('/replay.')) testData.push(url.pathname);
      return route.continue();
    }
    const protocol = new RegExp('^/api/v[234]/canister/' + gateway.reviewer + '/(?:read_state|call)$');
    if (live && url.origin === gateway.origin && !url.search && (
      (request.method() === 'POST' && protocol.test(url.pathname))
      || (request.method() === 'GET' && url.pathname === '/api/v2/status'))) {
      reviewerRequests.push(url.pathname);
      const body = request.postDataBuffer();
      const message = body && Cbor.decode(body)?.content;
      if (message?.method_name === 'node_performance_on_demand') {
        const [subnet, , nodes] = IDL.decode(performanceArgs, new Uint8Array(message.arg));
        performanceRequests.push({ subnet: subnet.toText(), nodes: nodes[0]?.map(id => id.toText()) });
      }
      if (failDiscovery && message?.method_name === 'subnet_activity') {
        return route.fulfill({ status: 403, body: 'Simulated discovery refresh rejection' });
      }
      return route.continue();
    }
    rejected.push(request.url());
    return route.abort();
  });
  const page = await context.newPage({ acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  const url = path => gateway.origin + path;
  await page.goto(url('/test-cases'));
  assert.equal(await page.locator('.test-case-item').count(), catalogue.cases.length);
  await page.screenshot({ path: resolve(output, 'catalogue.png'), fullPage: true });
  const results = [];
  for (const item of catalogue.cases) {
    const path = '/test-cases/' + item.id;
    console.log('Checking ' + item.id);
    const before = testData.length;
    await page.goto(url(path));
    assert.match(await page.locator('.test-catalogue h1').textContent(), new RegExp(item.proposalIds[0]));
    await page.getByText(item.lifecycleLabel + ' · ' + item.kind, { exact: true }).waitFor();
    if (!item.asset) {
      await page.getByText(/Interactive review unavailable/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Review', exact: true }).count(), 0);
      assert.equal(testData.length, before);
      results.push({ case: item.id, support: item.supportLabel });
      continue;
    }
    assert.equal(await page.locator('#search input[name=first]').inputValue(), item.proposalIds[0]);
    assert.equal(await page.getByRole('button', { name: 'Subnet overview', exact: true }).isVisible(), false);
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    const intro = await page.locator('.test-catalogue').innerText();
    assert.doesNotMatch(intro, /\[object HTML|(?:^|\n)\s*null\s*(?:\n|$)/);
    if (item.actionEvidence.some(entry => entry.kind === 'recorded-governance-reply' && entry.at)) {
      for (const entry of item.actionEvidence.filter(row => row.kind === 'recorded-governance-reply' && row.at)) {
        const clock = entry.at.replace('T', ' ').replace(/(?:Z|\+00:00)$/, ' UTC');
        assert.ok(intro.includes('Original Governance observation #' + entry.id) && intro.includes(clock), intro);
      }
    }
    if (item.fault === 'slow-locations') await page.locator('#report-status').getByText(/Loading data centers/).waitFor();
    const expected = / (Executed|Rejected|Failed) /.test(item.lifecycleLabel) ? 'Proposal outcome recorded' : 'Data loading complete';
    const status = page.locator('#report-status');
    await status.getByText(expected, { exact: true }).waitFor().catch(async error => {
      throw new Error(item.id + ' · ' + await status.textContent(), { cause: error });
    });
    assert.deepEqual(testData.slice(before), ['/' + item.asset]);
    const generate = page.getByRole('button', { name: 'Generate review', exact: true });
    let report = false;
    if (expected === 'Data loading complete') {
      if (item.id === 'separate-add-remove') {
        await page.getByLabel('Proposal order').selectOption('BThenA');
        await page.getByLabel('Membership state').selectOption('1');
        await page.locator('.review-summary > strong').filter({ hasText: /3 → 2 members/ }).waitFor();
      }
      if (item.id === 'untargeted-two-subnets') {
        const subnet = page.getByLabel('Subnet', { exact: true });
        const first = await subnet.inputValue();
        await subnet.selectOption({ index: 1 });
        assert.notEqual(await subnet.inputValue(), first);
        await status.getByText('Data loading complete', { exact: true }).waitFor();
      }
      if (item.id === 'review-checks-combined') {
        await page.getByLabel('Proposal order').selectOption('BThenA');
        await status.getByText('Data loading complete', { exact: true }).waitFor();
        await page.locator('.review-checks').getByText(/Add and Remove overlap/).first().waitFor();
      }
      await generate.click();
      const button = page.getByRole('button', { name: 'Download review', exact: true });
      const [download] = await Promise.all([page.waitForEvent('download'), button.click()]).catch(async error => {
        const status = await page.locator('.inspector p.status').allTextContents();
        throw new Error(item.id + ' download · ' + [...status, ...errors].join(' · '), { cause: error });
      });
      const zip = await download.path();
      const markdown = execFileSync('unzip', ['-p', zip, 'review.md'], { encoding: 'utf8' });
      assert.match(markdown, item.activity ? /Bundled test case · Synthetic scenario/ : /Bundled test case · Historical replay/);
      assert.match(markdown, /Fixture backend observed/);
      assert.ok(markdown.includes('Membership and Registry source receipts') && markdown.includes('Observed at'));
      for (const entry of item.actionEvidence.filter(row => row.kind === 'recorded-governance-reply' && row.at)) {
        const original = new Date(entry.at).toISOString().replace('T', ' ').replace(/(?:\.000)?Z$/, ' UTC');
        assert.ok(markdown.includes('Original Governance observation ' + original));
      }
      if (item.id === 'review-checks-three-replacements') {
        assert.match(markdown, /1 additional fault tolerable · 2 would exceed/);
        assert.match(markdown, /Governance check complete.*4 references found/);
        assert.match(markdown, /Adopted · awaiting execution · Motion.*exact textual principal reference/);
        for (const id of [990002, 990003, 990005, 990006]) assert.match(markdown, new RegExp('/proposal/' + id));
        assert.doesNotMatch(markdown, /990004/);
      }
      if (item.id === 'review-checks-four-replacements') {
        assert.match(markdown, /Warning · zero margin/);
        assert.match(markdown, /Governance check incomplete/);
        assert.match(markdown, /Missing payloads 1/);
      }
      if (item.id === 'review-checks-combined') {
        assert.match(markdown, /Add duplicates 1 · Remove duplicates 1/);
        assert.match(markdown, /removal wins under the upstream simulation/);
        assert.match(markdown, /modeled fault budget exceeded/);
        assert.match(markdown, /Earlier arrivals modeled/);
        assert.match(markdown, /Limiting side/);
        assert.match(markdown, /Accepted Governance discovery source receipts/);
        assert.match(markdown, /Argument SHA-256/);
      }
      if (item.id === 'separate-add-remove') assert.match(markdown, /Proposal #85622 then Proposal #85612.*Step 1 of 2/);
      if (item.id === 'nns-144954-recorded-open') {
        assert.match(markdown, /40 members · Add 1 · Remove 1 · Unchanged 39/);
        assert.match(markdown, /Original Governance observation/);
        assert.match(markdown, /Synthetic NNS-role supplement/);
        await download.saveAs(resolve(output, '144954-review.zip'));
        await page.screenshot({ path: resolve(output, '144954-test-case.png'), fullPage: true });
      }
      if (item.activity) {
        await download.saveAs(resolve(output, item.id + '.zip'));
        await page.screenshot({ path: resolve(output, item.id + '.png'), fullPage: true });
      }
      report = true;
    }
    results.push({ case: item.id, status: expected, report });
  }
  const recorded = '/test-cases/nns-144954-recorded-open';
  await page.goto(url(recorded));
  await page.reload();
  assert.equal(page.url(), url(recorded));
  assert.equal(await page.locator('#search input[name=first]').inputValue(), '144954');
  await page.getByLabel('Switch test case').selectOption('multiple-changes');
  await page.getByRole('button', { name: 'Open selected test case', exact: true }).click();
  await page.waitForURL(url('/test-cases/multiple-changes'));
  assert.equal(await page.locator('#search input[name=first]').inputValue(), '144940');
  await page.getByRole('link', { name: 'Test cases', exact: true }).click();
  await page.waitForURL(url('/test-cases'));
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.setViewportSize({ width: 1366, height: 900 });
  assert.equal(reviewerRequests.length, 0);

  async function verifyPerformance(existingCount, proposedCount, relatedCount, explicit) {
    const rows = await page.locator('.review-node-tables tbody tr').evaluateAll(items => items.map(row => ({
      role: row.className,
      id: new URL(row.querySelector('a[href*="/network/nodes/"]').href).pathname.split('/').pop(),
    })));
    const existing = rows.filter(row => !row.role.includes('added')).map(row => row.id).sort();
    const proposed = rows.filter(row => !row.role.includes('removed')).map(row => row.id).sort();
    assert.equal(existing.length, existingCount);
    assert.equal(proposed.length, proposedCount);
    assert.equal(rows.length, relatedCount);
    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    const preset = page.locator('#performance-preset');
    const initial = performanceRequests.length;
    assert.equal(await preset.inputValue(), 'membership-union');
    const read = page.getByRole('button', { name: 'Read blockmaking samples' });
    await read.click();
    await page.waitForFunction(() => !document.querySelector('#performance-form button').disabled);
    assert.equal(performanceRequests.length, initial + 1);
    assert.deepEqual([...performanceRequests.at(-1).nodes].sort(), rows.map(row => row.id).sort());
    if (explicit) {
      await preset.selectOption('proposed-membership');
      await read.click();
      await page.waitForFunction(() => !document.querySelector('#performance-form button').disabled);
      assert.equal(performanceRequests.length, initial + 2);
      assert.deepEqual([...performanceRequests.at(-1).nodes].sort(), proposed);
    }
  }
  const capturesBeforeLive = testData.length;
  live = true;
  await page.getByRole('link', { name: 'Live review', exact: true }).click();
  await page.waitForURL(url('/') + '*');
  assert.equal(await page.locator('.test-catalogue').count(), 0);
  await page.locator('#search input[name=first]').fill('144954');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 90000 });
  await page.locator('.review-checks').getByText(/Governance check incomplete/).waitFor();
  await verifyPerformance(40, 40, 41, false);
  execFileSync('dfx', ['canister', 'call', '--network', 'local', '--candid', 'fixture.did', 'fixture',
    'load_review_case', '("review-checks-three-replacements")'], {
    cwd: resolve(project), env: { ...process.env, DFX_IDENTITY: 'codex_local' },
  });
  await page.getByRole('button', { name: 'Subnet Activity', exact: true }).click();
  const activity = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Subnet Activity' }) });
  await activity.getByText(/Pinned roster resolved/).waitFor();
  await activity.getByText(/Governance check complete.*references found/).waitFor();
  await activity.locator('details').filter({ has: page.locator('button').filter({ hasText: /^Review #990001$/ }) }).locator('summary').first().press('Enter');
  await page.screenshot({ path: resolve(output, 'subnet-activity.png'), fullPage: true });
  await activity.getByRole('button', { name: 'Review #990001', exact: true }).click();
  await page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 90000 });
  await page.locator('.review-checks').getByText(/Governance check complete.*4 references found/).waitFor({ timeout: 90000 });
  failDiscovery = true;
  const refreshChecks = page.getByRole('button', { name: 'Refresh review checks', exact: true });
  await refreshChecks.click();
  await page.locator('.review-checks').getByText(/Previous Governance observation.*Refresh failed.*4 references found/).waitFor();
  failDiscovery = false;
  await refreshChecks.click();
  await page.locator('.review-checks').getByText(/Governance check complete.*4 references found/).waitFor({ timeout: 90000 });
  execFileSync('dfx', ['canister', 'call', '--network', 'local', '--candid', 'fixture.did', 'fixture',
    'load_review_case', '("nns-145077-recorded-open")'], {
    cwd: resolve(project), env: { ...process.env, DFX_IDENTITY: 'codex_local' },
  });
  // An unsubmitted edit is not the identity of the visible review.
  await page.locator('#search input[name=first]').fill('144954');
  await activity.getByRole('button', { name: 'Refresh discovery', exact: true }).click();
  await activity.getByText(/Registry 66264.*Pinned roster resolved/).waitFor({ timeout: 90000 });
  await activity.getByText(/Governance check incomplete/).waitFor();
  await page.locator('.review-checks').getByText(/Previous Governance observation.*could not verify/).waitFor();
  await activity.getByRole('button', { name: 'All subnets', exact: true }).click();
  assert.equal(await activity.locator('.activity-count').count(), 98);
  await page.locator('.review-header').getByRole('link', { name: '#990001', exact: true }).waitFor();
  await activity.screenshot({ path: resolve(output, 'recorded-burst-navigator.png') });
  failDiscovery = true;
  await activity.getByRole('button', { name: 'Refresh discovery', exact: true }).click();
  await activity.getByText(/Showing the previous observation/).waitFor({ timeout: 90000 });
  assert.equal(await activity.locator('.activity-count').count(), 98);
  await page.locator('.review-header').getByRole('link', { name: '#990001', exact: true }).waitFor();
  failDiscovery = false;
  await activity.getByRole('button', { name: 'Retry discovery', exact: true }).click();
  await activity.getByRole('button', { name: 'Refresh discovery', exact: true }).waitFor({ timeout: 90000 });
  await activity.getByText(/Governance check incomplete/).waitFor();
  await page.setViewportSize({ width: 390, height: 800 });
  const noProposals = activity.locator('details').filter({ has: page.getByText('No proposals for this subnet in the observed result.', { exact: true }) });
  const empty = noProposals.nth(20);
  await empty.locator('summary').click();
  const inspect = empty.getByRole('button', { name: 'Inspect current membership' });
  await inspect.scrollIntoViewIfNeeded();
  const position = await activity.evaluate(el => el.scrollTop);
  assert.ok(position > 0);
  await inspect.click();
  await page.locator('#subnet-status').getByText('Subnet loaded.', { exact: true }).waitFor({ timeout: 90000 });
  assert.equal(await activity.isVisible(), false);
  assert.equal(await page.locator('#subnet-result .map-card').count(), 1);
  await page.locator('#subnet-result').getByText(/members · Registry 66,264/).waitFor();
  await page.screenshot({ path: resolve(output, 'current-subnet-mobile.png') });
  await page.getByRole('button', { name: 'Back to subnet list', exact: true }).click();
  assert.equal(await activity.evaluate(el => el.scrollTop), position);
  await page.setViewportSize({ width: 1366, height: 900 });
  const archivedRow = activity.locator('details').filter({ has: page.locator('button').filter({ hasText: /^Review #145077$/ }) });
  await archivedRow.locator('summary').first().press('Enter');
  await activity.getByRole('button', { name: 'Review #145077', exact: true }).click();
  await activity.getByRole('button', { name: 'Next proposal', exact: true }).click();
  await page.locator('.review-header').getByRole('link', { name: '#145076', exact: true }).waitFor();
  await page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 90000 });
  await activity.getByRole('button', { name: 'Previous proposal', exact: true }).click();
  await page.locator('.review-header').getByRole('link', { name: '#145077', exact: true }).waitFor();
  await page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 90000 });
  execFileSync('dfx', ['canister', 'call', '--network', 'local', '--candid', 'fixture.did', 'fixture',
    'load_review_case', '("multiple-changes")'], {
    cwd: resolve(project), env: { ...process.env, DFX_IDENTITY: 'codex_local' },
  });
  await page.locator('#search input[name=first]').fill('144940');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 90000 });
  await verifyPerformance(5, 5, 7, true);
  assert.equal(testData.length, capturesBeforeLive);
  assert.ok(reviewerRequests.some(path => path.endsWith('/call')));
  assert.deepEqual(rejected, []);
  assert.deepEqual(errors, []);
  const summary = { origin: gateway.origin, certified: gateway.observed, rawRefusals: gateway.rawRefusals,
    results, bundledEvidenceRequests: testData.length, liveReviewerCalls: reviewerRequests.filter(path => path.endsWith('/call')).length,
    activityOverviewVerified: true, performanceRequests, testReviewerCalls: 0, outsideRequests: rejected.length };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('Verified ' + summary.certified.length + ' gateway responses and ' + results.length + ' test cases.');
} finally {
  await browser.close();
}
