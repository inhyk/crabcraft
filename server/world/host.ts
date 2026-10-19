import { randomUUID, randomBytes } from 'node:crypto';
import { CHAT, shownName } from '../chat/safety.ts';
import type { WorldChatService, ChatParticipant, ChatPreferences, ChatResult } from './chat.ts';
import { isDeepStrictEqual } from 'node:util';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { createArea } from '../../src/sim/area.ts';
import { InMemoryCharacterRegistry, InMemoryTransferCoordinator } from '../../src/sim/transfer.ts';
import { prepareRestore, type CoreCharacterCodec, type IdentityJson, type CheckpointJson, type GrantJson, type RestorePolicy } from '../../src/sim/persistence.ts';
import type { Area, AreaSnapshot, BossProfileId, EntityRef, GrantReadToken, EventRecord, PlayerCommand, PlayerIntent, PlayerState, SimUnit, WorldId } from '../../src/sim/types.ts';
import { canChallenge } from '../../src/sim/data/progression.ts';
import type { LedgerMode } from '../../src/sim/ledger.ts';
import type { EndingIntegrationOptions } from '../../src/sim/features/worldRules.ts';
import { BOSS_PROFILES } from '../../src/sim/data/bosses.ts';
import { TREASURES, LIGHTHOUSE_SECRET } from '../../src/sim/features/exploration.ts';
import { CharacterStore, CharacterStoreError, type Character, type VictimOutcomeResources, type GrantBatchEntry } from './character-store.ts';
import { WorldTicketRegistry, type SessionBinding } from './admission.ts';
import type { HostOwnership } from './ownership.ts';
import type { DurableOutcomeStore } from './contribution-store.ts';
import type { SourceLedgerLimits } from '../../src/sim/outcomes.ts';
import { DeadlineScheduler } from './scheduler.ts';
import { PersistenceCoordinator, readCertifiedGrantPage, AreaSourceDrain, PagedOutcomeRecovery, type Recovery } from './persistence-coordinator.ts';
import { PUBLIC_WORLDS, HOSTABLE_WORLDS, type LoadedWorldDefinition } from './catalog.ts';
import { InputSession, InputRateBudget, HOST_COMMANDS, type HostCommand, type PreparedInput } from './gameplay/intents.ts';
import { prepareObservationSnapshot, releasePreparedObservation, WIRE_SCHEMA_REVISION, validateWireSchema } from './gameplay/protocol.ts';
import type { GameplayCatalog, GameplayProtocol, ObservationInput, PreparedObservation, WireBinding, WorldControl } from './gameplay/protocol.ts';
import type { CommandResult } from './gameplay/events.ts';
import { createDungeonDefinition, createDungeonQuery } from '../../src/sim/areas/dungeon.ts';
import { dungeonFor, type DungeonTier } from '../../src/sim/data/dungeons.ts';
import type { Admission, DungeonObservation, DungeonReturnBinding, StagedArrival, StagedDeparture } from '../../src/sim/types.ts';
import type { DungeonCompletionStore } from './dungeon-completion-store.ts';
import { freezeDungeonCompletion, sealDungeonCompletion, deliverDungeonAwards, dungeonReturnFor, dungeonWorld, validateDungeonCommand, type DungeonCommand, type DungeonCommandResult, type FrozenDungeonCompletion } from './dungeons.ts';

type StoredCharacter = Character<IdentityJson, CheckpointJson>;
export interface HostPolicies {
  readonly authTimeoutMs: number;
  readonly inputTimeoutMs: number;
  readonly reconnectGraceMs: number;
  readonly sessionRevalidateMs: number;
  readonly checkpointIntervalMs: number;
  readonly maxConnections: number;
  readonly maxConnectionsPerIp: number;
  readonly maxWaiting: number;
  readonly maxAuthFrameBytes: number;
  readonly maxFrameBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxQueuedInputs: number;
  readonly maxMutationSourcesPerTick: number;
  readonly loopIntervalMs: number;
  readonly endingPresentation?: { readonly stage: EndingIntegrationOptions['stage'] };
  readonly ledger?: { sourceLimits: SourceLedgerLimits; drainLimits: Omit<ConstructorParameters<typeof AreaSourceDrain>[3], 'codecVersion'>; recoveryLimits: Omit<ConstructorParameters<typeof PagedOutcomeRecovery>[2], 'codecVersion'>; recoveryIntervalMs: number };
  readonly victimOutcome: VictimOutcomeResources;
  readonly victimOutcomeRetryCeiling?: VictimOutcomeResources;
  readonly persistence: { maxQueuedPerCharacter: number; maxAttempts: number; retryMs: number; maxRecoveryRounds: number };
  readonly areaLimits: { eventCount: number; inputCommandsPerTick: number; timers: number; projectiles: number };
  readonly restore: RestorePolicy;
  readonly chat?: { maxPending: number };
  readonly party?: { maxParties: number; maxEncounters: number; returnSpawn(world: WorldId, profile: BossProfileId): string };
  /** Dungeon runs share the party room pool. While enabled every Area keeps feature award receipts. */
  readonly dungeons?: { readonly tiers: readonly DungeonTier[]; readonly maxPendingAwards: number };
  /** A clock anomaly is an explicit restore failure, never a hidden offline-policy choice. */
  offlineSeconds(character: StoredCharacter, nowWallMs: number): number;
  visible(unit: Readonly<SimUnit>, viewer: Readonly<PlayerState>): boolean;
  observationExtras(snapshot: AreaSnapshot, character: string, visibleIds: ReadonlySet<number>): Pick<ObservationInput, 'features' | 'recovery' | 'achievements'>;
}
export interface ActualWorldHostDeps {
  admission: WorldTicketRegistry;
  characters: CharacterStore<IdentityJson, CheckpointJson, GrantJson>;
  worlds: ReadonlyMap<WorldId, LoadedWorldDefinition>;
  codec: CoreCharacterCodec;
  /** verifyObservations (default true): see ObservationChecks in gameplay/protocol.ts; create() must use the same choice. */
  gameplay: { catalog: GameplayCatalog; create(): GameplayProtocol; verifyObservations?: boolean };
  ownership: HostOwnership;
  chat?: WorldChatService;
  outcomes?: DurableOutcomeStore;
  dungeonCompletions?: Pick<DungeonCompletionStore, 'recordDungeonCompletion' | 'readPendingDungeonAwards' | 'charactersWithPendingDungeonAwards'>;
  policies: HostPolicies;
  originAllowed(origin: string, req: IncomingMessage): boolean;
  clientIp(req: IncomingMessage): string;
  nowMonotonicMs(): number;
  nowWallMs(): number;
  /** Internal diagnostics only; callers decide what sanitized metadata may be logged. */
  onFailure?(stage: string, error: unknown): void;
}
export interface ActualWorldHost {
  ready(): Promise<void>;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  stopAdmission(): void;
  /** Internal recovery only. No HTTP or client authority is exposed. */
  retryDurability(resources: VictimOutcomeResources): Promise<boolean>;
  shutdown(deadlineMs: number): Promise<{ durable: boolean; unresolved: number }>;
  stats(): Readonly<Record<string, number | boolean>>;
  /** Trusted typed dungeon commands for a connected, authenticated character; the wire commands share its queue. */
  dungeon(characterId: string, command: DungeonCommand): Promise<DungeonCommandResult>;
  /** Read-only view of the character's current run, or null outside a dungeon. */
  dungeonObservation(characterId: string): Readonly<DungeonObservation> | null;
}
interface DungeonRun { readonly runId: string; readonly tier: DungeonTier; frozen?: FrozenDungeonCompletion }
interface Slot { kind: 'public' | 'party' | 'dungeon'; ledgerMode: LedgerMode; source?: AreaSourceDrain; world: LoadedWorldDefinition['world']; area: Area; tick: DeadlineScheduler; snapshot: DeadlineScheduler; events: EventRecord[]; watermark: number; lastCheckpoint: number; publishes: number; party?: Party; profile?: BossProfileId; dungeon?: DungeonRun }
interface Actor { record: StoredCharacter; slot: Slot; ref: EntityRef; connection: Connection | null; detachedAt: number | null; generation: number; pendingReplay: boolean; grantRead?: GrantReadToken; returnTo?: { world: WorldId; spawn: string }; dungeonAwards?: boolean }
interface Party { code: string; leader: string; members: Map<string, string>; pvp: boolean; encounter?: Slot; dungeon?: Slot }
interface Connection {
  ws: WebSocket; ip: string; origin: string; generation: number; closed: boolean;
  phase: 'preauth' | 'authenticating' | 'loading' | 'queued' | 'admitted' | 'closed';
  binding?: SessionBinding; actor?: Actor; protocol: GameplayProtocol; stream?: WireBinding; input?: InputSession; revoked?: { binding: WireBinding; input: InputSession; protocol: GameplayProtocol }; inputBudget: InputRateBudget;
  sequence: number; epoch: number; full: boolean; lastInput: number; timedOut: boolean; nextValidation: number; validating: boolean; authTimer?: ReturnType<typeof setTimeout>;
  visible: Set<number>;
  queueKey?: string;
  publishedConsumed: number;
  baselineSequence: number;
  /** Results of applied commands whose effects are not yet in a committed checkpoint. */
  results: CommandResult[];
  /** Results whose save committed, waiting for a baseline to be sent on; awaiting counts those in the save in flight. */
  ready: CommandResult[]; awaiting: number;
  chatBusy: boolean; chatPreferences?: ChatPreferences; chatNeedsPreferences: boolean;
  discoveries: { unit: EntityRef; id: string; startOrder: number; inputSequence: number; commandIndex: number }[];
}
interface Waiting { connection: Connection; record: StoredCharacter; world: WorldId }
interface PendingTravel { actor: Actor; source: Slot; ref: EntityRef; gate: string; destination: WorldId }
const HOST_COMMAND_KINDS = new Set(HOST_COMMANDS);
/** Victim outcome transactions of one save round in flight at once (the pg pool has 10 clients, one holds ownership). */
const JOURNAL_CONCURRENCY = 4;
const ECONOMIC_INTERACTIONS = new Set<string>([...TREASURES.map(t => t.id), LIGHTHOUSE_SECRET.id]);
class OutcomeResourcePause extends Error {}
const isResourceOnly = (error: unknown) => error instanceof OutcomeResourcePause || error instanceof CharacterStoreError && error.code === 'resource_limit';
const sameRef = (a: EntityRef, b: EntityRef) => a.area === b.area && a.id === b.id && a.life === b.life;
const buffer = (raw: RawData) => Buffer.isBuffer(raw) ? raw : raw instanceof ArrayBuffer ? Buffer.from(raw) : Buffer.concat(raw);
const reject = (socket: Duplex, status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);

/** Actual numeric simulation host. The synthetic v2 fixture is intentionally not imported. */
export function createActualWorldHost(deps: ActualWorldHostDeps): ActualWorldHost {
  const p = deps.policies, external = !!p.ledger;
  validateWireSchema(deps.gameplay.catalog);
  if (p.endingPresentation && deps.gameplay.catalog.wireSchemaRevision !== WIRE_SCHEMA_REVISION) throw new Error('ending requires the compiled wire schema catalog');
  // The browser offers exactly the advertised tiers, and the dungeon view needs the compiled schema on both ends.
  if (p.dungeons && deps.gameplay.catalog.wireSchemaRevision !== WIRE_SCHEMA_REVISION) throw new Error('dungeons require the compiled wire schema catalog');
  { const advertised = deps.gameplay.catalog.dungeons ?? [], tiers = p.dungeons?.tiers ?? [];
    if (advertised.length !== tiers.length || tiers.some(tier => !advertised.includes(tier))) throw new Error('catalog dungeon tiers must match the dungeon policy'); }
  if (!!deps.outcomes !== external) throw new Error('outcomes service and explicit ledger policy must be paired');
  if (p.ledger && (!Number.isSafeInteger(p.ledger.recoveryIntervalMs) || p.ledger.recoveryIntervalMs < 1)) throw new Error('explicit recovery interval required');
  for (const key of ['authTimeoutMs', 'inputTimeoutMs', 'sessionRevalidateMs', 'checkpointIntervalMs', 'maxConnections', 'maxConnectionsPerIp', 'maxWaiting', 'maxAuthFrameBytes', 'maxFrameBytes', 'maxBufferedBytes', 'maxQueuedInputs', 'maxMutationSourcesPerTick', 'loopIntervalMs'] as const) {
    if (!Number.isSafeInteger(p[key]) || p[key] < 1) throw new Error(`invalid host limit: ${key}`);
  }
  if (!Number.isFinite(p.reconnectGraceMs) || p.reconnectGraceMs < 0 || p.maxMutationSourcesPerTick > 256 || p.areaLimits.inputCommandsPerTick > 32) throw new Error('unsupported host durability/input bounds');
  if (!Number.isSafeInteger(p.persistence.maxRecoveryRounds) || p.persistence.maxRecoveryRounds < 0 || p.persistence.maxRecoveryRounds > 32 ||
    p.maxAuthFrameBytes > p.maxFrameBytes || p.maxConnectionsPerIp > p.maxConnections) throw new Error('invalid host recovery/frame limits');
  if (p.party && (!Number.isSafeInteger(p.party.maxParties) || p.party.maxParties < 1 || !Number.isSafeInteger(p.party.maxEncounters) || p.party.maxEncounters < 1)) throw new Error('invalid party capacity');
  if (!p.victimOutcome || ![p.victimOutcome.maxEntries, p.victimOutcome.maxPayloadBytes, p.victimOutcome.timeoutMs].every(value => Number.isSafeInteger(value) && value > 0) || p.victimOutcome.timeoutMs > 2147483647) throw new Error('explicit victim outcome resource budgets required');
  if (p.victimOutcomeRetryCeiling && (!(['maxEntries', 'maxPayloadBytes', 'timeoutMs'] as const).every(key => Number.isSafeInteger(p.victimOutcomeRetryCeiling![key]) && p.victimOutcomeRetryCeiling![key] > 0) || p.victimOutcomeRetryCeiling.timeoutMs > 2147483647 || (['maxEntries', 'maxPayloadBytes', 'timeoutMs'] as const).some(key => p.victimOutcomeRetryCeiling![key] < p.victimOutcome[key]))) throw new Error('invalid victim outcome retry ceiling');
  if (!!deps.chat !== !!p.chat || p.chat && (!Number.isSafeInteger(p.chat.maxPending) || p.chat.maxPending < 1)) throw new Error('explicit chat pending limit required');
  if (!!deps.dungeonCompletions !== !!p.dungeons) throw new Error('dungeon store and explicit dungeon policy must be paired');
  if (p.dungeons && (!p.party || !Number.isSafeInteger(p.dungeons.maxPendingAwards) || p.dungeons.maxPendingAwards < 1 || p.dungeons.maxPendingAwards > 256 ||
    !Array.isArray(p.dungeons.tiers) || !p.dungeons.tiers.length || new Set(p.dungeons.tiers).size !== p.dungeons.tiers.length ||
    p.dungeons.tiers.some(tier => !dungeonFor(tier) || !deps.worlds.has(dungeonWorld(tier))))) throw new Error('invalid dungeon policy');
  const featureAwards = p.dungeons ? { maxPending: p.dungeons.maxPendingAwards } : undefined;
  deps.ownership.assertOwned();
  const registry = new InMemoryCharacterRegistry();
  const transfers = new InMemoryTransferCoordinator(registry);
  const slots = new Map<WorldId, Slot>();
  const allSlots = new Set<Slot>();
  const parties = new Map<string, Party>();
  const memberParty = new Map<string, Party>();
  const actors = new Map<string, Actor>();
  const connections = new Set<Connection>();
  const waiting: Waiting[] = [];
  const travels = new Map<string, PendingTravel>();
  const encounterRequests = new Map<string, { actor: Actor; profile: BossProfileId }>();
  const returnRequests = new Map<string, { actor: Actor; leaveParty: boolean }>();
  const dungeonRequests = new Map<string, { actor: Actor; command: DungeonCommand; resolve(result: DungeonCommandResult): void }>();
  const dungeonExits = new Map<string, { actor: Actor; slot: Slot; leaveParty: boolean }>();
  let nextDungeonSeal = 0;
  const completion: (() => void)[] = [];
  const persistence = new PersistenceCoordinator(deps.characters, deps.ownership, { ...p.persistence, now: deps.nowMonotonicMs });
  const wss = new WebSocketServer({ noServer: true, maxPayload: p.maxFrameBytes, perMessageDeflate: false });
  let admissionRequested = true; let accepting = !external; let stopped = false; let frozen = false; let draining = false; let barrier: Promise<void> | null = null; let barrierHalts = false; let timer: ReturnType<typeof setTimeout> | undefined; let slice: ReturnType<typeof setImmediate> | undefined;
  const failedSources = new Set<Slot>(), drainedFailedSources = new Set<Slot>(), attemptedFailedSources = new Set<Slot>();
  let startupRecovery = external, nextRecovery = deps.nowMonotonicMs(), lastSave = deps.nowMonotonicMs(), haltNextSave = false;
  /** A barrier that holds the world: no tick and no snapshot until it ends. A retained save round does not hold it. */
  const halted = () => barrier !== null && barrierHalts;
  let readyDone = !external, resolveReady!: () => void, rejectReady!: (error: unknown) => void;
  const readiness = external ? new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }) : Promise.resolve();
  void readiness.catch(() => {});
  const outcomeRecovery = deps.outcomes && p.ledger ? new PagedOutcomeRecovery(deps.outcomes, deps.ownership, { ...p.ledger.recoveryLimits, codecVersion: deps.codec.version }) : null;
  let victimResources = { ...p.victimOutcome };
  let pausedDurability: { run: () => Promise<void>; ownership: HostOwnership; halting: boolean } | null = null;
  let grantProofsActive = false;
  let generation = 1; let unresolved = 0; let pendingChat = 0;
  const chatTargets = new Map<string, { participant: ChatParticipant; expires: number }>();
  // persistenceBarriers counts every save round. haltingBarriers and haltedMs count those that held the world (persistenceMs is
  // the wall time of startDurability rounds); saveRounds and saveMs the retained rounds that let it run, saveRetries those of
  // them given up after a journal failure (the next round then holds the world). aoi*: actor slots.
  const metrics = { ticks: 0, snapshots: 0, packets: 0, receivedPackets: 0, discardedRevokedFrames: 0, bytesSent: 0, bytesReceived: 0, rejected: 0, queued: 0,
    haltingBarriers: 0, haltedMs: 0, saveRounds: 0, saveMs: 0, saveRetries: 0, aoiNear: 0, aoiFar: 0, aoiFarHeld: 0, dungeonClears: 0, dungeonSealRetries: 0,
    authFailures: 0, pendingSourceGrants: 0, persistenceBarriers: 0, persistenceMs: 0, tickMs: 0, snapshotBatchMs: 0, neutralizations: 0, recoveries: 0 };
  const processStarted = deps.nowMonotonicMs(), processCpuStart = process.cpuUsage();
  const timings = new Map<string, { values: number[]; cursor: number }>();
  const observe = (name: string, ms: number) => {
    const timing = timings.get(name) ?? { values: [], cursor: 0 };
    if (timing.values.length < 4096) timing.values.push(ms); else timing.values[timing.cursor++ % timing.values.length] = ms;
    timings.set(name, timing);
  };
  const timingStats = () => Object.fromEntries([...timings].flatMap(([name, timing]) => {
    const values = [...timing.values].sort((a, b) => a - b);
    const at = (p: number) => values[Math.floor((values.length - 1) * p)] ?? 0;
    return [[`${name}P50Ms`, at(.5)], [`${name}P99Ms`, at(.99)], [`${name}Samples`, values.length]];
  }));
  const endingOptions = (incarnation: string): EndingIntegrationOptions | undefined => p.endingPresentation ? {
    incarnation, stage: p.endingPresentation.stage,
    appearance: owner => {
      const actor = [...actors.values()].find(actor => sameRef(actor.ref, owner));
      return actor ? { ...actor.record.identity.appearance, name: shownName(actor.record.identity.appearance.name) } : null;
    },
  } : undefined;
  if (PUBLIC_WORLDS.some(world => !deps.worlds.has(world)) || [...deps.worlds.keys()].some(world => !HOSTABLE_WORLDS.some(id => id === world))) throw new Error('missing safe public world configuration');
  for (const world of HOSTABLE_WORLDS.filter(id => deps.worlds.has(id))) {
    const loaded = deps.worlds.get(world);
    if (!loaded || loaded.world !== world || loaded.publicDefinition.bosses.length) throw new Error(`missing safe public world: ${world}`);
    if (loaded.publicDefinition.enemies.length > p.maxMutationSourcesPerTick) throw new Error('population exceeds bounded checkpoint receipts');
    const now = deps.nowMonotonicMs();
    const ledgerMode: LedgerMode = external ? 'external-durable' : 'retained';
    const id = `${world}:${randomUUID()}`;
    const area = createArea({ endingPresentation: endingOptions(id), ledgerMode, ledgerLimits: p.ledger?.sourceLimits, id, definition: loaded.publicDefinition, query: loaded.query,
      actionData: loaded.actionData, policy: loaded.policy, seed: loaded.seed, characters: registry,
      context: { mode: 'public', pvp: 'disabled', members: [] }, limits: p.areaLimits, ...(featureAwards ? { featureAwards } : {}) });
    const slot: Slot = { kind: 'public', ledgerMode, world, area, tick: new DeadlineScheduler(30, now), snapshot: new DeadlineScheduler(20, now, 1), events: [], watermark: -1, lastCheckpoint: now, publishes: 0 };
    slots.set(world, slot); allSlots.add(slot);
  }
  if (external && p.party) for (const loaded of deps.worlds.values()) for (const definition of loaded.encounterDefinitions.values()) {
    const id = `party:${randomUUID()}`;
    const validation = createArea({ endingPresentation: endingOptions(id), id, ledgerMode: 'external-durable', ledgerLimits: p.ledger!.sourceLimits, definition,
      query: loaded.query, actionData: loaded.actionData, policy: loaded.policy, seed: loaded.seed,
      context: { mode: 'party-encounter', pvp: 'disabled', members: [] }, limits: p.areaLimits, ...(featureAwards ? { featureAwards } : {}) });
    validation.dispose();
  }
  if (external && p.dungeons) for (const tier of p.dungeons.tiers) createDungeonArea(tier, 'external-durable', randomUUID()).dispose();
  const enqueue = (fn: () => void) => {
    if (stopped) return;
    // Each admitted connection owns at most a small fixed number of in-flight IO operations.
    if (completion.length >= p.maxConnections * 8 + 16) { failClosed(); return; }
    completion.push(fn);
  };
  const boundary = <T>(fn: () => T): Promise<T> => new Promise((resolve, rejectPromise) => enqueue(() => { try { resolve(fn()); } catch (error) { rejectPromise(error); } }));
  function sourceAdapter(slot: Slot): AreaSourceDrain | undefined {
    if (slot.ledgerMode !== 'external-durable') return;
    const area = slot.area, ownership = deps.ownership;
    return new AreaSourceDrain(area, deps.outcomes!, ownership, { ...p.ledger!.drainLimits, codecVersion: deps.codec.version }, boundary,
      () => !stopped && allSlots.has(slot) && slot.area === area && deps.ownership === ownership && !drainedFailedSources.has(slot));
  }
  for (const slot of allSlots) slot.source = sourceAdapter(slot);
  // Retained results wait in c.results until the save round that contains them commits, and ending transitions are held
  // by their capture binding, so the retained input watermark is the live one; only external rounds hold it back.
  const publishedConsumed = (c: Connection) => external ? c.publishedConsumed : c.input!.consumedInput;
  const sourceFailed = (slot: Slot) => failedSources.has(slot) || drainedFailedSources.has(slot);
  const json = (c: Connection, value: unknown) => {
    if (c.ws.readyState === WebSocket.OPEN) { const data = JSON.stringify(value); c.ws.send(data); metrics.packets++; metrics.bytesSent += Buffer.byteLength(data); }
  };
  const queueNotice = (c: Connection, world: WorldId, position: number) => {
    const hostedWorld = HOSTABLE_WORLDS.find(id => id === world && slots.has(id));
    if (!hostedWorld) { sendControl(c, { type: 'error', code: 'world-unavailable', retryable: false }); return; }
    const key = `${world}:${position}`;
    if (c.queueKey === key) return;
    c.queueKey = key;
    if (!sendControl(c, { type: 'queued', world: hostedWorld, position })) json(c, { type: 'queued', world: hostedWorld, position });
  };
  const close = (c: Connection, code: string, retryable = false) => {
    if (c.closed) return;
    if (!sendControl(c, { type: 'error', code, retryable })) json(c, { type: 'error', code, retryable });
    c.ws.close(1008, code.slice(0, 80));
  };
  function sendControl(c: Connection, value: WorldControl): boolean {
    if (!c.stream || !c.input || !c.actor || c.stream.area !== c.actor.slot.area.services.id || c.closed || c.ws.readyState !== WebSocket.OPEN) return false;
    for (const chunk of c.protocol.encodeControl({ ...c.stream, sequence: ++c.sequence, tick: c.actor.slot.area.services.tick,
      acceptedInput: c.input.acceptedInput, consumedInput: publishedConsumed(c) }, value)) {
      c.ws.send(chunk, { binary: true }); metrics.packets++; metrics.bytesSent += chunk.byteLength;
    }
    return true;
  }
  const controlError = (c: Connection, code: string) => {
    sendControl(c, { type: 'error', code, retryable: false });
  };
  /** Only results whose save committed (c.ready) are ever sent, in a snapshot or on their own. */
  function materializeResults(c: Connection): CommandResult[] {
    return c.ready.map(result => result.status === 'durable' ? { ...result, revision: c.actor!.record.revision } : result);
  }
  function sendResults(c: Connection) {
    if (!c.ready.length || !c.baselineSequence || !c.stream || !c.input || !c.actor || c.closed || c.ws.readyState !== WebSocket.OPEN) return;
    if (c.ws.bufferedAmount > p.maxBufferedBytes) { close(c, 'result-backpressure', true); return; }
    const chunks = c.protocol.encodeEvents({ ...c.stream, sequence: ++c.sequence, tick: c.actor.slot.area.services.tick,
      acceptedInput: c.input.acceptedInput, consumedInput: publishedConsumed(c) }, { baselineSequence: c.baselineSequence, events: [], results: materializeResults(c) });
    for (const chunk of chunks) { c.ws.send(chunk, { binary: true }); metrics.packets++; metrics.bytesSent += chunk.byteLength; }
    c.ready = [];
  }
  function partyState(party: Party | undefined) {
    if (!party) return null;
    const run = party.dungeon?.dungeon;
    return { code: party.code, leader: party.members.get(party.leader)!, pvp: party.pvp,
      members: [...party.members].map(([character, id]) => {
        const actor = actors.get(character);
        if (!actor) throw new Error('party references retired actor');
        return { id, name: shownName(actor.record.identity.appearance.name), ref: actor.ref, world: actor.slot.world, online: !!actor.connection };
      }),
      // Members learn the running run here to join it; absent without dungeons so the older shape is unchanged.
      ...(p.dungeons ? { dungeon: run ? { runId: run.runId, tier: run.tier } : null } : {}) };
  }
  function publishParty(c: Connection) {
    if (!c.stream || !c.input || !c.actor || c.stream.area !== c.actor.slot.area.services.id || c.closed || c.ws.readyState !== WebSocket.OPEN) return;
    const state = partyState(memberParty.get(c.actor.record.characterId));
    sendControl(c, { type: 'party', state });
  }
  function syncPartyContexts() {
    for (const slot of allSlots) if (slot.area.players.size) {
      const context = slot.area.services.context;
      slot.area.applyContext({ ...context, pvp: slot.kind === 'party' && slot.party?.pvp ? 'party-only' : 'disabled',
        members: context.members.map(member => ({ ...member, party: memberParty.get(member.character)?.code ?? null })) });
    }
    for (const c of connections) if (c.actor && !c.closed) publishParty(c);
  }
  function leaveParty(character: string, sync = true) {
    const party = memberParty.get(character);
    if (!party) return;
    party.members.delete(character); memberParty.delete(character);
    if (!party.members.size) parties.delete(party.code);
    else if (party.leader === character) party.leader = party.members.keys().next().value!;
    if (sync) syncPartyContexts();
  }
  function partyCommand(c: Connection, command: { kind: string; code?: string; enabled?: boolean }) {
    const actor = c.actor!, character = actor.record.characterId, party = memberParty.get(character);
    if (!p.party) { controlError(c, 'party-unavailable'); return; }
    if (command.kind === 'partyCreate') {
      if (party || actor.slot.kind !== 'public' || parties.size >= p.party.maxParties) { controlError(c, 'party-unavailable'); return; }
      let code = '';
      for (let attempt = 0; attempt < 16; attempt++) { code = randomBytes(3).toString('hex').toUpperCase(); if (!parties.has(code)) break; }
      if (parties.has(code)) throw new Error('party code capacity');
      const created: Party = { code, leader: character, members: new Map([[character, randomUUID()]]), pvp: false };
      parties.set(code, created); memberParty.set(character, created); syncPartyContexts();
    } else if (command.kind === 'partyJoin') {
      const target = parties.get(command.code ?? ''), leader = target && actors.get(target.leader);
      const unit = actor.slot.area.services.getUnit(actor.ref), member = actor.slot.area.services.context.members.find(m => m.character === character);
      if (party || !target || !leader || target.encounter || target.members.size >= 8 || actor.slot.kind !== 'public' || actor.slot !== leader.slot ||
        !unit?.alive || member?.seatedBoat || member?.villagePlaying) { controlError(c, 'party-join-unavailable'); return; }
      target.members.set(character, randomUUID()); memberParty.set(character, target); syncPartyContexts();
    } else if (command.kind === 'partyLeave') {
      if (actor.slot.kind === 'party') returnRequests.set(character, { actor, leaveParty: true });
      else if (actor.slot.kind === 'dungeon') dungeonExits.set(character, { actor, slot: actor.slot, leaveParty: true });
      else leaveParty(character);
    } else if (command.kind === 'partyPvp') {
      if (!party || party.leader !== character || typeof command.enabled !== 'boolean') { controlError(c, 'party-leader-required'); return; }
      party.pvp = command.enabled; syncPartyContexts();
    } else if (command.kind === 'encounterLeave') {
      if (actor.slot.kind === 'dungeon') { dungeonExits.set(character, { actor, slot: actor.slot, leaveParty: false }); return; }
      if (actor.slot.kind !== 'party') { controlError(c, 'encounter-unavailable'); return; }
      returnRequests.set(character, { actor, leaveParty: false });
    }
  }
  /** A dungeon command from the wire joins the same ordered queue as host.dungeon(); a denial arrives as a control error. */
  function requestDungeon(c: Connection, command: Extract<HostCommand, { kind: `dungeon${string}` }>) {
    const actor = c.actor!, character = actor.record.characterId;
    if (!p.dungeons) { controlError(c, 'dungeon-unavailable'); return; }
    let owned: DungeonCommand;
    try { owned = validateDungeonCommand({ ...command }); } catch { controlError(c, 'invalid-command'); return; }
    if (dungeonRequests.has(character)) { controlError(c, 'dungeon-busy'); return; }
    dungeonRequests.set(character, { actor, command: owned, resolve: () => {} });
  }
  function participantOf(actor: Actor): ChatParticipant {
    return { accountId: actor.record.accountId, ref: { ...actor.ref }, name: shownName(actor.record.identity.appearance.name), partyId: memberParty.get(actor.record.characterId)?.code ?? null };
  }
  const refKey = (ref: EntityRef) => JSON.stringify([ref.area, ref.id, ref.life]);
  function rememberChatTarget(actor: Actor) {
    if (!deps.chat) return;
    const now = deps.nowMonotonicMs();
    for (const [key, item] of chatTargets) if (item.expires <= now) chatTargets.delete(key);
    const participant = participantOf(actor), key = refKey(actor.ref);
    chatTargets.delete(key); chatTargets.set(key, { participant, expires: now + CHAT.reportMs });
    while (chatTargets.size > p.maxConnections * 8) chatTargets.delete(chatTargets.keys().next().value!);
  }
  function chatScope(c: Connection): string {
    const actor = c.actor!, party = memberParty.get(actor.record.characterId);
    return JSON.stringify([c.generation, actor.generation, c.stream, actor.ref, party?.code ?? null, party ? [...party.members.keys()] : [], party?.pvp ?? false]);
  }
  function chatCommand(c: Connection, command: Extract<HostCommand, { kind: `chat${string}` }>, inputSequence?: number) {
    const operation = command.kind === 'chatSay' ? 'say' : command.kind === 'chatPreferences' ? 'preferences' : command.kind === 'chatBlock' ? 'block' : command.kind === 'chatMute' ? 'mute' : 'report';
    const reply = (value: Omit<Extract<WorldControl, { type: 'chatResult' }>, 'type' | 'inputSequence' | 'operation'>) => {
      if (inputSequence !== undefined) sendControl(c, { type: 'chatResult', inputSequence, operation, ...value });
    };
    if (!deps.chat || !p.chat || c.chatBusy || pendingChat >= p.chat.maxPending || !c.actor || !c.stream || frozen || draining || deps.ownership.closed.aborted) { reply({ ok: false, error: 'unavailable' }); return; }
    const actor = c.actor, scope = chatScope(c), sender = participantOf(actor);
    const recipients = [...actors.values()].filter(a => a.connection && !a.connection.closed && (command.kind === 'chatSay' && command.channel === 'party' ? sender.partyId && memberParty.get(a.record.characterId)?.code === sender.partyId : a.slot === actor.slot))
      .map(a => ({ actor: a, connection: a.connection!, scope: chatScope(a.connection!), participant: participantOf(a) }));
    let target: ChatParticipant | undefined;
    if ('target' in command) {
      const current = [...actors.values()].find(a => sameRef(a.ref, command.target));
      const remembered = chatTargets.get(refKey(command.target));
      target = current ? participantOf(current) : remembered && remembered.expires > deps.nowMonotonicMs() ? remembered.participant : undefined;
      if (!target) { reply({ ok: false, error: 'invalid' }); return; }
    }
    c.chatBusy = true; pendingChat++; if (inputSequence === undefined) c.chatNeedsPreferences = false;
    let task: Promise<ChatResult<object>>;
    if (command.kind === 'chatSay') task = deps.chat.say(sender, command.text, recipients.map(r => r.participant), command.channel);
    else if (command.kind === 'chatPreferences') {
      const { kind: _kind, ...change } = command;
      task = Object.keys(change).length ? deps.chat.setPreferences(sender.accountId, change) : deps.chat.preferences(sender.accountId);
    } else if (command.kind === 'chatBlock') task = deps.chat.block(sender.accountId, target!, command.blocked);
    else if (command.kind === 'chatMute') task = deps.chat.mute(sender.accountId, target!, command.muted);
    else task = deps.chat.report(sender, target!, sender.ref.area, command.reason);
    void task.catch(() => ({ ok: false as const, error: 'unavailable' as const })).then(result => enqueue(() => {
      pendingChat--; c.chatBusy = false;
      if (c.closed || c.actor !== actor || !c.stream || chatScope(c) !== scope || deps.ownership.closed.aborted || frozen || draining) return;
      deps.ownership.assertOwned();
      if (!result.ok) { reply(result); return; }
      if (command.kind === 'chatPreferences') {
        const preference = result as ChatResult<ChatPreferences> & { ok: true };
        c.chatPreferences = { enabled: preference.enabled, partyOnly: preference.partyOnly }; c.chatNeedsPreferences = false;
        sendControl(c, { type: 'chatPreferences', ...c.chatPreferences }); reply({ ok: true });
      } else if (command.kind === 'chatSay') {
        const said = result as Awaited<ReturnType<WorldChatService['say']>> & { ok: true };
        for (const recipient of recipients) if (!recipient.connection.closed && recipient.connection.actor === recipient.actor && chatScope(recipient.connection) === recipient.scope && said.recipients.some(ref => sameRef(ref, recipient.participant.ref)))
          sendControl(recipient.connection, { type: 'chatLine', channel: command.channel, line: said.line });
        reply({ ok: true });
      } else if (command.kind === 'chatBlock') reply({ ok: true, target: command.target, blocked: command.blocked });
      else if (command.kind === 'chatMute') reply({ ok: true, target: command.target, muted: command.muted });
      else reply({ ok: true, target: command.target }); // Global moderation state remains internal.
    }));
  }
  function failClosed() {
    accepting = false; frozen = true;
    if (!readyDone) { readyDone = true; rejectReady(new Error('world unavailable before ledger readiness')); }
    if (grantProofsActive) {
      grantProofsActive = false;
      for (const actor of actors.values()) if (actor.slot.ledgerMode === 'external-durable') {
        try { actor.slot.area.invalidateGrantRead(actor.ref); actor.grantRead = undefined; } catch (error) { deps.onFailure?.('ledger-invalidate', error); }
      }
    }
    for (const c of connections) close(c, 'host-unavailable', true);
  }
  const drain = (slot: Slot) => {
    const events = slot.area.drainEvents().filter(({ event }) => {
      if (event.type !== 'travelReady' || slots.has(event.destination)) return true;
      const actor = [...actors.values()].find(a => sameRef(a.ref, event.unit));
      if (actor?.connection) sendControl(actor.connection, { type: 'error', code: 'world-unavailable', retryable: false });
      return false;
    });
    if (slot.events.length + events.length > p.areaLimits.eventCount) throw new Error('publication event capacity');
    slot.events.push(...events); if (events.length) slot.watermark = events.at(-1)!.order;
    for (const { event } of events) if (event.type === 'travelReady') {
      const actor = [...actors.values()].find(a => sameRef(a.ref, event.unit));
      if (actor && !travels.has(actor.record.characterId)) travels.set(actor.record.characterId, { actor, source: slot, ref: event.unit, gate: event.gate, destination: event.destination });
    }
    return events;
  };
  const bootstrap = (c: Connection, actor: Actor) => {
    if (c.input && c.stream) {
      c.input.revoke(); c.protocol.reset(c.stream); // Drop the old render baseline while retaining its strict control watermark.
      c.revoked = { binding: c.stream, input: c.input, protocol: c.protocol }; c.protocol = deps.gameplay.create();
    }
    if (++c.epoch > 0xffffffff) throw new Error('stream epoch exhausted');
    c.actor = actor; actor.connection = c; actor.detachedAt = null; actor.generation = generation++;
    c.stream = { session: c.stream?.session ?? randomUUID(), area: actor.slot.area.services.id, epoch: c.epoch, catalog: deps.gameplay.catalog.version };
    c.sequence = 0; c.full = true; c.visible.clear(); c.protocol.reset(c.stream);
    c.publishedConsumed = 0; c.baselineSequence = 0; c.results = []; c.ready = []; c.discoveries = [];
    c.queueKey = undefined;
    c.input = new InputSession(c.stream, deps.gameplay.catalog, { now: deps.nowMonotonicMs() / 1000, maxQueued: p.maxQueuedInputs, timeoutSeconds: p.inputTimeoutMs / 1000, budget: c.inputBudget });
    actor.slot.area.resetInputSession(actor.ref); c.phase = 'admitted'; c.lastInput = deps.nowMonotonicMs(); c.timedOut = false;
    json(c, { type: 'world-bound', ...c.stream });
    if (p.party) publishParty(c);
    rememberChatTarget(actor); c.chatNeedsPreferences = !!deps.chat;
  };
  const attach = (request: Waiting): boolean => {
    const c = request.connection;
    if (c.closed || !c.binding || c.binding.expiresAt <= deps.nowWallMs()) return true;
    const existing = actors.get(request.record.characterId);
    if (existing) {
      if (existing.record.accountId !== c.binding.accountId || existing.connection) { close(c, 'character-active'); return true; }
      bootstrap(c, existing); return true;
    }
    const slot = slots.get(request.world)!;
    const admission = slot.area.reserveAdmission(request.record.characterId, slot.area.services.definition.spawn.id, 0);
    if (!admission) return false;
    let stage: ReturnType<Area['stageRestoredArrival']> | undefined;
    try {
      const checkpoint = deps.codec.toCore(request.record.checkpoint);
      const offline = p.offlineSeconds(request.record, deps.nowWallMs());
      if (!Number.isFinite(offline) || offline < 0) throw new Error('invalid offline interval');
      stage = slot.area.stageRestoredArrival(admission, checkpoint, prepareRestore(checkpoint, offline, p.restore), { revision: request.record.revision });
      if (!registry.compareAndSwap(request.record.characterId, null, stage.newRef)) throw new Error('character ownership conflict');
      const ref = slot.area.activateRestoredArrival(stage.token); slot.area.releaseAdmission(admission.token);
      const actor: Actor = { record: request.record, slot, ref, connection: null, detachedAt: null, generation: generation++, pendingReplay: true, dungeonAwards: !!p.dungeons };
      actors.set(request.record.characterId, actor); bootstrap(c, actor); return true;
    } catch {
      if (stage) slot.area.abortArrival(stage.token);
      slot.area.releaseAdmission(admission.token); close(c, 'restore-failed'); return true;
    }
  };
  const admitWaiting = () => {
    if (barrier || frozen) return;
    let attached = false;
    for (let i = 0; i < waiting.length;) {
      const request = waiting[i];
      if (attach(request)) { waiting.splice(i, 1); attached ||= !!request.connection.actor; }
      else { queueNotice(request.connection, request.world, waiting.slice(0, i + 1).filter(r => r.world === request.world).length); i++; }
    }
    if (attached) startDurability();
  };
  const advanceTravel = () => {
    if (barrier || frozen) return;
    for (const [character, request] of travels) {
      const { actor, source } = request, destination = slots.get(request.destination);
      if (!destination || actor.slot !== source || !sameRef(actor.ref, request.ref) || !actor.connection) { travels.delete(character); continue; }
      // The transfer records every unacknowledged grant of the source Area (whoever its recipient is) in the in-memory
      // mailbox and acknowledges it there. Retained grants wait for the next save round, and ticks go on while one is in
      // flight, so the source may hold grants that are not journaled yet: journal them in a halting round first (no tick
      // can add one before the travel runs at a later pump), so the transfer never acknowledges a grant that is not in PG.
      if (source.ledgerMode === 'retained' && source.area.pendingGrants().length) { startDurability(); return; }
      const result = transfers.transfer(character, source.area, destination.area, request.gate, metrics.ticks);
      if (result.ok) {
        actor.ref = result.ref; actor.slot = destination; actor.generation = generation++;
        if (p.party) syncPartyContexts();
        bootstrap(actor.connection, actor); travels.delete(character); startDurability(); break;
      }
      if (result.reason === 'destination-full') {
        queueNotice(actor.connection, request.destination, [...travels.values()].filter(r => r.destination === request.destination).findIndex(r => r.actor === actor) + 1);
      } else {
        controlError(actor.connection, 'travel-unavailable'); travels.delete(character);
      }
    }
  };
  const moveActor = (actor: Actor, destination: Slot, spawn: string): boolean => {
    const source = actor.slot, ref = actor.ref;
    const admission = destination.area.reserveAdmission(actor.record.characterId, spawn, metrics.ticks);
    if (!admission) return false;
    let departure: ReturnType<Area['stageDeparture']> | undefined;
    let arrival: ReturnType<Area['stageArrival']> | undefined;
    let committed = false;
    try {
      departure = source.area.stageDeparture(ref);
      arrival = destination.area.stageArrival(admission, departure.dto);
      if (!registry.compareAndSwap(actor.record.characterId, ref, arrival.newRef)) throw new Error('encounter ownership conflict');
      committed = true;
      source.area.commitDeparture(departure.token);
      actor.ref = destination.area.activateArrival(arrival.token); actor.slot = destination; actor.generation = generation++;
      destination.area.releaseAdmission(admission.token); drain(source); return true;
    } catch (error) {
      if (committed) throw error; // CAS is the commit boundary; never pretend a partial commit rolled back.
      if (arrival) destination.area.abortArrival(arrival.token);
      if (departure) source.area.abortDeparture(departure.token);
      destination.area.releaseAdmission(admission.token); return false;
    }
  };
  const available = (actor: Actor) => {
    const area = actor.slot.area, unit = area.services.getUnit(actor.ref), player = area.services.playerByCharacter(actor.record.characterId);
    const member = area.services.context.members.find(m => m.character === actor.record.characterId);
    return !!unit?.alive && !unit.hidden && !!player && !player.state.controlsLocked && !member?.seatedBoat && !member?.villagePlaying &&
      !area.services.encounterActive() && area.services.time - unit.lastCombat >= 5;
  };
  const advanceEncounters = () => {
    if (barrier || frozen || !p.party) return;
    for (const [character, request] of encounterRequests) {
      encounterRequests.delete(character);
      const { actor, profile } = request, c = actor.connection, source = actor.slot, party = memberParty.get(character);
      const definition = deps.worlds.get(source.world)?.encounterDefinitions.get(profile), boss = definition?.bosses[0];
      const unit = source.area.services.getUnit(actor.ref), player = source.area.services.playerByCharacter(character);
      const beacon = source.area.snapshot().features.beaconLit;
      if (!c || !party || !party.members.has(character) || source.kind !== 'public' || !definition || !boss || !unit || !player || !available(actor) ||
        !canChallenge(unit.level, BOSS_PROFILES[profile].level, !!player.state.flags.rustCleared, !!player.state.flags.abyssCleared, player.state.quests.chapter) ||
        (profile === 'rust' || profile === 'abyss') && !beacon ||
        Math.hypot(unit.x - boss.arena.position.x, unit.y - boss.arena.position.y, unit.z - boss.arena.position.z) > boss.arena.radius + 3) {
        if (c) controlError(c, 'encounter-prerequisites'); continue;
      }
      if (party.dungeon || party.encounter && (party.encounter.profile !== profile || party.encounter.world !== source.world)) { controlError(c, 'party-encounter-active'); continue; }
      const returnSpawn = p.party.returnSpawn(source.world, profile);
      const publicDefinition = source.area.services.definition;
      if (![publicDefinition.spawn.id, publicDefinition.recall.id, ...Object.values(publicDefinition.pois).map(poi => poi.id)].includes(returnSpawn)) { controlError(c, 'encounter-return-unconfigured'); continue; }
      let destination = party.encounter;
      if (!destination) {
        if ([...allSlots].filter(s => s.kind !== 'public').length >= p.party.maxEncounters) { controlError(c, 'encounter-capacity'); continue; }
        const loaded = deps.worlds.get(source.world)!, now = deps.nowMonotonicMs();
        const id = `party:${randomUUID()}`;
        const area = createArea({ endingPresentation: endingOptions(id), ledgerMode: source.ledgerMode, ledgerLimits: p.ledger?.sourceLimits, id, definition, query: loaded.query, actionData: loaded.actionData,
          policy: loaded.policy, seed: loaded.seed, characters: registry, context: { mode: 'party-encounter', pvp: party.pvp ? 'party-only' : 'disabled', members: [] }, limits: p.areaLimits, ...(featureAwards ? { featureAwards } : {}) });
        area.bootstrapEncounter(profile, { beaconLit: beacon });
        destination = { kind: 'party', ledgerMode: source.ledgerMode, world: source.world, area, party, profile, tick: new DeadlineScheduler(30, now),
          snapshot: new DeadlineScheduler(20, now, 1), events: [], watermark: -1, lastCheckpoint: now, publishes: 0 };
        party.encounter = destination; allSlots.add(destination); destination.source = sourceAdapter(destination);
      }
      // A public request starts a dormant/rematch boss or joins an already running encounter.
      // Transfer places joins inside the arena, so the local outside-arena bossChallenge heuristic does not apply.
      const targetBoss = destination.area.services.bossByProfile(profile);
      const starting = targetBoss?.state === 'dormant' || targetBoss?.state === 'dead';
      const joining = targetBoss?.state === 'waking' || targetBoss?.state === 'idle' || targetBoss?.state === 'fight';
      if (!targetBoss || !starting && !joining) { controlError(c, 'encounter-unavailable'); continue; }
      if (!moveActor(actor, destination, 'encounter:entry')) { controlError(c, 'encounter-full'); continue; }
      actor.returnTo = { world: source.world, spawn: returnSpawn };
      syncPartyContexts();
      const started = !starting || destination.area.services.runCommand(actor.ref, { kind: 'bossChallenge', profile });
      actor.ref = destination.area.services.playerByCharacter(character)!.state.unit;
      bootstrap(c, actor);
      if (!started) controlError(c, 'encounter-start-unavailable');
      drain(destination); startDurability(); break;
    }
    if (barrier) return;
    for (const [character, request] of returnRequests) {
      returnRequests.delete(character);
      const { actor } = request, c = actor.connection;
      if (!c || actor.slot.kind !== 'party' || !actor.returnTo || !available(actor)) { if (c) controlError(c, 'encounter-return-unavailable'); continue; }
      const destination = slots.get(actor.returnTo.world)!;
      if (!moveActor(actor, destination, actor.returnTo.spawn)) {
        returnRequests.set(character, request); queueNotice(c, destination.world, 1); continue;
      }
      actor.returnTo = undefined;
      if (request.leaveParty) leaveParty(character); else syncPartyContexts();
      bootstrap(c, actor); startDurability(); break;
    }
  };
  const cleanupEncounters = () => {
    if (barrier || frozen) return;
    for (const slot of allSlots) if (slot.kind === 'party' && slot.area.players.size === 0 && slot.area.pendingGrants().length === 0 && (!slot.source || !slot.area.resourceUsage().dirtyCreditEntries && !slot.area.resourceUsage().pendingDeaths)) {
      slot.area.dispose(); allSlots.delete(slot); failedSources.delete(slot); drainedFailedSources.delete(slot); attemptedFailedSources.delete(slot); if (slot.party?.encounter === slot) slot.party.encounter = undefined;
    }
  };
  // Private dungeon runs. A run Area is created per start and shares the party room pool with boss encounters.
  function createDungeonArea(tier: DungeonTier, ledgerMode: LedgerMode, runId: string): Area {
    const loaded = deps.worlds.get(dungeonWorld(tier))!;
    return createArea({ ledgerMode, ledgerLimits: p.ledger?.sourceLimits, id: `dungeon:${runId}`, definition: createDungeonDefinition(tier), query: createDungeonQuery(loaded.query),
      actionData: loaded.actionData, policy: loaded.policy, seed: loaded.seed, characters: registry, context: { mode: 'dungeon', pvp: 'disabled', members: [] },
      limits: p.areaLimits, dungeon: { runId, tier }, featureAwards });
  }
  const unsealedDungeon = () => [...allSlots].some(slot => !!slot.dungeon?.frozen);
  const settled = (actor: Actor) => !actor.slot.area.appliedGrantIds(actor.record.characterId).length && !actor.slot.area.appliedFeatureAwardIds(actor.record.characterId).length;
  function settleDungeonRequests(code: string) {
    for (const request of dungeonRequests.values()) request.resolve({ ok: false, code });
    dungeonRequests.clear();
  }
  /** All-or-nothing entry: every admission and staged transfer exists before the first ownership switch. */
  function enterDungeon(members: readonly Actor[], destination: Slot, returns: ReadonlyMap<Actor, Readonly<DungeonReturnBinding>>): boolean {
    const staged: { actor: Actor; source: Slot; admission: Admission; departure?: StagedDeparture; arrival?: StagedArrival }[] = [];
    try {
      for (const actor of members) {
        const admission = destination.area.reserveAdmission(actor.record.characterId, destination.area.services.definition.spawn.id, metrics.ticks);
        if (!admission) throw new Error('dungeon admission full');
        staged.push({ actor, source: actor.slot, admission });
      }
      for (const entry of staged) { entry.departure = entry.source.area.stageDeparture(entry.actor.ref); entry.arrival = destination.area.stageArrival(entry.admission, entry.departure.dto); }
      for (const entry of staged) if (!sameRef(registry.owner(entry.actor.record.characterId) ?? { area: '', id: 0, life: 0 }, entry.actor.ref)) throw new Error('dungeon ownership conflict');
    } catch {
      for (const entry of staged) {
        if (entry.arrival) destination.area.abortArrival(entry.arrival.token);
        if (entry.departure) entry.source.area.abortDeparture(entry.departure.token);
        destination.area.releaseAdmission(entry.admission.token);
      }
      return false;
    }
    // Commit boundary: owners were checked above and nothing below awaits, ticks or publishes.
    for (const entry of staged) {
      const { actor, source } = entry;
      if (!registry.compareAndSwap(actor.record.characterId, actor.ref, entry.arrival!.newRef)) throw new Error('dungeon ownership conflict');
      source.area.commitDeparture(entry.departure!.token);
      actor.ref = destination.area.activateArrival(entry.arrival!.token); destination.area.releaseAdmission(entry.admission.token);
      destination.area.bindDungeonReturn(actor.ref, returns.get(actor)!, deps.worlds.get(source.world)!.query);
      actor.slot = destination; actor.generation = generation++; drain(source);
    }
    return true;
  }
  /** Same-process exit through the source-owned checkpoint stage: survival, death clock and progression are preserved. */
  function exitDungeon(actor: Actor, slot: Slot): 'moved' | 'wait' | 'failed' {
    const character = actor.record.characterId, destination = slots.get(slot.world)!;
    if (!settled(actor)) return 'wait';
    const admission = destination.area.reserveAdmission(character, destination.area.services.definition.spawn.id, metrics.ticks);
    if (!admission) return 'wait';
    let exit: ReturnType<Area['stageInstanceExit']> | undefined, arrival: StagedArrival | undefined, committed = false;
    try {
      exit = slot.area.stageInstanceExit(actor.ref);
      arrival = destination.area.stageInstanceArrival(admission, exit);
      slot.area.validateInstanceExit(exit.token); destination.area.validateInstanceArrival(arrival.token);
      if (!registry.compareAndSwap(character, exit.sourceRef, arrival.newRef)) throw new Error('dungeon exit ownership conflict');
      committed = true;
      slot.area.commitInstanceExit(exit.token, arrival.newRef);
      actor.ref = destination.area.activateInstanceArrival(arrival.token);
    } catch (error) {
      if (committed) throw error;
      if (arrival) destination.area.abortArrival(arrival.token);
      if (exit) slot.area.abortInstanceExit(exit.token);
      destination.area.releaseAdmission(admission.token); return 'failed';
    }
    destination.area.releaseAdmission(admission.token);
    actor.slot = destination; actor.generation = generation++; drain(slot);
    return 'moved';
  }
  function dungeonCommand(actor: Actor, command: DungeonCommand): DungeonCommandResult | 'wait' {
    const character = actor.record.characterId, party = memberParty.get(character), fail = (code: string) => ({ ok: false as const, code });
    if (actors.get(character) !== actor || !actor.connection || actor.connection.closed) return fail('dungeon-unavailable');
    if (command.kind === 'dungeonReturn') {
      const slot = actor.slot, run = slot.dungeon;
      if (slot.kind !== 'dungeon' || !run || run.runId !== command.run) return fail('dungeon-run-unavailable');
      const phase = slot.area.dungeonObservation()!.phase;
      // The leader may end an active run. Once it has ended anyone may bring the whole run home, dead or alive.
      if (phase !== 'clear' && phase !== 'failed' && party?.leader !== character) return fail('dungeon-leader-required');
      for (const resident of actors.values()) if (resident.slot === slot && !dungeonExits.has(resident.record.characterId)) dungeonExits.set(resident.record.characterId, { actor: resident, slot, leaveParty: false });
      return { ok: true, run: { area: slot.area.services.id, runId: run.runId }, tier: run.tier };
    }
    const source = actor.slot;
    if (source.kind !== 'public') return fail('dungeon-unavailable');
    if (!party) return fail('dungeon-party-required');
    let destination: Slot | undefined, tier: DungeonTier, members: Actor[];
    if (command.kind === 'dungeonStart') {
      tier = command.tier;
      if (!p.dungeons!.tiers.includes(tier)) return fail('dungeon-unavailable');
      if (party.leader !== character) return fail('dungeon-leader-required');
      if (party.encounter || party.dungeon) return fail('party-encounter-active');
      if ([...allSlots].filter(slot => slot.kind !== 'public').length >= p.party!.maxEncounters) return fail('dungeon-capacity');
      members = [...party.members.keys()].map(id => actors.get(id)!);
    } else {
      destination = party.dungeon;
      if (!destination?.dungeon || destination.dungeon.runId !== command.run) return fail('dungeon-run-unavailable');
      const run = destination.area.dungeonObservation()!;
      // A late joiner cannot claim a run that already ended or holds an unsealed clear.
      if (run.phase === 'clear' || run.phase === 'failed' || run.completionPending || destination.dungeon.frozen) return fail('dungeon-run-ended');
      tier = destination.dungeon.tier; members = [actor];
    }
    if (source.world !== dungeonWorld(tier)) return fail('dungeon-world');
    const returns = new Map<Actor, Readonly<DungeonReturnBinding>>();
    for (const member of members) {
      if (!member?.connection || member.connection.closed || member.slot !== source) return fail('dungeon-party-not-ready');
      const unit = source.area.services.getUnit(member.ref)!;
      if (unit.level < tier) return fail('dungeon-level');
      if (!available(member)) return fail('dungeon-party-busy');
      try { returns.set(member, dungeonReturnFor(source.world, deps.worlds.get(source.world)!.query, unit)); } catch { return fail('dungeon-return-unsafe'); }
    }
    if (!members.every(settled)) return 'wait';
    if (!destination) {
      const runId = randomUUID(), area = createDungeonArea(tier, source.ledgerMode, runId), now = deps.nowMonotonicMs();
      destination = { kind: 'dungeon', ledgerMode: source.ledgerMode, world: source.world, area, party, tick: new DeadlineScheduler(30, now),
        snapshot: new DeadlineScheduler(20, now, 1), events: [], watermark: -1, lastCheckpoint: now, publishes: 0, dungeon: { runId, tier } };
      if (!enterDungeon(members, destination, returns)) { area.dispose(); return fail('dungeon-unavailable'); }
      party.dungeon = destination; allSlots.add(destination); destination.source = sourceAdapter(destination);
    } else if (!enterDungeon(members, destination, returns)) return fail('dungeon-full');
    syncPartyContexts();
    for (const member of members) bootstrap(member.connection!, member);
    return { ok: true, run: { area: destination.area.services.id, runId: destination.dungeon!.runId }, tier };
  }
  const advanceDungeons = () => {
    if (barrier || frozen || !p.dungeons) return;
    let flush = false;
    for (const [character, request] of dungeonRequests) {
      const result = dungeonCommand(request.actor, request.command);
      if (result === 'wait') { flush = true; continue; } // Receipts must be durable before an ownership switch.
      dungeonRequests.delete(character); flush ||= result.ok;
      if (!result.ok && request.actor.connection) controlError(request.actor.connection, result.code);
      request.resolve(result);
    }
    for (const [character, request] of dungeonExits) {
      const { actor, slot } = request;
      if (actors.get(character) !== actor || actor.slot !== slot) { dungeonExits.delete(character); continue; }
      const moved = exitDungeon(actor, slot);
      if (moved === 'wait') { flush = true; continue; }
      dungeonExits.delete(character);
      if (moved === 'failed') { if (actor.connection) controlError(actor.connection, 'dungeon-return-unavailable'); continue; }
      if (request.leaveParty) leaveParty(character); else syncPartyContexts();
      if (actor.connection) bootstrap(actor.connection, actor);
      flush = true;
    }
    if (flush) startDurability();
  };
  const cleanupDungeons = () => {
    if (barrier || frozen) return;
    let ended = false;
    for (const slot of allSlots) if (slot.kind === 'dungeon' && slot.area.players.size === 0 && !slot.dungeon!.frozen && !slot.area.pendingDungeonCompletion() &&
      (!slot.source || !slot.area.resourceUsage().dirtyCreditEntries && !slot.area.resourceUsage().pendingDeaths)) {
      slot.area.dispose(); allSlots.delete(slot); failedSources.delete(slot); drainedFailedSources.delete(slot); attemptedFailedSources.delete(slot);
      if (slot.party?.dungeon === slot) { slot.party.dungeon = undefined; ended = true; }
    }
    // The party control stops advertising the disposed run.
    if (ended) syncPartyContexts();
  };
  /** A safe public checkpoint cannot restore in the chamber: discard the local life and readmit the durable one publicly. */
  function evictDungeonResident(actor: Actor, recovery: Recovery<IdentityJson, CheckpointJson, GrantJson>) {
    const character = actor.record.characterId, slot = actor.slot, c = actor.connection;
    slot.area.evictForRecovery(actor.ref); metrics.recoveries++;
    actors.delete(character); travels.delete(character); encounterRequests.delete(character); returnRequests.delete(character); dungeonExits.delete(character);
    // Inside a durability barrier contexts cannot change; the barrier's final boundary resyncs every party.
    actor.connection = null; leaveParty(character, false); drain(slot);
    if (c && !c.closed) waiting.unshift({ connection: c, record: recovery.character, world: deps.codec.toCore(recovery.character.checkpoint).world });
  }
  /** Journal each frozen clear, then ACK its Area candidate. A failed write keeps the same roster for the next barrier. */
  async function sealDungeonRuns() {
    if (!deps.dungeonCompletions) return;
    for (const slot of [...allSlots]) {
      const frozenClear = slot.dungeon?.frozen, area = slot.area;
      if (!frozenClear) continue;
      const result = await sealDungeonCompletion({ area, frozen: frozenClear, store: deps.dungeonCompletions, ownership: deps.ownership, boundary,
        isCurrent: () => !stopped && allSlots.has(slot) && slot.area === area && slot.dungeon?.frozen === frozenClear });
      await boundary(() => {
        if (result.kind === 'unresolved') {
          if (result.reason === 'ownership') throw new Error('dungeon seal ownership lost');
          metrics.dungeonSealRetries++; nextDungeonSeal = deps.nowMonotonicMs() + p.checkpointIntervalMs; return;
        }
        if (slot.dungeon?.frozen === frozenClear) slot.dungeon.frozen = undefined;
        if (result.kind === 'sealed') { metrics.dungeonClears++; for (const r of frozenClear.manifest.recipients) { const a = actors.get(r.characterId); if (a) a.dungeonAwards = true; } }
      });
    }
  }
  /** Certified clear awards for every actor that may have unpaid rows. Returns true when the round must restart. */
  async function deliverPendingDungeonAwards(): Promise<boolean> {
    if (!p.dungeons || !deps.dungeonCompletions) return false;
    const store = deps.dungeonCompletions, maxPending = p.dungeons.maxPendingAwards;
    const leases = await boundary(() => { deps.ownership.assertOwned(); return [...actors.values()].filter(a => a.dungeonAwards).map(actor => ({ actor, generation: actor.generation, slot: actor.slot, ref: { ...actor.ref }, revision: actor.record.revision })); });
    const results = await Promise.all(leases.map(async lease => ({ lease, result: await deliverDungeonAwards({ area: lease.slot.area, ref: lease.ref, accountId: lease.actor.record.accountId,
      characterId: lease.actor.record.characterId, expectedRevision: lease.revision, maxPending, store, ownership: deps.ownership, boundary,
      isCurrent: () => actors.get(lease.actor.record.characterId) === lease.actor && lease.actor.generation === lease.generation && lease.actor.slot === lease.slot &&
        sameRef(lease.actor.ref, lease.ref) && lease.actor.record.revision === lease.revision }) })));
    return boundary(() => {
      deps.ownership.assertOwned(); let retry = false;
      for (const { lease, result } of results) {
        if (result.kind === 'unresolved') throw new Error('dungeon award certification unresolved: ' + result.reason);
        if (result.kind === 'stale' || result.kind === 'revision') retry = true;
        else if (result.kind === 'applied') { lease.actor.dungeonAwards = result.more; if (result.more) lease.actor.pendingReplay = true; }
      }
      for (const slot of allSlots) drain(slot);
      return retry;
    });
  }
  const load = (c: Connection, characterId: string) => {
    const attempt = c.generation, binding = c.binding!; c.phase = 'loading';
    void deps.characters.getOwned(binding.accountId, characterId).then(record => enqueue(() => {
      if (c.closed || c.generation !== attempt || !accepting || deps.ownership.closed.aborted) return;
      if (actors.get(record.characterId)?.connection || waiting.some(request => request.record.characterId === record.characterId && request.connection !== c)) { close(c, 'character-active'); return; }
      const world = deps.codec.toCore(record.checkpoint).world;
      if (!slots.has(world)) { close(c, 'world-unavailable'); return; }
      if (waiting.length >= p.maxWaiting) { close(c, 'queue-full', true); return; }
      c.phase = 'queued'; waiting.push({ connection: c, record, world }); metrics.queued++; admitWaiting();
    }), () => enqueue(() => { if (!c.closed && c.generation === attempt) close(c, 'character-unavailable'); }));
  };

  function restoreDurableActor(actor: Actor, recovery: Recovery<IdentityJson, CheckpointJson, GrantJson>) {
    deps.ownership.assertOwned();
    if (actor.slot.kind === 'dungeon') { evictDungeonResident(actor, recovery); return; }
    actor.dungeonAwards = !!p.dungeons;
    const checkpoint = deps.codec.toCore(recovery.character.checkpoint), restored = prepareRestore(checkpoint, 0, p.restore);
    const ref = actor.slot.area.restorePlayerCheckpoint(actor.ref, checkpoint, restored, recovery.grants.filter(grant => grant.appliedRevision !== null).map(grant => grant.id), recovery.character.revision);
    actor.ref = ref; actor.record = recovery.character; actor.generation = generation++; actor.pendingReplay = true;
    if (actor.connection) bootstrap(actor.connection, actor);
  }
  const liveSourceArea = (areaId: string) => [...allSlots].some(slot => slot.area.services.id === areaId && slot.ledgerMode === 'external-durable' && !drainedFailedSources.has(slot));
  const sourceNeedsIO = (slot: Slot) => {
    if (slot.ledgerMode !== 'external-durable' || failedSources.has(slot) || drainedFailedSources.has(slot)) return false;
    const usage = slot.area.resourceUsage();
    return !!usage.dirtyCreditEntries || !!usage.pendingDeaths || !!slot.area.contributionSummariesNeeded().length;
  };
  type SourceGrant = { slot: Slot } & ReturnType<Area['pendingGrants']>[number];
  const retainedSources = (): SourceGrant[] => [...allSlots].filter(slot => slot.ledgerMode === 'retained').flatMap(slot => slot.area.pendingGrants().map(entry => ({ slot, ...entry })));
  /** Journal retained source grants: an entire death's recipients in one transaction. No recipient is ACKed individually. */
  async function journalSources(sources: readonly SourceGrant[]) {
    const groups = new Map<string, SourceGrant[]>();
    const unique = new Map<string, string>();
    for (const source of sources) {
      const signature = JSON.stringify(source.grant), prior = unique.get(source.grant.id);
      if (prior && prior !== signature) throw new Error('grant identity content conflict');
      if (prior) continue;
      unique.set(source.grant.id, signature);
      const key = JSON.stringify(source.grant.victim), group = groups.get(key) ?? []; group.push(source); groups.set(key, group);
    }
    for (const group of groups.values()) if (group.length > victimResources.maxEntries) throw new OutcomeResourcePause('victim outcome resource budget; complete source retained');
    // Each death is its own whole-outcome transaction. Deaths that share a recipient run one after another in one lane (so
    // none waits on another's row lock inside its deadline); up to JOURNAL_CONCURRENCY lanes run at once. Every one settles
    // before the first failure is reported, so a retry never races a transaction of this round.
    const lanes = new Map<string, SourceGrant[][]>(), owner = new Map<string, string>();
    const root = (character: string): string => { let at = character; while (owner.get(at) !== at) at = owner.get(at)!; return at; };
    for (const group of groups.values()) {
      const recipients = group.map(({ grant }) => grant.recipient);
      for (const recipient of recipients) if (!owner.has(recipient)) owner.set(recipient, recipient);
      for (const recipient of recipients.slice(1)) owner.set(root(recipient), root(recipients[0]));
    }
    for (const group of groups.values()) { const lane = root(group[0].grant.recipient), list = lanes.get(lane) ?? []; list.push(group); lanes.set(lane, list); }
    const resources = victimResources, pending = [...lanes.values()], failures: unknown[] = [];
    const record = async (group: SourceGrant[]) => {
      const entries: GrantBatchEntry<GrantJson>[] = [];
      // An actor's account is its record's; offline recipients are looked up as before.
      for (const { grant } of group) entries.push({ accountId: actors.get(grant.recipient)?.record.accountId ?? await deps.characters.getOwner(grant.recipient), characterId: grant.recipient, id: grant.id, payload: deps.codec.grantToJson(grant) });
      const recorded = await deps.characters.recordVictimOutcome(entries, resources);
      if (recorded.length !== entries.length || recorded.some((entry, index) => entry.id !== entries[index].id)) throw new Error('incomplete victim outcome journal');
    };
    await Promise.all(Array.from({ length: Math.min(JOURNAL_CONCURRENCY, pending.length) }, async () => {
      for (let lane = pending.shift(); lane; lane = pending.shift()) for (const group of lane) { try { await record(group); } catch (error) { failures.push(error); break; } }
    }));
    // Any failure that is not resource-only fails closed rather than becoming a resumable pause.
    if (failures.length) throw failures.find(error => !(error instanceof CharacterStoreError && error.code === 'resource_limit')) ?? failures[0];
  }
  /** Halting save round: the world is held (no tick, no snapshot) from its start to its end. See startSave() for the other kind. */
  function startDurability() {
    if (barrier || frozen || !actors.size && !external && !unsealedDungeon()) return;
    metrics.persistenceBarriers++; metrics.haltingBarriers++; const began = deps.nowMonotonicMs(); lastSave = began;
    const tokens = new Map<Slot, string>();
    for (const slot of allSlots) if (slot.area.players.size || slot.ledgerMode === 'external-durable') tokens.set(slot, slot.area.beginDurabilityBarrier('checkpoint'));
    const sources = retainedSources();
    metrics.pendingSourceGrants = sources.length;
    // Retained mode: the certified page read (about five queries and two checkpoint decodes per actor) is skipped for an
    // actor with nothing to read: not a recipient of this barrier's grants, not pendingReplay, and no unreceipted journal
    // row at the start of the round (charactersWithPendingGrants, which also sees rows that other writers such as a late
    // old-owner seal committed). A skipped actor's revision is still checked by its checkpoint commit in the same round.
    // An actor with dungeon awards to deliver is never skipped: the award read only reports a moved revision, and this
    // page read is what recovers it before that read; skipping it would retry the stale revision until recovery capacity.
    const grantRecipients = external ? null : new Set(sources.map(source => source.grant.recipient));
    const work = async () => {
      let startupDrained = false;
      await journalSources(sources);
      for (const slot of allSlots) if (slot.source) {
        for (;;) { const progress = await slot.source.drain({ refreshSummaries: true }); if (!progress.more) break; }
      }
      if (outcomeRecovery && (startupRecovery || !draining && deps.nowMonotonicMs() >= nextRecovery)) {
        const initial = startupRecovery;
        for (;;) {
          if (draining && initial) throw new Error('shutdown before initial ledger recovery');
          const sweep = await outcomeRecovery.sweep({ isLiveArea: liveSourceArea });
          if (!initial || sweep.cycleComplete && !sweep.cycleHasPending) break;
        }
        nextRecovery = deps.nowMonotonicMs() + p.ledger!.recoveryIntervalMs;
        startupDrained = initial;
      }
      await sealDungeonRuns();
      for (let round = 0; round <= p.persistence.maxRecoveryRounds; round++) {
        const ids = [...actors.keys()];
        const [unread, unpaid] = await Promise.all([grantRecipients ? deps.characters.charactersWithPendingGrants(ids) : null,
          deps.dungeonCompletions ? deps.dungeonCompletions.charactersWithPendingDungeonAwards(ids) : null]);
        // Retained-mode host fence. Area-owned one-use tokens are still required before pruning is enabled.
        const leases = await boundary(() => {
          deps.ownership.assertOwned();
          return [...actors.values()].map(actor => {
            const room = 256 - actor.slot.area.appliedGrantIds(actor.record.characterId).length;
            if (room < 0) throw new Error('checkpoint receipt capacity');
            const connection = actor.connection, limit = Math.min(100, room);
            let token: GrantReadToken | null = null;
            if (limit && actor.slot.ledgerMode === 'external-durable') {
              actor.slot.area.bindDurableLedger(actor.ref, actor.record.revision);
              token = actor.slot.area.beginGrantRead(actor.ref, actor.record.revision); actor.grantRead = token; grantProofsActive = true;
            }
            // An award row another writer committed (such as a late old-owner seal) flags its online recipient like a local seal does.
            if (unpaid?.has(actor.record.characterId)) actor.dungeonAwards = true;
            const skip = !!unread && limit > 0 && !actor.pendingReplay && !actor.dungeonAwards && !grantRecipients!.has(actor.record.characterId) && !unread.has(actor.record.characterId);
            return { actor, ownerGeneration: actor.generation, slot: actor.slot, ref: { ...actor.ref }, token,
              revision: actor.record.revision, connection, connectionGeneration: connection?.generation, session: connection?.stream?.session, limit, skip };
          });
        });
        const pages = await Promise.all(leases.map(async lease => ({ lease, result: lease.skip ? null : lease.limit ? await readCertifiedGrantPage(deps.characters, deps.ownership, {
          accountId: lease.actor.record.accountId, characterId: lease.actor.record.characterId, expectedRevision: lease.revision, limit: lease.limit,
        }) : null })));
        const reread = await boundary(() => {
          deps.ownership.assertOwned(); let retry = false;
          for (const { lease, result } of pages) {
            const actor = lease.actor, connection = actor.connection;
            const current = actors.get(actor.record.characterId) === actor && actor.generation === lease.ownerGeneration && actor.slot === lease.slot &&
              sameRef(actor.ref, lease.ref) && actor.record.revision === lease.revision && connection === lease.connection && connection?.generation === lease.connectionGeneration && connection?.stream?.session === lease.session;
            if (!current) { if (lease.token) lease.slot.area.cancelGrantRead(lease.token); actor.grantRead = undefined; actor.pendingReplay = true; retry = true; continue; }
            if (lease.skip) continue;
            if (!result) { actor.pendingReplay = true; continue; }
            if (result.kind === 'unresolved') { if (lease.token) lease.slot.area.cancelGrantRead(lease.token); actor.grantRead = undefined; throw new Error('journal certification unresolved: ' + result.reason); }
            if (result.kind === 'recovery') { if (lease.token) lease.slot.area.cancelGrantRead(lease.token); actor.grantRead = undefined; metrics.recoveries++; restoreDurableActor(actor, result.recovery); retry = true; continue; }
            const grants = result.grants.map(grant => deps.codec.grantFromJson(grant.payload));
            if (lease.token) actor.slot.area.applyCertifiedGrants(lease.token, { revision: result.revision, grants });
            else {
              if (actor.slot.ledgerMode !== 'retained') throw new Error('external grant delivery requires an Area proof');
              for (const grant of grants) actor.slot.area.receiveGrant(grant);
            }
            actor.grantRead = undefined; actor.pendingReplay = result.more;
          }
          grantProofsActive = false;
          for (const slot of allSlots) drain(slot);
          return retry;
        });
        if (reread) { if (round === p.persistence.maxRecoveryRounds) throw new Error('journal certification recovery capacity'); continue; }
        if (await deliverPendingDungeonAwards()) { if (round === p.persistence.maxRecoveryRounds) throw new Error('dungeon award recovery capacity'); continue; }
        const captures = await boundary(() => { deps.ownership.assertOwned(); return [...actors.values()].map(actor => ({ actor, generation: actor.generation, capture: actor.slot.area.capturePlayerCheckpoint(actor.ref) })); });
        const results = await persistence.commitBatch(captures.map(({ actor, capture }) => ({ captureId: capture.captureId,
          accountId: actor.record.accountId, characterId: actor.record.characterId, expectedRevision: actor.record.revision,
          checkpoint: deps.codec.toJson(capture.checkpoint), appliedGrantIds: capture.appliedGrantIds,
          ...(capture.appliedFeatureAwardIds ? { appliedFeatureAwardIds: capture.appliedFeatureAwardIds } : {}) })));
        const recovered = await boundary(() => {
          deps.ownership.assertOwned(); let retry = false;
          for (const [index, result] of results.entries()) {
            const { actor, generation: capturedGeneration, capture } = captures[index];
            if (actor.generation !== capturedGeneration) throw new Error('capture owner changed during barrier');
            if (result.kind === 'unresolved') throw new Error('checkpoint unresolved');
            if (result.kind === 'saved') { actor.record = result.character; actor.slot.area.markCheckpointDurable(capture.captureId, result.character.revision, capture.appliedGrantIds, capture.appliedFeatureAwardIds); }
            else {
              metrics.recoveries++; const recovery = result.recovery;
              const exact = isDeepStrictEqual(recovery.character.checkpoint, deps.codec.toJson(capture.checkpoint)) && recovery.grants.every(g => g.appliedRevision !== null) &&
                (recovery.dungeonAwards ?? []).every(a => a.appliedRevision !== null) && (capture.appliedFeatureAwardIds?.length ?? 0) === (recovery.dungeonAwards?.length ?? 0);
              actor.record = recovery.character;
              if (exact) actor.slot.area.markCheckpointDurable(capture.captureId, recovery.character.revision, capture.appliedGrantIds, capture.appliedFeatureAwardIds);
              else {
                restoreDurableActor(actor, recovery);
                retry = true;
              }
            }
          }
          return retry;
        });
        if (!recovered) break;
        if (round === p.persistence.maxRecoveryRounds) throw new Error('checkpoint recovery capacity');
      }
      await boundary(() => {
        deps.ownership.assertOwned();
        for (const source of sources) source.slot.area.acknowledgeGrant(source.grant.id);
        metrics.pendingSourceGrants = 0;
        for (const [slot, token] of tokens) { drain(slot); slot.area.releaseDurabilityBarrier(token); slot.lastCheckpoint = deps.nowMonotonicMs(); }
        for (const c of connections) if (c.input) c.publishedConsumed = c.input.consumedInput;
        if (startupDrained && startupRecovery) { startupRecovery = false; accepting = admissionRequested && !draining; readyDone = true; resolveReady(); }
        // The world was held since this round began, so every pending result is in a checkpoint this round committed.
        for (const c of connections) if (c.results.length) { c.ready.push(...c.results); c.results = []; }
        for (const actor of actors.values()) if (actor.connection) sendResults(actor.connection);
        if (p.party) syncPartyContexts();
        metrics.persistenceMs += deps.nowMonotonicMs() - began;
        observe('persistenceBarrier', deps.nowMonotonicMs() - began);
      });
    };
    runDurability(work, true);
  }
  /** One durability task at a time; halting ones hold the world until they end (metrics.haltedMs). */
  function holdBarrier(task: Promise<void>, halting: boolean) {
    const started = deps.nowMonotonicMs(); barrierHalts = halting;
    barrier = task.finally(() => { barrier = null; barrierHalts = false; if (halting) metrics.haltedMs += deps.nowMonotonicMs() - started; });
  }
  function runDurability(work: () => Promise<void>, halting: boolean) {
    holdBarrier(work().then(() => {
      if (pausedDurability?.run === work) { pausedDurability = null; unresolved--; frozen = false; accepting = admissionRequested && !draining; }
    }).catch(error => {
      deps.onFailure?.('durability', error);
      if (isResourceOnly(error) && !deps.ownership.closed.aborted && !draining) {
        if (!pausedDurability) unresolved++;
        pausedDurability = { run: work, ownership: deps.ownership, halting };
      } else { if (!pausedDurability) unresolved++; pausedDurability = null; }
      failClosed();
    }), halting);
  }

  /**
   * Retained-mode save round, at most one per checkpointIntervalMs ("1초마다 묶어 저장, 저장 중에도 세계는 계속").
   * At one tick boundary it takes every unacknowledged source grant, a checkpoint capture of every actor and the command
   * results those captures contain. Then, while ticks and snapshots go on, it journals those grants (so every receipt a
   * capture names has its journal row) and commits all captures in one transaction. Only at a boundary after that commit
   * are the captures marked durable, the grants acknowledged and the captured results released to their streams. A crash
   * loses at most the progress after the last committed round; nothing sent as durable can be lost. Rows other writers
   * journaled, and recovery after a conflict, go to the halting round that pendingReplay starts, as before. External
   * ledger mode, admission, travel, encounters, retirement and shutdown keep the halting barrier; a gate travel whose
   * source Area holds grants not journaled yet first journals them in one (advanceTravel).
   * With dungeons enabled every Area also keeps a durable feature award ledger, and this round lets the world run there too.
   * Exactly-once rests on two facts per character: the ledger owner's durable revision is the PG revision its next award read
   * is fenced by (beginFeatureAwardRead, applyCertifiedFeatureAwards), and appliedFeatureAwardIds are the paid awards no
   * committed checkpoint names yet. A capture records both; its mark, after the commit, advances that revision and drops the
   * IDs the commit receipted. Award pages are applied only under a barrier, in the halting round pendingReplay starts, so the
   * paid IDs cannot change while this round is in flight; the owner can: a respawn re-prepares it on the next life and a
   * stream rebind (bootstrap) invalidates it, both keeping its revision, and a dungeon resident moves. Holding the world kept
   * capture and mark on the same owner and pose. Here the mark instead re-validates at the post-commit boundary
   * (Area.markCheckpointDurable without a barrier): same unit, same captured revision (one save round at a time), same run
   * return binding, and the current owner advances. Seals, award delivery, dungeon entry and exit stay in halting rounds.
   */
  function startSave() {
    if (haltNextSave) { if (!barrier && !frozen) { haltNextSave = false; startDurability(); } return; }
    if (barrier || frozen || draining || external || !actors.size) return;
    deps.ownership.assertOwned();
    const began = deps.nowMonotonicMs(); lastSave = began; metrics.persistenceBarriers++; metrics.saveRounds++;
    const sources = retainedSources();
    metrics.pendingSourceGrants = sources.length;
    const captures = [...actors.values()].map(actor => ({ actor, slot: actor.slot, revision: actor.record.revision, capture: actor.slot.area.capturePlayerCheckpoint(actor.ref) }));
    const acks: { c: Connection; actor: Actor; epoch: number; session: string | undefined; results: CommandResult[] }[] = [];
    for (const c of connections) if (c.actor && c.results.length) {
      acks.push({ c, actor: c.actor, epoch: c.epoch, session: c.stream?.session, results: c.results });
      c.awaiting += c.results.length; c.results = [];
    }
    const work = async () => {
      try { await journalSources(sources); }
      catch (error) {
        // A resource-only failure pauses as in a halting round. Any other journal failure (such as a victim outcome
        // transaction that ran out of its deadline while the running world kept the event loop busy) gives this round up
        // before anything was written for its captures: they are discarded, their results wait again, no grant is
        // acknowledged (journaling is idempotent), and the next round, started right away, holds the world as before.
        if (isResourceOnly(error) || deps.ownership.closed.aborted) throw error;
        deps.onFailure?.('save-journal-retry', error);
        await boundary(() => {
          deps.ownership.assertOwned();
          for (const { slot, capture } of captures) slot.area.discardCheckpointCapture(capture.captureId);
          for (const { c, actor, epoch, session, results: captured } of acks) {
            c.awaiting -= captured.length;
            if (!c.closed && c.actor === actor && actor.connection === c && c.epoch === epoch && c.stream?.session === session) c.results.unshift(...captured);
          }
          metrics.saveRetries++; haltNextSave = true; lastSave = -Infinity;
        });
        return;
      }
      const results = await persistence.commitBatch(captures.map(({ actor, revision, capture }) => ({ captureId: capture.captureId,
        accountId: actor.record.accountId, characterId: actor.record.characterId, expectedRevision: revision,
        checkpoint: deps.codec.toJson(capture.checkpoint), appliedGrantIds: capture.appliedGrantIds,
        ...(capture.appliedFeatureAwardIds ? { appliedFeatureAwardIds: capture.appliedFeatureAwardIds } : {}) })));
      // After the commit this round's own receipts exist, so only rows from other writers remain unread.
      const ids = captures.map(({ actor }) => actor.record.characterId);
      const [unread, unpaid] = await Promise.all([deps.characters.charactersWithPendingGrants(ids), deps.dungeonCompletions ? deps.dungeonCompletions.charactersWithPendingDungeonAwards(ids) : null]);
      await boundary(() => {
        deps.ownership.assertOwned(); let restored = false;
        for (const [index, result] of results.entries()) {
          const { actor, slot, revision, capture } = captures[index];
          // Admission, travel, encounters and retirement wait for this round, so the actor keeps its Area; a respawn may change its ref.
          if (actors.get(actor.record.characterId) !== actor || actor.slot !== slot || actor.record.revision !== revision) throw new Error('capture owner changed during save');
          if (result.kind === 'unresolved') throw new Error('checkpoint unresolved');
          if (result.kind === 'saved') { actor.record = result.character; slot.area.markCheckpointDurable(capture.captureId, result.character.revision, capture.appliedGrantIds, capture.appliedFeatureAwardIds); continue; }
          metrics.recoveries++; const recovery = result.recovery;
          const exact = isDeepStrictEqual(recovery.character.checkpoint, deps.codec.toJson(capture.checkpoint)) && recovery.grants.every(g => g.appliedRevision !== null) &&
            (recovery.dungeonAwards ?? []).every(a => a.appliedRevision !== null) && (capture.appliedFeatureAwardIds?.length ?? 0) === (recovery.dungeonAwards?.length ?? 0);
          actor.record = recovery.character;
          if (exact) slot.area.markCheckpointDurable(capture.captureId, recovery.character.revision, capture.appliedGrantIds, capture.appliedFeatureAwardIds);
          else {
            // The same restore as in a halting round, under a barrier held for this boundary only; pendingReplay then makes
            // the next pump replay the journal for it under a halting round.
            const token = slot.area.beginDurabilityBarrier('recovery');
            try { restoreDurableActor(actor, recovery); } finally { slot.area.releaseDurabilityBarrier(token); }
            restored = true;
          }
        }
        // A restore leaves its party (a dungeon resident is evicted); a halting round resyncs at its end, so this one does too.
        if (restored && p.party) syncPartyContexts();
        for (const source of sources) source.slot.area.acknowledgeGrant(source.grant.id);
        metrics.pendingSourceGrants = retainedSources().length;
        // Journal rows and dungeon awards are read and applied only by the halting round that pendingReplay starts.
        for (const actor of actors.values()) {
          if (unpaid?.has(actor.record.characterId)) actor.dungeonAwards = true;
          if (unread.has(actor.record.characterId) || actor.dungeonAwards) actor.pendingReplay = true;
        }
        for (const { c, actor, epoch, session, results: captured } of acks) {
          c.awaiting -= captured.length;
          // Released only on the stream that produced them; a rebind (respawn, recovery) drops them as bootstrap always has.
          if (!c.closed && c.actor === actor && actor.connection === c && c.epoch === epoch && c.stream?.session === session) c.ready.push(...captured);
        }
        for (const slot of allSlots) drain(slot);
        for (const c of connections) sendResults(c);
        metrics.saveMs += deps.nowMonotonicMs() - began;
        observe('persistenceSave', deps.nowMonotonicMs() - began);
      });
    };
    runDurability(work, false);
  }

  function startFailedSourceDrain() {
    if (barrier || stopped || deps.ownership.closed.aborted) return;
    const pending = [...failedSources].filter(slot => !attemptedFailedSources.has(slot));
    if (!pending.length) return;
    for (const slot of pending) attemptedFailedSources.add(slot);
    const work = async () => {
      for (const slot of pending) {
        if (!slot.source) throw new Error('failed external Area missing source adapter');
        for (;;) { const progress = await slot.source.drain({ refreshSummaries: false }); if (!progress.more) break; }
        await boundary(() => { deps.ownership.assertOwned(); failedSources.delete(slot); drainedFailedSources.add(slot); });
      }
    };
    holdBarrier(work().catch(error => { deps.onFailure?.('failed-source-drain', error); unresolved++; failClosed(); }), true);
  }
  const retireDetached = (now: number) => {
    if (barrier || frozen) return;
    const actor = [...actors.values()].find(a => !a.connection && a.detachedAt !== null && now - a.detachedAt >= p.reconnectGraceMs);
    if (!actor) return;
    const character = actor.record.characterId;
    const unsettled = actor.slot.area.appliedGrantIds(character).length || actor.slot.area.appliedFeatureAwardIds(character).length;
    if (external) { if ([...allSlots].some(slot => slot.area.pendingGrants().length) || unsettled) { startDurability(); return; } }
    // Retained: retire once nothing earned for this character is only in memory (no unjournaled grant names it, its applied
    // grants and feature awards are durable). The next save round settles that; other characters' grants no longer hold it
    // while another actor remains. The last actor waits for every grant: a death credits contributors who have left, so a
    // grant can name only absent characters, and with no actor left no save round runs (startSave, startDurability, shutdown).
    else if ((actors.size === 1 ? retainedSources().length > 0 : [...allSlots].some(slot => slot.area.pendingGrants().some(entry => entry.grant.recipient === character))) || unsettled) return;
    const retirement = actor.slot.area.quiescePlayer(actor.ref, 'disconnect');
    const capturedGeneration = actor.generation;
    const task = async () => {
      const result = await persistence.commit({ captureId: retirement.capture.captureId, accountId: actor.record.accountId,
        characterId: actor.record.characterId, expectedRevision: actor.record.revision,
        checkpoint: deps.codec.toJson(retirement.capture.checkpoint), appliedGrantIds: retirement.capture.appliedGrantIds,
        ...(retirement.capture.appliedFeatureAwardIds ? { appliedFeatureAwardIds: retirement.capture.appliedFeatureAwardIds } : {}) });
      await boundary(() => {
        deps.ownership.assertOwned();
        if (capturedGeneration !== actor.generation || actor.connection) throw new Error('retirement owner changed');
        if (result.kind === 'unresolved') throw new Error('retirement unresolved');
        if (result.kind === 'recovery') {
          restoreDurableActor(actor, result.recovery);
          // Replacement invalidates the retirement token. A new bounded capture is required next pump.
          return;
        }
        actor.record = result.character;
        actor.slot.area.markCheckpointDurable(retirement.capture.captureId, result.character.revision, retirement.capture.appliedGrantIds, retirement.capture.appliedFeatureAwardIds);
        actor.slot.area.commitPlayerRetirement(retirement.token);
        actors.delete(actor.record.characterId); travels.delete(actor.record.characterId); encounterRequests.delete(actor.record.characterId); returnRequests.delete(actor.record.characterId);
        leaveParty(actor.record.characterId); drain(actor.slot);
        // A load that raced this save must not reattach its older checkpoint or pending receipt list.
        for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].record.characterId === actor.record.characterId) {
          const request = waiting.splice(i, 1)[0]; load(request.connection, actor.record.characterId);
        }
      });
    };
    holdBarrier(task().catch(error => { deps.onFailure?.('retirement', error); unresolved++; failClosed(); }), true);
  };

  /**
   * Interest management ("가까운 40 m 안은 20번, 그 밖은 5번"): of the visible units (80 m, kept to 88 m), those within
   * NEAR_METERS of the viewer and every pin (self, party, target, engaged boss) are updated in every snapshot; the others
   * are refreshed every FAR_PERIOD-th snapshot of the Area, staggered by unit id, and held (heldIds) in between.
   */
  const NEAR_METERS = 40, FAR_PERIOD = 4;
  const visible = (slot: Slot, actor: Actor, c: Connection, beat: number, held: Set<number>): Set<number> => {
    const viewer = slot.area.services.playerByCharacter(actor.record.characterId)!;
    const self = slot.area.services.getUnit(actor.ref)!;
    const pins = new Set<number>([self.ref.id]);
    const party = slot.area.services.context.members.find(m => m.character === actor.record.characterId)?.party;
    if (party) for (const m of slot.area.services.context.members) if (m.party === party) pins.add(m.unit.id);
    if (viewer.state.target && slot.area.services.getUnit(viewer.state.target)) pins.add(viewer.state.target.id);
    for (const b of slot.area.bosses.values()) if (b.engaged) pins.add(b.unit.id);
    const ids = new Set<number>();
    let near = 0, far = 0;
    for (const unit of slot.area.units.values()) {
      if (!p.visible(unit, viewer.state)) continue;
      const id = unit.ref.id, radius = c.visible.has(id) ? 88 : 80, distance2 = (unit.x - self.x) ** 2 + (unit.z - self.z) ** 2;
      if (pins.has(id)) { ids.add(id); near++; }
      else if (!unit.hidden && distance2 <= radius ** 2) {
        ids.add(id);
        if (distance2 <= NEAR_METERS ** 2) near++;
        else { far++; if ((beat + id) % FAR_PERIOD) held.add(id); }
      }
    }
    if (!ids.has(self.ref.id)) { ids.add(self.ref.id); near++; }
    metrics.aoiNear += near; metrics.aoiFar += far; return ids;
  };
  /**
   * One Area publication: a shared prepared snapshot, then every recipient's observation. Recipients are encoded in slices
   * of at most PUBLISH_SLICE_MS; between slices the event loop runs IO callbacks (PG replies of a save in flight, inputs)
   * but the pump does nothing else until the publication ends: no tick, no boundary completion, no admission or travel, so
   * every recipient sees the same snapshot, events and stream state as with one synchronous pass.
   */
  const PUBLISH_SLICE_MS = 4;
  let publication: { slot: Slot; snapshot: AreaSnapshot; prepared: PreparedObservation; appearances: ObservationInput['appearances']; beat: number;
    events: EventRecord[]; watermark: number; recipients: Actor[]; index: number; started: number; busy: number; dungeon: Readonly<DungeonObservation> | null } | null = null;
  const publish = (slot: Slot) => {
    if (halted() || frozen || publication || [...actors.values()].some(actor => actor.pendingReplay)) return;
    const start = deps.nowMonotonicMs(), snapshot = slot.area.snapshot();
    const appearances = Object.fromEntries([...actors.values()].filter(a => a.slot === slot).map(a => [`${a.ref.id}:${a.ref.life}`, { ...a.record.identity.appearance, name: shownName(a.record.identity.appearance.name) }]));
    const prepared = prepareObservationSnapshot(snapshot, appearances, deps.gameplay.catalog, { verify: deps.gameplay.verifyObservations ?? true });
    observe('snapshotPrepare', deps.nowMonotonicMs() - start);
    // A run Area's typed view is read at the same boundary as its snapshot and shared by every recipient.
    publication = { slot, snapshot, prepared, appearances, beat: slot.publishes++, events: slot.events, watermark: slot.watermark,
      recipients: [...actors.values()].filter(actor => actor.slot === slot), index: 0, started: start, busy: deps.nowMonotonicMs() - start,
      dungeon: slot.kind === 'dungeon' ? slot.area.dungeonObservation() : null };
    slot.events = [];
    continuePublication();
  };
  const endPublication = (complete: boolean) => {
    const job = publication!; publication = null; releasePreparedObservation(job.prepared);
    if (complete) { metrics.snapshotBatchMs += job.busy; observe('snapshotBatch', job.busy); observe('snapshotWall', deps.nowMonotonicMs() - job.started); }
  };
  function continuePublication() {
    const job = publication!, slot = job.slot, snapshot = job.snapshot, prepared = job.prepared;
    // Nothing is published after fail-closed, ownership loss, drain or the Area's retirement.
    if (frozen || draining || stopped || deps.ownership.closed.aborted || !allSlots.has(slot)) { endPublication(false); return; }
    const sliceStart = deps.nowMonotonicMs();
    try {
      while (job.index < job.recipients.length) {
        const actor = job.recipients[job.index++], c = actor.connection;
        if (actor.slot !== slot || !c || c.closed || !c.stream || !c.input) continue;
        if (c.ws.bufferedAmount > p.maxBufferedBytes) { close(c, 'slow-client', true); continue; }
        try {
          const encodeStart = deps.nowMonotonicMs(), wasFull = c.full, held = new Set<number>();
          c.visible = visible(slot, actor, c, job.beat, held);
          if (!c.full) metrics.aoiFarHeld += held.size;
          const extras = p.observationExtras(snapshot, actor.record.characterId, c.visible);
          const recovery = p.endingPresentation ? { ...extras.recovery, endingPresentation: slot.area.endingObservation(actor.ref) } : extras.recovery;
          const features = job.dungeon ? { ...extras.features, dungeon: job.dungeon } : extras.features;
          const chunks = c.protocol.encodeObservation({ binding: c.stream, sequence: ++c.sequence, tick: snapshot.tick,
            acceptedInput: c.input.acceptedInput, consumedInput: publishedConsumed(c), selfRef: actor.ref,
            snapshot, prepared, events: job.events, visibleIds: c.visible, heldIds: c.full ? undefined : held, full: c.full, eventWatermark: job.watermark, appearances: job.appearances,
            results: materializeResults(c),
            ...extras, features, recovery });
          observe('recipientEncode', deps.nowMonotonicMs() - encodeStart);
          for (const chunk of chunks) { c.ws.send(chunk, { binary: true }); metrics.packets++; metrics.bytesSent += chunk.byteLength; }
          c.full = false; c.baselineSequence = c.sequence; c.ready = []; metrics.snapshots++;
          if (wasFull) { if (p.party) publishParty(c); if (c.chatPreferences) sendControl(c, { type: 'chatPreferences', ...c.chatPreferences }); }
        } catch (error) { deps.onFailure?.('observation', error); close(c, 'observation-unavailable', true); }
        if (deps.nowMonotonicMs() - sliceStart >= PUBLISH_SLICE_MS) break;
      }
    } finally { job.busy += deps.nowMonotonicMs() - sliceStart; }
    if (job.index >= job.recipients.length) endPublication(true);
  }
  const step = (slot: Slot) => {
    if (halted() || frozen || draining) return;
    if (slot.ledgerMode === 'external-durable' && !slot.area.prepareLedgerStep().ready) { startDurability(); return; }
    const inputs = new Map<number, PlayerIntent>(), prepared: { c: Connection; frame: PreparedInput; unit: EntityRef }[] = [];
    const hostCommands: { c: Connection; command: HostCommand | Extract<PlayerCommand, {kind:'bossChallenge'}>; inputSequence: number }[] = [];
    const now = deps.nowMonotonicMs(); let progression = false;
    for (const actor of actors.values()) if (actor.slot === slot) {
      const c = actor.connection;
      if (!c || !c.input || c.closed) continue;
      const frame = c.input.prepareTick(now / 1000, p.areaLimits.inputCommandsPerTick);
      if (frame) {
        if (c.results.length + c.ready.length + c.awaiting + c.discoveries.length + frame.intent.commands.length > 256) { close(c, 'result-backpressure', true); continue; }
        const host = frame.intent.commands.filter(command => HOST_COMMAND_KINDS.has(command.kind) || slot.kind === 'public' && command.kind === 'bossChallenge');
        if (host.length && frame.intent.commands.length !== 1) { close(c, 'host-command-boundary'); continue; }
        const commands = frame.intent.commands.filter((command): command is PlayerCommand => !HOST_COMMAND_KINDS.has(command.kind) && !(slot.kind === 'public' && command.kind === 'bossChallenge'));
        inputs.set(actor.ref.id, { ...frame.intent, commands }); prepared.push({ c, frame, unit: actor.ref });
        if (host[0]) hostCommands.push({ c, command: host[0] as HostCommand | Extract<PlayerCommand, {kind:'bossChallenge'}>, inputSequence: frame.commandOrigins[0].inputSequence });
        progression ||= frame.intent.commands.some(command => !HOST_COMMAND_KINDS.has(command.kind) && !['target', 'jump', 'dance', 'cancel', 'ability'].includes(command.kind));
      } else if (!c.timedOut && now - c.lastInput >= p.inputTimeoutMs) { slot.area.neutralizeInput(actor.ref); c.timedOut = true; metrics.neutralizations++; }
    }
    const inputTick = slot.area.services.tick;
    const started = deps.nowMonotonicMs(); let outcomes: ReturnType<Area['step']>;
    try { outcomes = slot.area.step(inputs); }
    catch (error) { if (slot.source) failedSources.add(slot); throw error; }
    metrics.ticks++; metrics.tickMs += deps.nowMonotonicMs() - started; observe('tick', deps.nowMonotonicMs() - started);
    const changedLives: Actor[] = [];
    for (const actor of actors.values()) if (actor.slot === slot) {
      const current = slot.area.services.playerByCharacter(actor.record.characterId)?.state.unit;
      if (current && !sameRef(actor.ref, current)) { actor.ref = current; actor.generation = generation++; changedLives.push(actor); }
    }
    if (slot.dungeon && !slot.dungeon.frozen) {
      // Policy A roster: every character the run still holds at this clear boundary, before any exit, leave or retirement.
      const cleared = freezeDungeonCompletion(slot.area, [...actors.values()].filter(a => a.slot === slot).map(a => ({ characterId: a.record.characterId, accountId: a.record.accountId, ref: a.ref })));
      if (cleared) { slot.dungeon.frozen = cleared; progression = true; }
    }
    for (const { c, frame } of prepared) c.input!.commitConsumed(frame.token);
    for (const { c, command, inputSequence } of hostCommands) {
      if (command.kind.startsWith('chat')) { chatCommand(c, command as Extract<HostCommand, {kind:`chat${string}`}>, inputSequence); continue; }
      if (command.kind.startsWith('dungeon')) { requestDungeon(c, command as Extract<HostCommand, {kind:`dungeon${string}`}>); continue; }
      if (command.kind === 'bossChallenge') {
        if (!p.party || !command.profile) controlError(c, 'party-unavailable');
        else encounterRequests.set(c.actor!.record.characterId, { actor: c.actor!, profile: command.profile });
      } else partyCommand(c, command);
    }
    const emitted = drain(slot);
    const used = new Set<EventRecord>();
    for (const { c, frame, unit } of prepared) for (const [index, command] of frame.intent.commands.entries()) {
      const origin = frame.commandOrigins[index];
      if (!origin) throw new Error('missing command origin');
      const outcome = outcomes.find(result => result.commandIndex === index && sameRef(result.unit, unit));
      if (command.kind === 'endingControl') {
        c.results.push({ ...origin, status: outcome?.success ? 'succeeded' : 'failed', code: outcome?.success ? 'ending-control-accepted' : 'ending-control-rejected' });
      } else if (command.kind === 'forgeBuy' || command.kind === 'forgeUpgrade') {
        const record = emitted.find(record => !used.has(record) && record.tick === inputTick && record.event.type === 'equipment' && sameRef(record.event.unit, unit) && record.event.operation === (command.kind === 'forgeBuy' ? 'buy' : 'upgrade') && record.event.slot === (command.slot ?? 'weapon') && record.event.request === command.request);
        if (record?.event.type === 'equipment') {
          used.add(record); c.results.push({ ...origin, status: outcome?.success ? 'durable' : 'failed', code: `equipment-${record.event.result}`, ...(command.request === undefined ? {} : { request: command.request }) });
        } else c.results.push({ ...origin, status: 'failed', code: 'equipment-unavailable', ...(command.request === undefined ? {} : { request: command.request }) });
      } else if (command.kind === 'questAccept' || command.kind === 'questTurnIn' || command.kind === 'questTrack') {
        c.results.push({ ...origin, status: outcome?.success ? 'durable' : 'failed', code: outcome?.success ? command.kind === 'questAccept' ? 'quest-accepted' : command.kind === 'questTurnIn' ? 'quest-completed' : 'quest-tracked' : 'quest-unavailable' });
      } else if ((command.kind === 'interact' || command.kind === 'channelStart') && ECONOMIC_INTERACTIONS.has(command.targetId ?? '')) {
        if (!outcome?.success) { c.results.push({ ...origin, status: 'failed', code: 'discovery-unavailable' }); continue; }
        const record = emitted.find(record => !used.has(record) && record.tick === inputTick && record.event.type === 'discovery' && sameRef(record.event.unit, unit) && record.event.id === command.targetId);
        if (record?.event.type === 'discovery') { used.add(record); c.results.push({ ...origin, status: 'durable', code: `discovery-${record.event.discovery}` }); }
        else {
          const start = emitted.find(record => record.tick === inputTick && record.event.type === 'castStart' && sameRef(record.event.unit, unit) && record.event.channel?.kind === 'lighthouse-secret');
          if (!start) throw new Error('accepted discovery has no authoritative outcome');
          c.discoveries.push({ ...origin, unit, id: command.targetId!, startOrder: start.order });
        }
      }
    }
    for (const c of connections) if (c.actor?.slot === slot) for (let i = c.discoveries.length - 1; i >= 0; i--) {
      const pending = c.discoveries[i];
      const record = emitted.find(record => !used.has(record) && record.order > pending.startOrder && record.event.type === 'discovery' && sameRef(record.event.unit, pending.unit) && record.event.id === pending.id);
      const interrupted = emitted.some(record => record.order > pending.startOrder && record.event.type === 'castEnd' && record.event.channel && record.event.result === 'interrupted' && sameRef(record.event.unit, pending.unit));
      if (record || interrupted) {
        if (record) used.add(record);
        c.discoveries.splice(i, 1);
        c.results.push({ inputSequence: pending.inputSequence, commandIndex: pending.commandIndex, status: record ? 'durable' : 'failed', code: record ? 'discovery-lighthouse-secret' : 'discovery-interrupted' });
      }
    }
    for (const actor of changedLives) if (actor.connection) bootstrap(actor.connection, actor);
    // Retained mode saves in the pump's save round (startSave), at most once per checkpointIntervalMs, never from a tick.
    if (!external) return;
    progression ||= slot.area.pendingGrants().length > 0 || emitted.some(({ event }) =>
      ['quest', 'xp', 'levelUp', 'equipment', 'achievement', 'discovery', 'endingReady', 'death', 'respawn'].includes(event.type));
    if (progression || p.endingPresentation && slot.area.hasPendingEndingTransitions() || sourceNeedsIO(slot) || now - slot.lastCheckpoint >= p.checkpointIntervalMs) startDurability();
    else for (const { c } of prepared) c.publishedConsumed = c.input!.consumedInput;
  };
  const pump = () => {
    if (stopped) return;
    try {
      if (deps.ownership.closed.aborted) failClosed();
      // The turn that finishes a publication does no world work: ticks start at the next timer turn. Ticking right after the
      // last slice put about three times as many young-generation collections inside Area.step (local 100-bot runs: 125-130
      // ticks over 10 ms against 26), which is what the tick p99 budget measures.
      if (publication) continuePublication();
      else pumpWorld();
    } catch (error) { if (publication) endPublication(false); deps.onFailure?.('pump', error); unresolved++; failClosed(); }
    // An open publication or due catch-up ticks continue right after pending IO callbacks; otherwise the loop interval applies.
    if (publication || behind) slice = setImmediate(pump); else timer = setTimeout(pump, p.loopIntervalMs);
  };
  const TICK_SLICE_MS = 8; let behind = false;
  const pumpWorld = () => {
    behind = false;
    for (let count = 0; completion.length && count < p.maxConnections * 8 + 16; count++) completion.shift()!();
    const now = deps.nowMonotonicMs();
    if (external && !barrier && failedSources.size) startFailedSourceDrain();
    for (const c of connections) if (c.binding && !c.closed) {
      if (c.binding.expiresAt <= deps.nowWallMs()) { close(c, 'session-expired'); continue; }
      if (!c.validating && now >= c.nextValidation) {
        c.validating = true; const attempt = c.generation; c.nextValidation = now + p.sessionRevalidateMs;
        void deps.admission.revalidate(c.binding).then(binding => enqueue(() => {
          if (c.closed || c.generation !== attempt) return; c.validating = false;
          if (!binding) close(c, 'session-expired'); else c.binding = binding;
        }), () => enqueue(() => { if (!c.closed && c.generation === attempt) close(c, 'session-unavailable', true); }));
      }
    }
    if (frozen || draining || deps.ownership.closed.aborted) settleDungeonRequests('host-unavailable');
    if (!frozen && !draining && !deps.ownership.closed.aborted) for (const c of connections) if (c.phase === 'admitted' && c.chatNeedsPreferences && !c.chatBusy && pendingChat < p.chat!.maxPending) chatCommand(c, { kind: 'chatPreferences' });
    if (!frozen && !draining) {
      if (!barrier) {
        if (external && (startupRecovery || now >= nextRecovery || [...allSlots].some(sourceNeedsIO))) startDurability();
        if (!barrier && unsealedDungeon() && now >= nextDungeonSeal) startDurability();
        admitWaiting(); if (!barrier && [...actors.values()].some(actor => actor.pendingReplay)) startDurability(); advanceTravel(); advanceEncounters(); cleanupEncounters(); advanceDungeons(); cleanupDungeons(); retireDetached(now);
        if (!barrier && !external && now - lastSave >= p.checkpointIntervalMs) startSave();
      }
      // A retained save round in flight does not hold the world; every other barrier does. While held, the schedulers are
      // left alone (not idled), so the first pump after the barrier catches up as before.
      if (!halted()) for (const slot of allSlots) {
        if (publication) break; // the rest waits for the publication that just started
        if (!slot.area.players.size || halted()) { slot.tick.idle(now); slot.snapshot.idle(now); continue; }
        // Catch-up ticks stop after TICK_SLICE_MS; the next turn (right after pending IO) runs the rest.
        const ticked = deps.nowMonotonicMs();
        slot.tick.runFor(now, () => step(slot), () => deps.nowMonotonicMs() - ticked, TICK_SLICE_MS);
        if (now >= slot.tick.next) behind = true;
        if (!halted()) slot.snapshot.run(now, () => publish(slot));
      }
    }
  };
  const ledgerStats = () => {
    if (!external) return {};
    const keys = ['dirtyCreditEntries','dirtyCreditBytes','pendingDeaths','stagedBytes','appliedGrantIds','replayTokens','ledgerOwners','summaryReads','captures'];
    const totals: Record<string, number> = {};
    for (const slot of allSlots) { const usage = slot.area.resourceUsage(); for (const key of keys) totals['ledger' + key[0].toUpperCase() + key.slice(1)] = (totals['ledger' + key[0].toUpperCase() + key.slice(1)] ?? 0) + (usage[key] ?? 0); }
    if (outcomeRecovery) for (const [key, value] of Object.entries(outcomeRecovery.metrics)) totals['ledgerRecovery' + key[0].toUpperCase() + key.slice(1)] = value;
    return totals;
  };
  const onLost = () => {
    for (const actor of actors.values()) if (actor.slot.ledgerMode === 'external-durable' && !failedSources.has(actor.slot) && !drainedFailedSources.has(actor.slot)) {
      try { actor.slot.area.invalidateGrantRead(actor.ref); actor.grantRead = undefined; } catch (error) { deps.onFailure?.('ledger-ownership-loss', error); }
    }
    failClosed();
  }; deps.ownership.closed.addEventListener('abort', onLost);
  pump();
  return {
    ready: () => readiness,
    handleUpgrade(req, socket, head) {
      if (req.url?.split('?')[0] !== '/world') return;
      if (!accepting || frozen || deps.ownership.closed.aborted) { reject(socket, '503 Service Unavailable'); return; }
      const origin = req.headers.origin;
      if (!origin || !deps.originAllowed(origin, req)) { reject(socket, '403 Forbidden'); return; }
      const ip = deps.clientIp(req);
      if (connections.size >= p.maxConnections || [...connections].filter(c => c.ip === ip).length >= p.maxConnectionsPerIp) { reject(socket, '503 Service Unavailable'); return; }
      wss.handleUpgrade(req, socket, head, ws => {
        const c: Connection = { ws, ip, origin, generation: generation++, closed: false, phase: 'preauth',
          protocol: deps.gameplay.create(), inputBudget: new InputRateBudget(deps.nowMonotonicMs() / 1000), sequence: 0, epoch: 0, full: true, lastInput: 0, timedOut: false, nextValidation: Infinity, validating: false, visible: new Set(), publishedConsumed: 0, baselineSequence: 0, results: [], ready: [], awaiting: 0, discoveries: [], chatBusy: false, chatNeedsPreferences: false };
        connections.add(c);
        c.authTimer = setTimeout(() => { if (c.phase === 'preauth' || c.phase === 'authenticating') close(c, 'auth-timeout'); }, p.authTimeoutMs);
        ws.on('error', () => ws.terminate());
        ws.on('close', () => {
          c.closed = true; c.phase = 'closed'; c.generation++; connections.delete(c); if (c.authTimer) clearTimeout(c.authTimer);
          enqueue(() => {
            for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].connection === c) waiting.splice(i, 1);
            const actor = c.actor;
            if (actor?.connection === c) { actor.connection = null; actor.detachedAt = deps.nowMonotonicMs(); if (!sourceFailed(actor.slot)) { if (actor.grantRead) actor.slot.area.cancelGrantRead(actor.grantRead); actor.slot.area.neutralizeInput(actor.ref); } actor.grantRead = undefined; }
          });
        });
        ws.on('message', (raw, binary) => {
          if (c.closed || frozen || draining) return;
          const bytes = buffer(raw); metrics.bytesReceived += bytes.byteLength; metrics.receivedPackets++;
          if (c.phase === 'preauth') {
            if (binary || bytes.byteLength > p.maxAuthFrameBytes) { close(c, 'auth-frame'); return; }
            let value: { type?: unknown; ticket?: unknown; characterId?: unknown; schemaRevision?: unknown };
            try { value = JSON.parse(bytes.toString('utf8')); } catch { close(c, 'auth-frame'); return; }
            if (!value || typeof value !== 'object' || Array.isArray(value) || !['characterId,ticket,type', 'characterId,schemaRevision,ticket,type'].includes(Object.keys(value).sort().join(',')) || value.type !== 'authenticate' || typeof value.characterId !== 'string') { close(c, 'auth-frame'); return; }
            if (Object.hasOwn(value, 'schemaRevision') && (value.schemaRevision !== WIRE_SCHEMA_REVISION || value.schemaRevision !== deps.gameplay.catalog.wireSchemaRevision) || (p.endingPresentation || p.dungeons) && value.schemaRevision !== WIRE_SCHEMA_REVISION) { close(c, 'protocol-schema'); return; }
            c.phase = 'authenticating'; const attempt = c.generation;
            void deps.admission.consume(value.ticket, origin).then(binding => enqueue(() => {
              if (c.closed || c.generation !== attempt || !accepting || deps.ownership.closed.aborted) return;
              if (c.authTimer) clearTimeout(c.authTimer); c.binding = binding; c.nextValidation = deps.nowMonotonicMs() + p.sessionRevalidateMs;
              load(c, value.characterId as string);
            }), () => enqueue(() => { metrics.authFailures++; if (!c.closed && c.generation === attempt) close(c, 'authentication-failed'); }));
          } else if (c.phase === 'admitted' && binary && c.input && c.stream) {
            try {
              const message = c.protocol.decodeClientMessage(bytes, c.stream);
              if (message.kind === 'resync') { c.inputBudget.consume(deps.nowMonotonicMs() / 1000); c.revoked = undefined; c.full = true; return; }
              c.input.acceptDecoded(message.intent, deps.nowMonotonicMs() / 1000); c.revoked = undefined; c.lastInput = deps.nowMonotonicMs(); c.timedOut = false;
            } catch {
              try {
                const prior = c.revoked; if (!prior) throw new Error('unknown input binding');
                const stale = prior.protocol.decodeClientMessage(bytes, prior.binding), now = deps.nowMonotonicMs() / 1000;
                if (stale.kind === 'input') prior.input.discardRevoked(bytes, now); else c.inputBudget.consume(now);
                metrics.discardedRevokedFrames++;
              }
              catch { metrics.rejected++; close(c, 'invalid-input'); }
            }
          } else { metrics.rejected++; close(c, 'unexpected-frame'); }
        });
      });
    },
    stopAdmission() { admissionRequested = false; accepting = false; },
    async retryDurability(resources) {
      const pause = pausedDurability, ceiling = p.victimOutcomeRetryCeiling;
      if (!pause || !ceiling || barrier || !frozen || draining || stopped || pause.ownership !== deps.ownership || deps.ownership.closed.aborted) return false;
      const keys = ['maxEntries', 'maxPayloadBytes', 'timeoutMs'] as const;
      if (!resources || keys.some(key => !Number.isSafeInteger(resources[key]) || resources[key] < victimResources[key] || resources[key] > ceiling[key]) || !keys.some(key => resources[key] > victimResources[key])) throw new Error('retry requires increased explicit budgets within ceiling');
      deps.ownership.assertOwned(); victimResources = { ...resources }; runDurability(pause.run, pause.halting);
      await barrier; return pausedDurability === null && !frozen && !deps.ownership.closed.aborted;
    },
    async shutdown(deadlineMs) {
      admissionRequested = false; accepting = false; draining = true;
      const end = deps.nowMonotonicMs() + deadlineMs;
      for (const c of connections) { if (!sendControl(c, { type: 'restarting', retryAfterSeconds: 1 })) json(c, { type: 'restarting', retryAfterSeconds: 1 }); if (c.actor && !sourceFailed(c.actor.slot)) c.actor.slot.area.neutralizeInput(c.actor.ref); }
      if (external && failedSources.size) startFailedSourceDrain();
      // A save round already in flight ends first; the final round then captures the last ticks with the world held.
      while (barrier && deps.nowMonotonicMs() < end) await new Promise(resolve => setTimeout(resolve, p.loopIntervalMs));
      if (!barrier && !frozen) startDurability();
      while (barrier && deps.nowMonotonicMs() < end) await new Promise(resolve => setTimeout(resolve, p.loopIntervalMs));
      const persisted = await persistence.shutdown(Math.max(0, end - deps.nowMonotonicMs()));
      stopped = true; if (timer) clearTimeout(timer); if (slice) clearImmediate(slice); deps.ownership.closed.removeEventListener('abort', onLost); settleDungeonRequests('host-unavailable');
      for (const c of connections) { if (c.authTimer) clearTimeout(c.authTimer); c.ws.close(1012, 'Server restarting'); }
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => { for (const c of connections) c.ws.terminate(); resolve(); }, Math.max(0, end - deps.nowMonotonicMs()));
        wss.close(() => { clearTimeout(timeout); resolve(); });
      });
      // An unsealed clear is an owed obligation lost with this process; report it rather than claim a durable stop.
      // So is a retained grant still only in memory with no actor left: the final round above did not run to journal it.
      const count = unresolved + persisted.unresolved + (barrier ? 1 : 0) + [...allSlots].filter(slot => slot.dungeon?.frozen).length + (actors.size ? 0 : retainedSources().length);
      return { durable: persisted.durable && count === 0, unresolved: count };
    },
    dungeon(characterId, command) {
      return new Promise<DungeonCommandResult>(resolve => {
        let owned: DungeonCommand;
        try { owned = validateDungeonCommand(command); } catch { resolve({ ok: false, code: 'invalid-command' }); return; }
        const actor = actors.get(characterId);
        if (!p.dungeons || stopped || frozen || draining || !actor?.connection || actor.connection.closed) { resolve({ ok: false, code: 'dungeon-unavailable' }); return; }
        if (dungeonRequests.has(characterId)) { resolve({ ok: false, code: 'dungeon-busy' }); return; }
        dungeonRequests.set(characterId, { actor, command: owned, resolve });
      });
    },
    dungeonObservation(characterId) {
      const actor = actors.get(characterId);
      return actor?.slot.kind === 'dungeon' ? actor.slot.area.dungeonObservation() : null;
    },
    stats: () => ({ ...metrics, checkpointBatches: persistence.metrics.batches, checkpointBatchFallbacks: persistence.metrics.batchFallbacks, ...timingStats(), ...ledgerStats(), processCpuUserMs: process.cpuUsage(processCpuStart).user / 1000,
      processCpuSystemMs: process.cpuUsage(processCpuStart).system / 1000, processElapsedMs: deps.nowMonotonicMs() - processStarted,
      activeConnections: connections.size, activeActors: actors.size, waiting: waiting.length,
      publicAreas: slots.size, ready: readyDone && !startupRecovery && !frozen && !deps.ownership.closed.aborted, failedSources: failedSources.size, resourcePaused: pausedDurability !== null, frozen, accepting, draining, stopped, ownershipHeld: !deps.ownership.closed.aborted, durableBarrier: barrier !== null, haltingBarrier: halted(), checkpointCaptures: [...allSlots].reduce((n, s) => n + s.area.resourceUsage().captures, 0), unresolved,
      pendingChat, partyCount: parties.size, encounterAreas: [...allSlots].filter(slot => slot.kind === 'party').length, dungeonAreas: [...allSlots].filter(slot => slot.kind === 'dungeon').length,
      droppedTicks: [...allSlots].reduce((n, s) => n + s.tick.dropped, 0), droppedSnapshots: [...allSlots].reduce((n, s) => n + s.snapshot.dropped, 0) }),
  };
}
