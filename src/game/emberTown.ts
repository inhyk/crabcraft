import * as THREE from 'three';
import type {LavaZone} from './emberLava';
import {
  FORGE_BANNERS, FORGE_BARGE, FORGE_CRANE, FORGE_D, FORGE_HOUSES, FORGE_JETTY, FORGE_LANTERNS, FORGE_QUAY, FORGE_RAIL,
  FORGE_STALLS, FORGE_W, FORGE_YARD, GLASS_KILN, SMELTER_TOWER, forgeYaw, type ForgeHouse,
} from './emberTownLayout';

/*
 * Emberreach's forge town and arrival quay (World V), from the plan in emberTownLayout.ts: six battered basalt houses
 * with lighter mortar, crow-stepped gables, verdigris copper or riveted iron roofs, big stacks breathing smoke and
 * sparks, glowing forge mouths and windows; each house shows its trade in its yard (smithy, smelter, inn, armourer,
 * glassblower, ore merchant). Caged ember lanterns on basalt posts line the avenue, heavy banners hang from iron bars,
 * an outdoor forge works west of the smelter, and the south rim is a quay with a jetty out over the lava, a heat-proof
 * ore barge on its chain ferry and a cargo crane.
 * Draw calls: everything solid is one merged mesh (one material; masonry, planks and riveted plates are drawn in its
 * shader from world position, pattern id and roughness/metalness per vertex), plus one each for glows, cloth, ground
 * light pools, smoke, flames and sparks. Local fire light: up to 16 warm point sources lit in the solid shader (no
 * three.js lights), additive pools carry it onto the ground.
 */

const V = THREE.Vector3;
type Geo = THREE.BufferGeometry;
type RGB = [number, number, number];
const TAU = Math.PI * 2;
/** Solid shader patterns. */
const PAT = {plain: 0, ashlar: 1, rubble: 2, plank: 3, plate: 4};
const lin = (hex: string, k = 1): RGB => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function storedQuality(): 'high' | 'low' { try { return localStorage.getItem('cc.quality') === 'low' ? 'low' : 'high'; } catch { return 'high'; } }

/** Accumulates world-space triangles with per-vertex colour and shader attributes. */
class Acc {
  private p: number[] = []; private n: number[] = []; private c: number[] = []; private u: number[] = [];
  private x: number[][] = [];
  private nm = new THREE.Matrix3(); private v = new V();
  col: RGB = [1, 1, 1];
  /** Extra per-vertex attributes (name, size), filled from `ex`. */
  ex: number[];
  constructor(readonly extras: [string, number][]) { this.ex = extras.flatMap(([, s]) => new Array(s).fill(0)); this.x = extras.map(() => []); }
  /** Adds g (consumed) under m; `grad` recolours by the geometry's own (local) position. */
  add(g: Geo, m: THREE.Matrix4, grad?: (x: number, y: number, z: number) => RGB, exf?: (x: number, y: number, z: number) => number[]) {
    const s = g.index ? g.toNonIndexed() : g;
    const P = s.getAttribute('position'), N = s.getAttribute('normal'), U = s.getAttribute('uv');
    this.nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      const lx = P.getX(i), ly = P.getY(i), lz = P.getZ(i);
      this.v.set(lx, ly, lz).applyMatrix4(m); this.p.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(N, i).applyMatrix3(this.nm).normalize(); this.n.push(this.v.x, this.v.y, this.v.z);
      const c = grad ? grad(lx, ly, lz) : this.col; this.c.push(c[0], c[1], c[2]);
      this.u.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      const ex = exf ? exf(lx, ly, lz) : this.ex;
      let o = 0; this.extras.forEach(([, size], k) => { for (let j = 0; j < size; j++) this.x[k].push(ex[o + j]); o += size; });
    }
    if (s !== g) s.dispose(); g.dispose();
  }
  get count() { return this.p.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    this.extras.forEach(([name, size], k) => g.setAttribute(name, new THREE.Float32BufferAttribute(this.x[k], size)));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/* Geometry ------------------------------------------------------------------------------------------------------- */

/** Quads to a flat-shaded geometry (each quad a,b,c,d counter-clockwise seen from outside). */
function quads(list: THREE.Vector3[][]): Geo {
  const p: number[] = [], n: number[] = [], e1 = new V(), e2 = new V(), nn = new V();
  for (const q of list) {
    e1.subVectors(q[1], q[0]); e2.subVectors(q[2], q[0]); nn.crossVectors(e1, e2).normalize();
    for (const k of q.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]) { p.push(q[k].x, q[k].y, q[k].z); n.push(nn.x, nn.y, nn.z); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}
/** Battered block: footprint w0 x d0 at y = 0 narrowing to w1 x d1 at y = h (sides and top). */
function frustum(w0: number, d0: number, w1: number, d1: number, h: number, bottom = false): Geo {
  const a = [new V(-w0 / 2, 0, d0 / 2), new V(w0 / 2, 0, d0 / 2), new V(w0 / 2, 0, -d0 / 2), new V(-w0 / 2, 0, -d0 / 2)];
  const b = [new V(-w1 / 2, h, d1 / 2), new V(w1 / 2, h, d1 / 2), new V(w1 / 2, h, -d1 / 2), new V(-w1 / 2, h, -d1 / 2)];
  const q: THREE.Vector3[][] = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; q.push([a[i], a[j], b[j], b[i]]); }
  q.push([b[0], b[1], b[2], b[3]]);
  if (bottom) q.push([a[3], a[2], a[1], a[0]]);
  return quads(q);
}
/** Gable prism: width w (x), ridge along z of length d, eaves at y = 0, ridge at y = h. */
function prism(w: number, h: number, d: number): Geo {
  const f = [new V(-w / 2, 0, d / 2), new V(w / 2, 0, d / 2), new V(0, h, d / 2)], b = f.map(p => new V(p.x, p.y, -d / 2));
  return quads([[f[0], f[1], f[2]], [b[1], b[0], b[2]], [f[1], b[1], b[2], f[2]], [b[0], f[0], f[2], b[2]]]);
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, s = 10) => new THREE.CylinderGeometry(r1, r0, h, s);
const lathe = (pr: [number, number][], s = 12) => new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), s);
/** Rough lump (ore, coal, slag): a squashed, jittered icosahedron. */
function lump(r: number, seed: number): Geo {
  const g = new THREE.IcosahedronGeometry(r, 0).toNonIndexed(), P = g.getAttribute('position');
  const key = (x: number, y: number, z: number) => hash(Math.round(x * 97) * 3 + Math.round(y * 89) * 7 + Math.round(z * 83) * 11 + seed);
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = .72 + .5 * key(x, y, z); P.setXYZ(i, x * k, y * k * .7, z * k); }
  g.computeVertexNormals(); return g;
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V();
const trs = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new V(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));

/* Shaders -------------------------------------------------------------------------------------------------------- */

const NOISE = /* glsl */ `
float etH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float etN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(etH(i),etH(i+vec2(1,0)),f.x),mix(etH(i+vec2(0,1)),etH(i+vec2(1,1)),f.x),f.y);}
`;

/** The one solid material: vertex colour, per-vertex pattern (aPat: id, scale, seed, ground y), roughness/metalness (aRM). */
function solidMaterial(lights: number, uniforms: {uTime: THREE.IUniform<number>; uLP: THREE.IUniform<THREE.Vector4[]>; uLC: THREE.IUniform<THREE.Vector4[]>}) {
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, metalness: 1});
  m.name = 'ember-town-solid';
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms, {uMortar: {value: new THREE.Color('#9a9188')}});
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPat;attribute vec2 aRM;varying vec4 vPat;varying vec2 vRM;varying vec3 vWP;varying vec3 vWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvPat=aPat;vRM=aRM;vWP=(modelMatrix*vec4(transformed,1.)).xyz;vWN=normalize(mat3(modelMatrix)*objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n#define ET_LIGHTS ${lights}\nuniform float uTime;uniform vec4 uLP[16];uniform vec4 uLC[16];uniform vec3 uMortar;varying vec4 vPat;varying vec2 vRM;varying vec3 vWP;varying vec3 vWN;\n${NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  vec3 N0=normalize(vWN);vec2 etQ;
  if(abs(N0.y)>.72)etQ=vWP.xz;else{vec2 t=normalize(vec2(-N0.z,N0.x));etQ=vec2(dot(vWP.xz,t),vWP.y);}
  float pat=vPat.x,etK=vPat.y,etSeed=vPat.z,etRough=1.;
  if(pat>.5&&pat<2.5){
    // Dressed stone (1) or rubble (2): staggered courses, block tint, bevelled arrises, lighter recessed mortar.
    float rub=step(1.5,pat);float hgt=(.44+.2*rub)*etK;float row=floor(etQ.y/hgt);
    float w=(.82+.5*etH(vec2(row,etSeed+3.)))*etK*(1.+.4*rub);float x=etQ.x+etH(vec2(row,etSeed))*3.;float c=floor(x/w);
    vec2 f=vec2(fract(x/w)*w,fract(etQ.y/hgt)*hgt);
    float e=min(min(f.x,w-f.x),min(f.y,hgt-f.y))+(etN(etQ*5.)-.5)*.05*etK*(.4+rub);
    float mo=1.-smoothstep(.016*etK,.04*etK,e);
    float bt=.76+.42*etH(vec2(c,row)+etSeed);
    vec3 st=diffuseColor.rgb*bt*(.86+.24*etN(etQ*6.+etSeed))*(.8+.2*smoothstep(.03,.14,e));
    diffuseColor.rgb=mix(st,uMortar*(.82+.2*etN(etQ*3.)),mo);etRough=1.+.15*mo;
  }else if(pat>2.5&&pat<3.5){
    // Planks: boards across u, grain along v, dark gaps.
    float w=.2*etK;float b=floor(etQ.x/w);float f=fract(etQ.x/w);
    float grain=etN(vec2(etQ.x*40.,etQ.y*2.5+b*7.));
    diffuseColor.rgb*=(.78+.36*etH(vec2(b,etSeed)))*(.8+.3*grain)*mix(.45,1.,smoothstep(0.,.06,f)*smoothstep(1.,.94,f));
  }else if(pat>3.5){
    // Roof and armour plates: standing seams, laps with rivets; etK is the verdigris on copper (0 = blackened iron).
    float sx=fract(etQ.x/.62),sy=fract(etQ.y/.95);
    float seam=1.-smoothstep(.0,.05,min(sx,1.-sx));float lap=1.-smoothstep(.0,.06,sy);
    vec2 rc=vec2(fract(etQ.x/.2)-.5,(sy-.08)*4.75);float riv=1.-smoothstep(.12,.2,length(rc));
    float streak=etN(vec2(etQ.x*5.,etQ.y*.5+etSeed))*.6+etN(vec2(etQ.x*13.,etQ.y*1.3))*.4;
    vec3 base=diffuseColor.rgb*(.82+.3*streak);
    base=mix(base,mix(vec3(.26,.11,.05),vec3(.55,.62,.55),streak),etK*smoothstep(.55,.85,streak)*.55);
    diffuseColor.rgb=base*(1.-.35*lap)*(1.+.25*seam)*(1.+.5*riv*(1.-etK*.5));etRough=1.-.25*seam-.2*riv;
  }else diffuseColor.rgb*=.9+.2*etN(etQ*4.+etSeed);
  // Contact darkening at the foot of everything, cool not black.
  diffuseColor.rgb*=mix(vec3(.46,.44,.52),vec3(1.),smoothstep(0.,1.5,vWP.y-vPat.w));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=clamp(vRM.x*etRough,.08,1.);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=vRM.y;')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
  {vec3 warm=vec3(0.);
   for(int i=0;i<ET_LIGHTS;i++){vec3 d=uLP[i].xyz-vWP;float r=uLP[i].w;float dl=length(d);
    if(dl<r){float fa=1.-dl/r;fa*=fa;float ndl=max(dot(N0,d/dl)*.8+.2,0.);
     float fl=1.+.16*sin(uTime*(6.3+uLC[i].w)+uLC[i].w*3.1)+.09*sin(uTime*15.7+uLC[i].w*7.);warm+=uLC[i].rgb*fa*ndl*fl;}}
   totalEmissiveRadiance+=warm*diffuseColor.rgb;}`);
  };
  m.customProgramCacheKey = () => 'ember-town-solid-' + lights;
  return m;
}

/** Glows (forge mouths, windows, coals, hot metal, lit glass): HDR vertex colours with a flicker (aFl: amount, phase). */
function glowMaterial(time: THREE.IUniform<number>) {
  const m = new THREE.MeshBasicMaterial({vertexColors: true});
  m.name = 'ember-town-glow';
  m.onBeforeCompile = s => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;attribute vec2 aFl;varying float vFl;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFl=1.+aFl.x*(.55*sin(uTime*5.1+aFl.y)+.3*sin(uTime*13.7+aFl.y*2.3)+.15*sin(uTime*23.+aFl.y*5.));');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFl;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=vFl;');
  };
  m.customProgramCacheKey = () => 'ember-town-glow';
  return m;
}

/** Banner cloth: canvas crest (two fields), sways from its bar (aSw: amount, phase). */
function bannerTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d')!;
  for (const [i, field, edge] of [[0, '#7c2416', '#c8923c'], [1, '#26242a', '#b9813a']] as [number, string, string][]) {
    const x0 = i * 128;
    const grad = g.createLinearGradient(x0, 0, x0 + 128, 0); grad.addColorStop(0, field); grad.addColorStop(.5, field); grad.addColorStop(1, field);
    g.fillStyle = grad; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + 128, 0); g.lineTo(x0 + 128, 216); g.lineTo(x0 + 64, 256); g.lineTo(x0, 216); g.closePath(); g.fill();
    // Weave and soot.
    for (let k = 0; k < 900; k++) { const x = x0 + hash(k + i * 1000) * 128, y = hash(k * 1.7 + 5 + i) * 240; g.fillStyle = `rgba(0,0,0,${.05 + .08 * hash(k + 9)})`; g.fillRect(x, y, 1, 2 + hash(k) * 4); }
    g.strokeStyle = edge; g.lineWidth = 6; g.beginPath(); g.moveTo(x0 + 10, 8); g.lineTo(x0 + 118, 8); g.lineTo(x0 + 118, 208); g.lineTo(x0 + 64, 244); g.lineTo(x0 + 10, 208); g.closePath(); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 18, 16); g.lineTo(x0 + 110, 16); g.lineTo(x0 + 110, 203); g.lineTo(x0 + 64, 234); g.lineTo(x0 + 18, 203); g.closePath(); g.stroke();
    // Crest: an anvil under a three-tongued flame.
    g.fillStyle = edge; const cx = x0 + 64;
    g.beginPath(); g.moveTo(cx - 34, 128); g.lineTo(cx + 26, 128); g.quadraticCurveTo(cx + 44, 130, cx + 40, 138); g.lineTo(cx + 18, 140); g.lineTo(cx + 12, 152); g.lineTo(cx + 20, 168); g.lineTo(cx - 22, 168); g.lineTo(cx - 14, 152); g.lineTo(cx - 20, 140); g.lineTo(cx - 34, 138); g.closePath(); g.fill();
    g.fillStyle = i ? '#e2602a' : '#f0b04a';
    for (const [dx, hgt, w] of [[0, 62, 14], [-16, 40, 10], [16, 44, 10]]) { g.beginPath(); g.moveTo(cx + dx - w, 120); g.quadraticCurveTo(cx + dx - w * 1.2, 120 - hgt * .55, cx + dx + w * .2, 120 - hgt); g.quadraticCurveTo(cx + dx + w * .4, 120 - hgt * .45, cx + dx + w, 120); g.closePath(); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function clothMaterial(time: THREE.IUniform<number>) {
  const m = new THREE.MeshStandardMaterial({map: bannerTexture(), side: THREE.DoubleSide, roughness: .92, alphaTest: .5, vertexColors: true});
  m.name = 'ember-town-cloth';
  m.onBeforeCompile = s => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;attribute vec2 aSw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed+=objectNormal*aSw.x*(.16*sin(uTime*1.6+aSw.y+position.y*.9)+.06*sin(uTime*3.7+aSw.y*2.+position.x*2.));');
  };
  m.customProgramCacheKey = () => 'ember-town-cloth';
  return m;
}

/** Billboard puffs: smoke (normal blend) or flame licks (additive). aE: emitter xyz + size, aS: corner xy, phase, seed. */
function puffMaterial(time: THREE.IUniform<number>, flame: boolean) {
  const m = new THREE.ShaderMaterial({
    name: flame ? 'ember-town-flame' : 'ember-town-smoke', transparent: true, depthWrite: false, fog: true,
    blending: flame ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {uWind: {value: new V(.55, 0, .3)}}]),
    defines: flame ? {FLAME: 1} : {},
    vertexShader: /* glsl */ `
uniform float uTime;uniform vec3 uWind;attribute vec4 aE;attribute vec4 aS;varying vec2 vUv;varying float vA;varying float vHot;varying float vSeed;
#include <common>
#include <fog_pars_vertex>
void main(){
#ifdef FLAME
  float age=fract(uTime*(.9+.5*aS.w)+aS.z);vec3 p=aE.xyz+vec3(sin(aS.w*40.+uTime*3.)*.12*aE.w,age*1.6*aE.w,cos(aS.w*30.+uTime*2.)*.12*aE.w);
  float size=aE.w*(.55-.35*age);vA=smoothstep(0.,.15,age)*(1.-smoothstep(.4,1.,age));vHot=1.-age;
#else
  float age=fract(uTime*.055*(.8+.4*aS.w)+aS.z);vec3 p=aE.xyz+vec3(0.,age*12.*aE.w,0.)+uWind*age*age*10.*aE.w+vec3(sin(aS.w*40.+uTime*.3),0.,cos(aS.w*30.+uTime*.25))*age*1.4*aE.w;
  float size=aE.w*(.6+age*3.4);vA=smoothstep(0.,.1,age)*(1.-smoothstep(.35,1.,age));vHot=1.-smoothstep(0.,.18,age);
#endif
  vec4 mv=modelViewMatrix*vec4(p,1.);float r=aS.w*6.28+age*1.2;vec2 c=mat2(cos(r),-sin(r),sin(r),cos(r))*aS.xy;mv.xy+=c*size;
  gl_Position=projectionMatrix*mv;vUv=aS.xy+.5;vSeed=aS.w;
  vec4 mvPosition=mv;
#include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
varying vec2 vUv;varying float vA;varying float vHot;varying float vSeed;
#include <common>
#include <fog_pars_fragment>
${NOISE}
void main(){
  float n=etN(vUv*3.2+vSeed*17.)*.6+etN(vUv*7.+vSeed*5.)*.4;float d=length(vUv-.5)*2.;
#ifdef FLAME
  float a=(1.-smoothstep(.15,.95,d+(n-.5)*.6))*vA;vec3 c=mix(vec3(1.,.28,.05),vec3(1.6,.9,.35),vHot*n)*1.6;
  gl_FragColor=vec4(c*a,1.);
#else
  float a=(1.-smoothstep(.25,1.,d+(n-.5)*.7))*vA*.5;vec3 c=mix(vec3(.17,.15,.16),vec3(.36,.3,.29),n);c=mix(c,vec3(1.,.42,.14),vHot*.55);
  gl_FragColor=vec4(c,a);
#endif
#ifndef FLAME
#include <fog_fragment>
#endif
}`,
  });
  m.uniforms.uTime = time;
  return m;
}

/** Rising sparks (additive points). aE: emitter xyz + spread, aS: phase, seed. */
function sparkMaterial(time: THREE.IUniform<number>) {
  const m = new THREE.ShaderMaterial({
    name: 'ember-town-sparks', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uTime: time},
    vertexShader: /* glsl */ `
uniform float uTime;attribute vec4 aE;attribute vec2 aS;varying float vA;varying float vT;
void main(){float age=fract(uTime*(.22+.2*aS.y)+aS.x);
  vec3 p=aE.xyz+vec3(sin(aS.y*91.+age*4.+uTime*.7)*aE.w*age,age*age*7.+age*2.,cos(aS.y*53.+age*3.)*aE.w*age)+vec3(.5,0.,.3)*age*age*3.;
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(42./-mv.z,1.,3.5);
  vA=(1.-age)*(.6+.4*sin(uTime*23.+aS.y*40.));vT=age;}`,
    fragmentShader: /* glsl */ `
varying float vA;varying float vT;
void main(){float d=length(gl_PointCoord-.5);float a=(1.-smoothstep(.15,.5,d))*vA;gl_FragColor=vec4(mix(vec3(2.4,1.3,.4),vec3(1.1,.25,.05),vT)*a,1.);}`,
  });
  return m;
}

/** Warm light pools on the ground (additive): aPool = intensity, phase, distance fade at 150 m. */
function poolMaterial(time: THREE.IUniform<number>) {
  return new THREE.ShaderMaterial({
    name: 'ember-town-pools', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    uniforms: {uTime: time},
    vertexShader: /* glsl */ `
uniform float uTime;attribute vec2 aPool;attribute vec3 color;varying vec2 vUv;varying float vI;varying vec3 vC;
void main(){vUv=uv;vC=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
  vI=aPool.x*(1.+.14*sin(uTime*6.1+aPool.y)+.07*sin(uTime*14.3+aPool.y*2.))*(1.-smoothstep(70.,150.,-mv.z));}`,
    fragmentShader: /* glsl */ `
varying vec2 vUv;varying float vI;varying vec3 vC;
void main(){float d=length(vUv-.5)*2.;float a=pow(max(1.-d,0.),2.2)*vI;gl_FragColor=vec4(vC*a,1.);}`,
  });
}

/* Town ----------------------------------------------------------------------------------------------------------- */

export interface EmberTownOptions { height: (x: number, z: number) => number; zones: LavaZone[]; quality?: 'high' | 'low' }

export class EmberTown {
  readonly root = new THREE.Group();
  readonly stats: Record<string, number> = {houses: 0, chimneys: 0, forgeMouths: 0, windows: 0, lanterns: 0, banners: 0, braziers: 0, carts: 0, blades: 0, lights: 0, pools: 0, smoke: 0, flames: 0, sparks: 0, skipped: 0};
  private readonly time = {value: 0};
  private readonly lightPos: THREE.Vector4[] = [];
  private readonly lightCol: THREE.Vector4[] = [];
  private readonly solid = new Acc([['aPat', 4], ['aRM', 2]]);
  private readonly glow = new Acc([['aFl', 2]]);
  private readonly cloth = new Acc([['aSw', 2]]);
  private readonly pools = new Acc([['aPool', 2]]);
  private readonly puffs: {x: number; y: number; z: number; s: number}[] = [];
  private readonly flames: {x: number; y: number; z: number; s: number}[] = [];
  private readonly sparks: {x: number; y: number; z: number; s: number; n: number}[] = [];
  private readonly lights: {x: number; y: number; z: number; r: number; c: RGB; k: number}[] = [];
  private readonly low: boolean;
  private readonly h: (x: number, z: number) => number;
  private readonly zones: LavaZone[];

  constructor(o: EmberTownOptions) {
    this.h = o.height; this.zones = o.zones; this.low = (o.quality ?? storedQuality()) === 'low';
    this.root.name = 'ember-forge-town';
    for (const h of FORGE_HOUSES) this.house(h);
    this.outdoorForge();
    FORGE_STALLS.forEach((s, i) => this.stall(s.x, s.z, s.side, i));
    FORGE_LANTERNS.forEach(([x, z], i) => this.lantern(x, z, i));
    FORGE_BANNERS.forEach(([x, z], i) => this.bannerPost(x, z, i));
    this.harbour();
    this.finish();
  }

  /* -- placement helpers -- */
  private clearOfLava(x: number, z: number, r: number) {
    for (const zn of this.zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.radius + r + 1) { this.stats.skipped++; return false; }
    return true;
  }
  /** Solid piece: colour, pattern, scale, roughness, metalness; `base` is the ground y for contact darkening. */
  private S(g: Geo, m: THREE.Matrix4, hex: string, pat = PAT.plain, k = 1, rough = .85, metal = 0, base = -99, seed = 0) {
    this.solid.col = lin(hex); this.solid.ex = [pat, k, seed, base, rough, metal]; this.solid.add(g, m);
  }
  private G(g: Geo, m: THREE.Matrix4, c: RGB, flicker = 0, phase = 0, grad?: (x: number, y: number, z: number) => RGB) {
    this.glow.col = c; this.glow.ex = [flicker, phase]; this.glow.add(g, m, grad);
  }
  private light(x: number, y: number, z: number, r: number, hex: string, k: number) { this.lights.push({x, y, z, r, c: lin(hex), k}); }
  private pool(x: number, z: number, r: number, hex: string, k: number, phase = 0) {
    const g = new THREE.PlaneGeometry(r * 2, r * 2, 4, 4); g.rotateX(-Math.PI / 2);
    const P = g.getAttribute('position');
    for (let i = 0; i < P.count; i++) P.setY(i, this.h(x + P.getX(i), z + P.getZ(i)) + .05);
    this.pools.col = lin(hex); this.pools.ex = [k, phase]; this.pools.add(g, trs(x, 0, z)); this.stats.pools++;
  }
  /** Fire with its light, ground pool, flames and sparks. */
  private fire(x: number, y: number, z: number, size: number, r: number, k: number, phase: number) {
    this.light(x, y + .5, z, r, '#ff8a3a', k);
    this.pool(x, z, r * .7, '#ff7a30', .55 * Math.min(1.4, k / 2), phase);
    this.flames.push({x, y, z, s: size});
    this.sparks.push({x, y: y + .2, z, s: .4 * size, n: 10});
  }

  /* -- reusable props (world placement through a matrix) -- */
  private barrel(m: THREE.Matrix4, base: number, seed: number) {
    this.S(lathe([[0, 0], [.34, 0], [.4, .2], [.43, .45], [.4, .7], [.34, .9], [0, .9]], 12), m, '#5a3f2e', PAT.plank, .55, .8, 0, base, seed);
    for (const y of [.12, .78]) this.S(cyl(.39, .39, .06, 12).translate(0, y, 0), m, '#2b2a2e', PAT.plain, 1, .45, .8, base);
    this.S(cyl(.43, .43, .06, 12).translate(0, .45, 0), m, '#2b2a2e', PAT.plain, 1, .45, .8, base);
  }
  private crate(m: THREE.Matrix4, base: number, seed: number, w = .9, hh = .7) {
    this.S(box(w, hh, w).translate(0, hh / 2, 0), m, '#5d4332', PAT.plank, .7, .85, 0, base, seed);
    for (const s of [-1, 1]) this.S(box(w + .04, .08, .08).translate(0, hh * (s > 0 ? .9 : .1), w / 2), m, '#2d2a2c', PAT.plain, 1, .5, .7, base);
  }
  /** Heap of rough lumps (ore, coal, slag); `hot` lumps glow. */
  private heap(x: number, z: number, r: number, n: number, hex: string, seed: number, hot = 0, flatY?: number) {
    const gh = (px: number, pz: number) => flatY ?? this.h(px, pz), base = gh(x, z);
    for (let i = 0; i < n; i++) {
      const a = hash(seed + i) * TAU, d = Math.sqrt(hash(seed + i * 3.1)) * r, lx = x + Math.cos(a) * d, lz = z + Math.sin(a) * d;
      const sz = .22 + .22 * hash(seed + i * 7.3), y = gh(lx, lz) + (r - d) * .55 * (n > 6 ? 1 : .5);
      const m = trs(lx, y, lz, hash(i + seed) * 6, hash(i * 2 + seed), 0);
      if (hot && hash(seed + i * 5.5) < hot) this.G(lump(sz * .9, i + seed), m, lin('#ff6a1c', 1.6), .35, i);
      else this.S(lump(sz, i + seed), m, hex, PAT.rubble, .5, .95, 0, base - .3, seed + i);
    }
  }
  private anvil(m: THREE.Matrix4, base: number) {
    this.S(cyl(.36, .32, .62, 9).translate(0, .31, 0), m, '#4a3527', PAT.plank, .6, .9, 0, base);
    this.S(box(.42, .14, .32).translate(0, .69, 0), m, '#29282c', PAT.plain, 1, .4, .85, base);
    this.S(frustum(.42, .32, .2, .18, .16).translate(0, .76, 0), m, '#29282c', PAT.plain, 1, .4, .85, base);
    this.S(box(.66, .14, .26).translate(.04, .99, 0), m, '#323136', PAT.plain, 1, .3, .9, base);
    this.S(new THREE.ConeGeometry(.12, .36, 8).rotateZ(Math.PI / 2).translate(-.47, 1.0, 0), m, '#323136', PAT.plain, 1, .3, .9, base);
    this.S(box(.5, .14, .02).translate(.04, 1.06, .0), m, '#8f8b8a', PAT.plain, 1, .22, .95, base);
  }
  private trough(m: THREE.Matrix4, base: number) {
    this.S(frustum(1.7, .8, 1.8, .9, .62), m, '#55504f', PAT.ashlar, .5, .9, 0, base, 7);
    this.S(box(1.5, .02, .6).translate(0, .55, 0), m, '#141418', PAT.plain, 1, .08, .3, base);
  }
  private brazier(x: number, z: number, s: number, phase: number) {
    const y = this.h(x, z), m = trs(x, y, z, phase);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; this.S(box(.06, 1.05 * s, .06).translate(0, .52 * s, 0).applyMatrix4(trs(Math.cos(a) * .3 * s, 0, Math.sin(a) * .3 * s, -a, 0, .22)), m, '#2a292d', PAT.plain, 1, .5, .8, y); }
    this.S(lathe([[.1, 0], [.38, .1], [.52, .32], [.55, .36], [.5, .36], [.36, .16], [0, .1]].map(([r, h]) => [r * s, h * s] as [number, number]), 12).translate(0, .95 * s, 0), m, '#2f2d31', PAT.plate, 0, .5, .8, y);
    this.G(lathe([[0, .3 * s], [.46 * s, .3 * s], [.3 * s, .42 * s], [0, .46 * s]], 10).translate(0, .95 * s, 0), m, lin('#ff7a24', 2.2), .4, phase);
    this.fire(x, y + 1.35 * s, z, 1.1 * s, 7 * s, 2.6, phase);
    this.stats.braziers++;
  }
  private cart(x: number, z: number, yaw: number, load: 'ore' | 'ingot', seed: number) {
    const y = this.h(x, z), m = trs(x, y, z, yaw);
    this.S(frustum(.95, 1.5, 1.25, 1.85, .7, true).translate(0, .38, 0), m, '#3a3638', PAT.plate, 0, .55, .75, y, seed);
    for (const s of [-1, 1]) for (const t of [-.5, .5]) {
      this.S(cyl(.24, .24, .08, 10).rotateZ(Math.PI / 2).translate(s * .55, .24, t), m, '#26252a', PAT.plain, 1, .45, .85, y);
      this.S(cyl(.07, .07, .1, 6).rotateZ(Math.PI / 2).translate(s * .6, .24, t), m, '#b9843a', PAT.plain, 1, .35, .9, y);
    }
    if (load === 'ore') for (let i = 0; i < 9; i++) {
      const lx = (hash(seed + i) - .5) * .8, lz = (hash(seed + i * 2) - .5) * 1.3, mm = m.clone().multiply(trs(lx, 1.02 + hash(i) * .12, lz, i));
      if (i % 4 === 0) this.G(lump(.2, i + seed), mm, lin('#ff5a14', 1.4), .3, i); else this.S(lump(.24, i + seed), mm, '#4b3a3a', PAT.rubble, .4, .9, .1, y, i);
    } else for (let i = 0; i < 6; i++) { const mm = m.clone().multiply(trs((i % 2 - .5) * .42, 1.08 + Math.floor(i / 4) * .12, (Math.floor(i / 2) % 2 - .5) * .6 + (i > 3 ? 0 : 0), 0)); this.G(frustum(.36, .7, .3, .62, .12), mm, lin('#ff8a2a', i > 3 ? 2.2 : 1.1), .2, i); }
    this.stats.carts++;
  }
  private rails(x0: number, z0: number, x1: number, z1: number) {
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let t = .4; t < len; t += .9) { const x = x0 + (x1 - x0) * t / len, z = z0 + (z1 - z0) * t / len; this.S(box(1.6, .12, .26), trs(x, this.h(x, z) + .04, z, yaw), '#3f3029', PAT.plank, .4, .95, 0, this.h(x, z), t); }
    for (const s of [-1, 1]) { const ox = Math.cos(yaw) * s * .55, oz = -Math.sin(yaw) * s * .55; const mx = (x0 + x1) / 2 + ox, mz = (z0 + z1) / 2 + oz; this.S(box(.09, .1, len), trs(mx, this.h(mx, mz) + .14, mz, yaw), '#5d5a5c', PAT.plain, 1, .3, .9, -99); }
  }
  /** Lit window (protruding stone frame, glow pane, iron bars) on a wall plane through m (local +z out of the wall). */
  private window(m: THREE.Matrix4, w: number, hh: number, base: number, arch = false, k = 1.6) {
    const st = '#7d7571';
    this.S(box(w + .6, .22, .38).translate(0, -hh / 2 - .11, .1), m, st, PAT.plain, 1, .9, 0, base);
    for (const s of [-1, 1]) this.S(box(.3, hh, .3).translate(s * (w / 2 + .15), 0, .08), m, st, PAT.ashlar, .7, .9, 0, base, s);
    if (arch) this.archRing(m, w / 2 + .15, hh / 2, .3, .3, 5, st, base);
    else this.S(box(w + .7, .3, .36).translate(0, hh / 2 + .15, .1), m, st, PAT.plain, 1, .9, 0, base);
    const pane = arch ? this.archShape(w, hh) : new THREE.PlaneGeometry(w, hh, 1, 2);
    this.G(pane.translate(0, 0, .06), m, lin('#ff9a3c', k), .12, base, (_x, y) => lin(y < 0 ? '#ffb45a' : '#ff8a32', k * (1.1 - .25 * (y / hh + .5))));
    for (const dx of [-w / 6, w / 6]) this.S(box(.04, hh, .04).translate(dx, 0, .07), m, '#1f1e22', PAT.plain, 1, .5, .8, base);
    this.S(box(w, .04, .04).translate(0, hh * .1, .07), m, '#1f1e22', PAT.plain, 1, .5, .8, base);
    this.stats.windows++;
  }
  /** Rectangle with a semicircular head, w wide, hh tall to the springing (centred on the rectangle). */
  private archShape(w: number, hh: number) {
    const s = new THREE.Shape(); s.moveTo(-w / 2, -hh / 2); s.lineTo(w / 2, -hh / 2); s.lineTo(w / 2, hh / 2); s.absarc(0, hh / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, -hh / 2);
    return new THREE.ShapeGeometry(s, 8);
  }
  /** Voussoirs of a semicircular arch (radius r to the voussoir centre) springing at y, keystone proud and pale. */
  private archRing(m: THREE.Matrix4, r: number, y: number, depth: number, t: number, n: number, hex: string, base: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (i + .5) / n, key = i === (n - 1) / 2;
      this.S(box(t * (key ? 1.35 : 1), (Math.PI * r / n) * .92, depth * (key ? 1.25 : 1)).applyMatrix4(trs(Math.cos(a) * r, y + Math.sin(a) * r, depth * .3, 0, 0, a)), m, key ? '#8e857e' : hex, PAT.plain, 1, .9, 0, base);
    }
  }

  /* -- houses -- */
  private house(h: ForgeHouse) {
    const yaw = forgeYaw(h), cs = Math.cos(yaw), sn = Math.sin(yaw);
    const W = FORGE_W, D = FORGE_D, Ht = h.wall, Hr = h.rise;
    const toW = (lx: number, lz: number): [number, number] => [h.x + lx * cs + lz * sn, h.z - lx * sn + lz * cs];
    let y0 = Infinity; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [x, z] = toW(sx * W / 2, sz * D / 2); y0 = Math.min(y0, this.h(x, z)); }
    const F = trs(h.x, y0, h.z, yaw), L = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => F.clone().multiply(trs(x, y, z, ry, rx, rz));
    const gy = (lx: number, lz: number) => { const [x, z] = toW(lx, lz); return this.h(x, z) - y0; };
    const B = y0, wallHex = ['#5f5a5b', '#57534f', '#625c5a', '#5b5759', '#605a57', '#595557'][h.seed - 1];
    const seed = h.seed * 11;
    // Plinth (rubble, battered, sunk into the slope) and walls (dressed basalt, battered).
    this.S(frustum(W + .6, D + .6, W + .1, D + .1, 2.2), L(0, -1.2, 0), '#433f44', PAT.rubble, 1.2, .95, 0, B, seed);
    const wb = 1.0, hx = (y: number) => (W - .5 * (y - wb) / (Ht - wb)) / 2, hz = (y: number) => (D - .5 * (y - wb) / (Ht - wb)) / 2;
    this.S(frustum(W, D, W - .5, D - .5, Ht - wb), L(0, wb, 0), wallHex, PAT.ashlar, 1, .9, 0, B, seed + 1);
    // Quoins: alternating long and short pale blocks up every corner.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0, y = wb + .25; y < Ht - .2; i++, y += .5) {
      const a = (i + (sx * sz > 0 ? 0 : 1)) % 2 ? .95 : .55, b = (i + (sx * sz > 0 ? 0 : 1)) % 2 ? .55 : .95;
      this.S(box(a, .47, b), L(sx * (hx(y) - a / 2 + .05), y, sz * (hz(y) - b / 2 + .05)), '#7b7470', PAT.plain, 1, .9, 0, B, i);
    }
    this.S(box(W - .2, .26, D - .2), L(0, Ht - .02, 0), '#6d6663', PAT.plain, 1, .9, 0, B);
    // Roof: plates between crow-stepped gables, ridge along z (the gable faces the avenue).
    const eaveW = W / 2 + .45, slope = Math.atan2(Hr, eaveW), pl = Math.hypot(Hr, eaveW) + .05, gz = hz(Ht) - .3;
    const roofHex = h.roof === 'copper' ? '#4f8f7f' : '#3d3a3c', patina = h.roof === 'copper' ? 1 : 0;
    for (const s of [-1, 1]) this.S(box(pl, .16, 2 * gz - .1), L(s * eaveW / 2, Ht + Hr / 2 - .1, 0, 0, 0, -s * slope), roofHex, PAT.plate, patina, h.roof === 'copper' ? .55 : .45, h.roof === 'copper' ? .45 : .7, B, seed);
    this.S(prism(W - .6, Hr - .1, 2 * gz - .2), L(0, Ht, 0), '#2a2629', PAT.plain, 1, .9, 0, B);
    this.S(box(.34, .3, 2 * gz + .3), L(0, Ht + Hr + .02, 0, 0, Math.PI / 4 * 0), '#2c2a2d', PAT.plate, 0, .4, .8, B);
    for (let z = -gz + .6; z < gz; z += 1.2) this.S(box(.12, .16, .12), L(0, Ht + Hr + .22, z), '#c8923c', PAT.plain, 1, .35, .9, B);
    // Gutters along the eaves.
    for (const s of [-1, 1]) this.S(box(.16, .14, 2 * gz + .2), L(s * (eaveW + .02), Ht - .2, 0), '#2a292c', PAT.plain, 1, .4, .8, B);
    const steps = 5;
    for (const sz of [-1, 1]) for (let k = 0; k < steps; k++) {
      const hw = (hx(Ht) + .15) * (1 - k / steps) + .25, y = Ht + k * Hr / steps, th = Hr / steps;
      this.S(box(2 * hw, th, .62), L(0, y + th / 2, sz * gz), wallHex, PAT.ashlar, 1, .9, 0, B, seed + 2);
      for (const s of [-1, 1]) this.S(box(.62, .16, .76), L(s * (hw - .26), y + th + .06, sz * gz), '#8a827b', PAT.plain, 1, .9, 0, B);
      if (k === steps - 1) { this.S(box(2 * hw + .1, .16, .76), L(0, y + th + .06, sz * gz), '#8a827b', PAT.plain, 1, .9, 0, B); this.S(new THREE.ConeGeometry(.09, .9, 6).translate(0, .45, 0), L(0, y + th + .14, sz * gz), '#c8923c', PAT.plain, 1, .3, .9, B); }
    }
    // Gable oculus, lit.
    { const m = L(0, Ht + Hr * .42, gz + .32); this.S(new THREE.TorusGeometry(.5, .13, 5, 12), m, '#80776f', PAT.plain, 1, .9, 0, B); this.G(new THREE.CircleGeometry(.44, 12), m, lin('#ff9a3c', 1.5), .1, seed); this.S(box(.05, .9, .05).translate(0, 0, .04), m, '#1f1e22', PAT.plain, 1, .5, .8, B); this.S(box(.9, .05, .05).translate(0, 0, .04), m, '#1f1e22', PAT.plain, 1, .5, .8, B); }
    // Big chimney stack with soot and a corbelled cap; smoke and sparks rise from it.
    const big = h.role === 'smelter' ? 1.25 : 1, chx = (h.role === 'inn' ? 2.6 : -2.8), chz = -2.2, top = Ht + Hr + 2.6 * big;
    this.S(frustum(1.6 * big, 1.6 * big, 1.4 * big, 1.4 * big, top - Ht + .6 - 1.2), L(chx, Ht - .6, chz), wallHex, PAT.ashlar, .8, .9, 0, B, seed + 3);
    this.S(frustum(1.4 * big, 1.4 * big, 1.36 * big, 1.36 * big, 1.2), L(chx, top - 1.2, chz), '#2b2729', PAT.ashlar, .8, .95, 0, B, seed + 4);
    this.S(box(1.85 * big, .24, 1.85 * big), L(chx, top + .1, chz), '#6f6862', PAT.plain, 1, .9, 0, B);
    for (const s of [-1, 1]) this.S(cyl(.24, .2, .6, 8), L(chx + s * .35 * big, top + .5, chz), '#2c2a2d', PAT.plate, 0, .5, .75, B);
    this.G(new THREE.CircleGeometry(.17, 8).rotateX(-Math.PI / 2), L(chx - .35 * big, top + .79, chz), lin('#ff6a1c', 2), .5, seed);
    { const [wx, wz] = toW(chx, chz); for (const s of [-1, 1]) { const [px, pz] = toW(chx + s * .35 * big, chz); this.puffs.push({x: px, y: B + top + .8, z: pz, s: big * (s > 0 ? .9 : 1.1)}); } this.sparks.push({x: wx, y: B + top + .8, z: wz, s: .6, n: 14}); }
    this.stats.chimneys++;
    // Front: door at the side road's end, forge mouth on one side, a window on the other.
    const fz = (y: number) => hz(y) + .02;
    this.door(L(0, wb + 1.15, fz(wb + 1.15)), B, gy(0, D / 2 + .6));
    // Steps up the plinth to the door, cheeks either side.
    { const g0 = Math.min(gy(0, D / 2 + 1.6), wb - .1), n = Math.max(1, Math.round((wb - g0) / .3)), sh = (wb - g0) / n;
      for (let i = 0; i < n; i++) this.S(box(2.2, sh + .02, .42 * (n - i) + .1), L(0, g0 + sh * (i + .5), D / 2 + .05 + (.42 * (n - i) + .1) / 2), '#6d6762', PAT.ashlar, .7, .9, 0, B, 9 + i);
      for (const s of [-1, 1]) this.S(box(.36, wb - g0 + .25, .42 * n + .25), L(s * 1.28, g0 + (wb - g0 + .25) / 2, D / 2 + .05 + (.42 * n + .25) / 2), '#5a5452', PAT.ashlar, .6, .9, 0, B, 12 + s); }
    if (h.role !== 'inn') this.forgeMouth(h, L(-3.2, wb, fz(wb + 1.5)), toW, B, seed);
    else { this.window(L(-3.3, wb + 1.7, fz(wb + 1.7)), 1.5, 1.5, B, true, 1.9); this.window(L(-3.3, wb + 4.4, fz(wb + 4.4)), 1.0, 1.2, B, false); this.window(L(3.3, wb + 4.4, fz(wb + 4.4)), 1.0, 1.2, B, false); this.light(...this.at(toW, -3.3, D / 2 + 1, B + 2.4), 7, '#ff9a4a', 1.4); }
    this.window(L(3.3, wb + 1.7, fz(wb + 1.7)), 1.0, 1.35, B, h.role === 'inn' || h.role === 'glassblower');
    for (const s of [-1, 1]) {
      for (const lz of [-2.2, 2.2]) this.window(L(s * hx(wb + 1.9), wb + 1.9, lz, s * Math.PI / 2), .9, 1.2, B);
      if (h.role === 'inn') this.window(L(s * hx(wb + 4.5), wb + 4.5, 0, s * Math.PI / 2), .9, 1.1, B);
    }
    this.window(L(1.8, wb + 1.9, -hz(wb + 1.9), Math.PI), .9, 1.2, B);
    this.sign(h, L(1.25, wb + 3.2, fz(wb + 3.2)), B);
    this.role(h, L, gy, toW, B, seed);
    // Back yard: coal bunker and stacked crates against the rear wall.
    { const lz = -D / 2 - 1.2; this.S(frustum(2.6, 1.4, 2.5, 1.3, .8), L(-2.4, gy(-2.4, lz) - .05, lz), '#4a4548', PAT.rubble, .7, .95, 0, B, seed); this.heap(...toW(-2.4, lz), .9, 8, '#232126', seed + 40); this.crate(L(2.6, gy(2.6, lz), lz, .4), B, seed); this.crate(L(2.6, gy(2.6, lz) + .7, lz, .9), B, seed + 1, .8, .6); this.barrel(L(4.2, gy(4.2, lz + .4), lz + .4), B, seed); }
    // Between neighbours: water butt or barrels by the gable corners.
    this.barrel(L(-W / 2 - .7, gy(-W / 2 - .7, 2.8), 2.8), B, seed + 5);
    this.stats.houses++;
  }
  private at(toW: (lx: number, lz: number) => [number, number], lx: number, lz: number, y: number): [number, number, number] { const [x, z] = toW(lx, lz); return [x, y, z]; }
  /** Stone-framed arched door (planks, iron straps, ring), with a step. m: door centre on the wall face. */
  private door(m: THREE.Matrix4, base: number, groundY: number) {
    const w = 1.5, hh = 2.3;
    this.S(box(w, hh, .14), m, '#4a3426', PAT.plank, 1, .85, 0, base, 3);
    this.S(new THREE.CircleGeometry(w / 2, 8, 0, Math.PI).translate(0, hh / 2, .071), m, '#4a3426', PAT.plank, 1, .85, 0, base, 3);
    for (const y of [-.7, .1, .8]) this.S(box(w - .1, .08, .04).translate(0, y, .09), m, '#1d1c20', PAT.plain, 1, .45, .85, base);
    this.S(new THREE.TorusGeometry(.1, .025, 4, 10).translate(.45, 0, .12), m, '#b98a3c', PAT.plain, 1, .3, .9, base);
    for (const s of [-1, 1]) this.S(box(.34, hh + .1, .36).translate(s * (w / 2 + .17), 0, .1), m, '#7a726d', PAT.ashlar, .7, .9, 0, base, s);
    this.archRing(m, w / 2 + .17, hh / 2 + .05, .36, .34, 7, '#7a726d', base);
    void groundY;
  }
  /** Forge mouth: a built-out hearth with a glowing arched mouth, coals, an iron hood and a heat-shield awning. */
  private forgeMouth(h: ForgeHouse, m: THREE.Matrix4, toW: (lx: number, lz: number) => [number, number], base: number, seed: number) {
    const st = '#5a5452';
    this.S(box(3.0, 3.1, 1.0).translate(0, 1.55, .3), m, st, PAT.ashlar, .9, .9, 0, base, seed + 5);
    this.G(this.archShape(1.5, 1.1).translate(0, 1.25, .81), m, [1, 1, 1], .35, seed, (_x, y) => { const t = Math.min(1, Math.max(0, (y - .7) / 1.6)); return lin(t < .4 ? '#ffd36b' : '#ff6a1c', 3.4 - 2 * t); });
    this.archRing(m, .95, 1.8, .3, .3, 7, '#786f6a', base);
    for (const s of [-1, 1]) this.S(box(.32, 1.1, .32).translate(s * .92, 1.25, .86), m, '#786f6a', PAT.ashlar, .6, .9, 0, base, s);
    this.S(box(1.9, .24, .7).translate(0, .62, 1.0), m, '#6c6460', PAT.plain, 1, .9, 0, base);
    for (let i = 0; i < 6; i++) this.G(lump(.14, seed + i).translate(-.5 + i * .2, .82, .95), m, lin('#ff7a2a', 2.4), .5, i);
    // Hood and awning.
    this.S(frustum(2.6, 1.0, 1.6, .6, .8).translate(0, 3.1, .55), m, '#2e2c30', PAT.plate, 0, .5, .75, base);
    this.S(box(3.6, .06, 2.1).applyMatrix4(trs(0, 3.9, 1.6, 0, .32)), m, '#3a3739', PAT.plate, 0, .5, .75, base, seed);
    for (const s of [-1, 1]) this.S(box(.06, .06, 1.9).applyMatrix4(trs(s * 1.6, 3.5, 1.4, 0, -.45)), m, '#1f1e22', PAT.plain, 1, .5, .8, base);
    const p = new V(0, 1.3, 1.6).applyMatrix4(m);
    this.light(p.x, p.y + .2, p.z, 9, '#ff8a3a', 2.6);
    const g = new V(0, 0, 3.1).applyMatrix4(m); this.pool(g.x, g.z, 3.6, '#ff6a24', .5, seed);
    this.sparks.push({x: p.x, y: p.y + 1.2, z: p.z, s: .3, n: 8});
    void h; void toW;
    this.stats.forgeMouths++;
  }
  /** Iron bracket sign over the door with a brass emblem of the trade on a dark board. */
  private sign(h: ForgeHouse, m: THREE.Matrix4, base: number) {
    this.S(box(.07, .07, 1.3).translate(0, .3, .65), m, '#1f1e22', PAT.plain, 1, .5, .8, base);
    this.S(box(.05, .5, .05).applyMatrix4(trs(0, .05, .2, 0, .8)), m, '#1f1e22', PAT.plain, 1, .5, .8, base);
    const b = m.clone().multiply(trs(0, -.25, 1.05));
    for (const s of [-1, 1]) this.S(box(.03, .5, .03).translate(0, .3, s * .38), b, '#1f1e22', PAT.plain, 1, .5, .8, base);
    this.S(box(.95, .7, .07).translate(0, -.2, 0).applyMatrix4(trs(0, 0, 0, Math.PI / 2)), b, '#2e2622', PAT.plank, .6, .85, 0, base, 2);
    const shape = new THREE.Shape(), e = (pts: [number, number][]) => { shape.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) shape.lineTo(p[0], p[1]); };
    switch (h.role) {
      case 'smithy': e([[-.32, .1], [.22, .1], [.32, .05], [.14, .02], [.1, -.08], [.18, -.16], [-.16, -.16], [-.1, -.08], [-.14, .02], [-.32, .05]]); break;
      case 'smelter': e([[-.22, .16], [.22, .16], [.14, -.16], [-.14, -.16]]); break;
      case 'inn': e([[-.16, .18], [.12, .18], [.12, .1], [.26, .1], [.26, -.06], [.12, -.06], [.12, -.18], [-.16, -.18]]); break;
      case 'armourer': e([[-.2, .18], [.2, .18], [.2, -.02], [0, -.2], [-.2, -.02]]); break;
      case 'glassblower': e([[-.06, .2], [.06, .2], [.06, .08], [.16, -.02], [.16, -.18], [-.16, -.18], [-.16, -.02], [-.06, .08]]); break;
      default: e([[-.3, .1], [.3, .1], [.3, .06], [.04, .06], [.04, -.12], [.18, -.16], [-.18, -.16], [-.04, -.12], [-.04, .06], [-.3, .06]]);
    }
    for (const s of [-1, 1]) this.S(new THREE.ExtrudeGeometry(shape, {depth: .02, bevelEnabled: false}).translate(0, -.2, -.01).applyMatrix4(trs(s * .05, 0, 0, s * Math.PI / 2)), b, '#c8923c', PAT.plain, 1, .32, .9, base);
  }

  /** The trade in the yard (house-local pockets either side of the side road: |lx| 2.6..6.5, lz 5.6..10.5). */
  private role(h: ForgeHouse, L: (x: number, y: number, z: number, ry?: number, rx?: number, rz?: number) => THREE.Matrix4, gy: (lx: number, lz: number) => number, toW: (lx: number, lz: number) => [number, number], B: number, seed: number) {
    const D = FORGE_D, front = D / 2;
    const ground = (lx: number, lz: number, ry = 0) => L(lx, gy(lx, lz), lz, ry);
    switch (h.role) {
      case 'smithy': {
        this.anvil(ground(-3.4, front + 2.6, .3), B);
        this.trough(ground(-5.5, front + 2.2, Math.PI / 2), B);
        this.bladeRack(ground(4.6, front + 2.4), B, seed, 9);
        // Grindstone on its frame.
        { const m = ground(5.6, front + 5.2, .5); for (const s of [-1, 1]) this.S(box(.1, .9, .5).translate(s * .25, .45, 0), m, '#4a3426', PAT.plank, .5, .9, 0, B); this.S(cyl(.45, .45, .16, 16).rotateZ(Math.PI / 2).translate(0, .85, 0), m, '#8a8178', PAT.rubble, .4, .95, 0, B, 3); }
        this.barrel(ground(-6.2, front + 4.6), B, seed);
        this.toolRack(L(-5.0, 1.0, front - .02 + .15), B);
        break;
      }
      case 'smelter': {
        const {lx, lz} = SMELTER_TOWER; const m = ground(lx, lz, .4), [tx, tz] = toW(lx, lz), ty = this.h(tx, tz);
        this.S(lathe([[1.6, 0], [1.55, 1.2], [1.25, 4.6], [1.05, 6.6], [1.2, 6.8], [1.2, 7.1], [.9, 7.1], [.9, 6.9]], 14), m, '#5c5552', PAT.ashlar, .7, .92, 0, ty, seed + 9);
        for (const y of [1.6, 3.4, 5.2]) this.S(cyl(1.52 - y * .065, 1.52 - y * .065, .16, 14).translate(0, y, 0), m, '#2b292d', PAT.plate, 0, .45, .8, ty);
        this.G(this.archShape(.6, .45).translate(0, .55, 1.56), m, [1, 1, 1], .45, seed, (_x, y) => lin(y < .5 ? '#ffd36b' : '#ff6a1c', 3.2));
        this.archRing(m.clone().multiply(trs(0, 0, 1.5)), .42, .78, .3, .22, 5, '#786f6a', ty);
        this.G(new THREE.CircleGeometry(.85, 12).rotateX(-Math.PI / 2).translate(0, 7.12, 0), m, lin('#ff7a2a', 2.4), .4, seed);
        // Tap channel to sand moulds with cooling ingots.
        this.S(box(.5, .2, 1.6).translate(0, .1, 2.3), m, '#6c6460', PAT.plain, 1, .9, 0, ty);
        this.G(box(.2, .05, 1.5).translate(0, .22, 2.3), m, lin('#ff7a1c', 2.8), .3, seed);
        this.S(box(1.8, .3, 1.2).translate(0, .15, 3.7), m, '#7c705f', PAT.plain, 1, 1, 0, ty);
        for (let i = 0; i < 6; i++) this.G(frustum(.3, .55, .24, .48, .1).translate((i % 3 - 1) * .5, .3, 3.45 + Math.floor(i / 3) * .55), m, lin(i < 3 ? '#ffb040' : '#ff5a14', i < 3 ? 2.6 : 1.3), .2, i);
        const p = new V(0, .6, 1.9).applyMatrix4(m); this.light(p.x, p.y + .4, p.z, 8, '#ff7a2a', 2.6); this.pool(p.x, p.z + 0, 3.4, '#ff6a24', .55, 2);
        this.puffs.push({x: tx, y: ty + 7.2, z: tz, s: 1.3}); this.sparks.push({x: tx, y: ty + 7.2, z: tz, s: .8, n: 18});
        // Ore heap and a cart on the other side.
        this.heap(...toW(4.8, front + 3.2), 1.5, 22, '#5a4440', seed + 30, .12);
        this.cart(...toW(4.2, front + 6.2), forgeYaw(h) + Math.PI / 2, 'ore', seed);
        break;
      }
      case 'inn': {
        // Terrace: two tables with benches, mugs, a brazier; barrels and a lantern post on the other side.
        for (const [lx, lz] of [[-4.0, front + 2.6], [-4.4, front + 6.4]] as [number, number][]) {
          const m = ground(lx, lz, .15), b = B;
          this.S(box(1.6, .1, .8).translate(0, .78, 0), m, '#5b3f2c', PAT.plank, .7, .85, 0, b, 1);
          for (const s of [-1, 1]) this.S(box(.12, .74, .6).translate(s * .65, .37, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, b);
          for (const s of [-1, 1]) { this.S(box(1.5, .08, .32).translate(0, .45, s * .75), m, '#5b3f2c', PAT.plank, .7, .85, 0, b, 2); for (const t of [-1, 1]) this.S(box(.08, .42, .28).translate(t * .6, .21, s * .75), m, '#3f2c20', PAT.plank, .5, .9, 0, b); }
          for (let i = 0; i < 3; i++) this.S(cyl(.07, .065, .16, 8).translate(-.5 + i * .45, .91, (i % 2 - .5) * .3), m, i % 2 ? '#8a6a3a' : '#5d4a3a', PAT.plain, 1, .6, .2, b);
        }
        this.brazier(...toW(-6.0, front + 4.4), .9, seed);
        for (let i = 0; i < 5; i++) this.barrel(ground(3.6 + (i % 3) * .9, front + 2.0 + Math.floor(i / 3) * .9, i), B, seed + i);
        this.barrel(ground(4.05, front + 2.45).multiply(trs(0, .92, 0)), B, seed + 9);
        this.hangLantern(ground(5.6, front + 5.6), B, seed);
        break;
      }
      case 'armourer': {
        for (let i = 0; i < 3; i++) this.armourStand(ground(-3.2 - i * 1.25, front + 2.4 + (i % 2) * .5, .3 - i * .25), B, i);
        // Shield rack: round shields with bosses and brass rims leaning on a rail.
        { const m = ground(4.6, front + 2.4); for (const s of [-1, 1]) this.S(box(.1, 1.1, .1).translate(s * 1.3, .55, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, B); this.S(box(2.8, .1, .1).translate(0, 1.05, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, B);
          for (let i = 0; i < 4; i++) { const sm = m.clone().multiply(trs(-1.05 + i * .7, .58, .14, 0, -.2)); this.S(cyl(.46, .46, .07, 16).rotateX(Math.PI / 2), sm, i % 2 ? '#7a2a1e' : '#3b3a40', PAT.plate, 0, .55, .4, B, i); this.S(new THREE.TorusGeometry(.46, .035, 4, 18), sm, '#c8923c', PAT.plain, 1, .3, .9, B); this.S(new THREE.SphereGeometry(.11, 8, 5, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, .035), sm, '#a8a4a2', PAT.plain, 1, .25, .95, B); } }
        this.bladeRack(ground(5.2, front + 5.6, -.4), B, seed, 6);
        this.anvil(ground(-5.6, front + 5.6, .8), B);
        break;
      }
      case 'glassblower': {
        const {lx, lz} = GLASS_KILN, m = ground(lx, lz, -.2), [kx, kz] = toW(lx, lz), ky = this.h(kx, kz);
        this.S(lathe([[1.4, 0], [1.42, .6], [1.3, 1.4], [1.0, 2.0], [.5, 2.35], [.42, 2.4], [.42, 2.9], [.32, 2.9], [.32, 2.4], [0, 2.4]], 16), m, '#5e5653', PAT.ashlar, .55, .92, 0, ky, seed + 7);
        this.S(cyl(1.46, 1.46, .14, 16).translate(0, .55, 0), m, '#2b292d', PAT.plate, 0, .45, .8, ky);
        for (let i = 0; i < 3; i++) { const a = (i - 1) * .9, pm = m.clone().multiply(trs(Math.sin(a) * 1.25, 1.05, Math.cos(a) * 1.25, a)); this.S(new THREE.TorusGeometry(.3, .08, 5, 12), pm, '#786f6a', PAT.plain, 1, .9, 0, ky); this.G(new THREE.CircleGeometry(.26, 12).translate(0, 0, .02), pm, lin('#ffd070', 3.6), .3, i + seed); }
        const p = new V(0, 1.1, 1.9).applyMatrix4(m); this.light(p.x, p.y, p.z, 8, '#ffa040', 2.4); this.pool(p.x, p.z, 3.2, '#ff8a2a', .5, 3);
        this.puffs.push({x: kx, y: ky + 2.95, z: kz, s: .55}); this.sparks.push({x: kx, y: ky + 2.95, z: kz, s: .3, n: 6});
        // Marver bench with a glowing gather on a pipe.
        { const bm = ground(-2.9, front + 4.8, .4); this.S(box(1.4, .1, .5).translate(0, .8, 0), bm, '#5b3f2c', PAT.plank, .7, .85, 0, B); for (const s of [-1, 1]) this.S(box(.1, .8, .45).translate(s * .6, .4, 0), bm, '#3f2c20', PAT.plank, .5, .9, 0, B); this.S(cyl(.025, .025, 1.6, 6).rotateZ(Math.PI / 2 - .15).translate(-.1, .95, 0), bm, '#3a383c', PAT.plain, 1, .4, .85, B); this.G(new THREE.SphereGeometry(.14, 10, 7).translate(-.85, .87, 0), bm, lin('#ffb040', 3), .2, 1); }
        this.glassShelf(ground(4.6, front + 2.0), B, seed);
        this.crate(ground(5.8, front + 5.0, .3), B, seed); this.crate(ground(4.6, front + 5.4, -.2), B, seed + 1, .8, .6);
        break;
      }
      case 'merchant': {
        this.rails(...toW(-4.4, front + 1.2), ...toW(-4.4, front + 9.2));
        this.cart(...toW(-4.4, front + 3.6), forgeYaw(h), 'ingot', seed);
        this.cart(...toW(-4.4, front + 7.0), forgeYaw(h), 'ore', seed + 3);
        // Counter with a balance scale, ingot stacks on a pallet, sacks.
        { const m = ground(4.4, front + 2.3); this.S(box(2.6, .9, .8).translate(0, .45, 0), m, '#5d5552', PAT.ashlar, .55, .9, 0, B, 4); this.S(box(2.8, .1, .95).translate(0, .95, 0), m, '#4a3426', PAT.plank, .6, .85, 0, B);
          this.S(cyl(.03, .03, .7, 6).translate(0, 1.35, 0), m, '#c8923c', PAT.plain, 1, .3, .9, B); this.S(box(.9, .03, .03).translate(0, 1.7, 0), m, '#c8923c', PAT.plain, 1, .3, .9, B);
          for (const s of [-1, 1]) this.S(cyl(.16, .12, .05, 10).translate(s * .42, 1.45, 0), m, '#c8923c', PAT.plain, 1, .3, .9, B);
          for (let i = 0; i < 4; i++) this.S(frustum(.22, .5, .18, .44, .1).translate(-.9 + i * .26, 1.0, .1), m, '#b98a46', PAT.plain, 1, .3, .9, B); }
        { const m = ground(4.8, front + 5.4, .2); this.S(box(1.6, .14, 1.2).translate(0, .07, 0), m, '#4a3426', PAT.plank, .6, .9, 0, B); for (let i = 0; i < 12; i++) { const l = Math.floor(i / 4); this.S(frustum(.32, .66, .26, .58, .13).applyMatrix4(trs((i % 2 - .5) * .7 + (l % 2) * .0, .2 + l * .14, ((i >> 1) % 2 - .5) * .5, l % 2 ? Math.PI / 2 : 0)), m, l === 2 ? '#c69c56' : '#6f6a6c', PAT.plain, 1, .32, .9, B); } }
        for (let i = 0; i < 3; i++) this.S(lathe([[0, 0], [.32, .02], [.38, .25], [.3, .55], [.12, .66], [0, .68]], 9), ground(6.0, front + 3.6 + i * .7, i), '#8a7556', PAT.plain, 1, 1, 0, B, i);
        break;
      }
    }
  }
  private bladeRack(m: THREE.Matrix4, base: number, seed: number, n: number) {
    for (const s of [-1, 1]) { this.S(box(.1, 1.7, .1).translate(s * 1.25, .85, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, base); this.S(box(.08, .08, .7).translate(s * 1.25, .05, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, base); }
    this.S(box(2.6, .1, .1).translate(0, 1.65, 0), m, '#2a292c', PAT.plain, 1, .45, .8, base);
    for (let i = 0; i < n; i++) {
      const x = -1.05 + i * 2.1 / (n - 1), hot = i % 3 === 1, len = .95 + .2 * hash(seed + i), bm = m.clone().multiply(trs(x, 1.58, 0, 0, 0, (hash(i + seed) - .5) * .06));
      this.S(box(.05, .2, .05).translate(0, -.08, 0), bm, '#2a2224', PAT.plain, 1, .6, .3, base);
      this.S(box(.22, .04, .05).translate(0, -.2, 0), bm, '#b98a3c', PAT.plain, 1, .3, .9, base);
      const blade = frustum(.09, .012, .02, .006, len).rotateX(Math.PI).translate(0, -.22, 0);
      if (hot) this.G(blade, bm, [1, 1, 1], .15, i, (_x, y) => lin(y < -.22 - len * .5 ? '#ff6a1c' : '#ffb24a', y < -.22 - len * .5 ? 1.6 : 2.6)); else this.S(blade, bm, '#9a9798', PAT.plain, 1, .2, .95, base);
      this.stats.blades++;
    }
  }
  private toolRack(m: THREE.Matrix4, base: number) {
    this.S(box(1.4, .08, .08).translate(0, 1.5, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, base);
    for (let i = 0; i < 5; i++) { const x = -.55 + i * .28; this.S(box(.04, .9, .04).translate(x, 1.05, .06).applyMatrix4(trs(0, 0, 0, 0, 0, (i - 2) * .04)), m, '#2a292c', PAT.plain, 1, .45, .8, base); this.S(box(i % 2 ? .16 : .1, .12, .08).translate(x, .58, .06), m, '#3a383c', PAT.plain, 1, .4, .85, base); }
  }
  private armourStand(m: THREE.Matrix4, base: number, i: number) {
    this.S(cyl(.28, .3, .1, 8).translate(0, .05, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, base);
    this.S(box(.07, 1.3, .07).translate(0, .7, 0), m, '#3f2c20', PAT.plank, .5, .9, 0, base);
    const steel = i === 1 ? '#8c6a3c' : '#8f8d90';
    this.S(lathe([[.0, 0], [.26, .02], [.3, .2], [.32, .45], [.22, .62], [.1, .66], [0, .66]], 12).scale(1, 1, .65).translate(0, .95, 0), m, steel, PAT.plain, 1, .22, .95, base);
    this.S(box(.86, .08, .2).translate(0, 1.56, 0), m, steel, PAT.plain, 1, .25, .9, base);
    this.S(lathe([[0, 0], [.19, 0], [.2, .14], [.16, .28], [.06, .34], [0, .35]], 12).translate(0, 1.66, 0), m, steel, PAT.plain, 1, .22, .95, base);
    this.S(box(.05, .24, .05).translate(0, 2.04, 0), m, '#c8923c', PAT.plain, 1, .3, .9, base);
  }
  private glassShelf(m: THREE.Matrix4, base: number, seed: number) {
    for (const s of [-1, 1]) this.S(box(.08, 1.6, .5).translate(s * 1.1, .8, 0), m, '#2a292c', PAT.plain, 1, .45, .8, base);
    for (const y of [.35, .85, 1.35]) this.S(box(2.3, .06, .5).translate(0, y, 0), m, '#4a3426', PAT.plank, .6, .85, 0, base);
    const tints = ['#ff9a30', '#38c9b0', '#d8342a', '#ffd070', '#4a9ae0'];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
      const hh = .2 + .14 * hash(seed + r * 7 + i), rr = .06 + .04 * hash(i + r), c = tints[(i + r * 2) % 5];
      this.G(lathe([[0, 0], [rr, 0], [rr, hh * .6], [rr * .4, hh * .8], [rr * .35, hh], [0, hh]], 8).translate(-.9 + i * .36, .38 + r * .5, (hash(i * 3 + r) - .5) * .2), m, lin(c, .55 + .35 * hash(i + r * 3)), 0, 0);
    }
  }
  private hangLantern(m: THREE.Matrix4, base: number, seed: number) {
    this.S(box(.14, 2.6, .14).translate(0, 1.3, 0), m, '#4a3426', PAT.plank, .4, .9, 0, base);
    this.S(box(.08, .08, .8).translate(0, 2.5, .36), m, '#1f1e22', PAT.plain, 1, .5, .8, base);
    this.cageLantern(m.clone().multiply(trs(0, 2.0, .7)), base, seed, .8);
    const p = new V(0, 1.9, .7).applyMatrix4(m); this.pool(p.x, p.z, 2.6, '#ff9040', .45, seed);
  }
  /** Iron cage (bars, cap, tray) round an ember core. */
  private cageLantern(m: THREE.Matrix4, base: number, seed: number, s = 1) {
    const hh = .52 * s, w = .34 * s;
    this.G(box(w * .62, hh * .7, w * .62), m, [1, 1, 1], .25, seed, (_x, y) => lin(y > 0 ? '#ffb45a' : '#ff8a32', 2.6));
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.S(box(.035 * s, hh, .035 * s).translate(sx * w / 2, 0, sz * w / 2), m, '#1e1d21', PAT.plain, 1, .45, .85, base);
    for (const sx of [-1, 1]) this.S(box(.025 * s, hh, .025 * s).translate(sx * w / 2, 0, 0).applyMatrix4(trs(0, 0, 0, Math.PI / 4)), m, '#1e1d21', PAT.plain, 1, .45, .85, base);
    this.S(box(w + .08 * s, .06 * s, w + .08 * s).translate(0, -hh / 2, 0), m, '#232226', PAT.plain, 1, .45, .85, base);
    this.S(new THREE.ConeGeometry(w * .78, .26 * s, 4).rotateY(Math.PI / 4).translate(0, hh / 2 + .13 * s, 0), m, '#29282c', PAT.plate, 0, .45, .8, base);
    this.S(new THREE.TorusGeometry(.06 * s, .015 * s, 4, 8).translate(0, hh / 2 + .3 * s, 0), m, '#29282c', PAT.plain, 1, .45, .85, base);
  }

  /* -- street -- */
  private lantern(x: number, z: number, i: number) {
    if (!this.clearOfLava(x, z, .6)) return;
    const y = this.h(x, z), m = trs(x, y, z, Math.PI / 4 * (i % 2));
    this.S(box(.66, .34, .66).translate(0, .1, 0), m, '#4a464a', PAT.rubble, .5, .95, 0, y, i);
    this.S(frustum(.42, .42, .34, .34, 2.1).translate(0, .27, 0), m, '#55504f', PAT.ashlar, .55, .92, 0, y, i + 3);
    this.S(box(.54, .14, .54).translate(0, 2.4, 0), m, '#77706b', PAT.plain, 1, .9, 0, y);
    this.cageLantern(m.clone().multiply(trs(0, 2.76, 0)), y, i);
    this.pool(x, z, 3.0, '#ff9240', .42, i * 1.7);
    this.stats.lanterns++;
  }
  private bannerPost(x: number, z: number, i: number) {
    if (!this.clearOfLava(x, z, 1)) return;
    const side = Math.sign(x), y = this.h(x, z), m = trs(x, y, z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    this.S(box(.8, .5, .8).translate(0, .2, 0), m, '#4a464a', PAT.rubble, .5, .95, 0, y, i);
    this.S(frustum(.5, .5, .4, .4, 5.6).translate(0, .45, 0), m, '#55504f', PAT.ashlar, .55, .92, 0, y, i + 5);
    this.S(box(.6, .2, .6).translate(0, 6.1, 0), m, '#77706b', PAT.plain, 1, .9, 0, y);
    this.S(new THREE.ConeGeometry(.1, .7, 6).translate(0, 6.55, 0), m, '#c8923c', PAT.plain, 1, .3, .9, y);
    // Iron bar out towards the avenue, banner on rings with a weighted hem rod.
    this.S(box(.08, .08, 2.0).translate(0, 5.5, .95), m, '#1f1e22', PAT.plain, 1, .45, .85, y);
    this.S(box(.05, .05, 1.3).applyMatrix4(trs(0, 5.0, .55, 0, .75)), m, '#1f1e22', PAT.plain, 1, .45, .85, y);
    const bw = 1.5, bh = 3.4, g = new THREE.PlaneGeometry(bw, bh, 6, 12), P = g.getAttribute('position'), U = g.getAttribute('uv');
    for (let k = 0; k < P.count; k++) {
      const px = P.getX(k), py = P.getY(k), t = (bh / 2 - py) / bh;
      P.setZ(k, Math.sin(px / bw * TAU * 1.5 + i) * .05 * (.4 + t));
      U.setX(k, U.getX(k) * .5 + (i % 4 === 1 || i % 4 === 2 ? .5 : 0));
    }
    g.computeVertexNormals();
    const bm = m.clone().multiply(trs(0, 5.42 - bh / 2, 1.15, Math.PI / 2));
    // Sway grows down the banner from the bar.
    this.cloth.col = [1, 1, 1];
    this.cloth.add(g, bm, undefined, (_x, py) => { const t = (bh / 2 - py) / bh; return [t * t, i * 1.3 + side]; });
    this.S(cyl(.035, .035, bw + .2, 6).rotateZ(Math.PI / 2).applyMatrix4(trs(0, 0, 0, Math.PI / 2)).translate(0, 5.42, 1.15), m, '#1f1e22', PAT.plain, 1, .45, .85, y);
    this.stats.banners++;
  }
  private stall(x: number, z: number, side: -1 | 1, i: number) {
    const y = this.h(x, z), m = trs(x, y, z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    // Stone counter, iron frame, heat-shield awning.
    this.S(box(4.8, .95, 1.2).translate(0, .47, 0), m, '#5a5452', PAT.ashlar, .55, .9, 0, y, i);
    this.S(box(5.0, .12, 1.4).translate(0, 1.0, 0), m, '#6f6862', PAT.plain, 1, .9, 0, y);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.S(box(.12, 3.2, .12).translate(sx * 2.4, 1.6, sz * .9 - .3), m, '#232226', PAT.plain, 1, .45, .85, y);
    this.S(box(5.4, .07, 2.6).applyMatrix4(trs(0, 3.25, .2, 0, .18)), m, '#3c393b', PAT.plate, 0, .5, .75, y, i);
    this.S(box(5.4, .3, .06).translate(0, 3.05, 1.45), m, '#2b292d', PAT.plate, 0, .5, .75, y);
    if (i === 0) {
      // Blade stall: a rack of cooling blades behind, finished blades on the counter.
      this.bladeRack(m.clone().multiply(trs(0, 0, -1.0)), y, 40 + i, 8);
      for (let k = 0; k < 4; k++) this.S(frustum(.1, .02, .03, .01, 1.0).rotateZ(Math.PI / 2).translate(-1.6 + k * .9, 1.1, .1), m, '#a09c9c', PAT.plain, 1, .2, .95, y);
    } else {
      // Ingot stall: hot ingots in a tray, a brazier, stacked bars, scales.
      this.S(box(1.6, .1, .8).translate(-1.2, 1.12, 0), m, '#2b292d', PAT.plain, 1, .45, .8, y);
      for (let k = 0; k < 6; k++) this.G(frustum(.3, .55, .24, .48, .1).translate(-1.6 + (k % 3) * .38, 1.17, (Math.floor(k / 3) - .5) * .4), m, lin('#ff7a1c', 1.5 + k * .2), .2, k);
      for (let k = 0; k < 8; k++) this.S(frustum(.32, .66, .26, .58, .13).translate(1.0 + (k % 2) * .4, 1.08 + Math.floor(k / 4) * .14, ((k >> 1) % 2 - .5) * .5), m, '#77727a', PAT.plain, 1, .3, .9, y);
    }
    this.brazier(...this.atM(m, side > 0 ? 3.2 : -3.2, 1.6), .85, i * 2.1);
    this.crate(m.clone().multiply(trs(-3.0, 0, -.8, .2)), y, i); this.crate(m.clone().multiply(trs(-3.1, .7, -.8, .5)), y, i + 1, .8, .6); this.barrel(m.clone().multiply(trs(3.1, 0, -.9)), y, i);
  }
  private atM(m: THREE.Matrix4, lx: number, lz: number): [number, number] { const p = new V(lx, 0, lz).applyMatrix4(m); return [p.x, p.z]; }

  /** West of the smelter: hearth with hood and flue, bellows, anvil, quench trough, coal and tools. */
  private outdoorForge() {
    const {x, z} = FORGE_YARD, y = this.h(x, z), m = trs(x, y, z, Math.PI / 2);
    this.S(box(3.6, .95, 2.6).translate(0, .47, 0), m, '#55504f', PAT.ashlar, .7, .9, 0, y, 3);
    this.S(box(3.8, .14, 2.8).translate(0, 1.0, 0), m, '#6f6862', PAT.plain, 1, .9, 0, y);
    this.G(box(1.6, .1, 1.1).translate(0, 1.1, 0), m, [1, 1, 1], .4, 4, () => lin('#ff7a24', 2.6));
    for (let i = 0; i < 10; i++) this.G(lump(.16, i).translate(-.6 + (i % 5) * .3, 1.18, (Math.floor(i / 5) - .5) * .45), m, lin(i % 3 ? '#ff6a1c' : '#ffc050', 2.2 + (i % 3) * .5), .5, i);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.S(box(.14, 2.6, .14).translate(sx * 1.5, 2.3, sz * 1.0), m, '#232226', PAT.plain, 1, .45, .85, y);
    this.S(frustum(3.4, 2.4, .9, .9, 1.4).translate(0, 3.3, 0), m, '#302e32', PAT.plate, 0, .5, .75, y, 3);
    this.S(frustum(.9, .9, .75, .75, 3.8).translate(0, 4.7, 0), m, '#2c2a2e', PAT.plate, 0, .5, .75, y, 4);
    this.S(box(1.1, .12, 1.1).translate(0, 8.5, 0), m, '#2c2a2e', PAT.plain, 1, .5, .75, y);
    this.puffs.push({x, y: y + 8.6, z, s: .9}); this.sparks.push({x, y: y + 8.6, z, s: .5, n: 12});
    this.light(x, y + 1.6, z, 10, '#ff8a3a', 3); this.pool(x, z, 5, '#ff7024', .6, 1);
    this.flames.push({x, y: y + 1.15, z, s: 1.4}); this.sparks.push({x, y: y + 1.3, z, s: .7, n: 14});
    // Bellows: two boards with a leather body, a nozzle into the hearth.
    { const b = m.clone().multiply(trs(2.6, .9, 0, 0, 0, -.2)); for (const s of [-1, 1]) this.S(box(1.5, .06, .9).translate(0, s * .16, 0), b, '#4a3426', PAT.plank, .6, .85, 0, y); this.S(frustum(1.4, .82, 1.1, .7, .26).translate(0, -.13, 0), b, '#4a2e22', PAT.plain, 1, .8, 0, y); this.S(cyl(.07, .05, .8, 6).rotateZ(Math.PI / 2).translate(-1.1, 0, 0), b, '#2a292c', PAT.plain, 1, .4, .85, y); this.S(box(.08, .8, .08).translate(.7, -.5, 0), b, '#3f2c20', PAT.plank, .5, .9, 0, y); }
    this.anvil(m.clone().multiply(trs(0, 0, 2.6, .4)), y);
    this.trough(m.clone().multiply(trs(-2.8, 0, 1.9, 0)), y);
    this.heap(...this.atM(m, -2.6, -1.8), 1.1, 14, '#211f24', 77);
    this.toolRack(m.clone().multiply(trs(1.3, 0, -1.45)), y);
    this.bladeRack(m.clone().multiply(trs(3.6, 0, 2.6, -.6)), y, 90, 6);
    this.barrel(m.clone().multiply(trs(-3.4, 0, -.2)), y, 4);
  }

  /* -- arrival quay -- */
  private harbour() {
    const Q = FORGE_QUAY, J = FORGE_JETTY, deck = (x: number, z: number) => this.h(x, Math.min(z, Q.brow - 1)) + .06;
    // Apron: a conformed slab of flagstones from z0 to z1, its skirt dropping into the sea.
    const nx = 22, nz = 21, top: number[] = [];
    const g = new THREE.PlaneGeometry(Q.x1 - Q.x0, Q.z1 - Q.z0, nx, nz); g.rotateX(-Math.PI / 2);
    const P = g.getAttribute('position');
    for (let i = 0; i < P.count; i++) { const x = (Q.x0 + Q.x1) / 2 + P.getX(i), z = (Q.z0 + Q.z1) / 2 + P.getZ(i); P.setY(i, deck(x, z)); top.push(x, z); }
    g.computeVertexNormals(); g.translate((Q.x0 + Q.x1) / 2, 0, (Q.z0 + Q.z1) / 2);
    this.S(g, new THREE.Matrix4(), '#4f4b4e', PAT.ashlar, 1.6, .95, 0, -99, 21);
    // Kerbs on the land side, the quay wall and its buttresses into the lava.
    const wallTop = deck(0, Q.z1), jd = wallTop - .12;
    this.S(box(Q.x1 - Q.x0 + .6, wallTop + 3, 1.2), trs((Q.x0 + Q.x1) / 2, (wallTop - 3) / 2, Q.z1 + .3), '#3f3b40', PAT.rubble, 1.4, .95, 0, -99, 22);
    for (const x of [Q.x0, Q.x1]) this.S(box(1.2, wallTop + 3, Q.z1 - Q.brow + 2), trs(x, (wallTop - 3) / 2, (Q.z1 + Q.brow) / 2), '#3f3b40', PAT.rubble, 1.4, .95, 0, -99, 23);
    for (let x = Q.x0 + 3; x < Q.x1 - 1; x += 7) this.S(frustum(2.2, 2.0, 1.4, 1.2, wallTop + 3), trs(x, -3, Q.z1 + 1.2), '#38353a', PAT.rubble, 1.2, .95, 0, -99, x);
    this.S(box(Q.x1 - Q.x0 + .6, .3, 1.0), trs((Q.x0 + Q.x1) / 2, wallTop + .15, Q.z1 + .3), '#77706b', PAT.ashlar, 1.2, .9, 0, -99, 24);
    for (const x of [Q.x0, Q.x1]) this.S(box(1.0, .3, Q.z1 - Q.z0), trs(x, deck(x, (Q.z0 + Q.z1) / 2) + .15, (Q.z0 + Q.z1) / 2), '#77706b', PAT.ashlar, 1.2, .9, 0, -99, 25);
    // Bollards and mooring chains along the edge.
    for (let x = Q.x0 + 2; x < Q.x1; x += 5) { if (Math.abs(x - J.x) < 3) continue; const m = trs(x, wallTop + .3, Q.z1 + .1); this.S(lathe([[.28, 0], [.24, .3], [.18, .5], [.26, .62], [.26, .7], [0, .72]], 10), m, '#2a292c', PAT.plain, 1, .45, .85, wallTop); }
    // Jetty: basalt piers, iron-plated deck, rails and lamps; it runs out over the lava past the crab's reach.
    for (let z = J.z0 + 3; z <= J.z1; z += 6) for (const s of [-1, 1]) this.S(frustum(1.3, 1.3, .9, .9, jd + 2), trs(J.x + s * (J.half - .3), -2, z), '#38353a', PAT.rubble, 1, .95, 0, -99, z + s);
    this.S(box(J.half * 2, .35, J.z1 - J.z0 + 1), trs(J.x, jd - .17, (J.z0 + J.z1) / 2 + .5), '#3a3739', PAT.plate, 0, .5, .7, -99, 31);
    for (let z = J.z0 + .6; z < J.z1; z += 1.1) this.S(box(J.half * 2 - .3, .06, .9), trs(J.x, jd + .03, z), '#4a3a30', PAT.plank, .7, .9, 0, -99, z);
    for (const s of [-1, 1]) { this.S(box(.08, .08, J.z1 - J.z0), trs(J.x + s * (J.half - .1), jd + 1.0, (J.z0 + J.z1) / 2), '#1f1e22', PAT.plain, 1, .45, .85, -99); for (let z = J.z0 + 1; z <= J.z1; z += 3) this.S(box(.1, 1.0, .1), trs(J.x + s * (J.half - .1), jd + .5, z), '#1f1e22', PAT.plain, 1, .45, .85, -99); }
    for (const z of [J.z0 + 1.5, J.z1 - 1]) for (const s of [-1, 1]) { const m = trs(J.x + s * (J.half + .25), jd, z); this.S(frustum(.36, .36, .3, .3, 1.8), m, '#55504f', PAT.ashlar, .5, .92, 0, -99, z); this.cageLantern(m.clone().multiply(trs(0, 2.15, 0)), -99, z + s); this.light(J.x + s * (J.half + .25), jd + 2.2, z, 6, '#ff9a4a', 1.2); }
    // Barge: a riveted iron hull on the lava, its deckhouse stack smoking, ore and ingots aboard, a chain ferry ahead.
    this.barge();
    // Crane on the quay swinging a crate of ingots over the barge.
    this.crane();
    // Cargo on the quay: ore heaps, ingot pallets, crates, barrels; rails with two carts up towards town.
    this.heap(-19, 120, 2.2, 30, '#4f3d3a', 501, .06);
    this.heap(-14.5, 124.5, 1.4, 14, '#232126', 502);
    for (let i = 0; i < 4; i++) this.crate(trs(-22 + (i % 2) * 1.0, deck(-22, 108) + Math.floor(i / 2) * .7, 108 + (i % 2) * .2, i * .2), deck(-22, 108), 600 + i);
    for (let i = 0; i < 3; i++) this.barrel(trs(-19.5 + i * .9, deck(-19.5, 106), 106.5), deck(-19.5, 106), 610 + i);
    { const px = -8, pz = 120, y = deck(px, pz), m = trs(px, y, pz, .3); this.S(box(1.8, .14, 1.4).translate(0, .07, 0), m, '#4a3426', PAT.plank, .6, .9, 0, y); for (let i = 0; i < 16; i++) { const l = Math.floor(i / 4); this.S(frustum(.32, .66, .26, .58, .13).applyMatrix4(trs((i % 2 - .5) * .7, .2 + l * .14, ((i >> 1) % 2 - .5) * .5, l % 2 ? Math.PI / 2 : 0)), m, l === 3 ? '#c69c56' : '#6f6a6c', PAT.plain, 1, .32, .9, y); } }
    this.rails(FORGE_RAIL.x, FORGE_RAIL.z0, FORGE_RAIL.x, FORGE_RAIL.z1);
    this.cart(FORGE_RAIL.x, 110, 0, 'ore', 700); this.cart(FORGE_RAIL.x, 117, 0, 'ingot', 701);
    this.brazier(J.x - 4.5, Q.z1 - 3.5, 1.1, 5); this.brazier(J.x + 4.5, Q.z1 - 3.5, 1.1, 6);
    // Harbour master's tally board and a heat-shield shelter by the rails.
    { const m = trs(13, deck(13, 106), 106, -.4); for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.S(box(.12, 2.8, .12).translate(sx * 1.4, 1.4, sz * 1.0), m, '#232226', PAT.plain, 1, .45, .85, deck(13, 106)); this.S(box(3.4, .07, 2.6).applyMatrix4(trs(0, 2.9, 0, 0, .12)), m, '#3c393b', PAT.plate, 0, .5, .75, deck(13, 106), 9); this.crate(m.clone().multiply(trs(-.6, 0, .2)), deck(13, 106), 620); this.crate(m.clone().multiply(trs(.6, 0, -.1, .4)), deck(13, 106), 621); this.barrel(m.clone().multiply(trs(.5, 0, .7)), deck(13, 106), 622); }
  }
  private barge() {
    const b = FORGE_BARGE, sea = .15, m = trs(b.x, sea, b.z, 0, 0, .015);
    // Hull: battered box with a raked bow and stern, riveted plates, a brass rubbing strake.
    const L = b.len, Bm = b.beam;
    const hull = quads((() => {
      const y0 = -1.0, y1 = 1.1, hw0 = Bm / 2 - .5, hw1 = Bm / 2, l0 = L / 2 - 1.2, l1 = L / 2;
      const P = (x: number, y: number, z: number) => new V(x, y, z);
      const bot = [P(-hw0, y0, l0), P(hw0, y0, l0), P(hw0, y0, -l0), P(-hw0, y0, -l0)], tp = [P(-hw1, y1, l1), P(hw1, y1, l1), P(hw1, y1, -l1), P(-hw1, y1, -l1)];
      const q: THREE.Vector3[][] = [];
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; q.push([bot[i], bot[j], tp[j], tp[i]]); }
      q.push([tp[0], tp[1], tp[2], tp[3]]);
      return q;
    })());
    this.S(hull, m, '#36333a', PAT.plate, 0, .5, .75, sea, 40);
    this.S(box(Bm + .1, .16, L + .1), m.clone().multiply(trs(0, 1.1, 0)), '#b07a38', PAT.plain, 1, .35, .9, sea);
    this.S(box(Bm - .2, .14, L - .3), m.clone().multiply(trs(0, 1.22, 0)), '#4a3a30', PAT.plank, .8, .9, 0, sea, 41);
    // Deckhouse with its stack, lit port, cargo of ore and ingots, a bow chain wheel.
    const dm = m.clone().multiply(trs(0, 1.29, -L / 2 + 2.4));
    this.S(box(3.0, 1.9, 2.6).translate(0, .95, 0), dm, '#4a454a', PAT.ashlar, .6, .9, 0, sea, 42);
    this.S(box(3.4, .12, 3.0).translate(0, 1.96, 0), dm, '#2f2c30', PAT.plate, 0, .5, .75, sea);
    this.S(cyl(.32, .28, 2.6, 10).translate(.7, 3.2, -.4), dm, '#2c2a2e', PAT.plate, 0, .5, .75, sea);
    for (const s of [-1, 1]) this.G(new THREE.PlaneGeometry(.6, .5).rotateY(s * Math.PI / 2).translate(s * 1.51, 1.1, 0), dm, lin('#ff9a3c', 1.7), .15, s);
    this.G(new THREE.PlaneGeometry(.7, .5).translate(-.5, 1.1, 1.31), dm, lin('#ff9a3c', 1.7), .15, 2);
    const stack = new V(.7, 4.5, -.4).applyMatrix4(dm); this.puffs.push({x: stack.x, y: stack.y, z: stack.z, s: .7}); this.sparks.push({x: stack.x, y: stack.y, z: stack.z, s: .3, n: 6});
    const lp = new V(0, 1.4, 2).applyMatrix4(dm); this.light(lp.x, lp.y, lp.z, 6, '#ff9a4a', 1.2);
    for (let i = 0; i < 2; i++) { const c = new V((i - .5) * 2.2, 1.29, .4 + i * 2.6).applyMatrix4(m); this.heap(c.x, c.z, 1.1, 16, '#4b3a3a', 800 + i * 9, .1, c.y); }
    for (let i = 0; i < 9; i++) { const im = m.clone().multiply(trs(-1.2 + (i % 3) * .6, 1.36 + Math.floor(i / 3) * .13, 5.6, (i % 2) * Math.PI / 2)); this.G(frustum(.3, .6, .24, .52, .11), im, lin('#ff8a2a', i > 5 ? 1.8 : .7), .2, i); }
    this.S(cyl(.5, .5, .3, 14).rotateZ(Math.PI / 2), m.clone().multiply(trs(0, 1.6, L / 2 - .7)), '#2a292c', PAT.plain, 1, .45, .85, sea);
    // Chain ferry: two heavy chains from the bow and the stern over the lava to the haze, sagging into the crust.
    for (const [z0, dir, len] of [[L / 2 - .5, 1, 26], [-L / 2 + .5, -1, 4.6]] as [number, number, number][]) {
      const s0 = new V(0, 1.6, z0).applyMatrix4(m), n = Math.round(len / .42);
      for (let i = 0; i < n; i++) {
        const t = i / n, z = s0.z + dir * (.5 + t * len), y = dir > 0 ? s0.y - Math.sin(Math.min(1, t * 2.2) * Math.PI / 2) * 1.6 : s0.y + Math.sin(t * Math.PI) * -.5 + t * 4.4;
        this.S(new THREE.TorusGeometry(.16, .045, 4, 8).scale(1, 1.4, 1), trs(s0.x, y, z, i % 2 ? Math.PI / 2 : 0, Math.PI / 2), '#2a2629', PAT.plain, 1, .5, .8, -99);
      }
    }
  }
  private crane() {
    const c = FORGE_CRANE, y = this.h(c.x, c.z) + .06, m = trs(c.x, y, c.z, -.7);
    this.S(frustum(2.8, 2.8, 2.2, 2.2, 1.0), m, '#4f4b4e', PAT.ashlar, .8, .9, 0, y, 50);
    this.S(cyl(.7, .7, .3, 14).translate(0, 1.15, 0), m, '#2c2a2e', PAT.plate, 0, .45, .8, y);
    // Lattice mast and jib (iron), counterweight of stone, a winch drum, a hanging crate of ingots.
    const bar = (a: THREE.Vector3, b: THREE.Vector3, t = .1) => { const d = b.clone().sub(a), len = d.length(); const g = box(t, len, t); const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()); this.S(g, m.clone().multiply(new THREE.Matrix4().compose(a.clone().lerp(b, .5), q, new V(1, 1, 1))), '#2b292d', PAT.plain, 1, .45, .85, y); };
    const mast = 7.5;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bar(new V(sx * .45, 1.3, sz * .45), new V(sx * .3, mast, sz * .3), .14);
    for (let k = 0; k < 5; k++) { const y0 = 1.3 + k * (mast - 1.3) / 5, y1 = y0 + (mast - 1.3) / 5, r0 = .45 - .15 * k / 5, r1 = .45 - .15 * (k + 1) / 5; bar(new V(-r0, y0, r0), new V(r1, y1, r1)); bar(new V(r0, y0, -r0), new V(r1, y1, r1)); bar(new V(-r0, y0, -r0), new V(-r1, y1, r1)); }
    const tip = new V(0, mast + 2.2, 9.5), root = new V(0, mast - .3, 0);
    bar(root, tip, .2); bar(new V(0, mast + 1.4, 0), tip, .08); bar(new V(0, mast + 1.4, 0), new V(0, mast - .3, -2.6), .08); bar(new V(0, mast - .4, 0), new V(0, mast - .4, -2.6), .16);
    bar(new V(0, mast - .3, 0), new V(0, mast + 1.4, 0), .14);
    this.S(box(1.4, 1.0, 1.0), m.clone().multiply(trs(0, mast - .9, -2.6)), '#4f4b4e', PAT.ashlar, .5, .9, 0, y, 51);
    this.S(cyl(.35, .35, .9, 12).rotateZ(Math.PI / 2).translate(0, 1.9, .7), m, '#3a383c', PAT.plain, 1, .45, .85, y);
    bar(tip, new V(0, mast - 3.2, 9.5), .03);
    this.crate(m.clone().multiply(trs(0, mast - 4.0, 9.5, .3)), -99, 900, 1.0, .8);
    this.S(new THREE.TorusGeometry(.18, .04, 4, 8), m.clone().multiply(trs(0, mast - 3.1, 9.5)), '#2b292d', PAT.plain, 1, .45, .85, y);
  }

  /* -- assembly -- */
  private finish() {
    const nl = this.low ? 8 : 16;
    // Strongest and nearest-the-town sources first; the rest still light the ground through their pools.
    this.lights.sort((a, b) => b.k * b.r - a.k * a.r);
    for (let i = 0; i < 16; i++) {
      const l = this.lights[i];
      this.lightPos.push(l ? new THREE.Vector4(l.x, l.y, l.z, i < nl ? l.r : 0) : new THREE.Vector4(0, -1e4, 0, 0));
      this.lightCol.push(l ? new THREE.Vector4(l.c[0] * l.k, l.c[1] * l.k, l.c[2] * l.k, i * 1.37) : new THREE.Vector4());
    }
    this.stats.lights = Math.min(nl, this.lights.length);
    const solid = new THREE.Mesh(this.solid.geometry(), solidMaterial(nl, {uTime: this.time, uLP: {value: this.lightPos}, uLC: {value: this.lightCol}}));
    solid.name = 'ember-town-solid'; solid.castShadow = solid.receiveShadow = true;
    const glow = new THREE.Mesh(this.glow.geometry(), glowMaterial(this.time)); glow.name = 'ember-town-glow';
    const cloth = new THREE.Mesh(this.cloth.geometry(), clothMaterial(this.time)); cloth.name = 'ember-town-cloth'; cloth.castShadow = true; cloth.receiveShadow = true;
    const pools = new THREE.Mesh(this.pools.geometry(), poolMaterial(this.time)); pools.name = 'ember-town-pools'; pools.renderOrder = 2;
    this.root.add(solid, glow, cloth, pools);
    const per = this.low ? 8 : 16;
    if (this.puffs.length) { const smoke = this.puffMesh(this.puffs, per, false); smoke.name = 'ember-town-smoke'; smoke.renderOrder = 4; this.root.add(smoke); this.stats.smoke = this.puffs.length * per; }
    if (this.flames.length) { const fl = this.puffMesh(this.flames, this.low ? 4 : 7, true); fl.name = 'ember-town-flames'; fl.renderOrder = 3; this.root.add(fl); this.stats.flames = this.flames.length * (this.low ? 4 : 7); }
    if (!this.low && this.sparks.length) {
      const pos: number[] = [], e: number[] = [], s: number[] = [];
      for (const [k, sp] of this.sparks.entries()) for (let i = 0; i < sp.n; i++) { pos.push(sp.x, sp.y, sp.z); e.push(sp.x, sp.y, sp.z, sp.s); s.push(hash(k * 31 + i), hash(k * 17 + i * 3.3)); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aE', new THREE.Float32BufferAttribute(e, 4)); g.setAttribute('aS', new THREE.Float32BufferAttribute(s, 2));
      g.boundingSphere = new THREE.Sphere(new V(0, 20, 60), 140);
      const pts = new THREE.Points(g, sparkMaterial(this.time)); pts.name = 'ember-town-sparks'; pts.renderOrder = 5; this.root.add(pts); this.stats.sparks = pos.length / 3;
    }
    this.root.userData.emberTown = this.stats;
    this.root.userData.emberTownTris = (this.solid.count + this.glow.count + this.cloth.count) / 3;
  }
  private puffMesh(list: {x: number; y: number; z: number; s: number}[], per: number, flame: boolean) {
    const pos: number[] = [], e: number[] = [], s: number[] = [], idx: number[] = [];
    let v = 0;
    list.forEach((p, k) => { for (let i = 0; i < per; i++) {
      const ph = i / per + hash(k * 7 + i) * .3 / per, sd = hash(k * 13 + i * 1.7);
      for (const [cx, cy] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) { pos.push(p.x, p.y, p.z); e.push(p.x, p.y, p.z, p.s); s.push(cx, cy, ph, sd); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aE', new THREE.Float32BufferAttribute(e, 4)); g.setAttribute('aS', new THREE.Float32BufferAttribute(s, 4)); g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new V(0, 20, 60), 160);
    return new THREE.Mesh(g, puffMaterial(this.time, flame));
  }

  update(time: number) { this.time.value = time; }
}
