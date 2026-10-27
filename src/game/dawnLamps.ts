import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe, tube} from '../world/geom';
import {dawnGlows, dawnIron, dawnLanternGlass, dawnSandstone, solidPart} from './dawnMaterials';
import {dawnLampPosts} from './world3Colliders';

/*
 * Dawnharbor's road lamps: a turned sandstone foot, a slender iron post with a collar and finial, a scrolled arm
 * reaching over the road and a six-paned lantern hanging from it, lit amber with a soft halo. All posts merge into
 * one mesh per material (stone, iron, glass) plus one draw of halos.
 */

/** Height of the arm above the ground, and its reach from the post to the lantern's hook. */
const ARM_Y = 2.95, REACH = .82;
/** The lantern's centre, below the hook. */
const LANTERN_DROP = .38;

export interface DawnLamps {group: THREE.Group; flames: THREE.Vector3[]; update(time: number): void}

export function dawnLamps(height: (x: number, z: number) => number): DawnLamps {
  const group = new THREE.Group(); group.name = 'dawnharbor-road-lamps';
  const foot = lathe([[0, 0], [.33, 0], [.33, .1], [.29, .14], [.25, .16], [.21, .22], [.2, .44], [.24, .5], [.29, .53], [.29, .6], [.2, .64], [0, .64]], 28);
  const post = lathe([[0, .6], [.1, .6], [.11, .66], [.075, .72], [.062, .8], [.052, 2.4], [.075, 2.44], [.075, 2.5], [.055, 2.54], [.05, ARM_Y + .02], [.07, ARM_Y + .05], [.07, ARM_Y + .1], [.04, ARM_Y + .14], [.045, ARM_Y + .2], [.02, ARM_Y + .3], [0, ARM_Y + .32]], 14);
  // The arm: straight out, ending in a small down-turned curl for the hook; a scrolled brace under it.
  const arm = tube([new THREE.Vector3(0, ARM_Y, 0), new THREE.Vector3(REACH * .5, ARM_Y + .02, 0), new THREE.Vector3(REACH, ARM_Y, 0), new THREE.Vector3(REACH + .05, ARM_Y - .04, 0)], () => .026, 8);
  const braceCurve = new THREE.CubicBezierCurve3(new THREE.Vector3(.04, ARM_Y - .55, 0), new THREE.Vector3(.12, ARM_Y - .2, 0), new THREE.Vector3(.35, ARM_Y - .05, 0), new THREE.Vector3(.6, ARM_Y - .01, 0));
  const brace = tube(braceCurve.getPoints(14), (t) => .02 - .006 * t, 7);
  const scrollPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 1.7, r = .11 * (1 - i / 30); scrollPts.push(new THREE.Vector3(.2 + Math.sin(a) * r, ARM_Y - .16 - (1 - Math.cos(a)) * r * .9, 0)); }
  const scroll = tube(scrollPts, () => .014, 6);
  const hook = new THREE.TorusGeometry(.04, .009, 6, 12);
  // The lantern in its own frame: hook at y=0, a domed cap, six amber panes flaring up, a tray and a drop.
  const cap = lathe([[0, -.2], [.15, -.2], [.19, -.19], [.17, -.17], [.03, -.06], [.03, -.03], [0, -.02]], 6);
  const glass = new THREE.LatheGeometry([new THREE.Vector2(.11, -.6), new THREE.Vector2(.15, -.2)], 6);
  const tray = lathe([[0, -.7], [.03, -.7], [.04, -.66], [.13, -.63], [.14, -.6], [.12, -.59], [0, -.59]], 6);
  const mullion = new THREE.CylinderGeometry(.008, .008, .42, 4);
  const stone: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [], panes: THREE.BufferGeometry[] = [], flames: THREE.Vector3[] = [];
  const m = new THREE.Matrix4(), l = new THREE.Matrix4();
  for (const p of dawnLampPosts()) {
    // The foot sits a little into the ground on the downhill side.
    let low = Infinity;
    for (let a = 0; a < 8; a++) low = Math.min(low, height(p.x + Math.cos(a * .785) * .33, p.z + Math.sin(a * .785) * .33));
    const y = low - .06;
    // Local +x is the arm's direction.
    m.compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw - Math.PI / 2), new THREE.Vector3(1, 1, 1));
    stone.push(solidPart(foot, m));
    for (const g of [post, arm, brace, scroll]) iron.push(solidPart(g, m));
    iron.push(solidPart(hook, l.multiplyMatrices(m, new THREE.Matrix4().makeTranslation(REACH + .05, ARM_Y - .07, 0))));
    const lm = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(REACH + .05, ARM_Y - .1, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 6)));
    iron.push(solidPart(cap, lm), solidPart(tray, lm));
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, r = .13;
      const mm = new THREE.Matrix4().makeTranslation(Math.sin(a) * r, -.4, Math.cos(a) * r).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), .1));
      iron.push(solidPart(mullion, new THREE.Matrix4().multiplyMatrices(lm, mm)));
    }
    panes.push(solidPart(glass, lm, true));
    flames.push(new THREE.Vector3(0, -LANTERN_DROP, 0).applyMatrix4(lm));
  }
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow: boolean) => {
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose());
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat); mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh);
  };
  add(stone, dawnSandstone('dawnharbor-lamp-foot'), 'dawnharbor-lamp-feet', true);
  add(iron, dawnIron(), 'dawnharbor-lamp-iron', true);
  add(panes, dawnLanternGlass(), 'dawnharbor-lamp-glass', false);
  for (const g of [foot, post, arm, brace, scroll, hook, cap, glass, tray, mullion]) g.dispose();
  const halo = dawnGlows(flames.map(pos => ({pos, size: 1.5})), '#ffb763', 'dawnharbor-lamp-halos');
  group.add(halo);
  group.userData.lamps = flames.length;
  return {group, flames, update(time) { (halo.material as THREE.ShaderMaterial).uniforms.uTime.value = time; }};
}
