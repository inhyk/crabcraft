// The King's Road zone line on a server world (Chrome for Testing -> loopback host -> actual Area, disposable local PG, never
// the production VM). The server does not host Tidecrown yet, so a new level-1 character who walks (Shift+W with the
// right mouse button steering, no teleport) from the spawn up the road across the line is not taken there: the notice
// shows and the server walks the player back south of the line; the world and the quest chapter do not change.
// Usage: node tools/qa-tidecrown-road-server.mjs   (WORLD_QA_BROWSER_PORT, WORLD_QA_HOST_PORT, CC_QA_SHOTS)
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launchBrowser } from './lib/browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserPort = Number(process.env.WORLD_QA_BROWSER_PORT ?? 5277), hostPort = Number(process.env.WORLD_QA_HOST_PORT ?? 5288), clientOrigin = `http://127.0.0.1:${browserPort}`;
if (![browserPort, hostPort].every((p) => Number.isInteger(p) && p > 0 && p < 65536)) throw new Error('Invalid loopback QA port');
const shots = process.env.CC_QA_SHOTS ?? join(root, 'tmp/qa/tidecrown-road');
await mkdir(shots, { recursive: true });
const scratch = await mkdtemp('/private/tmp/crabcraft-road-server-');
const metadataPath = join(scratch, 'host.json');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let host, server, browser;
try {
  host = spawn(process.execPath, ['tools/qa-world-host-server.mjs', '--port', String(hostPort), '--metadata', metadataPath, '--client-origin', clientOrigin, '--world', 'w1'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  // Launcher errors may include driver configuration; print no launcher output or credentials.
  host.stderr.on('data', () => {});
  let metadata;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); break; }
    catch { if (host.exitCode !== null) throw new Error('QA host exited before readiness'); await pause(100); }
  }
  if (!metadata) throw new Error('QA host readiness timed out');
  const origin = new URL(metadata.origin);
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || metadata.clientOrigin !== clientOrigin) throw new Error('QA host must use the expected loopback origins');
  server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: browserPort, strictPort: true, proxy: { '/world': { target: origin.origin, ws: true }, '/api/account': { target: origin.origin } } }, logLevel: 'error' });
  await server.listen();
  browser = await launchBrowser({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.grantPermissions(['local-network-access'], { origin: clientOrigin });
  await context.addCookies([{ name: metadata.cookie.name, value: metadata.cookie.value, domain: '127.0.0.1', path: metadata.cookie.path, httpOnly: true, sameSite: 'Strict', secure: false }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|tidecrown|zone line/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.addInitScript(() => { localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.hintsSeen', '1'); });
  await page.goto(`${clientOrigin}/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`, { waitUntil: 'load' });
  await page.locator('.launch-notice-start').click();
  await page.waitForFunction(() => window.__ready && window.cc?.game?.server?.ready, undefined, { timeout: 120000 });
  await page.locator('.loading').waitFor({ state: 'detached' });

  const start = await page.evaluate(async () => {
    const g = window.cc.game, w = g.world, L = await import('/src/world/layout.ts');
    window.__L = L; window.__kings = g.zoneLines.lines[0];
    // A path over World I's own collision from where the player stands to the road's first point, away from hostiles.
    const u = g.player.unit, r = u.radius + 0.15, out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    const hostiles = g.units.filter((h) => h.hostile && h.alive && !h.hidden).map((h) => [h.pos.x, h.pos.z]);
    const goal = L.KINGS_ROAD.points[0], box = { x0: -40, z0: -60, nx: 70, nz: 90 };
    const free = (x, z) => { w.resolveCollision(x, z, r, out); return Math.hypot(out.x - x, out.y - z) < 0.02 && hostiles.every(([hx, hz]) => Math.hypot(hx - x, hz - z) > 13); };
    const key = (i, j) => j * box.nx + i, cell = (x, z) => [Math.round(x - box.x0), Math.round(z - box.z0)];
    const [si, sj] = cell(u.pos.x, u.pos.z), [gi, gj] = cell(goal[0], goal[1]);
    const prev = new Map([[key(si, sj), -1]]), queue = [[si, sj]];
    for (let q = 0; q < queue.length && !prev.has(key(gi, gj)); q++) {
      const [i, j] = queue[q];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj, k = key(ni, nj);
        if (ni < 0 || nj < 0 || ni >= box.nx || nj >= box.nz || prev.has(k) || !free(box.x0 + ni, box.z0 + nj)) continue;
        prev.set(k, key(i, j)); queue.push([ni, nj]);
      }
    }
    if (!prev.has(key(gi, gj))) return { error: 'no path from the spawn to the road' };
    const path = [];
    for (let k = key(gi, gj); k !== -1; k = prev.get(k)) path.unshift([box.x0 + (k % box.nx), box.z0 + Math.floor(k / box.nx)]);
    window.__route = [[u.pos.x, u.pos.z], ...path.filter((_, i) => i % 3 === 0), ...L.KINGS_ROAD.points.map(([x, z]) => [x, z])];
    window.__steer = (pts, ahead) => {
      const px = u.pos.x, pz = u.pos.z, segs = [];
      let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) { const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (len > 1e-6) segs.push({ a: pts[i], b: pts[i + 1], s: acc, len }); acc += len; }
      const last = window.__steerS ?? null;
      let best = Infinity, bestS = 0;
      for (const q of segs) {
        if (last !== null && (q.s + q.len < last - 4 || q.s > last + 12)) continue;
        const ex = q.b[0] - q.a[0], ez = q.b[1] - q.a[1], t = Math.max(0, Math.min(1, ((px - q.a[0]) * ex + (pz - q.a[1]) * ez) / (q.len * q.len)));
        const d = Math.hypot(px - q.a[0] - ex * t, pz - q.a[1] - ez * t);
        if (d < best) { best = d; bestS = q.s + q.len * t; }
      }
      window.__steerS = Math.max(last ?? 0, bestS);
      const s = Math.min(acc, window.__steerS + ahead);
      const q = segs.find((q) => q.s + q.len >= s) ?? segs[segs.length - 1], k = Math.min(1, (s - q.s) / q.len);
      g.follow.yaw = Math.atan2(q.a[0] + (q.b[0] - q.a[0]) * k - px, q.a[1] + (q.b[1] - q.a[1]) * k - pz) - Math.PI;
      return window.__steerS;
    };
    return { world: g.server.diagnostics().world, quest: g.quests.chapter, chapter: g.world2.chapter, pos: [u.pos.x, u.pos.z], route: window.__route.length, hostiles: hostiles.length, line: L.KINGS_ROAD_LINE };
  });
  console.log(JSON.stringify(start));
  assert.equal(start.error, undefined, start.error);
  assert.equal(start.world, 'w1');

  const t0 = Date.now();
  await page.mouse.move(800, 450); await page.mouse.down({ button: 'right' }); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(() => { window.__steer(window.__route, 4); return window.__kings.fired > 0 || !window.cc.game.player.unit.alive; }, undefined, { timeout: 150000, polling: 'raf' });
  } catch (error) {
    console.error(JSON.stringify(await page.evaluate(() => ({ pos: window.cc.game.player.unit.pos.toArray(), s: window.__steerS, alive: window.cc.game.player.unit.alive }))));
    throw error;
  } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); await page.mouse.up({ button: 'right' }); }
  const walkMs = Date.now() - t0;
  const crossed = await page.evaluate(() => { const g = window.cc.game, u = g.player.unit; return { alive: u.alive, z: u.pos.z, fired: window.__kings.fired }; });
  assert.ok(crossed.alive, 'the character reached the line alive');
  await page.screenshot({ path: `${shots}/5-server-line-turned-back.png` });
  // The server walks the player back south of the line (the client only steers its held input).
  await page.waitForFunction((lineZ) => window.cc.game.server.diagnostics().position[2] > lineZ + 1.8, start.line.a[1], { timeout: 5000 });
  await pause(1500);
  const after = await page.evaluate(() => {
    const g = window.cc.game, d = g.server.diagnostics();
    return { world: d.world, position: d.position, quest: g.quests.chapter, chapter: g.world2.chapter, inTidecrown: g.world2.inTidecrown, built: !!g.world2.tidecrown, w1: g.world.root.visible, fired: window.__kings.fired, held: g.zoneLines.serverHeld(), chat: [...document.querySelectorAll('.chat .line.sys')].map((e) => e.textContent).join('\n') };
  });
  console.log(JSON.stringify({ walkMs, crossed, after: { ...after, chat: after.chat.slice(-200) } }));
  assert.equal(after.world, 'w1', 'still World I on the server');
  assert.equal(after.quest, start.quest, 'the quest chapter is unchanged');
  assert.equal(after.chapter, 1);
  assert.deepEqual([after.inTidecrown, after.built, after.w1], [false, false, true], 'Tidecrown is neither entered nor built');
  assert.equal(after.fired, 1, 'the line fired once');
  assert.ok(after.position[2] > start.line.a[1] + 1.8, `the server position is back south of the line: ${after.position}`);
  assert.equal(after.held, null, 'the walk back has ended');
  assert.ok(after.chat.includes('타이드크라운으로 가는 길은 곧 열려요'), 'the not-yet-open notice is in the chat');
  assert.deepEqual(errors, []);
  console.log(`PASS server world: walked ${(walkMs / 1000).toFixed(1)} s from the spawn up the King's Road; the line fired once, showed the notice and the server walked the player back to z ${after.position[2].toFixed(1)}; world, chapter and quest unchanged; zero page errors`);
} finally {
  if (browser) { for (const context of browser.contexts()) for (const page of context.pages()) await page.evaluate(() => window.cc?.game?.server?.client.dispose()).catch(() => {}); await pause(150); }
  await browser?.close(); await server?.close();
  if (host) {
    host.kill('SIGTERM');
    for (let attempt = 0; host.exitCode === null && attempt < 100; attempt++) await pause(100);
    if (host.exitCode === null) host.kill('SIGKILL');
  }
  await rm(scratch, { recursive: true, force: true });
}
