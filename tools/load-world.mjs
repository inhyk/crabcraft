#!/usr/bin/env node
/** Real ws clients and fixture live in separate OS processes. No production endpoints. */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { SnapshotReceiver } from '../server/world/protocol.ts';
import { EventReceiver } from '../server/world/events.ts';
import { encodeIntent } from '../server/world/intents.ts';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function exitWithin(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(undefined), ms); })]); }
  finally { clearTimeout(timer); }
}
function onceMessage(child, type, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); };
    const message = value => { if (value?.type === type) { cleanup(); resolve(value); } };
    const exit = (code, signal) => { cleanup(); reject(new Error(`fixture exited before ${type}: ${code}/${signal}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`fixture ${type} timeout`)); }, timeout);
    child.on('message', message); child.on('exit', exit);
  });
}
export async function runLoad({ clients = 100, seconds = 10, idleSeconds = 1, warmupSeconds = 1 } = {}) {
  if (!Number.isInteger(clients) || clients < 1 || clients > 100) throw new Error('clients must be 1..100');
  for (const n of [seconds, idleSeconds, warmupSeconds]) if (!Number.isFinite(n) || n < 0 || n > 300) throw new Error('invalid duration');
  if (seconds < 1 || idleSeconds < .3) throw new Error('seconds >=1 and idleSeconds >=0.3 required');
  const child = fork(fileURLToPath(new URL('../server/world/fixture-main.mjs', import.meta.url)), [], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let exitResult; let stopRequested = false;
  const childExit = new Promise(resolve => child.once('exit', (code, signal) => { exitResult = { code, signal }; resolve(exitResult); }));
  const sendChild = message => new Promise((resolve, reject) => child.send(message, error => error ? reject(error) : resolve()));
  let diagnostics = ''; child.stdout.on('data', data => { diagnostics = (diagnostics + data).slice(-4096); }); child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4096); });
  const bots = []; let interval; let watchdog; let failure; let finalStats; let closing = false;
  let invalidPackets = 0; let staleOrMissingStreams = 0; let bytesReceived = 0; let bytesSent = 0;
  child.on('error', error => { failure ??= error; });
  const fail = error => { invalidPackets++; failure ??= error; };
  const getStats = async () => { const response = onceMessage(child, 'stats'); await sendChild({ type: 'stats' }); return (await response).stats; };
  const closeBots = async () => {
    closing = true;
    await Promise.all(bots.map(bot => new Promise(resolve => {
      if (bot.socket.readyState === WebSocket.CLOSED) return resolve();
      const timer = setTimeout(() => { bot.socket.terminate(); resolve(); }, 1000);
      bot.socket.once('close', () => { clearTimeout(timer); resolve(); }); bot.socket.close(1000, 'load complete');
    })));
  };
  try {
    const { url } = await onceMessage(child, 'ready');
    await Promise.all(Array.from({ length: clients }, (_, index) => new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { perMessageDeflate: false, maxPayload: 131072 });
      const bot = { socket, receiver: new SnapshotReceiver(), eventReceiver: new EventReceiver(), sent: 0, snapshots: 0, events: 0, actions: 0, lastEvent: 0, lastAction: 0, ackAdvances: 0, lastAck: 0, lastSnapshot: performance.now(), firstSnapshot: 0, index, initialized: false, previousSelf: undefined };
      bots.push(bot);
      const timer = setTimeout(() => reject(new Error('first snapshot timeout')), 10000);
      socket.on('message', (data, binary) => {
        try {
          if (!binary) throw new Error('non-binary fixture packet');
          bytesReceived += data.byteLength;
          if (data[3] === 3) {
            const packet = bot.eventReceiver.apply(data); bot.events += packet.events.length;
            const actions = packet.events.filter(event => event.kind === 'action').length; bot.actions += actions;
            if (packet.events.length) bot.lastEvent = performance.now(); if (actions) bot.lastAction = performance.now();
          } else {
            bot.receiver.apply(data); const now = performance.now(); const self = bot.receiver.state.get(bot.receiver.selfId);
            if (!self || bot.receiver.state.size > clients || bot.receiver.ack > bot.sent) throw new Error('invalid self/state/ack');
            for (const entity of bot.receiver.state.values()) if (entity.hp !== 100 || entity.maxHp !== 100 || entity.y !== 0 || Math.abs(entity.x) > 7200 || Math.abs(entity.z) > 7200) throw new Error('synthetic invariant failed');
            if (bot.receiver.ack > bot.lastAck) { bot.ackAdvances++; bot.lastAck = bot.receiver.ack; }
            if (bot.previousSelf && bot.receiver.tick === bot.previousSelf.tick && (self.x !== bot.previousSelf.x || self.z !== bot.previousSelf.z)) throw new Error('position changed without tick');
            bot.previousSelf = { x: self.x, z: self.z, tick: bot.receiver.tick };
            bot.snapshots++; bot.lastSnapshot = now; bot.firstSnapshot ||= now;
            if (!bot.initialized) { bot.initialized = true; clearTimeout(timer); resolve(); }
          }
        } catch (error) { fail(error); clearTimeout(timer); reject(error); }
      });
      socket.on('error', error => { clearTimeout(timer); fail(error); reject(error); });
      socket.on('close', () => { clearTimeout(timer); if (!closing) { const error = new Error('unexpected bot disconnect'); fail(error); reject(error); } });
    })));
    const send = (bot, intent) => { const bytes = encodeIntent({ ...intent, sequence: ++bot.sent }); bot.socket.send(bytes); bytesSent += bytes.byteLength; };
    let frame = 0;
    interval = setInterval(() => {
      frame++;
      for (const bot of bots) {
        if (bot.socket.readyState !== WebSocket.OPEN) continue;
        send(bot, { kind: 'move', x: Math.cos(frame / 30 + bot.index), z: Math.sin(frame / 30 + bot.index), yaw: (frame / 30) % (2 * Math.PI), flags: 0 });
        if (frame % 20 === 0) send(bot, { kind: 'action', action: 1, slot: bot.index % 8, target: bot.receiver.selfId });
      }
    }, 50);
    watchdog = setInterval(() => {
      const now = performance.now();
      if (bots.some(bot => now - bot.lastSnapshot > 1000 || (interval && (now - (bot.lastEvent || bot.firstSnapshot) > 1500 || now - (bot.lastAction || bot.firstSnapshot) > 1500)))) { staleOrMissingStreams++; failure ??= new Error('stale or missing snapshot/event stream'); }
    }, 100);
    await delay(warmupSeconds * 1000);
    const before = bots.map(bot => ({ snapshots: bot.snapshots, actions: bot.actions, events: bot.events, ackAdvances: bot.ackAdvances }));
    const serverBefore = await getStats(); const measuredStart = performance.now();
    await delay(seconds * 1000); const measuredMs = performance.now() - measuredStart;
    const perClient = bots.map((bot, i) => ({ id: bot.receiver.selfId, snapshots: bot.snapshots - before[i].snapshots, snapshotHz: (bot.snapshots - before[i].snapshots) * 1000 / measuredMs, actions: bot.actions - before[i].actions, events: bot.events - before[i].events, eventAgeMs: performance.now() - bot.lastEvent, actionAgeMs: performance.now() - bot.lastAction, ackAdvances: bot.ackAdvances - before[i].ackAdvances }));
    for (const c of perClient) if (c.actions < Math.max(1, Math.floor(seconds * .7)) || c.events < Math.max(1, Math.floor(seconds * .7)) || c.eventAgeMs > 1500 || c.actionAgeMs > 1500) throw new Error('insufficient measured action/event delivery or stale event stream');
    const serverAfter = await getStats();
    clearInterval(interval); interval = undefined;
    for (const bot of bots) send(bot, { kind: 'move', x: 0, z: 0, yaw: 0, flags: 0 });
    await delay(idleSeconds * 1000);
    const idlePositions = bots.map(bot => ({ ...bot.receiver.state.get(bot.receiver.selfId) }));
    await delay(150);
    for (const [i, bot] of bots.entries()) {
      const self = bot.receiver.state.get(bot.receiver.selfId);
      if (bot.receiver.ack !== bot.sent || self.x !== idlePositions[i].x || self.z !== idlePositions[i].z) throw new Error('idle/consumed acknowledgment failure');
      if (perClient[i].snapshotHz < 14 || perClient[i].snapshotHz > 26 || perClient[i].ackAdvances < seconds * 10 || bot.actions < 1 || bot.events < 1) throw new Error('insufficient sustained client delivery');
    }
    if (failure) throw failure;
    const measuredCpuMs = serverAfter.serverCpuUserMs + serverAfter.serverCpuSystemMs - serverBefore.serverCpuUserMs - serverBefore.serverCpuSystemMs;
    const stats = await getStats();
    if (stats.activeClients !== clients || stats.peakClients !== clients || stats.invalidPackets || stats.rejectedPackets || stats.appliedIntents === 0 || stats.backpressureDisconnects) throw new Error('fixture counters failed');
    await closeBots(); await delay(80);
    const noClientsBefore = await getStats(); await delay(150); const noClientsAfter = await getStats();
    if (noClientsAfter.activeClients !== 0 || noClientsAfter.tickCount !== noClientsBefore.tickCount || noClientsAfter.snapshotCount !== noClientsBefore.snapshotCount) throw new Error('empty fixture did not idle');
    const final = onceMessage(child, 'final'); stopRequested = true; await sendChild({ type: 'stop' }); finalStats = (await final).stats;
    const exited = await exitWithin(childExit, 2000);
    if (!exited || exited.code !== 0 || exited.signal) throw new Error('fixture did not exit cleanly');
    return { label: 'S4 synthetic loopback networking fixture (not game combat or VM performance)', node: process.version, clients, seconds, measuredMs,
      clientSummary: { minSnapshotHz: Math.min(...perClient.map(c => c.snapshotHz)), maxSnapshotHz: Math.max(...perClient.map(c => c.snapshotHz)), minSnapshots: Math.min(...perClient.map(c => c.snapshots)), minAckAdvances: Math.min(...perClient.map(c => c.ackAdvances)), totalActions: bots.reduce((n, c) => n + c.actions, 0), totalEvents: bots.reduce((n, c) => n + c.events, 0), invalidPackets, staleOrMissingStreams, bytesSent, bytesReceived },
      server: { ...stats, measuredCpuMs, measuredCpuPercent: measuredCpuMs / measuredMs * 100 }, cleanup: { activeClients: finalStats.activeClients, idleTickDelta: noClientsAfter.tickCount - noClientsBefore.tickCount, childStopped: true, childExitCode: exitResult.code, childSignal: exitResult.signal }, perClient };
  } catch (error) { throw new Error(`${error.message}${diagnostics ? `\nfixture diagnostics: ${diagnostics}` : ''}`, { cause: error }); }
  finally {
    if (interval) clearInterval(interval); if (watchdog) clearInterval(watchdog);
    await closeBots();
    if (!stopRequested && child.connected) { stopRequested = true; child.send({ type: 'stop' }, () => {}); }
    if (!exitResult) {
      await exitWithin(childExit, 2000);
      if (!exitResult) { child.kill('SIGKILL'); await childExit; }
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = { '--clients': 'clients', '--seconds': 'seconds', '--idle-seconds': 'idleSeconds', '--warmup-seconds': 'warmupSeconds' }[process.argv[i]];
    if (!key) throw new Error(`unknown option ${process.argv[i]}`); options[key] = Number(process.argv[i + 1]);
  }
  console.log(JSON.stringify(await runLoad(options), null, 2));
}
