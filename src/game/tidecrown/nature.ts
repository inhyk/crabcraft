// Tidecrown's vegetation and rocks from the World I nature kit: dense pines on the south ridge that hide the city
// until the crest, meadows and riverside flowers, rocks at cliff feet and shores. Trees and big rocks register
// collision circles; decoration does not. Deterministic for every client.
import * as THREE from 'three';
import type { Collision } from '../../sim/world/collision';
import { polyDistance, TC_CITY_WALL, TC_T, tcAxis, tcAxisCoords, tcCoast } from '../../sim/world/tidecrownGround';
import type { FoliageScatter } from '../../world/foliage';
import { trs } from '../../world/kit';
import { rng, Simplex, smoothstep } from '../../world/noise';
import { tcPaving } from './paving';

type Height = (x: number, z: number) => number;
export type NatureScatter = FoliageScatter;

class Placements {
  readonly items = new Map<string, THREE.Matrix4[]>();
  add(piece: string, m: THREE.Matrix4): void {
    let l = this.items.get(piece);
    if (!l) this.items.set(piece, (l = []));
    l.push(m.clone());
  }
}

export function scatterTidecrownNature(h: Height, col: Collision): NatureScatter {
  const R = rng(5207), N = new Simplex(91);
  const trees = new Placements(), small = new Placements();
  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const pave = { cobble: 0, dirt: 0, clear: 0 };
  const slope = (x: number, z: number) => {
    const dx = h(x + 1, z) - h(x - 1, z), dz = h(x, z + 1) - h(x, z - 1);
    return 2 / Math.sqrt(dx * dx + dz * dz + 4);
  };
  const [cx, cz] = tcAxis(TC_T.crest);
  // The view from the overlook: a clearing on the crest, and nothing tall in the cone toward the bridge.
  const inView = (x: number, z: number) => {
    const [t, s] = tcAxisCoords(x, z);
    // ... and a short clearing behind the crest on the axis, the line the eye arrives along.
    return Math.hypot(x - cx, z - cz) < 11 || (t > TC_T.crest && t < -96 && Math.abs(s) < (t - TC_T.crest) * 0.85 + 6) || (t > TC_T.crest - 22 && t <= TC_T.crest && Math.abs(s) < 9);
  };
  // The bridge, its heads and the gate court stay open.
  const structures = (x: number, z: number) => {
    const [t, s] = tcAxisCoords(x, z);
    return t > -128 && t < 30 && Math.abs(s) < 26;
  };
  const wallDist = (x: number, z: number) => polyDistance(x, z, TC_CITY_WALL);

  // Pines: a dense forest on the south shore, thinner stands on the western hills.
  const pines = ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5'];
  const step = 5.2;
  for (let z = -320; z <= 420; z += step) {
    for (let x = -322; x <= 420; x += step) {
      const jx = x + (R() - 0.5) * step * 0.95, jz = z + (R() - 0.5) * step * 0.95;
      const n = N.fbm(jx / 45, jz / 45, 3) * 0.5 + 0.5, roll = R(), pick = R(), size = R(), turn = R();
      const c = tcCoast(jx, jz);
      if (c.d < 5) continue;
      let d: number;
      if (c.south > c.north) d = 0.95 * smoothstep(5, 16, c.d);
      else {
        const wd = wallDist(jx, jz);
        if (wd > -14) continue;
        d = Math.max(0.12, 0.75 * smoothstep(-150, -230, jx)) * smoothstep(-14, -30, wd);
      }
      d *= 0.45 + 0.75 * n;
      if (roll > d) continue;
      if (inView(jx, jz) || structures(jx, jz)) continue;
      tcPaving(jx, jz, pave);
      if (pave.clear < 3) continue;
      const y = h(jx, jz);
      if (y < 1.6 || slope(jx, jz) < 0.74) continue;
      const deep = pave.clear > 30;
      const name = deep ? (pick < 0.7 ? 'Pine_5' : 'Pine_4') : pines[Math.floor(pick * pines.length)];
      const s = 1.05 + size * 0.95;
      trees.add(name, trs(jx, y - 0.15, jz, turn * Math.PI * 2, s));
      col.addCircle(jx, jz, 0.45 * s, y - 1, y + 9 * s);
      count('pine');
    }
  }
  // Broadleaf trees on the riverside meadows and the western fields.
  const commons = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'];
  for (let i = 0; i < 900; i++) {
    const x = -300 + R() * 560, z = -250 + R() * 440, roll = R(), pick = R(), size = R(), turn = R();
    const c = tcCoast(x, z);
    if (c.d < 6 || c.south > c.north) continue;
    const wd = wallDist(x, z);
    if (wd > -12) continue;
    if (roll > 0.35 + 0.4 * N.fbm(x / 30 + 5, z / 30, 2)) continue;
    if (structures(x, z)) continue;
    const y = h(x, z);
    if (y < 1.8 || slope(x, z) < 0.8) continue;
    const s = 0.85 + size * 0.55;
    trees.add(commons[Math.floor(pick * commons.length)], trs(x, y - 0.15, z, turn * Math.PI * 2, s));
    col.addCircle(x, z, 0.4 * s, y - 1, y + 7 * s);
    count('tree');
  }
  // Cypresses: dark columns along the King's Way, beside the King's Stair and round the keep's court; a few broad
  // trees in the terrace gardens.
  const cypress = (x: number, z: number, k: number) => {
    const y = h(x, z), s = 0.9 + 0.25 * ((k * 0.618) % 1);
    trees.add(k % 2 ? 'Pine_2' : 'Pine_3', trs(x, y - 0.2, z, k * 1.7, new THREE.Vector3(0.42 * s, 1.35 * s, 0.42 * s)));
    col.addCircle(x, z, 0.35, y - 1, y + 14 * s);
    count('cypress');
  };
  let k = 0;
  for (let t = 96; t <= 158; t += 8.5) for (const side of [-1, 1]) cypress(...tcAxis(t, side * 11), k++);
  for (let t = 167; t <= 199; t += 8) for (const side of [-1, 1]) cypress(...tcAxis(t, side * 13.5), k++);
  for (let t = 214; t <= 234; t += 10) for (const side of [-1, 1]) cypress(...tcAxis(t, side * 17), k++);
  for (const side of [-1, 1]) for (const t of [8, 20]) cypress(...tcAxis(t, side * 24), k++);
  for (let i = 0; i < 400; i++) {
    const x = -140 + R() * 360, z = -200 + R() * 330, roll = R(), pick = R(), size = R(), turn = R();
    if (roll > 0.18) continue;
    const wd = wallDist(x, z);
    if (wd < 10) continue;
    tcPaving(x, z, pave);
    if (pave.clear < 6) continue;
    const y = h(x, z);
    if (slope(x, z) < 0.86) continue;
    const s = 0.8 + size * 0.45;
    trees.add(commons[Math.floor(pick * commons.length)], trs(x, y - 0.15, z, turn * Math.PI * 2, s));
    col.addCircle(x, z, 0.4 * s, y - 1, y + 7 * s);
    count('garden');
  }
  // Bushes: road verges, forest edges, under the city walls and along the river.
  for (let i = 0; i < 5200; i++) {
    const x = -300 + R() * 640, z = -250 + R() * 620, roll = R(), flower = R(), size = R(), turn = R();
    const c = tcCoast(x, z);
    if (c.d < 3) continue;
    tcPaving(x, z, pave);
    const wd = wallDist(x, z);
    const verge = pave.clear > 0.8 && pave.clear < 3;
    const underWall = wd < -4 && wd > -12;
    const forest = c.south > c.north && roll < 0.3;
    const riverside = c.d < 16 && roll < 0.4;
    if (!(verge || underWall || forest || riverside) || pave.clear < 0.6 || wd > -4) continue;
    if (structures(x, z) && !verge) continue;
    const y = h(x, z);
    if (y < 1.2 || slope(x, z) < 0.74) continue;
    small.add(flower < 0.4 ? 'Bush_Common_Flowers' : 'Bush_Common', trs(x, y - 0.1, z, turn * 6.3, 0.75 + size * 0.7));
    count('bush');
  }
  // Flowers, clover, ferns and petals: meadows, the overlook, the riverside; ferns under the pines.
  for (let i = 0; i < 16000; i++) {
    const x = -300 + R() * 640, z = -250 + R() * 620, roll = R(), pick = R(), size = R(), turn = R();
    const c = tcCoast(x, z);
    if (c.d < 4) continue;
    tcPaving(x, z, pave);
    if (pave.clear < 0.6) continue;
    const wd = wallDist(x, z);
    if (wd > -3 && wd < 3) continue;
    const y = h(x, z);
    if (y < 1.4 || slope(x, z) < 0.78) continue;
    const forest = c.south > c.north && Math.hypot(x - cx, z - cz) > 14;
    const patch = N.fbm(x / 18, z / 18 + 40, 2) + (Math.hypot(x - cx, z - cz) < 16 ? 0.5 : 0);
    if (forest) {
      if (roll < 0.35) { small.add('Fern_1', trs(x, y - 0.05, z, turn * 6.3, 0.8 + size * 0.7)); count('fern'); }
      else if (roll < 0.42 && patch > 0.2) { small.add(pick < 0.5 ? 'Flower_3_Group' : 'Flower_4_Group', trs(x, y - 0.05, z, turn * 6.3, 0.45 + size * 0.3)); count('flower'); }
    } else if (patch > 0.12) {
      const name = pick < 0.45 ? 'Flower_3_Group' : pick < 0.8 ? 'Flower_4_Group' : 'Clover_1';
      small.add(name, trs(x, y - 0.05, z, turn * 6.3, 0.45 + size * 0.3));
      count('flower');
    } else if (roll < 0.5) {
      small.add(`Petal_${1 + Math.floor(pick * 5)}`, trs(x, y + 0.01, z, turn * 6.3, 0.9 + size * 0.6));
      count('petal');
    }
  }
  // Rocks: cliff feet, shores, the forest floor and the overlook's edge.
  for (let i = 0; i < 6000; i++) {
    const x = -320 + R() * 740, z = -320 + R() * 740, roll = R(), pick = R(), size = R(), turn = R(), tip = R(), roll2 = R();
    const c = tcCoast(x, z), y = h(x, z), sl = slope(x, z);
    if (y < -3) continue;
    tcPaving(x, z, pave);
    if (pave.clear < 0.4) continue;
    if (structures(x, z) && Math.abs(wallDist(x, z)) < 8) continue;
    let s = 0;
    if (sl < 0.72 && sl > 0.42 && roll < 0.5) s = 1.3 + size * 1.8;
    else if (c.d > -5 && c.d < 4 && roll < 0.4) s = 0.7 + size * 1.8;
    else if (c.south > c.north && roll < 0.06) s = 0.7 + size * 1.4;
    else if (Math.hypot(x - cx, z - cz) < 15 && roll < 0.5) s = 0.8 + size * 1.2;
    else continue;
    // Rocks big enough to block keep clear of every path; small ones may sit at its edge.
    if (wallDist(x, z) > -2 || pave.clear < (s > 1.3 ? 1.2 * s + 0.8 : 0.4)) continue;
    small.add(`Rock_Medium_${1 + Math.floor(pick * 3)}`, trs(x, y - 0.6 * s, z, turn * 6.3, s, (tip - 0.5) * 0.3, (roll2 - 0.5) * 0.3));
    if (s > 1.3 && y > 0) col.addCircle(x, z, 1.1 * s, y - 2, y + 2 * s);
    count('rock');
  }
  // Boulders flanking the overlook, and pebbles on its earth.
  for (const [t, s, size, turn] of [[-131, -9, 2.4, 0.4], [-127.5, 9.5, 2.8, 2.1], [-139, -7.5, 1.9, 4.2], [-136, 8.4, 1.6, 1.3]] as const) {
    const [x, z] = tcAxis(t, s), y = h(x, z);
    small.add(`Rock_Medium_${1 + (Math.round(turn * 10) % 3)}`, trs(x, y - 0.5 * size, z, turn, size, 0.12, -0.08));
    col.addCircle(x, z, 1.1 * size, y - 2, y + 2 * size);
    count('rock');
  }
  for (let i = 0; i < 60; i++) {
    const a = R() * Math.PI * 2, r = 1.5 + R() * 6.5, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, pick = R(), size = R(), turn = R();
    small.add(`Pebble_${pick < 0.5 ? 'Round' : 'Square'}_${1 + Math.floor(size * 3)}`, trs(x, h(x, z) - 0.03, z, turn * 6.3, 0.7 + size * 1.3));
  }
  // Grass tufts: thick along the road, the overlook and the meadows, sparse on lawns inside the walls.
  const tuftTarget = 18000, tufts: THREE.Matrix4[][] = [[], [], []];
  let placed = 0;
  for (let i = 0; i < tuftTarget * 7 && placed < tuftTarget; i++) {
    const x = -220 + R() * 500, z = -250 + R() * 560, roll = R(), patchRoll = R(), kind = R(), size = R(), turn = R();
    const c = tcCoast(x, z);
    if (c.d < 4) continue;
    tcPaving(x, z, pave);
    if (pave.clear < 0.3) continue;
    const near = Math.min(pave.clear, Math.hypot(x - cx, z - cz));
    if (roll > 1.1 - near / 60) continue;
    const wd = wallDist(x, z);
    if (wd > -2 && wd < 4) continue;
    const y = h(x, z);
    if (y < 1 || slope(x, z) < 0.8) continue;
    const patch = N.fbm(x / 9, z / 9 + 70, 2);
    if (patch < -0.25 && patchRoll < 0.7) continue;
    tufts[Math.floor(kind * 3)].push(trs(x, y - 0.03, z, turn * 6.3, 0.8 + size * 0.7 + Math.max(0, patch) * 0.6));
    placed++;
  }
  counts.tufts = placed;
  return { trees, small, tufts, counts, groveGlow: [] };
}
