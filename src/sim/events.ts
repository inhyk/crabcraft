import type { CoreEvent, EntityRef, EventRecord } from './types.ts';
/** Copy only plain finite value data. Reject accidental functions, renderer classes and cycles. */
export function copyValue<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'undefined') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Nonfinite simulation value'); return value; }
  if (typeof value !== 'object') throw new TypeError('Non-value simulation payload');
  if (seen.has(value)) throw new TypeError('Cyclic simulation payload');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new TypeError('Non-plain simulation payload');
  seen.add(value);
  const result = Array.isArray(value) ? value.map(v => copyValue(v, seen)) : Object.fromEntries(Object.entries(value).map(([k,v]) => [k, copyValue(v, seen)]));
  seen.delete(value); return result as T;
}
export function freezeValue<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeValue(child); Object.freeze(value); } return value; }
export const immutable = <T>(value: T): T => freezeValue(copyValue(value));
export const refKey = (ref: EntityRef): string => JSON.stringify([ref.area, ref.id, ref.life]);
export const sameRef = (a: EntityRef, b: EntityRef): boolean => a.area === b.area && a.id === b.id && a.life === b.life;
export class Events {
  private list: EventRecord[] = [];
  private order = 0;
  private transactionEvents: {tick:number;event:CoreEvent}[] | null = null;
  private capacity: number;
  constructor(capacity: number) { if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid event limit'); this.capacity = capacity; }
  get nextOrder(): number { return this.order; }
  get count(): number { return this.list.length; }
  assertRoom(count: number): void { if (this.list.length + count > this.capacity) throw new RangeError('Event capacity exceeded'); }
  assertPendingRoom():void {this.assertRoom(this.transactionEvents?.length??0);}
  transaction(run:()=>void):void { if(this.transactionEvents){run();return;}this.transactionEvents=[];try{run();const pending=this.transactionEvents;this.assertRoom(pending.length);this.transactionEvents=null;for(const e of pending)this.emit(e.tick,e.event);}finally{this.transactionEvents=null;} }
  emit(tick: number, event: CoreEvent): void { if(this.transactionEvents){this.transactionEvents.push({tick,event:immutable(event)});return;}this.assertRoom(1); const record = immutable({ tick, order: this.order, event }); this.order++; this.list.push(record); }
  peek():readonly EventRecord[] {return Object.freeze([...this.list]);}
  drain(): readonly EventRecord[] { const result = Object.freeze(this.list); this.list = []; return result; }
}
