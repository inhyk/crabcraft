import * as THREE from 'three';
import {moonstoneMaterial, silverMaterial, StoneBuilder} from './starMasonry';
import {starCrystalCluster, starCrystalMaterial} from './starCrystals';

/*
 * The star fountain in the village square, in the sanctum's moonstone: an octagonal basin on a stepped plinth with a
 * moulded coping, an octagonal pedestal rising from the water with a silver cradle that holds a violet crystal, and
 * the water itself. Its footprint stays inside the square's old collider (r 3.6 round (0, 55)).
 */

const TAN = Math.tan(Math.PI / 8);
/** A regular octagon's chamfer for apothem a (StoneBuilder's course: vertices at (a, a - ch)). */
const ch = (a: number) => a * (1 - TAN);

/** Octagon ring vertices at apothem a, height y, centre c. */
function ring(a: number, y: number, c: THREE.Vector3) {
  const b = a * TAN;
  return [[a, -b], [a, b], [b, a], [-b, a], [-a, b], [-a, -b], [-b, -a], [b, -a]].map(([x, z]) => new THREE.Vector3(c.x + x, y, c.z + z));
}

/** A band between two octagon rings, facing out (1), in (-1), up (0) or down (2). */
function band(sb: StoneBuilder, a0: number, y0: number, a1: number, y1: number, c: THREE.Vector3, face: 1 | -1 | 0 | 2, s0 = 0) {
  const lo = ring(a0, y0, c), up = ring(a1, y1, c), out = new THREE.Vector3();
  let s = s0;
  for (let k = 0; k < 8; k++) {
    const k1 = (k + 1) % 8, len = lo[k].distanceTo(lo[k1]);
    if (face === 0 || face === 2) out.set(0, face === 0 ? 1 : -1, 0);
    else out.copy(lo[k]).add(lo[k1]).multiplyScalar(.5).sub(c).setY(0).multiplyScalar(face);
    const vl = y0, vu = face === 0 || face === 2 ? y0 + Math.abs(a0 - a1) : y1;
    sb.tri(lo[k], lo[k1], up[k1], [s, vl], [s + len, vl], [s + len, vu], out);
    sb.tri(lo[k], up[k1], up[k], [s, vl], [s + len, vu], [s, vu], out);
    s += len;
  }
}

export class StarFountain {
  readonly root = new THREE.Group();
  readonly water: THREE.Mesh;
  readonly crystal: THREE.Mesh;

  constructor(x: number, z: number, y: number) {
    this.root.name = 'star-fountain';
    const c = new THREE.Vector3(x, 0, z), sb = new StoneBuilder();
    // Plinth step, the basin's wall with a moulded coping overhanging it, the inside down to the water's floor.
    const A = 3.12;
    band(sb, A + .3, y - .3, A + .3, y + .12, c, 1);
    band(sb, A + .3, y + .12, A, y + .12, c, 0);
    band(sb, A, y + .12, A, y + .5, c, 1);
    band(sb, A, y + .5, A + .12, y + .5, c, 2);
    band(sb, A + .12, y + .5, A + .12, y + .62, c, 1);
    band(sb, A + .12, y + .62, A - .38, y + .62, c, 0);
    band(sb, A - .38, y + .62, A - .38, y + .2, c, -1);
    // The floor under the water.
    const fl = ring(A - .38, y + .2, c);
    for (let k = 0; k < 8; k++) sb.tri(new THREE.Vector3(x, y + .2, z), fl[k], fl[(k + 1) % 8], [x, z], [fl[k].x, fl[k].z], [fl[(k + 1) % 8].x, fl[(k + 1) % 8].z], new THREE.Vector3(0, 1, 0));
    // The pedestal: base, a die, a shaft with an entasis, a capital and an abacus for the cradle.
    const m = new THREE.Matrix4().makeTranslation(x, y + .2, z);
    sb.stack([{y: 0, hw: .78, ch: ch(.78)}, {y: .3, hw: .78, ch: ch(.78)}, {y: .3, hw: .66, ch: ch(.66)}, {y: .42, hw: .62, ch: ch(.62)},
      {y: .42, hw: .44, ch: ch(.44)}, {y: 1.2, hw: .4, ch: ch(.4)}, {y: 1.75, hw: .36, ch: ch(.36)}, {y: 1.75, hw: .5, ch: ch(.5)}, {y: 1.9, hw: .54, ch: ch(.54)},
      {y: 1.9, hw: .58, ch: ch(.58)}, {y: 2.02, hw: .58, ch: ch(.58)}], m);
    const stone = new THREE.Mesh(sb.geometry('star-fountain-stone'), moonstoneMaterial({color: '#aab0c6', block: [1.05, .62], name: 'star-fountain-moonstone'}));
    stone.name = 'star-fountain-stone'; stone.castShadow = stone.receiveShadow = true;
    // Silver: a band on the coping's lip and the cradle's four prongs round the crystal.
    const silver = new StoneBuilder();
    band(silver, A + .135, y + .52, A + .135, y + .57, c, 1);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4, pm = new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a) * .3, y + 2.2, z + Math.sin(a) * .3), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * .4, 0, -Math.cos(a) * .4)), new THREE.Vector3(1, 1, 1));
      silver.stack([{y: 0, hw: .07, ch: .02}, {y: .7, hw: .035, ch: .01}], pm);
    }
    const trim = new THREE.Mesh(silver.geometry('star-fountain-silver'), silverMaterial()); trim.name = 'star-fountain-silver'; trim.castShadow = true;
    // The water: dark, glassy, catching the sky and the crystal.
    const wr = (A - .38) / Math.cos(Math.PI / 8);
    this.water = new THREE.Mesh(new THREE.CircleGeometry(wr, 8, Math.PI / 8), new THREE.MeshPhysicalMaterial({color: '#173a4a', emissive: '#0d3340', emissiveIntensity: .4, metalness: .1, roughness: .06, clearcoat: 1, clearcoatRoughness: .05, transparent: true, opacity: .9}));
    this.water.name = 'star-fountain-water'; this.water.rotation.x = -Math.PI / 2; this.water.position.set(x, y + .5, z);
    // The crystal set in the cradle (its frosted foot in the prongs), not floating.
    this.crystal = new THREE.Mesh(starCrystalCluster(), starCrystalMaterial('violet', {glow: 1.8, frost: .14}));
    this.crystal.name = 'star-fountain-crystal'; this.crystal.scale.set(.62, 1.2, .62); this.crystal.position.set(x, y + 2.2 + .5 * 1.2 + .05, z); this.crystal.castShadow = true;
    this.root.add(stone, trim, this.water, this.crystal);
  }
}
