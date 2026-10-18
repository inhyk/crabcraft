/** Shared contract for the implemented deterministic numeric simulation core.
 * Current gameplay refresh follows canonical dev 60df24f plus the merged S4 foundation.
 * Browser facade conversion, S1 event wiring and S3 baked query integration have separate gates.
 * Core state and events contain numeric/value data, never renderer objects, browser callbacks or I/O.
 */
export type WorldId = 'w1' | 'w2' | 'w3' | 'w4';
export type Chapter = 1 | 2 | 3 | 4;
export type EquipmentSlot = 'weapon' | 'armor';
export type EquipmentResult = 'bought' | 'owned' | 'busy' | 'coins' | 'upgraded' | 'unowned' | 'max';
export type BossProfileId = 'rust' | 'abyss' | 'eclipse' | 'dawn' | 'frost';
export type AreaId = string; // host-assigned unique INSTANCE/incarnation, never reused after recreation
export type EntityKey = string; // canonical encoding of full [area-instance,id,life], not EntityId alone
export type CharacterId = string; // opaque stable host identity, never EntityId or a guest token
export type EntityId = number; // monotonically allocated per Area,1..2^32-1; fail before mutation on exhaustion
export type Tick = number;
export type ClassId = 'warrior' | 'mage' | 'priest';
export interface Vec3 { x: number; y: number; z: number }
export interface Vec2Out { x: number; y: number; set(x: number, y: number): this }
// All registries key by area+id+life; life uint32 increments on respawn, never silently wraps.
export interface EntityRef { readonly area: AreaId; readonly id: EntityId; readonly life: number }
export interface Poi { readonly id: string; readonly position: Readonly<Vec3>; readonly yaw: number; readonly radius: number }

/** Intentionally matches S3 BakedWorld's query subset, without exposing its Collision.
 * src/sim/world/baked.ts:35-40,133-151: loadBakedWorld(data) is structurally assignable.
 * Vec2Out.y means world Z, retaining existing S3 collision signatures.
 * raycastSolid returns first hit distance or null, NOT a boolean/fraction.
 */
export interface WorldQuery {
  heightAt(x: number, z: number): number;
  resolveCollision<T extends Vec2Out>(x: number, z: number, radius: number, out: T): T;
  raycastSolid(from: Readonly<Vec3>, to: Readonly<Vec3>): number | null;
}
export interface RandomSource {
  readonly algorithm: 'mulberry32-v1'; // seed normalized with >>>0, next() in [0,1)
  next(): number; state(): number; // state uint32; draws only in stable core update order
}
export interface IdSource { next(): EntityId }
export type UnitKind = 'player' | 'npc' | 'townsfolk' | 'scrapling' | 'scavenger' | 'jellyfish' | 'boss' | 'freed';
export type Reaction = 'hostile' | 'friendly' | 'neutral' | 'player';
export interface SimUnit extends Vec3 {
  ref: EntityRef; // replaced on respawn; registry/controller handles are remapped atomically
  readonly archetype: string; // key into versioned neutral numeric catalog, no Unit.measure()
  kind: UnitKind; reaction: Reaction; level: number; yaw: number;
  radius: number; height: number; hp: number; maxHp: number; alive: boolean;
  hidden: boolean; targetable: boolean; invulnerable: boolean;
  stunUntil: number; slowUntil: number; slowPct: number;
  rust: number; rustUntil: number;
  absorb: number; absorbMax: number; absorbUntil: number;
  blessingUntil: number; // finite deadline; permanent encounter blessing uses the separate flag
  encounterBlessing: boolean; // replaces S1 Infinity, preserving regen and victory consumption
  lastCombat: number; pushX: number; pushZ: number; pushTime: number; lift: number;
  npcId: string | null;
  pose: NumericPoseState; // authoritative numeric phase/blend input for canonical anchor evaluation
  actions: ActionState[]; pendingHit: PendingHit | null; // insertion order, including fading layers
}
export type AbilityId = 'pincer-strike' | 'shell-bash' | 'sideways-charge' | 'whirlpool'
  | 'bubble-bolt' | 'frost-spray' | 'steam-blink' | 'tidal-nova'
  | 'smite' | 'mend-shell' | 'barnacle-ward' | 'holy-tide' | 'crown-burst';
export type AttackId = AbilityId | 'warrior-auto' | 'ranged-auto' | 'enemy-claw' | 'enemy-sea-cast' | 'enemy-leap' | 'boss-claw';
export type ActionId = 'idle' | 'walk_fwd' | 'walk_fast' | 'walk_back' | 'strafe_left' | 'strafe_right'
  | 'turn_left' | 'turn_right' | 'claw_left' | 'claw_right' | 'attack_swipe' | 'attack_slam'
  | 'cast' | 'jump' | 'death' | 'hit_react' | 'sit'
  | 'gesture_hello' | 'gesture_bow' | 'gesture_salute' | 'gesture_paw'
  | 'dance_crab' | 'dance_brazilian' | 'dance_dream_wings' | 'dance_maze'
  | 'break_toprock' | 'break_sixstep' | 'break_clawstand' | 'break_oneclaw'
  | 'break_spin' | 'break_jumpspin' | 'break_backflip';
export interface ActionRequest {
  id: ActionId; part: 'move' | 'channel' | 'release'; upper: boolean;
  from: number; to: number | null; loopFrom: number | null; loop: boolean;
  speed: number; fade: number; carryRoot: boolean;
}
export interface RootSample { x: number; z: number; yaw: number } // robot metres, local +X left,+Z forward
export interface RootCarryState {
  curve: string; dataVersion: string; metersToUnits: number;
  committed: boolean; committedClipTime: number | null; rebase: RootSample | null;
}
export interface ActionState extends ActionRequest {
  generation: number; start: number; clipTime: number;
  fadeIn: number; fadeOut: number; weight: number; targetWeight: 0 | 1;
  ended: boolean; interrupted: boolean; root: RootCarryState | null;
}
export interface ClipRule {
  id: ActionId; length: number; hold: boolean; holdAt: number | null;
  events: Readonly<Record<string, readonly number[]>>;
}
/** Data provider is mandatory; no missing-asset or zero-curve fallback in accepted core.
 * Derived from exact shipped clip/base data and rig/spec dimensions under content hashes.
 * Sampling must match controller/sampleClip+headingOf convention, including interpolation and window.
 * Actions start immediately in core whether or not browser assets have loaded.
 */
export interface NumericPoseState {
  locomotionTime: number; localVx: number; localVz: number; yawRate: number;
  previousX: number; previousZ: number; previousYaw: number;
  appliedQ: number[]; appliedPosition: [number, number, number];
  appliedRotation: [number, number, number, number];
  gaitPhase: number; controllerVx: number; controllerVz: number; controllerYaw: number;
  locomotionQ: number[]; locomotionPosition: [number, number, number];
  locomotionRotation: [number, number, number, number];
  locomotionWeights: Readonly<Record<string, number>>;
  // Actual canonical evaluator derives joint/base pose from these clocks, actions and versioned clips.
}
export interface ActionData {
  readonly version: string; readonly sourceHashes: Readonly<Record<string, string>>;
  clip(id: ActionId): ClipRule;
  root(curve: string, clipSeconds: number): RootSample;
  archetype(id: string): { radius: number; height: number; metersToUnits: number };
  launchAnchor(unit: Readonly<SimUnit>, pose: Readonly<NumericPoseState>): Readonly<Vec3>;
  // Canonical numeric clawR pose/socket evaluator, yaw/scale transformed to WORLD units.
  // Must use numeric pose/action data at launch, not rig/motion callbacks; parity gate in companion plan.
}
/** All active layers are interrupted on play(), even upper-vs-body, matching current controller.
 * Effective action is newest targetWeight>0 && (!ended || clip.hold). Fading layers do not select it.
 * Natural nonloop/nonhold fade begins AFTER advancing clipTime when t>=windowEnd-fadeOut*speed.
 * beginFadeOut samples min(t,windowEnd), commits root ONCE using CURRENT unit yaw and metersToUnits:
 * x+=(dx*cos(yaw)+dz*sin(yaw))*scale,z+=(-dx*sin(yaw)+dz*cos(yaw))*scale,yaw+=dyaw.
 * New action/stop/movement/damage/death cancellation calls the same commit at current clipTime;
 * no continuous root integration, no immediate collision correction (next movement resolves it, as S1).
 * Fade weights: in=max(.0001,fade),out=max(.05,fade); explicit stop uses max(.0001,stopFade).
 * Core emits action and rootRebase events. View applies rebase without feeding poses back into core.
 */
export type HitPlan =
  | { attack: 'warrior-auto'; source: EntityRef; target: EntityRef } // impact alive+gap, current dmgMul/crit/rage
  | { attack: 'pincer-strike' | 'shell-bash'; source: EntityRef; target: EntityRef } // target alive, current dmgMul
  | { attack: 'holy-tide'; source: EntityRef } // caster alive, impact position/nearby hostiles/heal
  | { attack: 'enemy-claw' | 'boss-claw'; source: EntityRef; target: EntityRef } // both alive, exact current gap guard/stats
  | { attack: 'enemy-sea-cast'; source: EntityRef; target: EntityRef; at: Readonly<Vec3> } // launch ground captured, impact alive/stun/chapter/distance/ring guards
  | { attack: 'enemy-leap'; source: EntityRef } // impact nearest eligible target+gap, actual leap resolver
  | { attack: 'ranged-auto'; source: EntityRef; target: EntityRef; school: 'frost' | 'holy' }
  | { attack: 'bubble-bolt'; source: EntityRef; target: EntityRef };
/** Hit plans dispatch ONLY impact effects, never executeAbility's cost/CD/cast/spawn stage again.
 * Attack-specific current-stat/crit draws occur at original impact point. Ranged style/school captured.
 * Wrong Area/life refs reject. Source dying without respawn keeps same life, so projectile may still hit;
 * transfer/respawn invalidates stale effects explicitly, tested as lifetime safety semantics.
 */
export interface PendingHit { left: number; plan: HitPlan } // countdown, decremented in SAME tick actor creates it
export type School = 'physical' | 'frost' | 'water' | 'holy' | 'rust';
export interface HitOptions { crit?: boolean; school?: School; noReact?: boolean; rage?: number }
export interface CombatController {
  readonly damageTakenMultiplier?: number;
  readonly profile?: BossProfileId;
  onDamaged?(source: EntityRef | null, damage: number): void;
  onHurt?(damage: number): void;
  gainRage?(amount: number): void;
  onWardHit?(broken: boolean): void;
  onDeath?(killer: EntityRef | null): void;
} // Implementations are sim-owned rules objects, never browser callbacks.
export interface CombatRules {
  damage(source: EntityRef | null, target: EntityRef, amount: number, options?: HitOptions): number;
  heal(source: EntityRef | null, target: EntityRef, amount: number, crit?: boolean): number;
  kill(target: EntityRef, source: EntityRef | null): void;
}
export type MechId = 'slam' | 'spray' | 'undertow' | 'cross' | 'barrage' | 'nova' | 'eclipse';
export type TelegraphShape =
  | { shape: 'circle'; at: Readonly<Vec3>; radius: number; ground: Readonly<Vec3>; color?: string }
  | { shape: 'cone'; at: Readonly<Vec3>; yaw: number; range: number; half: number; ground: Readonly<Vec3>; color?: string }
  | { shape: 'lane'; at: Readonly<Vec3>; yaw: number; halfLength: number; halfWidth: number; color: string }
  | { shape: 'undertow'; at: Readonly<Vec3>; radius: number };
export type ImpactShape =
  | { fx: 'slam'; at: Readonly<Vec3>; radius: number }
  | { fx: 'ring'; at: Readonly<Vec3>; color: string; r0: number; r1: number; seconds: number; inner: number }
  | { fx: 'lane'; at: Readonly<Vec3>; yaw: number; halfLength: number; halfWidth: number; seconds: number; color: string }
  | { fx: 'spray'; at: Readonly<Vec3>; yaw: number; range: number; half: number };
/** Complete S1 event families, by immutable IDs/value copies, plus action/lifecycle outputs.
 * Translation resolves reason/text/profile/quest keys in browser, never function-valued Label.
 * Critical invariants: event consumption cannot perform damage, reward, teleport or respawn.
 */
export type CoreEvent =
  | { type: 'damage'; src: EntityRef | null; dst: EntityRef; amount: number; crit: boolean; school?: School }
  | { type: 'heal'; src: EntityRef | null; dst: EntityRef; amount: number; crit: boolean }
  | { type: 'blocked'; unit: EntityRef; reason: 'evade' | 'absorbed' }
  | { type: 'death'; unit: EntityRef; killer: EntityRef | null }
  | { type: 'buff'; unit: EntityRef; buff: 'rust'; stacks: number }
  | { type: 'ward'; unit: EntityRef; stage: 'up' | 'hit' | 'down'; seconds?: number }
  | { type: 'castStart'; unit: EntityRef; seconds: number; ability?: AbilityId; channel?: { kind: ChannelKind; to: Readonly<Vec3>; start: number; end: number } }
  | { type: 'castEnd'; unit: EntityRef; channel: boolean; result: 'done' | 'interrupted'; reason?: string }
  | { type: 'ability'; caster: EntityRef; ability: AbilityId; stage: 'start' | 'hit'; target?: EntityRef | null; from?: Readonly<Vec3>; yaw?: number; range?: number; half?: number; amount?: number; stun?: number }
  | { type: 'projectile'; stage: 'spawn'; id: number; src: EntityRef; target: EntityRef; from: Readonly<Vec3>; style: ProjectileStyle; speed: number }
  | { type: 'projectile'; stage: 'hit'; id: number; src: EntityRef; target: EntityRef; style: ProjectileStyle; landed: boolean }
  | { type: 'press'; unit: EntityRef; slot: number }
  | { type: 'error'; unit: EntityRef; reason: string } // extraction narrows to current S1 ErrorReason union
  | { type: 'target'; unit: EntityRef; target: EntityRef | null }
  | { type: 'jump' | 'footstep' | 'recall' | 'aggro' | 'spawn' | 'leash' | 'freed'; unit: EntityRef }
  | { type: 'dance'; unit: EntityRef; stage: 'start' | 'moment' | 'stop'; moment?: string; move?: string }
  | { type: 'xp'; unit: EntityRef; amount: number }
  | { type: 'levelUp'; unit: EntityRef; level: number; oldMaxHp: number; maxHp: number; jump: boolean }
  | { type: 'attack'; src: EntityRef; attack: AttackId; stage: 'start' | 'hit'; target?: EntityRef; at?: Readonly<Vec3> }
  | { type: 'telegraph'; src: EntityRef; mech: MechId; level: number; seconds: number; shapes: readonly TelegraphShape[] }
  | { type: 'telegraphEnd'; src: EntityRef; cancelled: boolean }
  | { type: 'impact'; src: EntityRef; mech: MechId; shapes: readonly ImpactShape[]; loud: boolean }
  | { type: 'boss'; boss: EntityRef; stage: 'engage' | 'awake' | 'phase' | 'reset' | 'death' | 'frame'; phase?: number; show?: boolean }
  | { type: 'say'; unit: EntityRef; textKey: string; yell: boolean }
  | { type: 'loot'; unit: EntityRef; recipient: EntityRef; item: 'cog' }
  | { type: 'victory'; boss: EntityRef; recipients: readonly EntityRef[]; stage: 'banner' | 'end' }
  | { type: 'action'; unit: EntityRef; action: Readonly<ActionState> | null }
  | { type: 'rootRebase'; unit: EntityRef; generation: number; root: RootSample; position: Readonly<Vec3>; yaw: number }
  | { type: 'reward'; grant: EarnedGrant; appliedHere: boolean }
  | { type: 'respawn'; unit: EntityRef; position: Readonly<Vec3>; yaw: number }
  | { type: 'quest'; unit: EntityRef; quest: string; stage: 'accepted' | 'progress' | 'ready' | 'completed'; objective?: string; value?: number }
  | { type: 'equipment'; unit: EntityRef; slot: EquipmentSlot; operation: 'buy' | 'upgrade'; result: EquipmentResult; request?: number }
  | { type: 'endingReady'; unit: EntityRef; chapter: 4; replay: boolean }
  | { type: 'travelReady'; unit: EntityRef; destination: WorldId; gate: string };
export interface EventRecord { readonly tick: Tick; readonly order: number; readonly event: CoreEvent }

export type ChannelKind = 'recall' | 'beacon' | 'waystone';
export type PlayerCommand =
  | { kind: 'ability'; slot: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'target'; target: EntityRef | null }
  | { kind: 'jump' | 'dance' | 'cancel' }
  | { kind: 'channelStart'; channel: ChannelKind; targetId?: string }
  | { kind: 'interact'; targetId: string }
  | { kind: 'questAccept' | 'questTurnIn'; questId: string; npcId: string }
  | { kind: 'questTrack'; questId: string }
  | { kind: 'forgeBuy' | 'forgeUpgrade'; npcId: string; slot?: EquipmentSlot; request?: number }
  | { kind: 'travel'; gateId: string }
  | { kind: 'bossChallenge'; profile: BossSim['profile'] }
  | { kind: 'endingReplay' };
/** Input seq acknowledgment/transport validation is host work; no client position/HP/result.
 * Continuous held values replace previous values; commands execute once in supplied order.
 * Core retains continuous fields on missing input, but commands only run for seq>lastConsumedSeq.
 * Repeated/stale seq cannot repeat commands; multiple queued intents coalesce held state and keep
 * accepted command order. Host timeout/disconnect supplies neutral held values + release/cancel.
 * Reject invalid/oversized frames immediately without retaining them in a growing rejection queue.
 * Input adapter quantizes/range-checks [-1,1], finite yaw and bounded command count.
 */
export interface PlayerIntent {
  readonly seq: number;
  readonly forward: number; readonly strafe: number; readonly turn: number;
  readonly sprint: boolean;
  readonly steeringYaw: number | null;
  readonly heldChannel: ChannelKind | null;
  readonly commands: readonly PlayerCommand[];
}
export interface CastState { ability: AbilityId; start: number; end: number; target: EntityRef | null }
export interface ChannelState { kind: ChannelKind; start: number; end: number; targetId: string | null; to: Readonly<Vec3> }
export interface QuestState {
  chapter: Chapter; status: Record<string, 'locked' | 'available' | 'active' | 'ready' | 'done'>;
  progress: Record<string, number>; cogs: number;
  tracked: Partial<Record<Chapter, string>>; // preserve personal tracking across chapter travel
}
export interface PlayerState {
  character: CharacterId; unit: EntityRef; classId: ClassId; resource: number; maxResource: number;
  xp: number; coins: number; attackRank: number; armorRank: number; weaponOwned: boolean; armorOwned: boolean; baseMaxHp: number;
  gcdStart: number; gcdEnd: number; cooldowns: Record<string, { start: number; end: number }>;
  cast: CastState | null; channel: ChannelState | null; target: EntityRef | null;
  warded: boolean; nextSwing: number; lastAttack: number; queued: AbilityId | null;
  velX: number; velZ: number; jumpT: number; spinT: number; lastSpend: number; targetDeadAt: number;
  dash: { target: EntityRef; t: number } | null;
  deadUntil: number | null; role: 'authoritative'; controlsLocked: boolean; talkTarget: EntityRef | null;
  quests: QuestState; flags: Record<string, boolean>; cogMisses: number;
}
export interface PlayerSim extends CombatController {
  readonly state: PlayerState;
  applyIntent(intent: PlayerIntent): void;
  update(dt: number): void;
  useAbility(slot: number): void;
  interruptCast(reason?: string): void;
  cancelChannel(): void;
  startChannel(kind: ChannelKind, seconds: number, to: Readonly<Vec3>, targetId?: string): void;
  gainXp(amount: number): void;
  respawn(): void;
}
export type ProjectileStyle = 'bubble' | 'spark' | 'holy' | 'rust';
export interface ProjectileState extends Vec3 {
  id: number; source: EntityRef; target: EntityRef; style: ProjectileStyle;
  speed: number; elapsed: number; bornStep: number; hit: HitPlan;
  anchorVersion: string; // launch xyz, target life, speed/style captured; damage/crit sampled at actual impact
}
export type TimerAction =
  | { kind: 'respawn'; player: EntityRef }
  | { kind: 'bossWake'; boss: EntityRef }
  | { kind: 'lootPresentation'; grantId: string; corpse: EntityRef; recipient: CharacterId; item: 'cog' }
  | { kind: 'victory'; boss: EntityRef; recipients: readonly CharacterId[]; stage: 'banner' | 'end' }
  | { kind: 'echoSpawn'; spawnId: string };
export interface TimerState { id: number; due: number; insertion: number; action: TimerAction }
/** update selects due entries once, removes them, then fires by insertion order even when due differs.
 * Entries added during firing cannot join that selected batch; cancelled entries are removed eagerly.
 */
export interface AreaTimers { schedule(due: number, action: TimerAction): number; cancel(id: number): void }
export interface EnemySim extends CombatController { readonly unit: EntityRef; readonly spawnId: string; readonly state: 'idle' | 'chase' | 'leash' | 'dead' | 'gone'; update(dt: number): void; despawn(): void; respawnAt(x: number, z: number): void; resolveHit(plan: HitPlan): boolean; debugState(): DebugValue }
export interface BossSim extends CombatController { readonly state: 'dormant' | 'waking' | 'idle' | 'fight' | 'dying' | 'dead'; readonly engaged: boolean; readonly arena: Poi; sleep(): void; readonly unit: EntityRef; readonly profile: BossProfileId; update(dt: number): void; wake(): void; reset(): void; resolveHit(plan: HitPlan): boolean; debugState(): DebugValue }
export interface EnemySpawn {
  readonly id: string; readonly kind: 'scrapling' | 'scavenger' | 'jellyfish';
  readonly legacySlot?: string; // explicit original spawn-job identity, never inferred from Area iteration order
  readonly home: Readonly<Vec3>; readonly wanderRadius: number; readonly pack: string;
  readonly fixedLevel: number; readonly role: 'ordinary' | 'add' | 'echo';
}
export interface AmbientSpawn {
  readonly id: string; readonly ambientSlot: string; readonly archetype: string;
  readonly position: Readonly<Vec3>; readonly yaw?: number;
  readonly points: readonly Readonly<Vec3>[]; readonly wanderRadius: number;
  readonly route?: { readonly points: readonly Readonly<Vec3>[]; readonly radiusPadding: number; readonly step: number };
}
export interface AreaDefinition {
  readonly world: WorldId; readonly spawn: Poi; readonly recall: Poi;
  readonly townsfolk?: readonly AmbientSpawn[];
  readonly pois: Readonly<Record<string, Poi>>; readonly enemies: readonly EnemySpawn[];
  readonly bosses: readonly { profile: BossSim['profile']; arena: Poi; freedNpcId: string; freedArchetype?: string; freedPosition?: Readonly<Vec3>; captiveBeforeVictory?: boolean }[];
  readonly npcs: readonly { id: string; position: Readonly<Vec3>; yaw: number; archetype?: string }[];
  readonly interactions: readonly { id: string; kind: 'gate' | 'beacon' | 'crystal' | 'waystone' | 'explore'; position: Readonly<Vec3>; range: number; destination?: WorldId; objective?: string; channelTo?: Readonly<Vec3> }[];
}
/** Required explicit host policy. Formula/levels are configuration, not newly decided balance.
 * Must be deterministic and may depend only on inputs, never a clock/RNG outside Area.
 * legacy policy preserves S1 scaling where needed; server policy must use fixed spawn levels.
 */
export interface AreaPolicy {
  enemyLevel(spawn: EnemySpawn, legacyContext: { partyLevel: number; rustCleared: boolean; chapter: Chapter }): number;
  // Final server policy returns spawn.fixedLevel. Legacy policy can retain actual S1 scaling.
  enemyPopulation(spawn: EnemySpawn, nearbyPlayers: number): { desired: 0 | 1; respawnSeconds: number };
  damageAllowed(context: Readonly<AreaContext>, source: Readonly<SimUnit> | null, target: Readonly<SimUnit>): boolean;
  canInteract(context: Readonly<AreaContext>, player: Readonly<PlayerState>, interactionId: string): boolean;
  // Additional policy only: core still verifies known ID, same Area, alive, range and actual prerequisites.
}
export interface AreaContext {
  mode: 'public' | 'party-encounter' | 'legacy-room';
  members: readonly { character: CharacterId; unit: EntityRef; party: string | null; villagePlaying: boolean; seatedBoat: string | null }[];
  pvp: 'disabled' | 'party-only';
}
export interface EarnedGrant {
  id: string; // deterministic tuple [victim.area,victim.id,victim.life,recipient], no global ID
  victim: EntityRef; recipient: CharacterId;
  xp: number; coins: number; objectives: readonly { kind: string; amount: number }[];
  flags: readonly string[];
}
export interface Contribution { victim: EntityRef; contributors: readonly CharacterId[] }
/** Owned by Area, implemented with real rules. Methods cannot delegate state changes to a sink.
 * Subsystem controllers receive these services, not Game or server/WS/DOM objects.
 */
export interface AreaServices {
  readonly id: AreaId; readonly world: WorldId; readonly time: number; readonly tick: Tick;
  readonly query: WorldQuery; readonly actionData: ActionData; readonly context: AreaContext; readonly definition: AreaDefinition; readonly policy: AreaPolicy;
  readonly random: RandomSource; readonly ids: IdSource; readonly combat: CombatRules; readonly timers: AreaTimers;
  getUnit(ref: EntityRef): SimUnit | null; // rejects wrong Area, removed IDs and stale lives
  controller(ref: EntityRef): CombatController | null;
  respawnUnit(ref: EntityRef): EntityRef; // atomically advances life and remaps owned controller/player/context refs
  player(ref: EntityRef): PlayerSim | null;
  npcById(id: string): SimUnit | null;
  playerByCharacter(character: CharacterId): PlayerSim | null;
  applyEarnedGrant(grant: EarnedGrant): 'applied' | 'duplicate' | 'not-owner'; // real gainXp/coin/quest/flag effects
  players(): readonly SimUnit[]; // stable order, no required singleton local player
  targetFor(source: EntityRef): SimUnit | null; // empty area is valid
  hostilesNear(x: number, z: number, radius: number): readonly SimUnit[];
  outcomeTransaction(run: () => void): void; // sim-owned state operation, buffered event commit
  emit(event: CoreEvent): void; // enqueue copied data, no reentrant browser sink
  startAction(unit: EntityRef, action: ActionRequest, hit?: PendingHit): void;
  stopAction(unit: EntityRef, id?: ActionId, fade?: number): void;
  resolveHit(plan: HitPlan): void; // real impact-only effects, never re-pay or re-launch
  cancelPendingHit(unit: EntityRef): void;
  launch(projectile: Omit<ProjectileState, 'id' | 'elapsed' | 'bornStep'>): number; // Area stamps birth stage; stage-start-list eligibility only
  spawnAdd(boss: EntityRef, x: number, z: number): EnemySim | null;
  runCommand(player: EntityRef, command: PlayerCommand): boolean;
  bossByProfile(profile: BossSim['profile']): BossSim | null;
  encounterActive(): boolean;
  bossAvailable(profile: BossSim['profile']): boolean;
  completeChannel(player: EntityRef, channel: ChannelState): void;
  recordContribution(victim: EntityRef, attacker: EntityRef, damage: number): void;
  onUnitDied(victim: EntityRef, killer: EntityRef | null): void;
}
export interface AreaOptions {
  readonly characters?: CharacterRegistry; // host injects same registry into all Areas and coordinator
  readonly id: AreaId; readonly definition: AreaDefinition; readonly query: WorldQuery;
  readonly seed: number; readonly policy: AreaPolicy; readonly actionData: ActionData; readonly context: AreaContext;
  readonly limits: { eventCount: number; inputCommandsPerTick: number; timers: number; projectiles: number };
}
export interface AreaSnapshot {
  readonly area: AreaId; readonly world: WorldId; readonly tick: Tick; readonly time: number;
  readonly units: readonly Readonly<SimUnit>[];
  readonly players: readonly Readonly<PlayerState>[];
  readonly projectiles: readonly Readonly<ProjectileState>[];
} // Deep copied and stable sorted by ID; slowPct remains fraction0..1; S4 adapter scales to0..100.
/** Complete canonical test/debug data, not a production persistence protocol. No functions or refs. */
export type DebugValue = null | boolean | number | string | readonly DebugValue[] | { readonly [key: string]: DebugValue };
export interface AreaDebugState {
  schema: 's2-debug-v1'; definitionVersion: string; actionDataVersion: string;
  snapshot: AreaSnapshot; rng: { algorithm: 'mulberry32-v1'; state: number };
  allocators: { entity: number; action: number; projectile: number; timer: number; event: number };
  playerControllers: readonly DebugValue[];
  enemies: readonly DebugValue[]; bosses: readonly DebugValue[]; timers: readonly TimerState[];
  contributions: readonly Contribution[]; grants: readonly EarnedGrant[]; acknowledgedGrantIds: readonly string[];
  heldIntents: readonly { actor: EntityRef; intent: PlayerIntent; lastConsumedSeq: number }[];
  // Debug export only at between-tick boundary: no accepted commands remain pending after step().
  lifecycle: DebugValue;
  interactions: DebugValue; context: AreaContext;
}
/** Owned data: deadlines are REMAINING seconds at sourceTime, histories are ELAPSED ages.
 * GCD/CD start+end are converted together (age+remaining) to preserve UI fraction and60s ultimate.
 * No DTO field retains EntityRef, absolute Area time or aliases to mutable source state.
 * Retain HP/resource/progression/CD/status durations; rebuild deadlines at destination.time+remaining
 * and history start at destination.time-age. Clear target/cast/channel/queued/pending hit/dash/push/
 * velocities/lift/jump/spin/talk/death state, controls lock and encounter blessing; ward survives iff
 * retained absorbRemaining>0 && absorb>0. Commit action cancellation/root exactly once in source;
 * no action/root copied to destination, which starts idle at its admitted spawn.
 * World chapter/quest tracking changes through actual travel rules, never discard quest progress.
 */
export interface TransferDTO {
  version: 's2-transfer-v1'; character: CharacterId; classId: ClassId; archetype: string;
  hp: number; maxHp: number; resource: number; maxResource: number; xp: number; coins: number; attackRank: number; armorRank?: number; weaponOwned?: boolean; armorOwned?: boolean; baseMaxHp: number;
  cooldowns: Readonly<Record<string, { startAge: number; endRemaining: number }>>;
  gcd: { startAge: number; endRemaining: number };
  status: { stunRemaining: number; slowRemaining: number; slowPct: number; rustRemaining: number; rust: number;
    absorbRemaining: number; absorb: number; absorbMax: number; blessingRemaining: number };
  history: { combatAge: number; spendAge: number; attackAge: number; nextSwingRemaining: number };
  quests: QuestState; flags: Readonly<Record<string, boolean>>; cogMisses: number;
  appliedGrantIds: readonly string[];
}
export interface Admission { token: string; character: CharacterId; destination: AreaId; spawn: string; expiresAtHostTick: number }
export interface StagedDeparture { token: string; character: CharacterId; source: AreaId; sourceRef: EntityRef; dto: TransferDTO }
export interface StagedArrival { token: string; admission: Admission; newRef: EntityRef }
/** In-memory host contracts for S2; no DB/account/WS implementation required to test these.
 * Record immutable grants before source ack. Duplicate IDs must have identical content or fail.
 * Queue is non-dropping; backpressure is explicit failure before world mutation/disposal.
 */
export interface AwardMailbox {
  record(grant: EarnedGrant, alreadyAppliedToOwner: boolean): 'recorded' | 'duplicate';
  pending(character: CharacterId): readonly EarnedGrant[];
  acknowledgeApplied(character: CharacterId, grantId: string): void;
}
export interface CharacterRegistry {
  owner(character: CharacterId): EntityRef | null;
  compareAndSwap(character: CharacterId, expected: EntityRef | null, next: EntityRef | null): boolean;
}
export interface TransferCoordinator {
  readonly characters: CharacterRegistry; readonly awards: AwardMailbox;
  /** Between ticks only: reserve capacity+validate gate/destination before source freeze; dead/seated/
   * village-playing actors rejected. Freeze cancels no state until commit and stores exact rollback.
   * stageArrival builds inactive/private owned state; failure aborts destination and unfreezes source.
   * host registry swap is atomic, then infallible retire/activate; no tick/snapshot/event between them.
   * no await/I/O during commit. Reservation tokens single-use, expire/release explicitly.
   */
  transfer(character: CharacterId, source: Area, destination: Area, gate: string, hostTick: number): { ok: true; ref: EntityRef } | { ok: false; reason: string };
}

export interface Area {
  readonly services: AreaServices;
  readonly units: ReadonlyMap<EntityId, SimUnit>;
  readonly players: ReadonlyMap<EntityId, PlayerSim>;
  readonly enemies: ReadonlyMap<EntityId, EnemySim>;
  readonly bosses: ReadonlyMap<EntityId, BossSim>;
  readonly projectiles: ReadonlyMap<number, ProjectileState>;
  readonly timers: AreaTimers;
  /** Commands at OLD time -> time+=1/30,tick++ -> selected due timers -> players -> enemies ->
   * bosses -> progression/separation/death/status -> deterministic feature rules -> pending hits ->
   * projectiles -> action-clock advance/root fade commits (legacy motion-update stage).
   * Each pending hit left-=dt even if created in actor stage; input-stage action also advances once.
   * Projectiles iterate newest first from stage-start list; spawned-by-impact waits next update.
   * No renderer step, wall clock or20Hz snapshot call may advance any of these stages.
   */
  step(inputs: ReadonlyMap<EntityId, PlayerIntent>): void;
  snapshot(): AreaSnapshot;
  debugState(): AreaDebugState;
  drainEvents(): readonly EventRecord[]; // overflow fails actor/step preflight; fail-stop on unforeseen overflow, no silent loss/continued partial tick
  applyContext(context: AreaContext): void; // copied at boundary, validates membership before stepping
  /** Authority host supplies trusted fresh/loaded character state, never arbitrary browser save. */
  attachFresh(character: CharacterId, classId: ClassId, archetype: string, spawn: string): EntityRef;
  reserveAdmission(character: CharacterId, spawn: string, hostTick: number): Admission | null;
  releaseAdmission(token: string): void; // idempotent for reserved or staged token; releases capacity on any precommit failure
  stageDeparture(player: EntityRef): StagedDeparture;
  stageArrival(admission: Admission, dto: TransferDTO): StagedArrival;
  abortDeparture(token: string): void;
  abortArrival(token: string): void;
  /** commit removes only this actor's incoming/outgoing transient target/AI/hit/projectile/timer
   * refs; earned grants and other actors' unrelated state remain. No borrowed DTO/object aliases.
   */
  commitDeparture(token: string): void;
  activateArrival(token: string): EntityRef;
  /** Earned grants are synchronously determined/applied at death, once per victim life/recipient.
   * Already-earned eligibility of all valid damage contributors survives disconnect/transfer;
   * do not introduce additional time/range/party cutoffs while extracting the decided reward rule.
   * Locally-owned state applies once; absent recipient gets host mailbox grant, never a visual timer.
   * Host journals/drains with ack and forwards to current owner, or retains while disconnected.
   * Source cannot dispose until unacked grants are handed to host; destination de-dupes grant IDs.
   */
  pendingGrants(): readonly { grant: EarnedGrant; appliedHere: boolean }[];
  acknowledgeGrant(id: string): void;
  receiveGrant(grant: EarnedGrant): 'applied' | 'duplicate' | 'not-owner';
  dispose(): void;
}
/** Legacy browser boundary only. These types are review annotations, split OUTSIDE src/sim.
 * Single browser integration owner also owns facade semantics and direct rig-writer audit.
 * A replica is not an actively stepped PlayerSim and cannot auto attack, pay resources or earn again.
 */
export type ActorExecution =
  | { role: 'authoritative'; character: CharacterId; sim: PlayerSim }
  | { role: 'replica'; character: CharacterId | null; unit: EntityRef; observedSeq: number };
export interface ReplicaObservation { unit: EntityRef; seq: number; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean; level: number }
export interface LegacyAuthorityAdapter {
  actors: ReadonlyMap<EntityKey, ActorExecution>;
  observe(state: ReplicaObservation): void; // copied numeric observation, never run attack/ability resolver
  receiveOutcome(event: CoreEvent): void; // reconcile once under old room authority, no duplicate local hit
}
export interface LegacyVector3 extends Vec3 {
  set(x: number, y: number, z: number): this; copy(v: Readonly<Vec3>): this;
  clone(): LegacyVector3; // independent THREE.Vector3, NOT backed by SimUnit
  distanceTo(v: Readonly<Vec3>): number;
  // Actual browser object is THREE.Vector3 with x/y/z forwarding accessors; all native fluent
  // methods operate on the same authoritative components and return it. No render->sim copy.
}
export interface LegacyUnitFacade {
  readonly id: EntityId; readonly ref: EntityRef; readonly pos: LegacyVector3;
  readonly state: SimUnit; yaw: number;
  setYaw(yaw: number): void; teleport(world: WorldQuery, x: number, z: number, yaw?: number): void;
  moveTo(world: WorldQuery, x: number, z: number, dt: number): void;
  centre<T extends Vec3>(out: T): T; distTo(other: LegacyUnitFacade): number; gapTo(other: LegacyUnitFacade): number;
  act(id: ActionId, request: Partial<ActionRequest>): void; cancelPendingHit(): void;
  // Existing status/HP/player fields forward to state via accessors; controller lookup is registry-owned.
}
export interface UnitViewPort {
  apply(unit: Readonly<SimUnit>): void;
  consume(event: CoreEvent): void; // death/jump play visual clips directly; never call facade.act
  updateVisual(dt: number): void; dispose(): void;
}
export interface PlayerInputPort { sample(nextSeq: number): PlayerIntent }
export interface LegacyPlayerFacade {
  readonly sim: PlayerSim; readonly unit: LegacyUnitFacade; readonly view: UnitViewPort; readonly input: PlayerInputPort;
  // Existing live Player getters/setters/methods forward into the one PlayerSim; no copied combat state.
}
