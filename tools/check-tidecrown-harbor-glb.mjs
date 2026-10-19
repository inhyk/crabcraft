#!/usr/bin/env node
// Checks the Tidecrown harbour kit (public/models/world/tidecrown-harbor.glb) against its contract:
// piece names, only TC_* material names, no textures, COLOR_0 with baked AO on every primitive,
// triangle budgets, anchors on the ships, file size. Prints a table and exits 1 on any failure.
//
//   node tools/check-tidecrown-harbor-glb.mjs [path/to.glb]
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const root = new URL('..', import.meta.url).pathname;
const file = resolve(root, process.argv[2] ?? 'public/models/world/tidecrown-harbor.glb');
const MAX_BYTES = 3 * 1024 * 1024;
const BUDGET = {
  TC_Galleon: 45000,
  TC_GalleonFurled: 45000,
  TC_Cog: 18000,
  TC_Gondola: 3000,
  TC_Pier_10: 2500,
  TC_Quay_12: 2500,
  TC_Quay_12_Plain: 2500,
  TC_Crane: 6000,
  TC_CargoSet: 3000,
};
const SHIPS = { TC_Galleon: ['gangplank', 'lantern_0', 'masthead_main'], TC_GalleonFurled: ['gangplank'], TC_Cog: ['gangplank'], TC_Gondola: ['seat_0'] };
const MATERIALS = new Set(['TC_Wood', 'TC_WoodDark', 'TC_Sail', 'TC_Rope', 'TC_Gold', 'TC_Iron', 'TC_PaintBlue', 'TC_Limestone', 'TC_LimestoneDark']);

const errors = [];
const fail = (msg) => errors.push(msg);

const bytes = statSync(file).size;
if (bytes > MAX_BYTES) fail(`file is ${bytes} bytes, budget ${MAX_BYTES}`);
const buf = readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
if (json.images?.length || json.textures?.length) fail(`embedded images/textures: ${json.images?.length ?? 0}/${json.textures?.length ?? 0}`);

const gltf = await new Promise((res, rej) =>
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej),
);
const scene = gltf.scene;
scene.updateMatrixWorld(true);
const seen = new Set();
const rows = [];
for (const holder of scene.children) {
  const name = holder.name;
  seen.add(name);
  if (!(name in BUDGET)) fail(`unexpected top-level node ${name}`);
  let tris = 0;
  let prims = 0;
  let aoMin = Infinity;
  let aoMax = -Infinity;
  const mats = new Set();
  const box = new THREE.Box3();
  holder.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      mats.add(m.name);
      if (!MATERIALS.has(m.name)) fail(`${name}: material ${m.name} not in the TC_* list`);
      if (m.map) fail(`${name}: material ${m.name} has a texture`);
    }
    prims += Math.max(1, geo.groups.length);
    const idx = geo.getIndex();
    tris += (idx ? idx.count : geo.getAttribute('position').count) / 3;
    const col = geo.getAttribute('color');
    if (!col) fail(`${name}: a primitive has no COLOR_0`);
    else {
      for (let i = 0; i < col.count; i++) {
        const v = col.getX(i);
        if (v < aoMin) aoMin = v;
        if (v > aoMax) aoMax = v;
      }
    }
    geo.computeBoundingBox();
    box.union(geo.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  if (aoMax - aoMin < 0.2) fail(`${name}: COLOR_0 range ${aoMin.toFixed(2)}..${aoMax.toFixed(2)} does not look like baked AO`);
  const budget = BUDGET[name];
  if (budget && tris > budget) fail(`${name}: ${tris} triangles over the ${budget} budget`);
  for (const key of SHIPS[name] ?? []) if (!holder.userData.anchors?.[key]) fail(`${name}: anchors.${key} missing`);
  if (SHIPS[name] && !(box.min.y < 0 && box.max.y > 0)) fail(`${name}: waterline (y = 0) is not inside the hull bounds`);
  rows.push({ name, tris, budget, prims, mats: [...mats].length, ao: `${aoMin.toFixed(2)}..${aoMax.toFixed(2)}`, size: box.getSize(new THREE.Vector3()), anchors: Object.keys(holder.userData.anchors ?? {}).length });
}
for (const name of ['TC_Galleon', 'TC_Cog', 'TC_Gondola', 'TC_Pier_10', 'TC_Quay_12', 'TC_Crane']) if (!seen.has(name)) fail(`missing piece ${name}`);

const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
console.log(`${pad('piece', 18)} ${padl('tris', 6)} ${padl('budget', 6)} ${padl('prims', 5)} ${padl('mats', 4)} ${pad('COLOR_0', 10)} ${padl('anchors', 7)}  size x * y * z`);
for (const r of rows) {
  console.log(
    `${pad(r.name, 18)} ${padl(r.tris, 6)} ${padl(r.budget ?? '-', 6)} ${padl(r.prims, 5)} ${padl(r.mats, 4)} ${pad(r.ao, 10)} ${padl(r.anchors, 7)}  ${r.size.x.toFixed(1)} * ${r.size.y.toFixed(1)} * ${r.size.z.toFixed(1)}`,
  );
}
console.log(`total ${rows.reduce((a, r) => a + r.tris, 0)} triangles, ${(bytes / 1024 / 1024).toFixed(2)} MB (budget 3 MB), ${rows.length} pieces`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}
console.log('OK');
