// Lists recent chat reports, newest first. Read only. Bundled to server-dist/reports.mjs by build.mjs.
//   node server-dist/reports.mjs [--hours 24] [--limit 50] [--json]
// On the VM, as the service user with the service's env file:
//   sudo -u crabcraft node --env-file=/etc/crabcraft/prod.env /srv/crabcraft/prod/current/server-dist/reports.mjs --hours 48
import pg from 'pg';

const REASONS = { abuse: '욕설 abuse', personal: '개인정보 요구 personal info', harassment: '괴롭힘 harassment', other: '기타 other' };
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : fallback; };
const hours = option('--hours', 24), limit = option('--limit', 50), json = args.includes('--json');
if (args.includes('--help') || !(hours > 0) || !Number.isInteger(limit) || limit < 1) {
  console.log('usage: node reports.mjs [--hours 24] [--limit 50] [--json]  (DATABASE_URL must be set)');
  process.exit(args.includes('--help') ? 0 : 2);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let rows;
try {
  await client.query('BEGIN READ ONLY');
  ({ rows } = await client.query(`SELECT id, created, reporter_session, reporter_account, reporter_name, target_session, target_name, target_lines, room, reason, muted
    FROM chat_reports WHERE created > now() - make_interval(secs => $1) ORDER BY created DESC, id DESC LIMIT $2`, [hours * 3600, limit]));
  await client.query('COMMIT');
} finally { await client.end(); }

if (json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
const kst = (d, time = false) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', ...(time ? {} : { year: 'numeric', month: '2-digit', day: '2-digit' }), hour: '2-digit', minute: '2-digit', ...(time ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(d);
const short = s => s.length > 12 ? s.slice(0, 12) + '…' : s;
console.log(`chat reports in the last ${hours} h: ${rows.length}${rows.length === limit ? ` (first ${limit}; use --limit)` : ''}, times in KST`);
for (const r of rows) {
  console.log(`\n#${r.id}  ${kst(r.created)}  room ${r.room}  ${REASONS[r.reason] ?? r.reason}${r.muted ? '  -> muted for 30 min' : ''}`);
  console.log(`  reporter  ${r.reporter_name}  (session ${short(r.reporter_session)}${r.reporter_account ? `, account ${r.reporter_account}` : ''})`);
  console.log(`  target    ${r.target_name}  (session ${short(r.target_session)})`);
  if (!r.target_lines.length) console.log('    (no chat lines)');
  for (const line of r.target_lines) console.log(`    ${kst(new Date(line.at), true)}  ${line.text}`);
}
