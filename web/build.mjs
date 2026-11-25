import { cp, mkdir, readFile } from 'node:fs/promises';
import { Principal } from '@icp-sdk/core/principal';
import { build } from 'esbuild';

const canister = process.env.CANISTER_ID_REVIEWER;
if (!canister) throw new Error('Set CANISTER_ID_REVIEWER to the reviewer canister principal.');
const local = process.env.DFX_NETWORK === 'local';
const countryCodes = Object.fromEntries((await readFile(new URL('../crates/review-engine/data/country-codes.txt', import.meta.url), 'utf8'))
  .trim().split('\n').flatMap(line => {
    const [short, long] = line.trim().split(' ');
    return [[short, short], [long, short]];
  }));

await build({
  entryPoints: ['src/app.js'],
  outfile: 'dist/app.js',
  bundle: true,
  minify: true,
  target: 'es2022',
  define: {
    REVIEWER_ID: JSON.stringify(Principal.fromText(canister).toText()),
    LOCAL_REPLICA: JSON.stringify(local),
    REGISTRY_COUNTRY_CODES: JSON.stringify({ ...countryCodes, UK: 'GB' }),
  },
});
await mkdir('dist', { recursive: true });
await Promise.all(['index.html', 'styles.css', '.ic-assets.json5'].map(file => cp(file, `dist/${file}`)));
