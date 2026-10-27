import * as THREE from 'three';

/*
 * Emberreach's lava: a molten sea round the island, a brimming crater lake and six tongues that spill over the crater
 * lip, run down the volcano and stop on the plateau in thick lobes. No simulation: one crust texture baked here at
 * load, shaders on MeshStandardMaterial / MeshPhysicalMaterial (so the lava takes the sun, the hemisphere and the
 * World V fog) and meshes whose topology never changes.
 *
 * What makes it read thick rather than wet:
 * - Crust plates with glowing cracks (black-body HDR, peaks 2-4 so GAME_VIEW's bloom at 0.9 catches them; mid
 *   temperatures stay under 0.9).
 * - Plug flow on the tongues: the middle slides as a block (its pattern moves exactly with it, never resets), the
 *   shear bands at the sides tear the plates into streaks (dual-phase advection with a global 10 s period, which alone
 *   bounds the stretch), levees and stopped toes are crust at rest and carry no time term at all. Plug, band and rest
 *   blend over |c| with smoothsteps 0.2+ wide, never a per-pixel switch.
 * - Material coordinates follow the travel time, so plates and rope folds bunch up where the flow slows: ropes bowed
 *   downstream crowd towards the toe.
 * - Lobes: Bingham dome h = sqrt(2 d (dist + 8 d)), i.e. crest sqrt(2 d R) and an edge step of 4 d, sized from volume
 *   (R = (15 V / (8 pi sqrt(2 d)))^0.4); toes and side lobes are bulges of the same mesh, the outline wanders, a
 *   clinker band and a darker halo blur the edge on the ground. Shading normals come from a softer, blurred dome on the
 *   smooth cone, so lobes read round while positions hug the faceted cone.
 * - Gloss is a clear coat (roughness 0.32+) only on young crust and rope crests, broken up; no roughness under 0.30.
 *
 * The tongues lie on the cone and the terrain as they are: no channel is carved (ground.ts and the collision bake are
 * untouched), the levees are built on top instead, and lava has no collision, so crabs can walk into the lobes.
 * EmberLava.zones and emberLavaZones() mark where it lies.
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
/** Bingham dome over a distance `dist` from the outline: sqrt(2 d dist), plus the 4 d step at the edge, rounded over r0. */
const domeHeight = (dist: number, d = YIELD_D, r0 = .24) => {
  if (dist <= 0) return 0;
  const e = Math.min(1, dist / r0);
  return Math.sqrt(2 * d * (dist + 8 * d)) * Math.sqrt(e * (2 - e));
};
const smin = (a: number, b: number, k: number) => { const h = clamp(.5 + .5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); };
const smax = (a: number, b: number, k: number) => { if (k <= 1e-4) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * .25; };

/** Plug speed on the cone and at the toe, m/s; material coordinates are measured at the cone speed. */
const U0 = .3;
const U_TOE = .11;
/** Plate sizes (m) and the plates per texture repeat. */
const CELLS = 16;
const PLATE_TONGUE = 1.5, PLATE_SEA = 8, PLATE_LAKE = 1.1;
const TILE_TONGUE = CELLS * PLATE_TONGUE, TILE_SEA = CELLS * PLATE_SEA, TILE_LAKE = CELLS * PLATE_LAKE;
/** Dual-phase periods, s: the life of a pattern before it is renewed, long because that is what viscosity looks like. */
const T_BAND = 10, T_SEA = 12, T_LAKE = 12;

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
// Surface gradient of a scalar height from screen derivatives (world space), for crack relief.
vec3 lavaBumpGrad(vec3 p,vec3 n,float h){
  vec3 dpx=dFdx(p),dpy=dFdy(p);
  vec3 r1=cross(dpy,n),r2=cross(n,dpx);
  float det=dot(dpx,r1);
  if(abs(det)<1e-8)return vec3(0.);
  return (dFdx(h)*r1+dFdy(h)*r2)/det;
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
  vec4 cs=texture2D(uCrust,vec2(Y,X)/TILE);
  vec4 cp=texture2D(uCrust,vec2(Y,X-uShift)/TILE+vec2(.5,.13));
  float jit=texture2D(uCrust,vec2(Y,X)/TILE*.11+.3).a;
  float a=fract(uPhB+jit),b=fract(a+.5);
  float st=1./1.7; // torn plates stretched along the flow
  vec4 bA=texture2D(uCrust,vec2(Y,(X-${U0}*prof*${T_BAND}.*a)*st)/TILE+vec2(.21,.0));
  vec4 bB=texture2D(uCrust,vec2(Y,(X-${U0}*prof*${T_BAND}.*b)*st)/TILE+vec2(.58,.71));
  vec4 cb=mix(bA,bB,abs(2.*a-1.));
  lC=cs*wS+cp*wP+cb*wB;
  float r=lC.r,fine=lC.b,id=lC.g,nz=lC.a;
  float face=smoothstep(.1,.38,vLC.x)*act*(1.-smoothstep(.72,.9,ac)*lev);
  // Hot, fast lava on the cone is mostly open melt carrying crust rafts; by the toe the crust has closed up.
  float open=smoothstep(.6,1.,temp);
  float cw=(.035+.75*open*open+.1*wB*temp)*(1.-.85*wS)*mix(.7,1.25,nz);
  float aa=fwidth(r)*1.1+.004;
  lCrack=1.-smoothstep(cw-aa,cw+aa,r);
  // Hot crust breaks up along its fine cracks too: rafts of every size on the cone, whole plates by the toe.
  float fw=.3*open*open*(1.-wS),fa=fwidth(fine)+.004;
  lCrack=max(lCrack,(1.-smoothstep(fw-fa,fw+fa,fine))*step(.001,fw));
  float fineLine=1.-smoothstep(.0,.06+fwidth(fine),fine);
  // Rope folds: crest lines bowed downstream (the middle runs ahead), crowding where the flow slows.
  float ropeAmp=.06*smoothstep(.25,.7,vLC.z)*(1.-open)*(1.-face);
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
  float inner=mix(.5,.93,act*(1.-leveeW))*mix(1.,.86,smoothstep(.3,.9,vLC.z));
  // On cooling crust only some cracks still glow; the others have sealed dark.
  float gate=mix(smoothstep(.38,.7,nz+.25*id),1.,open);
  float heat=inner*mix(1.,.62,smoothstep(0.,cw+aa,r))*(.86+.14*nz)*pulse*mix(.45,1.,gate)+.06*wB;
  lEmit=lavaBB(heat)*lCrack;
  // A moving toe's face: melt squeezing out in a seam along its foot, the crust above it stretched and dark.
  float seam=face*(1.-smoothstep(.05,.2,vLC.w))*smoothstep(.0,.03,vLC.w)*smoothstep(.25,.6,nz+.2*sin(uPulse*.5+vLW.x*1.7+vLW.z*1.3));
  lEmit+=lavaBB(.9*inner/.93)*seam;
  diffuseColor.rgb*=1.-seam;
  lEmit+=lavaBB(temp*.62)*fineLine*open*(1.-lCrack)*(1.-wS);
  lEmit+=lavaBB(temp*.5)*(1.-rP)*wP*ropeAmp*6.*(1.-lCrack);
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
const TONGUE_COAT = /* glsl */ `
material.clearcoat*=lGloss;
material.clearcoatRoughness=max(material.clearcoatRoughness,.32);
`;

/* Pool shaders (molten sea, crater lake) -------------------------------------------------------------------------- */

const POOL_VERT_HEAD = 'varying vec3 vLW;';
const POOL_VERT_TAIL = 'vLW=(modelMatrix*vec4(transformed,1.)).xyz;';
const POOL_FRAG_HEAD = /* glsl */ `
${LAVA_COMMON}
uniform float uPh;
uniform vec3 uCentre; // crater: centre x, z and lake radius
varying vec3 vLW;
float lCrack,lStatic,lMelt;
vec3 lEmit;
vec4 lC;
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
  vec4 A=texture2D(uCrust,(p-vel*${period}.*a)/TILE);
  vec4 B=texture2D(uCrust,rot*((p-vel*${period}.*b)/TILE)+vec2(.37,.71)*flowW);
  lC=mix(A,B,abs(2.*a-1.)*flowW);
  float r=lC.r,fine=lC.b,id=lC.g,nz=lC.a;
  // Far away the cracks average out to a warm crust instead of sparkling.
  float far=smoothstep(.1,.4,length(fwidth(q*${CELLS}.)));
  // Melt between the plates: wide in hot leads, hairline under the cool rafts.
  float cw=(mix(.07,.46,pow(smoothstep(.45,1.,temp),1.6))+lMelt*.15+margin*.16)*mix(.7,1.25,nz);
  float aa=fwidth(r)*1.1+.004;
  lCrack=mix(1.-smoothstep(cw-aa,cw+aa,r),clamp(cw*1.15,0.,1.),far);
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

/* ---------------------------------------------------------------------------------------------------------------- */
/* Geometry                                                                                                            */

interface TongueDef {
  /** width: the channel on the cone, m; the lobe on the ground is sized from volume. */
  angle: number; width: number; run: number; bend: number; volume: number; seed: number;
  /** Front toes: c position, how far they reach (m), width in c. */
  toes: [number, number, number][];
  /** A stopped side lobe budding off one flank at the foot. */
  side: { sign: -1 | 1; volume: number } | null;
}
const DEG = Math.PI / 180;
const TONGUES: TongueDef[] = [
  { angle: -64 * DEG, width: 2.6, run: 6.5, bend: .1, volume: 15, seed: 1, toes: [[-.45, 1.1, .22], [.35, 1.6, .25]], side: null },
  { angle: -38 * DEG, width: 3.2, run: 8.0, bend: -.06, volume: 22, seed: 2, toes: [[.1, 1.5, .3], [-.62, .9, .2]], side: { sign: 1, volume: 7 } },
  { angle: -13 * DEG, width: 2.9, run: 6.0, bend: .08, volume: 17, seed: 3, toes: [[.5, 1.3, .22], [-.2, 1.0, .25]], side: { sign: -1, volume: 6 } },
  { angle: 16 * DEG, width: 3.4, run: 7.0, bend: -.08, volume: 24, seed: 4, toes: [[-.3, 1.6, .25], [.55, 1.0, .2]], side: { sign: 1, volume: 8 } },
  { angle: 41 * DEG, width: 2.8, run: 7.5, bend: .07, volume: 17, seed: 5, toes: [[0, 1.3, .3]], side: { sign: -1, volume: 6 } },
  { angle: 66 * DEG, width: 2.6, run: 5.5, bend: -.1, volume: 14, seed: 6, toes: [[.4, 1.0, .22], [-.4, 1.3, .22]], side: null },
];

/** The surfaces lava lies on: crater lip, faceted cone, and the terrain mesh exactly as frontierIsland triangulates it. */
class Support {
  readonly lakeR = 7.35;
  readonly crestR = 8.7;
  readonly crestY: number;
  readonly lakeY: number;
  private readonly lipA: number;
  readonly cone: Cone;
  private readonly height: (x: number, z: number) => number;
  constructor(cone: Cone, height: (x: number, z: number) => number) {
    this.cone = cone; this.height = height;
    this.crestY = cone.topY + 1.05;
    this.lipA = this.crestY - this.coneSmooth(this.crestR);
    this.lakeY = this.lip(this.lakeR);
  }
  coneSmooth(rho: number) { const c = this.cone; return c.baseY + (c.baseR - rho) / (c.baseR - c.topR) * (c.topY - c.baseY); }
  coneFacet(x: number, z: number) {
    const c = this.cone, dx = x - c.x, dz = z - c.z, rho = Math.hypot(dx, dz), seg = TAU / c.segments;
    const th = Math.atan2(dx, dz), local = ((th % seg) + seg) % seg - seg / 2;
    return this.coneSmooth(rho * Math.cos(local) / Math.cos(seg / 2));
  }
  /** The lip: a rounded rampart round the crater lake that merges into the cone below. */
  lip(rho: number) {
    if (rho <= this.crestR) return this.crestY - 2.25 * (1 - smooth(6.6, this.crestR, rho));
    const u = (rho - this.crestR) / 1.6, k = 1.9 * 1.6 / this.lipA;
    return this.coneSmooth(rho) + this.lipA * (1 + k * u) * Math.exp(-u * u);
  }
  /** The terrain as the 300 x 350 m, 2 m grid PlaneGeometry draws it (two triangles per cell, diagonal b-d). */
  terrain(x: number, z: number) {
    const fx = (x + 150) / 2, fz = (z + 175) / 2, ix = clamp(Math.floor(fx), 0, 149), iz = clamp(Math.floor(fz), 0, 174);
    const u = fx - ix, v = fz - iz, X = ix * 2 - 150, Z = iz * 2 - 175, h = this.height;
    if (u + v <= 1) { const a = h(X, Z); return a + (h(X + 2, Z) - a) * u + (h(X, Z + 2) - a) * v; }
    const c = h(X + 2, Z + 2); return c + (h(X, Z + 2) - c) * (1 - u) + (h(X + 2, Z) - c) * (1 - v);
  }
  /** Height under the lava. `faceted` false gives the smooth cone used for shading normals; k rounds the cone foot. */
  at(x: number, z: number, faceted: boolean, k: number) {
    const rho = Math.hypot(x - this.cone.x, z - this.cone.z);
    if (rho <= this.crestR) return this.lip(rho);
    const coneY = faceted ? mix(this.coneSmooth(rho), this.coneFacet(x, z), smooth(11.5, 13.5, rho)) : this.coneSmooth(rho);
    const u = (rho - this.crestR) / 1.6, kk = 1.9 * 1.6 / this.lipA;
    const lipBump = this.lipA * (1 + kk * u) * Math.exp(-u * u);
    return smax(Math.min(coneY, this.cone.topY + 2) + lipBump, this.terrain(x, z), k);
  }
  /** Distance from the volcano axis at which the cone meets the terrain along a direction. */
  footRadius(angle: number) {
    for (let r = 14; r < 40; r += .05) { const x = this.cone.x + Math.sin(angle) * r, z = this.cone.z + Math.cos(angle) * r; if (this.coneSmooth(r) <= this.terrain(x, z)) return r; }
    return 30;
  }
}

interface TongueBuild {
  geometry: THREE.BufferGeometry;
  outline: { x: number; z: number; ox: number; oz: number; s: number; ground: boolean }[];
  zones: LavaZone[];
}

/** One tongue: a ribbon parametrised by s (along) and c (across, -1..1) from inside the crater lake to its toes. */
function buildTongue(def: TongueDef, sup: Support, quality: LavaQuality): TongueBuild {
  const cone = sup.cone;
  const rho0 = 6.9, foot = sup.footRadius(def.angle), rhoEnd = foot + def.run;
  // Centre line in xz, sampled finely, with its 3D arc length.
  const angleAt = (rho: number) => def.angle + .018 * Math.sin(rho * .45 + def.seed * 1.7) * (1 - smooth(foot - 3, foot, rho)) + def.bend * smooth(foot - 2, rhoEnd, rho);
  const N = 900, cx: number[] = [], cz: number[] = [], cs: number[] = [], crho: number[] = [];
  const rhoMax = rhoEnd + 6;
  for (let i = 0; i <= N; i++) {
    const rho = rho0 + (rhoMax - rho0) * i / N, a = angleAt(rho);
    const x = cone.x + Math.sin(a) * rho, z = cone.z + Math.cos(a) * rho, y = sup.at(x, z, false, 1.2);
    if (i > 0) { const j = i - 1; cs.push(cs[j] + Math.hypot(x - cx[j], z - cz[j], y - (sup.at(cx[j], cz[j], false, 1.2)))); } else cs.push(0);
    cx.push(x); cz.push(z); crho.push(rho);
  }
  const sAtRho = (rho: number) => { const f = clamp((rho - rho0) / (rhoMax - rho0) * N, 0, N - 1e-6), i = Math.floor(f); return mix(cs[i], cs[i + 1], f - i); };
  const centre = (s: number) => {
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cs[mid] <= s) lo = mid; else hi = mid; }
    const t = clamp((s - cs[lo]) / Math.max(cs[hi] - cs[lo], 1e-6), 0, 1);
    const x = mix(cx[lo], cx[hi], t), z = mix(cz[lo], cz[hi], t), tx = cx[hi] - cx[lo], tz = cz[hi] - cz[lo], tl = Math.hypot(tx, tz) || 1;
    return { x, z, tx: tx / tl, tz: tz / tl, rho: mix(crho[lo], crho[hi], t) };
  };
  const sLip = sAtRho(sup.crestR), sFoot = sAtRho(foot), sEnd = sAtRho(rhoEnd);
  const R = lobeRadius(def.volume);
  const halfW = (s: number) => mix(mix(1.1, def.width / 2, smooth(sLip, sLip + 9, s)), R, smooth(sFoot - 1.5, sEnd - R * .5, s));
  // Side lobe: an elliptic bulge on one flank, sized from its own volume.
  const sideR = def.side ? lobeRadius(def.side.volume) : 0, sSide = sFoot + 1.4 + sideR * .3, sideLen = sideR * 1.05;
  const bulge = (s: number) => { if (!def.side) return 0; const u = (s - sSide) / sideLen; return Math.abs(u) >= 1 ? 0 : sideR * .95 * Math.sqrt(1 - u * u); };
  const halfSide = (s: number, sign: number) => halfW(s) + (def.side && def.side.sign === sign ? bulge(s) : 0);
  // The front: rounded corners, toes reaching out, an outline that wanders.
  const Rf = R * .85;
  const front = (c: number) => {
    let f = sEnd + Rf * (Math.sqrt(Math.max(0, 1 - c * c)) - 1);
    for (const [tc, amp, w] of def.toes) f += amp * Math.exp(-(((c - tc) / w) ** 2));
    return f + .22 * Math.sin(c * 7.3 + def.seed * 2.1) + .12 * Math.sin(c * 17.1 + def.seed);
  };
  // Speed falls from the cone speed to the toe speed; material coordinate X = U0 * travel time (bunches where slow).
  const speed = (s: number) => mix(U0, U_TOE, Math.pow(smooth(sFoot - 3, sEnd + 1, s), .8));
  const Xm = new Float64Array(2001), sTop = Math.max(...def.toes.map(t => t[1])) + sEnd + 1;
  for (let i = 1; i <= 2000; i++) { const s0 = sTop * (i - 1) / 2000, s1 = sTop * i / 2000; Xm[i] = Xm[i - 1] + (s1 - s0) * U0 / speed((s0 + s1) / 2); }
  const XmAt = (s: number) => { const f = clamp(s / sTop * 2000, 0, 1999.999), i = Math.floor(f); return mix(Xm[i], Xm[i + 1], f - i); };
  const temperature = (s: number) => mix(mix(.99, .86, smooth(sLip, sFoot, s)), .42, smooth(sFoot - 1, sEnd - 1, s));
  const leveeAt = (s: number) => smooth(sLip + .5, sLip + 4, s) * (1 - smooth(sFoot - 1, sFoot + 2.5, s));
  const lobeAt = (s: number) => smooth(sFoot - 1, sFoot + 2.5, s);
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
    for (let k = 0; k < K; k++) {
      const s = k < coarse ? (f - 2.6) * k / coarse : f - 2.6 * Math.pow(1 - (k - coarse + 1) / fine, 1.6);
      const i = k * J + j, cl = centre(s), w = halfSide(s, sign), v = c * w;
      const x = cl.x + cl.tz * v, z = cl.z - cl.tx * v; // side vector (tz, -tx) points to +c
      // Thickness: Bingham dome over the distance to the outline, capped thinner on the steep cone; levees on top.
      const dSide = (1 - Math.abs(c)) * w, dFront = Math.max(0, f - s), dist = Math.max(0, smin(dSide, dFront, .6));
      const cap = mix(.45, 1.4, smooth(sFoot - 2, sFoot + 1, s));
      const lev = leveeAt(s);
      let h = smin(domeHeight(dist), cap, .15);
      h += .32 * lev * Math.exp(-(((Math.abs(c) - .89) / .075) ** 2)) * Math.min(1, dist / .2);
      const kFoot = 1.2 * (1 - c * c);
      const y0 = sup.at(x, z, true, kFoot) + .045, yS = sup.at(x, z, false, kFoot) + .045;
      const ns = supNormal(x, z, kFoot);
      base[i * 3] = x; base[i * 3 + 1] = y0; base[i * 3 + 2] = z;
      baseS[i * 3] = x; baseS[i * 3 + 1] = yS; baseS[i * 3 + 2] = z;
      nrm[i * 3] = ns.x; nrm[i * 3 + 1] = ns.y; nrm[i * 3 + 2] = ns.z;
      thick[i] = h; sArr[i] = s;
      const out = def.side && sign === def.side.sign ? Math.max(0, Math.abs(v) - halfW(s)) : 0;
      const act = 1 - smooth(.2, 1.1, out);
      aLA.set([XmAt(s), c, w, temperature(s) * mix(.08, 1, act)], i * 4);
      aLB.set([act, lev, U0 / speed(s), lobeAt(s)], i * 4);
      // Swell only well inside the active lobe: nothing that is meant to be at rest (levees, stopped lobes) may move.
      const swell = smooth(.95, 1, act) * (lev > 1e-3 ? 0 : 1) * smooth(sFoot + 2.5, sEnd - 1, s) * clamp((dist - .3) / 1.2, 0, 1);
      aLC.set([0, swell, clamp(s / sEnd, 0, 1.2), h], i * 4);
      shadeH[i] = smin(domeHeight(dist, YIELD_D, .9), cap, .3) + (h - smin(domeHeight(dist), cap, .15));
    }
  }
  // Positions on the faceted cone; shading from a softer dome (edge rounded over 0.9 m, then blurred) on the smooth
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
  // Wind so the faces look up.
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
    // Check the winding against the normal once and flip if needed.
    const ia = index[0], ib = index[1], ic = index[2];
    const pa = new THREE.Vector3().fromArray(pos, ia * 3), pb = new THREE.Vector3().fromArray(pos, ib * 3), pc = new THREE.Vector3().fromArray(pos, ic * 3);
    const fn = new THREE.Vector3().crossVectors(pb.sub(pa), pc.sub(pa));
    if (fn.dot(new THREE.Vector3().fromArray(normals, ia * 3)) < 0) { for (let q = 0; q < index.length; q += 3) { const t = index[q + 1]; index[q + 1] = index[q + 2]; index[q + 2] = t; } g.setIndex(index); }
  }
  g.computeBoundingSphere();
  // Outline (edge columns and the front row), outward directions in xz, for the clinker band and the halo.
  const outline: TongueBuild['outline'] = [];
  const push = (k: number, j: number, jIn: number, kIn: number) => {
    const i = k * J + j, ii = kIn * J + jIn, x = base[i * 3], z = base[i * 3 + 2];
    let ox = x - base[ii * 3], oz = z - base[ii * 3 + 2]; const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    outline.push({ x, z, ox, oz, s: sArr[i], ground: sArr[i] > sFoot - 1.5 });
  };
  for (let k = K - 1; k >= 0; k--) push(k, 0, 1, k);
  for (let j = 1; j < J - 1; j++) push(K - 1, j, j, K - 3);
  for (let k = 0; k < K; k++) push(k, J - 1, J - 2, k);
  // Footprint on the ground for props to avoid.
  const zones: LavaZone[] = [];
  for (let s = sAtRho(foot - 2); s < sEnd; s += 2.5) { const cl = centre(s); zones.push({ x: cl.x, z: cl.z, radius: Math.max(halfSide(s, -1), halfSide(s, 1)) + 1, kind: 'tongue' }); }
  { const cl = centre(sEnd - R * .4); zones.push({ x: cl.x, z: cl.z, radius: R + 2.2, kind: 'toe' }); }
  return { geometry: g, outline, zones };
}

/** The crater rampart, turned from the lip profile and sunk into the cone at its foot. */
function lipGeometry(sup: Support, quality: LavaQuality) {
  const pts: THREE.Vector2[] = [];
  const steps = quality === 'high' ? 40 : 20;
  for (let i = 0; i <= steps; i++) { const rho = 6.5 + (12.7 - 6.5) * i / steps; pts.push(new THREE.Vector2(rho, sup.lip(rho) - (i === steps ? .7 : 0))); }
  const g = new THREE.LatheGeometry(pts, quality === 'high' ? 72 : 40);
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
  private readonly tongueGeo: Record<LavaQuality, THREE.BufferGeometry[]> = { high: [], low: [] };
  private readonly support: Support;
  private readonly tongueMeshes: THREE.Mesh[] = [];
  private readonly lip: THREE.Mesh;
  private readonly lipGeo: Record<LavaQuality, THREE.BufferGeometry>;
  private readonly clinker: THREE.InstancedMesh;
  private readonly clinkerCount: number;
  private quality: LavaQuality = 'high';
  private qualityAt = -1e9;

  constructor(opts: EmberLavaOptions) {
    this.root.name = 'ember-lava';
    const cone: Cone = { x: 0, z: -128, baseY: opts.ly - 10, topY: opts.ly + 28, baseR: 28, topR: 8, segments: 18 };
    const sup = new Support(cone, opts.height);
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
    const tongues = new THREE.Group(); tongues.name = 'lava-tongues'; this.root.add(tongues);
    const tongueMat = this.tongueMaterial();
    const outlines: TongueBuild['outline'][] = [];
    TONGUES.forEach((def, i) => {
      const built = buildTongue(def, sup, this.quality);
      this.tongueGeo[this.quality][i] = built.geometry;
      const mesh = new THREE.Mesh(built.geometry, tongueMat);
      mesh.name = `lava-tongue-${i}`; mesh.receiveShadow = true;
      tongues.add(mesh); this.tongueMeshes.push(mesh);
      outlines.push(built.outline); this.zones.push(...built.zones);
    });

    // Edges on the ground: a darker halo and a band of clinker crumbs, half of them pushed into the lava's edge.
    tongues.add(this.halo(outlines, sup));
    const clinker = this.clinkerPool(outlines, sup);
    this.clinker = clinker.mesh; this.clinkerCount = clinker.count;
    this.clinker.count = this.quality === 'high' ? this.clinkerCount : Math.floor(this.clinkerCount / 2);
    tongues.add(this.clinker);
    this.root.userData.lavaZones = this.zones;
  }

  /** Switch detail; called by update() when the stored setting changes. */
  setQuality(q: LavaQuality) {
    if (q === this.quality) return;
    this.quality = q;
    this.common.uDetail.value = q === 'high' ? 1 : 0;
    this.tongueMeshes.forEach((m, i) => { m.geometry = this.tongueGeo[q][i] ??= buildTongue(TONGUES[i], this.support, q).geometry; });
    this.lip.geometry = this.lipGeo[q];
    this.clinker.count = q === 'high' ? this.clinkerCount : Math.floor(this.clinkerCount / 2);
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
  }

  private tongueMaterial() {
    const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: .86, metalness: 0, clearcoat: 1, clearcoatRoughness: .32 });
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
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${TONGUE_COAT}`)
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
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${POOL_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${POOL_NORMAL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${POOL_EMIT}`)
        .replace('#include <dithering_fragment>', MASK_OUT);
    };
    m.customProgramCacheKey = () => m.name;
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

  /** A dark halo, 0.75 m wide, laid on the ground and cone round every tongue (about 25 % darker at the edge). */
  private halo(outlines: TongueBuild['outline'][], sup: Support) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    for (const line of outlines) {
      const start = pos.length / 3;
      line.forEach((p, i) => {
        for (const [off, alpha] of [[-.1, .3], [.25, .22], [.75, 0]] as const) {
          const x = p.x + p.ox * off, z = p.z + p.oz * off;
          pos.push(x, sup.at(x, z, true, 0) + .05, z); col.push(0, 0, 0, alpha * (p.s < 3 ? 0 : 1));
        }
        if (i > 0) { const a = start + (i - 1) * 3, b = start + i * 3; for (let r = 0; r < 2; r++) idx.push(a + r, b + r, a + r + 1, a + r + 1, b + r, b + r + 1); }
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    m.name = 'ember-lava-halo';
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'lava-halo'; mesh.renderOrder = 1;
    return mesh;
  }

  /** Clinker: a fixed pool of dark crumbs along the outlines (0.3-0.6 m band), noise from world space. */
  private clinkerPool(outlines: TongueBuild['outline'][], sup: Support) {
    const spots: { x: number; z: number; s: number; inside: boolean }[] = [];
    let seed = 1;
    for (const line of outlines) {
      let acc = 0;
      for (let i = 1; i < line.length; i++) {
        const p = line[i], q = line[i - 1];
        if (!p.ground) continue;
        acc += Math.hypot(p.x - q.x, p.z - q.z) * 11;
        while (acc >= 1) {
          acc -= 1; seed++;
          const t = hash1(seed * 1.3), inside = hash1(seed * 2.9) < .45;
          const off = inside ? -.05 - .25 * hash1(seed * 3.7) : .02 + .55 * Math.pow(hash1(seed * 4.1), 1.4);
          const x = mix(q.x, p.x, t) + p.ox * off + (hash1(seed * 5.3) - .5) * .12, z = mix(q.z, p.z, t) + p.oz * off + (hash1(seed * 6.1) - .5) * .12;
          spots.push({ x, z, s: off, inside });
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
  const sup = new Support(cone, height);
  const zones: LavaZone[] = [{ x: cone.x, z: cone.z, radius: 13, kind: 'crater' }];
  for (const def of TONGUES) zones.push(...buildTongue(def, sup, 'low').zones);
  return zones;
}
