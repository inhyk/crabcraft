// Move one merged Frostlight lamp out of the actors' lane for a cinematic take. The pole, kit
// lantern, flame, halo and pooled light move together; the game's original geometry is restored.
import * as THREE from 'three';
import { num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

class LampOffset implements Effect {
  private originals: { object: THREE.Mesh | THREE.Points; geometry: THREE.BufferGeometry }[] = [];
  private ready = false;
  private readonly at: THREE.Vector2;
  private readonly offset: THREE.Vector3;
  private readonly radius: number;

  constructor(cue: FxCue, private scene: THREE.Scene, ground: (x: number, z: number) => number) {
    const [x, z] = cue.at as [number, number];
    const [dx, dz] = cue.offset as [number, number];
    this.at = new THREE.Vector2(x, z);
    this.radius = num(cue.radius, 1.5);
    this.offset = new THREE.Vector3(dx, ground(x + dx, z + dz) - ground(x, z), dz);
  }

  private inside(p: THREE.Vector3): boolean {
    return Math.hypot(p.x - this.at.x, p.z - this.at.y) < this.radius;
  }

  update(_ctx: FxContext): void {
    const poles = this.scene.getObjectByName('frostlight-lamp-posts');
    if (!poles) return; // The village kit can finish loading after the shot is staged.
    if (!this.ready) {
      this.ready = true;
      const p = new THREE.Vector3();
      this.scene.updateMatrixWorld(true);
      this.scene.traverse((o) => {
        if (!['frostlight-lamp-posts', 'frostlight-lantern-flames', 'frostlight-lantern-glow'].includes(o.name)
          && !o.name.startsWith('frostlight-props:')) return;
        const object = o as THREE.Mesh | THREE.Points;
        const source = object.geometry;
        const positions = source?.getAttribute('position');
        if (!positions) return;
        const ids: number[] = [];
        for (let i = 0; i < positions.count; i++) {
          p.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
          if (this.inside(p)) ids.push(i);
        }
        if (!ids.length) return;
        const geometry = source.clone();
        const moved = geometry.getAttribute('position');
        const inverse = o.matrixWorld.clone().invert();
        for (const i of ids) {
          p.fromBufferAttribute(moved, i).applyMatrix4(o.matrixWorld).add(this.offset).applyMatrix4(inverse);
          moved.setXYZ(i, p.x, p.y, p.z);
        }
        moved.needsUpdate = true;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        this.originals.push({ object, geometry: source });
        object.geometry = geometry;
      });
    }
    // The village reassigns its pooled lights every frame before the cinema effects run.
    this.scene.traverse((o) => {
      if (o.name === 'frostlight-lamp-light' && this.inside(o.position)) o.position.add(this.offset);
    });
  }

  dispose(): void {
    for (const { object, geometry } of this.originals) {
      object.geometry.dispose();
      object.geometry = geometry;
    }
    this.originals = [];
    this.scene.traverse((o) => {
      if (o.name === 'frostlight-lamp-light' && this.inside(o.position.clone().sub(this.offset))) o.position.sub(this.offset);
    });
  }
}

registerEffect('snow-lamp-offset', (cue, scene, ground) => new LampOffset(cue, scene, ground));
