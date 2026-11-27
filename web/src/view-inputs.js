import { Principal } from '@icp-sdk/core/principal';

export const subnetInputProfile = Object.freeze({ id: 'urn:ic-widgets:subnet', major: 1 });
export const proposalInputProfile = Object.freeze({ id: 'urn:ic-widgets:proposal-ids', major: 1 });

export function subnetInput(value) {
  const subnet = Principal.fromText(value.trim());
  if (subnet.isAnonymous() || !subnet.toUint8Array().length) throw new Error('Enter a subnet principal.');
  return Object.freeze({ profile: subnetInputProfile, value: subnet.toText() });
}

export function proposalInput(first, second) {
  const values = [first, second].map(value => value.trim()).filter(Boolean);
  const ids = values.filter(value => /^[0-9]{1,20}$/.test(value)).map(BigInt);
  if (!ids.length || ids.length !== values.length || ids.some(id => id < 1n || id > 18_446_744_073_709_551_615n)
      || new Set(ids).size !== ids.length) {
    throw new Error('Choose one or two distinct positive proposal IDs.');
  }
  return Object.freeze({ profile: proposalInputProfile, value: Object.freeze(ids.map(String)) });
}
