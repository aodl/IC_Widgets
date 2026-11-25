// Use a disposable local reviewer and source fixture, as in browser-voting-review.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Cbor, requestIdOf } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from './src/reviewer.did.js';

const [project] = process.argv.slice(2);
if (!project) throw new Error('Provide the isolated local DFX project directory');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const dfx = (...args) => execFileSync('dfx', args, {
  cwd: project, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
}).trim();
const localCall = (canister, method, args = '()') => dfx('canister', 'call', '--network', 'local', canister, method, args);
const frontend = dfx('canister', 'id', '--network', 'local', 'frontend');
const reviewer = dfx('canister', 'id', '--network', 'local', 'reviewer');
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
    await page.locator('input[name=second]').fill(second);
    await page.getByRole('button', { name: 'Review', exact: true }).click();
  };
  const count = method => [...requests.values()].filter(row => row.method_name === method).length;
  try {
    await page.goto('http://' + frontend + '.localhost:4966');
    const principal = (await page.locator('#browser-principal').textContent()).trim();
    assert.match(localCall('reviewer', 'set_on_demand_caller', '(opt principal "' + principal + '")'), /Ok/);
    await run(page, send, count);
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
    if (held || content.method_name !== 'membership_detail_page') return route.continue();
    const [, keys] = IDL.decode(methods.membership_detail_page.argTypes, content.arg);
    if (!accepts(keys)) return route.continue();
    held = true;
    const response = await route.fetch();
    dispatched.release();
    await release.settled;
    return route.fulfill({ response });
  });
  return { dispatched: dispatched.settled, release: release.release };
}

try {
  await test('Supersession waits for an accepted page and clears the old workspace', 0, async (page, send, count) => {
    const hold = await holdPage(page, key => 'Nodes' in key);
    try {
      await send(144954);
      await hold.dispatched;
      await send(999999);
      await page.getByRole('heading', { name: 'Proposal #999999' }).waitFor();
      assert.equal(count('review_on_demand'), 1);
      assert.equal(count('membership_detail_page'), 1);
      assert.equal(await page.getByText('40 → 40 members', { exact: false }).count(), 0);
    } finally {
      hold.release();
    }
    await page.getByText(/Simulation unavailable.*999999.*unavailable/).waitFor();
    assert.equal(count('review_on_demand'), 2);
    assert.equal(count('membership_detail_page'), 1);
    assert.equal(count('compare_membership_details'), 0);
  });

  await test('Shared sh1 GPS absence affects all three nodes and preserves selection and zoom', 1, async (page, send) => {
    const hold = await holdPage(page, key => 'DataCenters' in key);
    try {
      await send(144954);
      await hold.dispatched;
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.getByRole('button', { name: 'Concentration increases at sh1', exact: true }).click();
      await page.locator('.inspector').getByText(/3 nodes selected/).waitFor();
    } finally {
      hold.release();
    }
    await page.getByText('Changes · 41 distinct nodes · 38/41 mapped', { exact: true }).waitFor();
    await page.getByText('Zoom 1.6×', { exact: true }).waitFor();
    await page.locator('.inspector').getByText(/3 nodes selected/).waitFor();
    await page.getByText('Unmapped nodes (3)', { exact: true }).click();
    await page.getByRole('button', { name: '+ kaoz3…4qe', exact: true }).click();
    await page.locator('.inspector').getByText(/no usable registered coordinates/).waitFor();
    await page.getByRole('button', { name: 'Before', exact: true }).click();
    await page.getByText('Before · 40 members · 38/40 mapped', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'After', exact: true }).click();
    await page.getByText('After · 40 members · 37/40 mapped', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Concentration', exact: true }).click();
    const owner = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Registered data-center owner', exact: true }) });
    assert.match(await owner.textContent(), /13 \/ 14 nodes → 12 \/ 14 nodes/);
  });

  await test('Optional rejection preserves membership and retries only one failed record', 2, async (page, send, count) => {
    await send(144954);
    await page.getByText(/Some evidence unavailable/).waitFor({ timeout: 120000 });
    await page.getByText(/40 → 40 members/).waitFor();
    const previous = count('membership_detail_page');
    mode(0);
    await page.getByRole('button', { name: 'Retry unavailable evidence', exact: true }).click();
    await page.getByText('Changes · 41 distinct nodes · 41/41 mapped', { exact: true }).waitFor();
    assert.equal(count('membership_detail_page'), previous + 1);
    assert.equal(count('review_on_demand'), 1);
  });

  await test('Conflicting membership blocks the simulation', 3, async (page, send, count) => {
    await send(144954);
    await page.getByText(/Simulation unavailable.*conflicting/).waitFor();
    assert.equal(await page.getByText(/40 → 40 members/).count(), 0);
    assert.equal(await page.getByRole('button', {name:'Export review'}).count(), 0);
    assert.equal(count('membership_detail_page'), 0);
  });

  await test('Executed proposal retains the historical before-state qualification', 4, async (page, send) => {
    await send(144954);
    await page.getByText(/Executed observed/).waitFor();
    await page.getByText(/actual historical before-state is unavailable/).waitFor();
    await page.getByText(/Analysis loaded/).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: 'Export review', exact: true }).click();
    assert.match(await page.getByLabel('Generated Markdown', { exact: true }).inputValue(), /historical/i);
  });

  await test('Both proposal orders and intermediate states share source evidence', 5, async (page, send, count) => {
    localCall('fixture', 'set_registry_mode', '(1 : nat8)');
    localCall('fixture', 'prepare_direct_registry');
    localCall('fixture', 'enable_proposal_fixture');
    await send(93, '92');
    await page.getByText(/different intermediate memberships/).waitFor();
    await page.getByText(/^Analysis loaded · assignment checks remain partial$|^Analysis loaded$/).waitFor({ timeout: 120000 });
    const pages = count('membership_detail_page');
    assert.ok(count('compare_membership_details') >= 4);
    const order = page.getByLabel('Proposal order');
    const step = page.getByLabel('Membership state');
    await order.selectOption('AThenB');
    await step.selectOption('1');
    await page.getByText(/50 → 51 members/).waitFor();
    await page.getByRole('button', { name: 'Export review', exact: true }).click();
    await page.getByLabel('VOTE', { exact: true }).fill('Order A assessment');
    const a = await page.getByLabel('Generated Markdown', { exact: true }).inputValue();
    await order.selectOption('BThenA');
    await step.selectOption('1');
    await page.getByText(/50 → 49 members/).waitFor();
    const b = await page.getByLabel('Generated Markdown', { exact: true }).inputValue();
    assert.match(b, /Proposal #92 then Proposal #93/);
    assert.match(a, /Proposal #93 then Proposal #92/);
    assert.doesNotMatch(b, /Order A assessment/);
    assert.equal(count('membership_detail_page'), pages);
    assert.equal(count('review_on_demand'), 1);
  });

  console.log(JSON.stringify({ scenarios: results }, null, 2));
} finally {
  mode(0);
  await browser.close();
}
