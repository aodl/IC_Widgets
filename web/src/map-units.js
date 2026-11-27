import { geometry, units } from './data/map-units.js';
import { countryStyles } from './country-presentation.js';

export function decodeMapUnits() {
  const bytes = atob(geometry);
  let offset = 0;
  function unsigned() {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes.charCodeAt(offset++);
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return value;
  }
  const signed = () => { const value = unsigned(); return (value >>> 1) ^ -(value & 1); };
  return units.map(code => {
    const rings = Array.from({ length: unsigned() }, () => {
      const ring = new Float64Array(unsigned() * 2);
      let lon = 0, lat = 0;
      for (let i = 0; i < ring.length; i += 2) {
        lon += signed();
        lat += signed();
        ring[i] = lon / 200;
        ring[i + 1] = lat / 200;
      }
      return ring;
    });
    return { code, rings };
  });
}

let mapPaths;
function paths() {
  return mapPaths ??= decodeMapUnits().map(({ code, rings }) => {
    const path = new Path2D();
    let west = Infinity, east = -Infinity, north = -Infinity, south = Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const lon = ring[i], lat = ring[i + 1];
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        if (i === 0) path.moveTo(lon, -lat);
        else path.lineTo(lon, -lat);
      }
      path.closePath();
    }
    return { code, path, west, east, north, south };
  });
}

export function drawCountries(ctx, { width, height, countries }, project) {
  const origin = project(0, 0);
  const unit = project(1, 0).x - origin.x;
  const overlays = [];
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(unit, unit);
  ctx.lineWidth = 0.65 / unit;
  for (const { code, path, west, east, north, south } of paths()) {
    const a = project(west, north), b = project(east, south);
    if (a.x > width || a.y > height || b.x < 0 || b.y < 0) continue;
    const style = countryStyles[countries?.shades[code]];
    ctx.fillStyle = style?.color ?? '#edf0e8';
    ctx.strokeStyle = '#9eada4';
    ctx.fill(path, 'evenodd');
    ctx.stroke(path);
    if (style?.border) overlays.push({ path, style });
    if (style && Math.max(b.x - a.x, b.y - a.y) < 3) {
      overlays.push({ style, center: [(west + east) / 2, -(north + south) / 2] });
    }
  }
  for (const { path, style, center } of overlays) {
    if (path) {
      ctx.lineWidth = 1.15 / unit;
      ctx.strokeStyle = style.border;
      ctx.setLineDash([2 / unit, 1.3 / unit]);
      ctx.stroke(path);
      ctx.setLineDash([]);
    } else {
      const side = 3 / unit;
      const [x, y] = center;
      ctx.lineWidth = 0.75 / unit;
      ctx.fillStyle = style.color;
      ctx.strokeStyle = style.border ?? '#607d70';
      ctx.fillRect(x - side / 2, y - side / 2, side, side);
      ctx.strokeRect(x - side / 2, y - side / 2, side, side);
    }
  }
  ctx.restore();
}
