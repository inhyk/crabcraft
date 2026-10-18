import { Reader, Writer, integer, u32, readPrefix, writePrefix } from './protocol.ts';
/** Future adapter output only. Synthetic events carry no combat result claim. */
export type WorldEvent =
  | { kind: 'damage' | 'heal'; source: number; target: number; amount: number }
  | { kind: 'death'; target: number }
  | { kind: 'action' | 'cast'; source: number; target: number; code: number }
  | { kind: 'telegraph'; source: number; x: number; z: number; radius: number; durationTicks: number }
  | { kind: 'result'; source: number; target: number; code: number; success: boolean };
export interface EventPacket { epoch: number; sequence: number; tick: number; events: readonly WorldEvent[] }
const kinds = ['damage', 'heal', 'death', 'action', 'cast', 'telegraph', 'result'] as const;
export const MAX_EVENTS = 256;
export function encodeEvents(p: EventPacket): Uint8Array {
  const w = new Writer(18 + MAX_EVENTS * 17); writePrefix(w, 3);
  w.put(integer(p.epoch, 1, 0xffffffff, 'epoch'), 4); w.put(integer(p.sequence, 1, 0xffffffff, 'sequence'), 4); w.put(u32(p.tick, 'tick'), 4);
  w.put(integer(p.events.length, 0, MAX_EVENTS, 'event count'), 2);
  for (const event of p.events) {
    const code = kinds.indexOf(event.kind); if (code < 0) throw new Error('unknown event'); w.put(code + 1, 1);
    if (event.kind !== 'death') w.put(integer(event.source, 1, 0xffffffff, 'source'), 4);
    if (event.kind !== 'telegraph') w.put(integer(event.target, 1, 0xffffffff, 'target'), 4);
    if (event.kind === 'damage' || event.kind === 'heal') w.put(integer(event.amount, 0, 1000000, 'amount'), 4);
    if (event.kind === 'action' || event.kind === 'cast' || event.kind === 'result') w.put(integer(event.code, 0, 255, 'code'), 1);
    if (event.kind === 'result') { if (typeof event.success !== 'boolean') throw new Error('invalid success'); w.put(event.success ? 1 : 0, 1); }
    if (event.kind === 'telegraph') {
      // Quantized coordinates (1/16 m), radius in 1/16 m; bounded future wire contract.
      w.put(integer(event.x, -32768, 32767, 'x'), 2, true); w.put(integer(event.z, -32768, 32767, 'z'), 2, true);
      w.put(integer(event.radius, 1, 16000, 'radius'), 2); w.put(integer(event.durationTicks, 1, 1800, 'durationTicks'), 2);
    }
  }
  return w.finish();
}
export function decodeEvents(bytes: Uint8Array): EventPacket {
  const r = new Reader(bytes); if (readPrefix(r) !== 3) throw new Error('not events');
  const epoch = integer(r.get(4), 1, 0xffffffff, 'epoch'); const sequence = integer(r.get(4), 1, 0xffffffff, 'sequence'); const tick = r.get(4);
  const count = integer(r.get(2), 0, MAX_EVENTS, 'event count'); const events: WorldEvent[] = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[integer(r.get(1), 1, kinds.length, 'event kind') - 1]!;
    const source = kind === 'death' ? 0 : integer(r.get(4), 1, 0xffffffff, 'source');
    const target = kind === 'telegraph' ? 0 : integer(r.get(4), 1, 0xffffffff, 'target');
    if (kind === 'damage' || kind === 'heal') events.push({ kind, source, target, amount: integer(r.get(4), 0, 1000000, 'amount') });
    else if (kind === 'death') events.push({ kind, target });
    else if (kind === 'telegraph') events.push({ kind, source, x: r.get(2, true), z: r.get(2, true), radius: integer(r.get(2), 1, 16000, 'radius'), durationTicks: integer(r.get(2), 1, 1800, 'durationTicks') });
    else {
      const code = r.get(1);
      if (kind === 'result') events.push({ kind, source, target, code, success: integer(r.get(1), 0, 1, 'success') === 1 });
      else events.push({ kind, source, target, code });
    }
  }
  r.end(); return { epoch, sequence, tick, events };
}
export class EventReceiver {
  epoch = 0; sequence = 0; tick = 0;
  reset(): void { this.epoch = this.sequence = this.tick = 0; }
  apply(bytes: Uint8Array): EventPacket {
    const p = decodeEvents(bytes);
    if (p.epoch < this.epoch || (p.epoch === this.epoch && (p.sequence !== this.sequence + 1 || p.tick < this.tick)) || (p.epoch > this.epoch && p.sequence !== 1)) throw new Error('stale or missing event');
    this.epoch = p.epoch; this.sequence = p.sequence; this.tick = p.tick; return p;
  }
}
