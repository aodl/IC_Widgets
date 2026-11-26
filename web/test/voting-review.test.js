import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewMarkdown } from '../src/review-markdown.js';
import { compositionRows, metricDelta } from '../src/detail-model.js';
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
    finalVerified: true, members: [], notes: ['Evidence is scoped'], composition,
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
  assert.equal(metricDelta(100 / 40, 100 / 50, { percentage: true }).text, '2.5% → 2%');
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
  assert.equal(filtered.facilities[0].before, 2);
  assert.equal(filtered.facilities[0].after, 2);
});

test('a narrow dense map still places every node without overlapping buttons', () => {
  const nodes = Array.from({ length: 41 }, (_, id) => ({
    id: String(id), dc: 'one', point: { lon: 18, lat: 70 }, role: 'Retained',
  }));
  const { markers, diameter } = mapScene(nodes, allRoles, project, view);
  assert.equal(markers.length, 41);
  assert.ok(diameter >= 24);
  for (const [i, node] of markers.entries()) {
    assert.ok(markers.slice(i + 1).every(other =>
      Math.abs(node.x - other.x) >= diameter || Math.abs(node.y - other.y) >= diameter));
  }
});
