import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CharacterContext<I> = { accountId: string; characterId: string; identity: I };
/** Required production adapter. It owns appearance/class, fresh level-1 state and actual core schema validation. */
export interface CharacterCodec<I extends Json, C extends Json, G extends Json> {
  version: number;
  validateIdentity(value: Json): I;
  fresh(context: CharacterContext<I>): C;
  validateCheckpoint(value: Json, context: CharacterContext<I>): C;
  validateGrant(value: Json, context: CharacterContext<I>): G;
}
export type Character<I, C> = CharacterContext<I> & { revision: number; checkpoint: C; updatedAt: number };
export const MAX_GRANT_BATCH_ENTRIES = 100;
export const MAX_CHECKPOINT_GRANT_RECEIPTS = 256;
export type VictimOutcomeResources = { maxEntries: number; maxPayloadBytes: number; timeoutMs: number };
export type GrantBatchEntry<G> = { accountId: string; characterId: string; id: string; payload: G };
export type EarnedGrant<G> = { id: string; sequence: string; accountId: string; characterId: string; payload: G };
export class CharacterStoreError extends Error {
  readonly code: 'invalid' | 'not_found' | 'version' | 'conflict' | 'grant_mismatch' | 'already_applied' | 'character_limit' | 'outcome_conflict' | 'resource_limit';
  constructor(code: CharacterStoreError['code'], message: string) { super(message); this.name = 'CharacterStoreError'; this.code = code; }
}
function fail(code: CharacterStoreError['code'], message: string): never { throw new CharacterStoreError(code, message); }
function account(value: string) { if (!/^g[a-f0-9]{23}$/.test(value)) fail('invalid', 'invalid account ID'); }
function character(value: string) { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) fail('invalid', 'invalid character ID'); }
function grantId(value: string) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > 512 ||
      /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)) fail('invalid', 'grant ID must be 1..512 UTF-8 bytes without controls or unpaired surrogates');
}
function revision(value: number) { if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail('invalid', 'invalid revision'); }
function featureIds(ids: readonly string[]) {
  if (!Array.isArray(ids) || ids.length > MAX_CHECKPOINT_GRANT_RECEIPTS || new Set(ids).size !== ids.length) fail('invalid', 'expected at most 256 distinct dungeon award IDs');
  for (const id of ids) if (typeof id !== 'string' || Buffer.byteLength(id) < 1 || Buffer.byteLength(id) > 2048) fail('invalid', 'invalid dungeon award ID');
}
function pageSize(value: number) { if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail('invalid', 'page size must be 1..100'); }

/** Canonical bounded JSON, including rejection of values JSON.stringify would silently discard/coerce. */
function json(value: unknown, maxBytes: number): string {
  const active = new Set<object>(); let nodes = 0;
  function visit(v: unknown, depth: number): Json {
    if (++nodes > 32768 || depth > 32) fail('invalid', 'JSON complexity limit exceeded');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { if (Buffer.byteLength(v) > maxBytes) fail('invalid', 'JSON too large'); return v; }
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object' || !v || active.has(v)) fail('invalid', 'expected finite, acyclic JSON');
    const array = Array.isArray(v);
    if (!array && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail('invalid', 'expected plain JSON object');
    if (Object.getOwnPropertySymbols(v).length) fail('invalid', 'symbol JSON keys are forbidden');
    active.add(v);
    const keys = Object.keys(v).sort();
    // Unique own keys must cover exactly 0..length-1; numeric-looking ordinary properties cannot fill holes.
    if (array && (keys.length !== v.length || keys.some(key => {
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= v.length || String(index) !== key;
    }))) fail('invalid', 'expected dense JSON array');
    const out: Json = array ? [] : Object.create(null);
    for (const key of keys) {
      if (Buffer.byteLength(key) > maxBytes) fail('invalid', 'JSON key too large');
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in descriptor)) fail('invalid', 'JSON accessors are forbidden');
      const item = visit(descriptor.value, depth + 1);
      if (array) (out as Json[])[Number(key)] = item;
      else (out as { [key: string]: Json })[key] = item;
    }
    active.delete(v); return out;
  }
  const text = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(text) > maxBytes) fail('invalid', 'JSON too large');
  return text;
}
function parsed(text: string, maxBytes: number): Json {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) fail('invalid', 'corrupt stored JSON');
  try { return JSON.parse(json(JSON.parse(text), maxBytes)) as Json; }
  catch (e) { if (e instanceof CharacterStoreError) throw e; return fail('invalid', 'corrupt stored JSON'); }
}
function victimTuple(id: string): [string, number, number, string] | null {
  try {
    const v = JSON.parse(id);
    return Array.isArray(v) && v.length === 4 && typeof v[0] === 'string' && v[0].length > 0 &&
      Number.isSafeInteger(v[1]) && v[1] >= 1 && v[1] <= 0xffffffff && Number.isSafeInteger(v[2]) && v[2] >= 1 && v[2] <= 0xffffffff && typeof v[3] === 'string' ? v as [string, number, number, string] : null;
  } catch { return null; }
}
const victimKey = (tuple: readonly unknown[]) => JSON.stringify(tuple.slice(0, 3));
const victimLock = (key: string) => createHash('sha256').update('world-victim-outcome:' + key).digest().readBigInt64BE().toString();
export { json as canonicalLedgerJson, victimLock as victimAdvisoryLock };
interface Row { character_id: string; account_id: string; codec_version: number; identity_json: string; checkpoint_json: string; revision: string; updated_at: Date | string }
interface GrantRow { grant_id: string; journal_sequence: string; character_id: string; account_id: string; codec_version: number; payload_json: string }

/** Trusted host storage only. No HTTP handler and no legacy-save input. */
export class CharacterStore<I extends Json, C extends Json, G extends Json> {
  private readonly pool: pg.Pool;
  private readonly codec: CharacterCodec<I, C, G>;
  constructor(pool: pg.Pool, codec: CharacterCodec<I, C, G>) {
    if (!codec || !Number.isInteger(codec.version) || codec.version < 1 || codec.version > 2147483647 ||
        ['validateIdentity', 'fresh', 'validateCheckpoint', 'validateGrant'].some(key => typeof codec[key as keyof typeof codec] !== 'function')) fail('invalid', 'a versioned server codec is required');
    this.pool = pool; this.codec = codec;
  }
  private version(version: number) { if (version !== this.codec.version) fail('version', 'unsupported character codec version'); }
  private decode(row: Row): Character<I, C> {
    this.version(row.codec_version); account(row.account_id); character(row.character_id);
    const rev = Number(row.revision);
    if (!Number.isSafeInteger(rev) || rev < 0) fail('invalid', 'corrupt stored revision');
    const updatedAt = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at);
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) fail('invalid', 'corrupt stored update timestamp');
    const identity = this.codec.validateIdentity(parsed(row.identity_json, 4096));
    json(identity, 4096);
    const context = { accountId: row.account_id, characterId: row.character_id, identity };
    const checkpoint = this.codec.validateCheckpoint(parsed(row.checkpoint_json, 262144), context);
    json(checkpoint, 262144);
    return { ...context, revision: rev, checkpoint, updatedAt };
  }
  private decodeGrant(row: GrantRow, context: CharacterContext<I>): EarnedGrant<G> {
    this.version(row.codec_version); grantId(row.grant_id);
    if (row.account_id !== context.accountId || row.character_id !== context.characterId || !/^[1-9][0-9]*$/.test(row.journal_sequence)) fail('invalid', 'corrupt grant recipient or sequence');
    const payload = this.codec.validateGrant(parsed(row.payload_json, 16384), context); json(payload, 16384);
    return { id: row.grant_id, sequence: row.journal_sequence, accountId: row.account_id, characterId: row.character_id, payload };
  }
  async create(accountId: string, identityInput: I): Promise<Character<I, C>> {
    account(accountId);
    const identity = this.codec.validateIdentity(parsed(json(identityInput, 4096), 4096));
    const context = { accountId, characterId: randomUUID(), identity };
    const checkpoint = this.codec.validateCheckpoint(this.codec.fresh(context), context);
    const result = await this.pool.query<Row>(`INSERT INTO world_characters(character_id,account_id,codec_version,identity_json,checkpoint_json)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [context.characterId, accountId, this.codec.version, json(identity, 4096), json(checkpoint, 262144)]);
    return this.decode(result.rows[0]);
  }
  /** Public creation policy: account lock, count, fresh insertion and validation share ONE transaction/client. */
  async createBounded(accountId: string, identityInput: I, maxCharactersPerAccount: number): Promise<Character<I, C>> {
    account(accountId);
    if (!Number.isSafeInteger(maxCharactersPerAccount) || maxCharactersPerAccount < 1) fail('invalid', 'explicit positive character limit required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query('SELECT 1 FROM accounts WHERE username=$1 FOR UPDATE', [accountId]);
      if (!owner.rowCount) fail('not_found', 'account not found');
      const count = (await client.query<{ count: string }>('SELECT count(*) FROM world_characters WHERE account_id=$1', [accountId])).rows[0].count;
      if (BigInt(count) >= BigInt(maxCharactersPerAccount)) fail('character_limit', 'account character limit reached');
      const identity = this.codec.validateIdentity(parsed(json(identityInput, 4096), 4096));
      const context = { accountId, characterId: randomUUID(), identity };
      const checkpoint = this.codec.validateCheckpoint(this.codec.fresh(context), context);
      const row = (await client.query<Row>(`INSERT INTO world_characters(character_id,account_id,codec_version,identity_json,checkpoint_json)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [context.characterId, accountId, this.codec.version, json(identity, 4096), json(checkpoint, 262144)])).rows[0];
      const created = this.decode(row); await client.query('COMMIT'); return created;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async getOwned(accountId: string, characterId: string): Promise<Character<I, C>> {
    account(accountId); character(characterId);
    const result = await this.pool.query<Row>('SELECT * FROM world_characters WHERE character_id=$1 AND account_id=$2', [characterId, accountId]);
    if (!result.rowCount) fail('not_found', 'character not found'); return this.decode(result.rows[0]);
  }
  async listOwned(accountId: string, options: { after?: string; limit?: number } = {}): Promise<Character<I, C>[]> {
    account(accountId); const limit = options.limit ?? 100; pageSize(limit); if (options.after) character(options.after);
    const result = await this.pool.query<Row>(`SELECT * FROM world_characters WHERE account_id=$1 AND ($2::uuid IS NULL OR character_id>$2::uuid)
      ORDER BY character_id LIMIT $3`, [accountId, options.after ?? null, limit]);
    return result.rows.map(row => this.decode(row));
  }
  /** Trusted host lookup for offline core recipients; never expose this as an unauthenticated client endpoint. */
  async getOwner(characterId: string): Promise<string> {
    character(characterId);
    const row = (await this.pool.query<{ account_id: string }>('SELECT account_id FROM world_characters WHERE character_id=$1', [characterId])).rows[0];
    if (!row) fail('not_found', 'character not found'); account(row.account_id); return row.account_id;
  }
  async recordGrant(accountId: string, characterId: string, id: string, payload: G): Promise<EarnedGrant<G>> {
    return (await this.recordGrantBatch([{ accountId, characterId, id, payload }]))[0];
  }
  /** Compatibility primitive for small trusted batches. Concurrent population is NOT a lifetime contributor cap. */
  async recordGrantBatch(entries: readonly GrantBatchEntry<G>[]): Promise<EarnedGrant<G>[]> {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_GRANT_BATCH_ENTRIES) fail('invalid', 'expected 1..100 grant entries');
    return this.writeGrants(entries);
  }
  /** Whole lifetime outcome: all N recipients and a count/content seal commit together, or none does. */
  async recordVictimOutcome(entries: readonly GrantBatchEntry<G>[], resources: VictimOutcomeResources): Promise<EarnedGrant<G>[]> {
    if (!resources || ![resources.maxEntries, resources.maxPayloadBytes, resources.timeoutMs].every(n => Number.isSafeInteger(n) && n > 0) || resources.timeoutMs > 2147483647) fail('invalid', 'explicit victim outcome resource budgets required');
    if (!Array.isArray(entries) || !entries.length) fail('invalid', 'whole victim outcome required');
    if (entries.length > resources.maxEntries) fail('resource_limit', 'retain complete outcome and retry with sufficient resources');
    return this.writeGrants(entries, { ...resources });
  }
  private async writeGrants(entries: readonly GrantBatchEntry<G>[], resources?: VictimOutcomeResources): Promise<EarnedGrant<G>[]> {
    let bytes = 0;
    const prepared = Array.from(entries, entry => {
      if (!entry || typeof entry !== 'object') fail('invalid', 'invalid grant entry');
      account(entry.accountId); character(entry.characterId); grantId(entry.id);
      const payloadJson = json(entry.payload, 16384), tuple = victimTuple(entry.id);
      bytes += Buffer.byteLength(payloadJson) + Buffer.byteLength(entry.id) + Buffer.byteLength(entry.accountId) + Buffer.byteLength(entry.characterId);
      if (resources && bytes > resources.maxPayloadBytes) fail('resource_limit', 'retain complete outcome and retry with sufficient resources');
      return { accountId: entry.accountId, characterId: entry.characterId, id: entry.id, payloadJson, outcome: tuple ? victimKey(tuple) : null, tuple };
    });
    if (new Set(prepared.map(entry => entry.id)).size !== prepared.length) fail('invalid', 'grant IDs must be distinct within a batch');
    const outcomeKeys = [...new Set(prepared.flatMap(entry => entry.outcome === null ? [] : [entry.outcome]))].sort();
    if (resources && (outcomeKeys.length !== 1 || prepared.some(e => !e.tuple || e.id !== JSON.stringify([...e.tuple.slice(0, 3), e.characterId])))) fail('invalid', 'one canonical victim with exact recipient IDs required');
    const recipients = new Map<string, string>();
    for (const entry of prepared) {
      const owner = recipients.get(entry.characterId);
      if (owner && owner !== entry.accountId) fail('invalid', 'conflicting batch recipient accounts');
      recipients.set(entry.characterId, entry.accountId);
    }
    const client = await this.pool.connect(), deadline = resources ? performance.now() + resources.timeoutMs : Infinity;
    let reusable = true;
    const raw = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = [], timeout?: number) => {
      const config = { text, values, ...(timeout ? { query_timeout: timeout } : {}) }; return client.query<R>(config);
    };
    const remaining = () => { const value = Math.ceil(deadline - performance.now()); if (value <= 0) fail('resource_limit', 'victim outcome transaction deadline'); return value; };
    const query = async <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) => {
      if (!resources) return raw<R>(text, values);
      await raw("SELECT set_config('statement_timeout',$1,true)", [String(remaining())], remaining());
      return raw<R>(text, values, remaining());
    };
    try {
      await raw('BEGIN', [], resources?.timeoutMs);
      // Serialize seal/legacy writers for every relevant victim BEFORE taking character row locks.
      for (const key of outcomeKeys) await query('SELECT pg_advisory_xact_lock($1::bigint)', [victimLock(key)]);
      for (const key of outcomeKeys) {
        if ((await query('SELECT 1 FROM world_contribution_sources WHERE victim_key=$1 UNION ALL SELECT 1 FROM world_paged_outcome_seals WHERE victim_key=$1 LIMIT 1', [key])).rowCount) fail('outcome_conflict', 'victim belongs to the paged ledger');
      }
      const seals = new Map<string, { codec_version: number; recipient_count: string; content_digest: string }>();
      for (const key of outcomeKeys) {
        const row = (await query<{ codec_version: number; recipient_count: string; content_digest: string }>('SELECT * FROM world_victim_outcomes WHERE outcome_key=$1', [key])).rows[0];
        if (row) seals.set(key, row);
      }
      if (resources && !seals.has(outcomeKeys[0])) {
        // Legacy canonical IDs have this exact tuple prefix. A partial old journal must not become a completeness seal.
        const prefix = outcomeKeys[0].slice(0, -1) + ',';
        if ((await query('SELECT 1 FROM world_character_grants WHERE left(grant_id,length($1))=$1 LIMIT 1', [prefix])).rowCount) fail('outcome_conflict', 'unsealed legacy victim journal requires explicit recovery');
      }
      const contexts = new Map<string, Character<I, C>>();
      for (const characterId of [...recipients.keys()].sort()) {
        const owned = await query<Row>('SELECT * FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR UPDATE', [characterId, recipients.get(characterId)]);
        if (!owned.rowCount) fail('not_found', 'character not found'); contexts.set(characterId, this.decode(owned.rows[0]));
      }
      const ordered = [...prepared].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      let validatedBytes = 0;
      const digest = createHash('sha256').update(JSON.stringify([this.codec.version, outcomeKeys, prepared.length]));
      for (const entry of ordered) {
        entry.payloadJson = json(this.codec.validateGrant(parsed(entry.payloadJson, 16384), contexts.get(entry.characterId)!), 16384);
        validatedBytes += Buffer.byteLength(entry.payloadJson) + Buffer.byteLength(entry.id) + Buffer.byteLength(entry.accountId) + Buffer.byteLength(entry.characterId);
        if (resources && validatedBytes > resources.maxPayloadBytes) fail('resource_limit', 'validated victim outcome exceeds resource budget');
        digest.update(JSON.stringify([entry.id, entry.accountId, entry.characterId, entry.payloadJson])).update('\n');
      }
      if (resources) {
        const seal = seals.get(outcomeKeys[0]), content = digest.digest('hex');
        if (seal && (seal.codec_version !== this.codec.version || seal.recipient_count !== String(prepared.length) || seal.content_digest !== content)) fail('outcome_conflict', 'victim recipient set or contents changed');
        if (!seal) await query('INSERT INTO world_victim_outcomes(outcome_key,codec_version,recipient_count,content_digest) VALUES($1,$2,$3,$4)', [outcomeKeys[0], this.codec.version, prepared.length, content]);
      }
      const grants = new Map<string, EarnedGrant<G>>();
      for (const entry of ordered) {
        const sealed = seals.has(entry.outcome ?? '');
        if (!sealed) await query(`INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(grant_id) DO NOTHING`, [entry.id, entry.characterId, entry.accountId, this.codec.version, entry.payloadJson]);
        const row = (await query<GrantRow & { same_payload: boolean }>('SELECT *, payload_json::jsonb = $2::jsonb AS same_payload FROM world_character_grants WHERE grant_id=$1', [entry.id, entry.payloadJson])).rows[0];
        if (!row && sealed) fail('outcome_conflict', 'cannot add recipients to a sealed victim outcome');
        if (!row || row.character_id !== entry.characterId || row.account_id !== entry.accountId || row.codec_version !== this.codec.version || !row.same_payload) fail('grant_mismatch', 'grant ID already has different contents or recipient');
        grants.set(entry.id, this.decodeGrant(row, contexts.get(entry.characterId)!));
      }
      await query('COMMIT'); return prepared.map(entry => grants.get(entry.id)!);
    } catch (e) {
      try { await raw('ROLLBACK', [], resources?.timeoutMs); } catch { reusable = false; }
      throw e;
    } finally { client.release(!reusable); }
  }
  async pendingGrants(accountId: string, characterId: string, options: { after?: string; limit?: number } = {}): Promise<EarnedGrant<G>[]> {
    const context = await this.getOwned(accountId, characterId), limit = options.limit ?? 100; pageSize(limit);
    const after = options.after ?? '0'; if (!/^(0|[1-9][0-9]{0,18})$/.test(after) || BigInt(after) > 9223372036854775807n) fail('invalid', 'invalid journal cursor');
    const result = await this.pool.query<GrantRow>(`SELECT g.* FROM world_replayable_grants g WHERE g.character_id=$1 AND g.journal_sequence>$2::bigint
      AND NOT EXISTS(SELECT 1 FROM world_character_grant_receipts r WHERE r.grant_id=g.grant_id) ORDER BY g.journal_sequence LIMIT $3`, [characterId, after, limit]);
    return result.rows.map(row => this.decodeGrant(row, context));
  }
  /** A consistent checkpoint + bounded receipt ledger for freeze/reload recovery after a conflict or lost ACK. */
  async loadForRecovery(accountId: string, characterId: string, ids: readonly string[], dungeonAwardIds?: readonly string[]): Promise<{
    character: Character<I, C>; grants: (EarnedGrant<G> & { appliedRevision: number | null })[];
    dungeonAwards?: { id: string; appliedRevision: number | null }[];
  }> {
    account(accountId); character(characterId);
    if (!Array.isArray(ids) || ids.length > MAX_CHECKPOINT_GRANT_RECEIPTS || new Set(ids).size !== ids.length) fail('invalid', 'expected at most 256 distinct grant IDs');
    ids.forEach(grantId); if (dungeonAwardIds !== undefined) featureIds(dungeonAwardIds);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<Row>('SELECT * FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR SHARE', [characterId, accountId]);
      if (!owned.rowCount) fail('not_found', 'character not found'); const current = this.decode(owned.rows[0]);
      const grants: (EarnedGrant<G> & { appliedRevision: number | null })[] = [];
      for (const id of ids) {
        const row = (await client.query<GrantRow & { applied_revision: string | null }>(`SELECT g.*,r.applied_revision FROM world_replayable_grants g
          LEFT JOIN world_character_grant_receipts r ON r.grant_id=g.grant_id
          WHERE g.grant_id=$1 AND g.character_id=$2 AND g.account_id=$3`, [id, characterId, accountId])).rows[0];
        if (!row) fail('not_found', 'earned grant not found for character');
        const appliedRevision = row.applied_revision === null ? null : Number(row.applied_revision);
        if (appliedRevision !== null && (!Number.isSafeInteger(appliedRevision) || appliedRevision < 1 || appliedRevision > current.revision)) fail('invalid', 'corrupt grant receipt revision');
        grants.push({ ...this.decodeGrant(row, current), appliedRevision });
      }
      if (dungeonAwardIds === undefined) { await client.query('COMMIT'); return { character: current, grants }; }
      const dungeonAwards: { id: string; appliedRevision: number | null }[] = [];
      for (const id of dungeonAwardIds) {
        const row = (await client.query<{ applied_revision: string | null }>(`SELECT r.applied_revision FROM world_dungeon_awards a
          LEFT JOIN world_dungeon_award_receipts r ON r.award_id=a.award_id WHERE a.award_id=$1 AND a.character_id=$2 AND a.account_id=$3`, [id, characterId, accountId])).rows[0];
        if (!row) fail('not_found', 'dungeon award not found for character');
        const appliedRevision = row.applied_revision === null ? null : Number(row.applied_revision);
        if (appliedRevision !== null && (!Number.isSafeInteger(appliedRevision) || appliedRevision < 1 || appliedRevision > current.revision)) fail('invalid', 'corrupt dungeon award receipt revision');
        dungeonAwards.push({ id, appliedRevision });
      }
      await client.query('COMMIT'); return { character: current, grants, dungeonAwards };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  /** Caller captures only trusted core state. Receipts and this checkpoint commit together or neither does. */
  async saveCheckpoint(accountId: string, characterId: string, expectedRevision: number, checkpointInput: C, appliedGrantIds: readonly string[] = [], appliedDungeonAwardIds: readonly string[] = []): Promise<Character<I, C>> {
    account(accountId); character(characterId); revision(expectedRevision);
    if (!Array.isArray(appliedGrantIds) || appliedGrantIds.length > MAX_CHECKPOINT_GRANT_RECEIPTS || new Set(appliedGrantIds).size !== appliedGrantIds.length) fail('invalid', 'expected at most 256 distinct grant IDs');
    appliedGrantIds.forEach(grantId); featureIds(appliedDungeonAwardIds);
    const checkpointJson = json(checkpointInput, 262144), client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<Row>('SELECT * FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR UPDATE', [characterId, accountId]);
      if (!owned.rowCount) fail('not_found', 'character not found'); const current = this.decode(owned.rows[0]);
      if (current.revision !== expectedRevision) fail('conflict', 'checkpoint revision conflict; reload before retry');
      const checkpoint = this.codec.validateCheckpoint(parsed(checkpointJson, 262144), current);
      for (const id of appliedGrantIds) {
        const grant = (await client.query<GrantRow>('SELECT * FROM world_replayable_grants WHERE grant_id=$1 AND character_id=$2 AND account_id=$3', [id, characterId, accountId])).rows[0];
        if (!grant) fail('not_found', 'earned grant not found for character'); this.decodeGrant(grant, current);
        const receipt = await client.query('SELECT 1 FROM world_character_grant_receipts WHERE grant_id=$1', [id]);
        if (receipt.rowCount) fail('already_applied', 'grant already applied; reload before retry');
      }
      // Dungeon clear awards (migration 008) only enter when the capture carries them; old callers never touch those tables.
      for (const id of appliedDungeonAwardIds) {
        if (!(await client.query('SELECT 1 FROM world_dungeon_awards WHERE award_id=$1 AND character_id=$2 AND account_id=$3', [id, characterId, accountId])).rowCount) fail('not_found', 'dungeon award not found for character');
        if ((await client.query('SELECT 1 FROM world_dungeon_award_receipts WHERE award_id=$1', [id])).rowCount) fail('already_applied', 'dungeon award already applied; reload before retry');
      }
      const result = await client.query<Row>(`UPDATE world_characters SET checkpoint_json=$1,revision=revision+1,updated_at=now()
        WHERE character_id=$2 AND account_id=$3 AND revision=$4 RETURNING *`, [json(checkpoint, 262144), characterId, accountId, expectedRevision]);
      if (!result.rowCount) fail('conflict', 'checkpoint revision conflict');
      for (const id of appliedGrantIds) await client.query('INSERT INTO world_character_grant_receipts(grant_id,character_id,applied_revision) VALUES($1,$2,$3)', [id, characterId, expectedRevision + 1]);
      for (const id of appliedDungeonAwardIds) await client.query('INSERT INTO world_dungeon_award_receipts(award_id,character_id,applied_revision) VALUES($1,$2,$3)', [id, characterId, expectedRevision + 1]);
      const saved = this.decode(result.rows[0]); await client.query('COMMIT'); return saved;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
