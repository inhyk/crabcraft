import type { Pool } from 'pg';
import type { Report } from '../chat/safety.ts';

/** Writes a chat report to chat_reports (migrations/003_chat_reports.sql). */
export async function storeReport(db: Pool, r: Report) {
  await db.query(`INSERT INTO chat_reports (created, reporter_session, reporter_name, target_session, target_name, target_lines, room, reason, muted)
    VALUES (to_timestamp($1::double precision / 1000), $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
  [r.at, r.reporter.session, r.reporter.name, r.target.session, r.target.name, JSON.stringify(r.target.lines), r.room, r.reason, r.muted]);
}
