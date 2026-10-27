import * as THREE from 'three';
import {dawnBoulders} from './dawnBoulders';
import {dawnLamps} from './dawnLamps';
import {dawnPaving} from './dawnPaving';
import {DAWN_PATHS} from './world3Colliders';

/*
 * Dawnharbor's town look, World III only: sandstone streets, road lamps, sculpted boulders, the harbour and the
 * arrival gate. DawnIsland adds `root` and calls update(); the kit-dressed parts arrive in dress().
 */

/** The town square (with the inlaid sun) and the arrival square under the gate. */
export const DAWN_SQUARES = [{x: 0, z: 53, r: 9.5, sun: 2.5}, {x: -10, z: 82, r: 6.5}] as const;

export interface DawnTown {
  root: THREE.Group;
  update(time: number, quality: 'high' | 'low', sunDir: THREE.Vector3): void;
}

export function dawnTown(height: (x: number, z: number) => number): DawnTown {
  const root = new THREE.Group(); root.name = 'dawnharbor-town';
  const paving = dawnPaving(height, DAWN_PATHS, {pads: DAWN_SQUARES});
  root.add(paving.root);
  const lamps = dawnLamps(height);
  root.add(lamps.group);
  const boulders = dawnBoulders(height);
  root.add(boulders.group);
  let q: 'high' | 'low' | null = null;
  return {
    root,
    update(time, quality, sunDir) {
      if (quality !== q) { q = quality; paving.setQuality(quality); }
      paving.setSun(sunDir);
      lamps.update(time);
      boulders.update(time);
    },
  };
}
