import type * as THREE from 'three';
import type { CrabRig } from '../crab/types';
import type { EntityRef, EventRecord } from '../sim/types.ts';
import { applyNumericPose } from '../game/simUnitView.ts';
import { rigCatalog } from '../sim/data/rig-catalog.ts';
import type { GameplayState, PublicActor } from '../../server/world/gameplay/protocol.ts';
import type { CommandResult } from '../../server/world/gameplay/events.ts';

export type WorldRigFactory = (actor: Readonly<PublicActor>) => Promise<CrabRig>;
export interface WorldActorHandle {
  readonly rig: CrabRig;
  /** Getter reads the current complete observation after subsequent snapshot commits. */
  readonly readState: () => Readonly<PublicActor>;
}
export interface WorldViewOptions {
  root: THREE.Object3D;
  createRig?: WorldRigFactory;
  onAdded?: (actor: Readonly<PublicActor>, handle: WorldActorHandle) => void;
  onRemoved?: (ref: EntityRef) => void;
  onSnapshot?: (state: GameplayState) => void;
  onEvents?: (records: readonly EventRecord[], results: readonly CommandResult[]) => void;
  onError?: (ref: EntityRef, code: string) => void;
}

export const worldActorKey = (ref: EntityRef): string => JSON.stringify([ref.area, ref.id, ref.life]);

/** Appearance comes from trusted identity; catalog-specific rigs have an explicit factory seam. */
export async function createWorldActorRig(actor: Readonly<PublicActor>): Promise<CrabRig> {
  if (actor.appearance) {
    const { createCrab } = await import('../crab/provider.ts');
    return createCrab({ ...actor.appearance });
  }
  if (actor.kind === 'player') throw new Error('World player appearance is required');
  const catalog = rigCatalog(actor.archetype);
  let rig: CrabRig;
  if (catalog.factory === 'createCrab') {
    const { createCrab } = await import('../crab/provider.ts');
    rig = await createCrab({ ...catalog.spec }, catalog.extras ? [...catalog.extras] : []);
  } else if (catalog.factory === 'createEnemyCrab') {
    const { createEnemyCrab } = await import('../crab/provider.ts');
    rig = await createEnemyCrab(catalog.kind);
  } else {
    const { createJellyfishRig } = await import('../crab/jellyfish.ts');
    rig = await createJellyfishRig();
  }
  rig.root.scale.multiplyScalar(catalog.rootMultiplier);
  return rig;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

interface ActorEntry {
  actor: Readonly<PublicActor>;
  presentation: string;
  generation: number;
  rig: CrabRig | null;
}

/** Raw server pose rendering. No local simulation, prediction, action clock or reward effects. */
export class WorldView {
  private readonly options: WorldViewOptions;
  private readonly createRig: WorldRigFactory;
  private readonly actors = new Map<string, ActorEntry>();
  private generation = 0;
  private disposed = false;
  private bindingKey: string | null = null;
  private current: GameplayState | null = null;

  constructor(options: WorldViewOptions) { this.options = options; this.createRig = options.createRig ?? createWorldActorRig; }
  get state(): GameplayState | null { return this.current ? structuredClone(this.current) : null; }
  get actorCount(): number { return this.actors.size; }
  get readyCount(): number { return [...this.actors.values()].filter(entry => entry.rig !== null).length; }

  actor(ref: EntityRef): WorldActorHandle | null {
    const entry = this.actors.get(worldActorKey(ref));
    return entry?.rig ? { rig: entry.rig, readState: () => entry.actor } : null;
  }

  commit(state: GameplayState, records: readonly EventRecord[] = [], results: readonly CommandResult[] = []): void {
    if (this.disposed) return;
    const header = state.header, bindingKey = JSON.stringify([header.session, header.area, header.epoch, header.catalog]);
    if (this.current) {
      const previous = this.current.header;
      if (bindingKey === this.bindingKey ? header.sequence <= previous.sequence : header.session !== previous.session || header.epoch <= previous.epoch) throw new Error('Stale world view commit');
    }
    if (this.bindingKey !== bindingKey) { this.reset(); this.bindingKey = bindingKey; }
    const owned = structuredClone(state);
    this.current = owned;
    const alive = new Set(owned.actors.map(actor => worldActorKey(actor.ref)));
    for (const [key, entry] of this.actors) if (!alive.has(key)) this.remove(key, entry);
    for (const actor of owned.actors) {
      const key = worldActorKey(actor.ref);
      const presentation = JSON.stringify([actor.archetype, actor.kind, actor.appearance]);
      let entry = this.actors.get(key);
      if (entry && entry.presentation !== presentation) { this.remove(key, entry); entry = undefined; }
      if (entry) entry.actor = freeze(actor);
      else {
        entry = { actor: freeze(actor), presentation, generation: this.generation, rig: null };
        this.actors.set(key, entry);
        void this.loadRig(key, entry);
      }
    }
    this.options.onSnapshot?.(structuredClone(owned));
    this.events(records, results);
  }

  private async loadRig(key: string, entry: ActorEntry): Promise<void> {
    let rig: CrabRig;
    try { rig = await this.createRig(structuredClone(entry.actor)); }
    catch {
      if (!this.disposed && entry.generation === this.generation && this.actors.get(key) === entry) {
        this.options.onError?.(entry.actor.ref, 'rig-load');
      }
      return;
    }
    if (this.disposed || entry.generation !== this.generation || this.actors.get(key) !== entry) { rig.dispose(); return; }
    entry.rig = rig;
    applyNumericPose(rig, entry.actor);
    rig.root.visible = !entry.actor.hidden;
    this.options.root.add(rig.root);
    this.options.onAdded?.(entry.actor, { rig, readState: () => entry.actor });
  }

  /** Presentation events do not call Unit.act, Player.useAbility, damage or progression code. */
  events(records: readonly EventRecord[], results: readonly CommandResult[] = []): void {
    if (this.disposed || !this.current) return;
    this.options.onEvents?.(structuredClone(records), structuredClone(results));
  }

  render(_nowMs: number, dt: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid view delta');
    for (const entry of this.actors.values()) {
      if (!entry.rig) continue;
      applyNumericPose(entry.rig, entry.actor);
      entry.rig.root.visible = !entry.actor.hidden;
      if (!entry.actor.hidden) entry.rig.update(dt);
    }
  }

  private remove(key: string, entry: ActorEntry): void {
    this.actors.delete(key);
    this.options.onRemoved?.(entry.actor.ref);
    if (entry.rig) { entry.rig.root.visible = false; entry.rig.root.removeFromParent(); entry.rig.dispose(); entry.rig = null; }
  }
  reset(): void {
    this.generation++;
    for (const [key, entry] of this.actors) this.remove(key, entry);
    this.current = null; this.bindingKey = null;
  }
  dispose(): void { if (!this.disposed) { this.reset(); this.disposed = true; } }
}
