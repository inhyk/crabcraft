// Feasibility spike (docs/server-world.md): what each client would receive per tick.
// Three encodings of the same server state, measured per client:
// - today: the host browser's JSON world checkpoint (EntityState, server/combatProtocol.ts) with every entity;
// - aoi json: the same JSON objects, only entities within a radius of the client's crab;
// - aoi binary delta: quantised fields, only what changed since the client's last packet, same radius.
import type { Enemy } from '../../../src/game/enemies';
import type { Unit } from '../../../src/game/unit';
import type { EntityState } from '../../combatProtocol';

export interface NetEntity {
  id: number;
  unit: Unit | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  level: number;
  alive: boolean;
  hidden: boolean;
  invulnerable: boolean;
  targetable: boolean;
  stunUntil: number;
  slowUntil: number;
  slowPct: number;
  rust: number;
  rustUntil: number;
  enemyState?: string;
  xp?: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The JSON object battle.ts snapshot() writes for one entity. */
export function entityJson(e: NetEntity, now: number, key: string): EntityState {
  return {
    id: key,
    x: round(e.x),
    y: round(e.y),
    z: round(e.z),
    yaw: round(e.yaw),
    hp: e.hp,
    maxHp: e.maxHp,
    level: e.level,
    alive: e.alive,
    hidden: e.hidden,
    invulnerable: e.invulnerable,
    targetable: e.targetable,
    stun: Math.min(60, Math.max(0, e.stunUntil - now)),
    slow: Math.min(60, Math.max(0, e.slowUntil - now)),
    slowPct: e.slowPct,
    rust: e.rust,
    rustFor: Math.min(60, Math.max(0, e.rustUntil - now)),
    ...(e.enemyState ? { enemyState: e.enemyState as EntityState['enemyState'], xp: e.xp } : {}),
  };
}

export function netEntity(id: number, u: Unit): NetEntity {
  const ctrl = u.ctrl as Enemy | null;
  const enemy = u.kind === 'scrapling' || u.kind === 'scavenger' || u.kind === 'jellyfish' ? ctrl : null;
  return {
    id,
    unit: u,
    x: u.pos.x,
    y: u.pos.y,
    z: u.pos.z,
    yaw: u.yaw,
    hp: Math.round(u.hp),
    maxHp: Math.round(u.maxHp),
    level: u.level,
    alive: u.alive,
    hidden: u.hidden,
    invulnerable: u.invulnerable,
    targetable: u.targetable,
    stunUntil: u.stunUntil,
    slowUntil: u.slowUntil,
    slowPct: u.slowPct,
    rust: u.rust,
    rustUntil: u.rustUntil,
    ...(enemy ? { enemyState: enemy.state, xp: enemy.stats.xp } : {}),
  };
}

// ------------------------------------------------------------------ binary delta

const STATE_CODE: Record<string, number> = { idle: 1, chase: 2, leash: 3, dead: 4, gone: 5 };

/** One entity as the client last received it: quantised fields. */
interface Q {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  level: number;
  flags: number;
  stun: number;
  slow: number;
  slowPct: number;
  rust: number;
  rustTick: number;
}

function quantise(e: NetEntity, tickHz: number): Q {
  return {
    // 1/16 m in x and z (int16 covers +-2048 m), 1/64 m in y, 1/256 turn of yaw.
    x: Math.round(e.x * 16),
    y: Math.round(e.y * 64),
    z: Math.round(e.z * 16),
    yaw: ((Math.round((e.yaw / (Math.PI * 2)) * 256) % 256) + 256) % 256,
    hp: e.hp,
    maxHp: e.maxHp,
    level: e.level,
    flags:
      (e.alive ? 1 : 0) | (e.hidden ? 2 : 0) | (e.invulnerable ? 4 : 0) | (e.targetable ? 8 : 0) | ((STATE_CODE[e.enemyState ?? ''] ?? 0) << 4),
    // Effects are sent as the server tick they end on, so they do not change while they run.
    stun: Math.max(0, Math.round(e.stunUntil * tickHz)),
    slow: Math.max(0, Math.round(e.slowUntil * tickHz)),
    slowPct: Math.round(e.slowPct * 100),
    rust: e.rust,
    rustTick: Math.max(0, Math.round(e.rustUntil * tickHz)),
  };
}

/** One scratch buffer for every client: a packet is measured, never kept. */
const SCRATCH = new Uint8Array(65536);

class Writer {
  buf = SCRATCH;
  n = 0;
  u8(v: number) {
    this.buf[this.n++] = v & 255;
  }
  i16(v: number) {
    const c = Math.max(-32768, Math.min(32767, v));
    this.buf[this.n++] = c & 255;
    this.buf[this.n++] = (c >> 8) & 255;
  }
  varint(v: number) {
    let x = Math.max(0, Math.floor(v));
    while (x >= 128) {
      this.buf[this.n++] = (x & 127) | 128;
      x = Math.floor(x / 128);
    }
    this.buf[this.n++] = x;
  }
}

const POS = 1;
const YAW = 2;
const HP = 4;
const FLAGS = 8;
const EFFECTS = 16;
const STATS = 32;
const REMOVE = 128;

/** Per client: which entities it holds and what it last received for each. */
export class ClientView {
  readonly known = new Map<number, Q>();
  private readonly w = new Writer();

  /**
   * Encode this tick's packet: entities within `radius` (leaving at radius + 5, so an entity on
   * the edge does not flicker in and out), only the fields that changed. Returns its byte size.
   */
  encode(tick: number, tickHz: number, cx: number, cz: number, radius: number, entities: readonly NetEntity[], selfId: number): number {
    const w = this.w;
    w.n = 0;
    w.u8(1); // packet type: snapshot
    w.varint(tick);
    const countAt = w.n;
    w.u8(0);
    w.u8(0); // entity count as a fixed u16, patched below
    let count = 0;
    const seen = new Set<number>();
    const r2 = radius * radius;
    const out2 = (radius + 5) * (radius + 5);
    for (const e of entities) {
      const d2 = (e.x - cx) ** 2 + (e.z - cz) ** 2;
      const prev = this.known.get(e.id);
      const inside = e.id === selfId || (!e.hidden && d2 <= (prev ? out2 : r2));
      if (!inside) continue;
      seen.add(e.id);
      const q = quantise(e, tickHz);
      let mask = 0;
      if (!prev) mask = POS | YAW | HP | FLAGS | EFFECTS | STATS;
      else {
        if (q.x !== prev.x || q.y !== prev.y || q.z !== prev.z) mask |= POS;
        if (q.yaw !== prev.yaw) mask |= YAW;
        if (q.hp !== prev.hp) mask |= HP;
        if (q.flags !== prev.flags) mask |= FLAGS;
        if (q.stun !== prev.stun || q.slow !== prev.slow || q.slowPct !== prev.slowPct || q.rust !== prev.rust || q.rustTick !== prev.rustTick) mask |= EFFECTS;
        if (q.maxHp !== prev.maxHp || q.level !== prev.level) mask |= STATS;
      }
      if (!mask) continue;
      this.known.set(e.id, q);
      count++;
      w.varint(e.id);
      w.u8(mask);
      if (mask & POS) {
        w.i16(q.x);
        w.i16(q.y);
        w.i16(q.z);
      }
      if (mask & YAW) w.u8(q.yaw);
      if (mask & HP) w.varint(q.hp);
      if (mask & FLAGS) w.u8(q.flags);
      if (mask & EFFECTS) {
        w.varint(q.stun);
        w.varint(q.slow);
        w.u8(q.slowPct);
        w.u8(q.rust);
        w.varint(q.rustTick);
      }
      if (mask & STATS) {
        w.varint(q.maxHp);
        w.varint(q.level);
      }
    }
    for (const id of this.known.keys()) {
      if (seen.has(id)) continue;
      this.known.delete(id);
      count++;
      w.varint(id);
      w.u8(REMOVE);
    }
    w.buf[countAt] = count & 255;
    w.buf[countAt + 1] = (count >> 8) & 255;
    return w.n;
  }
}
