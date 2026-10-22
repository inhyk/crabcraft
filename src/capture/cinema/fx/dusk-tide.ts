// dusk-tide: Tidecrown regraded for the burning city while the cue's shot runs: the sky's colours and
// cloud, the sun's direction, colour and strength, the sky fill and the reflections; the keep's cyan
// lantern (light, beam, halo), the seaglass glows and the gulls are hidden. All put back afterwards.
//
//   sky     { zenith, mid, horizon, ground, sun, glow, cloudLit, cloudShade }: colours; cover, sunVis: numbers
//   sunDir  [x, y, z] toward the sun (the sky's sun and the key light's direction)
//   sun     { color, intensity }     hemi { sky, ground, intensity }     env: reflections' intensity
//   hide    more object names kept hidden
//   mats    { <material name>: { color, emissive, intensity } }: the island's materials recoloured (the
//           cyan lantern glass to firelight, the windows dimmed)
import * as THREE from 'three';
import { registerEffect, type Effect } from '../fx';
import type { FxCue } from '../types';

type Uniforms = Record<string, { value: unknown }>;
interface Atmosphere {
  skyU: Uniforms;
  sun: THREE.DirectionalLight;
  lanternLight: THREE.PointLight;
  group: THREE.Group;
}

const SKY: Record<string, string> = { zenith: 'uZenith', mid: 'uMid', horizon: 'uHorizon', ground: 'uGround', sun: 'uSunColor', glow: 'uGlow', cloudLit: 'uCloudLit', cloudShade: 'uCloudShade' };
const HIDE = ['tc-lantern-beam', 'tc-lantern-halo', 'tidecrown-gulls', 'tc-crystal-glow', 'tc-seaglass-glow'];

class Tide implements Effect {
  private atmos: Atmosphere | null = null;
  private undo: (() => void)[] = [];
  private hidden: THREE.Object3D[] = [];
  private dir = new THREE.Vector3();
  constructor(
    private cue: FxCue,
    private scene: THREE.Scene,
  ) {}

  private take(): Atmosphere | null {
    if (this.atmos) return this.atmos;
    const g = (window as unknown as { app?: { current?: { game?: { world2?: { tidecrown?: { atmosphere?: Atmosphere } } } } } }).app?.current?.game;
    const a = g?.world2?.tidecrown?.atmosphere;
    if (!a) return null;
    this.atmos = a;
    const cue = this.cue;
    const set = <T>(get: () => T, put: (v: T) => void, v: T) => {
      const old = get();
      this.undo.push(() => put(old));
      put(v);
    };
    const sky = (cue.sky ?? {}) as Record<string, string | number>;
    for (const [k, u] of Object.entries(SKY)) {
      if (sky[k] === undefined) continue;
      const c = a.skyU[u].value as THREE.Color;
      const old = c.clone();
      this.undo.push(() => c.copy(old));
      c.set(String(sky[k]));
    }
    if (sky.cover !== undefined) set(() => a.skyU.uCloudCover.value as number, (v) => (a.skyU.uCloudCover.value = v), Number(sky.cover));
    if (sky.sunVis !== undefined) set(() => a.skyU.uSunVis.value as number, (v) => (a.skyU.uSunVis.value = v), Number(sky.sunVis));
    if (cue.sunDir) {
      this.dir.set(...(cue.sunDir as [number, number, number])).normalize();
      const v = a.skyU.uSunDir.value as THREE.Vector3;
      const old = v.clone();
      this.undo.push(() => v.copy(old));
      v.copy(this.dir);
    }
    const sun = (cue.sun ?? {}) as { color?: string; intensity?: number };
    if (sun.color) set(() => a.sun.color.clone(), (c) => a.sun.color.copy(c), new THREE.Color(sun.color));
    if (sun.intensity !== undefined) set(() => a.sun.intensity, (v) => (a.sun.intensity = v), sun.intensity);
    const hemi = a.group.children.find((o) => o instanceof THREE.HemisphereLight) as THREE.HemisphereLight | undefined;
    const h = (cue.hemi ?? {}) as { sky?: string; ground?: string; intensity?: number };
    if (hemi) {
      if (h.sky) set(() => hemi.color.clone(), (c) => hemi.color.copy(c), new THREE.Color(h.sky));
      if (h.ground) set(() => hemi.groundColor.clone(), (c) => hemi.groundColor.copy(c), new THREE.Color(h.ground));
      if (h.intensity !== undefined) set(() => hemi.intensity, (v) => (hemi.intensity = v), h.intensity);
    }
    if (cue.env !== undefined) {
      const old = this.scene.environmentIntensity;
      this.undo.push(() => (this.scene.environmentIntensity = old));
    }
    const mats = (cue.mats ?? {}) as Record<string, { color?: string; emissive?: string; intensity?: number }>;
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        const want = mats[mat.name];
        if (!want || seen.has(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue;
        seen.add(mat);
        if (want.color) set(() => mat.color.clone(), (c) => mat.color.copy(c), new THREE.Color(want.color));
        if (want.emissive) set(() => mat.emissive.clone(), (c) => mat.emissive.copy(c), new THREE.Color(want.emissive));
        if (want.intensity !== undefined) set(() => mat.emissiveIntensity, (v) => (mat.emissiveIntensity = v), want.intensity);
      }
    });
    const names = new Set([...HIDE, ...((cue.hide as string[]) ?? [])]);
    this.scene.traverse((o) => {
      if (names.has(o.name) && o.visible) this.hidden.push(o);
    });
    this.hidden.push(a.lanternLight);
    return a;
  }

  update(): void {
    const a = this.take();
    if (!a) return;
    for (const o of this.hidden) o.visible = false;
    // The island moves its sun to its own direction every frame; this runs after it.
    if (this.cue.sunDir) {
      a.sun.position.copy(a.sun.target.position).addScaledVector(this.dir, 300);
      a.sun.updateMatrixWorld();
    }
    if (this.cue.env !== undefined) this.scene.environmentIntensity = Number(this.cue.env);
  }

  dispose(): void {
    for (const f of this.undo.reverse()) f();
    this.undo = [];
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.atmos = null;
  }
}

registerEffect('dusk-tide', (cue, scene) => new Tide(cue, scene));
