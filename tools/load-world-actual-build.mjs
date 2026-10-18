#!/usr/bin/env node
/** Bundles tools/load-world-actual-entry.mjs (which imports the unchanged server/node/main.ts) into OUT/load-main.mjs,
 * next to server-dist's migrations and packaged world assets. Run `pnpm build:server` first.
 * The only build-time change is two optional hook calls injected into server/world/host.ts while bundling:
 * every host observe(name, ms) sample (the host's own tick and snapshotBatch timings) is copied to the entry, and the
 * host's metrics/slots/connections are handed to it for windowed counters. The source file on disk is untouched.
 * Usage: node tools/load-world-actual-build.mjs OUT_DIR */
import { build } from 'esbuild';
import { cp, readFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url), out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: load-world-actual-build.mjs OUT_DIR');
const hostPath = fileURLToPath(new URL('server/world/host.ts', root));
const edits = [
  ['  const observe = (name: string, ms: number) => {\n', '  const observe = (name: string, ms: number) => {\n    (globalThis as any).__crabLoadObserve?.(name, ms);\n'],
  ['tickMs: 0, snapshotBatchMs: 0, neutralizations: 0, recoveries: 0 };\n', 'tickMs: 0, snapshotBatchMs: 0, neutralizations: 0, recoveries: 0 };\n  (globalThis as any).__crabLoadHost?.({ metrics, allSlots, connections, actors, waiting });\n'],
];
const instrument = { name: 'load-host-hooks', setup(b) {
  b.onLoad({ filter: /server[\\/]world[\\/]host\.ts$/ }, async args => {
    if (args.path !== hostPath) return undefined;
    let text = await readFile(args.path, 'utf8');
    for (const [from, to] of edits) { if (text.split(from).length !== 2) throw new Error(`host.ts hook anchor not unique: ${from.trim()}`); text = text.replace(from, to); }
    return { contents: text, loader: 'ts' };
  });
} };
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('tools/load-world-actual-entry.mjs', root))], outfile: resolve(out, 'load-main.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['pg-native', 'bufferutil', 'utf-8-validate'], plugins: [instrument],
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" }, logLevel: 'warning' });
await cp(new URL('server-dist/migrations/', root), resolve(out, 'migrations'), { recursive: true });
await cp(new URL('server-dist/world/', root), resolve(out, 'world'), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('tools/load-world-actual-vm.mjs', root))], outfile: resolve(out, 'launch.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['pg-native'], banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" }, logLevel: 'warning' });
console.log(`built ${resolve(out, 'load-main.mjs')}`);
