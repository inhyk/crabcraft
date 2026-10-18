import * as THREE from 'three';
import type { CrabRig } from '../crab/types';
import type { SimUnit } from '../sim/types.ts';

/** Keep native Vector3 methods while the current actor owns its coordinates. */
export function createLivePosition(getState: () => Pick<SimUnit, 'x' | 'y' | 'z'>): THREE.Vector3 {
  const position = new THREE.Vector3();
  for (const key of ['x', 'y', 'z'] as const) {
    Object.defineProperty(position, key, {
      configurable: true,
      enumerable: true,
      get: () => getState()[key],
      set: (value: number) => { getState()[key] = value; },
    });
  }
  return position;
}

export type NumericPoseView = Readonly<Pick<SimUnit,'x'|'y'|'z'|'yaw'>> & {readonly pose:{readonly appliedQ:ArrayLike<number>;readonly appliedPosition:readonly [number,number,number];readonly appliedRotation:readonly [number,number,number,number]}};

/** The Area already advanced root carry, lift and pose. Rendering only copies the result. */
export function applyNumericPose(rig: CrabRig, state: NumericPoseView): void {
  rig.root.position.set(state.x, state.y, state.z);
  rig.root.rotation.y = state.yaw;
  rig.setPose(state.pose.appliedQ);
  const position = state.pose.appliedPosition;
  rig.body.position.set(
    position[0] * rig.metersToUnits,
    position[1] * rig.metersToUnits,
    position[2] * rig.metersToUnits,
  );
  const rotation = state.pose.appliedRotation;
  rig.body.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
}
