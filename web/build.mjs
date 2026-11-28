import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
import { build } from 'esbuild';
import { widgetBuild } from './widget-build.mjs';
import { testCatalogue } from './test-cases/catalogue.mjs';

const [, , mode, embedOutput, ...extra] = process.argv;
if (mode && (mode !== '--embed' || !embedOutput || extra.length)) {
  throw new Error('Usage: node build.mjs [--embed fresh-output-directory]');
}
const embedded = mode === '--embed';
const widget = widgetBuild();
if (widget && !embedded) throw new Error('Widget frame profiles require an embedded frontend build.');
if (embedded && (process.env.NEXUS_REPLAY_MANIFEST || process.env.NEXUS_REPLAY_OUTPUT)) {
  throw new Error('Embedded frontend builds refuse replay inputs.');
}

const canister = process.env.CANISTER_ID_REVIEWER;
if (!canister) throw new Error('Set CANISTER_ID_REVIEWER to the reviewer canister principal.');
const local = process.env.DFX_NETWORK === 'local';
const replayPath = process.env.NEXUS_REPLAY_MANIFEST;
if (replayPath && !local) throw new Error('Replay assets require the local network.');
const replay = replayPath ? JSON.parse(await readFile(replayPath, 'utf8')) : null;
const catalogue = embedded && !widget ? await testCatalogue() : { cases: [], assets: {} };
const output = replayPath ? process.env.NEXUS_REPLAY_OUTPUT ?? 'dist' : 'dist';

const widgetEntry = { map: ['src/node-map-widget.js', 'node-map.html'], activity: ['src/activity-widget.js', 'activity.html'] };
const [entry, html] = widgetEntry[widget?.view] ?? ['src/app.js', 'index.html'];
const bundle = await build({
  entryPoints: [entry],
  outfile: join(output, 'app.js'),
  bundle: true,
  minify: true,
  write: !embedded,
  target: 'es2022',
  define: {
    REVIEWER_ID: JSON.stringify(Principal.fromText(canister).toText()),
    LOCAL_REPLICA: JSON.stringify(local),
    FIXTURE_REPLAY: JSON.stringify(replay),
    EMBED_WIDGET: JSON.stringify(widget),
    TEST_CASES: JSON.stringify(catalogue.cases),
  },
});
if (embedded) {
  const javascript = bundle.outputFiles[0].contents;
  const css = await readFile('styles.css');
  const stylesheet = widget?.view === 'map' ? css
    : Buffer.concat([css, Buffer.from('\n'), await readFile('reviewer-experience.css')]);
  const filename = (prefix, extension, bytes) =>
    prefix + '.' + createHash('sha256').update(bytes).digest('hex') + '.' + extension;
  const script = filename('app', 'js', javascript);
  const style = filename('styles', 'css', stylesheet);
  const template = await readFile(html, 'utf8');
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
    ...(!widget && { 'test-cases.html': testPage, 'test-case-routes.txt': routes, ...catalogue.assets }) })
    .map(([name, bytes]) => writeFile(join(embedOutput, name), bytes, { flag: 'wx' })));
} else {
  await mkdir(output, { recursive: true });
  await Promise.all([
    ...['index.html', '.ic-assets.json5'].map(file => cp(file, join(output, file))),
    writeFile(join(output, 'styles.css'), (await readFile('styles.css', 'utf8')) + '\n' + await readFile('reviewer-experience.css', 'utf8')),
  ]);
}
