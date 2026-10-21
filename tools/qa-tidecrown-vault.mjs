// The Royal Vault of Tidecrown (Chrome for Testing on the dev server, a guest save). Bell keeps it in the Moult Market's
// hall, a keeper (not a game unit) in the gate-end bay beside her strongbox, clear of the King's Way, the market ring,
// the residents, the King, Captain Ara and the Seaglass portal; F at her opens the vault: the coins carried and the
// coins in the vault, a deposit and a withdraw row (100, 1,000, 10,000, all). Clicks move exact amounts and write the
// vault and the journey at once (a double click moves once), buttons are disabled when a side is short, and a fight,
// a dungeon, or another window on the same character refuse; a window that only rewrites the same coins does not.
// A reload keeps both balances; a second character on the device sees and takes the same vault. Then on a server
// world (a loopback host with a disposable PG, as qa-tidecrown-king) nothing is built and the key is not touched.
// Then signed in (a throwaway Postgres, server-dist/main.mjs and a fake Google, as qa-accounts, behind a dev server of
// its own): the first sign-in takes the guest vault into the account, a deposit reaches the account's save with its
// journey, a second computer loads it, a second character there takes it out, and the first computer then loads that.
// Zero page errors throughout.
// Writes the 1600x900 shots to CC_QA_SHOTS (default tmp/vault-shots).
// Usage: CC_QA_BASE=http://127.0.0.1:5281 node tools/qa-tidecrown-vault.mjs   (CC_QA_SERVER=0 skips the server world,
//   CC_QA_ACCOUNT=0 the signed-in part, CC_QA_LOCAL=0 the guest part)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createServer } from 'vite';
import { fakeGoogle } from '../server/node/fake-google.mjs';
import { freePort, startPostgres } from '../server/node/local-postgres.mjs';
import { launchBrowser } from './lib/browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5281';
const shots = process.env.CC_QA_SHOTS ?? join(root, 'tmp/vault-shots');
await mkdir(shots, { recursive: true });
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'];
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|tidecrown|portal|hub|keeper|vault|journey|bundle/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const HEIR = { race: 'dwarf', sex: 'male', classId: 'mage', shell: 1, crest: 0, led: 2, name: 'Vault heir' };

/** Page helpers: boot the game, cross into the capital, find and talk to Bell, read the vault and its page. */
function driver(p) {
  const loaded = () => p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
  const boot = async () => {
    await p.locator('.launch-notice-start').click();
    await loaded();
    await ready();
  };
  /** The game is up: the page helpers. */
  const ready = () =>
    p.evaluate(async () => {
      const g = window.app.current.game;
      g.god = true;
      const [V, G, CP, K, S, L] = await Promise.all([import('/src/game/tidecrown/vault.ts'), import('/src/sim/world/tidecrownGround.ts'), import('/src/game/tidecrown/cityPlan.ts'), import('/src/game/tidecrown/king.ts'), import('/src/accountStorage.ts'), import('/src/game/tidecrown/vaultLedger.ts')]);
      const journeyKey = () => { const s = g.player.unit.rig.spec; return S.storageKey(`cc.journey.v1:${s.race}:${s.sex}:${s.classId}:${s.name}`); };
      window.__V = {
        V, G, CP, K, S, journeyKey,
        vault: () => g.world2.hub.vault,
        state: () => ({ carried: g.player.coins, vault: g.world2.hub.vault.coins, stored: localStorage.getItem(S.storageKey('cc.vault.v1')), journey: JSON.parse(localStorage.getItem(journeyKey()) ?? 'null')?.coins ?? null }),
        page: () => ({
          tiles: [...document.querySelectorAll('.vault-tile strong')].map((e) => e.textContent),
          labels: [...document.querySelectorAll('.vault-tile span, .vault-label')].map((e) => e.textContent),
          buttons: Object.fromEntries([...document.querySelectorAll('.vault-amt')].map((b) => [`${b.dataset.move}:${b.dataset.amount}`, { text: b.textContent, disabled: b.disabled }])),
          status: document.querySelector('.vault-status')?.textContent ?? '', note: document.querySelector('.vault-note')?.textContent ?? '',
        }),
        cam: (cam, at) => { g.follow.update = function () { this.camera.position.set(...cam); this.camera.lookAt(...at); }; },
        free: () => { delete g.follow.update; },
        face: (x, z, yaw, d) => {
          g.player.setTarget(null);
          g.player.unit.teleport(g.world, x + Math.sin(yaw) * d, z + Math.cos(yaw) * d, yaw + Math.PI);
          g.follow.yaw = yaw;
          g.follow.cut();
        },
        prompt: () => document.querySelector('.prompt.on')?.textContent ?? '',
        // Buttons whose state disagrees with the balances (each is on exactly when its move would move coins).
        wrong: () => [...document.querySelectorAll('.vault-amt')].filter((b) => b.disabled !== !L.vaultAmount(g.player.coins, g.world2.hub.vault.coins, b.dataset.move, b.dataset.amount === 'all' ? 'all' : Number(b.dataset.amount))).map((b) => `${b.dataset.move}:${b.dataset.amount}`),
        dialogue: () => ({ name: g.hud.dialogue.unit?.name ?? null, text: document.querySelector('.dlg-text')?.textContent ?? '', buttons: [...document.querySelectorAll('.dlg-buttons .cc-btn')].map((b) => b.textContent) }),
      };
    });
  const intoCapital = async () => {
    // World I's crown portal by F, as a player arrives (the quay before the sea gate).
    const w1 = await p.evaluate(() => window.app.current.game.world2.hub.crownPortals.find((r) => r.chapter === 1));
    await p.evaluate(({ x, z, yaw }) => window.__V.face(x, z, yaw, 3), w1);
    await p.waitForFunction(() => window.__V.prompt().includes('타이드크라운') || window.__V.prompt().includes('Tidecrown'));
    await p.keyboard.press('KeyF');
    await p.waitForFunction(() => window.app.current.game.world2.inTidecrown && !document.querySelector('.tidecrown-loading'), null, { timeout: 120000 });
    await p.waitForTimeout(4500);
  };
  const toBell = async () => {
    await p.evaluate(() => { const g = window.app.current.game; g.hud.dialogue.close(); const { x, z, yaw } = window.__V.V.VAULT_POST; window.__V.face(x, z, yaw, 3); });
    await p.waitForFunction(() => /금고지기 벨에게 말 걸기|Talk to Bell/.test(window.__V.prompt()));
    await p.keyboard.press('KeyF');
    await p.waitForFunction(() => /^(금고지기 벨|Bell the Vault-keeper)$/.test(window.app.current.game.hud.dialogue.unit?.name ?? ''));
    await p.locator('.dlg-text').click();
    await p.waitForFunction(() => !window.app.current.game.hud.dialogue.typing);
    await p.waitForTimeout(300);
    return p.evaluate(() => ({ ...window.__V.dialogue(), ...window.__V.page(), state: window.__V.state() }));
  };
  const click = async (move, amount, dbl = false) => {
    const b = p.locator(`.vault-row.${move} .vault-amt[data-amount="${amount}"]`);
    const before = await p.evaluate(() => window.__V.state());
    if (dbl) await b.dblclick(); else await b.click();
    await p.waitForFunction((b) => { const s = window.__V.state(); return s.carried !== b.carried && !window.__V.vault().busy; }, before);
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => ({ state: window.__V.state(), page: window.__V.page(), wrong: window.__V.wrong() }));
    assert.deepEqual(r.wrong, [], `buttons on exactly when they would move coins: ${JSON.stringify(r)}`);
    return r;
  };
  /** Whether another window holds this character (what the vault checks before a move). */
  const twinned = () => p.evaluate(() => window.__V.vault().shared());
  return { boot, loaded, ready, intoCapital, toBell, click, twinned };
}

if (process.env.CC_QA_LOCAL !== '0') {
const browser = await launchBrowser({ headless: true, args });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const p = await context.newPage();
  p.setDefaultTimeout(90000);
  watch(p);
  await context.routeWebSocket('**/multiplayer*', (ws) => ws.close());
  await p.addInitScript(() => {
    // Seeded once: the reloads below must find what the page saved.
    if (localStorage.getItem('cc.qaVaultSeed')) return;
    localStorage.setItem('cc.qaVaultSeed', '1');
    const spec = { race: 'orc', sex: 'female', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Vault visitor' };
    localStorage.setItem('cc.spec', JSON.stringify(spec));
    localStorage.setItem(`cc.journey.v1:${spec.race}:${spec.sex}:${spec.classId}:${spec.name}`, JSON.stringify({ xp: 950, coins: 12345, chapter: 1 }));
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'high');
  });
  const d = driver(p);
  await p.goto(base + '/?screen=game');
  await d.boot();
  assert.deepEqual(await p.evaluate(() => window.__V.state()), { carried: 12345, vault: 0, stored: null, journey: 12345 });

  // 1. Bell in the market hall's gate-end bay: a keeper, beside her strongbox, clear of the ways and the other crabs.
  await d.intoCapital();
  const bell = await p.evaluate(() => {
    const g = window.app.current.game, { G, CP, K, V } = window.__V, u = window.__V.vault().unit, hall = CP.TC_LANDMARKS.find((l) => l.id === 'arcade');
    const dx = u.pos.x - hall.x, dz = u.pos.z - hall.z, lx = dx * G.TC_AXIS.ux + dz * G.TC_AXIS.uz, lz = dx * G.TC_P.x + dz * G.TC_P.z;
    const [, s] = G.tcAxisCoords(u.pos.x, u.pos.z), out = Math.atan2(-G.TC_AXIS.ux, -G.TC_AXIS.uz);
    const people = g.world2.tidecrownPeople.people.flatMap((r) => [r.home, r.end]);
    const segment = (px, pz, [ax, az], [bx, bz]) => { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1))); return Math.hypot(px - ax - vx * t, pz - az - vz * t); };
    const streets = CP.TC_CITY_STREETS.map((st) => ({ id: st.id, clear: Math.min(...st.points.slice(1).map((b, i) => segment(u.pos.x, u.pos.z, st.points[i], b))) - st.width / 2 }));
    const dressing = g.scene.getObjectByName('tc-vault-dressing');
    return {
      lx: +lx.toFixed(2), lz: +lz.toFixed(2), r: +u.radius.toFixed(2), y: +u.pos.y.toFixed(2), unit: g.units.includes(u), hidden: u.hidden,
      yawErr: +Math.abs(Math.atan2(Math.sin(u.yaw - out), Math.cos(u.yaw - out))).toFixed(3), kingsWay: +(Math.abs(s) - 12).toFixed(1),
      resident: +Math.min(...people.map((q) => Math.hypot(q.x - u.pos.x, q.z - u.pos.z))).toFixed(1),
      king: +Math.hypot(K.KING_POST.x - u.pos.x, K.KING_POST.z - u.pos.z).toFixed(0), captain: +Math.hypot(261 - u.pos.x, 8.9 - u.pos.z).toFixed(0), seaglass: +Math.hypot(-50 - u.pos.x, -110 - u.pos.z).toFixed(0),
      street: streets.reduce((a, b) => (b.clear < a.clear ? b : a)), plate: g.hud.plates.also.has(u), marker: g.world2.hub.markers().some((m) => m.label === '금고'),
      dressing: dressing ? dressing.children.length : 0, post: V.VAULT_POST,
    };
  });
  assert.ok(!bell.unit && !bell.hidden && bell.plate && bell.marker && bell.dressing >= 2, JSON.stringify(bell));
  assert.ok(bell.lx < -6.9 - bell.r && bell.lx > -10.6 + bell.r && Math.abs(bell.lz) < 5.8 - bell.r, `in the hall's gate-end bay, past its tables: ${JSON.stringify(bell)}`);
  assert.ok(Math.abs(bell.lz) - bell.r >= 1, `the aisle stays open: ${JSON.stringify(bell)}`);
  assert.ok(bell.yawErr < 0.05, `facing out of the hall: ${JSON.stringify(bell)}`);
  assert.ok(bell.kingsWay > bell.r + 5 && bell.street.clear > bell.r + 1, `clear of the King's Way and the streets: ${JSON.stringify(bell)}`);
  assert.ok(bell.resident > 8, `clear of the residents (nearest ${bell.resident} m)`);
  assert.ok(bell.king > 40 && bell.captain > 40 && bell.seaglass > 40, JSON.stringify(bell));
  console.log(`PASS Bell stands in the market hall's gate-end bay (hall x ${bell.lx}, z ${bell.lz}, floor y ${bell.y}) facing out, beside her strongbox and coins (${bell.dressing} meshes); a keeper with a plate and a "금고" minimap mark, not a game unit; ${bell.kingsWay} m off the King's Way, ${bell.street.clear.toFixed(1)} m off the nearest street (${bell.street.id}), ${bell.resident} m from the nearest resident, ${bell.king} m from the King, ${bell.captain} m from Captain Ara, ${bell.seaglass} m from the Seaglass portal`);
  await p.evaluate(() => {
    const g = window.app.current.game, { x, z, yaw } = window.__V.V.VAULT_POST, y = g.world2.tidecrown.height(x, z), fx = Math.sin(yaw), fz = Math.cos(yaw), px = -0.9189, pz = -0.3948;
    g.player.unit.teleport(g.world, x - 40, z + 10, 0);
    window.__V.cam([x + fx * 15 + px * 9, y + 5, z + fz * 15 + pz * 9], [x, y + 1.2, z]);
  });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${shots}/vault-keeper-hall.png` });
  await p.evaluate(() => {
    const g = window.app.current.game, { x, z, yaw } = window.__V.V.VAULT_POST, y = g.world2.tidecrown.height(x, z), fx = Math.sin(yaw), fz = Math.cos(yaw), px = 0.9189, pz = 0.3948;
    window.__V.cam([x + fx * 3.4 + px * 1.1, y + 2.0, z + fz * 3.4 + pz * 1.1], [x + px * 1.1, y + 0.45, z + pz * 1.1]);
  });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${shots}/vault-keeper-close.png` });
  await p.evaluate(() => window.__V.free());

  // 2. F opens the vault: what is carried, what is kept, and the two rows.
  const opened = await d.toBell();
  assert.equal(opened.name, '금고지기 벨');
  assert.ok(opened.text.includes('왕실 금고') && opened.text.includes('다른 캐릭터로도 꺼낼 수 있어요'), opened.text);
  assert.deepEqual(opened.tiles, ['🪙 12,345', '🪙 0']);
  assert.deepEqual(opened.labels, ['가진 코인', '금고에 맡긴 코인', '맡기기', '꺼내기']);
  assert.deepEqual(Object.fromEntries(Object.entries(opened.buttons).map(([k, v]) => [k, `${v.text}${v.disabled ? ' (off)' : ''}`])), {
    'deposit:100': '100', 'deposit:1000': '1,000', 'deposit:10000': '10,000', 'deposit:all': '모두',
    'withdraw:100': '100 (off)', 'withdraw:1000': '1,000 (off)', 'withdraw:10000': '10,000 (off)', 'withdraw:all': '모두 (off)',
  });
  assert.ok(opened.note.includes('로그인하지 않아서 금고는 이 기기에만 있어요'), opened.note);
  assert.deepEqual(opened.state, { carried: 12345, vault: 0, stored: null, journey: 12345 });
  await p.screenshot({ path: `${shots}/vault-dialogue.png` });
  console.log('PASS F at Bell opens the Royal Vault: 12,345 carried and 0 kept, deposit 100 / 1,000 / 10,000 / all open, every withdrawal off, and the device-only note for a guest');

  // 3. Exact moves, both sides saved at once; short sides disabled; a double click moves once.
  const total = 12345;
  const step = async (label, move, amount, carried, vault, dbl) => {
    const r = await d.click(move, amount, dbl);
    assert.deepEqual(r.state, { carried, vault, stored: JSON.stringify({ coins: vault }), journey: carried }, label);
    assert.equal(r.state.carried + r.state.vault, total);
    assert.deepEqual(r.page.tiles, [`🪙 ${carried.toLocaleString('en-US')}`, `🪙 ${vault.toLocaleString('en-US')}`]);
    return r.page;
  };
  let page = await step('deposit 1,000', 'deposit', 1000, 11345, 1000);
  assert.equal(page.status, '🪙 1,000 코인을 금고에 맡겼어요.');
  page = await step('deposit 10,000', 'deposit', 10000, 1345, 11000);
  assert.ok(page.buttons['deposit:10000'].disabled && !page.buttons['deposit:1000'].disabled && !page.buttons['withdraw:10000'].disabled, JSON.stringify(page.buttons));
  page = await step('withdraw 100 by a double click', 'withdraw', 100, 1445, 10900, true);
  assert.equal(page.status, '🪙 100 코인을 금고에서 꺼냈어요.');
  page = await step('deposit all', 'deposit', 'all', 0, 12345);
  assert.ok(['100', '1000', '10000', 'all'].every((a) => page.buttons[`deposit:${a}`].disabled), JSON.stringify(page.buttons));
  page = await step('withdraw 10,000', 'withdraw', 10000, 10000, 2345);
  assert.ok(page.buttons['withdraw:10000'].disabled && !page.buttons['withdraw:1000'].disabled && !page.buttons['withdraw:all'].disabled, JSON.stringify(page.buttons));
  await p.screenshot({ path: `${shots}/vault-after-moves.png` });
  const short = await p.evaluate(async () => ({ moved: await window.__V.vault().move('withdraw', 10000), over: await window.__V.vault().move('deposit', 20000), state: window.__V.state() }));
  assert.deepEqual(short, { moved: false, over: false, state: { carried: 10000, vault: 2345, stored: '{"coins":2345}', journey: 10000 } });
  console.log('PASS deposits of 1,000, 10,000 and all and withdrawals of 100 and 10,000 move exactly that, the journey and the vault saved together each time (12,345 in all throughout); 10,000 turns off when a side holds less; a double click moved 100 once; a short move called directly moves nothing');

  // 4. The same page in English.
  await p.evaluate(async () => { const { setLanguage } = await import('/src/i18n.ts'); setLanguage('en'); });
  const en = await d.toBell();
  assert.equal(en.name, 'Bell the Vault-keeper');
  assert.deepEqual([en.labels, en.tiles, en.buttons['deposit:all'].text], [['Carried', 'In the vault', 'Deposit', 'Withdraw'], ['🪙 10,000', '🪙 2,345'], 'All']);
  assert.ok(en.text.includes('Royal Vault') && en.note.includes('not signed in'), JSON.stringify(en));
  await p.evaluate(async () => { const { setLanguage } = await import('/src/i18n.ts'); setLanguage('ko'); });
  await d.toBell();
  console.log('PASS the same page in English (Carried, In the vault, Deposit, Withdraw, All)');

  // 5. Refusals: in a fight (the combat flag every hit sets), in a dungeon, knocked out.
  await p.evaluate(() => { const g = window.app.current.game; g.player.unit.lastCombat = g.time; });
  await p.waitForFunction(() => window.__V.page().status.includes('싸우는 중에는'));
  const fight = await p.evaluate(async () => ({ page: window.__V.page(), moved: await window.__V.vault().move('deposit', 100), state: window.__V.state() }));
  assert.ok(Object.values(fight.page.buttons).every((b) => b.disabled), JSON.stringify(fight.page.buttons));
  assert.deepEqual([fight.moved, fight.state.carried, fight.state.vault], [false, 10000, 2345]);
  await p.screenshot({ path: `${shots}/vault-refused-fight.png` });
  await p.waitForFunction(() => !window.app.current.game.player.inCombat && !window.__V.page().buttons['deposit:100'].disabled, null, { timeout: 10000 });
  // Read in one step, with nothing else running between the change and the reading.
  const other = await p.evaluate(() => {
    const g = window.app.current.game, v = window.__V.vault(), out = {};
    Object.defineProperty(g.dungeons, 'active', { configurable: true, get: () => true });
    out.dungeon = v.refusal();
    delete g.dungeons.active;
    g.player.unit.alive = false;
    out.knocked = v.refusal();
    g.player.unit.alive = true;
    out.after = v.refusal();
    return out;
  });
  assert.deepEqual(other, { dungeon: '던전 안에서는 금고를 쓸 수 없어요.', knocked: '쓰러진 동안에는 금고를 쓸 수 없어요.', after: null });
  console.log('PASS in a fight every button is off, the page says why, and a move moves nothing; it opens again when the fight is over; a dungeon and being knocked out refuse too');

  // 6. Another window: playing the same character there refuses here; a window that only rewrites the same coins does
  //    not; one that writes other coins leaves this window refusing until it reloads.
  const twin = await context.newPage();
  watch(twin);
  await twin.goto(base + '/?screen=game');
  await driver(twin).boot();
  for (const until = Date.now() + 30000; !(await d.twinned()); await pause(500)) if (Date.now() > until) throw new Error('the second window never held the character');
  const refused = await p.evaluate(async () => ({ moved: await window.__V.vault().move('deposit', 100), status: window.__V.page().status, state: window.__V.state() }));
  assert.deepEqual(refused, { moved: false, status: '다른 창에서도 이 캐릭터로 놀고 있어요. 그 창을 닫고 이 창을 새로 고쳐 주세요.', state: { carried: 10000, vault: 2345, stored: '{"coins":2345}', journey: 10000 } });
  await p.screenshot({ path: `${shots}/vault-refused-twin.png` });
  // The twin saved its journey (the same coins) while it was open.
  assert.equal(await twin.evaluate(() => { window.app.current.game.journey.save(); return window.__V.state().carried; }), 10000);
  await twin.close();
  const back = await p.evaluate(async () => ({ moved: await window.__V.vault().move('deposit', 100), again: await window.__V.vault().move('withdraw', 100), state: window.__V.state() }));
  assert.deepEqual(back, { moved: true, again: true, state: { carried: 10000, vault: 2345, stored: '{"coins":2345}', journey: 10000 } });
  const writer = await context.newPage();
  await writer.goto(base + '/');
  await writer.evaluate((key) => { const j = JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify({ ...j, coins: 77 })); }, await p.evaluate(() => window.__V.journeyKey()));
  await p.waitForFunction(() => window.__V.page().status.includes('다른 창에서도'));
  assert.equal(await p.evaluate(async () => window.__V.vault().move('withdraw', 100)), false);
  await writer.close();
  // This window's own save puts its coins back before the reload.
  await p.evaluate(() => window.app.current.game.journey.save());
  console.log('PASS with a second window on the same character every move is refused; once it closed (having saved the same coins) moves work again; a window that wrote other coins for this character leaves this one refusing');

  // 7. A reload keeps both balances.
  await p.reload();
  await d.boot();
  assert.deepEqual(await p.evaluate(() => window.__V.state()), { carried: 10000, vault: 2345, stored: '{"coins":2345}', journey: 10000 });
  console.log('PASS after a reload the character carries 10,000 and the vault keeps 2,345');

  // 8. A second character on this device sees the same vault and takes it out.
  const firstKey = await p.evaluate(() => window.__V.journeyKey());
  await p.evaluate((spec) => window.app.saveSpec(spec), HEIR);
  await p.reload();
  await d.boot();
  const fresh = await p.evaluate(() => window.__V.state());
  assert.deepEqual([fresh.carried, fresh.vault, fresh.stored], [0, 2345, '{"coins":2345}']);
  await d.intoCapital();
  const heir = await d.toBell();
  assert.deepEqual(heir.tiles, ['🪙 0', '🪙 2,345']);
  const took = await d.click('withdraw', 'all');
  assert.deepEqual(took.state, { carried: 2345, vault: 0, stored: '{"coins":0}', journey: 2345 });
  assert.equal(await p.evaluate((k) => JSON.parse(localStorage.getItem(k)).coins, firstKey), 10000);
  await p.screenshot({ path: `${shots}/vault-second-character.png` });
  console.log('PASS a second character on this device (Vault heir) sees the 2,345 in the vault and takes it all; the first character keeps its 10,000: 12,345 in all');
  assert.deepEqual(errors, []);
  console.log('PASS zero page errors on the local world');
} finally {
  await browser.close();
}
}

// 9. A server world: the capital is not hosted there, so no Bell, no vault, and the key is left as it was.
if (process.env.CC_QA_SERVER !== '0') {
  const browserPort = await freePort(), hostPort = await freePort(), clientOrigin = `http://127.0.0.1:${browserPort}`;
  const scratch = await mkdtemp('/private/tmp/crabcraft-vault-server-'), metadataPath = join(scratch, 'host.json');
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
    await page.addInitScript(() => { localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.hintsSeen', '1'); if (!localStorage.getItem('cc.vault.v1')) localStorage.setItem('cc.vault.v1', '{"coins":4242}'); });
    await page.goto(`${clientOrigin}/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`, { waitUntil: 'load' });
    await page.locator('.launch-notice-start').click();
    await page.waitForFunction(() => window.__ready && window.cc?.game?.server?.ready, undefined, { timeout: 120000 });
    await page.locator('.loading').waitFor({ state: 'detached' });
    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => {
      const g = window.cc.game, hub = g.world2.hub, built = [];
      g.scene.traverse((o) => { if (/^tc-vault|^crab:Bell$/.test(o.name)) built.push(o.name); });
      return { built, vault: hub.vault, units: hub.units.length, keys: Object.keys(localStorage).filter((k) => k.includes('cc.vault')), value: localStorage.getItem('cc.vault.v1'), panel: !!document.querySelector('.vault') };
    });
    assert.deepEqual(s, { built: [], vault: null, units: 0, keys: ['cc.vault.v1'], value: '{"coins":4242}', panel: false });
    assert.deepEqual(errors, []);
    console.log('PASS ?world=server: no Bell, no vault and no strongbox are built, and the vault key is left exactly as it was; zero page errors');
  } finally {
    await sb?.close();
    await server?.close();
    if (host && host.exitCode === null) { host.kill('SIGTERM'); await pause(500); }
  }
}

// 10. Signed in: the vault rides in the account's save with the journey, and every computer of the account loads it.
if (process.env.CC_QA_ACCOUNT !== '0') {
  execFileSync(process.execPath, [join(root, 'server/node/build.mjs')], { stdio: 'ignore' });
  const clientId = 'qa-client.apps.googleusercontent.com', clientSecret = 'GOCSPX-' + randomBytes(18).toString('base64url');
  const postgres = await startPostgres(), db = new pg.Pool({ connectionString: postgres.url });
  const google = await fakeGoogle({ clientId, clientSecret, name: 'localhost', sub: 'qa-vault-' + randomBytes(6).toString('hex') });
  const accountPort = await freePort(), devPort = await freePort(), devBase = `http://127.0.0.1:${devPort}`;
  let account, dev, ab;
  try {
    account = spawn(process.execPath, [join(root, 'server-dist/main.mjs')], { cwd: root, env: { PATH: process.env.PATH, PORT: String(accountPort), HOST: '127.0.0.1', DATABASE_URL: postgres.url, GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_AUTH_URL: google.authUrl, GOOGLE_TOKEN_URL: google.tokenUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    account.stdout.on('data', (b) => { log += b; });
    account.stderr.on('data', (b) => { log += b; });
    for (const until = Date.now() + 30000; !/listening on/.test(log); await pause(100)) if (account.exitCode !== null || Date.now() > until) throw new Error(`account server did not start:\n${log}`);
    // A dev server of its own whose /api/account goes to this account server (vite.config.ts reads CC_SERVER_URL).
    process.env.CC_SERVER_URL = `http://127.0.0.1:${accountPort}`;
    dev = await createServer({ root, server: { host: '127.0.0.1', port: devPort, strictPort: true }, logLevel: 'error' });
    await dev.listen();
    delete process.env.CC_SERVER_URL;
    ab = await launchBrowser({ headless: true, args });
    const saved = async (username) => JSON.parse((await db.query('SELECT save FROM accounts WHERE username = $1', [username])).rows[0]?.save ?? '{}');
    const waitSave = async (username, ok, what) => {
      for (const until = Date.now() + 30000; ; await pause(300)) {
        const s = await saved(username);
        if (ok(s)) return s;
        if (Date.now() > until) throw new Error(`the account save never ${what}: ${JSON.stringify(s)}`);
      }
    };
    const device = async (seed) => {
      const c = await ab.newContext({ viewport: { width: 1600, height: 900 } });
      await c.routeWebSocket('**/multiplayer*', (ws) => ws.close());
      const page = await c.newPage();
      page.setDefaultTimeout(90000);
      watch(page);
      await page.addInitScript((seed) => {
        if (location.port !== seed.port || localStorage.getItem('cc.qaVaultSeed')) return;
        localStorage.setItem('cc.qaVaultSeed', '1');
        localStorage.setItem('cc.hintsSeen', '1');
        localStorage.setItem('cc.language', 'ko');
        localStorage.setItem('cc.quality', 'low');
        if (!seed.spec) return;
        localStorage.setItem('cc.spec', JSON.stringify(seed.spec));
        localStorage.setItem(`cc.journey.v1:${seed.spec.race}:${seed.spec.sex}:${seed.spec.classId}:${seed.spec.name}`, JSON.stringify({ xp: 950, coins: 5000, chapter: 1 }));
        localStorage.setItem('cc.vault.v1', '{"coins":300}');
      }, { port: String(devPort), ...seed });
      await page.goto(devBase);
      await page.locator('.launch-notice-start').click();
      await page.waitForFunction(() => window.app?.currentId === 'title');
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await page.evaluate(() => { window.__qaLeaving = true; });
      await page.getByRole('button', { name: 'Google로 로그인', exact: true }).click();
      await page.waitForFunction(() => !window.__qaLeaving && window.app?.currentId === 'title' && /^g[a-f0-9]{23}$/.test(window.app.account.username), null, { timeout: 90000 });
      return page;
    };
    const enter = async (page) => {
      await page.getByRole('button', { name: '입장하기', exact: true }).click();
      const dr = driver(page);
      await dr.loaded();
      await dr.ready();
    };
    const SAVER = { race: 'human', sex: 'female', classId: 'priest', shell: 2, crest: 1, led: 0, name: 'Vault saver' };
    const saverJourney = `cc.journey.v1:${SAVER.race}:${SAVER.sex}:${SAVER.classId}:${SAVER.name}`;

    // The first sign-in takes this device's guest adventure into the new account, the vault with it.
    const one = await device({ spec: SAVER });
    const username = await one.evaluate(() => window.app.account.username);
    let cloud = await waitSave(username, (s) => s['cc.vault.v1'] && s[saverJourney], 'took the guest adventure');
    assert.deepEqual([cloud['cc.vault.v1'], JSON.parse(cloud[saverJourney]).coins], ['{"coins":300}', 5000]);
    console.log(`PASS the first Google sign-in takes the guest adventure into the new account, vault included (save: 5,000 carried, vault {"coins":300})`);
    await enter(one);
    const od = driver(one);
    await od.intoCapital();
    const signed = await od.toBell();
    assert.deepEqual(signed.tiles, ['🪙 5,000', '🪙 300']);
    assert.ok(signed.note.includes('이 Google 계정의 모든 캐릭터가 같은 금고를 써요'), signed.note);
    const dep = await od.click('deposit', 1000);
    assert.deepEqual(dep.state, { carried: 4000, vault: 1300, stored: '{"coins":1300}', journey: 4000 });
    const keys = await one.evaluate((u) => ({ account: localStorage.getItem(`cc.account.v1:${u}:cc.vault.v1`), guest: localStorage.getItem('cc.vault.v1') }), username);
    assert.deepEqual(keys, { account: '{"coins":1300}', guest: '{"coins":300}' });
    await one.screenshot({ path: `${shots}/vault-signed-in.png` });
    cloud = await waitSave(username, (s) => s['cc.vault.v1'] === '{"coins":1300}', 'took the deposit');
    assert.equal(JSON.parse(cloud[saverJourney]).coins, 4000, 'the journey half of the deposit is in the same save');
    console.log('PASS signed in, the page says every character of the Google account shares the vault; a 1,000 deposit is saved under the account (the guest vault stays 300) and reaches the account save together with the journey (4,000 carried, vault 1,300)');

    // A second computer loads the account's vault; a second character there takes it all out.
    const two = await device({});
    assert.equal(await two.evaluate(() => window.app.account.username), username);
    assert.equal(await two.evaluate((u) => localStorage.getItem(`cc.account.v1:${u}:cc.vault.v1`), username), '{"coins":1300}');
    const FRIEND = { race: 'tauren', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 1, name: 'Vault friend' };
    await two.evaluate((spec) => window.app.saveSpec(spec), FRIEND);
    await enter(two);
    const friend = await two.evaluate(() => window.__V.state());
    assert.deepEqual([friend.carried, friend.vault, friend.stored], [0, 1300, '{"coins":1300}']);
    const td = driver(two);
    await td.intoCapital();
    await td.toBell();
    const all = await td.click('withdraw', 'all');
    assert.deepEqual(all.state, { carried: 1300, vault: 0, stored: '{"coins":0}', journey: 1300 });
    await two.screenshot({ path: `${shots}/vault-second-computer.png` });
    cloud = await waitSave(username, (s) => s['cc.vault.v1'] === '{"coins":0}', 'took the withdrawal');
    const friendJourney = `cc.journey.v1:${FRIEND.race}:${FRIEND.sex}:${FRIEND.classId}:${FRIEND.name}`;
    assert.equal(JSON.parse(cloud[friendJourney]).coins, 1300);
    console.log('PASS a second computer on the same Google account loads the vault (1,300); a second character there (Vault friend) takes it all out, saved to the account with its journey (1,300 carried, vault 0)');

    // The first computer, reloaded, loads that vault.
    await one.reload();
    await one.locator('.launch-notice-start').click();
    await one.waitForFunction(() => window.app?.currentId === 'title' && /^g[a-f0-9]{23}$/.test(window.app.account.username));
    const reloaded = await one.evaluate((u) => ({ account: localStorage.getItem(`cc.account.v1:${u}:cc.vault.v1`), guest: localStorage.getItem('cc.vault.v1') }), username);
    assert.deepEqual(reloaded, { account: '{"coins":0}', guest: '{"coins":300}' });
    assert.deepEqual(errors, []);
    console.log('PASS the first computer, reloaded, loads the emptied vault from the account (the guest vault is still its own 300); zero page errors');
  } finally {
    await ab?.close();
    await dev?.close();
    if (account && account.exitCode === null) account.kill('SIGTERM');
    await db.end().catch(() => {});
    await google.close();
    postgres.stop();
  }
}
