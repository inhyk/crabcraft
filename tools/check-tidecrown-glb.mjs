#!/usr/bin/env node
// Checks public/models/world/tidecrown.glb against the kit contract the scene code relies on:
// the ten TC_* pieces as top-level nodes, only TC_* material names, COLOR_0 (baked AO) and
// TEXCOORD_0 on every primitive, triangle budgets, file size, and the triangle counts recorded in
// tools/tidecrown-pieces.json. It also decodes the meshopt buffers and measures the UV texel density
// (UV units per world unit, area-weighted) of the wall- and roof-like materials next to the World 1
// kit (village.glb MI_Brick / MI_UnevenBrick / MI_RoundTiles).
//
// Usage: node tools/check-tidecrown-glb.mjs [path/to/tidecrown.glb]
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(process.argv[2] ?? `${root}/public/models/world/tidecrown.glb`);
const factsPath = `${root}/tools/tidecrown-pieces.json`;
const kitPath = `${root}/public/models/world/village.glb`;

const PIECES = ['TC_Keep', 'TC_Lantern', 'TC_WardTower', 'TC_WardWall_12', 'TC_WardGate', 'TC_CityWall_12', 'TC_CityTower',
  'TC_PincerGate', 'TC_BridgeSpan', 'TC_Plinth'];
const MATERIALS = ['TC_Limestone', 'TC_LimestoneDark', 'TC_Slate', 'TC_Gold', 'TC_Nacre', 'TC_Glass', 'TC_LanternGlow', 'TC_Iron',
  'TC_Wood'];
const BUDGET = { TC_Keep: 120000, TC_PincerGate: 40000, TC_WardWall_12: 3000, TC_CityWall_12: 3000, TC_WardTower: 10000,
  TC_CityTower: 10000 };
const MAX_BYTES = 4 * 1024 * 1024;

const failures = [];
const fail = (m) => failures.push(m);

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin, size: buf.length };
}

/** Decoded bytes of every bufferView (meshopt views are decompressed). */
function decodeViews({ json, bin }) {
  const views = [];
  for (const v of json.bufferViews) {
    const ext = v.extensions?.EXT_meshopt_compression;
    if (ext) {
      const src = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset ?? 0), ext.byteLength);
      const dst = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(dst, ext.count, ext.byteStride, src, ext.mode, ext.filter ?? 'NONE');
      views.push({ data: dst, stride: ext.byteStride });
    } else if (v.buffer === 0 && bin && json.buffers[0].uri === undefined) {
      views.push({ data: new Uint8Array(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0), v.byteLength), stride: v.byteStride });
    } else {
      views.push(null); // fallback buffer of a meshopt view
    }
  }
  return views;
}

const COMP = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535],
  5125: [4, 'getUint32', 0], 5126: [4, 'getFloat32', 0] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, views, idx) {
  const a = json.accessors[idx];
  const v = views[a.bufferView];
  const [size, getter, norm] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = v.stride || size * n;
  const dv = new DataView(v.data.buffer, v.data.byteOffset, v.data.byteLength);
  const out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < n; c++) {
      let x = dv[getter]((a.byteOffset ?? 0) + i * stride + c * size, true);
      if (a.normalized && norm) x = Math.max(x / norm, -1);
      out[i * n + c] = x;
    }
  }
  return out;
}

function localMatrix(node) {
  const m = new THREE.Matrix4();
  if (node.matrix) return m.fromArray(node.matrix);
  const t = new THREE.Vector3(...(node.translation ?? [0, 0, 0]));
  const r = new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
  const s = new THREE.Vector3(...(node.scale ?? [1, 1, 1]));
  return m.compose(t, r, s);
}

/** Area-weighted UV density per material name, in the space of each top-level node. */
function uvDensity(glb, views, filter = () => true) {
  const { json } = glb;
  const acc = new Map();
  const scene = json.scenes[json.scene ?? 0];
  const walk = (ni, parent) => {
    const node = json.nodes[ni];
    const m = parent ? parent.clone().multiply(localMatrix(node)) : new THREE.Matrix4();
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        const name = json.materials[p.material]?.name ?? '?';
        if (!filter(name) || p.attributes.TEXCOORD_0 === undefined) continue;
        const pos = readAccessor(json, views, p.attributes.POSITION);
        const uv = readAccessor(json, views, p.attributes.TEXCOORD_0);
        const ind = readAccessor(json, views, p.indices);
        const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const e = acc.get(name) ?? { world: 0, uv: 0 };
        for (let i = 0; i < ind.length; i += 3) {
          for (let k = 0; k < 3; k++) P[k].set(pos[ind[i + k] * 3], pos[ind[i + k] * 3 + 1], pos[ind[i + k] * 3 + 2]).applyMatrix4(m);
          const w = P[1].clone().sub(P[0]).cross(P[2].clone().sub(P[0])).length() / 2;
          const [a, b, c] = [ind[i], ind[i + 1], ind[i + 2]];
          const u = Math.abs((uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) - (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1])) / 2;
          if (w < 1e-6) continue;
          e.world += w;
          e.uv += u;
        }
        acc.set(name, e);
      }
    }
    for (const c of node.children ?? []) walk(c, m);
  };
  for (const ni of scene.nodes) walk(ni, null);
  const out = {};
  for (const [k, e] of acc) out[k] = e.world > 0 ? Math.sqrt(e.uv / e.world) : 0;
  return out;
}

await MeshoptDecoder.ready;
const glb = readGlb(file);
const { json } = glb;
const scene = json.scenes[json.scene ?? 0];
const top = scene.nodes.map((i) => json.nodes[i]);
const names = top.map((n) => n.name);
for (const p of PIECES) if (!names.includes(p)) fail(`missing top-level piece ${p}`);
for (const n of names) if (!PIECES.includes(n)) fail(`unexpected top-level node ${n}`);
for (const m of json.materials ?? []) if (!MATERIALS.includes(m.name)) fail(`unexpected material ${m.name}`);
for (const m of json.materials ?? []) {
  const tex = JSON.stringify(m).match(/"(baseColorTexture|normalTexture|metallicRoughnessTexture|emissiveTexture|occlusionTexture)"/);
  if (tex) fail(`material ${m.name} embeds a texture (${tex[1]})`);
}
if ((json.images ?? []).length) fail(`GLB embeds ${json.images.length} images`);
if (glb.size > MAX_BYTES) fail(`file is ${glb.size} bytes > ${MAX_BYTES}`);

const facts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, 'utf8')) : null;
const rows = [];
for (const node of top) {
  let tris = 0;
  let prims = 0;
  let color = true;
  let uv = true;
  const mats = new Set();
  const visit = (n) => {
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        prims++;
        if ((p.mode ?? 4) !== 4) fail(`${node.name}: primitive mode ${p.mode}`);
        tris += json.accessors[p.indices].count / 3;
        if (p.attributes.COLOR_0 === undefined) color = false;
        if (p.attributes.TEXCOORD_0 === undefined) uv = false;
        mats.add(json.materials[p.material]?.name);
      }
    }
    for (const c of n.children ?? []) visit(json.nodes[c]);
  };
  visit(node);
  const budget = BUDGET[node.name];
  const rec = facts?.pieces?.[node.name]?.triangles;
  if (!color) fail(`${node.name}: a primitive lacks COLOR_0`);
  if (!uv) fail(`${node.name}: a primitive lacks TEXCOORD_0`);
  if (budget && tris > budget) fail(`${node.name}: ${tris} triangles > budget ${budget}`);
  if (rec !== undefined && rec !== tris) fail(`${node.name}: ${tris} triangles but tidecrown-pieces.json says ${rec}`);
  if (!node.extras?.anchors) fail(`${node.name}: no anchors in node extras`);
  rows.push({ piece: node.name, triangles: tris, budget: budget ?? '-', prims, COLOR_0: color ? 'yes' : 'NO', anchors: Object.keys(node.extras?.anchors ?? {}).length, materials: [...mats].sort().join(' ') });
}
console.table(rows);
const total = rows.reduce((s, r) => s + r.triangles, 0);
console.log(`file ${file}\nsize ${glb.size} bytes (${(glb.size / 1048576).toFixed(2)} MB, limit 4 MB), ${total} triangles, ${(json.materials ?? []).length} materials`);

// Texel density next to the World 1 kit.
const tcViews = decodeViews(glb);
const tc = uvDensity(glb, tcViews, (n) => ['TC_Limestone', 'TC_LimestoneDark', 'TC_Slate'].includes(n));
const dens = [];
if (existsSync(kitPath)) {
  const kit = readGlb(kitPath);
  const kd = uvDensity(kit, decodeViews(kit), (n) => ['MI_Brick', 'MI_UnevenBrick', 'MI_RoundTiles'].includes(n));
  const wallKit = (kd.MI_Brick + kd.MI_UnevenBrick) / 2;
  for (const [m, ref, refName] of [['TC_Limestone', wallKit, 'MI_Brick/MI_UnevenBrick'], ['TC_LimestoneDark', wallKit, 'MI_Brick/MI_UnevenBrick'],
    ['TC_Slate', kd.MI_RoundTiles, 'MI_RoundTiles']]) {
    const ratio = tc[m] / ref;
    dens.push({ material: m, uvPerUnit: +tc[m].toFixed(3), kit: refName, kitUvPerUnit: +ref.toFixed(3), ratio: +ratio.toFixed(2) });
    if (!(ratio > 0.8 && ratio < 1.25)) fail(`${m}: UV density ${tc[m].toFixed(3)} is ${ratio.toFixed(2)}x the kit's ${ref.toFixed(3)}`);
  }
  console.table(dens);
} else {
  console.log('kit village.glb not found; texel density comparison skipped', tc);
}

if (failures.length) {
  console.error(`FAIL (${failures.length})\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('OK: tidecrown.glb matches the kit contract');
