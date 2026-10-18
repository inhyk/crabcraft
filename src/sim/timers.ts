import type { AreaTimers, TimerAction, TimerState } from './types.ts';
import { immutable } from './events.ts';
import { Ids } from './random.ts';
export class Timers implements AreaTimers {
  private entries = new Map<number, TimerState>();
  private ids = new Ids();
  private pending:Map<number,TimerState>|null=null;
  private cancelled:Set<number>|null=null;
  private limit: number;
  constructor(limit: number) { if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid timer limit'); this.limit = limit; }
  get nextId(): number { return this.ids.nextValue; }
  countDue(now:number,kinds:readonly TimerAction['kind'][]):number {let count=0;for(const timer of this.entries.values())if(!this.cancelled?.has(timer.id)&&timer.due<=now&&kinds.includes(timer.action.kind))count++;if(this.pending)for(const timer of this.pending.values())if(timer.due<=now&&kinds.includes(timer.action.kind))count++;return count;}
  schedule(due: number, action: TimerAction): number { if (!Number.isFinite(due)) throw new RangeError('Nonfinite due time'); if (!this.pending&&this.entries.size >= this.limit) throw new RangeError('Timer capacity exceeded'); const owned = immutable(action); const id = this.ids.next(); (this.pending??this.entries).set(id, {id, insertion:id, due, action: owned}); return id; }
  cancel(id: number): void { if(this.pending){if(!this.pending.delete(id)&&this.entries.has(id))this.cancelled!.add(id);}else this.entries.delete(id); }
  /** Defer cosmetic capacity checks until the complete nested economic operation is staged. */
  transaction(run:()=>void,beforeCommit?:()=>void):void {
    if(this.pending){run();return;}
    this.pending=new Map();this.cancelled=new Set();
    try{run();if(this.entries.size-this.cancelled.size+this.pending.size>this.limit)throw new RangeError('Timer capacity exceeded');beforeCommit?.();for(const id of this.cancelled)this.entries.delete(id);for(const [id,timer]of this.pending)this.entries.set(id,timer);}
    finally{this.pending=null;this.cancelled=null;}
  }
  update(now: number, dispatch: (action: TimerAction) => void): void { if(this.pending)throw new Error('Timer dispatch during transaction');const due = [...this.entries.values()].filter(t => t.due <= now); for (const t of due) this.entries.delete(t.id); for (const t of due) dispatch(t.action); }
  removeWhere(predicate: (action: TimerAction) => boolean): void { for (const t of this.entries.values()) if (predicate(t.action)) this.cancel(t.id);if(this.pending)for(const t of this.pending.values())if(predicate(t.action))this.cancel(t.id); }
  snapshot(): readonly TimerState[] { return immutable([...this.entries.values()].filter(t=>!this.cancelled?.has(t.id)).concat([...(this.pending?.values()??[])])); }
  clear(): void {if(this.pending){this.pending.clear();for(const id of this.entries.keys())this.cancelled!.add(id);}else this.entries.clear();}
}
