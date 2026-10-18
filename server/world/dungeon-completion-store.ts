import { createHash } from 'node:crypto';
import type pg from 'pg';
import { canonicalLedgerJson, CharacterStoreError } from './character-store.ts';
import { dungeonFor } from '../../src/sim/data/dungeons.ts';
import { dungeonAwardId, validateDungeonFeatureAward, MAX_FEATURE_AWARD_PAGE, type DungeonFeatureAward } from '../../src/sim/features/dungeon-awards.ts';
import type { CertifiedFeatureAwardPage, DungeonCompletionCandidate, EntityRef } from '../../src/sim/types.ts';

/** Policy A: the clear-time run roster. Area capacity is 8, so one manifest never needs paging. */
export const MAX_DUNGEON_RECIPIENTS = 8;
export interface DungeonRecipient { readonly characterId: string; readonly accountId: string }
/** One immutable clear of one run. Recipients are frozen at the completion boundary, dead residents included. */
export interface DungeonCompletionManifest {
  readonly kind: 'dungeon-clear-v1';
  readonly candidate: DungeonCompletionCandidate;
  readonly recipients: readonly DungeonRecipient[];
}
export interface DungeonCompletionSeal {
  readonly area: string; readonly runId: string; readonly tier: number;
  readonly digest: string; readonly awardIds: readonly string[]; readonly created: boolean;
}
export type DungeonAwardRead =
  | { readonly kind: 'page'; readonly page: CertifiedFeatureAwardPage; readonly more: boolean }
  | { readonly kind: 'revision'; readonly revision: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHARACTER = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ACCOUNT = /^g[a-f0-9]{23}$/;
function fail(code: CharacterStoreError['code'], message: string): never { throw new CharacterStoreError(code, message); }
function plain(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid', `invalid ${what}`);
  const own = Object.getOwnPropertyNames(value);
  if (Object.getOwnPropertySymbols(value).length || own.length !== keys.length || keys.some(k => !own.includes(k))) fail('invalid', `invalid ${what} fields`);
  for (const k of keys) { const d = Object.getOwnPropertyDescriptor(value, k)!; if (!('value' in d) || !d.enumerable) fail('invalid', `invalid ${what} descriptor`); }
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length) fail('invalid', `invalid ${what}`);
  return [...value];
}
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const areaText = (s: unknown): s is string => typeof s === 'string' && Buffer.byteLength(s) >= 1 && Buffer.byteLength(s) <= 256 && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(s);

/** Strict copy with recipients in canonical character order. Amounts are the captured candidate values. */
export function validateDungeonCompletionManifest(input: unknown): DungeonCompletionManifest {
  const m = plain(input, ['kind', 'candidate', 'recipients'], 'dungeon manifest');
  if (m.kind !== 'dungeon-clear-v1') fail('invalid', 'unsupported dungeon manifest');
  const c = plain(m.candidate, ['run', 'tier', 'completedTick', 'finalWave', 'baseXp', 'coins'], 'dungeon candidate');
  const run = plain(c.run, ['area', 'runId'], 'dungeon run');
  if (!areaText(run.area) || typeof run.runId !== 'string' || !UUID.test(run.runId)) fail('invalid', 'dungeon run requires an area and a lowercase host run UUID');
  if (typeof c.tier !== 'number' || !dungeonFor(c.tier) || !count(c.completedTick) || !count(c.baseXp) || !count(c.coins)) fail('invalid', 'invalid dungeon tier, tick or amount');
  const finalWave = list(c.finalWave, 3, 'dungeon final wave').map(raw => {
    const ref = plain(raw, ['area', 'id', 'life'], 'final wave ref');
    if (ref.area !== run.area || !count(ref.id) || !count(ref.life) || (ref.life as number) < 1) fail('invalid', 'final wave refs must belong to the run Area');
    return { area: ref.area as string, id: ref.id as number, life: ref.life as number } satisfies EntityRef;
  });
  if (finalWave.length !== 3) fail('invalid', 'a dungeon clear has exactly three final wave actors');
  const recipients = list(m.recipients, MAX_DUNGEON_RECIPIENTS, 'dungeon recipients').map(raw => {
    const r = plain(raw, ['characterId', 'accountId'], 'dungeon recipient');
    if (typeof r.characterId !== 'string' || !CHARACTER.test(r.characterId) || typeof r.accountId !== 'string' || !ACCOUNT.test(r.accountId)) fail('invalid', 'invalid dungeon recipient');
    return { characterId: r.characterId, accountId: r.accountId };
  }).sort((a, b) => a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0);
  if (new Set(recipients.map(r => r.characterId)).size !== recipients.length) fail('invalid', 'duplicate dungeon recipient');
  return {
    kind: 'dungeon-clear-v1',
    candidate: { run: { area: run.area, runId: run.runId }, tier: c.tier as DungeonCompletionCandidate['tier'], completedTick: c.completedTick as number, finalWave, baseXp: c.baseXp as number, coins: c.coins as number },
    recipients,
  };
}
/** The per-recipient journal rows a manifest implies; the SQL trigger checks the same projection. */
export function dungeonAwardsFor(manifest: DungeonCompletionManifest): DungeonFeatureAward[] {
  const { run, tier, baseXp, coins } = manifest.candidate;
  return manifest.recipients.map(r => validateDungeonFeatureAward({ schema: 'dungeon-award-v1', id: dungeonAwardId(run, r.characterId), run: { area: run.area, runId: run.runId }, tier, recipient: r.characterId, baseXp, coins }, r.characterId));
}
const lockKey = (area: string, runId: string) => createHash('sha256').update('world-dungeon-completion:' + JSON.stringify([area, runId])).digest().readBigInt64BE().toString();
function awardId(value: unknown) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > 2048) fail('invalid', 'invalid dungeon award ID');
}
export function validateDungeonAwardIds(ids: readonly string[]): void {
  if (!Array.isArray(ids) || ids.length > 256 || new Set(ids).size !== ids.length) fail('invalid', 'expected at most 256 distinct dungeon award IDs');
  ids.forEach(awardId);
}
interface AwardRow { award_id: string; character_id: string; account_id: string; payload_json: string }
function decodeAward(row: AwardRow, accountId: string, characterId: string): DungeonFeatureAward {
  if (row.account_id !== accountId || row.character_id !== characterId) fail('invalid', 'corrupt dungeon award recipient');
  let payload: unknown;
  try { payload = JSON.parse(row.payload_json); } catch { fail('invalid', 'corrupt dungeon award payload'); }
  let award: DungeonFeatureAward;
  try { award = validateDungeonFeatureAward(payload, characterId); } catch { fail('invalid', 'corrupt dungeon award payload'); }
  if (award.id !== row.award_id) fail('invalid', 'corrupt dungeon award identity');
  return award;
}

/** Trusted host storage for typed dungeon clears. Separate from victim grants and the 007 paged ledger. */
export class DungeonCompletionStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }
  /** Whole manifest and all its awards commit together. Same content repeats are idempotent; any change rejects. */
  async recordDungeonCompletion(input: DungeonCompletionManifest): Promise<DungeonCompletionSeal> {
    const manifest = validateDungeonCompletionManifest(input), awards = dungeonAwardsFor(manifest);
    const { run, tier } = manifest.candidate, text = canonicalLedgerJson(manifest, 32768);
    const seal = (created: boolean): DungeonCompletionSeal => Object.freeze({ area: run.area, runId: run.runId, tier, digest: createHash('sha256').update(text).digest('hex'), awardIds: Object.freeze(awards.map(a => a.id)), created });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey(run.area, run.runId)]);
      const existing = (await client.query<{ same: boolean }>('SELECT manifest_json::jsonb = $3::jsonb AS same FROM world_dungeon_completions WHERE area_id=$1 AND run_id=$2::uuid', [run.area, run.runId, text])).rows[0];
      if (existing) {
        if (!existing.same) fail('outcome_conflict', 'dungeon run already sealed with different contents');
        await client.query('COMMIT'); return seal(false);
      }
      for (const r of manifest.recipients) {
        if (!(await client.query('SELECT 1 FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR SHARE', [r.characterId, r.accountId])).rowCount) fail('not_found', 'dungeon recipient not found');
      }
      await client.query('INSERT INTO world_dungeon_completions(area_id,run_id,manifest_json,recipient_count) VALUES($1,$2::uuid,$3,$4)', [run.area, run.runId, text, manifest.recipients.length]);
      for (const [i, award] of awards.entries()) {
        await client.query('INSERT INTO world_dungeon_awards(award_id,area_id,run_id,character_id,account_id,payload_json) VALUES($1,$2,$3::uuid,$4,$5,$6)',
          [award.id, run.area, run.runId, award.recipient, manifest.recipients[i].accountId, canonicalLedgerJson(award, 8192)]);
      }
      await client.query('COMMIT'); return seal(true);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  /**
   * Revision-consistent unpaid page. The character row share lock excludes saveCheckpoint, the only receipt writer,
   * so the revision and the receipt set describe the same durable state.
   */
  async readPendingDungeonAwards(accountId: string, characterId: string, expectedRevision: number, limit: number): Promise<DungeonAwardRead> {
    if (!ACCOUNT.test(accountId) || !CHARACTER.test(characterId)) fail('invalid', 'invalid dungeon award reader');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_FEATURE_AWARD_PAGE) fail('invalid', 'invalid dungeon award page request');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = (await client.query<{ revision: string }>('SELECT revision FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR SHARE', [characterId, accountId])).rows[0];
      if (!owned) fail('not_found', 'character not found');
      const revision = Number(owned.revision);
      if (!Number.isSafeInteger(revision) || revision < 0) fail('invalid', 'corrupt stored revision');
      if (revision !== expectedRevision) { await client.query('COMMIT'); return Object.freeze({ kind: 'revision', revision }); }
      const rows = (await client.query<AwardRow>(`SELECT a.award_id,a.character_id,a.account_id,a.payload_json FROM world_dungeon_awards a
        WHERE a.character_id=$1 AND a.account_id=$2 AND NOT EXISTS(SELECT 1 FROM world_dungeon_award_receipts r WHERE r.award_id=a.award_id)
        ORDER BY a.journal_sequence LIMIT $3`, [characterId, accountId, limit])).rows;
      await client.query('COMMIT');
      const awards = rows.map(row => ({ award: decodeAward(row, accountId, characterId), appliedRevision: null }));
      return Object.freeze({ kind: 'page', page: Object.freeze({ revision, awards: Object.freeze(awards) }), more: rows.length === limit });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
