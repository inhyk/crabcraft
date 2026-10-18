import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { createArea } from '../../src/sim/area.ts';
import { InMemoryCharacterRegistry, InMemoryTransferCoordinator } from '../../src/sim/transfer.ts';
import { prepareRestore, type CoreCharacterCodec, type IdentityJson, type CheckpointJson, type GrantJson, type RestorePolicy } from '../../src/sim/persistence.ts';
import type { Area, AreaSnapshot, EntityRef, EventRecord, PlayerIntent, PlayerState, SimUnit, WorldId } from '../../src/sim/types.ts';
import { CharacterStore, type Character } from './character-store.ts';
import { WorldTicketRegistry, type SessionBinding } from './admission.ts';
import type { HostOwnership } from './ownership.ts';
import { DeadlineScheduler } from './scheduler.ts';
import { PersistenceCoordinator } from './persistence-coordinator.ts';
import { PUBLIC_WORLDS, type LoadedWorldDefinition } from './catalog.ts';
import { InputSession, type PreparedInput } from './gameplay/intents.ts';
import type { GameplayCatalog, GameplayProtocol, ObservationInput, WireBinding } from './gameplay/protocol.ts';

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
  readonly persistence: { maxQueuedPerCharacter: number; maxAttempts: number; retryMs: number; maxRecoveryRounds: number };
  readonly areaLimits: { eventCount: number; inputCommandsPerTick: number; timers: number; projectiles: number };
  readonly restore: RestorePolicy;
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
  shutdown(deadlineMs: number): Promise<{ durable: boolean; unresolved: number }>;
  stats(): Readonly<Record<string, number | boolean>>;
}
interface Slot { world: WorldId; area: Area; tick: DeadlineScheduler; snapshot: DeadlineScheduler; events: EventRecord[]; watermark: number; lastCheckpoint: number }
interface Actor { record: StoredCharacter; slot: Slot; ref: EntityRef; connection: Connection | null; detachedAt: number | null; generation: number; replay: GrantJson[] }
interface Connection {
  ws: WebSocket; ip: string; origin: string; generation: number; closed: boolean;
  phase: 'preauth' | 'authenticating' | 'loading' | 'queued' | 'admitted' | 'closed';
  binding?: SessionBinding; actor?: Actor; protocol: GameplayProtocol; stream?: WireBinding; input?: InputSession;
  sequence: number; epoch: number; full: boolean; lastInput: number; timedOut: boolean; nextValidation: number; validating: boolean; authTimer?: ReturnType<typeof setTimeout>;
  visible: Set<number>;
}
interface Waiting { connection: Connection; record: StoredCharacter; replay: GrantJson[]; world: WorldId }
interface PendingTravel { actor: Actor; source: Slot; ref: EntityRef; gate: string; destination: WorldId }
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
  deps.ownership.assertOwned();
  const registry = new InMemoryCharacterRegistry();
  const transfers = new InMemoryTransferCoordinator(registry);
  const slots = new Map<WorldId, Slot>();
  const actors = new Map<string, Actor>();
  const connections = new Set<Connection>();
  const waiting: Waiting[] = [];
  const travels = new Map<string, PendingTravel>();
  const completion: (() => void)[] = [];
  const persistence = new PersistenceCoordinator(deps.characters, deps.ownership, { ...p.persistence, now: deps.nowMonotonicMs });
  const wss = new WebSocketServer({ noServer: true, maxPayload: p.maxFrameBytes, perMessageDeflate: false });
  let accepting = true; let stopped = false; let frozen = false; let draining = false; let barrier: Promise<void> | null = null; let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 1; let unresolved = 0;
  const metrics = { ticks: 0, snapshots: 0, packets: 0, bytesSent: 0, bytesReceived: 0, rejected: 0, queued: 0,
    authFailures: 0, persistenceBarriers: 0, persistenceMs: 0, tickMs: 0, snapshotBatchMs: 0, neutralizations: 0, recoveries: 0 };
  for (const world of PUBLIC_WORLDS) {
    const loaded = deps.worlds.get(world);
    if (!loaded || loaded.world !== world || loaded.publicDefinition.bosses.length) throw new Error(`missing safe public world: ${world}`);
    if (loaded.publicDefinition.enemies.length > p.maxMutationSourcesPerTick) throw new Error('population exceeds bounded checkpoint receipts');
    const now = deps.nowMonotonicMs();
    const area = createArea({ id: `${world}:${randomUUID()}`, definition: loaded.publicDefinition, query: loaded.query,
      actionData: loaded.actionData, policy: loaded.policy, seed: loaded.seed, characters: registry,
      context: { mode: 'public', pvp: 'disabled', members: [] }, limits: p.areaLimits });
    slots.set(world, { world, area, tick: new DeadlineScheduler(30, now), snapshot: new DeadlineScheduler(20, now, 1), events: [], watermark: -1, lastCheckpoint: now });
  }
  const enqueue = (fn: () => void) => {
    if (stopped) return;
    // Each admitted connection owns at most a small fixed number of in-flight IO operations.
    if (completion.length >= p.maxConnections * 8 + 16) { failClosed(); return; }
    completion.push(fn);
  };
  const boundary = <T>(fn: () => T): Promise<T> => new Promise((resolve, rejectPromise) => enqueue(() => { try { resolve(fn()); } catch (error) { rejectPromise(error); } }));
  const json = (c: Connection, value: unknown) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(value));
  };
  const close = (c: Connection, code: string, retryable = false) => {
    if (c.closed) return;
    json(c, { type: 'error', code, retryable }); c.ws.close(1008, code.slice(0, 80));
  };
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
  };
  const bootstrap = (c: Connection, actor: Actor) => {
    if (++c.epoch > 0xffffffff) throw new Error('stream epoch exhausted');
    c.actor = actor; actor.connection = c; actor.detachedAt = null; actor.generation = generation++;
    c.stream = { session: randomUUID(), area: actor.slot.area.services.id, epoch: c.epoch, catalog: deps.gameplay.catalog.version };
    c.sequence = 0; c.full = true; c.visible.clear(); c.protocol.reset(c.stream);
    c.input = new InputSession(c.stream, deps.gameplay.catalog, { now: deps.nowMonotonicMs() / 1000, maxQueued: p.maxQueuedInputs, timeoutSeconds: p.inputTimeoutMs / 1000 });
    actor.slot.area.resetInputSession(actor.ref); c.phase = 'admitted'; c.lastInput = deps.nowMonotonicMs(); c.timedOut = false;
    json(c, { type: 'world-bound', ...c.stream });
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
      const actor: Actor = { record: request.record, slot, ref, connection: null, detachedAt: null, generation: generation++, replay: request.replay };
      actors.set(request.record.characterId, actor); bootstrap(c, actor); return true;
    } catch {
      if (stage) slot.area.abortArrival(stage.token);
      slot.area.releaseAdmission(admission.token); close(c, 'restore-failed'); return true;
    }
  };
  const admitWaiting = () => {
    if (barrier || frozen) return;
    for (let i = 0; i < waiting.length;) {
      const request = waiting[i];
      if (attach(request)) { waiting.splice(i, 1); if (request.connection.actor) startDurability(); if (barrier) break; }
      else { json(request.connection, { type: 'queued', world: request.world, position: i + 1 }); i++; }
    }
  };
  const advanceTravel = () => {
    if (barrier || frozen) return;
    for (const [character, request] of travels) {
      const { actor, source } = request, destination = slots.get(request.destination);
      if (!destination || actor.slot !== source || !sameRef(actor.ref, request.ref) || !actor.connection) { travels.delete(character); continue; }
      const result = transfers.transfer(character, source.area, destination.area, request.gate, metrics.ticks);
      if (result.ok) {
        actor.ref = result.ref; actor.slot = destination; actor.generation = generation++;
        bootstrap(actor.connection, actor); travels.delete(character); startDurability(); break;
      }
      if (result.reason === 'destination-full') {
        json(actor.connection, { type: 'queued', world: request.destination, position: [...travels.keys()].indexOf(character) + 1 });
      } else {
        json(actor.connection, { type: 'error', code: 'travel-unavailable', retryable: true }); travels.delete(character);
      }
    }
  };
  const load = (c: Connection, characterId: string) => {
    const attempt = c.generation, binding = c.binding!; c.phase = 'loading';
    void Promise.all([deps.characters.getOwned(binding.accountId, characterId), deps.characters.pendingGrants(binding.accountId, characterId, { limit: 100 })]).then(([record, grants]) => enqueue(() => {
      if (c.closed || c.generation !== attempt || !accepting || deps.ownership.closed.aborted) return;
      const world = deps.codec.toCore(record.checkpoint).world;
      if (!slots.has(world)) { close(c, 'world-unavailable'); return; }
      if (waiting.length >= p.maxWaiting) { close(c, 'queue-full', true); return; }
      c.phase = 'queued'; waiting.push({ connection: c, record, replay: grants.map(g => g.payload), world }); metrics.queued++; admitWaiting();
    }), () => enqueue(() => { if (!c.closed && c.generation === attempt) close(c, 'character-unavailable'); }));
  };

  function startDurability() {
    if (barrier || frozen || !actors.size) return;
    metrics.persistenceBarriers++; const began = deps.nowMonotonicMs();
    const tokens = new Map<Slot, string>();
    for (const slot of slots.values()) if (slot.area.players.size) tokens.set(slot, slot.area.beginDurabilityBarrier('checkpoint'));
    const sources = [...slots.values()].flatMap(slot => slot.area.pendingGrants().map(entry => ({ slot, ...entry })));
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
        if (group.length > 100) throw new Error('contributor batch capacity');
        const entries = await Promise.all(group.map(async ({ grant }) => ({ accountId: await deps.characters.getOwner(grant.recipient), characterId: grant.recipient, id: grant.id, payload: deps.codec.grantToJson(grant) })));
        await deps.characters.recordGrantBatch(entries);
      }
      await boundary(() => {
        deps.ownership.assertOwned();
        for (const { grant, appliedHere } of sources) {
          const actor = actors.get(grant.recipient);
          // appliedHere is a historical fact; absent receipt never authorizes applying it twice.
          if (actor && !appliedHere && !actor.slot.area.appliedGrantIds(grant.recipient).includes(grant.id)) actor.slot.area.receiveGrant(grant);
        }
        for (const actor of actors.values()) {
          for (const grant of actor.replay) actor.slot.area.receiveGrant(deps.codec.grantFromJson(grant));
          actor.replay = [];
        }
        for (const slot of slots.values()) drain(slot);
      });
      for (let round = 0; round <= p.persistence.maxRecoveryRounds; round++) {
        const captures = await boundary(() => [...actors.values()].map(actor => ({ actor, generation: actor.generation, capture: actor.slot.area.capturePlayerCheckpoint(actor.ref) })));
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
                const checkpoint = deps.codec.toCore(recovery.character.checkpoint);
                actor.ref = actor.slot.area.restorePlayerCheckpoint(actor.ref, checkpoint, prepareRestore(checkpoint, 0, p.restore), recovery.grants.filter(g => g.appliedRevision !== null).map(g => g.id));
                for (const grant of recovery.grants) if (grant.appliedRevision === null) actor.slot.area.receiveGrant(deps.codec.grantFromJson(grant.payload));
                if (actor.connection) bootstrap(actor.connection, actor);
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
        for (const source of sources) source.slot.area.acknowledgeGrant(source.grant.id);
        for (const [slot, token] of tokens) { drain(slot); slot.area.releaseDurabilityBarrier(token); slot.lastCheckpoint = deps.nowMonotonicMs(); }
        metrics.persistenceMs += deps.nowMonotonicMs() - began;
      });
    };
    barrier = work().catch(error => { deps.onFailure?.('durability', error); unresolved++; failClosed(); }).finally(() => { barrier = null; });
  }

  const retireDetached = (now: number) => {
    if (barrier || frozen) return;
    const actor = [...actors.values()].find(a => !a.connection && a.detachedAt !== null && now - a.detachedAt >= p.reconnectGraceMs);
    if (!actor) return;
    if ([...slots.values()].some(slot => slot.area.pendingGrants().length) || actor.slot.area.appliedGrantIds(actor.record.characterId).length) { startDurability(); return; }
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
          actor.record = result.recovery.character;
          const checkpoint = deps.codec.toCore(actor.record.checkpoint);
          actor.ref = actor.slot.area.restorePlayerCheckpoint(actor.ref, checkpoint, prepareRestore(checkpoint, 0, p.restore), result.recovery.grants.filter(g => g.appliedRevision !== null).map(g => g.id));
          for (const grant of result.recovery.grants) if (grant.appliedRevision === null) actor.slot.area.receiveGrant(deps.codec.grantFromJson(grant.payload));
          // Replacement invalidates the retirement token. A new bounded capture is required next pump.
          return;
        }
        actor.record = result.character;
        actor.slot.area.markCheckpointDurable(retirement.capture.captureId, result.character.revision, retirement.capture.appliedGrantIds);
        actor.slot.area.commitPlayerRetirement(retirement.token);
        actors.delete(actor.record.characterId); travels.delete(actor.record.characterId); drain(actor.slot);
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
    if (barrier || frozen) return;
    const start = deps.nowMonotonicMs(), snapshot = slot.area.snapshot();
    for (const actor of actors.values()) {
      const c = actor.connection;
      if (actor.slot !== slot || !c || c.closed || !c.stream || !c.input) continue;
      if (c.ws.bufferedAmount > p.maxBufferedBytes) { close(c, 'slow-client', true); continue; }
      try {
        c.visible = visible(slot, actor, c);
        const chunks = c.protocol.encodeObservation({ binding: c.stream, sequence: ++c.sequence, tick: snapshot.tick,
          acceptedInput: c.input.acceptedInput, consumedInput: c.input.consumedInput, selfRef: actor.ref,
          snapshot, events: slot.events, visibleIds: c.visible, full: c.full, eventWatermark: slot.watermark,
          appearances: Object.fromEntries([...actors.values()].filter(a => a.slot === slot).map(a => [`${a.ref.id}:${a.ref.life}`, a.record.identity.appearance])),
          ...p.observationExtras(snapshot, actor.record.characterId, c.visible) });
        for (const chunk of chunks) { c.ws.send(chunk, { binary: true }); metrics.packets++; metrics.bytesSent += chunk.byteLength; }
        c.full = false; metrics.snapshots++;
      } catch (error) { deps.onFailure?.('observation', error); close(c, 'observation-unavailable', true); }
    }
    slot.events = []; metrics.snapshotBatchMs += deps.nowMonotonicMs() - start;
  };
  const step = (slot: Slot) => {
    if (barrier || frozen || draining) return;
    const inputs = new Map<number, PlayerIntent>(), prepared: { c: Connection; frame: PreparedInput }[] = [];
    const now = deps.nowMonotonicMs(); let progression = false;
    for (const actor of actors.values()) if (actor.slot === slot) {
      const c = actor.connection;
      if (!c || !c.input || c.closed) continue;
      const frame = c.input.prepareTick(now / 1000, p.areaLimits.inputCommandsPerTick);
      if (frame) {
        inputs.set(actor.ref.id, frame.intent); prepared.push({ c, frame });
        progression ||= frame.intent.commands.some(command => !['target', 'jump', 'dance', 'cancel', 'ability'].includes(command.kind));
      } else if (!c.timedOut && now - c.lastInput >= p.inputTimeoutMs) { slot.area.neutralizeInput(actor.ref); c.timedOut = true; metrics.neutralizations++; }
    }
    const started = deps.nowMonotonicMs(); slot.area.step(inputs); metrics.ticks++; metrics.tickMs += deps.nowMonotonicMs() - started;
    const changedLives: Actor[] = [];
    for (const actor of actors.values()) if (actor.slot === slot) {
      const current = slot.area.services.playerByCharacter(actor.record.characterId)?.state.unit;
      if (current && !sameRef(actor.ref, current)) { actor.ref = current; actor.generation = generation++; changedLives.push(actor); }
    }
    for (const { c, frame } of prepared) c.input!.commitConsumed(frame.token);
    for (const actor of changedLives) if (actor.connection) bootstrap(actor.connection, actor);
    drain(slot);
    progression ||= slot.area.pendingGrants().length > 0;
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
      if (!barrier && !frozen) {
        admitWaiting(); advanceTravel(); retireDetached(now);
        for (const slot of slots.values()) {
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
          protocol: deps.gameplay.create(), sequence: 0, epoch: 0, full: true, lastInput: 0, timedOut: false, nextValidation: Infinity, validating: false, visible: new Set() };
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
          const bytes = buffer(raw); metrics.bytesReceived += bytes.byteLength;
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
    stopAdmission() { accepting = false; },
    async shutdown(deadlineMs) {
      accepting = false; draining = true;
      const end = deps.nowMonotonicMs() + deadlineMs;
      for (const c of connections) { json(c, { type: 'restarting', retryAfterSeconds: 1 }); if (c.actor) c.actor.slot.area.neutralizeInput(c.actor.ref); }
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
    stats: () => ({ ...metrics, activeConnections: connections.size, activeActors: actors.size, waiting: waiting.length,
      publicAreas: slots.size, frozen, durableBarrier: barrier !== null, unresolved,
      droppedTicks: [...slots.values()].reduce((n, s) => n + s.tick.dropped, 0), droppedSnapshots: [...slots.values()].reduce((n, s) => n + s.snapshot.dropped, 0) }),
  };
}
