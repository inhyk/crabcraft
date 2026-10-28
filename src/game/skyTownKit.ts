import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {addPatch} from '../world/materials';
import {lathe, tube} from '../world/geom';

/*
 * Skybloom town kit (World VI): the shared materials and the merge buckets the houses, market, street and harbour
 * draw with. Every part goes into one Bucket per material and the bucket becomes one Mesh, so the whole town costs a
 * handful of draw calls. Per vertex: colour, aSu (metres along / across the part, or atlas uv for cloth) and
 * aSk = (ground height under the vertex, finish kind, seed). The shaders add the finish (ashlar coursing, plaster,
 * wood grain and boards, glazed barrel tiles, sail-cloth atlas with wind) and a contact shade from aSk.x, so walls,
 * posts and props darken where they meet the ground without any extra pass.
 */

export type Height = (x: number, z: number) => number;
const V = THREE.Vector3;
const _p = new V(), _q = new THREE.Quaternion(), _s = new V(), _e = new THREE.Euler();
/** Matrix from position, yaw / pitch / roll (YXZ) and uniform or xyz scale. */
export const M = (x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, s: number | [number, number, number] = 1) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ')), typeof s === 'number' ? _s.setScalar(s) : _s.set(s[0], s[1], s[2]));

/** Finish kinds per material (aSk.y). Cloth uses aSk.y as its wind weight instead. */
export const STONE = {dressed: 0, ashlar: 1, plaster: 2, rubble: 3, ceramic: 4} as const;
export const WOOD = {beam: 0, planks: 1, painted: 2} as const;
export const ROOF = {tiles: 0, cap: 1} as const;

export class Bucket {
  private parts: THREE.BufferGeometry[] = [];
  tris = 0;
  constructor(private h: Height) {}
  /** Adds a copy of `src` placed by `m`, tinted `color` (or per-vertex `tint`), with finish `kind` and `seed`. */
  add(src: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: THREE.ColorRepresentation, kind = 0, seed = 0, tint?: (p: THREE.Vector3, i: number) => number) {
    const g = src.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    const pos = g.getAttribute('position') as THREE.BufferAttribute, n = pos.count;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(pos.array as ArrayLike<number>).slice(0, n * 3), 3));
    const nor = g.getAttribute('normal') as THREE.BufferAttribute, na = Float32Array.from(nor.array as ArrayLike<number>).slice(0, n * 3);
    // Apex vertices that only touch degenerate triangles get no normal; give them up so no shader normalises zero.
    for (let i = 0; i < n; i++) if (Math.abs(na[i * 3]) + Math.abs(na[i * 3 + 1]) + Math.abs(na[i * 3 + 2]) < 1e-6) na[i * 3 + 1] = 1;
    out.setAttribute('normal', new THREE.Float32BufferAttribute(na, 3));
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined, su = new Float32Array(n * 2);
    if (uv) for (let i = 0; i < n; i++) { su[i * 2] = uv.getX(i); su[i * 2 + 1] = uv.getY(i); }
    out.setAttribute('aSu', new THREE.Float32BufferAttribute(su, 2));
    const c = new THREE.Color(color), col = new Float32Array(n * 3), sk = new Float32Array(n * 3), v = new V();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      const k = tint ? tint(v, i) : 1;
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
      sk[i * 3] = this.h(v.x, v.z); sk[i * 3 + 1] = kind; sk[i * 3 + 2] = seed;
    }
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setAttribute('aSk', new THREE.Float32BufferAttribute(sk, 3));
    if (g.index) out.setIndex(Array.from(g.index.array as ArrayLike<number>));
    else out.setIndex(Array.from({length: n}, (_, i) => i));
    this.tris += out.index!.count / 3;
    this.parts.push(out);
    g.dispose();
  }
  get count() { return this.parts.length; }
  mesh(mat: THREE.Material, name: string, shadow = true): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  }
}

// ---- Geometry ----------------------------------------------------------------------------------------------------

/** Box centred on the origin with uvs in metres on every face. */
export function bx(w: number, h: number, d: number, segs: [number, number, number] = [1, 1, 1]) {
  const g = new THREE.BoxGeometry(w, h, d, ...segs);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    uv.setXY(i, uv.getX(i) * (ax > .5 ? d : w), uv.getY(i) * (ay > .5 ? d : h));
  }
  return g;
}
const X = new V(1, 0, 0);
/** A squared timber from a to b (w wide, h deep), uv.x along the grain on all four sides. */
export function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h = w, roll = 0) {
  const d = b.clone().sub(a), l = d.length(), g = bx(l, h, w);
  const q = new THREE.Quaternion().setFromUnitVectors(X, d.normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(X, roll));
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().lerp(b, .5), q, new V(1, 1, 1)));
}
/** Lathe about +y from [radius, height] pairs (uv.x around in metres, uv.y along the profile). */
export const lath = (profile: [number, number][], seg = 12) => lathe(profile, seg);
/** Tube along points with uv.x along the length in metres (wood grain, rope lay). */
export function rod(path: THREE.Vector3[], r: number | ((t: number) => number), radial = 6) {
  const g = tube(path, typeof r === 'number' ? () => r : r, radial);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u * .4); }
  return g;
}
/** A rope hanging between a and b with sag (metres at the middle). */
export function sagPoints(a: THREE.Vector3, b: THREE.Vector3, sag: number, n = 10) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(a.clone().lerp(b, t).add(new V(0, -sag * 4 * t * (1 - t), 0))); }
  return out;
}
/** Round-headed arch outline w wide and h tall (springing at h - w/2) as a Shape, origin at the base centre. */
export function archShape(w: number, h: number, seg = 10) {
  const s = new THREE.Shape(), r = w / 2, sp = h - r;
  s.moveTo(-r, 0); s.lineTo(-r, sp);
  for (let i = 1; i <= seg; i++) { const a = Math.PI - i / seg * Math.PI; s.lineTo(Math.cos(a) * r, sp + Math.sin(a) * r); }
  s.lineTo(r, 0); s.lineTo(-r, 0);
  return s;
}
/** Arched frame (outer arch minus inner arch), extruded `depth` toward +z from z = 0, uvs in metres. */
export function archFrame(w: number, h: number, band: number, depth: number) {
  const s = archShape(w + band * 2, h + band), hole = archShape(w, h);
  s.holes.push(new THREE.Path(hole.getPoints().reverse()));
  return new THREE.ExtrudeGeometry(s, {depth, bevelEnabled: false, curveSegments: 10});
}
export function archPanel(w: number, h: number, depth: number) {
  return new THREE.ExtrudeGeometry(archShape(w, h), {depth, bevelEnabled: false, curveSegments: 10});
}
/** Ring (round window frame) in the xy plane. */
export const ring = (r: number, t: number, seg = 16) => new THREE.TorusGeometry(r, t, 4, seg);
/** Flat disc in the xy plane facing +z. */
export const disc = (r: number, seg = 20) => new THREE.CircleGeometry(r, seg);

/**
 * Hip roof with a concave sweep and lifted corners, eaves at y = 0, ridge along local x. a / b: half extents at the
 * eaves (a >= b), rise: ridge height, lift: corner upsweep. Returns the glazed top (uv: metres across the slope,
 * metres up from the eave), the timber soffit under it, the fascia band and the hip / ridge lines for caps.
 */
export function hipRoof(a: number, b: number, rise: number, lift: number, opts: {ns?: number; nt?: number; soffit?: number; fascia?: number} = {}) {
  const ns = opts.ns ?? 18, nt = opts.nt ?? 10, so = opts.soffit ?? .16, fa = opts.fascia ?? .2;
  const r = Math.max(0, a - b);
  const prof = (t: number) => rise * Math.pow(t, 1.45);
  const tops: THREE.BufferGeometry[] = [], unders: THREE.BufferGeometry[] = [], bands: THREE.BufferGeometry[] = [];
  // Faces: front (+z), back (-z) trapezoids; ends (+x, -x) triangles. Each maps (s, t) to a point.
  const faces: {E0: THREE.Vector3; E1: THREE.Vector3; R0: THREE.Vector3; R1: THREE.Vector3; across: 'x' | 'z'}[] = [
    {E0: new V(-a, 0, b), E1: new V(a, 0, b), R0: new V(-r, 0, 0), R1: new V(r, 0, 0), across: 'x'},
    {E0: new V(a, 0, -b), E1: new V(-a, 0, -b), R0: new V(r, 0, 0), R1: new V(-r, 0, 0), across: 'x'},
    {E0: new V(a, 0, b), E1: new V(a, 0, -b), R0: new V(r, 0, 0), R1: new V(r, 0, 0), across: 'z'},
    {E0: new V(-a, 0, -b), E1: new V(-a, 0, b), R0: new V(-r, 0, 0), R1: new V(-r, 0, 0), across: 'z'},
  ];
  const point = (f: typeof faces[number], s: number, t: number, out: THREE.Vector3) => {
    const e = new V().lerpVectors(f.E0, f.E1, s), rr = new V().lerpVectors(f.R0, f.R1, s);
    out.lerpVectors(e, rr, t);
    const c = Math.pow(Math.abs(s * 2 - 1), 3);
    out.y = prof(t) + lift * c * Math.pow(1 - t, 2.2);
    return out;
  };
  for (const f of faces) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], under: number[] = [];
    const slant = Math.hypot(b, rise) * 1.05, p = new V();
    for (let j = 0; j <= nt; j++) for (let i = 0; i <= ns; i++) {
      const s = i / ns, t = j / nt;
      point(f, s, t, p);
      pos.push(p.x, p.y, p.z); under.push(p.x, p.y - so, p.z);
      uv.push(f.across === 'x' ? p.x : p.z, t * slant);
    }
    for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
      const k = j * (ns + 1) + i;
      idx.push(k, k + 1, k + ns + 1, k + 1, k + ns + 2, k + ns + 1);
    }
    const top = new THREE.BufferGeometry();
    top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); top.setIndex(idx);
    top.computeVertexNormals();
    // Make sure the top faces up (winding differs between faces).
    const nn = top.getAttribute('normal') as THREE.BufferAttribute;
    if (nn.getY(Math.floor(nn.count / 2)) < 0) { for (let i = 0; i < idx.length; i += 3) { const t0 = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t0; } top.setIndex(idx); top.computeVertexNormals(); }
    tops.push(top);
    const un = new THREE.BufferGeometry();
    un.setAttribute('position', new THREE.Float32BufferAttribute(under, 3)); un.setAttribute('uv', new THREE.Float32BufferAttribute(uv.map((x, i) => i % 2 ? x * .3 : x), 2));
    const ri = idx.slice(); for (let i = 0; i < ri.length; i += 3) { const t0 = ri[i]; ri[i] = ri[i + 1]; ri[i + 1] = t0; }
    un.setIndex(ri); un.computeVertexNormals(); unders.push(un);
    // Fascia: a band from the top eave line down to the soffit eave line and a little below.
    const fp: number[] = [], fu: number[] = [], fi: number[] = [];
    for (let i = 0; i <= ns; i++) {
      point(f, i / ns, 0, p);
      fp.push(p.x, p.y + .02, p.z, p.x, p.y - so - fa, p.z);
      const u = (f.across === 'x' ? p.x : p.z); fu.push(u, 0, u, fa + so);
      if (i < ns) { const k = i * 2; fi.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const band = new THREE.BufferGeometry();
    band.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); band.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); band.setIndex(fi);
    band.computeVertexNormals();
    // Face outward: the band's normal should point away from the roof centre.
    const bn = band.getAttribute('normal') as THREE.BufferAttribute, mid = Math.floor(ns / 2) * 2;
    const bp = new V().fromBufferAttribute(band.getAttribute('position') as THREE.BufferAttribute, mid);
    if (bn.getX(mid) * bp.x + bn.getZ(mid) * bp.z < 0) { for (let i = 0; i < fi.length; i += 3) { const t0 = fi[i]; fi[i] = fi[i + 1]; fi[i + 1] = t0; } band.setIndex(fi); band.computeVertexNormals(); }
    bands.push(band);
  }
  // Cap lines: four hips from the eave corners to the ridge ends, and the ridge.
  const hips: THREE.Vector3[][] = [];
  for (const f of faces.slice(0, 2)) for (const s of [0, 1]) { const line: THREE.Vector3[] = []; for (let j = 0; j <= nt; j++) line.push(point(f, s, j / nt, new V())); hips.push(line); }
  const ridge = r > 0 ? [new V(-r, rise, 0), new V(r, rise, 0)] : [];
  return {top: mergeGeometries(tops)!, soffit: mergeGeometries(unders)!, fascia: mergeGeometries(bands)!, hips, ridge, corners: hips.map(l => l[0])};
}

// ---- Materials ---------------------------------------------------------------------------------------------------

const NOISE = /* glsl */ `
float skH(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float skN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(skH(i),skH(i+vec2(1.,0.)),f.x),mix(skH(i+vec2(0.,1.)),skH(i+1.),f.x),f.y);}
float skF(vec2 p){return skN(p)*.55+skN(p*2.3+7.1)*.3+skN(p*5.1+3.3)*.15;}
`;
type Code = {head?: string; vHead?: string; color?: string; rough?: string; normal?: string; vBegin?: string; emissive?: string; lights?: string; ao?: [number, number]};
function patch(mat: THREE.Material, key: string, o: Code, uniforms: Record<string, THREE.IUniform> = {}) {
  addPatch(mat, key, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSk;\nattribute vec2 aSu;\nvarying vec3 vSk;\nvarying vec2 vSu;\nvarying vec3 vSw;\nvarying vec3 vSn;\n' + (o.vHead ?? ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (o.vBegin ?? ''))
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSk=aSk;vSu=aSu;vSw=(modelMatrix*vec4(transformed,1.)).xyz;vSn=normalize(mat3(modelMatrix)*objectNormal);');
    let f = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSk;\nvarying vec2 vSu;\nvarying vec3 vSw;\nvarying vec3 vSn;\n' + NOISE + (o.head ?? ''))
      .replace('#include <color_fragment>', `#include <color_fragment>\n{float skAo=mix(${(o.ao?.[0] ?? .5).toFixed(2)},1.,smoothstep(0.,${(o.ao?.[1] ?? 1.15).toFixed(2)},vSw.y-vSk.x));diffuseColor.rgb*=skAo;}\n` + (o.color ?? ''));
    if (o.rough) f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + o.rough);
    if (o.normal) f = f.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + o.normal);
    if (o.emissive) f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + o.emissive);
    if (o.lights) f = f.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + o.lights);
    shader.fragmentShader = f;
  });
}

/** Bump the view normal by the screen derivatives of a height h (metres); fades out with distance. */
const BUMP = (h: string, k: string, far = 40) => `{
  float bh=${h};vec2 dh=vec2(dFdx(bh),dFdy(bh))*(${k})*(1.-smoothstep(${(far * .4).toFixed(1)},${far.toFixed(1)},length(vViewPosition)));
  vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),r1=cross(sy,normal),r2=cross(normal,sx);float det=dot(sx,r1);
  vec3 gr=sign(det)*(dh.x*r1+dh.y*r2),nn=abs(det)*normal-gr;if(dot(nn,nn)>1e-24)normal=normalize(nn);
}`;

export interface SkyMaterials {
  stone: THREE.MeshStandardMaterial; timber: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial; cloth: THREE.MeshStandardMaterial;
  time: {value: number};
}

let shared: SkyMaterials | null = null;
export function skyMaterials(): SkyMaterials {
  if (shared) return shared;
  const time = {value: 0};
  // Cream limestone: ashlar coursing on walls (planar in world space), plaster, rubble plinths, glazed ceramic.
  const stone = new THREE.MeshStandardMaterial({name: 'sky-stone', color: '#ffffff', roughness: .9, vertexColors: true});
  const plane = /* glsl */ `
  vec2 skPlane(vec3 p,vec3 n){return abs(n.y)>.7?p.xz:vec2(abs(n.x)>abs(n.z)?p.z:p.x,p.y);}
  // Coursed blocks: id and the distance (m) to the nearest joint. Row height rh, mean length bl.
  vec3 skBond(vec2 q,float rh,float bl){float row=floor(q.y/rh);float l=bl*(.75+.5*skH(vec2(row,3.1)));float x=q.x/l+skH(vec2(row,9.7))*3.;
   vec2 f=vec2(fract(x),fract(q.y/rh));vec2 d=min(f,1.-f)*vec2(l,rh);return vec3(floor(x),row,min(d.x,d.y));}
  float skStoneH(vec3 p){vec3 n=normalize(vSn);float k=floor(vSk.y+.5);if(k!=1.&&k!=3.)return skN(p.xz*6.+p.y*4.)*.004;
   vec2 q=skPlane(p,n);vec3 b=k==3.?skBond(q+vec2(0.,.11),.42,.75):skBond(q,.5,1.05);
   float j=smoothstep(.006,.04,b.z);return j*.02+skN(q*7.)*.006*j;}`;
  patch(stone, 'sky-stone-v1', {
    // Cream walls keep their value: a short soft contact shade at the foot, not the half-dark band timber gets.
    ao: [.74, .7],
    head: plane,
    color: /* glsl */ `{
      vec3 n=normalize(vSn);float k=floor(vSk.y+.5);vec2 q=skPlane(vSw,n);float g=skF(q*1.7+vSk.z);
      vec3 c=diffuseColor.rgb;
      if(k==1.||k==3.){vec3 b=k==3.?skBond(q+vec2(0.,.11),.42,.75):skBond(q,.5,1.05);float id=skH(b.xy+vSk.z*7.);
        c*=.93+.14*id+.06*(g-.5);c=mix(c,c*vec3(.94,.96,.92),step(.8,skH(b.xy+2.3)));
        float jt=1.-smoothstep(.008,.03,b.z);c=mix(c,c*vec3(.7,.68,.66),jt*.8);
        c*=1.-(1.-smoothstep(.03,.09,b.z))*.08;}
      else if(k==2.){c*=.95+.09*(g-.5)+.04*skN(q*13.);}
      else if(k==4.){c*=.94+.1*skN(q*9.);}
      else c*=.93+.12*(g-.5)+.05*skN(q*11.);
      // Weathering: moss and damp at the foot, faint sky-lit rain streaks down vertical faces.
      float foot=1.-smoothstep(.0,.6+g*.4,vSw.y-vSk.x);c=mix(c,c*vec3(.76,.84,.7),foot*.4*(1.-abs(n.y)));
      float streak=skN(vec2(q.x*3.1,vSw.y*.15))*(1.-abs(n.y));c*=1.-streak*.04;
      diffuseColor.rgb=c;}`,
    rough: `{float k=floor(vSk.y+.5);if(k==4.)roughnessFactor=.32;}`,
    normal: BUMP('skStoneH(vSw)', '1.', 30),
  });
  // Timber: honey wood grain along uv.x, boards across uv.y, painted boards (doors, shutters) with worn edges.
  const timber = new THREE.MeshStandardMaterial({name: 'sky-timber', color: '#ffffff', roughness: .82, vertexColors: true});
  patch(timber, 'sky-timber-v1', {
    head: /* glsl */ `
    vec3 skBoard(vec2 u){float w=.19;float b=floor(u.y/w);float x=u.x+skH(vec2(b,1.7))*5.;float seg=floor(x/2.6);
      vec2 f=vec2(fract(x/2.6)*2.6,fract(u.y/w)*w);float d=min(min(f.x,2.6-f.x),min(f.y,w-f.y));return vec3(b,seg,d);}`,
    color: /* glsl */ `{
      float k=floor(vSk.y+.5);vec2 u=vSu;vec3 c=diffuseColor.rgb;
      float grain=skN(vec2(u.x*.9,u.y*38.+vSk.z*13.))*.6+skN(vec2(u.x*3.,u.y*90.))*.4;
      if(k>=1.){vec3 b=skBoard(u);float id=skH(b.xy+vSk.z);c*=.84+.24*id;float seam=1.-smoothstep(.004,.018,b.z);c=mix(c,c*.45,seam);
        if(k==2.){c=mix(c,c*vec3(1.08,1.05,1.),smoothstep(.75,1.,skN(u*vec2(2.,9.)))*.6);grain*=.35;}}
      c*=.82+.3*grain;
      float knot=smoothstep(.93,.99,skN(u*vec2(1.3,7.)+vSk.z));c*=1.-knot*.35;
      diffuseColor.rgb=c;}`,
    normal: BUMP('(floor(vSk.y+.5)>=1.?smoothstep(.004,.02,skBoard(vSu).z)*.012:0.)+skN(vec2(vSu.x*.9,vSu.y*38.))*.004', '1.', 22),
  });
  // Deep teal glazed barrel tiles: courses up the slope (uv.y), rolls across it (uv.x); glossy, darker in the pans.
  const roof = new THREE.MeshStandardMaterial({name: 'sky-roof', color: '#ffffff', roughness: .42, metalness: .05, vertexColors: true});
  patch(roof, 'sky-roof-v1', {
    head: /* glsl */ `
    float skTileH(vec2 u){float x=fract(u.x/.3),y=fract(u.y/.27);float roll=sin(3.14159*x);return roll*.045+y*.022-(1.-smoothstep(0.,.08,y))*.018;}`,
    color: /* glsl */ `{
      float k=floor(vSk.y+.5);vec3 c=diffuseColor.rgb;
      if(k==0.){vec2 u=vSu;float x=fract(u.x/.3),y=fract(u.y/.27);vec2 id=floor(vec2(u.x/.3,u.y/.27));
        float roll=sin(3.14159*x);float h=skH(id+vSk.z*3.);
        // SKY_VIEW's dark contrast (pivot .55, darks 1.7) crushes anything under ~0.3 display toward black, so the glaze
        // carries a lifted teal and shallow pans: lit roofs land at grey 55-80 on screen, a step under the grass.
        c*=(.82+.22*h)*1.18;c=mix(c,c*vec3(.86,1.06,1.04),step(.86,skH(id+5.)));
        c*=mix(.7,1.,pow(roll,.6));c*=mix(.8,1.,smoothstep(0.,.14,y));
        c=mix(c,c*vec3(1.1,1.04,.92),smoothstep(.55,1.,skF(u*.35+vSk.z))*.3);
      }else{c*=.92+.12*skN(vSu*vec2(3.,1.));}
      diffuseColor.rgb=c;}`,
    rough: `{float k=floor(vSk.y+.5);if(k==0.){float x=fract(vSu.x/.3);roughnessFactor=mix(.74,.46,pow(sin(3.14159*x),.5))+skN(vSu*2.)*.08;}}`,
    normal: BUMP('(floor(vSk.y+.5)==0.?skTileH(vSu):0.)', '1.', 45),
    // The sky and the white cloud sea mirrored in the glaze would lift the roofs to the grass's value: keep a third.
    lights: 'reflectedLight.indirectSpecular*=.35;reflectedLight.indirectDiffuse*=2.7;',
  });
  // Gilt brass trim, finials, lantern cages.
  const metal = new THREE.MeshStandardMaterial({name: 'sky-brass', color: '#ffffff', roughness: .38, metalness: .55, vertexColors: true});
  patch(metal, 'sky-brass-v1', {color: `{diffuseColor.rgb*=.9+.18*skN(vSw.xz*4.+vSw.y*3.);}`});
  // Lamp glass and windows: unlit, colours above 1 bloom.
  const glow = new THREE.MeshBasicMaterial({name: 'sky-glow', color: '#ffffff', vertexColors: true});
  // Sail cloth: a painted atlas (aSu) and wind from aSk.y (0 rigid, 1 a free banner tail).
  const atlas = clothAtlas();
  const cloth = new THREE.MeshStandardMaterial({name: 'sky-cloth', color: '#ffffff', roughness: .92, vertexColors: true, side: THREE.DoubleSide});
  patch(cloth, 'sky-cloth-v1', {
    head: 'uniform float skTime;\nuniform sampler2D skAtlas;\n',
    vHead: 'uniform float skTime;\n',
    vBegin: `{float w=aSk.y;float ph=skTime*2.3+aSk.z*6.2831+aSu.x*9.+aSu.y*5.;transformed+=objectNormal*(sin(ph)*.11+sin(ph*2.1+1.3)*.035)*w;}`,
    color: /* glsl */ `{vec4 t=texture2D(skAtlas,vSu);vec3 c=diffuseColor.rgb*t.rgb;
      float ph=skTime*2.3+vSk.z*6.2831+vSu.x*9.+vSu.y*5.;c*=1.-vSk.y*.16*(.5+.5*cos(ph));
      c*=.95+.08*skN(vSu*vec2(260.,260.));diffuseColor.rgb=c;}`,
  }, {skTime: time, skAtlas: {value: atlas}});
  shared = {stone, timber, roof, metal, glow, cloth, time};
  return shared;
}

/** Atlas quadrants (u0, v0, u1, v1) for cloth uvs. */
export const CLOTH = {
  sail: [0, .5, .5, 1] as const, // cream with teal pinstripes
  banner: [.5, .5, 1, 1] as const, // teal field, gold border and world-tree emblem
  awning: [0, 0, .5, .5] as const, // broad teal and cream stripes with a gold thread
  kite: [.5, 0, 1, .5] as const, // four petal colours
};
/** Map local (s, t) in 0..1 into an atlas quadrant. */
export const atlasUv = (q: readonly [number, number, number, number], s: number, t: number): [number, number] => [q[0] + (q[2] - q[0]) * (.02 + .96 * s), q[1] + (q[3] - q[1]) * (.02 + .96 * t)];

function clothAtlas() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  // Canvas y grows down; texture v grows up (flipY): v in [.5, 1] is the canvas top half.
  const weave = (x0: number, y0: number, w: number, h: number) => { for (let i = 0; i < 2600; i++) { const x = x0 + (i * 73.37) % w, y = y0 + (i * 137.91) % h; g.fillStyle = i % 2 ? 'rgba(80,70,50,.05)' : 'rgba(255,255,255,.07)'; g.fillRect(x, y, 2, 1); } };
  // Sail: cream with paired teal pinstripes.
  g.fillStyle = '#eee7d6'; g.fillRect(0, 0, 256, 256);
  for (let x = 20; x < 256; x += 64) { g.fillStyle = '#2f8f8a'; g.fillRect(x, 0, 7, 256); g.fillRect(x + 12, 0, 3, 256); }
  weave(0, 0, 256, 256);
  // Banner: teal field, cream stripe, gold border and a world-tree emblem.
  g.fillStyle = '#23767a'; g.fillRect(256, 0, 256, 256);
  g.strokeStyle = '#d4a64a'; g.lineWidth = 9; g.strokeRect(266, 10, 236, 236);
  g.fillStyle = '#e9dfc8'; g.fillRect(256, 30, 256, 12);
  g.fillStyle = '#d9ae52'; g.beginPath(); g.arc(384, 120, 52, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#23767a'; g.beginPath(); g.arc(384, 120, 43, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8c46a';
  g.beginPath(); g.ellipse(384, 104, 30, 20, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(380, 108, 8, 34);
  g.beginPath(); g.moveTo(384, 140); g.quadraticCurveTo(366, 148, 356, 160); g.lineTo(362, 160); g.quadraticCurveTo(372, 150, 384, 147); g.quadraticCurveTo(396, 150, 406, 160); g.lineTo(412, 160); g.quadraticCurveTo(402, 148, 384, 140); g.fill();
  g.fillStyle = '#f2b8c6'; for (const [x, y] of [[368, 98], [396, 96], [386, 88], [374, 112], [400, 110]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#d4a64a'; for (let x = 280; x < 500; x += 22) { g.beginPath(); g.moveTo(x, 205); g.lineTo(x + 11, 222); g.lineTo(x + 22, 205); g.fill(); }
  weave(256, 0, 256, 256);
  // Awning: broad teal / cream stripes with a gold thread between.
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#eee7d6' : '#2a8580'; g.fillRect(i * 32, 256, 32, 256); g.fillStyle = '#d4a64a'; g.fillRect(i * 32 + 30, 256, 3, 256); }
  weave(0, 256, 256, 256);
  // Kite: four quarters in the meadow colours with a cream cross.
  const kc = ['#f2b8c6', '#b8a6e8', '#f3dc8a', '#3fb7b0'];
  for (let i = 0; i < 4; i++) { g.fillStyle = kc[i]; g.fillRect(256 + (i % 2) * 128, 256 + (i >> 1) * 128, 128, 128); }
  g.fillStyle = '#f7f3ea'; g.fillRect(380, 256, 8, 256); g.fillRect(256, 380, 256, 8);
  weave(256, 256, 256, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return t;
}

// ---- Build context -----------------------------------------------------------------------------------------------

/** A kit piece to place once the GLB loads: `size` is its target height in metres, the base sits on y. */
export interface KitPlace {file: 'props' | 'nature' | 'village'; piece: string; x: number; y: number; z: number; yaw: number; size: number; pitch?: number; roll?: number; hang?: boolean}
export interface TownCtx {
  h: Height;
  stone: Bucket; timber: Bucket; roof: Bucket; metal: Bucket; glow: Bucket; cloth: Bucket;
  kits: KitPlace[];
  stats: Record<string, number>;
  low: boolean;
}
export function townCtx(h: Height, low: boolean): TownCtx {
  return {h, stone: new Bucket(h), timber: new Bucket(h), roof: new Bucket(h), metal: new Bucket(h), glow: new Bucket(h), cloth: new Bucket(h), kits: [], stats: {}, low};
}
/** Frame helper: parts placed in a local frame (origin, yaw) go to world space through F. */
export class Frame {
  readonly F: THREE.Matrix4;
  constructor(readonly x: number, readonly y: number, readonly z: number, readonly yaw: number) { this.F = M(x, y, z, yaw); }
  m(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, s: number | [number, number, number] = 1) { return this.F.clone().multiply(M(x, y, z, yaw, pitch, roll, s)); }
  p(x: number, y: number, z: number) { return new V(x, y, z).applyMatrix4(this.F); }
  /** World yaw of a local yaw. */
  yw(yaw: number) { return this.yaw + yaw; }
}
/** Cloth grid w x h (local x right, y down from the top edge at y = 0), atlas quadrant q, wind weight by row. */
export function clothSheet(w: number, h: number, q: readonly [number, number, number, number], opts: {nx?: number; ny?: number; sag?: number; tail?: number; billow?: number} = {}) {
  const nx = opts.nx ?? 6, ny = opts.ny ?? 10, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const s = i / nx, t = j / ny;
    let y = -t * h;
    // Swallow tail: the middle of the bottom edge cut up by `tail`.
    if (opts.tail && j === ny) y += opts.tail * (1 - Math.abs(s * 2 - 1));
    const z = (opts.billow ?? 0) * Math.sin(s * Math.PI) * Math.sin(t * Math.PI * .9) + (opts.sag ?? 0) * Math.sin(s * Math.PI) * t;
    pos.push((s - .5) * w, y, z);
    uv.push(...atlasUv(q, s, 1 - t));
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * (nx + 1) + i; idx.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
