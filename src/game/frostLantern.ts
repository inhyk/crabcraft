import * as THREE from 'three';

/*
 * The kit's wall lantern (props.glb `Lantern_Wall`) in piece units: a plate on the wall, a bracket out to 1.25 m,
 * a chain, and the cage hanging from it 0.63 to 0.99 m out. Every flame, halo and light pool Frostlight hangs on
 * one is placed from here, at the candle inside the cage, so none floats beside it.
 */

/** The hanging cage, measured from the kit's vertices (below the chain, out past the brace). */
export const LANTERN_CAGE = new THREE.Box3(new THREE.Vector3(-.179, .082, .629), new THREE.Vector3(.179, .613, .986));
/** The candle: centred in the cage, a little below its middle. */
export const LANTERN_FLAME = new THREE.Vector3(0, .3, .808);

export interface HungLantern {
  /** The lantern's placement matrix, as passed to StaticBatch.add. */
  m: number[];
  /** Where its flame burns, world space. */
  flame: [number, number, number];
}

/** World position of the candle for a lantern placed with `m`. */
export function lanternFlame(m: THREE.Matrix4): THREE.Vector3 {
  return LANTERN_FLAME.clone().applyMatrix4(m);
}

/** Same for a placement given as position, yaw and uniform scale (no pitch or roll). */
export function lanternFlameAt(x: number, y: number, z: number, yaw: number, s: number): THREE.Vector3 {
  return LANTERN_FLAME.clone().multiplyScalar(s).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, y, z));
}

/** Note a hung lantern on `holder.userData.lanterns` (read by tools/qa-snow-details.mjs). */
export function noteLantern(holder: THREE.Object3D, m: THREE.Matrix4, flame: THREE.Vector3): void {
  ((holder.userData.lanterns ??= []) as HungLantern[]).push({m: m.toArray(), flame: [flame.x, flame.y, flame.z]});
}
