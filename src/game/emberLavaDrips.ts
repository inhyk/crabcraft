import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Drips where World V's lava hangs over an edge: a bulb sags out of a lip, stretches into a string while its neck thins,
 * pinches off, the drop falls and lands as a splat that flattens and cools, and what is left of the string recoils up
 * into the lip (the recoil is what says "viscous": water snaps back at once, jelly bounces, lava draws itself back
 * slowly). Sites (SPECS): lava toes budding off the crusted live tongues on the cone's 62 degree face, which show
 * against the dark crust from the sanctuary and the volcano foot, and two at the edges of live spillways where the crater
 * rampart's outer face drops at about 74 degrees. A ray onto the tongue meshes finds where each lip leaves the lava and
 * where its drop lands.
 *
 * Everything is a fixed pool: one tube per site deformed in the vertex shader (its length, neck, bulb and heat come in
 * as per-instance attributes the CPU computes from the clock each frame) and one InstancedMesh of lobed blobs holding
 * every site's lip, drop and splat (three slots per site; a slot that has nothing to show is scaled to 0). Blob shapes
 * are lobed, picked from each blob's own id (site and cycle), never plain spheres (isaac_sim #771: spheres read as a
 * cloud of beads). Two draw calls in all; nothing is allocated per frame.
 */

export type DripQuality = 'high' | 'low';

/** One flow as emberLava.ts lays it out. */
export interface DripSpill {
  /** Centre-line azimuth against the distance from the volcano axis (0 faces the sanctuary, positive towards +x). */
  angleAt: (rho: number) => number;
  /** 1 a live flow; lower is an older flow at rest (no drips). */
  heat: number;
}
export interface DripFrame {
  /** Height of the rock under the lava (crater lip, cone, terrain). */
  ground: (x: number, z: number) => number;
  /** The volcano axis. */
  cone: { x: number; z: number };
  /** TONGUES in emberLava.ts order. */
  spills: DripSpill[];
  /** The lava surfaces the drips hang from and land on (the tongue meshes); the rock swollen by the lava's thickness
   * stands in where a ray misses them. */
  surfaces: THREE.Object3D[];
  /** The lava's QA mask uniform (EmberLava.setMask): drips draw as flowing lava, their lips as lava at rest. */
  mask: { value: number };
}

/** Where a drip hangs: which flow, where along it (a distance from the axis, or 'brink' for the spillway's brink on
 * the rampart's outer face), sideways offset (m, + to the right looking downhill), how far the lip overhangs (m), how
 * crusted the lava there is (1 the tongues' crust, low on open melt). */
interface SiteSpec { spill: number; rho: number | 'brink'; side: number; over: number; crust: number }
/** In priority order: low quality keeps the first LOW_SITES. Toes on the crusted tongues low on the cone, where a glowing
 * drip shows against dark crust (the first two and the fifth in view of the volcano-foot camera, all of them from the
 * sanctuary), and two at the edges of live spillways on the rampart's outer face (on open melt, hardly crusted). */
const SPECS: SiteSpec[] = [
  { spill: 1, rho: 21.2, side: .45, over: 1.05, crust: 1 },
  { spill: 2, rho: 20.4, side: -.2, over: 1.05, crust: 1 },
  { spill: 1, rho: 16.6, side: -.5, over: 1, crust: 1 },
  { spill: 5, rho: 17.2, side: .3, over: 1, crust: 1 },
  { spill: 0, rho: 20.6, side: .35, over: 1, crust: 1 },
  { spill: 1, rho: 'brink', side: -.78, over: .55, crust: .15 },
  { spill: 0, rho: 16.2, side: .2, over: 1, crust: 1 },
  { spill: 5, rho: 'brink', side: .72, over: .55, crust: .15 },
];
const LOW_SITES = 4;

/** Lava thickness on the cone (the tongues' cap in emberLava.ts), m. */
const LAVA_H = .42;
const G = 9.81;
/** Share of a cycle spent growing before the pinch, and the recoil time, s. */
const PINCH = .72, RECOIL = .8;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash1 = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export interface DripSite {
  id: number;
  /** Where the string hangs from (under the lip). */
  anchor: THREE.Vector3;
  /** Downhill direction in xz. */
  outX: number; outZ: number;
  /** Lava surface the drop lands on, its normal. */
  land: THREE.Vector3; landN: THREE.Vector3;
  period: number; phase: number;
  /** How crusted the lava it drips from is: little at the spillways' open melt, fully lower down the cone. */
  crust: number;
  /** Pinch length, neck radius at the start, bulb radius, root radius, m. */
  length: number; r0: number; rb: number; rRoot: number;
  /** Time from the pinch to the drop touching down, s. */
  fall: number;
  lip: THREE.Matrix4;
}

/** What one drip is doing at an instant: the string's length, neck and bulb; the drop's height while it falls; the
 * splat's age (s since landing, -1 none). */
export interface DripState {
  cycle: number; t: number;
  stage: 'grow' | 'recoil' | 'rest';
  length: number; neck: number; bulb: number; stretch: number; heat: number;
  drop: boolean; dropY: number; dropTail: number;
  splatAge: number; splatSeed: number;
}

/** Pure function of the clock, shared by the renderer and QA. */
export function dripState(site: DripSite, time: number): DripState {
  const P = site.period, tt = time + site.phase, cycle = Math.floor(tt / P), t = tt - cycle * P, tp = PINCH * P;
  const L0 = site.rb * 1.15;
  const s: DripState = { cycle, t, stage: 'grow', length: L0, neck: site.r0, bulb: site.rb * .75, stretch: 1.15, heat: 1, drop: false, dropY: 0, dropTail: 0, splatAge: -1, splatSeed: 0 };
  if (t < tp) {
    // Sagging: slow at first, faster as the neck gives (necking runs away towards the pinch).
    const u = t / tp;
    s.length = L0 + (site.length - L0) * (.3 * u + .7 * Math.pow(u, 2.6));
    s.neck = site.r0 * (1 - .85 * smooth(.4, 1, u));
    s.bulb = site.rb * (.75 + .25 * smooth(0, .6, u));
    s.stretch = 1.2 + .45 * smooth(.3, 1, u);
  } else {
    const a = t - tp;
    if (a < RECOIL) {
      // What stays draws itself back up into the lip, slower as it shortens, and gathers into a bead at its end.
      s.stage = 'recoil';
      const v = a / RECOIL, e = 1 - Math.pow(1 - v, 2.4);
      const left = site.length - 2 * site.rb * 1.6;
      s.length = mix(left, L0, e);
      s.neck = site.r0 * mix(.15, 1, e);
      s.bulb = site.rb * mix(.1, .75, Math.pow(e, .7));
      s.heat = .85 + .15 * e;
    } else s.stage = 'rest';
    // The drop: starts where the bulb was, already moving at the string's last rate.
    if (a < site.fall) {
      const y0 = site.anchor.y - (site.length - site.rb * 1.6), v0 = .6;
      s.drop = true; s.dropY = y0 - v0 * a - .5 * G * a * a;
      s.dropTail = 1 - smooth(0, .22, a);
    }
  }
  // The splat of this cycle's drop, or of the last cycle's while it is still cooling.
  const landAt = tp + site.fall;
  const age = t >= landAt ? t - landAt : t + P - landAt;
  if (age < P * .64 && (t >= landAt || cycle > 0)) { s.splatAge = age; s.splatSeed = site.id * 101 + (t >= landAt ? cycle : cycle - 1); }
  return s;
}

/* ---------------------------------------------------------------------------------------------------------------- */

const BB = /* glsl */ `
uniform float uMask;
// Linear HDR black body as emberLava.ts (LAVA_COMMON): t 0..1 is about 800 K .. 1450 K.
vec3 dripBB(float t){
  t=clamp(t,0.,1.2);
  vec3 c=mix(vec3(1.,.04,0.),vec3(1.,.27,.012),smoothstep(0.,1.,t));
  return c*(7.*t*t*t);
}
float dripHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float dripNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(dripHash(i),dripHash(i+vec2(1,0)),f.x),mix(dripHash(i+vec2(0,1)),dripHash(i+vec2(1,1)),f.x),f.y);}
`;

/** The string: rings along v (0 at the lip, 1 at the tip), the bulb's rings spread by angle so its round end is smooth. */
const STRING_VERT_HEAD = /* glsl */ `
attribute vec2 aV;
attribute vec4 aS0; // length, neck radius, bulb radius, bulb stretch
attribute vec4 aS1; // root radius, temperature (1 fresh), crust amount, seed
varying vec3 vDW;
varying vec3 vDS; // s / length, material coordinate along the string, angle
varying float vDHeat;
varying float vDCrust;
float dSmax(float a,float b,float k){if(k<1e-4)return max(a,b);float h=max(k-abs(a-b),0.)/k;return max(a,b)+h*h*k*.25;}
float dripR(float s){
  float L=aS0.x,rn=aS0.y,rb=aS0.z,e=aS0.w,rr=aS1.x;
  float cb=L-rb*e;
  float q=clamp(s/max(cb,.02),0.,1.);
  // Thread: flared at the lip, thinnest just above the bulb, where it pinches.
  float th=mix(rr,rn,smoothstep(0.,.6,q));
  th*=1.-smoothstep(cb,cb+rb*e*.6,s);
  // Bulb: a pear, narrow where the thread pulls it, full at the bottom.
  float zb=(s-cb)/(rb*e);
  float bu=rb*sqrt(max(0.,1.-zb*zb))*(1.+.3*zb);
  return dSmax(th,bu,rb*.8*(1.-smoothstep(cb,L,s)));
}
float dripS(float v){
  float L=aS0.x,rb=aS0.z,e=aS0.w,cb=L-rb*e,top=cb-rb*e;
  if(v<.55){float w=v/.55;return mix(-.05,top,1.-pow(1.-w,1.35));}
  return cb-rb*e*cos(3.14159*(v-.55)/.45);
}
`;
const STRING_NORMAL = /* glsl */ `
float dS=dripS(aV.x),dRr=dripR(dS);
float dDr=clamp((dripR(dS+.006)-dripR(dS-.006))/.012,-25.,25.);
if(aV.x>.999)dDr=-25.;
vec3 objectNormal=normalize(vec3(cos(aV.y),dDr,sin(aV.y)));
#ifdef USE_TANGENT
vec3 objectTangent=vec3(-sin(aV.y),0.,cos(aV.y));
#endif
`;
const STRING_BEGIN = /* glsl */ `
vec3 transformed=vec3(cos(aV.y)*dRr,-dS,sin(aV.y)*dRr);
vDS=vec3(clamp(dS/max(aS0.x,.02),0.,1.),dS*.45/max(aS0.x,.2),aV.y);
vDHeat=aS1.y;vDCrust=aS1.z;
`;
const STRING_TAIL = 'vDW=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;';
const STRING_FRAG_HEAD = /* glsl */ `
${BB}
varying vec3 vDW;
varying vec3 vDS;
varying float vDHeat;
varying float vDCrust;
float dCrust;
vec3 dEmit;
`;
const STRING_COLOR = /* glsl */ `
{
  float q=vDS.x;
  // A skin of crust in streaks along the string, stretched with it; torn open in the stretched middle.
  // Angle as a point on the circle, so the pattern has no seam.
  vec2 ring=vec2(cos(vDS.z),sin(vDS.z));
  float bulbZone=smoothstep(.55,.8,q);
  // Streaks along the stretched thread, round flakes (world space) on the bulb.
  float n=mix(dripNoise(ring*2.6+vec2(vDW.x*4.1,vDS.y*14.+vDW.z*3.3)),dripNoise(vDW.xz*17.+vDW.y*19.),bulbZone);
  float n2=mix(dripNoise(ring*6.+vec2(vDW.z*7.,vDS.y*40.+3.)),dripNoise(vDW.zy*41.+vDW.x*7.),bulbZone);
  float mid=smoothstep(.04,.35,q)*(1.-smoothstep(.55,.9,q));
  // Crust cover: the skin of the lava it came from on the root, torn open in the stretched middle, flakes on the bulb.
  float cover=mix(mix(.78,.12,smoothstep(.02,.3,q)),.66,smoothstep(.62,.9,q))*vDCrust;
  float v=n*.68+n2*.32;
  dCrust=smoothstep(1.-cover-.05,1.-cover+.03,v);
  float seam=smoothstep(.09,0.,abs(v-(1.-cover)))*dCrust; // glowing edges of the crust flakes
  // The inside is hot wherever it shows; the stretched middle hottest, the bulb's end cooling.
  float T=vDHeat*mix(mix(.7,.62,smoothstep(.6,1.,q)),.88,mid);
  dEmit=dripBB(T)*(1.-dCrust)+dripBB(T*.92)*seam*.45+dripBB(T*.5)*.06*dCrust;
  diffuseColor.rgb=mix(vec3(.1,.035,.02),vec3(.04,.036,.038),dCrust);
}
`;
const STRING_ROUGH = 'roughnessFactor=mix(.36,.8,dCrust);';

/** Lobed blobs: lips (kind 0), drops (1, a tail while they leave the string), splats (2). */
const BLOB_VERT_HEAD = /* glsl */ `
attribute vec4 aB; // seed, heat, tail, kind
varying vec3 vDW;
varying vec3 vDNW;
varying vec4 vDB;
vec3 dH3(float s){return fract(sin(vec3(s*12.9898,s*78.233,s*37.719))*43758.5453);}
`;
const BLOB_NORMAL = /* glsl */ `
vec3 n0=normalize(position);
float r=1.;vec3 gr=vec3(0.);
for(int k=0;k<3;k++){
  vec3 d=normalize(dH3(aB.x+float(k)*3.7)-.5+vec3(0.,.001,0.));
  float a=mix(.12,.32,dH3(aB.x*1.3+float(k)).x)*(aB.w>1.99?2.2:1.);
  float c=max(dot(n0,d),0.);
  r+=a*c*c*c; gr+=3.*a*c*c*d;
}
r/=1.12;
gr-=dot(gr,n0)*n0;
vec3 objectNormal=normalize(n0-gr/r);
#ifdef USE_TANGENT
vec3 objectTangent=vec3(1.,0.,0.);
#endif
`;
const BLOB_BEGIN = /* glsl */ `
vec3 transformed=n0*r;
// Lips taper from the sheet (-x) to the string's root (+x).
if(aB.w<.99)transformed.yz*=1.-.58*smoothstep(-.7,1.,n0.x);
if(aB.w>.99&&aB.w<1.99){
  // Leaving the string: stretched, its top drawn into a short tail that snaps in.
  float e=1.+.7*aB.z;
  transformed.xz*=(1.-.55*aB.z*smoothstep(-.2,1.,n0.y))/sqrt(e);
  transformed.y*=e;
}
vDB=aB;
`;
const BLOB_TAIL = 'vDW=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;\nvDNW=mat3(modelMatrix)*mat3(instanceMatrix)*objectNormal;';
const BLOB_FRAG_HEAD = /* glsl */ `
${BB}
varying vec3 vDW;
varying vec3 vDNW;
varying vec4 vDB;
float dCrust;
vec3 dEmit;
`;
const BLOB_COLOR = /* glsl */ `
{
  vec3 nW=normalize(vDNW);
  // Bigger plates on the lips, which are the lava's own skin; finer flakes on drops and splats.
  float fq=vDB.w<.99?.5:1.;
  float n=dripNoise((vDW.xz*20.+vDW.y*13.)*fq+vDB.x),n2=dripNoise(vDW.zy*45.*fq+vDB.x*1.7);
  float T=vDB.y;
  // Lips: crusted on top, open underneath where the string leaves. Drops: a torn skin. Splats: the crust closes over
  // them as they cool. All less crusted on hotter lava.
  float kind=floor(vDB.w+.01),crust=fract(vDB.w+.01)/.45;
  float cover=kind<.5?mix(.92,.6,smoothstep(.2,-.7,nW.y))*crust:kind<1.5?.35*crust:mix(.3*crust,1.1,smoothstep(.1,.85,1.-T/.72));
  float v=n*.65+n2*.35;
  dCrust=smoothstep(1.-cover-.06,1.-cover+.04,v);
  float seam=smoothstep(.1,0.,abs(v-(1.-cover)))*dCrust;
  dEmit=dripBB(T)*(1.-dCrust)+dripBB(T*.92)*seam*(vDB.w<.99?.25:.45)+dripBB(T*.5)*.06*dCrust;
  diffuseColor.rgb=mix(vec3(.1,.035,.02),vec3(.04,.036,.038),dCrust);
}
`;
const BLOB_ROUGH = 'roughnessFactor=mix(.38,.85,dCrust);';
const EMIT = 'totalEmissiveRadiance=dEmit;';
/** QA mask (EmberLava.setMask): moving drips are blue in mode 1 (flowing lava), the lips red (lava at rest). */
const maskOut = (still: string) => /* glsl */ `
#include <dithering_fragment>
if(uMask>.5){float still=${still};if(uMask>1.5)still=1.-still;gl_FragColor=vec4(still,0.,1.-still,1.);}
`;

/* ---------------------------------------------------------------------------------------------------------------- */

export class EmberLavaDrips {
  readonly root = new THREE.Group();
  readonly sites: DripSite[] = [];
  /** Pinches and landings counted by update() since it started (QA). */
  readonly stats = { pinches: 0, landings: 0 };
  private readonly strings: THREE.InstancedMesh;
  private readonly blobs: THREE.InstancedMesh;
  private readonly aS0: THREE.InstancedBufferAttribute;
  private readonly aS1: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly lastPinch: number[] = [];
  private readonly lastLand: number[] = [];
  private quality: DripQuality;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(frame: DripFrame, quality: DripQuality) {
    this.root.name = 'lava-drips';
    this.quality = quality;
    this.buildSites(frame);
    const n = this.sites.length;

    // String: 26 rings of 13 (the seam doubled), tip ring closed.
    const RINGS = 26, SEG = 12;
    const aV = new Float32Array(RINGS * (SEG + 1) * 2), pos = new Float32Array(RINGS * (SEG + 1) * 3);
    const idx: number[] = [];
    for (let r = 0; r < RINGS; r++) for (let k = 0; k <= SEG; k++) {
      const i = r * (SEG + 1) + k, a = k / SEG * Math.PI * 2;
      aV[i * 2] = r / (RINGS - 1); aV[i * 2 + 1] = a;
      pos.set([Math.cos(a) * .2, -r / (RINGS - 1), Math.sin(a) * .2], i * 3);
      if (r < RINGS - 1 && k < SEG) { const b = i + SEG + 1; idx.push(i, i + 1, b, i + 1, b + 1, b); }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aV', new THREE.BufferAttribute(aV, 2));
    sg.setIndex(idx);
    this.aS0 = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); this.aS0.setUsage(THREE.DynamicDrawUsage);
    this.aS1 = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); this.aS1.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aS0', this.aS0); sg.setAttribute('aS1', this.aS1);
    this.strings = new THREE.InstancedMesh(sg, this.stringMaterial(frame.mask), Math.max(1, n));
    this.strings.name = 'lava-drip-strings';
    this.sites.forEach((s, i) => {
      this.m.makeRotationY(Math.atan2(-s.outZ, s.outX)); // local +x downhill
      this.m.setPosition(s.anchor);
      this.strings.setMatrixAt(i, this.m);
    });

    // Blobs: three slots per site (lip, drop, splat).
    const ico = new THREE.IcosahedronGeometry(1, 2);
    ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
    const bg = mergeVertices(ico);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(n * 3 * 4), 4); this.aB.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('aB', this.aB);
    this.blobs = new THREE.InstancedMesh(bg, this.blobMaterial(frame.mask), Math.max(1, n * 3));
    this.blobs.name = 'lava-drip-blobs';
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sites.forEach((s, i) => {
      this.blobs.setMatrixAt(i * 3, s.lip);
      this.aB.setXYZW(i * 3, s.id * 7.31 + 2, .74, 0, s.crust * .45);
      this.blobs.setMatrixAt(i * 3 + 1, this.m.makeScale(0, 0, 0));
      this.blobs.setMatrixAt(i * 3 + 2, this.m.makeScale(0, 0, 0));
    });
    // Both pools span all the sites: one sphere round them for culling (the shader moves the vertices).
    const box = new THREE.Box3();
    for (const s of this.sites) { box.expandByPoint(s.anchor); box.expandByPoint(s.land); }
    const sphere = box.getBoundingSphere(new THREE.Sphere()); sphere.radius += 2;
    this.strings.boundingSphere = sphere; this.blobs.boundingSphere = sphere.clone();
    for (const mesh of [this.strings, this.blobs]) { mesh.castShadow = false; mesh.receiveShadow = false; this.root.add(mesh); }
    this.setCount();
  }

  /** Lava top: the rock under it swollen by the lava's thickness (a ball of LAVA_H rolled over the rock). */
  private static top(ground: DripFrame['ground'], x: number, z: number) {
    let m = -1e9;
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const dx = i * LAVA_H / 4, dz = j * LAVA_H / 4, d2 = dx * dx + dz * dz;
      if (d2 > LAVA_H * LAVA_H) continue;
      m = Math.max(m, ground(x + dx, z + dz) + Math.sqrt(LAVA_H * LAVA_H - d2));
    }
    return m;
  }

  private buildSites(frame: DripFrame) {
    const { cone, ground } = frame;
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
    for (const m of frame.surfaces) m.updateMatrixWorld(true);
    /** The lava's top and its normal at (x, z): a ray onto the tongue meshes, else the swollen rock. */
    const surf = (x: number, z: number, above: number) => {
      ray.set(o.set(x, above, z), down);
      const hit = ray.intersectObjects(frame.surfaces, false)[0];
      if (hit?.face) return { y: hit.point.y, n: hit.face.normal.clone().transformDirection(hit.object.matrixWorld) };
      const t = (a: number, b: number) => EmberLavaDrips.top(ground, a, b), e = .3;
      return { y: t(x, z), n: new THREE.Vector3((t(x - e, z) - t(x + e, z)) / (2 * e), 1, (t(x, z - e) - t(x, z + e)) / (2 * e)).normalize() };
    };
    SPECS.forEach((spec, k) => {
      const spill = frame.spills[spec.spill];
      if (!spill || spill.heat < 1) return;
      const at = (rho: number) => { const a = spill.angleAt(rho); return { x: cone.x + Math.sin(a) * rho, z: cone.z + Math.cos(a) * rho }; };
      let rho = typeof spec.rho === 'number' ? spec.rho : 0;
      if (spec.rho === 'brink') {
        // The steepest stretch of the rampart's outer face just past the crest.
        let best = 9.6, steep = 0;
        for (let r = 9; r < 11.5; r += .05) { const p = at(r), q = at(r + .2), d = (ground(p.x, p.z) - ground(q.x, q.z)) / .2; if (d > steep) { steep = d; best = r; } }
        rho = best - .25;
      }
      // Downhill is straight away from the axis (the cone and the rampart are round); the flow may wander across it.
      const c = at(rho);
      let ox = c.x - cone.x, oz = c.z - cone.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      const sx = c.x - oz * spec.side, sz = c.z + ox * spec.side; // right of downhill is (-oz, ox)
      const S = surf(sx, sz, ground(sx, sz) + 6);
      // The anchor hangs a little below the sheet's surface, so the lip droops towards it.
      const ax = sx + ox * spec.over, az = sz + oz * spec.over, ay = S.y - .1 - .2 * spec.over;
      const L = surf(ax, az, ay), clear = ay - L.y;
      const id = k + 1, h = hash1(id * 3.17);
      const rb = .085 + .025 * hash1(id * 5.3), r0 = .06 + .015 * hash1(id * 7.1);
      const length = clamp(clear * .72, .6, 1.2);
      // Fall from where the bulb hangs at the pinch to touching the lava under it.
      const fallH = Math.max(.05, (ay - (length - rb * 1.6)) - rb * .7 - L.y), v0 = .6;
      const fall = (-v0 + Math.sqrt(v0 * v0 + 2 * G * fallH)) / G;
      // The lip: a lobe of lava sagging out of the sheet, from just inside its surface to the anchor, where it thins
      // into the string's root.
      const from = new THREE.Vector3(sx, S.y, sz).addScaledVector(S.n, -.16), to = new THREE.Vector3(ax, ay + .04, az);
      const axis = to.clone().sub(from), span = axis.length();
      const lip = new THREE.Matrix4().compose(
        from.clone().lerp(to, .5),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis.normalize()),
        new THREE.Vector3(span * .5 + .12, .2, .24));
      this.sites.push({
        id, anchor: new THREE.Vector3(ax, ay, az), outX: ox, outZ: oz,
        land: new THREE.Vector3(ax, L.y, az), landN: L.n,
        period: 4 + 3 * h, phase: hash1(id * 9.7) * 7, length, r0, rb, rRoot: .1 + .02 * hash1(id * 2.3), fall, lip, crust: spec.crust,
      });
    });
  }

  private setCount() {
    const n = this.quality === 'high' ? this.sites.length : Math.min(LOW_SITES, this.sites.length);
    this.strings.count = n; this.blobs.count = n * 3;
  }

  get active() { return this.strings.count; }

  /** Every active site's state at `time` (QA). */
  state(time: number) { return this.sites.slice(0, this.active).map(s => dripState(s, time)); }

  update(time: number, quality: DripQuality) {
    if (quality !== this.quality) { this.quality = quality; this.setCount(); }
    const n = this.active, S0 = this.aS0.array as Float32Array, S1 = this.aS1.array as Float32Array, B = this.aB.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const site = this.sites[i], st = dripState(site, time);
      S0[i * 4] = st.length; S0[i * 4 + 1] = st.neck; S0[i * 4 + 2] = st.bulb; S0[i * 4 + 3] = st.stretch;
      S1[i * 4] = site.rRoot; S1[i * 4 + 1] = st.heat; S1[i * 4 + 2] = site.crust; S1[i * 4 + 3] = site.id;
      // Events for QA: a pinch once the grow stage of a cycle is over, a landing once its splat exists.
      const pinched = st.stage === 'grow' ? st.cycle - 1 : st.cycle;
      const landed = st.splatAge >= 0 ? (st.splatSeed - site.id * 101) : -1e9;
      if (this.lastPinch[i] === undefined) { this.lastPinch[i] = pinched; this.lastLand[i] = landed; }
      if (pinched > this.lastPinch[i]) { this.stats.pinches++; this.lastPinch[i] = pinched; }
      if (landed > this.lastLand[i]) { this.stats.landings++; this.lastLand[i] = landed; }
      // Drop.
      const rd = site.rb;
      if (st.drop) {
        this.m.compose(this.v.set(site.anchor.x, st.dropY, site.anchor.z), this.q.identity(), this.sc.setScalar(rd));
        B.set([site.id * 13.7 + st.cycle * 1.618, .72, st.dropTail, 1 + site.crust * .45], (i * 3 + 1) * 4);
      } else this.m.makeScale(0, 0, 0);
      this.blobs.setMatrixAt(i * 3 + 1, this.m);
      // Splat: flattens over 0.22 s without a bounce, cools, then sinks into the lava before the next one lands.
      if (st.splatAge >= 0) {
        const a = st.splatAge, f = 1 - Math.pow(1 - Math.min(a / .22, 1), 2);
        // On open melt (little crust) it stays hot and is taken in at once.
        const molten = site.crust < .5, sink = molten ? 1 - smooth(.25, 1.2, a) : 1 - smooth(site.period * .3, site.period * .62, a);
        this.q.setFromUnitVectors(this.up, site.landN);
        this.sc.set(rd * (1 + .6 * f) * (.6 + .4 * sink), rd * (1 - .5 * f) * sink, rd * (1 + .5 * f) * (.6 + .4 * sink));
        this.v.copy(site.landN).multiplyScalar(rd * .45 * (1 - f) + rd * .05).add(site.land);
        this.m.compose(this.v, this.q, this.sc);
        const heat = molten ? .8 : .72 * Math.exp(-a / 1.4);
        B.set([st.splatSeed * 1.618 + site.id * 13.7, heat, 0, 2 + site.crust * .45], (i * 3 + 2) * 4);
      } else this.m.makeScale(0, 0, 0);
      this.blobs.setMatrixAt(i * 3 + 2, this.m);
    }
    this.aS0.needsUpdate = this.aS1.needsUpdate = this.aB.needsUpdate = true;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  private stringMaterial(mask: { value: number }) {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .5, metalness: 0 });
    m.name = 'ember-lava-drip-string';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uMask = mask;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${STRING_VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', STRING_NORMAL)
        .replace('#include <begin_vertex>', STRING_BEGIN)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${STRING_TAIL}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${STRING_FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${STRING_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${STRING_ROUGH}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${EMIT}`)
        .replace('#include <dithering_fragment>', maskOut('0.'));
    };
    m.customProgramCacheKey = () => m.name;
    return m;
  }

  private blobMaterial(mask: { value: number }) {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .5, metalness: 0 });
    m.name = 'ember-lava-drip-blob';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uMask = mask;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${BLOB_VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', BLOB_NORMAL)
        .replace('#include <begin_vertex>', BLOB_BEGIN)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${BLOB_TAIL}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${BLOB_FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${BLOB_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${BLOB_ROUGH}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${EMIT}`)
        .replace('#include <dithering_fragment>', maskOut('vDB.w<.99?1.:0.'));
    };
    m.customProgramCacheKey = () => m.name;
    return m;
  }
}
