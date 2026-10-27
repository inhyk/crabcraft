import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe} from '../world/geom';
import {rng} from '../world/noise';
import {dawnRope, dawnWood, solidPart, woodPart} from './dawnMaterials';
import {clothMaterial, rugMaterial, terracottaMaterial} from './dawnMarket';

/*
 * Grouped scenes of goods for Goldsand's open ground, so the square and the fields between the rows are not bare
 * sand: a caravan's rest (a rug thrown down, a camel saddle on it, water jars, one tipped over, bundles roped in
 * striped cloth, a water skin), a merchant's stack (crates, sacks of grain, jars, a rug spread for display) and a
 * potter's yard (jars in rows of sizes). Each scene is built round its spot, every piece set on the ground's own
 * height. Like the rest of the town's dressing they are not solid (dawnDressing.ts); the spots keep clear of the
 * roads, the villagers' posts and the quest points (qa-dawn-polish checks). Five meshes for all of them.
 */

export type GoodsKind = 'rest' | 'stack' | 'pots';
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
  const wood: THREE.BufferGeometry[] = [], cloth: THREE.BufferGeometry[] = [], clay: THREE.BufferGeometry[] = [], rugs: THREE.BufferGeometry[] = [], rope: THREE.BufferGeometry[] = [];
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
    } else {
      // A potter's yard: jars in rows of sizes on the sand, a few on a low plank shelf.
      for (let k = 0; k < 9; k++) jar(-1.4 + (k % 5) * .62 + (R() - .5) * .1, (k < 5 ? -.4 : .35) + (R() - .5) * .1, k % 3 === 0);
      wood.push(woodPart(box, M(.2, .35, -1.1, 0, 2.2, .05, .45), null, 0));
      for (const t of [-.9, .9]) wood.push(woodPart(box, M(.2 + t, .17, -1.1, 0, .06, .34, .4), null, 0, new THREE.Vector3(0, 1, 0)));
      for (let k = 0; k < 4; k++) {clay.push(tint(solidPart(pot, M(-.6 + k * .55, .38, -1.1, R() * 6, .8, .8, .8)), '#c98a52'));pieces++;}
      rug(1.6, .6, 1.2, .9, .4);
    }
  }
  [box, amph, pot, crock, sack, bundle, skin, arch, pole, pad].forEach(g => g.dispose());
  const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow = true) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; group.add(m);
  };
  mk(wood, dawnWood('goldsand-goods-wood'), 'goldsand-goods-wood');
  mk(cloth, clothMaterial(), 'goldsand-goods-cloth');
  mk(clay, terracottaMaterial(), 'goldsand-goods-pottery');
  mk(rugs, rugMaterial(), 'goldsand-goods-rugs', false);
  mk(rope, dawnRope(), 'goldsand-goods-rope');
  group.userData.scenes = spots.length; group.userData.pieces = pieces;
  return group;
}
