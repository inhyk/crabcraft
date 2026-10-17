// Feasibility spike (docs/server-world.md): run one configuration and print one JSON line.
// Built and driven by tools/sim-spike.mjs:
//   node --expose-gc tmp/sim-spike/main.js --players 100 --scenario normal --hz 20 --send 10 --seconds 60
import { Enemy, ENEMY_STATS } from '../../../src/game/enemies';
import { SimGame, type Scenario } from './sim';
import { ClientView, entityJson, netEntity, type NetEntity } from './snapshot';
import { createHeadlessWorld } from './world';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const players = Number(arg('players', '25'));
const scenario = arg('scenario', 'normal') as Scenario;
const hz = Number(arg('hz', '20'));
const sendHz = Number(arg('send', '10'));
const seconds = Number(arg('seconds', '60'));
const warmup = Number(arg('warmup', '5'));
const mobsPerPlayer = Number(arg('mobs', '1'));
const radii = arg('radii', '40,60,80').split(',').map(Number);
/** 'timed' respawns a dead enemy on its timer; 'unseen' keeps the game's rule (no player within 22 m, off camera). */
const respawn = arg('respawn', 'timed');
/** Player level: level 5 can fight Corrodius (level 3); a lower level keeps ordinary fights longer. */
const level = Number(arg('level', scenario === 'boss' ? '5' : '3'));
/**
 * Enemy respawn seconds (the game uses 30 to 45 s in World I, 12 s in World II). A crowded area
 * empties at the game's timers, so 'dense' respawns in 6 s to keep every enemy fighting.
 */
const respawnSec = Number(arg('respawnSec', scenario === 'dense' || scenario === 'spread' ? '6' : '0'));

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const heap = () => {
  gc();
  gc();
  const m = process.memoryUsage();
  // Terrain heights and the collision grid are typed arrays: arrayBuffers, outside heapUsed.
  return { heapMB: m.heapUsed / 1048576, arrayBuffersMB: m.arrayBuffers / 1048576, rssMB: m.rss / 1048576 };
};
const stats = (xs: number[]) => {
  if (!xs.length) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] };
};

if (respawnSec > 0) for (const k of Object.keys(ENEMY_STATS) as (keyof typeof ENEMY_STATS)[]) ENEMY_STATS[k].respawn = respawnSec;
if (respawn === 'timed') (Enemy.prototype as unknown as { canRespawnUnseen: () => boolean }).canRespawnUnseen = () => true;

const m0 = heap();
const { world, buildMs } = createHeadlessWorld();
const m1 = heap();
const t0 = performance.now();
const sim = new SimGame(world, scenario);
sim.setup(players, mobsPerPlayer, level);
const setupMs = performance.now() - t0;
const m2 = heap();

// Today's world checkpoint also carries the NPCs, townsfolk, the four bosses and their freed crabs.
const town: NetEntity[] = Array.from({ length: 15 + 8 }, (_, i) => ({
  id: 10000 + i, unit: null, x: (i % 5) * 6 - 12, y: 4, z: Math.floor(i / 5) * 6 - 12, yaw: 0, hp: 100, maxHp: 100, level: 1,
  alive: true, hidden: i >= 15, invulnerable: false, targetable: true, stunUntil: 0, slowUntil: 0, slowPct: 0, rust: 0, rustUntil: 0,
}));
const bossStates = ['b3', 'b10', 'b20', 'b30'].map((id) => ({ id, state: 'dormant', phase: 1, enraged: false, mech: null }));
const views = sim.clients.map(() => radii.map(() => new ClientView()));
const sendEvery = Math.max(1, Math.round(hz / sendHz));
const dt = 1 / hz;
const total = Math.round((warmup + seconds) * hz);
const warmTicks = Math.round(warmup * hz);
const tickMs: number[] = [];
/** CPU time of this thread per tick: wall time is inflated whenever the machine is busy. */
const tickCpuMs: number[] = [];
const encodeCpuMs: number[] = [];
const cpu = (): number => {
  const u = (process as unknown as { threadCpuUsage?: () => NodeJS.CpuUsage }).threadCpuUsage?.() ?? process.cpuUsage();
  return (u.user + u.system) / 1000;
};
let processCpu0 = process.cpuUsage();
const encodeMs: number[] = [];
const bin: number[][] = radii.map(() => []);
const aoiJson: number[][] = radii.map(() => []);
const aoiCount: number[][] = radii.map(() => []);
const todayWorld: number[] = [];
const todayState: number[] = [];
const fullBin: number[] = [];
let aliveEnemies = 0;
let aliveSamples = 0;
const fullView = sim.clients.map(() => new ClientView());

for (let tick = 0; tick < total; tick++) {
  if (tick === warmTicks) processCpu0 = process.cpuUsage();
  const ca = cpu();
  const a = performance.now();
  sim.tick(dt);
  const b = performance.now();
  const cb = cpu();
  const measuring = tick >= warmTicks;
  if (measuring) {
    tickMs.push(b - a);
    tickCpuMs.push(cb - ca);
  }
  if (tick % sendEvery) continue;
  const now = sim.time;
  const entities: NetEntity[] = sim.units.map((u, i) => netEntity(i, u));
  const selfIds = sim.clients.map((c) => sim.units.indexOf(c.unit));
  // Binary AOI deltas for every client at every radius; the 60 m one is timed as the production candidate.
  for (let r = 0; r < radii.length; r++) {
    const e0 = performance.now();
    const ec = cpu();
    for (let ci = 0; ci < sim.clients.length; ci++) {
      const u = sim.clients[ci].unit;
      const bytes = views[ci][r].encode(tick, hz, u.pos.x, u.pos.z, radii[r], entities, selfIds[ci]);
      if (measuring) bin[r].push(bytes);
    }
    if (measuring && radii[r] === 60) {
      encodeMs.push(performance.now() - e0);
      encodeCpuMs.push(cpu() - ec);
    }
  }
  for (let ci = 0; ci < sim.clients.length; ci++) {
    const bytes = fullView[ci].encode(tick, hz, 0, 0, 1e6, [...entities, ...town], selfIds[ci]);
    if (measuring) fullBin.push(bytes);
  }
  if (!measuring) continue;
  aliveEnemies += sim.enemies.filter((e) => e.unit.alive && !e.isAdd).length;
  aliveSamples++;
  // Today: the host's checkpoint (every entity but the players) to everyone, and each player's own state.
  // JSON sizes are sampled every 2 s: their garbage would otherwise land in the timed ticks.
  if (tick % Math.round(hz * 2) === 0) {
    const npcs = sim.units.filter((u) => u.kind !== 'player');
    const world = {
      type: 'world',
      world: {
        weather: { mood: 1, beacon: true, clock: now },
        entities: [...npcs.map((u, i) => entityJson(netEntity(i, u), now, `e${i}`)), ...town.map((e, i) => entityJson(e, now, `n${i}`))],
        bosses: bossStates, rust: false, abyss: false, chapter: 1, finalCleared: false, firstEnding: false, trueCleared: false,
        social: { mode: 'coop', parties: {} },
      },
    };
    todayWorld.push(Buffer.byteLength(JSON.stringify(world)));
    for (const c of sim.clients) {
      const u = c.unit;
      todayState.push(Buffer.byteLength(JSON.stringify({ type: 'state', id: '00000000-0000-4000-8000-000000000000', state: { x: u.pos.x, y: u.pos.y, z: u.pos.z, yaw: u.yaw, hp: u.hp, maxHp: u.maxHp, alive: u.alive, level: u.level } })));
    }
    for (let r = 0; r < radii.length; r++) {
      for (const c of sim.clients) {
        const cx = c.unit.pos.x;
        const cz = c.unit.pos.z;
        const near = entities.filter((e) => e.unit === c.unit || (!e.hidden && (e.x - cx) ** 2 + (e.z - cz) ** 2 <= radii[r] ** 2));
        aoiCount[r].push(near.length);
        aoiJson[r].push(Buffer.byteLength(JSON.stringify({ type: 'snap', tick, e: near.map((e) => entityJson(e, now, `e${e.id}`)) })));
      }
    }
  }
}
const processCpu = process.cpuUsage(processCpu0);
const m3 = heap();

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const others = Math.max(0, players - 1);
console.log(
  JSON.stringify({
    players,
    scenario,
    hz,
    sendHz,
    seconds,
    respawn,
    level,
    respawnSec: respawnSec || 'game',
    enemies: sim.enemies.filter((e) => !e.isAdd).length,
    units: sim.units.length,
    aliveEnemiesMean: aliveSamples ? aliveEnemies / aliveSamples : 0,
    worldBuildMs: buildMs,
    setupMs,
    tickMs: stats(tickMs),
    tickBudgetPct: (mean(tickMs) / (1000 / hz)) * 100,
    tickCpuMs: stats(tickCpuMs),
    tickCpuBudgetPct: (mean(tickCpuMs) / (1000 / hz)) * 100,
    encodeAllClientsMs: stats(encodeMs),
    encodeAllClientsCpuMs: stats(encodeCpuMs),
    /** Whole process (all threads, GC included) over the measured window, as a share of one core. */
    processCpuPctOfCore: ((processCpu.user + processCpu.system) / 1000 / (seconds * 1000)) * 100 * (1 / 1),
    wallSeconds: tickMs.reduce((x, y) => x + y, 0) / 1000,
    memory: { start: m0, world: m1, setup: m2, end: m3 },
    bytesPerClientPerSnapshot: {
      todayWorldJson: mean(todayWorld),
      todayStateJsonEach: mean(todayState),
      todayPerClientPerSecond: mean(todayWorld) * 10 + mean(todayState) * others * 20,
      fullBinaryDelta: stats(fullBin),
      aoiJson: Object.fromEntries(radii.map((r, i) => [r, stats(aoiJson[i])])),
      aoiEntities: Object.fromEntries(radii.map((r, i) => [r, stats(aoiCount[i])])),
      aoiBinaryDelta: Object.fromEntries(radii.map((r, i) => [r, stats(bin[i])])),
    },
    sim: sim.stats,
  }),
);
