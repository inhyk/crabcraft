import type { CoreEvent, EntityRef, EventRecord } from './types.ts';
/**
 * Copy only plain finite value data. Reject accidental functions, renderer classes and cycles.
 * The result, checks and errors are those of `value.map(copy)` for arrays and
 * `Object.fromEntries(Object.entries(value).map(copy))` for objects (holes stay holes, a `__proto__` key stays an own
 * property, a null-prototype object becomes a plain one), walked without the per-object entry arrays: this runs for the
 * whole Area at every snapshot. `ancestors` is the current path, so shared (DAG) values copy and only cycles fail.
 */
function copyPlain(value: unknown, ancestors: object[], freeze: boolean): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'undefined') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Nonfinite simulation value'); return value; }
  if (typeof value !== 'object') throw new TypeError('Non-value simulation payload');
  if (ancestors.includes(value)) throw new TypeError('Cyclic simulation payload');
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null) throw new TypeError('Non-plain simulation payload');
  ancestors.push(value);
  let result: unknown;
  if (array && proto !== Array.prototype) result = (value as unknown[]).map(v => copyPlain(v, ancestors, freeze)); // subclass or other realm: as map() does
  else if (array) {
    const source = value as unknown[], length = source.length, out = new Array<unknown>(length);
    for (let i = 0; i < length; i++) if (i in source) out[i] = copyPlain(source[i], ancestors, freeze);
    result = out;
  } else {
    const source = value as Record<string, unknown>, keys = Object.keys(source), out: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i], copied = copyPlain(source[key], ancestors, freeze);
      if (key === '__proto__') Object.defineProperty(out, key, { value: copied, writable: true, enumerable: true, configurable: true }); else out[key] = copied;
    }
    result = out;
  }
  ancestors.pop();
  return freeze ? Object.freeze(result) : result;
}
export function copyValue<T>(value: T): T { return copyPlain(value, [], false) as T; }
export function freezeValue<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeValue(child); Object.freeze(value); } return value; }
/** freezeValue(copyValue(value)) in one walk: every copied object is frozen once its children are. */
export const immutable = <T>(value: T): T => copyPlain(value, [], true) as T;
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
