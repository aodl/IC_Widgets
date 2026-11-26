import land from './data/land.js';
import { governanceText, metricDelta, replayLabel, replayRegistryText } from './detail-model.js';
import { el, number, styled } from './view.js';

const palette = { Removed: '#ad263f', Added: '#087748', Retained: '#315e80' };
const signs = { Added: '+', Removed: '−', Retained: '•' };
const names = { Added: 'Incoming', Removed: 'Outgoing', Retained: 'Retained' };
const distance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const order = (a, b) => (a.dc ?? '').localeCompare(b.dc ?? '') || a.id.localeCompare(b.id);
const glyphSize = role => role === 'Retained' ? 8 : 20;
const maxDisplacement = 48;
const targetSize = 26;
const offsets = [{ x: 0, y: 0 }];
for (let radius = 4; radius <= maxDisplacement; radius += 4) {
  const points = Math.ceil(2 * Math.PI * radius / 5);
  for (let index = 0; index < points; index++) {
    const angle = 2 * Math.PI * index / points + radius / 4 * 2.4;
    offsets.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
}

function placeMarkers(nodes, view) {
  const markers = [];
  for (const { node, anchor } of nodes) {
    const diameter = glyphSize(node.role);
    const inset = diameter / 2 + 1;
    let best;
    let bestClearance = -Infinity;
    for (const offset of offsets) {
      const x = clamp(anchor.x + offset.x, inset, view.width - inset);
      const y = clamp(anchor.y + offset.y, inset, view.height - inset);
      if (distance(anchor, { x, y }) > maxDisplacement ** 2 + 0.01) continue;
      const clearance = markers.reduce((min, previous) => Math.min(min,
        Math.hypot(previous.x - x, previous.y - y) - (previous.diameter + diameter) / 2), Infinity);
      if (clearance > bestClearance) {
        best = { x, y };
        bestClearance = clearance;
      }
      if (clearance >= 2) break;
    }
    markers.push({ node, anchor, diameter, ...best });
  }
  return markers;
}

function facilityLabels(facilities, markers, view) {
  const occupied = [];
  for (const facility of facilities) {
    const label = facility.id + ' · ' + facility.count;
    const width = 9 + label.length * 6.4;
    const { left, top, right, bottom } = facility.box;
    const center = (left + right) / 2 - width / 2;
    const candidates = [[center, top - 18], [center, bottom + 2], [right + 3, top], [left - width - 3, top]];
    const bounds = candidates.map(([x, y]) => ({
      x: clamp(x, 2, Math.max(2, view.width - width - 2)), y: clamp(y, 2, view.height - 18), width,
    })).find(box => !markers.some(({ x, y, diameter }) => x + diameter / 2 > box.x && x - diameter / 2 < box.x + width
      && y + diameter / 2 > box.y && y - diameter / 2 < box.y + 16)
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
  const priority = node => node.role !== 'Retained' ? 0 : changes.has(node.dc ?? node.id) ? 1 : 2;
  const nodes = located.sort((a, b) => priority(a) - priority(b) || order(a, b))
    .map(node => ({ node, anchor: project(node.point.lon, node.point.lat) }))
    .filter(({ anchor }) => anchor.x >= 0 && anchor.x <= view.width && anchor.y >= 0 && anchor.y <= view.height);
  const markers = placeMarkers(nodes, view).filter(({ node }) => roles.has(node.role));
  for (const marker of markers) {
    // Give separated markers larger native targets. Their hit boxes never cover another marker's center.
    const clearance = markers.reduce((min, other) => other === marker ? min
      : Math.min(min, Math.max(Math.abs(marker.x - other.x), Math.abs(marker.y - other.y))), targetSize + 0.5);
    marker.target = Math.max(1, clearance - 0.5);
  }
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
    const box = { left: Math.min(...group.map(p => p.x - p.diameter / 2)) - 3,
      right: Math.max(...group.map(p => p.x + p.diameter / 2)) + 3,
      top: Math.min(...group.map(p => p.y - p.diameter / 2)) - 3,
      bottom: Math.max(...group.map(p => p.y + p.diameter / 2)) + 3 };
    const separate = markers.some(({ node, x, y, diameter }) => node.dc !== id
      && x + diameter / 2 > box.left && x - diameter / 2 < box.right
      && y + diameter / 2 > box.top && y - diameter / 2 < box.bottom);
    const count = metricDelta(before || (beforePartial ? undefined : 0), after || (afterPartial ? undefined : 0),
      { beforePartial, afterPartial });
    const description = id + ' · ' + count.text + ' recorded ' + (after === 1 ? 'member' : 'members')
      + (group.length > after ? ' · ' + group.length + (group.length === 1 ? ' marker shown' : ' markers shown') : '');
    facilities.push({ id, before, after, count: count.text, description, markers: group, box, separate });
  }
  facilities.sort((a, b) => (Number(b.before !== b.after) - Number(a.before !== a.after)) || a.id.localeCompare(b.id));
  facilityLabels(facilities, markers, view);
  return { ...view, markers, facilities, mapped: located.length, total: members.length,
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
  const { width, height, markers, facilities } = scene;
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
    ctx.strokeStyle = '#46616d72';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = '#48616c';
    ctx.fill();
  }
  ctx.strokeStyle = '#3b586787';
  ctx.setLineDash([1, 2.5]);
  for (const facility of facilities) {
    if (facility.markers.length < 2) continue;
    const { left, top, right, bottom } = facility.box;
    ctx.beginPath();
    if (facility.separate) {
      for (const { x, y, diameter } of facility.markers) {
        ctx.moveTo(x + diameter / 2 + 2, y);
        ctx.arc(x, y, diameter / 2 + 2, 0, Math.PI * 2);
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
  if (exported) for (const { node, x, y, diameter } of [...markers].reverse()) {
    ctx.beginPath();
    ctx.arc(x, y, diameter / 2 - 0.6, 0, Math.PI * 2);
    ctx.fillStyle = palette[node.role];
    ctx.fill();
    ctx.lineWidth = selected.has(node.id) ? 2 : 1;
    ctx.strokeStyle = selected.has(node.id) ? '#ec9a33' : '#fff';
    ctx.stroke();
    if (node.role !== 'Retained') {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 14px system-ui';
      ctx.fillText(signs[node.role], x, y);
    }
  }
}

function sceneCaption(scene) {
  const filter = scene.roles.length === Object.keys(names).length ? 'All roles' : 'Filter: ' + (scene.roles.map(role => names[role]).join(', ') || 'no roles');
  return scene.total + ' nodes across both states · ' + scene.mapped + '/' + scene.total + ' located · '
    + scene.markers.length + ' shown · ' + filter + (scene.pending ? ' · ' + scene.pending + ' locations pending' : '');
}

function facilityCaption(scene) {
  return scene.facilities.filter(site => site.before !== site.after || site.markers.length > site.after)
    .map(site => site.description).join(' | ');
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
  let dragged = false;
  let unit;
  const limit = () => {
    lon = clamp(lon, -180, 180);
    lat = clamp(lat, -90, 90);
  };

  function draw() {
    map.toggleAttribute('data-regional', scale > 1);
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
    for (const { node, anchor, x, y, target, diameter } of scene.markers) {
      let button = buttons.get(node.id);
      if (!button) {
        button = action('', () => inspect([node.id], button.dataset.nodeLabel));
        button.dataset.marker = node.id;
        button.append(styled('span', 'map-glyph'));
        button.firstElementChild.setAttribute('aria-hidden', 'true');
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
      button.firstElementChild.textContent = node.role === 'Retained' ? '' : signs[node.role];
      button.style.setProperty('--pin-glyph', diameter + 'px');
      button.style.setProperty('--pin-target', target + 'px');
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
    caption.textContent = model ? sceneCaption(scene) + (scene.markers.some(marker => marker.target < 24)
      ? ' · Zoom in or use the node list to select nodes in dense locations.' : '')
      : emptyMessage ?? 'Registered locations appear here as evidence becomes available.';
    facilities.textContent = facilityCaption(scene);
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
    dragged = false;
    if (event.target.closest('button') || event.pointerType === 'touch') return;
    pointer = [event.clientX, event.clientY, lon, lat];
    map.setPointerCapture(event.pointerId);
  });
  map.addEventListener('pointermove', event => {
    if (!pointer) return;
    if (!dragged && Math.hypot(event.clientX - pointer[0], event.clientY - pointer[1]) < 4) return;
    dragged = true;
    lon = pointer[2] - (event.clientX - pointer[0]) / unit / scale;
    lat = pointer[3] + (event.clientY - pointer[1]) / unit / scale;
    limit();
    focusLabel = 'Panned view';
    draw();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) map.addEventListener(name, () => { pointer = undefined; });
  map.addEventListener('click', event => {
    if (dragged || event.target.closest('button')) return;
    const rect = pins.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    let nearest;
    let squared = (targetSize / 2) ** 2;
    for (const marker of scene.markers) {
      const separation = distance(point, marker);
      if (separation >= squared) continue;
      squared = separation;
      nearest = marker;
    }
    if (nearest) {
      const button = buttons.get(nearest.node.id);
      button.focus({ preventScroll: true });
      button.click();
    }
  });

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
      facilityCaption(scene),
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
