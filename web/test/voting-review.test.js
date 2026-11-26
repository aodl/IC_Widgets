import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewMarkdown } from '../src/review-markdown.js';
import { compositionDimensions, compositionRows, metricDelta, reviewReadiness } from '../src/detail-model.js';
import { mapScene } from '../src/review-map.js';

const group = (label, count) => [{ RegisteredLabel: label }, count];
const distribution = (groups, unknown = 0) => new Map([['DataCenter', { groups, unknown }]]);
const project = (x, y) => ({ x, y });
const view = { width: 310, height: 340 };
const allRoles = new Set(['Retained', 'Added', 'Removed']);

test('composition compares the exact same registered groups and carries changes below the largest group to Markdown', () => {
  const before = distribution([group('Largest', 12), group('Site | <b>A</b>', 3), group('leaving', 1)]);
  const after = distribution([group('Largest', 12), group('Site | <b>A</b>', 2), group('new', 2)]);
  const composition = compositionRows(before, after);
  assert.deepEqual(new Map(composition.map(row => [row.group, row.delta.text])), new Map([
    ['new', '0 → 2'], ['Site | <b>A</b>', '3 → 2'], ['leaving', '1 → 0'], ['Largest', '12'],
  ]));
  assert.equal(composition.find(row => row.group === 'leaving').note, 'Last member leaves this subnet');
  const model = {
    ids: ['144954'], version: 66013n, subnet: 'tdb26', membership: '40 members · 39 retained · 1 incoming · 1 outgoing',
    stateLabel: 'After proposal #144954', scenario: 'Proposal #144954', previewRevision: '00', governance: [],
    finalVerified: true, work: 'settled', members: [], notes: ['Evidence is scoped'], composition,
  };
  const result = reviewMarkdown(model, { vote: 'Adopt', tldr: 'Written by the reviewer', mapImage: 'https://example.test/map.png' });
  assert.match(result, /Data loading complete/);
  assert.match(result, /No Target Topology limits have been assumed/);
  assert.match(result, /Site \\\| &lt;b&gt;A&lt;\/b&gt; \| 3 → 2/);
  assert.match(result, /leaving \| 1 → 0/);
  assert.match(result, /Largest \| 12/);
  assert.doesNotMatch(result, /Assessment|Exception unresolved|Matches target/);
  assert.match(reviewMarkdown({ ...model, finalVerified: false }), /Provisional · Final Governance verification unavailable/);
  assert.ok(!reviewMarkdown(model, { mapImage: 'javascript:alert(1)' }).includes('javascript:'));
});

test('all tied concentrations and directly affected groups stay visible and the optional appendix includes every row', () => {
  const groups = [group('maximum A', 7), group('maximum B', 7), group('balanced swap', 1), group('unaffected', 1)];
  const before = distribution(groups);
  const after = distribution(groups);
  before.get('DataCenter').greater_than_one_third = [{ groups_to_reach: [3] }];
  after.get('DataCenter').greater_than_one_third = [{ groups_to_reach: [2] }];
  const dimensions = compositionDimensions(before, after);
  const composition = compositionRows(before, after, undefined, [{ dc: 'balanced swap' }]);
  assert.deepEqual(composition.filter(row => row.featured).map(row => row.group), ['maximum A', 'maximum B', 'balanced swap']);
  assert.equal(dimensions[0].tied, 2);
  assert.equal(dimensions[0].distinct.text, '4');
  assert.equal(dimensions[0].coefficient.text, '3 → 2');
  const model = { composition, dimensions, ids: ['1'], version: 1n, notes: [], governance: [], members: [], finalVerified: true };
  const concise = reviewMarkdown(model);
  assert.match(concise, /Changed Nakamoto coefficients/);
  assert.match(concise, /Data center · maximum B \| 7/);
  assert.doesNotMatch(concise, /unaffected|Full recorded distribution/);
  const full = reviewMarkdown(model, { fullDistribution: true });
  assert.ok(full.startsWith(concise));
  assert.match(full, /\| unaffected \| 1/);
});

test('arrow notation retains zeros, states unavailable sides and preserves percentage denominators', () => {
  assert.equal(metricDelta(28, 28).text, '28');
  assert.equal(metricDelta(13, 12).text, '13 → 12');
  assert.equal(metricDelta(5, 7.5, { percentage: true }).text, '5% → 7.5%');
  assert.equal(metricDelta(5.001, 5, { percentage: true }).text, '5.001% → 5%');
  assert.equal(metricDelta(2, undefined).text, '2 before · Proposed unavailable');
  assert.equal(metricDelta(undefined, 3).text, '3 · Before unavailable');
  assert.equal(metricDelta(2, 3).accessible, '2 before, 3 proposed');
  const row = compositionRows(distribution([], 1), distribution([group('site', 2)]))[0];
  assert.equal(row.delta.text, '2 · Before unavailable');
  const partial = metricDelta(2, 3, { beforePartial: true, afterPartial: true });
  assert.equal(partial.text, '≥2 → ≥3');
  assert.equal(partial.direction, 0);
  assert.equal(metricDelta(100 / 40, 100 / 50, { percentage: true }).text, '2.5% → 2%');
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

test('overlapping facilities preserve true anchors, individual marker IDs, and separate enclosures', () => {
  const rows = [
    { id: 'a', dc: 'site', point: { lat: 20, lon: 20 }, role: 'Retained' },
    { id: 'b', dc: 'site', point: { lat: 20, lon: 20 }, role: 'Added' },
    { id: 'c', dc: 'site', point: { lat: 20, lon: 20 }, role: 'Removed' },
    { id: 'd', dc: 'other site', point: { lat: 20, lon: 20 }, role: 'Retained' },
    { id: 'e', dc: 'other site', point: { lat: 20, lon: 20 }, role: 'Retained' },
    { id: 'unknown', role: 'Added' },
  ];
  const scene = mapScene(rows, allRoles, project, view);
  assert.equal(scene.markers.length, 5);
  assert.ok(scene.markers.every(row => row.anchor.x === 20 && row.anchor.y === 20));
  assert.equal(new Set(scene.markers.map(row => row.x + '/' + row.y)).size, 5);
  assert.deepEqual(scene.markers.map(row => [row.node.id, row.x, row.y]),
    mapScene(rows.toReversed(), allRoles, project, view).markers.map(row => [row.node.id, row.x, row.y]));
  const site = scene.facilities.find(row => row.id === 'site');
  assert.deepEqual([site.before, site.after, site.markers.length], [2, 2, 3]);
  assert.deepEqual(scene.facilities.find(row => row.id === 'other site').markers.map(row => row.node.id), ['d', 'e']);
  const filtered = mapScene(rows, new Set(['Added', 'Removed']), project, view);
  assert.deepEqual(filtered.markers.map(row => row.node.id), ['b', 'c']);
  for (const marker of filtered.markers) {
    const original = scene.markers.find(item => item.node === marker.node);
    assert.deepEqual([marker.x, marker.y], [original.x, original.y]);
  }
  assert.equal(filtered.facilities[0].before, 2);
  assert.equal(filtered.facilities[0].after, 2);
});

test('a narrow map keeps even 41 coincident nodes local and gives every marker a reachable center', () => {
  const nodes = Array.from({ length: 41 }, (_, id) => ({
    id: String(id), dc: 'one', point: { lon: 18, lat: 70 }, role: 'Retained',
  }));
  const { markers } = mapScene(nodes, allRoles, project, view);
  assert.equal(markers.length, 41);
  for (const [i, node] of markers.entries()) {
    assert.equal(node.diameter, 8);
    assert.ok(Math.hypot(node.x - node.anchor.x, node.y - node.anchor.y) <= 48.01);
    assert.ok(markers.slice(i + 1).every(other => Math.hypot(node.x - other.x, node.y - other.y) >= node.diameter));
    assert.ok(markers.slice(i + 1).every(other => Math.max(Math.abs(node.x - other.x), Math.abs(node.y - other.y))
      > (node.target + other.target) / 2));
  }
});
