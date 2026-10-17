// Feasibility spike for a server-authoritative world (docs/server-world.md).
// Bundles server/sim/spike/main.ts (the game's own Player, Enemy, Combat, Boss code) for Node and
// runs each configuration in its own process, so heap numbers start clean.
//   node tools/sim-spike.mjs                 # the matrix in the doc (about 5 minutes)
//   node tools/sim-spike.mjs --quick         # 10 s per configuration
//   node tools/sim-spike.mjs --players 100 --scenario boss
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';

const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { esbuild = require(require.resolve('esbuild', { paths: [require.resolve('wrangler')] })); }
mkdirSync('tmp/sim-spike', { recursive: true });
esbuild.buildSync({ entryPoints: ['server/sim/spike/main.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: 'tmp/sim-spike/main.js', logLevel: 'warning' });

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const quick = argv.includes('--quick');
const seconds = opt('seconds') ?? (quick ? '10' : '60');
const pass = ['hz', 'send', 'mobs', 'radii', 'respawn', 'warmup'].flatMap((k) => (opt(k) ? [`--${k}`, opt(k)] : []));
const playerList = (opt('players') ?? '1,25,50,100').split(',');
const scenarios = (opt('scenario') ?? 'normal,dense,spread,boss').split(',');

const rows = [];
for (const scenario of scenarios) {
  for (const players of playerList) {
    const r = spawnSync(process.execPath, ['--expose-gc', 'tmp/sim-spike/main.js', '--players', players, '--scenario', scenario, '--seconds', seconds, ...pass], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
    const row = JSON.parse(r.stdout.trim().split('\n').pop());
    rows.push(row);
    const b = row.bytesPerClientPerSnapshot;
    console.log(
      `${scenario.padEnd(6)} players=${String(players).padStart(3)} enemies=${String(row.enemies).padStart(3)} (alive ${row.aliveEnemiesMean.toFixed(0)})` +
        ` tick cpu mean=${row.tickCpuMs.mean.toFixed(3)}ms p99=${row.tickCpuMs.p99.toFixed(3)}ms max=${row.tickCpuMs.max.toFixed(2)}ms (${row.tickCpuBudgetPct.toFixed(1)}% of ${(1000 / row.hz).toFixed(0)}ms) wall p99=${row.tickMs.p99.toFixed(2)}ms` +
        ` encode cpu=${row.encodeAllClientsCpuMs.mean.toFixed(3)}ms heap=${(row.memory.end.heapMB - row.memory.start.heapMB).toFixed(1)}MB+ab${(row.memory.end.arrayBuffersMB - row.memory.start.arrayBuffersMB).toFixed(1)}MB rss=${row.memory.end.rssMB.toFixed(0)}MB` +
        ` | today=${(b.todayPerClientPerSecond / 1024).toFixed(1)}KB/s fullBin=${b.fullBinaryDelta.mean.toFixed(0)}B aoiJson60=${b.aoiJson[60]?.mean.toFixed(0)}B aoiBin60=${b.aoiBinaryDelta[60]?.mean.toFixed(0)}B (p95 ${b.aoiBinaryDelta[60]?.p95.toFixed(0)})` +
        ` | kills=${row.sim.kills} deaths=${row.sim.playerDeaths} actions=${row.sim.actions} mechs=${row.sim.mechs}`,
    );
  }
}
const out = { machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version, platform: process.platform }, at: new Date().toISOString(), rows };
writeFileSync('tmp/sim-spike/results.json', JSON.stringify(out, null, 1));
console.log('wrote tmp/sim-spike/results.json');
