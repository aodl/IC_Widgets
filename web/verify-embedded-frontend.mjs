// Verify the actual loopback IC HTTP gateway responses using its replica trust root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRequestResponsePair } from '@dfinity/response-verification';
import { Cbor } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';

export async function localCanisters(project, alias = 'frontend') {
  const config = JSON.parse(await readFile(resolve(project, 'dfx.json'), 'utf8'));
  const port = config.networks?.local?.bind?.match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port || config.networks.local.type !== 'ephemeral') {
    throw new Error('Use a disposable project with an ephemeral loopback IC gateway.');
  }
  const id = name => execFileSync('dfx', ['canister', 'id', '--network', 'local', name], {
    cwd: project, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
  }).trim();
  const frontend = id(alias);
  return { port, frontend, reviewer: id('reviewer'), origin: 'http://' + frontend + '.localhost:' + port };
}

// These headers are added by the local gateway or its HTTP server, outside the canister response.
const transportHeaders = new Set([
  'access-control-allow-origin', 'access-control-expose-headers', 'connection', 'date',
  'keep-alive', 'set-cookie', 'transfer-encoding', 'vary', 'x-ic-canister-id', 'x-request-id',
]);

function gatewayResponse({ port, origin }, method, path) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1', port, path, method, headers: { host: new URL(origin).host, 'accept-encoding': 'identity' },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const fields = response.rawHeaders.filter((_, index) => index % 2 === 0)
          .map((name, index) => [name.toLowerCase(), response.rawHeaders[2 * index + 1]]);
        resolve({ code: response.statusCode, headers: fields, body: Buffer.concat(chunks) });
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('IC HTTP gateway timed out')));
    req.on('error', reject);
    req.end();
  });
}

export async function verifyEmbeddedGateway(project, alias) {
  const canisters = await localCanisters(project, alias);
  const principal = Principal.fromText(canisters.frontend).toUint8Array();
  const status = await fetch('http://127.0.0.1:' + canisters.port + '/api/v2/status');
  assert.ok(status.ok);
  const root = Cbor.decode(new Uint8Array(await status.arrayBuffer())).root_key;
  const observed = [];
  async function verify(method, path, expected) {
    const gateway = await gatewayResponse(canisters, method, path);
    assert.equal(gateway.code, expected, method + ' ' + path + ': ' + gateway.body.toString().slice(0, 180));
    const headers = gateway.headers.filter(([name]) => !transportHeaders.has(name));
    const lookup = name => headers.find(([key]) => key === name)?.[1];
    const proof = verifyRequestResponsePair(
      { method, url: path, headers: [], body: [], certificate_version: [2] },
      { status_code: gateway.code, headers, body: gateway.body },
      principal, BigInt(Date.now()) * 1_000_000n, 300_000_000_000n, root, 2,
    );
    assert.equal(proof.verificationVersion, 2);
    assert.equal(proof.response.statusCode, expected);
    assert.deepEqual(Buffer.from(proof.response.body), gateway.body);
    assert.equal(lookup('x-content-type-options'), 'nosniff');
    assert.match(lookup('content-security-policy'), /connect-src 'self' https:\/\/icp-api\.io;/);
    assert.equal(lookup('cache-control'), expected === 200 && /^\/(?:app|styles)\.[a-f0-9]{64}\./.test(path)
      ? 'public, max-age=31536000, immutable' : 'public, no-cache, no-store');
    if (method === 'HEAD') assert.equal(gateway.body.length, 0);
    observed.push({ method, path, status: expected, certification: proof.verificationVersion });
    return gateway.body;
  }

  const html = await verify('GET', '/', 200);
  assert.deepEqual(await verify('GET', '/index.html', 200), html);
  const paths = [...html.toString().matchAll(/(?:src|href)="\.\/(app\.[a-f0-9]{64}\.js|styles\.[a-f0-9]{64}\.css)"/g)]
    .map(match => '/' + match[1]);
  assert.deepEqual(paths.map(path => path.split('.').at(-1)).sort(), ['css', 'js']);
  for (const path of paths) {
    const body = await verify('GET', path, 200);
    assert.equal(createHash('sha256').update(body).digest('hex'), path.split('.')[1]);
    const headers = await gatewayResponse(canisters, 'GET', path);
    const expectedMime = path.endsWith('.js') ? 'text/javascript' : 'text/css';
    assert.equal(headers.headers.find(([name]) => name === 'content-type')?.[1], expectedMime + '; charset=utf-8');
    if (path.endsWith('.js')) assert.doesNotMatch(body.toString(), /Replay scenario|nns-144954|ic-api\.internetcomputer\.org/);
    await verify('HEAD', path, 200);
  }
  await verify('HEAD', '/', 200);
  await verify('GET', '/app.js', 404);
  await verify('GET', '/.ic-assets.json5', 404);
  await verify('GET', '/unmatched/nested/path', 404);
  await verify('HEAD', '/unmatched/nested/path', 404);
  return { ...canisters, paths, observed };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [project, alias] = process.argv.slice(2);
  if (!project) throw new Error('Usage: node web/verify-embedded-frontend.mjs <local project> [frontend alias]');
  console.log(JSON.stringify(await verifyEmbeddedGateway(resolve(project), alias), null, 2));
}
