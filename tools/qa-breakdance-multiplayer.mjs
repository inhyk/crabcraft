#!/usr/bin/env node
// Two browsers in one room through the local relay (pnpm dev; the Vite plugin runs it): the host
// presses B and both screens must play the six-move breakdance, in order, to the end, each move
// starting on the guest's screen within 300 ms of the host's (the screenshots stall both pages for
// longer than that, which the per-move announcements must absorb); screenshots of both are taken at
// the same moment during the toprock, the 720 and the freeze. Then the host
// starts it again and walks, and the guest's copy must stop too; then the guest starts it from the
// multiplayer panel's button and the host must see it. Any console error or page error fails.
//
//   node tools/qa-breakdance-multiplayer.mjs [--url http://127.0.0.1:5192] [--out tmp/qa/breakdance-mp]
import { launchBrowser } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://127.0.0.1:5192');
const outDir = resolve(opt('--out', 'tmp/qa/breakdance-mp'));
mkdirSync(outDir, { recursive: true });
const relay = `${base.replace(/^http/, 'ws')}/multiplayer`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROUTINE = ['break_toprock', 'break_sixstep', 'break_spin', 'break_jumpspin', 'break_backflip', 'break_oneclaw'];
// Seconds into each move for the shared screenshot (the 720 near its apex).
const SHOTS = { break_toprock: 2.5, break_jumpspin: 0.42, break_oneclaw: 2.6 };

const browser = await launchBrowser({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const errors = [];
const fails = [];
const shots = [];

async function open(name, spec) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location()?.url ?? '';
    if (/Failed to load resource/.test(m.text()) && /\/(art|audio|fonts)\//.test(url)) return;
    errors.push(`${name}: ${m.text()} ${url ? `(${url})` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: pageerror: ${e.message}`));
  await page.addInitScript(([spec, relay]) => {
    localStorage.clear();
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.spec', JSON.stringify(spec));
    // Always the local relay, whatever the build was told.
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url, protocols) {
        super(String(url).includes('/multiplayer') ? relay + new URL(String(url)).search : url, protocols);
      }
    };
  }, [spec, relay]);
  await page.goto(`${base}/?screen=game`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.app?.current?.game?.loaded, null, { timeout: 90000 });
  return page;
}

/** The host's own routine on the host's screen; the host's crab replayed on the guest's screen. */
const own = (page) => page.evaluate(() => {
  const r = window.app.current.game.player.breakdance;
  return { active: r.active, step: r.step?.id ?? null, completed: r.lastCompleted };
});
const mirrored = (page) => page.evaluate(() => {
  const peer = [...window.app.current.game.multiplayer.peers.values()][0];
  const r = peer?.dance;
  return { active: !!r?.active, step: r?.step?.id ?? null, completed: r?.lastCompleted ?? null, action: peer?.unit?.motion.action ?? null };
});
/**
 * Every move change on this page, recorded in the page each frame (a poll from here can miss the
 * 1.2 s back flip while it takes screenshots): the own crab's routine, or the first peer's copy.
 */
const record = (page, which) => page.evaluate((which) => {
  const log = (window.__breakLog = []);
  let last = null;
  const tick = () => {
    const g = window.app.current.game;
    const r = which === 'own' ? g.player.breakdance : [...g.multiplayer.peers.values()][0]?.dance;
    const step = r?.active ? r.step?.id ?? null : null;
    if (step !== last) {
      last = step;
      log.push({ step, at: performance.timeOrigin + performance.now() });
    }
    window.__breakRaf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(window.__breakRaf);
  tick();
}, which);
const recorded = (page) => page.evaluate(() => window.__breakLog.filter((e) => e.step));
const until = async (fn, what, timeout = 15000) => {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(40);
  }
};

let host = null;
let guest = null;
try {
  host = await open('host', { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Host Crab' });
  guest = await open('guest', { race: 'orc', sex: 'female', classId: 'mage', shell: 1, crest: 1, led: 1, name: 'Guest Crab' });
  await host.evaluate(() => window.app.current.game.multiplayer.connect('create'));
  await host.waitForFunction(() => window.app.current.game.multiplayer.room);
  const room = await host.evaluate(() => window.app.current.game.multiplayer.room);
  await guest.evaluate((room) => window.app.current.game.multiplayer.connect('join', room), room);
  for (const p of [host, guest]) {
    await p.waitForFunction(() => [...window.app.current.game.multiplayer.peers.values()].some((peer) => peer.unit && peer.state), null, { timeout: 30000 });
  }
  console.log(`room ${room}: both clients see each other`);

  // The guest stands three metres to the host's left, both facing the same way; each camera looks
  // at its own crab from behind, a little to the side, so both crabs are on both screens (from the
  // front, Brinebeard by the fountain stands in the way).
  const at = await host.evaluate(() => {
    const u = window.app.current.game.player.unit;
    return { x: u.pos.x, z: u.pos.z, yaw: u.yaw };
  });
  await guest.evaluate((at) => {
    const g = window.app.current.game;
    g.player.unit.teleport(g.world, at.x + Math.cos(at.yaw) * 3, at.z - Math.sin(at.yaw) * 3, at.yaw);
  }, at);
  for (const [p, side] of [[host, 0.7], [guest, -0.7]]) {
    await p.evaluate((side) => {
      const g = window.app.current.game;
      g.follow.yaw = g.player.unit.yaw + Math.PI + side;
      g.follow.pitch = 0.32;
      g.follow.distance = 8;
    }, side);
  }
  await sleep(1500);
  await Promise.all([host.screenshot({ path: resolve(outDir, '00-host-idle.png'), timeout: 120000 }), guest.screenshot({ path: resolve(outDir, '00-guest-idle.png'), timeout: 120000 })]);

  // 1. The host breaks; the guest's screen plays the same moves, each starting with the host's.
  const ended = () => Promise.all([
    host.waitForFunction(() => !window.app.current.game.player.breakdance.active, null, { timeout: 60000 }),
    guest.waitForFunction(() => {
      const r = [...window.app.current.game.multiplayer.peers.values()][0]?.dance;
      return !!r && !r.active;
    }, null, { timeout: 60000 }),
  ]);
  await Promise.all([record(host, 'own'), record(guest, 'peer')]);
  await host.mouse.click(640, 400);
  await host.keyboard.press('KeyB');
  await ended();
  const [hEnd, gEnd] = await Promise.all([own(host), mirrored(guest)]);
  const [hLog, gLog] = await Promise.all([recorded(host), recorded(guest)]);
  const seenHost = hLog.map((e) => e.step);
  const seenGuest = gLog.map((e) => e.step);
  // Wall-clock delay from the host starting a move to the guest's copy starting it.
  const lag = gLog.map((e, i) => (hLog[i] ? Math.round(e.at - hLog[i].at) : NaN));
  if (JSON.stringify(seenHost) !== JSON.stringify(ROUTINE)) fails.push(`host moves ${seenHost.join(', ')}`);
  if (JSON.stringify(seenGuest) !== JSON.stringify(ROUTINE)) fails.push(`guest saw ${seenGuest.join(', ')}`);
  if (hEnd.completed !== true || gEnd.completed !== true) fails.push(`completed: host ${hEnd.completed}, guest ${gEnd.completed}`);
  if (lag.some((l) => !(Math.abs(l) <= 300))) fails.push(`a move started on the guest's screen more than 300 ms from the host's (${lag.join(', ')} ms)`);
  console.log(`  host ${seenHost.join(' > ')} (completed ${hEnd.completed}); guest ${seenGuest.join(' > ')} (completed ${gEnd.completed}); guest step lag ${lag.join(', ')} ms`);

  // Screenshots of both screens at the same moment of a move, one run of the routine each. Each page
  // waits frame by frame for that moment on its own timeline (the host's routine, the guest's copy)
  // and stops its render loop there, so a screenshot that takes seconds on a busy machine still
  // shows that moment; then both loops run again and B ends the run.
  const freezeAt = (page, id, at) => page.waitForFunction(([id, at]) => {
    const e = window.__breakLog.at(-1);
    const ok = !!e && e.step === id && performance.timeOrigin + performance.now() - e.at >= at * 1000;
    if (ok) window.app.engine.stop();
    return ok;
  }, [id, at], { polling: 'raf', timeout: 40000 });
  for (const [id, at] of Object.entries(SHOTS)) {
    await sleep(600);
    await Promise.all([record(host, 'own'), record(guest, 'peer')]);
    await host.keyboard.press('KeyB');
    await Promise.all([freezeAt(host, id, at), freezeAt(guest, id, at)]);
    const n = String(ROUTINE.indexOf(id) + 1).padStart(2, '0');
    const files = [resolve(outDir, `${n}-${id}-host.png`), resolve(outDir, `${n}-${id}-guest.png`)];
    const [hs, gs] = await Promise.all([own(host), mirrored(guest)]);
    await Promise.all([host.screenshot({ path: files[0], timeout: 120000 }), guest.screenshot({ path: files[1], timeout: 120000 })]);
    await Promise.all([host, guest].map((p) => p.evaluate(() => window.app.engine.start())));
    shots.push(...files);
    console.log(`  ${id}: host plays ${hs.step}, guest shows the host's crab in ${gs.step} (its clip ${gs.action})`);
    if (hs.step !== gs.step) fails.push(`at the ${id} screenshot the host played ${hs.step} but the guest showed ${gs.step}`);
    if ((await own(host)).active) await host.keyboard.press('KeyB');
    await ended();
  }

  // 2. Walking ends the host's routine, and the guest's copy with it.
  await sleep(800);
  await host.keyboard.press('KeyB');
  await until(async () => (await mirrored(guest)).step === 'break_toprock', 'the guest to see the second run');
  await sleep(1500);
  await host.keyboard.down('KeyW');
  await sleep(400);
  await host.keyboard.up('KeyW');
  const stopAt = Date.now();
  await until(async () => !(await mirrored(guest)).active, 'the guest copy to stop', 5000);
  const [hStop, gStop] = await Promise.all([own(host), mirrored(guest)]);
  if (hStop.completed !== false || gStop.completed !== false) fails.push(`walking: host completed ${hStop.completed}, guest completed ${gStop.completed}`);
  console.log(`  walking: host routine cut short (${hStop.completed}), guest copy stopped ${Date.now() - stopAt} ms after the key came up (${gStop.completed})`);

  // 3. The guest starts it from the panel button; the host sees it.
  await guest.evaluate(() => { document.querySelector('.mp-panel').open = true; });
  await sleep(1200);
  await guest.click('[data-emote="breakdance"]');
  await until(async () => (await mirrored(host)).step === 'break_toprock', 'the host to see the guest break');
  const g3 = await own(guest);
  if (!g3.active) fails.push('the panel button did not start the guest routine');
  await sleep(2000);
  const files = [resolve(outDir, '07-guest-button-host.png'), resolve(outDir, '07-guest-button-guest.png')];
  await Promise.all([host.screenshot({ path: files[0], timeout: 120000 }), guest.screenshot({ path: files[1], timeout: 120000 })]);
  shots.push(...files);
  const label = await guest.evaluate(() => document.querySelector('[data-emote="breakdance"]').textContent);
  // The button gives the keyboard back: W on the guest's page ends its routine.
  await guest.keyboard.down('KeyW');
  await sleep(400);
  await guest.keyboard.up('KeyW');
  await until(async () => !(await mirrored(host)).active, 'the host copy of the guest routine to stop', 5000);
  console.log(`  panel button "${label}": guest broke, host saw it, guest W stopped both`);
} catch (e) {
  fails.push(`step failed: ${e.message}`);
  // What each page had recorded, for the report.
  for (const [name, p] of [['host', host], ['guest', guest]]) {
    if (!p) continue;
    const log = await p.evaluate(() => (window.__breakLog ?? []).map((e) => `${e.step}@${Math.round(e.at % 1e6)}`)).catch(() => []);
    console.log(`  ${name} recorded: ${log.join(' ')}`);
  }
  if (host) console.log(`  host now: ${JSON.stringify(await own(host).catch(() => null))}`);
}
await browser.close();
console.log(`console errors: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
for (const f of fails) console.log(`fail: ${f}`);
console.log(`screenshots:\n${shots.map((s) => `  ${s}`).join('\n')}`);
const pass = !fails.length && !errors.length;
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
