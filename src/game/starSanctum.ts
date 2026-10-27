import * as THREE from 'three';
import {throneSolids} from './starThrone';
import {moonstoneMaterial,silverMaterial,StoneBuilder,type Course} from './starMasonry';
import {starCrystalCluster,starCrystalMaterial} from './starCrystals';

/*
 * The Eclipse Queen's sanctum, a ruined observatory of moonstone: the combat floor is one disc whose shader carves
 * a star map into the paving (coursed slabs, sunk joints, worn where feet go) with silver inlay (an eclipse at the
 * centre, rays, a band of constellations and the twelve phases of the moon); twelve obelisks on the old column
 * footprints carry crystal crowns in silver cradles; the pilgrims' gate on the approach (the sanctuary's piers at
 * (+-4.8,-55)) is a carved arch whose trumeau is the southern obelisk. Every solid keeps its old collider.
 */

const CENTER = new THREE.Vector2(0, -75);
/** The paving's top, where the old disc's was (the walkable ground beneath is unchanged). */
const FLOOR_Y = 3.08;
const FLOOR_R = 17;
/** Heights by footprint (0 = the south one in the gate, 6 = the north one behind the queen). */
const OBELISK_H = [9.37, 9.6, 7.2, 8.6, 7.2, 8.6, 11.2, 8.6, 7.2, 8.6, 7.2, 9.6];
/** The pilgrims' gate: piers (sanctuary pillars) and the elliptical arch between them. */
export const GATE = {x: 4.8, z: -55, spring: 5.7, rise: 3.4, ring: .82, depth: 1.3, zArch: -54.6};

function obeliskCourses(H: number, crown: boolean): Course[] {
  const c: Course[] = [
    {y: -.45, hw: 1.12, ch: .32}, {y: .42, hw: 1.12, ch: .32},
    {y: .42, hw: 1.0, ch: .28}, {y: .78, hw: .97, ch: .27},
    {y: .78, hw: .86, ch: .22}, {y: 1.95, hw: .84, ch: .22},
    {y: 1.95, hw: .93, ch: .25}, {y: 2.17, hw: .93, ch: .25},
    {y: 2.17, hw: .72, ch: .16}, {y: H - 1.15, hw: .53, ch: .12},
    {y: H - 1.15, hw: .64, ch: .16}, {y: H - .93, hw: .66, ch: .17},
  ];
  if (crown) c.push({y: H - .93, hw: .5, ch: .13}, {y: H - .72, hw: .44, ch: .11});
  else c.push({y: H - .93, hw: .58, ch: .15}, {y: H - .74, hw: .56, ch: .15});
  return c;
}

/** Floor: a disc and its kerb. World-space pattern (sanctumFloorMaterial). */
function floorGeometry(): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0, FLOOR_Y), new THREE.Vector2(FLOOR_R, FLOOR_Y), new THREE.Vector2(FLOOR_R + .55, FLOOR_Y), new THREE.Vector2(FLOOR_R + .85, FLOOR_Y - .12), new THREE.Vector2(FLOOR_R + 1.15, FLOOR_Y - .55)];
  const g = new THREE.LatheGeometry(pts, 160);g.translate(CENTER.x, 0, CENTER.y);
  // The lathe winds its faces inward for a profile going outward; flip so the top faces up.
  const idx = g.index!;for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1);idx.setX(i + 1, idx.getX(i + 2));idx.setX(i + 2, a); }
  g.computeVertexNormals();g.name = 'star-sanctum-floor';
  return g;
}

const FLOOR_GLSL = /* glsl */ `
float sfH(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float sfN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(sfH(i),sfH(i+vec2(1.,0.)),f.x),mix(sfH(i+vec2(0.,1.)),sfH(i+1.),f.x),f.y);}
float sfSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
// Course edges and the number of slabs in each course.
const float SF_R[7]=float[7](2.35,5.3,8.5,11.7,14.5,17.,18.4);
const float SF_N[7]=float[7](1.,12.,20.,28.,36.,44.,60.);
// Joints (distance to the nearest joint, metres) and the slab's id.
float sfJoints(vec2 p,out vec2 slab){
  float r=length(p),a=atan(p.x,-p.y)+3.14159265;
  int k=0;for(int i=0;i<6;i++)if(r>SF_R[i])k=i+1;
  float r0=k==0?0.:SF_R[k-1],r1=SF_R[k];
  float n=SF_N[k],off=fract(float(k)*.37);
  float s=a/6.2831853*n+off,cell=floor(s);
  float dr=min(r-r0,r1-r);
  float dt=k==0?9.:min(fract(s),1.-fract(s))*6.2831853/n*r;
  slab=vec2(float(k),cell);
  return min(dr,dt);
}
// Silver inlay (distance in metres): the eclipse, its rays, the ring lines, the star map, the moon's phases.
float sfInlay(vec2 p){
  float r=length(p),a=atan(p.x,-p.y);
  float d=abs(r-2.05)-.06;
  // Corona rays: long and short, tapering.
  float n=24.,sector=floor((a+3.14159265)/6.2831853*n),ac=(sector+.5)/n*6.2831853-3.14159265;
  float len=mod(sector,2.)<.5?2.7:1.6;
  vec2 dir=vec2(sin(ac),-cos(ac));
  float along=dot(p,dir),across=abs(dot(p,vec2(-dir.y,dir.x)));
  float ray=max(across-.11*(1.-clamp((along-2.25)/len,0.,1.)),max(2.25-along,along-2.25-len));
  d=min(d,ray);
  d=min(d,abs(r-5.3)-.035);d=min(d,abs(r-5.52)-.02);
  d=min(d,abs(r-8.5)-.035);d=min(d,abs(r-11.7)-.035);
  d=min(d,abs(r-14.5)-.035);d=min(d,abs(r-14.72)-.02);d=min(d,abs(r-16.85)-.05);
  // Star map between 8.5 and 11.7: a star per sector, constellations joining some neighbours.
  float sn=30.,ss=floor((a+3.14159265)/6.2831853*sn);
  for(int j=-1;j<=1;j++){
    float c=ss+float(j),c1=c+1.;
    float ra=9.1+sfH(vec2(mod(c,sn),1.))*2.,rb=9.1+sfH(vec2(mod(c1,sn),1.))*2.;
    float aa=(c+.2+.6*sfH(vec2(mod(c,sn),2.)))/sn*6.2831853-3.14159265,ab=(c1+.2+.6*sfH(vec2(mod(c1,sn),2.)))/sn*6.2831853-3.14159265;
    vec2 A=vec2(sin(aa),-cos(aa))*ra,B=vec2(sin(ab),-cos(ab))*rb;
    d=min(d,length(p-A)-(.09+.1*sfH(vec2(mod(c,sn),5.))));
    if(sfH(vec2(mod(c,sn),3.))>.35)d=min(d,sfSeg(p,A,B)-.018);
  }
  // Stars set into the obsidian eclipse, so the dark disc reads as night, not a hole.
  if(r<1.8){vec2 gc=floor(p/.46);vec2 o=vec2(sfH(gc+9.),sfH(gc+4.))*.3+.08;if(sfH(gc+7.)>.5)d=min(d,length(p-gc*.46-o)-(.02+.035*sfH(gc+2.)));}
  // The twelve phases in the outer band.
  float pn=12.,ps=floor((a+3.14159265)/6.2831853*pn),pa=(ps+.5)/pn*6.2831853-3.14159265;
  vec2 C=vec2(sin(pa),-cos(pa))*15.6,q=p-C;
  float disc=length(q)-.62;
  float phase=(ps/pn)*2.-1.;
  vec2 tang=vec2(cos(pa),sin(pa));
  float shadow=length(q-tang*phase*1.25)-.62;
  d=min(d,abs(disc)-.03);
  d=min(d,max(disc,-shadow));
  return d;
}
`;

function sanctumFloorMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#7d819c', roughness: .78, metalness: 0});
  m.name = 'star-sanctum-floor';
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSfWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSfWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSfWorld;\n${FLOOR_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 sfP=vSfWorld.xz-vec2(${CENTER.x.toFixed(2)},${CENTER.y.toFixed(2)});
vec2 sfSlab;float sfJ=sfJoints(sfP,sfSlab);
float sfPx=max(fwidth(sfP.x),.004);
float sfGroove=1.-smoothstep(.025,.06+sfPx,sfJ);
float sfIn=sfInlay(sfP);
float sfSilver=1.-smoothstep(-sfPx,sfPx,sfIn);
float sfRim=1.-smoothstep(0.,.07+sfPx,abs(sfIn+.01));
float sfR=length(sfP);
float sfObsidian=1.-smoothstep(1.93,1.96,sfR);
{
  float tone=.82+.32*sfH(sfSlab*vec2(17.,3.)+.5);
  float mott=sfN(sfP*1.1)*.55+sfN(sfP*4.3)*.3+sfN(sfP*13.)*.15;
  // Worn where feet go: the approach from the south gate and the circle round the eclipse.
  float worn=exp(-pow(sfP.x/3.2,2.))*smoothstep(-2.,10.,sfP.y)+exp(-pow((sfR-6.8)/2.4,2.))*.5;
  float grime=smoothstep(14.,18.,sfR)*.35+sfGroove;
  vec3 stone=diffuseColor.rgb*tone*(.78+.42*mott)*(1.+.14*worn);
  stone*=1.-.55*grime;
  stone=mix(stone,stone*.55,sfRim*.6*(1.-sfSilver));
  vec3 obs=vec3(.012,.012,.022);
  diffuseColor.rgb=mix(stone,obs,sfObsidian);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.78,.8,.9),sfSilver);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // Sunk joints and the inlays' cut edges as a bump (one evaluation, screen-space slope): they catch the moon.
  float h=-.03*sfGroove-.02*(1.-smoothstep(0.,.06,abs(sfIn+.015)))*(1.-sfSilver);
  vec2 dH=vec2(dFdx(h),dFdy(h));
  vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),r1=cross(sy,normal),r2=cross(normal,sx);
  float det=dot(sx,r1);
  normal=normalize(abs(det)*normal-sign(det)*(dH.x*r1+dH.y*r2));
}`)
      .replace('#include <lights_physical_fragment>', `roughnessFactor=mix(roughnessFactor,.32,sfSilver);roughnessFactor=mix(roughnessFactor,.12,sfObsidian);roughnessFactor=mix(roughnessFactor,1.,sfGroove);metalnessFactor=mix(metalnessFactor,1.,sfSilver);
#include <lights_physical_fragment>`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance+=vec3(.05,.07,.13)*sfSilver;
// The eclipse at the centre burns: its corona's inlay gives pearly light, brightest at the limb, and a rose
// chromosphere edges the obsidian; the rings further out stay moonlit silver.
{
  float cor=sfSilver*(1.-smoothstep(2.,5.2,sfR));
  totalEmissiveRadiance+=vec3(.95,.88,.72)*cor*(.35+1.4*exp(-(sfR-2.05)*1.6));
  totalEmissiveRadiance+=vec3(1.,.32,.55)*exp(-pow((sfR-1.93)/.05,2.))*.9;
}`);
  };
  m.customProgramCacheKey = () => 'star-sanctum-floor';
  return m;
}

/** Arch voussoirs as boxes for the camera and the server (above head height, so walking is unchanged). */
export function gateArchBoxes(height: (x: number, z: number) => number) {
  const y0 = height(0, GATE.z) + GATE.spring, out: {x: number; z: number; hx: number; hz: number; y0: number; y1: number}[] = [];
  for (let i = 0; i < 5; i++) {
    const a0 = Math.PI * (.12 + i * .76 / 5), a1 = Math.PI * (.12 + (i + 1) * .76 / 5);
    const x0 = Math.cos(a0) * GATE.x, x1 = Math.cos(a1) * GATE.x, yA = Math.sin(a0) * GATE.rise, yB = Math.sin(a1) * GATE.rise;
    out.push({x: (x0 + x1) / 2, z: GATE.zArch, hx: Math.abs(x1 - x0) / 2 + .1, hz: GATE.depth / 2, y0: y0 + Math.min(yA, yB) - GATE.ring / 2, y1: y0 + Math.max(yA, yB) + GATE.ring / 2});
  }
  return out;
}

/**
 * Eclipse emblems at the given placements (local +Z faces out): an obsidian disc in a silver ring with sixteen
 * corona rays, and a thin pale ring of light just outside the disc, so the sign reads at night. One draw each.
 */
function eclipseEmblems(at: THREE.Matrix4[], silver: THREE.Material): THREE.Group {
  const g = new THREE.Group();g.name = 'star-eclipse-emblems';
  const rays = new StoneBuilder();
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, l = k % 2 ? .5 : .85, r0 = .66;
    const c = new THREE.Vector3(Math.cos(a) * r0, Math.sin(a) * r0, 0), tip = new THREE.Vector3(Math.cos(a) * (r0 + l), Math.sin(a) * (r0 + l), .02);
    const side = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(.1), back = new THREE.Vector3(0, 0, -.12);
    rays.tri(c.clone().add(side), c.clone().sub(side), tip, [0, 0], [0, 0], [0, 0], new THREE.Vector3(0, 0, 1));
    rays.tri(c.clone().add(side).add(back), tip, c.clone().add(side), [0, 0], [0, 0], [0, 0], side);
    rays.tri(c.clone().sub(side).add(back), c.clone().sub(side), tip, [0, 0], [0, 0], [0, 0], side.clone().negate());
  }
  const parts: [THREE.BufferGeometry, THREE.Material, string][] = [
    [rays.geometry('star-eclipse-rays'), silver, 'star-eclipse-rays'],
    [new THREE.TorusGeometry(.62, .08, 8, 48), silver, 'star-eclipse-ring'],
    [new THREE.CircleGeometry(.56, 40).translate(0, 0, .01), new THREE.MeshStandardMaterial({color: '#05050b', roughness: .12, metalness: .3}), 'star-eclipse-disc'],
    [new THREE.TorusGeometry(.585, .022, 6, 64).translate(0, 0, .05), new THREE.MeshBasicMaterial({color: new THREE.Color(2.2, 2.05, 1.7), toneMapped: true}), 'star-eclipse-corona'],
  ];
  for (const [geo, mat, name] of parts) {
    const mesh = new THREE.InstancedMesh(geo, mat, at.length);mesh.name = name;
    at.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = name !== 'star-eclipse-corona';mesh.receiveShadow = true;g.add(mesh);
  }
  return g;
}

export class StarSanctum {
  readonly root = new THREE.Group();
  /** The twelve obelisk footprints, solid to movement and sight (unchanged from the old colonnade). */
  readonly solids = throneSolids();
  private crowns: THREE.InstancedMesh[] = [];
  constructor(height: (x: number, z: number) => number) {
    this.root.name = 'star-sanctum';
    const stone = moonstoneMaterial({color: '#a4a4b4'}), silver = silverMaterial();
    const floor = new THREE.Mesh(floorGeometry(), sanctumFloorMaterial());floor.receiveShadow = true;this.root.add(floor);

    const body = new StoneBuilder(), trim = new StoneBuilder(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const crownAt: {x: number; y: number; z: number; tint: number; yaw: number}[] = [];
    const emblems: THREE.Matrix4[] = [];
    throneSolids().forEach(({x, z}, i) => {
      const H = OBELISK_H[i], y = height(x, z), yaw = Math.atan2(CENTER.x - x, CENTER.y - z), crown = i !== 0;
      m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), one);
      if (i === 0) {
        // In the gate: not a pillar that hides the floor but a waist-high altar, its top a slab tilted to the pilgrim
        // with the eclipse set in it; the arch frames the sanctum over it.
        body.stack([{y: -.45, hw: 1.25, ch: .34}, {y: .3, hw: 1.25, ch: .34}, {y: .3, hw: 1.08, ch: .3}, {y: .42, hw: 1.06, ch: .29},
          {y: .42, hw: .82, ch: .22}, {y: .98, hw: .78, ch: .21}, {y: .98, hw: 1.0, ch: .27}, {y: 1.16, hw: 1.0, ch: .27}], m);
        trim.stack([{y: .3, hw: 1.12, ch: .31}, {y: .36, hw: 1.12, ch: .31}], m);
        emblems.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 1.34, z + .05), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.1, 0, 0)), new THREE.Vector3(.78, .78, .78)));
        return;
      }
      body.stack(obeliskCourses(H, crown), m);
      // The north obelisk behind the queen wears the eclipse under its crown, facing the gate.
      if (i === 6) emblems.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + H - 2.3, z + .7), new THREE.Quaternion(), new THREE.Vector3(.72, .72, .72)));
      // Silver: a band above the plinth, one at the die's moulding, one under the capital.
      for (const [y0, hw, ch] of [[.78, .9, .24], [2.17, .76, .17], [H - 1.27, .58, .135]] as const) trim.stack([{y: y0, hw, ch}, {y: y0 + .1, hw, ch}], m);
      if (crown) {
        // A cradle of four prongs round the crystal.
        for (let k = 0; k < 4; k++) {
          const pm = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(k * Math.PI / 2 + Math.PI / 4) * .36, H - .72, Math.sin(k * Math.PI / 2 + Math.PI / 4) * .36), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(k * Math.PI / 2 + Math.PI / 4) * .35, 0, -Math.cos(k * Math.PI / 2 + Math.PI / 4) * .35)), one);
          trim.stack([{y: 0, hw: .07, ch: .02}, {y: .62, hw: .035, ch: .01}], new THREE.Matrix4().multiplyMatrices(m, pm));
        }
        crownAt.push({x, y: y + H - .78, z, tint: i % 2, yaw: yaw + i});
      }
    });
    // The gate: two piers (inside the sanctuary's colliders, r 1) and imposts; and the two further up the road.
    const piers = new StoneBuilder();
    for (const side of [-1, 1]) {
      const x = side * GATE.x, y = height(x, GATE.z);
      m.compose(new THREE.Vector3(x, y, GATE.z), q.identity(), one);
      piers.stack([{y: -.4, hw: .8, ch: .24}, {y: .55, hw: .8, ch: .24}, {y: .55, hw: .7, ch: .2}, {y: .75, hw: .68, ch: .2}, {y: .75, hw: .6, ch: .16},
        {y: GATE.spring - .32, hw: .56, ch: .15}, {y: GATE.spring - .32, hw: .72, ch: .2}, {y: GATE.spring - .05, hw: .74, ch: .21}, {y: GATE.spring - .05, hw: .66, ch: .18}, {y: GATE.spring, hw: .66, ch: .18}], m);
      trim.stack([{y: GATE.spring - .44, hw: .6, ch: .16}, {y: GATE.spring - .36, hw: .6, ch: .16}], m);
    }
    // The other two sanctuary pillars, further up the road: lower piers with a crystal each.
    for (const side of [-1, 1]) {
      const x = side * 8, z = -47, y = height(x, z);
      m.compose(new THREE.Vector3(x, y, z), q.identity(), one);
      piers.stack([{y: -.4, hw: .78, ch: .24}, {y: .5, hw: .78, ch: .24}, {y: .5, hw: .62, ch: .17}, {y: 4.3, hw: .5, ch: .13}, {y: 4.3, hw: .64, ch: .18}, {y: 4.55, hw: .64, ch: .18}, {y: 4.55, hw: .46, ch: .12}, {y: 4.7, hw: .42, ch: .11}], m);
      trim.stack([{y: .5, hw: .66, ch: .18}, {y: .6, hw: .66, ch: .18}], m);
      crownAt.push({x, y: y + 4.66, z, tint: 0, yaw: side});
    }
    // The arch: an elliptical ring of voussoirs between the piers, keystone proud of it.
    const arch = new StoneBuilder(), ys = height(0, GATE.z) + GATE.spring, N = 40, hd = GATE.depth / 2, z0 = GATE.zArch;
    const pt = (t: number, off: number, dz: number) => { const a = Math.PI * t, ax = GATE.x + off, by = GATE.rise + off; return new THREE.Vector3(Math.cos(a) * ax, ys + Math.sin(a) * by, z0 + dz); };
    const arc = (t: number) => t * Math.PI * (GATE.x + GATE.rise) / 2;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N, h = GATE.ring / 2;
      const a = [pt(t0, -h, -hd), pt(t1, -h, -hd), pt(t1, h, -hd), pt(t0, h, -hd)], b = [pt(t0, -h, hd), pt(t1, -h, hd), pt(t1, h, hd), pt(t0, h, hd)];
      const u0 = arc(t0), u1 = arc(t1), mid = pt((t0 + t1) / 2, 0, 0), outward = (v: THREE.Vector3) => v;
      // Faces: south and north, intrados (under) and extrados (over).
      arch.tri(b[0], b[1], b[2], [u0, 0], [u1, 0], [u1, 1], new THREE.Vector3(0, 0, 1));arch.tri(b[0], b[2], b[3], [u0, 0], [u1, 1], [u0, 1], new THREE.Vector3(0, 0, 1));
      arch.tri(a[0], a[1], a[2], [u0, 0], [u1, 0], [u1, 1], new THREE.Vector3(0, 0, -1));arch.tri(a[0], a[2], a[3], [u0, 0], [u1, 1], [u0, 1], new THREE.Vector3(0, 0, -1));
      const inward = new THREE.Vector3().subVectors(new THREE.Vector3(0, ys, z0), mid), out = inward.clone().negate();
      arch.tri(a[0], a[1], b[1], [u0, 0], [u1, 0], [u1, 1], outward(inward));arch.tri(a[0], b[1], b[0], [u0, 0], [u1, 1], [u0, 1], inward);
      arch.tri(a[3], a[2], b[2], [u0, 0], [u1, 0], [u1, 1], out);arch.tri(a[3], b[2], b[3], [u0, 0], [u1, 1], [u0, 1], out);
    }
    // Keystone and a cornice over the crown.
    m.compose(new THREE.Vector3(0, ys + GATE.rise - .55, z0), q.identity(), one);
    arch.stack([{y: 0, hw: .62, ch: .1}, {y: 1.5, hw: .75, ch: .12}, {y: 1.5, hw: .92, ch: .16}, {y: 1.72, hw: .92, ch: .16}], m);
    // Voussoir joints only: every face sits mid-row, so the radial joints are the only lines.
    for (let i = 1; i < arch.joint.length; i += 2) arch.joint[i] = .9;
    const archGeo = arch.geometry('star-gate-arch');
    const gateMat = moonstoneMaterial({color: '#a8a8b8', block: [1.05, 2]});
    const archMesh = new THREE.Mesh(archGeo, gateMat);archMesh.name = 'star-gate-arch';archMesh.castShadow = archMesh.receiveShadow = true;this.root.add(archMesh);
    // The eclipse on the keystone's south face, on the altar and on the north obelisk: a dark moon in a silver corona.
    emblems.push(new THREE.Matrix4().compose(new THREE.Vector3(0, ys + GATE.rise + .32, z0 + hd + .2), new THREE.Quaternion(), one));
    this.root.add(eclipseEmblems(emblems, silver));
    const bodyMesh = new THREE.Mesh(body.geometry('star-sanctum-obelisks'), stone);bodyMesh.name = 'star-sanctum-obelisks';bodyMesh.castShadow = bodyMesh.receiveShadow = true;
    const trimMesh = new THREE.Mesh(trim.geometry('star-sanctum-silver'), silver);trimMesh.name = 'star-sanctum-silver';trimMesh.castShadow = true;
    const pierMesh = new THREE.Mesh(piers.geometry('sanctuary-gate-piers'), gateMat);pierMesh.name = 'sanctuary-gate-piers';pierMesh.castShadow = pierMesh.receiveShadow = true;
    this.root.add(bodyMesh, trimMesh, pierMesh);
    // Crowns: teal and violet crystals, one draw each.
    const cluster = starCrystalCluster(), mat = new THREE.Matrix4(), rot = new THREE.Quaternion();
    for (const [t, tint] of (['teal', 'violet'] as const).entries()) {
      const list = crownAt.filter(c => c.tint === t);
      const mesh = new THREE.InstancedMesh(cluster, starCrystalMaterial(tint, {glow: 1.6, frost: .12}), list.length);mesh.name = `star-sanctum-crowns-${tint}`;
      list.forEach((c, i) => { const s = new THREE.Vector3(.95, 1.9, .95);mat.compose(new THREE.Vector3(c.x, c.y + .5 * s.y, c.z), rot.setFromAxisAngle(up, c.yaw), s);mesh.setMatrixAt(i, mat); });
      mesh.castShadow = true;this.crowns.push(mesh);this.root.add(mesh);
    }
  }
  update(_time: number) { /* the crowns are still; their light is in the material */ }
}
