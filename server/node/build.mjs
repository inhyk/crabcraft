// pnpm build:server — bundles the Node server into server-dist/main.mjs with its SQL migrations beside it.
import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const out = new URL('server-dist/', root);
await rm(out, { recursive: true, force: true });
await build({
  entryPoints: [fileURLToPath(new URL('server/node/main.ts', root))],
  outfile: fileURLToPath(new URL('main.mjs', out)),
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
await cp(new URL('server/node/migrations/', root), new URL('migrations/', out), { recursive: true });
console.log('built server-dist/main.mjs');
