import assert from 'node:assert/strict';
import test from 'node:test';
import { Principal } from '@icp-sdk/core/principal';
import { nodeSelection } from '../src/node-snapshot.js';
import { composedOutputs, readMapScene, readNodeFilter } from '../src/composed-scope.js';
import { inspectionSubjectProfile, readInspectionSubject, proposalInput, proposalInputProfile, subnetInput, subnetInputProfile } from '../src/view-inputs.js';

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
  assert.deepEqual(existing.nodes, { selected: [], before: [], incoming: [], outgoing: [], affected: [] });
  assert.deepEqual(comparison.nodes.affected, [node.toText()]);
  assert.throws(() => comparison.nodes.selected.push(node), TypeError);
});

test('connected Performance gets only the exact finite producer filter, including ready-empty', () => {
  const subnet = Principal.fromUint8Array(Uint8Array.of(19, 2)).toText();
  const nodes = [1, 2, 3, 4].map(id => Principal.fromUint8Array(Uint8Array.of(id, 2)).toText());
  const selected = [nodes[0], nodes[2]];
  const selection = nodeSelection({ kind: 'comparison', registryVersion: 42n, selected, before: nodes.slice(0, 2), incoming: [nodes[2]],
    outgoing: [nodes[1]], affected: nodes.slice(1), revision: 'digest', subnet, label: 'Test scope' });
  const members = [
    { id: nodes[0], role: 'Retained', label: 'one', point: undefined },
    { id: nodes[1], role: 'Removed', label: 'two' },
    { id: nodes[2], role: 'Added', label: 'three', point: { lat: 10, lon: -15 } },
  ];
  const map = { members, countries: { groups: [], shades: {}, note: '' } };
  const { scene, filter } = composedOutputs(selection, map);
  assert.equal(scene.revision, filter.revision);
  assert.deepEqual(readMapScene(scene).members.map(member => member.id), nodes.slice(0, 3));
  assert.equal(Object.hasOwn(readMapScene(scene).members[0], 'point'), false);
  assert.equal(readNodeFilter(filter).scope, 'membership-union');
  assert.deepEqual(readNodeFilter(filter).nodeIds, nodes.slice(0, 3));
  assert.deepEqual(readNodeFilter(composedOutputs(selection, map, 'proposed-membership').filter).nodeIds, selected);
  assert.deepEqual(readNodeFilter(composedOutputs(selection, map, 'before-membership').filter).nodeIds, nodes.slice(0, 2));
  assert.deepEqual(readNodeFilter(composedOutputs(selection, map, 'changed-membership').filter).nodeIds, [nodes[2], nodes[1]]);
  assert.deepEqual(readNodeFilter(composedOutputs(selection, map, 'affected-membership').filter).nodeIds, nodes.slice(1));
  assert.deepEqual(readNodeFilter({ ...filter, value: { ...filter.value, nodeIds: [] } }).nodeIds, []);
  assert.throws(() => readNodeFilter({ kind: 'waiting' }), /Invalid widget evidence/);
  assert.throws(() => readNodeFilter({ ...filter, value: { ...filter.value, nodeIds: [nodes[0], nodes[0]] } }), /Invalid finite/);
  assert.throws(() => readMapScene({ ...scene, value: { ...scene.value, members: [members[0], members[0]] } }), /Invalid finite/);
});


test('inspection subjects preserve exact selection, including target context and proposal order', () => {
  const subnet = Principal.fromUint8Array(Uint8Array.of(1, 2, 1)).toText();
  const read = (value, profile = inspectionSubjectProfile) => readInspectionSubject({ kind: 'ready', profile, value });
  assert.deepEqual(read({ kind: 'subnet', subnet }), { kind: 'subnet', subnet });
  const scoped = { kind: 'proposals', proposalIds: ['18446744073709551615', '144954'], subnet };
  assert.deepEqual(read(scoped), scoped);
  for (const value of [
    { ...scoped, proposalIds: ['0144954'] },
    { ...scoped, proposalIds: ['144954', '144954'] },
    { ...scoped, proposalIds: ['144954', ''] },
    { ...scoped, proposalIds: ['146', '147', '148'] },
    { ...scoped, subnet: 'aaaaa-aa' },
    { ...scoped, subnet: ' ' + subnet },
    { ...scoped, evidence: {} },
    { ...scoped, kind: 'subnet' },
  ]) assert.throws(() => read(value));
  assert.throws(() => read(scoped, { ...inspectionSubjectProfile, major: 2 }));
  assert.throws(() => readInspectionSubject({ kind: 'waiting' }));
});
