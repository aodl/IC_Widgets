import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewMarkdown } from '../src/review-markdown.js';
import { metricDelta } from '../src/detail-model.js';
import { clusters } from '../src/review-map.js';

test('Markdown uses the accepted topology rows and escapes registered labels', () => {
  const model = {
    ids: ['144954'], version: 66013n, subnet: 'tdb26', membership: '40 members · +1 added · −1 removed',
    stateLabel: 'After proposal #144954', scenario: 'Proposal #144954', previewRevision: '00', governance: [],
    policyText: 'Compared with adopted motion #143190', finalVerified: true, gaps: true, members: [], notes: ['Evidence is scoped'],
    topology: [{ label: 'Site | <b>A</b>', ready: true, delta: metricDelta(2, 3), limit: '1 cap · exception', assessment: 'Exception unresolved' }],
  };
  const result = reviewMarkdown(model, { vote: 'Adopt', tldr: 'Written by the reviewer', mapImage: 'https://example.test/map.png' });
  assert.match(result, /^# Proposal #144954 Review/);
  assert.match(result, /\*\*VOTE\*\*: Adopt/);
  assert.match(result, /\*\*TLDR\*\*: Written by the reviewer/);
  assert.match(result, /Finished with gaps/);
  assert.ok(result.includes('1 cap · exception'));
  assert.ok(result.includes('3 (+1)'));
  assert.ok(result.includes('Site \\| &lt;b&gt;A&lt;/b&gt;'));
  assert.match(reviewMarkdown({ ...model, finalVerified: false }), /Provisional · Final Governance verification unavailable/);
  assert.ok(!reviewMarkdown(model, { mapImage: 'javascript:alert(1)' }).includes('javascript:'));
});

test('delta formatting preserves signs and percentage-point units without repeated values or negative zero', () => {
  assert.equal(metricDelta(28, 28).text, '28');
  assert.equal(metricDelta(13, 12).text, '12 (−1)');
  assert.equal(metricDelta(5, 7.5, { percentage: true }).text, '7.5% (+2.5 percentage points)');
  assert.equal(metricDelta(5.001, 5, { percentage: true }).text, '5%');
  assert.equal(metricDelta(2, undefined).text, 'Not recorded on-chain');
});

test('overlapping sites preserve their distinct roles and omit unknown and filtered nodes', () => {
  const rows = [
    { id: 'retained', point: { lat: 20, lon: 20 }, role: 'Retained' },
    { id: 'added', point: { lat: 21, lon: 20 }, role: 'Added' },
    { id: 'removed', point: { lat: 120, lon: 120 }, role: 'Removed' },
    { id: 'unknown', role: 'Added' },
  ];
  const project = (x, y) => ({ x, y });
  assert.deepEqual(clusters(rows, new Set(['Retained', 'Added']), project).map(row => row.nodes.map(node => node.id)), [['retained', 'added']]);
  assert.deepEqual(clusters(rows, new Set(['Added', 'Removed']), project).map(row => row.nodes.map(node => node.id)), [['added'], ['removed']]);
});
