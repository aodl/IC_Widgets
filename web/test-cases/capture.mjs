// Generate immutable Candid replies on the disposable historical fixture network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { idlFactory } from '../src/reviewer.did.js';
import { createReviewSession, reviewContexts, recordKey } from '../src/review-session.js';
import { branch, option, principal } from '../src/view.js';
import { capturedInputs } from './source-inputs.mjs';

const [projectArg, output, ...caseIds] = process.argv.slice(2);
if (!projectArg || !output) throw new Error('Usage: node web/test-cases/capture.mjs <disposable project> <output JSON> [case ID ...]');
const cwd = resolve(projectArg);
const config = JSON.parse(await readFile(resolve(cwd, 'dfx.json'), 'utf8'));
const bind = config.networks?.local?.bind;
assert.match(bind, /^127\.0\.0\.1:\d+$/);
assert.equal(config.networks.local.type, 'ephemeral');
const dfx = (args) => execFileSync('dfx', ['canister', ...args, '--network', 'local'], {
  cwd, env: { ...process.env, DFX_IDENTITY: 'codex_local' }, encoding: 'utf8',
}).trim();
const id = dfx(['id', 'reviewer']);
const source = dfx(['id', 'fixture']);
const { replays } = JSON.parse(await readFile(
  new URL('../../tests/source-fixture/data/historical/replays.json', import.meta.url), 'utf8'));
const service = idlFactory({ IDL }).fieldsAsObject();
const capture = { version: 1, inputs: await capturedInputs(), cases: {} };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const interactive = replays.filter(row => row.menu);
assert.ok(caseIds.every(id => interactive.some(row => row.id === id)), 'Unknown interactive test case');
for (const row of interactive.filter(row => !caseIds.length || caseIds.includes(row.id))) {
  dfx(['call', '--candid', 'fixture.did', 'fixture', 'load_review_case', '(' + JSON.stringify(row.id) + ')']);
  const agent = await HttpAgent.create({
    host: 'http://' + bind, shouldFetchRootKey: true, identity: Ed25519KeyIdentity.generate(),
  });
  const actor = Actor.createActor(idlFactory, { agent, canisterId: id });
  const replies = {}, pages = {};
  const client = new Proxy(actor, {
    get(target, method, receiver) {
      if (typeof method !== 'string' || !Object.hasOwn(service, method)) return Reflect.get(target, method, receiver);
      return async (...args) => {
        const type = service[method];
        const inputHash = digest(IDL.encode(type.argTypes, args));
        const reply = await target[method](...args);
        (replies[method] ??= {})[inputHash] = Buffer.from(IDL.encode(type.retTypes, [reply])).toString('base64');
        if (method === 'membership_context_detail_page' && reply.Ok?.outcome?.Ok) {
          const kind = branch(args[1]);
          const bank = pages[kind] ??= {};
          args[1][kind].forEach((id, index) => { bank[recordKey(id)] ??= { inputHash, index }; });
        }
        return reply;
      };
    },
  });
  const preview = await client.begin_membership_review(row.proposal_ids.map(BigInt));
  const live = preview.Ok;
  assert.ok(live?.outcome.Ok, row.id + ' registered proposal evidence · ' + (preview.Err ?? Object.keys(live?.outcome.Err ?? {}).join(', ')));
  const { report, subnet_rules, review_context } = live.outcome.Ok;
  const contexts = reviewContexts(report, option(subnet_rules) ?? []);
  const ready = contexts.filter(item => item.index && item.state && item.rules);
  const statuses = [];
  if (option(review_context) && ready.length) {
    const session = createReviewSession({ live, contexts, active: () => true,
      call: (active, run) => active() ? run(client) : undefined,
      updated() {}, progress: ({ stage }) => statuses.push(stage),
    });
    const order = report.scenarios.find(item => branch(item.id) === 'AThenB') ?? report.scenarios[0];
    const first = ready.filter(item => item.scenario === order);
    const selected = first.filter(item => principal(item.subnet) === principal(first[0].subnet)).at(-1);
    for (const context of [selected, ...ready.filter(item => item !== selected)]) {
      if (context.status !== 'pending') continue;
      session.select(context);
      await session.settled();
    }
    assert.ok(ready.every(item => item.calculation), row.id + ' comparisons captured');
    if (!session.section().final && session.section().retryable) {
      session.retry();
      await session.settled();
    }
    assert.ok(session.section().final && statuses.includes('Finished'),
      row.id + ' settlement captured · ' + (session.section().consistency?.reason ?? statuses.join(', ')));
  }
  if (row.activity?.length) {
    const check = await client.subnet_activity(row.proposal_ids.map(BigInt));
    assert.ok(check.Ok?.outcome.Ok, row.id + ' Governance discovery captured');
  }
  capture.cases[row.id] = { replies, pages };
  console.log(row.id + ' ' + Object.values(replies).reduce((count, batch) => count + Object.keys(batch).length, 0) + ' typed replies');
  agent.invalidateIdentity();
}
await writeFile(output, JSON.stringify(capture) + '\n');
console.log('Captured from disposable reviewer ' + id + ' and fixture ' + source + '.');
