// Exercise the embedded application over the real local IC gateway with a deny-by-default network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyEmbeddedGateway } from './verify-embedded-frontend.mjs';

const [project, output] = process.argv.slice(2).map(path => resolve(path));
if (!project || !output) throw new Error('Usage: node web/browser-production-network.mjs <isolated fixture project> <output>');
// The installed local profile uses the ordinary compiled app and native IC certification.
const { origin, reviewer, paths, observed } = await verifyEmbeddedGateway(project);
const assets = new Set(['/', ...paths]);
const allow = new RegExp('^/api/v[234]/canister/' + reviewer + '/(?:call|read_state)$');

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-background-networking', '--disable-quic', '--host-resolver-rules=MAP ' + new URL(origin).hostname + ' 127.0.0.1, MAP * ~NOTFOUND'],
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
    if (host === origin && method === 'GET' && !search && assets.has(pathname)) return route.continue();
    if (host === origin && !search && (allow.test(pathname) && method === 'POST' || pathname === '/api/v2/status' && method === 'GET')) {
      protocol.push(pathname);
      return route.continue();
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
  assert.equal(await page.locator('.map-card .node-changes tbody tr').count(), 2);
  const other = page.locator('.map-card .other-nodes');
  assert.equal(await other.evaluate(node => node.open), false);
  await other.getByText('Other Nodes (39)', { exact: true }).click();
  assert.equal(await other.locator('tbody tr').count(), 39);
  await other.getByText('Other Nodes (39)', { exact: true }).click();
  assert.equal(await page.locator('.map-help, .country-legend').count(), 0);
  assert.equal(await page.locator('.review-header').getByRole('link', { name: '#144954' }).getAttribute('href'),
    'https://dashboard.internetcomputer.org/proposal/144954');
  const map = page.locator('.map-frame');
  await map.scrollIntoViewIfNeeded();
  const sh1 = map.getByRole('button', { name: /^sh1 · Stockholm, Sweden/ });
  await sh1.focus();
  await page.keyboard.press('Enter');
  const popup = page.getByRole('region', { name: 'Map location details' });
  await popup.getByText(/Country members.*Sweden.*2 → 3/).waitFor();
  await popup.getByRole('link', { name: 'sh1', exact: true }).waitFor();
  await popup.getByRole('link', { name: 'bvcsg…mqe', exact: true }).waitFor();
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
      if (pixels[i] === 237 && pixels[i + 1] === 201 && pixels[i + 2] === 200) count++;
    }
    return count;
  });
  assert.ok(screenRed > 100, 'Switzerland must show the same pale red fill on the zoomed interactive map.');
  await map.screenshot({ path: resolve(output, 'switzerland-zoom.png') });
  await page.getByRole('button', { name: 'Generate review' }).click();
  const preview = page.locator('.markdown-preview');
  await preview.locator('.node-row-added [data-recorded-country=SE] canvas[data-drawn]').waitFor();
  assert.equal(await preview.locator('.other-nodes tbody tr').count(), 39);
  const png = await preview.getByRole('img', { name: /^Report map/ }).evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 270, canvas.width, canvas.height - 270).data;
    let green = 0, red = 0, borders = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (Math.abs(r - 191) + Math.abs(g - 226) + Math.abs(b - 196) < 6) green++;
      if (Math.abs(r - 237) + Math.abs(g - 201) + Math.abs(b - 200) < 9) red++;
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
  assert.match(markdown, /Other Nodes \(39\)/);
  assert.match(markdown, /\[sh1\]\(https:\/\/dashboard\.internetcomputer\.org\/network\/centers\/sh1\)/);
  assert.equal(protocol.length, count, 'Display and report actions used IC transport.');
  assert.deepEqual(rejected, [], 'External network requests were attempted.');
  assert.deepEqual(await page.evaluate(() => window.policyViolations), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ embeddedGateway: origin, certifiedResponses: observed.length,
    productionNetworkAllowlist: 'certified frontend assets and reviewer IC protocol routes',
    protocolRequests: count, reviewerCalls: protocol.filter(path => path.endsWith('/call')).length,
    mapAndReportProtocolRequests: protocol.length - count, externalRequests: rejected.length, zoomedSwissFillPixels: screenRed, pixels: png }, null, 2));
} finally {
  await browser.close();
}
