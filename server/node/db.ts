import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

// Beside this module in the source tree and beside main.mjs in server-dist (the build copies them).
const migrations = new URL('./migrations/', import.meta.url);
const LOCK = 0x63726162; // pg_advisory_lock key so two starting processes never migrate at once

export function createPool(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  // An idle client losing its connection must not crash the process; the next query reconnects.
  pool.on('error', e => console.error(`postgres: ${e.message}`));
  return pool;
}

/** Applies migrations/NNN_name.sql files in order, each once, recording them in schema_migrations. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const files = (await readdir(migrations)).filter(f => /^\d+_[\w-]+\.sql$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(r => r.version));
    for (const file of files) {
      const version = file.slice(0, -4);
      if (done.has(version)) continue;
      const sql = await readFile(new URL(file, migrations), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw new Error(`migration ${file}: ${e instanceof Error ? e.message : String(e)}`); }
      applied.push(version);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
  return applied;
}
