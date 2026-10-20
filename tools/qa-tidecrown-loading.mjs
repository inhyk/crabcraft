// The Tidecrown loading screen, entered on foot over the King's Road: the first entry (the island built), a second
// entry, and a third at phone width. Each shows the loading painting with the Tidecrown art loaded (not the fallback),
// a bar that only rises and is full before the screen fades, and is gone once inside; the first entry's label changes
// at least twice, a re-entry stays up long enough not to flash, leaving shows no loading screen, nothing of the old
// text-only veil appears, and there are no page or shader errors. The first entry is screencast: the bar's fill is
// read from the frames (it keeps rising while the build blocks the page), and a frame at mid-progress and one near the
// end are saved with a phone-width shot to CC_QA_SHOTS (default tmp/qa/tidecrown-loading).
// Usage: CC_QA_BASE=http://127.0.0.1:5256 node tools/qa-tidecrown-loading.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5241';
const shots = process.env.CC_QA_SHOTS ?? 'tmp/qa/tidecrown-loading';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|merge|geometr|tidecrown|zone line/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  p.setDefaultTimeout(60000);
  await p.addInitScript(() => {
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Loading watcher' }));
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'high');
  });
  await p.goto(base + '/?screen=game');
  await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
  const start = await p.evaluate(async () => {
    const g = window.app.current.game;
    g.god = true;
    for (const e of g.enemies) if (e.state !== 'gone') e.despawn();
    const L = await import('/src/world/layout.ts');
    const [kings, back] = g.zoneLines.lines;
    window.__kings = kings; window.__back = back;
    // Every loading screen that appears: its parts, the bar (computed scaleX) at each frame, run and label change,
    // when it starts to fade (and the bar then), when it goes; and any element of the old veil.
    const now = () => performance.timeOrigin + performance.now();
    window.__ld = { runs: [], veil: 0 };
    const scale = (bar) => { const m = /matrix\(([^,]+)/.exec(getComputedStyle(bar).transform); return m ? +m[1] : 0; };
    const track = (el) => {
      const bar = el.querySelector('.ld-bar > i'), label = el.querySelector('.ld-label'), box = el.querySelector('.ld-bar').getBoundingClientRect();
      const r = { el, t0: now(), on: true, samples: [], runs: [], labels: [{ t: 0, text: label.textContent }], outAt: null, outF: null, outArt: null, removedAt: null, bar: { x: box.x, y: box.y, w: box.width, h: box.height },
        parts: { title: el.querySelector('.ld-title')?.textContent, sub: el.querySelector('.ld-sub')?.textContent, tip: el.querySelector('.ld-tip')?.textContent, art: getComputedStyle(el.querySelector('.ld-art')).backgroundImage, z: getComputedStyle(el).zIndex } };
      const rec = (why) => r.samples.push({ t: now() - r.t0, f: scale(bar), op: +getComputedStyle(el).opacity, why });
      r.runs.push({ t: 0, to: bar.style.transform, ms: bar.style.transition });
      new MutationObserver(() => { r.labels.push({ t: now() - r.t0, text: label.textContent }); rec('label'); }).observe(label, { childList: true, characterData: true, subtree: true });
      new MutationObserver(() => { r.runs.push({ t: now() - r.t0, to: bar.style.transform, ms: bar.style.transition }); rec('run'); }).observe(bar, { attributes: true, attributeFilter: ['style'] });
      new MutationObserver(() => { if (el.classList.contains('out') && r.outAt === null) { r.outAt = now() - r.t0; r.outF = scale(bar); r.outArt = el.dataset.art ?? null; r.outFallback = el.classList.contains('fallback'); } }).observe(el, { attributes: true, attributeFilter: ['class'] });
      const loop = () => { if (!r.on) return; rec('frame'); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      window.__ld.runs.push(r);
    };
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) {
          if (n.matches('.tidecrown-veil') || n.querySelector('.tidecrown-veil')) window.__ld.veil++;
          if (n.matches('.tidecrown-loading')) track(n);
        }
        for (const n of m.removedNodes) { const r = window.__ld.runs.find((r) => r.el === n); if (r) { r.removedAt = now() - r.t0; r.on = false; } }
      }
    }).observe(document.body, { childList: true, subtree: true });
    const lineS = L.kingsRoadArcAtZ(L.KINGS_ROAD_LINE.a[1]), at = L.kingsRoadAt(lineS - 4);
    return { kings: [at.x, at.z, Math.atan2(at.dx, at.dz)], back: [-70, 334, 0] };
  });
  await p.waitForTimeout(800);

  const hold = async (on) => {
    const v = p.viewportSize();
    if (on) { await p.mouse.move(v.width / 2, v.height / 2); await p.mouse.down({ button: 'right' }); await p.keyboard.down('KeyW'); }
    else { await p.keyboard.up('KeyW'); await p.mouse.up({ button: 'right' }); }
  };
  /** From a few steps before a zone line, walk across it (the `line` global's fire count reaching `n`). */
  const cross = async (from, line, n) => {
    await p.evaluate(([x, z, yaw]) => { const g = window.app.current.game; g.player.unit.teleport(g.world, x, z, yaw); g.follow.yaw = yaw + Math.PI; g.follow.cut(); }, from);
    await p.waitForTimeout(500);
    await hold(true);
    try { await p.waitForFunction(([line, n]) => window[line].fired >= n, [line, n], { timeout: 30000, polling: 'raf' }); } finally { await hold(false); }
  };
  const settled = (inside) => p.waitForFunction((inside) => window.app.current.game.world2.inTidecrown === inside && !document.querySelector('.cc-blackout.on') && !document.querySelector('.tidecrown-loading'), inside, { timeout: 60000 });
  const runs = () => p.evaluate(() => window.__ld.runs.map(({ el, ...r }) => ({ ...r, inDom: el.isConnected })));
  const series = (r) => r.samples.filter((s) => s.op > 0).map((s) => s.f);
  /** The checks every entry shares; returns the run. */
  const checkEntry = async (k, name) => {
    await settled(true);
    const all = await runs(), r = all[k];
    assert.equal(all.length, k + 1, `${name}: one loading screen`);
    assert.equal(r.parts.title, '타이드크라운', `${name}: the title`);
    assert.ok(r.parts.sub.includes('왕국의 수도') && r.parts.tip.length > 10, `${name}: subtitle and tip: ${JSON.stringify(r.parts)}`);
    assert.ok(r.parts.art.includes('loading-tidecrown.webp') && +r.parts.z > 2000, `${name}: Tidecrown art, above the blackout: ${JSON.stringify(r.parts)}`);
    assert.equal(r.outArt, 'loaded', `${name}: the art loaded before the screen went`);
    assert.ok(!r.outFallback, `${name}: not the fallback`);
    const f = series(r);
    for (let i = 1; i < f.length; i++) assert.ok(f[i] >= f[i - 1] - 0.002, `${name}: the bar only rises (${f[i - 1]} then ${f[i]})`);
    const to = r.runs.map((x) => +(/scaleX\(([^)]+)\)/.exec(x.to)?.[1] ?? 0));
    for (let i = 1; i < to.length; i++) assert.ok(to[i] >= to[i - 1], `${name}: every run heads higher (${to.join(', ')})`);
    assert.ok(r.outF >= 0.999, `${name}: the bar is full when the screen starts to go (${r.outF})`);
    assert.ok(r.removedAt !== null && !r.inDom, `${name}: the screen is gone once inside`);
    assert.equal(await p.evaluate(() => window.__ld.veil + document.querySelectorAll('.tidecrown-veil').length), 0, `${name}: nothing of the old veil`);
    return r;
  };
  const brief = (r) => ({ shownMs: Math.round(r.outAt), goneMs: Math.round(r.removedAt), labels: r.labels.map((l) => `${Math.round(l.t)} ${l.text}`), runs: r.runs.map((x) => `${Math.round(x.t)} ${x.to} ${x.ms}`) });

  // 1. The first entry, screencast so the bar can be read from the frames while the build blocks the page.
  const cdp = await p.context().newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    const t = f.metadata.timestamp * 1000;
    if (!frames.length || t - frames[frames.length - 1].t >= 60) frames.push({ t, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });
  await cross(start.kings, '__kings', 1);
  const first = await checkEntry(0, 'first entry');
  await cdp.send('Page.stopScreencast');
  const changes = first.labels.filter((l, i) => i && l.text !== first.labels[i - 1].text).length;
  assert.ok(changes >= 2, `first entry: the label changes at least twice (${changes})`);
  console.log(JSON.stringify({ first: brief(first) }));
  // The bar's fill in each frame while the screen is fully up (between its fade in and out).
  const dec = await browser.newPage();
  const shown = frames.filter((f) => f.t >= first.t0 + 450 && f.t <= first.t0 + first.outAt);
  const fills = [];
  for (const f of shown) fills.push({ t: f.t - first.t0, f: await dec.evaluate(async ({ data, bar }) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + data)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const w = Math.round(bar.w), row = ctx.getImageData(Math.round(bar.x), Math.round(bar.y + bar.h / 2), w, 1).data;
    let last = -1;
    for (let i = 0; i < w; i++) if ((row[i * 4] + row[i * 4 + 1] + row[i * 4 + 2]) / 3 > 70) last = i;
    return (last + 1) / w;
  }, { data: f.data, bar: first.bar }) });
  await dec.close();
  assert.ok(fills.length >= 10, `frames while the screen was up: ${fills.length}`);
  for (let i = 1; i < fills.length; i++) assert.ok(fills[i].f >= fills[i - 1].f - 0.015, `first entry: the bar on screen only rises (${fills[i - 1].f.toFixed(3)} at ${Math.round(fills[i - 1].t)} ms, then ${fills[i].f.toFixed(3)})`);
  const gaps = fills.slice(1).map((x, i) => x.t - fills[i].t);
  console.log(JSON.stringify({ firstOnScreen: fills.filter((_, i) => i % 4 === 0 || i === fills.length - 1).map((x) => `${Math.round(x.t)}:${x.f.toFixed(2)}`), frames: fills.length, longestGapMs: Math.round(Math.max(...gaps)) }));
  const pick = (want) => fills.reduce((a, b) => (Math.abs(b.f - want) < Math.abs(a.f - want) ? b : a));
  const mid = pick(0.5), end = pick(0.93);
  for (const [name, f] of [['1-first-entry-mid', mid], ['2-first-entry-near-end', end]]) await writeFile(`${shots}/${name}.jpg`, Buffer.from(shown[fills.indexOf(f)].data, 'base64'));
  console.log(`PASS first entry over the King's Road: the Tidecrown painting (art loaded), ${changes} label changes, the bar only rose (on screen too) and was full as the screen went at ${Math.round(first.outAt)} ms; shots at ${mid.f.toFixed(2)} and ${end.f.toFixed(2)}`);

  // 2. Out over the return line (no loading screen), then a second entry: the same screen, never a flash.
  await cross(start.back, '__back', 1);
  await settled(false);
  assert.equal((await runs()).length, 1, 'leaving Tidecrown shows no loading screen');
  await p.waitForTimeout(800);
  await cross(start.kings, '__kings', 2);
  const second = await checkEntry(1, 'second entry');
  assert.ok(second.outAt >= 850, `second entry: up long enough not to flash (${Math.round(second.outAt)} ms)`);
  console.log(JSON.stringify({ second: brief(second) }));
  console.log(`PASS second entry: the same screen for ${Math.round(second.outAt)} ms before it fades, the bar full, then gone`);

  // 3. At phone width: everything inside the screen's width, and a shot.
  await cross(start.back, '__back', 2);
  await settled(false);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(800);
  await cross(start.kings, '__kings', 3);
  await p.waitForFunction(() => { const r = window.__ld.runs[2]; return r && +getComputedStyle(r.el).opacity > 0.99 && r.el.dataset.art; }, null, { timeout: 30000, polling: 'raf' });
  const fit = await p.evaluate(() => {
    const el = window.__ld.runs[2].el, w = innerWidth;
    // The art's slow push-in overflows its own clipped box, as on the game start's screen; the page must not scroll.
    return { w, scroll: document.scrollingElement.scrollWidth, clip: getComputedStyle(el).overflow, parts: ['.ld-title', '.ld-sub', '.ld-tip', '.ld-bar', '.ld-label'].map((s) => { const b = el.querySelector(s).getBoundingClientRect(); return [s, Math.round(b.left), Math.round(b.right)]; }) };
  });
  await p.screenshot({ path: `${shots}/3-phone-390x844.png` });
  for (const [s, l, r] of fit.parts) assert.ok(l >= 0 && r <= fit.w, `phone: ${s} fits (${l}..${r} of ${fit.w})`);
  assert.ok(fit.scroll <= fit.w && fit.clip === 'hidden', `phone: no sideways scroll (${fit.scroll}, ${fit.clip})`);
  await checkEntry(2, 'third entry (phone)');
  console.log(`PASS phone width: ${JSON.stringify(fit.parts)}`);

  assert.deepEqual(errors, []);
  console.log('PASS zero page or shader errors');
} finally {
  await browser.close();
}
