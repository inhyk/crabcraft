// A throwaway Postgres cluster for server tests and QA tools: TCP on 127.0.0.1 only, no Unix socket, removed by stop().
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { once } from 'node:events';
import pg from 'pg';

function pgBin() {
  const dirs = [process.env.PG_BIN, ...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const base of ['/opt/homebrew/opt', '/usr/lib/postgresql']) {
    try { for (const d of readdirSync(base).sort().reverse()) dirs.push(join(base, d, 'bin')); } catch { /* not installed here */ }
  }
  const dir = dirs.find(d => d && existsSync(join(d, 'initdb')) && existsSync(join(d, 'pg_ctl')));
  if (!dir) throw new Error('Postgres binaries (initdb, pg_ctl) not found; set PG_BIN');
  return dir;
}

export async function freePort() {
  for (;;) {
    const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
    const { port } = s.address(); s.close(); await once(s, 'close');
    if (port !== 5432) return port;
  }
}

/** Starts a cluster with an empty database `crabcraft`; returns its connection URL and stop(). */
export async function startPostgres() {
  const bin = pgBin(), dir = mkdtempSync(join(tmpdir(), 'crabcraft-pg-')), data = join(dir, 'data'), port = await freePort();
  const stop = () => {
    if (existsSync(join(data, 'postmaster.pid'))) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync'], { stdio: 'ignore' });
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(dir, 'postgres.log'), '-w', '-t', '30', '-o', `-c listen_addresses=127.0.0.1 -p ${port} -c unix_socket_directories='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    const admin = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${port}/postgres` });
    await admin.connect(); await admin.query('CREATE DATABASE crabcraft'); await admin.end();
  } catch (e) { stop(); throw e; }
  return { url: `postgres://postgres@127.0.0.1:${port}/crabcraft`, stop };
}
