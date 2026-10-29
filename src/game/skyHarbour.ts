import * as THREE from 'three';
import {SKY_AIRSHIP, SKY_CARGO, SKY_LOADING, SKY_MAST, SKY_PIER, SKY_SHEDS} from './skyTownLayout';
import {Bucket, CLOTH, Frame, M, ROOF, STONE, WOOD, atlasUv, beam, bx, clothSheet, disc, hipRoof, lath, ring, rod, sagPoints, skyMaterials, type TownCtx} from './skyTownKit';
import {hangingLantern, lanternPost, signEmblem} from './skyTown';

/*
 * The sky harbour at Skybloom's south rim: a plank boardwalk from the end of the high street through a tiled timber
 * gate, out past the cliff on piles into the cloud sea, to a pier head with bollards, a cargo crane, a signal mast
 * and lanterns; a sail-roofed cargo shed and the harbourmaster's booth stand at the boardwalk head (the only sail-cloth
 * roofs in town). The gate is low so the pier head and its ship read through it from the street; a rope closes it,
 * since gameplay heights stay on the meadow that falls away under the deck. A small airship lies moored alongside: plank hull with a painted strake and a gilt rail, a cabin
 * with its own glazed roof, a striped gas envelope with gilt bands and fins, rigging, and a turning propeller.
 */

const V = THREE.Vector3;
const C = {stone: '#e6dcc4', trim: '#efe5cd', timber: '#8a5f3a', timberDark: '#694629', deck: '#9c7048', roof: '#1f6a6e', cap: '#174f53', gold: '#d4a64a', rope: '#c2a678', plaster: '#f2eadb', paint: '#2f8f8a', glass: new THREE.Color('#ffb45e').multiplyScalar(1.35)};

export function skyHarbour(ctx: TownCtx) {
  const {h, stone, timber, metal} = ctx;
  const P = SKY_PIER, group = new THREE.Group(); group.name = 'skybloom-harbour';
  // Deck level: the boardwalk sits on the ground at the end of the street and keeps that level out over the void.
  let dy = -Infinity;
  for (let z = P.z0; z <= P.z0 + 12; z += 2) for (const x of [-P.half, 0, P.half]) dy = Math.max(dy, h(P.x + x, z));
  dy += .07;
  const solid = (x: number, z: number) => h(x, z) > dy - .6;
  // Boardwalk and pier head: planks across the walk, stringers along the sides.
  const walkLen = P.headZ - P.z0;
  timber.add(bx(P.half * 2, .14, walkLen), new THREE.Matrix4().makeTranslation(P.x, dy - .07, P.z0 + walkLen / 2), C.deck, WOOD.planks, 1);
  timber.add(bx(P.headHalf * 2, .14, P.z1 - P.headZ), new THREE.Matrix4().makeTranslation(P.x, dy - .07, (P.headZ + P.z1) / 2), C.deck, WOOD.planks, 2);
  for (const sx of [-1, 1]) {
    timber.add(beam(new V(P.x + sx * (P.half + .06), dy - .2, P.z0), new V(P.x + sx * (P.half + .06), dy - .2, P.headZ), .14, .3), null, C.timberDark, WOOD.beam, 3);
    timber.add(beam(new V(P.x + sx * (P.headHalf + .06), dy - .2, P.headZ), new V(P.x + sx * (P.headHalf + .06), dy - .2, P.z1), .14, .3), null, C.timberDark, WOOD.beam, 3);
  }
  timber.add(beam(new V(P.x - P.headHalf, dy - .2, P.z1 + .06), new V(P.x + P.headHalf, dy - .2, P.z1 + .06), .14, .3), null, C.timberDark, WOOD.beam, 3);
  timber.add(beam(new V(P.x - P.headHalf, dy - .2, P.headZ - .06), new V(P.x + P.headHalf, dy - .2, P.headZ - .06), .14, .3), null, C.timberDark, WOOD.beam, 3);
  // Stone abutment where the walk leaves the cliff; piles with iron bands and cross braces beyond it.
  let rimZ = P.z1; for (let z = P.z0; z <= P.z1; z += .5) if (!solid(P.x, z)) { rimZ = z; break; }
  stone.add(bx(P.half * 2 + 1.2, 3.2, 2.4, [1, 3, 1]), new THREE.Matrix4().makeTranslation(P.x, dy - 1.75, rimZ - 1.0), C.stone, STONE.ashlar, 4);
  stone.add(bx(P.half * 2 + 1.4, .16, 2.6), new THREE.Matrix4().makeTranslation(P.x, dy - .1, rimZ - 1.0), C.trim, STONE.dressed, 4);
  const piles: [number, number][] = [];
  for (let z = rimZ + 1.5; z < P.headZ; z += 4) for (const sx of [-1, 1]) piles.push([P.x + sx * (P.half - .1), z]);
  for (let z = P.headZ + .5; z <= P.z1; z += 4.6) for (const sx of [-1, 0, 1]) piles.push([P.x + sx * (P.headHalf - .2), z]);
  for (const [x, z] of piles) {
    const bottom = Math.max(h(x, z) - .5, dy - 18);
    timber.add(rod([new V(x, bottom, z), new V(x, dy - .1, z)], .2, 8), null, C.timberDark, WOOD.beam, x + z);
    for (const t of [.2, .55]) metal.add(new THREE.CylinderGeometry(.215, .215, .12, 10), new THREE.Matrix4().makeTranslation(x, dy - .1 - (dy - bottom) * t * .4 - .4, z), '#8a7a5a');
  }
  for (let i = 0; i + 2 < piles.length; i += 2) {
    const [ax, az] = piles[i], [bx0, bz] = piles[i + 2] ?? piles[i];
    if (Math.abs(ax - bx0) > .1 || bz - az > 6) continue;
    timber.add(beam(new V(ax, dy - .4, az), new V(bx0, dy - 3.2, bz), .12), null, C.timberDark, WOOD.beam, i);
    timber.add(beam(new V(ax, dy - 3.2, az), new V(bx0, dy - .4, bz), .12), null, C.timberDark, WOOD.beam, i + 1);
  }
  // Railing: posts and a top rail out on the pier, rope between, leaving the gangway open on the east of the head.
  const railRun = (a: THREE.Vector3, b: THREE.Vector3, gap?: [number, number]) => {
    const n = Math.max(1, Math.round(a.distanceTo(b) / 2));
    for (let k = 0; k <= n; k++) { const p = a.clone().lerp(b, k / n); if (gap && p.z > gap[0] && p.z < gap[1]) continue; timber.add(lath([[.08, 0], [.07, .9], [.1, .96], [.06, 1.06], [0, 1.08]], 6), new THREE.Matrix4().makeTranslation(p.x, dy, p.z), C.timber, WOOD.beam, k); }
    const segs: [THREE.Vector3, THREE.Vector3][] = gap ? [[a, new V(a.x, a.y, gap[0])], [new V(a.x, a.y, gap[1]), b]] : [[a, b]];
    for (const [s0, s1] of segs) { timber.add(beam(s0.clone().setY(dy + .92), s1.clone().setY(dy + .92), .1), null, C.timber, WOOD.beam, 5); timber.add(rod(sagPoints(s0.clone().setY(dy + .5), s1.clone().setY(dy + .5), .08, 8), .025, 4), null, C.rope, WOOD.beam, 6); }
  };
  for (const sx of [-1, 1]) railRun(new V(P.x + sx * P.half, 0, rimZ - 1), new V(P.x + sx * P.half, 0, P.headZ));
  railRun(new V(P.x - P.headHalf, 0, P.headZ), new V(P.x - P.headHalf, 0, P.z1));
  railRun(new V(P.x + P.headHalf, 0, P.headZ), new V(P.x + P.headHalf, 0, P.z1), [SKY_AIRSHIP.z - 1.2, SKY_AIRSHIP.z + 1.2]);
  railRun(new V(P.x - P.headHalf, 0, P.z1), new V(P.x + P.headHalf, 0, P.z1));
  for (const sx of [-1, 1]) railRun(new V(P.x + sx * P.half, 0, P.headZ), new V(P.x + sx * P.headHalf, 0, P.headZ));
  // Bollards with rope turns.
  const bollard = (x: number, z: number) => { metal.add(lath([[.2, 0], [.2, .08], [.13, .14], [.12, .42], [.2, .5], [.2, .58], [.1, .62], [0, .63]], 12), new THREE.Matrix4().makeTranslation(x, dy, z), '#5f6a6a'); metal.add(new THREE.TorusGeometry(.15, .035, 5, 14).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(x, dy + .3, z), C.rope); };
  const bol: [number, number][] = [[P.headHalf - .5, SKY_AIRSHIP.z - 5.2], [P.headHalf - .5, SKY_AIRSHIP.z + 5.2], [-P.headHalf + .5, P.z1 - 1.2], [P.half - .4, P.headZ - 6]];
  for (const [x, z] of bol) bollard(P.x + x, z);
  for (const sx of [-1, 1]) lanternPost(ctx, P.x + sx * (P.headHalf - .45), P.headZ + 1.0, sx < 0 ? 0 : Math.PI, dy);
  for (const sx of [-1, 1]) lanternPost(ctx, P.x + sx * (P.headHalf - .45), P.z1 - .5, sx < 0 ? 0 : Math.PI, dy);
  gate(ctx, P.x, P.gateZ, dy);
  for (const s of SKY_SHEDS) shed(ctx, s);
  crane(ctx, P.x - P.headHalf + 1.1, P.headZ + 5.5, dy);
  signalMast(ctx, P.x - P.headHalf + .8, P.z1 - 2.6, dy);
  // Cargo waiting by the boardwalk and on the head.
  for (const c of SKY_CARGO) {
    const y = h(c.x, c.z), s = Math.sign(c.x);
    ctx.kits.push({file: 'props', piece: 'Crate_Wooden', x: c.x, y, z: c.z - .5, yaw: .2, size: .95}, {file: 'props', piece: 'Crate_Wooden', x: c.x + s * .3, y: y + .95, z: c.z - .45, yaw: -.3, size: .75},
      {file: 'props', piece: 'Barrel', x: c.x - s * .2, y, z: c.z + .9, yaw: 0, size: 1.0}, {file: 'props', piece: 'Bag', x: c.x + s * .8, y, z: c.z + .3, yaw: 1, size: .65}, {file: 'props', piece: 'Rope_2', x: c.x - s * .9, y, z: c.z - .7, yaw: 0, size: .22});
  }
  ctx.kits.push({file: 'props', piece: 'Crate_Wooden', x: P.x + 3.6, y: dy, z: P.headZ + 2.2, yaw: .4, size: .8}, {file: 'props', piece: 'Barrel', x: P.x + 4.2, y: dy, z: P.headZ + 3.4, yaw: 0, size: .9},
    {file: 'props', piece: 'Bag', x: P.x + 3.4, y: dy, z: P.headZ + 3.2, yaw: 2, size: .6}, {file: 'props', piece: 'Bench', x: P.x - 2.2, y: dy, z: P.z1 - .9, yaw: 0, size: .85});
  const ship = airship(ctx, SKY_AIRSHIP.x, dy, SKY_AIRSHIP.z);
  const moored = mooringMast(ctx, SKY_MAST.x, SKY_MAST.z, SKY_MAST.height);
  group.add(ship.prop, moored.prop);
  ctx.stats.harbourPiles = piles.length;
  return {group, update(time: number) { ship.turn(time); moored.turn(time * .8 + 1); }};
}

/** Timber gate over the boardwalk: turned posts on stone feet, lintel and tie beam, a small glazed roof, sign. */
function gate(ctx: TownCtx, x: number, z: number, dy: number) {
  const {h, stone, timber, metal, roof} = ctx;
  for (const sx of [-1, 1]) {
    const px = x + sx * 3.25, y = h(px, z) - .1;
    stone.add(lath([[.42, -.3], [.42, .3], [.32, .4], [.3, .7], [.34, .76], [.26, .82], [0, .82]], 10), new THREE.Matrix4().makeTranslation(px, y, z), C.trim, STONE.dressed, sx);
    timber.add(lath([[.2, 0], [.18, .4], [.16, 2.1], [.2, 2.2], [.16, 2.3], [.16, 2.7], [0, 2.7]], 10), new THREE.Matrix4().makeTranslation(px, y + .8, z), C.timber, WOOD.beam, sx);
    for (const cy of [1.2, 2.25]) metal.add(new THREE.CylinderGeometry(.19, .19, .08, 12), new THREE.Matrix4().makeTranslation(px, y + .8 + cy, z), C.gold);
  }
  const top = dy + 3.3;
  timber.add(beam(new V(x - 4.3, top, z), new V(x + 4.3, top, z), .34, .42), null, C.timberDark, WOOD.beam, 7);
  timber.add(beam(new V(x - 3.4, top - .62, z), new V(x + 3.4, top - .62, z), .2, .24), null, C.timber, WOOD.beam, 8);
  for (const sx of [-1, 1]) timber.add(beam(new V(x + sx * 3.25, top - 1.3, z), new V(x + sx * 2.4, top - .62, z), .13), null, C.timber, WOOD.beam, 9);
  const r = hipRoof(4.75, .95, .62, .42, {ns: 16, nt: 5, soffit: .1, fascia: .14});
  const rf = new THREE.Matrix4().makeTranslation(x, top + .24, z);
  roof.add(r.top, rf, C.roof, ROOF.tiles, 9);
  timber.add(r.soffit, rf, C.timber, WOOD.planks, 9);
  timber.add(r.fascia, rf, C.timberDark, WOOD.beam, 9);
  for (const line of r.hips) roof.add(rod(line.map(p => p.clone().add(new V(0, .05, 0))), .08, 5), rf, C.cap, ROOF.cap, 9);
  metal.add(rod(r.ridge.map(p => p.clone().add(new V(0, .06, 0))), .11, 8), rf, C.gold);
  for (const p of r.ridge) metal.add(lath([[.12, 0], [.15, .08], [.06, .18], [.09, .28], [.03, .42], [0, .62]], 10), new THREE.Matrix4().makeTranslation(x + p.x, top + .24 + p.y, z), C.gold);
  // Sign under the tie beam: the harbour's airship emblem on both faces.
  timber.add(bx(1.3, .56, .07), new THREE.Matrix4().makeTranslation(x, top - 1.12, z), C.timberDark, WOOD.planks, 3);
  for (const sx of [-.48, .48]) timber.add(new THREE.CylinderGeometry(.01, .01, .2, 3), new THREE.Matrix4().makeTranslation(x + sx, top - .76, z), C.rope, WOOD.beam, 0);
  signEmblem(ctx, new THREE.Matrix4().makeTranslation(x, top - 1.12, z).multiply(new THREE.Matrix4().makeScale(1.1, 1.1, 1)), 'chandler', .045);
  metal.add(bx(1.36, .05, .1), new THREE.Matrix4().makeTranslation(x, top - .83, z), C.gold);
  for (const sx of [-1, 1]) { metal.add(rod([new V(x + sx * 3.9, top - .2, z), new V(x + sx * 3.9, top - .4, z)], .02, 4), null, C.gold); hangingLantern(ctx, new THREE.Matrix4().makeTranslation(x + sx * 3.9, top - .4, z), 1.0); }
  // The boarding rope across the gate: brass rings on the posts, a thick sagging rope with a tassel.
  { const g0 = h(x, z) - .1, a = new V(x - 3.05, g0 + 1.25, z), b = new V(x + 3.05, g0 + 1.25, z);
    for (const p of [a, b]) metal.add(ring(.09, .025, 10), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z), C.gold);
    timber.add(rod(sagPoints(a, b, .32, 12), .045, 6), null, '#a4262a', WOOD.beam, 0);
    metal.add(lath([[.0, 0], [.05, -.04], [.06, -.12], [.03, -.3], [0, -.32]], 8), new THREE.Matrix4().makeTranslation(x, g0 + .92, z), C.gold); }
}

/** Cargo crane: stone foot, mast, a jib over the cloud side, pulley, rope and a net of sacks; winch drum below. */
function crane(ctx: TownCtx, x: number, z: number, dy: number) {
  const {stone, timber, metal} = ctx;
  stone.add(bx(1.1, .5, 1.1), new THREE.Matrix4().makeTranslation(x, dy + .25, z), C.trim, STONE.dressed, 11);
  timber.add(beam(new V(x, dy + .5, z), new V(x, dy + 5.6, z), .28), null, C.timberDark, WOOD.beam, 11);
  const tip = new V(x - 4.6, dy + 6.0, z);
  timber.add(beam(new V(x + .4, dy + 5.2, z), tip, .22, .26), null, C.timberDark, WOOD.beam, 12);
  timber.add(beam(new V(x, dy + 3.2, z), new V(x - 2.4, dy + 5.4, z), .14), null, C.timber, WOOD.beam, 13);
  metal.add(ring(.18, .05, 12), new THREE.Matrix4().makeTranslation(tip.x + .1, tip.y - .3, z), C.gold);
  timber.add(rod([new V(tip.x + .1, tip.y - .45, z), new V(tip.x + .1, dy + 2.4, z)], .02, 4), null, C.rope, WOOD.beam, 0);
  timber.add(rod([new V(x + .2, dy + 5.4, z), tip.clone().add(new V(.2, -.2, 0))], .018, 4), null, C.rope, WOOD.beam, 0);
  for (const [k, piece, s] of [[0, 'Bag', .7], [1, 'Bag', .6], [2, 'Crate_Wooden', .6]] as const) ctx.kits.push({file: 'props', piece, x: tip.x + .1 + (k - 1) * .35, y: dy + 1.4 + (k % 2) * .2, z: z + (k - 1) * .2, yaw: k, size: s});
  timber.add(new THREE.SphereGeometry(.62, 10, 8, 0, Math.PI * 2, Math.PI * .35, Math.PI * .65), new THREE.Matrix4().makeTranslation(tip.x + .1, dy + 2.4, z), C.rope, WOOD.beam, 0);
  timber.add(new THREE.CylinderGeometry(.3, .3, .8, 12).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(x + .75, dy + .85, z), C.timber, WOOD.beam, 14);
  for (const sx of [-.42, .42]) metal.add(new THREE.CylinderGeometry(.34, .34, .05, 12).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(x + .75 + sx, dy + .85, z), C.gold);
}

/** Signal mast at the pier head: a yard with two pennants and a striped wind sock. */
function signalMast(ctx: TownCtx, x: number, z: number, dy: number) {
  const {timber, metal, cloth} = ctx;
  timber.add(lath([[.12, 0], [.1, 3], [.06, 8.2], [0, 8.2]], 8), new THREE.Matrix4().makeTranslation(x, dy, z), C.timber, WOOD.beam, 21);
  metal.add(new THREE.SphereGeometry(.12, 10, 8), new THREE.Matrix4().makeTranslation(x, dy + 8.3, z), C.gold);
  timber.add(beam(new V(x, dy + 7.1, z - 1.3), new V(x, dy + 7.1, z + 1.3), .08), null, C.timber, WOOD.beam, 22);
  for (const sz of [-1.2, 1.2]) cloth.add(clothSheet(.9, 1.5, CLOTH.banner, {nx: 3, ny: 8, tail: .5}), new THREE.Matrix4().makeTranslation(x, dy + 7.05, z + sz).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), '#ffffff', 1, sz);
  // Wind sock: a tapered striped cone off a gilt hoop, streaming east.
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], n = 12, m = 6;
  for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) { const t = j / m, a = i / n * Math.PI * 2, r = .3 * (1 - t * .55); pos.push(t * 1.9, Math.cos(a) * r - t * .25, Math.sin(a) * r); uv.push(...atlasUv(CLOTH.awning, t, i / n)); }
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const k = j * (n + 1) + i; idx.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2); }
  const sock = new THREE.BufferGeometry(); sock.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sock.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sock.setIndex(idx); sock.computeVertexNormals();
  cloth.add(sock, new THREE.Matrix4().makeTranslation(x + .15, dy + 6.2, z), '#ffffff', .35, 3);
  metal.add(ring(.3, .025, 14).rotateY(Math.PI / 2), new THREE.Matrix4().makeTranslation(x + .15, dy + 6.2, z), C.gold);
  metal.add(beam(new V(x, dy + 6.2, z), new V(x + .15, dy + 6.2, z), .04), null, C.gold);
}

/** The moored airship; the propeller is its own small mesh so it can turn. */
/** Airship with its hull gunwale origin at (x, dy + .5, z), bow along the yawed +z; `pier` adds the gangplank and lines. */
export function airship(ctx: TownCtx, x: number, dy: number, z: number, yaw = 0, pier = true) {
  const {timber, metal, cloth, stone, roof, glow} = ctx;
  const L = 13, W = 2.0, D = 2.1, top0 = dy + .5;
  const half = (zz: number) => Math.max(.04, Math.pow(Math.max(0, 1 - Math.pow(Math.abs(zz) / (L / 2), zz > 0 ? 2.4 : 3.2)), .5));
  const sheer = (zz: number) => .45 * Math.pow(zz / (L / 2), 2);
  const hullGeo = (p0: number, p1: number, grow: number) => {
    const nz = 40, np = 14, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= np; i++) {
      const zz = -L / 2 + L * j / nz, f = half(zz), ph = p0 + (p1 - p0) * i / np;
      pos.push(Math.cos(ph) * W * f * grow, sheer(zz) - Math.sin(ph) * D * Math.pow(f, .8) * grow, zz);
      uv.push(zz, ph * 1.6);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < np; i++) { const k = j * (np + 1) + i; idx.push(k, k + 1, k + np + 1, k + 1, k + np + 2, k + np + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const S = M(x, top0, z, yaw);
  timber.add(hullGeo(0, Math.PI, 1), S, C.timber, WOOD.planks, 31);
  for (const [a, b] of [[0, .32], [Math.PI - .32, Math.PI]]) timber.add(hullGeo(a, b, 1.012), S, C.paint, WOOD.painted, 32);
  // Deck, gilt rail along both gunwales, bowsprit with a figurehead finial and a lantern.
  { const nz = 20, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= nz; j++) { const zz = -L / 2 + .3 + (L - .6) * j / nz, f = half(zz) * W * .97; for (const sx of [-1, 1]) { pos.push(sx * f, sheer(zz) - .12, zz); uv.push(zz, sx * f); } }
    for (let j = 0; j < nz; j++) { const k = j * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if ((g.getAttribute('normal') as THREE.BufferAttribute).getY(0) < 0) { const ix = idx.slice(); for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 1]; ix[i + 1] = t; } g.setIndex(ix); g.computeVertexNormals(); }
    timber.add(g, S, C.deck, WOOD.planks, 33); }
  for (const sx of [-1, 1]) { const pts: THREE.Vector3[] = []; for (let j = 0; j <= 24; j++) { const zz = -L / 2 + .2 + (L - .4) * j / 24; pts.push(new V(sx * half(zz) * W * 1.01, sheer(zz) + .06, zz)); } metal.add(rod(pts, .06, 6), S, C.gold); }
  const bow = new V(0, sheer(L / 2) + .1, L / 2 - .1);
  timber.add(rod([bow, bow.clone().add(new V(0, .55, 1.8))], t => .09 * (1 - t * .5), 6), S, C.timberDark, WOOD.beam, 34);
  metal.add(lath([[.12, 0], [.16, .1], [.07, .25], [.1, .36], [0, .6]], 10), S.clone().multiply(new THREE.Matrix4().makeTranslation(bow.x, bow.y + .55, bow.z + 1.8)).multiply(new THREE.Matrix4().makeRotationX(1.2)), C.gold);
  hangingLantern(ctx, S.clone().multiply(new THREE.Matrix4().makeTranslation(0, bow.y + .42, bow.z + 1.35)), .9);
  // Stern cabin: plaster walls, round windows, its own tiled hip roof.
  const cz = -L / 2 + 3.1;
  stone.add(bx(2.3, 1.7, 3.0), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(cz) + .72, cz)), C.plaster, STONE.plaster, 35);
  for (const sx of [-1, 1]) for (const wz of [-.7, .7]) { metal.add(ring(.26, .04, 16), S.clone().multiply(new THREE.Matrix4().makeTranslation(sx * 1.17, sheer(cz) + .95, cz + wz)).multiply(new THREE.Matrix4().makeRotationY(sx * Math.PI / 2)), C.gold); glow.add(disc(.24, 14), S.clone().multiply(new THREE.Matrix4().makeTranslation(sx * 1.16, sheer(cz) + .95, cz + wz)).multiply(new THREE.Matrix4().makeRotationY(sx * Math.PI / 2)), C.glass); }
  timber.add(bx(.8, 1.3, .06), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(cz) + .55, cz + 1.52)), C.paint, WOOD.painted, 36);
  const cr = hipRoof(1.95, 1.55, .8, .35, {ns: 10, nt: 6, soffit: .08, fascia: .12});
  const crm = S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(cz) + 1.58, cz)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  roof.add(cr.top, crm, C.roof, ROOF.tiles, 37); timber.add(cr.soffit, crm, C.timber, WOOD.planks, 37); timber.add(cr.fascia, crm, C.timberDark, WOOD.beam, 37);
  for (const line of cr.hips) roof.add(rod(line.map(p => p.clone().add(new V(0, .04, 0))), .06, 5), crm, C.cap, ROOF.cap, 37);
  // Envelope: a striped spindle in three gore panels (12 stripes round), gilt bands, four fins.
  const EL = 17, ER = 3.2, ey = 7.6, ez = -.3;
  const er = (t: number) => Math.max(.06, ER * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), .62) * (1 - .12 * t));
  for (let seg = 0; seg < 3; seg++) {
    const nt = 32, na = 10, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= nt; j++) for (let i = 0; i <= na; i++) {
      const t = j / nt, a = (seg + i / na) / 3 * Math.PI * 2, r = er(t);
      pos.push(Math.cos(a) * r, Math.sin(a) * r, (t - .5) * EL); uv.push(...atlasUv(CLOTH.sail, i / na, t));
    }
    for (let j = 0; j < nt; j++) for (let i = 0; i < na; i++) { const k = j * (na + 1) + i; idx.push(k, k + 1, k + na + 1, k + 1, k + na + 2, k + na + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    cloth.add(g, S.clone().multiply(new THREE.Matrix4().makeTranslation(0, ey, ez)), '#ffffff', 0, seg);
  }
  for (const t of [.12, .5, .86]) { const r = er(t); metal.add(new THREE.TorusGeometry(r + .02, .07, 6, 40), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, ey, ez + (t - .5) * EL)), C.gold); }
  metal.add(new THREE.SphereGeometry(.28, 10, 8), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, ey, ez + EL / 2 - .05)), C.gold);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4, fin = new THREE.BufferGeometry();
    const fp = [0, 0, 0, 0, 0, 3.0, 1.9, 0, -.4, 1.5, 0, 2.2];
    fin.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fin.setIndex([0, 1, 2, 1, 3, 2]);
    fin.setAttribute('uv', new THREE.Float32BufferAttribute([...atlasUv(CLOTH.banner, .1, .1), ...atlasUv(CLOTH.banner, .1, .9), ...atlasUv(CLOTH.banner, .9, .1), ...atlasUv(CLOTH.banner, .9, .8)], 2)); fin.computeVertexNormals();
    const r0 = er(.1) * .85;
    cloth.add(fin, S.clone().multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * r0, ey + Math.sin(a) * r0, ez - EL / 2 + 1.0)).multiply(new THREE.Matrix4().makeRotationZ(a)), '#ffffff', 0, k);
  }
  // Struts from the gunwale to the envelope keel and rope rigging between them.
  for (const zz of [-3.4, 2.6]) for (const sx of [-1, 1]) {
    const a = new V(sx * half(zz) * W * .9, sheer(zz) + .05, zz), b = new V(sx * .7, ey - er((zz - ez) / EL + .5) * .92, zz * .9);
    timber.add(beam(a, b, .1), S, C.timberDark, WOOD.beam, 38);
  }
  for (let k = 0; k < 7; k++) for (const sx of [-1, 1]) {
    const zz = -L / 2 + 1.4 + k * 1.7, t = (zz * 1.15 - ez) / EL + .5;
    const a = new V(sx * half(zz) * W, sheer(zz) + .08, zz), b = new V(sx * er(t) * .55, ey - er(t) * .83, zz * 1.15);
    timber.add(rod([a, b], .018, 3), S, C.rope, WOOD.beam, 0);
  }
  for (const zz of [-4.8, 4.2]) hangingLantern(ctx, S.clone().multiply(new THREE.Matrix4().makeTranslation(W * half(zz) * .2, ey - er((zz - ez) / EL + .5) * .98, zz)), .9);
  // Gangplank to the pier head and mooring lines to the bollards.
  if (pier) {
  const pierEdge = SKY_PIER.x + SKY_PIER.headHalf, gw = x - half(0) * W + .1;
  timber.add(bx(gw - pierEdge + .6, .08, 1.0), new THREE.Matrix4().makeTranslation((gw + pierEdge) / 2, dy + .2, z), C.deck, WOOD.planks, 39);
  for (const sz of [-.5, .5]) timber.add(rod(sagPoints(new V(pierEdge - .1, dy + 1.0, z + sz * 2.4), new V(gw, top0 + .9, z + sz), .1, 6), .02, 3), null, C.rope, WOOD.beam, 0);
  for (const s of [-1, 1]) { const bz = SKY_AIRSHIP.z + s * 5.2; timber.add(rod(sagPoints(new V(pierEdge - .5, dy + .35, bz), new V(x - half(s * 4.6) * W, top0 + sheer(s * 4.6), z + s * 4.6), .35, 8), .03, 4), null, C.rope, WOOD.beam, 0); }
  }
  // Propeller at the stern: its own mesh (gilt hub, three honey blades) so it turns.
  const pb = new Bucket(ctx.h);
  pb.add(lath([[.16, -.2], [.2, 0], [.14, .2], [0, .26]], 10).rotateX(Math.PI / 2), null, C.gold, WOOD.beam, 0);
  for (let k = 0; k < 3; k++) pb.add(lath([[.0, 0], [.1, .1], [.15, .7], [.09, 1.3], [0, 1.36]], 6).scale(1, 1, .25), new THREE.Matrix4().makeRotationZ(k * Math.PI * 2 / 3 + .2), C.timber, WOOD.beam, k);
  const prop = pb.mesh(skyMaterials().timber, 'skybloom-airship-propeller')!;
  const hub = S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(-L / 2) - .55, -L / 2 - .25)), spin = new THREE.Matrix4();
  prop.matrix.copy(hub); prop.matrixWorldNeedsUpdate = true;
  timber.add(beam(new V(0, sheer(-L / 2) - .55, -L / 2 + .7), new V(0, sheer(-L / 2) - .55, -L / 2 - .1), .14), S, C.timberDark, WOOD.beam, 40);
  // A pennant streaming from the stern post.
  timber.add(lath([[.05, 0], [.04, 2.2], [0, 2.25]], 6), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(-L / 2 + .6), -L / 2 + .6)), C.timber, WOOD.beam, 41);
  cloth.add(clothSheet(.5, 1.6, CLOTH.banner, {nx: 2, ny: 8, tail: .3}), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(-L / 2 + .6) + 2.15, -L / 2 + .6)).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + .25)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), '#ffffff', 1, 7);
  ctx.stats.airship = 1;
  return {prop, nose: new V(0, 7.6, -.3 + 8.5 + .3).applyMatrix4(S), turn(time: number) { prop.matrix.multiplyMatrices(hub, spin.makeRotationZ(time * 2.4)); prop.matrixWorldNeedsUpdate = true; }};
}

/** Lattice mooring mast: stone foot, four tapering legs with ring beams and braces, a roofed platform at the top
 * with a gilt coupling; an airship rides from it, bow on, its envelope nose in the cup. */
function mooringMast(ctx: TownCtx, x: number, z: number, H: number) {
  const {h, stone, timber, metal, roof} = ctx;
  const y0 = h(x, z), b = 1.7, t = .6;
  stone.add(bx(4.2, 1.6, 4.2, [1, 2, 1]), new THREE.Matrix4().makeTranslation(x, y0 - .45, z), C.stone, STONE.ashlar, 51);
  stone.add(bx(4.4, .16, 4.4), new THREE.Matrix4().makeTranslation(x, y0 + .38, z), C.trim, STONE.dressed, 51);
  const leg = (sx: number, sz: number, f: number) => new V(x + sx * (b + (t - b) * f), y0 + .4 + (H - .4) * f, z + sz * (b + (t - b) * f));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) timber.add(beam(leg(sx, sz, 0), leg(sx, sz, 1), .26), null, C.timberDark, WOOD.beam, 52);
  const levels = 7;
  for (let k = 1; k <= levels; k++) {
    const f0 = (k - 1) / levels, f1 = k / levels;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c], [bx0, bz] = corners[(c + 1) % 4];
      timber.add(beam(leg(ax, az, f1), leg(bx0, bz, f1), .14), null, C.timber, WOOD.beam, 53 + k);
      if (k % 2 || c % 2) timber.add(beam(leg(ax, az, f0), leg(bx0, bz, f1), .09), null, C.timber, WOOD.beam, 60 + k);
    }
  }
  // Platform with a rail, four posts carrying a small swept roof, the coupling cup facing the ship.
  const top = y0 + H;
  timber.add(bx(2.8, .16, 2.8), new THREE.Matrix4().makeTranslation(x, top + .08, z), C.deck, WOOD.planks, 70);
  for (const [sx, sz] of corners) timber.add(lath([[.07, 0], [.07, 2.2], [0, 2.2]], 6), new THREE.Matrix4().makeTranslation(x + sx * 1.25, top + .16, z + sz * 1.25), C.timber, WOOD.beam, 71);
  for (let c = 0; c < 4; c++) { const [ax, az] = corners[c], [bx0, bz] = corners[(c + 1) % 4]; timber.add(beam(new V(x + ax * 1.3, top + 1.1, z + az * 1.3), new V(x + bx0 * 1.3, top + 1.1, z + bz * 1.3), .08), null, C.timber, WOOD.beam, 72); }
  const r = hipRoof(1.95, 1.95, 1.3, .35, {ns: 10, nt: 6, soffit: .08, fascia: .12});
  const rf = new THREE.Matrix4().makeTranslation(x, top + 2.36, z);
  roof.add(r.top, rf, C.roof, ROOF.tiles, 73); timber.add(r.soffit, rf, C.timber, WOOD.planks, 73); timber.add(r.fascia, rf, C.timberDark, WOOD.beam, 73);
  for (const line of r.hips) roof.add(rod(line.map(p => p.clone().add(new V(0, .05, 0))), .07, 5), rf, C.cap, ROOF.cap, 73);
  metal.add(lath([[.12, 0], [.15, .1], [.05, .25], [.09, .4], [.03, .6], [0, 1.1]], 10), new THREE.Matrix4().makeTranslation(x, top + 3.66, z), C.gold);
  const cup = new V(x + 1.6, top + 1.0, z);
  metal.add(beam(new V(x + .9, top + 1.0, z), cup, .12), null, C.gold);
  metal.add(lath([[.08, 0], [.16, .06], [.42, .3], [.46, .36], [.4, .36], [.14, .1], [0, .08]], 14).rotateZ(-Math.PI / 2), new THREE.Matrix4().makeTranslation(cup.x, cup.y, cup.z), C.gold);
  hangingLantern(ctx, new THREE.Matrix4().makeTranslation(x - 1.0, top + 2.1, z + 1.0), 1);
  // The ship: bow toward the mast (-x), envelope nose seated in the cup.
  const ship = airship(ctx, cup.x + 8.5, top + 1.0 - 7.6 - .5, z, -Math.PI / 2, false);
  loading(ctx, x, z, y0, top, cup.x + 8.5, top + 1.0 - 7.6, z);
  ctx.stats.mast = 1;
  return ship;
}

/**
 * The mast's ship taking on cargo, on the side the town sees: a timber loading stage on the grass with steps, crates
 * and a sack on it, a cleated gangway with rope rails up to the deck, and a derrick on the mast whose boom swings a
 * crate in a rope sling over the gunwale. (mx, mz, y0, top): the mast's foot and platform; (sx, deck, sz): the ship's
 * centre and gunwale height (airship(): bow along -x, beam along z, half-width 2 at mid-ship).
 */
function loading(ctx: TownCtx, mx: number, mz: number, y0: number, top: number, sx: number, deck: number, sz: number) {
  const {h, timber, metal} = ctx, L = SKY_LOADING;
  const g = h(L.x, L.z), sy = g + L.deck;
  // Stage: plank deck on posts with braces, three steps down on the south side.
  timber.add(bx(L.hx * 2, .14, L.hz * 2), new THREE.Matrix4().makeTranslation(L.x, sy - .07, L.z), C.deck, WOOD.planks, 81);
  for (const ox of [-1, 1]) for (const oz of [-1, 1]) {
    const px = L.x + ox * (L.hx - .15), pz = L.z + oz * (L.hz - .15);
    timber.add(beam(new V(px, h(px, pz) - .3, pz), new V(px, sy - .1, pz), .2), null, C.timberDark, WOOD.beam, 82 + ox + oz);
  }
  for (const oz of [-1, 1]) timber.add(beam(new V(L.x - L.hx + .15, h(L.x, L.z) + .1, L.z + oz * (L.hz - .15)), new V(L.x + L.hx - .15, sy - .25, L.z + oz * (L.hz - .15)), .1), null, C.timberDark, WOOD.beam, 86);
  for (let k = 0; k < 3; k++) { const sy0 = g + L.deck * (k + 1) / 4, zz = L.z + L.hz + .3 + (2 - k) * .32; timber.add(bx(1.3, .1, .34), new THREE.Matrix4().makeTranslation(L.x - .6, sy0, zz), C.deck, WOOD.planks, 87 + k); timber.add(beam(new V(L.x - .6, h(L.x - .6, zz) - .2, zz), new V(L.x - .6, sy0 - .05, zz), .12), null, C.timberDark, WOOD.beam, 90); }
  ctx.kits.push({file: 'props', piece: 'Crate_Wooden', x: L.x + .8, y: sy, z: L.z - .3, yaw: .35, size: .9}, {file: 'props', piece: 'Crate_Wooden', x: L.x + .9, y: sy + .9, z: L.z - .35, yaw: .1, size: .7},
    {file: 'props', piece: 'Bag', x: L.x + .2, y: sy, z: L.z + .6, yaw: 1.4, size: .7}, {file: 'props', piece: 'Barrel', x: L.x - 1.1, y: sy, z: L.z - .6, yaw: 0, size: .85});
  // Gangway from the stage's north edge up to the gunwale amidships, cleats across, rope rails on posts.
  const gx = L.x - .5, half = (zz: number) => Math.max(.04, Math.pow(Math.max(0, 1 - Math.pow(Math.abs(zz) / 6.5, zz > 0 ? 2.4 : 3.2)), .5));
  const lz = sx - gx, gun = sz + 2.0 * half(lz) + .05, foot = new V(gx, sy + .02, L.z - L.hz + .2), head = new V(gx, deck + .45 * Math.pow(lz / 6.5, 2) + .05, gun - .1);
  timber.add(beam(foot, head, 1.0, .09), null, C.deck, WOOD.planks, 91);
  const run = head.clone().sub(foot), n = Math.floor(run.length() / .42);
  for (let k = 1; k < n; k++) { const p = foot.clone().addScaledVector(run, k / n).add(new V(0, .06, 0)); timber.add(beam(p.clone().add(new V(-.48, 0, 0)), p.clone().add(new V(.48, 0, 0)), .06, .05), null, C.timberDark, WOOD.beam, 92); }
  for (const ox of [-.5, .5]) {
    const posts = [0, .5, 1].map(t => foot.clone().addScaledVector(run, t).add(new V(ox, 0, 0)));
    for (const p of posts) timber.add(beam(p, p.clone().add(new V(0, .95, 0)), .07), null, C.timber, WOOD.beam, 93);
    timber.add(rod(sagPoints(posts[0].clone().add(new V(0, .9, 0)), posts[2].clone().add(new V(0, .9, 0)), .12, 10), .03, 4), null, C.rope, WOOD.beam, 0);
  }
  // Derrick: a boom from the mast's south-east leg out over the bow quarter, a topping lift to the platform, and a
  // crate in a rope sling hanging from its tip just outboard of the gunwale, on its way down onto the deck.
  const pivot = new V(mx + 1.05, y0 + 5.2, mz + 1.05), tip = new V(sx - 3.6, top - .4, sz + 3.1);
  timber.add(beam(pivot, tip, .2), null, C.timberDark, WOOD.beam, 94);
  metal.add(beam(pivot.clone().add(new V(-.1, -.15, -.1)), pivot.clone().add(new V(.25, .15, .25)), .09), null, C.gold);
  timber.add(rod(sagPoints(tip, new V(mx + .4, top + 1.05, mz + .4), .15, 8), .035, 4), null, C.rope, WOOD.beam, 0);
  metal.add(new THREE.SphereGeometry(.14, 10, 8), new THREE.Matrix4().makeTranslation(tip.x, tip.y - .1, tip.z), C.gold);
  const hook = new V(tip.x, deck + 2.5, tip.z), cr = new V(tip.x, deck + 1.05, tip.z);
  timber.add(rod([tip, hook], .03, 4), null, C.rope, WOOD.beam, 0);
  metal.add(ring(.12, .03, 12), new THREE.Matrix4().makeTranslation(hook.x, hook.y - .1, hook.z), C.gold);
  ctx.kits.push({file: 'props', piece: 'Crate_Wooden', x: cr.x, y: cr.y, z: cr.z, yaw: .5, size: .85});
  // The sling: four ropes from the hook to the crate's top corners and a lash round it.
  const c = Math.cos(.5), s = Math.sin(.5), q = .42, ct = cr.y + .86;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) timber.add(rod([hook.clone().add(new V(0, -.18, 0)), new V(cr.x + (a * c + b * s) * q, ct, cr.z + (-a * s + b * c) * q)], .022, 3), null, C.rope, WOOD.beam, 0);
  // Back on the stage a second sling waits, slack, round the barrel.
  timber.add(rod(sagPoints(new V(L.x - 1.1, sy + 1.05, L.z - .6), new V(L.x - .2, sy + .05, L.z - .9), .25, 8), .025, 3), null, C.rope, WOOD.beam, 0);
  void h(mx, mz);
}

/**
 * Sail-roofed harbour building: stone feet and sill, timber posts and plates, plank back and side walls, a gable of
 * striped sail cloth laced over a ridge pole with rope ties, and inside it either stacked cargo (shed) or a counter
 * with ledgers under a lantern (booth). Local +z faces the boardwalk side.
 */
function shed(ctx: TownCtx, s: (typeof SKY_SHEDS)[number]) {
  const {h, stone, timber, metal, cloth} = ctx, {hx, hz} = s;
  let base = -Infinity, low = Infinity;
  for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = i * (hx + .3), lz = j * (hz + .3); const y = h(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c); base = Math.max(base, y); low = Math.min(low, y); }
  const f = new Frame(s.x, base + .2, s.z, s.yaw), seed = s.x * 3.1, booth = s.kind === 'booth';
  const wallH = booth ? 2.3 : 2.6, ridge = wallH + (booth ? 1.15 : 1.45);
  // Plinth: dressed stone sill over rubble down into the ground.
  stone.add(bx(hx * 2 + .4, base - low + .7, hz * 2 + .4, [1, 2, 1]), f.m(0, -(base - low + .7) / 2 + .02, 0), '#c4b694', STONE.rubble, seed);
  stone.add(bx(hx * 2 + .5, .12, hz * 2 + .5), f.m(0, .06, 0), C.trim, STONE.dressed, seed);
  const corners: [number, number][] = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  for (const [px, pz] of corners) timber.add(lath([[.15, 0], [.13, .3], [.12, wallH - .2], [.15, wallH - .1], [0, wallH]], 8), f.m(px, .1, pz), C.timber, WOOD.beam, seed + px);
  if (!booth) for (const px of [-hx / 3, hx / 3]) timber.add(lath([[.12, 0], [.11, wallH - .1], [0, wallH]], 8), f.m(px, .1, hz), C.timber, WOOD.beam, seed + px);
  for (const pz of [-hz, hz]) timber.add(beam(new V(-hx - .25, wallH, pz), new V(hx + .25, wallH, pz), .2, .24), f.F, C.timberDark, WOOD.beam, seed);
  for (const px of [-hx, hx]) timber.add(beam(new V(px, wallH, -hz - .2), new V(px, wallH, hz + .2), .18, .22), f.F, C.timberDark, WOOD.beam, seed);
  // Back wall of planks (booth: stone up to the counter on the front too, plastered above the back).
  timber.add(bx(hx * 2, wallH - .2, .1), f.m(0, (wallH - .2) / 2 + .14, -hz + .02), C.timber, WOOD.planks, seed);
  if (booth) for (const sx of [-1, 1]) timber.add(bx(.1, wallH - .2, hz * 2 - .2), f.m(sx * (hx - .02), (wallH - .2) / 2 + .14, 0), C.timber, WOOD.planks, seed + sx);
  // The shed's ends stay open above a low plank rail, so its cargo reads from the street and the pier.
  else for (const sx of [-1, 1]) for (const ry of [.55, 1.0]) timber.add(bx(.08, .12, hz * 2 - .2), f.m(sx * (hx - .02), ry, 0), C.timberDark, WOOD.beam, seed + sx);
  // Gable: king posts, ridge pole, two sail-cloth slopes lapping past the eaves, rope lacing at the gable ends.
  for (const px of [-hx - .15, hx + .15]) timber.add(beam(new V(px, wallH - .05, 0), new V(px, ridge + .05, 0), .14), f.F, C.timberDark, WOOD.beam, seed);
  timber.add(rod([new V(-hx - .55, ridge, 0), new V(hx + .55, ridge, 0)], .1, 8), f.F, C.timberDark, WOOD.beam, seed);
  const run = hz + .55, th = Math.atan2(ridge - wallH + .25, run), slope = Math.hypot(run, ridge - wallH + .25);
  for (const side of [0, Math.PI]) cloth.add(clothSheet(hx * 2 + 1.0, slope, CLOTH.sail, {nx: 12, ny: 6, sag: -.2}), f.m(0, ridge + .06, 0, side, th - Math.PI / 2), '#ffffff', .04, seed + side);
  for (const px of [-hx - .45, hx + .45]) for (const sz of [-1, 1]) timber.add(rod([new V(px, ridge - .02, 0), new V(px, wallH - .15, sz * (hz + .45))], .015, 3), f.F, C.rope, WOOD.beam, 0);
  for (const px of [-hx - .55, hx + .55]) metal.add(new THREE.SphereGeometry(.1, 8, 6), f.m(px, ridge, 0), C.gold);
  hangingLantern(ctx, f.m(hx * .55, wallH - .18, hz + .1), 1.0);
  const kit = (piece: string, lx: number, lz: number, size: number, yaw = 0, ly = .14) => { const p = f.p(lx, ly, lz); ctx.kits.push({file: 'props', piece, x: p.x, y: p.y, z: p.z, yaw: f.yw(yaw), size}); };
  if (booth) {
    // Counter across the open front, a ledger and an inkpot on it, the harbour's airship sign on a gilt arm.
    timber.add(bx(hx * 2 - .2, .1, .7), f.m(0, 1.12, hz - .25), C.timberDark, WOOD.planks, seed);
    stone.add(bx(hx * 2 - .2, 1.0, .3, [1, 2, 1]), f.m(0, .6, hz - .1), C.stone, STONE.ashlar, seed);
    timber.add(bx(.55, .06, .4), f.m(-.4, 1.2, hz - .25, .2), '#e8dcc0', WOOD.planks, seed);
    stone.add(new THREE.CylinderGeometry(.06, .07, .1, 8), f.m(.3, 1.22, hz - .3), '#2d4f6e', STONE.ceramic, seed);
    metal.add(rod([new V(hx - .2, wallH - .3, hz + .05), new V(hx - .2, wallH - .25, hz + 1.0)], .03, 5), f.F, C.gold);
    timber.add(bx(.8, .55, .06), f.m(hx - .2, wallH - .75, hz + .75, Math.PI / 2), C.timberDark, WOOD.planks, 3);
    signEmblem(ctx, f.m(hx - .2, wallH - .75, hz + .75, Math.PI / 2), 'chandler', .035);
    kit('Barrel', -hx - .7, hz - .4, .9, .3, h(f.p(-hx - .7, 0, hz - .4).x, f.p(-hx - .7, 0, hz - .4).z) - f.y);
  } else {
    // Cargo under the sail: crates stacked two high, barrels, sacks, a coil of rope; a hand truck at the door.
    kit('Crate_Wooden', -hx + .9, -hz + .9, .95, .1); kit('Crate_Wooden', -hx + .95, -hz + .9, .8, -.3, 1.09); kit('Crate_Wooden', -hx + 2.0, -hz + .85, .9, .4);
    kit('Barrel', hx - .7, -hz + .7, 1.0); kit('Barrel', hx - .75, -hz + 1.6, 1.0, .6); kit('Barrel', hx - 1.55, -hz + .7, .9, 1.2);
    kit('Bag', .2, -hz + .6, .7, 1); kit('Bag', .8, -hz + .7, .65, 2.3); kit('Bag', .5, -hz + .75, .55, .4, .7);
    kit('Rope_2', -.6, .4, .3, .5);
  }
  ctx.stats.sheds = (ctx.stats.sheds ?? 0) + 1;
}
