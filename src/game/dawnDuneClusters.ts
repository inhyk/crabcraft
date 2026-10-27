import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {rng} from '../world/noise';
import {addPatch} from '../world/materials';
import {FROST_NOISE} from './frostPaving';
import {DAWN_WIND} from '../sim/world/dawnGround';
import type {Collision} from '../world/collision';

/*
 * Goldsand's open desert tells what happened in it (World III). A handful of clusters placed by design, not
 * scattered: each one stands where a standard view's middle ground needs a focus, on a crest or at the top of a slip
 * face so a few objects silhouette large against the low sun, and the dune faces round them stay bare.
 *  - a caravanserai's ruined corner on the western caravan road: an ashlar wall corner, its courses stepping down
 *    where the sand took the stones, a toppled column of fluted drums, a standing stump, its capital on its side;
 *  - a fallen obelisk on the eastern dunes, its broken foot in the sand and its gilded tip in the air;
 *  - a merchant's lost cargo of amphorae, upright, tipped and broken, half buried (and a second cache by the shore);
 *  - a camel that did not make it, ribs and spine bleached under a dead acacia, at the end of a caravan track;
 *  - a palm-frond wind fence half drowned on its windward side, guarding the town's western edge.
 * Caravan tracks (paired ruts and the pads between them) cross the dunes to the ruin and the bones, and dry scrub
 * grows in the lee of each cluster. Everything solid is one merged mesh and one draw (sandstone, terracotta, bone,
 * palm wood and gilt told apart per vertex), the tracks one draw, the scrub the kit's instanced draws.
 * Solid pieces taller than ~0.6 m are registered as colliders (registerDuneClusters, the server bake).
 */

export type DuneClusterKind = 'ruin' | 'obelisk' | 'amphorae' | 'bones' | 'fence';
export interface DuneCluster {id: string; kind: DuneClusterKind; x: number; z: number; yaw: number}

/** The clusters, each where a view needs it; clear of paths, play zones, the arena and every quest, NPC and enemy point. */
export const DUNE_CLUSTERS: readonly DuneCluster[] = [
  // West view's middle ground behind the crab: the caravan road's halt (aerial west).
  {id: 'caravanserai', kind: 'ruin', x: -74, z: 1, yaw: 2.6},
  // East view: framed between the palms, against the bright sea.
  {id: 'fallen-obelisk', kind: 'obelisk', x: 79, z: -4, yaw: 2.5},
  // Dunes view: on the crest, at the end of the lost caravan's track.
  {id: 'lost-camel', kind: 'bones', x: -109, z: -29, yaw: -.5},
  // Dunes2 view: the town's western edge, a long silhouette across the frame against the town and the sun.
  {id: 'west-fence', kind: 'fence', x: -101, z: 32, yaw: 2.2},
  {id: 'west-cargo', kind: 'amphorae', x: -94, z: 38, yaw: .4},
  // Aerial: the eastern shore's beached cargo.
  {id: 'shore-cargo', kind: 'amphorae', x: 84, z: 44, yaw: -.8},
];

/** Caravan tracks over the dunes (x, z polylines): the western road to the ruin and the town, the eastern road past the obelisk, the lost caravan's last track. */
export const DUNE_TRACKS: readonly (readonly (readonly [number, number])[])[] = [
  [[-165, -14], [-138, -8], [-112, -3], [-92, -1], [-80, 3], [-70, 8], [-64, 20], [-62, 32]],
  [[100, 34], [92, 18], [86, 6], [84, -10], [82, -30], [76, -46]],
  [[-170, -56], [-150, -48], [-132, -38], [-115, -31]],
];

type Kind = 0 | 1 | 2 | 3 | 4 | 5; // sandstone, terracotta, bone, palm wood, gilt, carved rose granite
/** `local`: each vertex where it stood before placing (the granite's glyph columns are carved in it). */
interface Piece {g: THREE.BufferGeometry; kind: Kind; color: THREE.Color; local: Float32Array}
interface Solid {x: number; z: number; r: number; h: number}

// Linear, the boulders' beds (dawnBoulders.ts): honey, ochre-red, cream, iron-brown.
const STONE = [[.68, .45, .26], [.62, .38, .2], [.74, .55, .34], [.58, .36, .21]].map(([r, g, b]) => new THREE.Color(r, g, b));
const GRANITE = new THREE.Color(.5, .27, .2);
const CLAY = ['#b5532c', '#a6502f', '#c06a3e', '#9a4a2a'].map((c) => new THREE.Color(c));
const BONE = new THREE.Color(.86, .8, .68), WOOD = new THREE.Color('#8a6a48'), FROND = new THREE.Color('#9d8456'), GILT = new THREE.Color('#c9a24a');

/** Plain non-indexed position + normal geometry. */
function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  if (out !== g) g.dispose();
  return out;
}
/** Concave flutes round a cylinder's side (cylinder along y). */
function flute(g: THREE.BufferGeometry, n: number, depth: number) {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const a = Math.atan2(z, x), k = 1 - depth * Math.pow(.5 + .5 * Math.cos(a * n), 3);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
}
/** Break a drum's top: the upper cap and rim lowered by a jagged noise. */
function breakTop(g: THREE.BufferGeometry, top: number, depth: number, R: () => number) {
  const p = g.getAttribute('position'), ph = R() * 6;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < top - 1e-3) continue;
    const a = Math.atan2(p.getZ(i), p.getX(i)), r = Math.hypot(p.getX(i), p.getZ(i));
    p.setY(i, top - depth * (.5 + .5 * Math.sin(a * 3 + ph)) * (.4 + .6 * r) - depth * .3 * Math.abs(Math.sin(a * 7 + ph * 2)));
  }
}
/** An amphora's profile (radius, height), 1 m tall: pointed foot, belly, shoulder, neck, everted rim. */
const AMPHORA: [number, number][] = [[0, 0], [.05, .02], [.07, .08], [.14, .2], [.2, .36], [.21, .48], [.18, .62], [.1, .72], [.065, .78], [.06, .9], [.085, .94], [.075, .97], [.05, .965], [.05, .9]];

export interface DuneClusterParts {pieces: Piece[]; solids: Solid[]; scrub: [number, number, number][]; tree: [number, number, number] | null}

/** Every piece of every cluster, placed in the world on `height`. Pure layout (the meshes and the server bake both read it). */
export function duneClusterParts(height: (x: number, z: number) => number): DuneClusterParts {
  const pieces: Piece[] = [], solids: Solid[] = [], scrub: [number, number, number][] = [];
  let tree: [number, number, number] | null = null;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const [ci, c] of DUNE_CLUSTERS.entries()) {
    const R = rng(4111 + ci * 97), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    // Cluster-local (u along, w across) to world.
    const wx = (u: number, w: number) => c.x + u * cy - w * sy, wz = (u: number, w: number) => c.z + u * sy + w * cy;
    /** Place geometry `g` with its origin at local (u, w), `dy` over the ground there, turned by (rx, ry, rz) after the cluster yaw. */
    const put = (g: THREE.BufferGeometry | null, kind: Kind, color: THREE.Color, u: number, w: number, dy: number, rx = 0, ry = 0, rz = 0) => {
      const x = wx(u, w), z = wz(u, w), y = height(x, z) + dy, tone = .92 + R() * .16;
      if (!g) return y;
      q.setFromEuler(e.set(rx, ry - c.yaw, rz, 'YXZ'));
      const flatG = plain(g), local = new Float32Array(flatG.getAttribute('position').array);
      flatG.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
      pieces.push({g: flatG, kind, color: color.clone().multiplyScalar(tone), local});
      return y;
    };
    const solid = (u: number, w: number, r: number, h: number) => solids.push({x: wx(u, w), z: wz(u, w), r, h});
    const tuft = (u: number, w: number) => scrub.push([wx(u, w), wz(u, w), R()]);
    const stone = () => STONE[Math.floor(R() * STONE.length)];
    const block = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(.06, h * .15));
    if (c.kind === 'ruin') {
      // The wall corner: arm A along u, arm B along w; courses step down away from the corner, the top ones missing.
      const course = .62, bl = .95;
      for (const arm of [0, 1]) {
        const len = arm ? 4.2 : 6.6, n = Math.round(len / bl);
        // Courses of ashlar of uneven length, laid in stretcher bond; the wind has rounded the arrises, rocked the top
        // stones and taken some out of the face.
        for (let k = 0; k < 7; k++) {
          let a = k % 2 ? -bl * .45 : 0;
          while (a < len) {
            const L = Math.min(bl * (.75 + R() * .7), len - Math.max(a, 0)), mid = Math.max(a, 0) + L / 2;
            const top = Math.max(1, Math.round((arm ? 4.4 : 5.6) * (1 - mid / (len + .8)) + R() * .9));
            a += L;
            if (L < .3 || k >= top || (k === top - 1 && k > 0 && R() < .3) || (k > 0 && k < top - 1 && R() < .07)) { R(); R(); R(); continue; }
            const loose = k === top - 1 ? 1 : .25, h = course * (.9 + R() * .12);
            const g = new RoundedBoxGeometry(L - .03, h, .84 - R() * .1, 2, .09);
            put(g, 0, stone(), arm ? .42 : mid, arm ? mid : .42, -.35 + k * course + h / 2, (R() - .5) * .04 * loose, (arm ? Math.PI / 2 : 0) + (R() - .5) * .08 * loose, (R() - .5) * .06 * loose);
          }
        }
        for (let i = 0; i < n; i++) {
          const along = (i + .5) * bl, top = Math.max(1, Math.round((arm ? 4.4 : 5.6) * (1 - along / (len + .8))));
          if (top * course - .35 > .6) solid(arm ? .42 : along, arm ? along : .42, .62, top * course);
        }
      }
      // Blocks fallen from the courses, lying in the sand in front of the wall.
      for (let i = 0; i < 4; i++) put(block(bl, course, .84), 0, stone(), 1.6 + R() * 3.6, 1.7 + R() * 1.8, -.14, (R() - .5) * .5, R() * 3, (R() - .5) * .4);
      // The toppled column: four fluted drums in a broken line, half sunk.
      const col = (r: number, h: number) => { const g = new THREE.CylinderGeometry(r, r, h, 40, 2); flute(g, 16, .07); g.computeVertexNormals(); return g; };
      for (let i = 0; i < 4; i++) put(col(.5, .95), 0, stone(), 3.6 + i * 1.05 + (R() - .5) * .15, 5 + i * .3 + (R() - .5) * .3, .16, Math.PI / 2 + (R() - .5) * .08, .3 + (R() - .5) * .25, 0);
      solid(5.2, 5.5, 1.5, .8);
      // The stump standing on its base, broken off at chest height.
      // A column still standing on its base, drum on drum, broken off high: the silhouette the ruin is seen by.
      for (let i = 0; i < 4; i++) put(col(.54 - i * .015, .95), 0, stone(), -1.8 + (R() - .5) * .03, 4 + (R() - .5) * .03, .1 + .475 + i * .95, (R() - .5) * .02, R() * 6, (R() - .5) * .02);
      const stump = (() => { const g = new THREE.CylinderGeometry(.47, .48, 1.2, 40, 4); flute(g, 16, .07); breakTop(g, .6, .5, R); g.computeVertexNormals(); return g; })();
      put(stump, 0, stone(), -1.8, 4, .1 + 3.8 + .6, 0, R(), 0);
      put(block(1.45, .4, 1.45), 0, stone(), -1.8, 4, -.1, 0, R(), 0);
      solid(-1.8, 4, .8, 4.9);
      // Its capital on its side: abacus slab and echinus.
      const cap = (() => { const a = new RoundedBoxGeometry(1.1, .28, 1.1, 2, .04); a.translate(0, .42, 0); const ech = new THREE.LatheGeometry([[.4, 0], [.44, .06], [.56, .2], [.58, .28]].map(([r, y]) => new THREE.Vector2(r, y)), 32); return mergeGeometries([plain(a), plain(ech)])!; })();
      put(cap, 0, stone(), -3, 1.4, .3, 1.35, R(), .2);
      for (const [u, w] of [[-.7, -1], [1.3, 3], [7, 1.1], [3, 7], [-2.6, 2.8], [-3.4, 5.6]]) tuft(u, w);
    } else if (c.kind === 'obelisk') {
      // Shaft tapering to a gilt pyramidion, lying with its broken foot in the sand and its tip in the air.
      const L = 10.5, b0 = 1.25, b1 = .8;
      // Square in section, so flat faces: non-indexed normals.
      const flat = (g: THREE.BufferGeometry) => { const f = g.toNonIndexed(); g.dispose(); f.computeVertexNormals(); return f; };
      const shaft = flat(new THREE.CylinderGeometry(b1 / Math.SQRT2, b0 / Math.SQRT2, L, 4, 6).rotateY(Math.PI / 4).translate(0, L / 2, 0));
      const pyr = flat(new THREE.ConeGeometry(b1 / Math.SQRT2, .7, 4, 1).rotateY(Math.PI / 4).translate(0, L + .35, 0));
      const tilt = -1.0, foot = -1.6; // from upright toward +u: the shaft rises at about 33 degrees
      put(shaft, 5, GRANITE, 0, 0, foot, 0, .1, tilt);
      put(pyr, 4, GILT, 0, 0, foot, 0, .1, tilt);
      for (let t = 1.5; t < L; t += 1.5) { const h = foot + Math.cos(tilt) * t + .6; if (h > .6) solid(Math.sin(-tilt) * t, 0, .8, h); }
      // Its plinth, tipped, and two chips knocked off the shaft.
      put(block(2, .9, 2), 0, stone(), -2.2, -1.8, -.25, .25, .4, -.18);
      solid(-2.2, -1.8, 1.2, .8);
      for (let i = 0; i < 3; i++) put(block(.6 + R() * .4, .42, .55), 5, GRANITE, 2.4 + i * 2.1, 1.6 - i * 1.7, -.1, R(), R() * 3, R());
      for (const [u, w] of [[-3.2, .8], [1.6, -2], [7.5, 1.6], [4, 2.4]]) tuft(u, w);
    } else if (c.kind === 'amphorae') {
      // Upright and half sunk, tipped against each other, one lying, one broken with its sherds about it.
      const jar = (broken: number) => {
        const prof = broken ? AMPHORA.filter(([, y]) => y < broken).concat([[.2, broken], [.185, broken - .01]]) : AMPHORA;
        const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
        if (broken) { breakTop(g, broken, .1, R); g.computeVertexNormals(); return g; }
        // Two strap handles from the neck to the shoulder.
        const parts = [plain(g)];
        for (const s of [-1, 1]) { const h = new THREE.TorusGeometry(.075, .017, 5, 10, Math.PI); h.rotateZ(s > 0 ? -Math.PI / 2 : Math.PI / 2); h.translate(s * .075, .8, 0); parts.push(plain(h)); }
        return mergeGeometries(parts)!; };
      const spots: [number, number, number, number, number][] = [[0, 0, -.32, 0, 0], [.45, .2, -.4, .15, .1], [.15, .6, -.25, -.35, 0], [-.6, .3, -.12, 0, 1.45], [1.2, -.5, -.3, .5, .2], [-.2, -.7, -.2, 0, 0]];
      for (const [i, [u, w, dy, rx, rz]] of spots.entries()) put(jar(i === 2 ? .55 : 0), 1, CLAY[i % CLAY.length], u, w, dy, rx, R() * 6, rz);
      for (let i = 0; i < 6; i++) { const g = new THREE.CylinderGeometry(.2, .2, .02, 6, 1, true, 0, .7 + R() * .6); g.scale(1, 1 + R() * 3, 1); put(g, 1, CLAY[i % 4], .4 + R() * 1.4, .8 + R() * 1.1, .02, R() * 3, R() * 6, R() * 3); }
      solid(.2, .1, 1.1, .7);
      for (const [u, w] of [[-1.4, -.4], [1.8, .9], [.6, -1.6]]) tuft(u, w);
    } else if (c.kind === 'bones') {
      // Spine along u, half buried; ribs arching up out of the sand in pairs; the skull at the head end.
      const spineY = -.08;
      for (let i = 0; i < 12; i++) { const g = new THREE.CylinderGeometry(.1, .11, .18, 8, 1); g.rotateZ(Math.PI / 2); const v = new THREE.SphereGeometry(.09, 6, 4); v.scale(.7, 1.8, .7); v.translate(0, .16, 0); put(mergeGeometries([plain(g), plain(v)]), 2, BONE, i * .26 - 1.4, Math.sin(i * .4) * .06, spineY + Math.sin(i / 11 * Math.PI) * .12, 0, 0, 0); }
      for (let i = 0; i < 7; i++) for (const s of [-1, 1]) {
        
        const len = 1.25 - Math.abs(i - 2.5) * .1, rise = 1.05 - Math.abs(i - 2.8) * .08, sag = R() * .12;
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(.04, rise * .85, s * len * .45), new THREE.Vector3(.08, rise * (.75 - sag), s * len * .85), new THREE.Vector3(.1, -.2, s * len * 1.08)]);
        put(new THREE.TubeGeometry(curve, 16, .045, 6, false), 2, BONE, i * .26 - .65, 0, spineY + .04, 0, (R() - .5) * .12, (R() - .5) * .1);
      }
      solid(.2, 0, 1.4, 1.1);
      // Skull: cranium, long tapering snout, the jaw a little apart.
      const skull = (() => { const cr = new THREE.SphereGeometry(.17, 12, 8); cr.scale(1.2, .85, .9); const sn = new THREE.CylinderGeometry(.07, .12, .42, 9, 2); sn.rotateZ(Math.PI / 2); sn.translate(-.32, -.04, 0); const jaw = new THREE.CylinderGeometry(.035, .06, .48, 7, 1); jaw.rotateZ(Math.PI / 2 - .25); jaw.translate(-.28, -.16, 0); return mergeGeometries([plain(cr), plain(sn), plain(jaw)])!; })();
      skull.scale(1.35, 1.35, 1.35);
      put(skull, 2, BONE, -2, .3, .08, 0, .3, .25);
      // A leg bone or two dragged apart by jackals.
      for (let i = 0; i < 2; i++) { const g = new THREE.CylinderGeometry(.03, .035, .7, 6, 1); const k1 = new THREE.SphereGeometry(.055, 6, 4); k1.translate(0, .35, 0); const k2 = new THREE.SphereGeometry(.05, 6, 4); k2.translate(0, -.35, 0); put(mergeGeometries([plain(g), plain(k1), plain(k2)]), 2, BONE, .9 + i * .6, 1.1 + i * .5, .02, Math.PI / 2, R() * 3, 0); }
      tree = [wx(1.6, -1.9), wz(1.6, -1.9), R() * 6];
      solid(1.6, -1.9, .45, 3);
      for (const [u, w] of [[2.2, -1.2], [1, -2.6], [-2, -1.2], [2.6, 1.6]]) tuft(u, w);
    } else if (c.kind === 'fence') {
      // Stakes along u, a rail at two heights, frond stems lashed close between them; the windward side drowned.
      const len = 9, stakes = Math.round(len / 1.15);
      const bend = (u: number) => Math.sin(u / len * Math.PI) * .6;
      for (let i = 0; i <= stakes; i++) {
        const u = i * len / stakes - len / 2, lean = (R() - .5) * .2;
        put(new THREE.CylinderGeometry(.045, .055, 1.75, 6, 1), 3, WOOD, u, bend(u), .45, lean, 0, (R() - .5) * .15);
        if (i < stakes) {
          const ui = u + len / stakes / 2;
          for (const hy of [.25, .75]) { const r = new THREE.CylinderGeometry(.022, .022, len / stakes + .1, 5, 1); r.rotateZ(Math.PI / 2); put(r, 3, WOOD, ui, bend(ui) + .05, hy, 0, Math.atan2(bend(ui + .2) - bend(ui - .2), .4), 0); }
          // Frond stems: a gap where the wind tore some out.
          const gap = R() < .25 ? R() * .7 : -1;
          for (let s = .05; s < len / stakes - .04; s += .085) {
            const us = u + s;
            if (gap > 0 && Math.abs(s - gap) < .22) continue;
            const h = .9 + R() * .55;
            { const g = new THREE.BoxGeometry(.035, h, .07, 1, 3, 1); g.translate(0, h / 2, 0); const p = g.getAttribute('position'); for (let v = 0; v < p.count; v++) { const t = p.getY(v) / h; p.setX(v, p.getX(v) * (1 - t * .5)); p.setZ(v, p.getZ(v) * (1 - t * .6) + t * t * .12); } g.computeVertexNormals(); put(g, 3, FROND, us, bend(us) + (R() - .5) * .04, -.3, (R() - .5) * .08 - .08, (R() - .5) * .3, (R() - .5) * .1); }
          }
        }
        if (i < stakes) solid(u + len / stakes / 2, bend(u + len / stakes / 2), .4, 1.2);
      }
      for (const [u, w] of [[-3.2, -.9], [.4, -1.1], [3.6, -.8], [-1.6, 1.2]]) tuft(u, w);
    }
  }
  return {pieces, solids, scrub, tree};
}

/** The clusters' solids for the server bake: circles round each piece taller than ~0.6 m. */
export function registerDuneClusters(height: (x: number, z: number) => number, collision: Collision) {
  const parts = duneClusterParts(height);
  for (const p of parts.pieces) p.g.dispose();
  for (const s of parts.solids) {
    const y = height(s.x, s.z);
    collision.addCircle(s.x, s.z, s.r, y - .2, y + s.h);
  }
}

const HEAD = /* glsl */ `
uniform vec3 dcSand;
varying vec3 vDcW;
varying vec3 vDcN;
varying float vDcK;
varying float vDcA;
varying vec3 vDcL;
${FROST_NOISE}
float dcN3(vec3 p,vec3 w){return fpNoise(p.zy)*w.x+fpNoise(p.xz+3.1)*w.y+fpNoise(p.xy-7.7)*w.z;}
`;

function clusterMaterial(sand: THREE.Color): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-dune-clusters', color: '#ffffff', roughness: .88, vertexColors: true});
  addPatch(m, 'goldsand-dune-clusters', (shader) => {
    shader.uniforms.dcSand = {value: sand};
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDcK;\nattribute float aDcA;\nattribute vec3 aDcL;\nvarying vec3 vDcL;\nvarying vec3 vDcW;\nvarying vec3 vDcN;\nvarying float vDcK;\nvarying float vDcA;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDcW=(modelMatrix*vec4(transformed,1.)).xyz;vDcN=normalize(mat3(modelMatrix)*objectNormal);vDcK=aDcK;vDcA=aDcA;vDcL=aDcL;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 dN=normalize(vDcN),dA=abs(dN)/(abs(dN.x)+abs(dN.y)+abs(dN.z));
        float k=floor(vDcK+.5);
        float n1=dcN3(vDcW*1.3,dA)*.5+.5,n2=dcN3(vDcW*5.,dA)*.5+.5,n3=dcN3(vDcW*17.,dA)*.5+.5;
        vec3 c=diffuseColor.rgb;
        float rough=.9;
        if(k<.5){
          // Sandstone, weathered: grain, pits, faint laminae, iron stain and a paler wind-polished skin on the tops.
          float lam=sin(vDcW.y*34.+n1*3.)*.5+.5;
          c*=.86+.18*n2+.06*lam*(1.-dA.y)-.12*smoothstep(.68,.8,n3);
          c=mix(c,c*vec3(.82,.66,.55),smoothstep(.6,.85,n1)*.35);
          c=mix(c,c*1.1,smoothstep(.6,.95,dN.y)*.5);
        }else if(k<1.5){
          // Fired clay: mottled, slipped paler near the rim, dulled by dust.
          c*=.85+.25*n2;c=mix(c,c*vec3(1.15,1.1,1.),smoothstep(.55,.9,n1)*.4);
        }else if(k<2.5){
          // Bone: sun-bleached, hairline cracks and brown staining low down.
          c*=.92+.1*n2;c*=1.-.3*(1.-smoothstep(.0,.04,abs(fpNoise(vDcW.xz*9.+vDcW.y*4.))));
          c=mix(c,c*vec3(.8,.7,.55),(1.-smoothstep(.0,.25,vDcA))*.6);
        }else if(k<3.5){
          // Palm wood and frond stems: fibrous streaks along the stem, greyed by the sun.
          float fib=fpNoise(vec2(dot(vDcW.xz,vec2(13.,9.)),vDcW.y*1.5))*.5+.5;
          c*=.75+.4*fib*(.7+.3*n2);c=mix(c,vec3(.36,.33,.29),.25*n1);
        }else if(k>4.5){
          // Rose granite, speckled; glyph columns carved down each face of the obelisk (stone-local: y along the
          // shaft, the faces square to x and z).
          c*=.88+.14*n2;c=mix(c,vec3(.12,.1,.1),smoothstep(.72,.8,n3)*.5);c=mix(c,vec3(.75,.62,.55),smoothstep(.76,.84,dcN3(vDcW*23.,dA)*.5+.5)*.4);
          vec3 L=vDcL;float half_=mix(.625,.4,clamp(L.y/10.5,0.,1.));
          float acr=abs(L.x)>abs(L.z)?L.z:L.x,sx=acr/half_;
          if(abs(sx)<.62&&L.y>.6&&L.y<9.9&&max(abs(L.x),abs(L.z))>half_*.9){
            float row=floor(L.y/.24),col=floor((sx+.62)/.413);vec2 f=vec2(fract((sx+.62)/.413),fract(L.y/.24));
            float hsh=fract(sin(row*12.9898+col*78.233+floor(abs(L.x)>abs(L.z)?sign(L.x):sign(L.z)*2.)*3.1)*43758.55);
            float g=0.;vec2 d=f-.5;
            if(hsh<.25)g=step(abs(d.y),.09)*step(abs(d.x),.32);
            else if(hsh<.5)g=step(abs(d.x),.08)*step(abs(d.y),.33);
            else if(hsh<.75)g=step(abs(length(d)-.24),.06);
            else g=step(length(d-vec2(.15,0.)),.1)+step(length(d+vec2(.15,0.)),.1);
            float div=step(.94,fract((sx+.62)/.413));
            c*=1.-.35*clamp(g+div*.6,0.,1.);
          }
        }else{
          // Gilt, worn through to the stone in patches.
          float worn=smoothstep(.45,.7,n1*.7+n3*.3);
          c=mix(c,vec3(.5,.34,.2),worn*.6);rough=mix(.38,.85,worn);
        }
        // Blown sand banked at the foot (deepest on the windward side) and lodged on every upward face.
        float wind=max(0.,-dot(dN.xz,normalize(vec2(${DAWN_WIND[0].toFixed(4)},${DAWN_WIND[1].toFixed(4)}))));
        float skirt=1.-smoothstep(.02,(k<.5?.25:.12)+.18*n1+(k<.5?.6:.35)*wind,vDcA);
        float dust=smoothstep(.55,.95,dN.y+n2*.2)*smoothstep(.35,.7,n1)*.55;
        c=mix(c,dcSand*(.9+.15*n3),max(skirt,dust)*(k>1.5&&k<2.5?.45:1.));
        diffuseColor.rgb=c;
        float dcRough=mix(rough,.96,skirt);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=dcRough;');
  });
  return m;
}

/** Caravan tracks: paired ruts and the pads between them, a ribbon draped on the sand that darkens what is under it. */
function trackMesh(height: (x: number, z: number) => number): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const half = 1.05, across = [-1, -.5, 0, .5, 1];
  for (const line of DUNE_TRACKS) {
    let along = 0;
    const pts: [number, number][] = [];
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1], [bx, bz] = line[i], L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / .5);
      for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    // Smooth the corners (a caravan does not turn on a pin) with a few passes of averaging.
    for (let pass = 0; pass < 6; pass++) for (let i = 1; i < pts.length - 1; i++) pts[i] = [(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4];
    const base = pos.length / 3, total = pts.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i], [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
      if (i) along += Math.hypot(x - px, z - pz);
      let tx = nx - px, tz = nz - pz; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      for (const a of across) { const qx = x - tz * a * half, qz = z + tx * a * half; pos.push(qx, height(qx, qz) + .1, qz); uv.push(a * half, along, along / total); }
    }
    for (let i = 1; i < pts.length; i++) for (let j = 1; j < across.length; j++) {
      const a = base + (i - 1) * across.length + j - 1, b = a + 1, c = a + across.length, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTr', new THREE.Float32BufferAttribute(uv, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    name: 'goldsand-caravan-tracks', transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.MultiplyBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `attribute vec3 aTr;varying vec3 vTr;varying float vD;
      void main(){vTr=aTr;vec4 mv=modelViewMatrix*vec4(position,1.);vD=-mv.z;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: /* glsl */ `varying vec3 vTr;varying float vD;
      float h1(float n){return fract(sin(n*127.1)*43758.5453);}
      float vn(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(h1(i),h1(i+1.),f);}
      void main(){
        float u=vTr.x,v=vTr.y;
        // Two ruts .65 m off the middle, wandering a little; a darker shaded wall on one side, a lit lip on the other.
        float wob=(vn(v*.15)-.5)*.12;
        float r1=abs(u-.62-wob),r2=abs(u+.62-wob);
        float rut=1.-smoothstep(.06,.15,min(r1,r2));
        float wall=smoothstep(.0,.1,min(r1,r2))*(1.-smoothstep(.1,.18,min(r1,r2)))*step(0.,(u-wob)*sign(u));
        // Pads between the ruts: ovals in a pacing gait, two rows.
        float row=u-wob-sign(u-wob)*.22;float ph=v/.95+step(0.,u-wob)*.5;
        vec2 cell=vec2(row/.13,(fract(ph)-.5)*.95/.16);
        float pad=(1.-smoothstep(.6,1.,length(cell)))*step(abs(u-wob),.42)*step(.35,h1(floor(ph)+step(0.,u-wob)*31.));
        // The wind has filled the tracks in stretches; they fade at their ends and into the distance.
        float keep=smoothstep(.25,.55,vn(v*.07+3.))*smoothstep(0.,.04,vTr.z)*(1.-smoothstep(.96,1.,vTr.z))*(1.-smoothstep(45.,120.,vD));
        float dark=(rut*.2+wall*.1+pad*.16)*keep;
        gl_FragColor=vec4(vec3(1.-dark),1.);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'goldsand-caravan-tracks'; mesh.renderOrder = 1; mesh.frustumCulled = true;
  return mesh;
}

export interface DawnDuneClusters {group: THREE.Group}
/** Where the scrub and the dead tree go: World III's kit scatter (the nature kit, already tinted dry). */
export interface DuneScrub {add(name: string, m: THREE.Matrix4): void; has(name: string): boolean}

/** Build the clusters and the tracks; their scrub and the dead tree go to `scrub`. */
export function dawnDuneClusters(height: (x: number, z: number) => number, sand: THREE.Color, scrub: DuneScrub | null): DawnDuneClusters {
  const group = new THREE.Group(); group.name = 'goldsand-dune-clusters';
  const {pieces, scrub: tufts, tree} = duneClusterParts(height);
  const geos = pieces.map(({g, kind, color, local}) => {
    g.setAttribute('aDcL', new THREE.BufferAttribute(local, 3));
    const n = g.getAttribute('position').count, col = new Float32Array(n * 3), k = new Float32Array(n), above = new Float32Array(n), p = g.getAttribute('position');
    for (let i = 0; i < n; i++) { col.set([color.r, color.g, color.b], i * 3); k[i] = kind; above[i] = p.getY(i) - height(p.getX(i), p.getZ(i)); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aDcK', new THREE.BufferAttribute(k, 1)); g.setAttribute('aDcA', new THREE.BufferAttribute(above, 1));
    return g;
  });
  const geo = mergeGeometries(geos, false)!; geos.forEach((g) => g.dispose()); geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, clusterMaterial(sand));
  mesh.name = 'goldsand-dune-cluster-pieces'; mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh, trackMesh(height));
  let plants = 0;
  const place = (x: number, y: number, z: number, yaw: number, s: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
  if (scrub) {
    const dry = ['Grass_Wispy_Tall', 'Grass_Wispy_Short'].filter((n) => scrub.has(n));
    for (const [x, z, s] of tufts) for (let j = 0; j < 3 && dry.length; j++) {
      const a = s * 40 + j * 2.1, r = j ? .5 + j * .25 : 0, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      scrub.add(dry[(j + Math.floor(s * 7)) % dry.length], place(px, height(px, pz), pz, a, .5 + ((s * 13 + j) % 1) * .35)); plants++;
    }
    if (tree && scrub.has('DeadTree_2')) { scrub.add('DeadTree_2', place(tree[0], height(tree[0], tree[1]) - .2, tree[1], tree[2], .75)); plants++; }
  }
  group.userData = {clusters: DUNE_CLUSTERS.length, pieces: pieces.length, tracks: DUNE_TRACKS.length, scrub: plants, tree: !!tree};
  return {group};
}
