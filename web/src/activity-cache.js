import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from './reviewer.did.js';

// The independently hosted Activity queue is the only consumer. Cached replies are
// display observations, never inputs to the inspector's authoritative calculation.
const freshFor = 120_000;
const retainFor = 30 * 60_000;
const maxBytes = 400_000;
const schema = idlFactory({ IDL }).fieldsAsObject().subnet_activity.retTypes;
const key = 'ic-widgets.activity.v1.' + REVIEWER_ID;

function checked(value, now = Date.now()) {
  if (!value?.Ok?.outcome?.Ok) return;
  const finished = Number(value.Ok.usage.finished_at / 1_000_000n);
  if ( !Number.isSafeInteger(finished) || finished > now + 30_000 || now - finished >= retainFor) return;
  return { reply: value, finished, fresh: now - finished < freshFor };
}

export function cachedActivity() {
  try {
    const encoded = localStorage.getItem(key);
    if (!encoded || encoded.length > maxBytes * 2) return;
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    return checked(IDL.decode(schema, bytes)[0]);
  } catch {
    // Storage may be denied in a cross-origin iframe.
  }
}

export function rememberActivity(reply) {
  try {
    if (!checked(reply)) return;
    const bytes = new Uint8Array(IDL.encode(schema, [reply]));
    if (bytes.length > maxBytes) return;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    localStorage.setItem(key, btoa(binary));
  } catch {
    // A live reply remains usable without a browser cache.
  }
}

export async function readActivity(active, run, refresh) {
  const before = cachedActivity();
  const load = async () => {
    if (!active()) return;
    const cached = cachedActivity();
    if (cached?.fresh && (!refresh || cached.finished > (before?.finished ?? 0))) return cached.reply;
    const reply = await run();
    if (reply) rememberActivity(reply);
    return reply;
  };
  return navigator.locks ? navigator.locks.request(key, load) : load();
}
