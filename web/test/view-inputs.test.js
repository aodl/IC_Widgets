import assert from 'node:assert/strict';
import test from 'node:test';
import { Principal } from '@icp-sdk/core/principal';
import { nodeSelection, performanceSelection } from '../src/node-snapshot.js';
import { proposalInput, proposalInputProfile, subnetInput, subnetInputProfile } from '../src/view-inputs.js';

test('view anchors are typed separately and preserve exact proposal IDs', () => {
  const id = Principal.fromUint8Array(Uint8Array.of(41, 2));
  assert.deepEqual(subnetInput(' ' + id.toText()), { profile: subnetInputProfile, value: id.toText() });
  assert.throws(() => subnetInput('aaaaa-aa'), /subnet principal/);
  assert.throws(() => subnetInput('2vxsx-fae'), /subnet principal/);
  assert.deepEqual(proposalInput('18446744073709551615', ' 42 '), {
    profile: proposalInputProfile, value: ['18446744073709551615', '42'],
  });
  assert.throws(() => proposalInput('00042', '42'), /distinct positive/);
  assert.throws(() => proposalInput('1e2', ''), /distinct positive/);
});

test('both variants share a finite Performance selection contract, including ready-empty', () => {
  const node = Principal.fromUint8Array(Uint8Array.of(1, 2));
  const existing = nodeSelection({ kind: 'existing', registryVersion: 18_446_744_073_709_551_615n, selected: [] });
  const comparison = nodeSelection({ kind: 'comparison', registryVersion: 42n, selected: [], affected: [node], outgoing: [node] });
  assert.deepEqual(existing.profile, comparison.profile);
  assert.equal(existing.registryVersion, '18446744073709551615');
  assert.deepEqual(existing.nodes, { selected: [], incoming: [], outgoing: [], affected: [] });
  assert.deepEqual(comparison.nodes.affected, [node.toText()]);
  assert.throws(() => comparison.nodes.selected.push(node), TypeError);
});

test('bridged Performance accepts only an explicitly finite versioned scope', () => {
  const subnet = Principal.fromUint8Array(Uint8Array.of(19, 2)).toText();
  const value = nodeSelection({ kind: 'existing', registryVersion: 42n, selected: [], revision: 'a', subnet, label: 'Test scope' });
  const ready = { kind: 'ready', profile: value.profile, revision: 'a', value };
  assert.deepEqual(performanceSelection(ready).nodes.selected, []);
  assert.throws(() => performanceSelection({ ...ready, revision: 'superseded' }), /Unsupported/);
  assert.throws(() => performanceSelection({ ...ready, value: { ...value, nodes: {} } }), /Invalid finite/);
});
