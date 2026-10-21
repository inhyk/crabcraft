// node tools/qa-chat-safety.mjs — two guests in one public shard in headless Chrome against server-dist/main.mjs and a
// throwaway Postgres: profanity and a phone number arrive masked (log and bubble), the safety line shows once, a report
// is stored in chat_reports, block hides the other's chat and bubble, and "Show public chat" off hides public chat.
// The server and `vite preview` of dist/ run on free ports; the pages' /multiplayer socket is pointed at the server.
// Run `pnpm build` first. Screenshots go to CC_QA_SHOTS (default tmp/qa).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { launchBrowser } from './lib/browser.mjs';
import { freePort, startPostgres } from '../server/node/local-postgres.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), shots = process.env.CC_QA_SHOTS ?? join(root, 'tmp/qa'), shot = name => join(shots, name);
mkdirSync(shots, { recursive: true });
execFileSync(process.execPath, [join(root, 'server/node/build.mjs')], { stdio: 'inherit' });
const postgres = await startPostgres(), db = new pg.Pool({ connectionString: postgres.url });
const serverPort = await freePort(), previewPort = await freePort(), base = `http://127.0.0.1:${previewPort}`;
const children = [];
async function run(args, env, ready) {
  const child = spawn(process.execPath, args, { cwd: root, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  for (const until = Date.now() + 30000; !ready.test(out); await new Promise(r => setTimeout(r, 100))) if (child.exitCode !== null || Date.now() > until) throw new Error(`${args[0]} did not start:\n${out}`);
  return child;
}

let browser; const pageErrors = [];
async function open(name) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => pageErrors.push(`${name}: ${e.message}`));
  await p.addInitScript(([name, port]) => {
    localStorage.setItem('cc.quality', 'low'); localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name }));
    const WS = window.WebSocket; window.WebSocket = class extends WS { constructor(url, protocols) { super(String(url).includes('/multiplayer') ? `ws://127.0.0.1:${port}/multiplayer` : url, protocols); } };
  }, [name, serverPort]);
  await p.goto(base + '/?screen=game'); await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded, null, { timeout: 90000 });
  await p.evaluate(() => { document.querySelector('.mp-panel').open = true; });
  return p;
}
const together = p => p.waitForFunction(() => { const m = window.app.current.game.multiplayer; return m.ws?.readyState === 1 && m.shard && [...m.peers.values()].every(x => x.unit) && m.peers.size === 1; }, null, { timeout: 30000, polling: 100 });
const say = async (p, text) => { await p.locator('.mp-panel input[aria-label="채팅 메시지"]').fill(text); await p.locator('.mp-panel input[aria-label="채팅 메시지"]').press('Enter'); await p.waitForTimeout(750); };
/** Chat lines in the panel as shown (hidden ones flagged) and the other players' speech bubbles (not the villagers'). */
const view = p => p.evaluate(() => ({
  lines: [...document.querySelectorAll('.mp-log > div')].map(d => (d.hidden ? '[hidden] ' : '') + d.textContent),
  bubbles: window.app.current.game.hud.bubbles.list.filter(b => b.unit.kind === 'remote' && b.el.isConnected).map(b => b.inner.textContent),
}));
const lastLine = async (p, text) => (await view(p)).lines.find(l => l.includes(text));

try {
  await run([join(root, 'server-dist/main.mjs')], { PORT: String(serverPort), HOST: '127.0.0.1', DATABASE_URL: postgres.url }, /listening on/);
  await run([join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], {}, new RegExp(String(previewPort)));
  browser = await launchBrowser({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const kid = await open('Kind crab'), rude = await open('Rude crab');
  await Promise.all([together(kid), together(rude)]);

  // The safety line, once: the first time the chat input gets focus in the public world.
  const input = kid.locator('.mp-panel input[aria-label="채팅 메시지"]');
  await input.focus(); await kid.locator('.mp-panel > summary').focus(); await input.focus();
  const safety = await kid.locator('.mp-log .mp-safety').allTextContents();
  assert.deepEqual(safety, ['모르는 사람에게 이름, 학교, 전화번호를 알려 주지 마세요.']);
  await kid.screenshot({ path: shot('chat-safety-1-safety-line.png') });
  console.log('SAFETY_LINE_ONCE_PASS', safety);

  // Profanity and a phone number arrive masked, in the log and in the bubble.
  await say(rude, '시발 너 바보야');
  await kid.waitForFunction(() => document.querySelector('.mp-log')?.textContent.includes('Rude crab: ** 너 바보야'), null, { timeout: 5000 });
  await say(rude, '내 번호 010-1234-5678 이야');
  await kid.waitForFunction(() => document.querySelector('.mp-log')?.textContent.includes('내 번호 ************* 이야'), null, { timeout: 5000 });
  const masked = await view(kid);
  assert.ok(masked.bubbles.includes('내 번호 ************* 이야'), JSON.stringify(masked));
  assert.ok(!JSON.stringify(masked).includes('시발') && !JSON.stringify(masked).includes('010-1234'), JSON.stringify(masked));
  await kid.screenshot({ path: shot('chat-safety-2-masked.png') });
  console.log('MASKED_PASS', masked);

  // Report: the name in a chat line opens block and report; the report lands in Postgres.
  await kid.locator('.mp-log .mp-who', { hasText: 'Rude crab' }).first().click();
  await kid.locator('.mp-act .mp-report').click();
  await kid.screenshot({ path: shot('chat-safety-3-report-reasons.png') });
  await kid.locator('.mp-act button', { hasText: '개인정보 요구' }).click();
  await kid.waitForFunction(() => document.querySelector('.mp-log')?.textContent.includes('신고를 보냈어요.'), null, { timeout: 5000 });
  let rows = [];
  for (const until = Date.now() + 5000; !rows.length && Date.now() < until; await new Promise(r => setTimeout(r, 100))) ({ rows } = await db.query('SELECT * FROM chat_reports'));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].reason, rows[0].reporter_name, rows[0].target_name, rows[0].muted], ['personal', 'Kind crab', 'Rude crab', false]);
  assert.deepEqual(rows[0].target_lines.map(l => l.text), ['** 너 바보야', '내 번호 ************* 이야']);
  const lister = execFileSync(process.execPath, [join(root, 'server-dist/reports.mjs'), '--hours', '1'], { env: { PATH: process.env.PATH, DATABASE_URL: postgres.url }, encoding: 'utf8' });
  assert.match(lister, /chat reports in the last 1 h: 1/);
  console.log('REPORT_STORED_PASS', { id: rows[0].id, reason: rows[0].reason, room: rows[0].room, lines: rows[0].target_lines.length });
  console.log(lister);

  // Block: from the roster this time. Their lines and bubble go; they stay a crab.
  await kid.locator('.mp-roster .mp-who', { hasText: 'Rude crab' }).click();
  await kid.locator('.mp-act .mp-block').click();
  await say(rude, 'hello again');
  await rude.waitForFunction(() => document.querySelector('.mp-log')?.textContent.includes('hello again'), null, { timeout: 5000 });
  await kid.waitForTimeout(500);
  const blocked = await view(kid);
  assert.ok(blocked.lines.filter(l => l.includes('Rude crab:')).every(l => l.startsWith('[hidden] ')), JSON.stringify(blocked));
  assert.ok(blocked.lines.some(l => l === '[hidden] Rude crab: hello again'), JSON.stringify(blocked));
  assert.deepEqual(blocked.bubbles, []);
  assert.equal(await kid.evaluate(() => [...window.app.current.game.multiplayer.peers.values()][0].unit.hidden), false);
  assert.match(await kid.locator('.mp-blocked summary').textContent(), /차단한 모험가 1명/);
  assert.deepEqual(JSON.parse(await kid.evaluate(() => localStorage.getItem('cc.chat.blockedNames'))), ['Rude crab']);
  await kid.evaluate(() => { document.querySelector('.mp-blocked').open = true; });
  await kid.screenshot({ path: shot('chat-safety-4-blocked.png') });
  console.log('BLOCK_PASS', blocked);

  // Unblock, then turn public chat off in the Esc menu.
  await kid.locator('.mp-blocked-row button').click();
  assert.equal(await lastLine(kid, 'hello again'), 'Rude crab: hello again');
  await kid.evaluate(() => { const menu = window.app.current.game.hud.menu; menu.show(); menu.settings(); });
  await kid.locator('.menu .row', { hasText: '공개 채팅 보기' }).locator('button', { hasText: '끄기' }).click();
  await kid.screenshot({ path: shot('chat-safety-5-settings.png') });
  await kid.evaluate(() => window.app.current.game.hud.menu.close());
  await say(rude, 'can you see this');
  await rude.waitForFunction(() => document.querySelector('.mp-log')?.textContent.includes('can you see this'), null, { timeout: 5000 });
  await kid.waitForTimeout(500);
  const off = await view(kid);
  assert.equal(await lastLine(kid, 'can you see this'), '[hidden] Rude crab: can you see this');
  assert.ok(off.lines.filter(l => l.includes('Rude crab:')).every(l => l.startsWith('[hidden] ')), JSON.stringify(off));
  assert.deepEqual(off.bubbles, []);
  assert.equal(await input.isDisabled(), true);
  assert.match(await input.getAttribute('placeholder'), /공개 채팅이 꺼져 있어요/);
  assert.ok(off.lines.includes('공개 채팅을 껐어요. Esc 메뉴의 설정에서 다시 켤 수 있어요.'), JSON.stringify(off));
  assert.equal(await kid.evaluate(() => localStorage.getItem('cc.chat.public')), 'off');
  await kid.screenshot({ path: shot('chat-safety-6-public-chat-off.png') });
  await rude.screenshot({ path: shot('chat-safety-7-other-player.png') });
  console.log('PUBLIC_CHAT_OFF_PASS', off);
  assert.deepEqual(pageErrors, []);
  console.log(`PASS: safety line once; profanity and phone number masked in log and bubble; report stored (chat_reports id ${rows[0].id}) and listed; block hides chat and bubble and is remembered by name; public chat off hides public chat; page errors 0; screenshots in ${shots}`);
} catch (e) {
  for (const [i, page] of (browser?.contexts() ?? []).flatMap(c => c.pages()).entries()) await page.screenshot({ path: shot(`chat-safety-failure-${i}.png`) }).catch(() => {});
  throw e;
} finally { await browser?.close(); for (const c of children) c.kill('SIGTERM'); await db.end(); postgres.stop(); }
