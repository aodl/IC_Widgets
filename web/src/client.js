import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { idlFactory } from './reviewer.did.js';

export async function connect() {
  const agent = await HttpAgent.create({
    host: LOCAL_REPLICA ? window.location.origin : 'https://icp-api.io',
    shouldFetchRootKey: LOCAL_REPLICA,
  });
  return Actor.createActor(idlFactory, { agent, canisterId: REVIEWER_ID });
}

export function result(reply) {
  if ('Err' in reply) throw new Error(reply.Err);
  return reply.Ok;
}
