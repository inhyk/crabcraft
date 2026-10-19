// Clear the lens's lane through a wood: instanced vegetation (trees, bushes, rocks) standing on the
// camera's path is dropped for the shot, so trunks pass beside the lens instead of filling it.
// The fields repack their buffers every frame, so the cut is applied in the scene's onBeforeRender,
// after every update and before the renderer reads the instance matrices.
//
//   night-clear { cut: [[x, z, r], ...], match, skip }
//       every instance of a mesh whose name matches `match` (regex, default all) and not `skip`
//       (default 'grass') with its origin within r of a cut point is scaled to nothing
//   night-drop { at: [x, z], r, above }
//       hides scenery placed within r of (x, z) and more than `above` over the ground there
//       (unnamed props such as Starhaven's astrolabe, which `hide` cannot name)
import * as THREE from 'three';
import { registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

class Clear implements Effect {
  private cut: [number, number, number][];
  private match: RegExp;
  private skip: RegExp;
  private prev: THREE.Scene['onBeforeRender'];
  constructor(
    cue: FxCue,
    private scene: THREE.Scene,
  ) {
    this.cut = (cue.cut as [number, number, number][]) ?? [];
    this.match = new RegExp(String(cue.match ?? '.'));
    this.skip = new RegExp(String(cue.skip ?? 'grass'));
    this.prev = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      this.prev.apply(scene, args);
      this.apply();
    };
  }

  private apply(): void {
    const cut = this.cut;
    if (!cut.length) return;
    this.scene.traverseVisible((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !this.match.test(im.name) || this.skip.test(im.name)) return;
      const a = im.instanceMatrix.array as Float32Array;
      let hit = false;
      for (let i = 0; i < im.count; i++) {
        const x = a[i * 16 + 12];
        const z = a[i * 16 + 14];
        for (const [cx, cz, r] of cut) {
          if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) {
            for (let k = 0; k < 11; k++) a[i * 16 + k] = 0;
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        im.instanceMatrix.clearUpdateRanges();
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }

  update(_ctx: FxContext): void {}

  dispose(): void {
    this.scene.onBeforeRender = this.prev;
  }
}

class Drop implements Effect {
  private hidden: THREE.Object3D[] = [];
  private done = false;
  constructor(
    private cue: FxCue,
    private scene: THREE.Scene,
  ) {}

  update(ctx: FxContext): void {
    if (this.done) return;
    this.done = true;
    const [x, z] = (this.cue.at as [number, number]) ?? [0, 0];
    const r = Number(this.cue.r ?? 1);
    const y0 = ctx.ground(x, z) + Number(this.cue.above ?? 0);
    const p = new THREE.Vector3();
    this.scene.traverse((o) => {
      if (o === this.scene || !o.visible || o.parent === this.scene) return;
      o.getWorldPosition(p);
      if (Math.hypot(p.x - x, p.z - z) < r && p.y > y0) {
        o.visible = false;
        this.hidden.push(o);
      }
    });
  }

  dispose(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
  }
}

registerEffect('night-clear', (cue, scene) => new Clear(cue, scene));
registerEffect('night-drop', (cue, scene) => new Drop(cue, scene));
