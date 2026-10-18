import { createHash } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';

export class HostOwnershipError extends Error {
  readonly code: 'invalid' | 'busy' | 'lost' | 'released';
  constructor(code: HostOwnershipError['code']) { super('world host ownership ' + code); this.name = 'HostOwnershipError'; this.code = code; }
}
export interface HostOwnership {
  readonly key: string;
  readonly closed: AbortSignal;
  assertOwned(): void;
  release(): Promise<void>;
}
export type HostOwnershipOptions = { heartbeatMs?: number; queryTimeoutMs?: number };

/** One retained session-level advisory lock. Never return this connection to the idle pool. */
export async function acquireHostOwnership(pool: Pool, key: string, options: HostOwnershipOptions = {}): Promise<HostOwnership> {
  if (typeof key !== 'string' || Buffer.byteLength(key) < 1 || Buffer.byteLength(key) > 128 || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(key)) throw new HostOwnershipError('invalid');
  const heartbeatMs = options.heartbeatMs ?? 1000, queryTimeoutMs = options.queryTimeoutMs ?? 1000;
  for (const value of [heartbeatMs, queryTimeoutMs]) if (!Number.isSafeInteger(value) || value < 1 || value > 60000) throw new HostOwnershipError('invalid');
  const lockKey = createHash('sha256').update(key).digest().readBigInt64BE().toString();
  const client = await pool.connect();
  const query = <R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) => {
    // pg supports per-query read timeout; current @types/pg only declares the client default.
    const config = { text, values, query_timeout: queryTimeoutMs };
    return client.query<R>(config);
  };
  let disconnected = false, onLoss: (() => void) | undefined;
  const error = () => { disconnected = true; onLoss?.(); };
  const end = () => { error(); client.off('error', error); client.off('end', end); };
  client.on('error', error); client.on('end', end);
  try {
    const result = await query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [lockKey]);
    if (disconnected) throw new HostOwnershipError('lost');
    if (!result.rows[0].acquired) throw new HostOwnershipError('busy');
  } catch (e) { client.release(true); throw e; }

  const controller = new AbortController();
  let active = true, returned = false, inFlight = false, releasePromise: Promise<void> | undefined;
  const destroy = () => { if (!returned) { returned = true; client.release(true); } };
  const lose = () => {
    if (!active) return;
    active = false; clearInterval(timer); controller.abort(new HostOwnershipError('lost')); destroy();
  };
  onLoss = lose;
  const timer = setInterval(() => {
    if (!active || inFlight) return;
    inFlight = true;
    void query('SELECT 1').catch(lose).finally(() => { inFlight = false; });
  }, heartbeatMs);
  timer.unref();
  return {
    key,
    closed: controller.signal,
    assertOwned() { if (!active) throw controller.signal.reason; },
    release() {
      if (releasePromise) return releasePromise;
      if (!active) return Promise.resolve();
      active = false; clearInterval(timer); controller.abort(new HostOwnershipError('released'));
      releasePromise = (async () => {
        try { await query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]); }
        finally { destroy(); }
      })();
      return releasePromise;
    },
  };
}
