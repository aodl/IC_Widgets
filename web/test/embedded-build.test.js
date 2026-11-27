import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { testCatalogue } from '../test-cases/catalogue.mjs';

const web = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('embedded production accepts only freshly built, hash-named assets', async () => {
  const work = await mkdtemp(join(web, '.embedded-test-'));
  try {
    const output = join(work, 'assets');
    const run = (destination, extra = {}) => spawnSync(process.execPath, ['build.mjs', '--embed', destination], {
      cwd: web,
      env: { ...process.env, CANISTER_ID_REVIEWER: 'aaaaa-aa', DFX_NETWORK: 'ic',
        NEXUS_REPLAY_MANIFEST: '', NEXUS_REPLAY_OUTPUT: '', ...extra },
      encoding: 'utf8',
    });
    const ok = run(output);
    assert.equal(ok.status, 0, ok.stderr);
    const files = (await readdir(output)).sort();
    const catalogue = await testCatalogue();
    assert.deepEqual(files.filter(file => file.endsWith('.html')), ['404.html', 'index.html', 'test-cases.html']);
    assert.equal(files.length, 6 + Object.keys(catalogue.assets).length);
    assert.deepEqual((await readFile(join(output, 'test-case-routes.txt'), 'utf8')).trim().split('\n'),
      ['/test-cases', '/test-cases/', ...catalogue.cases.map(item => '/test-cases/' + item.id)]);
    const index = await readFile(join(output, 'index.html'), 'utf8');
    assert.match(index, /\.\/app\.[0-9a-f]{64}\.js/);
    assert.match(index, /\.\/styles\.[0-9a-f]{64}\.css/);
    for (const name of files.filter(name => /^(app|styles|replay)\./.test(name))) {
      const bytes = await readFile(join(output, name));
      assert.equal(name.split('.')[1], createHash('sha256').update(bytes).digest('hex'));
      if (name.startsWith('replay.')) assert.equal(bytes.toString(), catalogue.assets[name]);
      else assert.ok(index.includes('./' + name));
      assert.doesNotMatch(bytes.toString(), /Replay scenario|ic-api\.internetcomputer\.org/);
    }
    await writeFile(join(output, 'old.js'), 'stale asset');
    assert.notEqual(run(output).status, 0);
    for (const network of ['local', 'ic']) {
      const rejected = run(join(work, network), { DFX_NETWORK: network, NEXUS_REPLAY_MANIFEST: 'synthetic-fixtures.json' });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /Embedded frontend builds refuse replay inputs/);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
