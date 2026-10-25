import * as THREE from 'three';
import {SNOW_WIND} from '../sim/world/snowGround';

/*
 * Grown ice formations for Frostlight. The crystal shape (a six-sided tapered prism with a point, its hexagon
 * broken per seed) and the ice shading (flat facets from derivatives, path absorption, refraction, back-lit glow,
 * a frosted foot that attaches it to the drift) are ported from SNOWFLOW's crystal.wgsl and crystal.fragment.wgsl
 * (MIT, Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md).
 * SNOWFLOW refracts into a baked sky LUT; this world has none, so `env()` is the island's own sky gradient
 * over a snow bounce, with the aurora in its northern quarter (world4.ts hangs the curtain there), so the ice
 * carries the aurora's green and violet wherever a facet looks north.
 * Glacier ice on top of that: the big crystals fold, step at a ledge or snap off, and shed shards at the foot; the
 * shader measures each pixel's chord through the body (a cylinder round the growth axis through the entry point),
 * so thin edges go white and thick cores deep blue, and the refracted ray meets fracture planes, milky growth
 * veils and bubbles inside. Real ridges carry a bright rim, up-facing facets hold snow, windward faces rime.
 */

export interface Crystal {
  x: number;
  y: number;
  z: number;
  /** Growth axis, need not be normalised. */
  axis: [number, number, number];
  height: number;
  radius: number;
  seed: number;
  /** A clean grown point: no ledge and never snapped off (sunbursts, crowns). */
  plain?: boolean;
}

const fract = (v: number) => v - Math.floor(v);
function hash21(x: number, y: number): number {
  let p3x = fract(x * 0.1031), p3y = fract(y * 0.1031), p3z = fract(x * 0.1031);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  return fract((p3x + p3y) * p3z);
}

type P3 = [number, number, number];
/** Rings of six around the axis (+Y, local), bottom first, and the point or the break's centre on top. */
interface Shape { rings: P3[][]; crease: boolean[]; top: P3; capped: boolean }
/** Below this a crystal is an icicle, a vein or a twig of rime: the plain prism. */
const SMALL_H = 1.1, SMALL_R = .16;

function crystalShape(c: Crystal): Shape {
  const {height: H, radius: R, seed} = c;
  const s = (k: number) => hash21(seed * 1.37 + k * 7.13, k * 3.11 + seed);
  // Each radial direction gets its own length: no regular hexagon, which reads as manufactured.
  const wob = Array.from({length: 6}, (_, k) => .72 + .56 * hash21(k + seed * 31, seed * 17));
  const ring = (y: number | ((k: number) => number), r: number, tw = 0, jit = 0, salt = 0): P3[] => Array.from({length: 6}, (_, k) => {
    const a = k * 1.04719755 + seed * 6.2831853 + tw, rr = R * r * wob[k] * (1 + (hash21(k * 5.1 + salt, seed + salt * 3.7) - .5) * jit);
    return [Math.cos(a) * rr, typeof y === 'number' ? y : y(k), Math.sin(a) * rr];
  });
  const apex: P3 = [(hash21(seed, 7.31) - .5) * R * .5, H, (hash21(7.31, seed) - .5) * R * .5];
  if (H < SMALL_H || R < SMALL_R) return {rings: [ring(0, 1), ring(H * .58, .68)], crease: [false, true], top: apex, capped: false};
  const rings = [ring(0, 1)], crease = [false];
  // A fold low on the shaft: each side breaks into two facets, so no face is one flat slab.
  rings.push(ring(H * (.16 + .12 * s(1)), .95 + .07 * s(2), (s(3) - .5) * .14, .16, 1)); crease.push(false);
  let r = 1, shoulder = .58;
  if (!c.plain && H > 4 && s(4) < .32) {
    // A ledge where growth stopped and started again: a lip, then the shaft steps in. The break runs on a slant and
    // wanders a little, so it reads as a growth front, not a collar.
    const y = H * (.2 + .32 * s(5)), inset = .83 + .09 * s(6), dir = s(14) * 6.2831853, sl = R * (.3 + .35 * s(15));
    const ly = (k: number, lift: number) => y + lift + Math.cos(k * 1.04719755 + seed * 6.2831853 - dir) * sl + (hash21(k * 3.7 + seed, 11.3) - .5) * H * .03;
    rings.push(ring(k => ly(k, 0), .93, 0, .06, 2)); crease.push(true);
    rings.push(ring(k => ly(k, H * .014 + .03), .93 * inset, (s(7) - .5) * .2, .1, 3)); crease.push(true);
    r = .93 * inset; shoulder = .64;
  }
  rings.push(ring(H * (shoulder + (s(8) - .5) * .08), r * (r < 1 ? .8 : .68), (s(9) - .5) * .1, .1, 4)); crease.push(true);
  if (!c.plain && s(10) < .24 && H < 10) {
    // Snapped off: a slanted break face instead of the point.
    const yb = H * (.78 + .1 * s(11)), dir = s(12) * 6.2831853, sl = R * r * .32;
    const tilt = (k: number) => yb + Math.cos(k * 1.04719755 + seed * 6.2831853 - dir) * sl;
    const top = ring(tilt, r * .46, (s(13) - .5) * .2, .3, 5);
    rings.push(top); crease.push(true);
    const m = top.reduce((a, p) => [a[0] + p[0] / 6, a[1] + p[1] / 6, a[2] + p[2] / 6] as P3, [0, 0, 0] as P3);
    return {rings, crease, top: [m[0], m[1] + R * .05, m[2]], capped: true};
  }
  return {rings, crease, top: apex, capped: false};
}

/**
 * One non-indexed geometry for many crystals, so every facet is flat and a whole formation is one draw.
 * Per vertex: `aH01` (height up the crystal), `aSeed`, the crystal's root and unit axis (`aRoot`, `aAxis`), its
 * radius and height (`aDim`), and `aEdge`, barycentrics lifted by one on the edges that are not real ridges (the
 * diagonals of folded faces, the foot in the snow), so the shader can draw a rim on the ridges alone.
 */
export function crystalGeometry(list: readonly Crystal[]): THREE.BufferGeometry {
  const pos: number[] = [], h01: number[] = [], seeds: number[] = [], roots: number[] = [], axes: number[] = [], dims: number[] = [], edges: number[] = [];
  const axis = new THREE.Vector3(), ex = new THREE.Vector3(), ez = new THREE.Vector3(), ref = new THREE.Vector3(), w = new THREE.Vector3();
  for (const c of list) {
    axis.set(...c.axis);
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    axis.normalize();
    ref.set(Math.abs(axis.y) < 0.9 ? 0 : 1, 0, Math.abs(axis.y) < 0.9 ? 1 : 0);
    ex.crossVectors(ref, axis).normalize();
    ez.crossVectors(axis, ex);
    const sh = crystalShape(c);
    const put = (p: P3) => { w.set(c.x, c.y, c.z).addScaledVector(ex, p[0]).addScaledVector(axis, p[1]).addScaledVector(ez, p[2]); return w; };
    /** a-b-c with which of its edges (ab, bc, ca) are real ridges. */
    const tri = (a: P3, b: P3, d: P3, eab: boolean, ebc: boolean, eca: boolean) => {
      const hx = ebc ? 0 : 1, hy = eca ? 0 : 1, hz = eab ? 0 : 1;
      const bary: P3[] = [[1 + hx, hy, hz], [hx, 1 + hy, hz], [hx, hy, 1 + hz]];
      // Wound outward: the near facets are the front faces, so a pixel is where the view ray enters the body.
      ([[a, 0], [d, 2], [b, 1]] as const).forEach(([p, i]) => {
        const q = put(p);
        pos.push(q.x, q.y, q.z); h01.push(p[1] / c.height); seeds.push(c.seed);
        roots.push(c.x, c.y, c.z); axes.push(axis.x, axis.y, axis.z); dims.push(c.radius, c.height); edges.push(...bary[i]);
      });
    };
    for (let i = 0; i + 1 < sh.rings.length; i++) {
      const lo = sh.rings[i], up = sh.rings[i + 1];
      for (let k = 0; k < 6; k++) {
        const k1 = (k + 1) % 6;
        tri(lo[k], up[k], lo[k1], true, false, sh.crease[i]);
        tri(lo[k1], up[k], up[k1], false, sh.crease[i + 1], true);
      }
    }
    const last = sh.rings[sh.rings.length - 1], crease = sh.crease[sh.rings.length - 1];
    for (let k = 0; k < 6; k++) tri(last[k], sh.top, last[(k + 1) % 6], !sh.capped, !sh.capped, crease);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH01', new THREE.Float32BufferAttribute(h01, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  g.setAttribute('aRoot', new THREE.Float32BufferAttribute(roots, 3));
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(axes, 3));
  g.setAttribute('aDim', new THREE.Float32BufferAttribute(dims, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * A formation: one main crystal and satellites leaning out of it, like ice that grew from one seed, and (for the
 * big ones) shards broken off round its foot. `rand` is a deterministic 0..1 source, so the island looks the same
 * for every player; the shards draw from the main crystal's seed, so `rand` advances as it always did.
 */
export function crystalCluster(x: number, y: number, z: number, height: number, spread: number, count: number, rand: () => number, out: Crystal[] = []): Crystal[] {
  const lean = () => (rand() - 0.5) * 0.14;
  const main: Crystal = {x, y: y - 0.25, z, axis: [lean(), 1, lean()], height, radius: spread * 0.42, seed: rand() * 97};
  out.push(main);
  for (let j = 0; j < count; j++) {
    const a = (j / count + rand() * 0.18) * Math.PI * 2, d = spread * (0.35 + rand() * 0.45);
    const tilt = 0.25 + rand() * 0.45;
    out.push({
      x: x + Math.sin(a) * d, y: y - 0.2, z: z + Math.cos(a) * d,
      axis: [Math.sin(a) * tilt, 1, Math.cos(a) * tilt],
      height: height * (0.22 + rand() * 0.42),
      radius: spread * (0.12 + rand() * 0.14),
      seed: rand() * 97,
    });
  }
  if (height > 2.4) {
    let s = Math.floor(main.seed * 7919) >>> 0;
    const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const n = Math.min(7, 3 + Math.floor(height / 4));
    for (let j = 0; j < n; j++) {
      const a = r() * Math.PI * 2, d = spread * (0.55 + r() * 0.6), tilt = 0.7 + r() * 0.9;
      out.push({x: x + Math.sin(a) * d, y: y - 0.12, z: z + Math.cos(a) * d, axis: [Math.sin(a) * tilt, 1, Math.cos(a) * tilt],
        height: height * (0.05 + r() * 0.1), radius: spread * (0.05 + r() * 0.06), seed: r() * 97});
    }
  }
  return out;
}

export interface IceOptions {
  sun: THREE.DirectionalLight;
  skyHorizon?: THREE.ColorRepresentation;
  skyZenith?: THREE.ColorRepresentation;
  snowBounce?: THREE.ColorRepresentation;
  /** Overall brightness of the back-lit glow. */
  scatter?: number;
}

const ICE_VERTEX = /* glsl */ `
attribute float aH01;
attribute float aSeed;
attribute vec3 aRoot;
attribute vec3 aAxis;
attribute vec2 aDim;
attribute vec3 aEdge;
varying vec3 vWorld;
varying float vH01;
varying float vSeed;
varying vec3 vRoot;
varying vec3 vAxis;
varying vec2 vDim;
varying vec3 vEdge;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vWorld=w.xyz;vH01=aH01;vSeed=aSeed;vDim=aDim;vEdge=aEdge;
  vRoot=(modelMatrix*vec4(aRoot,1.)).xyz;vAxis=normalize(mat3(modelMatrix)*aAxis);
  vec4 mvPosition=viewMatrix*w;
  gl_Position=projectionMatrix*mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const ICE_FRAGMENT = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyHorizon;
uniform vec3 skyZenith;
uniform vec3 snowBounce;
uniform float scatter;
uniform float iceDetail;
uniform vec2 iceWind;
varying vec3 vWorld;
varying float vH01;
varying float vSeed;
varying vec3 vRoot;
varying vec3 vAxis;
varying vec2 vDim;
varying vec3 vEdge;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
vec2 icHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float icHash13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float icNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(icHash22(i)*2.-1.,f),b=dot(icHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(icHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(icHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
// The aurora as the ice sees it: a band of rays across the northern sky, green low, violet high.
vec3 icAurora(vec3 d){
  float north=smoothstep(-.2,.75,-d.z*inversesqrt(max(dot(d.xz,d.xz),1e-4)));
  float band=smoothstep(-.06,.18,d.y)*(1.-smoothstep(.55,.9,d.y));
  float az=atan(d.x,-d.z),rays=.5+.5*sin(az*21.+sin(az*4.3)*2.2);
  return mix(vec3(.06,.62,.4),vec3(.3,.2,.72),smoothstep(.22,.55,d.y))*north*band*(.45+.55*rays);
}
// What the ice sees: the island's sky above the horizon, lit snow below it.
vec3 sky(vec3 d){
  if(d.y<0.)return snowBounce*(.55+.45*smoothstep(-1.,0.,d.y));
  return mix(skyHorizon,skyZenith,smoothstep(0.,.6,d.y))+sunColor*.03*pow(max(dot(d,sunDir),0.),12.);
}
vec3 env(vec3 d){return sky(d)+icAurora(d)*step(0.,d.y);}
// Light on a matte surface facing n: the whole sky dome and the snow bounce (the zenith alone is night-blue).
vec3 dome(vec3 n){return mix(snowBounce*.75,mix(skyHorizon,skyZenith,.2)*1.25,.5+.5*n.y);}
float wrapDiffuse(float nl,float w){return max(0.,(nl+w)/((1.+w)*(1.+w)));}
void main(){
  #include <logdepthbuf_fragment>
  vec3 V=normalize(cameraPosition-vWorld);
  vec3 L=normalize(sunDir);
  // Flat facet normal from the geometry: the facet-to-facet jump in reflected sky is the look of ice.
  vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
  if(dot(N,V)<0.)N=-N;
  float NdotV=clamp(dot(N,V),1e-4,1.),NdotL=dot(N,L);
  // Each crystal its own ice: hue (glacier blue to green-cyan), clarity, age (milk and rime).
  float s1=fract(vSeed*.618034+.137),s2=fract(vSeed*.414214+.71),s3=fract(vSeed*.318310+.29);
  vec3 A=normalize(vAxis);float R=max(vDim.x,.01),H=max(vDim.y,.01);
  // The chord through the body along the refracted ray: a cylinder round the axis through the entry point, cut
  // at the tip and the foot. Short at the silhouette and in the point, long through the core.
  vec3 rd=refract(-V,N,1./1.31);
  if(dot(rd,rd)<.5)rd=-V;
  vec3 rel=vWorld-vRoot;float along=dot(rel,A);vec3 pp=rel-A*along;
  float ra=dot(rd,A);vec3 dp=rd-A*ra;
  float th=max(-2.*dot(pp,dp),0.)/max(dot(dp,dp),.02);
  th=min(th,max(ra>0.?(H-along)/max(ra,1e-3):along/max(-ra,1e-3)+.3*R,0.));
  th=min(th,2.6*R);
  // Optical depth against the crystal's own girth, so every face runs from a pale rim to a deep core; icicles stay pale.
  float tk=1.-exp(-th/((.75+.3*s2)*R+.25));
  // Light inside the body: the sky through every face, the sun scattered through the whole crystal and, when it
  // stands behind it, along its length instead of leaving a silhouette.
  vec3 hS=normalize(L+N*.42);
  float through=pow(clamp(dot(V,-hS),0.,1.),2.2);
  // Scattered light loses its red in the ice: the low amber sun reaches the core nearly white.
  vec3 sunIn=mix(sunColor,vec3(dot(sunColor,vec3(.3,.5,.2))),.6);
  vec3 lightIn=dome(N)*.85+sunIn*RECIPROCAL_PI*(wrapDiffuse(NdotL,.9)*.4+.12+through*scatter*1.3);
  // Three kinds of ice by seed: clear glacier blue, green-cyan meltwater ice, and old milky ice gone pale; so a stand
  // of spires is not one colour.
  float kG=smoothstep(.36,.5,s1)*(1.-smoothstep(.72,.8,s1)),kO=smoothstep(.76,.86,s1);
  vec3 mid=mix(mix(vec3(.035,.29,.72),vec3(.04,.43,.52),kG),vec3(.26,.5,.74),kO);
  vec3 deep=mix(mix(vec3(.006,.07,.36),vec3(.008,.17,.24),kG),vec3(.04,.17,.42),kO);
  vec3 thin=vec3(.74,.88,.97);
  vec3 body=mix(thin,mid,smoothstep(.05,.45,tk));
  body=mix(body,deep,smoothstep(.45,.9,tk));
  // Inside the ice along the ray: milky veils in growth bands (tilted with the crystal) and trapped bubbles.
  float milk=0.,bub=0.,foot=length(fwidth(vWorld));
  float nS=1.+2.*iceDetail;
  for(int k=0;k<3;k++){
    if(float(k)>=nS)break;
    float t=th*(.18+.32*float(k)),u=dot(rel+rd*t,A);vec3 q=rel+rd*t;
    vec3 qs=q-A*u;
    // Veils lie along the growth: stretched up the axis, narrow across it, so they read as sheets in the body.
    float veil=icNoise(vec2(u*.32+vSeed*3.1,dot(qs,vec3(.8,.3,.6))*2.1+vSeed))*.5+.5;
    // Growth bands, but only in places: a band that ran round every crystal would read as a striped lamp.
    float band=(icNoise(vec2(u*1.9+dot(qs,vec3(.3,.2,-.5))*.6+vSeed*7.,vSeed*1.3))*.5+.5)*smoothstep(.35,.75,icNoise(vec2(u*.35,dot(qs,vec3(-.6,.2,.4))*.5)+vSeed*2.)*.5+.5);
    milk+=smoothstep(.5,.85,veil*.8+band*.32)/nS;
    if(iceDetail>.5){vec3 g=q*4.2+vSeed;vec3 id=floor(g);float hb=icHash13(id);
      if(hb>.82){vec3 o=vec3(icHash13(id+7.1),icHash13(id+3.3),icHash13(id+5.9))-.5;bub+=smoothstep(.15,.05,length(fract(g)-.5-o*.5))*exp(-t*.7);}}
  }
  bub*=1.-smoothstep(.015,.05,foot);
  float milky=milk*mix(.3,1.,s3)*(1.+kO*.5);
  body=mix(body,vec3(.7,.84,.94),milky);
  vec3 color=body*lightIn;
  // The sky refracted through the thin parts.
  color+=env(rd)*exp(-vec3(1.5,.42,.17)*th)*.3;
  // Fracture planes: sheets inside the body that the ray crosses, milky, glinting where they mirror the sun.
  float trace=0.;
  for(int i=0;i<3;i++){
    if(float(i)>=nS)break;
    vec3 hh=fract(vSeed*vec3(1.31,.917,.513)+float(i)*vec3(.37,.61,.83));
    vec3 n=normalize(hh*2.-1.+A*(hh.x-.5)*1.2);
    vec3 c=vRoot+A*H*(.14+.5*hh.y);
    float dn=dot(n,rd);
    vec3 cv=vWorld-c;
    float ext=.22+.24*hh.z;
    // Where the plane breaks the surface: a hairline.
    float sd=dot(n,cv),sw=max(fwidth(sd)*1.2,.006);
    vec3 cs=cv-n*sd;
    float inS=1.-smoothstep(ext*.8,ext,length(cs-A*dot(cs,A)*.6)/R+icNoise(cs.xz*2.3+hh.xy*9.)*.2);
    trace=max(trace,(1.-smoothstep(sw*.5,sw,abs(sd)))*inS);
    if(abs(dn)<.04)continue;
    float t=-sd/dn;
    if(t<=0.||t>th)continue;
    vec3 qc=cv+rd*t;
    float m=1.-smoothstep(ext*.7,ext,length(qc-A*dot(qc,A)*.6)/R+icNoise(vec2(dot(qc,A),dot(qc,cross(n,A)))*2.2+hh.xy*9.)*.22);
    // The sheet mirrors the sun over its hackled face, not in one hot disc.
    float gl=pow(max(dot(reflect(rd,n),L),0.),5.)*smoothstep(.2,.8,icNoise(vec2(dot(qc,A),dot(qc,cross(n,A)))*5.+hh.zy*7.)*.5+.5);
    color+=(lightIn*vec3(.05,.085,.11)+sunIn*gl*.09)*m*exp(-t*.45);
  }
  // The aurora caught in the body, and the bubbles.
  color+=icAurora(normalize(vec3(N.x,max(N.y,.12),N.z)))*(.35+.35*through);
  color+=lightIn*vec3(.55,.68,.75)*bub*.6+vec3(.55,.68,.75)*lightIn*trace*.35;
  // Frost where it comes out of the drift (higher on the windward side), snow lodged on whatever faces up (ledges,
  // breaks, the backs of leaning crystals), powder dusted low, rime on the windward faces of the old ice.
  float wind=dot(N.xz,-iceWind);
  // Surface coordinates on the facet itself (across it, and up it), so no pattern smears diagonally down a face.
  vec2 fT=N.xz+vec2(1e-4,0.);fT=vec2(-fT.y,fT.x)*inversesqrt(dot(fT,fT));
  vec2 fc=mix(vec2(dot(vWorld.xz,fT),vWorld.y),vWorld.xz,smoothstep(.55,.8,abs(N.y)));
  float grain=icNoise(fc*6.+vSeed*19.)*.5+.5;
  float rise=clamp(.14*H,.25,1.7)*(.7+.25*wind+.5*(icNoise(vWorld.xz*.9+vSeed)*.5+.5)+s3*.3);
  float frost=clamp((1.-smoothstep(rise*.2,rise,abs(along)))*(.45+.6*grain),0.,1.);
  float up=N.y+icNoise(fc*3.1+7.)*.16;
  float lodged=smoothstep(.5,.7,up)*smoothstep(.15,.35,icNoise(fc*1.9+3.)*.5+.5+.2);
  float dust=smoothstep(.62,.9,icNoise(fc*vec2(5.,2.6)+vSeed)*.5+.5)*(1.-smoothstep(rise,rise*2.2,abs(along)))*.45;
  // Rime: feathers grown into the wind in soft patches on the windward faces of the old ice, thinning upward.
  float rime=smoothstep(.25,.85,wind)*smoothstep(.62,.95,s3)*smoothstep(.5,.78,icNoise(fc*vec2(.9,.45)+vSeed)*.5+.5+(grain-.5)*.18)*.6;
  frost=max(max(frost,lodged),max(dust,rime));
  if(frost>.002){
    vec3 fa=vec3(.88,.915,.965);
    vec3 fc=fa*RECIPROCAL_PI*sunColor*wrapDiffuse(NdotL,.62)+fa*dome(N)*.8;
    color=mix(color,fc,frost*.92);
  }
  // A bright rim on the real ridges, worn along its length: a pixel and a half wide, or a few centimetres near.
  float e=min(min(vEdge.x,vEdge.y),vEdge.z),fe=max(fwidth(e),1e-5);
  float px=e/fe,mw=e*foot/fe;
  float rim=max(1.-smoothstep(.1,.95,px),(1.-smoothstep(0.,min(.04,R*.08),mw))*.5)*(1.-smoothstep(.08,.3,fe));
  // Worn along its length, brightest where the ridge turns to the sun, and quieter with distance: a ridge glints in
  // places instead of outlining the crystal (a white outline on every edge reads as a drawn gem).
  rim*=smoothstep(.4,.78,icNoise(vec2(dot(vWorld,vec3(.7,1.3,.5))*.9,vSeed))*.5+.5)*(.3+.7*smoothstep(-.1,.6,NdotL+through*.5));
  rim*=(1.-frost*.6)*mix(1.,.22,smoothstep(.012,.045,foot));
  vec3 rc=dome(N)*.7+sunColor*RECIPROCAL_PI*(.08+1.4*smoothstep(-.2,.7,NdotL)+through*.8);
  color=mix(color,rc*vec3(.88,.96,1.),rim*.6);
  float rough=mix(.1,.42,frost);
  vec3 mirror=reflect(-V,N);
  float F=.021+.979*pow(1.-NdotV,5.);
  color=mix(color,env(mirror),F*(1.-frost*.75));
  if(NdotL>0.){
    vec3 Hh=normalize(V+L);
    float a2=rough*rough*rough*rough,nh=clamp(dot(N,Hh),0.,1.);
    float dd=nh*nh*(a2-1.)+1.;
    float D=a2/(PI*dd*dd);
    float k=(rough+1.)*(rough+1.)/8.;
    float Vis=1./((NdotV*(1.-k)+k)*(NdotL*(1.-k)+k)*4.);
    float Fs=.021+.979*pow(1.-clamp(dot(V,Hh),0.,1.),5.);
    // The sun mirrored in a facet rolls off at about twice white (scaled as a whole, so it keeps its hue): a glint,
    // not a second sun blooming over the spire.
    vec3 sp=sunColor*D*Vis*Fs*NdotL;float sm=max(max(sp.r,sp.g),sp.b);
    color+=sp*((sm<1.?sm:1.+(1.-exp(-(sm-1.)*1.2)))/max(sm,1e-5));
  }
  // Thin ice lets the drift behind show through; the thick core, the milk and the snow do not.
  float alpha=clamp(.42+.56*smoothstep(0.,.5,tk)+milky*.25+.2*(1.-NdotV)+frost*.6+rim*.5,0.,1.);
  gl_FragColor=vec4(color,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Blended but depth-writing: the first facet at a pixel shows the snow behind it, every facet behind that is
 * depth-rejected, so no crystal is ever blended over another one. `refresh(quality)` once a frame: 'low' keeps one
 * sample inside the body and one fracture plane, and drops the bubbles.
 */
export function iceMaterial(opts: IceOptions): { material: THREE.ShaderMaterial; refresh: (quality?: 'high' | 'low') => void } {
  const sunDir = new THREE.Vector3(0, 1, 0), sunColor = new THREE.Color(), tmp = new THREE.Vector3();
  const material = new THREE.ShaderMaterial({
    vertexShader: ICE_VERTEX,
    fragmentShader: ICE_FRAGMENT,
    transparent: true,
    depthWrite: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      sunDir: { value: sunDir },
      sunColor: { value: sunColor },
      // Linear values, the same numbers the island's sky shader writes.
      skyHorizon: { value: opts.skyHorizon ? new THREE.Color(opts.skyHorizon) : new THREE.Color().setRGB(0.32, 0.49, 0.65) },
      skyZenith: { value: opts.skyZenith ? new THREE.Color(opts.skyZenith) : new THREE.Color().setRGB(0.015, 0.045, 0.13) },
      snowBounce: { value: opts.snowBounce ? new THREE.Color(opts.snowBounce) : new THREE.Color().setRGB(0.55, 0.65, 0.78) },
      scatter: { value: opts.scatter ?? 0.9 },
      iceDetail: { value: 1 },
      iceWind: { value: new THREE.Vector2(SNOW_WIND[0], SNOW_WIND[1]) },
    }]),
  });
  // merge() clones values, so keep the live objects the refresh writes into.
  material.uniforms.sunDir.value = sunDir;
  material.uniforms.sunColor.value = sunColor;
  const refresh = (quality: 'high' | 'low' = 'high') => {
    opts.sun.getWorldPosition(sunDir);
    opts.sun.target.getWorldPosition(tmp);
    sunDir.sub(tmp).normalize();
    sunColor.copy(opts.sun.color).multiplyScalar(opts.sun.intensity);
    material.uniforms.iceDetail.value = quality === 'low' ? 0 : 1;
  };
  refresh();
  return { material, refresh };
}
