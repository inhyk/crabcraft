import { createHash } from 'node:crypto';
import { canonicalLedgerJson } from './character-store.ts';
import type { HostOwnership } from './ownership.ts';
import { dungeonAwardsFor, validateDungeonCompletionManifest, MAX_DUNGEON_RECIPIENTS, type DungeonCompletionManifest, type DungeonCompletionSeal, type DungeonCompletionStore, type DungeonAwardRead } from './dungeon-completion-store.ts';
import { MAX_FEATURE_AWARD_PAGE } from '../../src/sim/features/dungeon-awards.ts';
import { validateDungeonReturn } from '../../src/sim/features/dungeon-persistence.ts';
import { dungeonFor, type DungeonTier } from '../../src/sim/data/dungeons.ts';
import type { Area, DungeonReturnBinding, DungeonRunKey, EntityRef, FeatureAwardApplyResult, SimUnit, WorldId, WorldQuery } from '../../src/sim/types.ts';

/** Ordered commands from the authenticated current character. Runs are named by their host run UUID. */
export type DungeonCommand =
  | { readonly kind: 'dungeonStart'; readonly tier: DungeonTier }
  | { readonly kind: 'dungeonJoin' | 'dungeonReturn'; readonly run: string };
export type DungeonCommandResult =
  | { readonly ok: true; readonly run: DungeonRunKey; readonly tier: DungeonTier }
  | { readonly ok: false; readonly code: string };
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Strict owned copy; no owner IDs, flags or amounts are accepted from the requester. */
export function validateDungeonCommand(value: unknown): DungeonCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid dungeon command');
  const c = value as Record<string, unknown>, keys = Object.keys(c).sort().join();
  if (c.kind === 'dungeonStart' && keys === 'kind,tier' && typeof c.tier === 'number' && dungeonFor(c.tier)) return { kind: 'dungeonStart', tier: c.tier as DungeonTier };
  if ((c.kind === 'dungeonJoin' || c.kind === 'dungeonReturn') && keys === 'kind,run' && typeof c.run === 'string' && RUN_ID.test(c.run)) return { kind: c.kind, run: c.run };
  throw new Error('invalid dungeon command');
}
export const dungeonWorld = (tier: DungeonTier): WorldId => `w${dungeonFor(tier)!.chapter}` as WorldId;
/**
 * Grounded, collision-stable public origin for an entrant, checked with the same parent-world rule the Area binding uses.
 * Throws instead of guessing another location.
 */
export function dungeonReturnFor(world: WorldId, query: WorldQuery, unit: Readonly<SimUnit>): Readonly<DungeonReturnBinding> {
  const out = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; return this; } };
  let x = unit.x, z = unit.z;
  for (let i = 0; i < 4; i++) { query.resolveCollision(x, z, unit.radius, out); const moved = Math.hypot(out.x - x, out.y - z); x = out.x; z = out.y; if (moved <= 1e-9) break; }
  return validateDungeonReturn({ version: 1, world, location: { x, y: query.heightAt(x, z), z, yaw: unit.yaw } }, world, query, unit.radius);
}

/** A character the host still holds in the run Area: connected, in disconnect grace, alive or dead. */
export interface DungeonResident { readonly characterId: string; readonly accountId: string; readonly ref: EntityRef }
export interface FrozenDungeonCompletion { readonly token: string; readonly manifest: DungeonCompletionManifest }

const sameRef = (a: EntityRef, b: EntityRef) => a.area === b.area && a.id === b.id && a.life === b.life;

/**
 * Policy A: freeze the clear-time roster in the same between-tick boundary that first observes the pending clear,
 * before any leave, exit or retirement is processed. Players who already left are not in `residents`.
 * The host keeps the returned manifest and retries it unchanged; it never recomputes the roster later.
 */
export function freezeDungeonCompletion(area: Area, residents: readonly DungeonResident[]): FrozenDungeonCompletion | null {
  const captured = area.pendingDungeonCompletion();
  if (!captured) return null;
  if (residents.length > MAX_DUNGEON_RECIPIENTS) throw new Error('dungeon roster exceeds run capacity');
  const seen = new Set<string>();
  for (const r of residents) {
    if (seen.has(r.characterId)) throw new Error('duplicate dungeon resident');
    seen.add(r.characterId);
    const unit = area.services.getUnit(r.ref), player = unit ? area.services.player(r.ref) : null;
    if (!unit || !sameRef(unit.ref, r.ref) || !player || player.state.character !== r.characterId) throw new Error('dungeon resident is not in the run Area');
  }
  const c = captured.candidate;
  const manifest = validateDungeonCompletionManifest({
    kind: 'dungeon-clear-v1',
    candidate: { run: { area: c.run.area, runId: c.run.runId }, tier: c.tier, completedTick: c.completedTick, finalWave: c.finalWave.map(ref => ({ area: ref.area, id: ref.id, life: ref.life })), baseXp: c.baseXp, coins: c.coins },
    recipients: residents.map(r => ({ characterId: r.characterId, accountId: r.accountId })),
  });
  return Object.freeze({ token: captured.token, manifest });
}

/** Constant-size check that the durable seal is exactly this manifest before the source candidate is acknowledged. */
export function verifyDungeonCompletionSeal(manifest: DungeonCompletionManifest, seal: DungeonCompletionSeal): void {
  const { run, tier } = manifest.candidate, ids = dungeonAwardsFor(manifest).map(a => a.id);
  const digest = createHash('sha256').update(canonicalLedgerJson(manifest, 32768)).digest('hex');
  if (seal.area !== run.area || seal.runId !== run.runId || seal.tier !== tier || seal.digest !== digest ||
    seal.awardIds.length !== ids.length || seal.awardIds.some((id, i) => id !== ids[i])) throw new Error('dungeon completion seal mismatch');
}

export type DungeonSealResult =
  | { readonly kind: 'sealed'; readonly seal: DungeonCompletionSeal }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unresolved'; readonly reason: 'ownership' | 'storage' };

/** Journal the frozen manifest, then ACK the Area candidate. Any failure leaves the candidate pending for retry. */
export async function sealDungeonCompletion(input: {
  area: Area; frozen: FrozenDungeonCompletion; store: Pick<DungeonCompletionStore, 'recordDungeonCompletion'>;
  ownership: HostOwnership; boundary<T>(run: () => T): Promise<T>; isCurrent(): boolean;
}): Promise<DungeonSealResult> {
  const { area, frozen, store, ownership, boundary, isCurrent } = input;
  if (ownership.closed.aborted) return { kind: 'unresolved', reason: 'ownership' };
  let seal: DungeonCompletionSeal;
  try { ownership.assertOwned(); seal = await store.recordDungeonCompletion(frozen.manifest); verifyDungeonCompletionSeal(frozen.manifest, seal); }
  catch { return { kind: 'unresolved', reason: ownership.closed.aborted ? 'ownership' : 'storage' }; }
  return boundary(() => {
    if (ownership.closed.aborted) return { kind: 'unresolved' as const, reason: 'ownership' as const };
    ownership.assertOwned();
    const pending = area.pendingDungeonCompletion();
    if (!isCurrent() || !pending || pending.token !== frozen.token) return { kind: 'stale' as const };
    area.acknowledgeDungeonCompletion(frozen.token);
    return { kind: 'sealed' as const, seal };
  });
}

export type DungeonAwardDelivery =
  | { readonly kind: 'applied'; readonly more: boolean; readonly results: readonly FeatureAwardApplyResult[] }
  | { readonly kind: 'capacity' | 'stale' }
  | { readonly kind: 'revision'; readonly revision: number }
  | { readonly kind: 'unresolved'; readonly reason: 'ownership' | 'storage' };

/**
 * Certified delivery of unpaid clear awards to one owned actor. The caller holds the whole-Area durability barrier
 * and lifecycle lease for the duration, exactly as for deliverCertifiedAreaPage. Paid IDs leave memory only when a
 * checkpoint carrying them is saved with its receipts in one transaction and marked durable.
 */
export async function deliverDungeonAwards(input: {
  area: Area; ref: EntityRef; accountId: string; characterId: string; expectedRevision: number; maxPending: number;
  store: Pick<DungeonCompletionStore, 'readPendingDungeonAwards'>; ownership: HostOwnership;
  boundary<T>(run: () => T): Promise<T>; isCurrent(): boolean;
}): Promise<DungeonAwardDelivery> {
  const { area, ownership, boundary, store, isCurrent, accountId, characterId, expectedRevision } = input, ref = { ...input.ref };
  if (!Number.isSafeInteger(input.maxPending) || input.maxPending < 1 || input.maxPending > 256) throw new Error('invalid dungeon award pending bound');
  if (ownership.closed.aborted) return { kind: 'unresolved', reason: 'ownership' };
  const prepared = await boundary(() => {
    ownership.assertOwned();
    if (!isCurrent()) return null;
    const limit = Math.min(MAX_FEATURE_AWARD_PAGE, input.maxPending - area.appliedFeatureAwardIds(characterId).length);
    if (limit <= 0) return { limit: 0, token: null };
    return { limit, token: area.beginFeatureAwardRead(ref, expectedRevision) };
  });
  if (!prepared) return { kind: 'stale' };
  if (!prepared.token) return { kind: 'capacity' };
  const token = prepared.token;
  let read: DungeonAwardRead;
  try { read = await store.readPendingDungeonAwards(accountId, characterId, expectedRevision, prepared.limit); }
  catch { await boundary(() => area.cancelFeatureAwardRead(token)); return { kind: 'unresolved', reason: ownership.closed.aborted ? 'ownership' : 'storage' }; }
  return boundary(() => {
    if (ownership.closed.aborted) { area.cancelFeatureAwardRead(token); return { kind: 'unresolved' as const, reason: 'ownership' as const }; }
    ownership.assertOwned();
    if (!isCurrent()) { area.cancelFeatureAwardRead(token); return { kind: 'stale' as const }; }
    if (read.kind === 'revision') { area.cancelFeatureAwardRead(token); return read; }
    return { kind: 'applied' as const, more: read.more, results: area.applyCertifiedFeatureAwards(token, read.page) };
  });
}
