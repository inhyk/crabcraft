import type { Pool, PoolClient } from 'pg';
import type { EntityRef } from '../../src/sim/types.ts';
import { CHAT, Talk, reasonOf, shownName, type Reason, type Refusal, type TalkState } from '../chat/safety.ts';

/** These bindings come from admission and exact host actor lookup, never a client account assertion. */
export interface ChatParticipant {
  readonly accountId: string;
  readonly ref: EntityRef;
  readonly name: string;
  readonly partyId?: string | null;
}
export interface ChatPreferences { enabled: boolean; partyOnly: boolean }
export interface ChatLine { readonly sender: EntityRef; readonly name: string; readonly text: string; readonly at: number }
export type ChatError = Refusal | 'invalid' | 'off' | 'party' | 'empty' | 'duplicate' | 'limit' | 'unavailable';
export type ChatResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ChatError };
type State = { account_id: string; enabled: boolean; party_only: boolean; mute_until: string; report_watermark: string; talk: TalkState };
export const MAX_CHAT_TARGETS = 256;
export const MAX_CHAT_AUDIENCE = 2048;
const account = (value: unknown): value is string => typeof value === 'string' && /^g[a-f0-9]{23}$/.test(value);
const timestamp = (value: number) => Number.isSafeInteger(value) && value >= 0;
const publicRef = (ref: EntityRef) => Object.freeze({ area: ref.area, id: ref.id, life: ref.life });
const refKey = (ref: EntityRef) => JSON.stringify([ref.area, ref.id, ref.life]);
const sameParty = (a: ChatParticipant, b: ChatParticipant) => !!a.partyId && a.partyId === b.partyId;
function participant(value: ChatParticipant): boolean {
  const ref = value?.ref;
  return !!value && account(value.accountId) && typeof value.name === 'string' && value.name.length <= 256 && !!ref &&
    typeof ref.area === 'string' && ref.area.length > 0 && ref.area.length <= 128 &&
    Number.isSafeInteger(ref.id) && ref.id > 0 && ref.id <= 0xffffffff && Number.isSafeInteger(ref.life) && ref.life > 0 && ref.life <= 0xffffffff &&
    (value.partyId === undefined || value.partyId === null || typeof value.partyId === 'string' && value.partyId.length > 0 && value.partyId.length <= 128);
}
const fail = (error: ChatError): { ok: false; error: ChatError } => ({ ok: false, error });
const prefs = (row: State) => ({ ok: true as const, enabled: row.enabled, partyOnly: row.party_only });

/** Durable account chat, used by the actual world host. This service owns no sockets or membership. */
export class WorldChatService {
  private readonly pool: Pool;
  private readonly now: () => number;
  constructor(pool: Pool, now: () => number = Date.now) { this.pool = pool; this.now = now; }

  /** Locks account rows in one order, also serializing reports from the same reporter across targets. */
  private async transaction<T extends object>(ids: readonly string[], run: (db: PoolClient, rows: Map<string, State>, now: number) => Promise<ChatResult<T>>): Promise<ChatResult<T>> {
    if (!ids.length || ids.some(id => !account(id))) return fail('invalid');
    let db: PoolClient | undefined;
    try {
      db = await this.pool.connect();
      await db.query('BEGIN');
      // Bound lock/query waits without holding the gameplay loop. Errors roll back before any delivery.
      await db.query("SET LOCAL statement_timeout = '3000ms'; SET LOCAL lock_timeout = '1500ms'");
      const rows = new Map<string, State>();
      for (const id of [...new Set(ids)].sort()) {
        await db.query('INSERT INTO world_chat_accounts(account_id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
        const row = (await db.query<State>('SELECT * FROM world_chat_accounts WHERE account_id=$1 FOR UPDATE', [id])).rows[0];
        rows.set(id, row);
      }
      const now = this.now(); if (!timestamp(now)) throw new Error('invalid clock');
      const result = await run(db, rows, now);
      await db.query(result.ok ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch {
      await db?.query('ROLLBACK').catch(() => {});
      // No request body, name, account, session, cookie or raw DB error reaches logs or presentation.
      return fail('unavailable');
    } finally { db?.release(); }
  }

  preferences(accountId: string): Promise<ChatResult<ChatPreferences>> {
    return this.transaction([accountId], async (_db, rows) => prefs(rows.get(accountId)!));
  }

  setPreferences(accountId: string, change: Partial<ChatPreferences>): Promise<ChatResult<ChatPreferences>> {
    if (!change || typeof change !== 'object' || Array.isArray(change) || !Object.keys(change).length ||
      Object.entries(change).some(([key, value]) => !['enabled', 'partyOnly'].includes(key) || typeof value !== 'boolean')) return Promise.resolve(fail('invalid'));
    // Capture immutable primitives before the first asynchronous operation.
    const { enabled, partyOnly } = change;
    return this.transaction([accountId], async (db, rows) => {
      const before = rows.get(accountId)!;
      const row = (await db.query<State>('UPDATE world_chat_accounts SET enabled=$2, party_only=$3 WHERE account_id=$1 RETURNING *',
        [accountId, enabled ?? before.enabled, partyOnly ?? before.party_only])).rows[0];
      return prefs(row);
    });
  }

  block(accountId: string, target: ChatParticipant, blocked: boolean): Promise<ChatResult> { return this.targetPreference(accountId, target, 'blocked', blocked); }
  mute(accountId: string, target: ChatParticipant, muted: boolean): Promise<ChatResult> { return this.targetPreference(accountId, target, 'muted', muted); }
  private targetPreference(accountId: string, target: ChatParticipant, field: 'blocked' | 'muted', value: boolean): Promise<ChatResult> {
    if (!participant(target) || target.accountId === accountId || typeof value !== 'boolean') return Promise.resolve(fail('invalid'));
    const targetId = target.accountId;
    return this.transaction([accountId], async db => {
      const previous = (await db.query<{ blocked: boolean; muted: boolean }>('SELECT blocked,muted FROM world_chat_targets WHERE owner_account=$1 AND target_account=$2', [accountId, targetId])).rows[0];
      const next = { blocked: previous?.blocked ?? false, muted: previous?.muted ?? false, [field]: value };
      if (!next.blocked && !next.muted) {
        await db.query('DELETE FROM world_chat_targets WHERE owner_account=$1 AND target_account=$2', [accountId, targetId]);
      } else {
        if (!previous && (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM world_chat_targets WHERE owner_account=$1', [accountId])).rows[0].n >= MAX_CHAT_TARGETS) return fail('limit');
        await db.query(`INSERT INTO world_chat_targets(owner_account,target_account,blocked,muted) VALUES($1,$2,$3,$4)
          ON CONFLICT(owner_account,target_account) DO UPDATE SET blocked=EXCLUDED.blocked,muted=EXCLUDED.muted`, [accountId, targetId, next.blocked, next.muted]);
      }
      return { ok: true };
    });
  }

  say(sender: ChatParticipant, raw: unknown, audience: readonly ChatParticipant[], channel: 'area' | 'party' = 'area'): Promise<ChatResult<{ line: ChatLine; recipients: readonly EntityRef[] }>> {
    if (!participant(sender) || typeof raw !== 'string' || raw.length > 4096 || !Array.isArray(audience) || audience.length > MAX_CHAT_AUDIENCE ||
      audience.some(p => !participant(p)) || !['area', 'party'].includes(channel)) return Promise.resolve(fail('invalid'));
    // The host may mutate an actor/party during I/O. Capture this request, then it rechecks lifecycle on completion.
    const from = { ...sender, ref: publicRef(sender.ref) };
    const to = audience.map(p => ({ ...p, ref: publicRef(p.ref) }));
    return this.transaction([from.accountId], async (db, rows, now) => {
      const mine = rows.get(from.accountId)!;
      if (!mine.enabled) return fail('off');
      const partyOnly = channel === 'party' || mine.party_only;
      if (partyOnly && !from.partyId) return fail('party');
      const talk = new Talk(mine.talk), said = talk.say(raw, now);
      if (!said) return fail('empty');
      if ('refused' in said) return fail(said.refused);
      const eligible = to.filter(p => (channel === 'party' || p.ref.area === from.ref.area) && (!partyOnly || sameParty(from, p)));
      const ids = [...new Set(eligible.map(p => p.accountId))];
      const settings = ids.length ? (await db.query<State & { hidden: boolean }>(`SELECT p.account_id,
        COALESCE(c.enabled,true) AS enabled, COALESCE(c.party_only,false) AS party_only,
        COALESCE(t.blocked OR t.muted,false) AS hidden
        FROM unnest($1::text[]) AS p(account_id)
        LEFT JOIN world_chat_accounts c ON c.account_id=p.account_id
        LEFT JOIN world_chat_targets t ON t.owner_account=p.account_id AND t.target_account=$2`, [ids, from.accountId])).rows : [];
      const by = new Map(settings.map(row => [row.account_id, row]));
      const recipients = new Map<string, EntityRef>();
      for (const p of eligible) {
        const preference = by.get(p.accountId)!;
        if (preference.enabled && !preference.hidden && (!preference.party_only || sameParty(from, p)) && Number(mine.mute_until) <= now) recipients.set(refKey(p.ref), p.ref);
      }
      // Legacy moderation is a shadow mute: a muted sender sees their own filtered line only.
      recipients.set(refKey(from.ref), from.ref);
      await db.query('UPDATE world_chat_accounts SET talk=$2::jsonb WHERE account_id=$1', [from.accountId, JSON.stringify(talk.snapshot())]);
      return { ok: true, line: Object.freeze({ sender: from.ref, name: shownName(from.name), text: said.text, at: now }), recipients: Object.freeze([...recipients.values()]) };
    });
  }

  report(reporter: ChatParticipant, target: ChatParticipant, room: string, reason: Reason): Promise<ChatResult<{ muted: boolean }>> {
    if (!participant(reporter) || !participant(target) || reporter.accountId === target.accountId || !reasonOf(reason) ||
      typeof room !== 'string' || room.length === 0 || room.length > 128 || /[\u0000-\u001f\u007f]/.test(room)) return Promise.resolve(fail('invalid'));
    const from = { ...reporter, ref: publicRef(reporter.ref) }, to = { ...target, ref: publicRef(target.ref) };
    return this.transaction([from.accountId, to.accountId], async (db, rows, now) => {
      const state = rows.get(to.accountId)!;
      const cutoff = now - CHAT.reportMs;
      const reports = await db.query<{ duplicate: boolean; n: number }>(`SELECT
        COALESCE(bool_or(target_account=$2 AND id>$4::bigint),false) AS duplicate, count(*)::int AS n
        FROM chat_reports WHERE reporter_account=$1 AND created>to_timestamp($3::double precision/1000)`,
      [from.accountId, to.accountId, cutoff, state.report_watermark]);
      if (reports.rows[0].duplicate) return fail('duplicate');
      if (reports.rows[0].n >= CHAT.reportsEach) return fail('limit');
      const lines = new Talk(state.talk).snapshot().lines;
      const inserted = (await db.query<{ id: string }>(`INSERT INTO chat_reports(created,reporter_session,reporter_account,reporter_name,
        target_session,target_account,target_name,target_lines,room,reason,muted)
        VALUES(to_timestamp($1::double precision/1000),$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,false) RETURNING id`,
      [now, refKey(from.ref), from.accountId, shownName(from.name), refKey(to.ref), to.accountId, shownName(to.name), JSON.stringify(lines), room, reason])).rows[0];
      const count = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM
        (SELECT DISTINCT reporter_account FROM chat_reports WHERE target_account=$1 AND id>$2::bigint
          AND created>to_timestamp($3::double precision/1000) LIMIT $4) AS reporters`,
      [to.accountId, state.report_watermark, cutoff, CHAT.reporters])).rows[0].n;
      const muted = count >= CHAT.reporters && Number(state.mute_until) <= now;
      if (muted) {
        await db.query('UPDATE world_chat_accounts SET mute_until=$2,report_watermark=$3 WHERE account_id=$1', [to.accountId, now + CHAT.muteMs, inserted.id]);
        await db.query('UPDATE chat_reports SET muted=true WHERE id=$1', [inserted.id]);
      }
      return { ok: true, muted };
    });
  }
}
