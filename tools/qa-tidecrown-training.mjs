// Class training in Tidecrown (Chrome for Testing on the dev server, a new save per class). The three trainers stand in
// their districts (the warrior's by the Barnacle Works' forge, the priest's on the Cathedral's parvis, the mage's west
// of the great Seaglass tower) as keepers, with three training dummies each, all on free ground, off every street and
// clear of the residents, the King, Captain Ara, Opal and the Seaglass portal; none is a game unit. For each class a
// real F opens its trainer's page with its five skills and a tip for each, and another trainer's page lists that class's
// skills with a pointer home; "Practise" targets a dummy and brings up the practice panel. Every skill of the class is
// used through its key on the dummies: the damaging ones land (numbers float up), the rest do what they do there
// (charge arrives, stun, slow, heal, ward, blink); the panel's total, hits and biggest hit match the hits and its reset
// clears them. Dummies never die (a hit of a billion wraps them round), never move, give no XP or coins, and an accepted
// kingdom kill request stays at 0. A hit puts the player in combat: travel waits, the trainer still answers, and 5 s
// later travel is open again. In a relay room as a member, hits still land and nothing about a dummy is sent (no
// combat event, no skill aimed at it) and the room's units are untouched. On ?world=server nothing is built. Zero page
// errors throughout.
// Writes 1600x900 shots (each trainer with the dummies, a trainer's page, the practice panel) to CC_QA_SHOTS (default
// tmp/training-shots) and a contact sheet to CC_QA_SHEET (default docs/qa/tidecrown-training.jpg).
// Usage: CC_QA_BASE=http://127.0.0.1:5282 node tools/qa-tidecrown-training.mjs   (CC_QA_SERVER=0 skips the server
//   world; WORLD_QA_BROWSER_PORT, WORLD_QA_HOST_PORT pick its ports, default 5285 and 5286)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from './lib/browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5282';
const shots = process.env.CC_QA_SHOTS ?? join(root, 'tmp/training-shots');
const sheet = process.env.CC_QA_SHEET ?? join(root, 'docs/qa/tidecrown-training.jpg');
await mkdir(shots, { recursive: true });
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'];
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|tidecrown|training|dummy|keeper|hub/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
};
const CLASSES = ['warrior', 'priest', 'mage'];
const SPEC = { warrior: { race: 'orc', sex: 'female' }, priest: { race: 'dwarf', sex: 'male' }, mage: { race: 'undead', sex: 'female' } };

const browser = await launchBrowser({ headless: true, args });
try {
  for (const [ci, cls] of CLASSES.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const p = await ctx.newPage();
    p.setDefaultTimeout(90000);
    watch(p);
    await p.routeWebSocket('**/multiplayer*', (ws) => ws.close());
    await p.addInitScript(({ cls, spec }) => {
      localStorage.setItem('cc.spec', JSON.stringify({ ...spec, classId: cls, shell: 0, crest: 0, led: 0, name: `Trainee ${cls}` }));
      localStorage.setItem('cc.hintsSeen', '1');
      localStorage.setItem('cc.language', 'ko');
      localStorage.setItem('cc.quality', 'high');
    }, { cls, spec: SPEC[cls] });
    await p.goto(base + '/?screen=game');
    await p.locator('.launch-notice-start').click();
    await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
    await p.evaluate(async () => {
      const g = window.app.current.game;
      g.creatorTravel = true;
      g.ending.cancel();
      window.__before = { units: g.units.length };
      await g.world2.enterTidecrown();
      const M = await import('/src/game/tidecrown/training.ts'), P = await import('/src/game/tidecrown/cityPlan.ts'), L = await import('/src/game/abilityLocale.ts'), D = await import('/src/data/classes.ts');
      const tr = g.world2.hub.training, dummies = [...tr.units];
      const yard = (i) => dummies.filter((u) => u.ctrl.yard === i);
      window.__hits = [];
      window.__deaths = [];
      window.__abilities = [];
      window.__heals = 0;
      window.__log = [];
      g.events.listen((e) => {
        try {
          if (['press', 'error', 'castStart', 'castEnd', 'heal', 'ward'].includes(e.type) && (e.unit ?? e.dst) === g.player.unit) window.__log = [...window.__log.slice(-11), `${g.time.toFixed(2)} ${e.type} ${e.reason ?? e.result ?? e.slot ?? e.amount ?? e.stage ?? ''}`];
          if (e.type === 'damage' && tr.units.includes(e.dst)) window.__hits.push({ amount: e.amount, crit: e.crit, dst: dummies.indexOf(e.dst), mine: e.src === g.player.unit, t: g.time });
          else if (e.type === 'death') window.__deaths.push(e.unit.name);
          else if (e.type === 'heal' && e.dst === g.player.unit && e.src === g.player.unit) window.__heals++;
          else if (e.type === 'ability' && e.caster === g.player.unit) window.__abilities.push({ ability: e.ability, stage: e.stage, target: e.target ? dummies.indexOf(e.target) : null });
        } catch (err) { window.__listenerError = String(err); }
      });
      window.__T = {
        M, P, L, D, g, tr, dummies, yard,
        prompt: () => document.querySelector('.prompt.on')?.textContent ?? '',
        dialogue: () => ({
          name: g.hud.dialogue.unit?.name ?? null, title: document.querySelector('.dlg-qtitle')?.textContent ?? '', text: document.querySelector('.dlg-text')?.textContent ?? '',
          skills: [...document.querySelectorAll('.train-skill')].map((s) => ({ id: s.dataset.ability, name: s.querySelector('.train-name')?.textContent ?? '', meta: s.querySelector('.train-meta')?.textContent ?? '', tip: s.querySelector('.train-tip')?.textContent ?? '' })),
          buttons: [...document.querySelectorAll('.dlg-buttons .cc-btn')].map((b) => b.textContent),
        }),
        panel: () => {
          const el = document.querySelector('.practice');
          return el ? { shown: !el.classList.contains('hidden'), dps: el.querySelector('.practice-dps b')?.textContent ?? '', total: el.querySelector('.practice-total')?.textContent ?? '', biggest: el.querySelector('.practice-biggest')?.textContent ?? '', hits: el.querySelector('.practice-hits')?.textContent ?? '' } : null;
        },
        purse: () => ({ xp: g.player.xp, coins: g.player.coins, level: g.player.level }),
        // Stand `d` in front of the post (x, z) facing it, the camera behind.
        face: (x, z, yaw, d) => {
          const px = x + Math.sin(yaw) * d, pz = z + Math.cos(yaw) * d;
          g.player.setTarget(null);
          g.player.unit.teleport(g.world, px, pz, yaw + Math.PI);
          g.follow.yaw = yaw;
          g.follow.cut();
        },
        cam: (cam, at) => { g.follow.update = function () { this.camera.position.set(...cam); this.camera.lookAt(...at); }; },
        free: () => { delete g.follow.update; },
      };
    });
    await p.waitForFunction(() => !document.querySelector('.tidecrown-loading'));
    await p.waitForTimeout(4500);
    const reveal = async () => {
      await p.locator('.dlg-text').click();
      await p.waitForFunction(() => !window.app.current.game.hud.dialogue.typing);
    };
    const talkTo = async (i) => {
      await p.evaluate((i) => { const k = window.__T.M.TRAINING_YARDS[i].trainer; window.__T.g.hud.dialogue.close(); window.__T.face(k.x, k.z, k.yaw, 2.6); }, i);
      const name = await p.evaluate((i) => window.__T.M.TRAINING_YARDS[i].trainer.name[0], i);
      await p.waitForFunction((name) => window.__T.prompt().includes(`${name}에게 말 걸기`), name);
      const prompt = await p.evaluate(() => window.__T.prompt());
      await p.keyboard.press('KeyF');
      await p.waitForFunction((name) => window.app.current.game.hud.dialogue.unit?.name === name, name);
      await reveal();
      return { prompt, ...(await p.evaluate(() => window.__T.dialogue())) };
    };

    // 1. Where everything stands (once): keepers and dummies, not game units, on free ground, off the streets, clear.
    if (ci === 0) {
      const place = await p.evaluate(() => {
        const { g, tr, M, P, dummies } = window.__T, I = g.world2.tidecrown, hub = g.world2.hub;
        const o = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
        const free = (x, z, r) => { I.resolve(x, z, r, o); return Math.hypot(o.x - x, o.y - z) < 0.02; };
        const seg = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
        const street = (x, z) => Math.min(...P.TC_CITY_STREETS.flatMap((s) => s.points.slice(1).map((q, i) => seg(x, z, s.points[i], q) - s.width / 2)));
        const people = g.world2.tidecrownPeople.people.flatMap((r) => [r.home, r.end]);
        const keepers = hub.units.filter((u) => /^tc-(king|captain|portal-keeper)$/.test(u.npcId)).map((u) => u.pos);
        const portal = { x: -50, z: -110 };
        const trainers = hub.units.filter((u) => u.npcId.startsWith('tc-trainer-'));
        const all = [...trainers.map((u) => ({ u, r: u.radius + 0.2, kind: 'trainer' })), ...dummies.map((u) => ({ u, r: u.radius + 0.2, kind: 'dummy' }))];
        const report = all.map(({ u, r, kind }) => ({
          kind, name: u.name, x: +u.pos.x.toFixed(1), z: +u.pos.z.toFixed(1), free: free(u.pos.x, u.pos.z, r), ground: +Math.abs(u.pos.y - I.height(u.pos.x, u.pos.z)).toFixed(3),
          street: +street(u.pos.x, u.pos.z).toFixed(1), resident: +Math.min(...people.map((q) => Math.hypot(q.x - u.pos.x, q.z - u.pos.z))).toFixed(1),
          named: +Math.min(...[...keepers, portal].map((q) => Math.hypot(q.x - u.pos.x, q.z - u.pos.z))).toFixed(1),
          unit: g.units.includes(u), hidden: u.hidden, plate: g.hud.plates.also.has(u),
        }));
        return {
          report, trainers: trainers.map((u) => u.npcId), dummies: dummies.length, live: tr.units.length,
          markers: hub.markers().map((m) => m.label), growth: g.units.length - window.__before.units, residents: g.world2.tidecrownPeople.people.length,
          yards: M.TRAINING_YARDS.map((y) => y.cls),
        };
      });
      assert.deepEqual(place.trainers, ['tc-trainer-warrior', 'tc-trainer-priest', 'tc-trainer-mage']);
      assert.deepEqual(place.yards, ['warrior', 'priest', 'mage']);
      assert.equal(place.dummies, 9);
      assert.equal(place.live, 9);
      assert.equal(place.growth, 56, `only the 56 residents join g.units (${place.growth})`);
      for (const label of ['전사 훈련', '사제 훈련', '마법사 훈련']) assert.ok(place.markers.includes(label), `minimap mark ${label}: ${place.markers}`);
      for (const r of place.report) {
        const at = JSON.stringify(r);
        assert.ok(r.free && r.ground < 0.05, `on free ground: ${at}`);
        assert.ok(r.street >= 0.5, `off every street: ${at}`);
        assert.ok(r.resident >= 8, `clear of the residents: ${at}`);
        assert.ok(r.named >= 10, `clear of the King, Captain Ara, Opal and the Seaglass portal: ${at}`);
        assert.ok(!r.unit && !r.hidden && r.plate, `a plated keeper or dummy, not a game unit: ${at}`);
      }
      const near = (k) => Math.min(...place.report.filter((r) => r.kind === k).map((r) => r.resident));
      console.log(`PASS three trainers and nine dummies (${place.report.filter((r) => r.kind === 'trainer').map((r) => `${r.name} ${r.x},${r.z}`).join('; ')}), none a game unit (g.units grew by the 56 residents only), all on free ground, at least ${Math.min(...place.report.map((r) => r.street))} m off any street, ${Math.min(near('trainer'), near('dummy'))} m from the nearest resident and ${Math.min(...place.report.map((r) => r.named))} m from the King, Ara, Opal and the portal; on the minimap`);

      // The trainers with their dummies (the player stepped out of the picture).
      const VIEW = { warrior: [[-68.5, 2.8, 31.5], [-61.8, 0.9, 18.6]], priest: [[-32.5, 2.8, 3.5], [-45, 0.9, -4.6]], mage: [[-92.5, 2.8, -127.5], [-81.5, 0.9, -118.5]] };
      for (const c of CLASSES) {
        await p.evaluate(([cam, at]) => {
          const { g } = window.__T, h = (x, z) => g.world2.tidecrown.height(x, z);
          g.hud.dialogue.close();
          g.player.unit.hidden = true;
          window.__T.cam([cam[0], h(cam[0], cam[2]) + cam[1], cam[2]], [at[0], h(at[0], at[2]) + at[1], at[2]]);
        }, VIEW[c]);
        await p.waitForTimeout(2500);
        await p.screenshot({ path: `${shots}/${c}-trainer.png` });
      }
      await p.evaluate(() => { window.__T.g.player.unit.hidden = false; });
      await p.evaluate(() => window.__T.free());
    }

    // 2. F at the class's own trainer: its five skills, each with a tip, and the dummies.
    const own = await talkTo(ci);
    const want = await p.evaluate((cls) => window.__T.D.CLASSES[cls].abilities.map((a) => ({ id: a.id, name: window.__T.L.abilityName(a) })), cls);
    assert.ok(own.prompt.includes('기술 배우기'), own.prompt);
    assert.deepEqual(own.skills.map((s) => s.id), want.map((w) => w.id), `${cls}: its own five skills`);
    for (const [k, s] of own.skills.entries()) {
      assert.ok(s.name.includes(want[k].name), `${cls}: ${s.name}`);
      assert.ok(/초/.test(s.meta) && /(m|자신)/.test(s.meta), `${cls}: cost, cooldown and reach: ${s.meta}`);
      assert.ok(s.tip.length > 10, `${cls}: a tip for ${s.id}`);
    }
    assert.ok(own.text.includes('허수아비') && own.text.includes('초당 피해'), own.text);
    assert.deepEqual(own.buttons, ['🎯 허수아비로 연습하기', '다음에 할게요']);
    if (ci === 0) await p.screenshot({ path: `${shots}/${cls}-dialogue.png` });
    console.log(`PASS ${cls}: F at ${own.name} ("${own.prompt.replace(/^F/, '')}") opens "${own.title}" with ${own.skills.map((s) => s.name.replace(/^\d/, '')).join(', ')}, each with cost, cooldown, reach and a tip, and the dummies`);

    // Another class's trainer: that class's skills, no tips, and a pointer to this player's own trainer.
    const oi = (ci + 1) % 3, other = await talkTo(oi);
    const theirs = await p.evaluate((c) => window.__T.D.CLASSES[c].abilities.map((a) => a.id), CLASSES[oi]);
    const home = await p.evaluate((ci) => window.__T.M.TRAINING_YARDS[ci].trainer.name[0], ci);
    assert.deepEqual(other.skills.map((s) => s.id), theirs);
    assert.ok(other.skills.every((s) => !s.tip), 'no tips for another class');
    assert.ok(other.text.includes(home) && other.text.includes('아니지만'), other.text);
    assert.equal(other.buttons.length, 1);
    if (ci === 1) await p.screenshot({ path: `${shots}/${cls}-at-${CLASSES[oi]}-trainer.png` });
    console.log(`PASS ${cls} at the ${CLASSES[oi]} trainer ${other.name}: the ${CLASSES[oi]}'s skills without tips, and a pointer to ${home}`);
    await p.getByRole('button', { name: '알려 줘서 고마워요', exact: true }).click();

    // 3. Practise: the button targets the nearest dummy of the yard and brings up the panel.
    await talkTo(ci);
    const before = await p.evaluate(() => ({ ...window.__T.purse(), units: window.__T.g.units.length }));
    if (cls === 'warrior') {
      await p.evaluate(() => window.__T.g.world2.hub.kingdom.accept('patrol'));
      assert.equal(await p.evaluate(() => window.__T.g.world2.hub.kingdom.current?.id), 'patrol');
    }
    await p.getByRole('button', { name: '🎯 허수아비로 연습하기', exact: true }).click();
    const picked = await p.evaluate((ci) => { const { g, yard } = window.__T, t = g.player.target; return { yard: yard(ci).includes(t), dialogue: g.hud.dialogue.isOpen, panel: window.__T.panel() }; }, ci);
    assert.ok(picked.yard && !picked.dialogue && picked.panel?.shown, JSON.stringify(picked));

    // 4. Every skill through its key on the dummies.
    const use = async (slot, stance, check, opts = {}) => {
      await p.evaluate(({ ci, stance, opts }) => {
        const { g, yard } = window.__T, pl = g.player, ds = yard(ci), d = ds[opts.dummy ?? 0];
        pl.cooldowns.clear();
        pl.gcdEnd = 0;
        pl.resource = pl.maxResource;
        pl.nextSwing = Infinity;
        if (opts.hurt) pl.unit.hp = Math.round(pl.unit.maxHp * 0.4);
        let x, z, yaw;
        if (stance === 'between') {
          const a = ds[0].pos, b = ds[1].pos;
          x = (a.x + b.x) / 2; z = (a.z + b.z) / 2; yaw = Math.atan2(a.x - x, a.z - z);
        } else {
          const k = window.__T.M.TRAINING_YARDS[ci].trainer, away = Math.atan2(k.x - d.pos.x, k.z - d.pos.z);
          x = d.pos.x + Math.sin(away) * stance; z = d.pos.z + Math.cos(away) * stance; yaw = away + Math.PI;
        }
        pl.unit.teleport(g.world, x, z, yaw);
        g.follow.yaw = yaw + Math.PI;
        g.follow.cut();
        pl.setTarget(d);
      }, { ci, stance, opts });
      // Nothing still on its way (a cast, a bolt in flight, a pending swing) before the key.
      await p.waitForFunction(() => { const { g } = window.__T; return !g.player.cast && !g.projectiles.count && g.player.unit.pendingHitIn === null; });
      await p.waitForTimeout(250);
      await p.evaluate(({ ci, opts }) => {
        const pl = window.__T.g.player, d = window.__T.yard(ci)[opts.dummy ?? 0];
        window.__mark = { hits: window.__hits.length, abilities: window.__abilities.length, heals: window.__heals, hp: pl.unit.hp, x: pl.unit.pos.x, z: pl.unit.pos.z, dummy: { x: d.pos.x, z: d.pos.z } };
      }, { ci, opts });
      await p.keyboard.press(`Digit${slot}`);
      await p.waitForFunction(check, null, { timeout: 8000 }).catch(async (e) => { throw new Error(`skill ${slot} at ${stance}: ${e.message}\n${(await p.evaluate(() => window.__log)).join('\n')}`); });
      return p.evaluate(() => {
        const { g } = window.__T, m = window.__mark, hits = window.__hits.slice(m.hits);
        return { hits: hits.length, dummies: [...new Set(hits.map((h) => h.dst))].length, damage: hits.reduce((n, h) => n + h.amount, 0), abilities: window.__abilities.slice(m.abilities), moved: +Math.hypot(g.player.unit.pos.x - m.x, g.player.unit.pos.z - m.z).toFixed(1) };
      });
    };
    const landed = () => window.__hits.length > window.__mark.hits;
    const results = [];
    if (cls === 'warrior') {
      results.push(['Pincer Strike', await use(1, 1.25, landed)]);
      const bash = await use(2, 1.25, landed);
      assert.ok(await p.evaluate((ci) => window.__T.yard(ci)[0].stunUntil > window.__T.g.time, ci), 'Shell Bash stuns the dummy');
      results.push(['Shell Bash (stunned)', bash]);
      const charge = await use(3, 7, () => window.__abilities.slice(window.__mark.abilities).some((a) => a.ability === 'sideways-charge' && a.stage === 'hit'));
      assert.ok(charge.abilities.some((a) => a.ability === 'sideways-charge' && a.stage === 'hit' && a.target === 0) && charge.moved > 3, JSON.stringify(charge));
      results.push(['Sideways Charge (arrived)', charge]);
      const whirl = await use(4, 'between', landed);
      await p.waitForTimeout(300);
      results.push(['Whirlpool', whirl]);
      results.push(['Crown Burst', await use(5, 2.5, () => new Set(window.__hits.slice(window.__mark.hits).map((h) => h.dst)).size >= 3)]);
      assert.ok(await p.evaluate(() => new Set(window.__hits.filter((h) => h.mine).map((h) => h.dst)).size >= 2), 'Whirlpool and Crown Burst hit several dummies');
    } else if (cls === 'priest') {
      results.push(['Smite', await use(1, 8, landed)]);
      const mend = await use(2, 4, () => window.__heals > window.__mark.heals && window.app.current.game.player.unit.hp > window.__mark.hp, { hurt: true });
      results.push(['Mend Shell (healed)', mend]);
      await use(3, 4, () => window.app.current.game.player.warded);
      results.push(['Barnacle Ward (up)', { hits: 0, dummies: 0, damage: 0 }]);
      results.push(['Holy Tide', await use(4, 2, landed)]);
      results.push(['Crown Burst', await use(5, 2.5, () => new Set(window.__hits.slice(window.__mark.hits).map((h) => h.dst)).size >= 3)]);
    } else {
      results.push(['Bubble Bolt', await use(1, 8, landed)]);
      const spray = await use(2, 3, landed);
      assert.ok(await p.evaluate((ci) => window.__T.yard(ci)[0].slowUntil > window.__T.g.time, ci), 'Frost Spray slows the dummy');
      results.push(['Frost Spray (slowed)', spray]);
      const blink = await use(3, 5, () => Math.hypot(window.app.current.game.player.unit.pos.x - window.__mark.x, window.app.current.game.player.unit.pos.z - window.__mark.z) > 1);
      results.push(['Steam Blink (moved)', blink]);
      const nova = await use(4, 2.5, landed);
      await p.waitForTimeout(500);
      const still = await p.evaluate(() => { const d = window.__T.yard(2)[0].pos, m = window.__mark.dummy; return Math.hypot(d.x - m.x, d.z - m.z); });
      assert.ok(still < 1e-6, `Tidal Nova does not move a dummy (${still})`);
      results.push(['Tidal Nova (not moved)', nova]);
      results.push(['Crown Burst', await use(5, 2.5, () => new Set(window.__hits.slice(window.__mark.hits).map((h) => h.dst)).size >= 3)]);
    }
    await p.waitForTimeout(400);
    for (const [name, r] of results) if (!/Charge|Mend|Ward|Blink/.test(name)) assert.ok(r.hits > 0 && r.damage > 0, `${cls} ${name}: ${JSON.stringify(r)}`);
    console.log(`PASS ${cls}: every skill through its key in the yard: ${results.map(([n, r]) => `${n}${r.damage ? ` ${r.damage} on ${r.dummies}` : ''}`).join(', ')}`);

    // Numbers float up from the dummies, and the panel counts exactly this player's hits.
    const counted = await p.evaluate(() => {
      const { g, tr, dummies } = window.__T, mine = window.__hits.filter((h) => h.mine);
      const floats = g.hud.floats.pool.filter((f) => f.active && dummies.includes(f.unit) && /\d/.test(f.span.textContent)).length;
      return { floats, total: mine.reduce((n, h) => n + h.amount, 0), hits: mine.length, biggest: Math.max(...mine.map((h) => h.amount)), meter: { total: tr.meter.total, hits: tr.meter.hits, biggest: tr.meter.biggest }, panel: window.__T.panel() };
    });
    assert.ok(counted.floats > 0, `damage numbers over the dummies: ${counted.floats}`);
    assert.deepEqual(counted.meter, { total: counted.total, hits: counted.hits, biggest: counted.biggest });
    assert.ok(counted.panel.shown && counted.panel.total === counted.total.toLocaleString() && counted.panel.hits.startsWith(`${counted.hits} ·`) && counted.panel.biggest.startsWith(counted.biggest.toLocaleString()), JSON.stringify(counted));
    assert.ok(Number(counted.panel.dps.replace(/,/g, '')) > 0, `damage per second: ${counted.panel.dps}`);
    // The panel during practice, over the player's shoulder at a dummy.
    await p.evaluate((ci) => {
      const { g, yard } = window.__T, d = yard(ci)[1], k = window.__T.M.TRAINING_YARDS[ci].trainer, away = Math.atan2(k.x - d.pos.x, k.z - d.pos.z);
      g.player.unit.teleport(g.world, d.pos.x + Math.sin(away) * 3.2, d.pos.z + Math.cos(away) * 3.2, away + Math.PI);
      g.follow.yaw = away;
      g.follow.cut();
      g.player.setTarget(d);
      g.player.nextSwing = 0;
    }, ci);
    await p.waitForTimeout(cls === 'warrior' ? 300 : 2600);
    if (cls === 'warrior') { await p.evaluate(() => { const pl = window.__T.g.player; pl.cooldowns.clear(); pl.gcdEnd = 0; pl.resource = 100; }); await p.keyboard.press('Digit3'); await p.waitForTimeout(1200); await p.keyboard.press('Digit1'); }
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${shots}/${cls}-practice.png` });
    // The practice stops (the last swing or bolt lands), then Reset.
    await p.evaluate(() => { const pl = window.__T.g.player; pl.setTarget(null); pl.nextSwing = Infinity; });
    await p.waitForTimeout(1500);
    await p.locator('.practice-reset').click();
    const reset = await p.evaluate(() => ({ panel: window.__T.panel(), meter: { total: window.__T.tr.meter.total, hits: window.__T.tr.meter.hits, biggest: window.__T.tr.meter.biggest } }));
    assert.deepEqual(reset.meter, { total: 0, hits: 0, biggest: 0 });
    assert.ok(reset.panel.shown && reset.panel.total === '0' && reset.panel.hits === '0 · 0:00' && reset.panel.biggest === '-', JSON.stringify(reset.panel));
    console.log(`PASS ${cls}: ${counted.floats} damage numbers over the dummies; the panel counted ${counted.hits} hits, ${counted.total} damage, biggest ${counted.panel.biggest}, ${counted.panel.dps} per second, and Reset clears it`);

    // 5. Dummies never die, never pay, never count as kills.
    const after = await p.evaluate(({ before }) => {
      const { g, tr, dummies } = window.__T, pl = g.player;
      pl.nextSwing = Infinity;
      const huge = dummies.map((d) => g.combat.damage(pl.unit, d, 1e9));
      return {
        huge, alive: dummies.every((d) => d.alive && !d.hidden && d.hp > 0 && d.hp <= d.maxHp), deaths: window.__deaths.slice(), purse: window.__T.purse(), before,
        units: g.units.length, kingdom: g.world2.hub.kingdom.current ? g.world2.hub.kingdom.lines(g.world2.hub.kingdom.current)[0].text : null, live: tr.units.length, listener: window.__listenerError ?? null,
      };
    }, { before });
    assert.ok(after.huge.every((n) => n > 1e8) && after.alive, JSON.stringify(after));
    assert.deepEqual(after.deaths, []);
    assert.deepEqual([after.purse.xp, after.purse.coins], [before.xp, before.coins], 'no XP or coins from the dummies');
    assert.equal(after.units, before.units);
    assert.equal(after.listener, null);
    if (cls === 'warrior') assert.equal(after.kingdom, '적 물리치기: 0/5', 'the kingdom kill request does not advance');
    console.log(`PASS ${cls}: a hit of a billion on each dummy wraps it round alive (no death event), XP ${before.xp} and coins ${before.coins} unchanged${cls === 'warrior' ? ', the Royal Patrol kill request stays at 0/5' : ''}`);

    // 6. In combat after a hit: travel waits, the trainer still answers; five seconds on, travel is open.
    if (cls === 'warrior') {
      const fight = await p.evaluate(() => ({ inCombat: window.__T.g.player.inCombat, travel: window.__T.g.world2.canEnterTidecrown() }));
      assert.deepEqual(fight, { inCombat: true, travel: false });
      const answer = await talkTo(0);
      assert.equal(answer.name, '교관 그론');
      await p.evaluate(() => window.__T.g.hud.dialogue.close());
      const t0 = await p.evaluate(() => window.__T.g.time - window.__T.g.player.unit.lastCombat);
      await p.waitForFunction(() => !window.__T.g.player.inCombat, null, { timeout: 15000 });
      const t1 = await p.evaluate(() => ({ since: window.__T.g.time - window.__T.g.player.unit.lastCombat, travel: window.__T.g.world2.canEnterTidecrown() }));
      assert.ok(t1.since >= 5 && t1.since < 5.5 && t1.travel === true, JSON.stringify(t1));
      console.log(`PASS a hit puts the player in combat: travel waits and the trainer still answers F; combat ends ${t1.since.toFixed(2)} s after the last hit (${t0.toFixed(2)} s in when checked)`);
    }

    // 7. A relay room, as a member: hits land on this client only; nothing about a dummy is sent, the room is untouched.
    if (cls === 'mage') {
      const relay = await p.evaluate(async () => {
        const { g, tr, yard } = window.__T, mp = g.multiplayer, b = mp.battle, pl = g.player, sent = [];
        const was = { active: b.active, host: b.host, ownId: b.ownId, room: mp.room };
        const room = () => ({ units: [...b.units.keys()].length, enemies: g.enemies.map((e) => `${e.state}:${e.unit.hp}:${e.unit.alive}`).join('|') });
        const start = room(), m0 = tr.meter.total;
        mp.send = (m) => sent.push(JSON.parse(JSON.stringify(m)));
        Object.assign(b, { active: true, host: 'qa-host', ownId: 'qa-member' });
        mp.room = 'QATRAIN';
        const authority = b.authority;
        const d = yard(2)[0];
        // A bolt (cast, projectile), a spray and a nova (conditions), the burst, and a plain hit.
        const cast = async (slot, wait) => { pl.cooldowns.clear(); pl.gcdEnd = 0; pl.resource = pl.maxResource; pl.setTarget(d); pl.useAbility(slot); await new Promise((r) => setTimeout(r, wait)); };
        pl.unit.teleport(g.world, d.pos.x + 3, d.pos.z, -Math.PI / 2);
        pl.unit.setYaw(Math.atan2(d.pos.x - pl.unit.pos.x, d.pos.z - pl.unit.pos.z));
        await cast(1, 2600);
        await cast(2, 400);
        await cast(4, 400);
        await cast(5, 400);
        g.combat.damage(pl.unit, d, 50);
        const end = room();
        Object.assign(b, { active: was.active, host: was.host, ownId: was.ownId });
        mp.room = was.room;
        delete mp.send;
        const text = JSON.stringify(sent);
        return {
          authority, landed: tr.meter.total - m0, sent: sent.length, kinds: [...new Set(sent.map((m) => m.type))], combat: sent.filter((m) => m.type === 'combat'),
          aimed: sent.filter((m) => m.type === 'skill' && ('target' in m.skill || m.skill.fx === 'projectile')), named: /허수아비|dummy/i.test(text), start, end,
        };
      });
      assert.equal(relay.authority, false);
      assert.ok(relay.landed > 50, `hits land locally as a member: ${relay.landed}`);
      assert.deepEqual(relay.combat, [], 'no combat event');
      assert.deepEqual(relay.aimed, [], 'no skill effect aimed at a dummy');
      assert.equal(relay.named, false);
      assert.deepEqual(relay.end, relay.start, 'the room units and enemies are untouched');
      console.log(`PASS relay room member: ${relay.landed} damage landed on the dummies locally; of ${relay.sent} packets (${relay.kinds.join(', ')}) none is a combat event or a skill aimed at a dummy; the room's ${relay.start.units} units and the enemies untouched`);
    }

    // 8. Leaving takes the dummies, their plates and the panel away; they are not targets any more.
    const left = await p.evaluate(() => {
      const { g, tr, dummies } = window.__T;
      g.world2.exitTidecrown();
      return { live: tr.units.length, hidden: dummies.every((d) => d.hidden && !d.rig.root.visible), plates: dummies.some((d) => g.hud.plates.also.has(d)), panel: window.__T.panel()?.shown ?? false, target: g.player.target };
    });
    assert.deepEqual(left, { live: 0, hidden: true, plates: false, panel: false, target: null });
    console.log(`PASS ${cls}: leaving the capital hides the dummies, their plates and the panel, and none is a target`);
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS zero page errors on the local world');

  // The contact sheet: the three trainers, a trainer's page and the practice panel.
  const tiles = ['warrior-trainer', 'priest-trainer', 'mage-trainer', 'warrior-dialogue', 'priest-at-mage-trainer', 'mage-practice'];
  const data = await Promise.all(tiles.map(async (n) => `data:image/png;base64,${(await readFile(`${shots}/${n}.png`)).toString('base64')}`));
  const page = await browser.newPage();
  const jpg = await page.evaluate(async (data) => {
    const W = 800, H = 450, pad = 8, c = document.createElement('canvas');
    c.width = W * 3 + pad * 4;
    c.height = H * 2 + pad * 3;
    const x = c.getContext('2d');
    x.fillStyle = '#16120c';
    x.fillRect(0, 0, c.width, c.height);
    for (const [i, src] of data.entries()) {
      const img = new Image();
      img.src = src;
      await img.decode();
      x.drawImage(img, pad + (i % 3) * (W + pad), pad + Math.floor(i / 3) * (H + pad), W, H);
    }
    return c.toDataURL('image/jpeg', 0.84).split(',')[1];
  }, data);
  await mkdir(dirname(sheet), { recursive: true });
  await writeFile(sheet, Buffer.from(jpg, 'base64'));
  console.log(`PASS shots in ${shots}; contact sheet ${sheet}`);
} finally {
  await browser.close();
}

// 9. A server world: the capital is not hosted there yet, so no trainer, dummy or panel is built.
if (process.env.CC_QA_SERVER !== '0') {
  const browserPort = Number(process.env.WORLD_QA_BROWSER_PORT ?? 5285), hostPort = Number(process.env.WORLD_QA_HOST_PORT ?? 5286), clientOrigin = `http://127.0.0.1:${browserPort}`;
  const scratch = await mkdtemp('/private/tmp/crabcraft-training-server-'), metadataPath = join(scratch, 'host.json');
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
    const s = await page.evaluate(async () => {
      const g = window.cc.game, hub = g.world2.hub, built = [], A = await import('/src/game/abilities.ts');
      g.scene.traverse((o) => { if (/^training-|^crab:(Gron|Serena|Azur)$/.test(o.name)) built.push(o.name); });
      return { built, training: hub.training, units: hub.units.length, extra: A.combatUnits(g).length - g.units.length, markers: hub.markers().length, panel: !!document.querySelector('.practice') };
    });
    assert.deepEqual(s, { built: [], training: null, units: 0, extra: 0, markers: 0, panel: false });
    assert.deepEqual(errors, []);
    console.log('PASS ?world=server: no trainer, dummy, yard or practice panel is built, and nothing joins the targets; zero page errors');
  } finally {
    await sb?.close();
    await server?.close();
    if (host && host.exitCode === null) { host.kill('SIGTERM'); await pause(500); }
  }
}
