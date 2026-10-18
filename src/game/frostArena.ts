import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {FROST_NOISE,graniteMaterial} from './frostPaving';

/*
 * Boreas's throne floor: a disc of old, thick ice ringed by carved granite. The ice is lit as a surface (so
 * crabs and pillars shadow it) whose albedo looks into its depth: fracture sheets and trapped bubbles are
 * sampled along the refracted view ray, so they slide past each other as the camera moves. The three combat
 * rings are runes cut into the ice with light in the cuts. The sun's highlight is clamped and the sky comes
 * back through Fresnel instead, so the low sun no longer blows the floor out to white.
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
  /** Once a frame while Frostlight shows; 'low' halves the depth samples and drops the bubbles. */
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
// Plates of lake ice: distance to the nearest crack (Voronoi border, metres in cell units) and its outward normal.
float faPlates(vec2 x,out vec2 edgeN){
  vec2 n=floor(x),f=fract(x),mg=vec2(0.),mr=vec2(0.);float md=8.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=vec2(float(i),float(j)),r=g+.1+.8*fpHash22(n+g)-f;float d=dot(r,r);if(d<md){md=d;mr=r;mg=g;}}
  md=8.;edgeN=vec2(1.,0.);
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++){vec2 g=mg+vec2(float(i),float(j)),r=g+.1+.8*fpHash22(n+g)-f,dr=r-mr;
    if(dot(dr,dr)>1e-5){vec2 nn=normalize(dr);float d=dot(.5*(mr+r),nn);if(d<md){md=d;edgeN=nn;}}}
  return md;
}
// A vertical fracture sheet seen along the refracted ray: where the ray meets the sheet, how deep, how bright.
float faSheet(vec2 p,vec2 stepD,float scale,float depth,float seed,float foot){
  vec2 q=p*scale+seed;q+=vec2(fpNoise(q*.7),fpNoise(q*.7+5.))*.22;
  vec2 eN;float J=faPlates(q,eN)/scale;
  float toward=dot(stepD,eN);
  float hit=toward>1e-3?J/toward:(J<.004?0.:1e3);
  float w=max(.006,foot*.7);
  float line=1.-smoothstep(w*.5,w,J);
  float sheet=hit<depth?exp(-hit*2.4/depth)*(.55+.45*fpNoise(vec2(dot(p,vec2(-eN.y,eN.x))*3.,hit*9.)+seed)):0.;
  float k=.35+.65*smoothstep(-.4,.4,fpNoise(p*.23+seed*3.));
  return max(line*(.5+.5*k),sheet*.62*k);
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
float aNV=clamp(aV.y,0.,1.);
float aFoot=length(fwidth(vFaW.xz));
// Depth: fracture sheets of two sizes meet the refracted ray; a deep layer slides under them.
vec3 aRf=refract(-aV,vec3(0.,1.,0.),.763);
vec2 aStep=aRf.xz/max(-aRf.y,.25);
float aCr=faSheet(vFaW.xz,aStep,.27,.9,0.,aFoot);
float aFine=smoothstep(.2,.55,fpNoise(vFaW.xz*.13+7.));
if(faDetail>.5&&aFine>0.)aCr=max(aCr,faSheet(vFaW.xz,aStep,.85,.3,11.,aFoot)*aFine*.55);
float aDeep=fpFbm((vFaW.xz+aStep*1.6)*.35);
// Bubbles caught in the ice in clusters, at two depths.
float aBub=0.;
float aCluster=smoothstep(.15,.5,fpFbm(vFaW.xz*.2+9.));
if(faDetail>.5&&aCluster>0.){
  for(int k=0;k<2;k++){
    float d=.06+float(k)*.2;
    vec2 q=(vFaW.xz+aStep*d)*5.+float(k)*13.7;
    vec2 id=floor(q),f=fract(q)-.5,h=fpHash22(id);
    if(h.x>.55){vec2 o=(fpHash22(id+5.3)-.5)*.5;float r=.04+.12*h.y*h.y,dd=length(f-o);
      aBub+=(smoothstep(r,r*.4,dd)*.3+smoothstep(r*.75,r,dd)*smoothstep(r*1.15,r,dd)*.7)*exp(-d*2.5);}
  }
  aBub*=aCluster*(1.-smoothstep(.012,.04,aFoot));
}
// Thickness varies: dark blue where it is deep, milky where air froze in.
float aMilk=smoothstep(-.2,.6,fpFbm(vFaW.xz*.09+2.));
vec3 aIce=mix(vec3(.012,.05,.085),vec3(.05,.15,.2),aMilk*.7+.15*(1.-aNV)+aDeep*.25);
aIce+=vec3(.36,.56,.66)*aCr+vec3(.5,.7,.8)*aBub*.5;
// Rune rings: two cut grooves either side of a band of runes, and a faint halo so they read from afar.
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
  aGlow+=cut*pulse*mix(1.,.55,smoothstep(.03,.12,aFoot))+exp(-dR*dR/.35)*.07;
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
  aCut=max(aCut,cut);aGlow+=cut*(.6+.2*sin(faTime*.9));
}
// Frost flowers on the surface, powder blown in from the rim in wind streaks.
float aFrost=smoothstep(.42,.78,fpFbm(vFaW.xz*.42+3.))*.5;
float aStreak=fpNoise(vec2(dot(aP,vec2(.8,.6))*.32,dot(aP,vec2(-.6,.8))*2.1))*.5+.5;
float aDust=smoothstep(18.,22.4,aR+fpFbm(aP*.22)*3.)*.85+aStreak*.4*smoothstep(9.,20.,aR);
float aSnow=smoothstep(.5,.72,aDust+fpNoise(aP*2.9)*.12);
// The runes are warm enough to keep their band clear.
for(int i=0;i<3;i++){float dR=aR-faRings[i];aSnow*=smoothstep(.3,.75,abs(dR));}
vec3 aCol=mix(aIce,vec3(.62,.72,.8),aFrost);
aCol*=mix(1.,.55,aCut);
aCol=mix(aCol,vec3(.84,.92,.99),aSnow*(1.-aCut*.6));
diffuseColor.rgb*=aCol;
float aGlowK=aGlow*(1.-aSnow*.35);
`;

const ICE_ROUGH = /* glsl */ `
roughnessFactor=mix(mix(.36,.5,fpNoise(vFaW.xz*.6)*.5+.5),.72,aFrost);
roughnessFactor=mix(roughnessFactor,.9,aSnow);
roughnessFactor=mix(roughnessFactor,.65,aCut);
`;

const ICE_NORMAL = /* glsl */ `
{
  // Snow drifts carry a little height; the ice itself undulates gently.
  float h=aSnow*.02+fpFbm(vFaW.xz*.35)*.012;
  vec2 dpx=dFdx(vFaW.xz),dpy=dFdy(vFaW.xz);float dsx=dFdx(h),dsy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dsx*dpy.y-dsy*dpx.y,dpx.x*dsy-dpy.x*dsx)/det,-.4,.4):vec2(0.);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

const ICE_LIGHT = /* glsl */ `#include <lights_fragment_end>
reflectedLight.directSpecular=min(reflectedLight.directSpecular,vec3(.22));`;

const ICE_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance+=vec3(.22,.8,1.)*aGlowK*1.15;`;

const ICE_OUT = /* glsl */ `{
  // The sky in the ice, by Fresnel: strong across the floor, gone under snow and frost.
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  float F=.02+.98*pow(1.-clamp(dot(nW,aV),0.,1.),5.);
  outgoingLight+=faEnv(reflect(-aV,nW))*F*(1.-aSnow)*(1.-aFrost*.7)*(1.-aCut*.5)*.85;
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
  const ice = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1});
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

  // Rim: carved granite blocks with a groove along the top, sunk into the snow outside.
  // Profile across the rim (metres out from the ice edge, metres above the floor): an inner face, a chamfer, a
  // groove along the top, and an outer face that runs down into the snow.
  const profile: [number, number][] = [[-.14, -.02], [-.12, .1], [-.07, .13], [.58, .135], [.64, .11], [.7, .1], [.76, .11], [.82, .135], [1.32, .13], [1.4, .09], [1.6, -.02], [1.9, -.2]];
  const blocks: THREE.BufferGeometry[] = [];
  let seed = 9173;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const count = 40, gap = .0028, steps = 8;
  const tint = new THREE.Color();
  for (let b = 0; b < count; b++) {
    const a0 = b / count * Math.PI * 2 + gap, a1 = (b + 1) / count * Math.PI * 2 - gap;
    const lift = (rand() - .5) * .022, tiltR = (rand() - .5) * .02, r0 = radius - .1 + (rand() - .5) * .03;
    tint.setRGB(.19 + rand() * .07, .195 + rand() * .06, .21 + rand() * .05);
    const pos: number[] = [];
    const at = (a: number, [dr, dy]: [number, number]) => {
      const r = r0 + dr, y = center.y + dy + (dy > 0 ? lift + tiltR * dr : 0);
      return [center.x + Math.sin(a) * r, y, center.z + Math.cos(a) * r];
    };
    // Each profile facet is its own strip so the carved edges stay crisp.
    for (let k = 0; k + 1 < profile.length; k++) for (let i = 0; i < steps; i++) {
      const u0 = a0 + (a1 - a0) * i / steps, u1 = a0 + (a1 - a0) * (i + 1) / steps;
      const p00 = at(u0, profile[k]), p01 = at(u0, profile[k + 1]), p10 = at(u1, profile[k]), p11 = at(u1, profile[k + 1]);
      pos.push(...p00, ...p01, ...p10, ...p01, ...p11, ...p10);
    }
    // End faces show the joint between blocks.
    const shape = [...profile, [profile[profile.length - 1][0], -.3], [profile[0][0], -.3]] as [number, number][];
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
    g.setAttribute('aSnow', new THREE.Float32BufferAttribute(new Array(n).fill(.15), 1));
    blocks.push(g);
  }
  const rimGeo = mergeGeometries(blocks, false)!;
  blocks.forEach(g => g.dispose());
  const rim = new THREE.Mesh(rimGeo, graniteMaterial('frostlight-arena-rim'));
  rim.name = 'frostlight-arena-rim'; rim.castShadow = true; rim.receiveShadow = true;
  root.add(rim);
  root.userData.stats = {rimBlocks: count, rings: [...opts.rings]};
  return {root, update(time, quality) { uniforms.faTime.value = time; uniforms.faDetail.value = quality === 'low' ? 0 : 1; }};
}
