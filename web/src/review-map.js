import { drawCountries } from './map-units.js';
import { membershipSites, roleCounts, roles } from './detail-model.js';

export const markerDiameter = 12;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const keyOf = ({ lon, lat }) => lon + ',' + lat;

export function mapLocations(members, countries) {
  const sites = membershipSites(members);
  const conflicts = new Set([...sites].filter(([, site]) =>
    new Set(site.nodes.filter(node => node.point).map(node => keyOf(node.point))).size > 1).map(([id]) => id));
  const locations = new Map();
  const unmapped = [];
  let pending = 0;
  for (const node of members) {
    if (!node.point || conflicts.has(node.dc)) {
      if (node.locationPending) pending++;
      else unmapped.push(conflicts.has(node.dc) ? { ...node, locationIssue: 'Conflicting coordinates for the same pinned data center' } : node);
      continue;
    }
    const key = keyOf(node.point);
    if (!locations.has(key)) locations.set(key, { key, point: node.point, nodes: [] });
    locations.get(key).nodes.push(node);
  }
  const changed = [...sites.values()].filter(site => site.changed).sort((a, b) => a.id.localeCompare(b.id));
  return {
    locations: [...locations.values()].map(location => ({
      ...location, roles: Object.keys(roleCounts(location.nodes)).filter(role => location.nodes.some(node => node.role === role)),
      sites: [...new Set(location.nodes.map(node => node.dc))].sort().map(id =>
        ({ ...sites.get(id), nodes: location.nodes.filter(node => node.dc === id), id })),
    })),
    unmapped, pending, changed, countries, total: members.length, mapped: members.length - unmapped.length - pending,
  };
}

export function mapProjection(view, { lon = 0, lat = 0, scale = 1 } = {}) {
  const unit = Math.min((view.width - 28) / 360, (view.height - 28) / 180) * scale;
  return {
    unit,
    project: (x, y) => ({ x: view.width / 2 + (x - lon) * unit, y: view.height / 2 - (y - lat) * unit }),
    unproject: ({ x, y }) => ({ lon: lon + (x - view.width / 2) / unit, lat: lat - (y - view.height / 2) / unit }),
  };
}

export function fitLocations(locations, view) {
  if (!locations.length) return { lon: 0, lat: 0, scale: 1 };
  const points = locations.map(location => location.point);
  const west = Math.min(...points.map(p => p.lon)), east = Math.max(...points.map(p => p.lon));
  const south = Math.min(...points.map(p => p.lat)), north = Math.max(...points.map(p => p.lat));
  const unit = mapProjection(view).unit;
  return { lon: (west + east) / 2, lat: (south + north) / 2,
    scale: clamp(Math.min((view.width - 64) / unit / Math.max(1, east - west),
      (view.height - 64) / unit / Math.max(1, north - south)), 0.7, 12) };
}

export const siteLabel = site => site.id + ' · ' + site.count.text + ' nodes';

export function mapScene(geography, project, view) {
  const locations = geography.locations.map(location => ({ ...location, ...project(location.point.lon, location.point.lat) }));
  const visible = locations.filter(({ x, y }) => x >= 0 && x <= view.width && y >= 0 && y <= view.height);
  const labels = [];
  const placed = new Set();
  function place(location, text, site) {
    const width = Math.ceil(text.length * 6.5 + 8);
    if (width > view.width - 4) return false;
    const { x, y } = location;
    const candidates = [];
    for (const gap of site ? [13, 30, 48] : [12]) candidates.push([x - width / 2, y - gap - 16], [x - width / 2, y + gap],
      [x + gap, y - 8], [x - width - gap, y - 8]);
    for (const [left, top] of candidates) {
      const box = { left: clamp(left, 2, Math.max(2, view.width - width - 2)), top: clamp(top, 2, view.height - 18), width };
      if (visible.some(p => p.x + 10 > box.left && p.x - 10 < box.left + width && p.y + 10 > box.top && p.y - 10 < box.top + 16)
          || labels.some(p => p.left < box.left + width && p.left + p.width > box.left && p.top < box.top + 16 && p.top + 16 > box.top)) continue;
      labels.push({ ...box, text, x, y, site });
      return true;
    }
    return false;
  }
  for (const site of geography.changed) {
    const location = visible.find(location => location.sites.some(item => item.id === site.id));
    if (location && place(location, siteLabel(site), site)) placed.add(site.id);
  }
  for (const location of visible) {
    if (location.nodes.length > 1 && !location.sites.some(site => site.id && placed.has(site.id))) {
      place(location, String(location.nodes.length));
    }
  }
  return { ...view, locations, visible, labels, countries: geography.countries, overflow: geography.changed.filter(site => !placed.has(site.id)) };
}

export function mapCoverage(geography) {
  return geography.total + ' unique nodes across both states · ' + geography.mapped + '/' + geography.total + ' located'
    + (geography.pending ? ' · ' + geography.pending + ' locations loading' : '');
}

export function drawMap(ctx, scene, project) {
  const { width, height } = scene;
  ctx.fillStyle = '#e7eff2';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#cedde1';
  ctx.lineWidth = 1;
  for (let x = -180; x <= 180; x += 30) {
    ctx.beginPath(); ctx.moveTo(project(x, 0).x, 0); ctx.lineTo(project(x, 0).x, height); ctx.stroke();
  }
  for (let y = -90; y <= 90; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, project(0, y).y); ctx.lineTo(width, project(0, y).y); ctx.stroke();
  }
  drawCountries(ctx, scene, project);
  for (const { left, top, width, text, x, y } of scene.labels) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(clamp(x, left, left + width), clamp(y, top, top + 16));
    ctx.strokeStyle = '#627682';
    ctx.stroke();
    ctx.fillStyle = '#f8fbf5';
    ctx.fillRect(left, top, width, 16);
    ctx.fillStyle = '#173445';
    ctx.font = '600 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(text, left + 4, top + 12, width - 8);
  }
  // Nearby locations may overlap at overview scale. Keep changed sites legible without shifting their anchors.
  const changes = location => location.roles.some(role => role !== 'Retained');
  for (const location of scene.locations.toSorted((a, b) => Number(changes(a)) - Number(changes(b)))) drawMarker(ctx, location);
}

function drawMarker(ctx, { x, y, nodes, roles: present }) {
  const radius = markerDiameter / 2 - 0.5;
  present.forEach((role, i) => {
    const part = Math.PI * 2 / present.length;
    const start = -Math.PI / 2 + i * part;
    ctx.beginPath();
    if (present.length > 1) ctx.moveTo(x, y);
    ctx.arc(x, y, radius, start, start + part);
    ctx.closePath();
    ctx.fillStyle = roles[role].color;
    ctx.fill();
  });
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  if (nodes.length < 2) return;
  ctx.beginPath();
  ctx.arc(x, y, 8.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#334954';
  ctx.setLineDash([1, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
}
