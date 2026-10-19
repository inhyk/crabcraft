// Tidecrown studio: the capital's townhouse generator and market dressing on preview ground.
//   /dev/tidecrown.html?view=street|district|market|house|city|pieces  (&clean hides the UI)
// street: a sloping street of row houses at eye level in late-afternoon sun, a red crab for scale.
// district: fillDistrict on a 150 x 110 sample block with two crossing streets and a market plaza, from above.
// market: eye level among the stalls. house: a short row close up. pieces: the kit gallery (&kit=props, &f=regex).
// city: about 300 houses over 400 x 340 on one LOD, &preset=street|far|aerial|castle|edge|high (edge and high look
// at the city from the switch distance, for the near/far swap check); &near=, &chunk=, &shadow= tune the LOD.
import '../src/ui/kit.css';
import * as THREE from 'three';
import { Engine } from '../src/core/engine';
import { initAssets } from '../src/core/assets';
import { createCrab } from '../src/crab/index';
import { createSkyUniforms, createSky } from '../src/world/sky';
import { noiseTexture } from '../src/world/terrain';
import { WORLD_UNIFORMS } from '../src/world/materials';
import { addPatch } from '../src/world/materials';
import { GLSL_NOISE } from '../src/world/noise';
import { loadKit, StaticBatch, trs } from '../src/world/kit';
import { cityLod, fillDistrict, lineDist, loadTidecrownKit, planDistrict, pointInPoly, type District, type DistrictStreet, type Height, type TideBatch, type TidecrownKit, type V2 } from '../src/game/tidecrown/houses';
import type { TidecrownLod } from '../src/game/tidecrown/lod';
import { dressMarket, type Market } from '../src/game/tidecrown/marketStalls';

declare global {
  interface Window {
    __ready?: boolean;
    __info?: unknown;
    __district?: unknown;
    /** Set true to grab the next rendered frame into __shot (a PNG data URL), for headless capture. */
    __shoot?: boolean;
    __shot?: string;
    /** The city view's LOD (force near/far, hide) for the QA's swap check. */
    __lod?: TidecrownLod<TideBatch>;
    /** Draw calls and triangles of the last rendered frame. */
    __frame?: { calls: number; triangles: number };
  }
}

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'street';
if (params.has('clean')) document.body.classList.add('clean');
const engine = new Engine(document.getElementById('app')!, 'high');
initAssets(engine.renderer);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 2000);
const stats = document.getElementById('stats')!;
const panel = document.getElementById('panel')!;
for (const v of ['street', 'district', 'market', 'house', 'city', 'pieces']) {
  const a = document.createElement('a');
  a.href = `?view=${v}`;
  a.textContent = v;
  if (v === view) a.className = 'on';
  panel.appendChild(a);
}

// ---------------------------------------------------------------------------------------------
// Late-afternoon light: warm low sun, blue sky with drifting cloud, sky-lit reflections.

const skyU = createSkyUniforms(WORLD_UNIFORMS.uTime, noiseTexture());
// &sd=x,y,z overrides the direction toward the sun.
const sunDir = new THREE.Vector3(...((params.get('sd') ?? (view === 'street' ? '0.14,0.6,0.79' : view === 'house' ? '-0.35,0.62,-0.7' : '0.45,0.72,0.52')).split(',').map(Number) as [number, number, number])).normalize();
function setSky(dir: THREE.Vector3): void {
  skyU.uSunDir.value.copy(dir);
  skyU.uZenith.value.set('#2f6bc4');
  skyU.uMid.value.set('#86b3e6');
  skyU.uHorizon.value.set('#f6d2a2');
  skyU.uGround.value.set('#d9b48a');
  skyU.uSunColor.value.set('#fff1cf');
  skyU.uGlow.value.set('#ffc27a');
  skyU.uCloudLit.value.set('#fff2de');
  skyU.uCloudShade.value.set('#9fb0c8');
  skyU.uCloudCover.value = 0.42;
  skyU.uSunVis.value = 1;
}
setSky(sunDir);
const sky = createSky(skyU);
scene.add(sky);
const envScene = new THREE.Scene();
envScene.add(createSky(skyU));
const pmrem = new THREE.PMREMGenerator(engine.renderer);
scene.environment = pmrem.fromScene(envScene, 0.02).texture;
scene.environmentIntensity = 0.35;
scene.fog = new THREE.FogExp2('#e9d2b4', 0.0034);
const hemi = new THREE.HemisphereLight('#c4daf6', '#9a8266', 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffd9a6', Number(params.get('sun') ?? 4.4));
sun.castShadow = true;
sun.shadow.mapSize.set(3072, 3072);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
function aimSun(focus: THREE.Vector3, extent: number): void {
  sun.position.copy(focus).addScaledVector(sunDir, 160);
  sun.target.position.copy(focus);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 400 });
  sun.shadow.camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------------------------
// Preview ground: cobbled streets and plazas, flagged pavements, grassy yards behind the rows.

function ground(kit: TidecrownKit, h: Height, x0: number, x1: number, z0: number, z1: number, paved: (x: number, z: number) => number, step = 0.5, drop = 0): THREE.Mesh {
  const nx = Math.ceil((x1 - x0) / step);
  const nz = Math.ceil((z1 - z0) / step);
  const pos: number[] = [];
  const uv: number[] = [];
  const pave: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      pos.push(x, h(x, z) - drop, z);
      uv.push(x * 0.42, z * 0.42);
      pave.push(paved(x, z));
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPave', new THREE.Float32BufferAttribute(pave, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const src = kit.village.material('MI_UnevenBrick')!;
  const map = src.map!.clone();
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;
  const normalMap = src.normalMap?.clone() ?? null;
  if (normalMap) {
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({ name: 'tidecrown-preview-ground', map, normalMap, roughness: 0.9 });
  // aPave: 1 cobbled street, 0.5 flagged pavement, 0 grass and earth.
  addPatch(mat, 'tc-preview-ground', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPave;\nvarying float vPave;\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPave = aPave;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vPave;\nvarying vec3 vGW;\n${GLSL_NOISE}`).replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float t = smoothstep(0.1, 0.3, l);
        float n = cc_fbm(vGW.xz * 0.15);
        vec3 cob = mix(vec3(0.2, 0.15, 0.1), vec3(0.72, 0.6, 0.46) * (0.88 + 0.24 * n), t);
        vec3 flag = mix(vec3(0.3, 0.27, 0.22), vec3(0.78, 0.72, 0.6) * (0.92 + 0.12 * n), t);
        vec3 grass = mix(vec3(0.16, 0.24, 0.07), vec3(0.32, 0.4, 0.13), cc_fbm(vGW.xz * 0.6)) * mix(0.7, 1.05, n);
        vec3 earth = vec3(0.36, 0.28, 0.19) * (0.8 + 0.3 * cc_vnoise(vGW.xz * 1.7));
        vec3 soft = mix(earth, grass, smoothstep(0.35, 0.6, cc_fbm(vGW.xz * 0.35 + 3.0)));
        float p = vPave + (cc_vnoise(vGW.xz * 2.3) - 0.5) * 0.18;
        diffuseColor.rgb = p > 0.75 ? cob : p > 0.25 ? flag : soft;
      }`,
    );
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'tidecrown-preview-ground';
  mesh.receiveShadow = true;
  return mesh;
}

async function crab(x: number, z: number, h: Height, yaw: number): Promise<void> {
  const c = await createCrab({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'scale' });
  c.root.position.set(x, h(x, z), z);
  c.root.rotation.y = yaw;
  scene.add(c.root);
  c.update(0);
}

function stat(district: District, extra: Record<string, unknown> = {}): void {
  const info = { view, buildMs: (district.stats as Record<string, unknown>).buildMs, deterministic: (district.stats as Record<string, unknown>).deterministic, lanes: district.lanes.length, houses: district.stats.houses, districtMeshes: district.stats.meshes, districtTriangles: district.stats.triangles, districtFarTriangles: district.stats.farTriangles, chunks: district.stats.chunks, colliders: district.colliders.length, banners: district.lots.filter((l) => l.spec.banner).length, shops: district.lots.filter((l) => l.spec.shop).length, corners: district.lots.filter((l) => l.spec.corner?.left || l.spec.corner?.right).length, pieces: district.stats.pieces, ...extra };
  window.__info = info;
  if ((district.group as TidecrownLod<TideBatch>).isLOD) window.__lod = district.group as TidecrownLod<TideBatch>;
}

function exposeDistrict(d: District, streets: DistrictStreet[], reserved: V2[][], polygon: V2[], market?: Market): void {
  window.__district = {
    lots: d.lots.map((l) => ({ corners: l.corners, doors: l.doors, floors: l.spec.floors, width: l.spec.width, depth: l.spec.depth, shop: !!l.spec.shop, top: l.top })),
    streets,
    reserved,
    polygon,
    stalls: market?.stalls ?? [],
    colliders: d.colliders.length,
    stats: d.stats,
  };
}

// ---------------------------------------------------------------------------------------------
// Views

async function street(): Promise<void> {
  const kit = await loadTidecrownKit();
  const h: Height = (x, z) => z * 0.075 + Math.sin(z * 0.05) * 0.8 - Math.abs(x) * 0.02 + 0.25 * Math.sin(x * 0.3 + z * 0.17);
  const line: V2[] = [[0, -6], [1.5, 20], [-1, 42], [2, 66]];
  const streets: DistrictStreet[] = [{ points: line, width: 7 }];
  const polygon: V2[] = [[-17, -8], [18, -8], [19, 70], [-17, 70]];
  const d = fillDistrict({ kit, renderer: engine.renderer, polygon, streets, height: h, seed: Number(params.get('seed') ?? 7), setback: 0.9, laneSpacing: 0 });
  scene.add(d.group);
  scene.add(ground(kit, h, -30, 30, -20, 90, (x, z) => (lineDist(x, z, line) < 3.5 ? 1 : lineDist(x, z, line) < 4.6 ? 0.5 : 0)));
  await crab(0.8, 6.5, h, Math.PI + 0.4);
  cam.fov = 50;
  cam.position.set(-0.6, h(-0.6, 0) + 1.9, 0);
  cam.lookAt(1.2, h(1.2, 24) + 4.2, 24);
  aimSun(new THREE.Vector3(0, h(0, 22), 22), 36);
  exposeDistrict(d, streets, [], polygon);
  stat(d);
}

const DISTRICT_POLY: V2[] = [[-75, -50], [-20, -58], [40, -52], [76, -40], [72, 18], [64, 55], [10, 54], [-48, 58], [-78, 30]];
const DISTRICT_STREETS: DistrictStreet[] = [
  { points: [[-82, 6], [-40, 0], [0, -3], [38, 2], [82, -8]], width: 7 },
  { points: [[-6, -62], [-2, -20], [0, 0], [4, 24], [10, 62]], width: 6 },
];
const PLAZA = { x: 0, z: -1, r: 15 };
const plazaPoly = (): V2[] => Array.from({ length: 12 }, (_, i) => [PLAZA.x + Math.cos((i / 12) * Math.PI * 2) * (PLAZA.r + 3), PLAZA.z + Math.sin((i / 12) * Math.PI * 2) * (PLAZA.r + 1.5)] as V2);
const districtHeight: Height = (x, z) => 0.045 * z + 0.03 * x + 1.4 * Math.sin(x * 0.035) * Math.cos(z * 0.04);

async function buildDistrict(): Promise<{ kit: TidecrownKit; d: District; m: Market }> {
  const kit = await loadTidecrownKit();
  const reserved = [plazaPoly()];
  const t0 = performance.now();
  const opts = { polygon: DISTRICT_POLY, streets: DISTRICT_STREETS, reserved, height: districtHeight, seed: Number(params.get('seed') ?? 11), laneSpacing: Number(params.get('lanes') ?? 26) };
  const d = fillDistrict({ kit, renderer: engine.renderer, ...opts });
  const buildMs = Math.round(performance.now() - t0);
  // The same options must plan the same city.
  const deterministic = JSON.stringify(planDistrict(opts).lots.map((l) => l.spec)) === JSON.stringify(d.lots.map((l) => l.spec));
  scene.add(d.group);
  const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => a + 0.05);
  const m = dressMarket({ kit, x: PLAZA.x, z: PLAZA.z, radius: PLAZA.r, height: districtHeight, seed: 5, lanes: angles, laneWidth: 3, streets: DISTRICT_STREETS, inner: 4.5 });
  scene.add(m.group);
  const paved = (x: number, z: number) => {
    if (pointInPoly(x, z, reserved[0])) return 1;
    let best = 0;
    for (const s of [...DISTRICT_STREETS, ...d.lanes]) {
      const dd = lineDist(x, z, s.points);
      if (dd < s.width / 2) return 1;
      if (dd < s.width / 2 + 1.1) best = 0.5;
    }
    return best;
  };
  scene.add(ground(kit, districtHeight, -110, 110, -90, 90, paved));
  exposeDistrict(d, [...DISTRICT_STREETS, ...d.lanes], reserved, DISTRICT_POLY, m);
  Object.assign(d.stats, { buildMs, deterministic });
  return { kit, d, m };
}

async function district(): Promise<void> {
  const { d, m } = await buildDistrict();
  await crab(3, 9, districtHeight, 2.4);
  cam.fov = 40;
  cam.position.set(-52, 62, 84);
  if (params.has('top')) cam.position.set(0, 260, 1);
  cam.lookAt(4, 0, -10);
  aimSun(new THREE.Vector3(0, 0, 0), 100);
  scene.fog = new THREE.FogExp2('#e9d2b4', 0.0016);
  stat(d, { stalls: m.stalls.length, marketColliders: m.colliders.length });
}

async function market(): Promise<void> {
  const { d, m } = await buildDistrict();
  await crab(-2.6, 8.4, districtHeight, 2.6);
  cam.fov = 52;
  const cx = -8;
  const cz = 15.5;
  cam.position.set(cx, districtHeight(cx, cz) + 1.8, cz);
  cam.lookAt(5, districtHeight(5, -9) + 2.4, -9);
  aimSun(new THREE.Vector3(0, 0, 0), 45);
  stat(d, { stalls: m.stalls.length, marketColliders: m.colliders.length });
}

async function house(): Promise<void> {
  const kit = await loadTidecrownKit();
  const h: Height = (x, z) => z * 0.04 - x * 0.03;
  const line: V2[] = [[-30, 0], [30, 0]];
  const streets: DistrictStreet[] = [{ points: line, width: 6 }];
  const polygon: V2[] = [[-24, 0.5], [24, 0.5], [24, 16], [-24, 16]];
  const d = fillDistrict({ kit, renderer: engine.renderer, polygon, streets, height: h, seed: Number(params.get('seed') ?? 3), laneSpacing: 0 });
  scene.add(d.group);
  scene.add(ground(kit, h, -40, 40, -20, 30, (_x, z) => (Math.abs(z) < 3 ? 1 : Math.abs(z) < 4.1 ? 0.5 : 0)));
  await crab(1, -1, h, 0.6);
  cam.fov = 40;
  cam.position.set(Number(params.get('cx') ?? -3), Number(params.get('cy') ?? 6), Number(params.get('cz') ?? -22));
  cam.lookAt(0, 5, 6);
  aimSun(new THREE.Vector3(0, 0, 6), 30);
  exposeDistrict(d, streets, [], polygon);
  stat(d);
}

// ---------------------------------------------------------------------------------------------
// City: about 300 townhouses over 400 x 340 in four districts on one shared LOD, around a castle hill, a central
// market plaza, a cathedral square, gardens and smaller squares. Streets: Crown Way (north-south), Tide Street
// (west-east) and two ring streets.

const cityHeight: Height = (x, z) => -0.035 * z + 1.6 * Math.sin(x * 0.017) * Math.cos(z * 0.021);
const circle = (x: number, z: number, r: number, n = 14): V2[] => Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * r, z + Math.sin((i / n) * Math.PI * 2) * r] as V2);
const CROWN_WAY: DistrictStreet = { points: [[0, -80], [3, -40], [0, 0], [-3, 60], [2, 120], [0, 178]], width: 9 };
const TIDE_STREET: DistrictStreet = { points: [[-208, 16], [-130, 10], [-60, 14], [0, 8], [60, 4], [130, 12], [208, 8]], width: 8 };
const WEST_RING: DistrictStreet = { points: [[-98, -150], [-104, -90], [-96, -20], [-102, 60], [-97, 150]], width: 7 };
const EAST_RING: DistrictStreet = { points: [[100, -150], [96, -90], [104, -20], [98, 60], [103, 150]], width: 7 };
const MARKET = { x: 0, z: 8, r: 26 };
// Castle hill, market plaza, cathedral square, two gardens, a park, the harbour gate and four street squares.
const CITY_RESERVED: V2[][] = [circle(0, -128, 55), circle(MARKET.x, MARKET.z, MARKET.r), circle(120, 128, 26), circle(-150, 140, 24), circle(-125, -115, 24), circle(135, -115, 28), circle(0, 152, 22), circle(-100, -40, 20), circle(100, 75, 20), circle(-152, 12, 17), circle(152, 10, 17)];
const CITY_DISTRICTS: { poly: V2[]; streets: DistrictStreet[]; seed: number; lanes: number }[] = [
  { poly: [[-198, -168], [0, -168], [0, 12], [-198, 12]], streets: [TIDE_STREET, CROWN_WAY, WEST_RING], seed: 21, lanes: 0 },
  { poly: [[0, -168], [198, -168], [198, 8], [0, 8]], streets: [TIDE_STREET, CROWN_WAY, EAST_RING], seed: 22, lanes: 0 },
  { poly: [[-198, 12], [0, 12], [0, 168], [-198, 168]], streets: [TIDE_STREET, CROWN_WAY, WEST_RING], seed: 23, lanes: 0 },
  { poly: [[0, 8], [198, 8], [198, 168], [0, 168]], streets: [TIDE_STREET, CROWN_WAY, EAST_RING], seed: 24, lanes: 0 },
];
const CITY_PRESETS: Record<string, { cam: [number, number, number]; at: [number, number, number]; fov: number; fog: number }> = {
  // Crab eye in Tide Street, looking east down the avenue to the market plaza.
  street: { cam: [-150, 1.9, 11.6], at: [-60, 4, 14], fov: 50, fog: 0.0034 },
  // Crab eye on Crown Way below the market, looking north up the avenue to the castle hill.
  crown: { cam: [-1.5, 1.9, 120], at: [1, 5, 40], fov: 50, fog: 0.0034 },
  // Crab eye on the west ring street, looking south past the square.
  ring: { cam: [-99, 1.9, -95], at: [-99, 4, -10], fov: 50, fog: 0.0034 },
  // From a ridge 300 units south of the centre, 30 above the city.
  far: { cam: [0, 30, 300], at: [0, 6, 0], fov: 42, fog: 0.0012 },
  aerial: { cam: [-40, 170, 220], at: [0, 0, -10], fov: 42, fog: 0.0012 },
  // The castle stair: 28 above Crown Way at the gate, looking south over the roofs.
  castle: { cam: [0, 28, -76], at: [0, 2, 40], fov: 50, fog: 0.0025 },
};

async function city(): Promise<void> {
  const kit = await loadTidecrownKit();
  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
  const lod = cityLod(kit, engine.renderer, { chunk: num('chunk'), near: num('near'), shadow: num('shadow'), hysteresis: num('hyst') });
  const t0 = performance.now();
  const districts = CITY_DISTRICTS.map((c, i) => fillDistrict({ kit, polygon: c.poly, streets: c.streets, reserved: CITY_RESERVED, height: cityHeight, seed: c.seed, laneSpacing: c.lanes, lod, name: `tidecrown-city-${i}` }));
  lod.build();
  const buildMs = Math.round(performance.now() - t0);
  scene.add(lod);
  window.__lod = lod;
  const streets = [CROWN_WAY, TIDE_STREET, WEST_RING, EAST_RING, ...districts.flatMap((d) => d.lanes)];
  const paved = (x: number, z: number) => {
    if (Math.hypot(x - MARKET.x, z - MARKET.z) < MARKET.r) return 1;
    let best = 0;
    for (const s of streets) {
      const dd = lineDist(x, z, s.points);
      if (dd < s.width / 2) return 1;
      if (dd < s.width / 2 + 1.1) best = 0.5;
    }
    return best;
  };
  scene.add(ground(kit, cityHeight, -215, 215, -185, 185, paved, 1));
  const outer = ground(kit, cityHeight, -900, 900, -900, 900, () => 0, 30, 0.6);
  scene.add(outer);
  const presetName = params.get('preset') ?? 'street';
  const ls = lod.stats;
  const houses = districts.reduce((n, d) => n + d.stats.houses, 0);
  window.__district = {
    lots: districts.flatMap((d) => d.lots.map((l) => ({ corners: l.corners, doors: l.doors, floors: l.spec.floors, width: l.spec.width, depth: l.spec.depth, shop: !!l.spec.shop, top: l.top }))),
    streets,
    reserved: CITY_RESERVED,
    polygon: [[-198, -168], [198, -168], [198, 168], [-198, 168]],
    stalls: [],
    colliders: districts.reduce((n, d) => n + d.colliders.length, 0),
    stats: ls,
  };
  window.__info = { view, preset: presetName, buildMs, houses, chunks: ls.chunks, lodMeshes: ls.meshes, nearTriangles: ls.nearTriangles, farTriangles: ls.farTriangles, farPerHouse: Math.round(ls.farTriangles / houses), nearPerHouse: Math.round(ls.nearTriangles / houses), lod: lod.opts };
  // Presets, or the swap check's views: from the switch distance at crab eye (edge) or 30 up (high).
  // &dist= puts the edge and high views at another distance from the nearest houses than the switch distance.
  const near = num('dist') ?? lod.opts.near;
  const southEdge = Math.max(...districts.flatMap((d) => d.lots.flatMap((l) => l.corners.map((c) => (Math.abs(c[0]) < 40 ? c[1] : -Infinity)))));
  const presets: typeof CITY_PRESETS = {
    ...CITY_PRESETS,
    edge: { cam: [0, 1.9, southEdge + near - 2], at: [0, 6, southEdge - 30], fov: 50, fog: 0.0034 },
    high: { cam: [0, 30, southEdge + Math.sqrt(near * near - 26 * 26) - 2], at: [0, 2, southEdge - 40], fov: 50, fog: 0.0025 },
  };
  const pr = presets[presetName] ?? presets.street;
  cam.fov = pr.fov;
  cam.position.set(pr.cam[0], cityHeight(pr.cam[0], pr.cam[2]) + pr.cam[1], pr.cam[2]);
  cam.lookAt(pr.at[0], cityHeight(pr.at[0], pr.at[2]) + pr.at[1], pr.at[2]);
  scene.fog = new THREE.FogExp2('#e9d2b4', pr.fog);
  // The game's sun: a 70-unit shadow box centred ahead of the camera (src/world/index.ts).
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  const ahead = THREE.MathUtils.clamp((cam.position.y - cityHeight(cam.position.x, cam.position.z)) * 1.2, 12, 45);
  const focus = cam.position.clone().addScaledVector(fwd.setY(0).normalize(), ahead);
  focus.y = cityHeight(focus.x, focus.z);
  aimSun(focus, 70);
  if (presetName === 'street') await crab(-140, 12.6, cityHeight, Math.PI / 2 + 0.3);
  for (const k of [...Object.keys(CITY_PRESETS), 'edge', 'high']) {
    const a = document.createElement('a');
    a.href = `?view=city&preset=${k}`;
    a.textContent = k;
    if (k === presetName) a.className = 'on';
    panel.appendChild(a);
  }
}

async function pieces(): Promise<void> {
  const kit = await loadKit(`models/world/${params.get('kit') ?? 'village'}.glb`);
  const filter = new RegExp(params.get('f') ?? '.');
  const b = new StaticBatch(kit, 'gallery');
  const names = [...kit.pieces.keys()].filter((n) => filter.test(n)).sort();
  const cols = Math.ceil(Math.sqrt(names.length * 1.6));
  const sp = Number(params.get('sp') ?? 6);
  names.forEach((n, i) => {
    const x = (i % cols) * sp;
    const z = Math.floor(i / cols) * sp;
    b.add(n, trs(x, 0, z));
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = n;
    document.body.appendChild(el);
    const p = new THREE.Vector3(x, -0.4, z);
    engine.onFrame(() => {
      const v = p.clone().project(cam);
      el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
      el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
    });
  });
  scene.add(b.build());
  const W = cols * sp;
  const D = Math.ceil(names.length / cols) * sp;
  cam.position.set(W / 2 - sp / 2, D * 0.9, D + D * 0.7);
  cam.lookAt(W / 2 - sp / 2, 1, D / 2 - sp / 2);
}

const views: Record<string, () => Promise<void>> = { street, district, market, house, city, pieces };
await (views[view] ?? street)();
// &cam=x,y,z,tx,ty,tz places the camera anywhere (heights above the ground there), for spot checks.
const camArg = params.get('cam')?.split(',').map(Number);
if (camArg?.length === 6) {
  const [x, y, z, tx, ty, tz] = camArg;
  const g = view === 'district' || view === 'market' ? districtHeight : view === 'city' ? cityHeight : () => 0;
  cam.position.set(x, g(x, z) + y, z);
  cam.lookAt(tx, g(tx, tz) + ty, tz);
}
engine.setView(scene, cam, { bloom: { intensity: 0.55, threshold: 0.95 }, exposure: Number(params.get('exp') ?? 1.0) });
let frames = 0;
engine.onFrame(({ elapsed }) => {
  WORLD_UNIFORMS.uTime.value = elapsed;
  frames++;
});
engine.onAfterFrame(() => {
  const info = engine.renderer.info;
  window.__frame = { calls: info.render.calls, triangles: info.render.triangles };
  const l = window.__lod?.frame;
  // Houses: the LOD's own draws in the camera and shadow passes; frame: everything on screen.
  const houses = l ? `\nhouses ${l.calls + l.shadowCalls} calls (${l.shadowCalls} shadow)  ${((l.triangles + l.shadowTriangles) / 1000).toFixed(0)}k tris (${(l.shadowTriangles / 1000).toFixed(0)}k shadow)\nnear chunks ${window.__lod!.stats.near}/${window.__lod!.chunks.length}` : '';
  stats.textContent = `${view}  ${engine.fps.toFixed(0)} fps\nframe ${info.render.calls} calls  ${(info.render.triangles / 1000).toFixed(0)}k tris${houses}`;
  if (frames === 40 && window.__info) Object.assign(window.__info as object, { frameCalls: info.render.calls, frameTriangles: info.render.triangles, ...(l ? { houseCalls: l.calls + l.shadowCalls, houseShadowCalls: l.shadowCalls, houseTriangles: l.triangles + l.shadowTriangles, houseShadowTriangles: l.shadowTriangles, nearChunks: window.__lod!.stats.near } : {}) });
  if (frames === 45) window.__ready = true;
});
engine.onAfterFrame(() => {
  if (!window.__shoot) return;
  window.__shoot = false;
  window.__shot = engine.canvas.toDataURL('image/png');
});
engine.start();
