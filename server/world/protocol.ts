/** Standalone S4 wire contract. All multibyte values are little endian. */
export const MAGIC = 0x4357;
export const VERSION = 2;
export const MAX_ENTITIES = 2048;
export const MAX_PACKET_BYTES = 131072;
export const HEADER_BYTES = 30;
export const MASK = { position: 1, yaw: 2, hp: 4, flags: 8, effects: 16, stats: 32, remove: 128, all: 63 } as const;
export interface Entity {
  id: number; x: number; y: number; z: number; yaw: number;
  hp: number; maxHp: number; level: number; flags: number;
  stunTick: number; slowTick: number; slowPct: number; rust: number; rustTick: number;
}
export interface QuantizedEntity extends Entity {}
export interface RecordUpdate { id: number; mask: number; values?: Partial<QuantizedEntity> }
export interface SnapshotPacket { kind: 'full' | 'delta'; epoch: number; sequence: number; baseline: number; tick: number; ack: number; selfId: number; records: readonly RecordUpdate[] }
export function integer(n: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`invalid ${label}`);
  return n;
}
export function finite(n: number, label: string): number {
  if (!Number.isFinite(n)) throw new Error(`invalid ${label}`);
  return n;
}
export const u32 = (n: number, label: string) => integer(n, 0, 0xffffffff, label);
export function quantizeEntity(e: Entity): QuantizedEntity {
  integer(e.id, 1, 0xffffffff, 'id');
  const scaled = (v: number, scale: number, label: string) => integer(Math.round(finite(v, label) * scale), -32768, 32767, label);
  const q = {
    id: e.id, x: scaled(e.x, 16, 'x'), y: scaled(e.y, 64, 'y'), z: scaled(e.z, 16, 'z'),
    yaw: ((Math.round((finite(e.yaw, 'yaw') % (Math.PI * 2)) / (Math.PI * 2) * 256) % 256) + 256) % 256,
    hp: u32(e.hp, 'hp'), maxHp: integer(e.maxHp, 1, 0xffffffff, 'maxHp'),
    level: integer(e.level, 1, 65535, 'level'), flags: integer(e.flags, 0, 127, 'flags'),
    stunTick: u32(e.stunTick, 'stunTick'), slowTick: u32(e.slowTick, 'slowTick'),
    slowPct: integer(e.slowPct, 0, 100, 'slowPct'), rust: integer(e.rust, 0, 255, 'rust'), rustTick: u32(e.rustTick, 'rustTick'),
  };
  if (q.hp > q.maxHp) throw new Error('hp exceeds maxHp');
  return q;
}
export function dequantizeEntity(q: QuantizedEntity): Entity {
  return { ...q, x: q.x / 16, y: q.y / 64, z: q.z / 16, yaw: q.yaw / 256 * Math.PI * 2 };
}
export class Writer {
  private bytes: Uint8Array;
  private view: DataView;
  constructor(capacity = MAX_PACKET_BYTES) {
    integer(capacity, 0, MAX_PACKET_BYTES, 'capacity'); this.bytes = new Uint8Array(capacity); this.view = new DataView(this.bytes.buffer);
  }
  offset = 0;
  put(n: number, size: 1 | 2 | 4, signed = false): void {
    integer(n, signed ? -32768 : 0, signed ? 32767 : size === 4 ? 0xffffffff : size === 2 ? 65535 : 255, 'wire value');
    if (this.offset + size > this.bytes.byteLength) throw new Error('oversized packet');
    if (size === 1) this.view.setUint8(this.offset, n);
    else if (size === 2 && signed) this.view.setInt16(this.offset, n, true);
    else if (size === 2) this.view.setUint16(this.offset, n, true);
    else this.view.setUint32(this.offset, n, true);
    this.offset += size;
  }
  finish(): Uint8Array { return this.bytes.slice(0, this.offset); }
}
export class Reader {
  private view: DataView;
  offset = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_PACKET_BYTES) throw new Error('invalid packet size');
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get(size: 1 | 2 | 4, signed = false): number {
    if (this.offset + size > this.bytes.byteLength) throw new Error('truncated packet');
    const n = size === 1 ? this.view.getUint8(this.offset) : size === 2 ? signed ? this.view.getInt16(this.offset, true) : this.view.getUint16(this.offset, true) : this.view.getUint32(this.offset, true);
    this.offset += size;
    return n;
  }
  end(): void { if (this.offset !== this.bytes.byteLength) throw new Error('trailing bytes'); }
}
export function writePrefix(w: Writer, kind: number): void { w.put(MAGIC, 2); w.put(VERSION, 1); w.put(kind, 1); }
export function readPrefix(r: Reader): number {
  if (r.get(2) !== MAGIC || r.get(1) !== VERSION) throw new Error('unsupported protocol');
  return r.get(1);
}
const FIELDS: readonly [number, readonly [keyof QuantizedEntity, 1 | 2 | 4, boolean?][]][] = [
  [1, [['x', 2, true], ['y', 2, true], ['z', 2, true]]], [2, [['yaw', 1]]], [4, [['hp', 4]]], [8, [['flags', 1]]],
  [16, [['stunTick', 4], ['slowTick', 4], ['slowPct', 1], ['rust', 1], ['rustTick', 4]]],
  [32, [['maxHp', 4], ['level', 2]]],
];
function checkValues(mask: number, values: Partial<QuantizedEntity>): void {
  for (const [bit, fields] of FIELDS) if (mask & bit) for (const [key, size, signed] of fields) {
    const v = values[key]!;
    integer(v, signed ? -32768 : key === 'maxHp' || key === 'level' ? 1 : 0,
      signed ? 32767 : key === 'flags' ? 127 : key === 'slowPct' ? 100 : size === 4 ? 0xffffffff : size === 2 ? 65535 : 255, key);
  }
}
function checkHeader(p: SnapshotPacket): void {
  integer(p.epoch, 1, 0xffffffff, 'epoch'); integer(p.sequence, 1, 0xffffffff, 'sequence'); u32(p.tick, 'tick'); u32(p.ack, 'ack'); u32(p.selfId, 'selfId');
  if (p.kind !== 'full' && p.kind !== 'delta') throw new Error('invalid kind');
  u32(p.baseline, 'baseline');
  if (p.kind === 'full' ? p.baseline !== 0 : p.baseline === 0 || p.sequence !== p.baseline + 1) throw new Error('invalid baseline');
  integer(p.records.length, 0, p.kind === 'full' ? MAX_ENTITIES : MAX_ENTITIES * 2, 'record count');
}
function checkRecord(record: RecordUpdate, full: boolean): void {
  integer(record.id, 1, 0xffffffff, 'id'); integer(record.mask, 1, 255, 'mask');
  if (record.mask !== MASK.remove && (record.mask & ~MASK.all)) throw new Error('invalid mask');
  if (full && record.mask !== MASK.all) throw new Error('full record must contain all fields');
  if (record.mask !== MASK.remove) {
    if (!record.values) throw new Error('missing fields');
    checkValues(record.mask, record.values);
    if ((record.mask & 36) === 36 && record.values.hp! > record.values.maxHp!) throw new Error('hp exceeds maxHp');
  }
}
export function encodeSnapshot(packet: SnapshotPacket): Uint8Array {
  checkHeader(packet);
  const size = HEADER_BYTES + packet.records.reduce((sum, record) => sum + 5 + (record.mask === MASK.remove ? 0 : FIELDS.reduce((n, [bit, fields]) => n + (record.mask & bit ? fields.reduce((a, [, bytes]) => a + bytes, 0) : 0), 0)), 0);
  const w = new Writer(size); writePrefix(w, packet.kind === 'full' ? 1 : 2);
  for (const n of [packet.epoch, packet.sequence, packet.baseline, packet.tick, packet.ack, packet.selfId]) w.put(n, 4);
  w.put(packet.records.length, 2);
  const seen = new Set<number>();
  for (const record of packet.records) {
    checkRecord(record, packet.kind === 'full');
    if (seen.has(record.id)) throw new Error('duplicate id'); seen.add(record.id);
    w.put(record.id, 4); w.put(record.mask, 1);
    if (record.mask === MASK.remove) continue;
    for (const [bit, fields] of FIELDS) if (record.mask & bit) for (const [key, size, signed] of fields) w.put(record.values![key]!, size, signed);
  }
  return w.finish();
}
export function decodeSnapshot(bytes: Uint8Array): SnapshotPacket {
  const r = new Reader(bytes); const kind = readPrefix(r);
  if (kind !== 1 && kind !== 2) throw new Error('not a snapshot');
  const p: SnapshotPacket = { kind: kind === 1 ? 'full' : 'delta', epoch: r.get(4), sequence: r.get(4), baseline: r.get(4), tick: r.get(4), ack: r.get(4), selfId: r.get(4), records: [] };
  const count = integer(r.get(2), 0, kind === 1 ? MAX_ENTITIES : MAX_ENTITIES * 2, 'record count');
  const records: RecordUpdate[] = []; const seen = new Set<number>();
  for (let i = 0; i < count; i++) {
    const record: RecordUpdate = { id: r.get(4), mask: r.get(1) };
    if (record.mask !== MASK.remove) {
      record.values = {};
      for (const [bit, fields] of FIELDS) if (record.mask & bit) for (const [key, size, signed] of fields) record.values[key] = r.get(size, signed);
    }
    checkRecord(record, kind === 1);
    if (seen.has(record.id)) throw new Error('duplicate id'); seen.add(record.id); records.push(record);
  }
  r.end(); p.records = records; checkHeader(p); return p;
}
export class SnapshotReceiver {
  private entities = new Map<number, Readonly<QuantizedEntity>>();
  epoch = 0; sequence = 0; tick = 0; ack = 0; selfId = 0;
  get state(): ReadonlyMap<number, Readonly<QuantizedEntity>> { return this.entities; }
  reset(): void { this.entities = new Map(); this.epoch = this.sequence = this.tick = this.ack = this.selfId = 0; }
  apply(bytes: Uint8Array): SnapshotPacket {
    const p = decodeSnapshot(bytes);
    if (p.kind === 'delta' && (p.epoch !== this.epoch || p.baseline !== this.sequence || p.selfId !== this.selfId)) throw new Error('missing baseline');
    if (p.epoch < this.epoch || (p.epoch === this.epoch && p.sequence <= this.sequence)) throw new Error('stale snapshot');
    if (p.epoch === this.epoch && p.selfId !== this.selfId) throw new Error('recipient changed without reset');
    if (p.epoch === this.epoch && (p.tick < this.tick || p.ack < this.ack)) throw new Error('stale tick or ack');
    const next = p.kind === 'full' ? new Map<number, Readonly<QuantizedEntity>>() : new Map(this.entities);
    for (const record of p.records) {
      if (record.mask === MASK.remove) { if (!next.delete(record.id)) throw new Error('removing unknown entity'); continue; }
      if (!next.has(record.id) && record.mask !== MASK.all) throw new Error('partial unknown entity');
      const value = { ...next.get(record.id), ...record.values, id: record.id } as QuantizedEntity;
      checkValues(MASK.all, value);
      if (value.hp > value.maxHp) throw new Error('hp exceeds maxHp');
      next.set(record.id, Object.freeze(value));
    }
    if (p.selfId && !next.has(p.selfId)) throw new Error('missing self');
    if (next.size > MAX_ENTITIES) throw new Error('too many entities');
    this.entities = next; this.epoch = p.epoch; this.sequence = p.sequence; this.tick = p.tick; this.ack = p.ack; this.selfId = p.selfId;
    return p;
  }
}
export class ClientStream {
  private known = new Map<number, QuantizedEntity>();
  epoch: number; sequence = 0; private tick = 0; private ack = 0;
  readonly selfId: number;
  constructor(epoch = 1, selfId = 0) { this.selfId = u32(selfId, 'selfId'); this.epoch = integer(epoch, 1, 0xffffffff, 'epoch'); }
  reset(): void {
    integer(this.epoch + 1, 1, 0xffffffff, 'epoch'); this.epoch++; this.sequence = 0; this.tick = 0; this.ack = 0; this.known = new Map();
  }
  encode(tick: number, entities: readonly Entity[], forceFull = false, ack = 0): Uint8Array {
    u32(tick, 'tick'); u32(ack, 'ack'); if (ack < this.ack) throw new Error('ack regression'); if (tick < this.tick) throw new Error('tick regression');
    integer(entities.length, 0, MAX_ENTITIES, 'entity count');
    const next = new Map<number, QuantizedEntity>(); const records: RecordUpdate[] = [];
    const full = forceFull || this.sequence === 0;
    for (const entity of entities) {
      const q = quantizeEntity(entity); if (next.has(q.id)) throw new Error('duplicate id'); next.set(q.id, q);
      const previous = full ? undefined : this.known.get(q.id);
      let mask = 0;
      for (const [bit, fields] of FIELDS) if (!previous || fields.some(([key]) => previous[key] !== q[key])) mask |= bit;
      if (mask) records.push({ id: q.id, mask, values: q });
    }
    if (!full) for (const id of this.known.keys()) if (!next.has(id)) records.push({ id, mask: MASK.remove });
    const bytes = encodeSnapshot({ kind: full ? 'full' : 'delta', epoch: this.epoch, sequence: this.sequence + 1, baseline: full ? 0 : this.sequence, tick, ack, selfId: this.selfId, records });
    this.known = next; this.sequence++; this.tick = tick; this.ack = ack; return bytes;
  }
}
