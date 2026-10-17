// Feasibility spike (docs/server-world.md): World I's ground without a renderer.
// Terrain heights and the cliff/deep-water grid are pure math and build in Node as they do in the
// browser. Building, wreck and pier colliders are registered while their meshes are built from the
// GLB kits, so this world has none of them yet: a real server needs a collision bake (see the doc).
import * as THREE from 'three';
import { Collision } from '../../../src/world/collision';
import { POI_DEFS, SPAWN_POINTS } from '../../../src/world/layout';
import { Terrain } from '../../../src/world/terrain';
import type { Poi, PoiId, SpawnArea, World } from '../../../src/world/types';

export interface HeadlessWorld {
  world: World;
  buildMs: number;
  collision: Collision;
}

export function createHeadlessWorld(): HeadlessWorld {
  const t0 = performance.now();
  const terrain = new Terrain();
  const col = new Collision(terrain);
  col.buildBlocked();
  const pois = {} as Record<PoiId, Poi>;
  for (const [id, d] of Object.entries(POI_DEFS) as [PoiId, (typeof POI_DEFS)[PoiId]][]) {
    pois[id] = { id, position: new THREE.Vector3(d.x, d.y ?? col.heightAt(d.x, d.z), d.z), yaw: d.yaw, radius: d.radius };
  }
  const toV3 = ([x, z]: readonly [number, number]) => new THREE.Vector3(x, col.heightAt(x, z), z);
  const spawns: SpawnArea[] = [
    { id: 'scraplings', points: SPAWN_POINTS.scraplings.map(toV3), radius: 6 },
    { id: 'scavengers', points: SPAWN_POINTS.scavengers.map(toV3), radius: 3 },
    { id: 'townsfolk', points: SPAWN_POINTS.townsfolk.map(toV3), radius: 5 },
  ];
  const world: World = {
    root: new THREE.Group(),
    pois,
    spawns,
    heightAt: (x, z) => col.heightAt(x, z),
    resolveCollision: (x, z, r, out) => col.resolve(x, z, r, out),
    raycastSolid: (from, to) => col.raycast(from, to),
    update() {},
    setBeaconLit() {},
    setMood() {},
    // Night with the beacon lit: the state in which Corrodius can be fought.
    getEnvironment: () => ({ mood: 1, beacon: true }),
    dispose() {},
  };
  return { world, buildMs: performance.now() - t0, collision: col };
}
