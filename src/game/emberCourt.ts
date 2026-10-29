import * as THREE from 'three';
import {Builder,C,K,type V3} from './emberRocks';
import {EMBER_DETAIL,EMBER_NOISE} from './emberNoise';

/*
 * The forge court before the volcano, where the boss is fought (r 20 round (0, -72), floor at the exact gameplay
 * height). One disc, one shader: dressed basalt slabs laid in rings round a black hearth stone, eight radial
 * channels and two ring channels filled with cooled lava that still glows in its cracks, runes cut along the
 * channels, a kerb of long curved stones with a thin brass inlay for the boss ring, and wear: a polished middle,
 * scorch marks, ash in the joints, cracked slabs. Round it, the nine landmark columns (layoutFrontier's colliders,
 * r 1.5): carved basalt on stepped plinths, each crowned with a brass brazier whose fire lights the floor.
 */

const C0 = {x: 0, z: -72};
/** The column ring: same places as layoutFrontier's colliders. */
export function courtColumns() {
 const out: {x: number; z: number}[] = [];
 for (let i = 0; i < 10; i++) { const a = (i + 1) / 12 * Math.PI * 2, x = Math.sin(a) * 23, z = -72 + Math.cos(a) * 23; if (z > -56) continue; out.push({x, z}); }
 return out;
}
const MAX_LIGHT = 9;
/** Brazier fire height above the column's ground. */
const FIRE_Y = 7.75;

const HEAD = /* glsl */ `
uniform vec2 ecC;
uniform vec3 ecLight[${MAX_LIGHT}];
uniform float egDetail;
uniform float ecTime;
varying vec3 vEcW;
${EMBER_NOISE}
float ecBox(vec2 p,vec2 h,float rc){vec2 q=abs(p)-(h-rc);return length(max(q,0.))+min(max(q.x,q.y),0.)-rc;}
`;

const COLOR = /* glsl */ `
vec2 ecD=vEcW.xz-ecC;
float ecR=length(ecD),ecA=atan(ecD.y,ecD.x);
vec2 ecDpx=dFdx(vEcW.xz),ecDpy=dFdy(vEcW.xz);
float ecFoot=length(abs(ecDpx)+abs(ecDpy));
float ecFw=max(ecFoot*.5,1e-4);
float ecAlpha=1.-smoothstep(19.95,20.55,ecR+egNoise(vEcW.xz*1.3)*.15);
if(ecAlpha<.004)discard;
// Ring courses: the hearth stone, inner rings, the ring channel at 8 m, outer rings, the kerb from 19.15 m.
float ecR0=0.,ecR1=2.6;
if(ecR>=2.6&&ecR<8.){float k=floor((ecR-2.6)/1.35);ecR0=2.6+k*1.35;ecR1=ecR0+1.35;}
else if(ecR>=8.&&ecR<19.15){float k=floor((ecR-8.)/1.595);ecR0=8.+k*1.595;ecR1=min(ecR0+1.595,19.15);}
else if(ecR>=19.15){ecR0=19.15;ecR1=20.3;}
float ecRm=(ecR0+ecR1)*.5,ecKerb=step(19.15,ecR);
float ecN=max(1.,floor(6.2832*ecRm/(ecKerb>.5?2.4:1.75)));
float ecOff=egHash12(vec2(ecR0,3.7));
float ecT=(ecA/6.2832+.5)*ecN+ecOff,ecJ=floor(ecT);
float ecId=egHash12(vec2(ecJ,ecR0*7.1));
vec2 ecLoc=vec2((fract(ecT)-.5)*6.2832*ecRm/ecN,ecR-ecRm);
vec2 ecHs=vec2(3.1416*ecRm/ecN,(ecR1-ecR0)*.5);
float ecOut=ecR<2.6?ecR-2.6+.03:ecBox(ecLoc,ecHs-vec2(.022,.02),.04);
ecOut+=egNoise(vEcW.xz*7.+ecId*9.)*.01;
float ecJoint=(1.-smoothstep(-ecFw,ecFw,-ecOut))*min(1.,.03/ecFw);
// Channels: two rings and eight spokes of cooled lava, set into the slabs.
float ecSpokeA=(floor(ecA/.7854)+.5)*.7854;
float ecSpokeD=abs(sin(ecA-ecSpokeA))*ecR;
float ecSpoke=step(2.6,ecR)*step(ecR,19.15)*(1.-smoothstep(.1,.1+ecFw*2.,ecSpokeD));
float ecRing=max(1.-smoothstep(.12,.12+ecFw*2.,abs(ecR-8.)),1.-smoothstep(.1,.1+ecFw*2.,abs(ecR-2.6)));
float ecChan=max(ecSpoke,ecRing);
// Runes cut beside the spokes every metre and a half: short strokes, a few worn away.
float ecRuneU=ecR/1.5,ecRuneK=floor(ecRuneU),ecRuneH=egHash12(vec2(ecRuneK,ecSpokeA*3.));
vec2 ecRq=vec2(fract(ecRuneU)-.5,(ecSpokeD-.42)/.22);
float ecRune=0.;
if(ecR>3.2&&ecR<18.5&&abs(ecRq.y)<1.2){
  float s1=1.-smoothstep(.03,.06,abs(ecRq.x-(ecRuneH-.5)*.25));
  float s2=1.-smoothstep(.04,.08,abs(ecRq.y-(fract(ecRuneH*7.)-.5)*1.2));
  float s3=1.-smoothstep(.03,.06,abs(ecRq.x+ecRq.y*.3*(fract(ecRuneH*3.)-.5)));
  ecRune=max(s1*step(abs(ecRq.y),.9),s2*step(abs(ecRq.x),.28)*step(.3,fract(ecRuneH*5.)));
  ecRune=max(ecRune,s3*step(.6,ecRuneH)*step(abs(ecRq.y),.8));
  ecRune*=step(abs(ecRq.x),.33)*step(.15,fract(ecRuneH*11.))*(1.-ecSpoke);
}
// The hearth stone's sigil: an eight-pointed star cut into the obsidian.
float ecStar=0.;
if(ecR<2.45){float sa=abs(fract(ecA/.7854+.5)-.5)*.7854;ecStar=(1.-smoothstep(.03,.06,abs(ecR*sin(sa)-(2.2-ecR)*.18)))*step(.5,ecR);ecStar=max(ecStar,1.-smoothstep(.04,.07,abs(ecR-1.9)));}
// The boss ring: a thin brass inlay in the kerb.
float ecBrass=1.-smoothstep(.035,.035+ecFw*1.5,abs(ecR-19.55));
// Wear: polished middle, scorch blotches, ash in the joints, cracks across some slabs.
float ecN1=egNoise(vEcW.xz*.25+3.),ecN2=egNoise(vEcW.xz*1.2-1.);
float ecPolish=1.-smoothstep(4.,13.,ecR);
float ecScorch=smoothstep(.25,.6,egNoise(vEcW.xz*.18+9.)+ecN2*.15)*(1.-ecKerb);
// One crack across a few slabs, wandering from edge to edge.
float ecCa=fract(ecId*7.7)*3.1416,ecCl=dot(ecLoc,vec2(cos(ecCa),sin(ecCa)))+egNoise(ecLoc*4.+ecId*20.)*.12;
float ecCrack=(1.-smoothstep(.0,.015+ecFoot*.4,abs(ecCl)))*step(.88,fract(ecId*13.1))*(1.-ecKerb)*step(2.6,ecR);
float ecV=fract(ecId*17.3);
vec3 ecStone=mix(vec3(.23,.235,.26),vec3(.31,.31,.33),fract(ecId*4.3));
ecStone=mix(ecStone,vec3(.16,.155,.17),step(.86,ecV)*.8);
ecStone=mix(ecStone,vec3(.34,.335,.35)*(.9+.2*fract(ecId*5.)),ecKerb);
ecStone=ecR<2.6?vec3(.07,.065,.08):ecStone;
ecStone*=.86+.22*(egNoise(vEcW.xz*3.1+ecId*5.)*.5+.5);
float ecNear=1.-smoothstep(.006,.035,ecFoot);
if(ecNear>0.)ecStone*=1.+(egNoise(vEcW.xz*31.)*.07+sin((ecLoc.x+ecLoc.y*.3)*80.+ecId*13.)*.025)*ecNear;
ecStone*=mix(1.,.86,ecPolish*.5);
ecStone=mix(ecStone,vec3(.06,.05,.05),ecScorch*.55);
ecStone=mix(ecStone,vec3(.06,.06,.07),ecCrack*.7);
vec3 ecAsh=vec3(.4,.385,.4)*(.9+.2*ecN2);
vec3 ecCol=mix(ecStone,mix(vec3(.08,.075,.08),ecAsh,.55+.3*ecN1),ecJoint);
vec3 ecCrust=mix(vec3(.12,.06,.05),vec3(.07,.05,.05),egNoise(vEcW.xz*2.4)*.5+.5);
ecCol=mix(ecCol,ecCrust,ecChan);
ecCol=mix(ecCol,vec3(.05,.04,.04),ecRune*.8);
ecCol=mix(ecCol,vec3(.04,.035,.04),ecStar*.85);
ecCol=mix(ecCol,vec3(.78,.57,.27),ecBrass);
// Ash blown in over the edge.
float ecDrift=smoothstep(.6,.95,smoothstep(18.,20.5,ecR)+egNoise(vEcW.xz*.7)*.35)*(1.-ecBrass);
ecCol=mix(ecCol,ecAsh*.85,ecDrift*.6);
diffuseColor.rgb=egSrgb(ecCol);
diffuseColor.a*=ecAlpha;
`;

const ROUGH = /* glsl */ `
roughnessFactor=mix(.82-ecPolish*.12,.58,step(.86,ecV)*(1.-ecKerb)*(1.-ecScorch));
roughnessFactor=mix(roughnessFactor,.95,max(ecJoint,ecDrift));
roughnessFactor=mix(roughnessFactor,.34,ecBrass);
`;
const METAL = /* glsl */ `
metalnessFactor=ecBrass*.85;
`;

const NORMAL = /* glsl */ `
if(egDetail>.5){
  float h=(smoothstep(0.,.06,-ecOut)*.035-ecChan*.015-ecRune*.012-ecCrack*.01+egNoise(vEcW.xz*9.)*.003*ecNear)*(1.-smoothstep(.05,.25,ecFoot));
  normal=egBump(normal,h,ecDpx,ecDpy);
}
`;

const EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // Cooled lava still glowing in the cracks of its crust; brighter at the hearth, breathing slowly.
  vec3 cc=egCells(vEcW.xz*3.2);
  float crack=1.-smoothstep(.0,.05+ecFoot*.4,cc.x);
  float breathe=.75+.25*sin(ecTime*.8-ecR*.35);
  float worn=smoothstep(-.2,.5,egNoise(vEcW.xz*.6+2.));
  totalEmissiveRadiance+=vec3(1.,.26,.05)*ecChan*(crack*1.6+.12)*breathe*worn*(1.+(1.-smoothstep(2.6,9.,ecR))*.8);
  totalEmissiveRadiance+=vec3(1.,.38,.1)*ecRune*.55*breathe*worn;
  totalEmissiveRadiance+=vec3(1.,.42,.12)*ecStar*.5*breathe;
  // The braziers' fire on the floor round each column.
  vec3 pool=vec3(0.);
  for(int i=0;i<${MAX_LIGHT};i++){vec3 l=ecLight[i];float d=length(vEcW.xz-l.xy);float t=max(0.,1.-d/9.);pool+=vec3(1.,.5,.2)*t*t*l.z;}
  totalEmissiveRadiance+=pool*diffuseColor.rgb*2.2;
}
`;

const FLAME_VERT = /* glsl */ `
attribute vec3 aFl;
uniform float uTime;
varying float vU;
varying float vF;
varying vec3 vN;
varying vec3 vV;
void main(){
  vec3 p=position;
  float t=aFl.x,seed=aFl.y;
  // Tongues: the flame sways and licks, more at the top.
  float s=uTime*3.1+seed*17.;
  p.x+=sin(s+t*4.)*.12*t*t+sin(s*1.7+t*9.)*.04*t;
  p.z+=cos(s*1.3+t*5.)*.12*t*t;
  p.y+=sin(s*2.1)*.08*t;
  vU=t;vF=aFl.z;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);
  gl_Position=projectionMatrix*mv;
}
`;
const FLAME_FRAG = /* glsl */ `
varying float vU;
varying float vF;
varying vec3 vN;
varying vec3 vV;
void main(){
  float edge=pow(abs(dot(normalize(vN),normalize(vV))),1.4);
  vec3 c=mix(vec3(1.,.85,.5),vec3(1.,.35,.06),smoothstep(.0,.6,vU));
  c=mix(c,vec3(.6,.1,.02),smoothstep(.6,1.,vU));
  float a=edge*(1.-smoothstep(.45,1.,vU))*(vF>.5?.85:.6);
  gl_FragColor=vec4(c*(vF>.5?1.5:2.6)*a,a);
}
`;

/** Octagonal frustum from y0 to y1 (flat faces, crisp carved edges), with a cap on top. */
function oct(b: Builder, x: number, z: number, r0: number, r1: number, y0: number, y1: number, col: THREE.Color, seed: number, cap = true) {
 const n = 8, lo: V3[] = [], hi: V3[] = [];
 for (let k = 0; k < n; k++) { const a = (k + .5) / n * Math.PI * 2; lo.push([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0]); hi.push([x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1]); }
 for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; b.quad(lo[k], hi[k], hi[k1], lo[k1], col, K.dressed, 0, seed); if (cap) b.tri(hi[k], [x, y1, z], hi[k1], col, K.dressed, 0, seed); }
}

export interface EmberCourtOptions { height: (x: number, z: number) => number; ly: number }

export function emberCourt(opts: EmberCourtOptions) {
 const {height, ly} = opts;
 const cols = courtColumns();
 const root = new THREE.Group(); root.name = 'ember-forge-court';
 // Floor.
 const floorGeo = new THREE.CircleGeometry(20.6, 160); floorGeo.rotateX(-Math.PI / 2);
 const uniforms = {
  ecC: {value: new THREE.Vector2(C0.x, C0.z)},
  ecLight: {value: Array.from({length: MAX_LIGHT}, (_, i) => cols[i] ? new THREE.Vector3(cols[i].x, cols[i].z, 1) : new THREE.Vector3(0, 0, 0))},
  egDetail: EMBER_DETAIL,
  ecTime: {value: 0},
 };
 const floorMat = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .8, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
 floorMat.name = 'ember-forge-court-floor';
 floorMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
   .replace('#include <common>', '#include <common>\nvarying vec3 vEcW;')
   .replace('#include <fog_vertex>', '#include <fog_vertex>\nvEcW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <common>', `#include <common>\n${HEAD}`)
   .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR}`)
   .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`)
   .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${METAL}`)
   .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL}`)
   .replace('#include <emissivemap_fragment>', EMISSIVE);
 };
 floorMat.customProgramCacheKey = () => 'ember-forge-court-floor';
 const floor = new THREE.Mesh(floorGeo, floorMat);
 // The old floor's top sat at ly + 0.01 to 0.0135; this one at ly + 0.012, flat with the gameplay ground.
 floor.position.set(C0.x, ly + .012, C0.z); floor.name = 'ember-forge-court-floor'; floor.receiveShadow = true; floor.renderOrder = -1;
 root.add(floor);

 // Brass braziers (one merged mesh) and their fires (one merged additive mesh).
 const brassParts: THREE.BufferGeometry[] = [], flamePos: number[] = [], flameNrm: number[] = [], flameFl: number[] = [], flameIdx: number[] = [];
 const bowlProfile = [new THREE.Vector2(.0, 0), new THREE.Vector2(.32, 0), new THREE.Vector2(.42, .06), new THREE.Vector2(.78, .2), new THREE.Vector2(1.02, .5), new THREE.Vector2(1.1, .62), new THREE.Vector2(1.04, .66), new THREE.Vector2(.94, .52), new THREE.Vector2(.7, .34), new THREE.Vector2(0, .3)];
 cols.forEach((c, i) => {
  const y = height(c.x, c.z);
  const bowl = new THREE.LatheGeometry(bowlProfile, 24); bowl.translate(c.x, y + 7.28, c.z); brassParts.push(bowl);
  const band = new THREE.TorusGeometry(1.08, .045, 6, 32); band.rotateX(Math.PI / 2); band.translate(c.x, y + 7.84, c.z); brassParts.push(band);
  const collar = new THREE.CylinderGeometry(.9, .9, .12, 24, 1, true); collar.translate(c.x, y + 7.2, c.z); brassParts.push(collar);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + .2, rivet = new THREE.SphereGeometry(.06, 6, 4); rivet.translate(c.x + Math.cos(a) * 1.02, y + 7.62, c.z + Math.sin(a) * 1.02); brassParts.push(rivet); }
  // Two fires per brazier: a broad outer one and a hot inner core.
  for (const [rad, hgt, f, ox, oz] of [[.55, 1.6, 1, .18, .1], [.45, 1.25, 1, -.25, .15], [.42, 1.1, 1, .05, -.3], [.34, 1, 0, 0, 0]] as const) {
   const base = flamePos.length / 3, rings = 7, segs = 10;
   for (let r = 0; r <= rings; r++) {
    const t = r / rings, rr = rad * Math.sin(Math.PI * Math.min(1, t * .9 + .1)) * (1 - t * .35), yy = y + FIRE_Y - .15 + hgt * t;
    for (let s = 0; s < segs; s++) {
     const a = s / segs * Math.PI * 2;
     flamePos.push(c.x + ox * t + Math.cos(a) * rr, yy, c.z + oz * t + Math.sin(a) * rr); flameNrm.push(Math.cos(a), .2, Math.sin(a)); flameFl.push(t, i + f * .37 + ox * 3, f);
    }
   }
   for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) { const a = base + r * segs + s, bq = base + r * segs + (s + 1) % segs; flameIdx.push(a, bq, a + segs, bq, bq + segs, a + segs); }
  }
 });
 const brassGeo = mergeAll(brassParts);
 const brass = new THREE.Mesh(brassGeo, new THREE.MeshStandardMaterial({color: '#c8923c', metalness: .85, roughness: .38, emissive: '#3a1404', emissiveIntensity: .6}));
 brass.name = 'ember-court-braziers'; brass.castShadow = true; brass.receiveShadow = true;
 (brass.material as THREE.Material).name = 'ember-brass';
 root.add(brass);
 const flameGeo = new THREE.BufferGeometry();
 flameGeo.setAttribute('position', new THREE.Float32BufferAttribute(flamePos, 3));
 flameGeo.setAttribute('normal', new THREE.Float32BufferAttribute(flameNrm, 3));
 flameGeo.setAttribute('aFl', new THREE.Float32BufferAttribute(flameFl, 3));
 flameGeo.setIndex(flameIdx); flameGeo.computeBoundingSphere();
 const flameUniforms = {uTime: {value: 0}};
 const flames = new THREE.Mesh(flameGeo, new THREE.ShaderMaterial({uniforms: flameUniforms, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide}));
 flames.name = 'ember-court-fires'; flames.renderOrder = 3; flames.frustumCulled = false;
 root.add(flames);

 /** The columns' stone, added to the rock mesh (same material). */
 const addColumns = (b: Builder) => {
  cols.forEach((c, i) => {
   const y = height(c.x, c.z), s = i * 13 + 5, stone = C('#3a3c44'), dark = C('#2c2e35'), pale = C('#4a4b52');
   oct(b, c.x, c.z, 1.55, 1.48, y - .4, y + .42, dark, s);
   oct(b, c.x, c.z, 1.3, 1.22, y + .42, y + .78, stone, s);
   oct(b, c.x, c.z, 1.02, .96, y + .78, y + 1.02, pale, s);
   // Shaft in three drums with carved bands between them; each drum a little narrower.
   const drums: [number, number, number, number][] = [[1.02, 2.7, .84, .81], [2.92, 4.7, .8, .77], [4.92, 6.55, .76, .74]];
   drums.forEach(([y0, y1, r0, r1], k) => {
    oct(b, c.x, c.z, r0, r1, y + y0, y + y1, stone, s + k, false);
    if (k < 2) oct(b, c.x, c.z, r1 + .1, r1 + .1, y + y1, y + y1 + .22, pale, s, false);
   });
   oct(b, c.x, c.z, .74, 1.12, y + 6.55, y + 7.0, stone, s);
   oct(b, c.x, c.z, 1.2, 1.2, y + 7.0, y + 7.22, pale, s);
   // Coals in the bowl.
   const coal = new THREE.CircleGeometry(.9, 18); coal.rotateX(-Math.PI / 2); coal.translate(c.x, y + 7.62, c.z); coal.computeVertexNormals();
   b.geo(coal, C('#2a0c06'), K.cone, 0, s, (p: V3) => 1.05 + .25 * Math.sin(p[0] * 9 + p[2] * 7)); coal.dispose();
   // Rubble and a fallen drum at the foot of every other column.
   if (i % 2 === 0) { const a = i * 1.7, fx = c.x + Math.cos(a) * 2.6, fz = c.z + Math.sin(a) * 2.6; oct(b, fx, fz, .8, .8, height(fx, fz) - .2, height(fx, fz) + .35, stone, s + 99); }
  });
 };
 return {
  root, addColumns,
  update(time: number) { uniforms.ecTime.value = time; flameUniforms.uTime.value = time; for (const l of uniforms.ecLight.value) l.z = l.x || l.y ? .85 + .15 * Math.sin(time * 7.3 + l.x) * Math.sin(time * 4.1 + l.y) : 0; },
 };
}

function mergeAll(parts: THREE.BufferGeometry[]) {
 const pos: number[] = [], nrm: number[] = [];
 for (const p of parts) {
  const g = p.index ? p.toNonIndexed() : p, a = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < a.count; i++) { pos.push(a.getX(i), a.getY(i), a.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
  if (g !== p) g.dispose(); p.dispose();
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
 g.computeBoundingSphere();
 return g;
}
