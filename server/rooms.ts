import { worldOf, eventOf, type WorldState } from './combatProtocol.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';

import { specOf, stateOf, actions, clean, type Spec, type State } from './protocol.ts';

type Member = { id: string; ws: WebSocket; spec: Spec; state: State | null; room: string; pong: boolean; rateAt: number; messages: number; chatAt: number; combat: boolean };

export type RoomOptions = {
  /** Browser origins allowed to connect. By default only same-host origins may. */
  allowOrigin?: (origin: string, req: IncomingMessage) => boolean;
  /** Keep a created room and its world checkpoint until it is found empty at a check this many ms after creation; 0 drops it when the last player leaves. */
  keepRooms?: number;
  maxRooms?: number;
  maxMembers?: number;
};

/** Players per room or public shard. In a room, the elected host's browser simulates the world for all of them. */
export const ROOM_CAP = 8;
/** World areas a public shard can hold: World I, II and III. */
const areaOf = (v: unknown) => v === 2 || v === 3 ? v : 1;

const sameHost = (origin: string, req: IncomingMessage) => { try { return new URL(origin).host === req.headers.host; } catch { return false; } };
const reject = (socket: Duplex, status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };

/**
 * Room-scoped relay with an authenticated combat authority and world checkpoints.
 * `enter` puts a player in the least-full public shard of their world area. Shards relay presence and chat
 * only: nobody there is a combat authority, so strangers never take over each other's world or saves.
 */
export function attachRooms(server: EventEmitter, options: RoomOptions = {}) {
  const { allowOrigin = sameHost, keepRooms = 0, maxRooms = 64, maxMembers = 128 } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const rooms = new Map<string, Map<string, Member>>();
  const members = new Set<Member>();
  const worlds = new Map<string, WorldState>();
  const alarms = new Map<string, number>();
  /** Public shard code to its world area. Shard codes start with W, so they cannot be joined by code. */
  const publics = new Map<string, number>();
  const drop = (code: string) => { rooms.delete(code); worlds.delete(code); alarms.delete(code); publics.delete(code); };
  // Make room for a new one by forgetting the oldest room nobody is in.
  const evict = () => { for (const [code, room] of rooms) if (!room.size) { drop(code); return true; } return false; };
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
    // An empty shard has nothing to keep; a private room may keep its checkpoint.
    if (!room?.size) { if (!keepRooms || publics.has(m.room)) drop(m.room); }
    else if (!publics.has(m.room)) broadcast(m.room, { type: 'authority', host: host(m.room) });
    m.room = '';
    m.state = null;
  }
  function admit(m: Member, code: string, spec: Spec, combat: boolean) {
    m.spec = spec; m.combat = combat;
    m.room = code;
    if (!rooms.has(code)) rooms.set(code, new Map());
    const room = rooms.get(code)!, area = publics.get(code);
    send(m.ws, { type: 'welcome', host: host(code) || (m.combat ? m.id : ''), world: worlds.get(code) ?? null, id: m.id, room: code, ...(area ? { public: true, area } : {}), players: [...room.values()].map(p => ({ id: p.id, spec: p.spec, state: p.state })) });
    room.set(m.id, m);
    broadcast(code, { type: 'joined', id: m.id, spec }, m.id);
    if (host(code)) broadcast(code, { type: 'authority', host: host(code) });
  }
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split('?')[0] !== '/multiplayer') return;
    // No cross-site websocket access. Non-browser clients have no Origin header.
    if (req.headers.origin && !allowOrigin(req.headers.origin, req)) { reject(socket, '403 Forbidden'); return; }
    if (members.size >= maxMembers) { reject(socket, '503 Service Unavailable'); return; }
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
      if (msg.type === 'enter') {
        const spec = specOf(msg.spec);
        if (!spec) { send(ws, { type: 'error', message: 'Invalid character.' }); return; }
        const area = areaOf(msg.area);
        leave(m);
        let code = '', least = ROOM_CAP;
        for (const [c, a] of publics) { const size = rooms.get(c)?.size ?? 0; if (a === area && size < least) { code = c; least = size; } }
        if (!code) {
          if (rooms.size >= maxRooms && !evict()) { send(ws, { type: 'error', message: 'Server full. Try again later.' }); return; }
          do { code = `W${area}${randomBytes(2).toString('hex').toUpperCase()}`; } while (rooms.has(code));
          publics.set(code, area);
        }
        admit(m, code, spec, false);
      } else if (msg.type === 'create' || msg.type === 'join') {
        const spec = specOf(msg.spec);
        if (!spec) { send(ws, { type: 'error', message: 'Invalid character.' }); return; }
        let code = clean(msg.room, 6).toUpperCase();
        if (msg.type === 'create') {
          if (rooms.size >= maxRooms && !evict()) { send(ws, { type: 'error', message: 'Server full. Try again later.' }); return; }
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          if (keepRooms) alarms.set(code, now + keepRooms);
        } else if (!/^[A-F0-9]{6}$/.test(code) || !rooms.has(code)) {
          send(ws, { type: 'error', message: 'Room not found. Check the six-character code.' }); return;
        }
        if ((rooms.get(code)?.size ?? 0) >= ROOM_CAP) { send(ws, { type: 'error', message: 'Room is full (8 players).' }); return; }
        leave(m);
        admit(m, code, spec, msg.combatVersion === 1);
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
  // Like the Worker's room alarm: an empty room expires at its check, an occupied one gets another period.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, at] of alarms) if (at <= now) { if (rooms.get(code)?.size) alarms.set(code, now + keepRooms); else drop(code); }
  }, Math.min(60000, keepRooms || 60000));
  sweep.unref();
  const close = () => {
    clearInterval(heartbeat);
    clearInterval(sweep);
    server.off('upgrade', upgrade);
    for (const m of members) m.ws.terminate();
    wss.close();
  };
  server.once('close', close);
  return { close, rooms, publics };
}
