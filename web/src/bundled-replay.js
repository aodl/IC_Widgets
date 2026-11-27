import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from './reviewer.did.js';
import { hex } from './view.js';

const service = idlFactory({ IDL }).fieldsAsObject();
const methodNames = ['begin_membership_review', 'membership_context_detail_page', 'membership_registry_role',
  'compare_membership_context', 'finalize_membership_review'];

function decode(name, body) {
  return IDL.decode(service[name].retTypes, Uint8Array.from(atob(body), char => char.charCodeAt(0)))[0];
}

function variantPage(bundle, args, token) {
  const [requested, keys] = args;
  if (!token || hex(requested) !== hex(token)) throw new Error('Test case context is unavailable.');
  const kind = Object.keys(keys)[0];
  const refs = keys[kind].map(id => bundle.pages[kind]?.[id.toText?.() ?? id]);
  if (!refs.length || refs.some(ref => !ref)) throw new Error('This page is outside the captured test evidence.');
  const pages = new Map();
  const rows = refs.map(ref => {
    if (!pages.has(ref.inputHash)) {
      pages.set(ref.inputHash, decode('membership_context_detail_page',
        bundle.replies.membership_context_detail_page[ref.inputHash]).Ok);
    }
    return pages.get(ref.inputHash).outcome.Ok[kind][ref.index];
  });
  const original = pages.values().next().value;
  const receipts = [...pages.values()].flatMap(page => page.receipts);
  return { Ok: { ...original, outcome: { Ok: { [kind]: rows } }, receipts,
    usage: { ...original.usage, calls: receipts.length, source_bytes: receipts.reduce((sum, row) => sum + row.reply_bytes, 0n) } } };
}

export async function openBundledReplay(test) {
  const response = await fetch('/' + test.asset, { redirect: 'error', credentials: 'omit' });
  if (!response.ok) throw new Error('Certified test evidence is unavailable.');
  const bundle = await response.json();
  let token;
  const client = Object.fromEntries(methodNames.map(name => [name, async (...args) => {
    const bytes = IDL.encode(service[name].argTypes, args);
    const key = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    const body = bundle.replies?.[name]?.[key];
    if (!body && name !== 'membership_context_detail_page') throw new Error('This request is outside the captured test case.');
    if (name === 'membership_context_detail_page' && test.fault === 'slow-locations' && args[1].DataCenters) {
      await new Promise(resolve => setTimeout(resolve, 900));
    }
    const reply = body ? decode(name, body) : variantPage(bundle, args, token);
    if (name === 'begin_membership_review') token = reply.Ok?.outcome.Ok?.review_context?.[0];
    return reply;
  }]));
  return Object.freeze(client);
}
