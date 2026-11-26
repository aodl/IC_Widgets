import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
import { build } from 'esbuild';

const canister = process.env.CANISTER_ID_REVIEWER;
if (!canister) throw new Error('Set CANISTER_ID_REVIEWER to the reviewer canister principal.');
const local = process.env.DFX_NETWORK === 'local';
const replayPath = process.env.NEXUS_REPLAY_MANIFEST;
if (replayPath && !local) throw new Error('Replay assets require the local network.');
const replay = replayPath ? JSON.parse(await readFile(replayPath, 'utf8')) : null;
const output = replayPath ? process.env.NEXUS_REPLAY_OUTPUT ?? 'dist' : 'dist';

await build({
  entryPoints: ['src/app.js'],
  outfile: join(output, 'app.js'),
  bundle: true,
  minify: true,
  target: 'es2022',
  define: {
    REVIEWER_ID: JSON.stringify(Principal.fromText(canister).toText()),
    LOCAL_REPLICA: JSON.stringify(local),
    FIXTURE_REPLAY: JSON.stringify(replay),
  },
});
await mkdir(output, { recursive: true });
await Promise.all(['index.html', 'styles.css', '.ic-assets.json5'].map(file => cp(file, join(output, file))));
