import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { localCanisters } from '../verify-embedded-frontend.mjs';
import { testCatalogue } from './catalogue.mjs';

const [project] = process.argv.slice(2);
if (!project) throw new Error('Usage: node web/test-cases/measure.mjs <disposable project>');
const cwd = resolve(project);
const { origin } = await localCanisters(cwd);
const { cases } = await testCatalogue();
const sample = cases.find(row => row.id === 'nns-144954-recorded-open');
const routes = ['/test-cases', '/test-cases/' + sample.id, '/' + sample.asset];
const balance = alias => {
  const status = execFileSync('dfx', ['canister', 'status', '--network', 'local', alias], {
    cwd, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
  });
  return BigInt(/^Balance: ([\d_]+) Cycles$/m.exec(status)[1].replaceAll('_', ''));
};
async function request(path) {
  const response = await fetch(origin + path, { redirect: 'error' });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('ic-certificate'));
  return (await response.arrayBuffer()).byteLength;
}
for (const path of routes) await request(path);
const reviewerBefore = balance('reviewer');
const frontendBefore = balance('frontend');
const start = Date.now();
let bytes = 0;
for (let index = 0; index < 20; index++) {
  for (const path of routes) bytes += await request(path);
}
const elapsedMs = Date.now() - start;
const frontendAfter = balance('frontend');
const reviewerAfter = balance('reviewer');
const measurement = (before, after) => ({ before: String(before), after: String(after), decrease: String(before - after) });
console.log(JSON.stringify({ queryRequests: 60, bytes, elapsedMs, routes, separatelyMeasuredLocalBalance: {
  frontend: measurement(frontendBefore, frontendAfter), reviewer: measurement(reviewerBefore, reviewerAfter),
} }, null, 2));
