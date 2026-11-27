import { flagAtlas, flagCodes, flagSize } from './data/flag-atlas.js';
import { units } from './data/map-units.js';
import { el, styled } from './view.js';

const flags = new Map(flagCodes.match(/../g).map((code, index) => [code, index]));
const mappedCodes = new Set(units.filter(Boolean));
const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const compactNames = new Intl.DisplayNames(['en'], { type: 'region', style: 'short', fallback: 'none' });
const displayAliases = new Map([['UK', 'GB']]);

export const countryToken = region => region?.split(',')[1]?.trim() || undefined;

export function countryName(token) {
  if (!token) return undefined;
  const capitalized = token.toUpperCase();
  const code = displayAliases.get(capitalized) ?? capitalized;
  const short = flags.has(code) ? compactNames.of(code) : undefined;
  const name = flags.has(code) ? (short && short.length > 3 ? short : names.of(code)) : undefined;
  return name ? { code, name } : { name: token };
}

const emoji = code => Array.from(code, char => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65)).join('');

export function countryMarkdown(token, fallback) {
  const country = countryName(token);
  return country?.code ? emoji(country.code) + ' ' + country.name + ' (' + token + ')' : country?.name ?? fallback;
}

let atlas;
export function countryLabel(token, fallback, showToken = false) {
  const country = countryName(token);
  if (!country?.code) return el('span', country?.name ?? fallback);
  const [width, height, columns] = flagSize;
  const index = flags.get(country.code);
  const flag = Object.assign(styled('canvas', 'country-flag'), { width, height });
  flag.setAttribute('aria-hidden', 'true');
  const label = styled('span', 'country-label', flag, country.name, showToken ? ' (' + token + ')' : null);
  label.title = 'Recorded country token: ' + token;
  label.dataset.recordedCountry = token;
  if (!atlas) {
    const png = Uint8Array.from(atob(flagAtlas), char => char.charCodeAt(0));
    atlas = Promise.resolve().then(() => createImageBitmap(new Blob([png], { type: 'image/png' })));
  }
  atlas.then(bitmap => {
    flag.getContext('2d').drawImage(bitmap, index % columns * width, Math.floor(index / columns) * height,
      width, height, 0, 0, width, height);
    flag.dataset.drawn = '';
  }).catch(() => flag.replaceWith(el('span', emoji(country.code))));
  return label;
}

export const countryStyles = {
  increase: { color: '#bfe2c4' },
  decrease: { color: '#edc9c8' },
  exit: { color: '#edc9c8', border: '#a05f65' },
  neutral: { color: '#d7dfda' },
};
export const boundaryNote = 'Natural Earth map-unit boundaries are cartographic. Country shading uses recorded membership groups. Green shows increases and red shows decreases. A dashed border marks a country falling to zero. Small squares mark represented map units too small to see at the current zoom.';

export function countryComparison(rows, dimension) {
  if (!dimension?.distinct) return { groups: [], shades: {}, note: 'Country shading awaits the replicated comparison.' };
  const groups = rows.filter(row => row.key === 'RegisteredCountry').map(row => ({
    token: row.group, ...countryName(row.group), before: row.prior, after: row.proposed, delta: row.delta,
  }));
  const byCode = new Map();
  for (const group of groups) {
    if (!mappedCodes.has(group.code)) continue;
    if (!byCode.has(group.code)) byCode.set(group.code, []);
    byCode.get(group.code).push(group);
  }
  const ambiguous = [...byCode.values()].some(items => items.length > 1);
  const unmapped = groups.some(group => !mappedCodes.has(group.code));
  const notes = [];
  if (dimension.partial) notes.push('Missing country evidence leaves all country fills neutral.');
  if (ambiguous) notes.push('Recorded tokens that resolve to the same map unit stay separate. Those fills are neutral.');
  if (unmapped) notes.push('Unmatched recorded country labels remain in the distribution.');
  const shades = Object.fromEntries([...byCode].map(([code, items]) => {
    const [group] = items;
    const shade = dimension.partial || items.length > 1 || group.before === group.after ? 'neutral'
      : group.after === 0 ? 'exit' : group.after > group.before ? 'increase' : 'decrease';
    return [code, shade];
  }));
  return { groups, shades, note: notes.join(' ') };
}
