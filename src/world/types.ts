// Contract between the world (src/world) and gameplay (src/game).
import type * as THREE from 'three';

export type PoiId =
  | 'spawn' | 'forge' | 'chapel' | 'tavern' | 'grove' | 'shore' | 'lighthouse' | 'wreck'
  | 'beacon' | 'bossArena' | 'npc:brinebeard' | 'npc:silvermoon' | 'npc:coralline'
  | 'npc:grukk' | 'npc:hoofclaw' | 'npc:rattlebolt' | 'npc:pip';

export interface Poi {
  id: PoiId;
  position: THREE.Vector3;
  /** Facing as yaw (radians, 0 = +Z). */
  yaw: number;
  radius: number;
}

export interface SpawnArea {
  id: 'scraplings' | 'scavengers' | 'townsfolk';
  /** Points on the ground where enemies or ambient NPCs may spawn and wander. */
  points: THREE.Vector3[];
  /** Wander radius around each point. */
  radius: number;
}

export interface World {
  /** Everything static: terrain, buildings, props, water, sky. Add to the scene once. */
  readonly root: THREE.Group;
  readonly pois: Record<PoiId, Poi>;
  readonly spawns: SpawnArea[];
  /** Ground height at x,z (terrain, docks, the wreck deck, lighthouse stairs). */
  heightAt(x: number, z: number): number;
  /**
   * Push a circle (character) out of solid obstacles. Returns the corrected x,z.
   * Characters are circles of `radius` on the XZ plane.
   */
  resolveCollision(x: number, z: number, radius: number, out: THREE.Vector2): THREE.Vector2;
  /** Line of sight for ranged spells and camera collision. */
  raycastSolid(from: THREE.Vector3, to: THREE.Vector3): number | null;
  /** Called every frame: water, foliage sway, beacon, fog, ambient particles. */
  update(dt: number, elapsed: number, camera: THREE.Camera): void;
  /** Quest hooks. */
  setBeaconLit(lit: boolean): void;
  /** 0 = dusk (start), 1 = night (boss), 2 = celebration (ending fireworks). */
  setMood(mood: 0 | 1 | 2, instant?: boolean): void;
  getEnvironment(): { mood: 0 | 1 | 2; beacon: boolean };
  dispose(): void;
}

export interface WorldOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  quality: 'low' | 'high';
  onProgress?: (fraction: number, label: string) => void;
}

export type CreateWorld = (opts: WorldOptions) => Promise<World>;
