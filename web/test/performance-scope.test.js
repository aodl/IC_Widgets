import assert from 'node:assert/strict';
import test from 'node:test';
import { performanceNodes } from '../src/composed-scope.js';

test('Performance uses the exact finite before/proposed union and preserves explicit scopes', () => {
  const before = ['retained-1', 'retained-2', 'retained-3', 'removed-1', 'removed-2'];
  const selected = [...before.slice(0, 3), 'added-1', 'added-2'];
  const selection = { kind: 'comparison', nodes: {
    before, selected, incoming: selected.slice(3), outgoing: before.slice(3), affected: ['different-step', ...before],
  } };
  assert.deepEqual(performanceNodes(selection, 'membership-union'), [...before, ...selected.slice(3)]);
  assert.deepEqual(performanceNodes(selection, 'proposed-membership'), selected);
  assert.deepEqual(performanceNodes(selection, 'before-membership'), before);
  assert.deepEqual(performanceNodes(selection, 'outgoing-membership'), before.slice(3));
  assert.deepEqual(performanceNodes(selection, 'affected-membership'), selection.nodes.affected);
  assert.deepEqual(performanceNodes({ kind: 'comparison', nodes: { ...selection.nodes, incoming: [] } }, 'incoming-membership'), []);
  assert.equal(performanceNodes(undefined, 'membership-union'), undefined);
  assert.deepEqual(performanceNodes({ kind: 'existing', nodes: { selected } }, 'membership-union'), selected);
});
