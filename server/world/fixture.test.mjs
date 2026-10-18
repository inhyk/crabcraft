import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { startFixture, fixtureSpawn } from './fixture.ts';
import { SnapshotReceiver } from './protocol.ts';
import { encodeIntent } from './intents.ts';
import { runLoad, assertClosedTotals } from '../../tools/load-world.mjs';
test('spawn positions remain bounded across reconnect IDs through u32 maximum', () => {
  for (const id of [1, 100, 101, 2611, 10000, 0xffffffff]) { const e = fixtureSpawn(id); assert(Math.abs(e.x) <= 36); assert(Math.abs(e.z) <= 36); assert.equal(e.id, id); }
  assert.deepEqual(fixtureSpawn(101), { ...fixtureSpawn(1), id: 101 });
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 2000) { const deadline = Date.now() + timeout; while (!fn()) { if (Date.now() > deadline) throw new Error('condition timeout'); await delay(5); } }
test('real sockets reject remote bind,configured capacity, text/malformed/oversized intent; healthy connection survives', { timeout: 10000 }, async () => {
  await assert.rejects(startFixture({ host: '0.0.0.0' }), /loopback/);
  const fixture = await startFixture({ maxClients: 2 }); const sockets = [];
  try {
    const healthy = new WebSocket(fixture.url); sockets.push(healthy); const receiver = new SnapshotReceiver(); let snapshots = 0;
    healthy.on('message', bytes => { if (bytes[3] !== 3) { receiver.apply(bytes); snapshots++; } }); await once(healthy, 'open'); await until(() => snapshots > 0);
    const attacker = new WebSocket(fixture.url); sockets.push(attacker); await once(attacker, 'open');
    const extra = new WebSocket(fixture.url); sockets.push(extra); const extraClosed = once(extra, 'close'); assert.equal((await extraClosed)[0], 1013);
    healthy.send(encodeIntent({ kind: 'move', sequence: 1, x: 1, z: 0, yaw: 0, flags: 0 })); await until(() => receiver.ack === 1);
    assert.equal(fixture.stats().acceptedIntents, 1); assert.equal(fixture.stats().appliedIntents, 1);
    attacker.send('{"damage":999,"xp":999}'); attacker.send(new Uint8Array([1, 2, 3]));
    await until(() => fixture.stats().invalidPackets >= 2); const before = snapshots;
    const attackerClosed = once(attacker, 'close'); attacker.send(new Uint8Array(65)); assert.equal((await attackerClosed)[0], 1009);
    await until(() => snapshots > before + 1); assert.equal(healthy.readyState, WebSocket.OPEN); assert.equal(fixture.stats().rejectedClients, 1);
  } finally { for (const socket of sockets) socket.terminate(); await fixture.close(); await fixture.close(); }
});
test('100 real clients in a separate fixture process receive sustained binary snapshots/events and consumed ack; graceful idle/exit', { timeout: 20000 }, async () => {
  const result = await runLoad({ clients: 100, seconds: 2, idleSeconds: .4, warmupSeconds: .5 });
  assert.equal(result.server.peakClients, 100); assert.equal(result.clientSummary.invalidPackets, 0); assert.equal(result.clientSummary.staleOrMissingStreams, 0);
  assert(result.clientSummary.minSnapshots >= 28); assert(result.clientSummary.minAckAdvances >= 20);
  assert(result.clientSummary.totalActions >= 100); assert(result.clientSummary.totalEvents >= 100);
  assert(result.server.bytesSent > 0); assert(result.server.bytesReceived > 0); assert(result.server.snapshotBatchMs.samples > 0);
  assert.equal(result.server.activeClients, 0); assert.equal(result.server.activeClientsBeforeClose, 100);
  assert.equal(result.server.bytesSent, result.clientSummary.bytesReceived); assert.equal(result.server.bytesReceived, result.clientSummary.bytesSent);
  assert.equal(result.server.sentPackets, result.clientSummary.receivedPackets); assert.equal(result.server.receivedPackets, result.clientSummary.sentPackets);
  assert.equal(result.server.snapshotCount, result.clientSummary.totalSnapshots); assert.equal(result.server.eventPacketCount, result.clientSummary.totalEventPackets);
  assert.equal(result.server.eventCount, result.clientSummary.totalEvents); assert.equal(result.server.actionEventCount, result.clientSummary.totalActions);
  assert.equal(result.cleanup.exactTotalsMatched, true); assert.equal(result.cleanup.forcedClientCloses, 0);
  assert.equal(result.cleanup.activeClients, 0); assert.equal(result.cleanup.idleTickDelta, 0); assert.equal(result.cleanup.childExitCode, 0); assert.equal(result.cleanup.childSignal, null);
});

test('fixture exits cleanly when parent IPC disconnects abruptly', { timeout: 5000 }, async () => {
  const child = fork(fileURLToPath(new URL('./fixture-main.mjs', import.meta.url)), [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await once(child, 'message'); const exited = once(child, 'exit'); child.disconnect();
    const [code, signal] = await exited; assert.equal(code, 0); assert.equal(signal, null);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
test('events received only before measurement cannot produce a passing load result', { timeout: 10000 }, async () => {
  const original = WebSocket.prototype.emit; const started = performance.now();
  WebSocket.prototype.emit = function(name, ...args) {
    if (name === 'message' && args[0]?.[3] === 3 && performance.now() - started > 1200) return false;
    return original.call(this, name, ...args);
  };
  try { await assert.rejects(runLoad({ clients: 1, seconds: 2.1, idleSeconds: .3, warmupSeconds: 1.3 }), /measured action\/event delivery|stale event stream/); }
  finally { WebSocket.prototype.emit = original; }
});

test('closed/drained total reconciliation rejects every mismatch without tolerance', () => {
  const server = { bytesSent: 10000, bytesReceived: 1300, sentPackets: 210, receivedPackets: 100, snapshotCount: 200, eventPacketCount: 10, eventCount: 11, actionEventCount: 5 };
  const client = { bytesReceived: 10000, bytesSent: 1300, receivedPackets: 210, sentPackets: 100, totalSnapshots: 200, totalEventPackets: 10, totalEvents: 11, totalActions: 5 };
  assert.doesNotThrow(() => assertClosedTotals(server, client));
  for (const key of Object.keys(client)) assert.throws(() => assertClosedTotals(server, { ...client, [key]: client[key] + 1 }), /mismatch/);
  assert.throws(() => assertClosedTotals(server, { ...client, bytesReceived: server.bytesSent + 3000 }), /bytes sent mismatch/);
});
