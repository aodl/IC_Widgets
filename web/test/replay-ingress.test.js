import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cbor } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { replayRequest } from '../replay-ingress.mjs';

const reviewer = Principal.fromUint8Array(Uint8Array.of(1, 1));
const reviewers = new Set([reviewer.toText()]);
const prefix = '/api/v4/canister/' + reviewer.toText();
const envelope = {
  content: {
    request_type: 'call', canister_id: reviewer.toUint8Array(),
    method_name: 'begin_membership_review', sender: Uint8Array.of(1),
    arg: Uint8Array.of(1), ingress_expiry: 1_800_000_000_000_000_000n,
  },
  sender_pubkey: Uint8Array.of(2),
  sender_sig: Uint8Array.of(3),
};
const submit = (changes = {}, path = prefix + '/call') =>
  replayRequest(path, reviewers, new Uint8Array(Cbor.encode({
    ...envelope, content: { ...envelope.content, ...changes },
  })));

test('development ingress passes the signed reviewer request and strips unneeded fields', () => {
  const body = submit({ obsolete: 'ignored' });
  assert.ok(body);
  assert.deepEqual(Cbor.decode(new Uint8Array(body)), envelope);
});

test('development ingress keeps other canisters, controller methods and arbitrary read-state paths private', () => {
  assert.equal(submit({ canister_id: Principal.managementCanister().toUint8Array() }), undefined);
  assert.equal(submit({ method_name: 'configure_collection' }), undefined);
  assert.equal(submit({}, '/api/v4/canister/aaaaa-aa/call'), undefined);
  assert.equal(submit({}, '/_/dashboard'), undefined);
  const readPath = '/api/v3/canister/' + reviewer.toText() + '/read_state';
  assert.ok(submit({ request_type: 'read_state', paths: [[Buffer.from('request_status'), new Uint8Array(32)]] }, readPath));
  assert.equal(submit({ request_type: 'read_state', paths: [[Buffer.from('canister'), reviewer.toUint8Array()]] }, readPath), undefined);
});
