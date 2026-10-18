import { worldOf, eventOf, type WorldState } from './combatProtocol.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';

import { specOf, stateOf, actions, clean, type Spec, type State } from './protocol.ts';
import type { MonitorSnapshot, MonitorPlayer } from './monitor.ts';
import { Moderation, Talk, CHAT, reasonOf, sessionOf, shownName, type Report } from './chat/safety.ts';

/** `session`: the client's per-tab id (see chat/safety.ts); `lastRoom`: where a departed player was, for reports. */
type Member = { id: string; ws: WebSocket; spec: Spec; state: State | null; room: string; pong: boolean; rateAt: number; messages: number; combat: boolean; snow: boolean; session: string; talk: Talk; lastRoom: string };

export type RoomOptions = {
  /** Browser origins allowed to connect. By default only same-host origins may. */
  allowOrigin?: (origin: string, req: IncomingMessage) => boolean;
  /** Keep a created room and its world checkpoint until it is found empty at a check this many ms after creation; 0 drops it when the last player leaves. */
  keepRooms?: number;
  maxRooms?: number;
  maxMembers?: number;
  /** Stores a chat report. Without it (the Vite relay) reports are only logged. */
  report?: (report: Report) => void | Promise<void>;
};

/** Players per room or public shard. In a room, the elected host's browser simulates the world for all of them. */
export const ROOM_CAP = 8;
/** Public presence is isolated by world area, including Frostlight. */
const areaOf = (v: unknown) => v === 2 || v === 3 || v === 4 || v === 5 || v === 6 ? v : 1;

const sameHost = (origin: string, req: IncomingMessage) => { try { return new URL(origin).host === req.headers.host; } catch { return false; } };
const reject = (socket: Duplex, status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
const logReport = (r: Report) => console.log(`chat report: ${JSON.stringify(r)}`);

/**
 * Room-scoped relay with an authenticated combat authority and world checkpoints.
 * `enter` puts a player in the least-full public shard of their world area. Shards relay presence and chat
 * only for legacy clients. Opt-in shared-world shards elect a combat authority within one area;
 * their portal travel stays personal and cannot change the shard area.
 * Chat is filtered and rate limited, names with bad words are replaced, and reports can mute a player (chat/safety.ts).
 */
export function attachRooms(server: EventEmitter, options: RoomOptions = {}) {
  const { allowOrigin = sameHost, keepRooms = 0, maxRooms = 64, maxMembers = 128, report = logReport } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const rooms = new Map<string, Map<string, Member>>();
  const members = new Set<Member>();
  /** Players by id, kept for a while after they leave so they can still be reported. */
  const known = new Map<string, { member: Member; gone: number }>();
  const moderation = new Moderation();
  const worlds = new Map<string, WorldState>();
  const alarms = new Map<string, number>();
  const snowRooms=new Map<string,boolean>();
  const sharedAreas=new Set<string>();
  const observed = new Map<string, { updatedAt: number | null; action: MonitorPlayer['action'] }>();
  let actionSeq = 0;
  /** Public shard code to its world area. Shard codes start with W, so they cannot be joined by code. */
  const publics = new Map<string, number>();
  const drop = (code: string) => { rooms.delete(code); worlds.delete(code); alarms.delete(code); publics.delete(code);snowRooms.delete(code);sharedAreas.delete(code); };
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
    else if (!publics.has(m.room)||sharedAreas.has(m.room)) broadcast(m.room, { type: 'authority', host: host(m.room) });
    m.lastRoom = m.room;
    m.room = '';
    m.state = null;
    observed.delete(m.id);
  }
  function admit(m: Member, code: string, spec: Spec, combat: boolean, session: unknown) {
    // Strangers see a neutral name instead of one with a bad word or contact details; the player is told.
    const safeName = shownName(spec.name), renamed = safeName !== spec.name;
    const nameKey = (value:string) => value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
    const used = new Set([...members].filter(p=>p!==m && p.room && p.ws.readyState===WebSocket.OPEN).map(p=>nameKey(p.spec.name)));
    let name = safeName, suffix = 2;
    while(used.has(nameKey(name))){
      const tag = ` #${suffix++}`;
      name = safeName.slice(0,24-tag.length).replace(/[\uD800-\uDBFF]$/,'') + tag;
    }
    m.spec = { ...spec, name }; m.combat = combat; spec = m.spec;
    m.session = sessionOf(session, m.session);
    m.room = code;
    if (!rooms.has(code)) rooms.set(code, new Map());
    const room = rooms.get(code)!, area = publics.get(code);
    send(m.ws, { type: 'welcome', host: host(code) || (m.combat ? m.id : ''), world: worlds.get(code) ?? null, id: m.id, room: code, displayName:name, ...(name!==safeName?{nameConflict:true}:{}), ...(area ? { public: true, area, ...(sharedAreas.has(code)?{sharedWorld:1}:{}) } : {}), ...(renamed ? { renamed: name } : {}), players: [...room.values()].map(p => ({ id: p.id, spec: p.spec, state: p.state })) });
    room.set(m.id, m);
    broadcast(code, { type: 'joined', id: m.id, spec }, m.id);
    if (host(code)) broadcast(code, { type: 'authority', host: host(code) });
  }
  let stopping = false;
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split('?')[0] !== '/multiplayer') return;
    if (stopping) { reject(socket, '503 Service Unavailable'); return; }
    // No cross-site websocket access. Non-browser clients have no Origin header.
    if (req.headers.origin && !allowOrigin(req.headers.origin, req)) { reject(socket, '403 Forbidden'); return; }
    if (members.size >= maxMembers) { reject(socket, '503 Service Unavailable'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  };
  server.on('upgrade', upgrade);
  wss.on('connection', ws => {
    const id = randomUUID();
    const m: Member = { id, ws, spec: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Crab' }, state: null, room: '', pong: true, rateAt: Date.now(), messages: 0, combat: false, snow: false, session: id, talk: new Talk(), lastRoom: '' };
    members.add(m);
    known.set(id, { member: m, gone: 0 });
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => { m.pong = true; });
    ws.on('close', () => {
      leave(m); members.delete(m);
      // Moved to the end, so under a flood of short connections the oldest departures go first.
      known.delete(m.id); known.set(m.id, { member: m, gone: Date.now() });
      for (const [old, k] of known) { if (known.size <= maxMembers * 8) break; if (k.gone) known.delete(old); }
    });
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
        const area = areaOf(msg.area), shared=msg.sharedWorld===1&&msg.snowWorld===true&&msg.combatVersion===1;
        leave(m);
        let code = '', least = ROOM_CAP;
        for (const [c, a] of publics) { const size = rooms.get(c)?.size ?? 0; if (a === area && sharedAreas.has(c)===shared && size < least) { code = c; least = size; } }
        if (!code) {
          if (rooms.size >= maxRooms && !evict()) { send(ws, { type: 'error', message: 'Server full. Try again later.' }); return; }
          do { code = `W${area}${randomBytes(2).toString('hex').toUpperCase()}`; } while (rooms.has(code));
          publics.set(code, area);
          if(shared)sharedAreas.add(code);
        }
        m.snow=shared;admit(m, code, spec, shared, msg.session);
      } else if (msg.type === 'create' || msg.type === 'join') {
        const spec = specOf(msg.spec);
        if (!spec) { send(ws, { type: 'error', message: 'Invalid character.' }); return; }
        let code = clean(msg.room, 6).toUpperCase();
        if (msg.type === 'create') {
          if (rooms.size >= maxRooms && !evict()) { send(ws, { type: 'error', message: 'Server full. Try again later.' }); return; }
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          snowRooms.set(code,msg.snowWorld===true);
          if (keepRooms) alarms.set(code, now + keepRooms);
        } else if (!/^[A-F0-9]{6}$/.test(code) || !rooms.has(code)) {
          send(ws, { type: 'error', message: 'Room not found. Check the six-character code.' }); return;
        }
        if ((rooms.get(code)?.size ?? 0) >= ROOM_CAP) { send(ws, { type: 'error', message: 'Room is full (8 players).' }); return; }
        const snow=msg.snowWorld===true;
        if(snowRooms.get(code)!==snow){send(ws,{type:'error',message:'Game versions differ. Everyone must refresh before joining.'});return;}
        leave(m);m.snow=snow;
        admit(m, code, spec, msg.combatVersion === 1, msg.session);
      } else if (msg.type === 'leave') { leave(m); send(ws, { type: 'leftRoom' }); }
      else if (m.room && msg.type === 'state') {
        const state = stateOf(msg.state);
        if (!state) return;
        m.state = state;
        const old = observed.get(m.id);
        observed.set(m.id, { updatedAt: now, action: old?.action ?? null });
        broadcast(m.room, { type: 'state', id: m.id, state }, m.id);
      } else if (m.room && msg.type === 'action' && actions.has(msg.action)) {
        const old = observed.get(m.id);
        observed.set(m.id, { updatedAt: old?.updatedAt ?? null, action: { name: msg.action, seq: ++actionSeq, at: now } });
        broadcast(m.room, { type: 'action', id: m.id, action: msg.action }, m.id);
      } else if (m.room && m.combat && msg.type === 'world' && host(m.room) === m.id) {
        const world = worldOf(msg.world);
        if (world && (!publics.has(m.room)||sharedAreas.has(m.room)&&world.chapter===publics.get(m.room)) && (m.snow || world.chapter<4&&!world.bosses.some(b=>b.id==='b300'))) { worlds.set(m.room, world); broadcast(m.room, { type: 'world', world }, m.id); }
      } else if (m.room && m.combat && msg.type === 'combat') {
        const authority = host(m.room) === m.id;
        const event = eventOf(msg.event, authority);
        if (event && (event.kind!=='heal-cast'||m.spec.classId==='priest') && (!publics.has(m.room)||!['chapter','party','duel','dungeon-return'].includes(event.kind)) && (m.snow || (event.chapter??1)<4&&![event.target,event.source].some(key=>key==='b300'||key==='f300'))) {
          const packet = { type: 'combat', id: m.id, event };
          if (authority) broadcast(m.room, packet, m.id);
          else { const h = rooms.get(m.room)?.get(host(m.room)); if (h) send(h.ws, packet); }
        }
      } else if (m.room && msg.type === 'chat') {
        const said = m.talk.say(msg.text, now);
        if (!said) return;
        if ('refused' in said) { send(ws, { type: 'chatRefused', reason: said.refused }); return; }
        const packet = { type: 'chat', id: m.id, name: m.spec.name, text: said.text };
        // A muted player still sees their own lines, so nothing tells them to try harder.
        if (moderation.muted(m.session, now)) send(ws, packet); else broadcast(m.room, packet);
      } else if (m.room && msg.type === 'report') {
        // Someone in this room or the last one, up to ten minutes after they left; a player's id is only ever sent to their room.
        const reason = reasonOf(msg.reason), target = typeof msg.id === 'string' ? known.get(msg.id)?.member : undefined;
        const room = target && [m.room, m.lastRoom].find(r => r && (r === target.room || r === target.lastRoom));
        if (!reason || !target || target === m || !room) { send(ws, { type: 'reported', id: String(msg.id ?? '').slice(0, 64), ok: false }); return; }
        const counted = moderation.report(m.session, target.session, now);
        send(ws, { type: 'reported', id: target.id, ok: counted.ok });
        if (!counted.ok) return;
        const row: Report = { at: now, room, reason, muted: counted.muted, reporter: { session: m.session, name: m.spec.name }, target: { session: target.session, name: target.spec.name, lines: [...target.talk.lines] } };
        void Promise.resolve().then(() => report(row)).catch(e => console.error(`chat report: ${e instanceof Error ? e.message : String(e)}`));
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
    for (const [id, k] of known) if (k.gone && now - k.gone > CHAT.reportMs) known.delete(id);
    moderation.sweep(now);
  }, Math.min(60000, keepRooms || 60000));
  sweep.unref();
  const close = () => {
    clearInterval(heartbeat);
    clearInterval(sweep);
    server.off('upgrade', upgrade);
    for (const m of members) m.ws.terminate();
    wss.close();
  };
  /**
   * Before the process stops: tell every player the server is restarting, so clients come back at once, and close
   * their sockets. Until the HTTP server closes, new sockets are refused with 503 instead of left waiting.
   */
  const restart = async (wait = 1000) => {
    stopping = true;
    for (const m of members) { send(m.ws, { type: 'restarting' }); m.ws.close(1012, 'Server restarting'); }
    for (const until = Date.now() + wait; members.size && Date.now() < until;) await new Promise(r => setTimeout(r, 20));
    for (const m of members) m.ws.terminate();
  };
  server.once('close', close);
  const monitorSnapshot = (): MonitorSnapshot => ({
    at: Date.now(),
    players: [...members].filter(m => m.room).map(m => ({
      id: m.id, room: m.room, public: publics.has(m.room),
      area: publics.get(m.room) ?? m.state?.area ?? worlds.get(m.room)?.chapter ?? null,
      spec: { ...m.spec }, state: m.state ? { ...m.state } : null,
      updatedAt: observed.get(m.id)?.updatedAt ?? null,
      action: observed.get(m.id)?.action ? { ...observed.get(m.id)!.action! } : null,
    })),
  });
  return { close, restart, rooms, publics, moderation, monitorSnapshot };
}
