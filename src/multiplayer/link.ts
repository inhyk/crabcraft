// The multiplayer socket and how it comes back. No DOM or game imports, so server/rooms.test.mjs drives
// it against the real relay with Node's WebSocket.

/** `enter`: a public shard of the current world area. `create` and `join`: a code room with friends. */
export type Mode = 'enter' | 'create' | 'join';
export type Message = { type: string; [key: string]: any };
export type Lost = {
  mode: Mode;
  room: string;
  /** Tries since the socket was last welcomed, this one included. */
  attempt: number;
  /** Milliseconds until the next try, or null when a code room gives up. */
  delay: number | null;
  /** A welcome came on an earlier socket of this connection. */
  welcomed: boolean;
};
export type LinkHandlers = {
  /** The first message on each new socket: what to ask the server for. */
  hello(mode: Mode, room: string): unknown;
  message(msg: Message): void;
  lost(info: Lost): void;
  /** Welcomed again `gap` ms after the socket dropped; `restart` when the server said it was restarting. */
  back?(info: { gap: number; restart: boolean }): void;
};
export type LinkOptions = { random?: () => number; welcomeTimeout?: number };

/** A code room tries this many times, as before, then the player goes back to the public world. */
export const ROOM_RETRIES = 5;
export const ROOM_RETRY_MS = 1500;
/** The public world: about 1, 2, 4, 8 and 16 s, then every 30 s, each ±25% so a crowd does not retry in step. */
export function backoff(attempt: number, random = Math.random): number {
  return Math.round(Math.min(30000, 1000 * 2 ** Math.max(0, attempt)) * (0.75 + 0.5 * random()));
}
/** After the server's `restarting` notice: 0.5 to 3 s, to spread everyone's first try. */
export const restartDelay = (random = Math.random) => Math.round(500 + 2500 * random());

export class Link {
  ws: WebSocket | null = null;
  retry: ReturnType<typeof setTimeout> | null = null;
  mode: Mode = 'enter';
  room = '';
  private attempt = 0;
  /** Backoff steps taken since the last welcome; the try after a restart notice does not count. */
  private step = 0;
  private welcomed = false;
  private lostAt = 0;
  private restarting = false;
  private restarted = false;
  private disposed = false;
  private readonly url: (mode: Mode, room: string) => string | URL;
  private readonly handlers: LinkHandlers;
  private readonly random: () => number;
  private readonly welcomeTimeout: number;

  constructor(url: (mode: Mode, room: string) => string | URL, handlers: LinkHandlers, options: LinkOptions = {}) {
    this.url = url;
    this.handlers = handlers;
    this.random = options.random ?? Math.random;
    this.welcomeTimeout = options.welcomeTimeout ?? 10000;
  }

  get open() { return this.ws?.readyState === WebSocket.OPEN; }
  get connecting() { return this.ws?.readyState === WebSocket.CONNECTING; }

  /** A new connection: drops the current socket and any pending retry. */
  connect(mode: Mode, room = '') {
    if (this.disposed) return;
    this.stop();
    this.mode = mode; this.room = room;
    this.attempt = this.step = 0; this.welcomed = false; this.lostAt = 0; this.restarting = this.restarted = false;
    this.dial();
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 65536) this.ws.send(JSON.stringify(msg));
  }

  /** Closes the socket without retrying. */
  stop() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws; this.ws = null;
    ws?.close();
  }

  dispose() { this.disposed = true; this.stop(); }

  private dial() {
    const { mode, room } = this;
    const ws = new WebSocket(this.url(mode, room));
    this.ws = ws;
    // Until the welcome: a server that never answers is treated as a dropped socket.
    const timeout = setTimeout(() => ws.close(), this.welcomeTimeout);
    ws.onopen = () => { if (this.ws === ws) this.send(this.handlers.hello(mode, room)); };
    ws.onmessage = e => {
      if (this.ws !== ws || this.disposed) return;
      let msg: Message;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'restarting') { this.restarting = true; return; }
      if (msg.type === 'welcome') {
        clearTimeout(timeout);
        const gap = this.lostAt ? Date.now() - this.lostAt : 0, restart = this.restarted;
        // Later retries rejoin what the server put us in: a created room is joined by its code.
        if (msg.public) { this.mode = 'enter'; this.room = ''; } else { this.mode = 'join'; this.room = String(msg.room); }
        this.attempt = this.step = 0; this.welcomed = true; this.lostAt = 0; this.restarted = false;
        this.handlers.message(msg);
        if (gap) this.handlers.back?.({ gap, restart });
        return;
      }
      this.handlers.message(msg);
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.ws !== ws || this.disposed) return;
      this.ws = null;
      if (this.welcomed && !this.lostAt) this.lostAt = Date.now();
      const restart = this.restarting;
      this.restarting = false;
      if (restart) this.restarted = true;
      const attempt = ++this.attempt;
      let delay: number | null;
      if (this.mode === 'enter') delay = restart ? restartDelay(this.random) : backoff(this.step++, this.random);
      // A code room retries only a connection it once had, as before.
      else delay = this.welcomed && attempt <= ROOM_RETRIES ? (restart ? restartDelay(this.random) : ROOM_RETRY_MS) : null;
      if (delay !== null) this.retry = setTimeout(() => { this.retry = null; if (!this.disposed) this.dial(); }, delay);
      this.handlers.lost({ mode: this.mode, room: this.room, attempt, delay, welcomed: this.welcomed });
    };
  }
}
