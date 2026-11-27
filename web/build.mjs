import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
import { build } from 'esbuild';
import { testCatalogue } from './test-cases/catalogue.mjs';

const [, , mode, embedOutput, ...extra] = process.argv;
if (mode && (mode !== '--embed' || !embedOutput || extra.length)) {
  throw new Error('Usage: node build.mjs [--embed fresh-output-directory]');
}
const embedded = mode === '--embed';
if (embedded && (process.env.NEXUS_REPLAY_MANIFEST || process.env.NEXUS_REPLAY_OUTPUT)) {
  throw new Error('Embedded frontend builds refuse replay inputs.');
}

const canister = process.env.CANISTER_ID_REVIEWER;
if (!canister) throw new Error('Set CANISTER_ID_REVIEWER to the reviewer canister principal.');
const local = process.env.DFX_NETWORK === 'local';
const replayPath = process.env.NEXUS_REPLAY_MANIFEST;
if (replayPath && !local) throw new Error('Replay assets require the local network.');
const replay = replayPath ? JSON.parse(await readFile(replayPath, 'utf8')) : null;
const catalogue = embedded ? await testCatalogue() : { cases: [], assets: {} };
const output = replayPath ? process.env.NEXUS_REPLAY_OUTPUT ?? 'dist' : 'dist';

const bundle = await build({
  entryPoints: ['src/app.js'],
  outfile: join(output, 'app.js'),
  bundle: true,
  minify: true,
  write: !embedded,
  target: 'es2022',
  define: {
    REVIEWER_ID: JSON.stringify(Principal.fromText(canister).toText()),
    LOCAL_REPLICA: JSON.stringify(local),
    FIXTURE_REPLAY: JSON.stringify(replay),
    TEST_CASES: JSON.stringify(catalogue.cases),
  },
});
if (embedded) {
  const javascript = bundle.outputFiles[0].contents;
  const stylesheet = await readFile('styles.css');
  const filename = (prefix, extension, bytes) =>
    prefix + '.' + createHash('sha256').update(bytes).digest('hex') + '.' + extension;
  const script = filename('app', 'js', javascript);
  const style = filename('styles', 'css', stylesheet);
  const template = await readFile('index.html', 'utf8');
  for (const reference of ['./app.js', './styles.css']) {
    if (template.split(reference).length !== 2) throw new Error('Expected one HTML reference to ' + reference);
  }
  const index = template.replace('./app.js', './' + script).replace('./styles.css', './' + style);
  const notFound = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Not found | IC Widgets</title>'
    + '<h1>Page not found</h1><a href="/">Open IC Widgets</a></html>\n';
  const testPage = index.replace('./' + script, '/' + script).replace('./' + style, '/' + style);
  const routes = ['/test-cases', '/test-cases/', ...catalogue.cases.map(row => '/test-cases/' + row.id)].join('\n') + '\n';
  await mkdir(embedOutput);
  await Promise.all(Object.entries({ [script]: javascript, [style]: stylesheet, 'index.html': index, '404.html': notFound,
    'test-cases.html': testPage, 'test-case-routes.txt': routes, ...catalogue.assets })
    .map(([name, bytes]) => writeFile(join(embedOutput, name), bytes, { flag: 'wx' })));
} else {
  await mkdir(output, { recursive: true });
  await Promise.all(['index.html', 'styles.css', '.ic-assets.json5'].map(file => cp(file, join(output, file))));
}
