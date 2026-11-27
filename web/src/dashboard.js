import { el } from './view.js';

const origin = 'https://dashboard.internetcomputer.org';
const routes = new Map([
  ['proposal', ['/proposal/', /^[0-9]+$/]],
  ['subnet', ['/network/subnets/', /^[a-z0-9]+(?:-[a-z0-9]+)+$/]],
  ['node', ['/network/nodes/', /^[a-z0-9]+(?:-[a-z0-9]+)+$/]],
  ['center', ['/network/centers/', /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i]],
  ['provider', ['/network/provider/', /^[a-z0-9]+(?:-[a-z0-9]+)+$/]],
]);

export function dashboardUrl(entity, id) {
  const route = routes.get(entity);
  if (!route || id == null || !route[1].test(String(id))) return undefined;
  return origin + route[0] + encodeURIComponent(String(id));
}

export function dashboardLink(entity, id, label = id) {
  const href = dashboardUrl(entity, id);
  if (!href) return label;
  return Object.assign(el('a', label), {
    href, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer', title: String(id),
  });
}

export function proposalHeading(ids) {
  return [ids.length === 1 ? 'Proposal ' : 'Proposals ', ...ids.flatMap((id, index) =>
    [index ? ' + ' : '', dashboardLink('proposal', id, '#' + id)])];
}
