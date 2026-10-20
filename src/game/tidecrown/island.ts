// Tidecrown, the limestone capital north of Clawhaven: built lazily on first entry (terrain, sky, sea, forests, the
// castle kit on its layout, statues), then shown and updated while the player is inside.
import * as THREE from 'three';
import type { Collision } from '../../sim/world/collision';
import { buildFoliage, type FoliageResult } from '../../world/foliage';
import { loadKit } from '../../world/kit';
import { buildTidecrownCity, type TidecrownCity } from './city';
import { loadTidecrownKit } from './houses';
import { WORLD_UNIFORMS } from '../../world/materials';
import { buildTidecrownAtmosphere, TC_ENV_INTENSITY, TC_FOG, type TidecrownAtmosphere } from './atmosphere';
import { buildHorizon } from './horizon';
import { buildGulls } from './gulls';
import { type GroundLight, paintGroundLight } from './groundLight';
import type { MapSnapshot } from '../snapshots';
import { paintTidecrownMap } from './minimap';
import { buildTidecrownHeights } from '../../sim/world/tidecrownGround';
import { TC_MARKET } from './cityPlan';
import { resolveTidecrown, TC_ARRIVAL, TC_ARRIVAL_YAW, tcAxis, tidecrownGround, tidecrownLayout, type TidecrownLayout } from './layout';
import { tidecrownMaterials } from './materials';
import { buildHeroStatues } from './statues';
import { buildTidecrownStructures, type TidecrownStructures } from './structures';
import { TidecrownTerrain, tidecrownTerrainMaterial } from './terrain';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** The landform's heights and ground splat on a worker (the same numbers as on the main thread), or here if workers
 * fail. */
function offThread(): { heights: Promise<Float32Array>; splat: Promise<Uint8Array | undefined> } {
  let toH!: (h: Float32Array) => void, toS!: (s?: Uint8Array) => void;
  const heights = new Promise<Float32Array>((r) => (toH = r)), splat = new Promise<Uint8Array | undefined>((r) => (toS = r));
  let w: Worker | null = null, got = false;
  const fallback = () => {
    w?.terminate();
    if (!got) toH(buildTidecrownHeights());
    toS(undefined);
  };
  try {
    w = new Worker(new URL('./heights.worker.ts', import.meta.url), { type: 'module', name: 'tidecrown-heights' });
  } catch {
    fallback();
    return { heights, splat };
  }
  w.onmessage = (e: MessageEvent<{ heights?: Float32Array; splat?: Uint8Array }>) => {
    if (e.data.heights) { got = true; toH(e.data.heights); }
    if (e.data.splat) { toS(e.data.splat); w!.terminate(); }
  };
  w.onerror = fallback;
  w.postMessage(0);
  return { heights, splat };
}

/** Every kit at once (World I's village, props and nature for the townhouses, the castle, the districts' landmarks and
 * the harbour) and the statues. */
const loadAll = () => Promise.all([
  loadTidecrownKit(), loadKit('models/world/tidecrown.glb'), loadKit('models/world/tidecrown-city.glb'), loadKit('models/world/tidecrown-harbor.glb'), buildHeroStatues(),
]);
let early: { loading: ReturnType<typeof loadAll>; heights: Promise<Float32Array>; splat: Promise<Uint8Array | undefined> } | null = null;

/** Start what need not wait for the fade: the kits' download and parse, and the heights. build() takes them up. */
export function prefetchTidecrown(): void {
  early ??= { loading: loadAll(), ...offThread() };
}

export class TidecrownIsland {
  readonly root = new THREE.Group();
  readonly spawn = new THREE.Vector3(TC_ARRIVAL[0], 0, TC_ARRIVAL[1]);
  readonly spawnYaw = TC_ARRIVAL_YAW;
  /** Scene fog while inside; the colour follows the camera (warmer facing the sun). */
  readonly fog = { color: TC_FOG.color.clone(), density: TC_FOG.density };
  readonly envIntensity = TC_ENV_INTENSITY;
  layout!: TidecrownLayout;
  collision!: Collision;
  atmosphere!: TidecrownAtmosphere;
  structures!: TidecrownStructures;
  city!: TidecrownCity;
  /** Open squares and streets where Clawhaven's townsfolk stroll while the player is here: a few points each. */
  readonly strolls: [number, number][][] = [
    [tcAxis(10, -9), tcAxis(10, 9), tcAxis(24, -9), tcAxis(24, 9)],
    [tcAxis(114, -6), tcAxis(124, 6), tcAxis(134, -6), tcAxis(144, 6)],
    [[-46, -6], [-31, -1], [-16, -6]],
    [tcAxis(158, -10), tcAxis(158, 10), tcAxis(162, 0)],
    [45, 135, 225, 315].map((a) => [TC_MARKET.centre[0] + 33.5 * Math.cos((a * Math.PI) / 180), TC_MARKET.centre[1] + 33.5 * Math.sin((a * Math.PI) / 180)] as [number, number]),
  ];
  /** Minimap picture, painted from the terrain at build time. */
  map!: MapSnapshot;
  /** How long each build step took (ms) and how much nature was scattered. */
  readonly info: { steps: Record<string, number>; nature: Record<string, number>; city: Record<string, number> } = { steps: {}, nature: {}, city: {} };
  private foliage: FoliageResult | null = null;
  private groundLight: GroundLight | null = null;
  private lanternGlow: THREE.MeshStandardMaterial | null = null;
  private built = false;

  constructor() {
    this.root.name = 'tidecrown';
    this.root.visible = false;
  }

  /** Ground plus walkable decks; the analytic landform before the build. */
  height(x: number, z: number): number {
    return this.built ? this.layout.heightAt(x, z) : tidecrownGround(x, z);
  }
  resolve<T extends { set(x: number, y: number): T }>(x: number, z: number, r: number, out: T): T {
    return resolveTidecrown(this.collision, x, z, r, out);
  }

  async build(renderer: THREE.WebGLRenderer, quality: 'low' | 'high', onProgress?: (f: number) => void): Promise<void> {
    if (this.built) return;
    const step = (name: string, t0: number) => (this.info.steps[name] = Math.round(performance.now() - t0));
    let t0 = performance.now();
    // The kits load while the layout is worked out, on heights from a worker (both usually started under the fade).
    prefetchTidecrown();
    const { loading, heights, splat } = early!;
    early = null;
    await tick();
    this.layout = tidecrownLayout(await heights);
    this.collision = this.layout.col;
    this.spawn.y = this.layout.heightAt(this.spawn.x, this.spawn.z);
    step('layout', t0);
    onProgress?.(0.25);
    await tick();

    t0 = performance.now();
    const [tide, kit, cityKit, harbourKit, statues] = await loading;
    const { village, nature } = tide;
    step('assets', t0);
    onProgress?.(0.45);
    await tick();

    t0 = performance.now();
    const terrain = new TidecrownTerrain(this.layout.heights, await splat);
    this.groundLight = paintGroundLight(this.layout.city);
    const ground = terrain.buildMeshes(tidecrownTerrainMaterial(terrain, village, nature, WORLD_UNIFORMS.uTime, this.groundLight));
    this.root.add(ground);
    const pines: [number, number][] = [];
    for (const [name, list] of this.layout.nature.trees.items) if (name.startsWith('Pine_')) for (const m of list) pines.push([m.elements[12], m.elements[14]]);
    this.map = paintTidecrownMap(terrain, pines, this.layout.city);
    step('terrain', t0);
    onProgress?.(0.6);
    await tick();

    t0 = performance.now();
    const mats = tidecrownMaterials(village);
    this.lanternGlow = mats.TC_LanternGlow as THREE.MeshStandardMaterial;
    this.structures = buildTidecrownStructures(kit, village, mats, this.layout.placements, (x, z) => this.layout.heightAt(x, z), statues);
    this.root.add(this.structures.group);
    step('structures', t0);
    onProgress?.(0.7);
    await tick();

    // The sky before the city: its canals reflect it.
    t0 = performance.now();
    this.atmosphere = buildTidecrownAtmosphere(terrain, quality, WORLD_UNIFORMS.uTime, this.structures.lanternAt);
    this.root.add(this.atmosphere.group, buildHorizon(), buildGulls(WORLD_UNIFORMS.uTime));
    this.atmosphere.environment(renderer);
    step('atmosphere', t0);
    await tick();

    t0 = performance.now();
    this.city = buildTidecrownCity({ tide, city: cityKit, harbour: harbourKit }, mats, this.atmosphere.skyU, this.layout.city, (x, z) => this.layout.heightAt(x, z), renderer, quality);
    this.root.add(this.city.group);
    this.info.city = { ...this.city.stats.ms, plan: this.layout.city.ms };
    step('city', t0);
    onProgress?.(0.8);
    await tick();

    t0 = performance.now();
    const scatter = this.layout.nature;
    if (quality === 'low') {
      // Graphics settings thin decoration only; trees and rocks (which block movement) all stay.
      for (const [name, list] of scatter.small.items) if (!name.startsWith('Rock_')) scatter.small.items.set(name, list.filter((_, i) => i % 5 < 3));
      scatter.tufts.forEach((l, i) => (scatter.tufts[i] = l.filter((_, k) => k % 9 < 4)));
    }
    this.foliage = buildFoliage(nature, scatter, quality);
    this.foliage.group.name = 'tidecrown-foliage';
    this.root.add(this.foliage.group);
    this.info.nature = { ...this.foliage.counts };
    step('foliage', t0);
    onProgress?.(0.9);
    await tick();

    this.built = true;
    onProgress?.(1);
  }

  /** The prefiltered sky for scene.environment while inside. */
  environment(renderer: THREE.WebGLRenderer): THREE.Texture {
    return this.atmosphere.environment(renderer);
  }

  update(time: number, playerX: number, playerZ: number, camera?: THREE.Camera): void {
    if (!this.built) return;
    if (camera) {
      this.atmosphere.update(time, camera, playerX, playerZ, (x, z) => this.layout.heightAt(x, z));
      this.atmosphere.hazeColor(camera, this.fog.color);
      this.foliage?.update(camera);
    }
    if (this.lanternGlow) this.lanternGlow.emissiveIntensity = 3.2 + 0.5 * Math.sin(time * 1.3);
    this.structures.flame.emissiveIntensity = 2.6 + 0.6 * Math.sin(time * 11) * Math.sin(time * 6.3);
    this.city.update(time, camera);
    this.refine(6);
  }

  private detailDone!: () => void;
  /** The houses' near detail streams in a few ms a frame around the camera; this resolves once it has first caught up. */
  readonly detail = new Promise<void>((r) => (this.detailDone = r));
  /** The near detail the camera needs is in. */
  detailed = false;
  /** Build (and free) `budget` ms of the houses' near detail for where the camera is (the island's update does 6 a frame). */
  refine(budget: number): boolean {
    if (!this.built) return false;
    this.detailed = this.city.refine(budget);
    if (this.detailed) this.detailDone();
    return this.detailed;
  }

  /**
   * Just entered (the fade still up): let the first frames render, so the shader links and texture uploads of what
   * the arrival sees happen behind the fade, not after it lifts.
   */
  async settle(): Promise<void> {
    for (let i = 0; i < 3; i++) await frame();
  }

  /** Leaving: the houses' near detail goes (it streams in again on return). */
  leave(): void {
    if (this.built) this.city.release();
  }

  dispose(): void {
    this.atmosphere?.dispose();
    // The houses' pools free their own GPU buffers.
    this.city?.dispose();
    const mats = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      // A BatchedMesh owns its matrix and indirection textures as well as its geometry; sprites share one geometry.
      if ((o as THREE.BatchedMesh).isBatchedMesh) (o as THREE.BatchedMesh).dispose();
      else if (m.geometry && !(o instanceof THREE.Sprite)) m.geometry.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      if (m.material) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
    });
    // Only textures made here; the kit maps and the shared noise belong to World I.
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && (v.userData.tidecrown || v instanceof THREE.CanvasTexture)) textures.add(v);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    this.groundLight?.texture.dispose();
  }
}
