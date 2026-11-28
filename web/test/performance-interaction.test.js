import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPerformance } from '../src/performance.js';

test('the script-controlled embedded button and bounded retry keep the exact finite filter', async t => {
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.handlers = {};
      this.value = '';
    }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this[name] = value; }
    closest() { return this.parent; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    reportValidity() { return true; }
    querySelector() { return this.button; }
  }
  globalThis.Node = Element;
  const selectors = new Map();
  globalThis.document = {
    querySelector(selector) {
      if (!selectors.has(selector)) selectors.set(selector, new Element(selector));
      return selectors.get(selector);
    },
    createElement: tag => new Element(tag),
  };
  const get = selector => document.querySelector(selector);
  const form = get('#performance-form');
  form.button = new Element('button');
  form.elements = { subnet: new Element('input'), days: Object.assign(new Element('input'), { valueAsNumber: 7 }) };
  get('#performance-mode').parent = new Element('label');
  const requests = [];
  let busy = true;
  const successful = { Ok: { outcome: { Ok: { samples: [] } }, receipts: [], registry_version: [],
    usage: { calls: 1, source_bytes: 0, started_at: 0n, finished_at: 0n, instructions: 0, peak_batch_reservation: 0 } } };
  const performance = mountPerformance((active, run) => {
    assert.equal(active(), true);
    return run({ node_performance_on_demand: async (subnet, _start, filter) => {
      requests.push([subnet.toText(), filter[0]?.map(node => node.toText())]);
      return busy ? { Err: 'another on-demand request is running' } : successful;
    } });
  }, { connected: true });
  const scope = {
    subnet: 'tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe',
    nodeIds: ['2vxsx-fae'], scope: 'membership-union', registryVersion: '66013', label: 'Test filter',
  };
  const expected = [scope.subnet, scope.nodeIds];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  performance.follow(scope);
  await settle();
  assert.match(get('#performance-status').textContent, /waiting while the reviewer/);
  t.mock.timers.tick(4000);
  await settle();
  assert.equal(form.button.textContent, 'Retry blockmaking samples');
  assert.deepEqual(requests, [expected, expected]);
  busy = false;
  form.button.handlers.click();
  await settle();
  assert.deepEqual(requests, [expected, expected, expected]);
  assert.equal(form.button.textContent, 'Refresh blockmaking samples');

  busy = true;
  form.button.handlers.click();
  await settle();
  performance.follow({ ...scope, nodeIds: [] });
  t.mock.timers.tick(4000);
  await settle();
  assert.equal(form.button.disabled, true);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request[1].length === 1));
});
