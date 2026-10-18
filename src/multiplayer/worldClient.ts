import { captureEdges, sampleHeld, type PlayerInputGame } from '../game/playerInput.ts';
import type { HeldInput } from '../sim/input.ts';
import type { ChannelKind, PlayerCommand } from '../sim/types.ts';
import {
  GameplayReceiver, LIMITS, binding as validateBinding, clone, encodeControl, sameBinding,
  type GameplayCatalog, type GameplayState, type WireBinding, type WireHeader,
} from '../../server/world/gameplay/protocol.ts';
import { encodeInput, validateCommand, type GameplayCommand, type GameplayInput } from '../../server/world/gameplay/intents.ts';
import type { CommandResult } from '../../server/world/gameplay/events.ts';
import type { EventRecord } from '../sim/types.ts';

export type WorldConnectionState = 'idle' | 'ticket' | 'connecting' | 'authenticating' | 'queued' | 'loading' | 'admitted' | 'recovering' | 'reconnecting' | 'authRequired' | 'closed';
export interface WorldSocket extends EventTarget {
  readonly readyState: number;
  readonly bufferedAmount: number;
  binaryType: BinaryType;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}
export interface WorldClientOptions {
  catalog: GameplayCatalog;
  origin?: string;
  fetch?: typeof globalThis.fetch;
  socket?: (url: string) => WorldSocket;
  now?: () => number;
  windowTarget?: EventTarget | null;
  documentTarget?: EventTarget | null;
  hidden?: () => boolean;
  resetInput?: () => void;
  onState?: (state: WorldConnectionState, code?: string) => void;
  onSnapshot?: (state: GameplayState, events: readonly EventRecord[], results: readonly CommandResult[]) => void;
  onEvents?: (events: readonly EventRecord[], results: readonly CommandResult[]) => void;
  onReset?: (reason: string) => void;
  onRejected?: (code: string) => void;
  handshakeMs?: number;
  recoveryMs?: number;
  maxReconnects?: number;
}
const NEUTRAL: HeldInput = { forward: 0, strafe: 0, turn: 0, sprint: false, steeringYaw: null, heldChannel: null };
const MAX_PENDING = 128, MAX_LEDGER = 128, MAX_BUFFERED = 65536, INPUT_PERIOD_MS = 1000 / 30;
const ownKeys = (value: object, expected: readonly string[]): value is Record<string, unknown> => Object.keys(value).every(key => expected.includes(key)) && expected.every(key => Object.hasOwn(value, key));
async function readBoundedText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > 4096) throw new Error('ticket-response-size');
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error('ticket-response-size'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Authenticated v3 transport. It never constructs or steps a browser Area. */
export class WorldClient {
  private readonly options: WorldClientOptions;
  private readonly catalog: GameplayCatalog;
  private readonly now: () => number;
  private readonly windowTarget: EventTarget | null;
  private readonly documentTarget: EventTarget | null;
  private socket: WorldSocket | null = null;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fragmentTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;
  private focused = true;
  private receiver: GameplayReceiver | null = null;
  private binding: WireBinding | null = null;
  private held: HeldInput = { ...NEUTRAL };
  private pending: GameplayCommand[] = [];
  private ledger = new Map<number, GameplayInput>();
  private sequence = 0;
  private controlSequence = 0;
  private accepted = 0;
  private consumed = 0;
  private nextSend = 0;
  private attempts = 0;
  private characterId = '';
  private status: WorldConnectionState = 'idle';
  private current: GameplayState | null = null;
  private queueInfo: { world: string; position: number } | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;

  constructor(options: WorldClientOptions) {
    this.options = options;
    this.catalog = clone(options.catalog);
    this.now = options.now ?? (() => performance.now());
    this.windowTarget = options.windowTarget === undefined ? typeof window === 'undefined' ? null : window : options.windowTarget;
    this.documentTarget = options.documentTarget === undefined ? typeof document === 'undefined' ? null : document : options.documentTarget;
    for (const value of [options.handshakeMs ?? 10000, options.recoveryMs ?? 5000]) if (!Number.isFinite(value) || value <= 0) throw new RangeError('Invalid world deadline');
    if (!Number.isSafeInteger(options.maxReconnects ?? 5) || (options.maxReconnects ?? 5) < 0) throw new RangeError('Invalid reconnect limit');
    this.windowTarget?.addEventListener('blur', this.onBlur);
    this.windowTarget?.addEventListener('focus', this.onFocus);
    this.documentTarget?.addEventListener('visibilitychange', this.onVisibility);
  }

  get state(): WorldConnectionState { return this.status; }
  get view(): GameplayState | null { return this.current ? clone(this.current) : null; }
  get queue() { return this.queueInfo ? { ...this.queueInfo } : null; }
  get inputWatermarks() { return { sent: this.sequence, accepted: this.accepted, consumed: this.consumed, pending: this.pending.length, unconsumed: this.ledger.size }; }

  /** Resolves only after a complete admitted baseline; each new socket obtains a fresh ticket. */
  connect(characterId: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('World client disposed'));
    if (typeof characterId !== 'string' || !characterId || characterId.length > 128) return Promise.reject(new TypeError('Invalid character ID'));
    this.attempts = 0;
    return this.begin(characterId);
  }

  private begin(characterId: string): Promise<void> {
    this.stopAttempt('replaced');
    this.characterId = characterId;
    const generation = this.generation;
    const promise = new Promise<void>((resolve, reject) => { this.resolveConnect = resolve; this.rejectConnect = reject; });
    this.abort = new AbortController();
    this.setState('ticket');
    this.deadline(this.options.handshakeMs ?? 10000, generation, 'handshake-timeout');
    void this.dial(generation, characterId, this.abort.signal);
    return promise;
  }

  private async dial(generation: number, characterId: string, signal: AbortSignal): Promise<void> {
    try {
      const origin = new URL(this.options.origin ?? location.origin);
      if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('invalid-origin');
      const response = await (this.options.fetch ?? fetch)(new URL('/api/account/world-ticket', origin), {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', 'X-Crabcraft-Account': '1' }, body: '{}',
      });
      if (!this.active(generation)) return;
      if (!response.ok) { this.fail(response.status === 401 || response.status === 403 ? 'session' : 'ticket', response.status !== 401 && response.status !== 403); return; }
      const text = await readBoundedText(response);
      if (!this.active(generation)) return;
      if (text.length > 4096) throw new Error('ticket-response-size');
      const result: unknown = JSON.parse(text);
      if (!result || typeof result !== 'object' || !('ticket' in result) || typeof result.ticket !== 'string' || result.ticket.length < 1 || result.ticket.length > 512) throw new Error('ticket-response');
      const url = new URL('/world', origin); url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = (this.options.socket ?? (address => new WebSocket(address)))(url.href);
      if (!this.active(generation)) { socket.close(); return; }
      this.socket = socket; socket.binaryType = 'arraybuffer';
      this.setState('connecting');
      socket.addEventListener('open', () => {
        if (!this.active(generation, socket)) return;
        this.setState('authenticating');
        socket.send(JSON.stringify({ type: 'authenticate', ticket: result.ticket, characterId }));
      });
      socket.addEventListener('message', event => {
        if (this.active(generation, socket)) this.receive((event as MessageEvent).data);
      });
      socket.addEventListener('close', () => { if (this.active(generation, socket)) this.fail('disconnected', true); });
      socket.addEventListener('error', () => { if (this.active(generation, socket)) this.fail('transport', true); });
    } catch {
      if (this.active(generation)) this.fail('connection', true);
    }
  }

  private active(generation: number, socket?: WorldSocket): boolean { return !this.disposed && generation === this.generation && (!socket || socket === this.socket); }
  private setState(state: WorldConnectionState, code?: string): void { this.status = state; this.options.onState?.(state, code); }
  private clearTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private clearFragmentTimer(): void { if (this.fragmentTimer !== null) clearTimeout(this.fragmentTimer); this.fragmentTimer = null; }
  private deadline(ms: number, generation: number, reason: string): void {
    this.clearTimer(); this.timer = setTimeout(() => { if (this.active(generation)) this.fail(reason, true); }, ms);
  }

  private receive(data: unknown): void {
    if (typeof data === 'string') { this.receiveBootstrap(data); return; }
    if (!(data instanceof ArrayBuffer) || !this.receiver || !this.binding) { this.fail('unexpected-frame', false); return; }
    let result: ReturnType<GameplayReceiver['accept']>;
    try {
      result = this.receiver.accept(new Uint8Array(data), this.now() / 1000);
      if (!result) {
        if (this.fragmentTimer === null) {
          const generation = this.generation;
          this.fragmentTimer = setTimeout(() => { this.fragmentTimer = null; if (this.active(generation)) this.recover('fragment'); }, LIMITS.assemblySeconds * 1000);
        }
        return;
      }
      this.clearFragmentTimer();
      const header = this.receiver.header;
      if (header) this.acknowledge(header);
    } catch { this.clearFragmentTimer(); this.recover('gap'); return; }
    if (result.kind === 'control') {
      const control = result.control;
      if (control.type === 'error') this.fail(control.code, control.retryable);
      else if (control.type === 'restarting') this.fail('restarting', true);
      return;
    }
    if (result.kind === 'snapshot') {
      this.clearTimer(); this.attempts = 0; this.current = clone(result.state);
      this.setState('admitted'); this.resolveConnect?.(); this.resolveConnect = this.rejectConnect = null;
      this.options.onSnapshot?.(clone(result.state), result.events, result.results);
    } else this.options.onEvents?.(result.events, result.results);
  }

  private receiveBootstrap(text: string): void {
    try {
      if (text.length > 4096) throw new Error('oversized bootstrap');
      const raw: unknown = JSON.parse(text);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('type' in raw)) throw new Error('invalid bootstrap');
      const message = raw as Record<string, unknown>;
      if (message.type === 'world-bound') {
        if (!ownKeys(message, ['type', 'session', 'area', 'epoch', 'catalog'])) throw new Error('bootstrap fields');
        const { type: _type, ...binding } = message;
        validateBinding(binding);
        if (binding.catalog !== this.catalog.version) { this.fail('catalog', false); return; }
        if (this.binding && (binding.session !== this.binding.session || binding.epoch <= this.binding.epoch)) throw new Error('invalid stream reset');
        this.clearFragmentTimer(); this.clearInput(); this.current = null; this.queueInfo = null; this.options.onReset?.('binding');
        this.binding = clone(binding);
        this.receiver = new GameplayReceiver(binding, this.catalog);
        this.nextSend = this.now(); this.setState('loading');
        this.deadline(this.options.recoveryMs ?? 5000, this.generation, 'baseline-timeout');
      } else if (message.type === 'queued') {
        if (this.binding || !ownKeys(message, ['type', 'world', 'position']) || !['w1', 'w2', 'w3', 'w4'].includes(String(message.world)) || !Number.isSafeInteger(message.position) || Number(message.position) < 1) throw new Error('invalid queue');
        this.clearTimer(); this.queueInfo = { world: String(message.world), position: Number(message.position) }; this.setState('queued');
      } else if (message.type === 'error') {
        if (!ownKeys(message, ['type', 'code', 'retryable']) || typeof message.code !== 'string' || message.code.length > 128 || typeof message.retryable !== 'boolean') throw new Error('invalid error');
        this.fail(message.code, message.retryable);
      } else throw new Error('unknown bootstrap');
    } catch { this.fail('bootstrap', false); }
  }

  private acknowledge(header: WireHeader): void {
    if (!this.binding || !sameBinding(header, this.binding) || header.acceptedInput > this.sequence || header.consumedInput > header.acceptedInput || header.acceptedInput < this.accepted || header.consumedInput < this.consumed) throw new Error('invalid ACK');
    this.accepted = header.acceptedInput; this.consumed = header.consumedInput;
    for (const seq of this.ledger.keys()) if (seq <= this.consumed) this.ledger.delete(seq);
  }

  /** All UI callbacks and keyboard edges use this single ordered bounded command queue. */
  command(command: GameplayCommand): boolean {
    if (this.status !== 'admitted' || !this.binding || !this.focused || this.isHidden()) return this.reject('not-admitted');
    if (this.pending.length >= MAX_PENDING) return this.reject('command-capacity');
    try { validateCommand(command, this.catalog, this.binding.area); this.pending.push(clone(command)); return true; }
    catch { return this.reject('command'); }
  }
  private reject(code: string): false { this.options.onRejected?.(code); return false; }
  push(...commands: PlayerCommand[]): void { for (const command of commands) this.command(command); }
  sampleHeld(held: HeldInput): void { this.held = { ...held, steeringYaw: held.steeringYaw === null ? null : Math.atan2(Math.sin(held.steeringYaw), Math.cos(held.steeringYaw)) }; }

  capture(game: PlayerInputGame, dt: number, channel: ChannelKind | null = null): void {
    if (this.status !== 'admitted' || !this.focused || this.isHidden()) { this.held = { ...NEUTRAL }; return; }
    sampleHeld(game, this, dt, channel); captureEdges(game, this);
  }

  /** One transport frame per deadline, never replaying render-stall catch-up commands. */
  pump(nowMs = this.now()): void {
    if (!Number.isFinite(nowMs)) throw new TypeError('Invalid client clock');
    if (this.status !== 'admitted' || !this.binding || !this.socket || this.socket.readyState !== 1 || nowMs < this.nextSend) return;
    if (this.socket.bufferedAmount >= MAX_BUFFERED) { this.recover('gap'); return; }
    if (this.ledger.size >= MAX_LEDGER) { this.fail('input-ack-timeout', true); return; }
    if (!Number.isSafeInteger(this.sequence + 1)) { this.fail('sequence', false); return; }
    const intent: GameplayInput = { ...this.held, seq: this.sequence + 1, commands: this.pending.slice(0, 32) };
    try {
      const bytes = encodeInput({ binding: this.binding, intent }, this.catalog);
      this.socket.send(new Uint8Array(bytes).buffer);
    } catch { this.fail('send', true); return; }
    this.sequence = intent.seq; this.pending.splice(0, intent.commands.length); this.ledger.set(intent.seq, clone(intent));
    this.nextSend = nowMs + INPUT_PERIOD_MS;
  }

  private recover(reason: 'gap' | 'fragment' | 'baseline' | 'catalog'): void {
    if (this.status === 'recovering') return;
    if (!this.binding || !this.socket || this.socket.readyState !== 1 || this.socket.bufferedAmount >= MAX_BUFFERED) { this.fail('resync', true); return; }
    this.pending = []; this.held = { ...NEUTRAL }; this.options.resetInput?.();
    this.setState('recovering');
    const header: WireHeader = { ...this.binding, sequence: ++this.controlSequence, tick: 0, acceptedInput: 0, consumedInput: 0 };
    try {
      for (const bytes of encodeControl(header, { type: 'resync', lastSequence: this.receiver?.header?.sequence ?? 0, reason })) this.socket.send(new Uint8Array(bytes).buffer);
    } catch { this.fail('resync', true); return; }
    this.deadline(this.options.recoveryMs ?? 5000, this.generation, 'resync-timeout');
  }

  private clearInput(): void {
    this.pending = []; this.held = { ...NEUTRAL }; this.ledger.clear(); this.sequence = this.controlSequence = this.accepted = this.consumed = 0;
    this.options.resetInput?.();
  }
  private stopAttempt(reason: string): void {
    this.generation++; this.clearTimer(); this.clearFragmentTimer(); this.abort?.abort(); this.abort = null;
    const socket = this.socket; this.socket = null; socket?.close();
    this.rejectConnect?.(new Error(reason)); this.resolveConnect = this.rejectConnect = null;
    this.binding = null; this.receiver = null; this.current = null; this.queueInfo = null; this.clearInput(); this.options.onReset?.(reason);
  }
  private fail(code: string, retryable: boolean): void {
    this.stopAttempt(code);
    if (this.disposed) return;
    if (!retryable) { this.setState('authRequired', code); return; }
    if (this.attempts >= (this.options.maxReconnects ?? 5)) { this.setState('closed', code); return; }
    const delay = Math.min(30000, 1000 * 2 ** this.attempts++), generation = this.generation;
    this.setState('reconnecting', code);
    this.timer = setTimeout(() => {
      if (this.active(generation)) void this.begin(this.characterId).catch(() => {});
    }, delay);
  }
  private isHidden(): boolean { return this.options.hidden?.() ?? (typeof document !== 'undefined' && document.hidden); }
  private readonly onBlur = (): void => { this.focused = false; this.resetHeld(); };
  private readonly onFocus = (): void => { this.focused = true; this.resetHeld(); };
  private readonly onVisibility = (): void => { this.resetHeld(); };
  private resetHeld(): void {
    this.pending = []; this.held = { ...NEUTRAL }; this.options.resetInput?.();
    this.nextSend = this.now(); this.pump(this.nextSend);
  }
  dispose(): void {
    if (this.disposed) return;
    this.resetHeld(); this.disposed = true; this.stopAttempt('disposed'); this.setState('closed');
    this.windowTarget?.removeEventListener('blur', this.onBlur);
    this.windowTarget?.removeEventListener('focus', this.onFocus);
    this.documentTarget?.removeEventListener('visibilitychange', this.onVisibility);
  }
}
