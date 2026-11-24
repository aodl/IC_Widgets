import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proposalIds } from '../src/view.js';

test('keeps Candid nat64 IDs exact when the agent returns a typed array', () => {
  const ids = new BigUint64Array([144942n, 18_446_744_073_709_551_615n]);
  assert.equal(proposalIds(ids), '#144942 + #18446744073709551615');
  assert.equal(proposalIds([144942n]), '#144942');
});
