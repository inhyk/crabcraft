import * as THREE from 'three';
import type {LavaZone} from './emberLava';
import {
  FORGE_BANNERS, FORGE_BARGE, FORGE_BEDS, FORGE_BRAZIERS, FORGE_C, FORGE_HOIST, FORGE_CRANE, FORGE_FURNACE, FORGE_HOUSES, FORGE_JETTY,
  FORGE_LANTERNS, FORGE_OPEN_FORGE, FORGE_QUAY, FORGE_RAIL, FORGE_GATE, FORGE_STALLS, GLASS_KILN, forgeYaw, yardAt,
  type ForgeHouse,
} from './emberTownLayout';
import {emberSurface} from './emberPaving';
import {EMBER_VENTS} from './emberGroundLayout';

/*
 * Emberreach's forge works and arrival quay (World V), from the plan in emberTownLayout.ts: one round furnace yard
 * paved in concentric courses of cut basalt round the town's blast furnace (iron-hooped basalt shaft, charging gallery,
 * three glowing tap mouths feeding channels across the flags to casting beds), ringed by six battered basalt houses
 * facing it, with lighter mortar, crow-stepped gables, verdigris copper roofs (riveted iron on the two forges), big
 * stacks breathing smoke and sparks, lit windows and caged lanterns on wall brackets; each house shows its trade in
 * front (smithy, ore house, inn, armourer, glassblower, ore merchant). Lantern posts and banners stand only where
 * people gather: the yard's mouths, the quay and the sanctuary gate. The south rim is a quay with a jetty out over the
 * lava, a heat-proof ore barge on its chain ferry and a cargo crane.
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
const PAT = {plain: 0, ashlar: 1, rubble: 2, plank: 3, plate: 4, yard: 5};
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
    Object.assign(s.uniforms, uniforms, {uMortar: {value: new THREE.Color('#a39b92')}, uYard: {value: new THREE.Vector3(FORGE_C.x, FORGE_C.z, FORGE_C.r)}});
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPat;attribute vec2 aRM;varying vec4 vPat;varying vec2 vRM;varying vec3 vWP;varying vec3 vWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvPat=aPat;vRM=aRM;vWP=(modelMatrix*vec4(transformed,1.)).xyz;vWN=normalize(mat3(modelMatrix)*objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n#define ET_LIGHTS ${lights}\nuniform float uTime;uniform vec4 uLP[16];uniform vec4 uLC[16];uniform vec3 uMortar;uniform vec3 uYard;varying vec4 vPat;varying vec2 vRM;varying vec3 vWP;varying vec3 vWN;\n${NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  vec3 N0=normalize(vWN);vec2 etQ;vec3 etU=vec3(1.,0.,0.),etV=vec3(0.,0.,1.),etBev=vec3(0.);
  if(abs(N0.y)>.72)etQ=vWP.xz;else{vec2 t=normalize(vec2(-N0.z,N0.x));etQ=vec2(dot(vWP.xz,t),vWP.y);etU=vec3(t.x,0.,t.y);etV=vec3(0.,1.,0.);}
  float pat=vPat.x,etK=vPat.y,etSeed=vPat.z,etRough=1.;
  if(pat>.5&&pat<2.5){
    // Dressed stone (1) or rubble (2): courses alternating tall and short, blocks of mixed length (some split),
    // pitted faces, chamfered arrises tilting the normal, thin lighter mortar.
    float rub=step(1.5,pat);float ka=(.5+.18*rub)*etK,kb=(.34+.14*rub)*etK,per=ka+kb;
    float pr=floor(etQ.y/per),fy=etQ.y-pr*per,top=step(ka,fy);float row=pr*2.+top,hgt=mix(ka,kb,top);fy-=top*ka;
    float w=(.5+1.15*etH(vec2(row,etSeed+3.)))*etK*(1.+.35*rub);float x=etQ.x+etH(vec2(row,etSeed))*3.;float c=floor(x/w);float fx=x-c*w;
    float sp=etH(vec2(c,row)+etSeed*.7);if(sp<.38){float at=w*(.35+.3*etH(vec2(row,c)));if(fx>at){fx-=at;w-=at;c+=.5;}else w=at;}
    float jit=(etN(etQ*4.+etSeed)-.5)*.04*etK*(.3+rub);
    float e=min(min(fx,w-fx),min(fy,hgt-fy))+jit;
    float mo=1.-smoothstep(.01*etK,.026*etK,e);
    float bh=etH(vec2(c,row)+etSeed);float bt=.84+.3*bh;
    vec3 st=diffuseColor.rgb*bt*mix(vec3(1.),vec3(1.06,.99,.95),etH(vec2(row,c)+2.))*(.88+.16*etN(etQ*15.+etSeed)+.06*etN(etQ*3.));
    float bv=.075*etK;st*=.86+.14*smoothstep(0.,bv*1.6,e);
    diffuseColor.rgb=mix(st,uMortar*(.85+.2*etN(etQ*5.)),mo);etRough=1.+.12*mo;
    vec2 tl=vec2((1.-smoothstep(0.,bv,w-fx))-(1.-smoothstep(0.,bv,fx)),(1.-smoothstep(0.,bv,hgt-fy))-(1.-smoothstep(0.,bv,fy)));
    tl+=(vec2(etH(vec2(c,row+9.)),etH(vec2(row,c+5.)))-.5)*.22;
    etBev=(tl.x*etU+tl.y*etV)*.5*(1.-mo);
  }else if(pat>2.5&&pat<3.5){
    // Planks: boards across u, grain along v, dark gaps.
    float w=.2*etK;float b=floor(etQ.x/w);float f=fract(etQ.x/w);
    float grain=etN(vec2(etQ.x*40.,etQ.y*2.5+b*7.));
    diffuseColor.rgb*=(.78+.36*etH(vec2(b,etSeed)))*(.8+.3*grain)*mix(.45,1.,smoothstep(0.,.06,f)*smoothstep(1.,.94,f));
  }else if(pat>4.5){
    // Furnace yard: concentric courses of cut flags round the furnace, staggered radial joints filled with ash, the
    // joints nearest the furnace breathing heat (emissive below), a darker trodden ring.
    vec2 yd=vWP.xz-uYard.xy;float yr=length(yd),yth=atan(yd.y,yd.x);
    float cw=.72,ri=floor(yr/cw),fr=yr/cw-ri,rm=(ri+.5)*cw;
    float n=max(8.,floor(6.2832*rm/(.85+.5*etH(vec2(ri,4.1)))));
    float u=(yth/6.2832+.5+etH(vec2(ri,9.3)))*n,c=floor(u),fu=u-c;
    float id=etH(vec2(c,ri)+1.7);
    float e=min(min(fu,1.-fu)*6.2832*rm/n,min(fr,1.-fr)*cw)+(etN(vWP.xz*5.)-.5)*.025;
    float mo=1.-smoothstep(.015,.04,e);
    vec3 st=diffuseColor.rgb*(.86+.22*id)*(.88+.16*etN(vWP.xz*11.+id*7.)+.08*etN(vWP.xz*2.3));
    st=mix(st,st*vec3(.74,.75,.8),step(id,.07));st=mix(st,st*vec3(1.08,.98,.93),step(.95,id)*.6);
    // Soot fans out from the furnace and the tap channels; a darker trodden ring; ash drifts lie in patches.
    float soot=(1.-smoothstep(5.5,14.,yr))*.5+(1.-smoothstep(9.,26.,yr))*.2;
    st*=1.-soot*(.6+.4*etN(vWP.xz*.9));
    st*=mix(1.,.9,smoothstep(3.,1.,abs(yr-16.)));
    float ash=smoothstep(.58,.9,etN(vWP.xz*.45+3.)*.7+etN(vWP.xz*1.7)*.3)*smoothstep(8.,14.,yr);
    vec3 jt=mix(vec3(.07,.066,.072),uMortar*.4,.15+.5*ash);
    st=mix(st,uMortar*.36*(.9+.2*etN(vWP.xz*6.)),ash*.4);
    diffuseColor.rgb=mix(st,jt,mo);etRough=1.+.15*mo;
    vec2 tl=vec2(smoothstep(.06,0.,(1.-fu)*6.2832*rm/n)-smoothstep(.06,0.,fu*6.2832*rm/n),smoothstep(.06,0.,(1.-fr)*cw)-smoothstep(.06,0.,fr*cw));
    vec2 tr=vec2(-sin(yth),cos(yth)),rd=vec2(cos(yth),sin(yth));
    etBev=(tl.x*vec3(tr.x,0.,tr.y)+tl.y*vec3(rd.x,0.,rd.y))*.35*(1.-mo);
    etSeed=mo*(1.-smoothstep(5.,13.,yr))*smoothstep(.4,.72,etN(vWP.xz*.9+4.))*(.6+.4*etN(vWP.xz*1.3+uTime*.05));
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
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize(normal+mat3(viewMatrix)*etBev);')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
  {vec3 warm=vec3(0.);
   for(int i=0;i<ET_LIGHTS;i++){vec3 d=uLP[i].xyz-vWP;float r=uLP[i].w;float dl=length(d);
    if(dl<r){float fa=1.-dl/r;fa*=fa;float ndl=max(dot(N0,d/dl)*.8+.2,0.);
     float fl=1.+.16*sin(uTime*(6.3+uLC[i].w)+uLC[i].w*3.1)+.09*sin(uTime*15.7+uLC[i].w*7.);warm+=uLC[i].rgb*fa*ndl*fl;}}
   totalEmissiveRadiance+=warm*diffuseColor.rgb;
   if(vPat.x>4.5)totalEmissiveRadiance+=vec3(1.,.22,.04)*etSeed*.9;}`);
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
  readonly stats: Record<string, number> = {wallLanterns: 0, furnace: 0, houses: 0, chimneys: 0, forgeMouths: 0, windows: 0, lanterns: 0, banners: 0, braziers: 0, carts: 0, blades: 0, lights: 0, pools: 0, smoke: 0, flames: 0, sparks: 0, skipped: 0};
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
    this.yard();
    this.furnace();
    for (const h of FORGE_HOUSES) this.house(h);
    this.outdoorForge();
    FORGE_STALLS.forEach((s, i) => { const [x, z] = yardAt(s.a, s.r); this.stall(x, z, -s.a * Math.PI / 180, i); });
    FORGE_BRAZIERS.forEach((b, i) => this.brazier(...yardAt(b.a, b.r), 1.05, 11 + i));
    FORGE_LANTERNS.forEach(([x, z], i) => this.lantern(x, z, i));
    FORGE_BANNERS.forEach(([x, z], i) => this.bannerPost(x, z, i));
    this.harbour();
    this.vents();
    this.finish();
  }

  /* -- placement helpers -- */
  /** Walking surface: the yard's flags inside the furnace yard, the terrain elsewhere. */
  private floor(x: number, z: number) { return Math.hypot(x - FORGE_C.x, z - FORGE_C.z) < FORGE_C.r ? emberSurface(this.h, x, z) + .07 : this.h(x, z); }
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
  private brazier(x: number, z: number, s: number, phase: number, at?: number) {
    const y = at ?? this.h(x, z), m = trs(x, y, z, phase);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; this.S(box(.06, 1.05 * s, .06).translate(0, .52 * s, 0).applyMatrix4(trs(Math.cos(a) * .3 * s, 0, Math.sin(a) * .3 * s, -a, 0, .22)), m, '#2a292d', PAT.plain, 1, .5, .8, y); }
    this.S(lathe([[.1, 0], [.38, .1], [.52, .32], [.55, .36], [.5, .36], [.36, .16], [0, .1]].map(([r, h]) => [r * s, h * s] as [number, number]), 12).translate(0, .95 * s, 0), m, '#2f2d31', PAT.plate, 0, .5, .8, y);
    this.G(lathe([[0, .3 * s], [.46 * s, .3 * s], [.3 * s, .42 * s], [0, .46 * s]], 10).translate(0, .95 * s, 0), m, lin('#ff7a24', 2.2), .4, phase);
    this.fire(x, y + 1.35 * s, z, 1.1 * s, 7 * s, 2.6, phase);
    this.stats.braziers++;
  }
  private cart(x: number, z: number, yaw: number, load: 'ore' | 'ingot', seed: number) {
    const y = this.floor(x, z) + .08, m = trs(x, y, z, yaw);
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
    for (let t = .4; t < len; t += .9) { const x = x0 + (x1 - x0) * t / len, z = z0 + (z1 - z0) * t / len, y = this.floor(x, z); this.S(box(1.6, .12, .26), trs(x, y + .02, z, yaw), '#3f3029', PAT.plank, .4, .95, 0, y, t); }
    // Rails in short lengths so they follow the floor.
    for (const s of [-1, 1]) for (let t = 0; t < len - .01; t += 3) { const l = Math.min(3, len - t), x = x0 + (x1 - x0) * (t + l / 2) / len + Math.cos(yaw) * s * .55, z = z0 + (z1 - z0) * (t + l / 2) / len - Math.sin(yaw) * s * .55; this.S(box(.09, .1, l), trs(x, this.floor(x, z) + .13, z, yaw), '#5d5a5c', PAT.plain, 1, .3, .9, -99); }
  }
  /** Buffer stop at a rail end (x, z), the rails arriving along `yaw`: an iron-shod timber beam on two posts braced back
   *  with raking struts, a heap of ballast behind it. */
  private bufferStop(x: number, z: number, yaw: number) {
    const y = this.floor(x, z), m = trs(x, y, z, yaw);
    for (const s of [-1, 1]) {
      this.S(box(.22, .62, .22).translate(s * .55, .31, 0), m, '#3f3029', PAT.plank, .5, .92, 0, y);
      this.S(box(.14, .1, 1.05).applyMatrix4(new THREE.Matrix4().makeRotationX(.42)).translate(s * .55, .3, .5), m, '#3f3029', PAT.plank, .5, .92, 0, y);
      this.S(cyl(.13, .13, .12, 10).rotateX(Math.PI / 2).translate(s * .55, .5, -.17), m, '#2a292d', PAT.plain, 1, .4, .85, y);
    }
    this.S(box(1.7, .28, .26).translate(0, .5, 0), m, '#4a3426', PAT.plank, .6, .9, 0, y);
    this.S(box(1.74, .08, .3).translate(0, .66, 0), m, '#2b292d', PAT.plate, 0, .45, .8, y);
    const [hx, hz] = [x + Math.sin(yaw) * .95, z + Math.cos(yaw) * .95]; this.heap(hx, hz, .7, 10, '#3a3739', 900 + Math.round(x * 7 + z));
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
    const W = h.w, D = h.d, Ht = h.wall, Hr = h.rise;
    const toW = (lx: number, lz: number): [number, number] => [h.x + lx * cs + lz * sn, h.z - lx * sn + lz * cs];
    let y0 = Infinity; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [x, z] = toW(sx * W / 2, sz * D / 2); y0 = Math.min(y0, this.h(x, z)); }
    const F = trs(h.x, y0, h.z, yaw), L = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => F.clone().multiply(trs(x, y, z, ry, rx, rz));
    const gy = (lx: number, lz: number) => { const [x, z] = toW(lx, lz); return this.h(x, z) - y0; };
    const B = y0, wallHex = ['#47434a', '#433f43', '#4a4548', '#45424a', '#494447', '#434046'][h.seed - 1];
    const seed = h.seed * 11;
    // Plinth (rubble, battered, sunk into the slope) and walls (dressed basalt, battered).
    this.S(frustum(W + .6, D + .6, W + .1, D + .1, 2.2), L(0, -1.2, 0), '#433f44', PAT.rubble, 1.2, .95, 0, B, seed);
    const wb = 1.0, hx = (y: number) => (W - .5 * (y - wb) / (Ht - wb)) / 2, hz = (y: number) => (D - .5 * (y - wb) / (Ht - wb)) / 2;
    this.S(frustum(W, D, W - .5, D - .5, Ht - wb), L(0, wb, 0), wallHex, PAT.ashlar, .76, .9, 0, B, seed + 1);
    // Quoins: alternating long and short pale blocks up every corner.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0, y = wb + .25; y < Ht - .2; i++, y += .5) {
      const a = (i + (sx * sz > 0 ? 0 : 1)) % 2 ? .95 : .55, b = (i + (sx * sz > 0 ? 0 : 1)) % 2 ? .55 : .95;
      this.S(box(a, .47, b), L(sx * (hx(y) - a / 2 + .05), y, sz * (hz(y) - b / 2 + .05)), '#5d5756', PAT.plain, 1, .9, 0, B, i);
    }
    this.S(box(W - .2, .26, D - .2), L(0, Ht - .02, 0), '#5a5452', PAT.plain, 1, .9, 0, B);
    // Roof: plates between crow-stepped gables, ridge along z (the gable faces the avenue).
    const eaveW = W / 2 + .45, slope = Math.atan2(Hr, eaveW), pl = Math.hypot(Hr, eaveW) + .05, gz = hz(Ht) - .3;
    const roofHex = h.roof === 'copper' ? '#4f8f7f' : '#3d3a3a', patina = h.roof === 'copper' ? 1 : 0;
    for (const s of [-1, 1]) this.S(box(pl, .16, 2 * gz - .1), L(s * eaveW / 2, Ht + Hr / 2 - .1, 0, 0, 0, -s * slope), roofHex, PAT.plate, patina, h.roof === 'copper' ? .55 : .45, h.roof === 'copper' ? .45 : .7, B, seed);
    this.S(prism(W - .6, Hr - .1, 2 * gz - .2), L(0, Ht, 0), '#2a2629', PAT.plain, 1, .9, 0, B);
    this.S(box(.34, .3, 2 * gz + .3), L(0, Ht + Hr + .02, 0, 0, Math.PI / 4 * 0), '#2c2a2d', PAT.plate, 0, .4, .8, B);
    for (let z = -gz + .6; z < gz; z += 1.2) this.S(box(.12, .16, .12), L(0, Ht + Hr + .22, z), '#c8923c', PAT.plain, 1, .35, .9, B);
    // Gutters along the eaves.
    for (const s of [-1, 1]) this.S(box(.16, .14, 2 * gz + .2), L(s * (eaveW + .02), Ht - .2, 0), '#2a292c', PAT.plain, 1, .4, .8, B);
    const steps = 5;
    for (const sz of [-1, 1]) for (let k = 0; k < steps; k++) {
      const hw = (hx(Ht) + .15) * (1 - k / steps) + .25, y = Ht + k * Hr / steps, th = Hr / steps;
      this.S(box(2 * hw, th, .62), L(0, y + th / 2, sz * gz), wallHex, PAT.ashlar, .76, .9, 0, B, seed + 2);
      for (const s of [-1, 1]) this.S(box(.62, .16, .76), L(s * (hw - .26), y + th + .06, sz * gz), '#6a6360', PAT.plain, 1, .9, 0, B);
      if (k === steps - 1) { this.S(box(2 * hw + .1, .16, .76), L(0, y + th + .06, sz * gz), '#6a6360', PAT.plain, 1, .9, 0, B); this.S(new THREE.ConeGeometry(.09, .9, 6).translate(0, .45, 0), L(0, y + th + .14, sz * gz), '#c8923c', PAT.plain, 1, .3, .9, B); }
    }
    // Gable oculus, lit.
    { const m = L(0, Ht + Hr * .42, gz + .32); this.S(new THREE.TorusGeometry(.5, .13, 5, 12), m, '#80776f', PAT.plain, 1, .9, 0, B); this.G(new THREE.CircleGeometry(.44, 12), m, lin('#ff9a3c', 1.5), .1, seed); this.S(box(.05, .9, .05).translate(0, 0, .04), m, '#1f1e22', PAT.plain, 1, .5, .8, B); this.S(box(.9, .05, .05).translate(0, 0, .04), m, '#1f1e22', PAT.plain, 1, .5, .8, B); }
    // Big chimney stack with soot and a corbelled cap; smoke and sparks rise from it.
    const big = h.role === 'smelter' ? 1.25 : 1, chx = (h.role === 'inn' ? 2.6 : -2.8), chz = -2.2, top = Ht + Hr + 2.6 * big;
    this.S(frustum(1.6 * big, 1.6 * big, 1.4 * big, 1.4 * big, top - Ht + .6 - 1.2), L(chx, Ht - .6, chz), wallHex, PAT.ashlar, .6, .9, 0, B, seed + 3);
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
    const forge = h.roof === 'iron';
    if (forge) this.forgeMouth(h, L(-3.2, wb, fz(wb + 1.5)), toW, B, seed);
    else if (h.role !== 'inn') { this.window(L(-3.2, wb + 1.6, fz(wb + 1.6)), 1.6, 1.6, B, true, 2.1); const [px, pz] = toW(-3.2, D / 2 + 2.2); this.light(px, B + 2.2, pz, 7, '#ff9a4a', 1.3); this.pool(px, pz, 3.2, '#ff8a3a', .6, seed); }
    else { this.window(L(-3.3, wb + 1.7, fz(wb + 1.7)), 1.5, 1.5, B, true, 1.9); this.window(L(-3.3, wb + 4.4, fz(wb + 4.4)), 1.0, 1.2, B, false); this.window(L(3.3, wb + 4.4, fz(wb + 4.4)), 1.0, 1.2, B, false); this.light(...this.at(toW, -3.3, D / 2 + 1, B + 2.4), 7, '#ff9a4a', 1.4); }
    this.window(L(3.3, wb + 1.7, fz(wb + 1.7)), 1.0, 1.35, B, h.role === 'inn' || h.role === 'glassblower');
    for (const s of [-1, 1]) {
      for (const lz of [-2.2, 2.2]) this.window(L(s * hx(wb + 1.9), wb + 1.9, lz, s * Math.PI / 2), .9, 1.2, B);
      if (h.role === 'inn') this.window(L(s * hx(wb + 4.5), wb + 4.5, 0, s * Math.PI / 2), .9, 1.1, B);
    }
    this.window(L(1.8, wb + 1.9, -hz(wb + 1.9), Math.PI), .9, 1.2, B);
    this.sign(h, L(1.25, wb + 3.2, fz(wb + 3.2)), B);
    // Caged lantern on a wall bracket beside the door (the lamps live on the houses, not along the roads).
    { const m = L(-1.55, wb + 2.75, fz(wb + 2.75)); this.S(box(.07, .07, .62).translate(0, .32, .31), m, '#1f1e22', PAT.plain, 1, .5, .8, B); this.S(box(.05, .45, .05).applyMatrix4(trs(0, .1, .12, 0, .7)), m, '#1f1e22', PAT.plain, 1, .5, .8, B); this.cageLantern(m.clone().multiply(trs(0, -.05, .58)), B, seed + 7, .75); const [px, pz] = toW(-1.55, D / 2 + 1.4); this.pool(px, pz, 2.4, '#ff9a48', .42, seed + 3); this.stats.wallLanterns++; }
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
    const g = new V(0, 0, 3.1).applyMatrix4(m); this.pool(g.x, g.z, 3.8, '#ff6a24', .66, seed);
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
    const D = h.d, front = D / 2;
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
        // The ore house: ore and coal bins either side, a loaded cart on rails running out towards the furnace.
        for (const [lx, hex, sd, hot] of [[-4.6, '#5a4440', 30, .1], [4.6, '#232126', 31, 0]] as [number, string, number, number][]) {
          this.S(frustum(3.2, 2.2, 3.1, 2.1, .7), ground(lx, front + 3.0), '#3f3b40', PAT.rubble, .8, .95, 0, B, seed + sd);
          this.heap(...toW(lx, front + 3.0), 1.3, 20, hex, seed + sd, hot, B + gy(lx, front + 3.0) + .55);
        }
        // Rails from the door to the foot of the furnace's skip hoist, one cart loaded on the way.
        { const [ax, az] = toW(0, front + 1.4), [bx, bz] = yardAt(FORGE_HOIST.a, FORGE_HOIST.r + 1.25); this.rails(ax, az, bx, bz); this.bufferStop(bx, bz, Math.atan2(bx - ax, bz - az));
          this.cart(ax + (bx - ax) * .42, az + (bz - az) * .42, Math.atan2(bx - ax, bz - az), 'ore', seed); }
        this.barrel(ground(-6.1, front + 5.6), B, seed + 2);
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
        this.rails(...toW(-4.4, front + 1.2), ...toW(-4.4, front + 9.2)); this.bufferStop(...toW(-4.4, front + 9.0), forgeYaw(h));
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

  /* -- furnace yard -- */
  /** The yard's floor: one polar mesh conformed a few centimetres over the rendered terrain (the solid shader lays the
   *  concentric courses), a kerb ring broken where the ways come in. */
  private yard() {
    const C = FORGE_C, r0 = FORGE_FURNACE.plinth - .6, nr = 26, na = 120, pos: number[] = [], idx: number[] = [];
    const lift = (x: number, z: number) => emberSurface(this.h, x, z) + .07;
    for (let i = 0; i <= nr; i++) for (let j = 0; j < na; j++) {
      const r = r0 + (C.r - r0) * i / nr, t = j / na * TAU, x = C.x + Math.sin(t) * r, z = C.z - Math.cos(t) * r;
      pos.push(x, lift(x, z), z);
    }
    for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) { const a = i * na + j, b = i * na + (j + 1) % na, c = a + na, d = b + na; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.S(g, new THREE.Matrix4(), '#41434c', PAT.yard, 1, .82, 0, -99, 0);
    // Kerb: long dressed stones on the rim, open at the avenue, the lanes and the spawn portal.
    const gaps: [number, number][] = [[0, 5.2], [180, 5.2], [290, 3.4], [79, 3.4], [206.6, 4.2]];
    const n = Math.round(TAU * C.r / 1.25);
    for (let k = 0; k < n; k++) {
      const a = (k + .5) / n * 360, t = a * Math.PI / 180;
      if (gaps.some(([g0, w]) => Math.abs(((a - g0 + 540) % 360) - 180) * Math.PI / 180 * C.r < w)) continue;
      const [x, z] = yardAt(a, C.r - .2), y = lift(x, z) - .1;
      this.S(box(1.18, .26, .46).translate(0, .13, 0), trs(x, y, z, -t + Math.PI / 2 * 0, 0, 0), '#4e4c52', PAT.plain, 1, .9, 0, y - .1, k);
    }
    // Tap channels from the furnace mouths to the casting beds; the beds hold ingots in sand moulds, some still glowing.
    for (const [i, b] of FORGE_BEDS.entries()) {
      const t = b.a * Math.PI / 180, r1 = FORGE_FURNACE.r + .9, r2 = b.r - 1.3, len = r2 - r1;
      const [cx, cz] = yardAt(b.a, (r1 + r2) / 2), cy = lift(cx, cz);
      const m = trs(cx, cy, cz, -t);
      for (const s of [-1, 1]) this.S(box(.26, .16, len).translate(s * .36, .05, 0), m, '#55525a', PAT.plain, 1, .85, 0, cy - .1, i + s);
      this.G(box(.42, .04, len).translate(0, .02, 0), m, [1, 1, 1], .35, i * 2.3, (_x, _y, z) => lin(z < 0 ? '#ffb24a' : '#ff6a1c', z < 0 ? 3.0 : 2.2));
      const [bx, bz] = yardAt(b.a, b.r), by = lift(bx, bz), bm = trs(bx, by, bz, -t);
      this.S(frustum(3.4, 2.6, 3.2, 2.4, .3).translate(0, -.08, 0), bm, '#4f4c52', PAT.ashlar, .5, .9, 0, by - .1, 70 + i);
      this.S(box(2.9, .05, 2.1).translate(0, .22, 0), bm, '#7a6c5c', PAT.plain, 1, 1, 0, by - .1, i);
      for (let k = 0; k < 8; k++) {
        const lx = (k % 4 - 1.5) * .66, lz = (Math.floor(k / 4) - .5) * .9, hot = (k + i) % 3 !== 0;
        const g2 = frustum(.34, .66, .28, .58, .11).translate(lx, .24, lz);
        if (hot) this.G(g2, bm, lin(k < 4 ? '#ffb040' : '#ff5a14', k < 4 ? 2.6 : 1.4), .2, k + i); else this.S(g2, bm, '#3a383c', PAT.plain, 1, .4, .8, by);
      }
      this.pool(bx, bz, 3.2, '#ff7a2a', .5, i * 1.9);
      this.sparks.push({x: bx, y: by + .4, z: bz, s: .25, n: 5});
      // Beside each bed: a slag heap with a few still-hot lumps, cooled ingots stacked on a pallet.
      { const [sx, sz] = yardAt(b.a + 17, b.r + .6); this.heap(sx, sz, 1.1, 16, '#2c2a30', 300 + i * 7, .12, lift(sx, sz)); }
      { const [px, pz] = yardAt(b.a + (i === 2 ? 32 : -15), b.r + (i === 2 ? -.5 : .8)), py = lift(px, pz), pm = trs(px, py, pz, -t + .3); this.S(box(1.5, .12, 1.1).translate(0, .06, 0), pm, '#4a3426', PAT.plank, .6, .9, 0, py);
        for (let k = 0; k < 10; k++) { const l = Math.floor(k / 4); this.S(frustum(.32, .66, .26, .58, .13).applyMatrix4(trs(((k % 4) % 2 - .5) * .62, .19 + l * .14, (Math.floor((k % 4) / 2) - .5) * .48, l % 2 ? Math.PI / 2 : 0)), pm, l === 2 ? '#8a6a46' : '#4b4a50', PAT.plain, 1, .32, .9, py); } }
    }
    // Round the rim: crates and barrels against the kerb.
    for (const [k, a] of [232, 262, 100, 125, 160].entries()) {
      const [x, z] = yardAt(a, C.r - 1.4), y = lift(x, z), m = trs(x, y, z, -a * Math.PI / 180 + Math.PI);
      this.crate(m.clone().multiply(trs(-.6, 0, 0, .2)), y, 400 + k); this.crate(m.clone().multiply(trs(.5, 0, .1, -.3)), y, 410 + k, .8, .6);
      if (k % 2) this.crate(m.clone().multiply(trs(-.5, .7, .05, .6)), y, 420 + k, .75, .55); else this.barrel(m.clone().multiply(trs(1.5, 0, .3)), y, 430 + k);
    }
  }

  /** The town's blast furnace: battered basalt shaft in iron hoops and straps, a blast main round its waist, a charging
   *  gallery, a verdigris gas cap over the glowing throat, three tap mouths, an inclined skip hoist up to the gallery. */
  private furnace() {
    const F = FORGE_FURNACE;
    let y0 = Infinity; for (let a = 0; a < 360; a += 30) y0 = Math.min(y0, this.h(...yardAt(a, F.plinth)));
    const m = trs(F.x, y0, F.z), L = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => m.clone().multiply(trs(x, y, z, ry, rx, rz));
    const prof: [number, number][] = [[F.r + .1, .4], [F.r, 1.4], [F.r - .25, 3.6], [F.r - .85, 6.2], [F.r - 1.4, 9.0], [F.r - 1.65, 10.6]];
    const rAt = (y: number) => { for (let k = 1; k < prof.length; k++) if (y <= prof[k][1]) { const [ra, ya] = prof[k - 1], [rb, yb] = prof[k]; return ra + (rb - ra) * (y - ya) / (yb - ya); } return prof[prof.length - 1][0]; };
    // Plinth (rubble, octagonal, stepped), the shaft, a pale collar.
    this.S(lathe([[0, -.8], [F.plinth + .2, -.8], [F.plinth, .1], [F.plinth - .5, .1], [F.plinth - .55, .45], [0, .45]], 8).rotateY(Math.PI / 8), m, '#3d3a40', PAT.rubble, 1.1, .95, 0, y0, 3);
    this.S(lathe([...prof, [F.r - 1.65, 10.75], [0, 10.75]], 20), m, '#423e42', PAT.ashlar, .85, .9, 0, y0, 5);
    this.S(lathe([[F.r - 1.75, 10.6], [F.r - 1.25, 10.7], [F.r - 1.2, 11.1], [F.r - 1.8, 11.15]], 16), m, '#6a6360', PAT.ashlar, .6, .9, 0, y0, 6);
    this.S(cyl(F.r - 1.2, F.r - 1.2, .12, 20).translate(0, 11.18, 0), m, '#c8923c', PAT.plain, 1, .32, .9, y0);
    // Hoops and straps.
    for (const y of [1.2, 2.6, 4.2, 5.9, 7.6, 9.6]) { const r = rAt(y) + .06; this.S(cyl(r, r, .2, 20).translate(0, y, 0), m, '#2b292d', PAT.plate, 0, .42, .82, y0); }
    for (let k = 0; k < 10; k++) {
      const t = (k + .5) / 10 * TAU; if (F.taps.some(a => Math.abs(((t * 180 / Math.PI - a + 540) % 360) - 180) < 16)) continue;
      for (let s = 1; s < prof.length; s++) { const [ra, ya] = prof[s - 1], [rb, yb] = prof[s], len = Math.hypot(rb - ra, yb - ya), rm = (ra + rb) / 2 + .05;
        this.S(box(.22, len, .08), L(Math.sin(t) * rm, (ya + yb) / 2, Math.cos(t) * rm, t, Math.atan2(rb - ra, yb - ya)), '#2b292d', PAT.plain, 1, .45, .82, y0); }
    }
    // Blast main round the waist with downcomers to the tuyeres.
    this.S(new THREE.TorusGeometry(F.r + .75, .32, 8, 28).rotateX(Math.PI / 2).translate(0, 4.6, 0), m, '#323035', PAT.plate, 0, .45, .8, y0, 8);
    for (let k = 0; k < 8; k++) { const t = (k + .5) / 8 * TAU, ry = rAt(2.2), x0 = Math.sin(t), z0 = Math.cos(t);
      this.S(cyl(.13, .13, 2.4, 6), L(x0 * (F.r + .7), 3.4, z0 * (F.r + .7)), '#2d2b30', PAT.plain, 1, .45, .82, y0);
      this.S(cyl(.13, .13, F.r + .7 - ry, 6).rotateZ(Math.PI / 2), L(x0 * (F.r + .7 + ry) / 2, 2.2, z0 * (F.r + .7 + ry) / 2, t + Math.PI / 2), '#2d2b30', PAT.plain, 1, .45, .82, y0);
      this.S(cyl(.2, .2, .14, 8).rotateZ(Math.PI / 2), L(x0 * (ry + .1), 2.2, z0 * (ry + .1), t + Math.PI / 2), '#c8923c', PAT.plain, 1, .32, .9, y0); }
    // Charging gallery: iron deck on struts, rails, and the gas cap over the throat with its stack.
    const gy = 9.0, gr = rAt(gy), go = gr + 1.7;
    this.S(lathe([[gr - .05, 0], [go, 0], [go, .2], [gr - .05, .2]], 24).translate(0, gy, 0), m, '#3a3739', PAT.plate, 0, .5, .75, y0, 9);
    for (let k = 0; k < 10; k++) { const t = k / 10 * TAU, x = Math.sin(t), z = Math.cos(t), rs = rAt(gy - 2.2);
      const a = new V(x * rs, gy - 2.2, z * rs), b = new V(x * (go - .2), gy, z * (go - .2)), d = b.clone().sub(a), len = d.length();
      this.S(box(.12, len, .12), m.clone().multiply(new THREE.Matrix4().compose(a.clone().lerp(b, .5), new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()), new V(1, 1, 1))), '#252428', PAT.plain, 1, .45, .85, y0);
      this.S(box(.07, 1.05, .07).translate(0, .52, 0), L(x * (go - .08), gy + .2, z * (go - .08)), '#252428', PAT.plain, 1, .45, .85, y0); }
    for (const hh of [.6, 1.1]) this.S(new THREE.TorusGeometry(go - .08, .04, 4, 40).rotateX(Math.PI / 2).translate(0, gy + .2 + hh, 0), m, '#252428', PAT.plain, 1, .45, .85, y0);
    this.G(new THREE.CircleGeometry(F.r - 1.75, 18).rotateX(-Math.PI / 2).translate(0, 11.2, 0), m, lin('#ff8a2a', 2.6), .45, 4);
    for (let k = 0; k < 4; k++) { const t = (k + .5) / 4 * TAU; this.S(box(.14, 1.5, .14).translate(0, .75, 0), L(Math.sin(t) * 1.55, 11.15, Math.cos(t) * 1.55, t, 0, 0), '#252428', PAT.plain, 1, .45, .85, y0); }
    this.S(lathe([[2.5, 0], [2.3, .25], [1.5, .9], [.75, 1.25], [.6, 1.3], [0, 1.3]], 16).translate(0, 12.5, 0), m, '#4f8f7f', PAT.plate, 1, .55, .45, y0, 10);
    this.S(new THREE.TorusGeometry(2.48, .07, 4, 28).rotateX(Math.PI / 2).translate(0, 12.52, 0), m, '#c8923c', PAT.plain, 1, .32, .9, y0);
    this.S(cyl(.55, .5, 2.6, 12).translate(0, 15.0, 0), m, '#2c2a2e', PAT.plate, 0, .5, .75, y0, 11);
    this.S(cyl(.68, .68, .2, 12).translate(0, 16.3, 0), m, '#4f8f7f', PAT.plate, 1, .55, .45, y0, 12);
    this.puffs.push({x: F.x, y: y0 + 16.4, z: F.z, s: 1.6}, {x: F.x + .3, y: y0 + 16.4, z: F.z - .2, s: 1.3});
    this.sparks.push({x: F.x, y: y0 + 16.4, z: F.z, s: .9, n: 22}, {x: F.x, y: y0 + 11.6, z: F.z, s: .6, n: 12});
    this.light(F.x, y0 + 10.4, F.z, 15, '#ff8a3a', 1.6);
    // Tap mouths: built-out cheeks with an arched glowing mouth, an iron lintel, sparks; light and a pool in front.
    for (const [i, a] of F.taps.entries()) {
      const t = -a * Math.PI / 180, r = rAt(1.2), tm = m.clone().multiply(trs(0, 0, 0, t + Math.PI)).multiply(trs(0, 0, r - .25));
      this.S(box(2.6, 2.7, 1.2).translate(0, 1.35, .3), tm, '#4f4b4f', PAT.ashlar, .8, .9, 0, y0, 20 + i);
      this.G(this.archShape(1.1, .8).translate(0, .95, .92), tm, [1, 1, 1], .4, i * 3.1, (_x, y) => { const k = Math.min(1, Math.max(0, (y - .5) / 1.2)); return lin(k < .45 ? '#ffd36b' : '#ff6a1c', 3.6 - 1.8 * k); });
      this.archRing(tm.clone().multiply(trs(0, 0, .88)), .72, 1.35, .3, .26, 7, '#6a6360', y0);
      this.S(box(2.2, .24, .3).translate(0, 2.35, .95), tm, '#2b292d', PAT.plate, 0, .45, .8, y0, i);
      const p = new V(0, .9, 2.0).applyMatrix4(tm); this.light(p.x, p.y + .5, p.z, 10, '#ff7a2a', 2.8);
      const q = new V(0, 0, 3.2).applyMatrix4(tm); this.pool(q.x, q.z, 3.8, '#ff6a24', .58, i * 2.2);
      this.sparks.push({x: p.x, y: p.y + .6, z: p.z, s: .35, n: 9});
    }
    // Inclined skip hoist: two lattice chords from a stone foot up to the gallery, a skip half-way with ore.
    { const t = -FORGE_HOIST.a * Math.PI / 180, hm = m.clone().multiply(trs(0, 0, 0, t + Math.PI)), foot = new V(0, 0, FORGE_HOIST.r), top = new V(0, gy + .2, go - .2);
      const fy = this.h(...yardAt(FORGE_HOIST.a, FORGE_HOIST.r)) - y0; foot.y = fy;
      this.S(frustum(2.2, 1.8, 1.8, 1.5, .9).translate(0, fy - .2, FORGE_HOIST.r), hm, '#4f4b4f', PAT.ashlar, .6, .9, 0, y0, 30);
      const bar = (a: THREE.Vector3, b: THREE.Vector3, w = .12) => { const d = b.clone().sub(a), len = d.length(); this.S(box(w, len, w), hm.clone().multiply(new THREE.Matrix4().compose(a.clone().lerp(b, .5), new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()), new V(1, 1, 1))), '#28272b', PAT.plain, 1, .45, .85, y0); };
      for (const s of [-1, 1]) { const a = foot.clone().add(new V(s * .7, .7, 0)), b = top.clone().add(new V(s * .7, .3, 0)); bar(a, b, .16); bar(a.clone().add(new V(0, .9, 0)), b.clone().add(new V(0, .9, 0)), .1);
        for (let k = 0; k < 7; k++) { const u = k / 7, v = (k + 1) / 7; bar(a.clone().lerp(b, u), a.clone().lerp(b, v).add(new V(0, .9, 0)), .06); } }
      for (let k = 0; k <= 7; k++) { const p = foot.clone().add(new V(0, .7, 0)).lerp(top.clone().add(new V(0, .3, 0)), k / 7); bar(p.clone().add(new V(-.7, 0, 0)), p.clone().add(new V(.7, 0, 0)), .08); }
      const sk = foot.clone().add(new V(0, 1.2, 0)).lerp(top, .45), sm = hm.clone().multiply(trs(sk.x, sk.y, sk.z, 0, -Math.atan2(top.y - foot.y, foot.z - top.z) + Math.PI / 2 * 0));
      this.S(frustum(1.0, 1.2, 1.2, 1.5, .8, true), sm, '#3a3638', PAT.plate, 0, .55, .75, y0, 31);
      const sw = new V(0, .82, 0).applyMatrix4(sm); this.heap(sw.x, sw.z, .5, 7, '#5a4440', 33, .1, sw.y); }
    this.stats.furnace++;
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
  private stall(x: number, z: number, yaw: number, i: number) {
    const y = this.h(x, z), m = trs(x, y, z, yaw);
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
    this.brazier(...this.atM(m, i ? -3.2 : 3.2, 1.6), .85, i * 2.1);
    this.crate(m.clone().multiply(trs(-3.0, 0, -.8, .2)), y, i); this.crate(m.clone().multiply(trs(-3.1, .7, -.8, .5)), y, i + 1, .8, .6); this.barrel(m.clone().multiply(trs(3.1, 0, -.9)), y, i);
  }
  private atM(m: THREE.Matrix4, lx: number, lz: number): [number, number] { const p = new V(lx, 0, lz).applyMatrix4(m); return [p.x, p.z]; }

  /** On the yard's west rim: hearth with hood and flue, bellows, anvil, quench trough, coal and tools. */
  private outdoorForge() {
    const [x, z] = yardAt(FORGE_OPEN_FORGE.a, FORGE_OPEN_FORGE.r), y = this.h(x, z), m = trs(x, y, z, -FORGE_OPEN_FORGE.a * Math.PI / 180);
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
  /** Quay deck height: the island's brow carried out over the slope to the quay wall. */
  private deck(x: number, z: number) { return this.h(x, Math.min(z, FORGE_QUAY.brow - 1)) + .06; }
  private harbour() {
    const Q = FORGE_QUAY, J = FORGE_JETTY, deck = (x: number, z: number) => this.deck(x, z);
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
    this.brazier(J.x - 4.5, Q.z1 - 3.5, 1.1, 5, deck(J.x - 4.5, Q.z1 - 3.5)); this.brazier(J.x + 4.5, Q.z1 - 3.5, 1.1, 6, deck(J.x + 4.5, Q.z1 - 3.5));
    this.gate();
    // Harbour master's tally board and a heat-shield shelter by the rails.
    { const m = trs(13, deck(13, 106), 106, -.4); for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.S(box(.12, 2.8, .12).translate(sx * 1.4, 1.4, sz * 1.0), m, '#232226', PAT.plain, 1, .45, .85, deck(13, 106)); this.S(box(3.4, .07, 2.6).applyMatrix4(trs(0, 2.9, 0, 0, .12)), m, '#3c393b', PAT.plate, 0, .5, .75, deck(13, 106), 9); this.crate(m.clone().multiply(trs(-.6, 0, .2)), deck(13, 106), 620); this.crate(m.clone().multiply(trs(.6, 0, -.1, .4)), deck(13, 106), 621); this.barrel(m.clone().multiply(trs(.5, 0, .7)), deck(13, 106), 622); }
  }
  /** Harbour gate: battered basalt pylons with braziers, an iron truss with the town's brass crest and chains. */
  private gate() {
    const G = FORGE_GATE, y = Math.min(this.deck(-G.x, G.z), this.deck(G.x, G.z)), top = 6.4;
    for (const s of [-1, 1]) {
      const x = s * G.x, by = this.h(x, G.z), m = trs(x, by, G.z);
      this.S(frustum(2.9, 2.9, 2.5, 2.5, 1.4).translate(0, -.4, 0), m, '#433f44', PAT.rubble, 1, .95, 0, by, 60 + s);
      this.S(frustum(2.4, 2.4, 1.95, 1.95, top - 1.0).translate(0, 1.0, 0), m, '#5d5859', PAT.ashlar, .85, .9, 0, by, 62 + s);
      for (let i = 0, yy = 1.25; yy < top - .3; i++, yy += .5) for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const hw = (2.4 - .45 * (yy - 1) / (top - 1)) / 2, a = (i + (cx * cz > 0 ? 0 : 1)) % 2 ? .8 : .5;
        this.S(box(a, .47, 1.3 - a), m.clone().multiply(trs(cx * (hw - a / 2 + .05), yy, cz * (hw - (1.3 - a) / 2 + .05))), '#7b7470', PAT.plain, 1, .9, 0, by, i);
      }
      this.S(box(2.4, .3, 2.4).translate(0, top + .15, 0), m, '#7d756f', PAT.plain, 1, .9, 0, by);
      this.brazier(x, G.z, 1.15, 7 + s, by + top + .3);
      // Banner on the town face of each pylon.
      const bw = 1.3, bh = 3.0, g = new THREE.PlaneGeometry(bw, bh, 4, 10), P = g.getAttribute('position'), U = g.getAttribute('uv');
      for (let k = 0; k < P.count; k++) { P.setZ(k, Math.sin(P.getX(k) / bw * TAU * 1.5 + s) * .04); U.setX(k, U.getX(k) * .5 + (s > 0 ? .5 : 0)); }
      g.computeVertexNormals();
      this.cloth.col = [1, 1, 1];
      this.cloth.add(g, trs(x, by + top - .55 - bh / 2, G.z - 1.13, Math.PI), undefined, (_x, py) => { const t = (bh / 2 - py) / bh; return [t * t * .6, s * 2.1]; });
      this.S(cyl(.035, .035, bw + .3, 6).rotateZ(Math.PI / 2), trs(x, by + top - .5, G.z - 1.16), '#1f1e22', PAT.plain, 1, .45, .85, by);
    }
    // Truss between the pylons: two chords and diagonals, the crest hanging under it on chains.
    const span = 2 * G.x - 1.9, ty = y + top - .7;
    for (const dy of [0, .9]) this.S(box(span, .16, .16), trs(0, ty + dy, G.z), '#262529', PAT.plain, 1, .45, .85, y);
    for (let i = 0; i < 6; i++) { const x0 = -span / 2 + i * span / 6, x1 = x0 + span / 6; const len = Math.hypot(x1 - x0, .9); this.S(box(.08, len, .08), trs((x0 + x1) / 2, ty + .45, G.z, 0, 0, (i % 2 ? 1 : -1) * Math.atan2(x1 - x0, .9)), '#262529', PAT.plain, 1, .45, .85, y); }
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) this.S(new THREE.TorusGeometry(.09, .025, 4, 8).scale(1, 1.4, 1), trs(s * .7, ty - .2 - k * .22, G.z, k % 2 ? Math.PI / 2 : 0), '#2a2629', PAT.plain, 1, .5, .8, y);
    const crest = new THREE.Shape(); crest.moveTo(-.95, .45); crest.lineTo(.7, .45); crest.quadraticCurveTo(1.15, .42, 1.05, .25); crest.lineTo(.45, .2); crest.lineTo(.3, -.1); crest.lineTo(.55, -.5); crest.lineTo(-.6, -.5); crest.lineTo(-.4, -.1); crest.lineTo(-.55, .2); crest.lineTo(-.95, .25); crest.closePath();
    const cm = trs(0, ty - 1.45, G.z);
    this.S(new THREE.ExtrudeGeometry(crest, {depth: .12, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 1}).translate(0, 0, -.06), cm, '#c8923c', PAT.plain, 1, .3, .9, y);
    const flame = new THREE.Shape(); flame.moveTo(-.35, .5); flame.quadraticCurveTo(-.45, .9, -.05, 1.35); flame.quadraticCurveTo(.05, 1.0, .12, 1.15); flame.quadraticCurveTo(.45, .85, .35, .5); flame.closePath();
    this.G(new THREE.ExtrudeGeometry(flame, {depth: .08, bevelEnabled: false}).translate(0, -.05, -.04), cm, lin('#ff7a24', 2.4), .3, 9);
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
    this.S(box(3.2, 2.6, 2.8).translate(0, 1.3, 0), dm, '#4a454a', PAT.ashlar, .6, .9, 0, sea, 42);
    this.S(prism(3.6, .7, 3.2).translate(0, 2.6, 0), dm, '#3a3638', PAT.plate, 0, .5, .75, sea, 43);
    this.S(cyl(.36, .3, 4.2, 10).translate(.8, 3.8, -.6), dm, '#2c2a2e', PAT.plate, 0, .5, .75, sea);
    for (const s of [-1, 1]) this.S(box(.12, .55, L - 1), m.clone().multiply(trs(s * (Bm / 2 - .05), 1.45, 0)), '#3a3638', PAT.plate, 0, .5, .75, sea, 44);
    for (const s of [-1, 1]) this.G(new THREE.PlaneGeometry(.6, .5).rotateY(s * Math.PI / 2).translate(s * 1.61, 1.5, 0), dm, lin('#ff9a3c', 1.7), .15, s);
    this.G(new THREE.PlaneGeometry(.7, .5).translate(-.5, 1.5, 1.41), dm, lin('#ff9a3c', 1.7), .15, 2);
    const stack = new V(.8, 5.95, -.6).applyMatrix4(dm); this.puffs.push({x: stack.x, y: stack.y, z: stack.z, s: .7}); this.sparks.push({x: stack.x, y: stack.y, z: stack.z, s: .3, n: 6});
    const lp = new V(0, 1.6, 2.2).applyMatrix4(dm); this.light(lp.x, lp.y, lp.z, 6, '#ff9a4a', 1.2);
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
    const c = FORGE_CRANE, b = FORGE_BARGE, y = this.deck(c.x, c.z), m = trs(c.x, y, c.z, Math.atan2(b.x - c.x, b.z - 6 - c.z));
    this.S(frustum(2.8, 2.8, 2.2, 2.2, 1.0), m, '#4f4b4e', PAT.ashlar, .8, .9, 0, y, 50);
    this.S(cyl(.7, .7, .3, 14).translate(0, 1.15, 0), m, '#2c2a2e', PAT.plate, 0, .45, .8, y);
    // Lattice mast and jib (iron), counterweight of stone, a winch drum, a hanging crate of ingots.
    const bar = (a: THREE.Vector3, b: THREE.Vector3, t = .1) => { const d = b.clone().sub(a), len = d.length(); const g = box(t, len, t); const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()); this.S(g, m.clone().multiply(new THREE.Matrix4().compose(a.clone().lerp(b, .5), q, new V(1, 1, 1))), '#2b292d', PAT.plain, 1, .45, .85, y); };
    const mast = 7.5;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bar(new V(sx * .45, 1.3, sz * .45), new V(sx * .3, mast, sz * .3), .14);
    for (let k = 0; k < 5; k++) { const y0 = 1.3 + k * (mast - 1.3) / 5, y1 = y0 + (mast - 1.3) / 5, r0 = .45 - .15 * k / 5, r1 = .45 - .15 * (k + 1) / 5; bar(new V(-r0, y0, r0), new V(r1, y1, r1)); bar(new V(r0, y0, -r0), new V(r1, y1, r1)); bar(new V(-r0, y0, -r0), new V(-r1, y1, r1)); }
    const reach = Math.hypot(b.x - c.x, b.z - 6 - c.z) - .5, tip = new V(0, mast + 2.2, reach), root = new V(0, mast - .3, 0);
    bar(root, tip, .2); bar(new V(0, mast + 1.4, 0), tip, .08); bar(new V(0, mast + 1.4, 0), new V(0, mast - .3, -2.6), .08); bar(new V(0, mast - .4, 0), new V(0, mast - .4, -2.6), .16);
    bar(new V(0, mast - .3, 0), new V(0, mast + 1.4, 0), .14);
    this.S(box(1.4, 1.0, 1.0), m.clone().multiply(trs(0, mast - .9, -2.6)), '#4f4b4e', PAT.ashlar, .5, .9, 0, y, 51);
    this.S(cyl(.35, .35, .9, 12).rotateZ(Math.PI / 2).translate(0, 1.9, .7), m, '#3a383c', PAT.plain, 1, .45, .85, y);
    bar(tip, new V(0, mast - 3.2, reach), .03);
    this.crate(m.clone().multiply(trs(0, mast - 4.0, reach, .3)), -99, 900, 1.0, .8);
    this.S(new THREE.TorusGeometry(.18, .04, 4, 8), m.clone().multiply(trs(0, mast - 3.1, reach)), '#2b292d', PAT.plain, 1, .45, .85, y);
  }

  /* -- fumarole fields (emberGroundLayout.ts EMBER_VENTS; the vent cones themselves are emberRocks.ts) -- */
  /** A miner's pick: ash handle, iron head with a point and a chisel end; local origin at the head. */
  private pick(m: THREE.Matrix4, base: number) {
    this.S(cyl(.032, .038, 1.05, 6).translate(0, -.5, 0), m, '#5a4434', PAT.plank, .5, .85, 0, base);
    this.S(new THREE.ConeGeometry(.05, .4, 6).rotateZ(-Math.PI / 2).translate(.2, 0, 0), m, '#38373b', PAT.plain, 1, .35, .85, base);
    this.S(box(.32, .08, .06).translate(-.16, 0, 0), m, '#38373b', PAT.plain, 1, .35, .85, base);
    this.S(box(.1, .12, .1), m, '#2a292d', PAT.plain, 1, .4, .85, base);
  }
  private vents() {
    for (const [g, v] of EMBER_VENTS.entries()) {
      if (!this.clearOfLava(v.x, v.z, 6)) continue;
      // Each vent: a white-hot throat with flame licks over the rim, lit steam rising and leaning downwind, sparks.
      for (const [k, [x, z, r, hh]] of v.vents.entries()) {
        const y = this.h(x, z), ph = g * 3.7 + k * 1.9;
        this.G(new THREE.CircleGeometry(r * .3, 10).rotateX(-Math.PI / 2), trs(x, y + hh * .74, z), lin('#ffc46a', 3.2), .45, ph);
        this.flames.push({x, y: y + hh * .82, z, s: .45 + r * .35});
        this.puffs.push({x, y: y + hh + .1, z, s: .32 + r * .26});
        this.sparks.push({x, y: y + hh, z, s: .2 + r * .1, n: 6});
        this.pool(x, z, 1.6 + r * 1.6, '#ff6a24', .55, ph);
      }
      this.pool(v.x, v.z, 6.5, '#ff7a30', .32, g * 2.3);
      this.light(v.x, this.h(v.x, v.z) + 1.6, v.z, 9, '#ff7a30', 2.2);
      // The miners' traces: an ore cart drawn up to the heap, picks driven into it, a crate of sulfur.
      const [cx, cz, cyaw] = v.cart, [hx, hz, hr] = v.heap;
      this.cart(cx, cz, cyaw, 'ore', 500 + g * 17);
      this.heap(hx, hz, hr, 26, '#5a4a3a', 520 + g * 29, .04);
      this.heap(hx + .4, hz - .3, hr * .55, 9, '#9a8540', 560 + g * 13);
      const hy = this.h(hx, hz);
      this.pick(trs(hx - .3, hy + hr * .7 + .45, hz + .2, .6 + g, .45, .25), hy);
      this.pick(trs(hx + hr * .7, hy + .62, hz - .5, 2.1 + g, -.6, .1), hy);
      { const a = Math.atan2(cx - hx, cz - hz) + Math.PI / 2, x = hx + Math.sin(a) * (hr + .9), z = hz + Math.cos(a) * (hr + .9), y = this.h(x, z);
        this.crate(trs(x, y - .04, z, a + .3, .04, -.03), y, 580 + g); this.barrel(trs(x + Math.sin(a) * 1.1, y - .03, z + Math.cos(a) * 1.1, a), y, 590 + g); }
    }
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
