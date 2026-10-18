import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {FROST_NOISE,graniteMaterial} from './frostPaving';

/*
 * Boreas's throne floor: a disc of old lake ice a metre thick, ringed by carved granite. It is lit as a surface (so
 * crabs and pillars shadow it) whose albedo looks down into its depth: the crack field is sampled along the
 * refracted view ray, so every fracture is a vertical sheet that opens and slides as the camera moves, and
 * columns of trapped bubbles stack under each other. The three combat rings are runes cut into the ice with
 * light in the cuts. The sun's highlight is clamped and the sky comes back through Fresnel instead, so the low
 * sun no longer blows the floor out to white.
 */

export interface FrostArenaOptions {
  center: THREE.Vector3;
  /** Ice radius; the granite rim starts just inside it. */
  radius: number;
  /** Radii of the rune rings. */
  rings: readonly number[];
  skyHorizon: THREE.Color;
  skyZenith: THREE.Color;
  snowBounce: THREE.Color;
}

export interface FrostArena {
  root: THREE.Group;
  /** Once a frame while Frostlight shows; 'low' takes fewer depth samples and drops the bubbles and fine cracks. */
  update(time: number, quality: 'high' | 'low'): void;
}

/** Height of the ice above the combat floor (snowHeight is exactly 19 inside the arena). */
const ICE_LIFT = .035;

const ICE_HEAD = /* glsl */ `
${FROST_NOISE}
uniform vec3 faCenter;
uniform vec3 faRings;
uniform vec3 faSkyH;
uniform vec3 faSkyZ;
uniform vec3 faBounce;
uniform float faTime;
uniform float faDetail;
varying vec3 vFaW;
vec3 faEnv(vec3 d){
  if(d.y<0.)return faBounce*(.55+.45*smoothstep(-1.,0.,d.y));
  return mix(faSkyH,faSkyZ,smoothstep(0.,.6,d.y));
}
// One fracture: a vertical sheet standing on segment a-b, reaching depth D. The refracted ray from p moves by st
// per metre of depth, so it meets the sheet's plane at one depth, analytically: the sheet is continuous and slides
// with the view. trace is the hairline where the sheet breaks the surface.
void faSheet(vec2 p,vec2 a,vec2 b,float D,float w,vec2 st,float foot,inout float sheet,inout float trace){
  vec2 ab=b-a;float L=length(ab);vec2 dir=ab/L,n=vec2(-dir.y,dir.x),ap=p-a;
  float s=dot(ap,n),t=dot(ap,dir);
  trace=max(trace,(1.-smoothstep(foot*.6,foot*1.6+.003,length(ap-dir*clamp(t,0.,L))))*w*(.55+.45*fpNoise(vec2(t*.7,w*31.))));
  float sn=dot(st,n);
  if(abs(sn)<1e-4)return;
  float d=-s/sn;
  if(d<=0.||d>D)return;
  float th=t+dot(st,dir)*d;
  if(th<0.||th>L)return;
  float f=exp(-d*1.7)*(1.-smoothstep(D*.5,D,d))*smoothstep(0.,.3,th)*smoothstep(0.,.3,L-th);
  // Hackles on the fracture face.
  f*=clamp(.5+.6*fpNoise(vec2(th*2.3,d*9.)+a),0.,1.);
  sheet+=f*w*(1.-sheet);
}
// Nodes of a crack web: one jittered point per cell.
vec2 faNode(vec2 c,float size,float salt){return (c+.15+.7*fpHash22(c*1.31+salt))*size;}
// The crack network around p: a web of straight fractures joining jittered nodes (some links missing, so it never
// closes into tiles), the star struck out from the sigil, and in patches a finer, shallower web (high quality).
void faCrackField(vec2 p,vec2 st,float foot,float detail,vec2 c0,out float sheet,out float trace){
  sheet=0.;trace=0.;
  const float S=5.4;
  vec2 base=floor(p/S);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 c=base+vec2(float(i),float(j)),a=faNode(c,S,0.);
    vec3 h=vec3(fpHash22(c+.37),fpHash12(c+9.1));
    float D=.3+.8*h.z,w=.45+.55*fract(h.z*13.7);
    if(h.x<.42)faSheet(p,a,faNode(c+vec2(1.,0.),S,0.),D,w,st,foot,sheet,trace);
    if(h.y<.42)faSheet(p,a,faNode(c+vec2(0.,1.),S,0.),D*.8,1.45-w,st,foot,sheet,trace);
    if(fract(h.z*7.3)<.15)faSheet(p,a,faNode(c+vec2(1.,1.),S,0.),D*.6,.7,st,foot,sheet,trace);
  }
  for(int i=0;i<7;i++){
    float fi=float(i),a=(fi+fpHash12(vec2(fi,4.))*.6)/7.*6.2831853,r1=4.6+5.5*fpHash12(vec2(fi,9.)),k=(fpHash12(vec2(fi,2.))-.5)*.6;
    vec2 d=vec2(cos(a),sin(a)),d2=vec2(cos(a+k),sin(a+k)),q=c0+d*(2.75+r1)*.5;
    faSheet(p,c0+d*2.75,q,.6,1.,st,foot,sheet,trace);
    faSheet(p,q,q+d2*(r1-2.75)*.5,.4,.8,st,foot,sheet,trace);
  }
  if(detail>.5&&fpNoise(p*.11+8.)>.2){
    const float F=1.3;
    vec2 fb=floor(p/F);float sh=0.,tr=0.;
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
      vec2 c=fb+vec2(float(i),float(j)),a=faNode(c,F,5.);vec2 h=fpHash22(c+3.7);
      if(h.x<.3)faSheet(p,a,faNode(c+vec2(1.,0.),F,5.),.12,1.,st,foot,sh,tr);
      if(h.y<.3)faSheet(p,a,faNode(c+vec2(0.,1.),F,5.),.1,1.,st,foot,sh,tr);
    }
    sheet+=sh*.6*(1.-sheet);trace=max(trace,tr*.6);
  }
}
float faSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
// One rune, in band units (y spans -1..1): a stave and up to four twigs picked by the id.
float faGlyph(vec2 q,float id){
  float d=faSeg(q,vec2(0.,-.78),vec2(0.,.78));
  vec4 h=fract(id*vec4(13.13,7.31,3.71,19.9));
  float s1=h.y>.5?1.:-1.,s2=h.w>.5?1.:-1.;
  if(h.x>.3)d=min(d,faSeg(q,vec2(0.,.78),vec2(.42*s1,.2)));
  if(h.z>.4)d=min(d,faSeg(q,vec2(0.,.05*s2),vec2(.42*s2,-.5)));
  if(h.y<.35)d=min(d,faSeg(q,vec2(-.4,.42),vec2(.4,-.12)));
  if(h.w<.3)d=min(d,faSeg(q,vec2(0.,-.3),vec2(-.42*s1,.3)));
  if(h.x<.15)d=min(d,faSeg(q,vec2(-.42,-.78),vec2(-.42,.2)));
  return d;
}
`;

const ICE_COLOR = /* glsl */ `
vec2 aP=vFaW.xz-faCenter.xz;
float aR=length(aP),aAng=atan(aP.y,aP.x);
vec3 aV=normalize(cameraPosition-vFaW);
float aFoot=length(fwidth(vFaW.xz));
// The view ray bends into the ice; at depth d it has reached vFaW.xz+aStep*d.
vec3 aRf=refract(-aV,vec3(0.,1.,0.),.763);
vec2 aStep=aRf.xz/max(-aRf.y,.2);
// Thickness: black-green and clear where it is deep, milky where air froze in; the milk lies half a metre down,
// so it drifts against the cracks as the camera moves.
float aMilk=smoothstep(-.25,.7,fpFbm((vFaW.xz+aStep*.5)*.075+2.));
vec3 aIce=mix(vec3(.004,.022,.036),vec3(.045,.12,.155),aMilk*.7);
float aSheet,aTrace;
faCrackField(vFaW.xz,aStep,aFoot,faDetail,faCenter.xz,aSheet,aTrace);
aIce+=mix(vec3(.2,.45,.58),vec3(.55,.8,.9),aSheet)*aSheet*.6+vec3(.5,.62,.68)*aTrace*.3;
// Bubbles caught as they rose: columns of small flat discs stacked under each other, in clusters.
float aBub=0.;
if(faDetail>.5){
  float cl=smoothstep(.05,.45,fpNoise(vFaW.xz*.09+4.));
  if(cl>0.)for(int k=0;k<4;k++){
    float d=.06+float(k)*.12;
    vec2 q=(vFaW.xz+aStep*d)/.42,id=floor(q),h=fpHash22(id+31.);
    if(h.x>.9){
      vec2 o=(fpHash22(id+5.3)-.5)*.4;float r=(.035+.05*h.y)*(1.-float(k)*.18),dd=length(fract(q)-.5-o);
      aBub+=(smoothstep(r,r*.5,dd)*.4+smoothstep(r*.72,r,dd)*smoothstep(r*1.1,r,dd)*.4)*exp(-d*2.6);
    }
  }
  aBub*=cl*(1.-smoothstep(.012,.04,aFoot));
}
aIce+=vec3(.6,.78,.86)*aBub*.5;
// Rune rings: two cut grooves either side of a band of runes, and a faint halo in the ice so they read from afar.
float aGlow=0.,aCut=0.;
for(int i=0;i<3;i++){
  float R=faRings[i],dR=aR-R,bw=R>20.?.3:.26;
  float gd=abs(abs(dR)-bw),gw=max(.022,aFoot*.6);
  float groove=1.-smoothstep(gw*.5,gw,gd);
  float N=floor(6.2831853*R/.62),cw=6.2831853*R/N,u=(aAng/6.2831853+.5)*N,cell=floor(u);
  float bh=bw-.08;
  vec2 q=vec2((fract(u)-.5)*cw,dR)/bh;
  float sw=max(.09,aFoot*1.2/bh);
  float g=(1.-smoothstep(sw*.5,sw,faGlyph(q,fpHash12(vec2(cell,R)))))*step(abs(dR),bh+.02);
  float cut=max(groove,g);
  float pulse=.75+.25*sin(faTime*1.3-aAng*2.-R*.7);
  aCut=max(aCut,cut);
  aGlow+=cut*pulse*mix(1.,.55,smoothstep(.03,.12,aFoot))+exp(-dR*dR/.3)*.09;
}
// The sigil at the centre: a six-armed frost star cut into the ice.
{
  float a=mod(aAng+.5235988,1.0471976)-.5235988;
  vec2 q=aR*vec2(cos(a),abs(sin(a)));
  float d=faSeg(q,vec2(.35,0.),vec2(2.25,0.));
  d=min(d,faSeg(q,vec2(1.,0.),vec2(1.45,.38)));
  d=min(d,faSeg(q,vec2(1.6,0.),vec2(1.9,.24)));
  d=min(d,abs(aR-2.6));
  d=min(d,abs(aR-.3));
  float sw=max(.022,aFoot*.6);
  float cut=1.-smoothstep(sw*.5,sw,d);
  aCut=max(aCut,cut);aGlow+=cut*(.6+.2*sin(faTime*.9))+exp(-aR*aR/1.2)*.05;
}
// Frost flowers on the surface; powder blown in from the rim in wind streaks, piled against the rim stones.
float aFrost=smoothstep(.45,.8,fpFbm(vFaW.xz*.42+3.))*.45+smoothstep(17.,21.6,aR+fpFbm(aP*.3)*2.)*.35;
float aStreak=fpNoise(vec2(dot(aP,vec2(.8,.6))*.32,dot(aP,vec2(-.6,.8))*2.1))*.5+.5;
float aDust=smoothstep(18.4,21.7,aR+fpFbm(aP*.22)*2.6)*1.05+aStreak*.4*smoothstep(10.,20.,aR);
float aSnow=smoothstep(.56,.64,aDust+fpNoise(aP*1.3)*.14+fpNoise(aP*4.7)*.05);
// The runes are warm enough to keep their band clear.
for(int i=0;i<3;i++){float dR=aR-faRings[i];aSnow*=smoothstep(.3,.75,abs(dR));}
vec3 aCol=mix(aIce,vec3(.6,.7,.78),aFrost);
aCol*=mix(1.,.55,aCut);
aCol=mix(aCol,vec3(.84,.93,1.),aSnow*(1.-aCut*.6));
diffuseColor.rgb*=aCol;
float aGlowK=aGlow*(1.-aSnow*.35);
`;

const ICE_ROUGH = /* glsl */ `
roughnessFactor=mix(mix(.2,.36,fpNoise(vFaW.xz*.6)*.5+.5),.72,aFrost);
roughnessFactor=mix(roughnessFactor,.92,aSnow);
roughnessFactor=mix(roughnessFactor,.6,aCut);
`;

const ICE_NORMAL = /* glsl */ `
{
  // Snow carries a little height; the ice itself undulates gently.
  float h=smoothstep(.0,1.,aSnow)*.025+fpFbm(vFaW.xz*.35)*.01;
  vec2 dpx=dFdx(vFaW.xz),dpy=dFdy(vFaW.xz);float dsx=dFdx(h),dsy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dsx*dpy.y-dsy*dpx.y,dpx.x*dsy-dpy.x*dsx)/det,-.4,.4):vec2(0.);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

const ICE_LIGHT = /* glsl */ `#include <lights_fragment_end>
reflectedLight.directSpecular=min(reflectedLight.directSpecular,vec3(.2));`;

const ICE_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance+=vec3(.22,.8,1.)*aGlowK*1.15;`;

const ICE_OUT = /* glsl */ `{
  // The sky in the ice, by Fresnel: strong across the floor, gone under snow and frost.
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  float F=.02+.98*pow(1.-clamp(dot(nW,aV),0.,1.),5.);
  outgoingLight+=faEnv(reflect(-aV,nW))*F*(1.-aSnow)*(1.-aFrost*.7)*(1.-aCut*.5)*.8;
}
#include <opaque_fragment>`;

export function frostArena(opts: FrostArenaOptions): FrostArena {
  const root = new THREE.Group(); root.name = 'frostlight-arena-floor';
  const {center, radius} = opts;
  const uniforms = {
    faCenter: {value: center.clone()},
    faRings: {value: new THREE.Vector3(opts.rings[0] ?? 6, opts.rings[1] ?? 13, opts.rings[2] ?? 21.5)},
    faSkyH: {value: opts.skyHorizon},
    faSkyZ: {value: opts.skyZenith},
    faBounce: {value: opts.snowBounce},
    faTime: {value: 0},
    faDetail: {value: 1},
  };
  const iceGeo = new THREE.CircleGeometry(radius + .05, 160); iceGeo.rotateX(-Math.PI / 2);
  const ice = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1});
  ice.name = 'frostlight-arena-ice';
  ice.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFaW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFaW=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ICE_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ICE_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ICE_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${ICE_NORMAL}`)
      .replace('#include <emissivemap_fragment>', ICE_EMISSIVE)
      .replace('#include <lights_fragment_end>', ICE_LIGHT)
      .replace('#include <opaque_fragment>', ICE_OUT);
  };
  ice.customProgramCacheKey = () => 'frostlight-arena-ice';
  const floor = new THREE.Mesh(iceGeo, ice);
  floor.name = 'frostlight-arena-ice'; floor.position.set(center.x, center.y + ICE_LIFT, center.z); floor.receiveShadow = true;
  root.add(floor);

  // Rim: carved granite blocks with a groove along the top, sunk into the snow outside. The main road arrives from
  // the south (angle 0), where two blocks are left out as the way in.
  // Profile across the rim (metres out from the ice edge, metres above the floor): an inner face, a chamfer, a
  // groove along the top, and an outer face that runs down into the snow.
  const profile: [number, number][] = [[-.14, -.02], [-.12, .12], [-.07, .15], [.58, .155], [.64, .13], [.7, .12], [.76, .13], [.82, .155], [1.32, .15], [1.4, .1], [1.6, -.02], [1.9, -.22]];
  const blocks: THREE.BufferGeometry[] = [];
  let seed = 9173;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const count = 40, gap = .0028, steps = 16, gate = [count - 1, 0];
  // Chisel irregularity: a displacement that depends only on position, so shared edges stay closed.
  const chisel = (x: number, y: number, z: number) => {
    const h = (u: number) => { const v = Math.sin(u) * 43758.5453; return v - Math.floor(v) - .5; };
    return [h(x * 12.9898 + z * 78.233 + y * 3.7) * .012, h(x * 39.346 + z * 11.135 + y * 7.1) * .008, h(x * 73.156 + z * 52.235 + y * 1.9) * .012];
  };
  const tint = new THREE.Color();
  const piece = (a0: number, a1: number, prof: [number, number][], r0: number, lift: number, tiltR: number, snow: number) => {
    const pos: number[] = [];
    const at = (a: number, [dr, dy]: [number, number]) => {
      const r = r0 + dr, y = center.y + dy + (dy > 0 ? lift + tiltR * dr : 0), x = center.x + Math.sin(a) * r, z = center.z + Math.cos(a) * r;
      const [cx, cy, cz] = chisel(x, y, z);
      return [x + cx, y + (dy > 0 ? cy : 0), z + cz];
    };
    // Each profile facet is its own strip so the carved edges stay crisp.
    for (let k = 0; k + 1 < prof.length; k++) for (let i = 0; i < steps; i++) {
      const u0 = a0 + (a1 - a0) * i / steps, u1 = a0 + (a1 - a0) * (i + 1) / steps;
      const p00 = at(u0, prof[k]), p01 = at(u0, prof[k + 1]), p10 = at(u1, prof[k]), p11 = at(u1, prof[k + 1]);
      pos.push(...p00, ...p01, ...p10, ...p01, ...p11, ...p10);
    }
    // End faces show the joint between blocks.
    const shape = [...prof, [prof[prof.length - 1][0], -.3], [prof[0][0], -.3]] as [number, number][];
    const tris = THREE.ShapeUtils.triangulateShape(shape.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [a, side] of [[a0, -1], [a1, 1]] as const) for (const t of tris) {
      const [p, q, r] = t.map(id => new THREE.Vector3(...at(a, shape[id])));
      const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p));
      const out = n.x * Math.cos(a) * side - n.z * Math.sin(a) * side > 0;
      for (const v of out ? [p, q, r] : [p, r, q]) pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const n = pos.length / 3;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [tint.r, tint.g, tint.b]), 3));
    g.setAttribute('aGround', new THREE.Float32BufferAttribute(new Array(n).fill(center.y), 1));
    g.setAttribute('aSnow', new THREE.Float32BufferAttribute(new Array(n).fill(snow), 1));
    blocks.push(g);
  };
  for (let b = 0; b < count; b++) {
    const a0 = b / count * Math.PI * 2 + gap, a1 = (b + 1) / count * Math.PI * 2 - gap;
    const lift = (rand() - .5) * .022, tiltR = (rand() - .5) * .02, r0 = radius - .1 + (rand() - .5) * .03;
    tint.setRGB(.13 + rand() * .05, .14 + rand() * .045, .155 + rand() * .045);
    if (!gate.includes(b)) piece(a0, a1, profile, r0, lift, tiltR, .15);
  }
  const rimGeo = mergeGeometries(blocks, false)!;
  blocks.forEach(g => g.dispose());
  const rim = new THREE.Mesh(rimGeo, graniteMaterial('frostlight-arena-rim'));
  rim.name = 'frostlight-arena-rim'; rim.castShadow = true; rim.receiveShadow = true;
  root.add(rim);
  root.userData.stats = {rimBlocks: count - gate.length, gateBlocks: gate.length, rings: [...opts.rings]};
  return {root, update(time, quality) { uniforms.faTime.value = time; uniforms.faDetail.value = quality === 'low' ? 0 : 1; }};
}
