import type { Character, EarnedGrant, Json } from './character-store.ts';
import type { HostOwnership } from './ownership.ts';
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
  readonly metrics = { captures: 0, saved: 0, recoveries: 0, retries: 0, failed: 0, commitMs: 0 };
  constructor(store: CheckpointStore<I, C, G>, ownership: HostOwnership,
    options: { maxQueuedPerCharacter: number; maxAttempts: number; retryMs: number; now: () => number }) {
    if (!Number.isSafeInteger(options.maxQueuedPerCharacter) || options.maxQueuedPerCharacter < 1 || options.maxQueuedPerCharacter > 256 ||
      !Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 100 || !Number.isFinite(options.retryMs) || options.retryMs < 0) throw new Error('invalid persistence limits');
    this.store = store; this.ownership = ownership; this.options = options;
  }
  commit(input: PlayerCommit<C>): Promise<CommitResult<I, C, G>> {
    if (this.stopped || this.ownership.closed.aborted) return Promise.resolve({ kind: 'unresolved', captureId: input.captureId, reason: 'ownership' });
    if (!input.captureId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.appliedGrantIds.length > 256 || new Set(input.appliedGrantIds).size !== input.appliedGrantIds.length) throw new Error('invalid checkpoint capture');
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
