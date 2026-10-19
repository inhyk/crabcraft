// Development stand-in for public/models/world/tidecrown.glb and for statues.ts: rough pieces at the contract sizes
// and material names (TC_*), world-unit UVs and a height-based occlusion in vertex colour. island.ts loads this file
// only when the real assets are missing; delete it once both have landed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Kit } from '../../world/kit';

type Parts = Partial<Record<string, THREE.BufferGeometry[]>>;
const m4 = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

/** Positions, normals, world-unit box-projected UVs and an occlusion gradient, in one attribute layout. */
function finish(g: THREE.BufferGeometry, density: number, aoTop: number): THREE.BufferGeometry {
  const geo = (g.index ? g.toNonIndexed() : g).clone();
  geo.deleteAttribute('uv');
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const uv = new Float32Array(p.count * 2), col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay > ax && ay > az ? [x, z] : ax > az ? [z, y] : [x, y];
    uv[i * 2] = u * density;
    uv[i * 2 + 1] = v * density;
    const occ = 0.62 + 0.38 * Math.min(1, Math.max(0, y / aoTop)) - (n.getY(i) < -0.5 ? 0.18 : 0);
    col.set([occ, occ, occ, 1], i * 4);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geo;
}

class PieceBuilder {
  readonly parts: Parts = {};
  constructor(private aoTop: number) {}
  add(mat: string, geo: THREE.BufferGeometry, m?: THREE.Matrix4): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    (this.parts[mat] ??= []).push(g);
    return this;
  }
  box(mat: string, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0): this {
    return this.add(mat, new THREE.BoxGeometry(w, h, d), m4(x, y + h / 2, z, ry));
  }
  cyl(mat: string, r0: number, r1: number, h: number, x = 0, y = 0, z = 0, seg = 20): this {
    return this.add(mat, new THREE.CylinderGeometry(r1, r0, h, seg, 1), m4(x, y + h / 2, z));
  }
  cone(mat: string, r: number, h: number, x = 0, y = 0, z = 0, seg = 20): this {
    return this.add(mat, new THREE.ConeGeometry(r, h, seg, 1), m4(x, y + h / 2, z));
  }
  /** Crenellated parapet along local X at height y, both faces. */
  merlons(mat: string, len: number, y: number, thick: number, z = 0): this {
    const n = Math.max(2, Math.round(len / 2.4));
    for (let i = 0; i < n; i++) this.box(mat, (len / n) * 0.55, 1.6, thick, -len / 2 + (i + 0.5) * (len / n), y, z);
    return this;
  }
  /** Merlons round a drum. */
  ring(mat: string, r: number, y: number, n = 12): this {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add(mat, new THREE.BoxGeometry(1.4, 1.6, 1.2), m4(Math.sin(a) * r, y + 0.8, Math.cos(a) * r, a));
    }
    return this;
  }
  build(kit: Kit, name: string, mats: Map<string, THREE.Material>): void {
    const parts = Object.entries(this.parts).map(([mat, geos]) => {
      const density = mat === 'TC_Slate' ? 0.2 : 0.5;
      const geometry = mergeGeometries(geos!.map((g) => finish(g, density, this.aoTop)), false)!;
      geometry.computeBoundingBox();
      return { geometry, material: mats.get(mat)! };
    });
    const box = new THREE.Box3();
    for (const p of parts) box.union(p.geometry.boundingBox!);
    kit.pieces.set(name, { name, parts, box });
  }
}

/** A tapering tube along a curve (claws, horns). */
function horn(points: THREE.Vector3[], r0: number, r1: number, seg = 10, rings = 18): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.TubeGeometry(curve, rings, 1, seg, false);
  const p = tube.getAttribute('position');
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, c = curve.getPointAt(t), r = r0 + (r1 - r0) * Math.pow(t, 0.9);
    for (let j = 0; j <= seg; j++) {
      const k = i * (seg + 1) + j;
      const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  return tube;
}

/** A crab claw: a fat curved finger with a smaller one (the dactyl), rising from a pier toward the axis. */
function claw(b: PieceBuilder, mat: string, side: number, baseY: number, tipY: number, x0: number): void {
  const s = side;
  b.add(mat, horn([new THREE.Vector3(s * x0, baseY, 0), new THREE.Vector3(s * (x0 + 2), baseY + 9, 0), new THREE.Vector3(s * (x0 - 2), baseY + 19, 0), new THREE.Vector3(s * 3, tipY - 4, 0), new THREE.Vector3(s * 0.4, tipY, 0)], 5.2, 0.6));
  b.add(mat, horn([new THREE.Vector3(s * (x0 - 1), baseY + 15, 0), new THREE.Vector3(s * (x0 - 5), baseY + 19, 0), new THREE.Vector3(s * (x0 - 8.5), baseY + 20, 0)], 2.2, 0.4));
}

/** Pieces at the sizes of the castle kit's contract (layout.ts TC_PIECES). */
export function buildStubKit(): Kit {
  const kit = new Kit();
  const mats = new Map<string, THREE.Material>();
  for (const name of ['TC_Limestone', 'TC_LimestoneDark', 'TC_Slate', 'TC_Gold', 'TC_Nacre', 'TC_Glass', 'TC_LanternGlow', 'TC_Iron', 'TC_Wood']) {
    const m = new THREE.MeshStandardMaterial({ name, vertexColors: true });
    mats.set(name, m);
    kit.materials.set(name, m);
  }
  const L = 'TC_Limestone', D = 'TC_LimestoneDark', S = 'TC_Slate', G = 'TC_Gold';

  // City wall: 12 long, 24 tall, 6 thick, with a battered footing, string course and crenellations.
  new PieceBuilder(24).box(D, 12.02, 3, 6.6).box(L, 12.02, 19.4, 6, 0, 3).box(D, 12.02, 0.8, 6.5, 0, 22.4).merlons(L, 12, 22.4, 1, 2.6).merlons(L, 12, 22.4, 1, -2.6).build(kit, 'TC_CityWall_12', mats);
  // City tower: drum 32 tall, corbelled parapet, slate cone and a gold finial.
  {
    const b = new PieceBuilder(32).cyl(D, 6.6, 6.2, 4).cyl(L, 6.1, 5.8, 24, 0, 4).cyl(D, 5.8, 6.6, 2, 0, 28).cyl(L, 6.6, 6.6, 2, 0, 30).ring(L, 6.1, 32, 12).cone(S, 7, 14, 0, 32).cyl(G, 0.25, 0.1, 4, 0, 46);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; b.add('TC_Glass', new THREE.BoxGeometry(0.8, 2.6, 0.3), m4(Math.sin(a) * 5.95, 18, Math.cos(a) * 5.95, a)); }
    b.build(kit, 'TC_CityTower', mats);
  }
  new PieceBuilder(16).box(D, 12.02, 2.4, 4.5).box(L, 12.02, 12.4, 4, 0, 2.4).box(D, 12.02, 0.7, 4.4, 0, 14.8).merlons(L, 12, 14.8, 0.8, 1.6).merlons(L, 12, 14.8, 0.8, -1.6).build(kit, 'TC_WardWall_12', mats);
  {
    const b = new PieceBuilder(56).cyl(D, 7.6, 7.2, 5).cyl(L, 7.1, 6.8, 46, 0, 5).cyl(D, 6.8, 7.8, 2.5, 0, 51).cyl(L, 7.8, 7.8, 2.5, 0, 53.5).ring(L, 7.2, 56, 14).cone(S, 8.2, 18, 0, 56).cyl(G, 0.3, 0.12, 5, 0, 74);
    for (const y of [18, 32, 44]) for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + y; b.add('TC_Glass', new THREE.BoxGeometry(0.9, 3.2, 0.3), m4(Math.sin(a) * 6.95, y, Math.cos(a) * 6.95, a)); }
    b.build(kit, 'TC_WardTower', mats);
  }
  {
    // Ward gate: two flanking blocks, arch over a 6 x 9 passage, slate hood and an iron portcullis.
    const b = new PieceBuilder(22);
    for (const s of [-1, 1]) b.box(L, 5, 20, 8, s * 5.5, 0).box(D, 5.4, 1, 8.4, s * 5.5, 20).merlons(L, 5, 21, 0.8, 3.6);
    b.box(L, 6, 11, 8, 0, 9).box(D, 6.4, 0.8, 8.4, 0, 9).box('TC_Iron', 5.6, 4, 0.4, 0, 5, 3.2).box('TC_Wood', 5.8, 9, 0.5, 0, 0, -1.5);
    b.add(S, new THREE.ConeGeometry(4.4, 4, 4), m4(0, 22, 0, Math.PI / 4, 1.6, 1, 1.2));
    b.build(kit, 'TC_WardGate', mats);
  }
  {
    // Pincer Gate: two 14 wide piers, an arched 12 x 18 passage, and two giant claws whose tips meet at 46.
    const b = new PieceBuilder(46);
    for (const s of [-1, 1]) {
      b.box(D, 14.6, 4, 14.6, s * 13, 0).box(L, 14, 18, 14, s * 13, 4).box(D, 14.6, 1, 14.6, s * 13, 22).merlons(L, 14, 23, 1, 6.6).merlons(L, 14, 23, 1, -6.6);
      b.box('TC_Gold', 4, 6, 0.4, s * 13, 10, 7.1).box('TC_LimestoneDark', 5, 7, 0.3, s * 13, 9.5, 7.05);
      claw(b, L, s, 22, 46, 13);
    }
    b.box(L, 12, 5, 14, 0, 18).box(D, 12.4, 1, 14.4, 0, 23);
    b.box('TC_Iron', 11.6, 6, 0.5, 0, 12, 4.5).box('TC_Wood', 11.8, 18, 0.6, 0, 0, -5);
    b.build(kit, 'TC_PincerGate', mats);
  }
  {
    // Bridge span: 30 long along Z, deck top at the origin, 14 wide, an arch between piers 14 down, plinth bays.
    const b = new PieceBuilder(0.01);
    const shape = new THREE.Shape([new THREE.Vector2(-15, -14), new THREE.Vector2(15, -14), new THREE.Vector2(15, -1.4), new THREE.Vector2(-15, -1.4)]);
    const hole = new THREE.Path();
    hole.moveTo(-10.5, -14.5);
    hole.lineTo(-10.5, -12);
    hole.absarc(0, -12, 10.5, Math.PI, 0, true);
    hole.lineTo(10.5, -14.5);
    shape.holes.push(hole);
    const arch = new THREE.ExtrudeGeometry(shape, { depth: 13, bevelEnabled: false });
    b.add(L, arch, m4(6.5, 0, 0, -Math.PI / 2));
    b.box(D, 14.4, 1.1, 30, 0, -1.4).box(L, 13.2, 0.3, 30, 0, -0.3);
    for (const s of [-1, 1]) {
      b.box(L, 0.9, 1.3, 30, s * 6.6, 0).box(D, 1.1, 0.25, 30, s * 6.6, 1.3);
      // Corbelled bay for a plinth.
      b.box(D, 8.4, 1.4, 9, s * 11, -1.4).add(D, new THREE.CylinderGeometry(4.6, 1.2, 5, 4, 1), m4(s * 11, -4.4, 0, Math.PI / 4, 1.2, 1, 1));
      // Cutwater pier noses.
      for (const z of [-15, 15]) b.add(D, new THREE.CylinderGeometry(2.4, 3, 13, 3), m4(s * 7.6, -8, z, s > 0 ? Math.PI / 2 : -Math.PI / 2));
    }
    b.build(kit, 'TC_BridgeSpan', mats);
  }
  new PieceBuilder(8).box(D, 8, 1.4, 8).box(L, 7, 5.2, 7, 0, 1.4).box(D, 8, 1.4, 8, 0, 6.6).box(G, 4, 2.4, 0.2, 0, 3, 3.55).build(kit, 'TC_Plinth', mats);
  {
    // Keep: great hall (60 x 70), corner towers, a nacre shell dome ringed with spines, the spire and its claw crown.
    const b = new PieceBuilder(60);
    b.box(D, 61, 4, 71).box(L, 56, 26, 66, 0, 4).box(D, 57, 1.2, 67, 0, 30).merlons(L, 56, 31.2, 1, 32.5).merlons(L, 56, 31.2, 1, -32.5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(L, 8, 7.4, 44, sx * 28, 0, sz * 33).cyl(D, 7.4, 8.4, 2, sx * 28, 44, sz * 33).ring(L, 7.8, 46, 14).add(S, new THREE.ConeGeometry(8.6, 18, 20), m4(sx * 28, 48 + 9, sz * 33)).cyl(G, 0.35, 0.12, 5, sx * 28, 66, sz * 33);
    // Front: portal and tall stained-glass windows.
    b.box(D, 14, 18, 1.5, 0, 4, 33.4).box('TC_Wood', 9, 13, 0.5, 0, 4, 34.2).box(G, 9.6, 0.6, 0.6, 0, 17, 34.3);
    for (const x of [-18, -9, 9, 18]) b.box('TC_Glass', 4.2, 15, 0.4, x, 9, 33.2).box(D, 5.4, 1, 1.4, x, 24, 33.2);
    for (const z of [-22, -8, 8, 22]) for (const s of [-1, 1]) b.box('TC_Glass', 0.4, 14, 4, s * 28.1, 10, z);
    b.box('TC_Glass', 9, 9, 0.4, 0, 21.5, 33.2);
    b.add('TC_Nacre', new THREE.SphereGeometry(27, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), m4(0, 32, 0, 0, 1, 0.85, 1.05));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 26;
      b.add('TC_Nacre', new THREE.ConeGeometry(2.4, 10, 6), m4(Math.sin(a) * r, 36, Math.cos(a) * r * 1.05, a, 1, 1, 1, 0.45));
    }
    // Spire: tapering drum from the dome's crown to the claw crown, ringed by galleries.
    b.cyl(L, 6.5, 4.6, 70, 0, 50).cyl(D, 7.2, 7.2, 1.6, 0, 70).cyl(D, 6.2, 6.2, 1.6, 0, 96).cyl(D, 5.4, 5.4, 1.4, 0, 120).cyl(L, 4.6, 6.4, 8, 0, 120).cyl(D, 6.8, 6.8, 1.2, 0, 128);
    for (const y of [60, 84, 108]) for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; b.add('TC_Glass', new THREE.BoxGeometry(1.2, 6, 0.4), m4(Math.sin(a) * 5.5, y, Math.cos(a) * 5.5, a)); }
    // Six claws hold the lantern (centre 142), tips at 150.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pt = (r: number, y: number) => new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
      b.add(L, horn([pt(5.6, 128), pt(9.5, 135), pt(9.2, 143), pt(5.6, 148.5), pt(2.6, 150)], 1.9, 0.25, 8, 14));
    }
    b.cyl(G, 3.2, 2, 3, 0, 132);
    b.build(kit, 'TC_Keep', mats);
  }
  {
    const b = new PieceBuilder(1);
    b.add('TC_LanternGlow', new THREE.IcosahedronGeometry(4, 3));
    for (const r of [0, Math.PI / 3, (2 * Math.PI) / 3]) b.add(G, new THREE.TorusGeometry(4.25, 0.18, 6, 40), m4(0, 0, 0, r, 1, 1, 1, Math.PI / 2));
    b.build(kit, 'TC_Lantern', mats);
  }
  return kit;
}

/** Six stand-in hero statues (human, orc, dwarf, undead, night elf, tauren): crab warriors in limestone, about 18 tall. */
export async function buildStubStatues(): Promise<THREE.Object3D[]> {
  const stoneMat = new THREE.MeshStandardMaterial({ name: 'tc-statue-stone', color: '#ddd2bb', roughness: 0.85 });
  const goldMat = new THREE.MeshStandardMaterial({ name: 'tc-statue-gold', color: '#c9a24a', metalness: 0.85, roughness: 0.35 });
  const make = (kind: number) => {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.applyMatrix4(m);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    };
    // Shell body on six legs, raised claws.
    add(new THREE.SphereGeometry(4.2, 28, 16), stoneMat, m4(0, 9.5, 0, 0, 1, 0.75, 1));
    add(new THREE.SphereGeometry(3.4, 24, 12), stoneMat, m4(0, 12.4, 0.6, 0, 1, 0.7, 1));
    for (let i = 0; i < 6; i++) {
      const s = i < 3 ? -1 : 1, z = -2.6 + (i % 3) * 2.6;
      add(horn([new THREE.Vector3(s * 3.2, 9, z), new THREE.Vector3(s * 5.4, 9.6, z * 1.2), new THREE.Vector3(s * 5.6, 0.2, z * 1.3)], 0.8, 0.4, 8, 10), stoneMat, new THREE.Matrix4());
    }
    for (const s of [-1, 1]) {
      add(horn([new THREE.Vector3(s * 3.8, 10.5, 2.5), new THREE.Vector3(s * 6.4, 13.5, 4.5), new THREE.Vector3(s * 5.4, 16, 5.6)], 1.2, 1.6, 8, 10), stoneMat, new THREE.Matrix4());
      add(new THREE.SphereGeometry(2.2, 16, 10), stoneMat, m4(s * 5.2, 17, 5.8, 0, 0.8, 1.2, 0.8));
      add(new THREE.ConeGeometry(0.8, 3, 8), stoneMat, m4(s * 4.6, 19.4, 5.8, 0, 1, 1, 1, 0, s * 0.3));
    }
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.55, 10, 8), goldMat, m4(s * 1.3, 13.6, 3.6));
    // Race marks: helm and sword, tusks and axe, beard and hammer, hood, crescent, horns and totem.
    if (kind === 0) { add(new THREE.ConeGeometry(2.4, 3.4, 16), stoneMat, m4(0, 15, 0.6)); add(new THREE.BoxGeometry(0.5, 9, 0.3), goldMat, m4(-6.2, 21, 5.6)); add(new THREE.CylinderGeometry(3, 3, 0.5, 20), stoneMat, m4(6.6, 15.5, 7.3, 0, 1, 1, 1, Math.PI / 2)); }
    if (kind === 1) { for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.5, 2.4, 8), goldMat, m4(s * 1.2, 11.6, 3.9, 0, 1, 1, 1, -1.2)); add(new THREE.BoxGeometry(3.4, 2.6, 0.4), stoneMat, m4(6.6, 21, 5.8)); }
    if (kind === 2) { add(new THREE.ConeGeometry(2.2, 4, 12), stoneMat, m4(0, 9, 3.6, 0, 1, 1, 1, Math.PI)); add(new THREE.BoxGeometry(2.6, 2.2, 2.2), goldMat, m4(-5.6, 21, 5.6)); }
    if (kind === 3) add(new THREE.ConeGeometry(4, 6, 16, 1, true), stoneMat, m4(0, 14.5, 0.4));
    if (kind === 4) add(new THREE.TorusGeometry(2.6, 0.35, 8, 24, Math.PI * 1.3), goldMat, m4(5.4, 21.5, 5.8, 0, 1, 1, 1, 0, 0.8));
    if (kind === 5) { for (const s of [-1, 1]) add(horn([new THREE.Vector3(s * 2.2, 14, 0.6), new THREE.Vector3(s * 5, 16, 0.6), new THREE.Vector3(s * 5.4, 19, 1)], 0.8, 0.15, 8, 10), goldMat, new THREE.Matrix4()); add(new THREE.CylinderGeometry(0.4, 0.4, 14, 8), stoneMat, m4(6.4, 17, 6)); }
    g.name = `tc-statue-stub-${kind}`;
    return g;
  };
  return [0, 1, 2, 3, 4, 5].map(make);
}
