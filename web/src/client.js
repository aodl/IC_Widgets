import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { idlFactory } from './reviewer.did.js';
import { hex } from './view.js';

// The browser keeps this pilot identity in memory and displays only its principal.
export const identity = Ed25519KeyIdentity.generate();

export const replays = typeof FIXTURE_REPLAY === 'undefined' ? null : FIXTURE_REPLAY;
if (typeof FIXTURE_REPLAY !== 'undefined' && FIXTURE_REPLAY
    && !['127.0.0.1', '[::1]', 'localhost'].includes(location.hostname) && !location.hostname.endsWith('.localhost')) {
  throw new Error('Development replay requires a loopback origin.');
}
export const activeReplay = replays && (replays.cases.find(row => row.id === new URLSearchParams(location.search).get('case'))
  ?? replays.cases.find(row => row.id === replays.initial));

export async function connect() {
  const agent = await HttpAgent.create({
    host: LOCAL_REPLICA ? window.location.origin : 'https://icp-api.io',
    shouldFetchRootKey: LOCAL_REPLICA,
    identity,
  });
  return Actor.createActor(idlFactory, { agent, canisterId: activeReplay?.reviewer ?? REVIEWER_ID });
}

export function result(reply) {
  if ('Err' in reply) throw new Error(reply.Err);
  return reply.Ok;
}

export async function compareMembership(client, input, active = () => true, policy = []) {
  const name = policy.length ? 'compare_membership_with_policy' : 'compare_membership_details';
  const args = [input, ...policy];
  const method = Actor.interfaceOf(client).fieldsAsObject()[name];
  const bytes = IDL.encode(method.argTypes, args);
  const inputHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  if (!active()) return undefined;
  const calculated = result(await client[name](...args));
  if (hex(calculated.input_hash) !== inputHash) {
    throw new Error('The replicated calculation returned a different input digest.');
  }
  return { ...calculated, bytes, inputHash };
}

export function liveError(error) {
  if ('ProposalChanged' in error) {
    return `Proposal #${error.ProposalChanged.id} changed during the review. Start a new review for its observed state.`;
  }
  if ('Source' in error) {
    return `Source observation ${error.Source.observation} is unavailable. ${error.Source.reason}`;
  }
  if ('InvalidEvidence' in error) {
    const evidence = error.InvalidEvidence;
    if ('MissingProposal' in evidence) return `Proposal #${evidence.MissingProposal} is unavailable.`;
    if ('UnsupportedAction' in evidence) return `Proposal #${evidence.UnsupportedAction.id} has an unsupported action.`;
    if ('MalformedPayload' in evidence) return `Proposal #${evidence.MalformedPayload.id} has an invalid action payload.`;
    if ('InvalidTopology' in evidence) return 'The Registry topology contains conflicting required assignments.';
    if ('UnavailableRecord' in evidence) {
      const [kind, key] = Object.entries(evidence.UnavailableRecord)[0];
      return `Required Registry evidence is unavailable for ${kind}${key === null ? '' : ` ${key.toText?.() ?? key}`}.`;
    }
    return 'The proposal or its Registry evidence could not be validated.';
  }
  const message = {
    Deadline: 'The source reads exceeded the time limit. Try again.',
    CycleBalance: 'The canister has insufficient liquid cycles for the next batch.',
    CallLimit: 'The review exceeded its source-call or node limit.',
    SourceBytes: 'The source replies exceeded the input size limit.',
    ResultLimit: 'The result exceeded its response size limit.',
  };
  return message[Object.keys(error)[0]] ?? 'Source evidence is unavailable.';
}
