import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Scatter, StaticBatch, trs, type Kit} from '../world/kit';
import {rng} from '../world/noise';
import {lathe, tube} from '../world/geom';
import {Acc, CL, CR, FIN, block, box, dawnCloth, dawnCraft, dawnPlaster, face, facePoint, type BlockFrame, type Face, type Hole} from './dawnAdobe';
import {dawnPalmGrove} from './dawnPalms';
import {dawnGlows, dawnRope, dawnWood, woodPart} from './dawnMaterials';
import {DAWN_TINTS, DAWN_WELL, dawnBlocks, dawnPalms, stairFootprint, type DawnBlock, type DawnFace} from './dawnHousePlan';

/*
 * Goldsand Harbor's desert quarter (World III), from the plan in dawnHousePlan.ts: flat-roofed blocks of whitewash,
 * sandstone and mudbrick with battered walls and rounded corners; small deep windows (lintelled, arched with painted
 * shutters, or screened with lattice), arched doorways with painted plank doors, mashrabiya bays on upper storeys,
 * rows of roof-beam ends (vigas) and spouts, outside stairs to the roofs, three windcatcher towers, a domed shrine,
 * a forge with its chimney and fire, a tavern terrace, a spice shop, the healer's well, and life on the roofs: water
 * jars, rugs drying over parapets, laundry, ladders, shade sails, stair huts and roof gardens. Date palms stand in
 * scenes, not scattered. Everything shares five materials (plaster, craft, cloth, wood, palm fronds) plus the kit
 * props (doors' pots and lanterns come from dawnDressing.ts through `doors`).
 */

const V = THREE.Vector3;
const Y = new V(0, 1, 0);
const FINISH = [FIN.plaster, FIN.ashlar, FIN.mudbrick, FIN.plaster, FIN.plaster];
const PAINT = ['#2b3a7a', '#2aa3a0', '#4a78a0', '#c98a1a', '#a5482a', '#3f6e4a', '#356f86'];
const CLOTH = ['#2b3a7a', '#e3a21a', '#b5532c', '#c9b48e', '#7a2f3a', '#2f6f78'];
const WOOD_DARK = '#5a3d26';

export interface DawnQuarter {
  group: THREE.Group;
  /** Door anchors (beside each street door, 1.55 m up) and facing yaw, for dawnDressing's pots and lanterns. */
  doors: {pos: THREE.Vector3; yaw: number}[];
  stats: Record<string, number>;
  update(time: number): void;
}

const faceYaw = (N: THREE.Vector3) => Math.atan2(N.x, N.z);

export function dawnHouses(height: (x: number, z: number) => number, kits: {props: Kit; nature: Kit}): DawnQuarter {
  const group = new THREE.Group(); group.name = 'goldsand-quarter';
  const wall = new Acc({uv: 'aPlUv', aux: 'aPl', k: 'aPlK'}), craft = new Acc({uv: 'aCrUv', aux: 'aCr'}), cloth = new Acc({uv: 'aClUv', aux: 'aCl'});
  craft.a3 = [0, 0, 0]; cloth.a3 = [0, 0, 0];
  const woods: THREE.BufferGeometry[] = [], ropes: THREE.BufferGeometry[] = [];
  const props = new StaticBatch(kits.props, 'goldsand-quarter-props'), plants = new Scatter(kits.nature, 'goldsand-quarter-plants');
  const doors: {pos: THREE.Vector3; yaw: number}[] = [], glows: {pos: THREE.Vector3; size: number}[] = [];
  const stats: Record<string, number> = {blocks: 0, windows: 0, doors: 0, vigas: 0, bays: 0, windcatchers: 0, stairs: 0, jars: 0, rugs: 0, laundry: 0, sails: 0, ladders: 0, gardens: 0, carpets: 0, baskets: 0, awnings: 0, palms: 0, domes: 0};
  const prop = (piece: string, x: number, y: number, z: number, yaw = 0, s = 1) => { if (kits.props.has(piece)) props.add(piece, trs(x, y, z, yaw, s)); };
  const plant = (piece: string, x: number, y: number, z: number, yaw: number, s: number) => { if (kits.nature.has(piece)) plants.add(piece, trs(x, y, z, yaw, s)); };
  const wood = (g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation | null = null, paint = 0, axis = new V(1, 0, 0)) => { woods.push(woodPart(g, m, color, paint, axis)); g.dispose(); };
  const basis = (p: THREE.Vector3, X: THREE.Vector3, Yv: THREE.Vector3, Z: THREE.Vector3) => new THREE.Matrix4().makeBasis(X, Yv, Z).setPosition(p);
  const blocks = dawnBlocks();
  const byId = new Map(blocks.map(b => [b.id, b]));
  const frames = new Map<string, BlockFrame>();

  // ---- Small builders -------------------------------------------------------------------------------------------
  const jar = (x: number, y: number, z: number, s: number, glazed: string | null, seed: number) => {
    const g = lathe([[0, 0], [.1, .005], [.19, .1], [.235, .3], [.215, .5], [.13, .63], [.085, .68], [.09, .74], [.12, .77], [.105, .78]], 12);
    craft.a3 = [glazed ? CR.glaze : CR.clay, 0, seed]; craft.col.set(glazed ?? (seed % 3 < 1 ? '#a85a32' : '#b8714a'));
    craft.geo(g, new THREE.Matrix4().compose(new V(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y, seed), new V(s, s, s)));
    g.dispose(); stats.jars++;
  };
  const pot = (x: number, y: number, z: number, s: number, seed: number, plantName?: string) => {
    const g = lathe([[0, 0], [.15, 0], [.19, .05], [.25, .34], [.29, .38], [.29, .42], [.25, .42]], 12);
    craft.a3 = [CR.clay, 0, seed]; craft.col.set(seed % 2 ? '#b0623a' : '#c07a4e');
    craft.geo(g, new THREE.Matrix4().compose(new V(x, y, z), new THREE.Quaternion(), new V(s, s, s)));
    g.dispose();
    if (plantName) plant(plantName, x, y + .36 * s, z, seed, .38 * s + .1);
  };
  const basket = (x: number, y: number, z: number, spice: string, seed: number) => {
    const b = lathe([[0, 0], [.2, .0], [.26, .1], [.28, .2], [.3, .22]], 12);
    craft.a3 = [CR.basket, 0, seed]; craft.col.set('#c7a165');
    craft.geo(b, new THREE.Matrix4().makeTranslation(x, y, z)); b.dispose();
    const m = lathe([[0, .3], [.08, .29], [.18, .25], [.27, .19], [.28, .17]], 12);
    craft.a3 = [CR.spice, 0, seed]; craft.col.set(spice);
    craft.geo(m, new THREE.Matrix4().makeTranslation(x, y, z)); m.dispose();
    stats.baskets++;
  };
  /** Cloth sheet over a grid of corners (a,b at the top edge; c,d below) sagging by `sag`. */
  const sheet = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: string, pattern: number, sag: number, sway: (u: number, v: number) => number, seed: number, nu = 6, nv = 4, uvMetres = true) => {
    cloth.col.set(color);
    const P = (u: number, v: number) => {
      const top = a.clone().lerp(b, u), bot = d.clone().lerp(c, u), p = top.lerp(bot, v);
      return p.add(new V(0, -sag * 4 * u * (1 - u) * (.4 + .6 * Math.sin(Math.PI * v)), 0));
    };
    const W = a.distanceTo(b), Hh = a.distanceTo(d);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
      const pts = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], uv = uvMetres ? [u0 * W, v0 * Hh, u1 * W, v0 * Hh, u1 * W, v1 * Hh, u0 * W, v1 * Hh] : [u0, v0, u1, v0, u1, v1, u0, v1];
      const sw = [sway(u0, v0), sway(u1, v0), sway(u1, v1), sway(u0, v1)];
      const n = new V().subVectors(pts[1], pts[0]).cross(new V().subVectors(pts[3], pts[0])).normalize();
      if (n.y < -.2) n.negate();
      for (const k of [0, 1, 2, 0, 2, 3]) { cloth.a3 = [sw[k], pattern, seed]; cloth.vert(pts[k], n, uv[k * 2], uv[k * 2 + 1]); }
    }
  };
  const post = (x: number, y0: number, z: number, h: number, r = .06) => wood(new THREE.CylinderGeometry(r * .85, r, h, 7), trs(x, y0 + h / 2, z), null, 0, new V(0, 1, 0));
  /** Wooden ladder from a (foot) to b (top). */
  const ladder = (a: THREE.Vector3, b: THREE.Vector3) => {
    const dir = b.clone().sub(a), L = dir.length(); dir.normalize();
    const side = new V().crossVectors(dir, Y).normalize(); if (side.lengthSq() < .5) side.set(1, 0, 0);
    const nrm = new V().crossVectors(side, dir).normalize();
    for (const s of [-1, 1]) wood(new THREE.BoxGeometry(.06, L, .05), basis(a.clone().lerp(b, .5).addScaledVector(side, s * .22), side, dir, nrm), null, 0, new V(0, 1, 0));
    for (let t = .3; t < L - .15; t += .3) wood(new THREE.CylinderGeometry(.022, .022, .46, 5), basis(a.clone().addScaledVector(dir, t), dir, side, nrm.clone().negate()), null, 0, new V(0, 1, 0));
    stats.ladders++;
  };
  /** Rope line through points (sagging between ends). */
  const line = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(a.clone().lerp(b, t).add(new V(0, -sag * 4 * t * (1 - t), 0))); }
    ropes.push(tube(pts, () => .012, 4));
    return (t: number) => a.clone().lerp(b, t).add(new V(0, -sag * 4 * t * (1 - t), 0));
  };
  const laundry = (a: THREE.Vector3, b: THREE.Vector3, R: () => number) => {
    for (const p of [a, b]) post(p.x, p.y - 1.75, p.z, 1.8, .04);
    const at = line(a, b, .22), L = a.distanceTo(b), along = b.clone().sub(a).setY(0).normalize(), nrm = new V(-along.z, 0, along.x);
    let t = .1;
    while (t < .9) {
      const w = R() < .3 ? .95 : .5 + R() * .2, h = w > .9 ? .85 : .5 + R() * .25, top = at(t + w / L / 2).add(new V(0, -.02, 0));
      const l = top.clone().addScaledVector(along, -w / 2), r = top.clone().addScaledVector(along, w / 2);
      sheet(l, r, r.clone().add(new V(0, -h, 0)).addScaledVector(nrm, .03), l.clone().add(new V(0, -h, 0)).addScaledVector(nrm, .03), ['#e8e2d2', '#2b3a7a', '#e3a21a', '#e9e5da', '#b5532c', '#5a8fa0'][Math.floor(R() * 6)], CL.plain, 0, (_u, v) => v * .9, R() * 9, 2, 2);
      stats.laundry++;
      t += (w + .14) / L;
    }
  };
  /** Rug drying over a parapet: hangs `out` metres outside and a little inside. f is the face, u along it. */
  const parapetRug = (fr: BlockFrame, f: Face, u: number, w: number, out: number, color: string, seed: number) => {
    const topV = fr.top - fr.ground;
    const o0 = facePoint(f, u - w / 2, topV - out).addScaledVector(f.N, .035), o1 = facePoint(f, u + w / 2, topV - out).addScaledVector(f.N, .035);
    const t0 = facePoint(f, u - w / 2, topV).addScaledVector(f.N, .035).add(new V(0, .03, 0)), t1 = facePoint(f, u + w / 2, topV).addScaledVector(f.N, .035).add(new V(0, .03, 0));
    const i0 = t0.clone().addScaledVector(f.N, -.38), i1 = t1.clone().addScaledVector(f.N, -.38);
    const d0 = i0.clone().add(new V(0, -.3, 0)), d1 = i1.clone().add(new V(0, -.3, 0));
    const total = out + .38 + .3, s1 = out / total, s2 = (out + .38) / total;
    const seg = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, va: number, vb: number) => {
      cloth.col.set(color); cloth.a3 = [0, CL.rug, seed];
      const n = new V().subVectors(b, a).cross(new V().subVectors(d, a)).normalize();
      for (const [p, uu, vv] of [[a, 0, va], [b, 1, va], [c, 1, vb], [a, 0, va], [c, 1, vb], [d, 0, vb]] as const) cloth.vert(p, n, uu, vv);
    };
    seg(o0, o1, t1, t0, 0, s1); seg(t0, t1, i1, i0, s1, s2); seg(i0, i1, d1, d0, s2, 1);
    stats.rugs++;
  };
  /** Carpet hung flat on a wall from a rod: centre u, bottom v, size. */
  const wallCarpet = (f: Face, u: number, v: number, w: number, h: number, color: string, seed: number) => {
    const a = facePoint(f, u - w / 2, v + h).addScaledVector(f.N, .05), b = facePoint(f, u + w / 2, v + h).addScaledVector(f.N, .05);
    const c = facePoint(f, u + w / 2, v).addScaledVector(f.N, .08), d = facePoint(f, u - w / 2, v).addScaledVector(f.N, .08);
    cloth.col.set(color);
    const nu = 3, nv = 4;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const P = (uu: number, vv: number) => a.clone().lerp(b, uu).lerp(d.clone().lerp(c, uu), vv).addScaledVector(f.N, .025 * Math.sin(Math.PI * uu) * vv);
      const q = [[i / nu, j / nv], [(i + 1) / nu, j / nv], [(i + 1) / nu, (j + 1) / nv], [i / nu, (j + 1) / nv]];
      for (const k of [0, 1, 2, 0, 2, 3]) { cloth.a3 = [q[k][1] * .25, CL.rug, seed]; cloth.vert(P(q[k][0], q[k][1]), f.N, q[k][0], 1 - q[k][1]); }
    }
    wood(new THREE.CylinderGeometry(.025, .025, w + .2, 6), basis(a.clone().lerp(b, .5).addScaledVector(f.N, .01), f.N, f.U, new V().crossVectors(f.N, f.U)), null, 0, new V(0, 1, 0));
    stats.carpets++;
  };
  /** Awning: cloth from the wall at height v out `depth`, falling `drop`, across [u0, u1]; posts if `posts`. */
  const awning = (f: Face, u0: number, u1: number, v: number, depth: number, drop: number, color: string, stripe: boolean, posts: boolean, seed: number) => {
    const a = facePoint(f, u0, v).addScaledVector(f.N, .05), b = facePoint(f, u1, v).addScaledVector(f.N, .05);
    const d = a.clone().addScaledVector(f.N, depth).add(new V(0, -drop, 0)), c = b.clone().addScaledVector(f.N, depth).add(new V(0, -drop, 0));
    sheet(a, b, c, d, color, stripe ? CL.stripe : CL.plain, .12, (_u, vv) => vv * .35, seed, Math.max(3, Math.round((u1 - u0) / .6)), 3);
    // A valance hanging from the front edge.
    sheet(d, c, c.clone().add(new V(0, -.22, 0)), d.clone().add(new V(0, -.22, 0)), color, stripe ? CL.stripe : CL.plain, .1, () => .45, seed + 1, Math.max(3, Math.round((u1 - u0) / .6)), 1);
    // Rail along the wall and the front.
    wood(new THREE.CylinderGeometry(.035, .035, u1 - u0 + .1, 6), basis(a.clone().lerp(b, .5), f.N, f.U, new V().crossVectors(f.N, f.U)), null, 0, new V(0, 1, 0));
    wood(new THREE.CylinderGeometry(.035, .035, u1 - u0 + .1, 6), basis(d.clone().lerp(c, .5), f.N, f.U, new V().crossVectors(f.N, f.U)), null, 0, new V(0, 1, 0));
    if (posts) for (const p of [c, d]) { const gy = height(p.x, p.z); post(p.x, gy - .1, p.z, p.y - gy + .1, .055); }
    else for (const [p, q] of [[a, d], [b, c]] as const) {
      // Diagonal brackets from the wall up to the front rail.
      const foot = p.clone().add(new V(0, -.9, 0)), dir = q.clone().sub(foot), L = dir.length(); dir.normalize();
      wood(new THREE.CylinderGeometry(.03, .03, L, 5), basis(foot.clone().lerp(q, .5), new V().crossVectors(dir, f.U).normalize(), dir, f.U), null, 0, new V(0, 1, 0));
    }
    stats.awnings++;
  };
  /** Shade sail on four poles over a rectangle (corners at heights). */
  const sail = (cs: THREE.Vector3[], color: string, seed: number, poleFrom: number[]) => {
    cs.forEach((p, i) => { if (poleFrom[i] !== undefined) post(p.x, poleFrom[i], p.z, p.y - poleFrom[i] + .08, .045); });
    sheet(cs[0], cs[1], cs[2], cs[3], color, CL.plain, .2, (u, v) => .25 + .5 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), seed, 6, 6);
    stats.sails++;
  };
  const vigaGeo = () => new THREE.CylinderGeometry(.07, .08, .66, 7);

  // ---- Openings per block ---------------------------------------------------------------------------------------
  const keyFaces: DawnFace[] = ['z+', 'x+', 'z-', 'x-'];
  /** Faces' lengths for a block, matching block(). */
  const geometryOf = (b: DawnBlock) => {
    const g0 = height(b.x, b.z);
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => height(b.x + sx * b.w / 2, b.z + sz * b.d / 2));
    const gmin = Math.min(g0, ...cs);
    const ground = g0, base = b.lift ? g0 + b.lift : gmin - .4, roof = g0 + b.h, top = roof + b.para;
    const bat = Math.min(.32, .022 * (top - ground)), rb = .3 + bat;
    const L = {'z+': b.w - 2 * rb, 'z-': b.w - 2 * rb, 'x+': b.d - 2 * rb, 'x-': b.d - 2 * rb} as Record<DawnFace, number>;
    return {ground, base, roof, top, L};
  };

  interface Feature { f: DawnFace; h: Hole; style: 'lintel' | 'shutter' | 'none' | 'sill'; paint: string }
  for (const b of blocks) {
    const R = rng(b.seed), G = geometryOf(b);
    const floors = b.role === 'shrine' || b.role === 'forge' || b.role === 'wall' ? 1 : Math.max(1, Math.round(b.h / 3.2)), sh = b.h / floors;
    const style = b.seed % 3, paint = PAINT[b.seed % PAINT.length];
    const holes: Partial<Record<DawnFace, Hole[]>> = {}, feats: Feature[] = [];
    const add = (f: DawnFace, h: Hole, st: Feature['style'] = 'none', p = paint) => { (holes[f] ??= []).push(h); feats.push({f, h, style: st, paint: p}); };
    const streetSide = (f: DawnFace) => f === b.door || (b.x > 0 ? f === 'x-' : f === 'x+');
    if (b.role === 'wall') {
      // Courtyard walls: an arched gate in the long face toward the street.
      const f: DawnFace = b.w > b.d ? (b.z > 33 ? 'z+' : 'z-') : (b.x > 0 ? 'x-' : 'x+'), L = G.L[f];
      if (L > 3) add(f, {u0: L / 2 - .6, u1: L / 2 + .6, v0: 0, v1: 2.05, arch: true, depth: .3, kind: CR.door, color: PAINT[(b.seed + 2) % PAINT.length]});
    } else if (b.role !== 'bridge') {
      for (const f of keyFaces) {
        const L = G.L[f];
        if (L < 1.2) continue;
        const street = streetSide(f);
        // The door and the role's big openings on the door face.
        let doorU = -10, doorW = 0;
        if (f === b.door) {
          doorU = L / 2;
          if (b.role === 'forge') { doorW = 3.8; add(f, {u0: doorU - 1.9, u1: doorU + 1.9, v0: 0, v1: 3.35, arch: true, depth: 3.6, kind: CR.room, glow: 1.4}); }
          else if (b.role === 'shop') { doorW = 2.4; add(f, {u0: doorU - 1.2, u1: doorU + 1.2, v0: 0, v1: 2.55, arch: true, depth: .7, kind: CR.room, glow: .55}); }
          else if (b.role === 'shrine') { doorW = 1.9; add(f, {u0: doorU - .95, u1: doorU + .95, v0: 0, v1: 3.1, arch: true, depth: .6, kind: CR.door, color: '#c9a24a', tiled: true}); }
          else {
            doorW = b.role === 'tavern' ? 1.6 : 1.25;
            add(f, {u0: doorU - doorW / 2, u1: doorU + doorW / 2, v0: 0, v1: b.role === 'tavern' ? 2.6 : 2.3, arch: true, depth: .45, kind: CR.door, color: b.role === 'healer' ? '#3f6e4a' : paint});
          }
          stats.doors++;
        }
        for (let fl = 0; fl < floors; fl++) {
          const count = Math.max(1, Math.floor((L - .4) / 2.1));
          for (let i = 0; i < count; i++) {
            const u = L * (i + .5) / count;
            if (fl === 0 && Math.abs(u - doorU) < doorW / 2 + .75) continue;
            if (fl > 0 && Math.abs(u - doorU) < 1 && f === b.door && floors > 1 && b.seed % 2 === 0) continue; // the bay goes here
            if (R() < (street ? .25 : .5)) continue;
            if (b.role === 'shrine') { add(f, {u0: u - .3, u1: u + .3, v0: 2.3, v1: 3.6, arch: true, depth: .5, kind: CR.lattice, color: WOOD_DARK, glow: .2}, 'sill'); stats.windows++; continue; }
            if (b.role === 'forge' && f === b.door) continue;
            if (fl === 0) {
              // Ground floor: small, high, screened or dark.
              const w = .5;
              add(f, {u0: u - w / 2, u1: u + w / 2, v0: 1.3, v1: 1.85, depth: .38, kind: R() < .5 ? CR.lattice : CR.room, color: WOOD_DARK, glow: .25}, 'lintel');
            } else {
              const v0 = fl * sh + .85;
              if (style === 0) add(f, {u0: u - .3, u1: u + .3, v0, v1: v0 + .8, depth: .4, kind: CR.room, glow: .3}, 'lintel');
              else if (style === 1) add(f, {u0: u - .32, u1: u + .32, v0, v1: v0 + 1.12, arch: true, depth: .4, kind: R() < .4 ? CR.lattice : CR.room, color: WOOD_DARK, glow: .3}, 'shutter', PAINT[(b.seed + i + fl) % PAINT.length]);
              else add(f, {u0: u - .3, u1: u + .3, v0, v1: v0 + 1.05, arch: true, depth: .42, kind: CR.lattice, color: WOOD_DARK, glow: .35}, 'sill');
            }
            stats.windows++;
          }
        }
      }
    } else {
      // The bridge room: windows over the road on both open faces.
      for (const f of ['x+', 'x-'] as const) { const L = G.L[f]; for (const u of [L * .3, L * .7]) { add(f, {u0: u - .3, u1: u + .3, v0: b.lift! + 1.1, v1: b.lift! + 2.15, arch: true, depth: .4, kind: CR.lattice, color: WOOD_DARK, glow: .3}, 'sill'); stats.windows++; } }
    }
    wall.col.set(b.role === 'shrine' ? '#f3eadb' : DAWN_TINTS[b.tint]); wall.k = b.role === 'shrine' ? FIN.plaster : FINISH[b.tint];
    const fr = block(wall, craft, {cx: b.x, cz: b.z, w: b.w, d: b.d, base: G.base, ground: G.ground, roof: G.roof, para: b.para, holes, soffit: !!b.lift, thick: b.role === 'wall' ? b.w < b.d ? b.w / 2 - .02 : b.d / 2 - .02 : .3, r: b.role === 'wall' ? .2 : .3, batter: b.role === 'wall' ? .012 : .022, cap: true});
    frames.set(b.id, fr);
    stats.blocks++;
    if (b.lift) {
      // Beams under the bridge room.
      for (let t = -b.w / 2 + .4; t <= b.w / 2 - .3; t += .7) wood(vigaGeo().scale(1, (b.d + .3) / .66, 1), basis(new V(b.x + t, G.base - .08, b.z), new V(1, 0, 0), new V(0, 0, 1), new V(0, -1, 0)), null, 0, new V(0, 1, 0));
    }
    // Opening details.
    for (const {f, h, style: st, paint: pc} of feats) {
      const F = fr.faces[f], uc = (h.u0 + h.u1) / 2, w = h.u1 - h.u0;
      if (st === 'lintel') wood(new THREE.BoxGeometry(w + .36, .12, .26), basis(facePoint(F, uc, h.v1 + .07).addScaledVector(F.N, .05), F.U, Y, F.N), null, 0);
      if (st === 'sill' || st === 'shutter') { const p = facePoint(F, uc, h.v0 - .04).addScaledVector(F.N, .05); box(wall, p.x, p.y, p.z, w + .18, .08, .16, faceYaw(F.N)); }
      if (st === 'shutter') {
        const hh = (h.arch ? h.v1 - w / 2 : h.v1) - h.v0 + .02;
        for (const s of [-1, 1]) {
          const u = s < 0 ? h.u0 - w / 4 - .02 : h.u1 + w / 4 + .02, p = facePoint(F, u, h.v0 + hh / 2).addScaledVector(F.N, .045);
          wood(new THREE.BoxGeometry(w / 2, hh, .035), basis(p, F.U, Y, F.N), pc, .9, new V(0, 1, 0));
        }
      }
      if (h.kind === CR.door && h.v0 === 0) {
        // Threshold step, and the door's anchor for the dressing (beside the door, as TownBuilder's).
        const s = facePoint(F, uc, 0).addScaledVector(F.N, .26);
        box(wall, s.x, height(s.x, s.z) + .02, s.z, w + .5, .2, .52, faceYaw(F.N));
        if (b.role !== 'wall') {
          const a = facePoint(F, uc, 1.55).addScaledVector(F.U, w / 2 + .38).addScaledVector(F.N, .1);
          doors.push({pos: a, yaw: faceYaw(F.N)});
        }
      }
    }
    if (b.role === 'wall') continue;
    // Vigas: roof-beam ends out of the long faces (beams span the short way), and floor beams on upper storeys.
    const long: DawnFace[] = b.w >= b.d ? ['z+', 'z-'] : ['x+', 'x-'];
    for (const f of long) {
      const F = fr.faces[f], L = F.L, levels = [G.roof - .16 - G.ground];
      if (b.role === 'bridge') levels[0] = G.roof - .16 - G.ground;
      for (let fl = 1; fl < floors; fl++) levels.push(fl * sh - .12);
      for (const v of levels) {
        const step = v > b.h - .5 ? .74 : .95;
        for (let u = .45 + (R() * .1); u < L - .3; u += step) {
          if ((holes[f] ?? []).some(h => u > h.u0 - .2 && u < h.u1 + .2 && v > h.v0 - .25 && v < h.v1 + .35)) continue;
          const out = .26 + R() * .08, p = facePoint(F, u, v + (R() - .5) * .03).addScaledVector(F.N, out);
          wood(vigaGeo(), basis(p, F.U, F.N, new V().crossVectors(F.U, F.N)), null, 0, new V(0, 1, 0));
          stats.vigas++;
        }
      }
    }
    // A spout through the parapet on one side face, its streak under it in the plaster.
    if (b.role !== 'bridge') {
      const f = b.w >= b.d ? (b.seed % 2 ? 'x+' : 'x-') : (b.seed % 2 ? 'z+' : 'z-'), F = fr.faces[f];
      const p = facePoint(F, F.L * (.3 + .4 * R()), b.h + .06).addScaledVector(F.N, .3);
      wood(new THREE.BoxGeometry(.16, .1, .75), basis(p, F.U, Y, F.N).multiply(new THREE.Matrix4().makeRotationX(.12)), null, 0, new V(0, 0, 1));
    }
    // Mashrabiya bay over the door on two-storey street fronts.
    if (b.door && floors > 1 && b.seed % 2 === 0 && b.role !== 'forge') {
      const F = fr.faces[b.door], uc = F.L / 2, v0 = sh + .55, bw = 1.4, bh = 1.55, bd = .55;
      const p0 = facePoint(F, uc - bw / 2, v0), p1 = facePoint(F, uc + bw / 2, v0);
      const out = (p: THREE.Vector3, d: number, dv = 0) => p.clone().addScaledVector(F.N, d).add(new V(0, dv, 0));
      craft.a3 = [CR.lattice, .3, b.seed]; craft.col.set(WOOD_DARK);
      const fa = out(p0, bd), fb = out(p1, bd);
      craft.quad(fa, fb, out(p1, bd, bh), out(p0, bd, bh), F.N, [0, 0, bw, 0, bw, bh, 0, bh]);
      craft.quad(out(p0, .02), fa, out(p0, bd, bh), out(p0, .02, bh), F.U.clone().negate(), [0, 0, bd, 0, bd, bh, 0, bh]);
      craft.quad(fb, out(p1, .02), out(p1, .02, bh), out(p1, bd, bh), F.U, [0, 0, bd, 0, bd, bh, 0, bh]);
      const mid = p0.clone().lerp(p1, .5);
      wood(new THREE.BoxGeometry(bw + .2, .14, bd + .14), basis(out(mid, bd / 2, bh + .07), F.U, Y, F.N), WOOD_DARK, .8);
      wood(new THREE.BoxGeometry(bw + .16, .16, bd + .1), basis(out(mid, bd / 2, -.08), F.U, Y, F.N), WOOD_DARK, .8);
      for (const s of [-.5, 0, .5]) wood(new THREE.BoxGeometry(.12, .34, bd * .8), basis(out(mid.clone().addScaledVector(F.U, s * bw * .8), bd * .38, -.32), F.U, Y, F.N), WOOD_DARK, .8);
      stats.bays++;
    }
    // Windcatcher tower on the roof: slit vents near the top, beams through it, a capped crown.
    if (b.wind) {
      const tx = b.x + b.wind.dx * (b.w / 2 - 1.5), tz = b.z + b.wind.dz * (b.d / 2 - 1.5), rise = 5.4, sz = 2.2;
      const th: Partial<Record<DawnFace, Hole[]>> = {};
      for (const f of keyFaces) th[f] = [-.58, 0, .58].map(o => ({u0: (sz - .7) / 2 + o - .13, u1: (sz - .7) / 2 + o + .13, v0: rise - 2.9, v1: rise - .6, arch: true, depth: .75, kind: CR.room, glow: 0}));
      wall.col.set(DAWN_TINTS[b.tint === 2 ? 3 : b.tint]); wall.k = FINISH[b.tint === 2 ? 3 : b.tint];
      const tf = block(wall, craft, {cx: tx, cz: tz, w: sz, d: sz, base: G.roof - .1, ground: G.roof - .1, roof: G.roof + rise, para: .35, holes: th, r: .14, batter: .012, thick: .22});
      for (const f of keyFaces) {
        const F = tf.faces[f];
        for (const u of [F.L * .22, F.L * .78]) wood(vigaGeo().scale(1, 1.1, 1), basis(facePoint(F, u, rise - .18).addScaledVector(F.N, .26), F.U, F.N, new V().crossVectors(F.U, F.N)), null, 0, new V(0, 1, 0));
      }
      // A cornice slab under the cap.
      box(wall, tx, G.roof + rise - .02, tz, sz + .16, .1, sz + .16);
      stats.windcatchers++;
      wall.gy = G.ground;
    }
    // Outside stair to the roof: masonry steps with a parapet on the open side.
    const sf = stairFootprint(b);
    if (sf && b.stair) {
      wall.col.set(DAWN_TINTS[b.tint]); wall.k = FINISH[b.tint]; wall.gy = G.ground; wall.top = G.top;
      const alongX = b.stair.face[0] === 'z', dir = b.stair.dir, run = alongX ? sf.hx * 2 : sf.hz * 2, wide = alongX ? sf.hz * 2 : sf.hx * 2;
      const out = b.stair.face[1] === '+' ? 1 : -1, n = Math.ceil(G.top - G.ground) / .25 | 0, rise = (G.top - .02 - G.ground) / n;
      const start = alongX ? sf.x - dir * run / 2 : sf.z - dir * run / 2;
      for (let i = 0; i < n; i++) {
        const along = start + dir * (i + .5) * run / n, hgt = (i + 1) * rise + .4;
        const sx = alongX ? along : sf.x, sz = alongX ? sf.z : along;
        box(wall, alongX ? sx : sx - out * .08, G.ground - .4 + hgt / 2, alongX ? sz - out * .08 : sz, alongX ? run / n + .01 : wide - .16, hgt, alongX ? wide - .16 : run / n + .01);
        // Outer parapet: a low wall stepping with the flight.
        const px = alongX ? sx : sf.x + out * (wide / 2 - .08), pz = alongX ? sf.z + out * (wide / 2 - .08) : sz;
        box(wall, px, G.ground - .4 + (hgt + .55) / 2, pz, alongX ? run / n + .01 : .16, hgt + .55, alongX ? .16 : run / n + .01);
      }
      stats.stairs++;
    }
  }

  // ---- Roles ---------------------------------------------------------------------------------------------------
  const roleBlock = (role: string) => blocks.find(b => b.role === role)!;
  // The shrine: an octagonal drum with arched lights, a tiled neck, a whitewashed dome and a brass sun finial; an
  // alfiz frame round the door, stone benches either side, corner horns on the parapet.
  {
    const b = roleBlock('shrine'), fr = frames.get(b.id)!, G = geometryOf(b), F = fr.faces[b.door!];
    wall.col.set('#f3eadb'); wall.k = FIN.plaster; wall.gy = G.ground; wall.top = G.top + 6;
    const a = 2.15, drumH = 1.25, y0 = G.roof - .05, side = 2 * a * Math.tan(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const phi = k * Math.PI / 4, N = new V(Math.sin(phi), 0, Math.cos(phi)), U = new V().crossVectors(Y, N);
      const O = new V(b.x, y0, b.z).addScaledVector(N, a).addScaledVector(U, -side / 2);
      face(wall, craft, {O, U, N, L: side, H: drumH, bat: 0, ground: 0}, [{u0: side / 2 - .2, u1: side / 2 + .2, v0: .25, v1: 1.0, arch: true, depth: .3, kind: CR.lattice, color: WOOD_DARK, glow: .4}]);
    }
    const yT = y0 + drumH, R0 = a * 1.1;
    const cornice = lathe([[a * 1.075, yT - .02], [R0, yT + .02], [R0, yT + .14], [a * .98, yT + .16]], 24);
    wall.geo(cornice, new THREE.Matrix4().makeTranslation(b.x, 0, b.z)); cornice.dispose();
    const neck = lathe([[a * .98, yT + .15], [a * .98, yT + .5]], 24, 1);
    craft.a3 = [CR.tile, 0, 3]; craft.col.set('#ffffff');
    craft.geo(neck, new THREE.Matrix4().makeTranslation(b.x, 0, b.z)); neck.dispose();
    const Rd = a * .96, prof: [number, number][] = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14, th = t * Math.PI / 2; prof.push([Rd * Math.pow(Math.cos(th), .85) + (i === 14 ? 0 : 0), yT + .5 + Rd * 1.18 * Math.sin(th) + .25 * Math.pow(t, 6)]); }
    prof.push([0, prof[prof.length - 1][1]]);
    const dome = lathe(prof, 28);
    wall.geo(dome, new THREE.Matrix4().makeTranslation(b.x, 0, b.z)); dome.dispose();
    const yTop = prof[prof.length - 1][1];
    const fin = lathe([[0, 0], [.13, 0], [.15, .08], [.07, .16], [.11, .3], [.12, .38], [.05, .5], [.025, .95], [0, 1.0]], 12);
    craft.a3 = [CR.brass, 0, 0]; craft.col.set('#ffffff');
    craft.geo(fin, new THREE.Matrix4().makeTranslation(b.x, yTop - .04, b.z)); fin.dispose();
    const disc = new THREE.CylinderGeometry(.2, .2, .04, 16).rotateX(Math.PI / 2).rotateY(faceYaw(F.N));
    craft.geo(disc, new THREE.Matrix4().makeTranslation(b.x, yTop + .7, b.z)); disc.dispose();
    stats.domes++;
    // Alfiz: a moulded frame round the arch.
    const uc = F.L / 2, w = 1.9, v1 = 3.1;
    for (const [du, dv, sw, sv] of [[-w / 2 - .12, v1 / 2 + .05, .2, v1 + .3], [w / 2 + .12, v1 / 2 + .05, .2, v1 + .3], [0, v1 + .12, w + .44, .2]] as const) {
      const p = facePoint(F, uc + du, dv).addScaledVector(F.N, .04); box(wall, p.x, p.y, p.z, sw, sv, .14, faceYaw(F.N));
    }
    wall.top = G.top;
    // Benches (mastaba) either side of the door, with cushions.
    for (const s of [-1, 1]) {
      const p = facePoint(F, uc + s * 2.05, .23).addScaledVector(F.N, .35);
      box(wall, p.x, p.y, p.z, 1.6, .5, .62, faceYaw(F.N));
      const cpos = p.clone().add(new V(0, .3, 0));
      sheet(cpos.clone().addScaledVector(F.U, -.7).addScaledVector(F.N, -.25), cpos.clone().addScaledVector(F.U, .7).addScaledVector(F.N, -.25), cpos.clone().addScaledVector(F.U, .7).addScaledVector(F.N, .27), cpos.clone().addScaledVector(F.U, -.7).addScaledVector(F.N, .27), s < 0 ? '#2b3a7a' : '#b5532c', CL.rug, -.05, () => 0, 4 + s, 2, 2, false);
    }
    // Corner horns (small rounded merlons) on the parapet.
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(wall, b.x + sx * (b.w / 2 - .45), G.top + .22, b.z + sz * (b.d / 2 - .45), .42, .45, .42);
    // Brass lamps beside the door.
    for (const s of [-1, 1]) { const p = facePoint(F, uc + s * 1.35, 2.5).addScaledVector(F.N, .14); glows.push({pos: p, size: .9}); }
  }
  // The forge: a chimney stack with a sooty crown, the hearth's fire deep in the arch, the anvil and bench outside
  // under a canvas.
  {
    const b = roleBlock('forge'), fr = frames.get(b.id)!, G = geometryOf(b), F = fr.faces[b.door!];
    const cx = b.x + (b.x > 0 ? 1 : -1) * (b.w / 2 - 1.1), cz = b.z - b.d / 2 + 1.2;
    wall.col.set('#a88a6a'); wall.k = FIN.mudbrick;
    block(wall, craft, {cx, cz, w: 1.5, d: 1.5, base: G.roof - .1, ground: G.roof - .1, roof: G.roof + 3.6, para: .3, r: .12, batter: .04, thick: .3});
    wall.col.set('#2c2420'); box(wall, cx, G.roof + 3.6 + .02, cz, .7, .02, .7);
    wall.gy = G.ground;
    const hearth = facePoint(F, F.L / 2, .7).addScaledVector(F.N, -3.2);
    for (const [du, dv, s] of [[0, 0, 2.2], [-.5, .25, 1.4], [.6, .1, 1.2], [0, .9, 1.6]]) glows.push({pos: hearth.clone().addScaledVector(F.U, du).add(new V(0, dv, 0)), size: s});
    const yaw = faceYaw(F.N), at = (u: number, n: number) => facePoint(F, u, 0).addScaledVector(F.N, n);
    const an = at(F.L / 2 - 2.6, 1.3); prop('Anvil_Log', an.x, height(an.x, an.z), an.z, yaw + .3); prop('Anvil', an.x, height(an.x, an.z) + .62, an.z, yaw + .3);
    const wb = at(F.L / 2 + 2.9, 1.1); prop('Workbench', wb.x, height(wb.x, wb.z), wb.z, yaw + Math.PI / 2);
    const br = at(F.L / 2 + 2.6, 2.2); prop('Barrel', br.x, height(br.x, br.z), br.z, 1.3);
    const ws = at(F.L / 2 - 3.2, 2.3); prop('Whetstone', ws.x, height(ws.x, ws.z), ws.z, yaw - .4);
    awning(F, F.L / 2 - 3.5, F.L / 2 + 3.5, 3.55, 1.8, .5, '#6e5a46', false, true, 41);
  }
  // The tavern: a striped terrace awning on posts, tables and stools, barrels, carpets either side of the door, a
  // shade sail on the roof terrace.
  {
    const b = roleBlock('tavern'), fr = frames.get(b.id)!, G = geometryOf(b), F = fr.faces[b.door!];
    awning(F, .3, F.L - .3, 3.05, 2.4, .55, '#b5532c', true, true, 51);
    const yaw = faceYaw(F.N), at = (u: number, n: number) => facePoint(F, u, 0).addScaledVector(F.N, n);
    for (const [u, n] of [[1.5, 1.4], [F.L - 1.5, 1.4]]) {
      const p = at(u, n); prop('Table_Large', p.x, height(p.x, p.z), p.z, yaw + Math.PI / 2, .8);
      for (const s of [-1, 1]) { const q = p.clone().addScaledVector(F.U, s * .95); prop('Stool', q.x, height(q.x, q.z), q.z, s); }
      const m = p.clone(); prop('Mug', m.x, height(m.x, m.z) + .7, m.z, 1);
    }
    for (const [u, n, k] of [[.35, .5, 0], [F.L - .35, .45, 1], [F.L - .35, 1.1, 2]] as const) { const p = at(u, n); prop(k === 2 ? 'Barrel_Holder' : 'Barrel', p.x, height(p.x, p.z), p.z, k); }
    for (const s of [-1, 1]) wallCarpet(F, F.L / 2 + s * 1.75, .55, 1.15, 1.75, s < 0 ? '#7a2f3a' : '#2b3a7a', 60 + s);
    const yR = G.roof, hw = b.w / 2 - .7, hd = b.d / 2 - .7;
    sail([new V(b.x - hw, yR + 2.4, b.z - hd), new V(b.x + hw, yR + 2.1, b.z - hd), new V(b.x + hw, yR + 2.4, b.z + hd * .1), new V(b.x - hw, yR + 2.1, b.z + hd * .1)], '#e3a21a', 52, [yR, yR, yR, yR]);
    for (const s of [-1, 1]) { sheet(new V(b.x + s * 1.2 - .7, yR + .02, b.z - 1.6), new V(b.x + s * 1.2 + .7, yR + .02, b.z - 1.6), new V(b.x + s * 1.2 + .7, yR + .02, b.z + .2), new V(b.x + s * 1.2 - .7, yR + .02, b.z + .2), s < 0 ? '#7a2f3a' : '#2b3a7a', CL.rug, 0, () => 0, 53 + s, 2, 2, false); stats.rugs++; }
    glows.push({pos: facePoint(F, F.L / 2, 2.9).addScaledVector(F.N, .2), size: 1.1});
  }
  // The spice shop: a saffron-striped awning, baskets of spice heaped on a low platform, sacks, carpets on the wall.
  {
    const b = roleBlock('shop'), fr = frames.get(b.id)!, F = fr.faces[b.door!];
    awning(F, .1, F.L - .1, 2.95, 1.9, .5, '#e3a21a', true, true, 71);
    const at = (u: number, n: number) => facePoint(F, u, 0).addScaledVector(F.N, n);
    const spices = ['#c0421c', '#e3a21a', '#8a4a22', '#d9b23a', '#6e1f22', '#5b6b2a', '#b5532c', '#e6c35a'];
    const plat = at(F.L / 2, 1.05), yaw = faceYaw(F.N);
    wood(new THREE.BoxGeometry(F.L - .6, .3, .9), trs(plat.x, height(plat.x, plat.z) + .15, plat.z, yaw), '#6b4a2e', 0);
    for (let i = 0; i < 8; i++) {
      const u = .55 + (F.L - 1.1) * (i % 4 + .5) / 4, n = i < 4 ? .8 : 1.35, p = at(u, n);
      basket(p.x, height(p.x, p.z) + (i < 4 ? .3 : .3), p.z, spices[i], i * 3.1);
    }
    for (const [u, n] of [[.2, 2.1], [F.L - .25, 2.05]]) { const p = at(u, n); prop('Bag', p.x, height(p.x, p.z), p.z, u); }
    for (const s of [-1, 1]) wallCarpet(F, F.L / 2 + s * (F.L / 2 - .05), .35, .62, 1.9, s < 0 ? '#b5532c' : '#2b3a7a', 80 + s);
    // A stack of rolled carpets: two on the ground, one on top.
    const rc = at(F.L - .45, 2.75);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.CylinderGeometry(.13, .13, 1.3, 10).rotateZ(Math.PI / 2).rotateY(yaw);
      cloth.a3 = [0, CL.plain, 90 + i]; cloth.col.set(['#7a2f3a', '#2b3a7a', '#b5532c'][i]);
      const p = rc.clone().addScaledVector(F.N, i === 0 ? .14 : i === 1 ? -.14 : 0);
      cloth.geo(g, new THREE.Matrix4().makeTranslation(p.x, height(p.x, p.z) + .13 + (i === 2 ? .23 : 0), p.z), 1);
      g.dispose();
    }
  }
  // The healer: a green door under a striped green canopy, herbs in pots, the well with its tiled curb, frame,
  // pulley and bucket.
  {
    const b = roleBlock('healer'), fr = frames.get(b.id)!, F = fr.faces[b.door!];
    awning(F, F.L / 2 - 1.1, F.L / 2 + 1.1, 2.75, 1.1, .35, '#3f6e4a', true, false, 81);
    const at = (u: number, n: number) => facePoint(F, u, 0).addScaledVector(F.N, n);
    const herbs = ['Plant_1', 'Plant_7_Big', 'Bush_Common_Flowers', 'Plant_1', 'Plant_7'];
    [.45, 1.0, F.L - 1.0, F.L - .45].forEach((u, i) => { const p = at(u, .45); pot(p.x, height(p.x, p.z), p.z, .9 + (i % 2) * .25, i + 3, herbs[i % herbs.length]); });
    const cp = at(F.L - .4, 1.4); prop('Cauldron', cp.x, height(cp.x, cp.z), cp.z, 0, .8);
    const sp = at(.5, 1.5); prop('Shelf_Simple', sp.x, height(sp.x, sp.z), sp.z, faceYaw(F.N) + Math.PI / 2, .8);
    const {x: wx, z: wz, r: wr} = DAWN_WELL, wy = height(wx, wz);
    wall.col.set('#d9a86a'); wall.k = FIN.ashlar; wall.gy = wy; wall.top = wy + 1;
    const curb = lathe([[wr - .26, wy + .78], [wr - .22, wy + .84], [wr + .02, wy + .84], [wr + .06, wy + .78], [wr + .02, wy + .74]], 24);
    wall.geo(curb, new THREE.Matrix4().makeTranslation(wx, 0, wz)); curb.dispose();
    const wallR = lathe([[wr + .08, wy - .3], [wr, wy + .74]], 24);
    craft.a3 = [CR.tile, 0, 7]; craft.col.set('#ffffff');
    const band = lathe([[wr + .02, wy + .2], [wr + .02, wy + .62]], 24);
    wall.geo(wallR, new THREE.Matrix4().makeTranslation(wx, 0, wz)); wallR.dispose();
    craft.geo(band, new THREE.Matrix4().makeTranslation(wx, 0, wz).multiply(new THREE.Matrix4().makeScale(1.012, 1, 1.012))); band.dispose();
    const inner = lathe([[wr - .26, wy + .78], [wr - .26, wy - .6]], 24);
    inner.scale(1, 1, 1);
    const ii = inner.getAttribute('normal') as THREE.BufferAttribute; for (let i = 0; i < ii.count; i++) ii.setXYZ(i, -ii.getX(i), -ii.getY(i), -ii.getZ(i));
    const idx = inner.index!; for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
    wall.ao = .5; wall.geo(inner, new THREE.Matrix4().makeTranslation(wx, 0, wz)); wall.ao = 1; inner.dispose();
    craft.a3 = [CR.room, 0, 1]; craft.col.set('#ffffff');
    const water = new THREE.CircleGeometry(wr - .26, 20).rotateX(-Math.PI / 2);
    craft.geo(water, new THREE.Matrix4().makeTranslation(wx, wy + .1, wz)); water.dispose();
    // Frame, axle, rope and bucket.
    for (const s of [-1, 1]) wood(new THREE.BoxGeometry(.12, 2.1, .12), trs(wx + s * (wr - .05), wy + 1.05 + .3, wz), null, 0, new V(0, 1, 0));
    wood(new THREE.CylinderGeometry(.05, .05, wr * 2 + .2, 8).rotateZ(Math.PI / 2), trs(wx, wy + 2.25, wz), null, 0, new V(1, 0, 0));
    wood(new THREE.CylinderGeometry(.16, .16, .1, 12).rotateZ(Math.PI / 2), trs(wx, wy + 2.25, wz), '#3a2a1e', .6, new V(1, 0, 0));
    ropes.push(tube([new V(wx, wy + 2.1, wz), new V(wx, wy + 1.15, wz)], () => .013, 4));
    prop('Bucket_Wooden_1', wx, wy + .82, wz + .02, .4, .9);
    wall.gy = 0;
  }

  // ---- Roof life -----------------------------------------------------------------------------------------------
  for (const b of blocks) {
    if (b.role === 'wall' || b.role === 'shrine' || b.role === 'bridge') continue;
    const R = rng(b.seed * 3 + 1), fr = frames.get(b.id)!, G = geometryOf(b), yR = G.roof;
    const ix = b.w / 2 - .75, iz = b.d / 2 - .75;
    // Places on the roof: the four quadrants minus the windcatcher's and the chimney's.
    const free: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const taken = (qx: number, qz: number) => (b.wind && Math.sign(b.wind.dx || 1e-3) === qx && (b.wind.dz === 0 || Math.sign(b.wind.dz) === qz)) || (b.role === 'forge' && qz < 0);
    const spots = free.filter(([qx, qz]) => !taken(qx, qz));
    const at = (q: [number, number], fx = .5, fz = .5) => new V(b.x + q[0] * ix * fx, yR, b.z + q[1] * iz * fz);
    const items = ['jars', 'rug', 'laundry', 'garden', 'sail', 'hut'];
    const pick = items.filter(() => R() < .55).slice(0, Math.min(spots.length, b.w * b.d > 30 ? 3 : 2));
    if (!pick.length) pick.push('jars');
    if (b.role === 'tavern') pick.length = 0;
    pick.forEach((it, i) => {
      const q = spots[i];
      if (!q) return;
      if (it === 'jars') {
        const p = at(q, .6, .6);
        for (let k = 0; k < 3 + Math.floor(R() * 3); k++) jar(p.x + (R() - .5) * .9, yR, p.z + (R() - .5) * .9, .8 + R() * .5, R() < .3 ? ['#2a6f9a', '#2aa3a0', '#3b4f8a'][k % 3] : null, k + b.seed);
      } else if (it === 'rug') {
        const f: DawnFace = b.x > 0 ? 'x-' : 'x+', F = fr.faces[f];
        parapetRug(fr, F, F.L * (.3 + R() * .4), .95 + R() * .3, 1.0 + R() * .4, CLOTH[Math.floor(R() * CLOTH.length)], b.seed + i);
      } else if (it === 'laundry') {
        const p = at(q, .4, .4), along = b.w > b.d ? new V(1, 0, 0) : new V(0, 0, 1), L = Math.min(b.w > b.d ? b.w : b.d, 6) - 1.8;
        laundry(p.clone().addScaledVector(along, -L / 2).add(new V(0, 1.75, 0)), p.clone().addScaledVector(along, L / 2).add(new V(0, 1.75, 0)), R);
      } else if (it === 'garden') {
        const p = at(q, .55, .55);
        wall.col.set(DAWN_TINTS[b.tint]); wall.k = FINISH[b.tint]; wall.gy = yR; wall.top = yR + .5;
        box(wall, p.x, yR + .22, p.z, 1.5, .44, .8);
        craft.a3 = [CR.spice, 0, 2]; craft.col.set('#3d2a1c'); box(craft, p.x, yR + .445, p.z, 1.3, .01, .6, 0, 16);
        for (let k = 0; k < 3; k++) plant(['Plant_1', 'Bush_Common_Flowers', 'Plant_7'][k], p.x - .45 + k * .45, yR + .44, p.z, R() * 6, .45 + R() * .15);
        pot(p.x + .9, yR, p.z + .5, .9, b.seed + 2, 'Plant_7_Big');
        stats.gardens++;
      } else if (it === 'sail') {
        const c = at(q, .45, .45), hx = Math.min(1.5, ix * .7), hz = Math.min(1.4, iz * .7);
        sail([new V(c.x - hx, yR + 2.2, c.z - hz), new V(c.x + hx, yR + 1.9, c.z - hz), new V(c.x + hx, yR + 2.2, c.z + hz), new V(c.x - hx, yR + 1.9, c.z + hz)], CLOTH[Math.floor(R() * CLOTH.length)], b.seed, [yR, yR, yR, yR]);
        sheet(new V(c.x - .7, yR + .02, c.z - .5), new V(c.x + .7, yR + .02, c.z - .5), new V(c.x + .7, yR + .02, c.z + .5), new V(c.x - .7, yR + .02, c.z + .5), CLOTH[(b.seed + 1) % CLOTH.length], CL.rug, 0, () => 0, b.seed + 5, 2, 2, false);
        stats.rugs++;
      } else if (it === 'hut' && b.h > 5) {
        const p = at(q, .55, .55);
        wall.col.set(DAWN_TINTS[b.tint]); wall.k = FINISH[b.tint];
        const f: DawnFace = b.x > 0 ? 'x-' : 'x+';
        block(wall, craft, {cx: p.x, cz: p.z, w: 1.7, d: 1.7, base: yR - .1, ground: yR - .1, roof: yR + 2.15, para: .25, r: .2, batter: .01, holes: {[f]: [{u0: .2, u1: .95, v0: .1, v1: 1.95, arch: true, depth: .25, kind: CR.door, color: PAINT[(b.seed + 3) % PAINT.length]}]}, thick: .2});
        wall.gy = G.ground;
      } else {
        const p = at(q, .6, .6);
        for (let k = 0; k < 2; k++) jar(p.x + (R() - .5) * .6, yR, p.z + (R() - .5) * .6, .9 + R() * .3, null, k + b.seed);
      }
    });
    wall.gy = G.ground;
  }
  // Ladders from a lower roof up to a taller neighbour's parapet.
  for (const a of blocks) for (const b of blocks) {
    if (a === b || a.role === 'wall' || b.role === 'wall' || a.lift || b.lift || a.role === 'shrine') continue;
    const ga = geometryOf(a), gb = geometryOf(b);
    if (gb.top - ga.roof < 2.4) continue;
    const gapX = Math.abs(a.x - b.x) - (a.w + b.w) / 2, gapZ = Math.abs(a.z - b.z) - (a.d + b.d) / 2;
    const overZ = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2), overX = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
    let foot: THREE.Vector3 | null = null, topP: THREE.Vector3 | null = null;
    if (gapX > -.3 && gapX < 1.2 && overZ > 2) {
      const s = Math.sign(b.x - a.x), z = Math.max(a.z - a.d / 2, b.z - b.d / 2) + overZ * .65, xw = b.x - s * (b.w / 2 - .02);
      foot = new V(xw - s * 1.15, ga.roof, z); topP = new V(xw - s * .25, gb.top + .45, z);
    } else if (gapZ > -.3 && gapZ < 1.2 && overX > 2) {
      const s = Math.sign(b.z - a.z), x = Math.max(a.x - a.w / 2, b.x - b.w / 2) + overX * .35, zw = b.z - s * (b.d / 2 - .02);
      foot = new V(x, ga.roof, zw - s * 1.15); topP = new V(x, gb.top + .45, zw - s * .25);
    }
    if (!foot || !topP) continue;
    // Only within the lower roof.
    if (Math.abs(foot.x - a.x) > a.w / 2 - .5 || Math.abs(foot.z - a.z) > a.d / 2 - .5) continue;
    ladder(foot, topP);
  }

  // ---- Street scenes -------------------------------------------------------------------------------------------
  // Big water jars and herb pots at the lane-head doors; benches in the shrine forecourt shade; carpets on walls.
  for (const b of blocks) {
    if (!b.door || b.role !== 'house') continue;
    const fr = frames.get(b.id)!, F = fr.faces[b.door], R = rng(b.seed + 9);
    const at = (u: number, n: number) => facePoint(F, u, 0).addScaledVector(F.N, n);
    const p = at(F.L / 2 - 1.3, .42); jar(p.x, height(p.x, p.z), p.z, 1.25, null, b.seed);
    const q = at(F.L / 2 - 1.85, .38); pot(q.x, height(q.x, q.z), q.z, 1, b.seed + 1, R() < .5 ? 'Plant_7_Big' : 'Plant_1');
    if (b.seed % 3 === 0) wallCarpet(F, F.L / 2 + 1.9, .6, .85, 1.35, CLOTH[b.seed % CLOTH.length], b.seed);
    if (b.seed % 3 === 1) awning(F, F.L / 2 - 1.05, F.L / 2 + 1.05, 2.75, .9, .3, CLOTH[b.seed % CLOTH.length], b.seed % 2 === 0, false, b.seed);
  }
  // The walled yard (lane 26 east): a shade sail from the wall over a bench and jars.
  {
    const w = byId.get('e-26w')!, yy = height(w.x, w.z);
    sail([new V(w.x + .3, yy + 2.5, w.z - 2.4), new V(w.x + 3.6, yy + 2.1, w.z - 2.4), new V(w.x + 3.6, yy + 2.1, w.z + 1.6), new V(w.x + .3, yy + 2.5, w.z + 1.6)], '#2b3a7a', 31, [yy, yy, yy, yy]);
    prop('Bench', w.x + 1.0, yy, w.z, Math.PI / 2);
    for (let k = 0; k < 3; k++) jar(w.x + 3.4, yy, w.z + 1.2 - k * .5, 1.1, null, k);
  }
  // Palms.
  const palms = dawnPalmGrove(craft, dawnPalms(), height, 77);
  stats.palms = palms.count;

  // ---- Meshes --------------------------------------------------------------------------------------------------
  const plaster = dawnPlaster(), craftM = dawnCraft(), clothM = dawnCloth(), woodM = dawnWood('goldsand-wood');
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string, cast = true) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = cast; o.receiveShadow = true; group.add(o); return o; };
  mesh(wall.build(), plaster, 'goldsand-walls');
  mesh(craft.build(), craftM, 'goldsand-craft');
  mesh(cloth.build(), clothM, 'goldsand-cloth');
  if (woods.length) { const g = mergeGeometries(woods, false)!; woods.forEach(w => w.dispose()); mesh(g, woodM, 'goldsand-wood'); }
  if (ropes.length) { const g = mergeGeometries(ropes.map(r => { const o = r.index ? r.toNonIndexed() : r; for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal') o.deleteAttribute(k); return o; }), false)!; mesh(g, dawnRope(), 'goldsand-ropes', false); }
  group.add(palms.mesh);
  group.add(props.build());
  group.add(plants.build({boundsPadding: .3}));
  const glow = dawnGlows(glows, '#ffb35a', 'goldsand-fire-glows');
  group.add(glow);
  group.userData.stats = stats;
  return {
    group, doors, stats,
    update(time) {
      clothM.userData.time.value = time; palms.update(time);
      (glow.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    },
  };
}
