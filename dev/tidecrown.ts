// Tidecrown studio: the capital's townhouse generator and market dressing on preview ground.
//   /dev/tidecrown.html?view=street|district|market|house|pieces  (&clean hides the UI)
// street: a sloping street of row houses at eye level in late-afternoon sun, a red crab for scale.
// district: fillDistrict on a 150 x 110 sample block with two crossing streets and a market plaza, from above.
// market: eye level among the stalls. house: a short row close up. pieces: the kit gallery (&kit=props, &f=regex).
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
import { fillDistrict, lineDist, loadTidecrownKit, planDistrict, pointInPoly, type District, type DistrictStreet, type Height, type TidecrownKit, type V2 } from '../src/game/tidecrown/houses';
import { dressMarket, type Market } from '../src/game/tidecrown/marketStalls';

declare global {
  interface Window {
    __ready?: boolean;
    __info?: unknown;
    __district?: unknown;
    /** Set true to grab the next rendered frame into __shot (a PNG data URL), for headless capture. */
    __shoot?: boolean;
    __shot?: string;
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
for (const v of ['street', 'district', 'market', 'house', 'pieces']) {
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

function ground(kit: TidecrownKit, h: Height, x0: number, x1: number, z0: number, z1: number, paved: (x: number, z: number) => number): THREE.Mesh {
  const step = 0.5;
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
      pos.push(x, h(x, z), z);
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
  const info = { view, buildMs: (district.stats as Record<string, unknown>).buildMs, deterministic: (district.stats as Record<string, unknown>).deterministic, lanes: district.lanes.length, houses: district.stats.houses, districtMeshes: district.stats.meshes, districtTriangles: district.stats.triangles, colliders: district.colliders.length, banners: district.lots.filter((l) => l.spec.banner).length, shops: district.lots.filter((l) => l.spec.shop).length, corners: district.lots.filter((l) => l.spec.corner?.left || l.spec.corner?.right).length, pieces: district.stats.pieces, ...extra };
  window.__info = info;
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
  const d = fillDistrict({ kit, polygon, streets, height: h, seed: Number(params.get('seed') ?? 7), setback: 0.9, laneSpacing: 0 });
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
  const d = fillDistrict({ kit, ...opts });
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
  const d = fillDistrict({ kit, polygon, streets, height: h, seed: Number(params.get('seed') ?? 3), laneSpacing: 0 });
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

const views: Record<string, () => Promise<void>> = { street, district, market, house, pieces };
await (views[view] ?? street)();
// &cam=x,y,z,tx,ty,tz places the camera anywhere (heights above the ground there), for spot checks.
const camArg = params.get('cam')?.split(',').map(Number);
if (camArg?.length === 6) {
  const [x, y, z, tx, ty, tz] = camArg;
  const g = view === 'district' || view === 'market' ? districtHeight : () => 0;
  cam.position.set(x, g(x, z) + y, z);
  cam.lookAt(tx, g(tx, tz) + ty, tz);
}
engine.setView(scene, cam, { bloom: { intensity: 0.55, threshold: 0.95 }, exposure: Number(params.get('exp') ?? 1.0) });
let frames = 0;
engine.onFrame(({ elapsed }) => {
  WORLD_UNIFORMS.uTime.value = elapsed;
  frames++;
  const info = engine.renderer.info;
  stats.textContent = `${view}  ${engine.fps.toFixed(0)} fps\ncalls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`;
  if (frames === 40 && window.__info) Object.assign(window.__info as object, { frameCalls: info.render.calls, frameTriangles: info.render.triangles });
  if (frames === 45) window.__ready = true;
});
engine.onAfterFrame(() => {
  if (!window.__shoot) return;
  window.__shoot = false;
  window.__shot = engine.canvas.toDataURL('image/png');
});
engine.start();
