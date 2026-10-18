import { CHAT_MAX, filterText, maskSplitPhone, nameAllowed, NEUTRAL_NAME } from './filter.ts';

// Spam limits, recent lines, reports and mutes for the relay's chat. Children play in public shards with
// strangers, so every line is filtered (./filter.ts) and players can block (in the browser) and report (here).

export const REASONS = ['abuse', 'personal', 'harassment', 'other'] as const;
export type Reason = typeof REASONS[number];
export type Line = { at: number; text: string };
export type TalkState = { sent: number[]; lines: Line[] };
export type Refusal = 'fast' | 'burst' | 'repeat';
/** One report as the relay hands it to storage. Never an IP address. */
export type Report = {
  at: number;
  room: string;
  reason: Reason;
  reporter: { session: string; name: string };
  target: { session: string; name: string; lines: Line[] };
  /** This report muted the target. */
  muted: boolean;
};

export const CHAT = {
  /** Least time between two lines from one player. */
  gap: 700,
  /** At most `burst` lines in any `burstMs`. */
  burst: 5, burstMs: 10_000,
  /** The same text again within this long is dropped. */
  repeatMs: 30_000,
  /** Lines kept per player for reports. */
  lines: 20,
  /** A phone number split over the last `splitLines` lines within `splitMs` is masked (as the hub does). */
  splitLines: 2, splitMs: 30_000,
  /** This many different players reporting one player within `reportMs` mute them for `muteMs`. */
  reporters: 3, reportMs: 10 * 60_000, muteMs: 30 * 60_000,
  /** Reports one player may send in `reportMs`. */
  reportsEach: 10,
};

/** A name strangers may see: one with a bad word or contact details is replaced, not shown masked. */
export const shownName = (name: string) => nameAllowed(name) ? name : NEUTRAL_NAME;
/** The client's random per-tab id, so a reconnect keeps its mute; otherwise the connection's own id. */
export const sessionOf = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : fallback;
export const reasonOf = (value: unknown): Reason | null => REASONS.find(r => r === value) ?? null;

/** What one player said lately. */
export class Talk {
  private sent: number[] = [];
  lines: Line[] = [];

  /** Restores server-owned storage only. Descriptor reads reject accessors without invoking them. */
  constructor(state?: TalkState) {
    if (state === undefined) return;
    const invalid = () => { throw new Error('invalid talk state'); };
    const fields = (value: unknown, keys: string[]) => {
      if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
      const all = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(all).length !== keys.length || keys.some(key => !all[key] || !('value' in all[key]))) return invalid();
      return keys.map(key => all[key].value as unknown);
    };
    const array = (value: unknown, max: number): unknown[] => {
      if (!Array.isArray(value) || value.length > max) return invalid();
      const all = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(all).length !== value.length + 1) return invalid();
      return Array.from({ length: value.length }, (_, i) => {
        const field = all[String(i)]; return field && 'value' in field ? field.value : invalid();
      });
    };
    const time = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : invalid();
    const [sent, lines] = fields(state, ['sent', 'lines']);
    this.sent = array(sent, CHAT.burst).map(time);
    this.lines = array(lines, CHAT.lines).map(value => {
      const [at, text] = fields(value, ['at', 'text']);
      if (typeof text !== 'string' || !text || text.length > CHAT_MAX) return invalid();
      const filtered = filterText(text).text;
      if (!filtered) return invalid();
      return { at: time(at), text: filtered };
    });
    for (const list of [this.sent, this.lines.map(line => line.at)]) {
      if (list.some((at, i) => i > 0 && at < list[i - 1])) invalid();
    }
  }

  /** Independent copies keep caller mutation out of the next rate-limit decision. */
  snapshot(): TalkState { return { sent: [...this.sent], lines: this.lines.map(line => ({ ...line })) }; }

  /** Filters a line and applies the limits: the text to send, a refusal to tell the sender, or null for nothing to send. */
  say(raw: unknown, now: number): { text: string } | { refused: Refusal } | null {
    if (typeof raw !== 'string') return null;
    let { text } = filterText(raw);
    if (!text) return null;
    const last = this.lines[this.lines.length - 1];
    if (last && now - last.at < CHAT.gap) return { refused: 'fast' };
    this.sent = this.sent.filter(at => now - at < CHAT.burstMs);
    if (this.sent.length >= CHAT.burst) return { refused: 'burst' };
    const recent = this.lines.filter(l => now - l.at < CHAT.repeatMs);
    if (recent.some(l => l.text === text)) return { refused: 'repeat' };
    text = maskSplitPhone(this.lines.filter(l => now - l.at < CHAT.splitMs).slice(-CHAT.splitLines).map(l => l.text), text);
    this.sent.push(now);
    this.lines.push({ at: now, text });
    if (this.lines.length > CHAT.lines) this.lines.shift();
    return { text };
  }
}

/** Reports and the mutes they lead to, by player session. In memory: a server restart forgives. */
export class Moderation {
  private mutes = new Map<string, number>();
  /** Target session to reporter session to when. */
  private reports = new Map<string, Map<string, number>>();
  /** Reporter session to the times of their reports. */
  private sent = new Map<string, number[]>();

  muted(session: string, now: number) { return (this.mutes.get(session) ?? 0) > now; }

  /** Counts a report. `ok` is false for a repeat or one over the reporter's limit; `muted` when this one muted the target. */
  report(reporter: string, target: string, now: number) {
    const mine = (this.sent.get(reporter) ?? []).filter(at => now - at < CHAT.reportMs);
    const by = this.reports.get(target) ?? new Map<string, number>();
    for (const [who, at] of by) if (now - at >= CHAT.reportMs) by.delete(who);
    if (reporter === target || by.has(reporter) || mine.length >= CHAT.reportsEach) return { ok: false, muted: false };
    mine.push(now); this.sent.set(reporter, mine);
    by.set(reporter, now); this.reports.set(target, by);
    const muted = by.size >= CHAT.reporters && !this.muted(target, now);
    if (muted) { this.mutes.set(target, now + CHAT.muteMs); this.reports.delete(target); }
    return { ok: true, muted };
  }

  /** Forgets what has run out. */
  sweep(now: number) {
    for (const [s, until] of this.mutes) if (until <= now) this.mutes.delete(s);
    for (const [s, by] of this.reports) { for (const [who, at] of by) if (now - at >= CHAT.reportMs) by.delete(who); if (!by.size) this.reports.delete(s); }
    for (const [s, list] of this.sent) { const fresh = list.filter(at => now - at < CHAT.reportMs); if (fresh.length) this.sent.set(s, fresh); else this.sent.delete(s); }
  }
}
