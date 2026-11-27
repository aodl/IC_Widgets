import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testCatalogue } from '../test-cases/catalogue.mjs';
import { openBundledReplay } from '../src/bundled-replay.js';
import { createReviewSession, reviewContexts } from '../src/review-session.js';
import { option } from '../src/view.js';

test('bundled replay uses the normal review session and rejects IDs outside its captured case', async t => {
  const catalogue = await testCatalogue();
  const row = catalogue.cases.find(item => item.id === 'nns-144954-recorded-open');
  t.mock.method(globalThis, 'fetch', async path => {
    assert.equal(path, '/' + row.asset);
    return new Response(catalogue.assets[row.asset]);
  });
  const client = await openBundledReplay(row);
  await assert.rejects(client.begin_membership_review([144940n]), /outside the captured test case/);
  const live = (await client.begin_membership_review([144954n])).Ok;
  const { report, subnet_rules } = live.outcome.Ok;
  const contexts = reviewContexts(report, option(subnet_rules));
  const selected = contexts.find(context => context.index && context.state);
  const session = createReviewSession({
    live, contexts, active: () => true, call: (active, run) => active() ? run(client) : undefined,
    updated() {}, progress() {},
  });
  session.select(selected);
  await session.settled();
  assert.equal(session.section().stage, 'Finished');
  assert.ok(session.section().final?.length);
  assert.equal(selected.calculation.comparison.selected.members.length, 40);
  assert.equal(selected.calculation.comparison.selected.added.length, 1);
});
