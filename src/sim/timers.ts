import type { AreaTimers, TimerAction, TimerState } from './types.ts';
import { immutable } from './events.ts';
import { Ids } from './random.ts';
export class Timers implements AreaTimers {
  private entries = new Map<number, TimerState>();
  private ids = new Ids();
  private limit: number;
  constructor(limit: number) { if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid timer limit'); this.limit = limit; }
  get nextId(): number { return this.ids.nextValue; }
  countDue(now:number,kinds:readonly TimerAction['kind'][]):number {let count=0;for(const timer of this.entries.values())if(timer.due<=now&&kinds.includes(timer.action.kind))count++;return count;}
  schedule(due: number, action: TimerAction): number { if (!Number.isFinite(due)) throw new RangeError('Nonfinite due time'); if (this.entries.size >= this.limit) throw new RangeError('Timer capacity exceeded'); const owned = immutable(action); const id = this.ids.next(); this.entries.set(id, {id, insertion:id, due, action: owned}); return id; }
  cancel(id: number): void { this.entries.delete(id); }
  update(now: number, dispatch: (action: TimerAction) => void): void { const due = [...this.entries.values()].filter(t => t.due <= now); for (const t of due) this.entries.delete(t.id); for (const t of due) dispatch(t.action); }
  removeWhere(predicate: (action: TimerAction) => boolean): void { for (const t of this.entries.values()) if (predicate(t.action)) this.entries.delete(t.id); }
  snapshot(): readonly TimerState[] { return immutable([...this.entries.values()]); }
  clear(): void { this.entries.clear(); }
}
