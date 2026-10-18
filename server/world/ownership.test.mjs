import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { acquireHostOwnership, HostOwnershipError } from './ownership.ts';

let postgres, observer;
before(async () => {
  try { postgres = await startPostgres(); observer = new pg.Pool({ connectionString: postgres.url }); }
  catch (e) { await observer?.end(); postgres?.stop(); throw e; }
});
after(async () => { try { await observer?.end(); } finally { postgres?.stop(); } });
const pool = () => new pg.Pool({ connectionString: postgres.url, max: 2 });
const ownershipError = code => e => e instanceof HostOwnershipError && e.code === code;
const lockPid = async () => { const rows = (await observer.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted")).rows; assert.equal(rows.length, 1); return rows[0].pid; };
const untilClosed = signal => signal.aborted ? Promise.resolve() : new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('ownership loss not signalled')), 2000);
  signal.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
});

test('two independent hosts contend; retained lock client is not borrowed or returned to idle pool', async () => {
  const firstPool = pool(), secondPool = pool(); let first, second;
  try {
    first = await acquireHostOwnership(firstPool, 'test/world-authority'); first.assertOwned();
    const pid = await lockPid(); assert.equal(firstPool.idleCount, 0);
    assert.notEqual((await firstPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, pid);
    await assert.rejects(acquireHostOwnership(secondPool, 'test/world-authority'), ownershipError('busy'));
    await first.release(); assert.equal(first.closed.aborted, true); assert.equal(first.closed.reason.code, 'released'); assert.throws(() => first.assertOwned(), ownershipError('released'));
    await first.release(); second = await acquireHostOwnership(secondPool, 'test/world-authority'); second.assertOwned();
    assert.notEqual(await lockPid(), pid);
  } finally { await first?.release(); await second?.release(); await firstPool.end(); await secondPool.end(); }
});

test('backend loss aborts host authority and allows another real host to acquire', async () => {
  const firstPool = pool(), secondPool = pool(); let first, second;
  try {
    first = await acquireHostOwnership(firstPool, 'test/world-loss', { heartbeatMs: 20, queryTimeoutMs: 100 });
    const pid = await lockPid(), lost = untilClosed(first.closed); let notified = 0;
    first.closed.addEventListener('abort', () => notified++, { once: true });
    assert.equal((await observer.query('SELECT pg_terminate_backend($1) AS stopped', [pid])).rows[0].stopped, true);
    await lost; assert.equal(notified, 1); assert.equal(first.closed.reason.code, 'lost'); assert.throws(() => first.assertOwned(), ownershipError('lost'));
    second = await acquireHostOwnership(secondPool, 'test/world-loss'); second.assertOwned(); await first.release();
  } finally { await first?.release(); await second?.release(); await firstPool.end(); await secondPool.end(); }
});

test('transaction failure on another borrowed client cannot release the retained host lock', async () => {
  const firstPool = pool(), secondPool = pool(); let first;
  try {
    first = await acquireHostOwnership(firstPool, 'test/world-transaction'); const pid = await lockPid();
    const transaction = await firstPool.connect();
    try { assert.notEqual((await transaction.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, pid); await transaction.query('BEGIN'); await assert.rejects(transaction.query('SELECT 1/0'), /division by zero/); await transaction.query('ROLLBACK'); }
    finally { transaction.release(); }
    first.assertOwned(); await assert.rejects(acquireHostOwnership(secondPool, 'test/world-transaction'), ownershipError('busy'));
  } finally { await first?.release(); await firstPool.end(); await secondPool.end(); }
});

test('acquisition failure on a poisoned transaction destroys the connection rather than pooling it', async () => {
  const poisonedPool = new pg.Pool({ connectionString: postgres.url, max: 1 }); let ownership;
  try {
    const client = await poisonedPool.connect(), pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await client.query('BEGIN'); await assert.rejects(client.query('SELECT 1/0'), /division by zero/); client.release();
    await assert.rejects(acquireHostOwnership(poisonedPool, 'test/world-poisoned'), /current transaction is aborted/);
    ownership = await acquireHostOwnership(poisonedPool, 'test/world-poisoned'); assert.notEqual(await lockPid(), pid); ownership.assertOwned();
  } finally { await ownership?.release(); await poisonedPool.end(); }
});

test('ownership validates bounded keys and heartbeat configuration before acquiring', async () => {
  for (const key of ['', 'x'.repeat(129), 'bad\0key', '\ud800']) await assert.rejects(acquireHostOwnership(observer, key), ownershipError('invalid'));
  for (const options of [{ heartbeatMs: 0 }, { queryTimeoutMs: Infinity }, { heartbeatMs: 60001 }]) await assert.rejects(acquireHostOwnership(observer, 'test/bounds', options), ownershipError('invalid'));
});
