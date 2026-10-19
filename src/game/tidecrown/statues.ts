// The Bridge of Six Shells' hero statues: one colossal crab per race, carved from the real rig.
// Each statue is a dressed crab (race gear, crest, class weapon) posed on the rig's own joints
// (feet planted and claws raised by a small solver), frozen into static geometry (full-detail
// shell, far-LOD mechanics, the gear meshes) and split into three draws whose materials every
// statue shares: weathered limestone, bronze-gold accents, and the visor with faintly glowing eyes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCrab, HOME } from '../../crab/index';
import type { JumperRig } from '../../crab/rig';
import { loadCrabTemplate, type CrabTemplate, type PartClass } from '../../crab/template';
import { JOINT_NAMES, type ClassId, type CrabSpec, type RaceId, type Sex } from '../../crab/types';

/** Height of every statue at the top of its highest part, world units (live crab shell = 1). */
export const STATUE_HEIGHT = 18;
/** Side of the square plinth top every statue's feet fit on, world units. */
export const STATUE_PLINTH = 8;

type V2 = [number, number];
type V3 = [number, number, number];

interface ClawGoal {
  /**
   * Direction the held piece points (statue frame: x = crab's left, y up, z forward). Sword, staff
   * and lantern ride the jaw hinge, which is always square to the upper arm, so the claw itself
   * moves in the plane across this direction.
   */
  aim: V3;
  /** What aims: the held piece's +Y (handle, blade), the jaw hinge, or the jaw itself. */
  axis: 'y' | 'hinge' | 'jaw';
  /** Where the held piece's face (+Z) should turn: a shield or a book shown to the bridge. */
  face?: V3;
  /** Where the claw reaches from its shoulder (projected into that plane). */
  reach: V3;
  /** How far along it, as a share of the straight arm (default 0.92). */
  extend?: number;
  /** Jaw opening (LF/RF_J4, radians; the right jaw opens positive, the left negative). */
  jaw?: number;
}

interface StatueDef {
  race: RaceId;
  sex: Sex;
  classId: ClassId;
  crest: number;
  /** A second crest whose piece is carved on as well (night elf: antennae and the moon diadem). */
  crestExtra?: number;
  /** base_link height (live shell heights) and nose-up pitch (radians). */
  body: { y: number; pitch: number };
  /** Walking feet on the ground, (x, z) in live shell heights. */
  feet: { LM: V2; RM: V2; LR: V2; RR: V2 };
  clawL: ClawGoal;
  clawR: ClawGoal;
}

/**
 * Bridge order: human, orc, dwarf, undead, night elf, tauren. Every statue lifts something high
 * (blade, staff, lantern) so its height comes from the gesture, which keeps the body small enough
 * for its feet, gathered under it, to stand on the plinth (`feet` are pulled in to fit).
 */
const STATUES: StatueDef[] = [
  {
    // Knight: reared up, sword raised upright before him, shield up at the shoulder.
    race: 'human', sex: 'male', classId: 'warrior', crest: 0,
    body: { y: 0.95, pitch: 0.25 },
    feet: { LM: [0.55, 0.2], RM: [-0.55, 0.2], LR: [0.5, -0.55], RR: [-0.5, -0.55] },
    clawR: { aim: [-0.1, 0.9, -0.4], axis: 'y', reach: [-0.25, 1, 0.6], jaw: 0.1 },
    clawL: { aim: [-0.1, 1, 0.1], axis: 'hinge', face: [0.15, 0.05, 1], reach: [0.6, 0.1, 1], extend: 0.85, jaw: -0.1 },
  },
  {
    // Orc: both claws flung up and out in a roar, blade swung in over its head, shield high.
    race: 'orc', sex: 'male', classId: 'warrior', crest: 0,
    body: { y: 0.9, pitch: 0.25 },
    feet: { LM: [0.6, 0.22], RM: [-0.6, 0.22], LR: [0.52, -0.55], RR: [-0.52, -0.55] },
    clawR: { aim: [0.55, 0.8, 0.2], axis: 'y', reach: [-0.8, 0.6, 0.2], jaw: 0.5 },
    clawL: { aim: [-0.5, 0.8, 0.3], axis: 'hinge', face: [1, 0.25, 0.6], reach: [0.8, 0.55, 0.25], jaw: -0.45 },
  },
  {
    // Dwarf: squat and broad, sword at rest on the shoulder, shield braced at its side.
    race: 'dwarf', sex: 'male', classId: 'warrior', crest: 0,
    body: { y: 0.85, pitch: 0.2 },
    feet: { LM: [0.6, 0.22], RM: [-0.6, 0.22], LR: [0.52, -0.6], RR: [-0.52, -0.6] },
    clawR: { aim: [0.65, 0.55, -0.5], axis: 'y', reach: [-0.4, 0.5, 1], extend: 0.75, jaw: 0.05 },
    clawL: { aim: [-0.1, 1, -0.2], axis: 'hinge', face: [0.6, 0, 0.8], reach: [1, -0.15, 0.3], extend: 0.85, jaw: -0.05 },
  },
  {
    // Undead: hunched under the hood, lantern lifted over its head, hymnal held before it.
    race: 'undead', sex: 'male', classId: 'priest', crest: 0,
    body: { y: 0.92, pitch: -0.2 },
    feet: { LM: [0.68, 0.05], RM: [-0.68, 0.05], LR: [0.5, -0.55], RR: [-0.5, -0.55] },
    clawR: { aim: [0.3, 0.9, -0.25], axis: 'y', reach: [-0.45, 1, 0.45], extend: 0.95, jaw: 0.1 },
    clawL: { aim: [0, 1, 0], axis: 'hinge', face: [0, 0.6, 1], reach: [0.35, 0, 1], extend: 0.75, jaw: -0.1 },
  },
  {
    // Night elf: tall on straight legs, staff raised to the moon, the other claw open to the sky.
    race: 'nightelf', sex: 'female', classId: 'mage', crest: 1, crestExtra: 2,
    body: { y: 1.0, pitch: 0.45 },
    feet: { LM: [0.5, 0.15], RM: [-0.5, 0.15], LR: [0.45, -0.45], RR: [-0.45, -0.45] },
    clawR: { aim: [-0.15, 0.85, -0.45], axis: 'y', reach: [-0.3, 1, 0.5], jaw: 0.1 },
    clawL: { aim: [0.5, 0.85, 0.2], axis: 'jaw', reach: [0.5, 1, 0.3], jaw: -0.7 },
  },
  {
    // Tauren: broad and raised under the great horns, lantern staff upright at its side like a totem.
    race: 'tauren', sex: 'male', classId: 'priest', crest: 0,
    body: { y: 0.95, pitch: 0.3 },
    feet: { LM: [0.55, 0.2], RM: [-0.55, 0.2], LR: [0.5, -0.55], RR: [-0.5, -0.55] },
    clawR: { aim: [0, 1, 0], axis: 'y', reach: [-1, 0, 0.3], jaw: 0.1 },
    clawL: { aim: [0, 1, 0], axis: 'hinge', face: [0.3, 0.5, 1], reach: [0.75, -0.1, 0.8], extend: 0.85, jaw: -0.1 },
  },
];

// ------------------------------------------------------------------------------------------
// Materials, shared by all six statues.

const STONE = '#d9cfb8';
const BRONZE = '#b8913f';
const EYE = '#53f2e4';
/** Eye texture spots for the visor glass (dark) and glowing gear (lantern glass, staff orb). */
const VISOR_UV: V2 = [0.03, 0.06];
const GLOW_UV: V2 = [0.985, 0.9];

interface StatueMaterials {
  stone: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
}
let materials: StatueMaterials | null = null;

function statueMaterials(): StatueMaterials {
  if (materials) return materials;
  const grain = limestoneTexture(256);
  const stone = new THREE.MeshStandardMaterial({
    name: 'statue-limestone',
    color: STONE,
    roughness: 0.86,
    metalness: 0,
    map: grain,
    bumpMap: grain,
    bumpScale: 2,
    vertexColors: true,
  });
  const bronze = new THREE.MeshStandardMaterial({
    name: 'statue-bronze',
    color: BRONZE,
    roughness: 0.36,
    metalness: 0.8,
    vertexColors: true,
  });
  const eye = new THREE.MeshStandardMaterial({
    name: 'statue-eyes',
    color: '#17191b',
    roughness: 0.42,
    metalness: 0.1,
    emissive: EYE,
    emissiveMap: eyeTexture(),
    emissiveIntensity: 0.9,
  });
  materials = { stone, bronze, eye };
  return materials;
}

/** Tileable lattice value noise with period `p` cells across the texture. */
function tileNoise(size: number, p: number, seed: number): Float32Array {
  const lat = new Float32Array(p * p);
  let s = seed >>> 0;
  for (let i = 0; i < lat.length; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    lat[i] = (s & 0xffff) / 0xffff;
  }
  const out = new Float32Array(size * size);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * p;
      const fy = (y / size) * p;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = sm(fx - ix);
      const ty = sm(fy - iy);
      const a = lat[(iy % p) * p + (ix % p)];
      const b = lat[(iy % p) * p + ((ix + 1) % p)];
      const c = lat[((iy + 1) % p) * p + (ix % p)];
      const d = lat[((iy + 1) % p) * p + ((ix + 1) % p)];
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  return out;
}

/** Pale limestone grain: soft mottling, a fine tooth, scattered pits and faint bedding lines. */
function limestoneTexture(size: number): THREE.Texture {
  const oct = [4, 8, 16, 32, 64].map((p, i) => tileNoise(size, p, 11 + i * 31));
  const fine = tileNoise(size, 128, 97);
  const warp = tileNoise(size, 4, 501);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const m = oct[0][i] * 0.4 + oct[1][i] * 0.3 + oct[2][i] * 0.18 + oct[3][i] * 0.08 + oct[4][i] * 0.04;
    // Bedding: thin darker lines that wander with the warp (period-safe: integer cycles).
    const bed = Math.abs(Math.sin(((y / size) * 6 + warp[i] * 0.6) * Math.PI));
    let l = 0.84 + (m - 0.5) * 0.3 + (fine[i] - 0.5) * 0.14 - (bed < 0.05 ? (0.05 - bed) * 1.6 : 0);
    l = Math.max(0, Math.min(1, l));
    data[i * 4] = Math.round(l * 255);
    data[i * 4 + 1] = Math.round(l * (0.985 + (oct[1][i] - 0.5) * 0.02) * 255);
    data[i * 4 + 2] = Math.round(l * (0.95 + (oct[0][i] - 0.5) * 0.06) * 255);
    data[i * 4 + 3] = 255;
  }
  // Pits: small dark dots, wrapped at the edges.
  let s = 7;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) & 0xffff) / 0xffff;
  for (let k = 0; k < size * 1.6; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const r = 0.6 + rnd() * 1.3;
    const depth = 0.55 + rnd() * 0.3;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        const x = (Math.floor(cx) + dx + size) % size;
        const y = (Math.floor(cy) + dy + size) % size;
        const j = (y * size + x) * 4;
        const f = 1 - (1 - depth) * (1 - d * d);
        for (let c = 0; c < 3; c++) data[j + c] = Math.round(data[j + c] * f);
      }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The LED eyes as an emission mask over the face screen's uv (window centre at 0.5, eyes at
 * u = 0.3 and 0.7 like the live face's neutral pills), plus a dark spot for the visor glass and a
 * lit spot for glowing gear.
 */
function eyeTexture(): THREE.Texture {
  const w = 256;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const pill = (cx: number, cy: number, hw: number, hh: number) => {
    g.beginPath();
    g.roundRect(cx - hw, cy - hh, hw * 2, hh * 2, hw);
    g.fill();
  };
  for (const u of [0.3, 0.7]) {
    const cx = u * w;
    const cy = (1 - 0.56) * h;
    g.fillStyle = 'rgba(255,255,255,0.22)';
    pill(cx, cy, 9, 21);
    g.fillStyle = '#fff';
    pill(cx, cy, 5, 16);
  }
  // Glowing gear (lantern glass, staff orb, antenna tips) at about a third of the eyes.
  g.fillStyle = '#a0a0a0';
  g.fillRect(w - 8, 0, 8, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------------------------------
// Posing on the rig's own joints.

const LEGS = ['LM', 'RM', 'LR', 'RR'] as const;
type Leg = (typeof LEGS)[number];
const jointIndex = (name: string) => JOINT_NAMES.indexOf(name as (typeof JOINT_NAMES)[number]);

class Poser {
  /** Absolute joint angles (posture bias included), JOINT_NAMES order. */
  readonly q = new Float64Array(JOINT_NAMES.length);
  private lo = new Float64Array(JOINT_NAMES.length);
  private hi = new Float64Array(JOINT_NAMES.length);
  private tmp = new THREE.Vector3();

  constructor(
    readonly rig: JumperRig,
    t: CrabTemplate,
    /** Live shell heights to world units for this rig (race scale). */
    readonly unit: number,
  ) {
    JOINT_NAMES.forEach((j, i) => {
      const l = t.links[t.jointLinks[i]];
      this.lo[i] = l.lower;
      this.hi[i] = l.upper;
      this.set(i, HOME[j]);
    });
  }

  set(i: number, a: number): void {
    a = Math.min(this.hi[i], Math.max(this.lo[i], a));
    this.q[i] = a;
    this.rig.setJoint(JOINT_NAMES[i], a - this.rig.jointBias[i]);
  }

  update(): void {
    this.rig.root.updateMatrixWorld(true);
  }

  pos(o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
    return o.getWorldPosition(out).divideScalar(this.unit);
  }

  /**
   * Damped least squares on a residual over one limb's joints, numeric derivatives, only the
   * limb's subtree re-posed per step. Returns the final residual norm.
   */
  solve(limb: THREE.Object3D, joints: number[], residual: () => number[], iters = 120): number {
    const n = joints.length;
    const h = 1e-3;
    const lambda = 0.03;
    const evaluate = () => {
      limb.updateMatrixWorld(true);
      return residual();
    };
    let r0 = evaluate();
    let e0 = Math.hypot(...r0);
    let stall = 0;
    for (let it = 0; it < iters && e0 > 1e-5 && stall < 3; it++) {
      const J: number[][] = [];
      for (const i of joints) {
        const s = this.q[i];
        const d = s + h > this.hi[i] ? -h : h;
        this.set(i, s + d);
        const r = evaluate();
        this.set(i, s);
        J.push(r.map((v, k) => (v - r0[k]) / d));
      }
      const A: number[][] = [];
      const b: number[] = [];
      for (let a = 0; a < n; a++) {
        A.push([]);
        for (let c = 0; c < n; c++) {
          let sum = a === c ? lambda * lambda : 0;
          for (let k = 0; k < r0.length; k++) sum += J[a][k] * J[c][k];
          A[a].push(sum);
        }
        let sb = 0;
        for (let k = 0; k < r0.length; k++) sb -= J[a][k] * r0[k];
        b.push(sb);
      }
      const dq = linSolve(A, b);
      const before = joints.map((i) => this.q[i]);
      joints.forEach((i, k) => this.set(i, this.q[i] + Math.max(-0.25, Math.min(0.25, dq[k]))));
      const r1 = evaluate();
      const e1 = Math.hypot(...r1);
      if (e1 > e0) {
        joints.forEach((i, k) => this.set(i, before[k]));
        evaluate();
        break;
      }
      stall = e0 - e1 < 1e-5 ? stall + 1 : 0;
      r0 = r1;
      e0 = e1;
    }
    return e0;
  }

  /** The best of several solves from spread-out starting angles (deterministic). */
  solveFrom(limb: THREE.Object3D, joints: number[], residual: () => number[], starts: number, seed: number): number {
    let s = seed >>> 0;
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) & 0xffff) / 0xffff;
    const home = joints.map((i) => this.q[i]);
    let best = Infinity;
    let bestQ = home;
    for (let k = 0; k < starts; k++) {
      joints.forEach((i, j) => this.set(i, k === 0 ? home[j] : this.lo[i] + (this.hi[i] - this.lo[i]) * rnd()));
      const e = this.solve(limb, joints, residual);
      if (e < best - 1e-6) {
        best = e;
        bestQ = joints.map((i) => this.q[i]);
      }
    }
    joints.forEach((i, j) => this.set(i, bestQ[j]));
    limb.updateMatrixWorld(true);
    return best;
  }

  /**
   * Plants a walking foot: ground contact first, the footprint target second (by `footprint`, the
   * weight of the sideways error against the height error). A right leg starts
   * from its left twin's mirrored angles (every leg joint flips sign), so both bend the same way.
   */
  foot(leg: Leg, target: V3, footprint = 0.15): number {
    const tip = this.rig.linkNode(`${leg}_foot_tip_link`);
    const joints = [0, 1, 2].map((k) => jointIndex(`${leg}_J${k}_joint`));
    const limb = this.rig.linkNode(`${leg}_hip_link`);
    const residual = () => {
      const p = this.pos(tip, this.tmp);
      return [(p.x - target[0]) * footprint, p.y - target[1], (p.z - target[2]) * footprint];
    };
    if (leg[0] === 'R') {
      const twin = [0, 1, 2].map((k) => jointIndex(`L${leg[1]}_J${k}_joint`));
      joints.forEach((i, k) => this.set(i, -this.q[twin[k]]));
      return this.solve(limb, joints, residual);
    }
    return this.solveFrom(limb, joints, residual, 6, leg.charCodeAt(0) * 31 + leg.charCodeAt(1));
  }

  claw(side: 'L' | 'R', goal: ClawGoal): number {
    const sock = this.rig.getSocket(side === 'L' ? 'clawL' : 'clawR');
    const held = this.rig.gearMeshes.find((g) => g.parent === sock);
    const joints = [0, 1, 2, 3].map((k) => jointIndex(`${side}F_J${k}_joint`));
    const limb = this.rig.linkNode(`${side}F_shoulder_link`);
    const aim = new THREE.Vector3(...goal.aim).normalize();
    const axisOf = goal.axis === 'y' && held ? held : sock;
    const col = goal.axis === 'jaw' ? 2 : 1;
    // Reach target: from the arm's roll joint, along the reach hint laid into the plane across the aim.
    const j1 = this.pos(this.rig.linkNode(`${side}F_upper_arm_link`));
    const [b2, b3] = [joints[2], joints[3]].map((i) => this.q[i]);
    this.set(joints[2], 0);
    this.set(joints[3], 0);
    limb.updateMatrixWorld(true);
    const span = this.pos(sock).distanceTo(j1);
    this.set(joints[2], b2);
    this.set(joints[3], b3);
    const dir = new THREE.Vector3(...goal.reach).normalize();
    if (goal.axis !== 'jaw') dir.addScaledVector(aim, -dir.dot(aim)).normalize();
    const at = j1.clone().addScaledVector(dir, span * (goal.extend ?? 0.92));
    const face = goal.face && held ? new THREE.Vector3(...goal.face).normalize() : null;
    const m = new THREE.Vector3();
    const f = new THREE.Vector3();
    const err = this.solveFrom(limb, joints, () => {
      const p = this.pos(sock, this.tmp);
      m.setFromMatrixColumn(axisOf.matrixWorld, col).normalize();
      const r = [p.x - at.x, p.y - at.y, p.z - at.z, (m.x - aim.x) * 2, (m.y - aim.y) * 2, (m.z - aim.z) * 2];
      if (face) {
        f.setFromMatrixColumn(held!.matrixWorld, 2).normalize();
        r.push(f.x - face.x, f.y - face.y, f.z - face.z);
      }
      return r;
    }, 12, side === 'L' ? 101 : 202);
    if (goal.jaw !== undefined) this.set(jointIndex(`${side}F_J4_joint`), goal.jaw);
    return err;
  }
}

/** Gaussian elimination with partial pivoting (tiny systems). */
function linSolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

// ------------------------------------------------------------------------------------------
// Freezing the posed crab into three static geometries.

type Bucket = 'stone' | 'bronze' | 'eye';

/** Robot body classes: the visor is dark glass, everything else carved stone. */
const PART_BUCKET: Record<PartClass, Bucket> = {
  shell: 'stone',
  dark: 'stone',
  rubber: 'stone',
  metal: 'stone',
  joint: 'stone',
  visor: 'eye',
};

/**
 * Gear materials cast in bronze (helm metal, trims, rivets, wiring, the night elf's moon inlays);
 * glows light up faintly with the eyes; cracks stay dark. Copper is the dwarf's braided beard,
 * carved in stone like the rest of the face.
 */
const BRONZE_GEAR = /^(gold|steel|brass|iron|silver|leaf-silver|servo|wire-.*|paint-moon)$/;
const GLOW_GEAR = /^glow-/;
const DARK_GEAR = /^(crack)$/;

interface Piece {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array | null;
  index: Uint32Array;
}

function gearBucket(matName: string, held: boolean): { bucket: Bucket; uv?: V2 } {
  const name = matName.replace(/^gear:/, '').replace(/:.*$/, '');
  if (GLOW_GEAR.test(name)) return { bucket: 'eye', uv: GLOW_UV };
  if (DARK_GEAR.test(name)) return { bucket: 'eye', uv: VISOR_UV };
  if (BRONZE_GEAR.test(name)) return { bucket: 'bronze' };
  if (held && !/^(book|paper)$/.test(name)) return { bucket: 'bronze' };
  return { bucket: 'stone' };
}

function visibleInTree(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** A mesh geometry moved by `m` (and `push` along its normals): positions, normals, optional uv, index. */
function readPiece(geo: THREE.BufferGeometry, m: THREE.Matrix4, uv: V2 | 'keep' | null, push = 0): Piece {
  let g = geo;
  if (!g.getAttribute('normal')) {
    g = geo.clone();
    g.computeVertexNormals();
  }
  const pa = g.getAttribute('position');
  const na = g.getAttribute('normal');
  const n = pa.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    w.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
    v.fromBufferAttribute(pa, i).applyMatrix4(m).addScaledVector(w, push);
    pos.set([v.x, v.y, v.z], i * 3);
    nor.set([w.x, w.y, w.z], i * 3);
  }
  let uvs: Float32Array | null = null;
  if (uv === 'keep') {
    const ua = g.getAttribute('uv');
    uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) uvs.set([ua.getX(i), ua.getY(i)], i * 2);
  } else if (uv) {
    uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) uvs.set(uv, i * 2);
  }
  const index = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
  if (m.determinant() < 0) for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  return { pos, nor, uv: uvs, index };
}

function toGeometry(pieces: Piece[], withUv: boolean): THREE.BufferGeometry {
  const geos = pieces.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3));
    if (withUv) g.setAttribute('uv', new THREE.BufferAttribute(p.uv ?? new Float32Array((p.pos.length / 3) * 2), 2));
    g.setIndex(new THREE.BufferAttribute(p.index, 1));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('statue: could not merge geometry');
  return merged;
}

/** One body class from one detail level, limited to some bones. */
interface BodySource {
  cls: PartClass;
  geo: THREE.BufferGeometry;
  keep: (bone: number) => boolean;
}

/** Triangles of a skinned body geometry whose first vertex rides a kept bone. */
function sourceTriangles(s: BodySource): number[] {
  const si = s.geo.getAttribute('skinIndex');
  const idx = s.geo.index;
  const n = idx ? idx.count : s.geo.getAttribute('position').count;
  const tris: number[] = [];
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    if (s.keep(si.getX(a))) tris.push(a, idx ? idx.getX(i + 1) : i + 1, idx ? idx.getX(i + 2) : i + 2);
  }
  return tris;
}

/** Room left between a foot's tip and the plinth edge, world units (the pad reaches a little past it). */
const FOOT_MARGIN = 0.9;

/** Most triangles one statue may have. */
const TRIANGLE_BUDGET = 58000;

/**
 * The body the statue is carved from: the full-detail shell and visor (the surfaces a 18-unit
 * statue shows up close), the far LOD for the small mechanical classes, and the far LOD shell on
 * whichever walking legs it takes to keep the statue under its triangle budget with its gear.
 */
function bodySources(t: CrabTemplate, without: readonly string[], gearTris: number): { body: BodySource[]; lodLegs: string[] } {
  const full = t.parts(without);
  const lod = t.lodParts?.(without) ?? full;
  const legBones = (legs: string[]) =>
    new Set(legs.flatMap((l) => [`${l}_hip_link`, `${l}_calf_link`].map((n) => t.linkByName.get(n)!.bone)));
  const order = [[], ['LR', 'RR'], ['LR', 'RR', 'LM', 'RM']];
  let out: BodySource[] = [];
  let lodLegs: string[] = [];
  for (const legs of order) {
    const low = legBones(legs);
    lodLegs = legs;
    out = [];
    for (const cls of full.keys()) {
      if (cls === 'shell') {
        out.push({ cls, geo: full.get(cls)!, keep: (b) => !low.has(b) });
        if (low.size && lod.has(cls)) out.push({ cls, geo: lod.get(cls)!, keep: (b) => low.has(b) });
      } else if (cls === 'visor' || !lod.has(cls)) {
        out.push({ cls, geo: full.get(cls)!, keep: () => true });
      } else {
        out.push({ cls, geo: lod.get(cls)!, keep: () => true });
      }
    }
    const tris = out.reduce((s, src) => s + sourceTriangles(src).length / 3, 0);
    if (tris + gearTris <= TRIANGLE_BUDGET) break;
  }
  return { body: out, lodLegs };
}

/** The posed rig as world-space pieces per bucket. */
function bakeRig(rig: JumperRig, body: BodySource[]): Record<Bucket, Piece[]> {
  rig.root.updateMatrixWorld(true);
  const out: Record<Bucket, Piece[]> = { stone: [], bronze: [], eye: [] };
  const boneMats = rig.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, rig.skeleton.boneInverses[i]));
  const boneNor = boneMats.map((m) => new THREE.Matrix3().getNormalMatrix(m));
  const v = new THREE.Vector3();
  for (const src of body) {
    const pa = src.geo.getAttribute('position');
    const na = src.geo.getAttribute('normal');
    const si = src.geo.getAttribute('skinIndex');
    const tris = sourceTriangles(src);
    // Compact: only the vertices the kept triangles use.
    const remap = new Map<number, number>();
    for (const i of tris) if (!remap.has(i)) remap.set(i, remap.size);
    const n = remap.size;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    for (const [i, j] of remap) {
      const b = si.getX(i);
      v.fromBufferAttribute(pa, i).applyMatrix4(boneMats[b]);
      pos.set([v.x, v.y, v.z], j * 3);
      v.fromBufferAttribute(na, i).applyMatrix3(boneNor[b]).normalize();
      nor.set([v.x, v.y, v.z], j * 3);
    }
    const index = Uint32Array.from(tris, (i) => remap.get(i)!);
    const bucket = PART_BUCKET[src.cls];
    out[bucket].push({ pos, nor, uv: bucket === 'eye' ? new Float32Array(n * 2).map((_, k) => VISOR_UV[k % 2]) : null, index });
  }
  // The LED screen, lifted a hair off the visor so the eyes never fight it for depth.
  const face = rig.face.mesh;
  out.eye.push(readPiece(face.geometry, face.matrixWorld, 'keep', 0.0012 * rig.metersToUnits));
  for (const root of rig.gearMeshes) {
    const held = root.parent?.name.startsWith('socket:') ?? false;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !visibleInTree(mesh)) return;
      const { bucket, uv } = gearBucket((mesh.material as THREE.Material).name, held);
      out[bucket].push(readPiece(mesh.geometry, mesh.matrixWorld, bucket === 'eye' ? uv ?? VISOR_UV : null));
    });
  }
  return out;
}

/**
 * Lowest (or highest) point, world units, of what rides on one link (skinned body and the gear on
 * that link), or of the whole posed crab when `link` is null.
 */
function extremeY(rig: JumperRig, t: CrabTemplate, body: BodySource[], link: string | null, highest = false): number {
  rig.root.updateMatrixWorld(true);
  const bone = link ? t.linkByName.get(link)!.bone : -1;
  const mats = rig.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, rig.skeleton.boneInverses[i]));
  const v = new THREE.Vector3();
  let best = highest ? -Infinity : Infinity;
  const take = (y: number) => (best = highest ? Math.max(best, y) : Math.min(best, y));
  for (const src of body) {
    const pa = src.geo.getAttribute('position');
    const si = src.geo.getAttribute('skinIndex');
    for (let i = 0; i < pa.count; i++) {
      const b = si.getX(i);
      if ((link && b !== bone) || !src.keep(b)) continue;
      take(v.fromBufferAttribute(pa, i).applyMatrix4(mats[b]).y);
    }
  }
  const node = link ? rig.linkNode(link) : null;
  for (const g of rig.gearMeshes) {
    if (node && g.parent !== node) continue;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !visibleInTree(mesh)) return;
      const pa = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pa.count; i++) take(v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld).y);
    });
  }
  return best;
}

// ------------------------------------------------------------------------------------------
// Weathering: hemisphere occlusion over a voxelised statue, then stone and bronze tints.

const AO_DIRS = (() => {
  const dirs: V3[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    // Cosine-weighted Fibonacci hemisphere.
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const a = i * 2.39996323;
    dirs.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u)]);
  }
  return dirs;
})();

function occlusion(geos: THREE.BufferGeometry[], height: number): Float32Array[] {
  const box = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  const res = 72;
  const size = box.getSize(new THREE.Vector3());
  const vox = Math.max(size.x, size.y, size.z) / res;
  const o = box.min.clone().subScalar(vox * 2);
  const nx = Math.ceil(size.x / vox) + 5;
  const ny = Math.ceil(size.y / vox) + 5;
  const nz = Math.ceil(size.z / vox) + 5;
  const grid = new Uint8Array(nx * ny * nz);
  const mark = (x: number, y: number, z: number) => {
    const i = Math.floor((x - o.x) / vox);
    const j = Math.floor((y - o.y) / vox);
    const k = Math.floor((z - o.z) / vox);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) grid[(k * ny + j) * nx + i] = 1;
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const g of geos) {
    const p = g.getAttribute('position');
    const idx = g.index!;
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(p, idx.getX(t));
      b.fromBufferAttribute(p, idx.getX(t + 1));
      c.fromBufferAttribute(p, idx.getX(t + 2));
      const steps = Math.min(40, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (vox * 0.6)));
      for (let i = 0; i <= steps; i++)
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps;
          const v = j / steps;
          mark(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v);
        }
    }
  }
  const reach = height * 0.22;
  const steps = Math.ceil(reach / vox);
  const tan = new THREE.Vector3();
  const bit = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  return geos.map((g) => {
    const p = g.getAttribute('position');
    const nn = g.getAttribute('normal');
    const occ = new Float32Array(p.count);
    for (let v = 0; v < p.count; v++) {
      nrm.fromBufferAttribute(nn, v);
      tan.set(Math.abs(nrm.y) < 0.9 ? 0 : 1, Math.abs(nrm.y) < 0.9 ? 1 : 0, 0).cross(nrm).normalize();
      bit.crossVectors(nrm, tan);
      const px = p.getX(v) + nrm.x * vox * 1.5;
      const py = p.getY(v) + nrm.y * vox * 1.5;
      const pz = p.getZ(v) + nrm.z * vox * 1.5;
      let hit = 0;
      for (const [dx, dy, dz] of AO_DIRS) {
        const rx = tan.x * dx + bit.x * dy + nrm.x * dz;
        const ry = tan.y * dx + bit.y * dy + nrm.y * dz;
        const rz = tan.z * dx + bit.z * dy + nrm.z * dz;
        for (let s = 1; s <= steps; s++) {
          const d = s * vox;
          const y = py + ry * d;
          if (y < 0) {
            hit += 1 - s / steps;
            break;
          }
          const i = Math.floor((px + rx * d - o.x) / vox);
          const j = Math.floor((y - o.y) / vox);
          const k = Math.floor((pz + rz * d - o.z) / vox);
          if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) break;
          if (grid[(k * ny + j) * nx + i]) {
            hit += 1 - s / steps;
            break;
          }
        }
      }
      occ[v] = hit / AO_DIRS.length;
    }
    return occ;
  });
}

/** Smooth 3D value noise for low-frequency mottling. */
function vnoise(x: number, y: number, z: number): number {
  const h = (i: number, j: number, k: number) => {
    let s = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x1b873593);
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
    return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const ux = sm(fx);
  const uy = sm(fy);
  const uz = sm(fz);
  let s = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1;
    const dy = (k >> 1) & 1;
    const dz = k >> 2;
    s += (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz) * h(ix + dx, iy + dy, iz + dz);
  }
  return s;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const fbm = (x: number, y: number, z: number) => vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.15;

function weather(geo: THREE.BufferGeometry, occ: Float32Array, height: number, kind: 'stone' | 'bronze', seed: number): void {
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  // Verdigris relative to the bronze base colour (linear), so vertex colour times material colour lands on it.
  const base = new THREE.Color(BRONZE);
  const pat = new THREE.Color('#4f8f74');
  const ratio = [pat.r / base.r, pat.g / base.g, pat.b / base.b];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const ny = n.getY(i);
    const o = occ[i];
    const ao = 1 - Math.min(1, o * 1.5) * 0.8;
    const up = 0.86 + 0.14 * Math.min(1, y / (height * 0.4));
    const face = 1 + Math.max(0, ny) * 0.07 - Math.max(0, -ny) * 0.16;
    const m = fbm(x * 0.32 + seed, y * 0.32, z * 0.32);
    if (kind === 'stone') {
      // Mottled limestone: bleached on top, darker in the folds, underneath, down the rain streaks
      // on the steep faces, and in a few weathered patches.
      const streak = fbm(x * 0.9 + seed, y * 0.07, z * 0.9);
      const rain = 1 - 0.16 * smooth(0.42, 0.72, streak) * (1 - Math.abs(ny));
      const patch = smooth(0.55, 0.78, fbm(x * 0.11, y * 0.11 + seed, z * 0.11));
      const tone = (0.8 + m * 0.4) * ao * up * face * rain * (1 - 0.14 * patch);
      const warm = 0.03 * (fbm(x * 0.6, y * 0.6 + seed, z * 0.6) - 0.5) + 0.03 * patch;
      col.set([tone * (1 + warm), tone * (1 + warm * 0.4), tone * (1 - warm * 1.6)], i * 3);
    } else {
      const pv = Math.min(1, Math.max(0, o * 1.6 + (m - 0.5) * 0.7 + Math.max(0, ny) * 0.15 - 0.12)) * 0.75;
      const tone = (0.8 + m * 0.35) * (1 - Math.min(1, o * 1.35) * 0.55);
      col.set([tone * (1 + (ratio[0] - 1) * pv), tone * (1 + (ratio[1] - 1) * pv), tone * (1 + (ratio[2] - 1) * pv)], i * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Box-projected uv in world units (one texture tile every 3.5 units). */
function boxUv(geo: THREE.BufferGeometry): void {
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  const k = 1 / 3.5;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.set([p.getX(i) * k, p.getZ(i) * k], i * 2);
    else if (ax >= az) uv.set([p.getZ(i) * k, p.getY(i) * k], i * 2);
    else uv.set([p.getX(i) * k, p.getY(i) * k], i * 2);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ------------------------------------------------------------------------------------------

interface BakedStatue {
  race: RaceId;
  classId: ClassId;
  crest: number;
  /** Walking legs whose shell comes from the far LOD to stay in budget. */
  lodLegs: string[];
  /** Highest of the four feet's lowest points above the ground, statue units (0: all planted). */
  footGap: number;
  /** World units per live shell height in this statue. */
  scale: number;
  stone: THREE.BufferGeometry;
  bronze: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
}

const specOf = (d: StatueDef, crest: number): CrabSpec => ({ race: d.race, sex: d.sex, classId: d.classId, shell: 0, crest, led: 0, name: `statue-${d.race}` });

async function carve(d: StatueDef, t: CrabTemplate, seed: number): Promise<BakedStatue> {
  const rig = (await createCrab(specOf(d, d.crest))) as JumperRig;
  let extra: JumperRig | null = null;
  if (d.crestExtra !== undefined) {
    // Borrow the second crest's piece from a crab dressed with it; it rides on the same link.
    extra = (await createCrab(specOf(d, d.crestExtra))) as JumperRig;
    for (const g of extra.gearMeshes.filter((g) => g.name.startsWith('crest_'))) {
      const link = rig.linkNode(g.parent!.name);
      link.add(g);
      rig.gearMeshes.push(g);
    }
  }
  let gearTris = 0;
  for (const g of rig.gearMeshes)
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && visibleInTree(m)) gearTris += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
    });
  const { body: parts, lodLegs } = bodySources(t, rig.look.without, gearTris);
  const unit = rig.metersToUnits * t.info.shellTopHome;
  rig.posture.position.set(0, 0, 0);
  rig.posture.rotation.set(0, 0, 0);
  rig.body.position.set(0, d.body.y * unit, 0);
  rig.body.rotation.set(-d.body.pitch, 0, 0);
  const p = new Poser(rig, t, unit);
  p.update();
  // Claws first: the raised piece sets the statue's scale, and the scale how close the feet gather.
  p.claw('L', d.clawL);
  p.claw('R', d.clawR);
  const scale = STATUE_HEIGHT / (extremeY(rig, t, parts, null, true) / unit);
  const half = (STATUE_PLINTH / 2 - FOOT_MARGIN) / scale;
  const zs = LEGS.map((l) => d.feet[l][1]);
  const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
  const feet = {} as Record<Leg, V3>;
  for (const l of LEGS) {
    const [x, z] = d.feet[l];
    feet[l] = [Math.sign(x) * Math.min(Math.abs(x), half), 0, zc + Math.max(-half, Math.min(half, z - zc))];
  }
  // Later passes aim each tip link so the foot's lowest point, not the tip, meets the ground: for a
  // settled pose that point sits a fixed way below the tip.
  for (let pass = 0; pass < 4; pass++) {
    for (const leg of LEGS) {
      if (pass) feet[leg][1] = p.pos(rig.linkNode(`${leg}_foot_tip_link`)).y - extremeY(rig, t, parts, `${leg}_calf_link`) / unit;
      p.foot(leg, feet[leg], pass < 3 ? 0.15 : 0.04);
    }
  }
  p.update();
  const footLow = LEGS.map((leg) => extremeY(rig, t, parts, `${leg}_calf_link`));
  const tips = LEGS.map((l) => p.pos(rig.linkNode(`${l}_foot_tip_link`)));

  const pieces = bakeRig(rig, parts);
  const stone = toGeometry(pieces.stone, false);
  const bronze = toGeometry(pieces.bronze, false);
  const eye = toGeometry(pieces.eye, true);
  rig.dispose();
  extra?.dispose();

  // Base centre under the feet, lowest point on the ground, scaled to the statue height.
  const cx = (Math.min(...tips.map((f) => f.x)) + Math.max(...tips.map((f) => f.x))) / 2;
  const cz = (Math.min(...tips.map((f) => f.z)) + Math.max(...tips.map((f) => f.z))) / 2;
  const box = new THREE.Box3();
  for (const g of [stone, bronze, eye]) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  const k = STATUE_HEIGHT / (box.max.y - box.min.y);
  const footGap = Math.max(...footLow.map((y) => (y - box.min.y) * k));
  const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-cx * unit, -box.min.y, -cz * unit));
  for (const g of [stone, bronze, eye]) {
    g.applyMatrix4(m);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  const [oStone, oBronze] = occlusion([stone, bronze, eye], STATUE_HEIGHT);
  weather(stone, oStone, STATUE_HEIGHT, 'stone', seed);
  weather(bronze, oBronze, STATUE_HEIGHT, 'bronze', seed);
  boxUv(stone);
  boxUv(bronze);
  return { race: d.race, classId: d.classId, crest: d.crest, lodLegs, footGap, scale: k * unit, stone, bronze, eye };
}

let baked: Promise<BakedStatue[]> | null = null;

async function bakeAll(): Promise<BakedStatue[]> {
  const t = await loadCrabTemplate();
  const out: BakedStatue[] = [];
  for (const [i, d] of STATUES.entries()) {
    out.push(await carve(d, t, i * 13.7));
    // About 0.1 s of work per statue: let a frame through between them.
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/**
 * The six hero statues in bridge order (human, orc, dwarf, undead, night elf, tauren). Each is a
 * group with its origin at the centre of its base on the ground, facing +Z, STATUE_HEIGHT tall,
 * three static meshes (stone, bronze, eyes) on materials all statues share; nothing updates per
 * frame. Geometry is carved once and every call returns new groups over it, so the result can be
 * placed freely; the geometry and materials are shared, so callers do not dispose them.
 */
export async function buildHeroStatues(): Promise<THREE.Object3D[]> {
  baked ??= bakeAll();
  const list = await baked;
  const mats = statueMaterials();
  return list.map((s) => {
    const g = new THREE.Group();
    g.name = `statue:${s.race}`;
    g.userData = { race: s.race, classId: s.classId, crest: s.crest, lodLegs: s.lodLegs, footGap: s.footGap, scale: s.scale };
    for (const key of ['stone', 'bronze', 'eye'] as const) {
      const mesh = new THREE.Mesh(s[key], mats[key]);
      mesh.name = `statue-${s.race}-${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      g.add(mesh);
    }
    return g;
  });
}
