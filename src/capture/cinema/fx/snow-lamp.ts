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

/**
 * snow-props { moves: [{ at: [x, z], by: [dx, dz] | 'sink', radius }...], meshes: [name prefix...] }: every vertex
 * of the named merged meshes within `radius` of `at` moves by [dx, dz] (re-seated on the ground there) or, for
 * 'sink', under the snow; the game's geometry is restored after the shot.
 */
class PropMove implements Effect {
  private originals: { object: THREE.Mesh; geometry: THREE.BufferGeometry }[] = [];
  private ready = false;
  private moves: { at: THREE.Vector2; radius: number; offset: THREE.Vector3 }[];

  constructor(private cue: FxCue, private scene: THREE.Scene, ground: (x: number, z: number) => number) {
    this.moves = ((cue.moves as { at: [number, number]; by: [number, number] | 'sink'; radius?: number }[]) ?? []).map((m) => {
      const [x, z] = m.at;
      const offset = m.by === 'sink' ? new THREE.Vector3(0, -40, 0) : new THREE.Vector3(m.by[0], ground(x + m.by[0], z + m.by[1]) - ground(x, z), m.by[1]);
      return { at: new THREE.Vector2(x, z), radius: m.radius ?? 2, offset };
    });
  }

  update(_ctx: FxContext): void {
    if (this.ready) return;
    const prefixes = (this.cue.meshes as string[]) ?? ['frostlight-sites-'];
    const p = new THREE.Vector3();
    const found: THREE.Mesh[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && prefixes.some((n) => o.name.startsWith(n))) found.push(m);
    });
    if (!found.length) return; // The world can finish building after the shot is staged.
    this.ready = true;
    this.scene.updateMatrixWorld(true);
    for (const object of found) {
      const source = object.geometry;
      const positions = source.getAttribute('position');
      if (!positions) continue;
      const hits: [number, THREE.Vector3][] = [];
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        const m = this.moves.find((m) => Math.hypot(p.x - m.at.x, p.z - m.at.y) < m.radius);
        if (m) hits.push([i, m.offset]);
      }
      if (!hits.length) continue;
      const geometry = source.clone();
      const moved = geometry.getAttribute('position');
      const inverse = object.matrixWorld.clone().invert();
      for (const [i, offset] of hits) {
        p.fromBufferAttribute(moved, i).applyMatrix4(object.matrixWorld).add(offset).applyMatrix4(inverse);
        moved.setXYZ(i, p.x, p.y, p.z);
      }
      moved.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      this.originals.push({ object, geometry: source });
      object.geometry = geometry;
    }
  }

  dispose(): void {
    for (const { object, geometry } of this.originals) {
      object.geometry.dispose();
      object.geometry = geometry;
    }
    this.originals = [];
  }
}

registerEffect('snow-props', (cue, scene, ground) => new PropMove(cue, scene, ground));
