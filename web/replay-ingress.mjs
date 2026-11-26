import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cbor } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';

const updates = new Set([
  'begin_membership_review', 'membership_context_detail_page', 'membership_target_topology',
  'compare_membership_with_policy', 'finalize_membership_review', 'node_performance_on_demand',
]);
const endpoint = /^\/api\/(v2|v3|v4)\/canister\/([a-z0-9-]+)\/(call|read_state)$/;
const maxBody = 272 * 1024;
const requestStatus = Buffer.from('request_status');

export function replayRequest(path, reviewers, bytes) {
  const match = endpoint.exec(path);
  if (!match || !reviewers.has(match[2])) return;
  const [, version, target, verb] = match;
  if (verb === 'call' ? version === 'v3' : version !== 'v3') return;
  try {
    const { content, sender_pubkey, sender_sig } = Cbor.decode(bytes);
    const { request_type, sender, ingress_expiry } = content;
    if (!(sender instanceof Uint8Array) || !(sender_pubkey instanceof Uint8Array)
        || !(sender_sig instanceof Uint8Array) || typeof ingress_expiry !== 'bigint') return;
    let allowed = { request_type, sender, ingress_expiry };
    if (verb === 'call') {
      const { canister_id, method_name, arg, nonce } = content;
      if (request_type !== 'call' || !(canister_id instanceof Uint8Array)
          || Principal.fromUint8Array(canister_id).toText() !== target
          || !updates.has(method_name) || !(arg instanceof Uint8Array)
          || (nonce !== undefined && !(nonce instanceof Uint8Array))) return;
      allowed = { ...allowed, canister_id, method_name, arg };
      if (nonce !== undefined) allowed.nonce = nonce;
    } else {
      const [status, id] = content.paths?.[0] ?? [];
      if (request_type !== 'read_state' || content.paths?.length !== 1
          || content.paths[0].length !== 2
          || !(status instanceof Uint8Array) || !requestStatus.equals(status)
          || !(id instanceof Uint8Array) || id.length !== 32) return;
      allowed.paths = [[status, id]];
    }
    // Re-encode only the checked fields. The IC verifies the browser's signature.
    return Cbor.encode({ content: allowed, sender_pubkey, sender_sig });
  } catch {
    return undefined;
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBody) return;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function replayIngress(project, replicaPort) {
  const manifest = JSON.parse(await readFile(resolve(project, 'replays.json'), 'utf8'));
  const config = JSON.parse(await readFile(resolve(project, 'dfx.json'), 'utf8'));
  if (config.networks?.local?.bind !== '127.0.0.1:' + replicaPort
      || config.networks.local.type !== 'ephemeral') throw new Error('An isolated loopback replay is required.');
  const reviewers = new Set(manifest.cases.map(row => Principal.fromText(row.reviewer).toText()));
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path, { type, bytes: await readFile(resolve(project, 'assets', file)) }])));
  const replica = 'http://127.0.0.1:' + replicaPort;
  let active = 0;
  return createServer({ requestTimeout: 10_000 }, async (request, response) => {
    const path = request.url.split('?')[0];
    const asset = assets.get(path);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy',
      "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (asset && ['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(200, { 'Content-Type': asset.type }).end(request.method === 'HEAD' ? undefined : asset.bytes);
      return;
    }
    const status = path === '/api/v2/status' && request.method === 'GET';
    const signed = endpoint.exec(path);
    if (!status && (!signed || request.method !== 'POST' || !reviewers.has(signed[2]))) {
      response.writeHead(404).end();
      return;
    }
    if (active >= 24) {
      response.writeHead(429).end('Development replay is busy. Try again shortly.');
      return;
    }
    active++;
    try {
      let body;
      if (!status) {
        if (request.headers['content-type']?.split(';')[0] !== 'application/cbor') {
          response.writeHead(415).end();
          return;
        }
        const bytes = await readBody(request);
        if (!bytes) {
          response.writeHead(413).end();
          return;
        }
        body = replayRequest(path, reviewers, bytes);
        if (!body) {
          response.writeHead(403).end();
          return;
        }
      }
      const upstream = await fetch(replica + path, {
        method: request.method,
        headers: body ? { 'Content-Type': 'application/cbor' } : {},
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(125_000),
      });
      const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const bytes = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, { 'Content-Type': type }).end(bytes);
    } catch {
      response.writeHead(502).end('The local development replica is unavailable.');
    } finally {
      active--;
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [project, replicaPort, ingressPort = '4972'] = process.argv.slice(2);
  if (!project || !/^\d{4,5}$/.test(replicaPort ?? '') || !/^\d{4,5}$/.test(ingressPort)) {
    throw new Error('Usage: node web/replay-ingress.mjs <local project> <replica port> [ingress port]');
  }
  const server = await replayIngress(project, replicaPort);
  server.listen(Number(ingressPort), '127.0.0.1', () => console.log('Replay ingress on 127.0.0.1:' + ingressPort));
}
