import { countryLabel, countryName, countryToken } from './country-presentation.js';
import { dashboardLink } from './dashboard.js';
import { absent, nodeFields, roles, roleSummary, shortIds } from './detail-model.js';
import { clamp, drawMap, mapCoverage, mapLocations, mapProjection, mapScene, pointDistance, siteLabel } from './review-map.js';
import { action, deltaNode, el, styled } from './view.js';

const targetRadius = 14;
const midpoint = (a, b) => b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
const world = { lon: 0, lat: 0, scale: 1 };
const siteRegion = site => site.nodes.find(node => node.region)?.region.split(',').map(part => part.trim());
const siteHeading = site => {
  const region = siteRegion(site);
  return [site.id, region && [region[2], countryName(region[1])?.name].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Registered location';
};
function siteTitle(site, links = false) {
  const region = siteRegion(site);
  const center = site.id ?? 'Registered location';
  return [links ? dashboardLink('center', site.id, center) : center, region?.[2] ? ' · ' + region[2] : '',
    region?.[1] ? [region[2] ? ', ' : ' · ', countryLabel(region[1])] : null].flat();
}
const uniqueCount = (nodes, existing) => nodes.length + ' unique ' + (nodes.length === 1 ? 'node' : 'nodes') + (existing ? ' at this location' : ' represented across the two states');
const locationTitle = location => location.sites.map(siteHeading).join(' / ');
const siteCounts = site => site.count ? 'Subnet members: ' + site.count.text : '';

export function siteIdentities(nodes) {
  const owners = new Set(), providers = new Map();
  for (const node of nodes) {
    owners.add(node.owner || node.centerIssue || absent);
    const id = node.provider;
    const unavailable = id ? undefined : node.operatorIssue || absent;
    const key = id ?? unavailable;
    if (!providers.has(key)) providers.set(key, { id, unavailable, count: 0 });
    providers.get(key).count++;
  }
  return { owners: [...owners], providers: [...providers.values()] };
}

function siteEvidence(site, labels, links = false) {
  const { owners, providers } = siteIdentities(site.nodes);
  const owner = (owners.length === 1 ? 'Data center owner: ' : 'Data center owners: ') + owners.join(' · ');
  const provider = providers.flatMap(({ id, unavailable, count }, index) =>
    [index ? ' · ' : '', unavailable ?? (links ? dashboardLink('provider', id, labels.get(id)) : labels.get(id)),
      providers.length > 1 ? ' (' + count + (count === 1 ? ' node)' : ' nodes)') : '']);
  return [el('div', owner), el('div', providers.length === 1 ? 'Provider: ' : 'Providers: ', provider)];
}

function nodeDetails(node) {
  const id = Object.assign(el('input'), { value: node.id, readOnly: true });
  id.setAttribute('aria-label', 'Full node principal');
  const status = el('span');
  status.setAttribute('role', 'status');
  const field = (label, value) => el('div', el('dt', label), el('dd', value));
  const [identity, dc, owner, provider, operator, country] = nodeFields(node);
  const recorded = field => dashboardLink(field.entity, field.value, field.text);
  return styled('div', 'node-detail', id, action('Copy node ID', async () => {
    try {
      await navigator.clipboard.writeText(node.id);
      status.textContent = 'Node ID copied.';
    } catch {
      id.select();
      status.textContent = document.execCommand('copy') ? 'Node ID copied.' : 'Select and copy the node ID.';
    }
  }), ' ', dashboardLink(identity.entity, identity.value, 'Node dashboard'), status, el('dl',
    field('Data center', recorded(dc)), field('Data center owner', owner.text),
    field('Country', countryLabel(country.value, country.text, true)),
    field('Registered region', node.region || node.centerIssue || absent),
    field('Node provider', dashboardLink('provider', provider.value, provider.text)), field('Operator', operator.text),
    field('Coordinates', node.point ? node.point.lat + ', ' + node.point.lon : node.locationIssue || absent)));
}

let nextId = 0;
/**
 * Mount an IC Node Map with a producer-defined geographic scope. The map only
 * receives registered nodes, optional comparison country groups and a view key.
 */
export function nodeMap({ existing = false } = {}) {
  const roleLabel = role => existing ? 'Member' : roles[role].label;
  let geography = mapLocations([]);
  let view = world;
  let scope;
  let reason;
  let scene, projection, viewport;
  let selected, expanded, choices, hovered, hoverTimer, suppressedHover, described;
  let labels = new Map();
  const buttons = new Map();
  const canvas = el('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const pins = styled('div', 'map-pins');
  const panel = styled('section', 'map-popup');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Map location details');
  panel.id = 'map-location-' + ++nextId;
  panel.hidden = true;
  const tooltip = styled('div', 'map-tooltip');
  tooltip.id = 'map-summary-' + nextId;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  const surface = styled('div', 'map-surface', canvas, pins);
  const frame = styled('div', 'map-frame', surface, tooltip, panel);
  frame.tabIndex = 0;
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', 'Map of registered locations');
  const caption = styled('p', 'map-coverage');
  const overflow = styled('p', 'map-facilities');
  const unmapped = el('details');
  const countryNote = styled('p', 'map-country-note');
  const legend = styled('div', 'map-legend', (existing ? ['Retained'] : Object.keys(roles)).map(role => {
    const dot = styled('span', 'map-symbol');
    dot.style.background = roles[role].color;
    return el('span', dot, roleLabel(role));
  }));
  const section = styled('section', 'map-section', styled('div', 'map-heading', el('h3', 'Map')),
    frame, styled('div', 'map-caption', legend, caption), countryNote, overflow, unmapped);

  function renderTooltip() {
    const location = scene?.visible.find(item => item.key === hovered);
    tooltip.hidden = !location || selected !== undefined || choices !== undefined || suppressedHover === hovered;
    described?.removeAttribute('aria-describedby');
    described = undefined;
    if (tooltip.hidden) return;
    described = buttons.get(hovered);
    described?.setAttribute('aria-describedby', tooltip.id);
    tooltip.replaceChildren(...location.sites.map(site => el('div', el('strong', siteTitle(site)),
      el('div', siteCounts(site)), ...siteEvidence(site, labels))), existing ? null : el('span', roleSummary(location.nodes)),
      el('span', uniqueCount(location.nodes, existing)));
    tooltip.style.left = clamp(location.x - tooltip.offsetWidth / 2, 2, viewport.width - tooltip.offsetWidth - 2) + 'px';
    const top = location.y > tooltip.offsetHeight + 12 ? location.y - tooltip.offsetHeight - 8 : location.y + 8;
    tooltip.style.top = clamp(top, 2, viewport.height - tooltip.offsetHeight - 2) + 'px';
  }

  function showSummary(key) {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
    if (hovered !== key) suppressedHover = undefined;
    hovered = key;
    renderTooltip();
  }

  function leaveSummary(key) {
    if (hoverTimer) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined;
      if (hovered === key && !tooltip.matches(':hover') && document.activeElement !== buttons.get(key)) showSummary(undefined);
    }, 200);
  }
  tooltip.addEventListener('pointerenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  });
  tooltip.addEventListener('pointerleave', () => leaveSummary(hovered));

  function outside(event) { if (!frame.contains(event.target)) close(false); }

  function close(restore = true) {
    const trigger = buttons.get(selected);
    selected = expanded = choices = undefined;
    document.removeEventListener('pointerdown', outside, true);
    panel.hidden = true;
    for (const button of buttons.values()) button.setAttribute('aria-expanded', 'false');
    suppressedHover = hovered;
    if (restore) (trigger && !trigger.hidden ? trigger : frame).focus({ preventScroll: true });
    suppressedHover = hovered;
    renderTooltip();
  }

  function open(key) {
    selected = key;
    expanded = choices = undefined;
    for (const [id, button] of buttons) button.setAttribute('aria-expanded', String(id === key));
    renderPanel(true);
  }

  function renderPanel(focus = false) {
    if (selected === undefined && !choices) return;
    const location = scene.visible.find(item => item.key === selected);
    if (selected !== undefined && !location) {
      close(panel.contains(document.activeElement));
      return;
    }
    const restore = panel.contains(document.activeElement) ? document.activeElement.dataset.mapNode : undefined;
    const closeButton = action('Close', () => close());
    closeButton.setAttribute('aria-label', 'Close map details');
    const title = el('h4', location?.sites.length === 1 ? siteTitle(location.sites[0], true)
      : location ? 'Shared registered location' : 'Choose a location');
    const content = location ? location.sites.map(site => {
      const records = site.nodes.sort((a, b) => Object.keys(roles).indexOf(a.role) - Object.keys(roles).indexOf(b.role)
        || a.id.localeCompare(b.id));
      const tokens = [...new Set(records.map(node => countryToken(node.region)).filter(Boolean))];
      const countryRows = tokens.length ? tokens.map(token => {
        const group = geography.countries?.groups.find(item => item.token === token);
        return styled('p', 'map-country-count', 'Country members · ', countryLabel(token, absent, true), ' · ',
          group ? deltaNode(group.delta) : existing ? 'Country count unavailable' : 'Comparison unavailable');
      }) : el('p', 'Country · ' + (records.find(node => node.centerIssue)?.centerIssue ?? absent));
      return styled('section', 'map-popup-site',
        location.sites.length > 1 ? el('h5', siteTitle(site, true)) : null,
        site.count ? el('strong', 'Subnet members: ', deltaNode(site.count)) : null,
        countryRows,
        ...siteEvidence(site, labels, true),
        existing ? null : el('p', roleSummary(records)), el('p', uniqueCount(records, existing)),
        el('ul', records.map(node => {
          const button = action(roleLabel(node.role) + ' ' + node.label, () => {
            expanded = expanded === node.id ? undefined : node.id;
            renderPanel();
          });
          button.dataset.mapNode = node.id;
          button.style.color = roles[node.role].color;
          button.setAttribute('aria-expanded', String(expanded === node.id));
          return el('li', button, expanded === node.id ? nodeDetails(node) : null);
        })));
    }) : choices.map(item => action(locationTitle(item), () => open(item.key)));
    panel.replaceChildren(styled('div', 'map-popup-heading', title, closeButton), ...content);
    panel.hidden = false;
    document.addEventListener('pointerdown', outside, true);
    renderTooltip();
    if (focus) closeButton.focus({ preventScroll: true });
    else if (restore) [...panel.querySelectorAll('[data-map-node]')].find(button => button.dataset.mapNode === restore)?.focus({ preventScroll: true });
  }

  function draw(refreshPanel = false) {
    if (surface.clientWidth < 29 || surface.clientHeight < 29) return;
    viewport = { width: surface.clientWidth, height: surface.clientHeight };
    projection = mapProjection(viewport, view);
    frame.dataset.mapScale = String(view.scale);
    scene = mapScene(geography, projection.project, viewport);
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(viewport.width * ratio), height = Math.round(viewport.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(width / viewport.width, 0, 0, height / viewport.height, 0, 0);
    drawMap(ctx, scene, projection.project);
    const visible = new Set(scene.visible.map(location => location.key));
    for (const [key, button] of buttons) {
      if (!visible.has(key) && document.activeElement === button) frame.focus({ preventScroll: true });
      button.hidden = !visible.has(key);
    }
    for (const location of scene.visible) {
      const { x, y, key } = location;
      let button = buttons.get(key);
      if (!button) {
        button = styled('button', 'map-pin');
        button.type = 'button';
        button.setAttribute('aria-controls', panel.id);
        button.addEventListener('click', event => { if (event.detail === 0) open(key); });
        button.addEventListener('focus', () => showSummary(key));
        button.addEventListener('blur', () => leaveSummary(key));
        buttons.set(key, button);
        pins.append(button);
      }
      button.hidden = false;
      button.setAttribute('aria-label', [locationTitle(location), ...location.sites.map(siteCounts), existing ? null : roleSummary(location.nodes),
        uniqueCount(location.nodes, existing)].filter(Boolean).join(' · '));
      button.setAttribute('aria-expanded', String(selected === key));
      button.style.left = x + 'px';
      button.style.top = y + 'px';
      button.dataset.location = key;
      button.dataset.nodes = location.nodes.map(node => node.id).join(' ');
    }
    if (selected !== undefined && !visible.has(selected)) close(panel.contains(document.activeElement));
    else if (refreshPanel) renderPanel();
    renderTooltip();
    caption.textContent = scope ? mapCoverage(geography, existing) : reason ?? 'Registered locations appear as evidence loads.';
    frame.dataset.changedSiteLabels = scene.labels.filter(label => label.site).map(label => label.text).join(' | ');
    overflow.textContent = scene.overflow.length ? 'Changed sites outside map labels: ' + scene.overflow.map(siteLabel).join(' · ') : '';
  }

  const middle = () => ({ x: viewport.width / 2, y: viewport.height / 2 });
  const local = ({ clientX, clientY }) => ({ x: clientX - surface.getBoundingClientRect().left, y: clientY - surface.getBoundingClientRect().top });
  function moveAt(anchor, to, scale) {
    const { unit } = mapProjection(viewport, { scale });
    const center = middle();
    view = { scale, lon: clamp(anchor.lon - (to.x - center.x) / unit, -180, 180),
      lat: clamp(anchor.lat + (to.y - center.y) / unit, -90, 90) };
    draw();
  }
  function zoom(scale, at) { moveAt(projection.unproject(at), at, clamp(scale, 0.7, 12)); }

  const pointers = new Map();
  let gesture, tapPoint;
  let moved = false;
  function resetGesture() {
    const [a, b] = pointers.values();
    if (!a) { gesture = undefined; return; }
    const center = midpoint(a, b);
    gesture = { center, anchor: projection.unproject(center), scale: view.scale, gap: b ? pointDistance(a, b) : 0 };
  }
  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2 || !projection) return;
    tapPoint = undefined;
    if (pointers.size === 0) moved = false;
    else moved = true;
    pointers.set(event.pointerId, local(event));
    resetGesture();
    if (event.pointerType !== 'touch') event.preventDefault();
    if (moved) {
      showSummary(undefined);
      for (const id of pointers.keys()) surface.setPointerCapture(id);
    }
  });
  surface.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType !== 'touch' && !pointers.size && scene) {
        const point = local(event);
        const nearest = scene.visible.reduce((best, item) => {
          const distance = pointDistance(item, point);
          return distance < (best?.distance ?? targetRadius) ? { key: item.key, distance } : best;
        }, undefined);
        if (nearest && nearest.key !== hovered) showSummary(nearest.key);
        else if (!nearest && hovered !== undefined) leaveSummary(hovered);
      }
      return;
    }
    pointers.set(event.pointerId, local(event));
    const [a, b] = pointers.values();
    const center = midpoint(a, b);
    if (!moved && pointDistance(center, gesture.center) < 5) return;
    if (!moved) {
      moved = true;
      surface.setPointerCapture(event.pointerId);
      showSummary(undefined);
    }
    const scale = b && gesture.gap > 0 ? gesture.scale * pointDistance(a, b) / gesture.gap : gesture.scale;
    moveAt(gesture.anchor, center, clamp(scale, 0.7, 12));
  });
  function finish(event) {
    if (!pointers.has(event.pointerId)) return;
    const point = local(event);
    const tap = event.type === 'pointerup' && !moved && pointDistance(point, gesture.center) < 5;
    pointers.delete(event.pointerId);
    resetGesture();
    if (tap) tapPoint = point;
  }
  // Open on the click so the touch-generated click cannot activate a newly mounted chooser button.
  surface.addEventListener('click', event => {
    if (event.detail === 0 || !tapPoint) return;
    const point = tapPoint;
    tapPoint = undefined;
    const hits = scene.visible.filter(item => pointDistance(item, point) <= targetRadius);
    if (hits.length === 1) open(hits[0].key);
    else if (hits.length > 1) {
      selected = expanded = undefined;
      choices = hits;
      renderPanel(true);
    } else if (!panel.hidden) close(false);
    else frame.focus({ preventScroll: true });
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']) {
    surface.addEventListener(event, input => {
      const onSurface = surface.hasPointerCapture(input.pointerId);
      if (event === 'pointerleave') {
        if (!pointers.size) leaveSummary(hovered);
        if (onSurface) return;
      }
      // Touch starts with implicit capture on the canvas. Transferring capture keeps that pointer active.
      if (event === 'lostpointercapture' && input.target !== surface && onSurface) return;
      finish(input);
    });
  }
  surface.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || !projection) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
    zoom(view.scale * Math.exp(clamp(-delta * 0.002, -0.7, 0.7)), local(event));
  }, { passive: false });
  frame.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!panel.hidden) close();
      else {
        for (const id of pointers.keys()) {
          if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
        }
        pointers.clear();
        gesture = undefined;
        suppressedHover = hovered;
        renderTooltip();
      }
      return;
    }
    if (panel.contains(event.target) || event.ctrlKey || event.metaKey || !projection) return;
    const pan = { ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32] }[event.key];
    if (pan) moveAt(projection.unproject({ x: middle().x + pan[0], y: middle().y + pan[1] }), middle(), view.scale);
    else if (['+', '=', '-', '−'].includes(event.key)) zoom(view.scale * (['+', '='].includes(event.key) ? 1.5 : 1 / 1.5), middle());
    else return;
    event.preventDefault();
  });

  function dismissFromOutside(event) {
    if (event.key !== 'Escape' || frame.contains(event.target)) return;
    if (!panel.hidden) close(false);
    else if (!tooltip.hidden) {
      suppressedHover = hovered;
      renderTooltip();
    }
  }
  document.addEventListener('keydown', dismissFromOutside);

  const observer = new ResizeObserver(() => draw());
  observer.observe(surface);
  return {
    section,
    dispose() {
      document.removeEventListener('keydown', dismissFromOutside);
      observer.disconnect();
      clearTimeout(hoverTimer);
      close(false);
    },
    update(snapshot, message) {
      const nextScope = snapshot?.key;
      if (nextScope !== scope) {
        scope = nextScope;
        view = world;
        close(false);
        showSummary(undefined);
        buttons.clear();
        pins.replaceChildren();
      }
      reason = message;
      geography = mapLocations(snapshot?.members ?? [], snapshot?.countries);
      labels = shortIds((snapshot?.members ?? []).map(node => node.provider).filter(Boolean));
      countryNote.textContent = snapshot?.countries?.note ?? '';
      unmapped.hidden = !geography.unmapped.length;
      const focusKey = unmapped.contains(document.activeElement) ? document.activeElement.dataset.node : undefined;
      const openNodes = new Set([...unmapped.querySelectorAll('details[open] > summary')].map(item => item.dataset.node));
      unmapped.replaceChildren(el('summary', 'Unmapped nodes (' + geography.unmapped.length + ')'),
        el('ul', geography.unmapped.map(node => {
          const label = [roleLabel(node.role) + ' ' + node.label, node.dc, node.locationIssue].filter(Boolean).join(' · ');
          const summary = el('summary', label);
          summary.dataset.node = node.id;
          const details = el('details', summary, nodeDetails(node));
          details.open = openNodes.has(node.id);
          return el('li', details);
        })));
      if (focusKey) [...unmapped.querySelectorAll('summary')].find(item => item.dataset.node === focusKey)?.focus({ preventScroll: true });
      draw(true);
    },
  };
}
