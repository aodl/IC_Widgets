import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryComparison, countryMarkdown, countryName, countryToken } from '../src/country-presentation.js';
import { compositionDimensions, compositionRows } from '../src/detail-model.js';
import { decodeMapUnits } from '../src/map-units.js';

const key = 'RegisteredCountry';
const distribution = (groups, unknown = 0) => new Map([[key, {
  unknown,
  groups: groups.map(([label, count]) => [{ RegisteredLabel: label }, count]),
  largest: [Math.max(0, ...groups.map(([, count]) => count))],
}]]);
function countries(before, after) {
  const rows = compositionRows(before, after);
  const dimension = compositionDimensions(before, after).find(item => item.key === key);
  return { dimension, ...countryComparison(rows, dimension) };
}

test('country presentation retains the registered token and resolves explicit display aliases', () => {
  assert.deepEqual(countryName('UK'), { code: 'GB', name: 'United Kingdom' });
  assert.equal(countryToken('Europe, UK ,London'), 'UK');
  assert.match(countryMarkdown('UK'), /^🇬🇧 United Kingdom \(UK\)$/);
  assert.equal(countryName('HK').name, 'Hong Kong');
  assert.equal(countryName('IM').name, 'Isle of Man');
  assert.deepEqual(countryName('QZ'), { name: 'QZ' });
  assert.deepEqual(countryName('Unmapped region'), { name: 'Unmapped region' });
  assert.equal(countryMarkdown(undefined, 'Not recorded'), 'Not recorded');
});

test('country shading uses accepted counts, retains zeros and keeps ambiguous aliases separate', () => {
  const prior = distribution([['SE', 2], ['CH', 3], ['IM', 1], ['UK', 4], ['GB', 1], ['QZ', 1]]);
  const proposed = distribution([['SE', 3], ['CH', 2], ['UK', 2], ['GB', 1], ['QZ', 1]]);
  const output = countries(prior, proposed);
  assert.deepEqual(output.shades, { CH: 'decrease', GB: 'neutral', IM: 'exit', SE: 'increase' });
  assert.match(output.note, /stay separate.*Unmatched recorded/);
  assert.equal(output.dimension.distinct.text, '6 → 5');
  assert.equal(output.groups.find(row => row.token === 'UK').delta.text, '4 → 2');
  assert.equal(output.groups.find(row => row.token === 'GB').delta.text, '1');
  assert.equal(output.groups.find(row => row.token === 'QZ').name, 'QZ');
  assert.equal(output.groups.find(row => row.token === 'IM').delta.text, '1 → 0');
});

test('incomplete country evidence leaves all directional fills neutral', () => {
  const prior = distribution([['SE', 2], ['CH', 3]], 1);
  const proposed = distribution([['SE', 3], ['CH', 2]]);
  const output = countries(prior, proposed);
  assert.deepEqual(output.shades, { CH: 'neutral', SE: 'neutral' });
  assert.match(output.note, /Missing country evidence/);
  assert.equal(output.groups.find(row => row.token === 'SE').delta.text, '≥2 → 3');
  assert.equal(output.dimension.coefficient.text, 'Unavailable from recorded evidence');
});

test('simplified map-unit geometry retains separate nondegenerate Hong Kong and Isle of Man polygons', () => {
  const shapes = decodeMapUnits();
  assert.ok(shapes.length > 250);
  for (const [code, longitude, latitude] of [['HK', 114, 22], ['IM', -5, 54]]) {
    const shape = shapes.find(item => item.code === code);
    assert.ok(shape);
    const [ring] = shape.rings;
    assert.ok(ring.length >= 6);
    let area = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      assert.ok(Math.abs(ring[i] - longitude) < 1);
      assert.ok(Math.abs(ring[i + 1] - latitude) < 1);
      area += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
    }
    assert.ok(Math.abs(area) > 0.001);
  }
});
