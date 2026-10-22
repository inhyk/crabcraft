import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {FROST_NOISE,graniteMaterial} from './frostPaving';

/*
 * Boreas's throne floor: a disc of old lake ice a metre thick, ringed by carved granite. It is lit as a surface (so
 * crabs and pillars shadow it) whose albedo looks down into its depth: every fracture of the crack web is a
 * vertical sheet the refracted view ray meets analytically, so the sheets open and slide as the camera moves, a
 * milky layer half a metre down drifts against them, and columns of trapped bubbles stack under each other. The three combat rings are runes cut into the ice with
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
  /** Once a frame while Frostlight shows; 'low' drops the branch cracks, the fine hairline web and the bubbles. */
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
// The crack web, baked on the CPU (frostArena below): a grid that lists, per cell, the cracks whose sheets a ray
// entering there can meet (8 ids, -1 ends the list), and the cracks themselves (ends; depth, weight, fine).
uniform sampler2D faGrid;
uniform sampler2D faCracks;
uniform vec4 faGridInfo;
varying vec3 vFaW;
vec3 faEnv(vec3 d){
  if(d.y<0.)return faBounce*(.55+.45*smoothstep(-1.,0.,d.y));
  return mix(faSkyH,faSkyZ,smoothstep(0.,.6,d.y));
}
// One fracture: a vertical sheet standing on segment a-b, reaching depth D. The refracted ray from p moves by st
// per metre of depth, so it meets the sheet's plane at one depth, analytically: the sheet is continuous and slides
// with the view. trace is the hairline where the sheet breaks the surface.
void faSheet(vec2 p,vec2 a,vec2 b,float D,float w,vec2 st,float foot,inout float sheet,inout float trace){
  // Cheap reject first (no square roots): too far from the line, or past either end, for the ray to reach it.
  vec2 ab=b-a,ap=p-a;float l2=dot(ab,ab),reach=D*length(st)+foot*1.6+.003,cr=ab.x*ap.y-ab.y*ap.x,ta=dot(ap,ab);
  if(cr*cr>reach*reach*l2||ta<-reach*sqrt(l2)||ta>l2+reach*sqrt(l2))return;
  float L=sqrt(l2);vec2 dir=ab/L,n=vec2(-dir.y,dir.x);
  float s=dot(ap,n),t=dot(ap,dir),ds=length(ap-dir*clamp(t,0.,L)),tw=foot*1.6+.003;
  if(ds<tw)trace=max(trace,(1.-smoothstep(foot*.6,tw,ds))*w*(.55+.45*fpNoise(vec2(t*.7,w*31.))));
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
// The cracks a ray entering at p can meet, nearest first: the web of straight fractures, the star struck out from
// the sigil, and (high quality) the fine hairline web in patches.
void faCrackField(vec2 p,vec2 st,float foot,float detail,out float sheet,out float trace){
  sheet=0.;trace=0.;
  ivec2 gi=ivec2(floor((p-faGridInfo.xy)/faGridInfo.z));int n=int(faGridInfo.w);
  if(gi.x<0||gi.y<0||gi.x>=n||gi.y>=n)return;
  vec4 ids[2];ids[0]=texelFetch(faGrid,ivec2(gi.x*2,gi.y),0);ids[1]=texelFetch(faGrid,ivec2(gi.x*2+1,gi.y),0);
  for(int k=0;k<8;k++){
    float id=ids[k/4][k%4];
    if(id<0.)break;
    vec4 info=texelFetch(faCracks,ivec2(int(id),1),0);
    if(info.z>.5&&detail<.5)continue;
    vec4 c=texelFetch(faCracks,ivec2(int(id),0),0);
    faSheet(p,c.xy,c.zw,info.x,info.y,st,foot,sheet,trace);
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
vec2 aMq=(vFaW.xz+aStep*.5)*.075+2.;
float aMilk=smoothstep(-.25,.7,fpNoise(aMq)*.7+fpNoise(aMq*2.1+3.)*.3);
vec3 aIce=mix(vec3(.004,.022,.036),vec3(.045,.12,.155),aMilk*.7);
float aSheet,aTrace;
faCrackField(vFaW.xz,aStep,aFoot,faDetail,aSheet,aTrace);
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
  float bh=bw-.08,g=0.;
  if(abs(dR)<bh+.02){
    vec2 q=vec2((fract(u)-.5)*cw,dR)/bh;
    float sw=max(.09,aFoot*1.2/bh);
    g=1.-smoothstep(sw*.5,sw,faGlyph(q,fpHash12(vec2(cell,R))));
  }
  float cut=max(groove,g);
  float pulse=.75+.25*sin(faTime*1.3-aAng*2.-R*.7);
  aCut=max(aCut,cut);
  aGlow+=cut*pulse*mix(1.,.55,smoothstep(.03,.12,aFoot))+exp(-dR*dR/.3)*.09;
}
// The sigil at the centre: a six-armed frost star cut into the ice.
if(aR<3.){
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
float aFrost=smoothstep(.45,.8,fpNoise(vFaW.xz*.42+3.)*.7+fpNoise(vFaW.xz*.9+5.)*.3)*.45+smoothstep(17.,21.6,aR+fpNoise(aP*.3)*2.)*.35;
float aStreak=fpNoise(vec2(dot(aP,vec2(.8,.6))*.32,dot(aP,vec2(-.6,.8))*2.1))*.5+.5;
float aDust=smoothstep(18.4,21.7,aR+fpNoise(aP*.22)*2.6)*1.05+aStreak*.4*smoothstep(10.,20.,aR);
// The drift thins out over a hand's width into a grainy fringe of powder (the grain fades before it can alias), not
// a cut edge with a rim of shade round it.
float aSnow=smoothstep(.5,.72,aDust+fpNoise(aP*1.3)*.14+fpNoise(aP*4.7)*.05+fpNoise(aP*17.)*.06*(1.-smoothstep(.015,.05,aFoot)));
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
  float h=smoothstep(.35,1.,aSnow)*.022+fpNoise(vFaW.xz*.35)*.01;
  vec2 dpx=dFdx(vFaW.xz),dpy=dFdy(vFaW.xz);float dsx=dFdx(h),dsy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dsx*dpy.y-dsy*dpx.y,dpx.x*dsy-dpy.x*dsx)/det,-.4,.4):vec2(0.);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

const ICE_LIGHT = /* glsl */ `#include <lights_fragment_end>
{
  // The sun's highlight rolls off softly to .2, scaled as a whole so it keeps the sun's hue: clamped per channel,
  // the gold glare's edge split into bands (blue clipped first, then green, then red) and read as a rainbow.
  vec3 s=reflectedLight.directSpecular;float m=max(max(s.r,s.g),s.b);
  float k=m<.12?m:.12+.08*(1.-exp(-(m-.12)/.08));
  reflectedLight.directSpecular=s*(k/max(m,1e-5));
}`;

const ICE_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
// The runes burn in the aurora's colours: teal, drifting slowly to violet round each ring.
float aHue=smoothstep(.25,.95,sin(aAng*2.+aR*.35-faTime*.21)*.5+.5);
totalEmissiveRadiance+=mix(vec3(.22,.8,1.),vec3(.62,.36,1.05),aHue*.75)*aGlowK*1.15;`;

const ICE_OUT = /* glsl */ `{
  // The sky in the ice, by Fresnel: strong across the floor, gone under snow and frost.
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  float F=.02+.98*pow(1.-clamp(dot(nW,aV),0.,1.),5.);
  outgoingLight+=faEnv(reflect(-aV,nW))*F*(1.-aSnow)*(1.-aFrost*.7)*(1.-aCut*.5)*.8;
}
#include <opaque_fragment>`;

interface Crack { ax: number; az: number; bx: number; bz: number; depth: number; weight: number; fine: boolean }
/** Grid step of the crack lookup, metres, and how many cracks a cell lists. */
const GRID = .5, SLOTS = 8;
/** Farthest a refracted ray drifts sideways inside the ice before a sheet fades (depth x the steepest step). */
const REACH_SIDE = 1.15 * 1.4;

/**
 * The crack web of the arena ice, generated once: straight fractures joining jittered nodes (some links left out,
 * so it never closes into tiles), seven cracks struck out from the sigil, three great cracks in from the rim, and
 * a fine shallow web in patches.
 * Baked into a lookup grid so the shader tests only the few cracks near each pixel.
 */
function crackWeb(center: THREE.Vector3, radius: number) {
  const h2 = (x: number, z: number, salt: number) => { const v = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453; return v - Math.floor(v); };
  const cracks: Crack[] = [];
  const near = (x: number, z: number, pad: number) => Math.hypot(x - center.x, z - center.z) < radius + pad;
  const web = (size: number, salt: number, link: number, depth: () => number, fine: boolean, keep: (x: number, z: number) => boolean) => {
    const node = (i: number, j: number) => [(i + .15 + .7 * h2(i, j, salt)) * size, (j + .15 + .7 * h2(i, j, salt + 1)) * size];
    const i0 = Math.floor((center.x - radius) / size) - 1, i1 = Math.floor((center.x + radius) / size) + 1;
    const j0 = Math.floor((center.z - radius) / size) - 1, j1 = Math.floor((center.z + radius) / size) + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [ax, az] = node(i, j);
      if (!near(ax, az, size) || !keep(ax, az)) continue;
      const w = .45 + .55 * h2(i, j, salt + 2), d = depth();
      for (const [di, dj, p, dd, ww] of [[1, 0, link, 1, w], [0, 1, link, .8, 1.45 - w], [1, 1, link * .36, .6, .7]] as const) {
        if (h2(i, j, salt + 3 + di + dj * 2) >= p) continue;
        const [bx, bz] = node(i + di, j + dj);
        cracks.push({ax, az, bx, bz, depth: d * dd, weight: fine ? .55 : ww, fine});
      }
    }
  };
  let seed = 5179;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  web(5.4, 3, .5, () => .3 + .8 * rand(), false, () => true);
  // The star struck out from the sigil: seven cracks from its rim, each kinking once.
  for (let i = 0; i < 7; i++) {
    const a = (i + rand() * .6) / 7 * Math.PI * 2, r1 = 4.6 + 5.5 * rand(), k = (rand() - .5) * .6, r0 = 2.75, rm = (r0 + r1) / 2;
    const mx = center.x + Math.cos(a) * rm, mz = center.z + Math.sin(a) * rm;
    cracks.push({ax: center.x + Math.cos(a) * r0, az: center.z + Math.sin(a) * r0, bx: mx, bz: mz, depth: .6, weight: 1, fine: false});
    cracks.push({ax: mx, az: mz, bx: mx + Math.cos(a + k) * (r1 - r0) / 2, bz: mz + Math.sin(a + k) * (r1 - r0) / 2, depth: .4, weight: .8, fine: false});
  }
  // Three great cracks run in from the rim, the first across the south half where the road comes in.
  for (const pts of [[[21, 76], [14, 96], [6.5, 108]], [[21.2, 205], [13, 186], [8, 168]], [[20.6, 312], [12.5, 330], [7, 318]]]) {
    for (let k = 1; k < pts.length; k++) {
      const [r0, a0] = pts[k - 1], [r1, a1] = pts[k], d = Math.PI / 180;
      cracks.push({ax: center.x + Math.cos(a0 * d) * r0, az: center.z + Math.sin(a0 * d) * r0, bx: center.x + Math.cos(a1 * d) * r1, bz: center.z + Math.sin(a1 * d) * r1, depth: 1.05, weight: 1, fine: false});
    }
  }
  // Hairlines only in patches (a coarse value noise), shallow.
  const patch = (x: number, z: number) => { const u = x / 9, v = z / 9, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv, s = (t: number) => t * t * (3 - 2 * t);
    const a = h2(iu, iv, 9), b = h2(iu + 1, iv, 9), c = h2(iu, iv + 1, 9), d = h2(iu + 1, iv + 1, 9);
    return a + (b - a) * s(fu) + (c - a) * s(fv) + (a - b - c + d) * s(fu) * s(fv); };
  web(1.3, 11, .15, () => .1 + .03 * rand(), true, (x, z) => patch(x, z) > .66);
  if (cracks.length > 1024) cracks.length = 1024;
  // Lookup grid over the disc: for each cell the nearest cracks (big ones first) within reach of its centre.
  const n = Math.ceil((radius * 2 + 2) / GRID), ox = center.x - n * GRID / 2, oz = center.z - n * GRID / 2;
  const lists: {id: number; d: number; fine: boolean}[][] = Array.from({length: n * n}, () => []);
  const reachOf = (c: Crack) => c.depth * REACH_SIDE + GRID * .75 + .05;
  cracks.forEach((c, id) => {
    const r = reachOf(c), gx0 = Math.max(0, Math.floor((Math.min(c.ax, c.bx) - r - ox) / GRID)), gx1 = Math.min(n - 1, Math.floor((Math.max(c.ax, c.bx) + r - ox) / GRID));
    const gz0 = Math.max(0, Math.floor((Math.min(c.az, c.bz) - r - oz) / GRID)), gz1 = Math.min(n - 1, Math.floor((Math.max(c.az, c.bz) + r - oz) / GRID));
    const dx = c.bx - c.ax, dz = c.bz - c.az, l2 = dx * dx + dz * dz;
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const px = ox + (gx + .5) * GRID, pz = oz + (gz + .5) * GRID, t = Math.max(0, Math.min(1, ((px - c.ax) * dx + (pz - c.az) * dz) / l2));
      const d = Math.hypot(c.ax + dx * t - px, c.az + dz * t - pz);
      if (d < r) lists[gz * n + gx].push({id, d, fine: c.fine});
    }
  });
  const gridData = new Float32Array(n * 2 * n * 4).fill(-1);
  let dropped = 0, maxList = 0;
  lists.forEach((l, k) => {
    l.sort((a, b) => Number(a.fine) - Number(b.fine) || a.d - b.d);
    maxList = Math.max(maxList, l.length); dropped += Math.max(0, l.length - SLOTS);
    const gx = k % n, gz = Math.floor(k / n);
    l.slice(0, SLOTS).forEach((e, s) => { gridData[((gz * n * 2) + gx * 2 + (s >> 2)) * 4 + (s & 3)] = e.id; });
  });
  const crackData = new Float32Array(cracks.length * 2 * 4);
  cracks.forEach((c, i) => { crackData.set([c.ax, c.az, c.bx, c.bz], i * 4); crackData.set([c.depth, c.weight, c.fine ? 1 : 0, 0], (cracks.length + i) * 4); });
  const tex = (data: Float32Array, w: number, h: number) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  return {grid: tex(gridData, n * 2, n), cracks: tex(crackData, cracks.length, 2), info: new THREE.Vector4(ox, oz, GRID, n),
    stats: {cracks: cracks.length, fine: cracks.filter(c => c.fine).length, gridCells: n * n, maxList, dropped}};
}

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
    faGrid: {value: null as THREE.DataTexture | null},
    faCracks: {value: null as THREE.DataTexture | null},
    faGridInfo: {value: new THREE.Vector4()},
  };
  const web = crackWeb(center, radius);
  uniforms.faGrid.value = web.grid; uniforms.faCracks.value = web.cracks; uniforms.faGridInfo.value.copy(web.info);
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
  // Drawn before the snowfield, so the terrain under the disc fails the depth test instead of being shaded.
  floor.renderOrder = -1;
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
  root.userData.stats = {rimBlocks: count - gate.length, gateBlocks: gate.length, rings: [...opts.rings], ...web.stats};
  return {root, update(time, quality) { uniforms.faTime.value = time; uniforms.faDetail.value = quality === 'low' ? 0 : 1; }};
}
