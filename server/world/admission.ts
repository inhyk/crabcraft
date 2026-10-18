import { createHash, randomBytes } from 'node:crypto';

/** Server-internal binding. sessionKey is the opaque DB token hash, never the raw cookie token. */
export type SessionBinding = { accountId: string; sessionKey: string; expiresAt: number };
export type SessionResolver = (binding: SessionBinding) => Promise<SessionBinding | null>;
export type WorldAdmissionOptions = { ttlMs?: number; maxTickets?: number; maxPerAccount?: number; now?: () => number };
export class WorldAdmissionError extends Error {
  readonly code: 'origin' | 'ticket' | 'session' | 'capacity';
  constructor(code: WorldAdmissionError['code']) { super('world admission ' + code); this.name = 'WorldAdmissionError'; this.code = code; }
}
const digest = (ticket: string) => createHash('sha256').update(ticket).digest('hex');
const validOrigin = (origin: unknown): origin is string => {
  if (typeof origin !== 'string' || origin.length > 512) return false;
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.origin === origin; } catch { return false; }
};
const validBinding = (binding: SessionBinding, now: number) => /^g[a-f0-9]{23}$/.test(binding.accountId) && /^[a-f0-9]{64}$/.test(binding.sessionKey) && Number.isSafeInteger(binding.expiresAt) && binding.expiresAt > now;
type Pending = { binding: SessionBinding; origin: string; expiresAt: number };

/** One process, shared by account HTTP and the future /world host. Restart discards outstanding tickets. */
export class WorldTicketRegistry {
  private readonly pending = new Map<string, Pending>();
  private readonly counts = new Map<string, number>();
  private readonly resolveSession: SessionResolver;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxTickets: number;
  private readonly maxPerAccount: number;
  constructor(resolveSession: SessionResolver, options: WorldAdmissionOptions = {}) {
    this.resolveSession = resolveSession; this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 30000; this.maxTickets = options.maxTickets ?? 4096; this.maxPerAccount = options.maxPerAccount ?? 4;
    for (const [value, max] of [[this.ttlMs, 60000], [this.maxTickets, 65536], [this.maxPerAccount, 64]]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('invalid world admission bounds');
    }
  }
  private remove(key: string, pending: Pending) {
    this.pending.delete(key); const count = this.counts.get(pending.binding.accountId)! - 1;
    if (count) this.counts.set(pending.binding.accountId, count); else this.counts.delete(pending.binding.accountId);
  }
  private prune(now: number) { for (const [key, pending] of this.pending) if (pending.expiresAt <= now) this.remove(key, pending); }
  issue(binding: SessionBinding, origin: string): { ticket: string; expiresAt: number } {
    const now = this.now(); this.prune(now);
    if (!validOrigin(origin)) throw new WorldAdmissionError('origin');
    if (!validBinding(binding, now)) throw new WorldAdmissionError('session');
    if (this.pending.size >= this.maxTickets || (this.counts.get(binding.accountId) ?? 0) >= this.maxPerAccount) throw new WorldAdmissionError('capacity');
    const ticket = randomBytes(32).toString('base64url'), expiresAt = Math.min(now + this.ttlMs, binding.expiresAt);
    this.pending.set(digest(ticket), { binding: { accountId: binding.accountId, sessionKey: binding.sessionKey, expiresAt: binding.expiresAt }, origin, expiresAt });
    this.counts.set(binding.accountId, (this.counts.get(binding.accountId) ?? 0) + 1);
    return { ticket, expiresAt };
  }
  /** Removes before the first await: replay/racing consumes, including DB failure, cannot reuse a ticket. */
  async consume(ticket: unknown, origin: unknown): Promise<SessionBinding> {
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new WorldAdmissionError('ticket');
    const key = digest(ticket), pending = this.pending.get(key);
    if (!pending) throw new WorldAdmissionError('ticket');
    this.remove(key, pending);
    if (!validOrigin(origin) || origin !== pending.origin) throw new WorldAdmissionError('origin');
    if (pending.expiresAt <= this.now()) throw new WorldAdmissionError('ticket');
    const binding = await this.revalidate(pending.binding);
    if (!binding || pending.expiresAt <= this.now()) throw new WorldAdmissionError('session');
    return binding;
  }
  /** Future host uses this at its lifecycle boundaries to reject expired/revoked active sessions. */
  async revalidate(binding: SessionBinding): Promise<SessionBinding | null> {
    if (!validBinding(binding, this.now())) return null;
    const current = await this.resolveSession(binding);
    if (!current || current.accountId !== binding.accountId || current.sessionKey !== binding.sessionKey) return null;
    const result = { accountId: current.accountId, sessionKey: current.sessionKey, expiresAt: Math.min(current.expiresAt, binding.expiresAt) };
    return validBinding(result, this.now()) ? result : null;
  }
}
