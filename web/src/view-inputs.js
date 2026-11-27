import { Principal } from '@icp-sdk/core/principal';

/** @typedef {{profile: 'urn:ic-widgets:subnet', value: string}} SubnetInput */
/** @typedef {{profile: 'urn:ic-widgets:proposal-ids', value: string[]}} ProposalInput */

export function subnetInput(value) {
  const subnet = Principal.fromText(value.trim());
  if (subnet.isAnonymous() || !subnet.toUint8Array().length) throw new Error('Enter a subnet principal.');
  return Object.freeze({ profile: 'urn:ic-widgets:subnet', value: subnet.toText() });
}

export function proposalInput(first, second) {
  const values = [first, second].map(value => value.trim()).filter(Boolean);
  const ids = values.filter(value => /^[0-9]{1,20}$/.test(value)).map(BigInt);
  if (!ids.length || ids.length !== values.length || ids.some(id => id < 1n || id > 18_446_744_073_709_551_615n)
      || new Set(ids).size !== ids.length) {
    throw new Error('Choose one or two distinct positive proposal IDs.');
  }
  return Object.freeze({ profile: 'urn:ic-widgets:proposal-ids', value: Object.freeze(ids.map(String)) });
}
