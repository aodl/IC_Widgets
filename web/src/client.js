import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { idlFactory } from './reviewer.did.js';
import { hex } from './view.js';

// The browser keeps this pilot identity in memory and displays only its principal.
export const identity = Ed25519KeyIdentity.generate();

export async function connect() {
  const agent = await HttpAgent.create({
    host: LOCAL_REPLICA ? window.location.origin : 'https://icp-api.io',
    shouldFetchRootKey: LOCAL_REPLICA,
    identity,
  });
  return Actor.createActor(idlFactory, { agent, canisterId: REVIEWER_ID });
}

export function result(reply) {
  if ('Err' in reply) throw new Error(reply.Err);
  return reply.Ok;
}

export async function compareMembership(client, input) {
  const method = Actor.interfaceOf(client).fieldsAsObject().compare_membership_details;
  const bytes = IDL.encode(method.argTypes, [input]);
  const inputHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const calculated = result(await client.compare_membership_details(input));
  if (hex(calculated.input_hash) !== inputHash) {
    throw new Error('The replicated calculation returned a different input digest.');
  }
  return { ...calculated, bytes, inputHash };
}

export function liveError(error) {
  if ('ProposalChanged' in error) {
    return `Proposal #${error.ProposalChanged.id} changed while the Registry was being read. Run the review again.`;
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
