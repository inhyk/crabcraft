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
import type { Area, AreaSnapshot, BossProfileId, EntityRef, EventRecord, PlayerCommand, PlayerIntent, PlayerState, SimUnit, WorldId } from '../../src/sim/types.ts';
import { canChallenge } from '../../src/sim/data/progression.ts';
import { BOSS_PROFILES } from '../../src/sim/data/bosses.ts';
import { TREASURES, LIGHTHOUSE_SECRET } from '../../src/sim/features/exploration.ts';
import { CharacterStore, CharacterStoreError, type Character, type VictimOutcomeResources, type GrantBatchEntry } from './character-store.ts';
import { WorldTicketRegistry, type SessionBinding } from './admission.ts';
import type { HostOwnership } from './ownership.ts';
import { DeadlineScheduler } from './scheduler.ts';
import { PersistenceCoordinator, readCertifiedGrantPage, type Recovery } from './persistence-coordinator.ts';
import { PUBLIC_WORLDS, type LoadedWorldDefinition } from './catalog.ts';
import { InputSession, HOST_COMMANDS, type HostCommand, type PreparedInput } from './gameplay/intents.ts';
import { prepareObservationSnapshot } from './gameplay/protocol.ts';
import type { GameplayCatalog, GameplayProtocol, ObservationInput, WireBinding, WorldControl } from './gameplay/protocol.ts';
import type { CommandResult } from './gameplay/events.ts';

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
  readonly victimOutcome: VictimOutcomeResources;
  readonly victimOutcomeRetryCeiling?: VictimOutcomeResources;
  readonly persistence: { maxQueuedPerCharacter: number; maxAttempts: number; retryMs: number; maxRecoveryRounds: number };
  readonly areaLimits: { eventCount: number; inputCommandsPerTick: number; timers: number; projectiles: number };
  readonly restore: RestorePolicy;
  readonly chat?: { maxPending: number };
  readonly party?: { maxParties: number; maxEncounters: number; returnSpawn(world: WorldId, profile: BossProfileId): string };
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
  gameplay: { catalog: GameplayCatalog; create(): GameplayProtocol };
  ownership: HostOwnership;
  chat?: WorldChatService;
  policies: HostPolicies;
  originAllowed(origin: string, req: IncomingMessage): boolean;
  clientIp(req: IncomingMessage): string;
  nowMonotonicMs(): number;
  nowWallMs(): number;
  /** Internal diagnostics only; callers decide what sanitized metadata may be logged. */
  onFailure?(stage: string, error: unknown): void;
}
export interface ActualWorldHost {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  stopAdmission(): void;
  /** Internal recovery only. No HTTP or client authority is exposed. */
  retryDurability(resources: VictimOutcomeResources): Promise<boolean>;
  shutdown(deadlineMs: number): Promise<{ durable: boolean; unresolved: number }>;
  stats(): Readonly<Record<string, number | boolean>>;
}
interface Slot { kind: 'public' | 'party'; world: WorldId; area: Area; tick: DeadlineScheduler; snapshot: DeadlineScheduler; events: EventRecord[]; watermark: number; lastCheckpoint: number; party?: Party; profile?: BossProfileId }
interface Actor { record: StoredCharacter; slot: Slot; ref: EntityRef; connection: Connection | null; detachedAt: number | null; generation: number; pendingReplay: boolean; returnTo?: { world: WorldId; spawn: string } }
interface Party { code: string; leader: string; members: Map<string, string>; pvp: boolean; encounter?: Slot }
interface Connection {
  ws: WebSocket; ip: string; origin: string; generation: number; closed: boolean;
  phase: 'preauth' | 'authenticating' | 'loading' | 'queued' | 'admitted' | 'closed';
  binding?: SessionBinding; actor?: Actor; protocol: GameplayProtocol; stream?: WireBinding; input?: InputSession;
  sequence: number; epoch: number; full: boolean; lastInput: number; timedOut: boolean; nextValidation: number; validating: boolean; authTimer?: ReturnType<typeof setTimeout>;
  visible: Set<number>;
  queueKey?: string;
  baselineSequence: number;
  results: CommandResult[];
  chatBusy: boolean; chatPreferences?: ChatPreferences; chatNeedsPreferences: boolean;
  discoveries: { unit: EntityRef; id: string; startOrder: number; inputSequence: number; commandIndex: number }[];
}
interface Waiting { connection: Connection; record: StoredCharacter; world: WorldId }
interface PendingTravel { actor: Actor; source: Slot; ref: EntityRef; gate: string; destination: WorldId }
const HOST_COMMAND_KINDS = new Set(HOST_COMMANDS);
const ECONOMIC_INTERACTIONS = new Set<string>([...TREASURES.map(t => t.id), LIGHTHOUSE_SECRET.id]);
class OutcomeResourcePause extends Error {}
const sameRef = (a: EntityRef, b: EntityRef) => a.area === b.area && a.id === b.id && a.life === b.life;
const buffer = (raw: RawData) => Buffer.isBuffer(raw) ? raw : raw instanceof ArrayBuffer ? Buffer.from(raw) : Buffer.concat(raw);
const reject = (socket: Duplex, status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);

/** Actual numeric simulation host. The synthetic v2 fixture is intentionally not imported. */
export function createActualWorldHost(deps: ActualWorldHostDeps): ActualWorldHost {
  const p = deps.policies;
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
  const completion: (() => void)[] = [];
  const persistence = new PersistenceCoordinator(deps.characters, deps.ownership, { ...p.persistence, now: deps.nowMonotonicMs });
  const wss = new WebSocketServer({ noServer: true, maxPayload: p.maxFrameBytes, perMessageDeflate: false });
  let admissionRequested = true; let accepting = true; let stopped = false; let frozen = false; let draining = false; let barrier: Promise<void> | null = null; let timer: ReturnType<typeof setTimeout> | undefined;
  let victimResources = { ...p.victimOutcome };
  let pausedDurability: { run: () => Promise<void>; ownership: HostOwnership } | null = null;
  let generation = 1; let unresolved = 0; let pendingChat = 0;
  const chatTargets = new Map<string, { participant: ChatParticipant; expires: number }>();
  const metrics = { ticks: 0, snapshots: 0, packets: 0, receivedPackets: 0, bytesSent: 0, bytesReceived: 0, rejected: 0, queued: 0,
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
  for (const world of PUBLIC_WORLDS) {
    const loaded = deps.worlds.get(world);
    if (!loaded || loaded.world !== world || loaded.publicDefinition.bosses.length) throw new Error(`missing safe public world: ${world}`);
    if (loaded.publicDefinition.enemies.length > p.maxMutationSourcesPerTick) throw new Error('population exceeds bounded checkpoint receipts');
    const now = deps.nowMonotonicMs();
    const area = createArea({ id: `${world}:${randomUUID()}`, definition: loaded.publicDefinition, query: loaded.query,
      actionData: loaded.actionData, policy: loaded.policy, seed: loaded.seed, characters: registry,
      context: { mode: 'public', pvp: 'disabled', members: [] }, limits: p.areaLimits });
    const slot: Slot = { kind: 'public', world, area, tick: new DeadlineScheduler(30, now), snapshot: new DeadlineScheduler(20, now, 1), events: [], watermark: -1, lastCheckpoint: now };
    slots.set(world, slot); allSlots.add(slot);
  }
  const enqueue = (fn: () => void) => {
    if (stopped) return;
    // Each admitted connection owns at most a small fixed number of in-flight IO operations.
    if (completion.length >= p.maxConnections * 8 + 16) { failClosed(); return; }
    completion.push(fn);
  };
  const boundary = <T>(fn: () => T): Promise<T> => new Promise((resolve, rejectPromise) => enqueue(() => { try { resolve(fn()); } catch (error) { rejectPromise(error); } }));
  const json = (c: Connection, value: unknown) => {
    if (c.ws.readyState === WebSocket.OPEN) { const data = JSON.stringify(value); c.ws.send(data); metrics.packets++; metrics.bytesSent += Buffer.byteLength(data); }
  };
  const queueNotice = (c: Connection, world: WorldId, position: number) => {
    const key = `${world}:${position}`;
    if (c.queueKey === key) return;
    c.queueKey = key;
    if (!sendControl(c, { type: 'queued', world, position })) json(c, { type: 'queued', world, position });
  };
  const close = (c: Connection, code: string, retryable = false) => {
    if (c.closed) return;
    if (!sendControl(c, { type: 'error', code, retryable })) json(c, { type: 'error', code, retryable });
    c.ws.close(1008, code.slice(0, 80));
  };
  function sendControl(c: Connection, value: WorldControl): boolean {
    if (!c.stream || !c.input || !c.actor || c.stream.area !== c.actor.slot.area.services.id || c.closed || c.ws.readyState !== WebSocket.OPEN) return false;
    for (const chunk of c.protocol.encodeControl({ ...c.stream, sequence: ++c.sequence, tick: c.actor.slot.area.services.tick,
      acceptedInput: c.input.acceptedInput, consumedInput: c.input.consumedInput }, value)) {
      c.ws.send(chunk, { binary: true }); metrics.packets++; metrics.bytesSent += chunk.byteLength;
    }
    return true;
  }
  const controlError = (c: Connection, code: string) => {
    sendControl(c, { type: 'error', code, retryable: false });
  };
  function materializeResults(c: Connection): CommandResult[] {
    return c.results.map(result => result.status === 'durable' ? { ...result, revision: c.actor!.record.revision } : result);
  }
  function sendResults(c: Connection) {
    if (!c.results.length || !c.baselineSequence || !c.stream || !c.input || !c.actor || c.closed || c.ws.readyState !== WebSocket.OPEN) return;
    if (c.ws.bufferedAmount > p.maxBufferedBytes) { close(c, 'result-backpressure', true); return; }
    const chunks = c.protocol.encodeEvents({ ...c.stream, sequence: ++c.sequence, tick: c.actor.slot.area.services.tick,
      acceptedInput: c.input.acceptedInput, consumedInput: c.input.consumedInput }, { baselineSequence: c.baselineSequence, events: [], results: materializeResults(c) });
    for (const chunk of chunks) { c.ws.send(chunk, { binary: true }); metrics.packets++; metrics.bytesSent += chunk.byteLength; }
    c.results = [];
  }
  function partyState(party: Party | undefined) {
    if (!party) return null;
    return { code: party.code, leader: party.members.get(party.leader)!, pvp: party.pvp,
      members: [...party.members].map(([character, id]) => {
        const actor = actors.get(character);
        if (!actor) throw new Error('party references retired actor');
        return { id, name: shownName(actor.record.identity.appearance.name), ref: actor.ref, world: actor.slot.world, online: !!actor.connection };
      }) };
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
  function leaveParty(character: string) {
    const party = memberParty.get(character);
    if (!party) return;
    party.members.delete(character); memberParty.delete(character);
    if (!party.members.size) parties.delete(party.code);
    else if (party.leader === character) party.leader = party.members.keys().next().value!;
    syncPartyContexts();
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
      if (actor.slot.kind === 'party') returnRequests.set(character, { actor, leaveParty: true }); else leaveParty(character);
    } else if (command.kind === 'partyPvp') {
      if (!party || party.leader !== character || typeof command.enabled !== 'boolean') { controlError(c, 'party-leader-required'); return; }
      party.pvp = command.enabled; syncPartyContexts();
    } else if (command.kind === 'encounterLeave') {
      if (actor.slot.kind !== 'party') { controlError(c, 'encounter-unavailable'); return; }
      returnRequests.set(character, { actor, leaveParty: false });
    }
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
    for (const c of connections) close(c, 'host-unavailable', true);
  }
  const drain = (slot: Slot) => {
    const events = slot.area.drainEvents();
    if (slot.events.length + events.length > p.areaLimits.eventCount) throw new Error('publication event capacity');
    slot.events.push(...events); if (events.length) slot.watermark = events.at(-1)!.order;
    for (const { event } of events) if (event.type === 'travelReady') {
      const actor = [...actors.values()].find(a => sameRef(a.ref, event.unit));
      if (actor && !travels.has(actor.record.characterId)) travels.set(actor.record.characterId, { actor, source: slot, ref: event.unit, gate: event.gate, destination: event.destination });
    }
    return events;
  };
  const bootstrap = (c: Connection, actor: Actor) => {
    if (++c.epoch > 0xffffffff) throw new Error('stream epoch exhausted');
    c.actor = actor; actor.connection = c; actor.detachedAt = null; actor.generation = generation++;
    c.stream = { session: randomUUID(), area: actor.slot.area.services.id, epoch: c.epoch, catalog: deps.gameplay.catalog.version };
    c.sequence = 0; c.full = true; c.visible.clear(); c.protocol.reset(c.stream);
    c.baselineSequence = 0; c.results = []; c.discoveries = [];
    c.queueKey = undefined;
    c.input = new InputSession(c.stream, deps.gameplay.catalog, { now: deps.nowMonotonicMs() / 1000, maxQueued: p.maxQueuedInputs, timeoutSeconds: p.inputTimeoutMs / 1000 });
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
      stage = slot.area.stageRestoredArrival(admission, checkpoint, prepareRestore(checkpoint, offline, p.restore));
      if (!registry.compareAndSwap(request.record.characterId, null, stage.newRef)) throw new Error('character ownership conflict');
      const ref = slot.area.activateRestoredArrival(stage.token); slot.area.releaseAdmission(admission.token);
      const actor: Actor = { record: request.record, slot, ref, connection: null, detachedAt: null, generation: generation++, pendingReplay: true };
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
      if (party.encounter && (party.encounter.profile !== profile || party.encounter.world !== source.world)) { controlError(c, 'party-encounter-active'); continue; }
      const returnSpawn = p.party.returnSpawn(source.world, profile);
      const publicDefinition = source.area.services.definition;
      if (![publicDefinition.spawn.id, publicDefinition.recall.id, ...Object.values(publicDefinition.pois).map(poi => poi.id)].includes(returnSpawn)) { controlError(c, 'encounter-return-unconfigured'); continue; }
      let destination = party.encounter;
      if (!destination) {
        if ([...allSlots].filter(s => s.kind === 'party').length >= p.party.maxEncounters) { controlError(c, 'encounter-capacity'); continue; }
        const loaded = deps.worlds.get(source.world)!, now = deps.nowMonotonicMs();
        const area = createArea({ id: `party:${randomUUID()}`, definition, query: loaded.query, actionData: loaded.actionData,
          policy: loaded.policy, seed: loaded.seed, characters: registry, context: { mode: 'party-encounter', pvp: party.pvp ? 'party-only' : 'disabled', members: [] }, limits: p.areaLimits });
        area.bootstrapEncounter(profile, { beaconLit: beacon });
        destination = { kind: 'party', world: source.world, area, party, profile, tick: new DeadlineScheduler(30, now),
          snapshot: new DeadlineScheduler(20, now, 1), events: [], watermark: -1, lastCheckpoint: now };
        party.encounter = destination; allSlots.add(destination);
      }
      if (!moveActor(actor, destination, 'encounter:entry')) { controlError(c, 'encounter-full'); continue; }
      actor.returnTo = { world: source.world, spawn: returnSpawn };
      syncPartyContexts();
      if (!destination.area.services.runCommand(actor.ref, { kind: 'bossChallenge', profile })) throw new Error('validated encounter start rejected');
      actor.ref = destination.area.services.playerByCharacter(character)!.state.unit;
      bootstrap(c, actor); drain(destination); startDurability(); break;
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
    for (const slot of allSlots) if (slot.kind === 'party' && slot.area.players.size === 0 && slot.area.pendingGrants().length === 0) {
      slot.area.dispose(); allSlots.delete(slot); if (slot.party?.encounter === slot) slot.party.encounter = undefined;
    }
  };
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
    const checkpoint = deps.codec.toCore(recovery.character.checkpoint), restored = prepareRestore(checkpoint, 0, p.restore);
    const ref = actor.slot.area.restorePlayerCheckpoint(actor.ref, checkpoint, restored, recovery.grants.filter(grant => grant.appliedRevision !== null).map(grant => grant.id));
    actor.ref = ref; actor.record = recovery.character; actor.generation = generation++; actor.pendingReplay = true;
    if (actor.connection) bootstrap(actor.connection, actor);
  }
  function startDurability() {
    if (barrier || frozen || !actors.size) return;
    metrics.persistenceBarriers++; const began = deps.nowMonotonicMs();
    const tokens = new Map<Slot, string>();
    for (const slot of allSlots) if (slot.area.players.size) tokens.set(slot, slot.area.beginDurabilityBarrier('checkpoint'));
    const sources = [...allSlots].flatMap(slot => slot.area.pendingGrants().map(entry => ({ slot, ...entry })));
    metrics.pendingSourceGrants = sources.length;
    const work = async () => {
      // Group an entire death's recipients in one transaction. No recipient is ACKed individually.
      const groups = new Map<string, typeof sources>();
      const unique = new Map<string, string>();
      for (const source of sources) {
        const signature = JSON.stringify(source.grant), prior = unique.get(source.grant.id);
        if (prior && prior !== signature) throw new Error('grant identity content conflict');
        if (prior) continue;
        unique.set(source.grant.id, signature);
        const key = JSON.stringify(source.grant.victim), group = groups.get(key) ?? []; group.push(source); groups.set(key, group);
      }
      for (const group of groups.values()) {
        if (group.length > victimResources.maxEntries) throw new OutcomeResourcePause('victim outcome resource budget; complete source retained');
        const entries: GrantBatchEntry<GrantJson>[] = [];
        for (const { grant } of group) entries.push({ accountId: await deps.characters.getOwner(grant.recipient), characterId: grant.recipient, id: grant.id, payload: deps.codec.grantToJson(grant) });
        const recorded = await deps.characters.recordVictimOutcome(entries, victimResources);
        if (recorded.length !== entries.length || recorded.some((entry, index) => entry.id !== entries[index].id)) throw new Error('incomplete victim outcome journal');
      }
      for (let round = 0; round <= p.persistence.maxRecoveryRounds; round++) {
        // Retained-mode host fence. Area-owned one-use tokens are still required before pruning is enabled.
        const leases = await boundary(() => {
          deps.ownership.assertOwned();
          return [...actors.values()].map(actor => {
            const room = 256 - actor.slot.area.appliedGrantIds(actor.record.characterId).length;
            if (room < 0) throw new Error('checkpoint receipt capacity');
            const connection = actor.connection;
            return { actor, ownerGeneration: actor.generation, slot: actor.slot, ref: { ...actor.ref },
              revision: actor.record.revision, connection, connectionGeneration: connection?.generation, session: connection?.stream?.session,
              limit: Math.min(100, room) };
          });
        });
        const pages = await Promise.all(leases.map(async lease => ({ lease, result: lease.limit ? await readCertifiedGrantPage(deps.characters, deps.ownership, {
          accountId: lease.actor.record.accountId, characterId: lease.actor.record.characterId, expectedRevision: lease.revision, limit: lease.limit,
        }) : null })));
        const reread = await boundary(() => {
          deps.ownership.assertOwned(); let retry = false;
          for (const { lease, result } of pages) {
            const actor = lease.actor, connection = actor.connection;
            const current = actors.get(actor.record.characterId) === actor && actor.generation === lease.ownerGeneration && actor.slot === lease.slot &&
              sameRef(actor.ref, lease.ref) && actor.record.revision === lease.revision && connection === lease.connection && connection?.generation === lease.connectionGeneration && connection?.stream?.session === lease.session;
            if (!current) { actor.pendingReplay = true; retry = true; continue; }
            if (!result) { actor.pendingReplay = true; continue; }
            if (result.kind === 'unresolved') throw new Error('journal certification unresolved: ' + result.reason);
            if (result.kind === 'recovery') { metrics.recoveries++; restoreDurableActor(actor, result.recovery); retry = true; continue; }
            for (const grant of result.grants) actor.slot.area.receiveGrant(deps.codec.grantFromJson(grant.payload));
            actor.pendingReplay = result.more;
          }
          for (const slot of allSlots) drain(slot);
          return retry;
        });
        if (reread) { if (round === p.persistence.maxRecoveryRounds) throw new Error('journal certification recovery capacity'); continue; }
        const captures = await boundary(() => { deps.ownership.assertOwned(); return [...actors.values()].map(actor => ({ actor, generation: actor.generation, capture: actor.slot.area.capturePlayerCheckpoint(actor.ref) })); });
        const results = await Promise.all(captures.map(({ actor, capture }) => persistence.commit({ captureId: capture.captureId,
          accountId: actor.record.accountId, characterId: actor.record.characterId, expectedRevision: actor.record.revision,
          checkpoint: deps.codec.toJson(capture.checkpoint), appliedGrantIds: capture.appliedGrantIds })));
        const recovered = await boundary(() => {
          deps.ownership.assertOwned(); let retry = false;
          for (const [index, result] of results.entries()) {
            const { actor, generation: capturedGeneration, capture } = captures[index];
            if (actor.generation !== capturedGeneration) throw new Error('capture owner changed during barrier');
            if (result.kind === 'unresolved') throw new Error('checkpoint unresolved');
            if (result.kind === 'saved') { actor.record = result.character; actor.slot.area.markCheckpointDurable(capture.captureId, result.character.revision, capture.appliedGrantIds); }
            else {
              metrics.recoveries++; const recovery = result.recovery;
              const exact = isDeepStrictEqual(recovery.character.checkpoint, deps.codec.toJson(capture.checkpoint)) && recovery.grants.every(g => g.appliedRevision !== null);
              actor.record = recovery.character;
              if (exact) actor.slot.area.markCheckpointDurable(capture.captureId, recovery.character.revision, capture.appliedGrantIds);
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
        for (const actor of actors.values()) if (actor.connection) sendResults(actor.connection);
        if (p.party) syncPartyContexts();
        metrics.persistenceMs += deps.nowMonotonicMs() - began;
        observe('persistenceBarrier', deps.nowMonotonicMs() - began);
      });
    };
    runDurability(work);
  }
  function runDurability(work: () => Promise<void>) {
    barrier = work().then(() => {
      if (pausedDurability?.run === work) { pausedDurability = null; unresolved--; frozen = false; accepting = admissionRequested && !draining; }
    }).catch(error => {
      deps.onFailure?.('durability', error);
      const resourceOnly = error instanceof OutcomeResourcePause || error instanceof CharacterStoreError && error.code === 'resource_limit';
      if (resourceOnly && !deps.ownership.closed.aborted && !draining) {
        if (!pausedDurability) unresolved++;
        pausedDurability = { run: work, ownership: deps.ownership };
      } else { if (!pausedDurability) unresolved++; pausedDurability = null; }
      failClosed();
    }).finally(() => { barrier = null; });
  }

  const retireDetached = (now: number) => {
    if (barrier || frozen) return;
    const actor = [...actors.values()].find(a => !a.connection && a.detachedAt !== null && now - a.detachedAt >= p.reconnectGraceMs);
    if (!actor) return;
    if ([...allSlots].some(slot => slot.area.pendingGrants().length) || actor.slot.area.appliedGrantIds(actor.record.characterId).length) { startDurability(); return; }
    const retirement = actor.slot.area.quiescePlayer(actor.ref, 'disconnect');
    const capturedGeneration = actor.generation;
    const task = async () => {
      const result = await persistence.commit({ captureId: retirement.capture.captureId, accountId: actor.record.accountId,
        characterId: actor.record.characterId, expectedRevision: actor.record.revision,
        checkpoint: deps.codec.toJson(retirement.capture.checkpoint), appliedGrantIds: retirement.capture.appliedGrantIds });
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
        actor.slot.area.markCheckpointDurable(retirement.capture.captureId, result.character.revision, retirement.capture.appliedGrantIds);
        actor.slot.area.commitPlayerRetirement(retirement.token);
        actors.delete(actor.record.characterId); travels.delete(actor.record.characterId); encounterRequests.delete(actor.record.characterId); returnRequests.delete(actor.record.characterId);
        leaveParty(actor.record.characterId); drain(actor.slot);
        // A load that raced this save must not reattach its older checkpoint or pending receipt list.
        for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].record.characterId === actor.record.characterId) {
          const request = waiting.splice(i, 1)[0]; load(request.connection, actor.record.characterId);
        }
      });
    };
    barrier = task().catch(error => { deps.onFailure?.('retirement', error); unresolved++; failClosed(); }).finally(() => { barrier = null; });
  };

  const visible = (slot: Slot, actor: Actor, c: Connection): Set<number> => {
    const viewer = slot.area.services.playerByCharacter(actor.record.characterId)!;
    const self = slot.area.services.getUnit(actor.ref)!;
    const pins = new Set<number>([self.ref.id]);
    const party = slot.area.services.context.members.find(m => m.character === actor.record.characterId)?.party;
    if (party) for (const m of slot.area.services.context.members) if (m.party === party) pins.add(m.unit.id);
    if (viewer.state.target && slot.area.services.getUnit(viewer.state.target)) pins.add(viewer.state.target.id);
    for (const b of slot.area.bosses.values()) if (b.engaged) pins.add(b.unit.id);
    const ids = new Set<number>();
    for (const unit of slot.area.units.values()) {
      if (!p.visible(unit, viewer.state)) continue;
      const radius = c.visible.has(unit.ref.id) ? 88 : 80;
      if (pins.has(unit.ref.id) || !unit.hidden && (unit.x - self.x) ** 2 + (unit.z - self.z) ** 2 <= radius ** 2) ids.add(unit.ref.id);
    }
    ids.add(self.ref.id); return ids;
  };
  const publish = (slot: Slot) => {
    if (barrier || frozen || [...actors.values()].some(actor => actor.pendingReplay)) return;
    const start = deps.nowMonotonicMs(), snapshot = slot.area.snapshot();
    const appearances = Object.fromEntries([...actors.values()].filter(a => a.slot === slot).map(a => [`${a.ref.id}:${a.ref.life}`, { ...a.record.identity.appearance, name: shownName(a.record.identity.appearance.name) }]));
    const prepared = prepareObservationSnapshot(snapshot, appearances, deps.gameplay.catalog);
    observe('snapshotPrepare', deps.nowMonotonicMs() - start);
    for (const actor of actors.values()) {
      const c = actor.connection;
      if (actor.slot !== slot || !c || c.closed || !c.stream || !c.input) continue;
      if (c.ws.bufferedAmount > p.maxBufferedBytes) { close(c, 'slow-client', true); continue; }
      try {
        const encodeStart = deps.nowMonotonicMs(), wasFull = c.full;
        c.visible = visible(slot, actor, c);
        const chunks = c.protocol.encodeObservation({ binding: c.stream, sequence: ++c.sequence, tick: snapshot.tick,
          acceptedInput: c.input.acceptedInput, consumedInput: c.input.consumedInput, selfRef: actor.ref,
          snapshot, prepared, events: slot.events, visibleIds: c.visible, full: c.full, eventWatermark: slot.watermark, appearances,
          results: materializeResults(c),
          ...p.observationExtras(snapshot, actor.record.characterId, c.visible) });
        observe('recipientEncode', deps.nowMonotonicMs() - encodeStart);
        for (const chunk of chunks) { c.ws.send(chunk, { binary: true }); metrics.packets++; metrics.bytesSent += chunk.byteLength; }
        c.full = false; c.baselineSequence = c.sequence; c.results = []; metrics.snapshots++;
        if (wasFull) { if (p.party) publishParty(c); if (c.chatPreferences) sendControl(c, { type: 'chatPreferences', ...c.chatPreferences }); }
      } catch (error) { deps.onFailure?.('observation', error); close(c, 'observation-unavailable', true); }
    }
    slot.events = []; metrics.snapshotBatchMs += deps.nowMonotonicMs() - start; observe('snapshotBatch', deps.nowMonotonicMs() - start);
  };
  const step = (slot: Slot) => {
    if (barrier || frozen || draining) return;
    const inputs = new Map<number, PlayerIntent>(), prepared: { c: Connection; frame: PreparedInput; unit: EntityRef }[] = [];
    const hostCommands: { c: Connection; command: HostCommand | Extract<PlayerCommand, {kind:'bossChallenge'}>; inputSequence: number }[] = [];
    const now = deps.nowMonotonicMs(); let progression = false;
    for (const actor of actors.values()) if (actor.slot === slot) {
      const c = actor.connection;
      if (!c || !c.input || c.closed) continue;
      const frame = c.input.prepareTick(now / 1000, p.areaLimits.inputCommandsPerTick);
      if (frame) {
        if (c.results.length + c.discoveries.length + frame.intent.commands.length > 256) { close(c, 'result-backpressure', true); continue; }
        const host = frame.intent.commands.filter(command => HOST_COMMAND_KINDS.has(command.kind) || slot.kind === 'public' && command.kind === 'bossChallenge');
        if (host.length && frame.intent.commands.length !== 1) { close(c, 'host-command-boundary'); continue; }
        const commands = frame.intent.commands.filter((command): command is PlayerCommand => !HOST_COMMAND_KINDS.has(command.kind) && !(slot.kind === 'public' && command.kind === 'bossChallenge'));
        inputs.set(actor.ref.id, { ...frame.intent, commands }); prepared.push({ c, frame, unit: actor.ref });
        if (host[0]) hostCommands.push({ c, command: host[0] as HostCommand | Extract<PlayerCommand, {kind:'bossChallenge'}>, inputSequence: frame.commandOrigins[0].inputSequence });
        progression ||= frame.intent.commands.some(command => !HOST_COMMAND_KINDS.has(command.kind) && !['target', 'jump', 'dance', 'cancel', 'ability'].includes(command.kind));
      } else if (!c.timedOut && now - c.lastInput >= p.inputTimeoutMs) { slot.area.neutralizeInput(actor.ref); c.timedOut = true; metrics.neutralizations++; }
    }
    const inputTick = slot.area.services.tick;
    const started = deps.nowMonotonicMs(), outcomes = slot.area.step(inputs); metrics.ticks++; metrics.tickMs += deps.nowMonotonicMs() - started; observe('tick', deps.nowMonotonicMs() - started);
    const changedLives: Actor[] = [];
    for (const actor of actors.values()) if (actor.slot === slot) {
      const current = slot.area.services.playerByCharacter(actor.record.characterId)?.state.unit;
      if (current && !sameRef(actor.ref, current)) { actor.ref = current; actor.generation = generation++; changedLives.push(actor); }
    }
    for (const { c, frame } of prepared) c.input!.commitConsumed(frame.token);
    for (const { c, command, inputSequence } of hostCommands) {
      if (command.kind.startsWith('chat')) { chatCommand(c, command as Extract<HostCommand, {kind:`chat${string}`}>, inputSequence); continue; }
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
      if (command.kind === 'forgeBuy' || command.kind === 'forgeUpgrade') {
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
    progression ||= slot.area.pendingGrants().length > 0 || emitted.some(({ event }) =>
      ['quest', 'xp', 'levelUp', 'equipment', 'achievement', 'discovery', 'endingReady', 'death', 'respawn'].includes(event.type));
    if (progression || now - slot.lastCheckpoint >= p.checkpointIntervalMs) startDurability();
  };
  const pump = () => {
    if (stopped) return;
    try {
      if (deps.ownership.closed.aborted) failClosed();
      for (let count = 0; completion.length && count < p.maxConnections * 8 + 16; count++) completion.shift()!();
      const now = deps.nowMonotonicMs();
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
      if (!frozen && !draining && !deps.ownership.closed.aborted) for (const c of connections) if (c.phase === 'admitted' && c.chatNeedsPreferences && !c.chatBusy && pendingChat < p.chat!.maxPending) chatCommand(c, { kind: 'chatPreferences' });
      if (!barrier && !frozen && !draining) {
        admitWaiting(); if (!barrier && [...actors.values()].some(actor => actor.pendingReplay)) startDurability(); advanceTravel(); advanceEncounters(); cleanupEncounters(); retireDetached(now);
        for (const slot of allSlots) {
          if (!slot.area.players.size || barrier) { slot.tick.idle(now); slot.snapshot.idle(now); continue; }
          slot.tick.run(now, () => step(slot));
          if (!barrier) slot.snapshot.run(now, () => publish(slot));
        }
      }
    } catch (error) { deps.onFailure?.('pump', error); unresolved++; failClosed(); }
    timer = setTimeout(pump, p.loopIntervalMs);
  };
  const onLost = () => failClosed(); deps.ownership.closed.addEventListener('abort', onLost);
  pump();
  return {
    handleUpgrade(req, socket, head) {
      if (req.url?.split('?')[0] !== '/world') return;
      if (!accepting || frozen || deps.ownership.closed.aborted) { reject(socket, '503 Service Unavailable'); return; }
      const origin = req.headers.origin;
      if (!origin || !deps.originAllowed(origin, req)) { reject(socket, '403 Forbidden'); return; }
      const ip = deps.clientIp(req);
      if (connections.size >= p.maxConnections || [...connections].filter(c => c.ip === ip).length >= p.maxConnectionsPerIp) { reject(socket, '503 Service Unavailable'); return; }
      wss.handleUpgrade(req, socket, head, ws => {
        const c: Connection = { ws, ip, origin, generation: generation++, closed: false, phase: 'preauth',
          protocol: deps.gameplay.create(), sequence: 0, epoch: 0, full: true, lastInput: 0, timedOut: false, nextValidation: Infinity, validating: false, visible: new Set(), baselineSequence: 0, results: [], discoveries: [], chatBusy: false, chatNeedsPreferences: false };
        connections.add(c);
        c.authTimer = setTimeout(() => { if (c.phase === 'preauth' || c.phase === 'authenticating') close(c, 'auth-timeout'); }, p.authTimeoutMs);
        ws.on('error', () => ws.terminate());
        ws.on('close', () => {
          c.closed = true; c.phase = 'closed'; c.generation++; connections.delete(c); if (c.authTimer) clearTimeout(c.authTimer);
          enqueue(() => {
            for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].connection === c) waiting.splice(i, 1);
            const actor = c.actor;
            if (actor?.connection === c) { actor.connection = null; actor.detachedAt = deps.nowMonotonicMs(); actor.slot.area.neutralizeInput(actor.ref); }
          });
        });
        ws.on('message', (raw, binary) => {
          if (c.closed || frozen || draining) return;
          const bytes = buffer(raw); metrics.bytesReceived += bytes.byteLength; metrics.receivedPackets++;
          if (c.phase === 'preauth') {
            if (binary || bytes.byteLength > p.maxAuthFrameBytes) { close(c, 'auth-frame'); return; }
            let value: { type?: unknown; ticket?: unknown; characterId?: unknown };
            try { value = JSON.parse(bytes.toString('utf8')); } catch { close(c, 'auth-frame'); return; }
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'characterId,ticket,type' || value.type !== 'authenticate' || typeof value.characterId !== 'string') { close(c, 'auth-frame'); return; }
            c.phase = 'authenticating'; const attempt = c.generation;
            void deps.admission.consume(value.ticket, origin).then(binding => enqueue(() => {
              if (c.closed || c.generation !== attempt || !accepting || deps.ownership.closed.aborted) return;
              if (c.authTimer) clearTimeout(c.authTimer); c.binding = binding; c.nextValidation = deps.nowMonotonicMs() + p.sessionRevalidateMs;
              load(c, value.characterId as string);
            }), () => enqueue(() => { metrics.authFailures++; if (!c.closed && c.generation === attempt) close(c, 'authentication-failed'); }));
          } else if (c.phase === 'admitted' && binary && c.input && c.stream) {
            try {
              const message = c.protocol.decodeClientMessage(bytes, c.stream);
              if (message.kind === 'resync') { c.full = true; return; }
              c.input.accept(bytes, deps.nowMonotonicMs() / 1000); c.lastInput = deps.nowMonotonicMs(); c.timedOut = false;
            } catch { metrics.rejected++; close(c, 'invalid-input'); }
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
      deps.ownership.assertOwned(); victimResources = { ...resources }; runDurability(pause.run);
      await barrier; return pausedDurability === null && !frozen && !deps.ownership.closed.aborted;
    },
    async shutdown(deadlineMs) {
      admissionRequested = false; accepting = false; draining = true;
      const end = deps.nowMonotonicMs() + deadlineMs;
      for (const c of connections) { if (!sendControl(c, { type: 'restarting', retryAfterSeconds: 1 })) json(c, { type: 'restarting', retryAfterSeconds: 1 }); if (c.actor) c.actor.slot.area.neutralizeInput(c.actor.ref); }
      if (!barrier && !frozen) startDurability();
      while (barrier && deps.nowMonotonicMs() < end) await new Promise(resolve => setTimeout(resolve, p.loopIntervalMs));
      const persisted = await persistence.shutdown(Math.max(0, end - deps.nowMonotonicMs()));
      stopped = true; if (timer) clearTimeout(timer); deps.ownership.closed.removeEventListener('abort', onLost);
      for (const c of connections) { if (c.authTimer) clearTimeout(c.authTimer); c.ws.close(1012, 'Server restarting'); }
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => { for (const c of connections) c.ws.terminate(); resolve(); }, Math.max(0, end - deps.nowMonotonicMs()));
        wss.close(() => { clearTimeout(timeout); resolve(); });
      });
      const count = unresolved + persisted.unresolved + (barrier ? 1 : 0);
      return { durable: persisted.durable && count === 0, unresolved: count };
    },
    stats: () => ({ ...metrics, ...timingStats(), processCpuUserMs: process.cpuUsage(processCpuStart).user / 1000,
      processCpuSystemMs: process.cpuUsage(processCpuStart).system / 1000, processElapsedMs: deps.nowMonotonicMs() - processStarted,
      activeConnections: connections.size, activeActors: actors.size, waiting: waiting.length,
      publicAreas: slots.size, resourcePaused: pausedDurability !== null, frozen, accepting, draining, stopped, ownershipHeld: !deps.ownership.closed.aborted, durableBarrier: barrier !== null, unresolved,
      pendingChat, partyCount: parties.size, encounterAreas: [...allSlots].filter(slot => slot.kind === 'party').length,
      droppedTicks: [...allSlots].reduce((n, s) => n + s.tick.dropped, 0), droppedSnapshots: [...allSlots].reduce((n, s) => n + s.snapshot.dropped, 0) }),
  };
}
