import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Character, EarnedGrant, Json } from './character-store.ts';
import type { HostOwnership } from './ownership.ts';
import { DurableOutcomeStore, DurableLedgerError, MAX_RECIPE_BYTES, type DraftHandle, type VictimSeal } from './contribution-store.ts';
import { canonicalLedgerJson } from './character-store.ts';
import { planOutcomePage, validateDeathRecipe, validatePlannerCursor, victimKey, type DeathRecipe, type PagedOutcomeSeal } from '../../src/sim/ledger.ts';
import type { Area, EntityRef, GrantApplyResult } from '../../src/sim/types.ts';
import type { IdentityJson, CheckpointJson, GrantJson, CoreCharacterCodec } from '../../src/sim/persistence.ts';

export interface PlayerCommit<C extends Json> {
  readonly captureId: string;
  readonly accountId: string;
  readonly characterId: string;
  readonly expectedRevision: number;
  readonly checkpoint: C;
  readonly appliedGrantIds: readonly string[];
}
export interface Recovery<I extends Json, C extends Json, G extends Json> {
  character: Character<I, C>;
  grants: (EarnedGrant<G> & { appliedRevision: number | null })[];
}
export interface CheckpointStore<I extends Json, C extends Json, G extends Json> {
  saveCheckpoint(account: string, character: string, revision: number, checkpoint: C, ids: readonly string[]): Promise<Character<I, C>>;
  /** Optional: all writes in one transaction, all or nothing (CharacterStore.saveCheckpoints). */
  saveCheckpoints?(writes: readonly { accountId: string; characterId: string; expectedRevision: number; checkpoint: C; appliedGrantIds: readonly string[] }[]): Promise<Character<I, C>[]>;
  loadForRecovery(account: string, character: string, ids: readonly string[]): Promise<Recovery<I, C, G>>;
}
export type CommitResult<I extends Json, C extends Json, G extends Json> =
  | { kind: 'saved'; captureId: string; character: Character<I, C> }
  | { kind: 'recovery'; captureId: string; recovery: Recovery<I, C, G> }
  | { kind: 'unresolved'; captureId: string; reason: 'ownership' | 'storage' };

function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (v: unknown) => { if (v && typeof v === 'object') { Object.freeze(v); for (const x of Object.values(v)) freeze(x); } };
  freeze(copy); return copy;
}

/** No live Area objects enter this coordinator. Completions must be applied by the host boundary. */
export class PersistenceCoordinator<I extends Json, C extends Json, G extends Json> {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly counts = new Map<string, number>();
  private readonly pending = new Set<Promise<unknown>>();
  private unresolved = 0;
  private stopped = false;
  private readonly store: CheckpointStore<I, C, G>;
  private readonly ownership: HostOwnership;
  private readonly options: { maxQueuedPerCharacter: number; maxAttempts: number; retryMs: number; now: () => number };
  readonly metrics = { captures: 0, saved: 0, recoveries: 0, retries: 0, failed: 0, commitMs: 0, batches: 0, batchFallbacks: 0 };
  constructor(store: CheckpointStore<I, C, G>, ownership: HostOwnership,
    options: { maxQueuedPerCharacter: number; maxAttempts: number; retryMs: number; now: () => number }) {
    if (!Number.isSafeInteger(options.maxQueuedPerCharacter) || options.maxQueuedPerCharacter < 1 || options.maxQueuedPerCharacter > 256 ||
      !Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 100 || !Number.isFinite(options.retryMs) || options.retryMs < 0) throw new Error('invalid persistence limits');
    this.store = store; this.ownership = ownership; this.options = options;
  }
  private check(input: PlayerCommit<C>): void {
    if (!input.captureId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.appliedGrantIds.length > 256 || new Set(input.appliedGrantIds).size !== input.appliedGrantIds.length) throw new Error('invalid checkpoint capture');
  }
  commit(input: PlayerCommit<C>): Promise<CommitResult<I, C, G>> {
    if (this.stopped || this.ownership.closed.aborted) return Promise.resolve({ kind: 'unresolved', captureId: input.captureId, reason: 'ownership' });
    this.check(input);
    const key = input.characterId;
    if ((this.counts.get(key) ?? 0) >= this.options.maxQueuedPerCharacter) throw new Error('checkpoint queue full');
    const capture = immutable(input); this.metrics.captures++;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const task = previous.then(() => this.save(capture));
    this.tails.set(key, task); this.pending.add(task);
    void task.finally(() => {
      this.pending.delete(task); this.counts.set(key, (this.counts.get(key) ?? 1) - 1);
      if (this.tails.get(key) === task) { this.tails.delete(key); this.counts.delete(key); }
    });
    return task;
  }
  /**
   * Several captures (distinct characters) in one store transaction, ordered after any earlier commit of the same characters.
   * A batch that does not certainly commit (an error, a conflict of one entry, a lost COMMIT response) sends every capture
   * through the same per-capture save() as commit(): retry, and recovery that inspects receipts and revision after a lost ACK.
   * One capture, or a store without saveCheckpoints, uses commit() unchanged.
   */
  commitBatch(inputs: readonly PlayerCommit<C>[]): Promise<CommitResult<I, C, G>[]> {
    if (!inputs.length) return Promise.resolve([]);
    if (inputs.length === 1 || typeof this.store.saveCheckpoints !== 'function') return Promise.all(inputs.map(input => this.commit(input)));
    if (this.stopped || this.ownership.closed.aborted) return Promise.resolve(inputs.map(input => ({ kind: 'unresolved' as const, captureId: input.captureId, reason: 'ownership' as const })));
    for (const input of inputs) this.check(input);
    const keys = inputs.map(input => input.characterId);
    if (new Set(keys).size !== keys.length) throw new Error('checkpoint batch repeats a character');
    if (keys.some(key => (this.counts.get(key) ?? 0) >= this.options.maxQueuedPerCharacter)) throw new Error('checkpoint queue full');
    const captures = inputs.map(input => immutable(input)); this.metrics.captures += captures.length;
    const previous = Promise.all(keys.map(key => this.tails.get(key) ?? Promise.resolve()));
    const task = previous.then(() => this.saveBatch(captures));
    for (const key of keys) { this.counts.set(key, (this.counts.get(key) ?? 0) + 1); this.tails.set(key, task); }
    this.pending.add(task);
    void task.finally(() => {
      this.pending.delete(task);
      for (const key of keys) {
        this.counts.set(key, (this.counts.get(key) ?? 1) - 1);
        if (this.tails.get(key) === task) { this.tails.delete(key); this.counts.delete(key); }
      }
    });
    return task;
  }
  private async saveBatch(captures: readonly PlayerCommit<C>[]): Promise<CommitResult<I, C, G>[]> {
    const start = this.options.now();
    if (this.ownership.closed.aborted) { this.unresolved += captures.length; return captures.map(capture => ({ kind: 'unresolved', captureId: capture.captureId, reason: 'ownership' })); }
    try {
      const saved = await this.store.saveCheckpoints!(captures.map(capture => ({ accountId: capture.accountId, characterId: capture.characterId,
        expectedRevision: capture.expectedRevision, checkpoint: capture.checkpoint, appliedGrantIds: capture.appliedGrantIds })));
      if (saved.length !== captures.length || saved.some((character, index) => character.characterId !== captures[index].characterId || character.revision !== captures[index].expectedRevision + 1)) throw new Error('incomplete checkpoint batch');
      // A successful write cannot authorize publication after the ownership session was lost.
      if (this.ownership.closed.aborted) { this.unresolved += captures.length; return captures.map(capture => ({ kind: 'unresolved', captureId: capture.captureId, reason: 'ownership' })); }
      this.metrics.saved += captures.length; this.metrics.batches++; this.metrics.commitMs += this.options.now() - start;
      return captures.map((capture, index) => ({ kind: 'saved', captureId: capture.captureId, character: saved[index] }));
    } catch {
      // The batch may have committed before its response was lost: per-capture save() inspects revision and receipts first.
      this.metrics.batchFallbacks++;
      return Promise.all(captures.map(capture => this.save(capture)));
    }
  }
  private async save(capture: PlayerCommit<C>): Promise<CommitResult<I, C, G>> {
    const start = this.options.now();
    for (let attempt = 0; attempt < this.options.maxAttempts; attempt++) {
      if (this.ownership.closed.aborted) { this.unresolved++; return { kind: 'unresolved', captureId: capture.captureId, reason: 'ownership' }; }
      try {
        const character = await this.store.saveCheckpoint(capture.accountId, capture.characterId, capture.expectedRevision, capture.checkpoint, capture.appliedGrantIds);
        // A successful write cannot authorize publication after the ownership session was lost.
        if (this.ownership.closed.aborted) { this.unresolved++; return { kind: 'unresolved', captureId: capture.captureId, reason: 'ownership' }; }
        this.metrics.saved++; this.metrics.commitMs += this.options.now() - start;
        return { kind: 'saved', captureId: capture.captureId, character };
      } catch {
        // A failed response can follow a committed transaction. Inspect consistent receipts before retrying.
        try {
          const recovery = await this.store.loadForRecovery(capture.accountId, capture.characterId, capture.appliedGrantIds);
          if (this.ownership.closed.aborted) { this.unresolved++; return { kind: 'unresolved', captureId: capture.captureId, reason: 'ownership' }; }
          if (recovery.character.revision !== capture.expectedRevision || recovery.grants.some(g => g.appliedRevision !== null)) {
            this.metrics.recoveries++; return { kind: 'recovery', captureId: capture.captureId, recovery };
          }
        } catch { /* Keep the original immutable capture and freeze its authority until storage returns. */ }
        if (attempt + 1 < this.options.maxAttempts) {
          this.metrics.retries++;
          await new Promise(resolve => setTimeout(resolve, this.options.retryMs));
        }
      }
    }
    this.unresolved++; this.metrics.failed++;
    return { kind: 'unresolved', captureId: capture.captureId, reason: 'storage' };
  }
  async shutdown(deadlineMs: number): Promise<{ durable: boolean; unresolved: number }> {
    this.stopped = true;
    if (!Number.isFinite(deadlineMs) || deadlineMs < 0) throw new Error('invalid shutdown deadline');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all([...this.pending]), new Promise(resolve => { timer = setTimeout(resolve, deadlineMs); })]);
    } finally { if (timer) clearTimeout(timer); }
    const unresolved = this.unresolved + this.pending.size;
    return { durable: unresolved === 0 && !this.ownership.closed.aborted, unresolved };
  }
}

export interface PendingGrantStore<I extends Json, C extends Json, G extends Json> {
  pendingGrants(account: string, character: string, options: { limit: number }): Promise<EarnedGrant<G>[]>;
  loadForRecovery(account: string, character: string, ids: readonly string[]): Promise<Recovery<I, C, G>>;
}
export type CertifiedPageRead<I extends Json, C extends Json, G extends Json> =
  | { kind: 'page'; revision: number; grants: (EarnedGrant<G> & { appliedRevision: number | null })[]; more: boolean }
  | { kind: 'recovery'; recovery: Recovery<I, C, G> }
  | { kind: 'unresolved'; reason: 'ownership' | 'storage' };

/** Candidate selection is not proof. The consistent second read certifies revision and exact receipts. */
export async function readCertifiedGrantPage<I extends Json, C extends Json, G extends Json>(
  store: PendingGrantStore<I, C, G>, ownership: HostOwnership,
  context: { accountId: string; characterId: string; expectedRevision: number; limit: number },
): Promise<CertifiedPageRead<I, C, G>> {
  if (!Number.isSafeInteger(context.expectedRevision) || context.expectedRevision < 0 || !Number.isSafeInteger(context.limit) || context.limit < 1 || context.limit > 100) throw new Error('invalid certified page read');
  const read = { ...context };
  if (ownership.closed.aborted) return { kind: 'unresolved', reason: 'ownership' };
  try {
    ownership.assertOwned();
    const candidates = await store.pendingGrants(read.accountId, read.characterId, { limit: read.limit });
    if (ownership.closed.aborted) return { kind: 'unresolved', reason: 'ownership' };
    if (candidates.length > read.limit || new Set(candidates.map(grant => grant.id)).size !== candidates.length) throw new Error('invalid journal candidates');
    const candidateIds = Object.freeze(candidates.map(grant => grant.id));
    const recovery = await store.loadForRecovery(read.accountId, read.characterId, candidateIds);
    if (ownership.closed.aborted) return { kind: 'unresolved', reason: 'ownership' };
    ownership.assertOwned();
    if (recovery.character.revision !== read.expectedRevision) return { kind: 'recovery', recovery };
    if (recovery.grants.length !== candidates.length || recovery.grants.some(grant => !candidateIds.includes(grant.id))) throw new Error('incomplete receipt certification');
    return { kind: 'page', revision: recovery.character.revision, grants: recovery.grants.filter(grant => grant.appliedRevision === null), more: candidateIds.length === read.limit };
  } catch { return { kind: 'unresolved', reason: ownership.closed.aborted ? 'ownership' : 'storage' }; }
}

export type AreaPageDelivery =
  | { kind: 'applied'; more: boolean; results: readonly GrantApplyResult[] }
  | { kind: 'capacity' | 'stale' }
  | { kind: 'recovery'; recovery: Recovery<IdentityJson, CheckpointJson, GrantJson> }
  | { kind: 'unresolved'; reason: 'ownership' | 'storage' };

/** External-mode adapter. Caller owns the whole-Area barrier and lifecycle lease throughout this IO. */
export async function deliverCertifiedAreaPage(input: {
  area: Area;
  ref: EntityRef;
  accountId: string; characterId: string; expectedRevision: number;
  store: PendingGrantStore<IdentityJson, CheckpointJson, GrantJson>;
  codec: CoreCharacterCodec;
  ownership: HostOwnership;
  boundary<T>(run: () => T): Promise<T>;
  isCurrent(): boolean;
}): Promise<AreaPageDelivery> {
  const { area, ownership, boundary, codec, store, isCurrent, accountId, characterId, expectedRevision } = input, ref = { ...input.ref };
  if (ownership.closed.aborted) return { kind: 'unresolved', reason: 'ownership' };
  const prepared = await boundary(() => {
    ownership.assertOwned();
    if (!isCurrent()) return null;
    const limit = Math.min(100, 256 - area.appliedGrantIds(characterId).length);
    if (limit < 0) throw new Error('checkpoint receipt capacity');
    if (!limit) return { limit, token: null };
    area.bindDurableLedger(ref, expectedRevision);
    return { limit, token: area.beginGrantRead(ref, expectedRevision) };
  });
  if (!prepared) return { kind: 'stale' };
  if (!prepared.token) return { kind: 'capacity' };
  const token = prepared.token;
  try {
    const result = await readCertifiedGrantPage(store, ownership, { accountId, characterId, expectedRevision, limit: prepared.limit });
    return await boundary(() => {
      if (ownership.closed.aborted) { area.cancelGrantRead(token); return { kind: 'unresolved' as const, reason: 'ownership' as const }; }
      ownership.assertOwned();
      if (!isCurrent()) { area.cancelGrantRead(token); return { kind: 'stale' as const }; }
      if (result.kind !== 'page') { area.cancelGrantRead(token); return result; }
      const results = area.applyCertifiedGrants(token, { revision: result.revision, grants: result.grants.map(grant => codec.grantFromJson(grant.payload)) });
      return { kind: 'applied' as const, more: result.more, results };
    });
  } catch (error) {
    // Matching-token cancellation cannot remove a newer proof; a partially applied prefix is never blindly replayed.
    await boundary(() => area.cancelGrantRead(token));
    throw error;
  }
}

/** Constant-size host proof for retiring one captured source recipe, never a client assertion. */
export function verifyPagedOutcomeSeal(recipe: DeathRecipe, codecVersion: number, seal: VictimSeal | null): PagedOutcomeSeal {
  const captured = validateDeathRecipe(recipe), digest = createHash('sha256').update(canonicalLedgerJson(captured, MAX_RECIPE_BYTES)).digest('hex');
  if (!seal || seal.format !== 'paged-v1' || seal.key !== victimKey(captured.victim) || victimKey(seal.victim) !== seal.key || seal.codecVersion !== codecVersion || seal.recipeDigest !== digest || seal.digestScheme !== 'sha256-chain-v1' || !/^[a-f0-9]{64}$/.test(seal.contentDigest) || seal.recipientCount !== captured.expectedContributors || seal.finalCursor.recipientCount !== captured.expectedContributors || seal.finalCursor.randomDraws !== captured.expectedRandomDraws) throw new Error('source outcome completeness proof mismatch');
  validatePlannerCursor(captured, seal.finalCursor);
  return immutable(seal);
}

export interface RecoverySweep {
  visited: number; appended: number; sealed: number; skippedLive: number;
  cycleComplete: boolean; cycleHasPending: boolean;
  afterSequence: string; throughSequence: string;
}
type RecoveryVisit = { appended: number; sealed: number; pending: boolean; skippedLive?: boolean };
type RecoveryStore = Pick<DurableOutcomeStore, 'getDraftRecoveryHighWater' | 'listVictimDrafts' | 'getVictimDraft' | 'readContributionPage' | 'appendVictimPage' | 'sealVictimDraft' | 'getVictimSeal'>;

/** One page per draft per sweep slice. Recurrence discovers late old-owner commits; this is not a writer fence. */
export class PagedOutcomeRecovery {
  private after = '0';
  private through: string | null = null;
  private cyclePending = false;
  private running = false;
  readonly metrics = { slices: 0, cycles: 0, visited: 0, appended: 0, sealed: 0, skippedLive: 0, maxPage: 0 };
  private readonly store: RecoveryStore;
  private readonly ownership: HostOwnership;
  private readonly limits: { draftsPerSlice: number; pageSize: number; codecVersion: number };
  constructor(store: RecoveryStore, ownership: HostOwnership, limits: { draftsPerSlice: number; pageSize: number; codecVersion: number }) {
    this.store = store; this.ownership = ownership; this.limits = { ...limits };
    if (![limits.draftsPerSlice, limits.pageSize].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 100) || !Number.isSafeInteger(limits.codecVersion) || limits.codecVersion < 1) throw new Error('explicit bounded recovery limits required');
  }
  private async io<T>(run: () => Promise<T>): Promise<T> {
    this.ownership.assertOwned(); if (this.ownership.closed.aborted) throw this.ownership.closed.reason;
    const result = await run();
    this.ownership.assertOwned(); if (this.ownership.closed.aborted) throw this.ownership.closed.reason;
    return result;
  }
  private draft(value: DraftHandle): DraftHandle {
    const recipe = validateDeathRecipe(value.recipe), cursor = validatePlannerCursor(recipe, value.cursor);
    const digest = createHash('sha256').update(canonicalLedgerJson(recipe, MAX_RECIPE_BYTES)).digest('hex');
    if (digest !== value.recipeDigest || victimKey(recipe.victim) !== victimKey(value.victim) || value.contributorCount !== recipe.expectedContributors || cursor.recipientCount > value.contributorCount || cursor.randomDraws > recipe.expectedRandomDraws) throw new Error('recovery draft identity or reservation mismatch');
    return value;
  }
  private seal(draft: DraftHandle, seal: VictimSeal | null): PagedOutcomeSeal {
    const verified = verifyPagedOutcomeSeal(draft.recipe, this.limits.codecVersion, seal);
    if (verified.contentDigest !== draft.contentChain || !isDeepStrictEqual(verified.finalCursor, draft.cursor)) throw new Error('recovery completeness seal mismatch');
    return verified;
  }
  private async visit(draftId: string, isLiveArea?: (areaId: string) => boolean): Promise<RecoveryVisit> {
    let draft = this.draft(await this.io(() => this.store.getVictimDraft(draftId))), appended = 0;
    const live = () => isLiveArea?.(draft.victim.area) ?? false;
    const skipped = (): RecoveryVisit => ({ appended, sealed: 0, pending: false, skippedLive: true });
    if (live()) return skipped();
    if (draft.cursor.recipientCount < draft.contributorCount) {
      const read = await this.io(() => this.store.readContributionPage(draftId, draft.cursor.afterCharacter, this.limits.pageSize));
      if (live()) return skipped();
      if (!read.credits.length || read.credits.length > this.limits.pageSize) throw new Error('recovery contribution page made no bounded progress');
      const planned = planOutcomePage(draft.recipe, draft.cursor, read.credits.map(write => write.credit));
      this.metrics.maxPage = Math.max(this.metrics.maxPage, planned.grants.length);
      try { draft = this.draft(await this.io(() => this.store.appendVictimPage(draftId, planned))); }
      catch (error) {
        if (this.ownership.closed.aborted) throw error;
        const recovered = this.draft(await this.io(() => this.store.getVictimDraft(draftId)));
        if (recovered.recipeDigest !== draft.recipeDigest || recovered.cursor.pageSequence < planned.nextCursor.pageSequence || recovered.cursor.recipientCount < planned.nextCursor.recipientCount) throw error;
        draft = recovered;
      }
      appended = 1;
    }
    if (live()) return skipped();
    if (draft.cursor.recipientCount < draft.contributorCount) return { appended, sealed: 0, pending: true };
    let seal: PagedOutcomeSeal;
    try { seal = await this.io(() => this.store.sealVictimDraft(draftId)); }
    catch (error) {
      if (this.ownership.closed.aborted) throw error;
      const recovered = await this.io(() => this.store.getVictimSeal(draft.victim));
      if (!recovered) throw error;
      seal = this.seal(draft, recovered);
    }
    if (live()) throw new Error('recovery Area ownership changed during seal');
    this.seal(draft, seal);
    return { appended, sealed: 1, pending: false };
  }
  async sweep(options: { isLiveArea?(areaId: string): boolean } = {}): Promise<RecoverySweep> {
    if (this.running) throw new Error('recovery slice already running');
    this.running = true;
    try {
      if (this.through === null) this.through = await this.io(() => this.store.getDraftRecoveryHighWater());
      const through = this.through, rows = await this.io(() => this.store.listVictimDrafts({ afterSequence: this.after, throughSequence: through, limit: this.limits.draftsPerSlice }));
      if (rows.length > this.limits.draftsPerSlice) throw new Error('recovery scan capacity');
      let appended = 0, sealed = 0, skippedLive = 0;
      for (const row of rows) {
        if (options.isLiveArea?.(row.victim.area)) { this.after = row.recoverySequence; skippedLive++; continue; }
        let result: RecoveryVisit;
        try { result = await this.visit(row.draftId, options.isLiveArea); }
        catch (error) {
          if (this.ownership.closed.aborted || !(error instanceof DurableLedgerError) || !['closed', 'not_found'].includes(error.code)) throw error;
          const completed = await this.io(() => this.store.getVictimSeal(row.victim));
          if (!completed || completed.format !== 'paged-v1' || completed.key !== victimKey(row.victim) || completed.codecVersion !== this.limits.codecVersion || completed.recipientCount !== row.contributorCount || completed.finalCursor.recipientCount !== completed.recipientCount) throw error;
          result = { appended: 0, sealed: 1, pending: false }; // Another valid finisher may seal/clean after our scan.
        }
        appended += result.appended; sealed += result.sealed; this.cyclePending ||= result.pending; if (result.skippedLive) skippedLive++;
        this.after = row.recoverySequence; // An unfinished large draft cannot monopolize its cycle.
      }
      const cycleComplete = rows.length < this.limits.draftsPerSlice || this.after === through;
      const result = { visited: rows.length, appended, sealed, skippedLive, cycleComplete, cycleHasPending: this.cyclePending, afterSequence: this.after, throughSequence: through };
      this.metrics.slices++; this.metrics.visited += rows.length; this.metrics.appended += appended; this.metrics.sealed += sealed; this.metrics.skippedLive += skippedLive;
      if (cycleComplete) { this.metrics.cycles++; this.after = '0'; this.through = null; this.cyclePending = false; }
      return result;
    } finally { this.running = false; }
  }
}

export interface SourceDrainProgress { credits: number; pages: number; retired: number; summaries: number; more: boolean }
type SourceStore = Pick<DurableOutcomeStore, 'recordContributionBatch' | 'readContributionSummary' | 'beginVictimDraft' | 'readContributionPage' | 'appendVictimPage' | 'sealVictimDraft' | 'getVictimSeal'>;
/** Explicit source IO phase, including zero-resident and failed-source drain. It never advances simulation. */
export class AreaSourceDrain {
  private running = false;
  private nextOutcome = 0;
  private readonly limits: { pageSize: number; creditBatchesPerSlice: number; outcomesPerSlice: number; summaryVictimsPerSlice: number; writeAttempts: number; codecVersion: number };
  constructor(privateArea: Area, privateStore: SourceStore, privateOwnership: HostOwnership,
    limits: { pageSize: number; creditBatchesPerSlice: number; outcomesPerSlice: number; summaryVictimsPerSlice: number; writeAttempts: number; codecVersion: number },
    privateBoundary: <T>(run: () => T) => Promise<T>, privateCurrent: () => boolean) {
    const keys = ['pageSize', 'creditBatchesPerSlice', 'outcomesPerSlice', 'summaryVictimsPerSlice', 'writeAttempts', 'codecVersion'] as const;
    if (!limits || Object.keys(limits).length !== keys.length || !keys.every(key => Number.isSafeInteger(limits[key]) && limits[key] >= 1) || keys.filter(key => key !== 'codecVersion').some(key => limits[key] > 100)) throw new Error('explicit bounded source drain limits required');
    this.area = privateArea; this.store = privateStore; this.ownership = privateOwnership; this.boundary = privateBoundary; this.isCurrent = privateCurrent; this.limits = { ...limits };
  }
  private readonly area: Area;
  private readonly store: SourceStore;
  private readonly ownership: HostOwnership;
  private readonly boundary: <T>(run: () => T) => Promise<T>;
  private readonly isCurrent: () => boolean;
  private check() { this.ownership.assertOwned(); if (this.ownership.closed.aborted || !this.isCurrent()) throw new Error('source drain owner changed'); }
  private async at<T>(run: () => T): Promise<T> { return this.boundary(() => { this.check(); return run(); }); }
  private async io<T>(run: () => Promise<T>): Promise<T> { this.check(); const value = await run(); this.check(); return value; }
  private async write<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try { return await this.io(run); }
      catch (error) { if (attempt >= this.limits.writeAttempts || this.ownership.closed.aborted || !this.isCurrent()) throw error; }
    }
  }
  async drain(options: { refreshSummaries: boolean }): Promise<SourceDrainProgress> {
    if (this.running) throw new Error('source drain already running');
    this.running = true;
    try {
      const result = { credits: 0, pages: 0, retired: 0, summaries: 0, more: false };
      for (let index = 0; index < this.limits.creditBatchesPerSlice; index++) {
        const batch = await this.at(() => this.area.captureDirtyCredits(this.limits.pageSize));
        if (!batch) break;
        await this.write(() => this.store.recordContributionBatch(batch.writes));
        await this.at(() => { if (this.area.markCreditsDurable(batch.token) !== 'acknowledged') throw new Error('source credit capture changed'); });
        result.credits += batch.writes.length;
      }
      if ((await this.at(() => this.area.resourceUsage())).dirtyCreditEntries) return { ...result, more: true };
      const captures = await this.at(() => this.area.pendingDeathRecipes(100));
      const count = Math.min(captures.length, this.limits.outcomesPerSlice);
      for (let index = 0; index < count; index++) {
        const capture = captures[(this.nextOutcome + index) % captures.length];
        let sealed = await this.io(() => this.store.getVictimSeal(capture.victim));
        if (!sealed) {
          const fence = await this.io(() => this.store.readContributionSummary(capture.victim, capture.recipe.overrides.map(credit => credit.character)));
          const draft = await this.write(() => this.store.beginVictimDraft({ recipe: capture.recipe, initialCursor: capture.initialCursor, fence }));
          const current = await this.at(() => this.area.stagedOutcomeResult(capture));
          if (current.cursor.recipientCount < capture.recipe.expectedContributors) {
            const read = await this.io(() => this.store.readContributionPage(draft.draftId, current.cursor.afterCharacter, this.limits.pageSize));
            if (!read.credits.length || read.credits.length > this.limits.pageSize) throw new Error('source outcome page made no bounded progress');
            const credits = read.credits.map(write => write.credit), planned = await this.at(() => this.area.planStagedOutcomePage(capture, credits));
            // Exact immutable append retry proves this page even if the first COMMIT response was lost.
            await this.write(() => this.store.appendVictimPage(draft.draftId, planned));
            await this.at(() => this.area.acceptStagedOutcomePage(capture, planned, credits));
            result.pages++;
          }
          const progress = await this.at(() => this.area.stagedOutcomeResult(capture));
          if (progress.cursor.recipientCount === capture.recipe.expectedContributors) {
            try { sealed = await this.write(() => this.store.sealVictimDraft(draft.draftId)); }
            catch (error) { if (this.ownership.closed.aborted) throw error; sealed = await this.io(() => this.store.getVictimSeal(capture.victim)); if (!sealed) throw error; }
          }
        }
        if (sealed) {
          const proof = verifyPagedOutcomeSeal(capture.recipe, this.limits.codecVersion, sealed);
          await this.at(() => this.area.retireJournaledOutcome(capture, proof)); result.retired++;
        }
      }
      if (captures.length) this.nextOutcome = (this.nextOutcome + count) % captures.length;
      const usage = await this.at(() => this.area.resourceUsage());
      if (usage.dirtyCreditEntries || usage.pendingDeaths) return { ...result, more: true };
      if (options.refreshSummaries) {
        const read = await this.at(() => this.area.beginContributionSummaryRead(this.limits.summaryVictimsPerSlice));
        if (read) {
          try {
            const summaries: Awaited<ReturnType<DurableOutcomeStore['readContributionSummary']>>[] = [];
            for (const victim of read.victims) summaries.push(await this.io(() => this.store.readContributionSummary(victim, read.residents.map(resident => resident.character))));
            await this.at(() => this.area.installContributionSummaries(read, summaries)); result.summaries += summaries.length;
          } catch (error) { await this.boundary(() => this.area.cancelContributionSummaryRead(read)); throw error; }
        }
        result.more = (await this.at(() => this.area.contributionSummariesNeeded())).length > 0;
      }
      return result;
    } finally { this.running = false; }
  }
}
