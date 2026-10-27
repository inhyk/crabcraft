import * as THREE from 'three';
import { createWorld } from '../world/provider';
import { DawnIsland } from '../game/world3';
import { SnowIsland } from '../game/world4';
import { FrontierIsland } from '../game/frontierIsland';
import { buildStarHeights, starSurfaceHeight } from '../game/world2Height';
import { buildStarSettlement } from '../game/world2Settlement';
import { starGroundColor } from '../game/world2Ground';
import { StarSky } from '../game/starSky';
import { StarSea } from '../game/starSea';
import { StarSun } from '../game/starSun';
import { StarThrone } from '../game/starThrone';
import { starCrystalGarden, layoutStarhaven } from '../game/world2Colliders';
import { facetedStarCrystal } from '../game/starCrystal';

export type Scenery = {
  scene: THREE.Scene;
  height(x: number, z: number): number;
  raycast(from: THREE.Vector3, to: THREE.Vector3): number | null;
  update(dt: number, time: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3): void;
  dispose(): void;
};

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    if ((o as THREE.Light).isLight) (o as THREE.DirectionalLight).shadow?.dispose();
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  scene.clear();
}

/** Visuals only: no Game, physics, player input, save writes or multiplayer admission. */
export async function scenery(area: number, renderer: THREE.WebGLRenderer): Promise<Scenery> {
  const scene = new THREE.Scene();
  if (area === 1) {
    const world = await createWorld({ scene, renderer, quality: 'low' });
    return { scene, height: (x, z) => world.heightAt(x, z), raycast: (a, b) => world.raycastSolid(a, b), update: (dt, t, cam) => world.update(dt, t, cam), dispose: () => world.dispose() };
  }
  const dispose = () => disposeScene(scene);
  if (area === 3) {
    const island = new DawnIsland();
    scene.add(island.root);
    try { await island.buildSettlement(); } catch (e) { dispose(); throw e; }
    island.root.visible = true;
    scene.fog = new THREE.FogExp2(island.sky.skyHorizon, .0025);
    return { scene, height: (x, z) => island.height(x, z), raycast: (a, b) => island.collision.raycast(a, b), update: (_dt, t, cam, p) => { island.update(t, false, p.x, p.z); if (scene.fog instanceof THREE.FogExp2) island.fog(cam, scene.fog); }, dispose };
  }
  if (area === 4) {
    const island = new SnowIsland();
    scene.add(island.root);
    try { await island.buildSettlement(); } catch (e) { dispose(); throw e; }
    island.root.visible = true;
    scene.fog = new THREE.FogExp2(island.sky.skyHorizon, .003);
    return { scene, height: (x, z) => island.height(x, z), raycast: (a, b) => island.collision.raycast(a, b), update: (_dt, t, _cam, p) => island.update(t, p.x, p.z), dispose };
  }
  if (area === 5 || area === 6) {
    const island = new FrontierIsland(area);
    scene.add(island.root); island.root.visible = true;
    scene.fog = new THREE.FogExp2(area === 5 ? '#3d2a2c' : '#bcd6ea', .003);
    return { scene, height: (x, z) => island.height(x, z), raycast: (a, b) => island.collision.raycast(a, b), update: (_dt, t) => island.update(t), dispose };
  }
  // World II shares its exact terrain samples, biome colours, town kit and major landmarks.
  // Quest objects and combat effects are personal to each player and are not in the presence feed.
  const heights = buildStarHeights(), height = (x: number, z: number) => starSurfaceHeight(heights, x, z);
  const land = new THREE.PlaneGeometry(280, 320, 140, 160); land.rotateX(-Math.PI / 2);
  const pos = land.attributes.position, colors: number[] = [], color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = height(x, z);
    pos.setY(i, y); starGroundColor(x, z, y, color); colors.push(color.r, color.g, color.b);
  }
  land.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); land.computeVertexNormals();
  scene.add(new THREE.Mesh(land, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .94, metalness: .08 })));
  const sky = new StarSky(), sea = new StarSea(), sun = new StarSun();
  scene.add(sky.root, sea.root, sun.light, sun.light.target, new THREE.HemisphereLight('#869cff', '#1a1028', 1));
  const stone = new THREE.MeshStandardMaterial({ color: '#3c3b57', roughness: .78, metalness: .3 });
  const crystal = new THREE.MeshStandardMaterial({ color: '#a57bff', emissive: '#6524c9', emissiveIntensity: 1.5, metalness: .5, roughness: .2 });
  const teal = new THREE.MeshStandardMaterial({ color: '#b0fff1', emissive: '#26afba', emissiveIntensity: 1.3, metalness: .6, roughness: .25 });
  const throne = new StarThrone(height, stone, teal, crystal); scene.add(throne.root);
  const gardens = new THREE.InstancedMesh(facetedStarCrystal(), crystal, 90), matrix = new THREE.Matrix4();
  starCrystalGarden(height).forEach((c, i) => {
    if (c.clear) matrix.makeScale(0, 0, 0);
    else matrix.compose(new THREE.Vector3(c.x, c.y + c.h * .5, c.z), c.q, c.scale);
    gardens.setMatrixAt(i, matrix);
  });
  scene.add(gardens);
  let collision: ReturnType<typeof layoutStarhaven>;
  try {
    const settlement = await buildStarSettlement(height); scene.add(settlement.root);
    collision = layoutStarhaven(height, settlement.natureNames);
  } catch (e) { dispose(); throw e; }
  scene.fog = new THREE.FogExp2('#211e3b', .003);
  return { scene, height, raycast: (a, b) => collision.col.raycast(a, b), update: (_dt, t, camera, p) => { sky.update(t, camera, 1); sea.update(t); sun.update(p.x, p.z); throne.update(t); }, dispose };
}
