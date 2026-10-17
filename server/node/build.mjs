// pnpm build:server — bundles the Node server into server-dist/main.mjs with its SQL migrations beside it,
// and the read-only chat report lister into server-dist/reports.mjs.
import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';
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
console.log('built server-dist/main.mjs and server-dist/reports.mjs');
