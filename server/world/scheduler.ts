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
  run(now: number, step: () => void): number {
    finite(now, 'time'); let count = 0;
    while (now >= this.next && count < this.maxCatchup) { step(); this.next += this.period; count++; }
    if (now >= this.next) { const missed = Math.floor((now - this.next) / this.period) + 1; this.dropped += missed; this.next += missed * this.period; }
    return count;
  }
}
