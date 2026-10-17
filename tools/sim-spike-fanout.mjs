// Feasibility spike (docs/server-world.md): what sending snapshots to 100 WebSockets costs the
// server process. A server (this file with --serve) sends every client one message of --bytes at
// --hz for --seconds through the `ws` package the game server uses; a second process holds the
// client sockets and counts what arrives. The server reports its own CPU time.
//   node tools/sim-spike-fanout.mjs --clients 100 --bytes 400 --hz 10 --seconds 15
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const clients = Number(opt('clients', '100'));
const bytes = Number(opt('bytes', '400'));
const hz = Number(opt('hz', '10'));
const seconds = Number(opt('seconds', '15'));
const text = argv.includes('--text');

if (argv.includes('--serve')) {
  const wss = new WebSocketServer({ port: 0, perMessageDeflate: false });
  wss.on('listening', () => process.stdout.write(`PORT ${wss.address().port}\n`));
  const sockets = new Set();
  wss.on('connection', (ws) => { sockets.add(ws); ws.on('close', () => sockets.delete(ws)); });
  // Each tick builds a fresh payload per client, as per-client snapshots would be.
  const body = text ? 'x'.repeat(bytes) : null;
  let started = 0;
  let cpu0;
  let sent = 0;
  const tick = () => {
    if (sockets.size < clients) return;
    if (!started) { started = performance.now(); cpu0 = process.cpuUsage(); }
    for (const ws of sockets) {
      if (ws.bufferedAmount > 1 << 20) continue;
      ws.send(text ? body : Buffer.alloc(bytes, sent & 255));
      sent++;
    }
    if (performance.now() - started >= seconds * 1000) {
      const c = process.cpuUsage(cpu0);
      const wall = (performance.now() - started) / 1000;
      for (const ws of sockets) ws.terminate();
      // On macOS a pipe write is asynchronous: exit once it is out.
      process.stdout.write(`RESULT ${JSON.stringify({ clients, bytes, hz, seconds: wall, text, sent, cpuPctOfCore: ((c.user + c.system) / 1e6 / wall) * 100 })}\n`, () => process.exit(0));
    }
  };
  setInterval(tick, 1000 / hz);
} else if (argv.includes('--connect')) {
  const port = Number(opt('port', '0'));
  let received = 0;
  for (let i = 0; i < clients; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { perMessageDeflate: false });
    ws.on('message', () => received++);
    ws.on('error', () => {});
  }
  // The process may end on its own once the server closes every socket: report on any exit.
  process.on('exit', () => writeSync(1, `RECEIVED ${received}\n`));
  process.on('SIGTERM', () => process.exit(0));
} else {
  const self = fileURLToPath(import.meta.url);
  const pass = ['--clients', String(clients), '--bytes', String(bytes), '--hz', String(hz), '--seconds', String(seconds), ...(text ? ['--text'] : [])];
  const server = spawn(process.execPath, [self, '--serve', ...pass], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  let client = null;
  let clientOut = '';
  server.stdout.on('data', (d) => {
    out += d;
    const port = /PORT (\d+)/.exec(out)?.[1];
    if (port && !client) {
      client = spawn(process.execPath, [self, '--connect', '--port', port, ...pass], { stdio: ['ignore', 'pipe', 'inherit'] });
      client.stdout.on('data', (c) => (clientOut += c));
    }
  });
  server.on('exit', () => {
    const result = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? 'null');
    client?.on('close', () => {
      const received = Number(/RECEIVED (\d+)/.exec(clientOut)?.[1] ?? 0);
      console.log(JSON.stringify({ ...result, received, kbPerSecondOut: (result.sent * result.bytes) / result.seconds / 1024 }));
    });
    client?.kill('SIGTERM');
  });
}
