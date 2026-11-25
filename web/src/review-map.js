import land from './data/land.js';
import { el, styled } from './view.js';

const W = 1200;
const H = 620;
const palette = { Removed: '#ad263f', Added: '#087748', Retained: '#16568e' };

export function clusters(members, roles, project, radius = 31) {
  const points = [];
  for (const node of members) {
    if (!roles.has(node.role) || !node.point) continue;
    const point = project(node.point.lon, node.point.lat);
    if (point.x < 0 || point.x > W || point.y < 0 || point.y > H) continue;
    let cluster = points.find(row => Math.hypot(row.x - point.x, row.y - point.y) < radius);
    if (!cluster) {
      cluster = { ...point, nodes: [] };
      points.push(cluster);
    }
    cluster.nodes.push(node);
  }
  return points;
}

function action(label, run) {
  const item = el('button', label);
  item.type = 'button';
  item.addEventListener('click', run);
  return item;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = el('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reviewMap(model) {
  const roles = new Set(Object.keys(palette));
  const canvas = el('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const pins = styled('div', 'map-pins');
  const selection = styled('div', 'map-selection', el('p', 'Select a marker to identify the nodes at that location.'));
  selection.setAttribute('aria-live', 'polite');
  const map = styled('div', 'map-frame', canvas, pins);
  const caption = styled('p', 'muted', 'Registered data-center coordinates · Natural Earth land outline');
  const status = styled('p', 'muted');
  status.setAttribute('role', 'status');
  let scale = 1;
  let lon = 0;
  let lat = 0;
  let pointer;
  const limit = () => {
    lon = Math.max(-150, Math.min(150, lon));
    lat = Math.max(-65, Math.min(75, lat));
  };
  function project(x, y) {
    return { x: W / 2 + (x - lon) * (W / 360) * scale, y: H / 2 - (y - lat) * (W / 360) * scale };
  }

  function identify(cluster) {
    selection.replaceChildren(el('strong', cluster.nodes.length + ' node' + (cluster.nodes.length > 1 ? 's' : '') + ' at this marker'),
      el('ul', cluster.nodes.map(node => {
        const a = el('a', node.id);
        a.href = node.row[0].url;
        return el('li', node.role + ' · ' + (node.dc ?? 'data center unavailable') + ' · ', a);
      })));
  }

  function draw(exportImage = false) {
    ctx.fillStyle = '#e6f1f5';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#b8ccd3';
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
    ctx.fillStyle = '#c1d1b6';
    ctx.strokeStyle = '#879c85';
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

    const viewWidth = map.clientWidth || Math.min(window.innerWidth, W);
    const markers = clusters(model.members, roles, project, Math.max(31, 28 * W / viewWidth));
    const buttons = [];
    for (const cluster of markers) {
      const visible = Object.keys(palette).filter(role => cluster.nodes.some(node => node.role === role));
      const site = [...new Set(cluster.nodes.map(node => node.dc))].join(', ');
      const label = visible.map(role => role + ' ' + cluster.nodes.filter(node => node.role === role).length).join(', ') + ' · ' + site;
      const colors = visible.map(role => palette[role]);
      const main = visible.find(role => role !== 'Retained') ?? 'Retained';
      const { x, y } = cluster;
      if (exportImage) {
        colors.forEach((color, index) => {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x, y, 15, index * Math.PI * 2 / colors.length, (index + 1) * Math.PI * 2 / colors.length);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        });
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(cluster.nodes.length), x, y + 5);
        if (main !== 'Retained') {
          ctx.textAlign = x < W - 70 ? 'left' : 'right';
          ctx.fillStyle = '#132637';
          ctx.fillText(site, x + (x < W - 70 ? 20 : -20), y - 13, 125);
        }
      } else {
        const marker = action(cluster.nodes.length, () => identify(cluster));
        marker.className = 'map-pin';
        marker.title = label;
        marker.setAttribute('aria-label', label);
        marker.style.left = (100 * x / W) + '%';
        marker.style.top = (100 * y / H) + '%';
        if (colors.length === 1) marker.style.backgroundColor = colors[0];
        else marker.style.backgroundImage = 'conic-gradient(' + colors.map((color, i) =>
          color + ' ' + (100 * i / colors.length) + '% ' + (100 * (i + 1) / colors.length) + '%').join(',') + ')';
        buttons.push(marker);
      }
    }
    if (!exportImage) pins.replaceChildren(...buttons);
    else {
      ctx.fillStyle = 'rgba(255,255,255,.96)';
      ctx.fillRect(12, 12, W - 24, 72);
      ctx.fillRect(12, H - 48, W - 24, 36);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#132637';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText('Network Nexus · ' + model.ids.map(id => '#' + id).join(' + ') + ' · Registry ' + model.version, 24, 40, W - 48);
      ctx.font = '16px sans-serif';
      ctx.fillText(model.subnet.split('-')[0] + ' · ' + model.scenario + ' · ' + model.stateLabel, 24, 66, W - 48);
      let x = 25;
      for (const [role, color] of Object.entries(palette)) {
        ctx.fillStyle = color;
        ctx.fillRect(x, H - 37, 14, 14);
        ctx.fillStyle = '#132637';
        ctx.fillText(role + (roles.has(role) ? '' : ' (hidden)'), x + 21, H - 24);
        x += 165;
      }
      ctx.fillText(model.members.filter(node => !node.point).length + ' unmapped · Natural Earth', x, H - 24, W - x - 24);
    }
  }

  function pan(dx, dy) {
    lon += dx / scale;
    lat += dy / scale;
    limit();
    draw();
  }
  function zoom(multiplier) {
    scale = Math.max(1, Math.min(9, scale * multiplier));
    if (scale === 1) lon = lat = 0;
    draw();
    status.textContent = 'Zoom ' + scale.toFixed(1) + '×';
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
    draw();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) map.addEventListener(name, () => { pointer = undefined; });

  const directions = [['←', 'Pan west', -30, 0], ['↑', 'Pan north', 0, 30], ['↓', 'Pan south', 0, -30], ['→', 'Pan east', 30, 0]];
  const controls = styled('div', 'actions map-controls', action('Zoom in', () => zoom(1.6)),
    action('Zoom out', () => zoom(1 / 1.6)), ...directions.map(([symbol, title, x, y]) => {
      const button = action(symbol, () => pan(x, y));
      button.setAttribute('aria-label', title);
      return button;
    }), action('Reset map', () => { lon = lat = 0; scale = 1; draw(); status.textContent = 'World view restored.'; }),
    action('Export map PNG', () => {
      const image = el('canvas');
      image.width = W;
      image.height = H;
      draw(true);
      image.getContext('2d').drawImage(canvas, 0, 0);
      draw();
      image.toBlob(blob => {
        if (blob) {
          download(blob, 'network-nexus-' + model.ids.join('-') + '-' + model.version + '.png');
          status.textContent = 'Map exported with the current zoom and filters.';
        } else status.textContent = 'Map export failed.';
      });
    }));
  const filters = styled('fieldset', 'map-filters', el('legend', 'Show nodes'),
    Object.keys(palette).map(role => {
      const toggle = el('input');
      toggle.type = 'checkbox';
      toggle.checked = true;
      toggle.addEventListener('change', () => {
        if (toggle.checked) roles.add(role); else roles.delete(role);
        selection.replaceChildren(el('p', 'Select a marker to identify the nodes at that location.'));
        draw();
      });
      const swatch = styled('span', 'swatch');
      swatch.style.backgroundColor = palette[role];
      return el('label', toggle, swatch, role);
    }));
  const unmapped = model.members.filter(node => !node.point);
  draw();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!map.isConnected) observer.disconnect();
      else draw();
    });
    observer.observe(map);
  }
  return styled('section', 'map-section', el('h3', 'World map'), controls, filters, map, caption,
    status, selection,
    el('details', el('summary', 'Unmapped nodes (' + unmapped.length + ')'),
      unmapped.length ? el('ul', unmapped.map(node => el('li', node.role + ' · ', el('code', node.id), ' · ' + (node.dc ?? 'data center unavailable')))) : el('p', 'None.')));
}
