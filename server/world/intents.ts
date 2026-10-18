import { Reader, Writer, integer, finite, u32, readPrefix, writePrefix } from './protocol.ts';
export type Intent = { kind: 'move'; sequence: number; x: number; z: number; yaw: number; flags: number } | { kind: 'action'; sequence: number; action: 1 | 2; slot: number; target: number };
export function encodeIntent(intent: Intent): Uint8Array {
  const keys = intent.kind === 'move' ? ['kind', 'sequence', 'x', 'z', 'yaw', 'flags'] : ['kind', 'sequence', 'action', 'slot', 'target'];
  if (Object.keys(intent).some(key => !keys.includes(key))) throw new Error('unknown intent field');
  const w = new Writer(14); writePrefix(w, intent.kind === 'move' ? 16 : intent.kind === 'action' ? 17 : 0);
  w.put(integer(intent.sequence, 1, 0xffffffff, 'sequence'), 4);
  if (intent.kind === 'move') {
    for (const axis of [intent.x, intent.z]) { finite(axis, 'axis'); if (Math.abs(axis) > 1) throw new Error('axis out of bounds'); w.put(Math.round(axis * 127) & 255, 1); }
    finite(intent.yaw, 'yaw'); if (intent.yaw < 0 || intent.yaw >= Math.PI * 2) throw new Error('yaw out of bounds');
    w.put(Math.round(intent.yaw / (Math.PI * 2) * 65536) % 65536, 2);
    w.put(integer(intent.flags, 0, 3, 'movement flags'), 1);
  } else if (intent.kind === 'action') {
    w.put(integer(intent.action, 1, 2, 'action'), 1); w.put(integer(intent.slot, 0, 7, 'slot'), 1); w.put(u32(intent.target, 'target'), 4);
  } else throw new Error('unknown intent kind');
  return w.finish();
}
export function decodeIntent(bytes: Uint8Array): Intent {
  if (bytes.byteLength > 14) throw new Error('oversized intent');
  const r = new Reader(bytes); const kind = readPrefix(r); const sequence = integer(r.get(4), 1, 0xffffffff, 'sequence');
  let intent: Intent;
  if (kind === 16) {
    const axis = () => { const n = r.get(1); if (n === 128) throw new Error('invalid axis'); return (n > 127 ? n - 256 : n) / 127; };
    intent = { kind: 'move', sequence, x: axis(), z: axis(), yaw: r.get(2) / 65536 * Math.PI * 2, flags: integer(r.get(1), 0, 3, 'movement flags') };
  } else if (kind === 17) {
    intent = { kind: 'action', sequence, action: integer(r.get(1), 1, 2, 'action') as 1 | 2, slot: integer(r.get(1), 0, 7, 'slot'), target: r.get(4) };
  } else throw new Error('unknown intent kind');
  r.end(); return intent;
}
/** Per authenticated connection in a future adapter; this fixture has no account identity. */
export class IntentSession {
  sequence = 0; rejected = 0; private tokens = 120; private lastTime: number; private actions: Intent[] = [];
  movement: Extract<Intent, { kind: 'move' }> | undefined;
  constructor(now = 0) { this.lastTime = finite(now, 'time'); }
  accept(bytes: Uint8Array, now: number): Intent {
    try {
      finite(now, 'time'); if (now < this.lastTime) throw new Error('clock regression');
      const intent = decodeIntent(bytes);
      if (intent.sequence <= this.sequence) throw new Error('stale intent');
      const tokens = Math.min(120, this.tokens + (now - this.lastTime) * 60);
      if (tokens < 1 || (intent.kind === 'action' && this.actions.length >= 4)) throw new Error('intent rate limit');
      this.tokens = tokens - 1; this.lastTime = now; this.sequence = intent.sequence;
      if (intent.kind === 'move') this.movement = intent; else this.actions.push(intent);
      return intent;
    } catch (error) { this.rejected++; throw error; }
  }
  drainActions(): Intent[] { const actions = this.actions; this.actions = []; return actions; }
}
