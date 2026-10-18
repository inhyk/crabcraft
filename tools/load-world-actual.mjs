#!/usr/bin/env node
/** Bots for the REAL world host (server/node/main.ts with WORLD_ENABLED=1), started by tools/load-world-actual-vm.mjs.
 * Each bot has its own seeded account (via the entry's /seed), creates its character with POST /api/account/world-characters,
 * takes a one-use ticket, authenticates on /world, and sends 30 Hz input like src/multiplayer/worldClient.ts:
 * run to an enemy, face it, target it and use class abilities. A receive gap sends the client's resync control.
 * Each bot sends its own X-Forwarded-For (host runs with TRUST_PROXY=1) so per-IP rate limits apply per player.
 * Bots are spread over --per-worker sized child processes so decoding does not stall one event loop.
 * Usage: node tools/load-world-actual.mjs --origin http://127.0.0.1:P --stats http://127.0.0.1:S --bots 100 --seconds 120
 *   --health http://127.0.0.1:18080/healthz,http://127.0.0.1:18081/healthz --label r1 --out result.json */
import { fork } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { GameplayReceiver, encodeControl } from '../server/world/gameplay/protocol.ts';
import { encodeInput } from '../server/world/gameplay/intents.ts';

const delay = ms => new Promise(r => setTimeout(r, ms));
const quantile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : 0; };
const CLASSES = ['warrior', 'mage', 'priest'], RACES = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'];
const ENEMY = new Set(['scrapling', 'scavenger', 'jellyfish']);
const HOMES = [[113, -8], [114, 8], [109, 44], [114, 62], [119, 80], [111, -24], [108, -54], [114, -74]];
const PLAN = { warrior: { range: 2.0, slots: [1, 2, 4, 1, 3] }, mage: { range: 16, slots: [1, 2, 1, 4] }, priest: { range: 16, slots: [1, 4, 1, 3, 2] } };

// ---------------------------------------------------------------- worker: owns a slice of bots
async function worker() {
  let bots = [], timer, opts, stopping = false;
  const count = (map, key) => { map[key] = (map[key] ?? 0) + 1; };
  const fresh = () => ({ bytes: 0, snapshots: 0, results: {}, failedCodes: {}, simErrors: {}, controlErrors: {}, damage: 0, kills: 0, deaths: 0, closes: 0, sent: 0, resyncs: 0, abilities: 0, reconnects: 0 });
  const headers = (bot, extra = {}) => ({ Origin: opts.origin, 'X-Crabcraft-Account': '1', Cookie: bot.account.cookie, 'X-Forwarded-For': bot.ip, ...extra });
  function events(bot, list, results) {
    const m = bot.m;
    for (const r of results ?? []) { count(m.results, r.status); if (r.status === 'failed') count(m.failedCodes, r.code); }
    for (const { event: e } of list ?? []) {
      if (!bot.selfId) continue;
      if (e.type === 'damage' && e.src?.id === bot.selfId) m.damage++;
      else if (e.type === 'death' && e.unit.id === bot.selfId) m.deaths++;
      else if (e.type === 'death' && e.killer?.id === bot.selfId) m.kills++;
      else if (e.type === 'error' && e.unit.id === bot.selfId) count(m.simErrors, e.reason);
    }
  }
  function resync(bot, reason) {
    bot.recovering = true; bot.m.resyncs++;
    const header = { ...bot.binding, sequence: ++bot.controlSequence, tick: 0, acceptedInput: 0, consumedInput: 0 };
    try { for (const bytes of encodeControl(header, { type: 'resync', lastSequence: bot.receiver?.header?.sequence ?? 0, reason })) bot.ws.send(bytes); } catch (e) { count(bot.m.controlErrors, 'resync-send'); }
  }
  async function setup(bot) {
    const appearance = { race: bot.race, sex: bot.i % 2 ? 'male' : 'female', classId: bot.classId, shell: bot.i % 4, crest: bot.i % 4, led: bot.i % 3, name: `Load ${opts.label} ${bot.i}` };
    const r = await fetch(opts.origin + '/api/account/world-characters', { method: 'POST', headers: headers(bot, { 'Content-Type': 'application/json' }), body: JSON.stringify({ appearance }) });
    if (r.status !== 201) throw new Error(`character ${bot.i}: ${r.status} ${await r.text()}`);
    bot.characterId = (await r.json()).character.characterId;
    await connectOnce(bot);
  }
  // A close (e.g. the host's 1008 invalid-input after a respawn rebinding races an in-flight input) reconnects with a new ticket,
  // as a player's client would; reconnects are counted.
  async function connectOnce(bot) {
    bot.receiver = null; bot.binding = null; bot.view = null; bot.recovering = false; bot.targetId = null;
    const tr = await fetch(opts.origin + '/api/account/world-ticket', { method: 'POST', headers: headers(bot) });
    if (tr.status !== 200) throw new Error(`ticket ${bot.i}: ${tr.status} ${await tr.text()}`);
    const { ticket } = await tr.json();
    const ws = new WebSocket(opts.origin.replace('http:', 'ws:') + '/world', { headers: { Origin: opts.origin, 'X-Forwarded-For': bot.ip }, perMessageDeflate: false });
    bot.ws = ws;
    ws.on('message', (bytes, binary) => {
      bot.m.bytes += bytes.byteLength;
      try {
        if (binary) {
          if (!bot.receiver) return;
          const u = bot.receiver.accept(bytes, performance.now() / 1000);
          if (!u) return;
          if (u.kind === 'snapshot') { bot.view = u.state; bot.selfId = u.state.selfRef?.id ?? bot.selfId; bot.m.snapshots++; bot.recovering = false; events(bot, u.events, u.results); }
          else if (u.kind === 'events') events(bot, u.events, u.results);
          else if (u.kind === 'control' && u.control?.type === 'error') count(bot.m.controlErrors, u.control.code);
        } else {
          const v = JSON.parse(bytes.toString());
          if (v.type === 'world-bound') { const { type, ...binding } = v; bot.binding = binding; bot.receiver = new GameplayReceiver(binding, opts.catalog); }
          else if (v.type === 'error') count(bot.m.controlErrors, v.code ?? 'error');
        }
      } catch (e) { count(bot.m.controlErrors, 'receive:' + String(e.message).replace(/^gameplay-v\d+: /, '').slice(0, 50)); if (!bot.recovering) resync(bot, 'gap'); }
    });
    ws.on('close', (code, reason) => { bot.m.closes++; bot.closeCode = code; count(bot.m.controlErrors, `close:${code}:${String(reason).slice(0, 40)}`);
      if (!stopping && bot.ws === ws) setTimeout(() => { bot.m.reconnects++; connectOnce(bot).catch(e => count(bot.m.controlErrors, 'reconnect:' + e.message.slice(0, 50))); }, 300); });
    ws.on('error', e => count(bot.m.controlErrors, 'ws:' + e.message.slice(0, 40)));
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    ws.send(JSON.stringify({ type: 'authenticate', ticket, characterId: bot.characterId, ...(opts.catalog.wireSchemaRevision === undefined ? {} : { schemaRevision: opts.catalog.wireSchemaRevision }) }));
    const end = Date.now() + 20000;
    while (!bot.view) { if (Date.now() > end || ws.readyState !== WebSocket.OPEN) throw new Error(`bot ${bot.i} not admitted: ${JSON.stringify(bot.m.controlErrors)} close=${bot.closeCode}`); await delay(20); }
  }
  function act(bot, now) {
    if (!bot.view || !bot.binding || bot.recovering || bot.ws.readyState !== WebSocket.OPEN) return;
    const actors = bot.view.actors, self = actors.find(a => a.ref.id === bot.selfId);
    const intent = { seq: bot.seq + 1, forward: 0, strafe: 0, turn: 0, sprint: false, steeringYaw: null, heldChannel: null, commands: [] };
    if (self && self.alive) {
      let best = null, bestD = Infinity;
      for (const a of actors) { if (!ENEMY.has(a.kind) || !a.alive || a.hidden || !a.targetable) continue; const d = Math.hypot(a.x - self.x, a.z - self.z); if (d < bestD) { best = a; bestD = d; } }
      const goal = best ?? { x: bot.home[0], z: bot.home[1] }, d = best ? bestD : Math.hypot(goal.x - self.x, goal.z - self.z);
      intent.steeringYaw = Math.atan2(goal.x - self.x, goal.z - self.z);
      if (!best || d > bot.plan.range) { intent.forward = 1; intent.sprint = d > 12; if (!best && d < 4) bot.home = HOMES[(bot.i + bot.seq) % HOMES.length].map(v => v + (Math.random() - .5) * 10); }
      if (best && d < bot.plan.range + 10) {
        if (bot.targetId !== best.ref.id) { intent.commands.push({ kind: 'target', target: best.ref }); bot.targetId = best.ref.id; }
        if (d <= bot.plan.range + .5 && now - bot.lastAbility > 700) { intent.commands.push({ kind: 'ability', slot: bot.plan.slots[bot.slotCursor++ % bot.plan.slots.length] }); bot.lastAbility = now; bot.m.abilities++; }
      }
      if (bot.i % 5 === 0 && bot.seq % 90 < 10) intent.strafe = bot.i % 2 ? 1 : -1; // a few side steps
    }
    try { bot.ws.send(encodeInput({ binding: bot.binding, intent }, opts.catalog)); bot.seq = intent.seq; bot.m.sent++; } catch (e) { count(bot.m.controlErrors, 'encode:' + e.message.slice(0, 40)); }
  }
  process.on('message', async msg => {
    try {
      if (msg.type === 'init') {
        opts = msg;
        bots = msg.accounts.map(({ index: i, account }) => ({ i, account, classId: CLASSES[i % 3], race: RACES[i % RACES.length], ip: `10.${msg.ipBlock}.${Math.floor(i / 200)}.${(i % 200) + 1}`,
          plan: PLAN[CLASSES[i % 3]], seq: 0, controlSequence: 0, slotCursor: 0, lastAbility: 0, targetId: null, recovering: false, home: HOMES[i % HOMES.length].map(v => v + (Math.random() - .5) * 10), m: fresh() }));
        for (const bot of bots) await setup(bot);
        timer = setInterval(() => { const now = Date.now(); for (const b of bots) act(b, now); }, 1000 / 30);
        process.send({ type: 'ready', admitted: bots.filter(b => b.view).length });
      } else if (msg.type === 'measure') { for (const b of bots) b.m = fresh(); process.send({ type: 'measuring' }); }
      else if (msg.type === 'collect') { process.send({ type: 'collected', bots: bots.map(b => ({ i: b.i, classId: b.classId, open: b.ws?.readyState === WebSocket.OPEN, ...b.m })) }); }
      else if (msg.type === 'stop') {
        clearInterval(timer); stopping = true;
        await Promise.all(bots.map(b => new Promise(r => { if (!b.ws || b.ws.readyState === WebSocket.CLOSED) return r(); const t = setTimeout(() => { b.ws.terminate(); r(); }, 2000); b.ws.once('close', () => { clearTimeout(t); r(); }); b.ws.close(1000, 'load complete'); })));
        process.send({ type: 'stopped' }); process.exit(0);
      }
    } catch (e) { process.send({ type: 'failed', error: e.message }); }
  });
}

// ---------------------------------------------------------------- main: seeding, timing, host stats, aggregation
async function main() {
  const args = { origin: '', stats: '', bots: 10, seconds: 30, health: '', label: 'r1', out: '', warmup: 25, 'per-worker': 10 };
  for (let i = 2; i < process.argv.length; i += 2) { const k = process.argv[i].replace(/^--/, ''); if (!(k in args)) throw new Error(`unknown ${k}`); args[k] = typeof args[k] === 'number' ? Number(process.argv[i + 1]) : process.argv[i + 1]; }
  if (!args.origin || !args.stats || !(args.bots >= 1 && args.bots <= 100) || !(args.seconds >= 5 && args.seconds <= 120)) throw new Error('bad arguments');
  const healthURLs = args.health ? args.health.split(',') : [];
  const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
  const health = async () => { const out = []; for (const url of healthURLs) { try { out.push((await fetch(url, { signal: AbortSignal.timeout(3000) })).status); } catch { out.push(0); } } return out; };
  const getStats = async () => (await fetch(args.stats + '/stats')).json();
  const result = { args, startedAt: new Date().toISOString(), health: [], stats: [], aborted: null };
  const workers = []; let abort = null;
  const ask = (w, msg, reply, ms = 120000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`worker ${reply} timeout`)), ms);
    const on = m => { if (m.type === reply) { clearTimeout(t); w.off('message', on); res(m); } else if (m.type === 'failed') { clearTimeout(t); w.off('message', on); rej(new Error(m.error)); } };
    w.on('message', on); w.send(msg);
  });
  try {
    const h0 = await health(); log('health', h0); if (h0.some(c => c !== 200)) throw new Error(`health ${h0} before run`);
    const seeded = await (await fetch(`${args.stats}/seed?n=${args.bots}&prefix=${args.label.replace(/[^a-z0-9]/g, '')}`, { method: 'POST' })).json();
    if (!Array.isArray(seeded)) throw new Error('seed failed ' + JSON.stringify(seeded));
    const catalog = await (await fetch(args.origin + '/api/account/world-catalog')).json();
    const ipBlock = 77 + (Number(args.label.replace(/\D/g, '')) || 0) % 100;
    for (let start = 0; start < args.bots; start += args['per-worker']) {
      const w = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      workers.push({ w, accounts: seeded.slice(start, start + args['per-worker']).map((account, k) => ({ index: start + k, account })) });
    }
    const ready = await Promise.all(workers.map(({ w, accounts }) => ask(w, { type: 'init', origin: args.origin, label: args.label, catalog, accounts, ipBlock }, 'ready')));
    log('admitted', ready.reduce((n, r) => n + r.admitted, 0), 'of', args.bots, 'in', workers.length, 'workers');
    const warmEnd = Date.now() + args.warmup * 1000;
    while (Date.now() < warmEnd) { const h = await health(); if (h.some(s => s !== 200)) { abort = `health ${h} during warm-up`; break; } await delay(1000); }
    if (!abort) {
      await Promise.all(workers.map(({ w }) => ask(w, { type: 'measure' }, 'measuring')));
      await fetch(args.stats + '/reset', { method: 'POST' });
      const start = Date.now(), end = start + args.seconds * 1000;
      log('measuring', args.seconds, 's');
      while (Date.now() < end) {
        const h = await health(), s = await getStats(), t = (Date.now() - start) / 1000;
        result.health.push({ t, codes: h }); result.stats.push({ t, loadavg: s.proc.loadavg, rssKb: s.proc.rssKb, utime: s.proc.utimeTicks, stime: s.proc.stimeTicks, connections: s.counters?.connections, tickP99: s.tick.p99 });
        if (h.some(c => c !== 200)) { abort = `health ${h} at ${t}s`; log('ABORT', abort); break; }
        if (result.stats.length % 15 === 0) log('t', t.toFixed(0), 'tick p50', s.tick.p50.toFixed(2), 'p99', s.tick.p99.toFixed(2), 'max', s.tick.max.toFixed(2), 'load', s.proc.loadavg, 'conn', s.counters?.connections);
        await delay(1000 - ((Date.now() - start) % 1000));
      }
      const final = await getStats(), seconds = (Date.now() - start) / 1000;
      const per = (await Promise.all(workers.map(({ w }) => ask(w, { type: 'collect' }, 'collected')))).flatMap(r => r.bots);
      result.final = final; result.measuredSeconds = seconds; result.perBot = per;
      const cpuTicks = final.proc.utimeTicks - final.procStart.utimeTicks + final.proc.stimeTicks - final.procStart.stimeTicks;
      const bps = per.map(b => b.bytes / seconds), hz = per.map(b => b.snapshots / seconds), sum = k => per.reduce((n, b) => n + b[k], 0);
      const merge = k => per.reduce((o, b) => { for (const [c, v] of Object.entries(b[k])) o[c] = (o[c] ?? 0) + v; return o; }, {});
      const loads = result.stats.map(s => Number(String(s.loadavg).split(' ')[0])).filter(Number.isFinite);
      result.summary = { bots: args.bots, openAtEnd: per.filter(b => b.open).length, measuredSeconds: seconds, aborted: abort,
        tickMs: final.tick, snapshotBatchMs: final.snapshotBatch, eventLoopDelayMs: final.eventLoopDelayMs,
        hostCounters: final.counters,
        hostCpuPctOneCore: cpuTicks / final.clockTicksPerSecond / seconds * 100, hostCpuPctVm2: cpuTicks / final.clockTicksPerSecond / seconds * 50,
        vmCpuBusyPct: final.proc.vmTotalTicks ? (final.proc.vmBusyTicks - final.procStart.vmBusyTicks) / (final.proc.vmTotalTicks - final.procStart.vmTotalTicks) * 100 : null,
        vmStealPct: final.proc.vmTotalTicks ? (final.proc.vmStealTicks - final.procStart.vmStealTicks) / (final.proc.vmTotalTicks - final.procStart.vmTotalTicks) * 100 : null,
        rssMbStart: final.procStart.rssKb / 1024, rssMbEnd: final.proc.rssKb / 1024, rssMbMax: Math.max(...result.stats.map(s => s.rssKb)) / 1024,
        loadavg1Max: loads.length ? Math.max(...loads) : null, loadavgStart: final.procStart.loadavg, loadavgEnd: final.proc.loadavg,
        perBotBytesPerSec: { mean: bps.reduce((a, b) => a + b, 0) / per.length, p95: quantile(bps, .95), min: Math.min(...bps), max: Math.max(...bps) },
        snapshotHz: { mean: hz.reduce((a, b) => a + b, 0) / per.length, min: Math.min(...hz), p5: quantile(hz, .05) },
        inputsPerBotPerSec: sum('sent') / per.length / seconds, abilityPresses: sum('abilities'),
        commandResults: merge('results'), failedCodes: merge('failedCodes'), simErrorReasons: merge('simErrors'), controlErrorCodes: merge('controlErrors'),
        damageEventsByBots: sum('damage'), kills: sum('kills'), deaths: sum('deaths'), resyncs: sum('resyncs'), closes: sum('closes'), reconnects: sum('reconnects'),
        healthCodes: [...new Set(result.health.map(h => h.codes.join('/')))], healthSamples: result.health.length,
        byClass: Object.fromEntries(CLASSES.map(c => { const g = per.filter(b => b.classId === c); return [c, { bots: g.length, kills: g.reduce((n, b) => n + b.kills, 0), deaths: g.reduce((n, b) => n + b.deaths, 0), damageEvents: g.reduce((n, b) => n + b.damage, 0) }]; })) };
      log('SUMMARY', JSON.stringify(result.summary, null, 1));
    }
  } catch (e) { result.aborted = abort ?? e.message; log('FAILED', e.message); }
  finally {
    result.aborted ??= abort;
    await Promise.all(workers.map(({ w }) => ask(w, { type: 'stop' }, 'stopped', 10000).catch(() => w.kill('SIGKILL'))));
    if (args.out) await writeFile(args.out, JSON.stringify(result, null, 1));
    log('done', result.aborted ?? 'ok');
  }
}
if (process.argv[2] === '--worker') await worker(); else await main();
