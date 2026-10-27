import * as THREE from 'three';
import {STAR_SKY_GLSL} from './starNight';

/*
 * Starhaven's crystals: a cluster (a main spire with leaning satellites and chips at its foot) and one crystal
 * material for every family on the island (amethyst gardens, the blue Moonshade leaves, the teal and violet crowns
 * of the sanctum). The cluster replaces the single faceted prism in the same unit space and inside its hull, so
 * every instance stays within the collider measured from the old crystal (starCrystalRadius), unchanged on the
 * server. The material keeps MeshStandardMaterial's lighting and shadows (moonlight glints on the flat facets) and
 * adds the inside: a glow that is deep where the eye looks through the body and pale at the tips, veils seen with
 * parallax below the surface, the night sky and aurora refracted through each facet, and a frosted, opaque foot.
 */

type P3 = [number, number, number];
const rnd = (i: number) => { const n = Math.sin(i * 91.17 + 7.3) * 43758.5453; return n - Math.floor(n); };

/** The old crystal's hull as an inscribed radius by height (facetedStarCrystal: hexagon rings, apex at y=1). */
function hullRadius(y: number): number {
  const k = 0.866, m = 0.012;
  if (y <= -0.95) return 0;
  if (y < -0.78) return THREE.MathUtils.mapLinear(y, -0.95, -0.78, 0, 0.58 * k) - m;
  if (y < -0.45) return THREE.MathUtils.mapLinear(y, -0.78, -0.45, 0.58 * k, 0.92 * k) - m;
  if (y < 0.43) return THREE.MathUtils.mapLinear(y, -0.45, 0.43, 0.92 * k, 0.82 * k) - m;
  // Toward the apex the cross-sections drift with it (0.058 at the tip): keep that much in hand.
  const s = (y - 0.43) / 0.57;
  return Math.max(0, 0.82 * k * (1 - s) - 0.065 * s - m);
}

interface Piece { base: P3; axis: P3; len: number; r: number; seed: number }

/** The cluster's crystals in the old unit space: ground line at y = -0.5 once placed. */
function pieces(): Piece[] {
  const out: Piece[] = [{base: [0, -0.97, 0], axis: [0.03, 1, -0.02], len: 1.95, r: 0.4, seed: 1}];
  const sats = [
    {a: 0.3, d: 0.3, lean: 0.36, len: 1.02, r: 0.2},
    {a: 1.55, d: 0.33, lean: 0.42, len: 0.78, r: 0.17},
    {a: 2.6, d: 0.3, lean: 0.3, len: 1.18, r: 0.19},
    {a: 3.75, d: 0.34, lean: 0.46, len: 0.66, r: 0.15},
    {a: 4.9, d: 0.32, lean: 0.38, len: 0.9, r: 0.18},
  ];
  sats.forEach((s, i) => out.push({base: [Math.cos(s.a) * s.d, -0.7, Math.sin(s.a) * s.d], axis: [Math.cos(s.a) * Math.sin(s.lean), Math.cos(s.lean), Math.sin(s.a) * Math.sin(s.lean)], len: s.len, r: s.r, seed: 2 + i}));
  // Chips broken off round the foot, lying low.
  for (let i = 0; i < 4; i++) {
    const a = 0.8 + i * 1.6 + rnd(i + 40) * 0.5, d = 0.45 + rnd(i + 50) * 0.08, lean = 0.9 + rnd(i + 60) * 0.3;
    out.push({base: [Math.cos(a) * d, -0.58, Math.sin(a) * d], axis: [Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean)], len: 0.24 + rnd(i + 70) * 0.1, r: 0.07 + rnd(i + 80) * 0.03, seed: 8 + i});
  }
  return out;
}

/**
 * One non-indexed geometry: flat facets. Attributes: `aH` (0 at a crystal's root, 1 at its point), `aFacet` (a
 * per-face random, so neighbouring facets differ in depth like real faces), `aSeed` (per crystal).
 */
export function starCrystalCluster(): THREE.BufferGeometry {
  const pos: number[] = [], h: number[] = [], facet: number[] = [], seed: number[] = [];
  const ax = new THREE.Vector3(), ex = new THREE.Vector3(), ez = new THREE.Vector3(), w = new THREE.Vector3();
  let face = 0;
  for (const p of pieces()) {
    ax.set(...p.axis).normalize();
    ex.set(0, 0, 1).cross(ax).normalize(); if (ex.lengthSq() < 1e-6) ex.set(1, 0, 0);
    ez.crossVectors(ax, ex);
    const wob = Array.from({length: 6}, (_, k) => 0.78 + 0.4 * rnd(p.seed * 13 + k));
    const ring = (t: number, r: number, tw: number): P3[] => Array.from({length: 6}, (_, k) => {
      const a = k * Math.PI / 3 + p.seed * 1.7 + tw, rr = p.r * r * wob[k];
      w.set(...p.base).addScaledVector(ax, p.len * t).addScaledVector(ex, Math.cos(a) * rr).addScaledVector(ez, Math.sin(a) * rr);
      return [w.x, w.y, w.z];
    });
    const rings = [ring(0, 0.82, 0), ring(0.16, 1, 0.04), ring(0.7 + 0.08 * rnd(p.seed), 0.9, 0.1)];
    const ts = [0, 0.16, 0.74];
    w.set(...p.base).addScaledVector(ax, p.len).addScaledVector(ex, (rnd(p.seed + 5) - 0.5) * p.r * 0.3);
    const apex: P3 = [w.x, w.y, w.z];
    const tri = (a: P3, b: P3, c: P3, ha: number, hb: number, hc: number) => {
      const f = rnd(face++ * 3.7 + p.seed);
      for (const [v, hv] of [[a, ha], [c, hc], [b, hb]] as const) { pos.push(...v); h.push(hv); facet.push(f); seed.push(p.seed / 16); }
    };
    for (let i = 0; i < 2; i++) for (let k = 0; k < 6; k++) {
      const k1 = (k + 1) % 6;
      tri(rings[i][k], rings[i + 1][k], rings[i][k1], ts[i], ts[i + 1], ts[i]);
      tri(rings[i][k1], rings[i + 1][k], rings[i + 1][k1], ts[i], ts[i + 1], ts[i + 1]);
    }
    for (let k = 0; k < 6; k++) tri(rings[2][k], apex, rings[2][(k + 1) % 6], ts[2], 1, ts[2]);
  }
  // Inside the old crystal's hull, so its measured collider still holds every facet.
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1], r = Math.hypot(pos[i], pos[i + 2]), max = hullRadius(y);
    if (r > max) { const s = Math.max(0, max) / r; pos[i] *= s; pos[i + 2] *= s; }
  }
  const g = new THREE.BufferGeometry(); g.name = 'star-crystal-cluster';
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  g.setAttribute('aFacet', new THREE.Float32BufferAttribute(facet, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

export type CrystalTint = 'amethyst' | 'moonshade' | 'teal' | 'violet';
const TINTS: Record<CrystalTint, {deep: P3; glow: P3; tip: P3}> = {
  amethyst: {deep: [0.035, 0.008, 0.11], glow: [0.36, 0.07, 0.95], tip: [0.86, 0.6, 1.0]},
  violet: {deep: [0.07, 0.02, 0.18], glow: [0.42, 0.13, 1.0], tip: [0.85, 0.7, 1.0]},
  moonshade: {deep: [0.006, 0.025, 0.12], glow: [0.05, 0.3, 1.0], tip: [0.6, 0.85, 1.0]},
  teal: {deep: [0.008, 0.07, 0.08], glow: [0.04, 0.62, 0.58], tip: [0.6, 1.0, 0.94]},
};

/**
 * A crystal material: `glow` scales the inner light (the sanctum's crowns burn brighter than the field), `frost`
 * how high the frosted foot climbs in local units (gardens stand in the ground at y = -0.5).
 */
export function starCrystalMaterial(tint: CrystalTint, opts: {glow?: number; frost?: number; ground?: number} = {}): THREE.MeshStandardMaterial {
  const t = TINTS[tint], v = (p: P3) => `vec3(${p.map(n => n.toFixed(4)).join(',')})`;
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.14, metalness: 0.05, flatShading: true, emissive: '#ffffff', envMapIntensity: 1.4});
  m.name = `star-crystal-${tint}`;
  const glow = (opts.glow ?? 1).toFixed(3), ground = (opts.ground ?? -0.5).toFixed(3), frost = (opts.frost ?? 0.22).toFixed(3);
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aH;attribute float aFacet;attribute float aSeed;
varying float vCsH;varying float vCsFacet;varying float vCsSeed;varying vec3 vCsLocal;varying vec3 vCsWorld;varying float vCsInst;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vCsH=aH;vCsFacet=aFacet;vCsSeed=aSeed;vCsLocal=position;
vec4 csW=vec4(transformed,1.);
#ifdef USE_INSTANCING
csW=instanceMatrix*csW;vCsInst=fract(sin(float(gl_InstanceID)*12.9898+3.1)*43758.5453);
#else
vCsInst=.5;
#endif
vCsWorld=(modelMatrix*csW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vCsH;varying float vCsFacet;varying float vCsSeed;varying vec3 vCsLocal;varying vec3 vCsWorld;varying float vCsInst;
${STAR_SKY_GLSL}
float csN3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float n=dot(i,vec3(1.,57.,113.));
  return mix(mix(mix(nsH1(n),nsH1(n+1.),f.x),mix(nsH1(n+57.),nsH1(n+58.),f.x),f.y),mix(mix(nsH1(n+113.),nsH1(n+114.),f.x),mix(nsH1(n+170.),nsH1(n+171.),f.x),f.y),f.z);}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 V=normalize(vViewPosition);
  float ndv=clamp(dot(normal,V),0.,1.);
  vec3 wN=inverseTransformDirection(normal,viewMatrix),wV=inverseTransformDirection(V,viewMatrix);
  // Frosted foot: opaque, pale and rough where the crystal leaves the ground.
  float frost=1.-smoothstep(${ground},${ground}+${frost},vCsLocal.y+(csN3(vCsWorld*3.1)-.5)*.12);
  // Looking through the body: refract, then sample veils a little way inside, so they slide under the facets.
  vec3 rd=refract(-wV,wN,1./1.55);if(dot(rd,rd)<.5)rd=-wV;
  float inside=csN3((vCsWorld+rd*(.35+.3*vCsFacet))*1.9+vCsSeed*7.)*.65+csN3((vCsWorld+rd*.8)*4.7)*.35;
  float through=pow(ndv,1.3);
  float lift=.75+.5*vCsInst;
  vec3 deep=${v(t.deep)},glowC=${v(t.glow)},tip=${v(t.tip)};
  vec3 body=mix(deep,glowC,smoothstep(.05,.95,vCsH*.75+inside*.45));
  body=mix(body,tip,smoothstep(.72,1.,vCsH)*.65);
  vec3 inner=body*(.22+1.5*through)*(.45+1.1*inside)*(.7+.6*vCsFacet)*lift;
  // The night refracted through the thin parts: the aurora's green and the moon's quarter.
  vec3 seen=starAtmosphere(rd,40.)*mix(1.4,.5,through);
  totalEmissiveRadiance=(inner*${glow}+seen)*(1.-frost*.9)+tip*pow(1.-ndv,4.)*.12;
  diffuseColor.rgb=mix(deep*.35,vec3(.5,.5,.62),frost);
}`)
      .replace('#include <lights_physical_fragment>', `{float frostR=1.-smoothstep(${ground},${ground}+${frost},vCsLocal.y);roughnessFactor=mix(roughnessFactor,.8,frostR);}
#include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => `star-crystal-${tint}-${glow}-${frost}-${ground}`;
  return m;
}
