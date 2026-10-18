import { randomUUID } from 'node:crypto';
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
export type GrantBatchEntry<G> = { accountId: string; characterId: string; id: string; payload: G };
export type EarnedGrant<G> = { id: string; sequence: string; accountId: string; characterId: string; payload: G };
export class CharacterStoreError extends Error {
  readonly code: 'invalid' | 'not_found' | 'version' | 'conflict' | 'grant_mismatch' | 'already_applied';
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
  /** Commit one complete death's full entitlement set atomically. Result order matches input order. */
  async recordGrantBatch(entries: readonly GrantBatchEntry<G>[]): Promise<EarnedGrant<G>[]> {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_GRANT_BATCH_ENTRIES) fail('invalid', 'expected 1..100 grant entries');
    const prepared = Array.from(entries, entry => {
      if (!entry || typeof entry !== 'object') fail('invalid', 'invalid grant entry');
      account(entry.accountId); character(entry.characterId); grantId(entry.id);
      return { ...entry, payloadJson: json(entry.payload, 16384) };
    });
    if (new Set(prepared.map(entry => entry.id)).size !== prepared.length) fail('invalid', 'grant IDs must be distinct within a batch');
    const recipients = new Map<string, string>();
    for (const entry of prepared) {
      const owner = recipients.get(entry.characterId);
      if (owner && owner !== entry.accountId) fail('invalid', 'conflicting batch recipient accounts');
      recipients.set(entry.characterId, entry.accountId);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock ALL character recipients first, in byte-stable UUID order, before touching any journal ID.
      const contexts = new Map<string, Character<I, C>>();
      for (const characterId of [...recipients.keys()].sort()) {
        const owned = await client.query<Row>('SELECT * FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR UPDATE', [characterId, recipients.get(characterId)]);
        if (!owned.rowCount) fail('not_found', 'character not found'); contexts.set(characterId, this.decode(owned.rows[0]));
      }
      const grants = new Map<string, EarnedGrant<G>>();
      // Also sort global grant IDs: disjoint recipient sets may still collide on immutable IDs.
      for (const entry of [...prepared].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const context = contexts.get(entry.characterId)!;
        const payload = json(this.codec.validateGrant(parsed(entry.payloadJson, 16384), context), 16384);
        await client.query(`INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(grant_id) DO NOTHING`, [entry.id, entry.characterId, entry.accountId, this.codec.version, payload]);
        const row = (await client.query<GrantRow & { same_payload: boolean }>('SELECT *, payload_json::jsonb = $2::jsonb AS same_payload FROM world_character_grants WHERE grant_id=$1', [entry.id, payload])).rows[0];
        if (row.character_id !== entry.characterId || row.account_id !== entry.accountId || row.codec_version !== this.codec.version || !row.same_payload) fail('grant_mismatch', 'grant ID already has different contents or recipient');
        grants.set(entry.id, this.decodeGrant(row, context));
      }
      await client.query('COMMIT'); return prepared.map(entry => grants.get(entry.id)!);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async pendingGrants(accountId: string, characterId: string, options: { after?: string; limit?: number } = {}): Promise<EarnedGrant<G>[]> {
    const context = await this.getOwned(accountId, characterId), limit = options.limit ?? 100; pageSize(limit);
    const after = options.after ?? '0'; if (!/^(0|[1-9][0-9]{0,18})$/.test(after) || BigInt(after) > 9223372036854775807n) fail('invalid', 'invalid journal cursor');
    const result = await this.pool.query<GrantRow>(`SELECT g.* FROM world_character_grants g WHERE g.character_id=$1 AND g.journal_sequence>$2::bigint
      AND NOT EXISTS(SELECT 1 FROM world_character_grant_receipts r WHERE r.grant_id=g.grant_id) ORDER BY g.journal_sequence LIMIT $3`, [characterId, after, limit]);
    return result.rows.map(row => this.decodeGrant(row, context));
  }
  /** A consistent checkpoint + bounded receipt ledger for freeze/reload recovery after a conflict or lost ACK. */
  async loadForRecovery(accountId: string, characterId: string, ids: readonly string[]): Promise<{
    character: Character<I, C>; grants: (EarnedGrant<G> & { appliedRevision: number | null })[];
  }> {
    account(accountId); character(characterId);
    if (!Array.isArray(ids) || ids.length > MAX_CHECKPOINT_GRANT_RECEIPTS || new Set(ids).size !== ids.length) fail('invalid', 'expected at most 256 distinct grant IDs');
    ids.forEach(grantId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<Row>('SELECT * FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR SHARE', [characterId, accountId]);
      if (!owned.rowCount) fail('not_found', 'character not found'); const current = this.decode(owned.rows[0]);
      const grants: (EarnedGrant<G> & { appliedRevision: number | null })[] = [];
      for (const id of ids) {
        const row = (await client.query<GrantRow & { applied_revision: string | null }>(`SELECT g.*,r.applied_revision FROM world_character_grants g
          LEFT JOIN world_character_grant_receipts r ON r.grant_id=g.grant_id
          WHERE g.grant_id=$1 AND g.character_id=$2 AND g.account_id=$3`, [id, characterId, accountId])).rows[0];
        if (!row) fail('not_found', 'earned grant not found for character');
        const appliedRevision = row.applied_revision === null ? null : Number(row.applied_revision);
        if (appliedRevision !== null && (!Number.isSafeInteger(appliedRevision) || appliedRevision < 1 || appliedRevision > current.revision)) fail('invalid', 'corrupt grant receipt revision');
        grants.push({ ...this.decodeGrant(row, current), appliedRevision });
      }
      await client.query('COMMIT'); return { character: current, grants };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  /** Caller captures only trusted core state. Receipts and this checkpoint commit together or neither does. */
  async saveCheckpoint(accountId: string, characterId: string, expectedRevision: number, checkpointInput: C, appliedGrantIds: readonly string[] = []): Promise<Character<I, C>> {
    account(accountId); character(characterId); revision(expectedRevision);
    if (!Array.isArray(appliedGrantIds) || appliedGrantIds.length > MAX_CHECKPOINT_GRANT_RECEIPTS || new Set(appliedGrantIds).size !== appliedGrantIds.length) fail('invalid', 'expected at most 256 distinct grant IDs');
    appliedGrantIds.forEach(grantId);
    const checkpointJson = json(checkpointInput, 262144), client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<Row>('SELECT * FROM world_characters WHERE character_id=$1 AND account_id=$2 FOR UPDATE', [characterId, accountId]);
      if (!owned.rowCount) fail('not_found', 'character not found'); const current = this.decode(owned.rows[0]);
      if (current.revision !== expectedRevision) fail('conflict', 'checkpoint revision conflict; reload before retry');
      const checkpoint = this.codec.validateCheckpoint(parsed(checkpointJson, 262144), current);
      for (const id of appliedGrantIds) {
        const grant = (await client.query<GrantRow>('SELECT * FROM world_character_grants WHERE grant_id=$1 AND character_id=$2 AND account_id=$3', [id, characterId, accountId])).rows[0];
        if (!grant) fail('not_found', 'earned grant not found for character'); this.decodeGrant(grant, current);
        const receipt = await client.query('SELECT 1 FROM world_character_grant_receipts WHERE grant_id=$1', [id]);
        if (receipt.rowCount) fail('already_applied', 'grant already applied; reload before retry');
      }
      const result = await client.query<Row>(`UPDATE world_characters SET checkpoint_json=$1,revision=revision+1,updated_at=now()
        WHERE character_id=$2 AND account_id=$3 AND revision=$4 RETURNING *`, [json(checkpoint, 262144), characterId, accountId, expectedRevision]);
      if (!result.rowCount) fail('conflict', 'checkpoint revision conflict');
      for (const id of appliedGrantIds) await client.query('INSERT INTO world_character_grant_receipts(grant_id,character_id,applied_revision) VALUES($1,$2,$3)', [id, characterId, expectedRevision + 1]);
      const saved = this.decode(result.rows[0]); await client.query('COMMIT'); return saved;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
