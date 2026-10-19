// Far islands and headlands on Tidecrown's horizon: rounded, wooded masses with rock flanks and sand rims, paled by
// the sea haze, so the sea does not end at an empty line.
import * as THREE from 'three';
import { tcNoise } from '../../sim/world/tidecrownGround';

interface Isle {
  x: number;
  z: number;
  /** Half extents and height. */
  rx: number;
  rz: number;
  h: number;
  yaw: number;
  seed: number;
}
const ISLES: Isle[] = [
  { x: -760, z: -420, rx: 150, rz: 70, h: 46, yaw: 0.3, seed: 1 },
  { x: -560, z: -760, rx: 90, rz: 55, h: 30, yaw: -0.5, seed: 2 },
  { x: -1020, z: 60, rx: 220, rz: 90, h: 70, yaw: 1.2, seed: 3 },
  { x: 120, z: -980, rx: 260, rz: 80, h: 58, yaw: 0.1, seed: 4 },
  { x: 760, z: -620, rx: 130, rz: 60, h: 34, yaw: -0.7, seed: 5 },
  { x: 980, z: 160, rx: 240, rz: 110, h: 80, yaw: 1.5, seed: 6 },
  { x: 700, z: 640, rx: 120, rz: 70, h: 36, yaw: 0.6, seed: 7 },
  { x: 430, z: -330, rx: 34, rz: 22, h: 16, yaw: 0.2, seed: 8 },
];

const SAND = new THREE.Color('#d8c59a'), ROCK = new THREE.Color('#a59a88'), GRASS = new THREE.Color('#5d8a3c'), WOOD = new THREE.Color('#2f5a2c');

function isle(i: Isle): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(2, 2, 48, 48).rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position'), col = new Float32Array(p.count * 3), c = new THREE.Color();
  const cs = Math.cos(i.yaw), sn = Math.sin(i.yaw);
  for (let k = 0; k < p.count; k++) {
    const u = p.getX(k), v = p.getZ(k), r = Math.hypot(u, v);
    const n = tcNoise(u * 3 + i.seed * 7, v * 3 - i.seed * 3, 4);
    const edge = 1 - r * (0.85 + 0.25 * n);
    // A rounded mass with a steeper seaward flank; below zero it sinks under the water.
    const y = edge > 0 ? i.h * Math.pow(edge, 0.7) * (0.75 + 0.35 * tcNoise(u * 5 + i.seed, v * 5, 3)) : -6;
    const lx = u * i.rx, lz = v * i.rz;
    p.setXYZ(k, i.x + cs * lx - sn * lz, y, i.z + sn * lx + cs * lz);
    const t = y / i.h;
    if (y < 2.5) c.copy(SAND);
    else if (edge < 0.18) c.copy(ROCK);
    else c.copy(GRASS).lerp(WOOD, THREE.MathUtils.smoothstep(t + 0.2 * n, 0.25, 0.6));
    col.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildHorizon(): THREE.Mesh {
  const geos = ISLES.map(isle);
  const merged = new THREE.BufferGeometry();
  const count = geos.reduce((a, g) => a + g.getIndex()!.count, 0);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx = new Uint32Array(count);
  let base = 0, o = 0;
  for (const g of geos) {
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    col.push(...(g.getAttribute('color').array as Float32Array));
    const ix = g.getIndex()!;
    for (let k = 0; k < ix.count; k++) idx[o++] = ix.getX(k) + base;
    base += g.getAttribute('position').count;
    g.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ name: 'tc-horizon', vertexColors: true, roughness: 0.95 }));
  mesh.name = 'tidecrown-horizon';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
