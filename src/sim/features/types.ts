import type { EntityRef, RandomSource, SimUnit, Vec3, WorldQuery } from '../types.ts';

export interface FeatureActor { readonly id: string; readonly unit: SimUnit }
/** Supplied by the owning Area, never by a render callback. All getters describe this fixed tick. */
export interface FeatureContext {
  readonly areaId: string;
  readonly chapter: number;
  readonly time: number;
  readonly authority: boolean;
  readonly authorityEpoch: number;
  readonly rng: RandomSource;
  readonly query: WorldQuery;
  readonly encounterEngaged: boolean;
  readonly endingActive: boolean;
  readonly authorityId: string | null;
  actors(): readonly FeatureActor[];
  resolve(id: string): SimUnit | null;
  townsfolk(): readonly FeatureActor[];
  /** Server: each real player. Legacy: only the local owner, including a room follower. */
  ownsProgression(id: string): boolean;
  readonly navPoints: readonly Readonly<Vec3>[];
  /** Clear numeric target/cast/channel/dash, pending hit, push and root actions. */
  clearControls(unit: SimUnit): void;
  /** Stop actions through Actions.stop so carried roots commit exactly once. */
  stopActions(unit: SimUnit): void;
  emit(event: FeatureEvent): void;
}
export interface ObservationStamp { area: string; epoch: number; sequence: number }
export interface FeatureObservation<T> extends ObservationStamp {
  state: T;
  /** Captured by the transport at the accepted life-observation boundary, never guessed from an ID. */
  bindings: Readonly<Record<string, EntityRef>>;
}
export type BoatAchievement = 'sail' | 'crew' | 'landfall';
/** These are achievement requests only. The source awards no village XP or coins. */
export type FeatureEvent =
  | { type: 'boatBoarded'; actor: EntityRef; id: string; seat: number; voyage: string }
  | { type: 'boatLeft'; actor: EntityRef; id: string; x: number; z: number; shore: boolean; voyage: string }
  | { type: 'boatAchievement'; actor: EntityRef; id: string; achievement: BoatAchievement; key: string; distance: number }
  | { type: 'villageStarted'; round: string; mode: VillageMode; members: string[]; seeker: string }
  | { type: 'villageCaught'; round: string; actor: EntityRef; id: string; outside: boolean }
  | { type: 'villageFinished'; round: string; result: VillageResult; key: string };
export interface BoatCommand { action: 'call' | 'board' | 'leave' | 'drive'; throttle: number; steer: number }
export interface BoatState {
  x: number; z: number; yaw: number; speed: number;
  seats: [string | null, string | null];
  exits?: Record<string, { x: number; z: number; shore: boolean }>;
}
export type VillageMode = 'hide' | 'tag';
export type VillageResult = 'seekers' | 'runners' | 'cancelled';
export interface VillageRound {
  id: string; mode: VillageMode; phase: 'ready' | 'play' | 'done'; left: number;
  starter: string; seeker: string; members: string[]; caught: string[]; result: VillageResult | '';
}
export function sameRef(a: EntityRef, b: EntityRef): boolean {
  return a.area === b.area && a.id === b.id && a.life === b.life;
}
export function actorForRef(context: FeatureContext, ref: EntityRef): FeatureActor | null {
  if (ref.area !== context.areaId) return null;
  return context.actors().find(a => sameRef(a.unit.ref, ref)) ?? null;
}
export function validStamp(context: FeatureContext, stamp: ObservationStamp, last: number): boolean {
  return !context.authority && stamp.area === context.areaId && stamp.epoch === context.authorityEpoch
    && Number.isSafeInteger(stamp.sequence) && stamp.sequence >= 0 && stamp.sequence > last;
}
export function validDt(dt: number): void {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid feature dt');
}

export function validBindings(context:FeatureContext, ids:readonly string[], bindings:Readonly<Record<string,EntityRef>>):boolean {
  if(!bindings||typeof bindings!=='object')return false;
  return ids.every(id=>{
    const ref=bindings[id];
    if(!ref||ref.area!==context.areaId||!Number.isSafeInteger(ref.id)||ref.id<1||ref.id>0xffffffff||!Number.isSafeInteger(ref.life)||ref.life<1||ref.life>0xffffffff)return false;
    const unit=context.resolve(id);return !unit||sameRef(ref,unit.ref);
  });
}

/** Numeric social movement context. Area supplies exact ownership before this phase runs. */
export interface NpcFeatureContext {
  readonly time: number;
  readonly rng: RandomSource;
  readonly query: WorldQuery;
  readonly authority: boolean;
  readonly endingActive: boolean;
  players(): readonly SimUnit[];
  externallyOwned(ref: EntityRef): boolean;
  hasAction(unit: SimUnit): boolean;
  playAction(unit: SimUnit, action: import('../types.ts').ActionId): void;
  emit(event: NpcFeatureEvent): void;
}
export type NpcBarkBank = 'shore' | 'star' | 'starVictory';
export type NpcFeatureEvent =
  | { type:'npcGreeting'; unit:EntityRef; player:EntityRef; expression:'happy'; seconds:1.5 }
  | { type:'npcBark'; unit:EntityRef; player:EntityRef; bank:NpcBarkBank; index:number };
/** Structural subset of AreaDefinition AmbientSpawn, owned by the world metadata provider. */
export interface NumericTownsfolkOptions {
  readonly points: readonly Readonly<Vec3>[];
  readonly wanderRadius: number;
  readonly route?: { readonly points:readonly Readonly<Vec3>[]; readonly radiusPadding:number; readonly step:number };
  /** World II/III/IV source calls relocate(), replacing the random initial pause with one second. */
  readonly relocated?: boolean;
}
