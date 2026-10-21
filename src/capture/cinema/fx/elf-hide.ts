// Hide merged scenery the night elf's moves would frame up close (Moonpool Grove's faceted standing
// stones and their runes): `hide` and `night-drop` cannot reach them, since they are unnamed meshes
// whose vertices, not their origin, sit at the grove.
//
//   elf-hide { at: [x, z], r, group, shaders }
//       every mesh under the object named `group` (default 'dressing') whose world bounding sphere
//       centre lies within r of (x, z) is hidden for the shot; shader materials (the pool, the beam)
//       are kept unless `shaders` is true
import * as THREE from 'three';
import { num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

class Hide implements Effect {
  private hidden: THREE.Object3D[] = [];
  private done = false;
  constructor(
    private cue: FxCue,
    private scene: THREE.Scene,
  ) {}

  update(_ctx: FxContext): void {
    if (this.done) return;
    this.done = true;
    const [x, z] = (this.cue.at as [number, number]) ?? [0, 0];
    const r = num(this.cue.r, 10);
    const name = String(this.cue.group ?? 'dressing');
    const c = new THREE.Vector3();
    this.scene.traverse((g) => {
      if (g.name !== name) return;
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        if (!this.cue.shaders && (m.material as THREE.Material & { isShaderMaterial?: boolean }).isShaderMaterial) return;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        c.copy(m.geometry.boundingSphere!.center).applyMatrix4(m.matrixWorld);
        if (Math.hypot(c.x - x, c.z - z) < r) {
          m.visible = false;
          this.hidden.push(m);
        }
      });
    });
  }

  dispose(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
  }
}

registerEffect('elf-hide', (cue, scene) => new Hide(cue, scene));
