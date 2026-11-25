import land from './data/land.js';
import { el, styled } from './view.js';

const W = 1200;
const H = 620;
const palette = { Removed: '#ad263f', Added: '#087748', Retained: '#315e80' };
const signs = { Added: '+', Removed: '−', Retained: '•' };

export function mapPopulation(members, mode) {
  return members.filter(node =>
    mode === 'Before' ? node.role !== 'Added' :
    mode === 'After' ? node.role !== 'Removed' : true);
}

export function clusters(members, roles, project, radius = 31) {
  const points = [];
  for (const node of members) {
    if (!roles.has(node.role) || !node.point) continue;
    const point = project(node.point.lon, node.point.lat);
    if (point.x < 0 || point.x > W || point.y < 0 || point.y > H) continue;
    let cluster;
    let nearest = radius;
    for (const row of points) {
      const distance = Math.hypot(row.x - point.x, row.y - point.y);
      if (node.role !== 'Retained' && row.nodes[0].role !== 'Retained' && distance > 0.001) continue;
      if (distance < nearest) {
        cluster = row;
        nearest = distance;
      }
    }
    if (!cluster) {
      cluster = { ...point, nodes: [] };
      points.push(cluster);
    }
    cluster.nodes.push(node);
  }
  return points;
}

function separateChanged(points, gap) {
  const placed = [];
  for (const point of points.filter(row => row.nodes.some(node => node.role !== 'Retained'))) {
    let x = point.x;
    let y = point.y;
    for (let attempt = 0; placed.some(p => Math.hypot(p.displayX - x, p.displayY - y) < gap) && attempt < 8; attempt++) {
      const angle = attempt * Math.PI / 4;
      const distance = gap * (attempt < 4 ? 1 : 1.4);
      x = Math.max(15, Math.min(W - 15, point.x + Math.cos(angle) * distance));
      y = Math.max(24, Math.min(H - 14, point.y + Math.sin(angle) * distance));
    }
    point.displayX = x;
    point.displayY = y;
    placed.push(point);
  }
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

export function reviewMap(inspect) {
  const roles = new Set(Object.keys(palette));
  let model;
  let emptyMessage;
  let selected = new Set();
  let mode = 'Changes';
  let focusLabel = 'World';
  const canvas = el('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const pins = styled('div', 'map-pins');
  const map = styled('div', 'map-frame', canvas, pins);
  map.setAttribute('aria-label', 'Map of registered data centers. The Nodes view provides a text equivalent.');
  const caption = styled('p', 'map-coverage');
  const status = styled('p', 'status');
  status.setAttribute('role', 'status');
  const unmapped = el('details', el('summary', 'Unmapped nodes'));
  let scale = 1;
  let lon = 0;
  let lat = 0;
  let pointer;
  const limit = () => {
    lon = Math.max(-160, Math.min(160, lon));
    lat = Math.max(-75, Math.min(75, lat));
  };
  function project(x, y) {
    return { x: W / 2 + (x - lon) * (W / 360) * scale, y: H / 2 - (y - lat) * (W / 360) * scale };
  }

  function draw(exportImage = false) {
    ctx.fillStyle = '#e7eff2';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#cedde1';
    ctx.lineWidth = 1;
    for (let x = -180; x <= 180; x += 30) {
      ctx.beginPath();
      ctx.moveTo(project(x, -90).x, 0);
      ctx.lineTo(project(x, 90).x, H);
      ctx.stroke();
    }
    for (let y = -90; y <= 90; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, project(0, y).y);
      ctx.lineTo(W, project(0, y).y);
      ctx.stroke();
    }
    ctx.fillStyle = '#cfdbcd';
    ctx.strokeStyle = '#a2b39f';
    ctx.lineWidth = 1.2;
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

    const population = mapPopulation(model?.members ?? [], mode);
    const viewWidth = map.clientWidth || Math.min(window.innerWidth, W);
    // Changed nodes seed clusters before retained nodes, so a retained point
    // cannot shift the marker away from the registered location of a change.
    const display = [...population].sort((a, b) => +(a.role === 'Retained') - +(b.role === 'Retained'));
    const gap = Math.max(32, 44 * W / viewWidth);
    const markers = clusters(display, roles, project, gap);
    separateChanged(markers, gap);
    markers.reverse();
    const buttons = [];
    for (const cluster of markers) {
      const counts = Object.keys(palette).map(role => [role, cluster.nodes.filter(node => node.role === role).length]).filter(([, count]) => count);
      const sites = [...new Set(cluster.nodes.map(node => node.dc).filter(Boolean))];
      const site = sites.join(', ');
      const label = counts.map(([role, count]) => role + ' ' + count).join(', ') + ' · ' + site;
      const changes = counts.filter(([role]) => role !== 'Retained');
      const emphasized = cluster.nodes.some(node => selected.has(node.id));
      const identity = cluster.nodes.map(node => node.id).join(',');
      const x = cluster.displayX ?? cluster.x;
      const y = cluster.displayY ?? cluster.y;
      if (x !== cluster.x || y !== cluster.y) {
        ctx.beginPath();
        ctx.moveTo(cluster.x, cluster.y);
        ctx.lineTo(x, y);
        ctx.strokeStyle = '#315e80';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (exportImage) {
        ctx.beginPath();
        ctx.arc(x, y, changes.length ? 17 : 12, 0, Math.PI * 2);
        ctx.fillStyle = changes.length ? '#18344a' : palette.Retained;
        ctx.fill();
        ctx.lineWidth = emphasized ? 5 : 2;
        ctx.strokeStyle = emphasized ? '#f2a445' : '#fff';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(String(cluster.nodes.length), x, y + 5);
        changes.forEach(([role, count], index) => {
          const badge = signs[role] + count;
          ctx.fillStyle = palette[role];
          ctx.fillRect(x - 18 + index * 24, y - 31, 24, 16);
          ctx.fillStyle = '#fff';
          ctx.fillText(badge, x - 6 + index * 24, y - 19);
        });
        if (changes.length) {
          ctx.textAlign = x < W - 95 ? 'left' : 'right';
          ctx.fillStyle = '#132637';
          ctx.fillText(sites.length > 3 ? sites.length + ' registered data centers' : site,
            x + (x < W - 95 ? 21 : -21), y + 5, 100);
        }
      } else {
        const marker = action(cluster.nodes.length, () => inspect(cluster.nodes.map(node => node.id),
          sites.length > 1 ? 'Location cluster' : site || 'Map location'));
        marker.className = 'map-pin' + (changes.length ? ' changed-pin' : '');
        marker.title = label;
        marker.dataset.marker = identity;
        marker.setAttribute('aria-label', label);
        marker.setAttribute('aria-pressed', String(emphasized));
        marker.style.left = (100 * x / W) + '%';
        marker.style.top = (100 * y / H) + '%';
        if (changes.length) marker.append(styled('span', 'map-badges', changes.map(([role, count]) =>
          styled('span', 'role-' + role.toLowerCase(), signs[role] + count))));
        buttons.push(marker);
      }
    }
    const mapped = population.filter(node => node.point).length;
    const coverage = mapped + '/' + population.length + ' mapped';
    if (!exportImage) {
      const focused = document.activeElement?.dataset.marker;
      pins.replaceChildren(...buttons);
      if (focused) buttons.find(button => button.dataset.marker === focused)?.focus({ preventScroll: true });
      caption.textContent = model
        ? mode + ' · ' + population.length + (mode === 'Changes' ? ' distinct nodes · ' : ' members · ') + coverage
        : emptyMessage ?? 'Registered locations appear here as evidence becomes available.';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.96)';
      ctx.fillRect(12, 12, W - 24, 76);
      ctx.fillRect(12, H - 42, W - 24, 30);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#132637';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText('Network Nexus · ' + model.ids.map(id => '#' + id).join(' + ') + ' · Registry ' + model.version, 24, 38, W - 48);
      ctx.font = '15px sans-serif';
      ctx.fillText(model.subnet.split('-')[0] + ' · ' + model.scenario + ' · ' + model.stateLabel, 24, 60, W - 48);
      ctx.fillText(mode + ' · ' + coverage + ' · ' + focusLabel + ' · ' + scale.toFixed(1) + '× · input ' + model.calculation.inputHash.slice(0, 12), 24, 80, W - 48);
      ctx.fillText('+ Added   − Removed   • Retained  |  ' +
        Object.keys(palette).map(role => roles.has(role) ? role : role + ' hidden').join(' · ') +
        '  |  ' + (population.length - mapped) + ' unmapped  |  Natural Earth', 24, H - 21, W - 48);
    }
  }

  function redrawUnmapped() {
    const open = unmapped.open;
    const rows = mapPopulation(model?.members ?? [], mode).filter(node => !node.point);
    unmapped.replaceChildren(el('summary', 'Unmapped nodes (' + rows.length + ')'),
      rows.length ? el('ul', rows.map(node => el('li',
        action(signs[node.role] + ' ' + node.label, () => inspect([node.id], node.label)),
        el('small', node.row[8] === '—' ? 'Registered coordinates unavailable' : node.row[8])))) : el('p', 'All displayed nodes have registered coordinates.'));
    unmapped.open = open;
    unmapped.hidden = !model?.members?.length;
  }

  function pan(dx, dy) {
    lon += dx / scale;
    lat += dy / scale;
    limit();
    focusLabel = 'Panned view';
    draw();
  }
  function zoom(multiplier) {
    scale = Math.max(1, Math.min(12, scale * multiplier));
    if (scale === 1) lon = lat = 0;
    focusLabel = 'Zoomed view';
    draw();
    status.textContent = 'Zoom ' + scale.toFixed(1) + '×';
  }
  function focusChanges() {
    const points = (model?.members ?? []).filter(node => node.role !== 'Retained' && node.point).map(node => node.point);
    if (!points.length) {
      status.textContent = 'Changed nodes have no mapped locations.';
      return;
    }
    const west = Math.min(...points.map(p => p.lon)), east = Math.max(...points.map(p => p.lon));
    const south = Math.min(...points.map(p => p.lat)), north = Math.max(...points.map(p => p.lat));
    lon = (west + east) / 2;
    lat = (south + north) / 2;
    scale = Math.max(1, Math.min(9, 245 / Math.max(east - west, 1), 120 / Math.max(north - south, 1)));
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
    lon = pointer[2] - (event.clientX - pointer[0]) * 360 / map.clientWidth / scale;
    lat = pointer[3] + (event.clientY - pointer[1]) * 360 / map.clientWidth / scale;
    limit();
    focusLabel = 'Panned view';
    draw();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) map.addEventListener(name, () => { pointer = undefined; });

  const modes = ['Changes', 'Before', 'After'].map(value => {
    const control = action(value, () => {
      mode = value;
      for (const button of modes) button.setAttribute('aria-pressed', String(button === control));
      draw();
      redrawUnmapped();
    });
    control.setAttribute('aria-pressed', String(mode === value));
    return control;
  });
  const arrows = [['←', 'Pan west', -30, 0], ['↑', 'Pan north', 0, 30], ['↓', 'Pan south', 0, -30], ['→', 'Pan east', 30, 0]];
  const focus = action('Focus changes', focusChanges);
  const controls = styled('div', 'actions map-controls', action('World', () => {
    lon = lat = 0; scale = 1; focusLabel = 'World'; draw();
  }), focus, ...arrows.map(([symbol, title, x, y]) => {
    const control = action(symbol, () => pan(x, y));
    control.setAttribute('aria-label', title);
    return control;
  }), ...[ ['+', 'Zoom in', 1.6], ['−', 'Zoom out', 1 / 1.6] ].map(([label, name, factor]) => {
    const control = action(label, () => zoom(factor));
    control.setAttribute('aria-label', name);
    return control;
  }));
  const exportButton = action('Export map PNG', () => {
    if (!model?.calculation) return;
    const exported = model;
    const name = 'network-nexus-' + model.ids.join('-') + '-' + model.version + '.png';
    const image = el('canvas');
    image.width = W;
    image.height = H;
    draw(true);
    image.getContext('2d').drawImage(canvas, 0, 0);
    draw();
    image.toBlob(blob => {
      if (model !== exported) return;
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
      return el('label', toggle, styled('span', 'map-symbol role-' + role.toLowerCase(), signs[role]), role);
    }));
  const section = styled('section', 'map-section', styled('div', 'map-heading', el('h3', 'World map'),
    styled('div', 'segmented', modes)), map, caption, controls, filters, unmapped, status);
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
    update(next, ids = [], reason) {
      model = next;
      emptyMessage = reason;
      selected = new Set(ids);
      exportButton.disabled = !model?.calculation;
      focus.disabled = !model?.members?.some(node => node.role !== 'Retained' && node.point);
      redrawUnmapped();
      draw();
    },
    highlight(ids) {
      selected = new Set(ids);
      draw();
    },
  };
}
