// World II's colliders, registered without meshes. HiddenWorld builds them this way in the browser;
// tools/bake-collision.mjs bakes the same registration for the server.
import { Collision } from '../world/collision';
import { starCrystalSpots } from './starCrystalLayout';
import { throneSolids } from './starThrone';
import { gateArchBoxes } from './starSanctum';
import { registerStarVillageLife } from './world2Life';
import { STAR_STORY_SOLIDS, starBoulders, starCraterShards } from './starFieldSpots';
import { registerStarSettlement, STAR_OBJECTIVES, starTrailDistance } from './world2Settlement';

/** The field crystals (starCrystalLayout.ts): clusters with reasons, open meadow between them. */
export function starCrystalGarden(height: (x: number, z: number) => number) {
  return starCrystalSpots(height);
}

/** Small teal crystals beside the starroad (world2.ts), every five metres, alternating sides; none where a pilgrim trail crosses. */
export function starRoadGuides(): [number, number][] {
  return Array.from({ length: 14 }, (_, i) => [(i % 2 ? 1 : -1) * 6.5, 5 - i * 5] as [number, number]).filter(([x, z]) => starTrailDistance(x, z) > 2.4);
}

export function layoutStarhaven(height: (x: number, z: number) => number, natureNames: readonly string[]) {
  const terrain = { minX: -140, minZ: -150, step: 2, nx: 141, nz: 161, heightAt: height, h: new Float32Array(141 * 161) };
  for (let j = 0; j < terrain.nz; j++) for (let i = 0; i < terrain.nx; i++) terrain.h[j * terrain.nx + i] = height(terrain.minX + i * 2, terrain.minZ + j * 2);
  const col = new Collision(terrain);
  registerStarSettlement(height, col, natureNames);
  const obstacles = throneSolids();
  // The obelisks; the one in the pilgrims' gate is a waist-high altar (starSanctum.ts), so sight passes over it.
  obstacles.forEach((o, i) => col.addCircle(o.x, o.z, o.r, height(o.x, o.z), height(o.x, o.z) + (i === 0 ? 1.4 : 12)));
  for (const c of starCrystalGarden(height)) col.addCircle(c.solid.x, c.solid.z, c.solid.r, c.solid.y0, c.solid.y1);
  // The pilgrims' gate's arch, above head height: sight only (the camera), never movement.
  for (const b of gateArchBoxes(height)) col.addBox(b.x, b.z, b.hx, b.hz, 0, b.y0, b.y1, true);
  for (const [x, z] of starRoadGuides()) col.addCircle(x, z, 0.62, height(x, z) - 0.5, height(x, z) + 1.9);
  registerStarVillageLife(height, col);
  // Field boulders, the crater's great shard and the story props (starFieldSpots.ts).
  for (const b of starBoulders()) if (b.solid) { const y = height(b.x, b.z); col.addCircle(b.x, b.z, b.r * 0.82, y - 0.3, y + b.h * 1.5); }
  const shard = starCraterShards()[0];
  col.addCircle(shard.x, shard.z, 0.85, height(shard.x, shard.z) - 0.5, height(shard.x, shard.z) + shard.h);
  for (const s of STAR_STORY_SOLIDS) col.addCircle(s.x, s.z, s.r, height(s.x, s.z) - 0.3, height(s.x, s.z) + s.h);
  // Quest props: waystone frames and ore beds.
  for (const [kind, [x, z]] of Object.entries(STAR_OBJECTIVES)) {
    const y = height(x, z);
    if (kind.startsWith('lamp-')) col.addCircle(x, z, 0.88, y, y + 3.15);
    else if (kind.startsWith('crystal-')) col.addCircle(x, z, 1.05, y, y + 0.4);
  }
  return { col, obstacles };
}
