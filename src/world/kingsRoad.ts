// The King's Road out of Clawhaven: lamp posts, kerb stones, the signpost at the chapel fork and the
// King's Gate arch on the ridge, where the zone line to Tidecrown crosses the road. The road itself is
// carved by Terrain and its woods are dressed by the foliage scatter; this file adds the built things.
// registerKingsRoad() adds the colliders (shared with the server bake), buildKingsRoad() the meshes.
import * as THREE from 'three';
import type { Collision } from './collision';
import { mergeAll } from './fountain';
import { worldBox } from './geom';
import { type Kit, type StaticBatch, trs } from './kit';
import { KINGS_GATE, KINGS_ROAD, kingsRoadAt, kingsRoadArcAtZ, KINGS_ROAD_LINE } from './layout';
import { plankMaterial } from './materials';
import { rng } from './noise';
import { polylineDist, type Terrain } from './terrain';
import type { GlowSpot } from './dressing';

const q = { d: 0, s: 0, t: 0, seg: 0 };
const BOX = (() => {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of KINGS_ROAD.points) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  return { x0, z0, x1, z1 };
})();

/** Distance from x,z to the King's Road centre line (Infinity well away from it). */
export function kingsRoadDist(x: number, z: number, reach = 30): number {
  if (x < BOX.x0 - reach || x > BOX.x1 + reach || z < BOX.z0 - reach || z > BOX.z1 + reach) return Infinity;
  polylineDist(x, z, KINGS_ROAD.points, q);
  return q.d;
}

/** Arc length of the closest point on the road. */
export function kingsRoadArc(x: number, z: number): number {
  polylineDist(x, z, KINGS_ROAD.points, q);
  return q.s;
}

/** Total length of the road. */
export const KINGS_ROAD_LENGTH = (() => {
  let s = 0;
  const p = KINGS_ROAD.points;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
})();

/** Arc length of the zone line on the road. */
export const KINGS_LINE_ARC = kingsRoadArcAtZ(KINGS_ROAD_LINE.a[1]);

const HALF = KINGS_ROAD.width / 2;

interface LampSite {
  x: number;
  z: number;
  /** Yaw of the lantern arm, pointing over the road. */
  yaw: number;
}

/** Lamp posts every 24 units from the end of the cobbles, alternating sides, none past the gate. */
export function kingsRoadLamps(): LampSite[] {
  const out: LampSite[] = [];
  let side = 1;
  for (let s = KINGS_ROAD.cobbleEnd - 4; s < KINGS_LINE_ARC - 12; s += 24) {
    const p = kingsRoadAt(s);
    // Left of the direction of travel is (dz, -dx).
    const nx = p.dz * side;
    const nz = -p.dx * side;
    const off = HALF + 1.15;
    out.push({ x: p.x + nx * off, z: p.z + nz * off, yaw: Math.atan2(-nx, -nz) });
    side = -side;
  }
  return out;
}

/** The fork signpost: on the chapel plaza's south-west rim, where the road leaves the plaza. */
export const KINGS_SIGNPOST = { x: -8.2, z: -35.2 } as const;

/** Gate frame: pillar centres and the arch's local axes (u across the road, v along it, facing south). */
function gateFrame() {
  const g = KINGS_GATE;
  const ux = Math.cos(g.yaw);
  const uz = -Math.sin(g.yaw);
  const vx = Math.sin(g.yaw);
  const vz = Math.cos(g.yaw);
  const half = g.span / 2;
  return { g, ux, uz, vx, vz, half, pillars: [-1, 1].map((k) => [g.x + ux * half * k, g.z + uz * half * k] as [number, number]) };
}

/** Lamp posts, the signpost and the gate pillars block movement; the arch blocks the camera only. */
export function registerKingsRoad(terrain: Terrain, col: Collision): void {
  for (const l of kingsRoadLamps()) {
    const y = terrain.heightAt(l.x, l.z);
    col.addCircle(l.x, l.z, 0.42, y - 1, y + 4);
  }
  const sy = terrain.heightAt(KINGS_SIGNPOST.x, KINGS_SIGNPOST.z);
  col.addCircle(KINGS_SIGNPOST.x, KINGS_SIGNPOST.z, 0.3, sy - 1, sy + 4);
  const { g, half, pillars } = gateFrame();
  for (const [px, pz] of pillars) col.addBox(px, pz, 1.05, 1.05, g.yaw, g.h - 2, g.h + 12);
  // The arch over the road: line of sight only, so the follow camera does not pass through it.
  col.addBox(g.x, g.z, half, 0.9, g.yaw, g.h + 7.2, g.h + 12.5, true);
}

/**
 * Canvas for the signpost boards: Korean above, English below, an arrow toward the place. Rows:
 * Tidecrown and Clawhaven with the arrow on the right (front faces), then both with it on the left
 * (back faces, where the board's tip is on the reader's left).
 */
function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const board = (y: number, ko: string, en: string, right: boolean) => {
    const h = 256;
    g.save();
    g.translate(0, y);
    const wood = g.createLinearGradient(0, 0, 0, h);
    wood.addColorStop(0, '#7a4f2e');
    wood.addColorStop(1, '#5c3a20');
    g.fillStyle = wood;
    g.fillRect(0, 0, 1024, h);
    // Grain.
    const R = rng(right ? 3 : 4);
    g.strokeStyle = 'rgba(40,22,10,0.35)';
    g.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      const yy = 12 + R() * (h - 24);
      g.beginPath();
      g.moveTo(0, yy);
      g.bezierCurveTo(300, yy + (R() - 0.5) * 18, 700, yy + (R() - 0.5) * 18, 1024, yy + (R() - 0.5) * 10);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,214,150,0.35)';
    g.lineWidth = 10;
    g.strokeRect(16, 16, 1024 - 32, h - 32);
    // Lettering: carved and gilded.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cx = right ? 470 : 554;
    const text = (s: string, font: string, yy: number) => {
      g.font = font;
      g.fillStyle = 'rgba(25,12,4,0.85)';
      g.fillText(s, cx + 3, yy + 4);
      g.fillStyle = '#f3d08a';
      g.fillText(s, cx, yy);
    };
    text(ko, '800 112px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif', 98);
    text(en, '700 62px Cinzel, "Trajan Pro", Georgia, serif', 196);
    // Arrow head toward the place.
    g.fillStyle = '#f3d08a';
    g.beginPath();
    const ax = right ? 930 : 94;
    const d = right ? 1 : -1;
    g.moveTo(ax + d * 44, 128);
    g.lineTo(ax - d * 22, 74);
    g.lineTo(ax - d * 22, 182);
    g.closePath();
    g.fill();
    g.restore();
  };
  board(0, '타이드크라운', 'TIDECROWN', true);
  board(256, '클로헤이븐 광장', 'CLAWHAVEN', true);
  board(512, '타이드크라운', 'TIDECROWN', false);
  board(768, '클로헤이븐 광장', 'CLAWHAVEN', false);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Arrow-shaped board (local x along the board, pointing +x when dir = 1), centred on y. */
function arrowBoard(len: number, h: number, depth: number, dir: 1 | -1): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const tip = h * 0.55;
  s.moveTo(0, -h / 2);
  s.lineTo(len - tip, -h / 2);
  s.lineTo(len, 0);
  s.lineTo(len - tip, h / 2);
  s.lineTo(0, h / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  if (dir < 0) g.scale(-1, 1, 1);
  // Flip the winding back after the mirror.
  if (dir < 0) {
    const idx = g.index;
    if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a); }
    else {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const nor = g.getAttribute('normal') as THREE.BufferAttribute;
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) for (const a of [pos, nor, uv]) {
        for (let c = 0; c < a.itemSize; c++) { const v = a.getComponent(i, c); a.setComponent(i, c, a.getComponent(i + 2, c)); a.setComponent(i + 2, c, v); }
      }
    }
    g.computeVertexNormals();
  }
  return g;
}

export interface KingsRoadDressing {
  group: THREE.Group;
  glows: GlowSpot[];
  lights: { pos: THREE.Vector3; color: string; intensity: number; distance: number; kind: GlowSpot['kind'] }[];
}

/** Meshes: kerb stones, lamp posts, the signpost and the King's Gate. Kit lanterns and banners go to the batches. */
export function buildKingsRoad(village: Kit, terrain: Terrain, propBatch: StaticBatch): KingsRoadDressing {
  const group = new THREE.Group();
  group.name = 'kings-road';
  const glows: GlowSpot[] = [];
  const lights: KingsRoadDressing['lights'] = [];
  const H = (x: number, z: number) => terrain.heightAt(x, z);
  const warm = new THREE.Color('#ffb45a');
  const R = rng(5150);

  // Kerb stones along both edges of the dirt road: low, rounded, a little irregular.
  const kerb: THREE.BufferGeometry[] = [];
  const kerbColour: number[] = [];
  const stone = new THREE.IcosahedronGeometry(1, 0);
  const tint = new THREE.Color();
  for (let s = KINGS_ROAD.cobbleEnd - 2; s < KINGS_ROAD_LENGTH - 0.5; s += 0.95) {
    const p = kingsRoadAt(s);
    for (const side of [-1, 1]) {
      if (R() < 0.06) continue;
      const nx = p.dz * side;
      const nz = -p.dx * side;
      const off = HALF + 0.12 + R() * 0.12;
      const x = p.x + nx * off;
      const z = p.z + nz * off;
      const sx = 0.3 + R() * 0.16;
      const g = stone.clone();
      g.scale(sx, 0.17 + R() * 0.08, 0.24 + R() * 0.07);
      g.rotateX((R() - 0.5) * 0.25);
      g.rotateY(Math.atan2(p.dx, p.dz) + Math.PI / 2 + (R() - 0.5) * 0.5);
      g.translate(x, H(x, z) - 0.02, z);
      kerb.push(g);
      tint.setHSL(0.07 + R() * 0.04, 0.14 + R() * 0.1, 0.2 + R() * 0.1);
      for (let i = 0; i < g.getAttribute('position').count; i++) kerbColour.push(tint.r, tint.g, tint.b);
    }
  }
  const kerbGeo = mergeAll(kerb);
  kerbGeo.setAttribute('color', new THREE.Float32BufferAttribute(kerbColour, 3));
  kerbGeo.computeVertexNormals();
  const kerbMesh = new THREE.Mesh(kerbGeo, new THREE.MeshStandardMaterial({ name: 'kings-kerb', vertexColors: true, roughness: 0.88, flatShading: true }));
  kerbMesh.name = 'kings-road-kerb';
  kerbMesh.receiveShadow = true;
  group.add(kerbMesh);

  // Lamp posts: a dressed-stone foot, a squared timber post and an arm with a hanging lantern.
  const planks = plankMaterial();
  const stoneMat = village.material('MI_RockTrim') ?? village.material('MI_Brick')!;
  const posts: THREE.BufferGeometry[] = [];
  const feet: THREE.BufferGeometry[] = [];
  for (const l of kingsRoadLamps()) {
    const y = H(l.x, l.z);
    const ax = Math.sin(l.yaw);
    const az = Math.cos(l.yaw);
    feet.push(worldBox(0.8, 0.7, 0.8, 0.6).rotateY(l.yaw).translate(l.x, y + 0.2, l.z));
    feet.push(worldBox(0.62, 0.14, 0.62, 0.6).rotateY(l.yaw).translate(l.x, y + 0.6, l.z));
    posts.push(worldBox(0.26, 3.3, 0.26, 0.5).rotateY(l.yaw).translate(l.x, y + 2.3, l.z));
    posts.push(worldBox(0.18, 0.18, 1.25, 0.5).rotateY(l.yaw).translate(l.x + ax * 0.5, y + 3.75, l.z + az * 0.5));
    posts.push(worldBox(0.12, 0.12, 0.85, 0.5).rotateX(Math.PI / 4).rotateY(l.yaw).translate(l.x + ax * 0.32, y + 3.42, l.z + az * 0.32));
    posts.push(worldBox(0.34, 0.12, 0.34, 0.5).rotateY(l.yaw).translate(l.x, y + 4.0, l.z));
    // The kit lantern hangs under the arm's end, facing along the road.
    propBatch.add('Lantern_Wall', trs(l.x + ax * 1.0, y + 2.85, l.z + az * 1.0, l.yaw + Math.PI, 0.85));
    const lp = new THREE.Vector3(l.x + ax * 1.08, y + 3.1, l.z + az * 1.08);
    glows.push({ pos: lp, color: warm, size: 1.5, kind: 'lamp' });
  }

  // The signpost at the fork.
  const sp = KINGS_SIGNPOST;
  const sy = H(sp.x, sp.z);
  const roadDir = kingsRoadAt(14);
  // Arm 1 points up the road (north-west), arm 2 back to the square (south).
  const toRoad = Math.atan2(-roadDir.dz, roadDir.dx);
  const toSquare = Math.atan2(-(4 - sp.z), 0 - sp.x);
  feet.push(worldBox(0.75, 0.5, 0.75, 0.6).translate(sp.x, sy + 0.15, sp.z));
  posts.push(worldBox(0.24, 4.1, 0.24, 0.5).translate(sp.x, sy + 2.2, sp.z));
  posts.push(new THREE.ConeGeometry(0.24, 0.32, 4).rotateY(Math.PI / 4).translate(sp.x, sy + 4.41, sp.z));
  const boardLen = 2.7;
  const arms: [number, number, number][] = [
    [toRoad, 3.55, 1],
    [toSquare, 2.85, 1],
  ];
  const boards: THREE.BufferGeometry[] = [];
  for (const [yaw, hgt, dir] of arms) boards.push(arrowBoard(boardLen, 0.66, 0.1, dir as 1).rotateY(yaw).translate(sp.x, sy + hgt, sp.z));
  // Label planes on both faces of each board; each face takes its own canvas row (see signTexture).
  const labels: THREE.BufferGeometry[] = [];
  arms.forEach(([yaw, hgt], i) => {
    for (const face of [1, -1]) {
      const pl = new THREE.PlaneGeometry(boardLen - 0.5, 0.58);
      const row = (face > 0 ? 0 : 2) + i;
      const uv = pl.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (row + 1 - uv.getY(k)) / 4);
      // The back face turns round, so its text still reads left to right from behind.
      if (face < 0) pl.rotateY(Math.PI);
      pl.translate((boardLen - 0.5) / 2 + 0.08, 0, face * 0.066);
      labels.push(pl.rotateY(yaw).translate(sp.x, sy + hgt, sp.z));
    }
  });
  const boardMesh = new THREE.Mesh(mergeAll(boards), planks);
  boardMesh.castShadow = boardMesh.receiveShadow = true;
  boardMesh.name = 'kings-signpost-boards';
  group.add(boardMesh);
  const labelMesh = new THREE.Mesh(mergeAll(labels), new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }));
  labelMesh.name = 'kings-signpost-labels';
  labelMesh.receiveShadow = true;
  group.add(labelMesh);

  // The King's Gate: two dressed-stone pillars, a round arch of voussoirs, a keystone crown and banners.
  const { g, ux, uz, vx, vz, half, pillars } = gateFrame();
  const gate: THREE.BufferGeometry[] = [];
  const P = (lx: number, ly: number, lz: number) => [g.x + ux * lx + vx * lz, g.h + ly, g.z + uz * lx + vz * lz] as const;
  const put = (geo: THREE.BufferGeometry, lx: number, ly: number, lz: number, rz = 0) => {
    const [x, y, z] = P(lx, ly, lz);
    gate.push(geo.rotateZ(rz).rotateY(g.yaw).translate(x, y, z));
  };
  const pillarTop = 6.6;
  for (const k of [-1, 1]) {
    const lx = half * k;
    const [px, pz] = pillars[(k + 1) / 2];
    const foot = Math.min(H(px, pz), g.h) - 1.2;
    put(worldBox(2.5, g.h - foot + 0.9, 2.5, 0.45), lx, (foot - g.h + 0.9) / 2, 0);
    put(worldBox(2.1, pillarTop - 0.9, 2.1, 0.45), lx, 0.9 + (pillarTop - 0.9) / 2, 0);
    put(worldBox(2.6, 0.5, 2.6, 0.45), lx, pillarTop + 0.25, 0);
    // Pinnacle with a small cap.
    put(worldBox(1.2, 1.2, 1.2, 0.45), lx, pillarTop + 1.1, 0);
    put(new THREE.ConeGeometry(0.95, 1.6, 4).rotateY(Math.PI / 4), lx, pillarTop + 2.5, 0);
  }
  // Voussoirs from pillar top to pillar top.
  const r0 = half - 1.05;
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (1 - (i + 0.5) / n);
    const lx = Math.cos(a) * (r0 + 0.55);
    const ly = pillarTop + Math.sin(a) * (r0 + 0.55);
    const w = (Math.PI * (r0 + 0.55)) / n - 0.06;
    put(worldBox(1.1, w, 1.7, 0.45), lx, ly, 0, a - Math.PI / 2 + Math.PI / 2);
  }
  // Spandrel wall above the arch and a coping course.
  const top = pillarTop + r0 + 1.3;
  for (const k of [-1, 1]) put(worldBox(2.2, top - pillarTop - 0.5, 1.4, 0.45), k * (half - 1.4), pillarTop + 0.5 + (top - pillarTop - 0.5) / 2, 0);
  put(worldBox(2 * half + 2.4, 0.6, 2.2, 0.45), 0, top + 0.3, 0);
  // Keystone crown: three points.
  for (const [lx, hh] of [[-0.9, 1.0], [0, 1.6], [0.9, 1.0]] as [number, number][]) put(new THREE.ConeGeometry(0.42, hh, 4).rotateY(Math.PI / 4), lx, top + 0.6 + hh / 2, 0);
  put(worldBox(2.6, 0.5, 1.0, 0.45), 0, top + 0.85, 0);
  const gateMesh = new THREE.Mesh(mergeAll(gate), stoneMat);
  gateMesh.name = 'kings-gate';
  gateMesh.castShadow = gateMesh.receiveShadow = true;
  group.add(gateMesh);
  // Banners on the south faces of the pillars and lanterns on their inner faces.
  for (const k of [-1, 1]) {
    const [bx, by, bz] = P(half * k, 2.9, 1.08);
    propBatch.add('Banner_2', trs(bx, by, bz, g.yaw, 1.15));
    const [lx, ly, lz] = P(half * k - k * 1.08, 3.4, 0);
    propBatch.add('Lantern_Wall', trs(lx, ly, lz, g.yaw - (k * Math.PI) / 2, 0.9));
    const [gx, gy, gz] = P(half * k - k * 1.95, 3.95, 0);
    glows.push({ pos: new THREE.Vector3(gx, gy, gz), color: warm, size: 1.7, kind: 'lamp' });
  }
  const [lgx, lgy, lgz] = P(0, 4, 1.5);
  lights.push({ pos: new THREE.Vector3(lgx, lgy, lgz), color: '#ffb35a', intensity: 7, distance: 16, kind: 'lamp' });

  const feetMesh = new THREE.Mesh(mergeAll(feet), stoneMat);
  feetMesh.name = 'kings-road-post-feet';
  feetMesh.castShadow = feetMesh.receiveShadow = true;
  group.add(feetMesh);
  const postMesh = new THREE.Mesh(mergeAll(posts), planks);
  postMesh.name = 'kings-road-posts';
  postMesh.castShadow = postMesh.receiveShadow = true;
  group.add(postMesh);
  return { group, glows, lights };
}
