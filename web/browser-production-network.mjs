// Exercise the production build with a real isolated replica and a deny-by-default browser network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Cbor } from '@icp-sdk/core/agent';

const [project, output] = process.argv.slice(2).map(path => resolve(path));
if (!project || !output) throw new Error('Usage: node web/browser-production-network.mjs <isolated fixture project> <output>');
const config = JSON.parse(await readFile(resolve(project, 'dfx.json'), 'utf8'));
const bind = config.networks?.local?.bind;
if (!/^127\.0\.0\.1:\d+$/.test(bind) || config.networks.local.type !== 'ephemeral') {
  throw new Error('The production transport test requires an isolated loopback replica.');
}
const reviewer = execFileSync('dfx', ['canister', 'id', '--network', 'local', 'reviewer'], {
  cwd: project, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
}).trim();
execFileSync('npm', ['--prefix', 'web', 'run', 'build'], {
  env: { ...process.env, DFX_NETWORK: 'ic', CANISTER_ID_REVIEWER: reviewer, NEXUS_REPLAY_MANIFEST: '' }, stdio: 'inherit',
});

const replica = 'http://' + bind;
const status = await fetch(replica + '/api/v2/status');
assert.ok(status.ok);
const rootKey = Buffer.from(Cbor.decode(new Uint8Array(await status.arrayBuffer())).root_key).toString('hex');
const release = await readFile('web/dist/app.js', 'utf8');
assert.doesNotMatch(release, /Replay scenario|nns-144954|ic-api\.internetcomputer\.org/);
const mainnetRoot = /308182301d060d2b0601040182dc7c0503010201060c2b0601040182dc7c05030201036100[0-9a-f]{192}/g;
assert.equal([...release.matchAll(mainnetRoot)].length, 1);
assert.notEqual(release.match(mainnetRoot)[0], rootKey);
// Substitute only the trust anchor in the test response. Certificate verification stays enabled.
// Production ships the original mainnet root and never requests a local fixture root key.
const testBundle = release.replace(mainnetRoot, rootKey);
const origin = 'https://network-nexus.test';
const api = 'https://icp-api.io';
const assets = new Map([
  ['/', ['text/html', await readFile('web/dist/index.html')]],
  ['/styles.css', ['text/css', await readFile('web/dist/styles.css')]],
  ['/app.js', ['application/javascript', testBundle]],
]);
const assetPolicy = await readFile('web/.ic-assets.json5', 'utf8');
const policy = assetPolicy.match(/"Content-Security-Policy":\s*"([^"]+)"/)?.[1];
assert.ok(policy);
const allow = new RegExp('^/api/v[234]/canister/' + reviewer + '/(?:call|read_state)$');

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-background-networking', '--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND'],
});
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
  const rejected = [], errors = [], protocol = [];
  await context.routeWebSocket('**/*', socket => {
    rejected.push(socket.url());
    socket.close();
  });
  await context.addInitScript(() => {
    window.policyViolations = [];
    addEventListener('securitypolicyviolation', event => window.policyViolations.push(event.blockedURI));
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const { origin: host, pathname, search } = new URL(request.url());
    const method = request.method();
    if (host === origin && method === 'GET' && !search && assets.has(pathname)) {
      const [contentType, body] = assets.get(pathname);
      return route.fulfill({ contentType, body, headers: { 'Content-Security-Policy': policy } });
    }
    if (host === api && !search && (allow.test(pathname) && method === 'POST' || pathname === '/api/v2/status' && method === 'GET')) {
      protocol.push(pathname);
      const response = await fetch(replica + pathname, { method, redirect: 'error',
        headers: method === 'POST' ? { 'content-type': 'application/cbor' } : {},
        body: method === 'POST' ? request.postDataBuffer() : undefined });
      return route.fulfill({ status: response.status, contentType: response.headers.get('content-type') ?? 'application/cbor',
        headers: { 'Access-Control-Allow-Origin': origin }, body: Buffer.from(await response.arrayBuffer()) });
    }
    rejected.push(request.url());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  assert.equal(await page.getByLabel('Replay scenario').count(), 0);
  await page.locator('[name=first]').fill('144954');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.locator('#report-status').getByText('Data loading complete', { exact: true }).waitFor({ timeout: 90000 });
  const count = protocol.length;
  assert.equal(protocol.filter(path => path.endsWith('/call')).length, 10, JSON.stringify(protocol));
  const flag = page.locator('.node-changes [data-recorded-country=SE] canvas[data-drawn]');
  await flag.waitFor();
  await page.locator('.node-changes').getByText('Sweden', { exact: true }).waitFor();
  await page.locator('.node-changes').getByText('Switzerland', { exact: true }).waitFor();
  const map = page.locator('.map-frame');
  await map.scrollIntoViewIfNeeded();
  const sh1 = map.getByRole('button', { name: /^sh1 · Stockholm, Sweden/ });
  await sh1.focus();
  await page.keyboard.press('Enter');
  const popup = page.getByRole('region', { name: 'Map location details' });
  await popup.getByText(/Country members.*Sweden.*2 → 3/).waitFor();
  await page.keyboard.press('Escape');
  await map.focus();
  const before = await sh1.getAttribute('style');
  await page.keyboard.press('+');
  await page.keyboard.press('ArrowLeft');
  assert.notEqual(await sh1.getAttribute('style'), before);
  await map.scrollIntoViewIfNeeded();
  const swiss = map.getByRole('button', { name: /^zh2 · Zurich, Switzerland/ });
  const { x, y, width, height } = await swiss.boundingBox();
  await page.mouse.move(x + width / 2, y + height / 2);
  for (let i = 0; i < 3; i++) {
    const old = await map.getAttribute('data-map-scale');
    await page.mouse.wheel(0, -450);
    await page.waitForFunction(scale => document.querySelector('.map-frame').dataset.mapScale !== scale, old);
  }
  const screenRed = await map.locator('.map-surface canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 239 && pixels[i + 1] === 213 && pixels[i + 2] === 212) count++;
    }
    return count;
  });
  assert.ok(screenRed > 100, 'Switzerland must show the same pale red fill on the zoomed interactive map.');
  await map.screenshot({ path: resolve(output, 'switzerland-zoom.png') });
  await page.getByRole('button', { name: 'Generate review' }).click();
  const preview = page.locator('.markdown-preview');
  await preview.locator('.node-row-added [data-recorded-country=SE] canvas[data-drawn]').waitFor();
  const png = await preview.getByRole('img', { name: /^Report map/ }).evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 270, canvas.width, canvas.height - 270).data;
    let green = 0, red = 0, borders = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (Math.abs(r - 204) + Math.abs(g - 230) + Math.abs(b - 208) < 6) green++;
      if (Math.abs(r - 239) + Math.abs(g - 213) + Math.abs(b - 212) < 9) red++;
      if (r < 197 && g < 205 && b < 196 && Math.abs(g - r) < 25 && Math.abs(b - r) < 17) borders++;
    }
    return { green, red, borders };
  });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download review' }).click();
  const zip = resolve(output, 'production-review.zip');
  await (await pending).saveAs(zip);
  await writeFile(resolve(output, 'production-map.png'), execFileSync('unzip', ['-p', zip, 'map.png']));
  assert.ok(png.green > 100 && png.red > 10 && png.borders > 100, JSON.stringify(png));
  const markdown = execFileSync('unzip', ['-p', zip, 'review.md'], { encoding: 'utf8' });
  assert.match(markdown, /🇸🇪 Sweden \(SE\) \| 2 → 3/);
  assert.match(markdown, /🇨🇭 Switzerland \(CH\) \| 3 → 2/);
  assert.match(markdown, /\]\(map\.png\)/);
  assert.equal(protocol.length, count, 'Display and report actions used IC transport.');
  assert.deepEqual(rejected, [], 'External network requests were attempted.');
  assert.deepEqual(await page.evaluate(() => window.policyViolations), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ productionNetworkAllowlist: 'application assets and reviewer IC protocol routes', protocolRequests: count,
    mapAndReportProtocolRequests: protocol.length - count, externalRequests: rejected.length, zoomedSwissFillPixels: screenRed, pixels: png }, null, 2));
} finally {
  await browser.close();
}
