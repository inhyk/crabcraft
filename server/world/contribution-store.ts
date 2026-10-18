import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { CoreCharacterCodec, IdentityJson } from '../../src/sim/persistence.ts';
import type { EntityRef } from '../../src/sim/types.ts';
import { initialPlannerCursor, validateCreditWrite, validateDeathRecipe, validatePlannerCursor, verifyDeathRecipeSummary, victimKey,
  type CreditWrite, type DeathRecipe, type PlannerCursor, type PlannedPage, type PagedOutcomeSeal } from '../../src/sim/ledger.ts';
import { canonicalLedgerJson as json, victimAdvisoryLock } from './character-store.ts';

export const MAX_LEDGER_PAGE = 100;
export const MAX_CREDIT_BYTES = 4096;
export const MAX_RECIPE_BYTES = 524288;
export const MAX_CURSOR_BYTES = 4096;
export type OutcomePlanner = (recipe: DeathRecipe, cursor: PlannerCursor, credits: readonly CreditWrite['credit'][]) => PlannedPage;
export type WholeVictimSeal = { format: 'whole-v1'; key: string; victim: EntityRef; codecVersion: number; recipientCount: number; digestScheme: 'sha256-flat-v1'; contentDigest: string };
export type VictimSeal = PagedOutcomeSeal | WholeVictimSeal;
export interface DraftHandle { draftId: string; victim: EntityRef; recipe: DeathRecipe; recipeDigest: string; cursor: PlannerCursor; contributorCount: number; sourceVersion: number; recoverySequence: string; contentChain: string }
export interface ContributionFence { sourceVersion: number; throughVersion: number; totalContributors: number; storedEligibleTotal: number }
export interface ContributionSummary extends ContributionFence { victim: EntityRef; state: 'open' | 'frozen'; residents: { character: string; priorCredit: CreditWrite['credit'] | null; eligibleBefore: number }[] }
export interface CreditPage { credits: CreditWrite[]; afterCharacter: string | null; throughCharacter: string | null; end: boolean }
export class DurableLedgerError extends Error {
  readonly code: 'invalid' | 'conflict' | 'closed' | 'not_found' | 'version';
  constructor(code: DurableLedgerError['code'], message: string) { super(message); this.name = 'DurableLedgerError'; this.code = code; }
}
const fail = (code: DurableLedgerError['code'], message: string): never => { throw new DurableLedgerError(code, message); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const character = (value: string) => { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) fail('invalid', 'invalid ledger character'); };
const pageLimit = (value: number) => { if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LEDGER_PAGE) fail('invalid', 'ledger page must be 1..100'); };
const safe = (value: string | number) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) fail('invalid', 'corrupt ledger count'); return n; };
const parse = <T>(value: string, maxBytes: number): T => JSON.parse(json(JSON.parse(value), maxBytes)) as T;
function victim(value: EntityRef) {
  const canonical = victimKey(value); json(value, 512);
  if (!value || typeof value.area !== 'string' || !value.area || !Number.isInteger(value.id) || value.id < 1 || value.id > 0xffffffff || !Number.isInteger(value.life) || value.life < 1 || value.life > 0xffffffff || Buffer.byteLength(canonical) > 512) fail('invalid', 'invalid victim lifetime');
  return canonical;
}
type Query = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<pg.QueryResult<R>>;
interface DraftRow { recovery_sequence: string; draft_id: string; victim_key: string; codec_version: number; recipe_json: string; recipe_digest: string; initial_cursor_json: string; cursor_json: string; total_count: string; source_version: string; planned_count: string; page_sequence: string; after_character: string | null; content_chain: string }
interface SourceRow { state: 'open' | 'frozen'; contributor_count: string; max_version: string; source_revision: string; stored_eligible_count: string }

/** Bounded IO only. The injected planner is the real pure core planner; no SQL reward formulas. */
export class DurableOutcomeStore {
  private readonly pool: pg.Pool;
  private readonly codec: CoreCharacterCodec;
  private readonly planner: OutcomePlanner;
  private readonly timeoutMs: number;
  constructor(pool: pg.Pool, codec: CoreCharacterCodec, options: { planOutcomePage: OutcomePlanner; queryTimeoutMs?: number }) {
    if (!options || typeof options.planOutcomePage !== 'function') fail('invalid', 'pure core planner injection required');
    this.pool = pool; this.codec = codec; this.planner = options.planOutcomePage; this.timeoutMs = options.queryTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2147483647) fail('invalid', 'invalid ledger query timeout');
  }
  private query: Query = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) => {
    const config = { text, values, query_timeout: this.timeoutMs }; return this.pool.query<R>(config);
  };
  private async tx<T>(run: (query: Query) => Promise<T>): Promise<T> {
    const client = await this.pool.connect(); let reusable = true;
    const query: Query = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) => {
      const config = { text, values, query_timeout: this.timeoutMs }; return client.query<R>(config);
    };
    try { await query('BEGIN'); await query("SELECT set_config('statement_timeout',$1,true)", [String(this.timeoutMs)]); const result = await run(query); await query('COMMIT'); return result; }
    catch (e) { try { await query('ROLLBACK'); } catch { reusable = false; } throw e; }
    finally { client.release(!reusable); }
  }
  private async lock(query: Query, key: string) { await query('SELECT pg_advisory_xact_lock($1::bigint)', [victimAdvisoryLock(key)]); }
  private async pagedSeal(key: string, query: Query): Promise<PagedOutcomeSeal | null> {
    const row = (await query<{ codec_version: number; recipient_count: string; recipe_digest: string; content_digest: string; final_cursor_json: string; final_cursor_digest: string; digest_scheme: string }>('SELECT * FROM world_paged_outcome_seals WHERE victim_key=$1', [key])).rows[0];
    if (!row) return null;
    if (row.codec_version !== this.codec.version || row.digest_scheme !== 'sha256-chain-v1') fail('version', 'unsupported paged seal');
    const tuple = JSON.parse(key), finalCursor = parse<PlannerCursor>(row.final_cursor_json, MAX_CURSOR_BYTES);
    if (hash(json(finalCursor, MAX_CURSOR_BYTES)) !== row.final_cursor_digest || finalCursor.recipientCount !== safe(row.recipient_count)) fail('conflict', 'corrupt sealed cursor');
    return { format: 'paged-v1', key, victim: { area: tuple[0], id: tuple[1], life: tuple[2] }, codecVersion: row.codec_version, recipientCount: safe(row.recipient_count), digestScheme: 'sha256-chain-v1', contentDigest: row.content_digest, recipeDigest: row.recipe_digest, finalCursor };
  }
  async getVictimSeal(ref: EntityRef): Promise<VictimSeal | null> {
    const key = victim(ref), paged = await this.pagedSeal(key, this.query); if (paged) return paged;
    const row = (await this.query<{ codec_version: number; recipient_count: string; content_digest: string }>('SELECT * FROM world_victim_outcomes WHERE outcome_key=$1', [key])).rows[0];
    if (!row) return null; if (row.codec_version !== this.codec.version) fail('version', 'unsupported whole seal');
    return { format: 'whole-v1', key, victim: { ...ref }, codecVersion: row.codec_version, recipientCount: safe(row.recipient_count), digestScheme: 'sha256-flat-v1', contentDigest: row.content_digest };
  }
  async recordContributionBatch(batch: readonly CreditWrite[]): Promise<void> {
    if (!Array.isArray(batch)) fail('invalid', 'credit batch required'); pageLimit(batch.length);
    const latest = new Map<string, CreditWrite>();
    for (const raw of Array.from(batch)) {
      const write = validateCreditWrite(parse<CreditWrite>(json(raw, MAX_CREDIT_BYTES + 1024), MAX_CREDIT_BYTES + 1024)); character(write.character); victim(write.victim); json(write.credit, MAX_CREDIT_BYTES);
      const id = JSON.stringify([victimKey(write.victim), write.character]), old = latest.get(id);
      if (old?.version === write.version && json(old.credit, MAX_CREDIT_BYTES) !== json(write.credit, MAX_CREDIT_BYTES)) fail('conflict', 'equal contribution version changed');
      if (!old || old.version < write.version) latest.set(id, write);
    }
    const writes = [...latest.values()], keys = [...new Set(writes.map(w => victimKey(w.victim)))].sort();
    await this.tx(async query => {
      for (const key of keys) {
        await this.lock(query, key);
        if ((await query('SELECT 1 FROM world_paged_outcome_seals WHERE victim_key=$1 UNION ALL SELECT 1 FROM world_victim_outcomes WHERE outcome_key=$1 LIMIT 1', [key])).rowCount) fail('closed', 'victim already sealed');
        const ref = writes.find(w => victimKey(w.victim) === key)!.victim;
        await query('INSERT INTO world_contribution_sources(victim_key,victim_json) VALUES($1,$2) ON CONFLICT DO NOTHING', [key, json(ref, 512)]);
      }
      for (const id of [...new Set(writes.map(w => w.character))].sort()) if (!(await query('SELECT 1 FROM world_characters WHERE character_id=$1 FOR KEY SHARE', [id])).rowCount) fail('not_found', 'contribution character missing');
      for (const write of writes) {
        const key = victimKey(write.victim), source = (await query<SourceRow>('SELECT * FROM world_contribution_sources WHERE victim_key=$1', [key])).rows[0];
        const row = (await query<{ credit_version: string; credit_json: string }>('SELECT credit_version,credit_json FROM world_contributions WHERE victim_key=$1 AND character_id=$2', [key, write.character])).rows[0];
        const credit = json(write.credit, MAX_CREDIT_BYTES), oldVersion = row ? safe(row.credit_version) : -1;
        if (oldVersion === write.version) { if (json(parse(row.credit_json, MAX_CREDIT_BYTES), MAX_CREDIT_BYTES) !== credit) fail('conflict', 'equal contribution version changed'); continue; }
        if (oldVersion > write.version) continue;
        if (source.state !== 'open') fail('closed', 'victim contributions are frozen');
        if (row) await query('UPDATE world_contributions SET credit_version=$3,credit_json=$4 WHERE victim_key=$1 AND character_id=$2', [key, write.character, write.version, credit]);
        else await query('INSERT INTO world_contributions(victim_key,character_id,credit_version,credit_json) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [key, write.character, write.version, credit]);
        const priorEligible = row ? parse<CreditWrite['credit']>(row.credit_json, MAX_CREDIT_BYTES).cogEligible : false;
        await query('UPDATE world_contribution_sources SET contributor_count=contributor_count+$2,max_version=GREATEST(max_version,$3),source_revision=source_revision+1,stored_eligible_count=stored_eligible_count+$4 WHERE victim_key=$1', [key, row ? 0 : 1, write.version, Number(write.credit.cogEligible) - Number(priorEligible)]);
      }
    });
  }
  async readContributionSummary(ref: EntityRef, residentIds: readonly string[]): Promise<ContributionSummary> {
    const key = victim(ref);
    if (!Array.isArray(residentIds) || residentIds.length > MAX_LEDGER_PAGE || new Set(residentIds).size !== residentIds.length) fail('invalid', 'at most 100 distinct resident IDs required');
    Array.from(residentIds).forEach(character);
    return this.tx(async query => {
      await this.lock(query, key);
      if (await this.pagedSeal(key, query) || (await query('SELECT 1 FROM world_victim_outcomes WHERE outcome_key=$1', [key])).rowCount) fail('closed', 'victim already sealed');
      return this.summary(query,ref,residentIds);
    });
  }
  private async summary(query: Query, ref: EntityRef, residentIds: readonly string[]): Promise<ContributionSummary> {
      const key = victimKey(ref);
      const source = (await query<SourceRow>('SELECT * FROM world_contribution_sources WHERE victim_key=$1', [key])).rows[0];
      const residents: ContributionSummary['residents'] = [];
      for (const id of [...residentIds].sort()) {
        if (!source) { residents.push({ character: id, priorCredit: null, eligibleBefore: 0 }); continue; }
        const prior = (await query<{ credit_json: string }>('SELECT credit_json FROM world_contributions WHERE victim_key=$1 AND character_id=$2', [key, id])).rows[0];
        const before = (await query<{ count: string }>(`SELECT count(*) FROM world_contributions WHERE victim_key=$1
          AND (credit_json::jsonb->'cogEligible')='true'::jsonb AND (character_id::text) COLLATE "C" < $2 COLLATE "C"`, [key, id])).rows[0].count;
        residents.push({ character: id, priorCredit: prior ? parse(prior.credit_json, MAX_CREDIT_BYTES) : null, eligibleBefore: safe(before) });
      }
      return { victim: { ...ref }, state: source?.state ?? 'open', sourceVersion: source ? safe(source.source_revision) : 0, throughVersion: source ? safe(source.max_version) : 0,
        totalContributors: source ? safe(source.contributor_count) : 0, storedEligibleTotal: source ? safe(source.stored_eligible_count) : 0, residents };
  }
  private async decodeDraft(row: DraftRow, query: Query): Promise<DraftHandle> {
    if (row.codec_version !== this.codec.version) fail('version', 'unsupported draft codec');
    const recipe = validateDeathRecipe(parse<DeathRecipe>(row.recipe_json, MAX_RECIPE_BYTES)), cursor = validatePlannerCursor(recipe, parse<PlannerCursor>(row.cursor_json, MAX_CURSOR_BYTES));
    if (hash(json(recipe, MAX_RECIPE_BYTES)) !== row.recipe_digest || victimKey(recipe.victim) !== row.victim_key || cursor.pageSequence !== safe(row.page_sequence) || cursor.recipientCount !== safe(row.planned_count) || cursor.afterCharacter !== row.after_character) fail('conflict', 'corrupt draft progress');
    if (cursor.pageSequence === 0) { if (row.cursor_json !== row.initial_cursor_json) fail('conflict', 'corrupt initial cursor'); }
    else {
      const proof = (await query<{ cursor_digest: string; content_chain: string; planned_count: string }>('SELECT cursor_digest,content_chain,planned_count FROM world_victim_pages WHERE draft_id=$1 AND page_sequence=$2', [row.draft_id, row.page_sequence])).rows[0];
      if (!proof || proof.cursor_digest !== hash(json(cursor, MAX_CURSOR_BYTES)) || proof.content_chain !== row.content_chain || proof.planned_count !== row.planned_count) fail('conflict', 'corrupt cursor proof');
    }
    return { draftId: row.draft_id, victim: recipe.victim, recipe, recipeDigest: row.recipe_digest, cursor, contributorCount: safe(row.total_count), sourceVersion: safe(row.source_version), recoverySequence: row.recovery_sequence, contentChain: row.content_chain };
  }
  async beginVictimDraft(input: { recipe: DeathRecipe; initialCursor?: PlannerCursor; fence: ContributionFence }): Promise<DraftHandle> {
    const recipe = validateDeathRecipe(parse<DeathRecipe>(json(input.recipe, MAX_RECIPE_BYTES), MAX_RECIPE_BYTES)), key = victim(recipe.victim);
    if (!input.fence || ![input.fence.sourceVersion,input.fence.throughVersion,input.fence.totalContributors,input.fence.storedEligibleTotal].every(n => Number.isSafeInteger(n) && n >= 0)) fail('invalid', 'exact durable contribution fence required');
    const initial = validatePlannerCursor(recipe, input.initialCursor ?? initialPlannerCursor(recipe));
    if (json(initial, MAX_CURSOR_BYTES) !== json(initialPlannerCursor(recipe), MAX_CURSOR_BYTES)) fail('invalid', 'draft requires the initial planner cursor');
    return this.tx(async query => {
      await this.lock(query, key);
      if (await this.pagedSeal(key, query) || (await query('SELECT 1 FROM world_victim_outcomes WHERE outcome_key=$1', [key])).rowCount) fail('closed', 'victim already sealed');
      const existing = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE victim_key=$1', [key])).rows[0];
      const recipeJson = json(recipe, MAX_RECIPE_BYTES), initialJson = json(initial, MAX_CURSOR_BYTES);
      if (existing) { if (existing.recipe_json !== recipeJson || existing.initial_cursor_json !== initialJson) fail('conflict', 'victim recipe changed'); return this.decodeDraft(existing, query); }
      const prefix = key.slice(0, -1) + ',';
      if ((await query('SELECT 1 FROM world_character_grants WHERE left(grant_id,length($1))=$1 LIMIT 1', [prefix])).rowCount) fail('conflict', 'unsealed legacy grants cannot become a paged draft');
      await query('INSERT INTO world_contribution_sources(victim_key,victim_json) VALUES($1,$2) ON CONFLICT DO NOTHING', [key, json(recipe.victim, 512)]);
      const source = (await query<SourceRow>('SELECT * FROM world_contribution_sources WHERE victim_key=$1', [key])).rows[0];
      if (safe(source.max_version) !== recipe.throughVersion || input.fence.throughVersion !== safe(source.max_version) || input.fence.sourceVersion !== safe(source.source_revision) || input.fence.totalContributors !== safe(source.contributor_count) || input.fence.storedEligibleTotal !== safe(source.stored_eligible_count)) fail('conflict', 'recipe/fence does not exactly match durable contribution observations');
      verifyDeathRecipeSummary(recipe, await this.summary(query, recipe.victim, recipe.overrides.map(c => c.character)));
      const digest = hash(recipeJson), chain = hash(json(['paged-ledger-seed-v1', key, this.codec.version, digest, source.contributor_count, source.max_version], 2048));
      const row = (await query<DraftRow>(`INSERT INTO world_victim_drafts(draft_id,victim_key,codec_version,recipe_json,recipe_digest,initial_cursor_json,cursor_json,total_count,source_version,content_chain)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) RETURNING *`, [randomUUID(), key, this.codec.version, recipeJson, digest, initialJson, source.contributor_count, source.source_revision, chain])).rows[0];
      await query("UPDATE world_contribution_sources SET state='frozen' WHERE victim_key=$1", [key]); return this.decodeDraft(row, query);
    });
  }
  async getVictimDraft(draftId: string): Promise<DraftHandle> {
    character(draftId);
    return this.tx(async query => {
      const hint = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0];
      if (!hint) fail('not_found', 'draft not found'); await this.lock(query, hint.victim_key);
      if (await this.pagedSeal(hint.victim_key, query)) fail('closed', 'draft sealed; read its immutable seal');
      const row = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0];
      return this.decodeDraft(row, query);
    });
  }
  async getDraftRecoveryHighWater(): Promise<string> {
    return (await this.query<{ sequence: string }>('SELECT COALESCE(max(recovery_sequence),0)::text AS sequence FROM world_victim_drafts')).rows[0].sequence;
  }
  async listVictimDrafts(options: { afterSequence?: string; throughSequence: string; limit?: number }): Promise<{ draftId: string; recoverySequence: string; victim: EntityRef; contributorCount: number; plannedCount: number }[]> {
    const limit = options.limit ?? MAX_LEDGER_PAGE; pageLimit(limit);
    const after = options.afterSequence ?? '0', through = options.throughSequence;
    for (const value of [after, through]) if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) fail('invalid', 'invalid recovery sequence');
    const rows = (await this.query<{ draft_id: string; recovery_sequence: string; victim_key: string; total_count: string; planned_count: string }>(`SELECT draft_id,recovery_sequence,victim_key,total_count,planned_count FROM world_victim_drafts d
      WHERE recovery_sequence>$1::bigint AND recovery_sequence<=$2::bigint AND NOT EXISTS(SELECT 1 FROM world_paged_outcome_seals s WHERE s.victim_key=d.victim_key) ORDER BY recovery_sequence LIMIT $3`, [after, through, limit])).rows;
    return rows.map(r => { const v = JSON.parse(r.victim_key); return { draftId: r.draft_id, recoverySequence: r.recovery_sequence, victim: { area: v[0], id: v[1], life: v[2] }, contributorCount: safe(r.total_count), plannedCount: safe(r.planned_count) }; });
  }
  async readContributionPage(draftId: string, afterCharacter: string | null, limit: number): Promise<CreditPage> {
    character(draftId); pageLimit(limit); if (afterCharacter !== null) character(afterCharacter);
    return this.tx(async query => {
      const hint = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0]; if (!hint) fail('not_found', 'draft not found');
      await this.lock(query, hint.victim_key);
      if (await this.pagedSeal(hint.victim_key, query)) fail('closed', 'draft already sealed');
      const draft = await this.decodeDraft((await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0], query), key = victimKey(draft.victim);
      const rows = (await query<{ character_id: string; credit_version: string; credit_json: string }>('SELECT character_id,credit_version,credit_json FROM world_contributions WHERE victim_key=$1 AND ($2::uuid IS NULL OR character_id>$2) ORDER BY character_id LIMIT $3', [key, afterCharacter, limit])).rows;
      const credits = rows.map(r => validateCreditWrite({ victim: draft.victim, character: r.character_id, version: safe(r.credit_version), credit: parse(r.credit_json, MAX_CREDIT_BYTES) }));
      if (credits.some(c => c.version > draft.recipe.throughVersion)) fail('conflict', 'credit exceeds frozen observation version');
      const through = credits.at(-1)?.character ?? afterCharacter;
      const more = (await query('SELECT 1 FROM world_contributions WHERE victim_key=$1 AND ($2::uuid IS NULL OR character_id>$2) LIMIT 1', [key, through])).rowCount;
      return { credits, afterCharacter, throughCharacter: credits.at(-1)?.character ?? null, end: !more };
    });
  }
  async appendVictimPage(draftId: string, page: PlannedPage): Promise<DraftHandle> {
    character(draftId); if (!page || !Array.isArray(page.grants)) fail('invalid', 'planned page required'); pageLimit(page.grants.length);
    const submitted = parse<PlannedPage>(json(page, MAX_LEDGER_PAGE * 18000), MAX_LEDGER_PAGE * 18000), pageDigest = hash(json(submitted, MAX_LEDGER_PAGE * 18000));
    return this.tx(async query => {
      const hint = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0]; if (!hint) fail('not_found', 'draft not found');
      await this.lock(query, hint.victim_key);
      if (await this.pagedSeal(hint.victim_key, query)) fail('closed', 'draft already sealed');
      const row = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0], draft = await this.decodeDraft(row, query);
      const old = (await query<{ page_digest: string }>('SELECT page_digest FROM world_victim_pages WHERE draft_id=$1 AND page_sequence=$2', [draftId, submitted.pageSequence])).rows[0];
      if (old) { if (old.page_digest !== pageDigest) fail('conflict', 'immutable page changed'); return draft; }
      if (submitted.pageSequence !== draft.cursor.pageSequence + 1 || submitted.afterCharacter !== draft.cursor.afterCharacter || json(submitted.expectedCursor, MAX_CURSOR_BYTES) !== json(draft.cursor, MAX_CURSOR_BYTES)) fail('conflict', 'page sequence or cursor mismatch');
      const credits = (await query<{ character_id: string; credit_version: string; credit_json: string }>('SELECT character_id,credit_version,credit_json FROM world_contributions WHERE victim_key=$1 AND ($2::uuid IS NULL OR character_id>$2) ORDER BY character_id LIMIT $3', [row.victim_key, draft.cursor.afterCharacter, submitted.grants.length])).rows;
      if (credits.length !== submitted.grants.length || credits.at(-1)?.character_id !== submitted.throughCharacter) fail('conflict', 'page skipped contributors');
      if (credits.some(c => safe(c.credit_version) > draft.recipe.throughVersion)) fail('conflict', 'credit exceeds frozen observation version');
      const expected = this.planner(draft.recipe, draft.cursor, credits.map(r => parse<CreditWrite['credit']>(r.credit_json, MAX_CREDIT_BYTES)));
      if (json(expected, MAX_LEDGER_PAGE * 18000) !== json(submitted, MAX_LEDGER_PAGE * 18000)) fail('conflict', 'page differs from the pure core planner');
      let chain = draft.contentChain;
      for (let i = 0; i < submitted.grants.length; i++) {
        const grant = submitted.grants[i], recipient = credits[i].character_id;
        if (grant.recipient !== recipient) fail('conflict', 'page recipient mismatch');
        const owner = (await query<{ account_id: string; identity_json: string; codec_version: number }>('SELECT account_id,identity_json,codec_version FROM world_characters WHERE character_id=$1 FOR SHARE', [recipient])).rows[0];
        if (!owner) fail('not_found', 'contribution owner missing'); if (owner.codec_version !== this.codec.version) fail('version', 'contribution owner codec mismatch');
        const identity: IdentityJson = this.codec.validateIdentity(parse(owner.identity_json, 4096));
        const payload = json(this.codec.validateGrant(this.codec.grantToJson(grant), { characterId: recipient, identity }), 16384);
        await query('INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json) VALUES($1,$2,$3,$4,$5)', [grant.id, recipient, owner.account_id, this.codec.version, payload]);
        await query('INSERT INTO world_paged_grant_visibility(grant_id,draft_id,victim_key,character_id) VALUES($1,$2,$3,$4)', [grant.id, draftId, row.victim_key, recipient]);
        chain = hash(json(['paged-ledger-row-v1', chain, grant.id, owner.account_id, recipient, payload], 20000));
      }
      const cursor = validatePlannerCursor(draft.recipe, submitted.nextCursor), cursorJson = json(cursor, MAX_CURSOR_BYTES);
      if (cursor.recipientCount > draft.contributorCount) fail('conflict', 'page exceeds frozen contribution count');
      await query('INSERT INTO world_victim_pages(draft_id,page_sequence,page_digest,through_character,cursor_digest,content_chain,planned_count) VALUES($1,$2,$3,$4,$5,$6,$7)', [draftId, cursor.pageSequence, pageDigest, cursor.afterCharacter, hash(cursorJson), chain, cursor.recipientCount]);
      const next = (await query<DraftRow>('UPDATE world_victim_drafts SET cursor_json=$2,planned_count=$3,page_sequence=$4,after_character=$5,content_chain=$6 WHERE draft_id=$1 RETURNING *', [draftId, cursorJson, cursor.recipientCount, cursor.pageSequence, cursor.afterCharacter, chain])).rows[0];
      return this.decodeDraft(next, query);
    });
  }
  async sealVictimDraft(draftId: string): Promise<PagedOutcomeSeal> {
    character(draftId);
    return this.tx(async query => {
      const sealed = (await query<{ victim_key: string }>('SELECT victim_key FROM world_paged_outcome_seals WHERE draft_id=$1', [draftId])).rows[0]; if (sealed) return (await this.pagedSeal(sealed.victim_key, query))!;
      const hint = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0]; if (!hint) fail('not_found', 'draft not found');
      await this.lock(query, hint.victim_key);
      const already = await this.pagedSeal(hint.victim_key, query); if (already) return already;
      const row = (await query<DraftRow>('SELECT * FROM world_victim_drafts WHERE draft_id=$1', [draftId])).rows[0], draft = await this.decodeDraft(row, query);
      if (draft.cursor.recipientCount !== draft.contributorCount || draft.cursor.recipientCount !== draft.recipe.expectedContributors || draft.cursor.randomDraws !== draft.recipe.expectedRandomDraws || (await query('SELECT 1 FROM world_contributions WHERE victim_key=$1 AND ($2::uuid IS NULL OR character_id>$2) LIMIT 1', [row.victim_key, draft.cursor.afterCharacter])).rowCount) fail('conflict', 'cannot seal an incomplete victim outcome');
      await query(`INSERT INTO world_paged_outcome_seals(victim_key,draft_id,codec_version,recipient_count,recipe_digest,digest_scheme,content_digest,final_cursor_json,final_cursor_digest)
        VALUES($1,$2,$3,$4,$5,'sha256-chain-v1',$6,$7,$8)`, [row.victim_key, draftId, this.codec.version, draft.contributorCount, draft.recipeDigest, draft.contentChain, json(draft.cursor, MAX_CURSOR_BYTES), hash(json(draft.cursor, MAX_CURSOR_BYTES))]);
      return (await this.pagedSeal(row.victim_key, query))!;
    });
  }
  async cleanupVictimDraft(draftId: string, limit = MAX_LEDGER_PAGE): Promise<{ removed: number; done: boolean }> {
    character(draftId); pageLimit(limit);
    return this.tx(async query => {
      const seal = (await query<{ victim_key: string }>('SELECT victim_key FROM world_paged_outcome_seals WHERE draft_id=$1', [draftId])).rows[0]; if (!seal) fail('closed', 'unsealed obligations cannot be cleaned');
      await this.lock(query, seal.victim_key); let removed = 0;
      removed += (await query('WITH keys AS(SELECT character_id FROM world_contributions WHERE victim_key=$1 ORDER BY character_id LIMIT $2) DELETE FROM world_contributions c USING keys WHERE c.victim_key=$1 AND c.character_id=keys.character_id', [seal.victim_key, limit])).rowCount ?? 0;
      removed += (await query('WITH keys AS(SELECT grant_id FROM world_paged_grant_visibility WHERE draft_id=$1 ORDER BY grant_id LIMIT $2) DELETE FROM world_paged_grant_visibility v USING keys WHERE v.grant_id=keys.grant_id', [draftId, limit])).rowCount ?? 0;
      removed += (await query('WITH keys AS(SELECT page_sequence FROM world_victim_pages WHERE draft_id=$1 ORDER BY page_sequence LIMIT $2) DELETE FROM world_victim_pages p USING keys WHERE p.draft_id=$1 AND p.page_sequence=keys.page_sequence', [draftId, limit])).rowCount ?? 0;
      const remains = (await query('SELECT 1 FROM world_contributions WHERE victim_key=$1 UNION ALL SELECT 1 FROM world_paged_grant_visibility WHERE draft_id=$2 UNION ALL SELECT 1 FROM world_victim_pages WHERE draft_id=$2 LIMIT 1', [seal.victim_key, draftId])).rowCount;
      if (!remains) { await query('DELETE FROM world_victim_drafts WHERE draft_id=$1', [draftId]); await query('DELETE FROM world_contribution_sources WHERE victim_key=$1', [seal.victim_key]); }
      return { removed, done: !remains };
    });
  }
}
