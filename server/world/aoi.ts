import { finite, integer, MAX_ENTITIES, quantizeEntity, type Entity } from './protocol.ts';
export interface Visibility { selfId: number; partyIds?: ReadonlySet<number>; targetId?: number; engagedBossId?: number }
/** Trusted server pins bypass hidden/range. Hidden unpinned units never enter or remain visible. */
export class AoiGrid {
  private cells = new Map<string, Entity[]>();
  private entities = new Map<number, Entity>();
  readonly radius: number; readonly hysteresis: number; readonly cellSize: number;
  constructor(radius = 80, hysteresis = 8, cellSize = 16) {
    this.cellSize = finite(cellSize, 'cellSize'); if (cellSize < 1 || cellSize > 256) throw new Error('invalid cellSize');
    this.radius = finite(radius, 'radius'); this.hysteresis = finite(hysteresis, 'hysteresis');
    if (radius <= 0 || radius > 1024 || hysteresis < 0 || hysteresis > radius) throw new Error('invalid AOI bounds');
  }
  rebuild(entities: readonly Entity[]): void {
    integer(entities.length, 0, MAX_ENTITIES, 'entity count');
    const cells = new Map<string, Entity[]>(); const all = new Map<number, Entity>();
    for (const source of entities) {
      quantizeEntity(source); if (all.has(source.id)) throw new Error('duplicate id');
      const e = Object.freeze({ ...source }); all.set(e.id, e);
      const key = this.key(Math.floor(e.x / this.cellSize), Math.floor(e.z / this.cellSize));
      const cell = cells.get(key) ?? []; cell.push(e); cells.set(key, cell);
    }
    this.cells = cells; this.entities = all;
  }
  private key(x: number, z: number): string { return `${x}:${z}`; }
  query(visibility: Visibility, previous: ReadonlySet<number> = new Set()): Entity[] {
    integer(visibility.selfId, 1, 0xffffffff, 'selfId');
    const self = this.entities.get(visibility.selfId); if (!self) throw new Error('missing self');
    if (visibility.partyIds && visibility.partyIds.size > MAX_ENTITIES) throw new Error('too many party pins');
    const pinned = new Set([visibility.selfId, ...(visibility.partyIds ?? []), ...[visibility.targetId, visibility.engagedBossId].filter((id): id is number => id !== undefined)]);
    for (const id of pinned) integer(id, 1, 0xffffffff, 'pinned id');
    if (pinned.size > MAX_ENTITIES) throw new Error('too many pins');
    const result = new Map<number, Entity>();
    const out = this.radius + this.hysteresis;
    for (let x = Math.floor((self.x - out) / this.cellSize); x <= Math.floor((self.x + out) / this.cellSize); x++) {
      for (let z = Math.floor((self.z - out) / this.cellSize); z <= Math.floor((self.z + out) / this.cellSize); z++) {
        for (const e of this.cells.get(this.key(x, z)) ?? []) {
          const radius = previous.has(e.id) ? out : this.radius;
          if (!(e.flags & 2) && (e.x - self.x) ** 2 + (e.z - self.z) ** 2 <= radius ** 2) result.set(e.id, e);
        }
      }
    }
    for (const id of pinned) { const e = this.entities.get(id); if (e) result.set(id, e); }
    return [...result.values()].sort((a, b) => a.id - b.id);
  }
}
