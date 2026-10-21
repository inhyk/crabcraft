// A broken wooden windmill standing dark against the stormy sky behind the undead (the original's
// ruined mill at the right of the frame): a tapering weatherboarded tower with boards gone, a door hole
// and one lit window, a gabled cap, and four lattice sails braced by a wheel of rings and spokes, slats
// and rings broken, rags of sailcloth, one sail snapped and hanging off its stock. Built of boxes in
// code, seen at mid to far distance: dark wood, a faint rim from the sky behind it, the scene's fog.
// Everything is a function of the shot clock (seek-safe).
//
//   night-windmill { at, path, yaw, face, scale, spin, sway, ... }
//       at     [x, z] (stands on the ground) or a point
//       path   [[t, x, z, lift], ...] (optional) moves it through ground spots over the shot (a smooth
//              curve through the keys; lift raises its foot off the ground there, or sinks it if < 0):
//              holds it at one side of the frame while the lens pans and tilts; keep its foot out of
//              sight while it moves (knoll hides a lifted foot)
//       knoll  height of a rocky mound under its foot (default 0, none)
//       yaw    its front's heading (radians, 0 = +z); face [x, z] or a point turns the front toward it
//              first (yaw then adds)
//       scale  size (1: hub 11.4 above the ground, sails 8.4 long); sink lowers it into the ground
//       lean   [x, z] tilt of the whole mill, radians (default a slight list)
//       spin   rad/s the sails turn (default 0); sway amplitude (rad, default 0.035) and swayT period (s)
//              of their creaking rock
//       ring   false drops the wheel of rings and spokes
//       wood, cloth, stone colours; key, keyK the cool light from above the lens; amb, ambK
//       rim, rimK the sky's edge light; sky a point the sky glows from (default: behind it, up)
//       haze, hazeK the air between it and the lens (colour, per unit of distance)
//       cloud  { k, color, size, back } a pale break in the storm clouds behind it so it reads black
//              against them (k 0 drops it; size in sail lengths, back its distance behind the hub)
//       lamp, lampK the lit window (lampK 0 puts it out); fogK scales the fog's density on it
//       seed
import * as THREE from 'three';
import { envelope, glowTexture, mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { fogUniforms, hdr, syncFog } from './night-kit';

type V3 = [number, number, number];

/** Material kinds (aKind): wood, sailcloth, the dark inside of a hole, the lit window, stone. */
const WOOD = 0;
const CLOTH = 1;
const DARK = 2;
const LAMP = 3;
const STONE = 4;

/** Tower: height, apothem at the foot and the top, eight faces; the cap's hub and the sails. */
const H = 10;
const A0 = 2.5;
const A1 = 1.6;
const SIDES = 8;
const BOARD = 0.42;
const HUB: V3 = [0, 11.4, 2.6];
const SHAFT_TILT = 0.12;
const SAIL = 8.4;
/** Where the snapped sail broke (from the hub). */
const SNAP = 2.7;

interface Box {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  s: THREE.Vector3;
  tone: number;
  kind: number;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** A box `w` wide and `d` deep from a to b; its width runs along `side` (squared to the length). */
function beam(out: Box[], a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, side: THREE.Vector3, tone: number, kind = WOOD): void {
  const len = a.distanceTo(b);
  if (len < 1e-4) return;
  const ay = b.clone().sub(a).normalize();
  const ax = side.clone().sub(ay.clone().multiplyScalar(side.dot(ay))).normalize();
  const az = ax.clone().cross(ay);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az));
  out.push({ p: a.clone().add(b).multiplyScalar(0.5), q, s: new THREE.Vector3(w, len, d), tone, kind });
}

function box(out: Box[], p: V3, s: V3, euler: V3, tone: number, kind = WOOD): void {
  out.push({ p: new THREE.Vector3(...p), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2], 'YXZ')), s: new THREE.Vector3(...s), tone, kind });
}

/** The tower, its foot, the cap and the windshaft (frame: y up from the foot, +z the front, +x screen right). */
function buildTower(rnd: () => number, lamp: boolean, knoll: number): { boxes: Box[]; window: THREE.Vector3; winNormal: THREE.Vector3 } {
  const out: Box[] = [];
  // A rocky mound under the foot: tiers of slabs leaning out, wider down.
  const tiers = knoll > 0 ? Math.max(1, Math.round(knoll / 2.5)) : 0;
  for (let j = 0; j < tiers; j++) {
    const th = knoll / tiers;
    const r = A0 + 0.2 + (j + 0.5) * th * 0.75;
    const n = 9 + j * 2;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5 * (j % 2) + 0.3 * rnd()) * 2 * Math.PI) / n;
      box(out, [Math.sin(a) * r, -(j + 0.5) * th + 0.2, Math.cos(a) * r], [2 * r * Math.tan(Math.PI / n) * 1.35, th * 1.35, 2.2 + j * 0.8], [0.25 + 0.2 * rnd(), a, (rnd() - 0.5) * 0.3], 0.55 + 0.35 * rnd(), STONE);
    }
  }
  const tone = () => 0.75 + 0.5 * rnd();
  const apo = (y: number) => A0 + ((A1 - A0) * y) / H;
  const taper = Math.atan((A0 - A1) / H);
  const half = Math.tan(Math.PI / SIDES);
  // Holes: the door (front face, foot), the lit window (front right face), and two torn patches.
  const holes: { face: number; y0: number; y1: number; u0: number; u1: number }[] = [
    { face: 0, y0: 0.5, y1: 2.6, u0: -0.24, u1: 0.18 },
    { face: 1, y0: 5.2, y1: 6.3, u0: -0.14, u1: 0.14 },
    { face: 7, y0: 6.9, y1: 8.6, u0: -0.5, u1: 0.05 },
    { face: 2, y0: 2.6, y1: 4.0, u0: 0.0, u1: 0.5 },
    { face: 6, y0: 8.7, y1: 10, u0: -0.1, u1: 0.5 },
  ];
  const rows = Math.round((H - 0.9) / BOARD);
  for (let f = 0; f < SIDES; f++) {
    const a = (f * 2 * Math.PI) / SIDES;
    for (let r = 0; r < rows; r++) {
      const y = 0.9 + (r + 0.5) * BOARD;
      // Each board, less the holes it crosses (their edges ragged, a board's length apart).
      let pieces: [number, number][] = [[-0.5, 0.5]];
      for (const h of holes) {
        if (h.face !== f || y < h.y0 || y > h.y1) continue;
        const j = (rnd() - 0.5) * 0.12;
        const c0 = h.u0 + (h.u0 > -0.5 ? j : 0);
        const c1 = h.u1 + (h.u1 < 0.5 ? j : 0);
        pieces = pieces.flatMap(([p0, p1]): [number, number][] => [
          ...(c0 > p0 ? [[p0, Math.min(p1, c0)] as [number, number]] : []),
          ...(c1 < p1 ? [[Math.max(p0, c1), p1] as [number, number]] : []),
        ]);
      }
      // A few boards gone, a few broken short.
      if (rnd() < 0.07 && r > 2) continue;
      if (rnd() < 0.1) pieces = pieces.map(([p0, p1]) => (rnd() < 0.5 ? [p0 + (p1 - p0) * rnd() * 0.5, p1] : [p0, p1 - (p1 - p0) * rnd() * 0.5]));
      const ap = apo(y);
      const w = 2 * ap * half + 0.08;
      for (const [p0, p1] of pieces) {
        if (p1 - p0 < 0.04) continue;
        const u = ((p0 + p1) / 2) * w;
        // Weatherboards lap: each sits a little proud at its foot.
        const out_ = ap + 0.05;
        const p: V3 = [Math.sin(a) * out_ + Math.cos(a) * u, y, Math.cos(a) * out_ - Math.sin(a) * u];
        box(out, p, [(p1 - p0) * w, BOARD * 1.08, 0.08], [-taper - 0.06, a, 0], tone());
      }
    }
  }
  // Corner posts, two snapped off short of the curb and two standing proud of it.
  for (let c = 0; c < SIDES; c++) {
    const a = ((c + 0.5) * 2 * Math.PI) / SIDES;
    const k = 1 / Math.cos(Math.PI / SIDES);
    const top = c === 3 ? H - 1.4 : c === 5 ? H + 0.7 : c === 6 ? H + 0.4 : H;
    const at = (y: number) => new THREE.Vector3(Math.sin(a) * (apo(y) * k + 0.06), y, Math.cos(a) * (apo(y) * k + 0.06));
    beam(out, at(0.8), at(top), 0.3, 0.3, new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), tone());
  }
  // The curb ring under the cap, one span broken and hanging.
  for (let c = 0; c < SIDES; c++) {
    const k = 1 / Math.cos(Math.PI / SIDES);
    const a0 = ((c + 0.5) * 2 * Math.PI) / SIDES;
    const a1 = ((c + 1.5) * 2 * Math.PI) / SIDES;
    const r = A1 * k + 0.15;
    const p0 = new THREE.Vector3(Math.sin(a0) * r, H + 0.1, Math.cos(a0) * r);
    const p1 = new THREE.Vector3(Math.sin(a1) * r, H + 0.1, Math.cos(a1) * r);
    if (c === 2) p1.lerp(p0, 0.45).y -= 1.1;
    beam(out, p0, p1, 0.25, 0.25, Y, tone());
  }
  // A stone foot.
  for (let f = 0; f < SIDES; f++) {
    const a = (f * 2 * Math.PI) / SIDES;
    box(out, [Math.sin(a) * (A0 + 0.12), 0.4, Math.cos(a) * (A0 + 0.12)], [2 * (A0 + 0.2) * half + 0.15, 1.3, 0.5], [0, a, 0], 0.8 + 0.4 * rnd(), STONE);
  }
  // The dark inside behind the door; the window's lit pane and its cross of mullions.
  const doorA = 0;
  box(out, [0, 1.6, A0 - 0.35], [1.6, 2.2, 0.05], [0, doorA, 0], 1, DARK);
  // The door itself, hanging off one hinge.
  box(out, [0.55, 1.35, A0 + 0.45], [0.9, 1.9, 0.07], [0.05, 0.7, 0.12], 0.9);
  const wa = (2 * Math.PI) / SIDES;
  const wy = 5.75;
  const wr = apo(wy) - 0.12;
  const win = new THREE.Vector3(Math.sin(wa) * wr, wy, Math.cos(wa) * wr);
  const winNormal = new THREE.Vector3(Math.sin(wa), 0, Math.cos(wa));
  box(out, [win.x, win.y, win.z], [0.9, 1.2, 0.05], [-taper, wa, 0], 1, lamp ? LAMP : DARK);
  const mr = apo(wy) + 0.06;
  box(out, [Math.sin(wa) * mr, wy, Math.cos(wa) * mr], [0.07, 1.05, 0.06], [-taper, wa, 0], 0.7);
  box(out, [Math.sin(wa) * mr, wy + 0.1, Math.cos(wa) * mr], [0.75, 0.07, 0.06], [-taper, wa, 0], 0.7);
  // The cap: a gable of planks running back from the front, a few gone, its ridge beam, the gable end.
  const capY = H + 0.3;
  const pitch = 0.82;
  const run = 2.75;
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 15; i++) {
      const z = -2.3 + i * 0.34;
      if ((sd === 1 && (i === 4 || i === 9)) || (sd === -1 && i === 12)) continue;
      const len = run * (i === 6 && sd === -1 ? 0.55 : 1) + 0.25;
      const cx = sd * (len / 2) * Math.cos(pitch);
      const cy = capY + run * Math.sin(pitch) - (len / 2) * Math.sin(pitch);
      box(out, [cx * 0.98, cy, z], [len, 0.07, 0.32], [0, 0, -sd * pitch], tone());
    }
    // Eaves beams.
    beam(out, new THREE.Vector3(sd * run * Math.cos(pitch), capY, -2.4), new THREE.Vector3(sd * run * Math.cos(pitch), capY, 2.6), 0.22, 0.22, X, tone());
  }
  beam(out, new THREE.Vector3(0, capY + run * Math.sin(pitch) + 0.05, -2.5), new THREE.Vector3(0, capY + run * Math.sin(pitch) + 0.05, 2.7), 0.2, 0.2, X, tone());
  // The front gable: boards across, shorter toward the ridge, one hanging loose.
  for (let i = 0; i < 7; i++) {
    const y = capY + 0.18 + i * 0.33;
    const w = ((2 * (run * Math.sin(pitch) - (y - capY))) / Math.tan(pitch)) * 0.95;
    if (w < 0.2 || i === 4) continue;
    box(out, [i === 2 ? 0.45 : 0, y, 2.55], [i === 2 ? w * 0.5 : w, 0.3, 0.07], [0, 0, i === 2 ? 0.35 : 0], tone());
  }
  // The windshaft out of the gable to the hub (inclined, as a mill's is), and the hub's canister.
  const hub = new THREE.Vector3(...HUB);
  const back = hub.clone().add(new THREE.Vector3(0, -Math.sin(SHAFT_TILT), -Math.cos(SHAFT_TILT)).multiplyScalar(3.4));
  beam(out, back, hub, 0.42, 0.42, X, 0.9);
  // A tail pole down the back to the ground, as a post mill's, splintered off at its foot.
  beam(out, new THREE.Vector3(0, capY + 0.2, -2.2), new THREE.Vector3(0.2, 1.6, -6.4), 0.3, 0.3, X, tone());
  // Fallen boards round the foot.
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const r = A0 + 0.8 + rnd() * 2.2;
    box(out, [Math.sin(a) * r, 0.1 + rnd() * 0.25, Math.cos(a) * r], [0.35, 0.07, 1.4 + rnd() * 1.6], [rnd() * 0.5 - 0.25, rnd() * Math.PI, rnd() * 0.3], tone());
  }
  return { boxes: out, window: win, winNormal };
}

/**
 * One sail's lattice along +y from `r0` to `r1` (its stock on the axis, sail bars across to the
 * trailing side +x and a narrow leading side -x, hemlaths along both edges, rags of cloth): `missing`
 * bar indices, `tatters` cells with cloth.
 */
function lattice(out: Box[], rnd: () => number, r0: number, r1: number, o: { missing?: number[]; tatters?: number; stock?: boolean; bars0?: number; hemOut?: number }): void {
  const tone = () => 0.75 + 0.5 * rnd();
  const W1 = 1.7;
  const W0 = -0.45;
  const F = 0.18; // the lattice sits in front of the stock
  const GAP = 0.5;
  if (o.stock !== false) beam(out, new THREE.Vector3(0, r0, 0), new THREE.Vector3(0, r1, 0), 0.36, 0.34, X, tone());
  const b0 = o.bars0 ?? 1.5;
  const n = Math.floor((r1 - Math.max(b0, r0)) / GAP);
  for (let i = 0; i <= n; i++) {
    if (o.missing?.includes(i)) continue;
    const y = Math.max(b0, r0) + i * GAP;
    // Some bars snapped short.
    const w1 = rnd() < 0.12 ? W1 * (0.3 + 0.5 * rnd()) : W1;
    const a = new THREE.Vector3(W0, y, F);
    const b = new THREE.Vector3(w1, y + (rnd() - 0.5) * 0.05, F);
    beam(out, a, b, 0.13, 0.1, Y, tone());
  }
  const top = Math.max(b0, r0) + n * GAP;
  const hemEnd = Math.min(r1, top) - (o.hemOut ?? 0);
  beam(out, new THREE.Vector3(W1, Math.max(b0, r0), F + 0.02), new THREE.Vector3(W1, hemEnd, F + 0.02), 0.15, 0.12, X, tone());
  beam(out, new THREE.Vector3(W0, Math.max(b0, r0), F + 0.02), new THREE.Vector3(W0, top, F + 0.02), 0.12, 0.1, X, tone());
  // Rags of sailcloth hung across a few cells, torn ragged (strips of uneven length).
  for (let k = 0; k < (o.tatters ?? 0); k++) {
    const i = Math.floor(rnd() * Math.max(1, n));
    const y = Math.max(b0, r0) + i * GAP + GAP;
    const strips = 3 + Math.floor(rnd() * 3);
    for (let s = 0; s < strips; s++) {
      const x0 = 0.05 + (s / strips) * (W1 - 0.1);
      const len = 0.35 + rnd() * 1.3;
      box(out, [x0 + (W1 - 0.1) / strips / 2, y - len / 2, F - 0.05], [(W1 - 0.1) / strips - 0.03, len, 0.02], [0, 0, (rnd() - 0.5) * 0.12], 0.8 + 0.4 * rnd(), CLOTH);
    }
  }
}

/** Rotate a sail built along +y to angle `a` round the hub (z). */
function turn(boxes: Box[], a: number): Box[] {
  const q = new THREE.Quaternion().setFromAxisAngle(Z, a);
  return boxes.map((b) => ({ ...b, p: b.p.clone().applyQuaternion(q), q: q.clone().multiply(b.q) }));
}

/** The sails, ring and spokes (hub frame: z along the shaft toward the front). */
function buildSails(rnd: () => number, ring: boolean): Box[] {
  const out: Box[] = [];
  const arm = (a: number, f: (o: Box[]) => void) => {
    const o: Box[] = [];
    f(o);
    out.push(...turn(o, a));
  };
  // Up-left: whole but for a few bars, rags.
  arm(0.5, (o) => lattice(o, rnd, -0.2, SAIL, { missing: [3, 9], tatters: 5 }));
  // Down-left: its tip torn away, the hemlath broken short.
  arm(0.5 + Math.PI / 2, (o) => {
    lattice(o, rnd, -0.2, SAIL * 0.72, { missing: [2, 5, 6], tatters: 3, hemOut: 1.3 });
    // A splinter of stock past the break.
    beam(o, new THREE.Vector3(0, SAIL * 0.72, 0), new THREE.Vector3(0.12, SAIL * 0.8, 0.05), 0.18, 0.2, X, 0.9);
  });
  // Down-right: snapped at SNAP (its outer part hangs, see buildHanging); a stump of splinters.
  arm(0.5 + Math.PI, (o) => {
    lattice(o, rnd, -0.2, SNAP, { tatters: 0 });
    beam(o, new THREE.Vector3(0, SNAP, 0), new THREE.Vector3(-0.1, SNAP + 0.45, 0.04), 0.14, 0.16, X, 0.9);
  });
  // Up-right: most of its bars gone, the bare stock at the tip, rags.
  arm(0.5 + (3 * Math.PI) / 2, (o) => lattice(o, rnd, -0.2, SAIL * 0.95, { missing: [1, 4, 7, 8, 10, 11], tatters: 3 }));
  // The hub's canister.
  box(out, [0, 0, 0.1], [0.85, 0.85, 0.9], [0, 0, 0.5], 0.9);
  if (ring) {
    // A wheel of two rings on the stocks and four spokes between them (the original's great wheel),
    // a few spans of it broken out.
    const spans = 20;
    for (const [r, gone] of [
      [2.75, [6, 7, 13]],
      [4.6, [3, 8, 9, 10, 15, 16]],
    ] as [number, number[]][]) {
      for (let i = 0; i < spans; i++) {
        if (gone.includes(i)) continue;
        const a0 = (i / spans) * Math.PI * 2;
        const a1 = ((i + 1) / spans) * Math.PI * 2;
        const p0 = new THREE.Vector3(Math.cos(a0) * r, Math.sin(a0) * r, 0.3);
        const p1 = new THREE.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, 0.3);
        beam(out, p0, p1, 0.16, 0.26, Z, 0.75 + 0.5 * rnd());
      }
    }
    for (let k = 0; k < 4; k++) {
      const a = 0.5 + Math.PI / 4 + (k * Math.PI) / 2;
      const len = k === 1 ? 3.6 : 4.75;
      beam(out, new THREE.Vector3(0, 0, 0.25), new THREE.Vector3(Math.cos(a) * len, Math.sin(a) * len, 0.3), 0.16, 0.18, Z, 0.75 + 0.5 * rnd());
    }
  }
  return out;
}

/** The snapped sail's outer part, hanging from its break (frame: the break at the origin, hanging down -y). */
function buildHanging(rnd: () => number): Box[] {
  const o: Box[] = [];
  lattice(o, rnd, 0, SAIL - SNAP, { missing: [0, 6], tatters: 3, bars0: 0.3 });
  // Hanging: the break up top, the tip down.
  return turn(o, Math.PI);
}

/** The cloud break behind it: soft drifting fbm billows on a lens-facing card, added to the sky. */
const CLOUD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CLOUD_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uK, uTime, uSeed;
  ${NOISE}
  varying vec2 vUv;
  void main(){
    vec2 p = vUv;
    float r = length(p * vec2(0.85, 1.15));
    vec3 q = vec3(p * 2.2 + vec2(uTime * 0.035, uTime * 0.01), uSeed + uTime * 0.03);
    float n = fbm(q + vec3(fbm(q * 0.8 + 7.), fbm(q * 0.8 + 13.), 0.) * 0.9);
    // Billows lit from above, darker bellies below; the edge torn by the noise.
    float b = smoothstep(0.38, 0.7, n) * (0.5 + 0.5 * smoothstep(-0.6, 0.6, p.y + (n - 0.5)));
    float fall = 1. - smoothstep(0.2, 0.95, r + (n - 0.5) * 0.6);
    gl_FragColor = vec4(uColor * uK * (0.15 + b) * fall * 0.6, 1.);
  }`;

const VERT = /* glsl */ `
  attribute vec2 aTone;
  uniform float uFogMode, uFogA, uFogB;
  varying vec3 vWorld; varying vec3 vN; varying vec2 vTone; varying float vFog; varying vec3 vObj;
  float fogAmount(float d){
    if (uFogMode < 0.5) return 0.;
    if (uFogMode < 1.5) return 1. - exp(-uFogA * uFogA * d * d);
    return smoothstep(uFogA, uFogB, d);
  }
  void main(){
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vTone = aTone;
    vObj = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec4 mv = viewMatrix * w;
    gl_Position = projectionMatrix * mv;
    vFog = fogAmount(-mv.z);
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uWood, uCloth, uStone, uKey, uKeyDir, uAmb, uRim, uSky, uLamp, uFogColor, uAxis, uHaze;
  uniform float uFlick, uInside, uHazeK;
  ${NOISE}
  varying vec3 vWorld; varying vec3 vN; varying vec2 vTone; varying float vFog; varying vec3 vObj;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vWorld);
    if (dot(N, V) < 0.) N = -N;
    float kind = vTone.y;
    if (kind > 2.5 && kind < 3.5) {
      // The lit window: warm, brightest low in the pane, a slow candle flicker.
      vec3 c = uLamp * (0.75 + 0.25 * smoothstep(0.6, -0.6, vObj.y)) * uFlick;
      float hz = 1. - exp(-uHazeK * distance(cameraPosition, vWorld));
      gl_FragColor = vec4(mix(mix(c, uHaze, hz * 0.5), uFogColor, vFog * 0.6), 1.);
      return;
    }
    vec3 base = kind < 0.5 ? uWood : kind < 1.5 ? uCloth : kind < 2.5 ? vec3(0.004) : uStone;
    // Grain along the board, weathered patches.
    float g = 0.75 + 0.5 * vnoise(vObj * vec3(1.5, 1.5, 9.) + vWorld * 0.7) * (0.6 + 0.8 * vnoise(vWorld * 0.35));
    base *= vTone.x * g;
    // The inside of the tower (faces turned toward its axis) stays dark.
    vec2 toAxis = uAxis.xz - vWorld.xz;
    float inside = uInside * smoothstep(0.1, 0.5, dot(normalize(N.xz + 1e-5), normalize(toAxis + 1e-5))) * step(length(toAxis), 3.4 * uAxis.y) * step(abs(N.y), 0.8);
    vec3 col = base * (uAmb + uKey * max(0., dot(N, uKeyDir))) * (1. - 0.75 * inside);
    // The sky behind: edges turned from the lens catch a faint rim, strongest on the sky's side and on top.
    float edge = pow(1. - max(dot(N, V), 0.), 1.6);
    float side = 0.35 + 0.65 * clamp(dot(N, uSky) * 0.7 + 0.5 + 0.3 * N.y, 0., 1.);
    col += uRim * edge * side * (0.6 + 0.4 * g) * (1. - inside);
    // The air between: far wood greys into the sky's colour.
    col = mix(col, uHaze, 1. - exp(-uHazeK * distance(cameraPosition, vWorld)));
    gl_FragColor = vec4(mix(col, uFogColor, vFog), 1.);
  }`;

/** [x, z, lift] at t on a Catmull-Rom curve through [t, x, z, lift] keys (held past the ends). */
function pathAt(p: number[][], t: number): number[] {
  const last = p.length - 1;
  if (t <= p[0][0] || !last) return p[0].slice(1);
  if (t >= p[last][0]) return p[last].slice(1);
  let i = 0;
  while (t > p[i + 1][0]) i++;
  const [a, b, c, d] = [p[Math.max(0, i - 1)], p[i], p[i + 1], p[Math.min(last, i + 2)]];
  const dt = c[0] - b[0];
  const k = (t - b[0]) / dt;
  const h00 = 2 * k ** 3 - 3 * k * k + 1;
  const h10 = k ** 3 - 2 * k * k + k;
  const h01 = -2 * k ** 3 + 3 * k * k;
  const h11 = k ** 3 - k * k;
  return [1, 2, 3].map((j) => {
    const m0 = ((c[j] - a[j]) / Math.max(1e-6, c[0] - a[0])) * dt;
    const m1 = ((d[j] - b[j]) / Math.max(1e-6, d[0] - b[0])) * dt;
    return h00 * b[j] + h10 * m0 + h01 * c[j] + h11 * m1;
  });
}

function instanced(boxes: Box[], mat: THREE.ShaderMaterial): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const tone = new Float32Array(boxes.length * 2);
  boxes.forEach((b, i) => {
    tone[i * 2] = b.tone;
    tone[i * 2 + 1] = b.kind;
  });
  geo.setAttribute('aTone', new THREE.InstancedBufferAttribute(tone, 2));
  const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
  const m = new THREE.Matrix4();
  boxes.forEach((b, i) => mesh.setMatrixAt(i, m.compose(b.p, b.q, b.s)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

class Windmill implements Effect {
  private root = new THREE.Group();
  private sails = new THREE.Group();
  private hanging = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private sailMat: THREE.ShaderMaterial;
  private halo: THREE.Sprite;
  private cloud: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private winLocal: THREE.Vector3;
  private winNormal: THREE.Vector3;
  private hubLocal = new THREE.Vector3(...HUB);
  private v = new THREE.Vector3();
  private path: number[][] | null;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    private ground: (x: number, z: number) => number,
  ) {
    const rnd = mulberry(num(cue.seed, 19));
    const lampK = num(cue.lampK, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uWood: { value: new THREE.Color(String(cue.wood ?? '#2b231b')) },
        uCloth: { value: new THREE.Color(String(cue.cloth ?? '#3a3a2e')) },
        uStone: { value: new THREE.Color(String(cue.stone ?? '#2a2a26')) },
        uKey: { value: hdr(cue.key ?? '#8a9ab8', num(cue.keyK, 0.35)) },
        uKeyDir: { value: new THREE.Vector3(0.2, 0.8, 0.55).normalize() },
        uAmb: { value: hdr(cue.amb ?? '#26301f', num(cue.ambK, 0.45)) },
        uRim: { value: hdr(cue.rim ?? '#9dff5a', num(cue.rimK, 0.45)) },
        uHaze: { value: new THREE.Color(String(cue.haze ?? '#1e2e16')) },
        uHazeK: { value: num(cue.hazeK, 0.018) },
        uSky: { value: new THREE.Vector3(0, 0.5, -1).normalize() },
        uLamp: { value: hdr(cue.lamp ?? '#ffb44a', 3.2 * lampK) },
        uFlick: { value: 1 },
        uAxis: { value: new THREE.Vector3() },
        uInside: { value: 1 },
        ...fogUniforms(),
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    // The sails share it but for the tower's dark inside.
    this.sailMat = this.mat.clone();
    this.sailMat.uniforms.uInside.value = 0;
    const tower = buildTower(rnd, lampK > 0, num(cue.knoll, 0));
    this.winLocal = tower.window;
    this.winNormal = tower.winNormal;
    this.root.add(instanced(tower.boxes, this.mat));
    this.sails.add(instanced(buildSails(rnd, cue.ring !== false), this.sailMat));
    this.hanging.add(instanced(buildHanging(rnd), this.sailMat));
    this.sails.position.copy(this.hubLocal);
    this.root.add(this.sails, this.hanging);
    // The window's warm halo in the haze.
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: hdr(cue.lamp ?? '#ffb44a', 0.9 * lampK), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    );
    this.halo.visible = lampK > 0;
    this.root.add(this.halo);
    this.halo.position.copy(this.winLocal).addScaledVector(this.winNormal, 0.5);
    this.halo.scale.setScalar(2.4);
    this.root.visible = false;
    scene.add(this.root);
    const cl = (cue.cloud ?? {}) as Record<string, unknown>;
    if (num(cl.k, 1) > 0) {
      this.cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(String(cl.color ?? '#9fbf80')) }, uK: { value: num(cl.k, 1) }, uTime: { value: 0 }, uSeed: { value: num(cue.seed, 19) * 1.7 } },
          vertexShader: CLOUD_VERT,
          fragmentShader: CLOUD_FRAG,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          fog: false,
        }),
      );
      this.cloud.frustumCulled = false;
      this.cloud.visible = false;
      scene.add(this.cloud);
    }
    this.path = Array.isArray(cue.path) && cue.path.length ? (cue.path as number[][]).map((k) => [k[0], k[1], k[2], k[3] ?? 0]) : null;
  }

  /** Where it stands at t (ground point). */
  private spot(ctx: FxContext, t: number): THREE.Vector3 {
    const p = this.path;
    if (p) {
      const [x, z, lift] = pathAt(p, t);
      return new THREE.Vector3(x, this.ground(x, z) + lift, z);
    }
    const at = this.cue.at;
    if (Array.isArray(at) && at.length === 2) return new THREE.Vector3(at[0], this.ground(at[0], at[1]), at[1]);
    return ctx.point(at).clone();
  }

  update(ctx: FxContext): void {
    const t = ctx.t;
    const on = envelope(this.cue, t) > 0;
    this.root.visible = on;
    if (this.cloud) this.cloud.visible = false;
    if (!on) return;
    const cue = this.cue;
    const scale = num(cue.scale, 1);
    const at = this.spot(ctx, t);
    at.y -= num(cue.sink, 0.3) * scale;
    // Heading: toward `face`, plus yaw.
    let yaw = num(cue.yaw, 0);
    if (cue.face !== undefined) {
      const f = Array.isArray(cue.face) && cue.face.length === 2 ? new THREE.Vector3(cue.face[0], 0, cue.face[1]) : ctx.point(cue.face);
      yaw += Math.atan2(f.x - at.x, f.z - at.z);
    }
    const lean = (Array.isArray(cue.lean) ? cue.lean : [0.035, -0.02]) as [number, number];
    this.root.position.copy(at);
    this.root.rotation.set(lean[1], yaw, lean[0], 'YXZ');
    this.root.scale.setScalar(scale);
    // The sails: a slow turn and a creaking rock (stick and slip), pure functions of t.
    const sway = num(cue.sway, 0.035);
    const per = num(cue.swayT, 5.5);
    const ph = (t / per) * Math.PI * 2;
    const rock = sway * (Math.sin(ph) + 0.35 * Math.sin(ph * 2.3 + 1.1) + 0.25 * Math.sign(Math.sin(ph * 0.5)) * Math.pow(Math.abs(Math.sin(ph * 0.5)), 6));
    const ang = num(cue.phase, 0) + num(cue.spin, 0) * t + rock;
    this.sails.rotation.set(-SHAFT_TILT, 0, ang);
    // The snapped sail hangs from its break, swinging a little, turned a touch out of the sail plane.
    const ba = 0.5 + Math.PI + ang;
    const brk = this.v.set(-Math.sin(ba) * SNAP, Math.cos(ba) * SNAP, 0.1).applyEuler(this.sails.rotation).add(this.hubLocal);
    this.hanging.position.copy(brk);
    const swing = 0.16 + 0.09 * Math.sin(t * 0.9 + 0.7) + rock * 1.5;
    this.hanging.rotation.set(0.12, 0.35, swing, 'YXZ');
    // Uniforms: fog, the sky's side, the window's flicker, the tower's axis (for its dark inside).
    const sky = cue.sky !== undefined ? ctx.point(cue.sky).clone().sub(at) : at.clone().sub(ctx.camera.position).setY(0).normalize().setY(0.6);
    const fl = 0.85 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 2.0) + 0.04 * Math.sin(t * 23.7);
    for (const m of [this.mat, this.sailMat]) {
      syncFog(m.uniforms, ctx.scene, num(cue.fogK, 1));
      (m.uniforms.uSky.value as THREE.Vector3).copy(sky).normalize();
      (m.uniforms.uAxis.value as THREE.Vector3).set(at.x, scale, at.z);
      m.uniforms.uFlick.value = fl;
    }
    this.halo.material.opacity = 0.55 * fl;
    if (this.cloud) {
      // Behind the hub, away from the lens, facing it.
      const cl = (cue.cloud ?? {}) as Record<string, unknown>;
      const hub = this.root.localToWorld(this.v.copy(this.hubLocal));
      const away = hub.clone().sub(ctx.camera.position).normalize();
      this.cloud.position.copy(hub).addScaledVector(away, num(cl.back, 30) * scale);
      this.cloud.quaternion.copy(ctx.camera.quaternion);
      const size = num(cl.size, 2.6) * SAIL * scale * (1 + num(cl.back, 30) * scale / Math.max(1, hub.distanceTo(ctx.camera.position)));
      this.cloud.scale.set(size * 1.4, size, 1);
      this.cloud.material.uniforms.uTime.value = t;
      this.cloud.visible = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.mat.dispose();
    this.sailMat.dispose();
    this.cloud?.removeFromParent();
    this.cloud?.geometry.dispose();
    this.cloud?.material.dispose();
    this.halo.material.dispose();
  }
}

registerEffect('night-windmill', (cue, scene, ground) => new Windmill(cue, scene, ground));
