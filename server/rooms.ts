import { worldOf, eventOf, type WorldState } from './combatProtocol.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';

import { specOf, stateOf, actions, clean, type Spec, type State } from './protocol.ts';

type Member = { id: string; ws: WebSocket; spec: Spec; state: State | null; room: string; pong: boolean; rateAt: number; messages: number; chatAt: number; combat: boolean };

/** Room-scoped relay with an authenticated combat authority and world checkpoints. */
export function attachRooms(server: EventEmitter) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const rooms = new Map<string, Map<string, Member>>();
  const members = new Set<Member>();
  const worlds = new Map<string, WorldState>();
  const host = (room: string) => [...(rooms.get(room)?.values() ?? [])].find(m => m.combat)?.id ?? '';
  function send(ws: WebSocket, data: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 256 * 1024) { ws.terminate(); return; }
    ws.send(JSON.stringify(data));
  }
  function broadcast(room: string, data: unknown, except?: string) {
    for (const m of rooms.get(room)?.values() ?? []) if (m.id !== except) send(m.ws, data);
  }
  function leave(m: Member) {
    if (!m.room) return;
    const room = rooms.get(m.room);
    room?.delete(m.id);
    broadcast(m.room, { type: 'left', id: m.id });
    if (!room?.size) { rooms.delete(m.room); worlds.delete(m.room); }
    else broadcast(m.room, { type: 'authority', host: host(m.room) });
    m.room = '';
    m.state = null;
  }
  const upgrade = (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    if (req.url?.split('?')[0] !== '/multiplayer') return;
    // No cross-site websocket access. Non-browser clients have no Origin header.
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
      catch { socket.destroy(); return; }
    }
    if (members.size >= 128) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  };
  server.on('upgrade', upgrade);
  wss.on('connection', ws => {
    const m: Member = { id: randomUUID(), ws, spec: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Crab' }, state: null, room: '', pong: true, rateAt: Date.now(), messages: 0, chatAt: 0, combat: false };
    members.add(m);
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => { m.pong = true; });
    ws.on('close', () => { leave(m); members.delete(m); });
    ws.on('message', (raw, binary) => {
      if (binary) return;
      const now = Date.now();
      if (now - m.rateAt > 1000) { m.rateAt = now; m.messages = 0; }
      if (++m.messages > (m.room && host(m.room) === m.id ? 240 : 60)) { ws.close(1008, 'Too many messages'); return; }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'create' || msg.type === 'join') {
        const spec = specOf(msg.spec);
        if (!spec) { send(ws, { type: 'error', message: 'Invalid character.' }); return; }
        let code = clean(msg.room, 6).toUpperCase();
        if (msg.type === 'create') {
          if (rooms.size >= 64) { send(ws, { type: 'error', message: 'Server full. Try again later.' }); return; }
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
        } else if (!/^[A-F0-9]{6}$/.test(code) || !rooms.has(code)) {
          send(ws, { type: 'error', message: 'Room not found. Check the six-character code.' }); return;
        }
        if ((rooms.get(code)?.size ?? 0) >= 8) { send(ws, { type: 'error', message: 'Room is full (8 players).' }); return; }
        leave(m);
        m.spec = spec; m.combat = msg.combatVersion === 1;
        m.room = code;
        if (!rooms.has(code)) rooms.set(code, new Map());
        const room = rooms.get(code)!;
        send(ws, { type: 'welcome', host: host(code) || (m.combat ? m.id : ''), world: worlds.get(code) ?? null, id: m.id, room: code, players: [...room.values()].map(p => ({ id: p.id, spec: p.spec, state: p.state })) });
        room.set(m.id, m);
        broadcast(code, { type: 'joined', id: m.id, spec }, m.id);
        if (host(code)) broadcast(code, { type: 'authority', host: host(code) });
      } else if (msg.type === 'leave') { leave(m); send(ws, { type: 'leftRoom' }); }
      else if (m.room && msg.type === 'state') {
        const state = stateOf(msg.state);
        if (!state) return;
        m.state = state;
        broadcast(m.room, { type: 'state', id: m.id, state }, m.id);
      } else if (m.room && msg.type === 'action' && actions.has(msg.action)) {
        broadcast(m.room, { type: 'action', id: m.id, action: msg.action }, m.id);
      } else if (m.room && m.combat && msg.type === 'world' && host(m.room) === m.id) {
        const world = worldOf(msg.world);
        if (world) { worlds.set(m.room, world); broadcast(m.room, { type: 'world', world }, m.id); }
      } else if (m.room && m.combat && msg.type === 'combat') {
        const authority = host(m.room) === m.id;
        const event = eventOf(msg.event, authority);
        if (event) {
          const packet = { type: 'combat', id: m.id, event };
          if (authority) broadcast(m.room, packet, m.id);
          else { const h = rooms.get(m.room)?.get(host(m.room)); if (h) send(h.ws, packet); }
        }
      } else if (m.room && msg.type === 'chat' && now - m.chatAt >= 700) {
        const text = clean(msg.text, 200);
        if (!text) return;
        m.chatAt = now;
        broadcast(m.room, { type: 'chat', id: m.id, name: m.spec.name, text });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const m of members) {
      if (!m.pong) { m.ws.terminate(); continue; }
      m.pong = false;
      m.ws.ping();
    }
  }, 15000);
  heartbeat.unref();
  const close = () => {
    clearInterval(heartbeat);
    server.off('upgrade', upgrade);
    for (const m of members) m.ws.terminate();
    wss.close();
  };
  server.once('close', close);
  return { close, rooms };
}
