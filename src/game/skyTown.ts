import * as THREE from 'three';
import {kitOnce} from './frostCraft';
import {StaticBatch} from '../world/kit';
import {HOUSE, HOUSE_WINGS, SKY_FESTOONS, SKY_HOUSES, festoonPoles, skyTownPlan, type HouseRole} from './skyTownLayout';
import {CLOTH, Frame, M, ROOF, STONE, WOOD, archFrame, archPanel, archShape, atlasUv, beam, bx, clothSheet, disc, hipRoof, lath, ring, rod, sagPoints, skyMaterials, townCtx, type Height, type TownCtx} from './skyTownKit';
import {skyHarbour} from './skyHarbour';

/*
 * Skybloom's town (World VI): six garden-harbour houses (cream ashlar ground floor, jettied timber-and-plaster upper
 * floor with a front balcony, deep teal glazed hip roof with swept eaves and a gilt ridge, round windows lit warm, a
 * sign and props that say who lives there), the seed and kite market, lantern posts gathered at the market, the harbour
 * and the benches, festoons of paper lanterns over three street ends, cloth banners at the harbour gate and the market,
 * and the sky-ship harbour (skyHarbour.ts). Values (style-w6): walls cream 170-210 grey, roofs a step darker than the
 * grass (glazed #1f6a6e), timber #8a5f3a, so wall, roof, grass, path and crab each read apart in greyscale. Parts merge into one mesh per material (skyTownKit.ts); kit props (barrels,
 * sacks, rope, flowers, vines) arrive with the GLBs and merge per kit material.
 */

const V = THREE.Vector3;
const C = {
  stone: '#e6dcc4', trim: '#efe5cd', rubble: '#cbbd9c', plaster: '#f2eadb', timber: '#8a5f3a', timberDark: '#694629',
  roof: '#1f6a6e', roofB: '#1d6569', cap: '#174f53', gold: '#d4a64a', glass: new THREE.Color('#ffb45e').multiplyScalar(1.35), rope: '#c2a678',
};
const DOORS = ['#2f8f8a', '#3a6f9e', '#2f8f8a', '#b4553f', '#3a6f9e', '#5b8a4a'];

export interface SkyTown {group: THREE.Group; update(time: number): void; stats: Record<string, number>; ready: Promise<void>}

export function skyTown(h: Height, low = false): SkyTown {
  const ctx = townCtx(h, low), mats = skyMaterials();
  SKY_HOUSES.forEach((s, i) => house(ctx, s.x, s.z, s.yaw, s.role, i));
  const plan = skyTownPlan();
  for (const s of plan.stalls) stall(ctx, s.x, s.z, s.yaw, s.goods);
  cart(ctx);
  for (const [x, z] of plan.lanterns) lanternPost(ctx, x, z, x < 0 ? 0 : Math.PI);
  for (const f of SKY_FESTOONS) festoon(ctx, f);
  plan.banners.forEach(([x, z], i) => banner(ctx, x, z, i));
  for (const b of plan.benches) benchScene(ctx, b.x, b.z, b.yaw);
  const harbour = skyHarbour(ctx);
  const group = new THREE.Group(); group.name = 'skybloom-town';
  const parts: [keyof Pick<TownCtx, 'stone' | 'timber' | 'roof' | 'metal' | 'glow' | 'cloth'>, THREE.Material, boolean][] = [
    ['stone', mats.stone, true], ['timber', mats.timber, true], ['roof', mats.roof, true], ['metal', mats.metal, true], ['glow', mats.glow, false], ['cloth', mats.cloth, true]];
  for (const [k, mat, shadow] of parts) { ctx.stats[k + 'Tris'] = Math.round(ctx[k].tris); const m = ctx[k].mesh(mat, 'skybloom-town-' + k, shadow); if (m) group.add(m); }
  group.add(harbour.group);
  const ready = dressKits(ctx, group);
  return {group, stats: ctx.stats, ready, update(time) { mats.time.value = time; harbour.update(time); }};
}

/** Kit props merged per material once the GLBs load (one parse each, shared with Frostlight's loader). */
async function dressKits(ctx: TownCtx, group: THREE.Group) {
  const files = {props: 'models/world/props.glb', nature: 'models/world/nature.glb', village: 'models/world/village.glb'} as const;
  const want = new Set(ctx.kits.map(k => k.file));
  const kits = Object.fromEntries(await Promise.all([...want].map(async f => [f, await kitOnce(files[f])] as const)));
  const batches = new Map<string, StaticBatch>();
  for (const k of ctx.kits) {
    const kit = kits[k.file]; if (!kit?.has(k.piece)) continue;
    let b = batches.get(k.file); if (!b) batches.set(k.file, b = new StaticBatch(kit, 'skybloom-town-' + k.file));
    const box = kit.get(k.piece).box, s = k.size / Math.max(1e-6, box.max.y - box.min.y);
    const m = new THREE.Matrix4().compose(new V(k.x, k.y, k.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(k.pitch ?? 0, k.yaw, k.roll ?? 0, 'YXZ')), new V(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, k.hang ? -box.max.y : -box.min.y, -(box.min.z + box.max.z) / 2));
    b.add(k.piece, m);
  }
  for (const b of batches.values()) { const g = b.build(); g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); } }); group.add(g); }
  ctx.stats.kitPieces = ctx.kits.length;
}

// ---- Houses ------------------------------------------------------------------------------------------------------

/** Footprint half sizes in the house frame (local x along the street front, +z out of the front door). */
const {WX, WZ, G, JET, U} = HOUSE;

function house(ctx: TownCtx, x: number, z: number, yaw: number, role: HouseRole, idx: number) {
  const {h} = ctx;
  let top = -Infinity, low = Infinity;
  for (let i = -1; i <= 1; i += .5) for (let j = -1; j <= 1; j += .5) {
    const c = Math.cos(yaw), s = Math.sin(yaw), lx = i * (WX + .4), lz = j * (WZ + .4);
    const y = h(x + lx * c + lz * s, z - lx * s + lz * c); top = Math.max(top, y); low = Math.min(low, y);
  }
  const yb = top + .32, f = new Frame(x, yb, z, yaw), seed = idx * 1.37;
  const {stone, timber, roof, metal, glow} = ctx;
  // Rubble plinth down into the slope, dressed cap, ashlar ground floor with quoins and a string course.
  stone.add(bx(WX * 2 + .5, yb - low + 1.2, WZ * 2 + .5), f.m(0, -(yb - low + 1.2) / 2 + .02, 0), C.rubble, STONE.rubble, seed);
  stone.add(bx(WX * 2 + .62, .12, WZ * 2 + .62), f.m(0, .02, 0), C.trim, STONE.dressed, seed);
  stone.add(bx(WX * 2, G, WZ * 2, [1, 3, 1]), f.m(0, G / 2, 0), C.stone, STONE.ashlar, seed);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0; k < 6; k++) {
    const long = k % 2 === 0, w = long ? .62 : .36;
    stone.add(bx(long ? .34 : .62, .5, long ? .62 : .34), f.m(sx * (WX - (long ? .14 : .28) + .04), .28 + k * .53, sz * (WZ - (long ? .28 : .14) + .04)), C.trim, STONE.dressed, seed + k);
    void w;
  }
  stone.add(bx(WX * 2 + .3, .2, WZ * 2 + .3), f.m(0, G + .02, 0), C.trim, STONE.dressed, seed);
  // Jettied upper floor: plaster box behind a honey timber frame.
  const ux = WX + JET, uz = WZ + JET, y0 = G + .14, y1 = y0 + U;
  stone.add(bx(ux * 2 - .08, U, uz * 2 - .08), f.m(0, y0 + U / 2, 0), C.plaster, STONE.plaster, seed);
  const tb = (a: THREE.Vector3, b: THREE.Vector3, w = .2, col = C.timber) => timber.add(beam(a, b, w), f.F, col, WOOD.beam, seed + a.x * .3 + b.z);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) tb(new V(sx * ux, y0 - .12, sz * uz), new V(sx * ux, y1 + .05, sz * uz), .24);
  for (const sz of [-1, 1]) { tb(new V(-ux - .1, y0 + .05, sz * uz), new V(ux + .1, y0 + .05, sz * uz), .22); tb(new V(-ux - .1, y1 - .04, sz * uz), new V(ux + .1, y1 - .04, sz * uz), .2); }
  for (const sx of [-1, 1]) { tb(new V(sx * ux, y0 + .05, -uz - .1), new V(sx * ux, y0 + .05, uz + .1), .22); tb(new V(sx * ux, y1 - .04, -uz - .1), new V(sx * ux, y1 - .04, uz + .1), .2); }
  // Studs and braces between the round windows.
  for (const sz of [-1, 1]) for (const px of [-3.55, -1.15, 1.15, 3.55]) tb(new V(px, y0 + .1, sz * (uz + .02)), new V(px, y1 - .1, sz * (uz + .02)), .16);
  for (const sx of [-1, 1]) for (const pz of [-1.6, 1.6]) tb(new V(sx * (ux + .02), y0 + .1, pz), new V(sx * (ux + .02), y1 - .1, pz), .16);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tb(new V(sx * (ux + .03), y0 + .15, sz * (uz - .25)), new V(sx * (ux + .03), y0 + 1.0, sz * (uz - 1.1)), .12);
  // Round windows: gilt ring, warm glass, a cross of glazing bars.
  const roundWin = (lx: number, ly: number, lz: number, ry: number, r = .5) => {
    metal.add(ring(r, .065), f.m(lx, ly, lz, ry), C.gold);
    glow.add(disc(r - .03), f.m(lx - .02 * Math.sin(ry), ly, lz - .02 * Math.cos(ry), ry), C.glass.clone().multiplyScalar(.85 + (idx % 3) * .08));
    timber.add(bx(r * 2 - .05, .05, .05), f.m(lx, ly, lz, ry), C.timberDark, WOOD.beam, seed);
    timber.add(bx(.05, r * 2 - .05, .05), f.m(lx, ly, lz, ry), C.timberDark, WOOD.beam, seed);
    stone.add(bx(r * 1.3, .1, .26), f.m(lx, ly - r - .06, lz, ry), C.trim, STONE.dressed, seed);
  };
  for (const px of [-2.35, 2.35]) roundWin(px, y0 + 1.5, uz + .05, 0);
  for (const sx of [-1, 1]) for (const pz of [-3.1, 0, 3.1]) roundWin(sx * (ux + .05), y0 + 1.5, pz, sx * Math.PI / 2, pz === 0 ? .42 : .5);
  for (const px of [-2.35, 2.35]) roundWin(px, y0 + 1.5, -uz - .05, Math.PI);
  // Arched front door in a dressed surround, painted planks, gilt ring; two steps down to the street.
  const door = DOORS[idx % DOORS.length];
  stone.add(archFrame(1.5, 2.55, .24, .26), f.m(0, 0, WZ - .08), C.trim, STONE.dressed, seed);
  timber.add(archPanel(1.5, 2.55, .08), f.m(0, 0, WZ - .02), door, WOOD.painted, seed);
  metal.add(ring(.1, .02, 10), f.m(.42, 1.15, WZ + .08), C.gold);
  for (let k = 0; k < 2; k++) stone.add(bx(2.2 - k * .2, .2, .55), f.m(0, -.1 - k * .2, WZ + .3 + k * .48), C.trim, STONE.dressed, seed + k);
  stone.add(bx(2.6, yb - low + .1, 1.4), f.m(0, -(yb - low + .1) / 2 - .4, WZ + .7), C.rubble, STONE.rubble, seed);
  // Arched shop windows either side of the door with a flower box under each.
  for (const sx of [-1, 1]) {
    const wx = sx * 2.65;
    stone.add(archFrame(1.2, 1.85, .2, .22), f.m(wx, .85, WZ - .06), C.trim, STONE.dressed, seed);
    glow.add(new THREE.ShapeGeometry(archShape(1.2, 1.85)), f.m(wx, .85, WZ + .02), C.glass);
    for (const bx0 of [-.3, .3]) timber.add(bx(.05, 1.8, .05), f.m(wx + bx0, .85 + .9, WZ + .08), C.timberDark, WOOD.beam, seed);
    timber.add(bx(1.2, .05, .05), f.m(wx, .85 + 1.15, WZ + .08), C.timberDark, WOOD.beam, seed);
    timber.add(bx(1.4, .32, .36), f.m(wx, .64, WZ + .2), C.timber, WOOD.planks, seed);
    if (!ctx.low) for (const k of [-.3, .3]) ctx.kits.push({file: 'nature', piece: k < 0 ? 'Flower_4_Group' : 'Flower_3_Group', ...wpos(f, wx + k, .8, WZ + .2), yaw: f.yw(k * 3), size: .45});
  }
  // Side and back ground-floor windows.
  for (const [lx, lz, ry] of [[WX + .02, 0, Math.PI / 2], [-WX - .02, 0, -Math.PI / 2], [0, -WZ - .02, Math.PI]] as const) {
    stone.add(archFrame(.9, 1.5, .18, .2), f.m(lx, 1.0, lz, ry), C.trim, STONE.dressed, seed);
    glow.add(new THREE.ShapeGeometry(archShape(.9, 1.5)), f.m(lx + Math.sin(ry) * .04, 1.0, lz + Math.cos(ry) * .04, ry), C.glass.clone().multiplyScalar(.8));
  }
  // Front balcony on carved brackets, timber rail and balusters, planters with blossom and hanging vines.
  const bw = 3.8, bd = 1.5, by = y0 - .06;
  timber.add(bx(bw * 2, .16, bd), f.m(0, by, uz + bd / 2), C.timber, WOOD.planks, seed);
  for (const px of [-3.65, -1.3, 1.3, 3.65]) { tb(new V(px, G - 1.0, WZ + .02), new V(px, by - .08, uz + bd - .25), .16, C.timberDark); }
  const rail = (a: THREE.Vector3, b: THREE.Vector3) => { tb(a.clone().setY(by + 1.0), b.clone().setY(by + 1.0), .12); tb(a.clone().setY(by + .14), b.clone().setY(by + .14), .08); const n = Math.round(a.distanceTo(b) / .24); for (let k = 1; k < n; k++) { const p = a.clone().lerp(b, k / n); timber.add(bx(.06, .86, .06), f.m(p.x, by + .57, p.z), C.timber, WOOD.beam, seed + k); } };
  const fr = uz + bd - .06;
  rail(new V(-bw + .06, 0, fr), new V(bw - .06, 0, fr));
  for (const sx of [-1, 1]) rail(new V(sx * (bw - .06), 0, uz + .05), new V(sx * (bw - .06), 0, fr));
  for (const px of [-bw + .06, bw - .06]) tb(new V(px, by, fr), new V(px, by + 1.12, fr), .14);
  for (const px of [-2.2, 2.2]) {
    timber.add(bx(1.1, .3, .3), f.m(px, by + 1.06, fr + .22), C.timber, WOOD.planks, seed);
    if (!ctx.low) {
      ctx.kits.push({file: 'nature', piece: 'Bush_Common_Flowers', ...wpos(f, px, by + 1.2, fr + .22), yaw: f.yw(px), size: .55});
      ctx.kits.push({file: 'village', piece: px < 0 ? 'Prop_Vine4' : 'Prop_Vine2', ...wpos(f, px, by + 1.15, fr + .4), yaw: f.yw(0), size: 1.6, hang: true});
    }
  }
  // Balcony door: painted arched leaves with a glazed fanlight.
  stone.add(archFrame(1.3, 2.3, .14, .12), f.m(0, by + .08, uz - .01), C.trim, STONE.dressed, seed);
  timber.add(archPanel(1.3, 2.3, .06), f.m(0, by + .08, uz - .04), door, WOOD.painted, seed);
  glow.add(new THREE.CircleGeometry(.55, 12, 0, Math.PI), f.m(0, by + .08 + 1.65, uz + .03), C.glass);
  // A climbing vine on one front corner.
  if (!ctx.low) ctx.kits.push({file: 'village', piece: idx % 2 ? 'Prop_Vine1' : 'Prop_Vine5', ...wpos(f, (idx % 2 ? 1 : -1) * (WX + .12), 0, WZ - .6), yaw: f.yw(idx % 2 ? Math.PI / 2 : -Math.PI / 2), size: 3.2});
  // Roof: turquoise glazed hip with swept eaves, soffit boards, fascia, gilt-capped hips, ridge and finials.
  const ey = y1 + .08, rise = [3.5, 3.2, 3.8, 3.4, 3.6, 3.3][idx % 6], a = ux + 1.25, b = uz + 1.2;
  // The gardener's house wears a planted roof terrace instead of the hip; every other house gets its roof below.
  if (role === 'garden') roofTerrace(ctx, f, ux, uz, ey, idx);
  else {
  const r = hipRoof(a, b, rise, [.6, .5, .72, .55, .66, .5][idx % 6]);
  const rf = f.m(0, ey, 0), tint = (p: THREE.Vector3) => .9 + .1 * Math.sin(p.x * .7 + p.z * .9 + idx);
  roof.add(r.top, rf, idx % 2 ? C.roof : C.roofB, ROOF.tiles, seed, tint);
  timber.add(r.soffit, rf, C.timber, WOOD.planks, seed);
  timber.add(r.fascia, rf, C.timberDark, WOOD.beam, seed);
  for (const line of r.hips) roof.add(rod(line.map(p => p.clone().add(new V(0, .06, 0))), .1, 6), rf, C.cap, ROOF.cap, seed);
  if (r.ridge.length) metal.add(rod(r.ridge.map(p => p.clone().add(new V(0, .07, 0))), .14, 8), rf, C.gold);
  for (const p of r.corners) metal.add(lath([[.09, 0], [.07, .1], [.03, .32], [0, .42]], 8), f.F.clone().multiply(new THREE.Matrix4().makeTranslation(p.x, ey + p.y, p.z)).multiply(new THREE.Matrix4().makeRotationAxis(new V(p.z, 0, -p.x).normalize(), -.9)), C.gold);
  const ends = role === 'inn' || role === 'tea' ? [] : r.ridge.length ? r.ridge : [new V(0, rise, 0)];
  for (const p of ends) metal.add(lath([[.16, 0], [.2, .1], [.08, .22], [.12, .34], [.05, .5], [.02, .78], [0, .8]], 10), f.m(p.x, ey + p.y + .05, p.z), C.gold);
  // Seen from the air each roof carries its own trade: dormers, chimneys and back wings (roofscape below).
  roofscape(ctx, f, role, idx, ey, rise, b);
  }
  const wing = HOUSE_WINGS[role]; if (wing) backWing(ctx, f, wing, idx);
  // Wind chime under the front eave: gilt hoop and five rods on threads.
  {
    const cx = -ux - .45, cz = uz + .5, cy = ey - .25;
    metal.add(ring(.16, .02, 12), f.m(cx, cy, cz, 0, Math.PI / 2), C.gold);
    for (let k = 0; k < 5; k++) { const a0 = k / 5 * Math.PI * 2, l = .35 + k % 3 * .12; metal.add(new THREE.CylinderGeometry(.018, .018, l, 5), f.m(cx + Math.cos(a0) * .12, cy - .15 - l / 2, cz + Math.sin(a0) * .12), C.gold); }
    timber.add(new THREE.CylinderGeometry(.008, .008, .25, 3), f.m(cx, cy + .12, cz), C.rope, WOOD.beam, seed);
  }
  // Door lantern on a gilt bracket.
  wallLantern(ctx, f, 1.3, 2.25, WZ + .05);
  // Hanging sign with the role's emblem, on a gilt arm at the street corner.
  sign(ctx, f, -(WX - .5), G - .3, WZ, role);
  roleProps(ctx, f, role, idx, ey + rise);
  ctx.stats.houses = (ctx.stats.houses ?? 0) + 1;
}

const wpos = (f: Frame, x: number, y: number, z: number) => { const p = f.p(x, y, z); return {x: p.x, y: p.y, z: p.z}; };

function wallLantern(ctx: TownCtx, f: Frame, x: number, y: number, z: number) {
  ctx.metal.add(rod([new V(x, y + .1, z), new V(x, y + .25, z + .25), new V(x, y + .2, z + .42)], .025, 5), f.F, C.gold);
  hangingLantern(ctx, f.m(x, y + .18, z + .42), 1);
}
/** Lantern hanging from y = 0 in the matrix's frame (cap, warm glass body, cage bars, drip). */
export function hangingLantern(ctx: TownCtx, m: THREE.Matrix4, s = 1, tint = C.glass) {
  const S = new THREE.Matrix4().makeScale(s, s, s), mm = m.clone().multiply(S);
  ctx.metal.add(lath([[0, 0], [.04, 0], [.04, -.05], [.16, -.12], [.13, -.16], [0, -.16]], 8), mm, C.gold);
  ctx.glow.add(lath([[0, -.14], [.11, -.17], [.135, -.3], [.11, -.46], [0, -.48]], 8), mm, tint);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; ctx.metal.add(new THREE.CylinderGeometry(.012, .012, .33, 4), mm.clone().multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * .135, -.31, Math.sin(a) * .135)), C.gold); }
  ctx.metal.add(lath([[0, -.44], [.12, -.46], [.08, -.52], [.02, -.6], [0, -.62]], 8), mm, C.gold);
}

function sign(ctx: TownCtx, f: Frame, x: number, y: number, z: number, role: HouseRole) {
  const {metal, timber} = ctx;
  metal.add(rod([new V(x, y, z), new V(x, y + .05, z + 1.0), new V(x, y - .08, z + 1.25)], .03, 5), f.F, C.gold);
  metal.add(rod([new V(x, y - .55, z + .02), new V(x, y - .02, z + .7)], .02, 4), f.F, C.gold);
  for (const dz of [.35, 1.05]) timber.add(new THREE.CylinderGeometry(.008, .008, .16, 3), f.m(x, y - .08, z + dz), C.rope, WOOD.beam, 0);
  // Board edge-on to the street so walkers on the road read it; emblem on both faces.
  const bm = f.m(x, y - .48, z + .7, Math.PI / 2);
  timber.add(bx(.92, .62, .06), bm, C.timberDark, WOOD.planks, 3);
  signEmblem(ctx, bm, role, .035);
  metal.add(bx(.98, .04, .08), bm.clone().multiply(new THREE.Matrix4().makeTranslation(0, .33, 0)), C.gold);
}

/** The role's gilt emblem on both faces of a board centred on m (faces at z = +-off). */
export function signEmblem(ctx: TownCtx, m: THREE.Matrix4, role: HouseRole, off: number) {
  const g = new THREE.ExtrudeGeometry(emblem(role), {depth: .02, bevelEnabled: false, curveSegments: 8});
  for (const side of [1, -1]) ctx.metal.add(g, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, side * off)).multiply(new THREE.Matrix4().makeScale(side, 1, side)), C.gold);
}

/** Gilt cut-out silhouettes (about 0.5 m): the trade of each house. */
function emblem(role: HouseRole): THREE.Shape | THREE.Shape[] {
  const s = new THREE.Shape();
  const circle = (sh: THREE.Shape | THREE.Path, cx: number, cy: number, r: number, cw = false) => { sh.moveTo(cx + r, cy); sh.absarc(cx, cy, r, 0, Math.PI * 2, cw); };
  if (role === 'chandler') { // airship: envelope over a small hull
    s.absellipse(0, .07, .26, .12, 0, Math.PI * 2, false); const hull = new THREE.Shape(); hull.moveTo(-.16, -.12); hull.lineTo(.16, -.12); hull.lineTo(.1, -.2); hull.lineTo(-.1, -.2); hull.lineTo(-.16, -.12);
    return [s, hull, rect(-.12, -.12, .015, .1), rect(.105, -.12, .015, .1)];
  }
  if (role === 'lantern') { s.moveTo(-.07, .22); s.lineTo(.07, .22); s.lineTo(.14, .1); s.lineTo(.12, -.14); s.lineTo(.06, -.2); s.lineTo(-.06, -.2); s.lineTo(-.12, -.14); s.lineTo(-.14, .1); s.lineTo(-.07, .22); const hole = new THREE.Path(); hole.moveTo(-.07, .08); hole.lineTo(.07, .08); hole.lineTo(.07, -.1); hole.lineTo(-.07, -.1); hole.lineTo(-.07, .08); s.holes.push(hole); return s; }
  if (role === 'maps') { for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? .07 : .23, x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) s.lineTo(x, y); else s.moveTo(x, y); } s.closePath(); return s; }
  if (role === 'inn') { s.absarc(0, 0, .2, Math.PI * .35, Math.PI * 1.65, false); s.absarc(.08, 0, .16, Math.PI * 1.55, Math.PI * .45, true); const star = new THREE.Shape(); circle(star, .16, .12, .035); return [s, star]; }
  if (role === 'tea') { s.moveTo(-.16, .06); s.lineTo(.16, .06); s.absarc(0, .06, .16, 0, -Math.PI, true); const saucer = rect(-.21, -.14, .42, .035); const handle = new THREE.Shape(); handle.absarc(.17, -.0, .06, Math.PI * .5, -Math.PI * .5, true); handle.absarc(.17, -.0, .03, -Math.PI * .5, Math.PI * .5, false);
    const steam = new THREE.Shape(); steam.moveTo(-.03, .1); steam.quadraticCurveTo(-.08, .17, -.02, .22); steam.quadraticCurveTo(.03, .26, -.01, .3); steam.lineTo(.02, .3); steam.quadraticCurveTo(.06, .25, .01, .21); steam.quadraticCurveTo(-.04, .16, 0, .1); return [s, saucer, handle, steam]; }
  // garden: a leaf with its stem
  s.moveTo(0, -.22); s.quadraticCurveTo(-.22, -.02, 0, .24); s.quadraticCurveTo(.22, -.02, 0, -.22);
  const vein = new THREE.Path(); vein.moveTo(-.01, -.12); vein.lineTo(.01, -.12); vein.lineTo(.01, .14); vein.lineTo(-.01, .14); vein.lineTo(-.01, -.12); s.holes.push(vein);
  return s;
}
const rect = (x: number, y: number, w: number, h: number) => { const r = new THREE.Shape(); r.moveTo(x, y); r.lineTo(x + w, y); r.lineTo(x + w, y + h); r.lineTo(x, y + h); r.lineTo(x, y); return r; };

/** Props in front of and beside each house that say who lives there. */
function roleProps(ctx: TownCtx, f: Frame, role: HouseRole, idx: number, ridgeY: number) {
  const {stone, timber, metal, cloth, h} = ctx;
  const gy = (lx: number, lz: number) => { const p = f.p(lx, 0, lz); return h(p.x, p.z) - f.y; };
  const kit = (file: 'props' | 'nature' | 'village', piece: string, lx: number, lz: number, size: number, yaw = 0, ly?: number) => ctx.kits.push({file, piece, ...wpos(f, lx, ly ?? gy(lx, lz), lz), yaw: f.yw(yaw), size});
  const seed = idx * 2.1;
  if (role === 'chandler') {
    // Hoist beam out of the upper floor with a pulley, rope and a crate on the hook; rope coils and cargo below.
    const hx = WX - 1.0, hz0 = WZ + JET, hz1 = WZ + 2.6, hy = G + 2.6;
    timber.add(beam(new V(hx, hy, hz0 - .3), new V(hx, hy, hz1), .24), f.F, C.timberDark, WOOD.beam, seed);
    timber.add(beam(new V(hx, hy - 1.2, hz0), new V(hx, hy - .05, hz0 + 1.3), .14), f.F, C.timberDark, WOOD.beam, seed);
    metal.add(ring(.16, .045, 12), f.m(hx, hy - .26, hz1 - .2, Math.PI / 2), C.gold);
    timber.add(new THREE.CylinderGeometry(.02, .02, 1.7, 4), f.m(hx, hy - 1.1, hz1 - .2), C.rope, WOOD.beam, seed);
    kit('props', 'Crate_Wooden', hx, hz1 - .2, .75, .3, hy - 2.7);
    kit('props', 'Crate_Wooden', 4.2, WZ + 1.3, .8, .2); kit('props', 'Crate_Wooden', 4.35, WZ + 2.25, .7, -.4); kit('props', 'Crate_Wooden', 4.25, WZ + 1.6, .62, .9, gy(4.2, WZ + 1.3) + .8);
    kit('props', 'Barrel', 3.3, WZ + 2.6, .95, 0); kit('props', 'Rope_3', 2.6, WZ + 1.4, .25, .5); kit('props', 'Rope_2', 3.2, WZ + 1.45, .22, 1.1, gy(4.2, WZ + 1.3) + .8);
    // A spare propeller leaning on the side wall and rolled sails on a rack.
    const pf = f.m(WX + .35, 1.15, 1.6, Math.PI / 2, 0, -.18);
    metal.add(lath([[.1, -.12], [.13, 0], [.1, .12], [0, .14]], 10), pf.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), C.gold);
    for (let k = 0; k < 3; k++) timber.add(lath([[.0, 0], [.09, .05], [.12, .5], [.07, .95], [0, 1]], 6), pf.clone().multiply(new THREE.Matrix4().makeRotationZ(k * Math.PI * 2 / 3)).multiply(new THREE.Matrix4().makeScale(1, 1, .3)), C.timber, WOOD.beam, seed + k);
    for (const pz of [-1.8, -.4]) timber.add(beam(new V(WX + .4, gy(WX + .4, pz), pz), new V(WX + .4, 1.3, pz), .1), f.F, C.timberDark, WOOD.beam, seed);
    for (let k = 0; k < 3; k++) { const g = new THREE.CylinderGeometry(.15, .15, 1.9, 10, 1); const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) { const [u, v] = atlasUv(CLOTH.sail, uv.getX(i), uv.getY(i)); uv.setXY(i, u, v); } cloth.add(g, f.m(WX + .55 + (k % 2) * .05, .5 + k * .32, -1.1, 0, Math.PI / 2), '#ffffff', 0, k); }
  } else if (role === 'lantern') {
    // A drying frame of paper lanterns by the door and a string of lanterns along the balcony.
    const fx = 3.9, fz = WZ + 1.7;
    for (const dx of [-1.15, 1.15]) timber.add(lath([[.09, 0], [.1, .2], [.07, .3], [.07, 2.3], [.1, 2.4], [.05, 2.55], [0, 2.6]], 6), f.m(fx + dx, gy(fx + dx, fz), fz), C.timber, WOOD.beam, seed);
    timber.add(beam(new V(fx - 1.35, 2.35, fz), new V(fx + 1.35, 2.35, fz), .1), f.F, C.timber, WOOD.beam, seed);
    const tones = ['#ffc070', '#ff9d7a', '#ffd98a', '#9fe8d8', '#f6a6c0', '#ffc070'];
    for (let k = 0; k < 6; k++) { const lx = fx - .95 + k * .38, l = .25 + (k * 37 % 5) * .08; timber.add(new THREE.CylinderGeometry(.008, .008, l, 3), f.m(lx, 2.3 - l / 2, fz), C.rope, WOOD.beam, 0); paperLantern(ctx, f.m(lx, 2.3 - l, fz), .9 + k % 2 * .2, new THREE.Color(tones[k]).multiplyScalar(1.6)); }
    const fr = WZ + JET + 1.44, a = new V(-3.74, G + 1.95, fr), b = new V(3.74, G + 1.95, fr);
    for (const p of [a, b]) timber.add(beam(new V(p.x, G + 1.2, fr), new V(p.x, p.y + .1, fr), .1), f.F, C.timber, WOOD.beam, seed);
    timber.add(rod(sagPoints(a, b, .25), .012, 3), f.F, C.rope, WOOD.beam, 0);
    for (let k = 1; k < 7; k++) { const p = sagPoints(a, b, .25, 7)[k]; paperLantern(ctx, f.m(p.x, p.y, p.z), .7, new THREE.Color(tones[k % 6]).multiplyScalar(1.5)); }
    kit('props', 'Workbench', -3.6, WZ + 1.6, .95, Math.PI / 2 + .1);
  } else if (role === 'maps') {
    // Telescope on the balcony aimed at the sky, a globe by the door and a barrel of rolled charts.
    const ty = G + .08, tz = WZ + JET + .9;
    for (let k = 0; k < 3; k++) { const a0 = k / 3 * Math.PI * 2; metal.add(beam(new V(2.6 + Math.cos(a0) * .35, ty, tz + Math.sin(a0) * .35), new V(2.6, ty + 1.1, tz), .04), f.F, C.gold); }
    metal.add(lath([[.07, 0], [.075, .5], [.09, .55], [.09, 1.1], [.12, 1.15], [.12, 1.45], [.0, 1.46]], 12), f.m(2.6, ty + 1.15, tz, .4, .95, 0).multiply(new THREE.Matrix4().makeTranslation(0, -.6, 0)), C.gold);
    const gx = -3.6, gz = WZ + 1.4, g0 = gy(gx, gz);
    timber.add(lath([[.25, 0], [.25, .06], [.06, .12], [.05, .7], [.12, .8], [0, .82]], 8), f.m(gx, g0, gz), C.timberDark, WOOD.beam, seed);
    stone.add(new THREE.SphereGeometry(.36, 18, 12), f.m(gx, g0 + 1.2, gz), '#3e8fa6', STONE.ceramic, seed);
    stone.add(new THREE.SphereGeometry(.362, 18, 12, 0, Math.PI * 2, .6, .5), f.m(gx, g0 + 1.2, gz, .5), '#d8c48c', STONE.ceramic, seed);
    metal.add(ring(.42, .02, 24), f.m(gx, g0 + 1.2, gz, .3, 0, .4), C.gold);
    kit('props', 'Barrel', 3.9, WZ + 1.3, .95, .3);
    turret(ctx, f, WX - .25, WZ - .25, idx);
    for (let k = 0; k < 5; k++) { const g = new THREE.CylinderGeometry(.05, .05, .7, 8); const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) { const [u, v] = atlasUv(CLOTH.sail, uv.getX(i) * .1, uv.getY(i) * .4); uv.setXY(i, u, v); } cloth.add(g, f.m(3.9 + Math.cos(k * 1.3) * .16, gy(3.9, WZ + 1.3) + 1.1, WZ + 1.3 + Math.sin(k * 1.3) * .16, k, .25 * Math.cos(k), .2 * Math.sin(k)), '#f4ead2', 0, k); }
  } else if (role === 'inn') {
    // Table and stools under a lantern string, barrels by the wall; a lantern cupola on the roof.
    kit('props', 'Table_Large', 3.9, WZ + 2.2, .85, Math.PI / 2);
    for (const [sx, sz] of [[3.1, 1.5], [3.1, 2.9], [4.7, 1.5], [4.7, 2.9]]) kit('props', 'Stool', sx, WZ + sz, .5, sx);
    for (const [mx, mz] of [[3.8, 1.9], [4.05, 2.6]]) kit('props', 'Mug', mx, WZ + mz, .14, mx * 2, gy(3.9, WZ + 2.2) + .86);
    kit('props', 'Barrel', -WX - .55, 1.4, .95, 0); kit('props', 'Barrel', -WX - .6, 2.5, .95, .5); kit('props', 'Barrel', -WX - .55, 1.95, .8, 1, gy(-WX - .55, 1.4) + .95);
    const pole = new V(5.3, 0, WZ + 3.6); timber.add(lath([[.08, 0], [.08, 2.7], [.05, 2.8], [0, 2.82]], 6), f.m(pole.x, gy(pole.x, pole.z), pole.z), C.timber, WOOD.beam, seed);
    const a = new V(WX - .2, G - .1, WZ + .1), b = new V(pole.x, gy(pole.x, pole.z) + 2.65, pole.z);
    timber.add(rod(sagPoints(a, b, .3), .012, 3), f.F, C.rope, WOOD.beam, 0);
    sagPoints(a, b, .3, 5).slice(1, 5).forEach((p, k) => paperLantern(ctx, f.m(p.x, p.y, p.z), .65, new THREE.Color(k % 2 ? '#ffc070' : '#ffd98a').multiplyScalar(1.6)));
    cupola(ctx, f, ridgeY, idx);
  } else if (role === 'tea') {
    // A sail awning over low tables with cushions and teapots; paper lanterns; a cupola on the roof.
    const ax = 4.3, az = WZ + 2.0;
    for (const [px, pz] of [[ax - 1.6, az + 1.2], [ax + 1.6, az + 1.2]]) timber.add(lath([[.08, 0], [.08, 2.25], [.05, 2.35], [0, 2.37]], 6), f.m(px, gy(px, pz), pz), C.timber, WOOD.beam, seed);
    const aw = clothSheet(3.4, 3.25, CLOTH.awning, {nx: 8, ny: 7, sag: -.16});
    cloth.add(aw, f.m(ax, G - .2, WZ + .05, 0, .23 - Math.PI / 2), '#ffffff', .2, 1);
    metal.add(rod([new V(ax - 1.75, G - .2, WZ + .06), new V(ax + 1.75, G - .2, WZ + .06)], .035, 5), f.F, C.gold);
    for (const [tx, tz] of [[ax - .8, az + .1], [ax + .9, az - .2]]) {
      const t0 = gy(tx, tz);
      timber.add(bx(.9, .07, .9), f.m(tx, t0 + .38, tz), C.timberDark, WOOD.planks, seed);
      for (const [lx, lz] of [[-.35, -.35], [.35, -.35], [-.35, .35], [.35, .35]]) timber.add(bx(.07, .36, .07), f.m(tx + lx, t0 + .18, tz + lz), C.timberDark, WOOD.beam, seed);
      stone.add(lath([[0, 0], [.08, 0], [.11, .06], [.1, .12], [.05, .15], [.06, .17], [0, .18]], 10), f.m(tx, t0 + .415, tz), '#e8eef0', STONE.ceramic, seed);
      stone.add(new THREE.CylinderGeometry(.012, .02, .14, 5), f.m(tx + .12, t0 + .5, tz, 0, 0, -.9), '#e8eef0', STONE.ceramic, seed);
      for (const [cx, cz] of [[-.75, 0], [.75, 0], [0, .75]]) { const g = new THREE.SphereGeometry(.28, 10, 6); g.scale(1, .32, 1); const uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) { const [u, v] = atlasUv(CLOTH.kite, uv.getX(i) * .5 + (cx > 0 ? .5 : 0), uv.getY(i) * .5 + (cz > 0 ? .5 : 0)); uv.setXY(i, u, v); } cloth.add(g, f.m(tx + cx, t0 + .09, tz + cz), '#ffffff', 0, cx); }
    }
    for (let k = 0; k < 3; k++) paperLantern(ctx, f.m(ax - 1.2 + k * 1.2, G - .78 - (k % 2) * .12, az + .3), .8, new THREE.Color(k % 2 ? '#f6a6c0' : '#ffd98a').multiplyScalar(1.5));
    cupola(ctx, f, ridgeY, idx);
  } else {
    // Gardener: a trellis of vines on the side wall, seed trays on a bench, pots of seedlings, a watering can.
    for (let k = 0; k <= 4; k++) timber.add(beam(new V(WX + .14, .1, -3 + k * 1.5), new V(WX + .14, 2.9, -3 + k * 1.5), .06), f.F, C.timber, WOOD.beam, seed);
    for (let k = 0; k <= 4; k++) timber.add(beam(new V(WX + .16, .5 + k * .6, -3.1), new V(WX + .16, .5 + k * .6, 3.1), .05), f.F, C.timber, WOOD.beam, seed);
    if (!ctx.low) for (const pz of [-2.2, .4, 2.6]) ctx.kits.push({file: 'village', piece: pz > 0 ? 'Prop_Vine6' : 'Prop_Vine9', ...wpos(f, WX + .3, 0, pz), yaw: f.yw(Math.PI / 2), size: 2.6});
    glasshouse(ctx, f, idx);
    const bx0 = 3.8, bz0 = WZ + 1.7, b0 = gy(bx0, bz0);
    timber.add(bx(2.0, .08, .7), f.m(bx0, b0 + .78, bz0, .15), C.timber, WOOD.planks, seed);
    for (const dx of [-.85, .85]) timber.add(bx(.08, .78, .6), f.m(bx0 + dx * Math.cos(.15), b0 + .39, bz0 - dx * Math.sin(.15), .15), C.timberDark, WOOD.beam, seed);
    for (let k = 0; k < 3; k++) { const tx = bx0 - .6 + k * .6; timber.add(bx(.5, .1, .4), f.m(tx, b0 + .87, bz0 - .07 * k, .15), C.timberDark, WOOD.planks, seed + k); if (!ctx.low) kit('nature', 'Plant_7', tx, bz0 - .07 * k, .25, k, b0 + .92); }
    const pots: [number, number, number][] = [[-3.2, WZ + 1.2, .5], [-3.9, WZ + 1.8, .38], [-2.6, WZ + 2.0, .32], [-4.4, WZ + .9, .44], [3.0, WZ + 2.6, .4]];
    pots.forEach(([px, pz, s], k) => {
      const p0 = gy(px, pz);
      stone.add(lath([[0, 0], [.22, 0], [.27, .06], [.3, .42], [.36, .46], [.36, .52], [.3, .52]], 12), f.m(px, p0, pz, k, 0, 0, s * 2), k % 2 ? '#3fb7b0' : '#e8dcc0', STONE.ceramic, seed + k);
      if (!ctx.low) kit('nature', k % 2 ? 'Bush_Common_Flowers' : 'Plant_1', px, pz, s * 1.4, k, p0 + s * .95);
    });
    const wx = -2.1, wz = WZ + 1.0, w0 = gy(wx, wz);
    metal.add(lath([[0, 0], [.16, 0], [.17, .3], [.12, .34], [0, .34]], 10), f.m(wx, w0, wz), '#7fb0a8');
    metal.add(rod([new V(wx + .14, w0 + .08, wz), new V(wx + .38, w0 + .32, wz), new V(wx + .46, w0 + .36, wz)], .02, 5), f.F, '#7fb0a8');
    metal.add(rod([new V(wx - .1, w0 + .34, wz), new V(wx, w0 + .5, wz), new V(wx + .1, w0 + .34, wz)], .015, 4), f.F, '#7fb0a8');
  }
}

/** The map maker's corner turret: corbelled out above the ground floor, round windows, a ribbed glazed dome. */
function turret(ctx: TownCtx, f: Frame, x: number, z: number, idx: number) {
  const R = 1.15, y0 = G - .7, y1 = G + .14 + U + .9;
  ctx.stone.add(lath([[.3, 0], [R * .7, .3], [R + .08, .7], [R + .08, .82], [0, .82]], 18), f.m(x, y0 - .1, z), C.trim, STONE.dressed, idx);
  ctx.stone.add(new THREE.CylinderGeometry(R, R, y1 - y0 - .7, 18, 2, true), f.m(x, (y0 + .7 + y1) / 2, z), C.plaster, STONE.plaster, idx);
  ctx.stone.add(new THREE.CylinderGeometry(R + .1, R + .1, .16, 18), f.m(x, y1, z), C.trim, STONE.dressed, idx);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI / 2 + Math.PI / 4 - Math.PI / 2 * (k === 2 ? -2 : 0); ctx.metal.add(ring(.3, .045), f.m(x + Math.sin(a) * (R + .02), y1 - 1.0, z + Math.cos(a) * (R + .02), a), C.gold); ctx.glow.add(disc(.28, 14), f.m(x + Math.sin(a) * (R + .01), y1 - 1.0, z + Math.cos(a) * (R + .01), a), C.glass); }
  const dome = new THREE.SphereGeometry(R + .25, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  { const uv = dome.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * (R + .25), (1 - uv.getY(i)) * 2.2); }
  ctx.roof.add(dome, f.m(x, y1 + .06, z, 0, 0, 0, [1, 1.25, 1]), C.roof, ROOF.tiles, idx);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, pts: THREE.Vector3[] = []; for (let j = 0; j <= 8; j++) { const p = j / 8 * Math.PI / 2; pts.push(new V(x + Math.sin(a) * Math.cos(p) * (R + .29), y1 + .06 + Math.sin(p) * (R + .29) * 1.25, z + Math.cos(a) * Math.cos(p) * (R + .29))); } ctx.metal.add(rod(pts, .035, 4), f.F, C.gold); }
  ctx.metal.add(lath([[.12, 0], [.14, .1], [.05, .24], [.09, .36], [.02, .6], [0, .9]], 10), f.m(x, y1 + .06 + (R + .25) * 1.25 - .05, z), C.gold);
}

/** The gardener's lean-to glasshouse against the north wall: stone kerb, timber glazing bars, pale glass. */
function glasshouse(ctx: TownCtx, f: Frame, idx: number) {
  const x0 = -WX, x1 = -WX - 2.6, z0 = -3.1, z1 = 3.1, hi = 3.0, lo = 2.0;
  const p0 = f.p(x1, 0, 0), g0 = ctx.h(p0.x, p0.z) - f.y;
  ctx.stone.add(bx(2.7, .9, 6.4), f.m((x0 + x1) / 2 - .05, g0 - .05, 0), C.stone, STONE.ashlar, idx);
  const glass = '#bfe0da', slope = Math.atan2(hi - lo, x0 - x1), run = Math.hypot(hi - lo, x0 - x1);
  ctx.stone.add(bx(run, .04, z1 - z0), f.m((x0 + x1) / 2, (hi + lo) / 2 + .02, 0, 0, 0, -slope), glass, STONE.ceramic, idx);
  ctx.stone.add(bx(.04, lo - g0 - .4, z1 - z0), f.m(x1, (lo + g0 + .4) / 2, 0), glass, STONE.ceramic, idx);
  for (const zz of [z0, z1]) {
    // End panels face outward: the south one drawn from the open side, the north one turned round from the wall.
    const w = x0 - x1, a = zz > 0 ? lo : hi, b = zz > 0 ? hi : lo, sh = new THREE.Shape();
    sh.moveTo(0, g0 + .4); sh.lineTo(w, g0 + .4); sh.lineTo(w, b); sh.lineTo(0, a); sh.lineTo(0, g0 + .4);
    ctx.stone.add(new THREE.ShapeGeometry(sh), zz > 0 ? f.m(x1, 0, zz) : f.m(x0, 0, zz, Math.PI), glass, STONE.ceramic, idx);
  }
  for (let k = 0; k <= 6; k++) {
    const zz = z0 + (z1 - z0) * k / 6;
    ctx.timber.add(beam(new V(x1, g0 + .4, zz), new V(x1, lo, zz), .08), f.F, C.timber, WOOD.beam, idx);
    ctx.timber.add(beam(new V(x1 - .02, lo, zz), new V(x0, hi, zz), .08), f.F, C.timber, WOOD.beam, idx);
  }
  for (const yy of [1.2]) ctx.timber.add(beam(new V(x1 - .02, yy, z0), new V(x1 - .02, yy, z1), .07), f.F, C.timber, WOOD.beam, idx);
  ctx.timber.add(beam(new V(x1 - .03, lo + .02, z0 - .05), new V(x1 - .03, lo + .02, z1 + .05), .12), f.F, C.timberDark, WOOD.beam, idx);
  if (!ctx.low) for (const zz of [-2.2, -.4, 1.6]) ctx.kits.push({file: 'nature', piece: 'Plant_1', ...wpos(f, x1 + .9, g0 + .4, zz), yaw: zz, size: .7});
}

/** A round-windowed lantern tower on the ridge with its own little swept roof. */
function cupola(ctx: TownCtx, f: Frame, ridgeY: number, idx: number) {
  const y = ridgeY - .55, s = .8;
  ctx.stone.add(bx(s * 2, 1.5, s * 2), f.m(0, y + .75, 0), C.plaster, STONE.plaster, idx);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ctx.timber.add(bx(.14, 1.55, .14), f.m(sx * s, y + .78, sz * s), C.timber, WOOD.beam, idx);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.metal.add(ring(.28, .04, 16), f.m(Math.sin(a) * (s + .03), y + .85, Math.cos(a) * (s + .03), a), C.gold); ctx.glow.add(disc(.26, 14), f.m(Math.sin(a) * (s + .02), y + .85, Math.cos(a) * (s + .02), a), C.glass); }
  const r = hipRoof(s + .55, s + .55, 1.0, .25, {ns: 10, nt: 6, soffit: .08, fascia: .12});
  const rf = f.m(0, y + 1.5, 0);
  ctx.roof.add(r.top, rf, C.roof, ROOF.tiles, idx);
  ctx.timber.add(r.soffit, rf, C.timber, WOOD.planks, idx);
  ctx.timber.add(r.fascia, rf, C.timberDark, WOOD.beam, idx);
  for (const line of r.hips) ctx.roof.add(rod(line.map(p => p.clone().add(new V(0, .04, 0))), .06, 5), rf, C.cap, ROOF.cap, idx);
  ctx.metal.add(lath([[.1, 0], [.12, .08], [.05, .16], [.08, .26], [.03, .4], [0, .6]], 10), f.m(0, y + 2.48, 0), C.gold);
}

/** Paper lantern: ribbed warm body between gilt caps, hanging from y = 0. */
function paperLantern(ctx: TownCtx, m: THREE.Matrix4, s: number, col: THREE.Color) {
  const mm = m.clone().multiply(new THREE.Matrix4().makeScale(s, s, s));
  ctx.metal.add(new THREE.CylinderGeometry(.05, .06, .04, 8), mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -.02, 0)), C.gold);
  const body = lath([[0, -.03], [.12, -.06], [.17, -.14], [.18, -.22], [.16, -.3], [.1, -.37], [0, -.39]], 10);
  ctx.glow.add(body, mm, col);
  ctx.metal.add(new THREE.CylinderGeometry(.05, .04, .04, 8), mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -.4, 0)), C.gold);
}

// ---- Market, street, benches -------------------------------------------------------------------------------------

/** Sail-cloth market stall: carved posts, plank counter, striped canopy with a scalloped valance, goods. */
function stall(ctx: TownCtx, x: number, z: number, yaw: number, goods: 'seeds' | 'kites') {
  const {h, timber, metal, cloth, stone} = ctx;
  let base = -Infinity; for (const [dx, dz] of [[-2.4, -1.3], [2.4, -1.3], [-2.4, 1.3], [2.4, 1.3], [0, 0]]) { const c = Math.cos(yaw), s = Math.sin(yaw); base = Math.max(base, h(x + dx * c + dz * s, z - dx * s + dz * c)); }
  const f = new Frame(x, base, z, yaw), seed = x;
  const th = .42, RY = 3.2, RZ = -.15;
  const gy = (lx: number, lz: number) => { const p = f.p(lx, 0, lz); return h(p.x, p.z) - base; };
  for (const [px, pz] of [[-2.2, -1.05], [2.2, -1.05], [-2.2, 1.05], [2.2, 1.05]]) {
    const y0 = gy(px, pz) - .2, top = RY - Math.abs(pz - RZ) * Math.tan(th) - .04;
    stone.add(lath([[.2, 0], [.2, .22], [.14, .3], [0, .3]], 8), f.m(px, y0, pz), C.trim, STONE.dressed, seed);
    timber.add(lath([[.09, 0], [.1, .3], [.07, .4], [.08, top - .5], [.11, top - .4], [.07, top - .3], [.07, top - y0], [0, top - y0]], 8), f.m(px, y0 + .28, pz), C.timber, WOOD.beam, seed + px);
  }
  timber.add(bx(4.5, .9, .14), f.m(0, .5, .95), C.timber, WOOD.planks, seed);
  timber.add(bx(.14, .9, 1.9), f.m(-2.18, .5, 0), C.timber, WOOD.planks, seed);
  timber.add(bx(.14, .9, 1.9), f.m(2.18, .5, 0), C.timber, WOOD.planks, seed);
  timber.add(bx(4.8, .09, 1.0), f.m(0, 1.0, .75), C.timberDark, WOOD.planks, seed);
  timber.add(bx(4.4, .07, .5), f.m(0, 1.45, -.85), C.timberDark, WOOD.planks, seed);
  for (const px of [-2.0, 2.0]) timber.add(bx(.08, .5, .5), f.m(px, 1.2, -.85), C.timberDark, WOOD.beam, seed);
  for (const sx of [-1, 1]) metal.add(bx(.08, .06, .7), f.m(sx * 2.15, .78, .95), C.gold);
  // Canopy: a sagging gable of striped sail cloth, ridge along x, lapping past the counter, with a valance.
  cloth.add(clothSheet(5.2, 1.95, CLOTH.awning, {nx: 10, ny: 5, sag: -.12}), f.m(0, RY, RZ, 0, th - Math.PI / 2), '#ffffff', .08, seed);
  cloth.add(clothSheet(5.2, 1.4, CLOTH.awning, {nx: 10, ny: 4, sag: -.1}), f.m(0, RY, RZ, Math.PI, th - Math.PI / 2), '#ffffff', .05, seed + 1);
  const vz = RZ + Math.cos(th) * 1.95, vy = RY - Math.sin(th) * 1.95;
  const val = clothSheet(5.2, .42, CLOTH.sail, {nx: 16, ny: 2});
  { const p = val.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) if (p.getY(i) < -.3) p.setY(i, p.getY(i) + .14 * Math.abs(Math.sin(p.getX(i) * Math.PI / .65))); val.computeVertexNormals(); }
  cloth.add(val, f.m(0, vy + .02, vz + .01), '#ffffff', .5, seed + 2);
  metal.add(rod([new V(-2.6, RY + .03, RZ), new V(2.6, RY + .03, RZ)], .05, 6), f.F, C.gold);
  for (const sx of [-1, 1]) metal.add(new THREE.SphereGeometry(.09, 8, 6), f.m(sx * 2.65, RY + .03, RZ), C.gold);
  hangingLantern(ctx, f.m(2.2, vy + .25, 1.25), .9);
  if (goods === 'seeds') {
    // Seed sacks, open baskets of seed, pollen jars on the shelf.
    for (const [sx, sz, sc] of [[-1.6, .7, .55], [-.9, .75, .5], [1.4, .7, .55]]) ctx.kits.push({file: 'props', piece: 'Bag', ...wpos(f, sx, 1.04, sz), yaw: f.yw(sx), size: sc});
    for (const [sx, sz] of [[-2.9, 1.4], [-3.3, .7], [2.9, 1.3]]) ctx.kits.push({file: 'props', piece: 'Bag', ...wpos(f, sx, gy(sx, sz), sz), yaw: f.yw(sx * 2), size: .7});
    for (const [bx0, col] of [[-.1, '#d9b45a'], [.55, '#8a5a3a'], [-2.75, '#c9a24a']] as const) {
      const by = bx0 < -2 ? gy(bx0, 1.9) : 1.04, bz = bx0 < -2 ? 1.9 : .75;
      timber.add(lath([[0, 0], [.2, 0], [.27, .18], [.25, .2], [0, .2]], 12), f.m(bx0, by, bz), '#b08850', WOOD.beam, seed);
      stone.add(new THREE.CircleGeometry(.24, 12), f.m(bx0, by + .17, bz, 0, -Math.PI / 2), col, STONE.dressed, seed);
    }
    for (let k = 0; k < 7; k++) jar(ctx, f.m(-1.8 + k * .6, 1.49, -.85), k);
  } else {
    // Kites hung from the canopy edge with ribbon tails, spools and coils of line on the counter.
    for (let k = 0; k < 4; k++) kite(ctx, f, -1.8 + k * 1.2, vy - .5 - (k % 2) * .25, vz + .1, k);
    for (const [sx, piece] of [[-1.3, 'Rope_1'], [-.2, 'Rope_2'], [1.2, 'Rope_1']] as const) ctx.kits.push({file: 'props', piece, ...wpos(f, sx, 1.045, .75), yaw: f.yw(sx), size: .12});
    for (let k = 0; k < 5; k++) { timber.add(new THREE.CylinderGeometry(.09, .09, .2, 10), f.m(-1.7 + k * .8, 1.6, -.85, 0, 0, Math.PI / 2), '#e8d6a8', WOOD.beam, k); metal.add(new THREE.CylinderGeometry(.12, .12, .03, 10), f.m(-1.7 + k * .8 - .1, 1.6, -.85, 0, 0, Math.PI / 2), C.gold); }
    ctx.kits.push({file: 'props', piece: 'Crate_Wooden', ...wpos(f, -2.95, gy(-2.95, 1.2), 1.2), yaw: f.yw(.3), size: .7});
    ctx.kits.push({file: 'props', piece: 'Barrel', ...wpos(f, 3.0, gy(3.0, .9), .9), yaw: f.yw(0), size: .9});
  }
  ctx.stats.stalls = (ctx.stats.stalls ?? 0) + 1;
}
function jar(ctx: TownCtx, m: THREE.Matrix4, k: number) {
  const cols = ['#e8b84a', '#f2c96a', '#d99a3a', '#f0d27a'];
  ctx.stone.add(lath([[0, 0], [.09, 0], [.12, .08], [.12, .2], [.08, .26], [.07, .3], [0, .3]], 10), m, cols[k % 4], STONE.ceramic, k);
  ctx.metal.add(new THREE.CylinderGeometry(.075, .075, .05, 10), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, .32, 0)), C.gold);
}
function kite(ctx: TownCtx, f: Frame, x: number, y: number, z: number, k: number) {
  const g = new THREE.BufferGeometry(), w = .42, hgt = .62;
  const P = [[0, hgt * .62], [w, 0], [0, -hgt * .38], [-w, 0], [0, 0]].map(([px, py]) => [px * (.8 + k % 2 * .2), py]);
  const pos: number[] = [], uv: number[] = [];
  for (const [i0, i1] of [[0, 1], [1, 2], [2, 3], [3, 0]]) for (const i of [i0, i1, 4]) { pos.push(P[i][0], P[i][1], 0); uv.push(...atlasUv(CLOTH.kite, P[i][0] / (w * 2) + .5, P[i][1] / hgt + .4)); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  ctx.cloth.add(g, f.m(x, y, z, .15 * (k - 1.5), 0, .25 * (k % 2 ? 1 : -1)), '#ffffff', .25, k);
  ctx.timber.add(new THREE.CylinderGeometry(.006, .006, .45, 3), f.m(x, y + .55, z), C.rope, WOOD.beam, 0);
  const tail = clothSheet(.07, 1.1, CLOTH.kite, {nx: 1, ny: 8});
  ctx.cloth.add(tail, f.m(x, y - hgt * .38, z + .01, 0, 0, .1), '#ffffff', .9, k + .5);
}

function cart(ctx: TownCtx) {
  const {x, z, yaw} = skyTownPlan().cart;
  ctx.kits.push({file: 'props', piece: 'Stall_Cart_Empty', x, y: ctx.h(x, z), z, yaw, size: 2.3});
  const f = new Frame(x, ctx.h(x, z), z, yaw);
  for (let k = 0; k < 6; k++) jar(ctx, f.m(-.6 + (k % 3) * .45, .92, -.15 + Math.floor(k / 3) * .3), k + 1);
  ctx.kits.push({file: 'props', piece: 'Bag', ...wpos(f, .55, .9, 0), yaw: yaw + .4, size: .5});
}

/** Carved post: stone foot, turned timber shaft with gilt collars, a crook arm and a hanging lantern over the road. */
export function lanternPost(ctx: TownCtx, x: number, z: number, yaw: number, base?: number) {
  const y = base ?? ctx.h(x, z) - .08, f = new Frame(x, y, z, yaw);
  ctx.stone.add(lath([[.34, -.2], [.34, .22], [.26, .3], [.22, .55], [.26, .62], [.2, .68], [0, .68]], 10), f.m(0, 0, 0), C.trim, STONE.dressed, x + z);
  ctx.timber.add(lath([[.12, 0], [.1, .3], [.085, 1.2], [.1, 1.3], [.085, 1.4], [.075, 2.4], [.09, 2.55], [.07, 2.7], [0, 2.72]], 8), f.m(0, .66, 0), C.timber, WOOD.beam, x * z);
  for (const cy of [1.37, 2.5]) ctx.metal.add(new THREE.CylinderGeometry(.105, .105, .07, 10), f.m(0, .66 + cy, 0), C.gold);
  ctx.metal.add(lath([[.09, 0], [.06, .12], [.03, .3], [0, .34]], 8), f.m(0, 3.38, 0), C.gold);
  ctx.metal.add(rod([new V(0, 3.1, 0), new V(.15, 3.32, 0), new V(.48, 3.36, 0), new V(.68, 3.2, 0)], .032, 5), f.F, C.gold);
  ctx.metal.add(rod([new V(.05, 2.75, 0), new V(.32, 3.1, 0), new V(.5, 3.32, 0)], .022, 4), f.F, C.gold);
  hangingLantern(ctx, f.m(.68, 3.18, 0), 1.25);
  ctx.stats.lanterns = (ctx.stats.lanterns ?? 0) + 1;
}

/** Tall pole with a gilt finial and crossbar, a swallow-tailed cloth banner in the wind and tassels. */
function banner(ctx: TownCtx, x: number, z: number, i: number) {
  const y = ctx.h(x, z) - .1, f = new Frame(x, y, z, 0), side = x < 0 ? -1 : 1;
  ctx.stone.add(lath([[.3, -.2], [.3, .2], [.2, .3], [0, .3]], 10), f.m(0, 0, 0), C.trim, STONE.dressed, i);
  ctx.timber.add(lath([[.1, 0], [.085, 3], [.07, 6.0], [0, 6.0]], 8), f.m(0, .28, 0), C.timber, WOOD.beam, i);
  ctx.metal.add(lath([[.09, 0], [.11, .08], [.04, .2], [.1, .34], [.0, .62]], 10), f.m(0, 6.25, 0), C.gold);
  const bxs = side * .78;
  ctx.metal.add(rod([new V(-.05 * side, 5.75, 0), new V(bxs * 2 - .05 * side, 5.75, 0)], .04, 6), f.F, C.gold);
  for (const ex of [-.05 * side, bxs * 2 - .05 * side]) if (Math.abs(ex) > .2) ctx.metal.add(new THREE.SphereGeometry(.07, 8, 6), f.m(ex, 5.75, 0), C.gold);
  const sheet = clothSheet(1.3, 3.3, CLOTH.banner, {nx: 6, ny: 14, tail: .45});
  ctx.cloth.add(sheet, f.m(bxs, 5.7, 0, 0), '#ffffff', 1, i * .37);
  ctx.timber.add(new THREE.CylinderGeometry(.02, .02, 1.38, 5), f.m(bxs, 5.7, 0, 0, 0, Math.PI / 2), C.timberDark, WOOD.beam, i);
  for (const dx of [-.62, .62]) { ctx.metal.add(lath([[0, 0], [.04, -.04], [.05, -.12], [.02, -.22], [0, -.24]], 6), f.m(bxs + dx, 5.66, .02), C.gold); }
  ctx.stats.banners = (ctx.stats.banners ?? 0) + 1;
}

/** A bench with two stone planters of blossom and a low lantern: a resting place, not a row of street furniture. */
function benchScene(ctx: TownCtx, x: number, z: number, yaw: number) {
  const y = ctx.h(x, z), f = new Frame(x, y, z, yaw);
  ctx.kits.push({file: 'props', piece: 'Bench', x, y, z, yaw: yaw + Math.PI, size: .85});
  for (const sx of [-1.6, 1.6]) {
    const p = f.p(sx, 0, 0), gy = ctx.h(p.x, p.z) - y;
    ctx.stone.add(bx(.95, .62, .95, [1, 2, 1]), f.m(sx, gy + .26, 0), C.stone, STONE.ashlar, sx);
    ctx.stone.add(bx(1.08, .1, 1.08), f.m(sx, gy + .6, 0), C.trim, STONE.dressed, sx);
    if (!ctx.low) { ctx.kits.push({file: 'nature', piece: 'Bush_Common_Flowers', ...wpos(f, sx, gy + .6, 0), yaw: x + sx, size: .75}); ctx.kits.push({file: 'nature', piece: 'Flower_4_Group', ...wpos(f, sx + .25, gy + .62, .25), yaw: x - sx, size: .5}); }
  }
  ctx.stats.benches = (ctx.stats.benches ?? 0) + 1;
}

/** Paper-lantern festoon over a street end: two slim poles on stone feet, a sagging rope, seven lanterns in warm tones. */
function festoon(ctx: TownCtx, fs: (typeof SKY_FESTOONS)[number]) {
  const [[ax, az], [bx0, bz]] = festoonPoles(fs), tops: THREE.Vector3[] = [];
  for (const [x, z] of [[ax, az], [bx0, bz]]) {
    const y = ctx.h(x, z) - .08, f = new Frame(x, y, z, 0);
    ctx.stone.add(lath([[.22, -.2], [.22, .16], [.15, .24], [0, .24]], 8), f.m(0, 0, 0), C.trim, STONE.dressed, x);
    ctx.timber.add(lath([[.08, 0], [.07, 1.4], [.085, 1.46], [.065, 1.52], [.055, 3.5], [0, 3.52]], 7), f.m(0, .22, 0), C.timber, WOOD.beam, z);
    ctx.metal.add(lath([[.07, 0], [.05, .1], [.02, .24], [0, .3]], 8), f.m(0, 3.72, 0), C.gold);
    tops.push(new V(x, y + 3.55, z));
  }
  ctx.timber.add(rod(sagPoints(tops[0], tops[1], .55, 10), .014, 3), null, C.rope, WOOD.beam, 0);
  const tones = ['#ffc070', '#f6a6c0', '#ffd98a', '#9fe8d8', '#ffc070', '#ff9d7a', '#ffd98a'];
  const pts = sagPoints(tops[0], tops[1], .55, 8);
  for (let k = 1; k < 8; k++) paperLantern(ctx, M(pts[k].x, pts[k].y, pts[k].z, k * .7), .8 + (k % 3) * .1, new THREE.Color(tones[k - 1]).multiplyScalar(1.55));
  ctx.stats.festoons = (ctx.stats.festoons ?? 0) + 1;
}

/** Height of a house roof's front or back slope above the eaves at distance d from the ridge line (hipRoof's profile). */
const slopeY = (rise: number, b: number, d: number) => rise * Math.pow(Math.max(0, 1 - Math.abs(d) / b), 1.45);

/** Chimneys and dormers by trade, so the six roofs read apart from the air. */
function roofscape(ctx: TownCtx, f: Frame, role: HouseRole, idx: number, ey: number, rise: number, b: number) {
  const chimneys: Record<HouseRole, [number, number][]> = {chandler: [[-2.6, -1.9]], lantern: [[3.0, -1.6]], maps: [[-2.8, -1.4]], inn: [[2.4, -2.0], [-3.4, -1.2]], tea: [[-1.8, -2.2]], garden: []};
  for (const [cx, cz] of chimneys[role]) chimney(ctx, f, cx, cz, ey + slopeY(rise, b, cz), ey + rise + .7, idx);
  if (role === 'lantern' || role === 'tea' || role === 'chandler') for (const dx of role === 'chandler' ? [1.6] : [-2.0, 2.0]) dormer(ctx, f, dx, b * .5, ey, rise, b, idx, role === 'tea' ? -1 : 1);
}

/** Stone stack through the roof: ashlar shaft, dressed cap, two teal chimney pots. */
function chimney(ctx: TownCtx, f: Frame, x: number, z: number, y0: number, y1: number, idx: number) {
  const h = y1 - y0 + .5;
  ctx.stone.add(bx(.78, h, .66, [1, 2, 1]), f.m(x, y0 - .5 + h / 2, z), C.stone, STONE.ashlar, idx + x);
  ctx.stone.add(bx(.98, .14, .86), f.m(x, y1 + .07, z), C.trim, STONE.dressed, idx);
  for (const dx of [-.18, .18]) ctx.stone.add(lath([[.12, 0], [.13, .2], [.1, .32], [.12, .36], [0, .36]], 10), f.m(x + dx, y1 + .14, z), '#2f7f7a', STONE.ceramic, idx + dx);
}

/** A dormer on the front (side = 1) or back slope: plaster cheeks, a round gilt window lit warm, a small hip roof. */
function dormer(ctx: TownCtx, f: Frame, x: number, z: number, ey: number, rise: number, b: number, idx: number, side: number) {
  const zz = z * side, yb = ey + slopeY(rise, b, z) - .35, yt = yb + 1.25, depth = 1.9, ry = side > 0 ? 0 : Math.PI;
  const dm = (lx: number, ly: number, lz: number, yaw = 0) => f.m(x + lx, ly, zz + lz * side, ry + yaw);
  ctx.stone.add(bx(1.4, yt - yb, depth), dm(0, (yb + yt) / 2, -depth / 2 + .05), C.plaster, STONE.plaster, idx);
  for (const sx of [-.7, .7]) ctx.timber.add(bx(.12, yt - yb + .05, .12), dm(sx, (yb + yt) / 2, .06), C.timber, WOOD.beam, idx);
  ctx.metal.add(ring(.34, .05), dm(0, yb + .72, .07), C.gold);
  ctx.glow.add(disc(.31, 14), dm(0, yb + .72, .06), C.glass.clone().multiplyScalar(.9));
  const r = hipRoof(1.15, .95, .6, .18, {ns: 8, nt: 5, soffit: .06, fascia: .1});
  const rm = dm(0, yt, -depth / 2 + .15, Math.PI / 2);
  ctx.roof.add(r.top, rm, C.roofB, ROOF.tiles, idx);
  ctx.timber.add(r.soffit, rm, C.timber, WOOD.planks, idx);
  ctx.timber.add(r.fascia, rm, C.timberDark, WOOD.beam, idx);
  ctx.metal.add(rod(r.ridge.map(p => p.clone().add(new V(0, .05, 0))), .06, 6), rm, C.gold);
}

/** One-storey back wing (store, kitchen) under its own low hip roof: the house reads as an L from the air. */
function backWing(ctx: TownCtx, f: Frame, w: {lx: number; lz: number; hx: number; hz: number}, idx: number) {
  const H = HOUSE.G + .5, p = f.p(w.lx, 0, w.lz), g = ctx.h(p.x, p.z) - f.y, seed = idx * 3.3;
  ctx.stone.add(bx(w.hx * 2 + .3, H - g + 1.4, w.hz * 2 + .3, [1, 2, 1]), f.m(w.lx, (H + g - 1.4) / 2 - .7 + .02, w.lz), C.rubble, STONE.rubble, seed);
  ctx.stone.add(bx(w.hx * 2, H, w.hz * 2, [1, 3, 1]), f.m(w.lx, H / 2, w.lz), C.stone, STONE.ashlar, seed);
  ctx.stone.add(bx(w.hx * 2 + .25, .18, w.hz * 2 + .25), f.m(w.lx, H, w.lz), C.trim, STONE.dressed, seed);
  // Round windows on the long sides, a plank door at the far end.
  for (const sx of [-1, 1]) for (const dz of [-w.hz * .45, w.hz * .45]) {
    ctx.metal.add(ring(.32, .05), f.m(w.lx + sx * (w.hx + .02), H * .55, w.lz + dz, sx * Math.PI / 2), C.gold);
    ctx.glow.add(disc(.29, 14), f.m(w.lx + sx * (w.hx + .01), H * .55, w.lz + dz, sx * Math.PI / 2), C.glass.clone().multiplyScalar(.8));
  }
  ctx.stone.add(archFrame(1.2, 2.2, .2, .2), f.m(w.lx, 0, w.lz - w.hz - .06, Math.PI), C.trim, STONE.dressed, seed);
  ctx.timber.add(archPanel(1.2, 2.2, .07), f.m(w.lx, 0, w.lz - w.hz - .02, Math.PI), DOORS[(idx + 2) % DOORS.length], WOOD.painted, seed);
  const a = Math.max(w.hx, w.hz) + .7, bb = Math.min(w.hx, w.hz) + .7, rise = 1.7, along = w.hz > w.hx;
  const r = hipRoof(a, bb, rise, .35, {ns: 12, nt: 6});
  const rf = f.m(w.lx, H + .12, w.lz, along ? Math.PI / 2 : 0);
  ctx.roof.add(r.top, rf, C.roof, ROOF.tiles, seed);
  ctx.timber.add(r.soffit, rf, C.timber, WOOD.planks, seed);
  ctx.timber.add(r.fascia, rf, C.timberDark, WOOD.beam, seed);
  for (const line of r.hips) ctx.roof.add(rod(line.map(q => q.clone().add(new V(0, .05, 0))), .08, 5), rf, C.cap, ROOF.cap, seed);
  ctx.metal.add(rod(r.ridge.map(q => q.clone().add(new V(0, .06, 0))), .1, 6), rf, C.gold);
  chimney(ctx, f, w.lx + w.hx * .4, w.lz - w.hz * .35, H + .12 + rise * .3, H + rise + .9, idx);
}

/**
 * The gardener's planted roof: a flat timber roof with a deep fascia, a stone parapet with dressed coping, a plank
 * deck, planters of shrubs and flowers round the edge, a pergola hung with vines and a small tiled stair hut.
 */
function roofTerrace(ctx: TownCtx, f: Frame, ux: number, uz: number, ey: number, idx: number) {
  const {stone, timber, roof, metal} = ctx, seed = idx * 2.7, A = ux + .55, B = uz + .55;
  timber.add(bx(A * 2 + .5, .32, B * 2 + .5), f.m(0, ey + .1, 0), C.timberDark, WOOD.beam, seed);
  timber.add(bx(A * 2, .08, B * 2), f.m(0, ey + .3, 0), C.timber, WOOD.planks, seed);
  for (const [w, d, x, z] of [[A * 2 + .4, .3, 0, B], [A * 2 + .4, .3, 0, -B], [.3, B * 2, A, 0], [.3, B * 2, -A, 0]] as const) {
    stone.add(bx(w, .7, d), f.m(x, ey + .6, z), C.plaster, STONE.plaster, seed);
    stone.add(bx(w + .12, .1, d + .12), f.m(x, ey + 1.0, z), C.trim, STONE.dressed, seed);
  }
  // Planters along the parapet with shrubs and flowers; a lawn bed in the middle.
  const beds: [number, number, number, number][] = [[-A + .6, -B + 1.6, .9, 2.4], [-A + .6, B - 1.8, .9, 2.0], [A - .6, -B + 1.4, .9, 2.0], [-1.2, B - .6, 3.2, .8], [2.2, -B + .6, 2.6, .8]];
  beds.forEach(([x, z, w, d], k) => {
    timber.add(bx(w, .45, d), f.m(x, ey + .55, z), C.timber, WOOD.planks, seed + k);
    stone.add(bx(w - .12, .04, d - .12), f.m(x, ey + .79, z), '#4f8f63', STONE.dressed, seed + k);
    if (!ctx.low) for (let q = 0; q < Math.max(2, Math.round(Math.max(w, d) / .8)); q++) {
      const t = (q + .5) / Math.max(2, Math.round(Math.max(w, d) / .8)) - .5, px = x + (w > d ? t * w * .85 : 0), pz = z + (w > d ? 0 : t * d * .85), p = f.p(px, ey + .8, pz);
      ctx.kits.push({file: 'nature', piece: (q + k) % 3 === 0 ? 'Flower_4_Group' : (q + k) % 3 === 1 ? 'Bush_Common_Flowers' : 'Flower_3_Group', x: p.x, y: p.y, z: p.z, yaw: f.yw(q * 1.3 + k), size: .55 + (q % 2) * .15});
    }
  });
  stone.add(bx(3.0, .06, 2.4), f.m(.6, ey + .37, .3), '#5f9a64', STONE.dressed, seed);
  // Pergola over the bench end, vines hanging from its beams.
  const px0 = .8, px1 = A - .5, pz0 = -.6, pz1 = B - .5;
  for (const [x, z] of [[px0, pz0], [px1, pz0], [px0, pz1], [px1, pz1]]) timber.add(lath([[.09, 0], [.08, 2.1], [.11, 2.2], [0, 2.22]], 6), f.m(x, ey + .34, z), C.timber, WOOD.beam, seed);
  for (const z of [pz0, pz1]) timber.add(beam(new V(px0 - .3, ey + 2.5, z), new V(px1 + .3, ey + 2.5, z), .14, .2), f.F, C.timberDark, WOOD.beam, seed);
  for (let k = 0; k <= 5; k++) { const x = px0 + (px1 - px0) * k / 5; timber.add(beam(new V(x, ey + 2.68, pz0 - .3), new V(x, ey + 2.68, pz1 + .3), .08, .12), f.F, C.timber, WOOD.beam, seed + k); }
  if (!ctx.low) for (const [x, z] of [[px0 + .4, pz0], [px1 - .6, pz1], [px0 + 1.4, pz1]]) { const p = f.p(x, ey + 2.6, z); ctx.kits.push({file: 'village', piece: x > 2 ? 'Prop_Vine2' : 'Prop_Vine4', x: p.x, y: p.y, z: p.z, yaw: f.yw(x), size: 1.5, hang: true}); }
  ctx.kits.push({file: 'props', piece: 'Bench', ...(() => { const p = f.p((px0 + px1) / 2, ey + .34, pz1 - .5); return {x: p.x, y: p.y, z: p.z}; })(), yaw: f.yw(Math.PI), size: .8});
  // Stair hut in the back corner: plaster box, round window, a small tiled hip roof with a gilt finial.
  const hx = -A + 1.3, hz = -B + 1.3;
  stone.add(bx(2.0, 2.1, 2.0), f.m(hx, ey + 1.38, hz), C.plaster, STONE.plaster, seed);
  metal.add(ring(.3, .045), f.m(hx + 1.02, ey + 1.5, hz, Math.PI / 2), C.gold);
  ctx.glow.add(disc(.27, 14), f.m(hx + 1.01, ey + 1.5, hz, Math.PI / 2), C.glass);
  const r = hipRoof(1.45, 1.45, 1.1, .3, {ns: 10, nt: 6, soffit: .08, fascia: .12}), rf = f.m(hx, ey + 2.42, hz);
  roof.add(r.top, rf, C.roof, ROOF.tiles, seed); timber.add(r.soffit, rf, C.timber, WOOD.planks, seed); timber.add(r.fascia, rf, C.timberDark, WOOD.beam, seed);
  for (const line of r.hips) roof.add(rod(line.map(q => q.clone().add(new V(0, .04, 0))), .06, 5), rf, C.cap, ROOF.cap, seed);
  metal.add(lath([[.1, 0], [.12, .08], [.05, .16], [.08, .26], [.03, .4], [0, .6]], 10), f.m(hx, ey + 3.5, hz), C.gold);
}
