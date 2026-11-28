import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Principal } from '@icp-sdk/core/principal';
import { activityRows, rowSummary } from '../src/activity-navigator.js';
import { acceptScopedActivity, discoveryScope, scopedActivity } from '../src/review-checks.js';

const burst = JSON.parse(readFileSync(new URL('../../docs/subnet-activity/governance-2026-11-27/observation.json', import.meta.url)));
const target = value => Principal.fromText(value);
const row = (id, targets, decision = 1, voting = true, unresolved = false, fn = 31) =>
  ({ id: BigInt(id), targets: [targets.map(target)], decision: [decision], voting_open: [voting], unresolved: [unresolved], function: [fn],
    lifecycle: decision === 3 ? { AdoptedPendingExecution: null } : decision === 1 ? { Open: null } : { Other: null }, deadline: [] });

test('recorded burst maps to five registered subnets without filling unobserved counts', () => {
  const proposals = burst.proposals.map(item => row(item.id, [item.subnet]));
  const extra = 'tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe';
  const payload = { subnets: [[...burst.proposals.map(item => target(item.subnet)), target(extra)]], proposals };
  const result = activityRows(payload, 'all');
  assert.deepEqual([...result.bySubnet.values()].map(items => items.length), [1, 1, 1, 1, 1, 0]);
  assert.equal(burst.discoveryComplete, false);
});

test('multi-subnet removals appear under each target and retain unresolved associations', () => {
  const [a, b] = burst.proposals.map(item => item.subnet);
  const removal = row(1, [a,b], 1, true, true, 13);
  const executed = row(2, [a], 4);
  const payload = { subnets: [[target(a),target(b)]], proposals: [removal, executed] };
  const undecided = activityRows(payload, 'undecided');
  const voting = activityRows(payload, 'voting');
  assert.deepEqual(undecided.bySubnet.get(a), [removal]);
  assert.deepEqual(voting.bySubnet.get(a), [removal,executed]);
  assert.deepEqual(voting.bySubnet.get(b), [removal]);
  assert.deepEqual(voting.unresolved, [removal]);
  assert.equal(voting.membershipCount, 2);
  assert.equal(voting.affectedCount, 2);
});

test('earliest voting deadline excludes closed proposals and separately counts adopted work', () => {
  const closed = { ...row(1, [], 3, false), deadline: [10n] };
  const open = { ...row(2, []), deadline: [20n] };
  const decided = { ...row(3, [], 4), deadline: [15n] };
  assert.deepEqual(rowSummary([closed, open, decided]), { deadline: 15n, awaiting: 1 });
});

const hash = Uint8Array.from([5, 8]);
const accepted = { id: 1n, function: 31, payload_hash: hash };
function discovery(attempt, instructions, matches = [{ proposal: 1n }, { proposal: 2n }]) {
  return { attempt, response: { usage: { finished_at: BigInt(attempt) }, outcome: { Ok: {
    requested_instructions: [instructions], truncated_proposals: [[1n]], complete: false, matches,
  } } } };
}

test('discovery findings bind to the accepted executable function and payload in every selected proposal', () => {
  const candidate = discovery(1, [[1n, 31, hash]]);
  const scoped = scopedActivity(candidate, [accepted]);
  assert.deepEqual(scoped.response.outcome.Ok.matches, [{ proposal: 1n }]);
  assert.equal(scoped.truncated, true);
  assert.match(scopedActivity(candidate, [accepted, { ...accepted, id: 2n }]).error, /could not verify/);
  assert.match(scopedActivity(candidate, [{ ...accepted, function: 2 }]).error, /could not verify/);
  assert.match(scopedActivity(candidate, [{ ...accepted, payload_hash: [9] }]).error, /could not verify/);
});

test('a successful scan missing the selection marks earlier finds stale and late attempts cannot replace them', () => {
  const first = acceptScopedActivity(undefined, discovery(1, [[1n, 31, hash]]), [accepted]);
  const missing = acceptScopedActivity(first, discovery(3, [[2n, 31, hash]]), [accepted]);
  assert.equal(missing.stale, true);
  assert.equal(missing.response.usage.finished_at, 1n);
  assert.match(missing.error, /could not verify/);
  assert.equal(acceptScopedActivity(missing, discovery(2, [[1n, 31, hash]]), [accepted]), missing);
  const failed = acceptScopedActivity(missing, { attempt: 4, error: 'Refresh failed · network' }, [accepted]);
  assert.equal(failed.response, first.response);
  assert.equal(failed.error, 'Refresh failed · network');
  const fresh = acceptScopedActivity(failed, discovery(5, [[1n, 31, hash]], []), [accepted]);
  assert.equal(fresh.stale, undefined);
  assert.deepEqual(fresh.response.outcome.Ok.matches, []);
});

test('a refresh can check accepted node identities even after the proposal leaves the list', () => {
  const node = target(burst.proposals[0].subnet);
  const scope = discoveryScope({ manifest: { proposals: [accepted] },
    scenarios: [{ steps: [{ proposal: 1n, requested: { Add: { nodes: [node, node] } } }] }] });
  const refreshed = discovery(4, [], []);
  refreshed.response.outcome.Ok.coverage = {
    pagination_complete: false, issues: ['bounded page was incomplete'], unsupported_actions: 0,
    missing_payloads: 0, malformed_payloads: 0,
  };
  refreshed.response.outcome.Ok.node_projection = [{
    requested: scope, matches: [{ proposal: 1n, other: 2n }], omitted_matches: 0,
  }];
  const scoped = scopedActivity(refreshed, [accepted], scope);
  assert.equal(scope.length, 1);
  assert.equal(scoped.projected, true);
  assert.deepEqual(scoped.response.outcome.Ok.matches, [{ proposal: 1n, other: 2n }]);
  assert.equal(scoped.response.outcome.Ok.complete, false);
  assert.match(scopedActivity(refreshed, [accepted], [[1n, node, { Outgoing: null }]]).error, /could not verify/);
});
