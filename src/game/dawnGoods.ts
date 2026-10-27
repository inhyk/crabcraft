import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe} from '../world/geom';
import {rng} from '../world/noise';
import {dawnRope, dawnWood, solidPart, woodPart} from './dawnMaterials';
import {clothMaterial, rugMaterial, terracottaMaterial} from './dawnMarket';
import {dawnSandstone} from './dawnMaterials';
import {PLAZA_SIZE, type PlazaKind} from './dawnPlazaPlan';

/*
 * Grouped scenes of goods for Goldsand's open ground, so the square and the fields between the rows are not bare
 * sand: a caravan's rest (a rug thrown down, a camel saddle on it, water jars, one tipped over, bundles roped in
 * striped cloth, a water skin), a merchant's stack (crates, sacks of grain, jars, a rug spread for display) and a
 * potter's yard (jars in rows of sizes). Each scene is built round its spot, every piece set on the ground's own
 * height. Like the rest of the town's dressing they are not solid (dawnDressing.ts); the spots keep clear of the
 * roads, the villagers' posts and the quest points (qa-dawn-polish checks). Five meshes for all of them.
 */

export type GoodsKind = 'rest' | 'stack' | 'pots' | PlazaKind;
export interface GoodsSpot {x: number; z: number; yaw: number; kind: GoodsKind}

/** The scenes: two framing the arrival (left, a caravan's rest; right, a merchant's stack), the rest on the bare ground
 * between the rows and the square. Clear of roads, posts and quest points (checked in qa-dawn-polish). */
export const DAWN_GOODS: readonly GoodsSpot[] = [
  {x: -18, z: 70.8, yaw: .55, kind: 'rest'},
  {x: -8.8, z: 70.6, yaw: -1.1, kind: 'stack'},
  {x: -24, z: 59, yaw: .3, kind: 'pots'},
  {x: 15.5, z: 60, yaw: -.9, kind: 'rest'},
  {x: 21, z: 39, yaw: 1.2, kind: 'stack'},
  {x: 27, z: 75, yaw: 2.4, kind: 'pots'},
];

/** Rug fields: madder, indigo, deep red, olive. */
const RUGS = ['#7a2f3a', '#2b3a7a', '#8a3a2e', '#4a5a3a'];
/** Bale cloth: sun-faded indigo, madder, umber, saffron. */
const BALES = ['#33406e', '#8a3a2e', '#6b4a2e', '#b8862a'];
const tint = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation) => {
  const n = g.getAttribute('position').count, c = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
};

export function dawnGoods(spots: readonly GoodsSpot[], height: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group(); group.name = 'goldsand-goods';
  const stone: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [], cloth: THREE.BufferGeometry[] = [], clay: THREE.BufferGeometry[] = [], rugs: THREE.BufferGeometry[] = [], rope: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const amph = lathe([[0, 0], [.07, 0], [.06, .05], [.18, .2], [.22, .4], [.18, .58], [.08, .68], [.07, .78], [.1, .8], [0, .8]], 16);
  const pot = lathe([[0, 0], [.12, 0], [.19, .08], [.2, .17], [.14, .26], [.15, .29], [0, .29]], 14);
  const crock = lathe([[0, 0], [.16, 0], [.24, .12], [.27, .3], [.22, .44], [.16, .48], [.17, .52], [0, .52]], 16);
  const sack = lathe([[0, 0], [.24, 0], [.3, .08], [.31, .3], [.26, .46], [.12, .55], [.07, .6], [.1, .64], [0, .64]], 12);
  // A bundle: cloth over a squat block, its edges rounded.
  const bundle = new THREE.BoxGeometry(1, 1, 1, 3, 2, 3);
  {const p = bundle.getAttribute('position') as THREE.BufferAttribute;for (let i = 0; i < p.count; i++){const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 - .18 * (Math.abs(x) * 2) * (Math.abs(z) * 2);p.setXYZ(i, x * (1 - .1 * Math.abs(y * 2)), y * (1 - .08 * Math.abs(x * z * 4)), z * k);}bundle.computeVertexNormals();}
  // A water skin: a swollen teardrop of hide.
  const skin = lathe([[0, 0], [.14, .03], [.2, .16], [.17, .3], [.07, .4], [.04, .46], [0, .47]], 12);
  // The camel saddle: two bowed wooden arches joined by rails, a padded cushion between.
  const arch = new THREE.TorusGeometry(.36, .045, 6, 14, Math.PI);
  const pole = new THREE.CylinderGeometry(.035, .035, 1, 6);
  const pad = new THREE.CapsuleGeometry(.2, .55, 4, 10).rotateZ(Math.PI / 2).scale(1, .55, 1.35);
  // The square's pieces: a pail, a post knob, a cart wheel's rim and hub, a tea glass.
  const pail = lathe([[0, 0], [.13, 0], [.15, .02], [.17, .28], [.18, .3], [.16, .3], [.145, .04], [0, .04]], 12);
  const knob = new THREE.SphereGeometry(.09, 8, 6);
  const rim = new THREE.TorusGeometry(.53, .045, 6, 22);
  const hub = new THREE.CylinderGeometry(.09, .09, .2, 10);
  const glass = new THREE.CylinderGeometry(.03, .025, .07, 8);
  // Offerings: a fruit or flower head, a clay oil lamp.
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const lamp = lathe([[0, 0], [.05, 0], [.07, .025], [.06, .045], [.02, .05], [0, .05]], 10).scale(1, 1, 1.5);
  let pieces = 0;
  for (const [si, s] of spots.entries()) {
    const R = rng(7101 + si * 31), c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    // Local (x, z) round the spot to world, standing on the ground there.
    const M = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) => {
      const wx = s.x + x * c + z * sn, wz = s.z - x * sn + z * c;
      return new THREE.Matrix4().compose(new THREE.Vector3(wx, height(wx, wz) + y, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, s.yaw + yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    };
    const rug = (x: number, z: number, w: number, d: number, yaw: number, y = .03) => {
      const g = new THREE.PlaneGeometry(w, d, 6, 4).rotateX(-Math.PI / 2);
      rugs.push(tint(solidPart(g, M(x, y, z, yaw), true), RUGS[Math.floor(R() * RUGS.length)])); g.dispose(); pieces++;
    };
    const jar = (x: number, z: number, big: boolean, lying = false) => {
      const sc = big ? 1.1 + R() * .3 : .9 + R() * .3, g = big ? amph : (R() < .5 ? pot : crock);
      clay.push(tint(solidPart(g, lying ? M(x, .2, z, R() * 6, sc, sc, sc, Math.PI / 2 - .12) : M(x, 0, z, R() * 6, sc, sc, sc)), R() < .5 ? '#b5532c' : R() < .5 ? '#c98a52' : '#a8673e')); pieces++;
    };
    const bale = (x: number, y: number, z: number, w: number, h: number, d: number, yaw: number) => {
      const g = solidPart(bundle, M(x, y + h / 2, z, yaw, w, h, d), true);
      // uv.x across the stripes: run them round the bale.
      const uv = g.getAttribute('uv') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute;
      // Dyed through, no stripes (uv.x in the canvas shader's plain band); the rope does the detail.
      for (let i = 0; i < uv.count; i++) uv.setXY(i, .08, .3 + (p.getY(i) + .5) * .3);
      cloth.push(tint(g, BALES[Math.floor(R() * BALES.length)]));
      for (const t of [-.28, .28]) rope.push(solidPart(box, M(x + Math.cos(yaw) * t * w, y + h / 2, z - Math.sin(yaw) * t * w, yaw, .04, h + .03, d + .03)));
      pieces++;
    };
    // A slatted crate: a dark-stained body, pale corner posts and two boards across each face.
    const crate = (x: number, y: number, z: number, yaw: number, w: number, h: number, d: number) => {
      wood.push(woodPart(box, M(x, y + h / 2, z, yaw, w - .04, h - .02, d - .04), '#5a3d26', .7));
      const cy = Math.cos(yaw), sy = Math.sin(yaw), at = (u: number, v: number) => [x + u * cy + v * sy, z - u * sy + v * cy] as const;
      for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {const [px, pz] = at(u * (w / 2 - .03), v * (d / 2 - .03));wood.push(woodPart(box, M(px, y + h / 2, pz, yaw, .07, h, .07), null, 0, new THREE.Vector3(0, 1, 0)));}
      for (const f of [h * .3, h * .72]) for (const [u, v, a] of [[0, d / 2, 0], [0, -d / 2, 0], [w / 2, 0, 1], [-w / 2, 0, 1]] as const) {const [px, pz] = at(u, v);wood.push(woodPart(box, M(px, y + f, pz, yaw, a ? .04 : w - .1, .1, a ? d - .1 : .04), null, 0));}
      pieces++;
    };
    const Yax = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1);
    const post = (x: number, z: number, h: number, r: number, y = 0) => wood.push(woodPart(pole, M(x, y + h / 2, z, 0, r / .035, h, r / .035), null, 0, Yax));
    const saddle = (x: number, z: number, yaw: number, cush: string) => {
      for (const t of [-.32, .32]) wood.push(woodPart(arch, M(x + Math.cos(yaw) * t, .07, z - Math.sin(yaw) * t, yaw + Math.PI / 2, 1, 1.15, 1), null, 0, Yax));
      for (const t of [-.3, .3]) wood.push(woodPart(pole, M(x + Math.sin(yaw) * t, .41, z + Math.cos(yaw) * t, yaw, 1, .9, 1, 0, Math.PI / 2), null, 0, Yax));
      cloth.push(tint(solidPart(pad, M(x, .37, z, yaw), true), cush));
      pieces++;
    };
    const ropeLine = (pts: THREE.Vector3[], r = .016) => {
      const w = pts.map(p => { const wx = s.x + p.x * c + p.z * sn, wz = s.z - p.x * sn + p.z * c; return new THREE.Vector3(wx, height(wx, wz) + p.y, wz); });
      for (let i = 1; i < w.length; i++) {
        const a = w[i - 1], b = w[i], L = a.distanceTo(b), q = new THREE.Quaternion().setFromUnitVectors(Yax, b.clone().sub(a).normalize());
        rope.push(solidPart(pole, new THREE.Matrix4().compose(a.clone().lerp(b, .5), q, new THREE.Vector3(r / .035, L, r / .035))));
      }
    };
    const bucket = (x: number, y: number, z: number, sc = 1) => { wood.push(woodPart(pail, M(x, y, z, R() * 6, sc, sc, sc), '#4a3423', .8, Yax)); pieces++; };
    const plaza = (kind: PlazaKind) => {
      if (kind === 'well') {
        // A sandstone drum with a moulded coping, two posts and a beam, the pulley wheel and its rope down to a pail,
        // a second pail on the coping, water jars at its foot; dark water far down.
        const {r, h, post: pp, beam} = PLAZA_SIZE.well;
        const drum = lathe([[r + .05, -.35], [r, h - .1], [r + .07, h - .08], [r + .07, h], [r - .27, h + .01], [r - .27, h - .06], [r - .22, h - .1], [r - .22, -.4]], 28);
        stone.push(solidPart(drum, M(0, 0, 0))); drum.dispose();
        const water = new THREE.CircleGeometry(r - .22, 20).rotateX(-Math.PI / 2);
        clay.push(tint(solidPart(water, M(0, -.15, 0)), '#16211f')); water.dispose();
        for (const t of [-pp, pp]) {
          wood.push(woodPart(box, M(t, (beam + .1) / 2 - .05, 0, 0, .15, beam + .1, .15), '#5a3d26', .3, Yax));
          // A stone footing round each post on the coping.
          stone.push(solidPart(box, M(t, h + .05, 0, 0, .32, .1, .32)));
        }
        wood.push(woodPart(box, M(0, beam + .02, 0, 0, pp * 2 + .5, .16, .18), '#5a3d26', .3));
        const wheel = new THREE.CylinderGeometry(.2, .2, .09, 14).rotateZ(Math.PI / 2);
        wood.push(woodPart(wheel, M(0, beam - .22, 0), '#3a2a1e', .5, new THREE.Vector3(1, 0, 0))); wheel.dispose();
        wood.push(woodPart(box, M(0, beam - .1, 0, 0, .05, .24, .05), null, 0, Yax));
        ropeLine([new THREE.Vector3(.2, beam - .22, 0), new THREE.Vector3(.2, h + .55, 0)]);
        ropeLine([new THREE.Vector3(-.2, beam - .22, 0), new THREE.Vector3(-.26, h + .2, .1), new THREE.Vector3(-pp - .05, h + .25, .05)]);
        bucket(.2, h + .22, 0, 1.05); bucket(.62, h + .02, -.42, .95);
        jar(-.6, -1.25, true); jar(-1.05, -.95, true); jar(.95, 1.05, false);
        rug(1.25, -.95, 1.1, .7, .6, .03);
      } else if (kind === 'trough') {
        const {l, w, h} = PLAZA_SIZE.trough, t = .1;
        for (const [x, z, sx, sz] of [[-(w - t) / 2, 0, t, l], [(w - t) / 2, 0, t, l], [0, -(l - t) / 2, w - 2 * t, t], [0, (l - t) / 2, w - 2 * t, t]] as const) stone.push(solidPart(box, M(x, (h + .3) / 2 - .3, z, 0, sx, h + .3, sz)));
        stone.push(solidPart(box, M(0, .02, 0, 0, w - 2 * t, .1, l - 2 * t)));
        const water = new THREE.PlaneGeometry(w - 2 * t, l - 2 * t).rotateX(-Math.PI / 2);
        clay.push(tint(solidPart(water, M(0, h - .1, 0)), '#2b3f3a')); water.dispose();
        bucket(.62, 0, .55);
      } else if (kind === 'hitch') {
        // Camel hitching rail: three posts and a worn log rail; a lead rope from the rail to a pack saddle on the
        // sand, feed sacks and a pail of water by it.
        const {posts, h} = PLAZA_SIZE.hitch;
        for (const z of posts) { post(0, z, h, .075); wood.push(woodPart(knob, M(0, h, z), null, 0, Yax)); }
        wood.push(woodPart(pole, M(0, h - .16, 0, 0, 2.2, 2.75, 2.2, Math.PI / 2), null, 0, Zax));
        saddle(-1.05, .35, .35, '#7a2f3a');
        const bag = solidPart(bundle, M(-1.05, .26, -.25, .35, .7, .38, .22), true); cloth.push(tint(bag, '#2b3a7a')); pieces++;
        ropeLine([new THREE.Vector3(0, h - .16, .45), new THREE.Vector3(-.4, .5, .5), new THREE.Vector3(-.75, .45, .4)]);
        ropeLine([new THREE.Vector3(0, h - .16, -.7), new THREE.Vector3(-.15, .35, -.85), new THREE.Vector3(-.2, .02, -1.15), new THREE.Vector3(-.55, .02, -1.0)]);
        for (const [x, z] of [[.6, -.9], [.75, -.35]] as const) { clay.push(tint(solidPart(sack, M(x, 0, z, R() * 6, 1, .85, 1)), '#a08a62')); pieces++; }
        bucket(.55, 0, .7, 1.1);
        rug(-1.1, .1, 1.5, 1.1, .2, .025);
      } else if (kind === 'cargo') {
        // The harbour's cargo stacked for the stalls: crates two high, sacks, an amphora rack, a roped bale.
        crate(-.55, 0, -.25, .05, .72, .62, .62); crate(.2, 0, -.3, -.06, .7, .6, .6); crate(-.2, .62, -.28, .12, .66, .58, .58);
        crate(-.6, 0, .4, .2, .6, .52, .52);
        for (const [x, z] of [[.75, .3], [.35, .55], [.85, -.35]] as const) { clay.push(tint(solidPart(sack, M(x, 0, z, R() * 6, 1, .9 + R() * .2, 1)), '#a08a62')); pieces++; }
        // Rack: two trestles, amphorae lying in it.
        for (const t of [-.45, .45]) wood.push(woodPart(box, M(-1.25, .28, t, 0, .8, .06, .06), null, 0));
        for (const t of [-.45, .45]) for (const u of [-.36, .36]) wood.push(woodPart(box, M(-1.25 + u, .14, t, 0, .06, .3, .06), null, 0, Yax));
        for (const t of [-.24, 0, .24]) { clay.push(tint(solidPart(amph, M(-1.25 + t, .5, -.42, 0, .85, .85, .85, Math.PI / 2)), t ? '#b5532c' : '#c98a52')); pieces++; }
        bale(.25, .6, .35, .55, .32, .42, .4);
        ropeLine([new THREE.Vector3(-.92, .02, -.6), new THREE.Vector3(-.85, .02, -.9), new THREE.Vector3(-.5, .02, -1.0)]);
      } else if (kind === 'cart') {
        // A two-wheeled hand cart up from the harbour, its shafts down on the stones, loaded and roped.
        const {hx} = PLAZA_SIZE.cart, R0 = .56, ax = -.25;
        for (const sx of [-hx + .06, hx - .06]) {
          wood.push(woodPart(rim, M(sx, R0, ax, Math.PI / 2), '#3a2a1e', .5, new THREE.Vector3(1, 0, 0)));
          for (let k = 0; k < 8; k++) wood.push(woodPart(box, M(sx, R0, ax, 0, .04, R0 * 1.9, .05, k * Math.PI / 8, 0), null, 0, Yax));
          wood.push(woodPart(hub, M(sx, R0, ax, 0, 1, 1, 1, 0, Math.PI / 2), '#3a2a1e', .5, new THREE.Vector3(1, 0, 0)));
        }
        wood.push(woodPart(box, M(0, R0, ax, 0, hx * 2 - .1, .07, .07), null, 0));
        // Bed and rails, tilted forward onto the shafts.
        const tilt = .12;
        wood.push(woodPart(box, M(0, R0 + .14, -.1, 0, hx * 2 - .28, .07, 1.9, tilt), '#6b4a2e', .2, Zax));
        for (const sx of [-1, 1]) {
          wood.push(woodPart(box, M(sx * (hx - .17), R0 + .32, -.1, 0, .05, .3, 1.9, tilt), null, 0, Zax));
          // Shafts from under the bed to the ground ahead.
          wood.push(woodPart(box, M(sx * (hx - .3), .38, 1.0, 0, .07, .07, 1.3, .52), null, 0, Zax));
        }
        crate(-.22, R0 + .2, -.45, .08, .55, .5, .5); crate(.2, R0 + .2, -.55, -.1, .5, .48, .48); crate(-.05, R0 + .68, -.5, .2, .45, .4, .45);
        for (const z of [.15, .5]) { clay.push(tint(solidPart(sack, M(0, R0 + .14, z, R() * 6, .95, .8, .95, tilt)), '#a08a62')); pieces++; }
        ropeLine([new THREE.Vector3(-hx + .12, R0 + .4, -.5), new THREE.Vector3(0, R0 + 1.12, -.5), new THREE.Vector3(hx - .12, R0 + .4, -.5)], .02);
      } else if (kind === 'canopy') {
        // A shade canopy over a sitting place: four poles, a striped indigo cloth sagging between them with a fringe,
        // two benches round a low tea table on a rug, cushions, a brass tray.
        const {hx, hz, h} = PLAZA_SIZE.canopy;
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) post(sx * hx, sz * hz, h + .1, .06);
        const sheetG = new THREE.PlaneGeometry(hx * 2 + .3, hz * 2 + .3, 10, 8).rotateX(-Math.PI / 2), sp = sheetG.getAttribute('position') as THREE.BufferAttribute, su = sheetG.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), z = sp.getZ(i), u = x / (hx + .15), v = z / (hz + .15); sp.setY(i, -.32 * (1 - u * u) * (1 - v * v) + .06 * v); su.setXY(i, (x + hx) * .55, (z + hz) / (2 * hz) * .6); }
        sheetG.computeVertexNormals();
        cloth.push(tint(solidPart(sheetG, M(0, h, 0), true), '#2b3a7a')); sheetG.dispose();
        for (const sz of [-1, 1]) {
          const val = new THREE.PlaneGeometry(hx * 2 + .3, .26, 8, 1), vu = val.getAttribute('uv') as THREE.BufferAttribute, vp = val.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < vu.count; i++) vu.setXY(i, (vp.getX(i) + hx) * .55, .62 + (vp.getY(i) + .13) * .5);
          cloth.push(tint(solidPart(val, M(0, h - .02 + .06 * sz - .13, sz * (hz + .15), sz > 0 ? 0 : Math.PI), true), '#2b3a7a')); val.dispose();
        }
        rug(0, 0, 2.6, 1.8, .05, .03);
        for (const sz of [-1, 1]) {
          wood.push(woodPart(box, M(0, .42, sz * .78, 0, 2.0, .07, .36), '#6b4a2e', .3));
          for (const t of [-.8, .8]) wood.push(woodPart(box, M(t, .2, sz * .78, 0, .3, .4, .3), null, 0, Yax));
          for (const t of [-.5, .3]) { cloth.push(tint(solidPart(bundle, M(t, .45, sz * .78, (R() - .5) * .3, .5, .14, .34), true), ['#b5532c', '#e3a21a', '#7a2f3a'][Math.floor(R() * 3)])); pieces++; }
        }
        const top = new THREE.CylinderGeometry(.42, .42, .05, 18);
        wood.push(woodPart(top, M(0, .36, 0), '#4a3423', .6, Yax)); top.dispose();
        wood.push(woodPart(box, M(0, .17, 0, 0, .12, .34, .12), null, 0, Yax));
        const tray = new THREE.CylinderGeometry(.24, .22, .025, 18);
        clay.push(tint(solidPart(tray, M(0, .4, 0)), '#c9a24a')); tray.dispose();
        for (const [x, z] of [[.08, .06], [-.1, -.05], [.02, -.12]] as const) { clay.push(tint(solidPart(glass, M(x, .41, z)), '#a8673e')); }
        jar(1.95, -1.0, true); jar(2.15, -.55, false);
        pieces += 6;
      } else if (kind === 'offering') {
        // A low altar of two sandstone blocks and a slab, laid with dates, pomegranates and marigold garlands, clay
        // oil lamps and a jar of oil; more offerings on a rug before it, a tipped bowl of grain.
        for (const t of [-.48, .48]) stone.push(solidPart(box, M(t, .14, 0, 0, .34, .42, .56)));
        stone.push(solidPart(box, M(0, .4, 0, 0, 1.4, .12, .74)));
        const fruit = (x: number, y: number, z: number, r: number, col: string) => { clay.push(tint(solidPart(ball, M(x, y + r * .8, z, R() * 6, r, r * .9, r)), col)); };
        for (let k = 0; k < 7; k++) fruit(-.5 + k * .16 + (R() - .5) * .05, .46, -.12 + (R() - .5) * .1, .055, k % 3 ? '#8e1f22' : '#b5532c');
        for (let k = 0; k < 9; k++) fruit(.22 + (R() - .5) * .3, .46 + (k > 5 ? .05 : 0), .16 + (R() - .5) * .2, .03, '#4a2a18');
        // Marigold garlands along the front edge and draped over the ends.
        for (let k = 0; k < 18; k++) { const t = k / 17; fruit(-.68 + t * 1.36, .38 - .1 * Math.sin(Math.PI * t), .38, .032, k % 2 ? '#e3a21a' : '#d9631c'); }
        for (const t of [-.62, .62]) for (let k = 0; k < 5; k++) fruit(t, .38 - k * .07, .3 - k * .02, .03, k % 2 ? '#e3a21a' : '#d9631c');
        for (const x of [-.45, 0, .45]) { clay.push(tint(solidPart(lamp, M(x, .46, .2, R() * 6)), '#a8673e')); pieces++; }
        jar(-.95, .25, true); jar(.95, -.15, false); jar(1.1, .3, false);
        rug(0, .95, 1.5, .8, .05, .025);
        clay.push(tint(solidPart(pot, M(-.35, .03, 1.05, 0, .8, .5, .8, 1.3)), '#c98a52'));
        for (let k = 0; k < 14; k++) fruit(-.12 + (R() - .5) * .4, .02, 1.1 + (R() - .5) * .3, .018, '#d9b77a');
        for (let k = 0; k < 6; k++) fruit(.3 + (R() - .5) * .3, .03, .95 + (R() - .5) * .2, .04, k % 2 ? '#e3a21a' : '#d9631c');
        pieces += 4;
      }
    };
    if (s.kind === 'rest') {
      rug(0, 0, 2.6, 1.7, .08);
      rug(.7, .5, 1.6, 1.1, -.35, .045);
      // The saddle on the rug, a little askew, a saddlebag over it.
      {
        const sx = -.35, sz = -.15, sy = .05, yaw = .25;
        for (const t of [-.32, .32]) wood.push(woodPart(arch, M(sx + t, sy + .02, sz, yaw + Math.PI / 2, 1, 1.15, 1), null, 0, new THREE.Vector3(0, 1, 0)));
        for (const t of [-.3, .3]) wood.push(woodPart(pole, M(sx, sy + .34, sz + t, yaw, 1, .9, 1, 0, Math.PI / 2), null, 0, new THREE.Vector3(0, 1, 0)));
        cloth.push(tint(solidPart(pad, M(sx, sy + .3, sz, yaw), true), '#7a2f3a'));
        const bag = solidPart(bundle, M(sx, sy + .2, sz + .45, yaw, .75, .4, .2), true);cloth.push(tint(bag, '#2b3a7a'));
        pieces += 2;
      }
      // Water jars at the rug's back edge, one tipped over; a skin of water hung on a stake.
      jar(-1.1, -.95, true); jar(-.7, -1.05, true); jar(-1.45, -.6, false); jar(.3, -1.05, true, true);
      wood.push(woodPart(pole, M(1.45, .55, -.75, 0, 1.2, 1.1, 1.2, .08), null, 0, new THREE.Vector3(0, 1, 0)));
      cloth.push(tint(solidPart(skin, M(1.45, .62, -.62, 0, 1, -1.1, .8), true), '#6b4a2e'));
      // Bundles roped in striped cloth, stacked by the saddle.
      bale(1.05, 0, .1, .8, .45, .55, .3); bale(1.0, .45, .05, .65, .38, .5, -.1); bale(1.7, 0, .55, .7, .42, .5, -.5);
    } else if (s.kind === 'stack') {
      rug(0, .3, 2.2, 1.5, -.05);
      // Crates two high, a third beside; sacks of grain against them; jars on the rug.
      crate(-1.2, 0, -.6, .1, .7, .6, .6); crate(-1.15, .6, -.62, -.08, .62, .55, .55); crate(-.45, 0, -.85, .35, .6, .54, .5);
      for (const [x, z] of [[-1.8, -.1], [-1.55, .35], [-.2, -.35]] as const) {clay.push(tint(solidPart(sack, M(x, 0, z, R() * 6, 1, .9 + R() * .2, 1)), '#a08a62'));pieces++;}
      jar(.4, .2, true); jar(.75, .55, false); jar(.95, .05, false); jar(.15, .7, false);
      bale(.9, 0, -.7, .7, .4, .5, .2);
      pieces += 3;
    } else if (s.kind !== 'pots') {
      plaza(s.kind);
    } else {
      // A potter's yard: jars in rows of sizes on the sand, a few on a low plank shelf.
      for (let k = 0; k < 9; k++) jar(-1.4 + (k % 5) * .62 + (R() - .5) * .1, (k < 5 ? -.4 : .35) + (R() - .5) * .1, k % 3 === 0);
      wood.push(woodPart(box, M(.2, .35, -1.1, 0, 2.2, .05, .45), null, 0));
      for (const t of [-.9, .9]) wood.push(woodPart(box, M(.2 + t, .17, -1.1, 0, .06, .34, .4), null, 0, new THREE.Vector3(0, 1, 0)));
      for (let k = 0; k < 4; k++) {clay.push(tint(solidPart(pot, M(-.6 + k * .55, .38, -1.1, R() * 6, .8, .8, .8)), '#c98a52'));pieces++;}
      rug(1.6, .6, 1.2, .9, .4);
    }
  }
  [box, amph, pot, crock, sack, bundle, skin, arch, pole, pad, pail, knob, rim, hub, glass, ball, lamp].forEach(g => g.dispose());
  const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow = true) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; group.add(m);
  };
  mk(stone, dawnSandstone('goldsand-goods-stone'), 'goldsand-goods-stone');
  mk(wood, dawnWood('goldsand-goods-wood'), 'goldsand-goods-wood');
  mk(cloth, clothMaterial(), 'goldsand-goods-cloth');
  mk(clay, terracottaMaterial(), 'goldsand-goods-pottery');
  mk(rugs, rugMaterial(), 'goldsand-goods-rugs', false);
  mk(rope, dawnRope(), 'goldsand-goods-rope');
  group.userData.scenes = spots.length; group.userData.pieces = pieces;
  return group;
}
