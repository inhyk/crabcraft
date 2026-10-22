import * as THREE from 'three';
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {type Kit,loadKit} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {snowCover,snowMass} from './snowCover';

/*
 * Frostlight's carved stone, banked snow and aurora runes, shared by the quest props (frostRequests.ts) and the
 * gateways (frostPortal.ts): dressed granite in world space (so merged and batched pieces need no UVs) under the
 * same settling snow as the village; lumpy drifts that bury every foot; rune glyphs cut into a face as a decal
 * whose groove stays when the glow goes out.
 */

/** Deterministic 0..1 stream: the props dress the same for every player. */
export function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}

// Small 3D value noise for the CPU shapes.
function hash3(x:number,y:number,z:number,s:number){let h=Math.imul(x,0x27d4eb2d)^Math.imul(y,0x165667b1)^Math.imul(z,0x1b873593)^Math.imul(s,0x9e3779b1);h=Math.imul(h^(h>>>15),0x2c1b3c6d);h=Math.imul(h^(h>>>12),0x297a2d39);return ((h^(h>>>15))>>>0)/4294967296;}
export function noise3(x:number,y:number,z:number,s=0){
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz,q=(t:number)=>t*t*(3-2*t),ux=q(fx),uy=q(fy),uz=q(fz);
 let out=0;
 for(let k=0;k<8;k++){const dx=k&1,dy=k>>1&1,dz=k>>2;out+=(dx?ux:1-ux)*(dy?uy:1-uy)*(dz?uz:1-uz)*hash3(ix+dx,iy+dy,iz+dz,s);}
 return out;
}

/** Shared kit loads: one parse per file for all of Frostlight's props. */
const kits=new Map<string,Promise<Kit>>();
export function kitOnce(path:string){let k=kits.get(path);if(!k)kits.set(path,k=loadKit(path));return k;}

/** A kit material cloned for the snow: matte unless metal, culled unless cloth, snow on what faces up (as snowVillage.ts). */
export function snowyKit(m:THREE.Material,cover=1){
 const v=m.clone() as THREE.MeshStandardMaterial;
 if(!/Metal/.test(m.name)){v.metalness=0;v.metalnessMap=null;}
 if(!/Cloth|Vine|Leaves|Flowers/.test(m.name))v.side=THREE.FrontSide;
 stylise(v,.98,[1.0,.99,.98]);snowCover(v,{cover});
 return v;
}

const STONE_HEAD=/* glsl */`
varying vec3 vStoneW;
float fsH13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float fsN3(vec3 p){vec3 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);vec2 k=vec2(0.,1.);
 return mix(mix(mix(fsH13(i),fsH13(i+k.yxx),u.x),mix(fsH13(i+k.xyx),fsH13(i+k.yyx),u.x),u.y),
            mix(mix(fsH13(i+k.xxy),fsH13(i+k.yxy),u.x),mix(fsH13(i+k.xyy),fsH13(i+k.yyy),u.x),u.y),u.z);}
#define FS_GRAIN(p) (fsN3((p)*7.)*.55+fsN3((p)*19.+3.7)*.3+abs(fsN3((p)*3.1)-.5)*.3)
`;

export interface StoneOptions {
 /** Dark and light ends of the stone's mottling, sRGB. */
 dark?:THREE.ColorRepresentation;
 light?:THREE.ColorRepresentation;
 /** Snow on what faces up (snowCover.ts). */
 cover?:number;
 /** Lay the up-facing faces as rings of paving slabs this wide round the mesh's own origin (a round floor). */
 rings?:number;
}

/**
 * Dressed granite: cool grey mottling, pale feldspar and dark hornblende specks, a chisel grain in the normal that
 * fades under snow and with distance. Vertex colour, if any, is occlusion. The snow is the village's own.
 */
export function frostStone(opts:StoneOptions={}){
 const dark=new THREE.Color(opts.dark??'#353d49'),light=new THREE.Color(opts.light??'#646d79');
 const m=new THREE.MeshStandardMaterial({name:'frostlight-carved-stone',color:'#ffffff',roughness:.86,metalness:0,vertexColors:true});
 const rings=opts.rings??0;
 // Snow first in the chain: its block runs after the stone's, so it settles over the colour the stone sets.
 snowCover(m,{cover:opts.cover??1});
 addPatch(m,`frost-stone${dark.getHexString()}${light.getHexString()}${rings}`,shader=>{
  shader.uniforms.uStoneDark={value:dark};shader.uniforms.uStoneLight={value:light};
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vStoneW;\nvarying vec2 vStoneO;')
   .replace('#include <project_vertex>','#include <project_vertex>\nvStoneW = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz + cameraPosition;\nvStoneO = position.xz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform vec3 uStoneDark;\nuniform vec3 uStoneLight;\nvarying vec2 vStoneO;\n${STONE_HEAD}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     vec3 sw = vStoneW;
     float mott = fsN3(sw * 1.3) * 0.6 + fsN3(sw * 3.7 + 3.1) * 0.4;
     float grain = fsN3(sw * 23.0);
     float speck = smoothstep(0.74, 0.9, fsN3(sw * 41.0 + 7.0));
     float horn = smoothstep(0.76, 0.93, fsN3(sw * 37.0 - 5.0));
     vec3 c = mix(uStoneDark, uStoneLight, clamp(mott * 1.35 - 0.18, 0.0, 1.0));
     c *= (0.86 + 0.28 * grain) * (1.0 - horn * 0.4);
     c += speck * 0.045;
     ${rings?`{
      // Rings of slabs round the origin, each slab its own tone, dark open joints between.
      float up = smoothstep(0.7, 0.9, normalize(vSnowN).y), r = length(vStoneO), ring = floor(r / ${rings.toFixed(3)});
      float n = max(6.0, floor(6.2832 * (ring + 0.5) * ${rings.toFixed(3)} / 0.95)), a = (atan(vStoneO.y, vStoneO.x) / 6.2832 + 0.5) * n + ring * 0.37;
      float fr = fract(r / ${rings.toFixed(3)}), fa = fract(a);
      float edge = min(min(fr, 1.0 - fr) * ${rings.toFixed(3)}, min(fa, 1.0 - fa) * 6.2832 * max(r, 0.3) / n);
      float slab = fsH13(vec3(ring, floor(a), 3.1));
      c *= mix(1.0, (0.8 + 0.4 * slab) * (1.0 - 0.72 * (1.0 - smoothstep(0.012, 0.03, edge))), up * step(0.45, r));
     }`:''}
     diffuseColor.rgb *= c;
    }`)
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    {
     float fade = (1.0 - ccSnow * 0.9) * (1.0 - smoothstep(9.0, 30.0, length(vViewPosition)));
     if (fade > 0.01) {
      vec3 n = inverseTransformDirection(normal, viewMatrix), q = vStoneW;
      float e = 0.02, b0 = FS_GRAIN(q);
      vec3 gw = vec3(FS_GRAIN(q + vec3(e, 0.0, 0.0)) - b0, FS_GRAIN(q + vec3(0.0, e, 0.0)) - b0, FS_GRAIN(q + vec3(0.0, 0.0, e)) - b0) / e;
      vec3 nw = normalize(n - (gw - dot(gw, n) * n) * 0.035 * fade);
      normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
     }
    }`);
 });
 return m;
}

/**
 * Snow banked round the feet of props (snowMass), vertex colour as occlusion. Free-standing banks meet the open
 * snowfield, so they take its white and sheen rather than the village's packed wall drifts.
 */
export function driftMaterial(){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-prop-drift',color:'#ffffff',roughness:.66,vertexColors:true});snowMass(m,{lumps:.7});
 return m;
}

/** Give a geometry a uniform occlusion colour if it has none (vertex-coloured materials read black without one). */
export function shade(g:THREE.BufferGeometry,o=1){
 if(g.getAttribute('color'))return g;
 const n=g.getAttribute('position').count,a=new Float32Array(n*3).fill(o);
 g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;
}

/**
 * A runestone: a flat slab with a worn, uneven outline (broad foot, a shoulder, the crown off centre), its faces
 * dressed flat to carry a carving and its edges rounded. Foot at y=0, faces at z = +-depth/2.
 */
export function runestone(seed:number,w:number,h:number,depth:number){
 const R=stream(seed*613+5),j=(v:number,k=.06)=>v+(R()-.5)*k;
 const pts=[[-.5,0],[.5,0],[j(.52),j(.42,.1)],[j(.44),j(.74,.08)],[j(.2,.12),j(.95,.05)],[j(-.08,.12),1],[j(-.34),j(.86,.08)],[j(-.5),j(.5,.1)]].map(([x,y])=>new THREE.Vector2(x*w,y*h));
 const shape=new THREE.Shape();shape.moveTo(pts[0].x,pts[0].y);shape.lineTo(pts[1].x,pts[1].y);
 shape.splineThru([...pts.slice(2),new THREE.Vector2(pts[0].x,pts[0].y+.02)]);
 const bevel=Math.min(.07,depth*.22);
 const g=new THREE.ExtrudeGeometry(shape,{depth:depth-2*bevel,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:6});
 g.translate(0,0,-(depth-2*bevel)/2);g.deleteAttribute('uv');
 // Indexed, so runestones merge with each other; hard edges keep their split normals.
 const m=mergeVertices(g);g.dispose();
 const pos=m.getAttribute('position'),occ=new Float32Array(pos.count*3);
 for(let i=0;i<pos.count;i++){const o=.55+.45*THREE.MathUtils.smoothstep(pos.getY(i)/h,0,.35);occ.set([o,o,o],i*3);}
 m.setAttribute('color',new THREE.BufferAttribute(occ,3));
 return m;
}

export type Ground=(x:number,z:number)=>number;
export interface Bank {geometry:THREE.BufferGeometry;
 /** The bank's height over the ground at a world point, 0 off it: decals on the snow ride over it. */
 lift:Ground}
/**
 * Snow banked round a footprint (world circles `x,z,r`), highest against them and feathered into the ground over
 * `reach`; under a body it drops below the ground, so a low body (a dais) is never poked through. Contact shade in
 * vertex colour.
 */
export function driftBank(bodies:readonly {x:number;z:number;r:number}[],ground:Ground,opts:{reach?:number;height?:number;seed?:number}={}):Bank{
 const reach=opts.reach??.9,H=opts.height??.28,seed=opts.seed??1;
 let cx=0,cz=0,far=0;for(const b of bodies){cx+=b.x/bodies.length;cz+=b.z/bodies.length;}
 for(const b of bodies)far=Math.max(far,Math.hypot(b.x-cx,b.z-cz)+b.r);
 const outer=far+reach;
 const edge=(x:number,z:number)=>{let d=Infinity;for(const b of bodies)d=Math.min(d,Math.hypot(x-b.x,z-b.z)-b.r);return d;};
 const height=(x:number,z:number,d:number)=>{
  const lump=.7+.6*noise3(x*1.7,z*1.7,0,seed),k=THREE.MathUtils.smoothstep(d,-.3,0);
  return d<0?H*lump*k-.25*(1-k):H*lump*Math.pow(1-THREE.MathUtils.clamp(d/reach,0,1),1.6);
 };
 const nR=12,nA=40,pos:number[]=[],col:number[]=[],idx:number[]=[];
 for(let i=0;i<=nR;i++)for(let j=0;j<nA;j++){
  const a=j/nA*Math.PI*2,r=outer*i/nR,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,d=edge(x,z);
  // A hair under the snowfield at its rim, so the bank runs out into the drift rather than ending on it.
  pos.push(x,ground(x,z)+(i===nR?0:height(x,z,d))-.025,z);
  const o=d<.25?.72+.28*THREE.MathUtils.smoothstep(d,-.05,.25):1;col.push(o,o,o);
 }
 for(let i=0;i<nR;i++)for(let j=0;j<nA;j++){const a=i*nA+j,b=i*nA+(j+1)%nA,c=a+nA,d=b+nA;idx.push(a,b,c,b,d,c);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();
 return {geometry:g,lift:(x,z)=>{if(Math.hypot(x-cx,z-cz)>=outer)return 0;const d=edge(x,z);return Math.max(0,height(x,z,d)-.025);}};
}

const RUNE_VERT=/* glsl */`
attribute vec3 aRune; // x glyph, y seed, z node
varying vec2 vUv;
varying vec3 vRune;
#include <fog_pars_vertex>
void main(){
 vUv=uv;vRune=aRune;
 vec4 mvPosition=modelViewMatrix*vec4(position,1.);
 gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const RUNE_FRAG=/* glsl */`
uniform float uTime;
uniform float uGlow[24];
uniform vec3 uGroove;
varying vec2 vUv;
varying vec3 vRune;
#include <fog_pars_fragment>
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
// Elder-futhark-like strokes in a 1 x 1.6 cell; 0 is the full seal: rings, ticks and a sigil; 7 a floor ring.
float glyph(vec2 p,int g){
 if(g==7){
  float r=length(p),d=min(abs(r-.93),abs(r-.79));
  float a=atan(p.y,p.x),k=floor(a/.5236+.5)*.5236,k2=(floor(a/.5236)+.5)*.5236;
  d=min(d,seg(p,vec2(cos(k),sin(k))*.8,vec2(cos(k),sin(k))*.92));
  return min(d,length(p-vec2(cos(k2),sin(k2))*.86)-.014);
 }
 if(g==0){
  float r=length(p),d=min(abs(r-.86),abs(r-.68));
  float a=atan(p.y,p.x),k=floor(a/.7854+.5)*.7854;vec2 t=vec2(cos(k),sin(k));
  d=min(d,seg(p,t*.7,t*.84));
  d=min(d,seg(p,vec2(0.,-.5),vec2(0.,.52)));
  d=min(d,min(seg(p,vec2(0.,.05),vec2(-.34,.42)),seg(p,vec2(0.,.05),vec2(.34,.42))));
  d=min(d,min(seg(p,vec2(0.,-.22),vec2(-.3,.1)),seg(p,vec2(0.,-.22),vec2(.3,.1))));
  return d;
 }
 p.y*=1.6;
 float d=1e3;
 if(g==1){d=seg(p,vec2(0.,-.8),vec2(0.,.8));d=min(d,min(seg(p,vec2(-.42,.36),vec2(0.,.8)),seg(p,vec2(.42,.36),vec2(0.,.8))));}
 else if(g==2){d=seg(p,vec2(0.,-.8),vec2(0.,.8));d=min(d,min(seg(p,vec2(0.,.1),vec2(-.42,.72)),seg(p,vec2(0.,.1),vec2(.42,.72))));}
 else if(g==3){d=seg(p,vec2(-.25,-.8),vec2(-.25,.8));d=min(d,min(seg(p,vec2(-.25,.25),vec2(.38,.7)),seg(p,vec2(-.25,-.2),vec2(.38,.25))));}
 else if(g==4){d=min(min(seg(p,vec2(0.,.75),vec2(.38,.25)),seg(p,vec2(.38,.25),vec2(0.,-.25))),min(seg(p,vec2(0.,-.25),vec2(-.38,.25)),seg(p,vec2(-.38,.25),vec2(0.,.75))));d=min(d,min(seg(p,vec2(0.,-.25),vec2(-.4,-.8)),seg(p,vec2(0.,-.25),vec2(.4,-.8))));}
 else if(g==5){d=min(seg(p,vec2(-.38,-.75),vec2(-.38,.75)),seg(p,vec2(.38,-.75),vec2(.38,.75)));d=min(d,min(seg(p,vec2(-.38,.75),vec2(.38,-.75)),seg(p,vec2(-.38,-.75),vec2(.38,.75))));}
 else{d=min(seg(p,vec2(-.42,-.75),vec2(.42,.75)),seg(p,vec2(-.42,.75),vec2(.42,-.75)));d=min(d,seg(p,vec2(0.,-.8),vec2(0.,.8)));}
 return d/1.25;
}
void main(){
 vec2 p=vUv*2.-1.;
 int g=int(vRune.x+.5);
 float w=g==0?.045:g==7?.011:.075,d=glyph(p,g),aa=fwidth(d)*1.2+.002;
 float groove=1.-smoothstep(w,w+aa,d);
 float glow=uGlow[int(vRune.z+.5)];
 // Light runs along the cut like the aurora: green below, cyan to violet above, a slow shimmer through it.
 float sh=.75+.25*sin(uTime*1.7+vRune.y*6.+p.y*3.)*sin(uTime*.9+p.x*4.);
 vec3 col=mix(vec3(.2,1.,.62),vec3(.38,.72,1.),smoothstep(-.8,.8,p.y+.2*sin(uTime*.5+vRune.y)));
 float core=1.-smoothstep(w*.15,w*.85,d),halo=exp(-max(d-w,0.)*16.)*(1.-groove);
 vec3 lit=col*(core*3.6+halo*.55)*sh*glow;
 float a=groove*.82;
 gl_FragColor=vec4(uGroove*a+lit,a);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   float fogF=1.-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
   float fogF=smoothstep(fogNear,fogFar,vFogDepth);
  #endif
  gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor*a,fogF);
 #endif
}`;

/** Carved rune decals: premultiplied so the groove darkens the stone and the glow adds light. `uGlow[node]` lights them. */
export function runeMaterial(){
 return new THREE.ShaderMaterial({name:'frostlight-runes',vertexShader:RUNE_VERT,fragmentShader:RUNE_FRAG,transparent:true,premultipliedAlpha:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,fog:true,
  uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uGlow:{value:new Array(24).fill(1)},uGroove:{value:new THREE.Color('#0b0e14')}}])});
}

/** One rune quad of `w` x `h` (glyph 0 is the full seal, 1..6 single runes), placed by `m`, lit by uGlow[node]. */
export function runeQuad(m:THREE.Matrix4,w:number,h:number,glyph:number,seed:number,node=0){
 const g=new THREE.PlaneGeometry(w,h);g.deleteAttribute('normal');
 const a=new Float32Array(4*3);for(let i=0;i<4;i++)a.set([glyph,seed,node],i*3);
 g.setAttribute('aRune',new THREE.BufferAttribute(a,3));
 return g.applyMatrix4(m);
}
