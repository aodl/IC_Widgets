import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function capturedInputs() {
  const files = {
    activityRegistry: '../../docs/subnet-activity/governance-2026-11-27/pinned-registry-values.json',
    fixtureManifest: '../../tests/source-fixture/data/historical/replays.json',
    indexedCatalogue: '../../tests/source-fixture/data/catalogue.json',
    reviewerInterface: '../src/reviewer.did.js',
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) =>
    [name, createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex')])));
}
