import * as THREE from 'three';

/*
 * Materials of World VI's world tree and its sanctuary (skyWorldTree.ts, skySanctuary.ts): pale silver bark with
 * plated furrows, lichen and moss; cream limestone with weathering streaks and moss on its ledges; leaf and blossom
 * cards that face the eye (and the sun, in the shadow pass) with a rounded crown normal; seed lanterns lit from
 * inside. One clock (`SKY_TREE_TIME`) sways the canopy and breathes the lanterns.
 * Geometry carries aAo = (baked occlusion, moss near the ground); bark adds aBark = (around in furrows, along in m).
 */

export const SKY_TREE_TIME={value:0};
/** 1 on high quality, 0 on low: fine grain, lichen and bump fade out. */
export const SKY_TREE_DETAIL={value:1};

export const SKY_NOISE=/* glsl */`
float skH12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec2 skH22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float skN(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(skH12(i),skH12(i+vec2(1.,0.)),u.x),mix(skH12(i+vec2(0.,1.)),skH12(i+1.),u.x),u.y);}
// Bump from a scalar height through screen derivatives (three's perturbNormalArb, on any height).
vec3 skPerturb(vec3 N,vec3 p,float h,float k){
  vec3 dx=dFdx(p),dy=dFdy(p);float hx=dFdx(h),hy=dFdy(h);
  vec3 r1=cross(dy,N),r2=cross(N,dx);float det=dot(dx,r1);
  vec3 g=sign(det)*(hx*r1+hy*r2);
  return normalize(abs(det)*N-k*g);
}
`;

const VARY_HEAD=/* glsl */`#include <common>
attribute vec2 aAo;
varying vec2 vAo;
varying vec3 vSkW;
varying vec3 vSkN;`;
const VARY_BODY=/* glsl */`#include <fog_vertex>
vAo=aAo;vSkW=(modelMatrix*vec4(transformed,1.)).xyz;vSkN=normalize(mat3(modelMatrix)*objectNormal);`;
const FRAG_HEAD=/* glsl */`#include <common>
uniform float uSkDetail;
varying vec2 vAo;
varying vec3 vSkW;
varying vec3 vSkN;
${SKY_NOISE}`;
const BUMP=/* glsl */`#include <normal_fragment_maps>
normal=skPerturb(normal,-vViewPosition,skHeight,uSkDetail*(1.-smoothstep(25.,80.,length(vViewPosition))));`;

/** Pale silver bark: plated furrows that wind with the wood, lichen rosettes, moss on the tops and the feet. */
export function skyBarkMaterial():THREE.MeshStandardMaterial{
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.92});m.name='sky-world-tree-bark';
 m.onBeforeCompile=s=>{
  s.uniforms.uSkDetail=SKY_TREE_DETAIL;
  s.vertexShader=s.vertexShader.replace('#include <common>',`${VARY_HEAD}\nattribute vec2 aBark;\nvarying vec2 vBark;`).replace('#include <fog_vertex>',`${VARY_BODY}\nvBark=aBark;`);
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`${FRAG_HEAD}\nvarying vec2 vBark;`)
   .replace('#include <color_fragment>',/* glsl */`
vec2 bq=vBark;
float bw=skN(vec2(bq.x*.9,bq.y*.2))-.5;
float bf=abs(fract(bq.x+bw*.7)-.5)*2.;
float plate=smoothstep(.05,.32,bf+(skN(bq*vec2(1.7,.35))-.5)*.16);
float cell=floor(bq.x+bw*.7);
// Plates crack across now and then, so the furrows read as bark, not fluting.
float brk=smoothstep(.6,.74,skN(vec2(cell*3.7,bq.y*.6)));
plate*=1.-brk*.7;
float grain=mix(.5,skN(bq*vec2(5.,1.1)),uSkDetail);
float bh=plate*(.78+.22*grain);
float tone=skN(vSkW.xz*.07+vSkW.y*.045);
vec3 barkC=mix(vec3(.13,.125,.14),mix(vec3(.34,.33,.31),vec3(.52,.5,.46),tone),bh);
float lich=smoothstep(.7,.8,skN(bq*vec2(2.1,.8)+7.))*plate*uSkDetail;
barkC=mix(barkC,vec3(.56,.6,.5),lich*.55);
float mN=skN(vSkW.xz*.33+vSkW.y*.19);
float moss=smoothstep(.42,.9,vSkN.y*.85+mN*.5-.12);
moss=max(moss,smoothstep(.25,.85,vAo.y*(1.25-plate*.55)+(mN-.5)*.7));
vec3 mossC=mix(vec3(.075,.17,.06),vec3(.19,.31,.1),mN);
diffuseColor.rgb=mix(barkC,mossC,moss*.92)*vAo.x;
float skHeight=bh*.07*(1.-moss)+moss*mN*.025;`)
   .replace('#include <normal_fragment_maps>',BUMP);
 };
 return m;
}

/** Cream limestone, carved: tone drift, rain streaks down the faces, moss on the ledges and at the foot. */
export function skyStoneMaterial():THREE.MeshStandardMaterial{
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.86});m.name='sky-sanctuary-limestone';
 m.onBeforeCompile=s=>{
  s.uniforms.uSkDetail=SKY_TREE_DETAIL;
  s.vertexShader=s.vertexShader.replace('#include <common>',VARY_HEAD).replace('#include <fog_vertex>',VARY_BODY);
  s.fragmentShader=s.fragmentShader.replace('#include <common>',FRAG_HEAD)
   .replace('#include <color_fragment>',/* glsl */`
vec3 sp=vSkW,sn=vSkN;
float n1=skN(sp.xz*.45+sp.y*vec2(.71,.53)),n2=mix(.5,skN(sp.xz*2.6-sp.y*vec2(.4,1.9)),uSkDetail);
vec3 stoneC=mix(vec3(.55,.51,.41),vec3(.76,.7,.57),n1)*(.9+.16*n2);
// Rain streaks: thin, vertical, from the ledges down.
float streak=skN(vec2(sp.x*4.1+sp.z*3.7,sp.y*.12));
stoneC*=1.-.14*smoothstep(.55,.95,streak)*(1.-abs(sn.y));
float pit=smoothstep(.8,.9,skN(sp.xz*9.+sp.y*vec2(5.3,4.1)))*uSkDetail;
stoneC*=1.-pit*.12;
float mN=skN(sp.xz*.6+sp.y*.3);
float moss=smoothstep(.55,.95,sn.y*.6+mN*.55)*smoothstep(.2,.6,mN);
moss=max(moss,smoothstep(.3,.9,vAo.y+(mN-.5)*.8));
vec3 mossC=mix(vec3(.08,.18,.065),vec3(.2,.32,.11),mN);
diffuseColor.rgb=mix(stoneC,mossC,moss*.9)*vAo.x;
float skHeight=(n2*.012-pit*.008)*(1.-moss);`)
   .replace('#include <normal_fragment_maps>',BUMP);
 };
 return m;
}

/** Leaf clumps (left half of the atlas) and blossom sprays (right half), drawn once on a canvas. */
function foliageAtlas():THREE.CanvasTexture{
 const c=document.createElement('canvas');c.width=512;c.height=256;const g=c.getContext('2d')!;
 let seed=9157;const r=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
 const leaf=(x:number,y:number,a:number,l:number,w:number,shade:number)=>{
  g.save();g.translate(x,y);g.rotate(a);
  g.beginPath();g.moveTo(0,0);g.bezierCurveTo(w,l*.25,w*.8,l*.75,0,l);g.bezierCurveTo(-w*.8,l*.75,-w,l*.25,0,0);g.closePath();
  const v=Math.round(shade*255);g.fillStyle=`rgb(${v},${v},${v})`;g.fill();
  g.strokeStyle=`rgba(0,0,0,.22)`;g.lineWidth=1.4;g.beginPath();g.moveTo(0,l*.08);g.lineTo(0,l*.88);g.stroke();
  g.restore();
 };
 // Leaves: a rounded clump, back leaves darker, all pointing out from a stem below the middle.
 for(let i=0;i<34;i++){
  const a=r()*Math.PI*2,d=r()*58,x=128+Math.cos(a)*d,y=136+Math.sin(a)*d*.9;
  leaf(x,y,Math.atan2(y-150,x-128)-Math.PI/2+(r()-.5)*.9,44+r()*26,15+r()*9,.5+.5*(i/34)*(.7+.3*r()));
 }
 // Blossoms: five-petal flowers over a few leaves.
 for(let i=0;i<10;i++){const a=r()*Math.PI*2,d=r()*55;leaf(384+Math.cos(a)*d,140+Math.sin(a)*d,a+Math.PI/2,40+r()*16,13+r()*6,.42+r()*.15);}
 for(let i=0;i<16;i++){
  const a=r()*Math.PI*2,d=Math.sqrt(r())*78,x=384+Math.cos(a)*d,y=128+Math.sin(a)*d,s=13+r()*9,rot=r()*6;
  for(let k=0;k<5;k++){const b=rot+k/5*Math.PI*2;g.beginPath();g.ellipse(x+Math.cos(b)*s*.55,y+Math.sin(b)*s*.55,s*.58,s*.42,b,0,Math.PI*2);const v=Math.round((.86+.14*r())*255);g.fillStyle=`rgb(${v},${v},${v})`;g.fill();}
  g.beginPath();g.arc(x,y,s*.22,0,Math.PI*2);g.fillStyle='rgb(150,120,70)';g.fill();
 }
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;t.name='sky-foliage-atlas';
 return t;
}

/*
 * Cards: `position` is the card's centre, aCorner its corner in card units (already rotated), aSize its half size.
 * The vertex shader spreads the corner along the current camera's right and up, so in the shadow pass the cards face
 * the sun and cast their full leafy shape. The normal leans out from the card centre, so each card shades round.
 */
const CARD_VERTEX_HEAD=/* glsl */`#include <common>
attribute vec2 aCorner;
attribute float aSize;
uniform float uSkTime;`;
const CARD_BILLBOARD=/* glsl */`
vec3 skR=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),skU=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
vec3 skSway=vec3(sin(uSkTime*1.1+position.x*.21+position.y*.13),0.,cos(uSkTime*.9+position.z*.19))*(.07+.0025*max(position.y-30.,0.));`;
export function skyFoliageMaterials(){
 const map=foliageAtlas();
 const leaves=new THREE.MeshStandardMaterial({map,alphaTest:.5,vertexColors:true,roughness:.78});leaves.name='sky-world-tree-leaves';
 leaves.onBeforeCompile=s=>{
  s.uniforms.uSkTime=SKY_TREE_TIME;
  s.vertexShader=s.vertexShader.replace('#include <common>',CARD_VERTEX_HEAD)
   .replace('#include <beginnormal_vertex>',`${CARD_BILLBOARD}\nvec3 objectNormal=normalize(normal+(skR*aCorner.x+skU*aCorner.y)*.55);`)
   .replace('#include <begin_vertex>','vec3 transformed=position+(skR*aCorner.x+skU*aCorner.y)*aSize+skSway;');
  // Mips average the leaves' alpha away; lift it with the mip level so far crowns stay full.
  s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>',/* glsl */`
{vec2 sz=vec2(textureSize(map,0));vec2 d=max(abs(dFdx(vMapUv*sz)),abs(dFdy(vMapUv*sz)));float lod=max(log2(max(d.x,d.y)),0.);diffuseColor.a*=1.+lod*.28;}
#include <alphatest_fragment>`)
   .replace('#include <emissivemap_fragment>',/* glsl */`#include <emissivemap_fragment>
// Light through the leaves: crowns glow a little on their sunward rim and never fall to black inside.
{float ndv=abs(dot(normal,normalize(vViewPosition)));totalEmissiveRadiance+=diffuseColor.rgb*(.05+.12*pow(1.-ndv,2.));}`);
 };
 const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map,alphaTest:.5});depth.name='sky-world-tree-leaves-depth';
 depth.onBeforeCompile=s=>{
  s.uniforms.uSkTime=SKY_TREE_TIME;
  s.vertexShader=s.vertexShader.replace('#include <common>',CARD_VERTEX_HEAD)
   .replace('#include <begin_vertex>',`${CARD_BILLBOARD}\nvec3 transformed=position+(skR*aCorner.x+skU*aCorner.y)*aSize+skSway;`);
 };
 return {leaves,depth};
}

/** Seed lanterns: a ribbed husk lit from inside (aGlow = (glow, phase)), breathing slowly. */
export function skyLanternMaterial():THREE.MeshStandardMaterial{
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,emissive:'#ffb85c',emissiveIntensity:2.4,roughness:.55});m.name='sky-seed-lantern';
 m.onBeforeCompile=s=>{
  s.uniforms.uSkTime=SKY_TREE_TIME;
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 aGlow;\nvarying vec2 vGlow;').replace('#include <fog_vertex>','#include <fog_vertex>\nvGlow=aGlow;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uSkTime;\nvarying vec2 vGlow;')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=vGlow.x*(.82+.18*sin(uSkTime*1.3+vGlow.y*6.283));');
 };
 return m;
}
