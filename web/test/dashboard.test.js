import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardUrl } from '../src/dashboard.js';
import { siteIdentities } from '../src/map-interaction.js';

test('dashboard destinations use supported routes and full registered IDs', () => {
  const origin = 'https://dashboard.internetcomputer.org';
  const id = 'kaoz3-4okcl-24amq-v5y4k-vim56-4njvo-fwvyk-v4grq-kuqum-7zm3p-4qe';
  assert.equal(dashboardUrl('proposal', 144954n), origin + '/proposal/144954');
  assert.equal(dashboardUrl('node', id), origin + '/network/nodes/' + id);
  assert.equal(dashboardUrl('subnet', id), origin + '/network/subnets/' + id);
  assert.equal(dashboardUrl('provider', id), origin + '/network/provider/' + id);
  assert.equal(dashboardUrl('center', 'sh1'), origin + '/network/centers/sh1');
  for (const key of ['operator', 'owner', 'constructor']) assert.equal(dashboardUrl(key, id), undefined);
  for (const raw of [undefined, '../sh1', 'sh1?test', 'sh1#test', 'https://example.com']) {
    assert.equal(dashboardUrl('center', raw), undefined);
  }
});

test('co-located nodes keep each recorded provider and identify missing metadata', () => {
  const providerA = 'first-recorded-principal', providerB = 'other-recorded-principal';
  const records = [
    { owner: 'Registered owner', provider: providerA },
    { owner: 'Registered owner', provider: providerB },
    { owner: 'Registered owner', provider: providerA },
    { centerIssue: 'Loading data centers', operatorIssue: 'Could not load operator' },
  ];
  assert.deepEqual(siteIdentities(records), {
    owners: ['Registered owner', 'Loading data centers'],
    providers: [
      { id: providerA, unavailable: undefined, count: 2 },
      { id: providerB, unavailable: undefined, count: 1 },
      { id: undefined, unavailable: 'Could not load operator', count: 1 },
    ],
  });
});
