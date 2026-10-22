import { finite, integer } from './protocol.ts';
/** Deadline steps are fixed dt; overload drops elapsed steps instead of unbounded replay. */
export class DeadlineScheduler {
  next: number; dropped = 0;
  readonly period: number; readonly maxCatchup: number;
  constructor(hz: number, now: number, maxCatchup = 4) {
    finite(hz, 'hz'); finite(now, 'time'); if (hz <= 0 || hz > 1000) throw new Error('invalid hz');
    this.period = 1000 / hz; this.next = now + this.period; this.maxCatchup = integer(maxCatchup, 1, 16, 'catchup');
  }
  idle(now: number): void { this.next = finite(now, 'time') + this.period; }
  /**
   * run() with a time budget: due steps more than maxCatchup periods behind are dropped first (the same count run() drops
   * when steps are fast), then due steps run until spent() reaches budgetMs. The rest stay due for the next call.
   */
  runFor(now: number, step: () => void, spent: () => number, budgetMs: number): number {
    finite(now, 'time'); let count = 0;
    if (now >= this.next) {
      const due = Math.floor((now - this.next) / this.period) + 1;
      if (due > this.maxCatchup) { const missed = due - this.maxCatchup; this.dropped += missed; this.next += missed * this.period; }
    }
    while (now >= this.next) { step(); this.next += this.period; count++; if (spent() >= budgetMs) break; }
    return count;
  }
  run(now: number, step: () => void): number {
    finite(now, 'time'); let count = 0;
    while (now >= this.next && count < this.maxCatchup) { step(); this.next += this.period; count++; }
    if (now >= this.next) { const missed = Math.floor((now - this.next) / this.period) + 1; this.dropped += missed; this.next += missed * this.period; }
    return count;
  }
}
