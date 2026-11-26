// Use a disposable local reviewer and source fixture, as in browser-voting-review.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Cbor, requestIdOf } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from './src/reviewer.did.js';

const [project, output] = process.argv.slice(2);
if (!project) throw new Error('Provide the isolated local DFX project directory');
if (output) await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const dfx = (...args) => execFileSync('dfx', args, {
  cwd: project, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
}).trim();
const localCall = (canister, method, args = '()') => dfx('canister', 'call', '--network', 'local', canister, method, args);
const frontend = dfx('canister', 'id', '--network', 'local', 'frontend');
const reviewer = dfx('canister', 'id', '--network', 'local', 'reviewer');
const config = JSON.parse(await readFile(resolve(project, 'dfx.json'), 'utf8'));
const port = config.networks?.local?.bind?.split(':').at(-1) ?? '4966';
const methods = idlFactory({ IDL }).fieldsAsObject();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
const mode = value => localCall('fixture', 'set_voting_review_fixture', '(' + value + ' : nat8)');
const gate = () => {
  let release;
  const settled = new Promise(resolve => { release = resolve; });
  return { settled, release };
};
const results = [];

async function test(name, fixture, run) {
  mode(fixture);
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const requests = new Map();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().endsWith('/canister/' + reviewer + '/call')) return;
    const { content } = Cbor.decode(new Uint8Array(request.postDataBuffer()));
    requests.set(Buffer.from(requestIdOf(content)).toString('hex'), content);
  });
  const send = async (id, second = '') => {
    await page.locator('input[name=first]').fill(String(id));
    await page.getByText('Review options', { exact: true }).click();
    await page.locator('input[name=second]').fill(second);
    await page.getByText('Review options', { exact: true }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
  };
  const count = method => [...requests.values()].filter(row => row.method_name === method).length;
  try {
    await page.goto('http://' + frontend + '.localhost:' + port);
    const principal = (await page.locator('#browser-principal').textContent()).trim();
    assert.match(localCall('reviewer', 'set_on_demand_caller', '(opt principal "' + principal + '")'), /Ok/);
    const nodeReads = () => [...requests.values()].filter(row => row.method_name === 'membership_context_detail_page').reduce((sum, row) => {
      const [, keys] = IDL.decode(methods.membership_context_detail_page.argTypes, row.arg);
      return sum + (keys.Nodes?.length ?? 0);
    }, 0);
    await run(page, send, count, nodeReads);
    assert.deepEqual(errors, []);
    results.push(name);
    console.log('PASS ' + name);
  } finally {
    await page.close();
  }
}

async function holdPage(page, accepts) {
  const dispatched = gate();
  const release = gate();
  let held = false;
  await page.route(/\/api\/v4\/canister\/[^/]+\/call$/, async route => {
    const { content } = Cbor.decode(new Uint8Array(route.request().postDataBuffer()));
    if (held || content.method_name !== 'membership_context_detail_page') return route.continue();
    const [, keys] = IDL.decode(methods.membership_context_detail_page.argTypes, content.arg);
    if (!accepts(keys)) return route.continue();
    held = true;
    const response = await route.fetch();
    dispatched.release();
    await release.settled;
    return route.fulfill({ response });
  });
  return { dispatched: dispatched.settled, release: release.release };
}
const status = page => page.locator('#report-status');
const finished = page => status(page).getByText('Finished with gaps', { exact: true }).waitFor({ timeout: 120000 });

try {
  await test('Held data-center page keeps counts truthful and preserves the inspector and map camera', 1, async (page, send) => {
    const hold = await holdPage(page, key => 'DataCenters' in key);
    try {
      await send(144954);
      await hold.dispatched;
      await page.locator('#review-counts').getByText(/^0 of 39 records settled/).waitFor();
      await page.getByText(/41 locations pending/).waitFor();
      assert.equal(await page.getByText(/Unmapped nodes/).isVisible(), false);
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.getByRole('button', { name: 'Registered DC owner', exact: true }).click();
      const panel = page.locator('.inspector');
      await panel.getByText('Loading data centers', { exact: true }).waitFor();
      await panel.getByRole('button', { name: 'Close details' }).click();
      await page.locator('.changed-nodes').getByRole('button', { name: /kaoz3/ }).click();
      await panel.getByLabel('Full node principal').waitFor();
      assert.match(await panel.textContent(), /Registered ownerLoading data centers/);
      assert.doesNotMatch(await panel.textContent(), /Unavailable|Could not load/);
      if (output) await page.screenshot({ path: resolve(output, '144954-loading.png'), fullPage: true });
    } finally {
      hold.release();
    }
    await finished(page);
    await page.getByText('41 nodes across both states · 38/41 mapped', { exact: true }).waitFor();
    await page.getByText('Zoom 1.6×', { exact: true }).waitFor();
    const panel = page.locator('.inspector');
    await panel.getByText('Coordinates not recorded on-chain', { exact: true }).waitFor();
    assert.match(await panel.textContent(), /Digital Realty/);
  });

  await test('Stop waits for a held call and leaves a terminal section message', 0, async (page, send, count) => {
    const hold = await holdPage(page, key => 'DataCenters' in key);
    try {
      await send(144954);
      await hold.dispatched;
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await status(page).getByText(/Stopping.*accepted call/).waitFor();
    } finally {
      hold.release();
    }
    await status(page).getByText('Stopped', { exact: true }).waitFor();
    await page.locator('.changed-nodes').getByRole('button', { name: /kaoz3/ }).click();
    await page.locator('.inspector').getByText('Not loaded · Review stopped', { exact: true }).first().waitFor();
    assert.equal(count('membership_target_topology'), 0);
    assert.equal(count('finalize_membership_review'), 0);
    assert.ok(await page.getByRole('button', { name: 'Export review', exact: true }).isDisabled());
  });

  await test('Supersession rejects a late node page and starts the next review', 0, async (page, send, count) => {
    const hold = await holdPage(page, key => 'Nodes' in key);
    try {
      await send(144954);
      await hold.dispatched;
      await send(999999);
      await page.getByRole('heading', { name: 'Proposal #999999' }).waitFor();
      assert.equal(count('begin_membership_review'), 1);
      assert.equal(await page.getByText(/40 members · \+1 added/).count(), 0);
    } finally {
      hold.release();
    }
    await status(page).getByText(/Could not produce a review.*999999.*unavailable/).waitFor();
    assert.equal(count('begin_membership_review'), 2);
    assert.equal(count('membership_context_detail_page'), 1);
  });

  await test('Failed metadata stays distinct from absence and retries only the failed key', 2, async (page, send, count) => {
    await send(144954);
    await finished(page);
    await page.locator('.changed-nodes').getByRole('button', { name: /kaoz3/ }).click();
    await page.locator('.inspector').getByText(/Could not load.*withheld optional/).first().waitFor();
    const pages = count('membership_context_detail_page');
    mode(0);
    const hold = await holdPage(page, key => 'DataCenters' in key);
    try {
      await page.getByRole('button', { name: 'Retry failed evidence', exact: true }).click();
      await hold.dispatched;
      await page.getByText('Previous accepted comparison · Retry in progress', { exact: true }).waitFor();
      await page.getByText('41 nodes across both states · 38/41 mapped', { exact: true }).waitFor();
      assert.ok(await page.getByRole('button', { name: 'Export review', exact: true }).isDisabled());
    } finally { hold.release(); }
    await finished(page);
    await page.getByText('41 nodes across both states · 41/41 mapped', { exact: true }).waitFor();
    assert.equal(count('membership_context_detail_page'), pages + 1);
    assert.equal(count('membership_target_topology'), 1);
    assert.equal(count('begin_membership_review'), 1);
  });

  await test('Required membership conflict blocks the review before enrichment', 3, async (page, send, count) => {
    await send(144954);
    await status(page).getByText(/Could not produce a review.*conflicting/).waitFor();
    assert.equal(count('membership_context_detail_page'), 0);
    assert.equal(await page.getByText(/40 members · \+1 added/).count(), 0);
  });

  await test('An executed proposal does not imply a historical baseline', 4, async (page, send, count) => {
    await send(144954);
    await status(page).getByText('Proposal outcome recorded', { exact: true }).waitFor();
    await page.getByText(/historical before-state is unavailable/).waitFor();
    assert.equal(count('membership_context_detail_page'), 0);
    assert.equal(await page.getByRole('button', { name: 'Export review', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Target Topology' }).count(), 0);
  });

  await test('The final Governance check blocks a result when the proposal executes during enrichment', 0, async (page, send, count) => {
    let changed = false;
    await page.route(/\/api\/v4\/canister\/[^/]+\/call$/, route => {
      const { content } = Cbor.decode(new Uint8Array(route.request().postDataBuffer()));
      if (!changed && content.method_name === 'finalize_membership_review') {
        changed = true;
        mode(4);
      }
      return route.continue();
    });
    await send(144954);
    await status(page).getByText('Could not produce a review', { exact: true }).waitFor({ timeout: 120000 });
    await page.getByText(/144954 changed during the review/).waitFor();
    assert.equal(count('finalize_membership_review'), 1);
    assert.ok(await page.getByRole('button', { name: 'Export review', exact: true }).isDisabled());
    assert.equal(await page.getByText(/40 members · \+1 added/).count(), 0);
  });

  await test('A failed final Governance read remains provisional and retries only verification', 0, async (page, send, count) => {
    let failed = false;
    await page.route(/\/api\/v4\/canister\/[^/]+\/call$/, route => {
      const { content } = Cbor.decode(new Uint8Array(route.request().postDataBuffer()));
      if (!failed && content.method_name === 'finalize_membership_review') {
        failed = true;
        mode(6);
      }
      return route.continue();
    });
    await send(144954);
    await status(page).getByText('Provisional · Governance check failed', { exact: true }).waitFor({ timeout: 120000 });
    await page.getByText(/Provisional.*Temporary fixture Governance failure/).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Export review', exact: true }).isDisabled());
    const pages = count('membership_context_detail_page');
    mode(0);
    await page.getByRole('button', { name: 'Retry failed evidence', exact: true }).click();
    await finished(page);
    assert.equal(count('membership_context_detail_page'), pages);
    assert.equal(count('compare_membership_with_policy'), 1);
    assert.equal(count('finalize_membership_review'), 2);
  });

  await test('An incompatible final action invalidates the comparison', 0, async (page, send) => {
    let changed = false;
    await page.route(/\/api\/v4\/canister\/[^/]+\/call$/, route => {
      const { content } = Cbor.decode(new Uint8Array(route.request().postDataBuffer()));
      if (!changed && content.method_name === 'finalize_membership_review') {
        changed = true;
        mode(7);
      }
      return route.continue();
    });
    await send(144954);
    await status(page).getByText('Could not produce a review', { exact: true }).waitFor({ timeout: 120000 });
    await page.getByText(/unsupported action/).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Export review', exact: true }).isDisabled());
    assert.equal(await page.getByText(/40 members · \+1 added/).count(), 0);
  });

  await test('Multi-subnet review enriches the selected subnet first within one record budget', 5, async (page, send, count, nodeReads) => {
    localCall('fixture', 'set_registry_mode', '(1 : nat8)');
    localCall('fixture', 'prepare_direct_registry');
    localCall('fixture', 'enable_proposal_fixture');
    await send(91);
    await finished(page);
    assert.equal(nodeReads(), 50);
    assert.equal(count('compare_membership_with_policy'), 1);
    await page.getByText(/1 affected subnet outside the enriched scope/).waitFor();
    await page.getByLabel('Subnet', { exact: true }).selectOption({ index: 1 });
    await finished(page);
    assert.equal(nodeReads(), 100);
    assert.equal(count('compare_membership_with_policy'), 2);
    assert.equal(count('membership_target_topology'), 1);
  });

  await test('Both orders and intermediate states settle with shared records', 5, async (page, send, count) => {
    localCall('fixture', 'set_registry_mode', '(1 : nat8)');
    localCall('fixture', 'prepare_direct_registry');
    localCall('fixture', 'enable_proposal_fixture');
    await send(93, '92');
    await finished(page);
    assert.equal(count('compare_membership_with_policy'), 6);
    assert.equal(count('finalize_membership_review'), 1);
    const pages = count('membership_context_detail_page');
    const order = page.getByLabel('Proposal order');
    const step = page.getByLabel('Membership state');
    await order.selectOption('AThenB');
    await step.selectOption('1');
    await page.locator('.review-summary').getByText(/51 \(\+1\) members/).waitFor();
    await page.getByRole('button', { name: 'Export review', exact: true }).click();
    await page.getByLabel('VOTE', { exact: true }).fill('Order A assessment');
    await order.selectOption('BThenA');
    await step.selectOption('1');
    await page.locator('.review-summary').getByText(/49 \(−1\) members/).waitFor();
    await page.getByRole('button', { name: 'Export review', exact: true }).click();
    const markdown = await page.getByLabel('Generated Markdown', { exact: true }).inputValue();
    assert.match(markdown, /Proposal #92 then Proposal #93/);
    assert.doesNotMatch(markdown, /Order A assessment/);
    assert.equal(count('membership_context_detail_page'), pages);
    await page.locator('#open-performance').click();
    await page.getByLabel('Performance scope').selectOption('follow');
    await page.getByLabel('Node filter').selectOption('affected');
    await page.getByText(/Proposal #92 then Proposal #93.*2 nodes/).waitFor();
  });

  console.log(JSON.stringify({ scenarios: results }, null, 2));
} finally {
  mode(0);
  await browser.close();
}
