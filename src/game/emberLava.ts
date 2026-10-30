import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { frontierTrees } from './realmLayout';
import { FLOW_CELL, LavaFlow, type FlowArea, type FlowDeposit, type FlowSource } from './emberLavaFlow';

/*
 * Emberreach's lava: a molten sea round the island, a brimming crater lake and its flows. Live flows spill through
 * notches in the crater rim, wander down the cone and run onto the plateau, where they feed lava that spreads and stops
 * (emberLavaFlow.ts, a GPU yield-stress height field); one breaks out of the main flow halfway down, one stalled high
 * on the cone, one older flow has crusted through. One crust texture baked here at load, shaders on
 * MeshStandardMaterial (so the lava takes the sun, the hemisphere and the World V fog) and meshes whose topology never
 * changes.
 *
 * What makes it read thick rather than wet:
 * - Crust plates with glowing cracks (black-body HDR, peaks 2-4 so GAME_VIEW's bloom at 0.9 catches them; mid
 *   temperatures stay under 0.9). On the flows the plates are anisotropic, longer along the flow, torn into streaks in
 *   the shear bands; open melt at the spillway crusts over within about 12 m down the cone. The sea mixes big cool
 *   rafts (plates about 3.6 m, a house or two across from the air) with hot leads broken into plates a third the size;
 *   hex tiling (three taps, each with its own offset, rotation and scale) hides the 58 m texture repeat.
 * - Plug flow on the tongues: the middle slides as a block (its pattern moves exactly with it, never resets), the
 *   shear bands at the sides tear the plates into streaks (dual-phase advection with a global 5 s period, which alone
 *   bounds the stretch), levees and stopped toes are crust at rest and carry no time term at all. Plug, band and rest
 *   blend over |c| with smoothsteps 0.2+ wide, never a per-pixel switch.
 * - Material coordinates follow the travel time, so plates and rope folds bunch up where the flow slows: ropes bowed
 *   downstream crowd towards the toe.
 * - Lobes on the plateau are simulated: each live tongue ends in a short nose just past the cone foot and feeds the
 *   height field there in episodes; fronts advance, slow and stop as yield domes (crest sqrt(2 d R), edge step), crust
 *   over and cool to dark rock; the next episode breaks out at an old lobe's margin. The grid mesh is lifted by the
 *   field in its vertex shader, lit by normals from a blurrier field, carries its crust with the sim's velocity while it
 *   moves and has no time term at rest; a glowing seam runs along moving fronts, clinker crumbs (a fixed pool placed on
 *   the GPU) and a darkening halo blur its margins. Where float render targets are missing the tongues end in the
 *   analytic lobes instead: Bingham domes h = sqrt(2 d (dist + 8 d)) under a rounded 1.1 m shoulder, sized from volume
 *   (R = (15 V / (8 pi sqrt(2 d)))^0.4), toes and side lobes bulges of the same mesh, shading normals from a softer,
 *   blurred dome on the smooth cone.
 * - The simulated lobes take the tongues' near-black basalt: plates and cracks unfolded up their fronts, pahoehoe
 *   ropes concentric with the margin (from the thickness each cell froze at), a cavity term that darkens cracks and
 *   troughs for specular light too, a glassy skin (0.62-0.82) so light breaks into glints, then a clinker skin, an
 *   oxidised rim and a contact line at the foot. Cooling rock keeps a dull red only deep in some cracks, fading with
 *   its temperature over a few minutes.
 * - Gloss (roughness down to 0.34) only on young crust and rope crests, broken up; no roughness under 0.30.
 * - The crust takes the sun's and the sky's strength but only half their tint (CRUST_LIGHT), so it reads as dark basalt
 *   under World V's amber sun and violet sky; the sea's crust barely takes the sun's highlight (SEA_SPECULAR).
 *
 * The tongues lie on the cone and the terrain as they are: no channel is carved (ground.ts and the collision bake are
 * untouched), the levees are built on top instead, and lava has no collision, so crabs can walk into the lobes. It is
 * all client-local and cosmetic: each player's lava runs its own simulation. EmberLava.zones and emberLavaZones() mark
 * where it lies, the toe zones covering everywhere the simulated lava can reach.
 */

export type LavaQuality = 'high' | 'low';
/** Where the lava is on the island, for keeping props and paths clear. */
export interface LavaZone { x: number; z: number; radius: number; kind: 'crater' | 'tongue' | 'toe' }

/** The volcano cone in frontierIsland.ts: CylinderGeometry(8, 28, 38, 18, 4, true) centred at (0, ly + 9, -128). */
interface Cone { x: number; z: number; baseY: number; topY: number; baseR: number; topR: number; segments: number }

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const hash1 = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

/** Shear depth d = (tau_y + c) / (rho g), metres, at game scale: crest/R = sqrt(2 d / R) is about 0.28 for R near 3.6 m (0.32 with the edge step). */
const YIELD_D = .14;
/** Lobe radius from its volume, isaac_sim #760: R = (15 V / (8 pi sqrt(2 d)))^0.4. */
export const lobeRadius = (volume: number, d = YIELD_D) => Math.pow(15 * volume / (8 * Math.PI * Math.sqrt(2 * d)), .4);
/** Lobe profile over a distance `dist` from the outline: the Bingham dome sqrt(2 d (dist + 8 d)) (crest sqrt(2 d R) plus
 * the 4 d edge step) under a rounded shoulder 1 - (1 - u)^3 over `sh` metres, so the front leaves the ground at about
 * 55 degrees and rolls over convexly onto a slightly domed top instead of standing up as a wall. */
const lobeHeight = (dist: number, sh = 1.1, d = YIELD_D) => {
  if (dist <= 0) return 0;
  const u = Math.min(1, dist / sh);
  return Math.sqrt(2 * d * (dist + 8 * d)) * (1 - (1 - u) ** 3);
};
const smin = (a: number, b: number, k: number) => { const h = clamp(.5 + .5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); };
const smax = (a: number, b: number, k: number) => { if (k <= 1e-4) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * .25; };

/** Plug speed on the cone and at the toe, m/s; material coordinates are measured at the cone speed. Fast enough that a
 * player sees the crust slide within a few seconds, in step with the lobes it feeds at the foot. */
const U0 = .6;
const U_TOE = .22;
/** Plate sizes (m) and the plates per texture repeat. */
const CELLS = 16;
const PLATE_TONGUE = 1.5, PLATE_SEA = 3.6, PLATE_LAKE = 1.1;
const TILE_TONGUE = CELLS * PLATE_TONGUE, TILE_SEA = CELLS * PLATE_SEA, TILE_LAKE = CELLS * PLATE_LAKE;
/** Dual-phase periods, s: the life of a pattern before it is renewed. The shear bands renew in proportion to the plug
 * speed (U0 T_BAND = 3 m of stretch at most); the sea and the crater lake are slow pools and keep their long periods. */
const T_BAND = 5, T_SEA = 12, T_LAKE = 12;
/** Hex centres per sea texture repeat (about 26 m apart), where the sea's taps change their offset, rotation and scale. */
const HEX_SEA = 2.2;

/* ---------------------------------------------------------------------------------------------------------------- */
/* Crust texture: R distance to the nearest open crack (0 crack .. 1 plate middle), G plate id, B distance to the fine */
/* cooling cracks inside a plate, A fbm noise. Every crack between two plates has its own width, and about a third   */
/* are welded shut, so plates come in many sizes and the network is never a regular net.                              */

function bakeCrust(size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const n = CELLS;
  const wrap = (i: number, m: number) => ((i % m) + m) % m;
  const px = new Float32Array(n * n), pz = new Float32Array(n * n), id = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    px[k] = i + .5 + .92 * (hash1(k * 3.1 + 1) - .5);
    pz[k] = j + .5 + .92 * (hash1(k * 5.7 + 2) - .5);
    id[k] = hash1(k * 9.3 + 7);
  }
  // Width of the crack between plates a and b: 0 welded shut, else 0.45..1.35.
  const crackWidth = (a: number, b: number) => { const o = hash1(Math.min(a, b) * 977.3 + Math.max(a, b) * 131.7); return o < .32 ? 0 : .45 + .9 * (o - .32) / .68; };
  // Widths towards the 5 x 5 neighbourhood of every cell, computed once (the pixel loop only looks them up).
  const widths = new Float32Array(n * n * 25);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    widths[(j * n + i) * 25 + (dz + 2) * 5 + dx + 2] = crackWidth(j * n + i, wrap(j + dz, n) * n + wrap(i + dx, n));
  }
  const m = n * 5, qx = new Float32Array(m * m), qz = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { const k = j * m + i; qx[k] = i + .5 + .9 * (hash1(k * 1.7 + 31) - .5); qz[k] = j + .5 + .9 * (hash1(k * 2.9 + 47) - .5); }
  const L = 32, lat = new Float32Array(L * L);
  for (let k = 0; k < L * L; k++) lat[k] = hash1(k * 4.3 + 91);
  const vnoise = (x: number, z: number, f: number) => {
    const X = x * f, Z = z * f, ix = Math.floor(X), iz = Math.floor(Z), u = X - ix, v = Z - iz;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), w = (a: number, b: number) => lat[wrap(b, f) * L + wrap(a, f)];
    return mix(mix(w(ix, iz), w(ix + 1, iz), su), mix(w(ix, iz + 1), w(ix + 1, iz + 1), su), sv);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x + .5) / size * n, fz = (y + .5) / size * n, cx = Math.floor(fx), cz = Math.floor(fz);
    let best = 1e9, bx = 0, bz = 0, bk = 0, bi = 0, bj = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx, iz = cz + dz, k = wrap(iz, n) * n + wrap(ix, n);
      const ox = px[k] - wrap(ix, n) + ix, oz = pz[k] - wrap(iz, n) + iz, d = (ox - fx) ** 2 + (oz - fz) ** 2;
      if (d < best) { best = d; bx = ox; bz = oz; bk = k; bi = ix; bj = iz; }
    }
    // Distance to each cell border (perpendicular bisector), divided by that crack's width; welded borders skipped.
    let edge = 1e9;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (!dz && !dx) continue;
      const ix = bi + dx, iz = bj + dz, k = wrap(iz, n) * n + wrap(ix, n);
      const w = widths[bk * 25 + (dz + 2) * 5 + dx + 2];
      if (!w) continue;
      const ox = px[k] - wrap(ix, n) + ix, oz = pz[k] - wrap(iz, n) + iz, ex = ox - bx, ez = oz - bz, el = Math.hypot(ex, ez);
      if (el < 1e-5) continue;
      const d = (((ox + bx) * .5 - fx) * ex + ((oz + bz) * .5 - fz) * ez) / el;
      edge = Math.min(edge, d / w);
    }
    const gx = (x + .5) / size * m, gz = (y + .5) / size * m, hx = Math.floor(gx), hz = Math.floor(gz);
    let f1 = 1e9, f2 = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ix = hx + dx, iz = hz + dz, k = wrap(iz, m) * m + wrap(ix, m);
      const d = Math.hypot(qx[k] - wrap(ix, m) + ix - gx, qz[k] - wrap(iz, m) + iz - gz);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const u = (x + .5) / size, v = (y + .5) / size;
    const noise = vnoise(u, v, 4) * .5 + vnoise(u, v, 8) * .3 + vnoise(u, v, 16) * .2;
    const o = (y * size + x) * 4;
    data[o] = Math.round(clamp(edge * 2.2, 0, 1) * 255);
    data[o + 1] = Math.round(id[bk] * 255);
    data[o + 2] = Math.round(clamp((f2 - f1) * 1.5, 0, 1) * 255);
    data[o + 3] = Math.round(noise * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Shared GLSL                                                                                                         */

const LAVA_COMMON = /* glsl */ `
uniform sampler2D uCrust;
uniform float uDetail;
uniform float uMask;
uniform float uPulse;
// Linear HDR black body for t 0..1 (about 800 K .. 1450 K): visible radiance rises steeply with temperature.
vec3 lavaBB(float t){
  t=clamp(t,0.,1.2);
  vec3 c=mix(vec3(1.,.04,0.),vec3(1.,.27,.012),smoothstep(0.,1.,t));
  c=mix(c,vec3(1.,.5,.12),smoothstep(1.,1.2,t));
  return c*(7.*t*t*t);
}
// Greys a light's colour by k, keeping its luminance (CRUST_LIGHT). World V lights its near-black basalt with a low amber
// sun and a violet sky; on a surface this dark nothing but the lights' tints shows, so a neutral crust read as saturated
// brown and purple (HSV saturation median about 0.45 at the volcano foot). The crust keeps the lights' strength, its
// glints and its own albedo; only the lights' colour is greyed, by LIGHT_GREY. Cracks and their glow keep all of it.
vec3 lavaGrey(vec3 c,float k){return mix(c,vec3(dot(c,vec3(.2126,.7152,.0722))),k);}
// Surface gradient of a scalar height from screen derivatives (world space), for crack relief.
vec3 lavaBumpGrad(vec3 p,vec3 n,float h){
  vec3 dpx=dFdx(p),dpy=dFdy(p);
  vec3 r1=cross(dpy,n),r2=cross(n,dpx);
  float det=dot(dpx,r1);
  if(abs(det)<1e-8)return vec3(0.);
  return (dFdx(h)*r1+dFdy(h)*r2)/det;
}
`;

/** Greys the light the crust reflects (see lavaGrey): diffuse through the albedo, so an albedo tint (the oxidised rim)
 * stays; specular as it is. After <aomap_fragment>, with lCrack set. */
const LIGHT_GREY = .5;
const CRUST_LIGHT = /* glsl */ `
{
  float k=${LIGHT_GREY.toFixed(2)}*(1.-lCrack);
  vec3 alb=max(diffuseColor.rgb,vec3(1e-5));
  reflectedLight.directDiffuse=lavaGrey(reflectedLight.directDiffuse/alb,k)*alb;
  reflectedLight.indirectDiffuse=lavaGrey(reflectedLight.indirectDiffuse/alb,k)*alb;
  reflectedLight.directSpecular=lavaGrey(reflectedLight.directSpecular,k);
  reflectedLight.indirectSpecular=lavaGrey(reflectedLight.indirectSpecular,k);
}
`;

/* Tongue shaders ------------------------------------------------------------------------------------------------- */

const TONGUE_VERT_HEAD = /* glsl */ `
attribute vec4 aLA; // material coordinate along (m), c across (-1..1), half width (m), temperature
attribute vec4 aLB; // activity (1 flowing, 0 at rest), levee factor, dXm/ds compression, lobe factor
attribute vec4 aLC; // front-face steepness, swell weight, s / length, thickness (m)
attribute vec3 aTan;
attribute vec3 aSide;
uniform float uSwell;
varying vec4 vLA;
varying vec4 vLB;
varying vec4 vLC;
varying vec3 vLT;
varying vec3 vLS;
varying vec3 vLW;
`;
const TONGUE_VERT_BODY = /* glsl */ `
// Active lobes inflate and relax on a 16 s breath; nothing else moves.
transformed.y+=aLC.y*.07*(.5+.5*sin(uSwell+position.x*.21+position.z*.13));
`;
const TONGUE_VERT_TAIL = /* glsl */ `
vLA=aLA;vLB=aLB;vLC=aLC;
vLT=normalize(mat3(modelMatrix)*aTan);vLS=normalize(mat3(modelMatrix)*aSide);
vLW=(modelMatrix*vec4(transformed,1.)).xyz;
`;
const TONGUE_FRAG_HEAD = /* glsl */ `
${LAVA_COMMON}
uniform float uShift;  // plug shift along, metres, wrapped to the texture repeat
uniform float uPhB;    // shear-band dual phase, fract(t / T)
varying vec4 vLA;
varying vec4 vLB;
varying vec4 vLC;
varying vec3 vLT;
varying vec3 vLS;
varying vec3 vLW;
float lRopeH(float ph,out float d){float cs=.5+.5*cos(6.2832*ph),c3=cs*cs*cs;d=-12.566*c3*sin(6.2832*ph);return c3*cs;}
float lCrack,lGloss,lStatic;
vec3 lEmit;
vec4 lC;
`;
const TONGUE_COLOR = /* glsl */ `
{
  const float TILE=${TILE_TONGUE.toFixed(2)};
  float ac=abs(vLA.y),X=vLA.x,Y=vLA.y*vLA.z,temp=vLA.w,act=vLB.x,lev=vLB.y,lobe=vLB.w;
  // Weights: at rest (levee, stopped lobes), plug (moves exactly), shear band (dual phase). Smooth over |c|.
  float pe=mix(.55,1.08,lobe);
  float leveeW=smoothstep(.72,.94,ac)*lev;
  float wS=max(leveeW,1.-smoothstep(.0,.35,act));
  float wP=(1.-smoothstep(pe-.12,pe+.12,ac))*(1.-wS);
  float wB=max(0.,1.-wS-wP);
  // At rest means no time term at all: no swell under this pixel either.
  lStatic=wS*(1.-step(1e-5,vLC.y));
  float e=clamp((ac-pe)/max(.84-pe,.05),0.,1.);
  float prof=1.-e*e;
  // On the toe's face X barely changes while the surface climbs; add the height so the face is not combed.
  X+=smoothstep(.15,.5,vLC.x)*vLC.w*3.;
  // Anisotropic crust: plates on the plug and at rest are squeezed across (1.6x longer than wide); the shear bands tear
  // theirs into streaks 2.8x longer than wide; on the spreading lobe the plates relax towards round. Only the across
  // scale changes on the moving plug, so the plug shift still wraps on whole texture repeats.
  float sx=mix(1.6,1.15,lobe);
  vec4 cs=texture2D(uCrust,vec2(Y*sx,X)/TILE);
  vec4 cp=texture2D(uCrust,vec2(Y*sx,X-uShift)/TILE+vec2(.5,.13));
  float jit=texture2D(uCrust,vec2(Y,X)/TILE*.11+.3).a;
  float a=fract(uPhB+jit),b=fract(a+.5);
  float st=mix(.45,.8,lobe),bx=mix(1.25,1.,lobe);
  vec4 bA=texture2D(uCrust,vec2(Y*bx,(X-${U0}*prof*${T_BAND}.*a)*st)/TILE+vec2(.21,.0));
  vec4 bB=texture2D(uCrust,vec2(Y*bx,(X-${U0}*prof*${T_BAND}.*b)*st)/TILE+vec2(.58,.71));
  vec4 cb=mix(bA,bB,abs(2.*a-1.));
  lC=cs*wS+cp*wP+cb*wB;
  float r=lC.r,fine=lC.b,id=lC.g,nz=lC.a;
  float face=smoothstep(.1,.38,vLC.x)*act*(1.-smoothstep(.72,.9,ac)*lev);
  // Hot, fast lava on the cone is mostly open melt carrying crust rafts; by the toe the crust has closed up.
  float open=smoothstep(.6,1.,temp);
  // An older flow at rest (not a levee) keeps thin cracks that still show the heat inside.
  float old=(1.-smoothstep(.0,.35,act))*(1.-leveeW);
  float cold=1.-smoothstep(.2,.42,temp);
  float cw=((.035+.75*open*open+.1*wB*temp)*(1.-.85*wS)+.05*old*(1.-.6*cold))*mix(.7,1.25,nz);
  float aa=fwidth(r)*1.1+.004;
  lCrack=1.-smoothstep(cw-aa,cw+aa,r);
  // Hot crust breaks up along its fine cracks too: rafts of every size on the cone, whole plates by the toe.
  float fw=.3*open*open*(1.-wS),fa=fwidth(fine)+.004;
  lCrack=max(lCrack,(1.-smoothstep(fw-fa,fw+fa,fine))*step(.001,fw));
  float fineLine=1.-smoothstep(.0,.06+fwidth(fine),fine);
  // Rope folds: crest lines bowed downstream (the middle runs ahead), crowding where the flow slows.
  float ropeAmp=.06*smoothstep(.12,.4,vLC.z)*(1.-open)*(1.-face);
  float dP,dS;
  // Bow about 0.45 half-widths in metres (material units are compressed by vLB.z), wobbling with the crust.
  float bow=.45*vLA.z*vLB.z*vLA.y*vLA.y;
  float phP=(X-uShift+bow)/1.1+.35*nz,phS=(X+bow)/1.1+.35*cs.a;
  float rP=lRopeH(phP,dP),rS=lRopeH(phS,dS);
  float kS=wS*(1.-leveeW);
  // Albedo: basalt crust, older and greyer on levees, fine cooling cracks; no baked shading.
  vec3 bas=vec3(.032,.028,.029)*(.7+.6*nz)*(.85+.3*id);
  bas=mix(bas,vec3(.062,.056,.054)*(.75+.5*nz),leveeW*.85);
  bas*=1.-.45*fineLine*(1.-open);
  float ox=smoothstep(cw,cw+.04,r)*(1.-smoothstep(cw+.04,cw+.1,r))*temp*(1.-wS)*(1.-open);
  bas=mix(bas,vec3(.09,.08,.078),ox*.35);
  diffuseColor.rgb=bas*(1.-lCrack);
  // Glow: cracks at the flow's temperature, cooler skin at their edges; torn shear bands and the toe face hotter.
  // The inside stays hot whatever the skin does: a crack shows it, brightest along its middle where the crust tore,
  // dimming to a dull skin at the plate's edge. Stopped lobes and levees have cooled through.
  float pulse=mix(1.,.86+.14*sin(uPulse+id*6.283),1.-wS);
  float inner=mix(.5,.93,act*(1.-leveeW))*mix(1.,.86,smoothstep(.3,.9,vLC.z))*mix(1.,.7,cold);
  // On cooling crust only some cracks still glow; the others have sealed dark (most of them on a cold flow).
  float gate=mix(smoothstep(.38+.22*cold,.7+.2*cold,nz+.25*id),1.,open);
  float heat=inner*mix(1.,.62,smoothstep(0.,cw+aa,r))*(.86+.14*nz)*pulse*mix(.45,1.,gate)+.06*wB;
  lEmit=lavaBB(heat)*lCrack;
  // A moving toe's face: melt squeezing out in a seam along its foot, the crust above it stretched and dark.
  float seam=face*(1.-smoothstep(.05,.2,vLC.w))*smoothstep(.0,.03,vLC.w)*smoothstep(.25,.6,nz+.2*sin(uPulse*.5+vLW.x*1.7+vLW.z*1.3));
  lEmit+=lavaBB(.9*inner/.93)*seam;
  diffuseColor.rgb*=1.-seam;
  lEmit+=lavaBB(temp*.62)*fineLine*open*(1.-lCrack)*(1.-wS);
  // Rope troughs: a thin glowing line in the bottom of each fold (rP is cos^4, so its fourth root is the cosine).
  // Only some folds are torn deep enough to glow, so the arcs do not stack up like rungs.
  float trough=(1.-smoothstep(.0,.3,sqrt(sqrt(rP))))*smoothstep(.45,.7,nz+.3*id);
  lEmit+=lavaBB(temp*.55)*trough*wP*ropeAmp*8.*(1.-lCrack);
  // Clear coat: broken glints on rope crests and the domed middles of young plates, split by the fine cracks.
  float young=smoothstep(.62,.8,id)*smoothstep(.35,.7,temp)*smoothstep(cw,cw+.03,r)*(1.-smoothstep(cw+.06,cw+.16,r));
  float crest=smoothstep(.6,.95,rP)*wP*smoothstep(0.,.03,ropeAmp);
  lGloss=uDetail*act*(1.-wS)*(1.-lCrack)*(1.-face)*max(crest*.8,young*.7)*smoothstep(.15,.35,fine);
  // Rope relief, analytic: along s (via the material compression) and across.
  float dXP=ropeAmp*wP*dP/1.1,dXS=.035*kS*dS/1.1;
  float dhds=(dXP+dXS)*vLB.z;
  float dhdv=(dXP+dXS)*.9*vLB.z*vLA.y;
  lRopeG=vec2(dhds,dhdv);
}
`;
const TONGUE_ROUGH = /* glsl */ `
roughnessFactor=mix(mix(.86,.93,lStatic),.42,lCrack);
roughnessFactor=mix(roughnessFactor,.6,smoothstep(.6,.82,lC.g)*(1.-lStatic)*(1.-lCrack)*smoothstep(.35,.7,vLA.w));
// Gloss: broken glints on young crust and rope crests only, from roughness (0.34), never a lacquered sheet.
roughnessFactor=mix(roughnessFactor,.34,lGloss);
roughnessFactor=max(roughnessFactor,.3);
`;
const TONGUE_NORMAL = /* glsl */ `
{
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  vec3 g=normalize(vLT)*lRopeG.x+normalize(vLS)*lRopeG.y;
  float near=1.-smoothstep(.03,.12,length(fwidth(vLW)));
  float hc=(-.06*lCrack+.05*sqrt(lC.r)-.012*(1.-smoothstep(0.,.08,lC.b)))*near;
  g+=lavaBumpGrad(vLW,nW,hc);
  g-=dot(g,nW)*nW;
  nW=normalize(nW-g);
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;
const TONGUE_EMIT = /* glsl */ `
totalEmissiveRadiance=lEmit;
`;
const TONGUE_LIGHT = `#include <aomap_fragment>\n${CRUST_LIGHT}`;

/* Pool shaders (molten sea, crater lake) -------------------------------------------------------------------------- */

const POOL_VERT_HEAD = 'varying vec3 vLW;';
const POOL_VERT_TAIL = 'vLW=(modelMatrix*vec4(transformed,1.)).xyz;';
const POOL_FRAG_HEAD = /* glsl */ `
${LAVA_COMMON}
uniform float uPh;
uniform vec3 uCentre; // crater: centre x, z and lake radius
varying vec3 vLW;
float lCrack,lStatic,lMelt,lFar;
vec3 lEmit;
vec4 lC;
// Sea hex tiling (after Mikkelsen 2022): a triangle grid of hex centres, each with its own offset, rotation and scale
// (0.8-1.25) of the crust; a point takes the three of its triangle, weighted by its barycentric weights sharpened to the
// 4th power. A tap's cracks keep their width down to half weight, then narrow to nothing (they are never cross-faded),
// so where two hexes meet the plates of both nets are cut by each other's tapering cracks, never blurred or thinned.
// Taps under 2 % are skipped (most pixels read one or two). Explicit gradients from the untransformed coordinate keep
// the mip level steady where the taps change.
// Out: r crack distance and b fine cracks (min), g plate id and a noise (weighted); r2 the hot leads' cracks (2.7x).
vec2 seaHash(vec2 v){return fract(sin(vec2(dot(v,vec2(127.1,311.7)),dot(v,vec2(269.5,183.3))))*43758.5453);}
void seaTap(vec2 v,float w,vec2 uv,vec2 dx,vec2 dy,float hot,inout vec4 c,inout float ws,inout float r2){
  if(w<.02)return;
  vec2 h=seaHash(v);
  float an=h.x*6.2832,sc=mix(.8,1.25,fract(h.y*13.7));
  mat2 M=mat2(cos(an),sin(an),-sin(an),cos(an))*sc;
  vec2 u=M*uv+h;
  vec4 t=textureGrad(uCrust,u,M*dx,M*dy);
  float fade=(1.-smoothstep(.12,.5,w))*1.2;
  c.r=min(c.r,t.r+fade);c.b=min(c.b,t.b+fade);c.ga+=t.ga*w;ws+=w;
  if(hot>.001)r2=min(r2,textureGrad(uCrust,u*2.7+vec2(.31,.57),M*dx*2.7,M*dy*2.7).r+fade);
}
vec4 seaHex(vec2 uv,vec2 dx,vec2 dy,float hot,out float r2){
  // A gentle shear of the grid bends the hex borders, so no straight line of crack ends shows from the air.
  vec2 st=uv*${HEX_SEA.toFixed(2)}+.25*sin(uv.yx*vec2(2.1,1.7)+vec2(1.3,.4));
  vec2 sk=vec2(st.x-.57735027*st.y,1.15470054*st.y),b=floor(sk),f=sk-b;
  float z=1.-f.x-f.y,s=step(z,0.),s2=2.*s-1.;
  vec3 w=pow(max(vec3(-z*s2,s-f.y*s2,s-f.x*s2),0.),vec3(4.));w/=w.x+w.y+w.z;
  vec4 c=vec4(9.,0.,9.,0.);float ws=0.;r2=9.;
  seaTap(b+vec2(s),w.x,uv,dx,dy,hot,c,ws,r2);
  seaTap(b+vec2(s,1.-s),w.y,uv,dx,dy,hot,c,ws,r2);
  seaTap(b+vec2(1.-s,s),w.z,uv,dx,dy,hot,c,ws,r2);
  return vec4(min(c.r,1.),c.g/ws,min(c.b,1.),c.a/ws);
}
`;
function poolColor(sea: boolean): string {
  const tile = sea ? TILE_SEA : TILE_LAKE, period = sea ? T_SEA : T_LAKE;
  return /* glsl */ `
{
  const float TILE=${tile.toFixed(2)};
  vec2 p=vLW.xz;
  vec2 vel;float flowW,temp,margin;
  ${sea ? /* glsl */ `
  // Slow eddies from a stream function (curl, so the crust neither piles up nor opens), 0.05..0.12 m/s.
  float s1=sin(.031*p.x+.7),c1=cos(.031*p.x+.7),s2=sin(.027*p.y-.3),c2=cos(.027*p.y-.3);
  float a3=.019*p.x-.045*p.y+1.9,a4=.052*p.x+.038*p.y;
  vec2 grad=vec2(1.8*.031*c1*c2+1.3*.019*cos(a3)+.8*.052*cos(a4),-1.8*.027*s1*s2-1.3*.045*cos(a3)+.8*.038*cos(a4));
  vel=vec2(grad.y,-grad.x)*.75;
  // The crust welds to the island: still within 3 m of the shore, a torn bright seam where it lets go.
  float e=length(vec2(p.x/128.,(p.y-2.)/155.));
  vec2 ge=vec2(p.x/16384.,(p.y-2.)/24025.)/max(e,1e-3);
  float shore=(e-.899)/max(length(ge),1e-5);
  flowW=smoothstep(3.,10.,shore);
  margin=exp(-pow((shore-8.)/4.,2.));
  // Broad cool rafts and hot open leads, fixed in space; plates drift through them.
  float macro=texture2D(uCrust,p/430.+.17).a;
  float jit=macro*2.3; // the phase offset varies as slowly as the rafts
  // Near the island the sea is stirred by the volcano's own outflow: hotter, more open within ~60 m of the shore.
  temp=max(mix(.35,1.,smoothstep(.36,.7,macro)),.84*(1.-smoothstep(20.,70.,shore))*flowW);
  lMelt=smoothstep(.7,.85,macro);
  ` : /* glsl */ `
  float jit=texture2D(uCrust,p/TILE*.21+.4).a*2.3;
  // Convection cell: crust is born over the upwelling in the middle, drifts out and founders at the walls.
  vec2 d=p-uCentre.xy;float rr=length(d),R=uCentre.z;
  vel=d/max(rr,.01)*.1*smoothstep(0.,2.5,rr)*(1.-smoothstep(R-1.2,R-.2,rr))+vec2(-d.y,d.x)*.012;
  flowW=1.;
  margin=smoothstep(R-1.6,R-.5,rr);
  temp=mix(.66,1.,max(margin,1.-smoothstep(.8,2.4,rr)));
  lMelt=1.-smoothstep(.9,2.,rr);
  `}
  lStatic=1.-step(.001,flowW);
  vel*=flowW;
  vec2 q=p/TILE;
  float a=fract(uPh+jit),b=fract(a+.5);
  float ang=1.9*flowW;mat2 rot=mat2(cos(ang),sin(ang),-sin(ang),cos(ang));
  ${sea ? /* glsl */ `// Hot leads: thinner crust broken into plates a third the size; the cool rafts stay whole, so the sea mixes
  // big rafts and small plates instead of one net at one scale. The mask varies over hundreds of metres. Both
  // phases are hex-tiled (each on its own grid, which drifts with its plates).
  float sm=smoothstep(.5,.64,macro);
  vec2 qdx=dFdx(q),qdy=dFdy(q);
  float rA2,rB2,wB=abs(2.*a-1.)*flowW;
  vec4 A=seaHex((p-vel*${period}.*a)/TILE,qdx,qdy,sm,rA2);
  vec4 B=seaHex(rot*((p-vel*${period}.*b)/TILE)+vec2(.37,.71)*flowW,rot*qdx,rot*qdy,sm,rB2);
  lC=mix(A,B,wB);
  // The small plates fade out on their own (from 2.7x nearer than the big ones), so far hot leads still show the big
  // net with wide glowing cracks instead of one smooth wash; hotFar brings back their average glow.
  float hotFar=smoothstep(.1,.4,length(fwidth(q*${CELLS}.))*2.7)*sm;
  if(sm>.001)lC.r=min(lC.r,mix(1.,mix(rA2,rB2,wB)*1.6,sm-hotFar));` : /* glsl */ `vec4 A=texture2D(uCrust,(p-vel*${period}.*a)/TILE);
  vec4 B=texture2D(uCrust,rot*((p-vel*${period}.*b)/TILE)+vec2(.37,.71)*flowW);
  lC=mix(A,B,abs(2.*a-1.)*flowW);`}
  float r=lC.r,fine=lC.b,id=lC.g,nz=lC.a;
  // Far away the cracks average out to a warm crust instead of sparkling.
  float far=smoothstep(.1,.4,length(fwidth(q*${CELLS}.)));
  lFar=far;
  // Melt between the plates: wide in hot leads, hairline under the cool rafts.
  float cw=(mix(.07,.46,pow(smoothstep(.45,1.,temp),1.6))+lMelt*.15+margin*.16)*mix(.7,1.25,nz);
  float aa=fwidth(r)*1.1+.004;
  lCrack=mix(1.-smoothstep(cw-aa,cw+aa,r),clamp(cw*1.15,0.,1.),far);
  ${sea ? 'lCrack=mix(lCrack,max(lCrack,clamp(cw*1.15,0.,1.)),hotFar*.45);' : ''}
  float fineLine=(1.-smoothstep(.0,.06+fwidth(fine),fine))*(1.-far);
  vec3 bas=vec3(.026,.023,.024)*(.7+.6*nz)*(.85+.3*id);
  bas*=1.-.45*fineLine*(1.-smoothstep(.6,1.,temp));
  diffuseColor.rgb=bas*(1.-lCrack);
  float pulse=mix(1.,.86+.14*sin(uPulse+id*6.283),flowW);
  float edge=mix(smoothstep(0.,cw+aa,r),.55,far);
  float heat=${sea ? '.86' : '.95'}*mix(.85,1.,temp)*mix(1.,.6,edge)*(.86+.14*nz)*pulse+margin*.1;
  lEmit=lavaBB(heat)*lCrack+lavaBB(.55)*fineLine*smoothstep(.75,1.,temp)*(1.-lCrack);
}
`;
}
const POOL_ROUGH = /* glsl */ `
// Crust .86; molten cracks .4; the broad open melt (hot leads, the lake's upwelling) .36 for one soft highlight.
roughnessFactor=max(mix(mix(.86,.4,lCrack),.36,lMelt*lCrack),.3);
`;
/** The sea from the sun's side: low sun, grazing view, so the Fresnel term lit the cool rafts as a pale sheen across
 * the plates. Far away the cracks average into lCrack, and their gloss (0.4) spread over the whole surface; there the
 * crust keeps its own roughness (the averaged glow stays). The sun's highlight is cut to 15 % on the crust and 50 % on
 * the cracks, so plates read as dark crust towards the sun as well. */
const SEA_ROUGH = /* glsl */ `
float lGl=lCrack*(1.-lFar);
roughnessFactor=max(mix(mix(.86,.4,lGl),.36,lMelt*lGl),.3);
`;
const SEA_SPECULAR = /* glsl */ `
#include <aomap_fragment>
reflectedLight.directSpecular*=mix(.15,.5,lGl);
`;
const POOL_NORMAL = /* glsl */ `
if(uDetail>.5){
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  float near=1.-smoothstep(.04,.2,length(fwidth(vLW)));
  float h=(.08*sqrt(lC.r)-.05*lCrack)*near;
  vec3 g=lavaBumpGrad(vLW,nW,h);
  g-=dot(g,nW)*nW;
  nW=normalize(nW-g);
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;
const POOL_EMIT = 'totalEmissiveRadiance=lEmit;';
/** Debug view for the stillness measure: red where the shader has no time term, blue where it flows (mode 2 swaps). */
const MASK_OUT = /* glsl */ `
#include <dithering_fragment>
if(uMask>.5){float still=step(.999,lStatic);if(uMask>1.5)still=1.-still;gl_FragColor=vec4(still,0.,1.-still,1.);}
`;

/* Simulated lava on the plateau (emberLavaFlow.ts) -------------------------------------------------------------- */

/** Plates on the simulated lava, m, and the dual-phase period of its crust, s: fed lobes move at 0.1-0.2 m/s (p90,
 * up to 0.37), so a pattern slides about one plate before it is renewed; shorter periods read as the cracks morphing. */
const PLATE_FLOW = 1.05, TILE_FLOW = CELLS * PLATE_FLOW, T_FLOW = 6;
/** How far the tongues run onto the ground before the simulated lava takes over, m. */
const FLOW_NOSE = 1.4;

const FLOW_VERT_HEAD = /* glsl */ `
attribute vec2 aCell;
uniform sampler2D uFR0;
uniform highp sampler2D uFBase;
uniform vec2 uFTexel;
varying vec2 vFU;
varying vec3 vFW;
varying float vLift;
varying vec3 vFN;
float fGround(ivec2 i){return texelFetch(uFBase,clamp(i,ivec2(0),textureSize(uFBase,0)-1),0).r;}
// The lift the mesh draws at a vertex (see FLOW_VERT_BEGIN): the thickness (3x3-rounded) where there is lava, the
// blurred thickness less 4 cm beside it, sunk 0.6 m far from it.
float fLift(vec4 r){return mix(max(r.r,r.a),mix(-.6,r.a*1.3-.05,smoothstep(.01,.05,r.a)),1.-smoothstep(.005,.02,r.r));}
// Shading height: the 5x5-blurred thickness on the domes; at the margin the drawn lift itself, so the shoulder turns
// away from the light where the mesh does instead of reading as a soft ramp.
// (Cut off at 0.12 m under the ground: the deep sink of far cells is not a slope to light.)
float fShade(ivec2 i,vec2 uv,float w){vec4 r=texture2D(uFR0,uv);return fGround(i)+mix(max(fLift(r),-.12),r.g,w);}
`;
/** Shading normal from the blurred thickness on the ground (isaac #944: normals softer than positions, so domes light
 * round), from the drawn thickness at the margin so the shoulder reads. */
const FLOW_VERT_NORMAL = /* glsl */ `
ivec2 fI=ivec2(aCell/uFTexel);
vec2 fX=vec2(uFTexel.x,0.),fZ=vec2(0.,uFTexel.y);
float fW=smoothstep(.25,.6,texture2D(uFR0,aCell).r);
float fdx=fShade(fI+ivec2(1,0),aCell+fX,fW)-fShade(fI-ivec2(1,0),aCell-fX,fW);
float fdz=fShade(fI+ivec2(0,1),aCell+fZ,fW)-fShade(fI-ivec2(0,1),aCell-fZ,fW);
vec3 objectNormal=normalize(vec3(-fdx,${(2 * FLOW_CELL).toFixed(3)},-fdz));
`;
/** Lift each covered vertex by the lava's thickness, or the 3x3-blurred thickness where that is more, so the top
 * rolls over convexly. An empty vertex beside the lava takes the blurred thickness less 4 cm (steeper than the blur
 * alone, so the front leaves the ground as a shoulder instead of a ramp), its ground contact following the blurred
 * field's smooth contour. Far from the lava it sinks 0.6 m: deep enough that the empty triangles stay under the ground
 * even across the cone foot's crease on the half-resolution mesh (they would show as black teeth there). */
const FLOW_VERT_BEGIN = /* glsl */ `
vec3 transformed=vec3(position);
vec4 fR=texture2D(uFR0,aCell);
vLift=fLift(fR);
transformed.y+=vLift;
vFU=aCell;
`;
const FLOW_VERT_TAIL = 'vFW=(modelMatrix*vec4(transformed,1.)).xyz;vFN=normalize(mat3(modelMatrix)*objectNormal);';
const FLOW_FRAG_HEAD = /* glsl */ `
${LAVA_COMMON}
uniform sampler2D uFR0;
uniform sampler2D uFR1;
uniform float uPhF;
varying vec2 vFU;
varying vec3 vFW;
varying float vLift;
varying vec3 vFN;
float lRopeH(float ph,out float d){float cs=.5+.5*cos(6.2832*ph),c3=cs*cs*cs;d=-12.566*c3*sin(6.2832*ph);return c3*cs;}
float lCrack,lGloss,lStatic,lEdge,lRope,lHot,lCav;
vec3 lEmit;
vec4 lC;
`;
const FLOW_COLOR = /* glsl */ `
{
  const float TILE=${TILE_FLOW.toFixed(2)};
  vec4 r0=texture2D(uFR0,vFU),r1=texture2D(uFR1,vFU);
  float T=r0.b,act=r1.z;
  vec2 vel=r1.xy;
  // Moving lava carries its crust (dual phase along the sim's velocity); lava at rest has no time term at all. The two
  // phases are blended as crack masks, not as distances, which would open blobs where their networks cross.
  float wM=smoothstep(.002,.012,length(vel));
  lStatic=1.-step(1e-5,wM);
  // Material coordinates on the ground plane, unfolded up the fronts (shifted outward by the height above the ground
  // along the smooth normal), so a front's face carries crust instead of one stretched texel.
  vec2 p=vFW.xz+normalize(vFN).xz*clamp(vLift,0.,.6)*1.4;
  vec4 cs=texture2D(uCrust,p/TILE);
  float jit=texture2D(uCrust,p/TILE*.11+.3).a;
  float a=fract(uPhF+jit),b=fract(a+.5),wB=abs(2.*a-1.);
  vec2 adv=vel*${T_FLOW}.;
  vec4 A=texture2D(uCrust,(p-adv*a)/TILE);
  vec4 B=texture2D(uCrust,(p-adv*b)/TILE+vec2(.37,.71));
  lC=mix(cs,mix(A,B,wB),wM);
  float fine=lC.b,id=lC.g,nz=cs.a;
  float hot=smoothstep(.3,.95,T);
  lHot=hot;
  // The margin, from the mesh's interpolated lift (exact where it meets the ground): the lowest ~0.12 m of a front is
  // a rubbly clinker skin, under it a thin oxidised rim and the contact line. Above it the face keeps the crust.
  float hr=max(r0.r,r0.a);
  lEdge=1.-smoothstep(.03,.16,vLift);
  float rim=1.-smoothstep(.02,.09,vLift);
  float contact=1.-smoothstep(-.02,.08,vLift);
  float cw=((.042+.05*hot+.05*hot*hot*wM)*(1.-.5*lEdge))*mix(.7,1.25,nz);
  float aS=fwidth(cs.r)*1.1+.004,aA=fwidth(A.r)*1.1+.004,aB=fwidth(B.r)*1.1+.004;
  float kS=1.-smoothstep(cw-aS,cw+aS,cs.r),kA=1.-smoothstep(cw-aA,cw+aA,A.r),kB=1.-smoothstep(cw-aB,cw+aB,B.r);
  lCrack=mix(kS,mix(kA,kB,wB),wM);
  // As it cools only the middle of a crack still shows the heat, deep down: the glowing core narrows to under half
  // the crack's width.
  float cc=cw*mix(.4,1.,hot);
  float gS=1.-smoothstep(cc-aS,cc+aS,cs.r),gA=1.-smoothstep(cc-aA,cc+aA,A.r),gB=1.-smoothstep(cc-aB,cc+aB,B.r);
  float core=mix(gS,mix(gA,gB,wB),wM);
  // Distance into the plate, for the heat falling off from a crack's middle (each phase its own).
  float eS=smoothstep(0.,cw+aS,cs.r),eM=mix(smoothstep(0.,cw+aA,A.r),smoothstep(0.,cw+aB,B.r),wB);
  float edge=mix(eS,eM,wM);
  float fineLine=1.-smoothstep(.0,.06+fwidth(fine),fine);
  // Pahoehoe ropes on the lobe's skin, concentric with its margin, so their crests bow out the way the lobe spread: a
  // yield dome h = sqrt(2 d x) puts x = h^2 / 2d metres in from its margin. In patches, never on the clinker margin
  // or the flat middle of a big lobe; at rest they come from the thickness alone (no time term).
  float big=texture2D(uCrust,p/6.3+.29).a,wob=texture2D(uCrust,p/1.9+.71).a;
  // From the 5x5-blurred thickness the lava had when it froze (subsidence does not move the folds), smooth enough that
  // they do not show the cells.
  float xin=r1.w*r1.w/${(2 * YIELD_D).toFixed(2)};
  float dR,rope=lRopeH(xin/.3+2.6*big+.9*wob,dR);
  float ropeW=smoothstep(.42,.6,big+.25*wob)*smoothstep(.12,.45,xin)*(1.-smoothstep(2.6,4.2,xin))*(1.-.5*wM);
  // Torn into short arcs: a fold runs a metre or two, then breaks.
  ropeW*=smoothstep(.25,.5,texture2D(uCrust,vec2(p.x+p.y,p.y-p.x)/3.1+.13).a+.3*rope);
  lRope=.05*ropeW*rope;
  // Albedo: near-black basalt as on the tongues, darkening into the cracks and the rope troughs; fine cooling cracks.
  vec3 bas=vec3(.022,.02,.021)*(.7+.6*nz)*(.85+.3*id);
  bas*=1.-.45*fineLine*(1.-hot);
  // Cavities: plates darken into their cracks, rope troughs under their crests. Applied to the light as a whole
  // (specular included, see FLOW_CAVITY), or a dark rough skin reads as a grey haze.
  lCav=mix(.4,1.,smoothstep(0.,cw*2.8+aS,lC.r))*(1.-.5*ropeW*(1.-smoothstep(.0,.4,rope)))*(1.-.85*lCrack);
  // Clinker skin low on the front, then a thin oxidised rim (rust-dark) and the contact line where it meets the ground.
  float rub=texture2D(uCrust,p/2.9+.53).a;
  bas=mix(bas,vec3(.014,.013,.013)*(.5+1.*rub),lEdge*.75);
  bas=mix(bas,vec3(.016,.009,.007)*(.6+.8*rub),rim*.8);
  diffuseColor.rgb=bas*(1.-lCrack);
  // Glow: the cracks show the inside's heat, brightest along their middle. Hot lava glows across every crack; cooling
  // rock keeps a dull red only deep in some of them, fading as its temperature falls (a monotonic fade over a few
  // minutes, the temperature channel alone); under T 0.1 it is dark.
  float inner=.93*pow(smoothstep(.04,.92,T),.6);
  float gate=mix(smoothstep(.42,.72,nz+.3*id),1.,hot);
  float pulse=mix(1.,.86+.14*sin(uPulse+id*6.283),wM);
  float heat=inner*mix(1.,.62,edge)*(.86+.14*nz)*pulse;
  lEmit=lavaBB(heat)*core*gate;
  // A moving hot front squeezes a glowing seam out along its foot; elsewhere the foot is the dark contact line.
  float seam=smoothstep(.04,.3,act)*hot*(1.-smoothstep(.05,.12,vLift))*smoothstep(-.03,.0,vLift)*smoothstep(.3,.55,rub+.3*nz);
  lEmit+=lavaBB(.9*inner/.93)*seam;
  diffuseColor.rgb*=1.-seam;
  // The rubbly margin is dark too: its rubble shadows itself.
  lCav*=mix(1.,.35+.45*rub,lEdge*(1.-hot))*(1.-.85*contact*(1.-seam));
  // Stretching skin on moving lava tears along its fine cracks too.
  lEmit+=lavaBB(T*.5)*fineLine*hot*wM*(1.-lCrack)*.5;
  // Clear coat: broken glints on the domed middles of young plates (moving) and on rope crests, fresher ones glossier.
  float young=smoothstep(.62,.8,id)*hot*(1.-lCrack)*smoothstep(.02,.06,lC.r-cw)*(1.-smoothstep(.06,.16,lC.r-cw));
  float crest=smoothstep(.55,.9,rope)*ropeW*smoothstep(.45,.7,nz+.5*fine)*mix(.45,.85,smoothstep(.04,.3,T));
  lGloss=uDetail*(1.-lEdge)*(1.-lCrack)*max(young*.7*wM*smoothstep(.15,.35,fine),crest);
}
`;
/** Cooled pahoehoe skin is glassy: 0.62-0.82 by plate, so light breaks into glints on its relief instead of a hazy
 * sheen; molten cracks 0.42, cold cracks and the clinker margin rough; broken glints on crests 0.36; never under 0.30. */
const FLOW_ROUGH = /* glsl */ `
roughnessFactor=mix(mix(.62,.82,fract(lC.g*7.3)),mix(.92,.42,lHot),lCrack);
roughnessFactor=mix(roughnessFactor,.95,lEdge*(1.-lCrack));
roughnessFactor=mix(roughnessFactor,.36,lGloss);
roughnessFactor=max(roughnessFactor,.3);
`;
const FLOW_CAVITY = /* glsl */ `
#include <aomap_fragment>
reflectedLight.directDiffuse*=lCav;reflectedLight.directSpecular*=lCav;
reflectedLight.indirectDiffuse*=lCav;reflectedLight.indirectSpecular*=lCav;
${CRUST_LIGHT}
`;
const FLOW_NORMAL = /* glsl */ `
{
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  // Relief fades with distance (not with the triangle's screen footprint, which jumps between facets of a steep front)
  // and on the clinker margin.
  float near=1.-smoothstep(12.,30.,distance(cameraPosition,vFW));
  // Plates domed between their cracks, the fine cooling cracks, and wrinkles in the skin at two scales.
  vec2 wq=vFW.xz+normalize(vFN).xz*clamp(vLift,0.,.6)*1.4;
  float wr=texture2D(uCrust,wq/2.1+.17).a*.6+texture2D(uCrust,wq/.9+.61).a*.4;
  float rb=texture2D(uCrust,wq/.55+.37).a;
  float hc=((-.07*lCrack+.08*sqrt(lC.r)-.018*(1.-smoothstep(0.,.08,lC.b))+.045*wr+lRope)*(1.-.6*lEdge)+.04*rb*lEdge)*near;
  vec3 g=lavaBumpGrad(vFW,nW,hc);
  g-=dot(g,nW)*nW;
  nW=normalize(nW-g);
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

/* ---------------------------------------------------------------------------------------------------------------- */
/* Geometry                                                                                                            */

interface TongueDef {
  /** Azimuth of the flow's spillway notch in the crater rim: 0 faces the sanctuary, positive towards +x. */
  angle: number;
  /** Channel width on the cone, m; the lobe on the ground is sized from volume. */
  width: number;
  /** Sideways wander down the slope: amplitude (m), wavelength along the radius (m), phase. */
  wander: [number, number, number][];
  /** Metres the front runs past the cone foot; for a stub, the radius on the cone where it stalled. */
  run: number;
  stub?: boolean;
  /** Angular drift on the ground, rad. */
  bend: number;
  volume: number;
  /** 1 a live flow; below 1 an older flow at rest, cooled through, its cracks glowing faintly (lower is colder). */
  heat: number;
  /** Depth of its spillway notch in the crater rim, m (a breakout has none). */
  notch: number;
  seed: number;
  /** Front toes: c position, how far they reach (m), width in c. */
  toes: [number, number, number][];
  /** A stopped side lobe budding off one flank at the foot. */
  side: { sign: -1 | 1; volume: number } | null;
  /** A breakout: leaves tongue `from` at radius `rho` and has drifted `drift` metres sideways 9 m further down. */
  branch?: { from: number; rho: number; drift: number };
}
const DEG = Math.PI / 180;
/** Uneven on purpose: most flows face the sanctuary, none go north to the sea, widths 2 to 3.8 m, one breakout, one
 * stalled stub and one older crusted flow. Wander curvature stays under 1 / (1.4 half width) so no ribbon folds. */
const TONGUES: TongueDef[] = [
  // West flank: a live flow with a side lobe at its foot.
  { angle: -63 * DEG, width: 2.5, wander: [[1.3, 15, .4], [.3, 9, 2.1]], run: 6.5, bend: .07, volume: 15, heat: 1, notch: .9, seed: 1, toes: [[-.4, 1.2, .3], [.42, 1.6, .32]], side: { sign: 1, volume: 6 } },
  // The main flow, widest, a little west of the sanctuary axis.
  { angle: -24 * DEG, width: 3.8, wander: [[1.6, 17, 2.6], [.3, 10, .3]], run: 9, bend: -.05, volume: 24, heat: 1, notch: 1.1, seed: 2, toes: [[.1, 1.6, .34], [-.62, 1.0, .28]], side: { sign: -1, volume: 7 } },
  // Breakout from the main flow at mid-slope, peeling off towards the centre.
  { angle: -10 * DEG, width: 2.0, wander: [[.6, 12, 1.2]], run: 5, bend: .05, volume: 10, heat: 1, notch: 0, seed: 3, toes: [[.35, 1.2, .32], [-.3, .8, .28]], side: null, branch: { from: 1, rho: 14.5, drift: 6.5 } },
  // A short flow that stalled high on the cone: a cooled dark snout.
  { angle: 8 * DEG, width: 2.4, wander: [[.6, 11, 3.3]], run: 15, stub: true, bend: 0, volume: 4, heat: .35, notch: .45, seed: 4, toes: [[.2, .5, .4]], side: null },
  // An older flow, crusted through, its cracks glowing faintly.
  { angle: 26 * DEG, width: 3.0, wander: [[1.5, 16, 4.4], [.35, 8.5, 1.]], run: 7, bend: .08, volume: 18, heat: .55, notch: .6, seed: 5, toes: [[-.3, 1.4, .32], [.5, 1.0, .28]], side: { sign: 1, volume: 6 } },
  // East flank: a narrow live flow.
  { angle: 58 * DEG, width: 2.2, wander: [[1.1, 14, 5.5], [.3, 7, .7]], run: 5.5, bend: -.09, volume: 13, heat: 1, notch: .8, seed: 6, toes: [[.4, 1.0, .32], [-.35, 1.4, .32]], side: null },
];
type TongueMode = 'sim' | 'lobe';
interface TongueSet { geo: Record<LavaQuality, THREE.BufferGeometry[]>; halo: THREE.Mesh; clinker: THREE.InstancedMesh; count: number; zones: LavaZone[] }
/** Steps run at once the first time the simulated lava is drawn. */
const FLOW_WARM_STEPS = 450;
const tongueNotches = () => TONGUES.filter(d => d.notch > 0).map(d => ({ a: d.angle, d: d.notch, w: (d.width / 2 + .8) / 8.7 }));

/** The surfaces lava lies on: crater lip with its spillway notches, faceted cone, and the terrain mesh exactly as frontierIsland triangulates it. */
class Support {
  readonly lakeR = 7.35;
  readonly crestR = 8.7;
  readonly crestY: number;
  readonly lakeY: number;
  private readonly lipA: number;
  readonly cone: Cone;
  private readonly height: (x: number, z: number) => number;
  private readonly notches: { a: number; d: number; w: number }[];
  constructor(cone: Cone, height: (x: number, z: number) => number, notches: { a: number; d: number; w: number }[]) {
    this.cone = cone; this.height = height; this.notches = notches;
    this.crestY = cone.topY + 1.05;
    this.lipA = this.crestY - this.coneSmooth(this.crestR);
    this.lakeY = this.lipRound(this.lakeR);
  }
  coneSmooth(rho: number) { const c = this.cone; return c.baseY + (c.baseR - rho) / (c.baseR - c.topR) * (c.topY - c.baseY); }
  coneFacet(x: number, z: number) {
    const c = this.cone, dx = x - c.x, dz = z - c.z, rho = Math.hypot(dx, dz), seg = TAU / c.segments;
    const th = Math.atan2(dx, dz), local = ((th % seg) + seg) % seg - seg / 2;
    return this.coneSmooth(rho * Math.cos(local) / Math.cos(seg / 2));
  }
  /** Depth the spillway notches cut at an azimuth and radius: full over the crest, gone at the lake and down the flank. */
  notch(ang: number, rho: number) {
    const bell = smooth(7.4, 8.4, rho) * (1 - smooth(10.2, 12.4, rho));
    if (bell <= 0) return 0;
    let n = 0;
    for (const q of this.notches) { let da = ang - q.a; da -= TAU * Math.round(da / TAU); n = Math.max(n, q.d * Math.exp(-((da / q.w) ** 2))); }
    return n * bell;
  }
  private lipBump(rho: number) { const u = (rho - this.crestR) / 1.6, k = 1.9 * 1.6 / this.lipA; return this.lipA * (1 + k * u) * Math.exp(-u * u); }
  /** The rampart round the crater lake, without notches. */
  private lipRound(rho: number) { return rho <= this.crestR ? this.crestY - 2.25 * (1 - smooth(6.6, this.crestR, rho)) : this.coneSmooth(rho) + this.lipBump(rho); }
  /** The lip: a rounded rampart round the crater lake that merges into the cone below, cut by the spillways. */
  lip(rho: number, ang: number) { return this.lipRound(rho) - this.notch(ang, rho); }
  /** The terrain as the 300 x 350 m, 2 m grid PlaneGeometry draws it (two triangles per cell, diagonal b-d). */
  terrain(x: number, z: number) {
    const fx = (x + 150) / 2, fz = (z + 175) / 2, ix = clamp(Math.floor(fx), 0, 149), iz = clamp(Math.floor(fz), 0, 174);
    const u = fx - ix, v = fz - iz, X = ix * 2 - 150, Z = iz * 2 - 175, h = this.height;
    if (u + v <= 1) { const a = h(X, Z); return a + (h(X + 2, Z) - a) * u + (h(X, Z + 2) - a) * v; }
    const c = h(X + 2, Z + 2); return c + (h(X, Z + 2) - c) * (1 - u) + (h(X + 2, Z) - c) * (1 - v);
  }
  /** Height under the lava. `faceted` false gives the smooth cone used for shading normals; k rounds the cone foot. */
  at(x: number, z: number, faceted: boolean, k: number) {
    const dx = x - this.cone.x, dz = z - this.cone.z, rho = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    if (rho <= this.crestR) return this.lip(rho, ang);
    const coneY = faceted ? mix(this.coneSmooth(rho), this.coneFacet(x, z), smooth(11.5, 13.5, rho)) : this.coneSmooth(rho);
    return smax(Math.min(coneY, this.cone.topY + 2) + this.lipBump(rho) - this.notch(ang, rho), this.terrain(x, z), k);
  }
  /** Distance from the volcano axis at which the cone meets the terrain along a direction. */
  footRadius(angle: number) {
    for (let r = 14; r < 40; r += .05) { const x = this.cone.x + Math.sin(angle) * r, z = this.cone.z + Math.cos(angle) * r; if (this.coneSmooth(r) <= this.terrain(x, z)) return r; }
    return 30;
  }
}

interface OutlinePoint { x: number; z: number; ox: number; oz: number; s: number; ground: boolean; lev: number; skip: boolean }
interface TongueBuild {
  geometry: THREE.BufferGeometry;
  /** One closed run round the tongue: left edge from the crater down, the front, the right edge back up. */
  outline: OutlinePoint[];
  zones: LavaZone[];
}

/** Sideways wander of a flow at radius rho, m; it fades in below the rim and freezes past the cone foot so lobes stay straight. */
function wanderAt(def: TongueDef, rho: number, foot: number) {
  const r = rho < foot - 3 ? rho : foot - 3 + 3 * (1 - Math.exp(-(rho - foot + 3) / 3));
  let l = 0;
  for (const [a, wl, ph] of def.wander) l += a * Math.sin(TAU * r / wl + ph);
  return l * smooth(8.4, 12, rho);
}
/** Centre-line azimuth against radius; a breakout follows its parent and peels away from it. */
function angleFn(defs: TongueDef[], i: number, sup: Support): (rho: number) => number {
  const def = defs[i], foot = sup.footRadius(def.angle);
  const own = (rho: number) => wanderAt(def, rho, foot) / rho + def.bend * smooth(foot - 2, foot + 10, rho);
  if (!def.branch) return rho => def.angle + own(rho);
  const b = def.branch, parent = angleFn(defs, b.from, sup);
  return rho => parent(rho) + b.drift * smooth(b.rho, b.rho + 9, rho) / rho + own(rho) * smooth(b.rho, b.rho + 5, rho);
}

/** One tongue: a ribbon parametrised by s (along) and c (across, -1..1) from inside the crater lake (or its parent) to its toes.
 * With `sim` the flow ends in a short nose just past the cone foot, where it feeds the simulated lava (emberLavaFlow.ts);
 * without, it ends in its analytic lobe (the fallback where float render targets are missing). */
function buildTongue(defs: TongueDef[], which: number, sup: Support, quality: LavaQuality, sim = false): TongueBuild {
  const def = defs[which], cone = sup.cone, branch = !!def.branch;
  const angleAt = angleFn(defs, which, sup);
  const nose = sim && !def.stub;
  const rho0 = def.branch ? def.branch.rho : 6.9, foot = sup.footRadius(def.angle), rhoEnd = def.stub ? def.run : foot + (nose ? FLOW_NOSE : def.run);
  // Centre line in xz, sampled finely, with its 3D arc length.
  const N = 900, cx: number[] = [], cz: number[] = [], cs: number[] = [], crho: number[] = [];
  const rhoMax = rhoEnd + 6;
  let py = 0;
  for (let i = 0; i <= N; i++) {
    const rho = rho0 + (rhoMax - rho0) * i / N, a = angleAt(rho);
    const x = cone.x + Math.sin(a) * rho, z = cone.z + Math.cos(a) * rho, y = sup.at(x, z, false, 1.2);
    if (i > 0) { const j = i - 1; cs.push(cs[j] + Math.hypot(x - cx[j], z - cz[j], y - py)); } else cs.push(0);
    cx.push(x); cz.push(z); crho.push(rho); py = y;
  }
  const sAtRho = (rho: number) => { const f = clamp((rho - rho0) / (rhoMax - rho0) * N, 0, N - 1e-6), i = Math.floor(f); return mix(cs[i], cs[i + 1], f - i); };
  const centre = (s: number) => {
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cs[mid] <= s) lo = mid; else hi = mid; }
    const t = clamp((s - cs[lo]) / Math.max(cs[hi] - cs[lo], 1e-6), 0, 1);
    const x = mix(cx[lo], cx[hi], t), z = mix(cz[lo], cz[hi], t), tx = cx[hi] - cx[lo], tz = cz[hi] - cz[lo], tl = Math.hypot(tx, tz) || 1;
    return { x, z, tx: tx / tl, tz: tz / tl, rho: mix(crho[lo], crho[hi], t) };
  };
  const sLip = branch ? 0 : sAtRho(sup.crestR), sFoot = sAtRho(foot), sEnd = sAtRho(rhoEnd);
  // A flow that stalled on the cone ends in a blunt snout, barely wider than its channel.
  const R = def.stub || nose ? Math.min(lobeRadius(def.volume), def.width / 2 * 1.15) : lobeRadius(def.volume);
  // Where the front starts spreading into its lobe: the cone foot, or higher up for a flow that stalled on the cone.
  const sSpread = Math.min(sFoot, sEnd - 1.8 * R);
  // A breakout carries lava that has already run from the rim to where it leaves its parent.
  const sAge = branch ? (def.branch!.rho - sup.crestR) * 2.1 : 0;
  const w0 = branch ? .45 : Math.min(1.1, def.width / 2) * .9;
  const halfW = (s: number) => mix(mix(w0, def.width / 2, smooth(sLip, sLip + 6, s)), R, smooth(sSpread - 1.5, sEnd - R * .5, s));
  // Side lobe: an elliptic bulge on one flank, sized from its own volume.
  const side0 = nose ? null : def.side;
  const sideR = side0 ? lobeRadius(side0.volume) : 0, sSide = sSpread + 1.4 + sideR * .3, sideLen = sideR * 1.05;
  const bulge = (s: number) => { if (!side0) return 0; const u = (s - sSide) / sideLen; return Math.abs(u) >= 1 ? 0 : sideR * .95 * Math.sqrt(1 - u * u); };
  const halfSide = (s: number, sign: number) => halfW(s) + (side0 && side0.sign === sign ? bulge(s) : 0);
  // The front: rounded corners, flat-topped toes pushing out of it, an outline that wanders.
  const Rf = R * .85;
  const front = (c: number) => {
    let f = sEnd + Rf * (Math.sqrt(Math.max(0, 1 - c * c)) - 1);
    for (const [tc, amp, w] of def.toes) f += amp * (nose ? .25 : 1) * Math.exp(-(((c - tc) / w) ** 4));
    return f + .22 * Math.sin(c * 7.3 + def.seed * 2.1) + .12 * Math.sin(c * 17.1 + def.seed);
  };
  // Speed falls from the cone speed to the toe speed; material coordinate X = U0 * travel time (bunches where slow).
  const speed = (s: number) => mix(U0, U_TOE, Math.pow(smooth(sSpread - 3, sEnd + 1, s), .8));
  const Xm = new Float64Array(2001), sTop = Math.max(...def.toes.map(t => t[1])) + sEnd + 1;
  for (let i = 1; i <= 2000; i++) { const s0 = sTop * (i - 1) / 2000, s1 = sTop * i / 2000; Xm[i] = Xm[i - 1] + (s1 - s0) * U0 / speed((s0 + s1) / 2); }
  const XmAt = (s: number) => { const f = clamp(s / sTop * 2000, 0, 1999.999), i = Math.floor(f); return mix(Xm[i], Xm[i + 1], f - i); };
  // Open melt at the spillway, crusted over a dozen metres down the cone, then the lobe's cooler skin.
  const temperature = (s: number) => {
    const a = s + sAge;
    let t = mix(.99, .64, smooth(sLip, sLip + 12, a));
    t = mix(t, .5, smooth(sLip + 12, Math.max(sLip + 13, sSpread + sAge), a));
    t = mix(t, .42, smooth(sSpread - 1, sEnd - 1, s));
    return t * Math.min(1, def.heat);
  };
  const leveeAt = (s: number) => smooth(sLip + .5, sLip + 4, s) * (branch ? smooth(2, 5, s) : 1) * (1 - smooth(sSpread - 1, sSpread + 2.5, s));
  const lobeAt = (s: number) => smooth(sSpread - 1, sSpread + 2.5, s);
  const live = def.heat >= 1 ? 1 : 0;
  // Levees grow with the channel: about 0.2 m on a 2 m flow, 0.35 m on the widest.
  const leveeH = .32 * clamp(def.width / 3.4, .6, 1.1);
  // Grid: columns denser at the edges, rows uniform up to 2.6 m before the front and fine over the toe.
  const J = quality === 'high' ? 34 : 16, fine = quality === 'high' ? 18 : 9;
  const coarse = Math.ceil(sEnd / (quality === 'high' ? .3 : .6));
  const K = coarse + fine;
  const cols: number[] = [];
  for (let j = 0; j < J; j++) { const u = -1 + 2 * j / (J - 1); cols.push(Math.sign(u) * (1 - Math.pow(1 - Math.abs(u), 1.6))); }
  const count = K * J;
  const pos = new Float32Array(count * 3), shadePos = new Float32Array(count * 3);
  const aLA = new Float32Array(count * 4), aLB = new Float32Array(count * 4), aLC = new Float32Array(count * 4);
  const thick = new Float32Array(count), base = new Float32Array(count * 3), baseS = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  const sArr = new Float32Array(count), shadeH = new Float32Array(count);
  const supNormal = (x: number, z: number, k: number) => {
    const e = .25, hx = sup.at(x + e, z, false, k) - sup.at(x - e, z, false, k), hz = sup.at(x, z + e, false, k) - sup.at(x, z - e, false, k);
    const v = new THREE.Vector3(-hx, 2 * e, -hz); return v.normalize();
  };
  for (let j = 0; j < J; j++) {
    const c = cols[j], f = front(c), sign = c < 0 ? -1 : 1;
    const fSlope = (front(Math.min(1, c + .01)) - front(Math.max(-1, c - .01))) / (Math.min(1, c + .01) - Math.max(-1, c - .01));
    for (let k = 0; k < K; k++) {
      const s = k < coarse ? (f - 2.6) * k / coarse : f - 2.6 * Math.pow(1 - (k - coarse + 1) / fine, 1.6);
      const i = k * J + j, cl = centre(s), w = halfSide(s, sign), v = c * w;
      const x = cl.x + cl.tz * v, z = cl.z - cl.tx * v; // side vector (tz, -tx) points to +c
      // Thickness: lobe profile over the distance to the outline (the front distance measured square to the front,
      // so the toes' flanks round over like the rest), capped thinner on the steep cone; levees on top.
      const dSide = (1 - Math.abs(c)) * w, fp = fSlope / Math.max(w, .3);
      const dFront = Math.max(0, f - s) / Math.sqrt(1 + fp * fp), dist = Math.max(0, smin(dSide, dFront, .6));
      const cap = mix(def.stub ? .38 : .45, def.stub ? .6 : 1.4, smooth(sSpread - 2, sSpread + 1, s));
      const lev = leveeAt(s);
      const taper = branch ? smooth(0, 3, s) : 1;
      const hBase = smin(lobeHeight(dist), cap, .15) * taper;
      let h = hBase + leveeH * lev * Math.exp(-(((Math.abs(c) - .89) / .075) ** 2)) * Math.min(1, dist / .2);
      const kFoot = 1.2 * (1 - c * c);
      const y0 = sup.at(x, z, true, kFoot) + .045, yS = sup.at(x, z, false, kFoot) + .045;
      const ns = supNormal(x, z, kFoot);
      base[i * 3] = x; base[i * 3 + 1] = y0; base[i * 3 + 2] = z;
      baseS[i * 3] = x; baseS[i * 3 + 1] = yS; baseS[i * 3 + 2] = z;
      nrm[i * 3] = ns.x; nrm[i * 3 + 1] = ns.y; nrm[i * 3 + 2] = ns.z;
      thick[i] = h; sArr[i] = s;
      const out = side0 && sign === side0.sign ? Math.max(0, Math.abs(v) - halfW(s)) : 0;
      const act = (1 - smooth(.2, 1.1, out)) * live;
      aLA.set([XmAt(s), c, w, temperature(s) * mix(.08, 1, 1 - smooth(.2, 1.1, out))], i * 4);
      aLB.set([act, lev, U0 / speed(s), lobeAt(s)], i * 4);
      // Swell only well inside the active lobe: nothing that is meant to be at rest (levees, stopped lobes) may move.
      const swell = nose ? 0 : smooth(.95, 1, act) * (lev > 1e-3 ? 0 : 1) * smooth(sSpread + 2.5, sEnd - 1, s) * clamp((dist - .3) / 1.2, 0, 1);
      aLC.set([0, swell, clamp((s + sAge) / (sEnd + sAge), 0, 1.2), h], i * 4);
      shadeH[i] = smin(lobeHeight(dist, 1.8), cap, .3) * taper + (h - hBase);
    }
  }
  // Positions on the faceted cone; shading from a softer dome (shoulder over 1.8 m, then blurred) on the smooth
  // cone, so the lobes light as rounder than the mesh is (isaac_sim #944).
  let blur = Float32Array.from(shadeH);
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(count);
    for (let k = 0; k < K; k++) for (let j = 0; j < J; j++) {
      let sum = 0, wsum = 0;
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) {
        const kk = k + dk, jj = j + dj; if (kk < 0 || kk >= K || jj < 0 || jj >= J) continue;
        const w = (dk === 0 ? 2 : 1) * (dj === 0 ? 2 : 1); sum += blur[kk * J + jj] * w; wsum += w;
      }
      const i = k * J + j; next[i] = j === 0 || j === J - 1 ? 0 : sum / wsum;
    }
    blur = next;
  }
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      pos[i * 3 + a] = base[i * 3 + a] + nrm[i * 3 + a] * thick[i];
      shadePos[i * 3 + a] = baseS[i * 3 + a] + nrm[i * 3 + a] * blur[i];
    }
  }
  const normals = new Float32Array(count * 3), tan = new Float32Array(count * 3), side = new Float32Array(count * 3);
  const P = (k: number, j: number) => { const i = clamp(k, 0, K - 1) * J + clamp(j, 0, J - 1); return new THREE.Vector3(shadePos[i * 3], shadePos[i * 3 + 1], shadePos[i * 3 + 2]); };
  const n = new THREE.Vector3(), ns = new THREE.Vector3();
  for (let k = 0; k < K; k++) for (let j = 0; j < J; j++) {
    const i = k * J + j;
    const t = P(k + 1, j).sub(P(k - 1, j)), sd = P(k, j + 1).sub(P(k, j - 1));
    n.crossVectors(t, sd).normalize();
    if (n.y < 0) n.negate();
    normals.set([n.x, n.y, n.z], i * 3);
    t.normalize(); sd.normalize();
    tan.set([t.x, t.y, t.z], i * 3); side.set([sd.x, sd.y, sd.z], i * 3);
    ns.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    aLC[i * 4] = 1 - clamp(n.dot(ns), 0, 1);
  }
  const index: number[] = [];
  for (let k = 0; k < K - 1; k++) for (let j = 0; j < J - 1; j++) {
    const a = k * J + j, b = a + 1, c = a + J, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('aLA', new THREE.BufferAttribute(aLA, 4));
  g.setAttribute('aLB', new THREE.BufferAttribute(aLB, 4));
  g.setAttribute('aLC', new THREE.BufferAttribute(aLC, 4));
  g.setAttribute('aTan', new THREE.BufferAttribute(tan, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 3));
  g.setIndex(index);
  {
    // Wind so the faces look up: check the winding against the normal once and flip if needed.
    const ia = index[0], ib = index[1], ic = index[2];
    const pa = new THREE.Vector3().fromArray(pos, ia * 3), pb = new THREE.Vector3().fromArray(pos, ib * 3), pc = new THREE.Vector3().fromArray(pos, ic * 3);
    const fn = new THREE.Vector3().crossVectors(pb.sub(pa), pc.sub(pa));
    if (fn.dot(new THREE.Vector3().fromArray(normals, ia * 3)) < 0) { for (let q = 0; q < index.length; q += 3) { const t = index[q + 1]; index[q + 1] = index[q + 2]; index[q + 2] = t; } g.setIndex(index); }
  }
  g.computeBoundingSphere();
  // Outline for the clinker and the halo, one continuous run (left edge down, the front, right edge back up), with
  // outward directions in xz. The start inside the crater lake or inside the parent flow is marked skip.
  const outline: OutlinePoint[] = [];
  const push = (k: number, j: number, jIn: number, kIn: number) => {
    const i = k * J + j, ii = kIn * J + jIn, x = base[i * 3], z = base[i * 3 + 2], s = sArr[i];
    let ox = x - base[ii * 3], oz = z - base[ii * 3 + 2]; const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    outline.push({ x, z, ox, oz, s, ground: !def.stub && s > sSpread - 1.5, lev: leveeAt(s), skip: s < (branch ? 4.5 : sLip + 1.5) });
  };
  for (let k = 0; k < K; k++) push(k, 0, 1, k);
  for (let j = 1; j < J - 1; j++) push(K - 1, j, j, K - 3);
  for (let k = K - 1; k >= 0; k--) push(k, J - 1, J - 2, k);
  // Footprint on the ground for props to avoid.
  const zones: LavaZone[] = [];
  if (!def.stub) {
    // Under the simulated lava the toe zones are its reach discs instead (flowLayout).
    for (let s = Math.max(0, sAtRho(foot - 2)); s < sEnd; s += 2.5) { const cl = centre(s); zones.push({ x: cl.x, z: cl.z, radius: Math.max(halfSide(s, -1), halfSide(s, 1)) + 1, kind: 'tongue' }); }
    if (!nose) { const cl = centre(sEnd - R * .4); zones.push({ x: cl.x, z: cl.z, radius: R + 2.2, kind: 'toe' }); }
  }
  return { geometry: g, outline, zones };
}

/** Episodes of the live flows on the ground: m3/s while feeding, feed and period (s), phase. The main flow and its
 * breakout (in sight of the sanctuary) feed every 44 s, half a period apart; the outer two every 60 s. Short, strong
 * pulses, so fronts move at a pace a player sees (emberLavaFlow.ts, Speed). About 1 m3/s scheduled on average in all,
 * 0.6-0.7 delivered (the feed cap holds back what lands on thick lava). */
const FEEDS: Record<number, [number, number, number, number]> = {
  0: [.8, 16, 60, 40],
  1: [.9, 20, 44, 38],
  2: [.8, 20, 44, 16],
  5: [.8, 16, 60, 10],
};
/** Where the simulated lava lives: the noses of the tongues that reach the ground feed it, every such flow starts with
 * an older cold lobe of 80 % of its analytic lobe's volume against its nose, and lava may spread over a disc 10.5 m
 * round a point 4 m beyond its nose. */
function flowLayout(sup: Support) {
  const cone = sup.cone, sources: FlowSource[] = [], deposits: FlowDeposit[] = [], areas: FlowArea[] = [];
  TONGUES.forEach((def, i) => {
    if (def.stub) return;
    const foot = sup.footRadius(def.angle), ang = angleFn(TONGUES, i, sup);
    const at = (rho: number) => { const a = ang(rho); return { x: cone.x + Math.sin(a) * rho, z: cone.z + Math.cos(a) * rho }; };
    const dirAt = (rho: number) => { const p = at(rho - .5), q = at(rho + .5), l = Math.hypot(q.x - p.x, q.z - p.z) || 1; return { x: (q.x - p.x) / l, z: (q.z - p.z) / l }; };
    const nose = at(foot + FLOW_NOSE * .5), nd = dirAt(foot + FLOW_NOSE * .5);
    // The old lobe's back edge tucks under the nose (it is 1.25 R long along the flow).
    const R = lobeRadius(def.volume * .8), dep = at(foot + FLOW_NOSE * .5 + R), dd = dirAt(foot + FLOW_NOSE * .5 + R);
    areas.push({ x: nose.x + nd.x * 4, z: nose.z + nd.z * 4, radius: 10.5 });
    // A live flow's old lobe froze recently (its deepest cracks still glow for a few minutes); the older flow's is cold.
    deposits.push({ x: dep.x, z: dep.z, dirX: dd.x, dirZ: dd.z, volume: def.volume * .8, seed: def.seed, temp: def.heat >= 1 ? .3 : .04 });
    const f = FEEDS[i];
    if (def.heat >= 1 && f) sources.push({ x: nose.x, z: nose.z, dirX: nd.x, dirZ: nd.z, rate: f[0], feed: f[1], period: f[2], phase: f[3], seed: def.seed });
  });
  return { sources, deposits, areas };
}
/** Distance to what lava must keep off on the plateau, m: the sanctuary and its ring of pillars (26.5 m round (0, -72)),
 * the obsidian trees, and the island's edge. */
function flowClearance(areas: FlowArea[]) {
  const pad = 12, minX = Math.min(...areas.map(a => a.x - a.radius)) - pad, maxX = Math.max(...areas.map(a => a.x + a.radius)) + pad;
  const minZ = Math.min(...areas.map(a => a.z - a.radius)) - pad, maxZ = Math.max(...areas.map(a => a.z + a.radius)) + pad;
  const trees = frontierTrees(5).filter(t => t.x > minX && t.x < maxX && t.z > minZ && t.z < maxZ);
  return (x: number, z: number) => {
    let c = Math.min(Math.hypot(x, z + 72) - 26.5, (.8 - Math.hypot(x / 128, (z - 2) / 155)) * 130);
    for (const t of trees) c = Math.min(c, Math.hypot(x - t.x, z - t.z) - (2.3 * t.s + .4));
    return c;
  };
}

/** The crater rampart, turned from the lip profile, cut by the spillway notches and sunk into the cone at its foot. */
function lipGeometry(sup: Support, quality: LavaQuality) {
  const pts: THREE.Vector2[] = [];
  const steps = quality === 'high' ? 40 : 20;
  for (let i = 0; i <= steps; i++) pts.push(new THREE.Vector2(6.5 + (12.7 - 6.5) * i / steps, 0));
  const g = new THREE.LatheGeometry(pts, quality === 'high' ? 112 : 56);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), rho = Math.hypot(x, z);
    p.setY(i, sup.lip(rho, Math.atan2(x, z)) - (rho > 12.69 ? .7 : 0));
  }
  g.computeVertexNormals();
  g.translate(sup.cone.x, 0, sup.cone.z);
  return g;
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** The quality tier the player picked ('auto' runs on the high tier); app.ts keeps it in localStorage. */
function storedQuality(): LavaQuality { try { return localStorage.getItem('cc.quality') === 'low' ? 'low' : 'high'; } catch { return 'high'; } }

export interface EmberLavaOptions {
  height: (x: number, z: number) => number;
  /** height(0, -72), the level frontierIsland places the volcano from. */
  ly: number;
}

export class EmberLava {
  readonly root = new THREE.Group();
  readonly zones: LavaZone[] = [];
  private readonly crust: THREE.DataTexture;
  private readonly common = { uCrust: { value: null as THREE.Texture | null }, uDetail: { value: 1 }, uMask: { value: 0 }, uPulse: { value: 0 } };
  private readonly tongueUniforms = { uShift: { value: 0 }, uPhB: { value: 0 }, uSwell: { value: 0 } };
  private readonly seaUniforms = { uPh: { value: 0 }, uCentre: { value: new THREE.Vector3() } };
  private readonly lakeUniforms = { uPh: { value: 0 }, uCentre: { value: new THREE.Vector3() } };
  /** Tongue geometry, halo and clinker per mode: 'sim' tongues end in a nose that feeds the simulated lava, 'lobe'
   * tongues end in analytic lobes (the fallback, built the first time it is needed). */
  private readonly tongueSets: Partial<Record<TongueMode, TongueSet>> = {};
  private readonly support: Support;
  private readonly tongueMeshes: THREE.Mesh[] = [];
  private readonly tongueGroup: THREE.Group;
  private readonly lip: THREE.Mesh;
  private readonly lipGeo: Record<LavaQuality, THREE.BufferGeometry>;
  private quality: LavaQuality = 'high';
  private qualityAt = -1e9;
  private mode: TongueMode = 'sim';
  /** The simulated lava on the plateau (emberLavaFlow.ts); its meshes are hidden when it cannot run. */
  readonly flow: LavaFlow;
  private readonly flowGroup = new THREE.Group();
  private readonly flowGeo: Record<LavaQuality, THREE.BufferGeometry>;
  private readonly flowLava: THREE.Mesh;
  private readonly flowHalo: THREE.Mesh;
  private readonly flowClinker: THREE.InstancedMesh;
  private readonly flowClinkerCount: number;
  private readonly flowUniforms = { uPhF: { value: 0 } };
  /** Captured from the first draw of a lava mesh; the simulation renders with it in update(). */
  private renderer: THREE.WebGLRenderer | null = null;
  private flowStarted = false;

  constructor(opts: EmberLavaOptions) {
    this.root.name = 'ember-lava';
    const cone: Cone = { x: 0, z: -128, baseY: opts.ly - 10, topY: opts.ly + 28, baseR: 28, topR: 8, segments: 18 };
    const sup = new Support(cone, opts.height, tongueNotches());
    this.support = sup;
    this.crust = bakeCrust(256);
    this.common.uCrust.value = this.crust;
    this.quality = storedQuality();
    this.common.uDetail.value = this.quality === 'high' ? 1 : 0;

    // Molten sea: replaces the 1800 m plane at the same level.
    const seaGeo = new THREE.PlaneGeometry(1800, 1800);
    seaGeo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(seaGeo, this.poolMaterial(true));
    // Drawn after the island's opaque meshes, so the depth test skips the sea under the land.
    // No shadow lookups: the sun's shadow box (+-105 m round the island) barely reaches the sea, and it is most of the screen.
    sea.position.y = .15; sea.name = 'molten-sea'; sea.receiveShadow = false; sea.renderOrder = 1;
    this.root.add(sea);

    // Crater: a lava lake inside a rampart that spills into the tongues.
    const crater = new THREE.Group(); crater.name = 'lava-crater'; this.root.add(crater);
    this.lakeUniforms.uCentre.value.set(cone.x, cone.z, sup.lakeR);
    const lakeGeo = new THREE.CircleGeometry(sup.lakeR + .35, 72); lakeGeo.rotateX(-Math.PI / 2);
    const lake = new THREE.Mesh(lakeGeo, this.poolMaterial(false));
    lake.position.set(cone.x, sup.lakeY, cone.z); lake.name = 'lava-crater-lake';
    crater.add(lake);
    this.lipGeo = { high: lipGeometry(sup, 'high'), low: lipGeometry(sup, 'low') };
    this.lip = new THREE.Mesh(this.lipGeo[this.quality], this.lipMaterial(sup.lakeY, cone));
    this.lip.name = 'lava-crater-lip'; this.lip.receiveShadow = true;
    crater.add(this.lip);
    this.zones.push({ x: cone.x, z: cone.z, radius: 13, kind: 'crater' });

    // Tongues at the current detail; the other level is built once, the first time the quality switches to it.
    const tongues = this.tongueGroup = new THREE.Group(); tongues.name = 'lava-tongues'; this.root.add(tongues);
    const tongueMat = this.tongueMaterial();
    const set = this.tongueSet('sim');
    TONGUES.forEach((_, i) => {
      const mesh = new THREE.Mesh(set.geo[this.quality][i], tongueMat);
      mesh.name = `lava-tongue-${i}`; mesh.receiveShadow = true;
      tongues.add(mesh); this.tongueMeshes.push(mesh);
    });
    this.zones.push(...set.zones);

    // The simulated lava at the foot: a grid mesh lifted by the height field, a darkening halo and clinker crumbs
    // round its margins, all drawn after the land so the cells sunk into the ground cost no shading.
    const lay = flowLayout(sup);
    this.flow = new LavaFlow({ ground: (x, z) => sup.at(x, z, true, 0), areas: lay.areas, clearance: flowClearance(lay.areas), sources: lay.sources, deposits: lay.deposits, d: YIELD_D });
    for (const a of lay.areas) this.zones.push({ x: a.x, z: a.z, radius: a.radius, kind: 'toe' });
    const g1 = this.flow.meshGeometry(1);
    this.flowGeo = { high: g1, low: this.flow.meshGeometry(2, g1) };
    this.flowGroup.name = 'lava-flow'; this.root.add(this.flowGroup);
    this.flowLava = new THREE.Mesh(this.flowGeo[this.quality], this.flowMaterial());
    this.flowLava.name = 'lava-flow-surface'; this.flowLava.receiveShadow = true; this.flowLava.renderOrder = 1;
    this.flowHalo = new THREE.Mesh(this.flowGeo[this.quality], this.flowHaloMaterial());
    this.flowHalo.name = 'lava-flow-halo'; this.flowHalo.renderOrder = 2;
    const fc = this.flowClinkerPool();
    this.flowClinker = fc.mesh; this.flowClinkerCount = fc.count;
    this.flowClinker.count = this.quality === 'high' ? fc.count : Math.floor(fc.count / 2);
    this.flowGroup.add(this.flowLava, this.flowHalo, this.flowClinker);
    const capture = (r: THREE.WebGLRenderer) => { this.renderer = r; };
    this.flowLava.onBeforeRender = capture; sea.onBeforeRender = capture;
    this.root.userData.lavaZones = this.zones;
  }

  /** Builds (once) the tongue geometry at the current detail, its halo and its clinker for a mode, and returns it. */
  private tongueSet(mode: TongueMode): TongueSet {
    const have = this.tongueSets[mode];
    if (have) {
      if (!have.geo[this.quality].length) TONGUES.forEach((_, i) => { have.geo[this.quality][i] = buildTongue(TONGUES, i, this.support, this.quality, mode === 'sim').geometry; });
      return have;
    }
    const geo: Record<LavaQuality, THREE.BufferGeometry[]> = { high: [], low: [] };
    const outlines: TongueBuild['outline'][] = [], zones: LavaZone[] = [];
    TONGUES.forEach((_, i) => {
      const built = buildTongue(TONGUES, i, this.support, this.quality, mode === 'sim');
      geo[this.quality][i] = built.geometry; outlines.push(built.outline); zones.push(...built.zones);
    });
    // Edges on the ground: a darker halo and a band of clinker crumbs, half of them pushed into the lava's edge.
    const halo = this.halo(outlines, this.support), clinker = this.clinkerPool(outlines, this.support);
    clinker.mesh.count = this.quality === 'high' ? clinker.count : Math.floor(clinker.count / 2);
    this.tongueGroup.add(halo, clinker.mesh);
    const set: TongueSet = { geo, halo, clinker: clinker.mesh, count: clinker.count, zones };
    this.tongueSets[mode] = set;
    return set;
  }

  /** Simulated lava on (the default) or the analytic lobes (where float render targets are missing, and for A/B
   * measurements). */
  setFlow(on: boolean) {
    const mode: TongueMode = on ? 'sim' : 'lobe';
    if (mode === this.mode) return;
    this.mode = mode;
    const set = this.tongueSet(mode);
    this.tongueMeshes.forEach((m, i) => { m.geometry = set.geo[this.quality][i]; });
    for (const k of ['sim', 'lobe'] as const) { const s = this.tongueSets[k]; if (s) s.halo.visible = s.clinker.visible = k === mode; }
    set.clinker.count = this.quality === 'high' ? set.count : Math.floor(set.count / 2);
    this.flowGroup.visible = on;
  }
  get flowOn() { return this.mode === 'sim'; }

  /** Height of the surface the lava lies on (crater lip, cone, terrain), for the heat haze's bake (emberHaze.ts). */
  surfaceY(x: number, z: number) { return this.support.at(x, z, true, 0); }

  /** Switch detail; called by update() when the stored setting changes. */
  setQuality(q: LavaQuality) {
    if (q === this.quality) return;
    this.quality = q;
    this.common.uDetail.value = q === 'high' ? 1 : 0;
    const set = this.tongueSet(this.mode);
    this.tongueMeshes.forEach((m, i) => { m.geometry = set.geo[q][i]; });
    this.lip.geometry = this.lipGeo[q];
    set.clinker.count = q === 'high' ? set.count : Math.floor(set.count / 2);
    // Low detail: the simulation is the same (it is cheap and its look must not change), drawn on every other cell,
    // with half the clinker.
    this.flowLava.geometry = this.flowHalo.geometry = this.flowGeo[q];
    this.flowClinker.count = q === 'high' ? this.flowClinkerCount : Math.floor(this.flowClinkerCount / 2);
  }

  /** QA: 1 renders the stillness mask (red = no time term, blue = flowing), 2 the same with colours swapped, 0 off. */
  setMask(mode: 0 | 1 | 2) { this.common.uMask.value = mode; }

  update(time: number) {
    if (time - this.qualityAt > 2 || time < this.qualityAt) { this.qualityAt = time; this.setQuality(storedQuality()); }
    // Phases are wrapped here in double precision so the shaders never see a large time.
    this.tongueUniforms.uShift.value = (U0 * time) % TILE_TONGUE;
    this.tongueUniforms.uPhB.value = fract(time / T_BAND);
    this.tongueUniforms.uSwell.value = (time * TAU / 16) % TAU;
    this.seaUniforms.uPh.value = fract(time / T_SEA);
    this.lakeUniforms.uPh.value = fract(time / T_LAKE);
    this.common.uPulse.value = (time * .4) % TAU;
    this.flowUniforms.uPhF.value = fract(time / T_FLOW);
    if (this.mode === 'sim' && this.renderer) {
      if (!this.flowStarted) {
        this.flowStarted = true;
        // A little history, so the first look already has lava on the move. Episodes that start within it break out of
        // the start state, whose snapshot is the CPU copy, so it needs no read-backs (each would be a stall).
        this.flow.advance(this.renderer, FLOW_WARM_STEPS, false);
      }
      this.flow.update(this.renderer, time);
      if (!this.flow.supported) this.setFlow(false);
    }
  }

  private tongueMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .86, metalness: 0 });
    m.name = 'ember-lava-tongue';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.common, this.tongueUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TONGUE_VERT_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TONGUE_VERT_BODY}`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${TONGUE_VERT_TAIL}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TONGUE_FRAG_HEAD}\nvec2 lRopeG;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${TONGUE_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${TONGUE_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TONGUE_NORMAL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${TONGUE_EMIT}`)
        .replace('#include <aomap_fragment>', TONGUE_LIGHT)
        .replace('#include <dithering_fragment>', MASK_OUT);
    };
    m.customProgramCacheKey = () => 'ember-lava-tongue';
    return m;
  }

  private poolMaterial(sea: boolean) {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .86, metalness: 0 });
    m.name = sea ? 'ember-molten-sea' : 'ember-crater-lake';
    const local = sea ? this.seaUniforms : this.lakeUniforms;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.common, local);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${POOL_VERT_HEAD}`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${POOL_VERT_TAIL}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${POOL_FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${poolColor(sea)}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${sea ? SEA_ROUGH : POOL_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${POOL_NORMAL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${POOL_EMIT}`)
        .replace('#include <aomap_fragment>', sea ? SEA_SPECULAR : '#include <aomap_fragment>')
        .replace('#include <dithering_fragment>', MASK_OUT);
    };
    m.customProgramCacheKey = () => m.name;
    return m;
  }

  /** The simulated lava: the tongue's crust, cracks and black-body glow, driven by the sim's temperature and velocity. */
  private flowMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .86, metalness: 0 });
    m.name = 'ember-lava-flow';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.common, this.flowUniforms, this.flow.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FLOW_VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', FLOW_VERT_NORMAL)
        .replace('#include <begin_vertex>', FLOW_VERT_BEGIN)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${FLOW_VERT_TAIL}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FLOW_FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FLOW_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FLOW_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FLOW_NORMAL}`)
        .replace('#include <aomap_fragment>', FLOW_CAVITY)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${TONGUE_EMIT}`)
        .replace('#include <dithering_fragment>', MASK_OUT);
    };
    m.customProgramCacheKey = () => 'ember-lava-flow';
    return m;
  }

  /** Darken-only halo round the simulated lava, as the tongues' halo: about 0.5 m wide (from the blurred thickness),
   * 28 % darker at the margin. Its vertices sink under the lava inside and into the ground far from it. */
  private flowHaloMaterial() {
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.ZeroFactor; m.blendDst = THREE.SrcColorFactor;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    m.name = 'ember-lava-flow-halo';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.flow.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;\nuniform sampler2D uFR0;\nvarying float vHalo;')
        .replace('#include <begin_vertex>', /* glsl */ `vec3 transformed=vec3(position);
          {
            vec4 fc=texture2D(uFR0,aCell);
            vHalo=.3*smoothstep(.004,.1,fc.g)*(1.-smoothstep(.006,.03,fc.r));
            // On the ground just above it, but under the lava's own margin vertices (they rise with the blurred
            // thickness, see FLOW_VERT_BEGIN), so the halo never paints the foot of the front.
            float lavaY=mix(-.6,fc.a*1.3-.05,smoothstep(.01,.05,fc.a));
            transformed.y+=fc.r>.012?-.05:(vHalo>.002?(lavaY>0.?min(.03,lavaY-.03):.03):-.4);
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHalo;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a=vHalo;')
        .replace('#include <fog_fragment>', /* glsl */ `
          float haloFog = 0.;
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              haloFog = 1. - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              haloFog = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
          #endif
          gl_FragColor = vec4(vec3(1. - diffuseColor.a * (1. - haloFog)), 1.);`);
    };
    m.customProgramCacheKey = () => 'ember-lava-flow-halo';
    return m;
  }

  /** Clinker for the simulated lava: a fixed pool of crumbs scattered over its whole reach (about 11 per m2); each one
   * reads the height field and shows only where it sits in the 0.5 m band outside a margin or on the margin itself,
   * so the band follows the fronts. Rotation and size come from per-instance data, the instance matrix only places it. */
  private flowClinkerPool() {
    const spots = this.flow.clinkerSpots();
    const order = spots.map((_, i) => i).sort((a, b) => hash1(a * 7.7) - hash1(b * 7.7));
    const ico = new THREE.IcosahedronGeometry(1.3, 0);
    ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
    const geo = mergeVertices(ico);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const f = .55 + .45 * hash1(i * 3.9 + 1); p.setXYZ(i, p.getX(i) * f, p.getY(i) * (.7 + .3 * hash1(i * 5.1)), p.getZ(i) * (.6 + .4 * hash1(i * 7.3))); }
    const ck = new Float32Array(spots.length * 4);
    const mesh = new THREE.InstancedMesh(geo, this.flowClinkerMaterial(), Math.max(1, spots.length));
    const mtx = new THREE.Matrix4();
    order.forEach((src, i) => {
      const sp = spots[src], h = hash1(src * 8.9 + 3), inside = hash1(src * 2.9) < .3;
      ck.set([sp.seed, (inside ? .045 + .05 * h : .05 + .09 * Math.pow(h, 1.5)), inside ? 1 : 0, hash1(src * 4.4)], i * 4);
      mesh.setMatrixAt(i, mtx.makeTranslation(sp.x, sp.y, sp.z));
    });
    geo.setAttribute('aCk', new THREE.InstancedBufferAttribute(ck, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.name = 'lava-flow-clinker';
    mesh.computeBoundingSphere();
    mesh.boundingSphere!.radius += 4;
    return { mesh, count: spots.length };
  }

  private flowClinkerMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .95, metalness: 0, flatShading: true });
    m.name = 'ember-lava-flow-clinker';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.common, this.flow.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aCk;\nuniform sampler2D uFR0;\nuniform vec4 uFGrid;\nvarying vec3 vLW;')
        .replace('#include <begin_vertex>', /* glsl */ `vec3 transformed;
          {
            vec3 ip=instanceMatrix[3].xyz;
            vec4 fc=texture2D(uFR0,(ip.xz-uFGrid.xy)/uFGrid.zw);
            // Outside crumbs lie on the ground in a band just outside the drawn margin (where the 3x3 field, which
            // places the margin, has faded but the 5x5 one has not); inside ones are half buried in the lava's foot.
            float outB=smoothstep(.004,.03,fc.g)*(1.-smoothstep(.04,.07,fc.a))*(1.-aCk.z);
            float inB=smoothstep(.03,.1,fc.r)*(1.-smoothstep(.22,.4,fc.r))*aCk.z;
            float show=sqrt(max(outB,inB));
            float a1=aCk.x*6.2832,a2=aCk.w*6.2832;
            mat3 R=mat3(cos(a1),0.,-sin(a1),0.,1.,0.,sin(a1),0.,cos(a1))*mat3(1.,0.,0.,0.,cos(a2),sin(a2),0.,-sin(a2),cos(a2));
            transformed=R*(position*vec3(1.+.5*aCk.w,.6,1.))*aCk.y*show;
            transformed.y+=(inB>outB?fc.r*.6:0.)+aCk.y*.25*show;
          }`)
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvLW=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uCrust;\nuniform float uMask;\nvarying vec3 vLW;')
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          {
            vec4 t=texture2D(uCrust,vLW.xz/7.3+vLW.y*.05);
            diffuseColor.rgb=vec3(.036,.031,.03)*(.6+.8*t.a)*(.8+.4*t.g);
          }`)
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif(uMask>.5)gl_FragColor=uMask>1.5?vec4(0.,0.,1.,1.):vec4(1.,0.,0.,1.);');
    };
    m.customProgramCacheKey = () => 'ember-lava-flow-clinker';
    return m;
  }

  /** Spatter rampart: basalt, rough; the inner wall takes the lake's glow, fading with height. Nothing moves. */
  private lipMaterial(lakeY: number, cone: Cone) {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .92, metalness: 0 });
    m.name = 'ember-crater-lip';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.common);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLW;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvLW=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${LAVA_COMMON}\nvarying vec3 vLW;\nvec3 lEmit;`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          {
            vec2 d=vLW.xz-vec2(${cone.x.toFixed(1)},${cone.z.toFixed(1)});
            float ang=atan(d.x,d.y),rho=length(d);
            vec4 t=texture2D(uCrust,vec2(ang*14./6.2832,vLW.y*.18));
            vec4 t2=texture2D(uCrust,vec2(ang*44./6.2832,vLW.y*.6+.3));
            diffuseColor.rgb=vec3(.07,.058,.058)*(.6+.6*t.a)*(.75+.5*t2.a)*mix(.55,1.,smoothstep(.0,.25,t.r));
            float inner=1.-smoothstep(8.3,8.8,rho);
            float above=max(vLW.y-${lakeY.toFixed(3)},0.);
            lEmit=lavaBB(.62)*inner*exp(-above*1.6)*.55+lavaBB(.8)*(1.-smoothstep(.0,.06,t2.r))*inner*exp(-above*2.5);
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance=lEmit;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif(uMask>.5)gl_FragColor=uMask>1.5?vec4(0.,0.,1.,1.):vec4(1.,0.,0.,1.);');
    };
    m.customProgramCacheKey = () => 'ember-crater-lip';
    return m;
  }

  /** A dark halo, 0.75 m wide, draped on the ground and cone round every tongue (about 25 % darker at the edge). It
   * multiplies what is under it, so it can only darken; the fog thins the darkening out with distance instead of
   * tinting the halo towards the pale fog colour. Quads across a gap (a jump between outline points, or a drape that
   * would span a step) are left out. */
  private halo(outlines: TongueBuild['outline'][], sup: Support) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const offs = [[-.1, .3], [.25, .22], [.75, 0]] as const;
    for (const line of outlines) {
      let prev = -1;
      line.forEach((p, i) => {
        const at = pos.length / 3;
        const ys = offs.map(([off]) => { const x = p.x + p.ox * off, z = p.z + p.oz * off; return sup.at(x, z, true, 0); });
        const ok = !p.skip && Math.abs(ys[2] - ys[0]) < .6;
        offs.forEach(([off, alpha], r) => { const x = p.x + p.ox * off, z = p.z + p.oz * off; pos.push(x, ys[r] + .05, z); col.push(1, 1, 1, ok ? alpha : 0); });
        const q = i > 0 ? line[i - 1] : null;
        if (q && prev >= 0 && Math.hypot(p.x - q.x, p.z - q.z) < 2.5) for (let r = 0; r < 2; r++) idx.push(prev + r, at + r, prev + r + 1, prev + r + 1, at + r, at + r + 1);
        prev = at;
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    // dst * src: the fragment writes 1 - darkness.
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.ZeroFactor; m.blendDst = THREE.SrcColorFactor;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    m.name = 'ember-lava-halo';
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', /* glsl */ `
        float haloFog = 0.;
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            haloFog = 1. - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            haloFog = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
        #endif
        gl_FragColor = vec4(vec3(1. - diffuseColor.a * (1. - haloFog)), 1.);`);
    };
    m.customProgramCacheKey = () => 'ember-lava-halo';
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'lava-halo'; mesh.renderOrder = 1;
    return mesh;
  }

  /** Clinker: a fixed pool of dark crumbs. On the ground a band along the lobes' edges and toes (0.3-0.6 m), half of it
   * pushed into the lava; up the cone only sparse clusters beside the levees, at uneven gaps. Noise from world space. */
  private clinkerPool(outlines: TongueBuild['outline'][], sup: Support) {
    const spots: { x: number; z: number; s: number; inside: boolean }[] = [];
    let seed = 1;
    for (const line of outlines) {
      let acc = 0, run = 0, nextCluster = 1.5 + 4 * hash1(line.length * .37);
      for (let i = 1; i < line.length; i++) {
        const p = line[i], q = line[i - 1], step = Math.hypot(p.x - q.x, p.z - q.z);
        if (p.skip || q.skip || step > 2.5) continue;
        if (p.ground && q.ground) {
          acc += step * 11;
          while (acc >= 1) {
            acc -= 1; seed++;
            const t = hash1(seed * 1.3), inside = hash1(seed * 2.9) < .45;
            const off = inside ? -.05 - .25 * hash1(seed * 3.7) : .02 + .55 * Math.pow(hash1(seed * 4.1), 1.4);
            const x = mix(q.x, p.x, t) + p.ox * off + (hash1(seed * 5.3) - .5) * .12, z = mix(q.z, p.z, t) + p.oz * off + (hash1(seed * 6.1) - .5) * .12;
            spots.push({ x, z, s: off, inside });
          }
        } else if (p.lev > .3) {
          run += step;
          if (run < nextCluster) continue;
          run = 0; seed++;
          nextCluster = 2.5 + 6 * hash1(seed * 7.9);
          const n = 2 + Math.floor(hash1(seed * 8.3) * 4), off = .15 + .4 * hash1(seed * 9.1);
          for (let k = 0; k < n; k++) {
            seed++;
            const a = hash1(seed * 1.9) * TAU, r = .4 * Math.sqrt(hash1(seed * 2.3)), o = Math.max(.02, off + r * Math.cos(a));
            spots.push({ x: p.x + p.ox * o + r * Math.sin(a) * p.oz, z: p.z + p.oz * o - r * Math.sin(a) * p.ox, s: o, inside: false });
          }
        }
      }
    }
    const max = spots.length;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .95, metalness: 0, flatShading: true });
    m.name = 'ember-lava-clinker';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.common);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLW;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvLW=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uCrust;\nuniform float uMask;\nvarying vec3 vLW;')
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          {
            // World-space noise, so each crumb picks up its own patch of the same crust as the lava next to it.
            vec4 t=texture2D(uCrust,vLW.xz/7.3+vLW.y*.05);
            diffuseColor.rgb=vec3(.05,.043,.043)*(.6+.8*t.a)*(.8+.4*t.g);
          }`)
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif(uMask>.5)gl_FragColor=uMask>1.5?vec4(0.,0.,1.,1.):vec4(1.,0.,0.,1.);');
    };
    m.customProgramCacheKey = () => 'ember-lava-clinker';
    const mesh = new THREE.InstancedMesh(geo, m, Math.max(1, max));
    const d = new THREE.Object3D();
    // Shuffle so that halving count on low drops every other crumb rather than whole tongues.
    const order = spots.map((_, i) => i).sort((a, b) => hash1(a * 7.7) - hash1(b * 7.7));
    order.forEach((src, i) => {
      const sp = spots[src], h = hash1(src * 8.9 + 3);
      const size = sp.inside ? .08 + .09 * h : mix(.13, .04, clamp(sp.s / .6, 0, 1)) * (.7 + .6 * h);
      d.position.set(sp.x, sup.at(sp.x, sp.z, true, 0) + size * (sp.inside ? .55 : .25), sp.z);
      d.rotation.set(h * 6.3, hash1(src * 2.2) * 6.3, hash1(src * 3.3) * 6.3);
      d.scale.set(size * (1 + .5 * hash1(src * 4.4)), size * .6, size);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.name = 'lava-clinker';
    mesh.computeBoundingSphere();
    return { mesh, count: max };
  }
}

/** Lava footprints on the island for chapter 5, computed from the same layout as the meshes (crater, tongues, toes). */
export function emberLavaZones(height: (x: number, z: number) => number, ly: number): LavaZone[] {
  const cone: Cone = { x: 0, z: -128, baseY: ly - 10, topY: ly + 28, baseR: 28, topR: 8, segments: 18 };
  const sup = new Support(cone, height, tongueNotches());
  const zones: LavaZone[] = [{ x: cone.x, z: cone.z, radius: 13, kind: 'crater' }];
  TONGUES.forEach((_, i) => zones.push(...buildTongue(TONGUES, i, sup, 'low', true).zones));
  // The simulated lava's toes can reach anywhere in these discs (it is blocked outside them).
  for (const a of flowLayout(sup).areas) zones.push({ x: a.x, z: a.z, radius: a.radius, kind: 'toe' });
  return zones;
}
