import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compositionDimensions, compositionRows, distanceSummary, memberEvidence, metricDelta, reviewReadiness, roleSummary } from '../src/detail-model.js';
import { reviewZip } from '../src/review-export.js';
import { reportSnapshot, reviewMarkdown } from '../src/review-markdown.js';
import { fitLocations, mapLocations, mapProjection, mapScene, markerDiameter } from '../src/review-map.js';

const group = (label, count) => [{ RegisteredLabel: label }, count];
const distribution = (key, groups, unknown = 0) => new Map([[key, {
  groups, unknown, largest: groups.length ? [Math.max(...groups.map(([, count]) => count))] : [],
}]]);
const view = { width: 310, height: 340 };

test('recorded grouping preserves every tie and uses strict one-third coefficients on a six-member subnet', () => {
  const before = distribution('RegisteredCountry', [group('SE', 1), group('CH', 2), group('US', 2), group('DE', 1)]);
  const after = distribution('RegisteredCountry', [group('SE', 2), group('CH', 1), group('US', 2), group('DE', 1)]);
  for (const row of [before, after]) Object.assign(row.get('RegisteredCountry'), {
    greater_than_one_third: [{ groups_to_reach: [2], nodes_required: 3 }],
    fault_budget_plus_one: [{ groups_to_reach: [1], nodes_required: 2 }],
  });
  const item = compositionDimensions(before, after)[1];
  assert.deepEqual(item.ties.map(list => list.map(row => row.label)), [['CH', 'US'], ['SE', 'US']]);
  assert.deepEqual(item.thresholds, [3, 3]);
  assert.deepEqual([item.distinct.text, item.largest.text, item.coefficient.text], ['4', '2', '2']);
  assert.equal(compositionRows(before, after).find(row => row.group === 'SE').delta.text, '1 → 2');
  before.get('RegisteredCountry').unknown = 1;
  const partial = compositionDimensions(before, after)[1];
  assert.equal(partial.coefficient.text, '2 · Before unavailable');
  assert.equal(partial.distinct.text, '≥4 → 4');
  assert.equal(partial.distinct.direction, 0);
});

test('distance formatting keeps exact evidence, tiny changes, zero and absent pairs distinct', () => {
  const row = (valid, total, mean) => ({
    valid_pairs: BigInt(valid), total_pairs: BigInt(total), minimum_metres: valid ? [0] : [],
    mean_metres: valid ? [mean] : [], maximum_metres: valid ? [19_461_421] : [],
  });
  const full = distanceSummary(row(780, 780, 7_367_029), row(780, 780, 7_361_847));
  assert.deepEqual(full.columns.map(column => column.delta.text), ['0 km', '7,367.0 km → 7,361.8 km', '19,461.4 km']);
  assert.deepEqual(full.columns[1].metres, [7_367_029, 7_361_847]);
  const partial = distanceSummary(row(1, 3, 0), row(3, 3, 1));
  assert.match(partial.coverage, /1 of 3 pairs before · 3 of 3 pairs proposed · known pairs only/);
  assert.equal(partial.columns[1].delta.text, '0 km → 0.001 km');
  assert.equal(partial.columns[1].delta.direction, 0);
  assert.equal(distanceSummary(row(0, 0), row(0, 0)).columns[0].delta.text, 'Unavailable from recorded evidence');
  assert.equal(metricDelta(28, 28).text, '28');
  assert.equal(metricDelta(2, 3).accessible, '2 before, 3 proposed');
});

test('settled loading, accepted calculations and Governance verification report separate outcomes', () => {
  const accepted = { status: 'partial', calculation: {} };
  assert.deepEqual(reviewReadiness(accepted, { work: 'running', stage: 'Lifecycle' }),
    { calculation: 'Complete', governance: 'Final verification in progress' });
  assert.deepEqual(reviewReadiness(accepted, { work: 'settled', consistency: { reason: 'timeout' } }),
    { calculation: 'Complete', governance: 'Final verification failed' });
  assert.deepEqual(reviewReadiness({ status: 'unavailable' }, { work: 'settled', final: [] }),
    { calculation: 'Failed', governance: 'Final verification passed' });
  assert.equal(reviewReadiness({ ...accepted, status: 'stale' }, { work: 'settled' }).calculation, 'Previous result retained');
});

test('co-location retains identities and facility counts without moving nearby or overlapping locations', () => {
  const node = (id, role, dc = 'site', lon = 20) => ({ id, role, dc, point: { lon, lat: 30 } });
  const nodes = [node('a', 'Added'), node('b', 'Removed'), node('c', 'Retained'), node('d', 'Retained'),
    node('e', 'Retained', 'other'), node('f', 'Removed', 'nearby', 20.001)];
  const geography = mapLocations(nodes);
  assert.equal(geography.locations.length, 2);
  assert.equal(geography.mapped, 6);
  assert.equal(markerDiameter, 12);
  const [shared, nearby] = geography.locations;
  assert.deepEqual(shared.roles, ['Added', 'Removed', 'Retained']);
  assert.deepEqual(shared.sites.map(item => item.id), ['other', 'site']);
  const [site] = shared.sites.slice(1);
  assert.equal(site.count.text, '3');
  assert.equal(site.nodes.length, 4);
  assert.equal(roleSummary(site.nodes), 'Add 1 · Remove 1 · Unchanged 2');
  assert.equal(nearby.sites[0].count.text, '1 → 0');
  for (const size of [view, { width: 750, height: 500 }]) {
    for (const camera of [{ lon: 0, lat: 0, scale: 1 }, { lon: 20, lat: 30, scale: 9 }]) {
      const { project } = mapProjection(size, camera);
      const scene = mapScene(geography, project, size);
      assert.equal(scene.locations.length, 2);
      assert.deepEqual(scene.locations.map(({ x, y }) => ({ x, y })), [project(20, 30), project(20.001, 30)]);
      assert.notEqual(scene.locations[0].x, scene.locations[1].x);
      assert.deepEqual([...scene.labels.map(item => item.site.id), ...scene.overflow.map(item => item.id)].sort(), ['nearby', 'site']);
    }
  }
  const newPin = nodes.map(item => item.dc === 'site' ? { ...item, point: { lon: 40, lat: 30 } } : item);
  assert.equal(mapLocations(newPin).locations[0].point.lon, 40);
  const conflict = mapLocations([{ ...nodes[0], point: { lon: 40, lat: 30 } }, ...nodes.slice(1)]);
  assert.equal(conflict.unmapped.length, 4);
  assert.match(conflict.unmapped[0].locationIssue, /Conflicting coordinates/);
  const outside = mapScene(geography, mapProjection(view, { lon: -160, lat: 0, scale: 10 }).project, view);
  assert.equal(outside.visible.length, 0);
  assert.ok(outside.locations.every(location => location.x > view.width));
});

test('missing owner and coordinate evidence preserve known provider and operator', () => {
  const id = text => ({ toText: () => text });
  const coordinates = { latitude_e7: 12, longitude_e7: 34 };
  const evidence = {
    Nodes: new Map([['node', [null, { Present: { value: { operator: [id('operator')] } } }]]]),
    Operators: new Map([['operator', [null, { Present: { value: { provider: [id('provider')], data_center: 'dc' } } }]]]),
    DataCenters: new Map([['dc', [null, { Present: { value: { registered_owner: '', coordinates: [coordinates] } } }]]]),
  };
  const ready = { work: 'settled' };
  const node = memberEvidence(evidence, 'node', 'Retained', ready);
  assert.equal(node.owner, '');
  assert.equal(node.provider, 'provider');
  assert.equal(node.operatorId, 'operator');
  assert.ok(node.point);
  evidence.DataCenters.set('dc', [null, { Unavailable: { reason: 'fixture error' } }]);
  const failed = memberEvidence(evidence, 'node', 'Retained', ready);
  assert.equal(failed.provider, 'provider');
  assert.match(failed.locationIssue, /^Could not load/);
  evidence.DataCenters.clear();
  assert.ok(memberEvidence(evidence, 'node', 'Retained', { work: 'running', stage: 'DataCenters' }).locationPending);
});

test('snapshot binds scope and accepted digest to a deterministic all-role scene and report', () => {
  const model = {
    ids: ['1', '2'], order: 'AThenB', step: 1, version: 66013n, subnet: 'subnet', scenario: 'Proposal #1 then Proposal #2',
    stateLabel: 'After proposal #1', membership: '2 members', summary: 'Compare.', notes: ['Evidence scope.'],
    governance: [{ id: 1n, lifecycle_status: 1, observed_at_nanos: 1n, payload_hash: Uint8Array.of(12), wire_extra: Uint8Array.of(13) }],
    dimensions: compositionDimensions(new Map(), new Map()), previewRevision: 'preview',
    members: [{ id: 'one', dc: 'site | <test>', role: 'Added', point: { lon: 2, lat: 3 } },
      { id: 'two', dc: 'site | <test>', role: 'Retained', point: { lon: 2, lat: 3 } },
      { id: 'three', dc: 'other', role: 'Removed', point: { lon: 4, lat: 6 } }],
    calculation: { inputHash: 'confirmed-digest', analysis_version: 3 },
  };
  const snapshot = reportSnapshot(model, []);
  const later = reportSnapshot({ ...model, step: 2 }, []);
  assert.notDeepEqual(later.scope, snapshot.scope);
  const projection = mapProjection(view, fitLocations(snapshot.geography.locations, view));
  const scene = mapScene(snapshot.geography, projection.project, view);
  assert.equal(scene.visible.reduce((sum, location) => sum + location.nodes.length, 0), 3);
  model.members[0].dc = 'changed after snapshot';
  assert.ok(Object.isFrozen(snapshot.members[0]));
  assert.ok(Object.isFrozen(snapshot.governance[0].payload_hash));
  assert.equal(snapshot.governance[0].wire_extra, undefined);
  const markdown = reviewMarkdown(snapshot);
  assert.match(markdown, /Step 1 of 2/);
  assert.match(markdown, /confirmed-digest/);
  assert.match(markdown, /\]\(map\.png\)/);
  assert.match(markdown, /site \\\| &lt;test&gt;/);
  assert.match(markdown, /Other Nodes \(1\)/);
  assert.match(markdown, /^\|  \| two \|/m);
  assert.doesNotMatch(markdown, /Reviewer vote|Reviewer summary|Reviewer attribution|https:\/\/(?!dashboard\.internetcomputer\.org\/)/);
  assert.match(reviewMarkdown(snapshot, { vote: 'Adopt', summary: 'Opinion', attribution: 'Reviewer' }), /Reviewer vote\n\nAdopt/);
});

test('archive puts the exact Markdown and PNG bytes at their relative paths', async () => {
  const files = [['review.md', new TextEncoder().encode('![map](map.png)')], ['map.png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47)]];
  const zip = new Uint8Array(await reviewZip(files).arrayBuffer());
  const header = new DataView(zip.buffer);
  let offset = 0;
  for (const [name, bytes] of files) {
    assert.equal(header.getUint32(offset, true), 0x04034b50);
    const length = header.getUint16(offset + 26, true);
    assert.equal(new TextDecoder().decode(zip.slice(offset + 30, offset + 30 + length)), name);
    const data = offset + 30 + length;
    assert.deepEqual(zip.slice(data, data + header.getUint32(offset + 18, true)), bytes);
    offset = data + bytes.length;
  }
  assert.equal(header.getUint32(offset, true), 0x02014b50);
  assert.equal(header.getUint32(zip.length - 6, true), offset);
});
