// Tidecrown hero statues: each of the six is 16 to 20 tall, stands on y = 0 with every foot down and
// within an 8 x 8 plinth top, draws in at most 3 calls and 60k triangles; the six together draw in
// at most 18. Writes the preview shots (wide row, crab eye level, one per statue, black
// silhouettes) to --out (default tmp/qa/tidecrown-statues).
//   pnpm dev --port 5242 --strictPort &   node tools/qa-tidecrown-statues.mjs [--base URL] [--out DIR] [--no-shots]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--base', process.env.CC_QA_BASE ?? 'http://127.0.0.1:5242');
const out = resolve(opt('--out', 'tmp/qa/tidecrown-statues'));
const shots = !args.includes('--no-shots');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
async function open(query) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  await p.goto(`${base}/dev/crab.html?view=statues&clean${query}`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return p;
}

try {
  const page = await open('');
  const r = await page.evaluate(() => window.__statues);
  const rows = r.statues.map((s) => ({
    race: s.race,
    class: s.classId,
    crest: s.crest,
    height: s.height,
    minY: s.minY,
    'w x d': `${s.width} x ${s.depth}`,
    footprint: s.footprint ? `x ${s.footprint[0]}..${s.footprint[1]}, z ${s.footprint[2]}..${s.footprint[3]}` : '-',
    'foot gap': s.footGap,
    scale: s.scale,
    'LOD legs': s.lodLegs.join(',') || '-',
    calls: s.calls,
    tris: s.tris,
  }));
  console.table(rows);
  console.log(`six together: ${r.together.calls} calls, ${r.together.triangles} triangles; carved in ${r.buildMs} ms (models and gear already loaded)`);
  if (shots) {
    const save = async (p, name) => {
      await p.waitForTimeout(700);
      const file = resolve(out, `${name}.png`);
      await p.screenshot({ path: file });
      console.log(`wrote ${file}`);
    };
    for (const cam of ['wide', 'low', ...r.statues.map((s) => s.race)]) {
      await page.evaluate((c) => window.__statueCam(c), cam);
      await save(page, `statues-${cam}`);
    }
    const sil = await open('&sil');
    await save(sil, 'statues-silhouette');
  }
  assert.deepEqual(r.statues.map((s) => s.race), ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren']);
  for (const s of r.statues) {
    assert.ok(s.height >= 16 && s.height <= 20, `${s.race} height ${s.height}`);
    assert.ok(Math.abs(s.minY) <= 0.05, `${s.race} lowest point ${s.minY}`);
    assert.ok(s.footGap <= 0.05, `${s.race} has a foot ${s.footGap} above the ground`);
    assert.ok(s.footprint && s.footprint.every((v) => Math.abs(v) <= 4), `${s.race} feet ${JSON.stringify(s.footprint)} reach past an 8 x 8 plinth top`);
    assert.ok(s.calls <= 3, `${s.race} draws in ${s.calls} calls`);
    assert.ok(s.tris <= 60000, `${s.race} has ${s.tris} triangles`);
  }
  assert.ok(r.together.calls <= 18, `six statues draw in ${r.together.calls} calls`);
  console.log('PASS six statues: height 16..20, lowest point at 0, all feet planted on an 8 x 8 top, <= 3 calls and <= 60k triangles each');

  assert.deepEqual(errors, []);
  console.log('PASS no page errors');
} finally {
  await browser.close();
}
