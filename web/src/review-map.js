import land from './data/land.js';
import { governanceText, metricDelta, replayLabel, replayRegistryText } from './detail-model.js';
import { el, number, styled } from './view.js';

const palette = { Removed: '#ad263f', Added: '#087748', Retained: '#315e80' };
const signs = { Added: '+', Removed: '−', Retained: '•' };
const names = { Added: 'Incoming', Removed: 'Outgoing', Retained: 'Retained' };
const distance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const order = (a, b) => (a.dc ?? '').localeCompare(b.dc ?? '') || a.id.localeCompare(b.id);
const spacing = 28;
const offsets = Array.from({ length: 9 * 9 }, (_, index) => ({ x: index % 9 - 4, y: Math.floor(index / 9) - 4 }))
  .sort((a, b) => distance(a, { x: 0, y: 0 }) - distance(b, { x: 0, y: 0 }) || a.y - b.y || a.x - b.x);

function placeNear(nodes, view) {
  const markers = [];
  for (const { node, anchor } of nodes) {
    const point = offsets.map(({ x, y }) => ({
      x: clamp(anchor.x + spacing * x, spacing / 2, view.width - spacing / 2),
      y: clamp(anchor.y + spacing * y, spacing / 2, view.height - spacing / 2),
    })).find(point => markers.every(previous =>
      Math.abs(previous.x - point.x) >= spacing || Math.abs(previous.y - point.y) >= spacing));
    if (!point) return;
    markers.push({ node, anchor, ...point });
  }
  return markers;
}

function placeOnGrid(nodes, view) {
  let step = spacing;
  while (Math.floor(view.width / step) * Math.floor(view.height / step) < nodes.length) step--;
  const available = [];
  for (let y = step / 2; y <= view.height - step / 2; y += step) {
    for (let x = step / 2; x <= view.width - step / 2; x += step) available.push({ x, y });
  }
  const markers = nodes.map(({ node, anchor }) => {
    let nearest = 0;
    for (let index = 1; index < available.length; index++) {
      if (distance(available[index], anchor) < distance(available[nearest], anchor)) nearest = index;
    }
    const [point] = available.splice(nearest, 1);
    return { node, anchor, ...point };
  });
  return { markers, diameter: step - 2 };
}

function facilityLabels(facilities, markers, view, diameter) {
  const occupied = [];
  for (const facility of facilities) {
    if (facility.before === facility.after && facility.before === facility.markers.length) continue;
    const label = facility.description;
    const width = 9 + label.length * 6.5;
    const { left, top, right, bottom } = facility.box;
    const center = (left + right) / 2 - width / 2;
    const candidates = [[center, top - 18], [center, bottom + 2], [right + 3, top], [left - width - 3, top]];
    // Mobile facilities can share a dense band. Keep the label near its group and above the connector layer.
    for (let hop = 1; hop <= 4; hop++) candidates.push([center, top - 18 - hop * 18], [center, bottom + 2 + hop * 18]);
    const bounds = candidates.map(([x, y]) => ({
      x: clamp(x, 2, Math.max(2, view.width - width - 2)), y: clamp(y, 2, view.height - 18), width,
    })).find(box => !markers.some(marker => marker.x + diameter / 2 > box.x && marker.x - diameter / 2 < box.x + width
      && marker.y + diameter / 2 > box.y && marker.y - diameter / 2 < box.y + 16)
      && !occupied.some(other => other.x < box.x + width && other.x + other.width > box.x
        && other.y < box.y + 16 && other.y + 16 > box.y));
    if (!bounds) continue;
    occupied.push(bounds);
    facility.label = { ...bounds, text: label };
  }
}

export function mapScene(members, roles, project, view) {
  const located = members.filter(node => node.point);
  const beforePartial = members.some(node => !node.dc && node.role !== 'Added');
  const afterPartial = members.some(node => !node.dc && node.role !== 'Removed');
  const changes = new Set(members.filter(node => node.role !== 'Retained').map(node => node.dc ?? node.id));
  const priority = node => changes.has(node.dc ?? node.id) ? 0 : 1;
  const nodes = located.filter(node => roles.has(node.role)).sort((a, b) => priority(a) - priority(b) || order(a, b))
    .map(node => ({ node, anchor: project(node.point.lon, node.point.lat) }))
    .filter(({ anchor }) => anchor.x >= 0 && anchor.x <= view.width && anchor.y >= 0 && anchor.y <= view.height);
  const nearby = placeNear(nodes, view);
  const { markers, diameter } = nearby ? { markers: nearby, diameter: 26 } : placeOnGrid(nodes, view);
  const facilities = [];
  const groups = new Map();
  for (const marker of markers) {
    const id = marker.node.dc;
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(marker);
  }
  for (const [id, group] of groups) {
    if (group.length < 2 && !group.some(marker => marker.node.role !== 'Retained')) continue;
    const all = members.filter(node => node.dc === id);
    const before = all.filter(node => node.role !== 'Added').length;
    const after = all.filter(node => node.role !== 'Removed').length;
    const pad = diameter / 2 + 4;
    const box = { left: Math.min(...group.map(p => p.x)) - pad, right: Math.max(...group.map(p => p.x)) + pad,
      top: Math.min(...group.map(p => p.y)) - pad, bottom: Math.max(...group.map(p => p.y)) + pad };
    const radius = diameter / 2;
    const separate = markers.some(marker => marker.node.dc !== id && marker.x + radius > box.left && marker.x - radius < box.right
      && marker.y + radius > box.top && marker.y - radius < box.bottom);
    const count = metricDelta(before || (beforePartial ? undefined : 0), after || (afterPartial ? undefined : 0),
      { beforePartial, afterPartial });
    const description = id + ' · ' + count.text + ' recorded ' + (after === 1 ? 'member' : 'members')
      + (group.length > after ? ' · ' + group.length + (group.length === 1 ? ' marker shown' : ' markers shown') : '');
    facilities.push({ id, before, after, description, markers: group, box, separate });
  }
  facilities.sort((a, b) => (Number(b.before !== b.after) - Number(a.before !== a.after)) || a.id.localeCompare(b.id));
  facilityLabels(facilities, markers, view, diameter);
  return { ...view, markers, facilities, diameter, mapped: located.length, total: members.length,
    pending: members.filter(node => node.locationPending).length,
    roles: Object.keys(names).filter(role => roles.has(role)) };
}

export function action(label, run) {
  const item = el('button', label);
  item.type = 'button';
  item.addEventListener('click', run);
  return item;
}

export function saveFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = el('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawScene(ctx, scene, project, selected, exported) {
  const { width, height, markers, facilities, diameter } = scene;
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
  ctx.fillStyle = '#cfdbcd';
  ctx.strokeStyle = '#a2b39f';
  for (const polygon of land) {
    ctx.beginPath();
    for (const ring of polygon) {
      ring.forEach(([lon, lat], index) => {
        const point = project(lon, lat);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.stroke();
  }
  for (const { anchor, x, y } of markers) {
    if (distance(anchor, { x, y }) < 1) continue;
    ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(x, y);
    ctx.strokeStyle = '#46616d9e';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#48616c';
    ctx.fill();
  }
  ctx.strokeStyle = '#3b5867';
  ctx.setLineDash([2, 3]);
  for (const facility of facilities) {
    if (facility.markers.length < 2) continue;
    const { left, top, right, bottom } = facility.box;
    ctx.beginPath();
    if (facility.separate) {
      for (const marker of facility.markers) {
        ctx.moveTo(marker.x + diameter / 2 + 2, marker.y);
        ctx.arc(marker.x, marker.y, diameter / 2 + 2, 0, Math.PI * 2);
      }
    } else ctx.roundRect(left, top, right - left, bottom - top, 8);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const facility of facilities) {
    if (!facility.label) continue;
    const { x, y, width, text } = facility.label;
    ctx.fillStyle = '#f8fbf5f5';
    ctx.fillRect(x, y, width, 16);
    ctx.fillStyle = '#173445';
    ctx.font = '600 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 3, y + 12, width - 6);
  }
  if (exported) for (const { node, x, y } of markers) {
    ctx.beginPath();
    ctx.arc(x, y, diameter / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = palette[node.role];
    ctx.fill();
    ctx.lineWidth = selected.has(node.id) ? 3 : 1.5;
    ctx.strokeStyle = selected.has(node.id) ? '#ec9a33' : '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold ' + Math.min(16, diameter - 5) + 'px system-ui';
    ctx.fillText(signs[node.role], x, y + 5);
  }
}

function sceneCaption(scene) {
  const filter = scene.roles.length === Object.keys(names).length ? 'All roles' : 'Filter: ' + (scene.roles.map(role => names[role]).join(', ') || 'no roles');
  return scene.total + ' nodes across both states · ' + scene.mapped + '/' + scene.total + ' located · '
    + scene.markers.length + ' shown · ' + filter + (scene.pending ? ' · ' + scene.pending + ' locations pending' : '');
}

export function reviewMap(inspect, active) {
  const roles = new Set(Object.keys(palette));
  let model;
  let emptyMessage;
  let selected = new Set();
  let focusLabel = 'World';
  let scene;
  let projection;
  let hiddenFocus;
  const canvas = el('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const pins = styled('div', 'map-pins');
  const buttons = new Map();
  const map = styled('div', 'map-frame', canvas, pins);
  map.setAttribute('role', 'group');
  map.setAttribute('aria-label', 'Individual nodes at registered data centers. Sources and details has a text list of every node.');
  map.tabIndex = -1;
  const caption = styled('p', 'map-coverage');
  const facilities = styled('p', 'map-facilities');
  const status = styled('p', 'status');
  status.setAttribute('role', 'status');
  const unmapped = el('details', el('summary', 'Unmapped nodes'));
  let scale = 1;
  let lon = 0;
  let lat = 0;
  let pointer;
  let unit;
  const limit = () => {
    lon = clamp(lon, -180, 180);
    lat = clamp(lat, -90, 90);
  };

  function draw() {
    const width = map.clientWidth || 320;
    const height = map.clientHeight || 330;
    const ratio = window.devicePixelRatio || 1;
    unit = Math.min((width - 32) / 360, (height - 32) / 180);
    const center = { lon, lat, scale };
    projection = (x, y) => ({ x: width / 2 + (x - center.lon) * unit * center.scale,
      y: height / 2 - (y - center.lat) * unit * center.scale });
    const focused = document.activeElement?.dataset.marker;
    scene = mapScene(model?.members ?? [], roles, projection, { width, height });
    const rasterWidth = Math.round(width * ratio);
    const rasterHeight = Math.round(height * ratio);
    if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
      canvas.width = rasterWidth;
      canvas.height = rasterHeight;
    }
    ctx.setTransform(rasterWidth / width, 0, 0, rasterHeight / height, 0, 0);
    drawScene(ctx, scene, projection, selected, false);
    const visible = new Set();
    for (const { node, anchor, x, y } of scene.markers) {
      let button = buttons.get(node.id);
      if (!button) {
        button = action('', () => inspect([node.id], button.dataset.nodeLabel));
        button.dataset.marker = node.id;
        buttons.set(node.id, button);
        pins.append(button);
      }
      button.hidden = false;
      button.dataset.nodeLabel = node.label;
      visible.add(node.id);
      button.className = 'map-pin role-' + node.role.toLowerCase();
      const label = [names[node.role], node.label, node.dc].filter(Boolean).join(' · ');
      button.title = label;
      button.setAttribute('aria-label', label + ' · ' + node.id);
      button.setAttribute('aria-pressed', String(selected.has(node.id)));
      button.textContent = signs[node.role];
      button.style.setProperty('--pin-size', scene.diameter + 'px');
      button.style.left = x + 'px';
      button.style.top = y + 'px';
      button.dataset.anchorX = String(anchor.x);
      button.dataset.anchorY = String(anchor.y);
    }
    const known = new Set(model?.members.map(node => node.id) ?? []);
    for (const [id, button] of buttons) {
      if (!known.has(id)) { button.remove(); buttons.delete(id); }
      else if (!visible.has(id)) button.hidden = true;
    }
    if (focused && !visible.has(focused)) {
      hiddenFocus = known.has(focused) ? focused : undefined;
      map.focus({ preventScroll: true });
    } else if (hiddenFocus && document.activeElement === map && visible.has(hiddenFocus)) {
      buttons.get(hiddenFocus).focus({ preventScroll: true });
      hiddenFocus = undefined;
    }
    caption.textContent = model ? sceneCaption(scene) + (scene.diameter < 24 ? ' · Dense view. Zoom or use the node list for larger targets.' : '')
      : emptyMessage ?? 'Registered locations appear here as evidence becomes available.';
    facilities.textContent = scene.facilities
      .filter(site => site.before !== site.after || site.markers.length > site.after)
      .map(site => site.description).join(' | ');
  }

  function redrawUnmapped() {
    const open = unmapped.open;
    const focused = unmapped.contains(document.activeElement) ? document.activeElement : undefined;
    const rows = (model?.members ?? []).filter(node => !node.point && !node.locationPending);
    const summary = el('summary', 'Unmapped nodes (' + rows.length + ')');
    const nodes = rows.map(node => {
      const button = action(signs[node.role] + ' ' + node.label, () => inspect([node.id], node.label));
      button.dataset.node = node.id;
      return button;
    });
    unmapped.replaceChildren(summary, el('ul', rows.map((node, index) => el('li', nodes[index], el('small', node.locationIssue)))));
    unmapped.open = open;
    unmapped.hidden = !rows.length;
    if (focused && !unmapped.hidden) (nodes.find(node => node.dataset.node === focused.dataset.node) ?? summary).focus({ preventScroll: true });
  }

  function pan(dx, dy) {
    lon += dx / scale;
    lat += dy / scale;
    limit();
    focusLabel = 'Panned view';
    draw();
  }
  function zoom(multiplier) {
    scale = clamp(scale * multiplier, 1, 12);
    if (scale === 1) lon = lat = 0;
    focusLabel = 'Zoomed view';
    draw();
    status.textContent = 'Zoom ' + scale.toFixed(1) + '×';
  }
  function focusChanges() {
    const points = (model?.members ?? []).filter(node => node.role !== 'Retained' && node.point).map(node => node.point);
    if (!points.length) { status.textContent = 'Changed nodes have no mapped locations.'; return; }
    const west = Math.min(...points.map(p => p.lon)), east = Math.max(...points.map(p => p.lon));
    const south = Math.min(...points.map(p => p.lat)), north = Math.max(...points.map(p => p.lat));
    lon = (west + east) / 2;
    lat = (south + north) / 2;
    scale = clamp(Math.min((scene.width - 72) / unit / Math.max(east - west, 1),
      (scene.height - 72) / unit / Math.max(north - south, 1)), 1, 9);
    limit();
    focusLabel = 'Focused on changes';
    draw();
  }
  map.addEventListener('pointerdown', event => {
    if (event.target.closest('button') || event.pointerType === 'touch') return;
    pointer = [event.clientX, event.clientY, lon, lat];
    map.setPointerCapture(event.pointerId);
  });
  map.addEventListener('pointermove', event => {
    if (!pointer) return;
    lon = pointer[2] - (event.clientX - pointer[0]) / unit / scale;
    lat = pointer[3] + (event.clientY - pointer[1]) / unit / scale;
    limit();
    focusLabel = 'Panned view';
    draw();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) map.addEventListener(name, () => { pointer = undefined; });

  const arrows = [['←', 'Pan west', -30, 0], ['↑', 'Pan north', 0, 30], ['↓', 'Pan south', 0, -30], ['→', 'Pan east', 30, 0]];
  const focus = action('Focus changes', focusChanges);
  const controls = styled('div', 'actions map-controls', action('World', () => {
    lon = lat = 0; scale = 1; focusLabel = 'World'; draw();
  }), focus, ...arrows.map(([symbol, title, x, y]) => {
    const control = action(symbol, () => pan(x, y));
    control.setAttribute('aria-label', title);
    return control;
  }), ...[['+', 'Zoom in', 1.6], ['−', 'Zoom out', 1 / 1.6]].map(([label, name, factor]) => {
    const control = action(label, () => zoom(factor));
    control.setAttribute('aria-label', name);
    return control;
  }));
  const exportButton = action('Export map PNG', () => {
    if (!active() || !model?.calculation || !model.finalVerified || model.work !== 'settled') return;
    const exported = model;
    const name = 'network-nexus-' + model.ids.join('-') + '-' + model.version + '.png';
    const image = el('canvas');
    const lines = [
      'Network Nexus · ' + model.scenario + ' · ' + model.stateLabel,
      'Registry ' + number(model.version) + ' · Subnet ' + model.subnet,
      model.membership,
      sceneCaption(scene) + ' · ' + focusLabel + ' · ' + scale.toFixed(1) + '×',
      model.replay ? replayLabel(model.replay) + (model.replay.roleSupplement ? ' · Synthetic NNS-role supplement' : '') : null,
      model.replay ? replayRegistryText(model.replay) : null,
      ...model.governance.map(proposal => governanceText(proposal, model.replay, true)),
      'Calculation input SHA-256 ' + model.calculation.inputHash,
      '+ Incoming   − Outgoing   • Retained   ·   Registered coordinates   ·   Natural Earth',
    ].filter(Boolean);
    const header = 23 * lines.length + 18;
    image.width = Math.max(1080, scene.width * 1.5);
    const factor = image.width / scene.width;
    image.height = header + Math.ceil(scene.height * factor);
    const out = image.getContext('2d');
    out.fillStyle = '#f7fbfb';
    out.fillRect(0, 0, image.width, header);
    out.fillStyle = '#132637';
    lines.forEach((line, index) => {
      out.font = index === 0 ? 'bold 21px system-ui' : '15px system-ui';
      out.fillText(line, 18, 25 + 23 * index, image.width - 36);
    });
    out.setTransform(factor, 0, 0, factor, 0, header);
    drawScene(out, scene, projection, selected, true);
    image.toBlob(blob => {
      if (!active() || model !== exported) return;
      if (blob) saveFile(name, blob, 'image/png');
      status.textContent = blob ? 'Map exported with this view and review scope.' : 'Map export failed.';
    });
  });
  const filters = styled('fieldset', 'map-filters', el('legend', 'Map roles'),
    Object.keys(palette).map(role => {
      const toggle = el('input');
      toggle.type = 'checkbox';
      toggle.checked = true;
      toggle.addEventListener('change', () => {
        if (toggle.checked) roles.add(role); else roles.delete(role);
        draw();
      });
      return el('label', toggle, styled('span', 'map-symbol role-' + role.toLowerCase(), signs[role]), names[role]);
    }));
  const section = styled('section', 'map-section', styled('div', 'map-heading', el('h3', 'World map')),
    map, caption, facilities, controls, filters, unmapped, status);
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!map.isConnected) observer.disconnect();
      else draw();
    });
    observer.observe(map);
  }
  return {
    section,
    exportButton,
    describe: () => sceneCaption(scene) + ' · ' + focusLabel + ' · ' + scale.toFixed(1) + '×',
    update(next, ids = [], reason) {
      model = next;
      emptyMessage = reason;
      selected = new Set(ids);
      exportButton.disabled = !model?.calculation || !model.finalVerified || model.work !== 'settled';
      focus.disabled = !model?.members?.some(node => node.role !== 'Retained' && node.point);
      redrawUnmapped();
      draw();
    },
    highlight(ids) { selected = new Set(ids); draw(); },
  };
}
