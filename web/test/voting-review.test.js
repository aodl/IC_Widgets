import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownTable, reviewMarkdown } from '../src/review-markdown.js';
import { clusters } from '../src/review-map.js';

test('Markdown uses shared factual rows and safely escapes source table data', () => {
  const fact = { title: 'Decentralisation and concentration', headers: ['Dimension', 'Value'],
    rows: [['Registered owner', '13 / 14 nodes → 12 / 14 nodes'], [{ label: 'Site | <b>A</b>', url: 'https://example.test/site' }, 3]] };
  const model = { ids: ['144954'], version: 66013n, subnet: 'tdb26', subnetLink: { url: 'https://example.test/subnet' },
    membership: '40 → 40 members', stateLabel: 'After proposal #144954', scenario: 'A independently',
    consequences: [], notes: ['Evidence is scoped'], dimensions: [], tables: [fact], payloads: [] };
  const result = reviewMarkdown(model, { vote: 'Adopt', tldr: 'Written by the reviewer', mapImage: 'https://example.test/map.png' });
  assert.match(result, /^# Proposal #144954 Review/);
  assert.match(result, /\*\*VOTE\*\*: Adopt/);
  assert.match(result, /\*\*TLDR\*\*: Written by the reviewer/);
  assert.match(result, /\[\!|!\[Registry data-center map\]/);
  assert.ok(result.includes(markdownTable(fact)));
  assert.ok(result.includes('Site \\| &lt;b&gt;A&lt;/b&gt;'));
  assert.ok(!reviewMarkdown(model, { mapImage: 'javascript:alert(1)' }).includes('javascript:'));
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
