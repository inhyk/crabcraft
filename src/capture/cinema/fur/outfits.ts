// The tribute's fur costumes, groomed on the Jumper rig in its bind space (robot metres: +x the crab's
// left, +y up, +z forward; the LED window spans x +-0.054, y 0.033..0.065 at z 0.066..0.091).
//   dwarf: a wolf-grey fur mantle over the carapace, a copper beard under the LED face with a moustache,
//          bushy brows over the window and two braids closed with iron rings, snow caked into all of it
//   beast: a long grizzled bear pelt over the shell, hanging off its sides, a ruff round the face and
//          shaggy fur down the upper legs; claws and lower legs stay bare metal
import * as THREE from 'three';
import type { Grown, Layer, V } from './groom';

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const sgn = (x: number) => (x < 0 ? -1 : 1);
/** Smooth blotches about a centimetre across (snow caked in patches). */
const blotch = (p: V, f = 1) =>
  0.5 + 0.5 * Math.sin(p.x * 210 * f + 1.3) * Math.sin(p.y * 170 * f + 0.7) * Math.sin(p.z * 190 * f + 2.1);

/** The LED window and the brow over it, kept clear of the mantle and the pelt. */
const FACE = (p: V, m = 0) => Math.abs(p.x) < 0.057 + m && p.z > 0.05 && p.y > 0.029;
/** Under the window: where the beard grows. */
const CHIN = (p: V) => p.z > 0.066 && p.y < 0.035 && p.y > -0.009 && Math.abs(p.x) < 0.062;

const MANTLE: Layer = {
  name: 'mantle',
  classes: ['shell', 'dark'],
  links: /^base_link$/,
  mask: (p, n) => (n.y < -0.3 || p.y < 0.006 || FACE(p) || CHIN(p) ? 0 : 1),
  count: 320000,
  points: 7,
  seg: 7,
  length: (p, _n, r) => 0.011 + 0.02 * ss(0.05, 0.012, p.y) + 0.006 * r,
  dir: (p, n, _r, out) => {
    const h = new THREE.Vector3(p.x, 0, p.z + 0.01).normalize();
    return out.copy(n).multiplyScalar(0.35).addScaledVector(h, 0.6).add(new THREE.Vector3(0, -0.25, -0.3 * Math.max(0, n.y)));
  },
  gravity: 0.8,
  curl: 0.14,
  width: 0.00016,
  stiff: 1,
  clump: { size: 30, pull: 0.7, pow: 1.3 },
  locks: { big: 6, lengthVar: 0.2, stray: 0.03 },
  snow: (p, n, r) => ss(0.6, 0.98, n.y) * Math.max(0, blotch(p, 0.7) * 1.6 - 0.8) * r,
  wave: { amp: 0.04, freq: 1.0 },
  jitter: 0.2,
  look: { colA: '#1c130d', colB: '#3e2e21', tip: '#6e5e4c', tipAmt: 0.6, rootAO: 0.06, spec1: 0.04, spec2: 0.16, back: 1.2, wrap: 0.4 },
  bits: { clumps: 0.2, crystals: 0.4, size: 0.0009, powder: 3 },
};

const BEARD: Layer = {
  name: 'beard',
  classes: ['shell', 'dark', 'visor'],
  links: /^base_link$/,
  mask: (p, n) => (CHIN(p) && n.z > 0.1 ? 1 - Math.pow(Math.abs(p.x) / 0.062, 4) : 0),
  count: 90000,
  points: 10,
  seg: 14,
  length: (p, _n, r) => 0.05 + 0.04 * (1 - Math.pow(Math.abs(p.x) / 0.062, 2)) + 0.01 * r,
  dir: (p, n, _r, out) => out.set(p.x * 3, -1, 0.22).normalize().addScaledVector(n, 0.2),
  gravity: 1.4,
  curl: 0.18,
  width: 0.00022,
  stiff: 1.6,
  clump: { size: 22, pull: 0.85, pow: 1.1 },
  locks: { big: 8, lengthVar: 0.25, stray: 0.03 },
  wave: { amp: 0.06, freq: 1.6 },
  snow: (p, _n, r) => (0.3 + Math.max(0, blotch(p) * 1.4 - 0.6)) * (0.5 + 0.5 * r),
  jitter: 0.15,
  look: { colA: '#341406', colB: '#6a2c0e', tip: '#8c4a1c', tipAmt: 0.5, rootAO: 0.12, spec1: 0.05, spec2: 0.35, gloss1: 120, gloss2: 28, shift: 0.1, back: 1.6, tipWidth: 0.3 },
  bits: { clumps: 0.4, crystals: 0.35, size: 0.0012, powder: 6 },
};

const MOUSTACHE: Layer = {
  name: 'moustache',
  classes: ['shell', 'dark', 'visor'],
  links: /^base_link$/,
  mask: (p, n) => (p.z > 0.066 && p.y > 0.021 && p.y < 0.037 && Math.abs(p.x) > 0.01 && Math.abs(p.x) < 0.06 && n.z > 0 ? 1 : 0),
  count: 14000,
  points: 7,
  seg: 9,
  length: (p, _n, r) => 0.018 + 0.016 * (Math.abs(p.x) / 0.06) + 0.004 * r,
  dir: (p, _n, _r, out) => out.set(sgn(p.x) * 1.1, -0.3, 0.55),
  gravity: 0.6,
  curl: 0.09,
  width: 0.00026,
  stiff: 1.4,
  clump: { size: 14, pull: 0.85, pow: 1.05 },
  locks: { big: 7, lengthVar: 0.25, stray: 0.04 },
  snow: (p, _n, r) => (blotch(p, 1.4) > 0.6 ? 0.7 : 0.15) * r,
  wave: { amp: 0.05, freq: 1.2 },
  look: { colA: '#361406', colB: '#6e2e10', tip: '#925020', tipAmt: 0.5, rootAO: 0.2, spec1: 0.05, spec2: 0.35, gloss1: 120, back: 1.6, tipWidth: 0.3 },
  bits: { clumps: 0.4, crystals: 0.35, size: 0.0011, powder: 6 },
};

const BROWS: Layer = {
  name: 'brows',
  classes: ['shell', 'dark'],
  links: /^base_link$/,
  mask: (p, n) => (p.y > 0.06 && p.z > 0.055 && Math.abs(p.x) > 0.008 && Math.abs(p.x) < 0.06 && n.y > -0.2 ? 1 : 0),
  count: 30000,
  points: 6,
  seg: 6,
  length: (p, _n, r) => 0.01 + 0.012 * (Math.abs(p.x) / 0.06) + 0.005 * r,
  dir: (p, _n, _r, out) => out.set(sgn(p.x) * 0.8, 0.32, 1),
  gravity: 0.3,
  curl: 0.22,
  width: 0.00022,
  stiff: 2.2,
  clump: { size: 40, pull: 0.75, pow: 1.2 },
  snow: (_p, _n, r) => 0.35 * r,
  wave: { amp: 0.08, freq: 1.4 },
  look: { colA: '#2c1006', colB: '#5e260e', tip: '#8a6a58', tipAmt: 0.45, rootAO: 0.2, spec1: 0.04, spec2: 0.25, back: 1.4, tipWidth: 0.3 },
  bits: { clumps: 0.2, crystals: 0.3, size: 0.0011, powder: 2 },
};

/** Where the two braids hang from, bind space; the rings close them at BRAID_RING of their length. */
export const BRAIDS = [
  { root: new THREE.Vector3(0.019, 0.012, 0.096), side: 1 },
  { root: new THREE.Vector3(-0.019, 0.012, 0.096), side: -1 },
];
export const BRAID_LEN = 0.078;
export const BRAID_RING = 0.7;

/** A braid's centre line at s (0 root .. 1 end). */
export function braidAxis(root: V, side: number, s: number, out = new THREE.Vector3()): V {
  return out.set(root.x + side * 0.004 * s, root.y - BRAID_LEN * s, root.z + 0.011 * Math.sin(Math.PI * Math.min(1, s * 1.1)) + 0.004 * s);
}

/** Three locks plaited down to the ring, then a loose tassel. */
function growBraids(rng: () => number): Grown {
  const P = 28;
  const per = 340;
  const count = BRAIDS.length * 3 * per;
  const pts = new Float32Array(count * P * 3);
  const roots = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const data = new Float32Array(count * 5);
  const ax = new THREE.Vector3();
  let i = 0;
  for (const b of BRAIDS) {
    for (let k = 0; k < 3; k++) {
      for (let m = 0; m < per; m++, i++) {
        const ang = rng() * Math.PI * 2;
        const rad = Math.sqrt(rng()) * 0.0017;
        const spread = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
        for (let j = 0; j < P; j++) {
          const s = j / (P - 1);
          braidAxis(b.root, b.side, s, ax);
          let ox: number;
          let oz: number;
          if (s <= BRAID_RING) {
            // The classic three-strand plait: each lock swings side to side and in and out at twice the rate.
            const ph = s * Math.PI * 2 * 4.6 + (k * Math.PI * 2) / 3;
            const R = 0.0042 * (1 - 0.35 * s) * ss(0, 0.06, s);
            ox = R * Math.sin(ph) + rad * Math.cos(ang + s * 3);
            oz = R * 0.55 * Math.sin(2 * ph) + rad * Math.sin(ang + s * 3);
            const pinch = 1 - 0.6 * ss(BRAID_RING - 0.08, BRAID_RING, s);
            ox *= pinch;
            oz *= pinch;
          } else {
            // The tassel below the ring fans out and droops.
            const f = ss(BRAID_RING, 1, s);
            ox = spread.x * (0.0012 + 0.0065 * f) * (0.4 + rad / 0.0017);
            oz = spread.z * (0.0012 + 0.0065 * f) * (0.4 + rad / 0.0017);
          }
          pts[(i * P + j) * 3] = ax.x + ox;
          pts[(i * P + j) * 3 + 1] = ax.y;
          pts[(i * P + j) * 3 + 2] = ax.z + oz;
        }
        roots[i * 3] = pts[i * P * 3];
        roots[i * 3 + 1] = pts[i * P * 3 + 1];
        roots[i * 3 + 2] = pts[i * P * 3 + 2];
        normals.set([0, -0.2, 1], i * 3);
        data[i * 5] = 0.00022 * (0.8 + 0.4 * rng());
        data[i * 5 + 1] = rng();
        data[i * 5 + 2] = rng() < 0.3 ? 0.6 : 0.1;
        data[i * 5 + 3] = rng();
        data[i * 5 + 4] = 3;
      }
    }
  }
  return { pts, roots, normals, data, count };
}

const BRAID: Layer = {
  ...BEARD,
  name: 'braids',
  count: 0,
  points: 28,
  seg: 40,
  stiff: 3,
  look: { ...BEARD.look, colA: '#301205', colB: '#62280c', tipAmt: 0.25, rootAO: 0.35 },
  bits: { clumps: 0.3, crystals: 0.4, size: 0.0009 },
  grow: growBraids,
};

const PELT: Layer = {
  name: 'pelt',
  classes: ['shell', 'dark'],
  links: /^base_link$/,
  mask: (p, n) => (n.y < -0.35 || p.y < -0.002 || (Math.abs(p.x) < 0.058 && p.z > 0.062 && p.y > 0.03 && p.y < 0.068) ? 0 : 1),
  count: 380000,
  points: 7,
  seg: 8,
  length: (p, _n, r) => 0.016 + 0.026 * ss(0.055, 0.004, p.y) + (p.z > 0.045 ? 0.008 : 0) + 0.007 * r,
  dir: (p, n, _r, out) => {
    const h = new THREE.Vector3(p.x, 0, p.z + 0.01).normalize();
    return out
      .copy(n)
      .multiplyScalar(0.45)
      .addScaledVector(h, 0.5 * (1 - Math.max(0, n.y)))
      .add(new THREE.Vector3(0, -0.25, -0.7 * Math.max(0, n.y)));
  },
  gravity: 0.85,
  curl: 0.18,
  width: 0.00018,
  stiff: 1.2,
  clump: { size: 80, pull: 0.55, pow: 1.3 },
  wave: { amp: 0.05, freq: 1.3 },
  snow: (p, n, r) => ss(0.6, 0.98, n.y) * Math.max(0, blotch(p, 0.5) * 1.5 - 0.6) * r,
  jitter: 0.3,
  look: { colA: '#140c08', colB: '#3a2014', tip: '#6a4630', tipAmt: 0.75, rootAO: 0.06, spec1: 0.03, spec2: 0.14, back: 1.3, wrap: 0.3 },
  bits: { clumps: 0.15, crystals: 0.25, size: 0.0012, powder: 2 },
};

/**
 * Guard hairs over the pelt: fewer, two to three times longer and coarser, standing out of the coat
 * with pale tips, longest down the spine, so the outline breaks up and the coat has a top layer.
 */
const GUARD: Layer = {
  ...PELT,
  name: 'guard',
  count: 70000,
  points: 8,
  seg: 10,
  length: (p, n, r) =>
    (0.034 + 0.03 * ss(0.055, 0.004, p.y) + 0.026 * ss(0.03, 0.0, Math.abs(p.x)) * Math.max(0, n.y)) * (0.75 + 0.5 * r),
  dir: (p, n, _r, out) => {
    const h = new THREE.Vector3(p.x, 0, p.z + 0.01).normalize();
    return out.copy(n).multiplyScalar(0.7).addScaledVector(h, 0.35).add(new THREE.Vector3(0, -0.1, -0.35 * Math.max(0, n.y)));
  },
  gravity: 0.7,
  curl: 0.1,
  jitter: 0.35,
  width: 0.00034,
  stiff: 1.6,
  clump: { size: 10, pull: 0.4, pow: 1.5 },
  locks: undefined,
  wave: { amp: 0.06, freq: 1.1 },
  look: { colA: '#1a1009', colB: '#3a2214', tip: '#8a6a4e', tipAmt: 0.85, rootAO: 0.1, spec1: 0.05, spec2: 0.2, back: 1.6, wrap: 0.3, tipWidth: 0.2 },
  bits: undefined,
};

const LIMBS: Layer = {
  name: 'limbs',
  classes: ['shell', 'metal', 'joint'],
  links: /(hip|thigh|shoulder|upper_arm)_link$/,
  mask: (_p, n) => (n.y < -0.55 ? 0 : 1),
  count: 150000,
  points: 6,
  seg: 6,
  length: (_p, _n, r) => 0.01 + 0.007 * r,
  dir: (p, n, _r, out) => out.copy(n).multiplyScalar(0.5).add(new THREE.Vector3(sgn(p.x) * 0.3, -0.6, 0)),
  gravity: 0.5,
  curl: 0.14,
  width: 0.00022,
  stiff: 1.3,
  clump: { size: 35, pull: 0.55, pow: 1.4 },
  snow: (_p, n, r) => ss(0.6, 0.98, n.y) * r * 0.4,
  jitter: 0.3,
  look: { colA: '#120a06', colB: '#2e1d12', tip: '#5a3e2c', tipAmt: 0.7, rootAO: 0.08, spec1: 0.03, spec2: 0.12, back: 1.2 },
  bits: { clumps: 0.3, crystals: 0.3, size: 0.0014 },
};

/** Gear the costume replaces: the dwarf's cable beard, crest and head plate; the beast's back armour. */
export const OUTFIT_HIDES: Record<string, string[]> = {
  dwarf: ['dwarf_gear', 'crest_braids'],
  beast: ['enemy_scavenger'],
};

export const OUTFITS: Record<string, Layer[]> = {
  dwarf: [MANTLE, BEARD, MOUSTACHE, BROWS, BRAID],
  beast: [PELT, GUARD, LIMBS],
};
