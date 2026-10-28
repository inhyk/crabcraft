import * as THREE from 'three';
import {SKY_AIRSHIP, SKY_CARGO, SKY_PIER} from './skyTownLayout';
import {Bucket, CLOTH, ROOF, STONE, WOOD, atlasUv, beam, bx, clothSheet, disc, hipRoof, lath, ring, rod, sagPoints, skyMaterials, type TownCtx} from './skyTownKit';
import {hangingLantern, lanternPost, signEmblem} from './skyTown';

/*
 * The sky harbour at Skybloom's south rim: a plank boardwalk from the end of the high street through a tiled timber
 * gate, out past the cliff on piles into the cloud sea, to a pier head with bollards, a cargo crane, a signal mast
 * and lanterns. A small airship lies moored alongside: plank hull with a painted strake and a gilt rail, a cabin
 * with its own glazed roof, a striped gas envelope with gilt bands and fins, rigging, and a turning propeller.
 */

const V = THREE.Vector3;
const C = {stone: '#e6dcc4', trim: '#efe5cd', timber: '#a8794a', timberDark: '#7f5a36', deck: '#b58a58', roof: '#2f8f8a', cap: '#226f6b', gold: '#d4a64a', rope: '#c2a678', plaster: '#f2eadb', paint: '#2f8f8a', glass: new THREE.Color('#ffcf86').multiplyScalar(1.75)};

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
  crane(ctx, P.x - P.headHalf + 1.1, P.headZ + 5.5, dy);
  signalMast(ctx, P.x - P.headHalf + .8, P.z1 - 2.6, dy);
  // Cargo waiting by the boardwalk and on the head.
  for (const c of SKY_CARGO) {
    const y = h(c.x, c.z), s = Math.sign(c.x);
    ctx.kits.push({file: 'props', piece: 'Crate_Wooden', x: c.x, y, z: c.z - .5, yaw: .2, size: .95}, {file: 'props', piece: 'Crate_Wooden', x: c.x + s * .3, y: y + .95, z: c.z - .45, yaw: -.3, size: .75},
      {file: 'props', piece: 'Barrel', x: c.x - s * .2, y, z: c.z + .9, yaw: 0, size: 1.0}, {file: 'props', piece: 'Bag', x: c.x + s * .8, y, z: c.z + .3, yaw: 1, size: .65}, {file: 'props', piece: 'Rope_2', x: c.x - s * .9, y, z: c.z - .7, yaw: 0, size: .22});
  }
  ctx.kits.push({file: 'props', piece: 'Crate_Wooden', x: P.x + 3.6, y: dy, z: P.headZ + 2.2, yaw: .4, size: .8}, {file: 'props', piece: 'Barrel', x: P.x + 4.2, y: dy, z: P.headZ + 3.4, yaw: 0, size: .9},
    {file: 'props', piece: 'Bag', x: P.x + 3.4, y: dy, z: P.headZ + 3.2, yaw: 2, size: .6}, {file: 'props', piece: 'Bench', x: P.x - 2.2, y: dy, z: P.z1 - .9, yaw: 0, size: .85},
    {file: 'props', piece: 'Bench', x: P.x - 3.2, y: h(P.x - 3.2, 118), z: 118, yaw: -.25, size: .85});
  const ship = airship(ctx, SKY_AIRSHIP.x, dy, SKY_AIRSHIP.z);
  group.add(ship.prop);
  ctx.stats.harbourPiles = piles.length;
  return {group, update(time: number) { ship.prop.rotation.z = time * 2.4; }};
}

/** Timber gate over the boardwalk: turned posts on stone feet, lintel and tie beam, a small glazed roof, sign. */
function gate(ctx: TownCtx, x: number, z: number, dy: number) {
  const {h, stone, timber, metal, roof} = ctx;
  for (const sx of [-1, 1]) {
    const px = x + sx * 3.25, y = h(px, z) - .1;
    stone.add(lath([[.42, -.3], [.42, .3], [.32, .4], [.3, .7], [.34, .76], [.26, .82], [0, .82]], 10), new THREE.Matrix4().makeTranslation(px, y, z), C.trim, STONE.dressed, sx);
    timber.add(lath([[.2, 0], [.18, .4], [.16, 3.4], [.2, 3.5], [.16, 3.6], [.16, 4.0], [0, 4.0]], 10), new THREE.Matrix4().makeTranslation(px, y + .8, z), C.timber, WOOD.beam, sx);
    for (const cy of [1.6, 3.55]) metal.add(new THREE.CylinderGeometry(.19, .19, .08, 12), new THREE.Matrix4().makeTranslation(px, y + .8 + cy, z), C.gold);
  }
  const top = dy + 4.75;
  timber.add(beam(new V(x - 4.3, top, z), new V(x + 4.3, top, z), .34, .42), null, C.timberDark, WOOD.beam, 7);
  timber.add(beam(new V(x - 3.4, top - .9, z), new V(x + 3.4, top - .9, z), .22, .26), null, C.timber, WOOD.beam, 8);
  for (const sx of [-1, 1]) timber.add(beam(new V(x + sx * 3.25, top - 1.6, z), new V(x + sx * 2.2, top - .9, z), .14), null, C.timber, WOOD.beam, 9);
  const r = hipRoof(4.75, .95, .85, .5, {ns: 16, nt: 5, soffit: .1, fascia: .14});
  const rf = new THREE.Matrix4().makeTranslation(x, top + .24, z);
  roof.add(r.top, rf, C.roof, ROOF.tiles, 9);
  timber.add(r.soffit, rf, C.timber, WOOD.planks, 9);
  timber.add(r.fascia, rf, C.timberDark, WOOD.beam, 9);
  for (const line of r.hips) roof.add(rod(line.map(p => p.clone().add(new V(0, .05, 0))), .08, 5), rf, C.cap, ROOF.cap, 9);
  roof.add(rod(r.ridge.map(p => p.clone().add(new V(0, .05, 0))), .1, 6), rf, C.cap, ROOF.cap, 9);
  for (const p of r.ridge) metal.add(lath([[.12, 0], [.15, .08], [.06, .18], [.09, .28], [.03, .42], [0, .62]], 10), new THREE.Matrix4().makeTranslation(x + p.x, top + .24 + p.y, z), C.gold);
  // Sign under the tie beam: the harbour's airship emblem on both faces.
  timber.add(bx(1.5, .7, .07), new THREE.Matrix4().makeTranslation(x, top - 1.55, z), C.timberDark, WOOD.planks, 3);
  for (const sx of [-.55, .55]) timber.add(new THREE.CylinderGeometry(.01, .01, .3, 3), new THREE.Matrix4().makeTranslation(x + sx, top - 1.07, z), C.rope, WOOD.beam, 0);
  signEmblem(ctx, new THREE.Matrix4().makeTranslation(x, top - 1.55, z).multiply(new THREE.Matrix4().makeScale(1.3, 1.3, 1)), 'chandler', .045);
  metal.add(bx(1.56, .05, .1), new THREE.Matrix4().makeTranslation(x, top - 1.18, z), C.gold);
  for (const sx of [-1, 1]) { metal.add(rod([new V(x + sx * 3.9, top - .2, z), new V(x + sx * 3.9, top - .45, z)], .02, 4), null, C.gold); hangingLantern(ctx, new THREE.Matrix4().makeTranslation(x + sx * 3.9, top - .45, z), 1.1); }
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
function airship(ctx: TownCtx, x: number, dy: number, z: number) {
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
  const S = new THREE.Matrix4().makeTranslation(x, top0, z);
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
  const pierEdge = SKY_PIER.x + SKY_PIER.headHalf, gw = x - half(0) * W + .1;
  timber.add(bx(gw - pierEdge + .6, .08, 1.0), new THREE.Matrix4().makeTranslation((gw + pierEdge) / 2, dy + .2, z), C.deck, WOOD.planks, 39);
  for (const sz of [-.5, .5]) timber.add(rod(sagPoints(new V(pierEdge - .1, dy + 1.0, z + sz * 2.4), new V(gw, top0 + .9, z + sz), .1, 6), .02, 3), null, C.rope, WOOD.beam, 0);
  for (const s of [-1, 1]) { const bz = SKY_AIRSHIP.z + s * 5.2; timber.add(rod(sagPoints(new V(pierEdge - .5, dy + .35, bz), new V(x - half(s * 4.6) * W, top0 + sheer(s * 4.6), z + s * 4.6), .35, 8), .03, 4), null, C.rope, WOOD.beam, 0); }
  // Propeller at the stern: its own mesh (gilt hub, three honey blades) so it turns.
  const pb = new Bucket(ctx.h);
  pb.add(lath([[.16, -.2], [.2, 0], [.14, .2], [0, .26]], 10).rotateX(Math.PI / 2), null, C.gold, WOOD.beam, 0);
  for (let k = 0; k < 3; k++) pb.add(lath([[.0, 0], [.1, .1], [.15, .7], [.09, 1.3], [0, 1.36]], 6).scale(1, 1, .25), new THREE.Matrix4().makeRotationZ(k * Math.PI * 2 / 3 + .2), C.timber, WOOD.beam, k);
  const prop = pb.mesh(skyMaterials().timber, 'skybloom-airship-propeller')!;
  prop.matrixAutoUpdate = true; prop.position.set(x, top0 + sheer(-L / 2) - .55, z - L / 2 - .25);
  timber.add(beam(new V(0, sheer(-L / 2) - .55, -L / 2 + .7), new V(0, sheer(-L / 2) - .55, -L / 2 - .1), .14), S, C.timberDark, WOOD.beam, 40);
  // A pennant streaming from the stern post.
  timber.add(lath([[.05, 0], [.04, 2.2], [0, 2.25]], 6), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(-L / 2 + .6), -L / 2 + .6)), C.timber, WOOD.beam, 41);
  cloth.add(clothSheet(.5, 1.6, CLOTH.banner, {nx: 2, ny: 8, tail: .3}), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, sheer(-L / 2 + .6) + 2.15, -L / 2 + .6)).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + .25)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), '#ffffff', 1, 7);
  ctx.stats.airship = 1;
  return {prop};
}
