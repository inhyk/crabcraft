// night-rags: the undead dressed as a corpse for the close-ups, on this actor's clone only (the shared
// crab materials are cloned, nothing shared is changed, everything goes back on dispose):
//   decay   the shell and leg plating weathered: the paint mottled and faded, rust blooms with streaks
//           running down from them, chipped paint to grey primer on the edges, fine scratches, dirt in
//           the crevices and on the undersides, a matte finish with a little relief
//   rags    tattered strips of dark filthy cloth hanging from the shell's rim and bandages wound round
//           a leg or two with a loose tail, ragged edges, holes and a frayed hem; the strips hang on
//           world-down from the rig, swing round the legs and the body, and sway
//   visor   fine cracks over the LED face glass from a blow at one corner (the eyes stay clear)
//   hood    the navy hood re-dyed a weathered grey-green with a faint cool rim, to read on dark trees
//   actor   the actor id
//   decay   { rust, chips, scratches, dirt } gains (1 each), or false
//   cloth   cloth colour (#211d14) and color2 its darker stains (#0a0906); linen the bandages' (#4a4333)
//   sway    the strips' idle swing in radians (0.14); kicks [[t, amp]...] swings from t dying away
//   visor   crack opacity (0.6), or false
//   hood    { color (#3a4237), rim (#9ec4d8), rimK (0.3) }, or false
//   until   the plain crab again after this (default never)
// A pure function of the shot clock and the rig's pose: each frame the strips are laid out again from
// their roots under gravity, out of the body and the legs. A seek renders any still faithfully.
import * as THREE from 'three';
import { mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type PartClass = 'shell' | 'dark' | 'visor' | 'metal' | 'joint' | 'rubber';
interface Rig {
  root: THREE.Object3D;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  gearMeshes: THREE.Object3D[];
  face: { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  parts: Map<PartClass, THREE.SkinnedMesh>;
  lodMeshes: Map<PartClass, THREE.SkinnedMesh>;
}
type Unit = { name: string; hidden?: boolean; rig: Rig };

// ------------------------------------------------------------------------------ decay

/**
 * Per vertex: how concave the surface is round it (+ in grooves, - on edges), from the welded mesh's
 * normals against its edges, smoothed twice. Cached per geometry (the template's are shared).
 */
const cavities = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();
function cavity(g: THREE.BufferGeometry): THREE.BufferAttribute {
  const hit = cavities.get(g);
  if (hit) return hit;
  const P = g.attributes.position;
  const n = P.count;
  const ids = new Map<string, number>();
  const weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P.getX(i) * 2e4)},${Math.round(P.getY(i) * 2e4)},${Math.round(P.getZ(i) * 2e4)}`;
    let w = ids.get(k);
    if (w === undefined) ids.set(k, (w = ids.size));
    weld[i] = w;
  }
  const m = ids.size;
  const wp = new Float32Array(m * 3);
  const wn = new Float32Array(m * 3);
  for (let i = 0; i < n; i++) wp.set([P.getX(i), P.getY(i), P.getZ(i)], weld[i] * 3);
  const idx = g.index;
  const tris = idx ? idx.count / 3 : n / 3;
  const at = (t: number, k: number) => weld[idx ? idx.getX(t * 3 + k) : t * 3 + k];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    const [i0, i1, i2] = [at(t, 0), at(t, 1), at(t, 2)];
    a.fromArray(wp, i0 * 3);
    b.fromArray(wp, i1 * 3).sub(a);
    c.fromArray(wp, i2 * 3).sub(a);
    b.cross(c);
    for (const i of [i0, i1, i2]) for (let k = 0; k < 3; k++) wn[i * 3 + k] += b.getComponent(k);
  }
  for (let i = 0; i < m; i++) {
    const l = Math.hypot(wn[i * 3], wn[i * 3 + 1], wn[i * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) wn[i * 3 + k] /= l;
  }
  let val = new Float32Array(m);
  const cnt = new Float32Array(m);
  const edge = (fn: (i: number, j: number) => void) => {
    for (let t = 0; t < tris; t++) {
      const v = [at(t, 0), at(t, 1), at(t, 2)];
      for (let k = 0; k < 3; k++) fn(v[k], v[(k + 1) % 3]);
    }
  };
  edge((i, j) => {
    const dx = wp[j * 3] - wp[i * 3];
    const dy = wp[j * 3 + 1] - wp[i * 3 + 1];
    const dz = wp[j * 3 + 2] - wp[i * 3 + 2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-7) return;
    val[i] += (wn[i * 3] * dx + wn[i * 3 + 1] * dy + wn[i * 3 + 2] * dz) / l;
    val[j] -= (wn[j * 3] * dx + wn[j * 3 + 1] * dy + wn[j * 3 + 2] * dz) / l;
    cnt[i]++;
    cnt[j]++;
  });
  for (let i = 0; i < m; i++) val[i] /= Math.max(1, cnt[i]);
  for (let it = 0; it < 2; it++) {
    const acc = new Float32Array(m);
    edge((i, j) => {
      acc[i] += val[j];
      acc[j] += val[i];
    });
    const next = new Float32Array(m);
    for (let i = 0; i < m; i++) next[i] = 0.5 * val[i] + (0.5 * acc[i]) / Math.max(1, cnt[i]);
    val = next;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, val[weld[i]]));
  const attr = new THREE.BufferAttribute(out, 1);
  cavities.set(g, attr);
  return attr;
}

/** The same geometry (attributes shared, nothing copied) with the cavity attribute added. */
function withCavity(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const o = new THREE.BufferGeometry();
  for (const [k, v] of Object.entries(g.attributes)) o.setAttribute(k, v);
  o.setIndex(g.index);
  for (const gr of g.groups) o.addGroup(gr.start, gr.count, gr.materialIndex);
  o.boundingSphere = g.boundingSphere;
  o.boundingBox = g.boundingBox;
  o.setAttribute('cavity', cavity(g));
  return o;
}

const DECAY_VERT = /* glsl */ `
  attribute float cavity;
  varying vec3 vBind;
  varying vec3 vBindN;
  varying float vCav;
`;
const DECAY_FRAG = /* glsl */ `
  uniform float uRust, uChip, uScratch, uDirt, uFade, uBump, uMetal;
  uniform vec3 uRustA, uRustB, uBare, uGrime;
  varying vec3 vBind;
  varying vec3 vBindN;
  varying float vCav;
  ${NOISE}
  vec3 decayBump(vec3 p, vec3 n, vec2 dH, float face) {
    vec3 sx = dFdx(p), sy = dFdy(p);
    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
    float det = dot(sx, r1) * face;
    vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
    return normalize(abs(det) * n - grad);
  }
  vec2 decayPlane(vec3 q, vec3 n) {
    vec3 a = abs(n);
    return a.x > a.y && a.x > a.z ? q.yz : a.y > a.z ? q.xz : q.xy;
  }
  /** Short straight scratches, at most one from each cell (cm), running near the angle dir. */
  float scratches(vec2 p, float cell, float dir, float seed) {
    vec2 g = p / cell;
    vec2 id = floor(g);
    float px = length(fwidth(p)) + 1e-4;
    float best = 0.;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = id + vec2(i, j);
        float on = step(h31(vec3(c, seed)), 0.16);
        vec2 o = c + vec2(h31(vec3(c, seed + 1.)), h31(vec3(c, seed + 2.)));
        float a = dir + (h31(vec3(c, seed + 3.)) - 0.5) * 0.7;
        vec2 d = vec2(cos(a), sin(a));
        float L = 0.3 + 0.9 * h31(vec3(c, seed + 4.));
        vec2 r = g - o;
        float t = clamp(dot(r, d), -L, L);
        float dist = length(r - d * t) * cell;
        float w = 0.01 + 0.012 * h31(vec3(c, seed + 5.));
        float line = (1. - smoothstep(w, w + px, dist)) * min(1., (w * 2.) / px);
        best = max(best, on * line * (1. - 0.7 * abs(t) / L));
      }
    }
    return best;
  }
`;
const DECAY_COLOR = /* glsl */ `
  vec3 dq = vBind * 100.;
  vec3 dnb = normalize(vBindN);
  float dbig = fbm(dq * 0.42 + 3.7);
  float dfine = vnoise(dq * 3.1);
  // Rust: blooms, and streaks running down from them on the steep faces.
  // (more in the grooves and along the lower edges, where the wet sits)
  float dbloomN = fbm(dq * 0.5 + vec3(11.3, 2.1, 7.7)) + 0.06 * dfine + 0.14 * clamp(vCav * 4., 0., 1.) + 0.1 * smoothstep(0.1, -0.6, dnb.y);
  float dbloom = smoothstep(0.6, 0.68, dbloomN);
  float dsteep = 1. - abs(dnb.y);
  float dst = vnoise(vec3(dq.x * 2.4, dq.y * 0.16, dq.z * 2.4) + 5.);
  float dstreak = smoothstep(0.6, 0.85, dst) * smoothstep(0.5, 0.64, fbm(vec3(dq.x * 0.5, dq.y * 0.08 + 0.3, dq.z * 0.5))) * dsteep;
  float drust = clamp(max(dbloom, dstreak * 0.6) * uRust, 0., 1.);
  // Chipped paint down to a dark primer, most on the convex edges, a pale lip where the paint broke.
  float dchipN = vnoise(dq * 2.2 + 21.) * 0.6 + vnoise(dq * 6. + 2.) * 0.3 + 0.4 * clamp(-vCav * 3., 0., 1.);
  float dce = fwidth(dchipN) + 1e-3;
  float dchip = smoothstep(0.8 - dce, 0.8 + dce, dchipN) * uChip * (1. - drust);
  float dlip = (smoothstep(0.775 - dce, 0.775 + dce, dchipN) - smoothstep(0.8 - dce, 0.8 + dce, dchipN)) * uChip * (1. - drust);
  // Rust creeping out under the paint round each chip.
  float dcreep = smoothstep(0.68, 0.8, dchipN) * uChip * 0.55;
  vec2 dpl = decayPlane(dq, dnb);
  float dscr = max(scratches(dpl, 1.6, 0.4, 1.), scratches(dpl + 7.3, 2.3, 2.1, 9.)) * uScratch * (1. - drust);
  // Dirt: in the grooves, on the undersides, mottled.
  // Dark grime run down the faces in drips.
  float ddrip = smoothstep(0.55, 0.8, vnoise(vec3(dq.x * 1.7, dq.y * 0.12, dq.z * 1.7) + 31.)) * dsteep;
  float ddirt = clamp(clamp(vCav * 4., 0., 1.) + smoothstep(0.1, -0.7, dnb.y) * 0.5 + (dbig - 0.5) * 1.1 + ddrip * 0.5, 0., 1.) * uDirt;
  vec3 dc = diffuseColor.rgb;
  dc *= 0.5 + 0.55 * dbig;
  dc = mix(dc, vec3(dot(dc, vec3(0.3, 0.55, 0.15))) * vec3(1.0, 1.02, 0.86), uFade);
  dc = mix(dc, dc * 1.45 + 0.01, dlip * 0.6);
  dc = mix(dc, uRustA * 1.3, dcreep * (1. - dchip));
  dc = mix(dc, uBare * (0.7 + 0.5 * dfine), dchip);
  dc = mix(dc, mix(uRustA, uRustB, fbm(dq * 1.6 + 8.)) * (0.7 + 0.5 * dfine), drust);
  dc = mix(dc, uGrime, ddirt * 0.65);
  dc = mix(dc, dc * 1.7 + 0.015, dscr * 0.55);
  diffuseColor.rgb = dc;
  float dH = drust * (0.5 + 0.5 * fbm(dq * 1.5)) - dchip * 0.5 - dscr * 0.3;
`;

interface DecayLook {
  rust: number;
  chips: number;
  scratches: number;
  dirt: number;
  fade: number;
  rough: number;
  metal: number;
}

/** A weathered clone of one of the crab's materials. */
function decayed(src: THREE.Material, look: DecayLook, bump: { value: number }): THREE.Material {
  const m = (src as THREE.MeshStandardMaterial).clone();
  m.name = `${src.name}:rags`;
  const phys = m as THREE.MeshPhysicalMaterial;
  if (phys.isMeshPhysicalMaterial) {
    phys.clearcoat *= 0.15;
    phys.clearcoatRoughness = Math.max(phys.clearcoatRoughness, 0.55);
    // Chalky old paint: little specular, or the moonlight's broad sheen washes the green out.
    phys.specularIntensity = Math.min(phys.specularIntensity, 0.1);
  }
  m.envMapIntensity *= 0.5;
  const u = {
    uRust: { value: look.rust },
    uChip: { value: look.chips },
    uScratch: { value: look.scratches },
    uDirt: { value: look.dirt },
    uFade: { value: look.fade },
    uMetal: { value: look.metal },
    uBump: bump,
    uRustA: { value: new THREE.Color('#3a1c0c') },
    uRustB: { value: new THREE.Color('#6a3412') },
    uBare: { value: new THREE.Color('#33251a') },
    uGrime: { value: new THREE.Color('#0c0b07') },
  };
  const rough = look.rough;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${DECAY_VERT}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBind = position; vBindN = normal; vCav = cavity;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${DECAY_FRAG}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${DECAY_COLOR}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n  roughnessFactor = clamp(max(roughnessFactor, ${rough.toFixed(3)}) + 0.12 * dbig, 0., 1.);\n  roughnessFactor = mix(roughnessFactor, 0.97, drust);\n  roughnessFactor = mix(roughnessFactor, 0.5, max(dchip, dscr) * (1. - drust));`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor * (1. - drust), uMetal, max(dchip, dscr) * (1. - drust));')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = decayBump(-vViewPosition, normal, vec2(dFdx(dH), dFdy(dH)) * uBump, faceDirection);');
  };
  m.customProgramCacheKey = () => 'night-rags-decay';
  return m;
}

/** How weathered each part class gets: the moulded shell rusts and chips, the metal rusts through. */
const DECAY: Record<Exclude<PartClass, 'visor'>, DecayLook> = {
  shell: { rust: 0.85, chips: 1, scratches: 1, dirt: 1, fade: 0.1, rough: 0.58, metal: 0.55 },
  dark: { rust: 0.7, chips: 0.5, scratches: 0.8, dirt: 1, fade: 0.2, rough: 0.78, metal: 0.4 },
  metal: { rust: 1.3, chips: 0.3, scratches: 0.7, dirt: 0.9, fade: 0.1, rough: 0.8, metal: 0.6 },
  joint: { rust: 1.2, chips: 0.3, scratches: 0.5, dirt: 1, fade: 0.1, rough: 0.75, metal: 0.7 },
  rubber: { rust: 0, chips: 0, scratches: 0.4, dirt: 1.2, fade: 0.3, rough: 0.92, metal: 0 },
};

// ------------------------------------------------------------------------------ cloth

const CLOTH_VERT = /* glsl */ `
  attribute vec4 rag;
  attribute float ragSeed;
  varying vec4 vRag;
  varying float vRagSeed;
`;
const CLOTH_FRAG = /* glsl */ `
  uniform vec3 uCloth, uCloth2, uLinen;
  uniform float uHem;
  varying vec4 vRag;
  varying float vRagSeed;
  ${NOISE}
`;
// vRag: x across 0..1, y along 0..1 (0 at the root), z the width and w the length in centimetres.
const CLOTH_CUT = /* glsl */ `
  float rs = vRagSeed * 13.1;
  vec2 rcm = vRag.xy * vRag.zw;
  float redge = min(vRag.x, 1. - vRag.x) * vRag.z;
  float rn = vnoise(vec3(rcm.x * 1.3, rcm.y * 2.6, rs));
  // Ragged sides, more torn toward the hem.
  if (redge < (0.05 + 0.35 * rn * rn) * (0.3 + 1.2 * vRag.y)) discard;
  // A torn hem: tongues of different lengths, frayed into threads.
  float rjag = uHem * (0.18 + 0.55 * vnoise(vec3(rcm.x * 0.9, rs, 1.)) + 0.25 * vnoise(vec3(rcm.x * 3.1, rs, 2.)));
  float rfromEnd = (1. - vRag.y) * vRag.w;
  if (rfromEnd < rjag) {
    float rth = fract(rcm.x * 9. + 0.4 * vnoise(vec3(rcm.x * 2., rcm.y * 0.5, rs)));
    float rlen = h31(vec3(floor(rcm.x * 9.), rs, 3.));
    if (rth > 0.42 || rfromEnd < rjag * rlen * 0.9) discard;
  }
  // Holes worn through.
  if (fbm(vec3(rcm.x * 0.55, rcm.y * 0.4, rs + 5.)) > 0.66 + 0.1 * (1. - vRag.y)) discard;
`;
const CLOTH_COLOR = /* glsl */ `
  float rst = fbm(vec3(rcm * vec2(0.5, 0.3), rs + 9.));
  float rweave = 0.92 + 0.08 * sin(rcm.x * 55.) * sin(rcm.y * 55.);
  // Strips are dark wool; the bandages (seeds from 20) grimy linen.
  float rband = step(19.5, vRagSeed);
  vec3 rc = mix(mix(uCloth, uLinen, rband), mix(uCloth2, uLinen * 0.35, rband), smoothstep(0.35, 0.75, rst));
  rc *= rweave * (0.75 + 0.5 * vnoise(vec3(rcm * 3., rs)));
  // Dust gathered on the hem and the torn edges, darker where it is soaked near the root.
  rc = mix(rc, rc * 1.6 + 0.012, smoothstep(0.5, 1., vRag.y) * 0.35);
  rc *= 0.7 + 0.3 * smoothstep(0., 0.25, vRag.y);
  diffuseColor.rgb = rc;
`;

function clothMaterial(cue: FxCue): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  m.name = 'night-rags:cloth';
  const u = {
    uCloth: { value: new THREE.Color(String(cue.cloth ?? '#211d14')) },
    uCloth2: { value: new THREE.Color(String(cue.color2 ?? '#0a0906')) },
    uLinen: { value: new THREE.Color(String(cue.linen ?? '#4a4333')) },
    uHem: { value: 1 },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${CLOTH_VERT}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRag = rag; vRagSeed = ragSeed;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLOTH_FRAG}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CLOTH_CUT}\n${CLOTH_COLOR}`);
  };
  m.customProgramCacheKey = () => 'night-rags-cloth';
  return m;
}

/** A strip of cloth: a root riding one bone, hanging from there. Bind-space vectors, metres. */
interface Strip {
  bone: number;
  root: THREE.Vector3;
  across: THREE.Vector3;
  out: THREE.Vector3;
  width: number;
  length: number;
  seed: number;
  phase: number;
}

/** A capsule round one link, in bind space. */
interface Capsule {
  bone: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

const ROWS = 12;
const COLS = 5;

/** Where the shell's lower rim is in the direction `deg` (0 ahead, 90 his left), bind space. */
function rimPoint(shell: THREE.BufferGeometry, deg: number, zc: number): THREE.Vector3 {
  const P = shell.attributes.position;
  const S = shell.attributes.skinIndex;
  const a = (deg * Math.PI) / 180;
  let best = -1;
  const out = new THREE.Vector3(Math.sin(a) * 0.09, 0.03, zc + Math.cos(a) * 0.1);
  for (let i = 0; i < P.count; i++) {
    if (S.getX(i) !== 0) continue;
    const y = P.getY(i);
    if (y > 0.036) continue;
    const x = P.getX(i);
    const z = P.getZ(i) - zc;
    const d = Math.atan2(Math.sin(Math.atan2(x, z) - a), Math.cos(Math.atan2(x, z) - a));
    if (Math.abs(d) > 0.05) continue;
    const r = Math.hypot(x, z);
    if (r > best) {
      best = r;
      out.set(x, y, z + zc);
    }
  }
  return out;
}

/** Every link's vertices (all part classes) grouped by bone, bind space. */
function boneVerts(parts: Map<PartClass, THREE.SkinnedMesh>): Map<number, number[]> {
  const by = new Map<number, number[]>();
  for (const [cls, m] of parts) {
    if (cls === 'visor') continue;
    const P = m.geometry.attributes.position;
    const S = m.geometry.attributes.skinIndex;
    for (let i = 0; i < P.count; i++) {
      const b = S.getX(i);
      let l = by.get(b);
      if (!l) by.set(b, (l = []));
      l.push(P.getX(i), P.getY(i), P.getZ(i));
    }
  }
  return by;
}

/** A capsule along the longest side of a link's bounding box. */
function capsuleOf(bone: number, v: number[]): Capsule {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < v.length; i += 3) box.expandByPoint(p.set(v[i], v[i + 1], v[i + 2]));
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const ax = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const others = [0, 1, 2].filter((k) => k !== ax).map((k) => size.getComponent(k));
  const r = 0.5 * Math.max(...others) * 0.95;
  const half = Math.max(0, size.getComponent(ax) / 2 - r * 0.5);
  const d = new THREE.Vector3().setComponent(ax, half);
  return { bone, a: c.clone().sub(d), b: c.clone().add(d), r };
}

/**
 * A bandage wound round a link: a helix of a ribbon over the link's cross-section (a rounded box from
 * its vertices, station by station) from `s0` to `s1` of its length; returns the geometry in bind
 * space, and the end where the loose tail leaves.
 */
function bandage(v: number[], s0: number, s1: number, turns: number, width: number, seed: number): { geo: THREE.BufferGeometry; end: THREE.Vector3; across: THREE.Vector3; out: THREE.Vector3 } {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < v.length; i += 3) box.expandByPoint(p.set(v[i], v[i + 1], v[i + 2]));
  const size = box.getSize(new THREE.Vector3());
  const ax = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const [e1, e2] = [0, 1, 2].filter((k) => k !== ax);
  const lo = box.min.getComponent(ax);
  const len = size.getComponent(ax);
  // The cross-section's centre and half extents along the link, in stations.
  const N = 16;
  const st = Array.from({ length: N }, () => ({ min: [Infinity, Infinity], max: [-Infinity, -Infinity] }));
  for (let i = 0; i < v.length; i += 3) {
    const s = Math.min(N - 1, Math.max(0, Math.floor(((v[i + ax] - lo) / len) * N)));
    const q = [v[i + e1], v[i + e2]];
    for (let k = 0; k < 2; k++) {
      st[s].min[k] = Math.min(st[s].min[k], q[k]);
      st[s].max[k] = Math.max(st[s].max[k], q[k]);
    }
  }
  const section = (f: number) => {
    const s = Math.min(N - 1, Math.max(0, Math.floor(f * N)));
    const g = st[s].min[0] === Infinity ? st.find((x) => x.min[0] !== Infinity)! : st[s];
    return { c: [(g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2], h: [(g.max[0] - g.min[0]) / 2, (g.max[1] - g.min[1]) / 2] };
  };
  const rnd = mulberry(seed);
  const point = (f: number, th: number, lift: number, out: THREE.Vector3) => {
    const { c, h } = section(f);
    const ct = Math.cos(th);
    const sn = Math.sin(th);
    // A rounded box (superellipse, n = 5) a little outside the section.
    const k = 2 / 5;
    const x = c[0] + (h[0] * 1.12 + lift) * Math.sign(ct) * Math.abs(ct) ** k;
    const y = c[1] + (h[1] * 1.12 + lift) * Math.sign(sn) * Math.abs(sn) ** k;
    out.setComponent(ax, lo + f * len).setComponent(e1, x).setComponent(e2, y);
    return out;
  };
  const steps = Math.round(turns * 28);
  const pos: number[] = [];
  const rag: number[] = [];
  const ids: number[] = [];
  const spanF = s1 - s0;
  const total = turns * 0.12;
  const ph = rnd() * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const q = i / steps;
    const th = ph + q * turns * Math.PI * 2;
    const mid = s0 + q * spanF;
    const w = (width / len) * (0.85 + 0.3 * rnd());
    // Each turn lies a hair further out than the one it overlaps.
    const lift = 0.0009 + 0.0006 * q;
    for (let j = 0; j < 2; j++) {
      const f = mid + (j - 0.5) * w;
      point(f, th, lift, p);
      pos.push(p.x, p.y, p.z);
      rag.push(j, q, width * 100 * 0.8, total * 100);
    }
    if (i < steps) {
      const a = i * 2;
      ids.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('rag', new THREE.Float32BufferAttribute(rag, 4));
  geo.setAttribute('ragSeed', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(seed), 1));
  geo.setIndex(ids);
  geo.computeVertexNormals();
  const thEnd = ph + turns * Math.PI * 2;
  const end = point(s1, thEnd, 0.0015, new THREE.Vector3());
  const prev = point(s1 - 0.02, thEnd - 0.2, 0.0015, new THREE.Vector3());
  const out = end.clone().sub(prev).normalize();
  const across = new THREE.Vector3().setComponent(ax, 1);
  return { geo, end, across, out };
}

// ------------------------------------------------------------------------------ visor

/** Fine cracks from a blow at the visor's upper corner, drawn on a canvas in the window's millimetres. */
function crackTexture(size: THREE.Vector2, seed: number): THREE.CanvasTexture {
  const W = 2048;
  const H = Math.round((W * size.y) / size.x);
  const pxmm = W / size.x;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const rnd = mulberry(seed);
  // mm from the window's centre (+x the viewer's right, +y up) to canvas pixels.
  const X = (x: number) => (x / size.x + 0.5) * W;
  const Y = (y: number) => (0.5 - y / size.y) * H;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (pts: [number, number][], w: number, a: number) => {
    g.strokeStyle = `rgba(255,255,255,${a})`;
    g.lineWidth = w * pxmm;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
  };
  const crack = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    const pts: [number, number][] = [[x, y]];
    let a = ang;
    let left = len;
    while (left > 0) {
      const step = Math.min(left, 2 + rnd() * 5);
      a += (rnd() - 0.5) * 0.45;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push([x, y]);
      left -= step;
      if (depth > 0 && rnd() < 0.12) crack(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), left * (0.3 + rnd() * 0.4), w * 0.7, depth - 1);
    }
    stroke(pts, w * 2.6, 0.12);
    stroke(pts, w, 0.85);
  };
  // The blow: the viewer's upper left, radial cracks, two broken rings round it.
  const ix = -size.x * 0.4;
  const iy = size.y * 0.3;
  const rays = 8;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + rnd() * 0.5;
    const long = Math.cos(a) > 0.3 ? 0.55 + rnd() * 0.4 : 0.2 + rnd() * 0.25;
    crack(ix, iy, a, size.x * long, 0.22 + rnd() * 0.1, 2);
  }
  for (const r of [2.2, 4.6]) {
    for (let k = 0; k < 4; k++) {
      const a0 = rnd() * Math.PI * 2;
      const pts: [number, number][] = [];
      for (let s = 0; s <= 6; s++) {
        const a = a0 + (s / 6) * (0.6 + rnd() * 0.5);
        const rr = r * (0.9 + rnd() * 0.2);
        pts.push([ix + Math.cos(a) * rr, iy + Math.sin(a) * rr]);
      }
      stroke(pts, 0.18, 0.7);
    }
  }
  // A second, smaller crack across the lower right.
  crack(size.x * 0.46, -size.y * 0.38, Math.PI * 0.9, size.x * 0.3, 0.18, 1);
  // The eyes stay clear: the cracks fade out over them.
  g.globalCompositeOperation = 'destination-out';
  const ey = size.y * 0.06;
  for (const sx of [-1, 1]) {
    const cx = X(sx * size.x * 0.2);
    const cy = Y(ey);
    const R = size.y * 0.45 * pxmm;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)');
    gr.addColorStop(0.7, 'rgba(0,0,0,0.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------------------ hood

const HOOD_FRAG = /* glsl */ `
  uniform vec3 uRim;
  uniform float uRimK;
  varying vec3 vHood;
  ${NOISE}
`;

function hoodMaterial(src: THREE.Material, cue: Record<string, unknown>): THREE.Material {
  const m = (src as THREE.MeshStandardMaterial).clone();
  m.name = `${src.name}:rags`;
  m.color.set(String(cue.color ?? '#3a4237'));
  m.roughness = 0.95;
  m.metalness = 0;
  const u = { uRim: { value: new THREE.Color(String(cue.rim ?? '#9ec4d8')) }, uRimK: { value: num(cue.rimK, 0.3) } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHood;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHood = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${HOOD_FRAG}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 hq = vHood * 100.;
        float hs = fbm(hq * 0.5 + 2.);
        diffuseColor.rgb *= 0.6 + 0.6 * hs;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.028, 0.02), smoothstep(0.55, 0.8, fbm(hq * 0.9 + 7.)) * 0.6);
        diffuseColor.rgb *= 0.93 + 0.07 * sin(hq.x * 40.) * sin(hq.z * 40.);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float hf = 1. - abs(dot(normal, normalize(vViewPosition)));
        totalEmissiveRadiance += uRim * uRimK * pow(hf, 5.);`,
      );
  };
  m.customProgramCacheKey = () => 'night-rags-hood';
  return m;
}

// ------------------------------------------------------------------------------ the effect

/** The rim strips: direction round the body (deg, 0 ahead, 90 his left), width and length (metres). */
const RIM: [number, number, number][] = [
  [10, 0.034, 0.075],
  [-22, 0.03, 0.09],
  [38, 0.036, 0.085],
  [-48, 0.04, 0.1],
  [66, 0.034, 0.105],
  [-72, 0.036, 0.09],
  [92, 0.03, 0.11],
  [-96, 0.034, 0.1],
  [120, 0.036, 0.115],
  [-124, 0.032, 0.105],
  [148, 0.04, 0.12],
  [-150, 0.038, 0.11],
  [176, 0.042, 0.125],
];
/** Bandaged links: link, from, to (share of its length), turns, width (m), tail length (m). */
const WRAPS: [string, number, number, number, number, number][] = [
  ['LF_forearm_link', 0.12, 0.8, 3.2, 0.012, 0.07],
  ['RM_calf_link', 0.15, 0.62, 2.6, 0.013, 0.08],
];
/** The body's footprint in bind space (a superellipse): half width, centre z, half depth, bottom. */
const BODY = { hx: 0.095, zc: -0.009, hz: 0.107, y0: -0.014, y1: 0.075 };

interface Dressed {
  rig: Rig;
  swaps: { mesh: THREE.SkinnedMesh; geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; mine: THREE.Material; myGeo: THREE.BufferGeometry }[];
  hood: { mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[]; mine: THREE.Material }[];
  hoodPiece: THREE.Object3D | null;
  added: THREE.Object3D[];
  strips: Strip[];
  capsules: Capsule[];
  stripMesh: THREE.Mesh;
}

class Rags implements Effect {
  private unit: Unit | null = null;
  private dressed: Dressed | null = null;
  private bump = { value: 0.002 };
  private cloth: THREE.MeshStandardMaterial;
  private crackMat: THREE.MeshBasicMaterial | null = null;
  private owned: { dispose(): void }[] = [];
  private kicks: [number, number][];
  private tmp = { m: new THREE.Matrix4(), inv: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3() };

  constructor(private cue: FxCue) {
    this.cloth = clothMaterial(cue);
    this.owned.push(this.cloth);
    this.kicks = ((cue.kicks ?? []) as number[][]).map((k) => [k[0], k[1] ?? 0.4]);
  }

  private find(): Unit | null {
    if (this.unit) return this.unit;
    const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
    const us = g?.units ?? [];
    for (let i = us.length - 1; i >= 0; i--) if (us[i].name === this.cue.actor) return (this.unit = us[i]);
    return null;
  }

  private valid(d: Dressed): boolean {
    for (const s of d.swaps) if (s.mesh.material !== s.mine || !s.mesh.parent) return false;
    const hood = d.rig.gearMeshes.find((o) => o.name === 'crest_hood') ?? null;
    return hood === d.hoodPiece;
  }

  private dress(u: Unit): Dressed | null {
    if (this.dressed && this.valid(this.dressed)) return this.dressed;
    this.undress();
    const rig = u.rig;
    if (!rig.parts?.size || !rig.bones?.length) return null;
    const d: Dressed = { rig, swaps: [], hood: [], hoodPiece: null, added: [], strips: [], capsules: [], stripMesh: null as unknown as THREE.Mesh };
    // Decay on every plated part (the full detail and the far shell).
    const decay = this.cue.decay === false ? null : ((this.cue.decay ?? {}) as Record<string, unknown>);
    if (decay) {
      for (const meshes of [rig.parts, rig.lodMeshes]) {
        for (const [cls, mesh] of meshes ?? []) {
          if (cls === 'visor' || Array.isArray(mesh.material)) continue;
          const base = DECAY[cls];
          const look = { ...base, rust: base.rust * num(decay.rust, 1), chips: base.chips * num(decay.chips, 1), scratches: base.scratches * num(decay.scratches, 1), dirt: base.dirt * num(decay.dirt, 1) };
          const mine = decayed(mesh.material, look, this.bump);
          const myGeo = withCavity(mesh.geometry);
          d.swaps.push({ mesh, geo: mesh.geometry, mat: mesh.material, mine, myGeo });
          mesh.material = mine;
          mesh.geometry = myGeo;
        }
      }
    }
    // The hood re-dyed.
    const hoodPiece = rig.gearMeshes.find((o) => o.name === 'crest_hood') ?? null;
    d.hoodPiece = hoodPiece;
    if (hoodPiece && this.cue.hood !== false) {
      const hc = (this.cue.hood ?? {}) as Record<string, unknown>;
      hoodPiece.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material) || !m.material.name.includes('cloth')) return;
        const mine = hoodMaterial(m.material, hc);
        d.hood.push({ mesh: m, mat: m.material, mine });
        m.material = mine;
      });
    }
    // Cracks on the visor glass, over the LED face.
    if (this.cue.visor !== false && rig.face?.mesh) {
      if (!this.crackMat) {
        const sz = (rig.face.material.uniforms.uSize?.value as THREE.Vector2) ?? new THREE.Vector2(107, 19);
        const tex = crackTexture(sz, 41);
        this.crackMat = new THREE.MeshBasicMaterial({
          map: tex,
          color: '#c4d0bc',
          transparent: true,
          opacity: num(this.cue.visor, 0.6),
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -8,
        });
        this.crackMat.name = 'night-rags:cracks';
        this.owned.push(tex, this.crackMat);
      }
      const cracks = new THREE.Mesh(rig.face.mesh.geometry, this.crackMat);
      cracks.name = 'night-rags:cracks';
      cracks.renderOrder = 3;
      cracks.castShadow = false;
      cracks.receiveShadow = false;
      rig.face.mesh.add(cracks);
      d.added.push(cracks);
    }
    // Rags: the strips from the rim, the bandages and their tails.
    const shell = rig.parts.get('shell');
    const verts = boneVerts(rig.parts);
    for (const [b, v] of verts) if (b !== 0) d.capsules.push(capsuleOf(b, v));
    const rnd = mulberry(77);
    if (shell) {
      RIM.forEach(([deg, w, len], i) => {
        const root = rimPoint(shell.geometry, deg, BODY.zc);
        const a = (deg * Math.PI) / 180;
        const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        root.addScaledVector(out, 0.0025);
        d.strips.push({ bone: 0, root, across: new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), out, width: w, length: len, seed: i + 1, phase: rnd() * 6.28 });
      });
    }
    WRAPS.forEach(([link, s0, s1, turns, w, tail], i) => {
      const b = rig.bones.findIndex((o) => o.name === link);
      const v = verts.get(b);
      if (b < 0 || !v) return;
      const band = bandage(v, s0, s1, turns, w, 20 + i);
      this.owned.push(band.geo);
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(rig.skeleton.boneInverses[b]);
      const mesh = new THREE.Mesh(band.geo, this.cloth);
      mesh.name = `night-rags:${link}`;
      mesh.frustumCulled = false;
      holder.add(mesh);
      rig.bones[b].add(holder);
      d.added.push(holder);
      d.strips.push({ bone: b, root: band.end, across: band.across, out: band.out, width: w * 0.9, length: tail, seed: 20 + i, phase: rnd() * 6.28 });
    });
    const n = d.strips.length * ROWS * COLS;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const rag = new Float32Array(n * 4);
    const seed = new Float32Array(n);
    const ids: number[] = [];
    d.strips.forEach((s, k) => {
      for (let i = 0; i < ROWS; i++) {
        for (let j = 0; j < COLS; j++) {
          const o = (k * ROWS + i) * COLS + j;
          const u = j / (COLS - 1);
          const v = i / (ROWS - 1);
          rag.set([u, v, s.width * 100, s.length * 100], o * 4);
          seed[o] = s.seed;
          if (i < ROWS - 1 && j < COLS - 1) ids.push(o, o + 1, o + COLS, o + 1, o + COLS + 1, o + COLS);
        }
      }
    });
    geo.setAttribute('rag', new THREE.BufferAttribute(rag, 4));
    geo.setAttribute('ragSeed', new THREE.BufferAttribute(seed, 1));
    geo.setIndex(ids);
    const strips = new THREE.Mesh(geo, this.cloth);
    strips.name = 'night-rags:strips';
    strips.frustumCulled = false;
    strips.castShadow = false;
    strips.receiveShadow = true;
    rig.bones[0].add(strips);
    d.added.push(strips);
    d.stripMesh = strips;
    this.dressed = d;
    return d;
  }

  private undress(): void {
    const d = this.dressed;
    if (!d) return;
    for (const s of d.swaps) {
      if (s.mesh.material === s.mine) {
        s.mesh.material = s.mat;
        s.mesh.geometry = s.geo;
      }
      s.mine.dispose();
    }
    for (const h of d.hood) {
      if (h.mesh.material === h.mine) h.mesh.material = h.mat;
      h.mine.dispose();
    }
    for (const o of d.added) o.removeFromParent();
    d.stripMesh.geometry.dispose();
    this.dressed = null;
  }

  /** The strips' sideways and outward swing (radians) at time t for a strip of phase ph. */
  private swing(t: number, ph: number): [number, number] {
    const sw = num(this.cue.sway, 0.14);
    let s = sw * (0.6 * Math.sin(1.4 * t + ph) + 0.4 * Math.sin(2.7 * t + 1.7 * ph));
    let o = sw * 0.6 * (0.6 * Math.sin(1.1 * t + 2.3 * ph) + 0.4 * Math.sin(3.3 * t + ph));
    for (const [t0, amp] of this.kicks) {
      const x = t - t0;
      if (x <= 0) continue;
      const k = amp * Math.exp(-1.6 * x) * Math.sin(5.5 * x + ph * 0.3);
      s += k * Math.cos(ph);
      o += k * Math.abs(Math.sin(ph));
    }
    return [s, o];
  }

  update(ctx: FxContext): void {
    const u = this.find();
    const on = ctx.t >= this.cue.t && ctx.t <= num(this.cue.until, Infinity);
    if (!u || !on) {
      if (!on) this.undress();
      return;
    }
    const d = this.dress(u);
    if (!d) return;
    const rig = d.rig;
    const base = rig.bones[0];
    base.updateWorldMatrix(true, true);
    // Bump relief in view units: a millimetre of the robot.
    this.bump.value = base.matrixWorld.getMaxScaleOnAxis() * 0.00035;
    const T = this.tmp;
    const toBase = T.inv.copy(base.matrixWorld).invert();
    // Each link's bind space into the base's (identity for the base itself).
    const linkM = new Map<number, THREE.Matrix4>();
    const bindToBase = (b: number) => {
      let m = linkM.get(b);
      if (!m) {
        m = b === 0 ? new THREE.Matrix4() : new THREE.Matrix4().multiplyMatrices(toBase, rig.bones[b].matrixWorld).multiply(rig.skeleton.boneInverses[b]);
        linkM.set(b, m);
      }
      return m;
    };
    const caps = d.capsules.map((c) => {
      const m = bindToBase(c.bone);
      return { a: c.a.clone().applyMatrix4(m), b: c.b.clone().applyMatrix4(m), r: c.r };
    });
    // World down in the base's frame.
    base.getWorldQuaternion(T.q);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(T.q.invert()).normalize();
    const pos = d.stripMesh.geometry.attributes.position as THREE.BufferAttribute;
    const seg = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const pts = Array.from({ length: ROWS }, () => new THREE.Vector3());
    const side = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const push = (p: THREE.Vector3, pad: number) => {
      // Out of the body...
      if (p.y > BODY.y0 && p.y < BODY.y1) {
        const x = p.x / (BODY.hx + pad);
        const z = (p.z - BODY.zc) / (BODY.hz + pad);
        const r = (x ** 4 + z ** 4) ** 0.25;
        if (r < 1) {
          const k = 1 / Math.max(r, 1e-3);
          p.x *= k;
          p.z = BODY.zc + (p.z - BODY.zc) * k;
        }
      }
      // ...and out of the legs.
      for (const c of caps) {
        ab.subVectors(c.b, c.a);
        const h = Math.max(0, Math.min(1, tmp.subVectors(p, c.a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
        const q = tmp.copy(c.a).addScaledVector(ab, h);
        const dd = p.distanceTo(q);
        const min = c.r + pad;
        if (dd < min) {
          if (dd < 1e-6) p.y -= min;
          else p.sub(q).multiplyScalar(min / dd).add(q);
        }
      }
    };
    d.strips.forEach((s, k) => {
      const m = bindToBase(s.bone);
      pts[0].copy(s.root).applyMatrix4(m);
      const out = T.v.copy(s.out).transformDirection(m);
      const across = T.w.copy(s.across).transformDirection(m);
      const [sw, so] = this.swing(ctx.t, s.phase);
      const L = s.length / (ROWS - 1);
      for (let i = 1; i < ROWS; i++) {
        const q = i / (ROWS - 1);
        // Over the rim first, then hanging, swinging more toward the hem.
        seg.copy(down).addScaledVector(out, Math.max(0.15, 1.1 - q * 3) + so * q * 2).addScaledVector(across, sw * q * 2).normalize();
        const p = pts[i].copy(pts[i - 1]).addScaledVector(seg, L);
        push(p, 0.003);
        p.sub(pts[i - 1]).setLength(L).add(pts[i - 1]);
        push(p, 0.0025);
      }
      for (let i = 0; i < ROWS; i++) {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(ROWS - 1, i + 1)];
        seg.subVectors(next, prev).normalize();
        // The width lies across the strip, at right angles to its run.
        side.copy(across).addScaledVector(seg, -across.dot(seg)).normalize();
        nrm.crossVectors(side, seg);
        const q = i / (ROWS - 1);
        const w = s.width * (1 - 0.25 * q);
        for (let j = 0; j < COLS; j++) {
          const u = j / (COLS - 1) - 0.5;
          // Folds across the width, deepening toward the hem, so it reads as cloth and not card.
          const curl = w * (0.12 * (u * u * 4 - 0.5) + 0.16 * Math.sin(u * 9.4 + s.phase + q * 2.5)) * (0.35 + q);
          tmp.copy(pts[i]).addScaledVector(side, u * w).addScaledVector(nrm, curl);
          pos.setXYZ((k * ROWS + i) * COLS + j, tmp.x, tmp.y, tmp.z);
        }
      }
    });
    pos.needsUpdate = true;
    d.stripMesh.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.undress();
    for (const o of this.owned) o.dispose();
  }
}

registerEffect('night-rags', (cue) => new Rags(cue));
