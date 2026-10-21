// The King of Tidecrown and his kingdom requests (real Chrome on the dev server, a new save). The king stands at the
// head of the King's Stair before the ward gate, facing down it, clear of the way through the gate and of the
// residents, as a keeper (not a game unit); F there opens his dialogue, which offers the first request to a new save.
// Accepting it and doing it in a world counts: real kills through the game's combat (a kill credited to nobody, or one
// a relay member was not fighting, does not), and for the second request an arrival by the captain's ship. Turning each
// in pays exactly the stated coins and XP once (the growth blessing does not multiply it; a second turn-in pays
// nothing). A reload keeps the log in the journey save and pays nothing again; an old save without the field, and one
// with a broken field, load with a fresh log. Then on a server world (a loopback host with a disposable PG, as
// qa-tidecrown-hub) no king is built. Zero page errors throughout.
// Writes the 1600x900 shots (the king before the gate, his crown, his offer, the tracker, turn-in and thanks) to
// CC_QA_SHOTS (default tmp/king-shots).
// Usage: CC_QA_BASE=http://127.0.0.1:5271 node tools/qa-tidecrown-king.mjs   (CC_QA_SERVER=0 skips the server world;
//   WORLD_QA_BROWSER_PORT, WORLD_QA_HOST_PORT pick its ports)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib/browser.mjs';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5271';
const shots = process.env.CC_QA_SHOTS ?? join(root, 'tmp/king-shots');
await mkdir(shots, { recursive: true });
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'];
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|tidecrown|portal|hub|keeper|king|kingdom|journey/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
};
const NAME = 'King visitor';

const browser = await launchBrowser({ headless: true, args });
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(90000);
  watch(p);
  await p.routeWebSocket('**/multiplayer*', (ws) => ws.close());
  await p.addInitScript((name) => {
    if (!localStorage.getItem('cc.spec')) localStorage.setItem('cc.spec', JSON.stringify({ race: 'orc', sex: 'female', classId: 'warrior', shell: 0, crest: 0, led: 0, name }));
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'high');
  }, NAME);
  const boot = async () => {
    await p.locator('.launch-notice-start').click();
    await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
    await p.evaluate(async () => {
      const g = window.app.current.game;
      g.god = true;
      const K = await import('/src/game/tidecrown/king.ts'), G = await import('/src/sim/world/tidecrownGround.ts');
      const journeyKey = () => { const s = g.player.unit.rig.spec; return `cc.journey.v1:${s.race}:${s.sex}:${s.classId}:${s.name}`; };
      window.__K = {
        K, G,
        log: () => {
          const k = g.world2.hub.kingdom, cur = k.current;
          return { offer: k.offer?.id ?? null, current: cur?.id ?? null, ready: k.ready, lines: cur ? k.lines(cur) : [], snapshot: k.snapshot() ?? null };
        },
        purse: () => ({ coins: g.player.coins, xp: g.player.xp }),
        saved: () => JSON.parse(localStorage.getItem(journeyKey()) ?? 'null'),
        journeyKey,
        state: () => ({ in: g.world2.inTidecrown, chapter: g.world2.chapter }),
        cam: (cam, at) => { g.follow.update = function () { this.camera.position.set(...cam); this.camera.lookAt(...at); }; },
        free: () => { delete g.follow.update; },
        // Stand `d` in front of a post facing it (the camera behind).
        face: (x, z, yaw, d) => {
          const px = x + Math.sin(yaw) * d, pz = z + Math.cos(yaw) * d;
          g.player.setTarget(null);
          g.player.unit.teleport(g.world, px, pz, yaw + Math.PI);
          g.follow.yaw = yaw;
          g.follow.cut();
        },
        text: () => document.querySelector('.dlg-text')?.textContent ?? '',
        dialogue: () => ({ name: g.hud.dialogue.unit?.name ?? null, text: document.querySelector('.dlg')?.innerText ?? '' }),
        buttons: () => [...document.querySelectorAll('.dlg-buttons .cc-btn')].map((b) => b.textContent),
        prompt: () => document.querySelector('.prompt.on')?.textContent ?? '',
        tracker: () => document.querySelector('.qt-kingdom')?.textContent ?? '',
        // Enemies this world has alive (no adds, no dungeon sentinels).
        foes: () => g.enemies.filter((e) => e.state !== 'gone' && e.unit.alive && !e.unit.hidden && !e.isAdd && !e.isDungeonOnly),
      };
    });
  };
  const reveal = async () => {
    await p.locator('.dlg-text').click();
    await p.waitForFunction(() => !window.app.current.game.hud.dialogue.typing);
  };
  const travelled = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 120000 });
  const intoCapital = async () => {
    // World I's crown portal by F, as a player arrives (the quay before the sea gate).
    const w1 = await p.evaluate(() => window.app.current.game.world2.hub.crownPortals.find((r) => r.chapter === 1));
    // The portals wait for a fight to end: the pack the kills woke goes home first.
    await p.evaluate(() => { for (const e of window.app.current.game.enemies) if (e.state !== 'gone' && e.unit.alive && e.state !== 'idle') e.despawn(); });
    await p.waitForFunction(() => { const g = window.app.current.game; return !g.player.inCombat && !g.encounter.engaged; }, null, { timeout: 30000 });
    await p.evaluate(({ x, z, yaw }) => window.__K.face(x, z, yaw, 3), w1);
    await p.waitForFunction(() => window.__K.prompt().includes('타이드크라운'));
    await p.keyboard.press('KeyF');
    await travelled(() => window.app.current.game.world2.inTidecrown && !document.querySelector('.tidecrown-loading'));
    // The zone banner fades before the shots.
    await p.waitForTimeout(4500);
  };
  const toKing = async () => {
    await p.evaluate(() => { const { x, z, yaw } = window.__K.K.KING_POST; window.__K.face(x, z, yaw, 3); });
    await p.waitForFunction(() => window.__K.prompt().includes('마리너스 왕에게 말 걸기'));
    await p.keyboard.press('KeyF');
    await p.waitForFunction(() => window.app.current.game.hud.dialogue.unit?.name === '마리너스 왕');
    await reveal();
    return p.evaluate(() => ({ ...window.__K.dialogue(), buttons: window.__K.buttons() }));
  };
  const sailHome = async () => {
    // The captain's ship to World I, through the UI.
    await p.evaluate(() => window.__K.face(261, 8.9, -Math.PI / 2, 3.6));
    await p.waitForFunction(() => window.__K.prompt().includes('아라 선장에게 말 걸기'));
    await p.keyboard.press('KeyF');
    await p.getByRole('button', { name: '월드 I · 클로헤이븐', exact: true }).click();
    await p.getByRole('button', { name: '출항하기', exact: true }).click();
    await travelled(() => !window.app.current.game.world2.inTidecrown && !document.querySelector('.tidecrown-loading'));
    await p.waitForTimeout(600);
  };

  await p.goto(base + '/?screen=game');
  await boot();
  const fresh = await p.evaluate(() => window.__K.log());
  assert.deepEqual(fresh, { offer: 'patrol', current: null, ready: false, lines: [], snapshot: null });
  assert.equal(await p.evaluate(() => 'kingdom' in (window.__K.saved() ?? {})), false, 'an untouched log adds nothing to the save');

  // 1. The king at the head of the King's Stair, a keeper rather than a game unit, clear of the routes and the residents.
  await intoCapital();
  const king = await p.evaluate(() => {
    const g = window.app.current.game, { G, K } = window.__K, u = g.world2.hub.units.find((v) => v.npcId === 'tc-king');
    const [t, s] = G.tcAxisCoords(u.pos.x, u.pos.z), yaw = Math.atan2(-G.TC_AXIS.ux, -G.TC_AXIS.uz);
    const people = g.world2.tidecrownPeople.people.flatMap((r) => [r.home, r.end]);
    return {
      t: +t.toFixed(2), s: +s.toFixed(2), y: +u.pos.y.toFixed(2), r: +u.radius.toFixed(2), unit: g.units.includes(u), hidden: u.hidden, crown: !!u.rig.root.getObjectByName('king-crown'),
      yawErr: +Math.abs(Math.atan2(Math.sin(u.yaw - yaw), Math.cos(u.yaw - yaw))).toFixed(3), post: K.KING_POST,
      resident: +Math.min(...people.map((q) => Math.hypot(q.x - u.pos.x, q.z - u.pos.z))).toFixed(1),
      plate: g.hud.plates.also.has(u), marker: g.world2.hub.markers().some((m) => m.label === '왕'),
    };
  });
  assert.ok(!king.unit && !king.hidden && king.crown && king.plate && king.marker, JSON.stringify(king));
  assert.ok(king.t > 201 && king.t < 205.3 - king.r && king.y > 39, `on the stair head before the ward gate: ${JSON.stringify(king)}`);
  assert.ok(Math.abs(king.s) - king.r >= 3, `clear of the gate's passage (|s| < 3): ${JSON.stringify(king)}`);
  assert.ok(king.yawErr < 0.05, `facing down the stair: ${JSON.stringify(king)}`);
  assert.ok(king.resident > 10, `clear of the residents (nearest ${king.resident} m)`);
  console.log(`PASS the king stands at the stair head (axis t ${king.t}, side ${king.s}, y ${king.y}) before the ward gate, facing down the stair, crowned, plated and on the minimap; not a game unit; ${king.resident} m from the nearest resident`);
  await p.evaluate(() => {
    const g = window.app.current.game, { G } = window.__K, h = (x, z) => g.world2.tidecrown.height(x, z);
    const [cx, cz] = G.tcAxis(194.5, 7.2), [ax, az] = G.tcAxis(204.5, 2.6);
    window.__K.cam([cx, h(cx, cz) + 3.6, cz], [ax, h(ax, az) + 2.3, az]);
    const [px, pz] = G.tcAxis(185, -3);
    g.player.unit.teleport(g.world, px, pz, Math.atan2(G.TC_AXIS.ux, G.TC_AXIS.uz));
  });
  await p.waitForTimeout(4500);
  await p.screenshot({ path: `${shots}/king-before-the-gate.png` });
  // His crown, close.
  await p.evaluate(() => {
    const g = window.app.current.game, { x, z, yaw } = window.__K.K.KING_POST, y = g.world2.tidecrown.height(x, z);
    const cx = x + Math.sin(yaw) * 3.1 + Math.cos(yaw) * 0.9, cz = z + Math.cos(yaw) * 3.1 - Math.sin(yaw) * 0.9;
    window.__K.cam([cx, y + 2.1, cz], [x, y + 1.25, z]);
  });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${shots}/king-crown.png` });
  await p.evaluate(() => window.__K.free());

  // 2. F opens his dialogue: the first request offered to a new save, with its objective and reward.
  const offer = await toKing();
  assert.ok(offer.text.includes('어서 오너라') && offer.text.includes('왕국 의뢰 · 왕국 순찰') && offer.text.includes('적 물리치기: 0/5') && offer.text.includes('60 코인') && offer.text.includes('150 XP'), offer.text);
  assert.deepEqual(offer.buttons, ['의뢰 받기', '다음에 할게요']);
  await p.screenshot({ path: `${shots}/king-offer.png` });
  console.log('PASS F at the king opens his dialogue: the royal greeting and the first request (Royal Patrol, defeat 5 enemies, 60 coins and 150 XP)');
  await p.evaluate(async () => { const { setLanguage } = await import('/src/i18n.ts'); setLanguage('en'); window.app.current.game.hud.dialogue.close(); });
  const en = await (async () => {
    await p.keyboard.press('KeyF');
    await p.waitForFunction(() => window.app.current.game.hud.dialogue.unit?.name === 'King Marinus');
    await reveal();
    return p.evaluate(() => ({ ...window.__K.dialogue(), buttons: window.__K.buttons() }));
  })();
  assert.ok(en.text.includes('Royal Patrol') && en.text.includes('Defeat enemies: 0/5') && en.text.includes('60 coins'), en.text);
  assert.deepEqual(en.buttons, ['Accept', 'Not now']);
  await p.evaluate(async () => { const { setLanguage } = await import('/src/i18n.ts'); setLanguage('ko'); window.app.current.game.hud.dialogue.close(); });
  console.log('PASS the same page in English');

  // 3. Accepting: the log, the journey save and the tracker.
  await toKing();
  await p.getByRole('button', { name: '의뢰 받기', exact: true }).click();
  await reveal();
  const accepted = await p.evaluate(() => ({ log: window.__K.log(), saved: window.__K.saved()?.kingdom, buttons: window.__K.buttons(), tracker: window.__K.tracker() }));
  assert.equal(accepted.log.current, 'patrol');
  assert.deepEqual(accepted.saved, { active: { id: 'patrol', n: 0, worlds: [], seen: [] } });
  assert.deepEqual(accepted.buttons, ['다녀올게요']);
  assert.ok(accepted.tracker.includes('왕국 순찰') && accepted.tracker.includes('적 물리치기: 0/5'), accepted.tracker);
  console.log(`PASS accepting saves the active request in the journey and tracks it: "${accepted.tracker}"`);
  await p.getByRole('button', { name: '다녀올게요', exact: true }).click();

  // 4. In a world: five real kills by the player count; a kill credited to nobody, and a relay member's kill of a
  //    fight it was not in, do not.
  await sailHome();
  const kills = await p.evaluate(() => {
    const g = window.app.current.game, foes = window.__K.foes(), b = g.multiplayer.battle, out = { foes: foes.length, steps: [] };
    const n = () => window.__K.log().lines[0].text;
    g.combat.kill(foes[0].unit, null);
    out.steps.push(['nobody', n()]);
    // A relay member (not the authority) hears of a kill credited to itself; it was not fighting that enemy.
    const was = { active: b.active, host: b.host, ownId: b.ownId };
    Object.assign(b, { active: true, host: 'qa-host', ownId: 'qa-member' });
    out.authority = b.authority;
    g.player.setTarget(null);
    g.combat.kill(foes[1].unit, g.player.unit);
    out.steps.push(['relay, not fighting', n()]);
    // The same, for an enemy it was fighting (its target).
    g.player.setTarget(foes[2].unit);
    g.combat.kill(foes[2].unit, g.player.unit);
    out.steps.push(['relay, fighting', n()]);
    Object.assign(b, was);
    g.player.setTarget(null);
    for (const e of foes.slice(3, 7)) { g.combat.damage(g.player.unit, e.unit, 1e7); out.steps.push(['own kill', n()]); }
    out.log = window.__K.log();
    return out;
  });
  assert.ok(kills.foes >= 7 && kills.authority === false, JSON.stringify(kills));
  assert.deepEqual(kills.steps.map((s) => s[1]), ['적 물리치기: 0/5', '적 물리치기: 0/5', '적 물리치기: 1/5', '적 물리치기: 2/5', '적 물리치기: 3/5', '적 물리치기: 4/5', '적 물리치기: 5/5']);
  assert.equal(kills.log.ready, true);
  await p.waitForFunction(() => window.__K.tracker().includes('타이드크라운의 왕에게 돌아가'), null, { timeout: 5000 }).catch(() => {});
  const doneTracker = await p.evaluate(() => window.__K.tracker());
  assert.ok(doneTracker.includes('타이드크라운의 왕에게 돌아가'), doneTracker);
  // The tracker in World I, once the banner has gone, looking along the shore away from the crown portal.
  await p.evaluate(() => { const g = window.app.current.game; g.player.unit.setYaw(g.player.unit.yaw + Math.PI); g.follow.yaw = g.player.unit.yaw + Math.PI; g.follow.cut(); });
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${shots}/kingdom-tracker.png` });
  console.log(`PASS kills in World I count only when the player's own (${kills.steps.map((s) => `${s[0]} ${s[1].split(': ')[1]}`).join(', ')}); the tracker sends the player back to the king`);

  // 5. Turn-in pays exactly the stated coins and XP once (a growth blessing is running and does not multiply it).
  await intoCapital();
  await p.evaluate(() => { window.app.current.game.player.xpBlessingUntil = Date.now() + 600000; });
  const ready = await toKing();
  assert.ok(ready.text.includes('해냈구나') && ready.text.includes('✓ 적 물리치기: 5/5'), ready.text);
  assert.deepEqual(ready.buttons, ['보상 받기', '나중에 받을게요']);
  await p.screenshot({ path: `${shots}/king-turn-in.png` });
  const before = await p.evaluate(() => window.__K.purse());
  await p.getByRole('button', { name: '보상 받기', exact: true }).click();
  await reveal();
  const paid = await p.evaluate(() => ({ purse: window.__K.purse(), log: window.__K.log(), saved: window.__K.saved(), again: window.app.current.game.world2.hub.kingdom.turnIn(), text: window.__K.text(), buttons: window.__K.buttons() }));
  assert.equal(paid.purse.coins - before.coins, 60);
  assert.equal(paid.purse.xp - before.xp, 150);
  assert.equal(paid.again, null);
  assert.deepEqual(paid.log.snapshot, { done: ['patrol'] });
  assert.deepEqual(paid.saved.kingdom, { done: ['patrol'] });
  assert.equal(paid.saved.coins, paid.purse.coins);
  assert.equal(paid.saved.xp, paid.purse.xp);
  assert.equal(paid.log.offer, 'voyage');
  assert.ok(paid.text.includes('60 코인과 150 XP') && paid.text.includes('수도를 떠나 월드에 가 보거라'), paid.text);
  await p.screenshot({ path: `${shots}/king-thanks.png` });
  const after = await p.evaluate(() => window.__K.purse());
  assert.deepEqual(after, paid.purse);
  console.log(`PASS turning in pays exactly +60 coins and +150 XP (${before.coins} -> ${paid.purse.coins} coins, ${before.xp} -> ${paid.purse.xp} XP, blessing running), saved with the log at once; a second turn-in pays nothing; the king thanks and offers the next request`);

  // 6. The second request counts an arrival: the captain's ship from the capital to World I.
  await p.getByRole('button', { name: '의뢰 받기', exact: true }).click();
  await p.evaluate(() => window.app.current.game.hud.dialogue.close());
  await sailHome();
  const voyage = await p.evaluate(() => ({ log: window.__K.log(), state: window.__K.state() }));
  assert.ok(voyage.log.current === 'voyage' && voyage.log.ready && voyage.log.lines[0].text === '수도에서 월드로 떠나기: 1/1' && !voyage.state.in && voyage.state.chapter === 1, JSON.stringify(voyage));
  await intoCapital();
  await toKing();
  const before2 = await p.evaluate(() => window.__K.purse());
  await p.getByRole('button', { name: '보상 받기', exact: true }).click();
  const paid2 = await p.evaluate(() => ({ purse: window.__K.purse(), log: window.__K.log() }));
  assert.ok(paid2.purse.coins - before2.coins === 40 && paid2.purse.xp - before2.xp === 100, JSON.stringify({ before2, paid2 }));
  assert.deepEqual(paid2.log.snapshot, { done: ['patrol', 'voyage'] });
  console.log('PASS the second request counts the ship to World I as leaving the capital, and pays +40 coins and +100 XP once');
  // The third is taken and left in progress over the reload.
  await reveal();
  await p.getByRole('button', { name: '의뢰 받기', exact: true }).click();
  const held = await p.evaluate(() => ({ purse: window.__K.purse(), log: window.__K.log() }));
  assert.ok(held.log.current === 'treasure' && !held.log.ready, JSON.stringify(held.log));
  await p.evaluate(() => window.app.current.game.journey.save());

  // 7. A reload keeps the log and pays nothing again.
  await p.reload();
  await boot();
  const reloaded = await p.evaluate(() => ({ purse: window.__K.purse(), log: window.__K.log() }));
  assert.deepEqual(reloaded.purse, held.purse);
  assert.deepEqual(reloaded.log.snapshot, { done: ['patrol', 'voyage'], active: { id: 'treasure', n: 0, worlds: [], seen: [] } });
  await intoCapital();
  const after2 = await toKing();
  assert.ok(after2.text.includes('섬의 보물') && after2.text.includes('아직 끝나지 않았구나') && after2.text.includes('섬의 보물 상자 찾기: 0/1'), after2.text);
  const noPay = await p.evaluate(() => ({ again: window.app.current.game.world2.hub.kingdom.turnIn(), purse: window.__K.purse() }));
  assert.equal(noPay.again, null);
  assert.deepEqual(noPay.purse, held.purse);
  console.log(`PASS after a reload the log is back (done: patrol, voyage; Island Treasure in hand), coins and XP unchanged (${held.purse.coins} coins, ${held.purse.xp} XP), and nothing is paid again`);

  // 8. An old save without the field, and one with a broken field, load with a fresh log.
  for (const [label, kingdom] of [['without the field', undefined], ['with a broken field', { done: ['nope', 7], active: { id: 'voyage', n: -3, worlds: 'x' }, runs: [1, 'x'.repeat(99)] }]]) {
    await p.evaluate(({ kingdom }) => {
      const spec = { race: 'dwarf', sex: 'male', classId: 'priest', shell: 0, crest: 0, led: 0, name: 'Old save' };
      localStorage.setItem('cc.spec', JSON.stringify(spec));
      const save = { xp: 950, coins: 33, chapter: 1, rust: false, quests: {}, objectives: {} };
      if (kingdom !== undefined) save.kingdom = kingdom;
      localStorage.setItem(`cc.journey.v1:${spec.race}:${spec.sex}:${spec.classId}:${spec.name}`, JSON.stringify(save));
    }, { kingdom });
    await p.reload();
    await boot();
    const old = await p.evaluate(() => ({ purse: window.__K.purse(), log: window.__K.log(), level: window.app.current.game.player.level }));
    assert.ok(old.purse.xp === 950 && old.purse.coins === 33 && old.level === 3, JSON.stringify(old));
    if (kingdom === undefined) assert.deepEqual(old.log, { offer: 'patrol', current: null, ready: false, lines: [], snapshot: null });
    else assert.deepEqual(old.log.snapshot, { active: { id: 'voyage', n: 0, worlds: [], seen: [] } });
    console.log(`PASS an old save ${label} loads (950 XP, 33 coins, level 3) with ${kingdom === undefined ? 'a fresh log offering Royal Patrol' : 'only its valid part kept (Royal Patrol not done, First Voyage in hand at 0)'}`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS zero page errors on the local world');
} finally {
  await browser.close();
}


// 9. A server world: the capital is not hosted there yet, so no keeper, king or request log is built.
if (process.env.CC_QA_SERVER !== '0') {
  const browserPort = Number(process.env.WORLD_QA_BROWSER_PORT ?? 5275), hostPort = Number(process.env.WORLD_QA_HOST_PORT ?? 5276), clientOrigin = `http://127.0.0.1:${browserPort}`;
  const scratch = await mkdtemp('/private/tmp/crabcraft-king-server-'), metadataPath = join(scratch, 'host.json');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let host, server, sb;
  try {
    host = spawn(process.execPath, ['tools/qa-world-host-server.mjs', '--port', String(hostPort), '--metadata', metadataPath, '--client-origin', clientOrigin, '--world', 'w1'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    host.stderr.on('data', () => {});
    let metadata;
    for (let i = 0; i < 300 && !metadata; i++) {
      try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); } catch { if (host.exitCode !== null) throw new Error('QA host exited before readiness'); await pause(100); }
    }
    if (!metadata) throw new Error('QA host readiness timed out');
    const origin = new URL(metadata.origin);
    server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: browserPort, strictPort: true, proxy: { '/world': { target: origin.origin, ws: true }, '/api/account': { target: origin.origin } } }, logLevel: 'error' });
    await server.listen();
    sb = await launchBrowser({ headless: true, args });
    const context = await sb.newContext({ viewport: { width: 1600, height: 900 } });
    await context.grantPermissions(['local-network-access'], { origin: clientOrigin });
    await context.addCookies([{ name: metadata.cookie.name, value: metadata.cookie.value, domain: '127.0.0.1', path: metadata.cookie.path, httpOnly: true, sameSite: 'Strict', secure: false }]);
    const page = await context.newPage();
    watch(page);
    await page.addInitScript(() => { localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.hintsSeen', '1'); });
    await page.goto(`${clientOrigin}/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`, { waitUntil: 'load' });
    await page.locator('.launch-notice-start').click();
    await page.waitForFunction(() => window.__ready && window.cc?.game?.server?.ready, undefined, { timeout: 120000 });
    await page.locator('.loading').waitFor({ state: 'detached' });
    const s = await page.evaluate(() => {
      const g = window.cc.game, hub = g.world2.hub, built = [];
      g.scene.traverse((o) => { if (/^king-crown|^crab:Marinus$/.test(o.name)) built.push(o.name); });
      return { built, units: hub.units.length, kingdom: hub.kingdom, point: hub.point(), markers: hub.markers().length, tracker: document.querySelector('.qt-kingdom')?.childElementCount ?? 0 };
    });
    assert.deepEqual(s, { built: [], units: 0, kingdom: null, point: null, markers: 0, tracker: 0 });
    assert.deepEqual(errors, []);
    console.log('PASS ?world=server: no king, keeper or kingdom request log is built, and no kingdom line in the tracker; zero page errors');
  } finally {
    await sb?.close();
    await server?.close();
    if (host && host.exitCode === null) { host.kill('SIGTERM'); await pause(500); }
  }
}
