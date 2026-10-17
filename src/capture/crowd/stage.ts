// A dance deck on the bay for the crowd: the pier's own dark plank tiles on posts in the water, a
// light-planked stage at the front for the hero, torches along the rim and banners at the corners,
// built from the village and props kits Clawhaven is made of.
import * as THREE from 'three';
import { loadKit, StaticBatch, trs } from '../../world/kit';
import { plankMaterial } from '../../world/materials';
import { worldBox } from '../../world/geom';
import type { Crowd } from './crowd';

/** Deck size in formation coordinates (centred on the formation), units. */
export interface DeckSpec {
  /** Across (formation x) and front to back (z). */
  width: number;
  depth: number;
  /** Top of the planks above sea level. */
  y: number;
  /** The hero's stage: width and depth at the front edge, and how much higher it stands. */
  stage?: { width: number; depth: number; rise: number };
  /** Extra deck in front of the formation's centre line, units (default depth / 2). */
  front?: number;
}

export interface Deck {
  group: THREE.Group;
  /** Ground height at a formation point, or null off the deck. */
  heightAt(x: number, z: number): number | null;
  /** Torch flames in world space, and their glowing balls (hidden right at the lens). */
  flames: THREE.Vector3[];
  flameMeshes: THREE.Mesh[];
  /** Stage lights on the rim, aimed at the crowd; off (intensity 0) until a program raises them. */
  spots: THREE.SpotLight[];
  /** Full intensity of each spot. */
  spotIntensity: number;
}

const TILE = 2;

export async function buildDeck(crowd: Crowd, spec: DeckSpec): Promise<Deck> {
  const [village, props] = await Promise.all([loadKit('models/world/village.glb'), loadKit('models/world/props.glb')]);
  const group = new THREE.Group();
  group.name = 'crowd-deck';
  const deck = new StaticBatch(village, 'crowd-deck-planks');
  const propBatch = new StaticBatch(props, 'crowd-deck-props');
  const planks = plankMaterial();
  const beams: THREE.BufferGeometry[] = [];
  const yaw = crowd.siteYaw;
  const front = spec.front ?? spec.depth / 2;
  const back = front - spec.depth;
  const hw = spec.width / 2;
  const st = spec.stage;
  const flames: THREE.Vector3[] = [];
  const w = new THREE.Vector3();
  const place = (x: number, z: number, y: number) => crowd.toWorld(x, 0, z, w).setY(y);
  const inStage = (x: number, z: number) => !!st && Math.abs(x) < st.width / 2 && z > front - st.depth;

  // Planks: the pier's tiles, the hero's stage in the light ones.
  for (let x = -hw + TILE / 2; x < hw; x += TILE) {
    for (let z = back + TILE / 2; z < front; z += TILE) {
      const s = inStage(x, z);
      place(x, z, spec.y + (s ? st!.rise : 0));
      deck.add(s ? 'Floor_WoodLight' : 'Floor_WoodDark', trs(w.x, w.y, w.z, yaw));
    }
  }
  // The stage's front and sides, a beam all round the deck, posts down into the water.
  const beam = (x0: number, z0: number, x1: number, z1: number, y: number, h: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const a = crowd.toWorld((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const g = worldBox(len, h, 0.35, 1);
    // Box length along formation x, turned to the segment, then to the site.
    const ang = Math.atan2(-(z1 - z0), x1 - x0);
    g.rotateY(ang + yaw);
    g.translate(a.x, y, a.z);
    beams.push(g);
  };
  beam(-hw, front, hw, front, spec.y - 0.2, 0.4);
  beam(-hw, back, hw, back, spec.y - 0.2, 0.4);
  beam(-hw, back, -hw, front, spec.y - 0.2, 0.4);
  beam(hw, back, hw, front, spec.y - 0.2, 0.4);
  if (st) {
    beam(-st.width / 2, front, st.width / 2, front, spec.y + st.rise / 2 - 0.02, st.rise + 0.04);
    beam(-st.width / 2, front - st.depth, -st.width / 2, front, spec.y + st.rise / 2 - 0.02, st.rise + 0.04);
    beam(st.width / 2, front - st.depth, st.width / 2, front, spec.y + st.rise / 2 - 0.02, st.rise + 0.04);
    beam(-st.width / 2, front - st.depth, st.width / 2, front - st.depth, spec.y + st.rise / 2 - 0.02, st.rise + 0.04);
  }
  const post = (x: number, z: number, top: number) => {
    const p = crowd.toWorld(x, 0, z);
    beams.push(new THREE.CylinderGeometry(0.22, 0.26, top + 3, 7).translate(p.x, (top - 3) / 2, p.z));
  };
  for (let x = -hw; x <= hw + 1e-6; x += 4) {
    post(x, front, spec.y - 0.1);
    post(x, back, spec.y - 0.1);
  }
  for (let z = back + 4; z < front - 1e-6; z += 4) {
    post(-hw, z, spec.y - 0.1);
    post(hw, z, spec.y - 0.1);
  }
  // Torches on tall posts round the rim (not across the front: the camera looks in there).
  const torch = (x: number, z: number) => {
    const p = crowd.toWorld(x, 0, z);
    beams.push(new THREE.CylinderGeometry(0.12, 0.15, 3.0, 6).translate(p.x, spec.y + 1.5, p.z));
    propBatch.add('Torch_Metal', trs(p.x, spec.y + 3.0, p.z, yaw, 1.1));
    flames.push(new THREE.Vector3(p.x, spec.y + 3.75, p.z));
  };
  for (let x = -hw + 0.6; x <= hw; x += 8) torch(x, back + 0.6);
  for (let z = back + 8.6; z < front - 6; z += 8) {
    torch(-hw + 0.6, z);
    torch(hw - 0.6, z);
  }
  // Banners on tall poles at the four corners.
  const banner = (x: number, z: number, which: string) => {
    const p = crowd.toWorld(x, 0, z);
    beams.push(new THREE.CylinderGeometry(0.14, 0.18, 7.5, 6).translate(p.x, spec.y + 3.75, p.z));
    propBatch.add(which, trs(p.x, spec.y + 6.4, p.z, yaw + Math.PI, 1.5));
  };
  banner(-hw + 0.3, back + 0.3, 'Banner_1');
  banner(hw - 0.3, back + 0.3, 'Banner_2');
  banner(-hw + 0.3, front - 0.3, 'Banner_2');
  banner(hw - 0.3, front - 0.3, 'Banner_1');

  group.add(deck.build(), propBatch.build());
  const merged = mergeGeos(beams);
  const beamMesh = new THREE.Mesh(merged, planks);
  beamMesh.castShadow = beamMesh.receiveShadow = true;
  group.add(beamMesh);

  // Flames: small HDR balls the bloom turns into a glow.
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb04a').multiplyScalar(4), toneMapped: false });
  const flameGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const flameMeshes = flames.map((f) => {
    const m = new THREE.Mesh(flameGeo, flameMat);
    m.position.copy(f);
    group.add(m);
    return m;
  });

  // Stage lights on tall masts at the corners and the middle of each side, crossing over the crowd
  // in warm white, magenta and cyan. They exist from the start (a light added later would make
  // every material recompile) and stay dark until the program turns them up.
  const spots: THREE.SpotLight[] = [];
  const SPOT_COLORS = ['#ffe2b0', '#ff5ac8', '#5ad8ff', '#ffe2b0', '#ff5ac8', '#5ad8ff'];
  const masts: [number, number][] = [[-hw + 0.5, front - 0.5], [hw - 0.5, front - 0.5], [-hw + 0.5, (front + back) / 2], [hw - 0.5, (front + back) / 2], [-hw + 0.5, back + 0.5], [hw - 0.5, back + 0.5]];
  masts.forEach(([x, z], i) => {
    const p = crowd.toWorld(x, 0, z);
    beams.push(new THREE.CylinderGeometry(0.16, 0.2, 9, 6).translate(p.x, spec.y + 4.5, p.z));
    const spot = new THREE.SpotLight(SPOT_COLORS[i % SPOT_COLORS.length], 0, 140, 0.62, 0.55, 1);
    spot.position.set(p.x, spec.y + 9.2, p.z);
    const aim = crowd.toWorld(-x * 0.35, 0, (front + back) / 2 + (z - (front + back) / 2) * -0.3);
    spot.target.position.set(aim.x, spec.y, aim.z);
    spot.castShadow = false;
    group.add(spot, spot.target);
    spots.push(spot);
  });
  const merged2 = mergeGeos(beams.splice(0));
  const mastMesh = new THREE.Mesh(merged2, planks);
  mastMesh.castShadow = mastMesh.receiveShadow = true;
  group.add(mastMesh);

  return {
    group,
    flames,
    flameMeshes,
    spots,
    spotIntensity: 55,
    heightAt(x, z) {
      if (Math.abs(x) > hw || z > front || z < back) return null;
      return spec.y + (inStage(x, z) ? st!.rise : 0);
    },
  };
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Same attribute set everywhere (boxes and cylinders both have position, normal, uv).
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of nonIndexed) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const size = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of nonIndexed) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
