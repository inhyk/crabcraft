// Checks public/models/world/tidecrown-city.glb against the Tidecrown landmarks contract:
// piece names, material names, COLOR_0 (baked AO) on every primitive, no textures, triangle budgets,
// file size, and agreement with tools/tidecrown-city-pieces.json. Reads only the GLB's JSON chunk.
// Usage: node tools/check-tidecrown-city-glb.mjs [file.glb]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] ?? path.join(ROOT, 'public/models/world/tidecrown-city.glb');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/tidecrown-city-pieces.json'), 'utf8'));
const MAX_BYTES = 4 * 1024 * 1024;
const BUDGETS = {
  TC_Cathedral: 60000,
  TC_SeaglassTower: 30000,
  TC_SeaglassCrystal: 3000,
  TC_Forge: 25000,
  TC_Waterwheel: 4000,
  TC_Fountain: 15000,
  TC_RetainingWall_12: 2500,
  TC_Stair_8: 4000,
  TC_Lamp: 1500,
  TC_BannerPole: 1500,
  TC_BannerWall: 1500,
  TC_MarketArcade: 12000,
};
const MATERIALS = new Set(['TC_Limestone', 'TC_LimestoneDark', 'TC_Slate', 'TC_Gold', 'TC_Glass', 'TC_Seaglass', 'TC_Copper', 'TC_Iron', 'TC_Wood', 'TC_Banner']);

const errors = [];
const fail = (msg) => errors.push(msg);

const buf = fs.readFileSync(FILE);
if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2) throw new Error(`${FILE} is not a glTF 2 binary`);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

if (buf.length > MAX_BYTES) fail(`file is ${buf.length} bytes, over ${MAX_BYTES}`);
if ((gltf.images ?? []).length || (gltf.textures ?? []).length) fail('the file embeds images or textures');
for (const m of gltf.materials ?? []) if (!MATERIALS.has(m.name)) fail(`unexpected material ${m.name}`);

// Node transforms (TRS or matrix) as column-major 4x4.
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const apply = (m, p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
// Normalised integer accessors (KHR_mesh_quantization) keep min/max as stored integers; map them to -1..1 / 0..1.
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function bounds(acc) {
  let { min, max } = acc;
  if (acc.normalized && NORM[acc.componentType]) {
    const d = NORM[acc.componentType];
    const signed = acc.componentType === 5120 || acc.componentType === 5122;
    const f = (v) => (Math.abs(v) > 1.0001 ? (signed ? Math.max(v / d, -1) : v / d) : v);
    min = min.map(f);
    max = max.map(f);
  }
  return [min, max];
}

const scene = gltf.scenes[gltf.scene ?? 0];
const rows = [];
const seen = new Set();
for (const ni of scene.nodes) {
  const holder = gltf.nodes[ni];
  const name = holder.name;
  seen.add(name);
  if (!(name in BUDGETS)) fail(`unexpected top-level node ${name}`);
  let tris = 0;
  const mats = new Set();
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let prims = 0;
  let withAO = 0;
  const walk = (idx, m) => {
    const n = gltf.nodes[idx];
    const mm = mul(m, local(n));
    if (n.mesh !== undefined) {
      for (const p of gltf.meshes[n.mesh].primitives) {
        prims++;
        if ((p.mode ?? 4) !== 4) fail(`${name}: primitive mode ${p.mode} is not triangles`);
        tris += (p.indices !== undefined ? gltf.accessors[p.indices].count : gltf.accessors[p.attributes.POSITION].count) / 3;
        if (p.attributes.COLOR_0 !== undefined) withAO++;
        for (const a of ['NORMAL', 'TEXCOORD_0']) if (p.attributes[a] === undefined) fail(`${name}: primitive without ${a}`);
        const mat = gltf.materials[p.material]?.name ?? '(none)';
        mats.add(mat);
        const [mn, mx] = bounds(gltf.accessors[p.attributes.POSITION]);
        for (const cx of [mn[0], mx[0]]) for (const cy of [mn[1], mx[1]]) for (const cz of [mn[2], mx[2]]) {
          const q = apply(mm, [cx, cy, cz]);
          for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i], q[i]);
            hi[i] = Math.max(hi[i], q[i]);
          }
        }
      }
    }
    for (const c of n.children ?? []) walk(c, mm);
  };
  // Bounds are relative to the holder (the game inverts the holder transform in loadKit).
  for (const c of holder.children ?? []) walk(c, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (holder.mesh !== undefined) fail(`${name}: holder node carries a mesh (expected an empty with a child mesh)`);
  if (withAO !== prims) fail(`${name}: ${prims - withAO} of ${prims} primitives lack COLOR_0`);
  if (tris > BUDGETS[name]) fail(`${name}: ${tris} triangles over the budget ${BUDGETS[name]}`);
  const spec = SPEC.pieces[name];
  if (!spec) fail(`${name}: missing from tidecrown-city-pieces.json`);
  else {
    if (spec.triangles !== tris) fail(`${name}: json says ${spec.triangles} triangles, glb has ${tris}`);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(spec.bounds.min[i] - lo[i]) > 0.05 || Math.abs(spec.bounds.max[i] - hi[i]) > 0.05) {
        fail(`${name}: bounds ${lo.map((v) => v.toFixed(2))} .. ${hi.map((v) => v.toFixed(2))} differ from the json`);
        break;
      }
    }
  }
  rows.push({ name, tris, budget: BUDGETS[name], mats: mats.size, lo, hi });
}
for (const n of Object.keys(BUDGETS)) if (!seen.has(n)) fail(`missing piece ${n}`);

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
console.log(`${pad('piece', 22)}${lpad('tris', 7)}${lpad('budget', 8)}${lpad('use', 6)}  mats  size (x, y, z)`);
let total = 0;
for (const r of rows) {
  total += r.tris;
  const size = r.hi.map((v, i) => (v - r.lo[i]).toFixed(1)).join(' x ');
  console.log(`${pad(r.name, 22)}${lpad(r.tris, 7)}${lpad(r.budget, 8)}${lpad(Math.round((100 * r.tris) / r.budget) + '%', 6)}  ${lpad(r.mats, 4)}  ${size}`);
}
console.log(`${pad('total', 22)}${lpad(total, 7)}`);
console.log(`file ${path.relative(ROOT, FILE)}: ${buf.length} bytes (${(buf.length / 1048576).toFixed(2)} MB of 4 MB), ${(gltf.materials ?? []).length} materials, extensions ${(gltf.extensionsUsed ?? []).join(', ')}`);
if (errors.length) {
  for (const e of errors) console.error('FAIL', e);
  process.exit(1);
}
console.log('OK tidecrown-city.glb meets the contract');
