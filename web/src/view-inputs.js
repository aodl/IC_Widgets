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

export const inspectionSubjectProfile = Object.freeze({ id: 'urn:ic-widgets:inspection-subject', major: 1 });

export function readInspectionSubject(input) {
  const value = input?.value;
  const invalid = () => new Error('Supply a current subnet principal or one or two exact proposal IDs.');
  if (input?.kind !== 'ready' || input.profile?.id !== inspectionSubjectProfile.id
      || input.profile.major !== inspectionSubjectProfile.major || !value || Array.isArray(value)) throw invalid();
  const subnet = Object.hasOwn(value, 'subnet') ? subnetInput(value.subnet).value : undefined;
  if (subnet !== value.subnet) throw invalid();
  if (value.kind === 'subnet' && subnet && Object.keys(value).every(key => ['kind', 'subnet'].includes(key))) {
    return { kind: 'subnet', subnet };
  }
  if (value.kind !== 'proposals' || !Array.isArray(value.proposalIds) || ![1, 2].includes(value.proposalIds.length)
      || !value.proposalIds.every(id => typeof id === 'string')
      || !Object.keys(value).every(key => ['kind', 'proposalIds', 'subnet'].includes(key))) throw invalid();
  const proposalIds = proposalInput(value.proposalIds[0], value.proposalIds[1] ?? '').value;
  if (proposalIds.length !== value.proposalIds.length || !proposalIds.every((id, index) => id === value.proposalIds[index])) throw invalid();
  return { kind: 'proposals', proposalIds, ...(subnet && { subnet }) };
}
