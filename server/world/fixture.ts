import { WebSocket, WebSocketServer } from 'ws';
import { performance } from 'node:perf_hooks';
import { AoiGrid } from './aoi.ts';
import { ClientStream, integer, type Entity } from './protocol.ts';
import { IntentSession } from './intents.ts';
import { encodeEvents, type WorldEvent } from './events.ts';
import { DeadlineScheduler } from './scheduler.ts';
export function fixtureEntity(id: number, x = 0, z = 0): Entity {
  return { id, x, y: 0, z, yaw: 0, hp: 100, maxHp: 100, level: 1, flags: 9, stunTick: 0, slowTick: 0, slowPct: 0, rust: 0, rustTick: 0 };
}
export function fixtureSpawn(id: number): Entity {
  integer(id, 1, 0xffffffff, 'id'); const slot = (id - 1) % 100;
  return fixtureEntity(id, (slot % 10) * 8 - 36, Math.floor(slot / 10) * 8 - 36);
}
interface Client { socket: WebSocket; entity: Entity; stream: ClientStream; intents: IntentSession; visible: Set<number>; ack: number; eventSequence: number; appliedMove: number; lastMove: number }
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}
export interface FixtureOptions { host?: string; port?: number; maxClients?: number }
/** Synthetic loopback-only kinematics. No game simulation, authentication or production import. */
export async function startFixture(options: FixtureOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('fixture only binds loopback');
  const maxClients = integer(options.maxClients ?? 100, 1, 100, 'maxClients');
  const port = integer(options.port ?? 0, 0, 65535, 'port');
  const server = new WebSocketServer({ host, port, maxPayload: 64, perMessageDeflate: false });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const started = performance.now(); const cpuStart = process.cpuUsage();
  const tickScheduler = new DeadlineScheduler(30, started, 4); const snapshotScheduler = new DeadlineScheduler(20, started, 1);
  const clients = new Map<number, Client>(); const grid = new AoiGrid();
  const batches: number[] = []; const ticks: number[] = []; const encodes: number[] = []; const remember = (values: number[], value: number) => { if (values.length < 100000) values.push(value); else values[metricCursor++ % values.length] = value; };
  let metricCursor = 0; let nextId = 1; let tick = 0; let snapshots = 0; let eventsSent = 0; let eventPackets = 0; let actionEvents = 0; let sentPackets = 0; let receivedPackets = 0;
  let bytesSent = 0; let bytesReceived = 0; let acceptedIntents = 0; let appliedIntents = 0; let rejectedPackets = 0; let invalidPackets = 0;
  let rejectedClients = 0; let peakClients = 0; let backpressureDisconnects = 0; let closed = false; let idleWakeups = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (client: Client, bytes: Uint8Array) => {
    if (client.socket.readyState !== WebSocket.OPEN) return false;
    if (client.socket.bufferedAmount > 1024 * 1024) { backpressureDisconnects++; client.socket.close(1013, 'fixture backpressure'); return false; }
    client.socket.send(bytes, { binary: true }); bytesSent += bytes.byteLength; sentPackets++; return true;
  };
  const simulate = () => {
    const begin = performance.now(); tick++;
    for (const c of clients.values()) {
      const move = c.intents.movement;
      if (move && begin - c.lastMove <= 250) {
        const length = Math.max(1, Math.hypot(move.x, move.z)); const speed = move.flags & 1 ? 6 : 3;
        c.entity.x = Math.max(-450, Math.min(450, c.entity.x + move.x / length * speed / 30));
        c.entity.z = Math.max(-450, Math.min(450, c.entity.z + move.z / length * speed / 30)); c.entity.yaw = move.yaw;
        if (move.sequence > c.appliedMove) { c.appliedMove = move.sequence; c.ack = Math.max(c.ack, move.sequence); appliedIntents++; }
      }
      const events: WorldEvent[] = [];
      for (const action of c.intents.drainActions()) {
        c.ack = Math.max(c.ack, action.sequence); appliedIntents++;
        if (action.kind === 'action') events.push({ kind: 'action', source: c.entity.id, target: action.target || c.entity.id, code: action.action });
      }
      // An explicit synthetic pulse validates event delivery even while clients stand still.
      if (tick % 30 === 0) events.push({ kind: 'cast', source: c.entity.id, target: c.entity.id, code: 0 });
      if (events.length && send(c, encodeEvents({ epoch: c.stream.epoch, sequence: ++c.eventSequence, tick, events }))) {
        eventsSent += events.length; eventPackets++; actionEvents += events.filter(event => event.kind === 'action').length;
      }
    }
    remember(ticks, performance.now() - begin);
  };
  const snapshot = () => {
    const batchStart = performance.now();
    grid.rebuild([...clients.values()].map(c => c.entity));
    for (const c of clients.values()) {
      const begin = performance.now(); const visible = grid.query({ selfId: c.entity.id }, c.visible);
      const bytes = c.stream.encode(tick, visible, false, c.ack); c.visible = new Set(visible.map(e => e.id));
      remember(encodes, performance.now() - begin);
      if (send(c, bytes)) snapshots++;
    }
    remember(batches, performance.now() - batchStart);
  };
  const pump = () => {
    if (closed) return;
    const now = performance.now();
    if (!clients.size) { tickScheduler.idle(now); snapshotScheduler.idle(now); idleWakeups++; timer = setTimeout(pump, 50); return; }
    tickScheduler.run(now, simulate); snapshotScheduler.run(now, snapshot);
    timer = setTimeout(pump, Math.max(1, Math.min(tickScheduler.next, snapshotScheduler.next) - performance.now()));
  };
  server.on('connection', socket => {
    if (clients.size >= maxClients || nextId > 0xffffffff) { rejectedClients++; socket.close(1013, 'fixture capacity'); return; }
    if (!clients.size) { const now = performance.now(); tickScheduler.idle(now); snapshotScheduler.idle(now); }
    const id = nextId++; const now = performance.now();
    const c: Client = { socket, entity: fixtureSpawn(id), stream: new ClientStream(1, id), intents: new IntentSession(now / 1000), visible: new Set(), ack: 0, eventSequence: 0, appliedMove: 0, lastMove: now };
    clients.set(id, c); peakClients = Math.max(peakClients, clients.size);
    socket.on('message', (data, binary) => {
      receivedPackets++; const bytes = data as Buffer; bytesReceived += bytes.byteLength;
      if (!binary) { rejectedPackets++; invalidPackets++; return; }
      try {
        const intent = c.intents.accept(bytes, performance.now() / 1000); acceptedIntents++;
        if (intent.kind === 'move') c.lastMove = performance.now();
      } catch { rejectedPackets++; invalidPackets++; }
    });
    socket.on('error', () => { /* ws rejects oversized payloads before message dispatch. */ rejectedPackets++; invalidPackets++; });
    socket.on('close', () => { clients.delete(id); });
  });
  pump();
  const stats = () => {
    const cpu = process.cpuUsage(cpuStart); const elapsedMs = performance.now() - started;
    return { fixture: 'synthetic-loopback-kinematics', actualGameSimulation: false, vmMeasurement: false, tickHz: 30, snapshotHz: 20,
      elapsedMs, serverCpuUserMs: cpu.user / 1000, serverCpuSystemMs: cpu.system / 1000, serverCpuPercent: (cpu.user + cpu.system) / 1000 / elapsedMs * 100,
      tickCount: tick, snapshotCount: snapshots, eventCount: eventsSent, eventPacketCount: eventPackets, actionEventCount: actionEvents, sentPackets, tickMs: { p50: percentile(ticks, .5), p99: percentile(ticks, .99), samples: ticks.length },
      snapshotBatchMs: { p50: percentile(batches, .5), p99: percentile(batches, .99), samples: batches.length },
      encodeMs: { p50: percentile(encodes, .5), p99: percentile(encodes, .99), samples: encodes.length },
      activeClients: clients.size, peakClients, rejectedClients, bytesSent, bytesReceived, receivedPackets, acceptedIntents, appliedIntents,
      rejectedPackets, invalidPackets, backpressureDisconnects, droppedTicks: tickScheduler.dropped, droppedSnapshots: snapshotScheduler.dropped, idleWakeups };
  };
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('invalid listener');
  return {
    url: `ws://${host === '::1' ? '[::1]' : host}:${address.port}`,
    stats,
    async close() {
      if (closed) return; closed = true; if (timer) clearTimeout(timer);
      for (const socket of server.clients) socket.terminate(); clients.clear();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
