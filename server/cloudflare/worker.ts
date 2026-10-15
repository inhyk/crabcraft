import { worldOf, eventOf, type WorldState } from '../combatProtocol';
import { DurableObject } from 'cloudflare:workers';
import { specOf, stateOf, actions, clean, type Spec, type State } from '../protocol';

type Connection = { id: string; room: string; spec: Spec | null; state: State | null; rateAt: number; messages: number; chatAt: number; combat?: boolean; joinedAt?: number };
type Message = { type: string; spec?: unknown; state?: State; action?: string; text?: string; combatVersion?: number; world?: unknown; event?: unknown };

export class CrabRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const room = url.searchParams.get('room')!;
    const created = await this.ctx.storage.get<number>('created');
    if (url.searchParams.get('mode') === 'create') {
      // Only the Worker chooses a new room ID. Collisions never merge rooms.
      if (created) return new Response('Room collision', { status: 409 });
      await this.ctx.storage.put('created', Date.now());
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    } else if (!created) return new Response('Room not found', { status: 404 });
    if (this.ctx.getWebSockets().length >= 8) return new Response('Room is full', { status: 409 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID(), room, spec: null, state: null, rateAt: Date.now(), messages: 0, chatAt: 0, combat: false, joinedAt: Date.now() } satisfies Connection);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 65536) { ws.close(1009, 'Message too large'); return; }
    const c = ws.deserializeAttachment() as Connection;
    const now = Date.now();
    if (now - c.rateAt >= 1000) { c.rateAt = now; c.messages = 0; }
    if (++c.messages > (c.combat && c.id === this.host() ? 240 : 60)) { ws.close(1008, 'Too many messages'); return; }
    ws.serializeAttachment(c);
    let msg: Message;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'create' || msg.type === 'join') {
      if (c.spec) return;
      const spec = specOf(msg.spec);
      if (!spec) { this.send(ws, { type: 'error', message: '캐릭터 정보를 확인해 주세요.' }); return; }
      const players = this.ctx.getWebSockets().filter(other => other !== ws).map(other => other.deserializeAttachment() as Connection).filter(other => other.spec).map(other => ({ id: other.id, spec: other.spec, state: other.state }));
      c.spec = spec; c.combat = msg.combatVersion === 1;
      c.joinedAt=Math.max(Date.now(),...this.ctx.getWebSockets().map(s => (s.deserializeAttachment() as Connection).joinedAt ?? 0))+1;
      ws.serializeAttachment(c);
      this.send(ws, { type: 'welcome', host: this.host(), world: await this.ctx.storage.get<WorldState>('world') ?? null, id: c.id, room: c.room, players });
      this.broadcast({ type: 'joined', id: c.id, spec }, ws);
      if (this.host()) this.broadcast({ type: 'authority', host: this.host() });
      return;
    }
    if (!c.spec) return;
    if (msg.type === 'state') {
      const state = stateOf(msg.state!);
      if (state) { c.state = state; this.broadcast({ type: 'state', id: c.id, state }, ws); }
    } else if (msg.type === 'action' && actions.has(msg.action!)) {
      this.broadcast({ type: 'action', id: c.id, action: msg.action }, ws);
    } else if (c.combat && msg.type === 'world' && c.id === this.host()) {
      const world = worldOf(msg.world);
      if (world) { await this.ctx.storage.put('world', world); this.broadcast({ type: 'world', world }, ws); }
    } else if (c.combat && msg.type === 'combat') {
      const authority = c.id === this.host();
      const event = eventOf(msg.event, authority);
      if (event) {
        const packet = { type: 'combat', id: c.id, event };
        if (authority) this.broadcast(packet, ws);
        else { const h = this.ctx.getWebSockets().find(s => (s.deserializeAttachment() as Connection).id === this.host()); if (h) this.send(h, packet); }
      }
    } else if (msg.type === 'chat' && now - c.chatAt >= 700) {
      const text = clean(msg.text, 200);
      if (text) { c.chatAt = now; this.broadcast({ type: 'chat', id: c.id, name: c.spec.name, text }); }
    } else if (msg.type === 'leave') { ws.close(1000, 'Left room'); }
    // Attachments restore current character/state and rate limits after hibernation.
    ws.serializeAttachment(c);
  }
  webSocketClose(ws: WebSocket) { this.depart(ws); }
  webSocketError(ws: WebSocket) { this.depart(ws); }
  private depart(ws: WebSocket) {
    const c = ws.deserializeAttachment() as Connection | null;
    if (c?.spec) {
      this.broadcast({ type: 'left', id: c.id }, ws);
      c.spec = null; ws.serializeAttachment(c);
      this.broadcast({ type: 'authority', host: this.host() });
    }
  }
  private host() {
    return this.ctx.getWebSockets().map(s => s.deserializeAttachment() as Connection).filter(c => c.spec && c.combat).sort((a,b) => (a.joinedAt! - b.joinedAt!) || a.id.localeCompare(b.id))[0]?.id ?? '';
  }
  private send(ws: WebSocket, data: unknown) {
    try { ws.send(JSON.stringify(data)); } catch { /* close callback cleans up */ }
  }
  private broadcast(data: unknown, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) if (ws !== except && (ws.deserializeAttachment() as Connection).spec) this.send(ws, data);
  }
  async alarm() {
    if (this.ctx.getWebSockets().length) { await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000); return; }
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, game: 'crabcraft-multiplayer' });
    if (url.pathname !== '/multiplayer' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const origin = request.headers.get('Origin');
    if (origin && !['https://inh-crabcraft-multiplayer.vercel.app', 'https://seonn.dev'].includes(origin)) return new Response('Origin forbidden', { status: 403 });
    const mode = url.searchParams.get('mode');
    let room = (url.searchParams.get('room') ?? '').toUpperCase();
    if (mode === 'create') {
      const bytes = crypto.getRandomValues(new Uint8Array(3));
      room = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    } else if (mode !== 'join' || !/^[A-F0-9]{6}$/.test(room)) return new Response('Invalid room', { status: 400 });
    url.searchParams.set('room', room);
    return env.ROOMS.getByName(room).fetch(new Request(url, request));
  },
} satisfies ExportedHandler<Env>;
