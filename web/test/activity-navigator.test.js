import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Principal } from '@icp-sdk/core/principal';
import { activityRows } from '../src/activity-navigator.js';
import { scopedActivity } from '../src/review-checks.js';

const burst = JSON.parse(readFileSync(new URL('../../docs/subnet-activity/governance-2026-11-27/observation.json', import.meta.url)));
const target = value => Principal.fromText(value);
const row = (id, targets, decision = 1, voting = true, unresolved = false, fn = 31) =>
  ({ id: BigInt(id), targets: [targets.map(target)], decision: [decision], voting_open: [voting], unresolved: [unresolved], function: [fn] });

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
});

test('reuse scopes references to the current selection and retains failed refresh and incomplete coverage', () => {
  const [a] = burst.proposals;
  const proposal = row(1,[a.subnet]);
  const response = { outcome: { Ok: { proposals: [proposal], complete: false,
    matches: [{proposal:1n},{proposal:2n}] } } };
  const observation = { response, stale: true };
  const accepted = scopedActivity(observation,[1n]);
  assert.equal(accepted.stale,true);
  assert.equal(accepted.response.outcome.Ok.complete,false);
  assert.deepEqual(accepted.response.outcome.Ok.matches,[{proposal:1n}]);
  assert.equal(scopedActivity(observation,[2n]),undefined);
});
