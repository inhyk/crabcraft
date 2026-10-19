// Tidecrown, the limestone capital north of Clawhaven: built lazily on first entry (terrain, sky, sea, forests, the
// castle kit on its layout, statues), then shown and updated while the player is inside.
import * as THREE from 'three';
import type { Collision } from '../../sim/world/collision';
import { buildFoliage, type FoliageResult } from '../../world/foliage';
import { type Kit, loadKit } from '../../world/kit';
import { WORLD_UNIFORMS } from '../../world/materials';
import { buildTidecrownAtmosphere, TC_ENV_INTENSITY, TC_FOG, type TidecrownAtmosphere } from './atmosphere';
import { buildHorizon } from './horizon';
import { buildGulls } from './gulls';
import type { MapSnapshot } from '../snapshots';
import { paintTidecrownMap } from './minimap';
import { resolveTidecrown, TC_ARRIVAL, TC_ARRIVAL_YAW, tidecrownGround, tidecrownLayout, type TidecrownLayout } from './layout';
import { tidecrownMaterials } from './materials';
import { buildTidecrownStructures, type TidecrownStructures } from './structures';
import { TidecrownTerrain, tidecrownTerrainMaterial } from './terrain';

interface StubModule {
  buildStubKit(): Kit;
  buildStubStatues(): Promise<THREE.Object3D[]>;
}
interface StatueModule {
  buildHeroStatues(): Promise<THREE.Object3D[]>;
}
// Both resolve to nothing once their files are gone: the statues land from their own branch, the stub is deleted.
const statueModules: Partial<Record<string, () => Promise<StatueModule>>> = import.meta.glob<StatueModule>('./statues.ts');
const stubModules: Partial<Record<string, () => Promise<StubModule>>> = import.meta.glob<StubModule>('./stubKit.ts');

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function loadStub(): Promise<StubModule> {
  const load = stubModules['./stubKit.ts'];
  if (!load) throw new Error('tidecrown: castle kit and stub are both missing');
  return load();
}

export class TidecrownIsland {
  readonly root = new THREE.Group();
  readonly spawn = new THREE.Vector3(TC_ARRIVAL[0], 0, TC_ARRIVAL[1]);
  readonly spawnYaw = TC_ARRIVAL_YAW;
  readonly fog = TC_FOG;
  readonly envIntensity = TC_ENV_INTENSITY;
  layout!: TidecrownLayout;
  collision!: Collision;
  atmosphere!: TidecrownAtmosphere;
  structures!: TidecrownStructures;
  /** Minimap picture, painted from the terrain at build time. */
  map!: MapSnapshot;
  /** Which castle kit and statues were used ('glb' / 'stub'), and how long each build step took (ms). */
  readonly info: { kit: string; statues: string; steps: Record<string, number>; nature: Record<string, number> } = { kit: '', statues: '', steps: {}, nature: {} };
  private foliage: FoliageResult | null = null;
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
    this.layout = tidecrownLayout();
    this.collision = this.layout.col;
    this.spawn.y = this.layout.heightAt(this.spawn.x, this.spawn.z);
    step('layout', t0);
    onProgress?.(0.25);
    await tick();

    t0 = performance.now();
    const [village, nature] = await Promise.all([loadKit('models/world/village.glb'), loadKit('models/world/nature.glb')]);
    let kit: Kit;
    try {
      kit = await loadKit('models/world/tidecrown.glb');
      if (!kit.has('TC_Keep')) throw new Error('no TC_Keep');
      this.info.kit = 'glb';
    } catch {
      kit = (await loadStub()).buildStubKit();
      this.info.kit = 'stub';
    }
    const statueLoad = statueModules['./statues.ts'];
    const statues = statueLoad ? await (await statueLoad()).buildHeroStatues() : await (await loadStub()).buildStubStatues();
    this.info.statues = statueLoad ? 'statues.ts' : 'stub';
    step('assets', t0);
    onProgress?.(0.45);
    await tick();

    t0 = performance.now();
    const terrain = new TidecrownTerrain(this.layout.heights);
    const ground = terrain.buildMeshes(tidecrownTerrainMaterial(terrain, village, nature, WORLD_UNIFORMS.uTime));
    this.root.add(ground);
    const pines: [number, number][] = [];
    for (const [name, list] of this.layout.nature.trees.items) if (name.startsWith('Pine_')) for (const m of list) pines.push([m.elements[12], m.elements[14]]);
    this.map = paintTidecrownMap(terrain, pines);
    step('terrain', t0);
    onProgress?.(0.6);
    await tick();

    t0 = performance.now();
    const mats = tidecrownMaterials(village);
    this.lanternGlow = mats.TC_LanternGlow as THREE.MeshStandardMaterial;
    this.structures = buildTidecrownStructures(kit, village, mats, this.layout.placements, (x, z) => this.layout.heightAt(x, z), statues);
    this.root.add(this.structures.group);
    step('structures', t0);
    onProgress?.(0.75);
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

    t0 = performance.now();
    this.atmosphere = buildTidecrownAtmosphere(terrain, quality, WORLD_UNIFORMS.uTime, this.structures.lanternAt);
    this.root.add(this.atmosphere.group, buildHorizon(), buildGulls(WORLD_UNIFORMS.uTime));
    this.atmosphere.environment(renderer);
    step('atmosphere', t0);
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
      this.foliage?.update(camera);
    }
    if (this.lanternGlow) this.lanternGlow.emissiveIntensity = 3.2 + 0.5 * Math.sin(time * 1.3);
  }

  dispose(): void {
    this.atmosphere?.dispose();
    const mats = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      // Sprites share one geometry across three.js.
      if (m.geometry && !(o instanceof THREE.Sprite)) m.geometry.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      if (m.material) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
    });
    // Only textures made here; the kit maps and the shared noise belong to World I.
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && (v.userData.tidecrown || v instanceof THREE.CanvasTexture)) textures.add(v);
      m.dispose();
    }
    for (const t of textures) t.dispose();
  }
}
