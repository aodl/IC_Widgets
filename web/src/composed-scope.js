import { Principal } from '@icp-sdk/core/principal';

export const mapSceneProfile = Object.freeze({ id: 'urn:ic-widgets:map-scene', major: 1 });
export const nodeFilterProfile = Object.freeze({ id: 'urn:ic-widgets:node-filter', major: 1 });

export function hasProfile(value, profile) {
  return value?.profile?.id === profile.id && value.profile.major === profile.major;
}

function ready(profile, revision, value) {
  return { kind: 'ready', profile, revision, value };
}

export const comparisonFilterLabels = Object.freeze({
  'membership-union': 'Before and proposed members',
  'proposed-membership': 'Proposed members',
  'before-membership': 'Before members',
  'changed-membership': 'Added and removed members',
  'incoming-membership': 'Added members',
  'outgoing-membership': 'Removed members',
  'affected-membership': 'Nodes affected across steps',
});
const maxFilterSize = 256;

export function composedOutputs(selection, { members, countries }, requestedScope = 'membership-union') {
  const { kind, revision, subnet, registryVersion, label, nodes } = selection;
  const { receipts, ...observation } = selection.observation ?? {};
  const scope = kind === 'existing' ? 'existing-membership' : requestedScope;
  const filters = {
    'existing-membership': nodes.selected,
    'membership-union': members.map(member => member.id),
    'proposed-membership': nodes.selected,
    'before-membership': members.filter(member => member.role !== 'Added').map(member => member.id),
    'changed-membership': members.filter(member => member.role !== 'Retained').map(member => member.id),
    'incoming-membership': nodes.incoming,
    'outgoing-membership': nodes.outgoing,
    'affected-membership': nodes.affected,
  };
  if (!Object.hasOwn(filters, scope)) throw new Error('Unsupported Performance scope.');
  const nodeIds = filters[scope];
  const filter = nodeIds.length <= maxFilterSize ? ready(nodeFilterProfile, revision,
    { subnet, registryVersion, scope, label, nodeIds })
    : { kind: 'unavailable', retryable: false, reason: 'This finite filter exceeds 256 nodes. Select a narrower scope.' };
  return {
    // A connected consumer receives one exact filter, with the producer's scope label.
    filter,
    scene: ready(mapSceneProfile, revision, JSON.parse(JSON.stringify({
      kind, subnet, registryVersion, label, members, countries, observation, coverage: selection.coverage,
    }))),
  };
}

function canonicalPrincipal(text) {
  return typeof text === 'string' && Principal.fromText(text).toText() === text;
}

function checked(input, profile) {
  const value = input?.value;
  if (input?.kind !== 'ready' || !hasProfile(input, profile) || !value || typeof input.revision !== 'string'
    || !input.revision.length || input.revision.length > 240 || !canonicalPrincipal(value.subnet)
    || typeof value.label !== 'string' || value.label.length > 240 || typeof value.registryVersion !== 'string'
    || !/^\d{1,20}$/.test(value.registryVersion) || BigInt(value.registryVersion) > 18_446_744_073_709_551_615n) {
    throw new Error('Invalid widget evidence.');
  }
  return value;
}

export function readNodeFilter(input) {
  const value = checked(input, nodeFilterProfile);
  if ((value.scope !== 'existing-membership' && !Object.hasOwn(comparisonFilterLabels, value.scope))
    || !Array.isArray(value.nodeIds) || value.nodeIds.length > maxFilterSize
    || new Set(value.nodeIds).size !== value.nodeIds.length || !value.nodeIds.every(canonicalPrincipal)) {
    throw new Error('Invalid finite node filter.');
  }
  return value;
}

export function readMapScene(input) {
  const value = checked(input, mapSceneProfile);
  const { kind, members, countries } = value;
  const roles = kind === 'existing' ? ['Retained'] : ['Added', 'Removed', 'Retained'];
  const validPoint = point => point === undefined || (point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180);
  const validMember = member => member && canonicalPrincipal(member.id) && roles.includes(member.role)
    && typeof member.label === 'string' && validPoint(member.point)
    && ['dc', 'owner', 'region', 'nodeIssue', 'operatorIssue', 'centerIssue', 'locationIssue'].every(key =>
      member[key] === undefined || typeof member[key] === 'string')
    && ['provider', 'operatorId'].every(key => member[key] === undefined || canonicalPrincipal(member[key]));
  if (!['existing', 'comparison'].includes(kind) || !Array.isArray(members) || members.length > 256
    || !members.every(validMember) || new Set(members.map(member => member.id)).size !== members.length
    || !Array.isArray(countries?.groups) || typeof countries.note !== 'string' || !countries.shades
    || Object.values(countries.shades).some(shade => !['neutral', 'increase', 'decrease', 'exit'].includes(shade))
    || !countries.groups.every(group => typeof group?.token === 'string' && typeof group.delta?.text === 'string')) {
    throw new Error('Invalid finite map scene.');
  }
  return value;
}
