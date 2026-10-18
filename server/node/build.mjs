// pnpm build:server — bundles the Node server into server-dist/main.mjs with its SQL migrations beside it,
// and the read-only chat report lister into server-dist/reports.mjs.
import { build } from 'esbuild';
import { cp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const out = new URL('server-dist/', root);
await rm(out, { recursive: true, force: true });
const bundle = (entry, outfile) => build({
  entryPoints: [fileURLToPath(new URL(entry, root))],
  outfile: fileURLToPath(new URL(outfile, out)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Optional native add-ons; pg and ws fall back to JavaScript when they are absent.
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  // pg and ws are CommonJS and require() Node built-ins.
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});
await bundle('server/node/main.ts', 'main.mjs');
await bundle('server/node/reports.mjs', 'reports.mjs');
await cp(new URL('server/node/migrations/', root), new URL('migrations/', out), { recursive: true });
// The real Area host loads the same four validated collision artifacts as the browser.
await cp(new URL('public/world/', root), new URL('world/', out), { recursive: true });
const artifacts = {};
let source;
for (const world of ['w1', 'w2', 'w3', 'w4']) {
  const file = `collision-${world}.json`;
  const bytes = await readFile(new URL(`world/${file}`, out));
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.format !== 'crabcraft-collision' || data.version !== 1 || data.world !== world ||
      !/^[a-f0-9]{64}$/.test(data.source) || source && source !== data.source) throw new Error(`invalid collision package: ${world}`);
  source = data.source;
  artifacts[world] = { file, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(new URL('world/world-manifest.json', out), JSON.stringify({ format: 'crabcraft-world-manifest', version: 1, source, artifacts }) + '\n');
console.log('built server-dist/main.mjs and server-dist/reports.mjs');
