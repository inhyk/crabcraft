import * as THREE from 'three';
import {SKY_GRID,SKY_MAP,skyGroundMap,skyHeight} from './skyGroundLayout';

/*
 * Skybloom's ground in the high late-morning sun: a cool meadow with lighter dry tips and blue-green hollows, moss in
 * the shade, bare soil and pebbles in a few open patches, pale trodden earth along the ways and at the doors, and
 * wildflowers painted in long wind-combed drifts (pink, white, lilac, butter). The mesh is the gameplay height grid
 * itself (one vertex per 2 m sample, as before). The shader reads the 1 m ground map (skyGroundLayout.skyGroundMap)
 * and one small tileable noise texture at six scales, each turned another way, so nothing tiles at any distance;
 * detail fades to its mean before a pixel can shimmer.
 */

const SIZE=256;
/** Tileable noise, four channels: fbm, cellular F1 (pebbles), fine blade noise, cellular F2 - F1 (cracks). */
function noiseTexture():THREE.DataTexture{
 const hash=(i:number,j:number,s:number)=>{let h=Math.imul(i,0x27d4eb2d)^Math.imul(j,0x165667b1)^Math.imul(s,0x9e3779b1);h=Math.imul(h^(h>>>15),0x2c1b3c6d);h=Math.imul(h^(h>>>12),0x297a2d39);return ((h^(h>>>15))>>>0)/4294967296;};
 const wrap=(i:number,p:number)=>((i%p)+p)%p;
 const grad=(x:number,y:number,p:number,s:number)=>{
  const fx=x*p/SIZE,fy=y*p/SIZE,ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy,q=(t:number)=>t*t*t*(t*(t*6-15)+10),qu=q(u),qv=q(v);
  const g=(i:number,j:number,dx:number,dy:number)=>{const a=hash(wrap(ix+i,p),wrap(iy+j,p),s)*Math.PI*2;return Math.cos(a)*dx+Math.sin(a)*dy;};
  const a=g(0,0,u,v),b=g(1,0,u-1,v),c=g(0,1,u,v-1),d=g(1,1,u-1,v-1);return a+(b-a)*qu+(c-a)*qv+(a-b-c+d)*qu*qv;
 };
 const fbm=(x:number,y:number,p0:number,oct:number,s:number)=>{let sum=0,amp=.5,p=p0;for(let i=0;i<oct;i++){sum+=grad(x,y,p,s+i)*amp;amp*=.5;p*=2;}return sum;};
 const cell=(x:number,y:number,p:number,s:number)=>{
  const fx=x*p/SIZE,fy=y*p/SIZE,ix=Math.floor(fx),iy=Math.floor(fy);let f1=9,f2=9;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const cx=ix+i,cy=iy+j,px=cx+.1+.8*hash(wrap(cx,p),wrap(cy,p),s),py=cy+.1+.8*hash(wrap(cx,p),wrap(cy,p),s+7),d=Math.hypot(fx-px,fy-py);if(d<f1){f2=f1;f1=d;}else if(d<f2)f2=d;}
  return [f1,f2];
 };
 const data=new Uint8Array(SIZE*SIZE*4),u8=(v:number)=>Math.max(0,Math.min(255,Math.round(v*255)));
 for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
  const o=(y*SIZE+x)*4,[f1,f2]=cell(x,y,24,3);
  data[o]=u8(.5+fbm(x,y,4,6,11)*.95);data[o+1]=u8(Math.min(1,f1/.75));
  data[o+2]=u8(.5+(fbm(x,y,64,2,23)*.7+grad(x,y,128,31)*.3)*1.1);data[o+3]=u8(Math.min(1,(f2-f1)/.5));
 }
 const t=new THREE.DataTexture(data,SIZE,SIZE,THREE.RGBAFormat);
 t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.colorSpace=THREE.NoColorSpace;t.name='skybloom-ground-noise';t.needsUpdate=true;
 return t;
}
/** The ground map's two layers as linear textures. */
export function skyGroundTextures(){
 const m=skyGroundMap(),mk=(d:Uint8Array,name:string)=>{const t=new THREE.DataTexture(d,m.w,m.h,THREE.RGBAFormat);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearFilter;t.colorSpace=THREE.NoColorSpace;t.name=name;t.needsUpdate=true;return t;};
 return {soil:mk(m.soil,'skybloom-soil-map'),aux:mk(m.aux,'skybloom-aux-map')};
}

/** Shared by the ground, the meadow and the paving: 1 on high quality, 0 on low. */
export const SKY_DETAIL={value:1};
const col=(hex:string)=>new THREE.Color(hex);
/** The meadow palette (style-w6.md), linear. */
export const SKY_GRASS={lit:col('#6fa86a'),deep:col('#4f8f63'),dry:col('#a7c27a'),shade:col('#3d6f66')};
export const SKY_BLOOMS=[col('#f2b8c6'),col('#f7f3ea'),col('#b8a6e8'),col('#f3dc8a')];

const HEAD=/* glsl */`
uniform sampler2D sgTex;
uniform sampler2D sgSoil;
uniform sampler2D sgAux;
uniform vec4 sgMap;
uniform float sgDetail;
uniform vec3 sgLit,sgDeep,sgDry,sgShadeC;
uniform vec3 sgB0,sgB1,sgB2,sgB3;
varying vec3 vSgW;
varying vec3 vSgN;
vec4 sgT(vec2 p,float s,float a){float c=cos(a),d=sin(a);return texture2D(sgTex,vec2(c*p.x-d*p.y,d*p.x+c*p.y)/s+a*3.7);}
float sgH(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec3 sgBloom(float h){return h<.25?sgB0:h<.5?sgB1:h<.75?sgB2:sgB3;}
`;

const COLOR=/* glsl */`
vec2 sgP=vSgW.xz;
vec2 sgUv=(sgP-sgMap.xy)*sgMap.zw;
vec4 sgS=texture2D(sgSoil,sgUv),sgA=texture2D(sgAux,sgUv);
float sgFoot=length(fwidth(sgP));
float sgF1=1.-smoothstep(.05,.22,sgFoot),sgF2=1.-smoothstep(.012,.06,sgFoot),sgF3=1.-smoothstep(.004,.016,sgFoot);
float sgMacro=sgT(sgP,150.,.3).r,sgMacro2=sgT(sgP,53.,1.1).r,sgMid=sgT(sgP,13.,2.).r,sgSw=sgT(sgP,7.5,.45).r;
float sgFine=mix(.5,sgT(sgP,3.1,.7).r,sgF1);
vec4 sgClump=sgT(sgP,1.9,2.6);
float sgBlade=mix(.5,sgT(sgP,.43,1.9).b,sgF2),sgBlade2=mix(.5,sgT(sgP,.17,.9).b,sgF3);
vec3 sgNw=normalize(vSgN);
float sgSlope=1.-sgNw.y;
// Coverage, ragged at every scale so no edge follows the map's texels.
float sgWorn=smoothstep(.3,.7,sgS.g+(sgMid-.5)*.45+(sgFine-.5)*.35);
float sgPatch=sgS.b-.5;
float sgDirt=smoothstep(.12,.3,sgPatch+(sgMid-.5)*.25+(sgFine-.5)*.15);
float sgMoss=smoothstep(.1,.28,-sgPatch+(sgMid-.5)*.2+(sgClump.r-.5)*.15*sgF1);
float sgGrass=smoothstep(.35,.62,sgS.r+(sgMacro2-.5)*.3+(sgFine-.5)*.35+(sgClump.g-.5)*.2*sgF1)*(1.-sgWorn*.9);
float sgRock=smoothstep(.42,.6,sgSlope+(sgMid-.5)*.2);
// Meadow: broad swathes between the lit and the deeper green, cool blue-green in the hollows, dry pale tips in sun.
vec3 sgG=mix(sgDeep,sgLit,smoothstep(.3,.7,sgMacro));
sgG=mix(sgG,sgShadeC,smoothstep(.6,.85,sgMacro2)*.35);
sgG=mix(sgG,sgDry,smoothstep(.5,.72,sgSw)*.45*(1.-sgMoss));
sgG*=mix(1.,.72,smoothstep(.45,.78,sgMid)*.6);
sgG*=.82+.36*sgClump.r;
sgG*=.76+.48*sgBlade;sgG*=.88+.24*sgBlade2;
// Dry tips catch the sun: fine pale flecks where the blades stand tall.
sgG=mix(sgG,sgDry*1.1,smoothstep(.62,.8,sgBlade)*.35*sgF2*sgA.a);
// Moss: deep, velvety, yellow-green at its crown.
vec3 sgM=mix(vec3(.06,.15,.05),vec3(.16,.27,.07),sgClump.r)*(.85+.3*sgFine);
// Soil: warm earth with pale pebbles and dark grit.
vec3 sgE=vec3(.2,.14,.09)*(.75+.5*sgMid)*(.85+.3*sgFine);
float sgPeb=(1.-smoothstep(.12,.2,sgClump.g))*sgF1;
sgE=mix(sgE,vec3(.52,.48,.4)*(.8+.4*sgClump.r),sgPeb*.75);
// Trodden earth by the ways and doors: pale, warm, gritty; packed darker in its middle.
vec3 sgW=vec3(.46,.38,.27)*(.8+.4*sgMid)*(.86+.28*sgFine);
float sgGrit=(1.-smoothstep(.08,.14,sgT(sgP,.8,1.7).g))*sgF2;
sgW=mix(sgW,vec3(.62,.58,.5),sgGrit*.5);
sgW=mix(sgW,sgW*.8,smoothstep(.75,1.,sgS.g)*.5);
// Stone where the ground falls steeply (the rim and the banks): cream limestone in beds.
float sgBed=vSgW.y*1.6+sgT(sgP,21.,1.3).r*2.4;
vec3 sgR=vec3(.6,.55,.44)*(.7+.5*sgT(vec2(sgP.x+sgP.y,vSgW.y*3.),4.,.2).r)*(.86+.28*step(.5,fract(floor(sgBed)*.618)));
sgR*=1.-.35*(1.-smoothstep(0.,.08,fract(sgBed)))*sgF1;
vec3 sgCol=sgE;
sgCol=mix(sgCol,sgM,sgMoss*(1.-sgDirt));
sgCol=mix(sgCol,sgG,sgGrass*(1.-sgDirt*.85)*(1.-sgMoss*.55));
sgCol=mix(sgCol,sgW,sgWorn);
sgCol=mix(sgCol,sgR,sgRock);
// Wildflowers painted into the sward: one blossom per small cell where the drift is thick, the drift's colour
// with a stray of another; far off the drift averages into a soft tint of its colour.
float sgFl=sgS.a*(1.-sgWorn)*(1.-sgRock);
vec3 sgFc=sgBloom(sgA.g);
vec2 sgCell=floor(sgP/.32);float sgR1=sgH(sgCell),sgR2=sgH(sgCell+19.7);
vec2 sgCc=(sgCell+.2+.6*vec2(sgR1,sgR2))*.32;
float sgDot=(1.-smoothstep(.035,.075,length(sgP-sgCc)))*step(sgR1,sgFl*.85);
vec3 sgDc=sgR2<.12?sgBloom(fract(sgA.g+.5)):sgFc;
sgCol=mix(sgCol,sgDc*(.85+.3*sgR2),sgDot*sgF2);
sgCol=mix(sgCol,mix(sgCol,sgFc,.5),sgFl*(1.-sgF2)*.32);
// Contact shade: blue-violet, deepest at the foot, ragged at its edge.
float sgAo=sgA.r*(.75+.5*sgFine);
sgCol*=mix(vec3(1.),vec3(.52,.58,.7),sgAo);
diffuseColor.rgb=sgCol;
float sgRelief=sgGrass*((sgBlade-.5)*.02+(sgClump.r-.5)*.03)+(1.-sgGrass)*(sgPeb*.014+(sgFine-.5)*.012)+sgRock*smoothstep(0.,.1,fract(sgBed))*.05*sgF1+sgMoss*(sgClump.r-.5)*.02;
`;

const ROUGH=/* glsl */`
roughnessFactor=mix(mix(.95,.8+.1*sgClump.r,sgGrass),.82,sgRock);
`;

const NORMAL=/* glsl */`
if(sgDetail>.5){
  vec2 dpx=dFdx(sgP),dpy=dFdy(sgP);float dhx=dFdx(sgRelief),dhy=dFdy(sgRelief),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dhx*dpy.y-dhy*dpx.y,dpx.x*dhy-dpy.x*dhx)/det,-.8,.8):vec2(0.);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

export interface SkyGround{mesh:THREE.Mesh;noise:THREE.DataTexture;soil:THREE.DataTexture;aux:THREE.DataTexture}
/** Skybloom's terrain over the gameplay grid (same 2 m mesh as before: one vertex per height sample). */
export function skyGround():SkyGround{
 const {nx,nz,step,minX,minZ}=SKY_GRID;
 const land=new THREE.PlaneGeometry((nx-1)*step,(nz-1)*step,nx-1,nz-1);land.rotateX(-Math.PI/2);
 const pos=land.getAttribute('position');
 for(let i=0;i<pos.count;i++)pos.setY(i,skyHeight(pos.getX(i),pos.getZ(i)));
 if(Math.abs(pos.getX(0)-minX)>1e-6||Math.abs(pos.getZ(0)-minZ)>1e-6)throw new Error('skyGround: mesh and grid disagree');
 land.computeVertexNormals();
 const noise=noiseTexture(),{soil,aux}=skyGroundTextures();
 const uniforms={sgTex:{value:noise},sgSoil:{value:soil},sgAux:{value:aux},sgMap:{value:new THREE.Vector4(SKY_MAP.minX,SKY_MAP.minZ,1/SKY_MAP.w,1/SKY_MAP.h)},sgDetail:SKY_DETAIL,
  sgLit:{value:SKY_GRASS.lit},sgDeep:{value:SKY_GRASS.deep},sgDry:{value:SKY_GRASS.dry},sgShadeC:{value:SKY_GRASS.shade},
  sgB0:{value:SKY_BLOOMS[0]},sgB1:{value:SKY_BLOOMS[1]},sgB2:{value:SKY_BLOOMS[2]},sgB3:{value:SKY_BLOOMS[3]}};
 // `map` holds the noise for anisotropy and disposal; the shader reads it itself.
 const material=new THREE.MeshStandardMaterial({map:noise,roughness:.92,metalness:0});
 material.name='skybloom-meadow-ground';
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vSgW;\nvarying vec3 vSgN;')
   .replace('#include <fog_vertex>','#include <fog_vertex>\nvSgW=(modelMatrix*vec4(transformed,1.)).xyz;vSgN=normalize(mat3(modelMatrix)*objectNormal);');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\n${HEAD}`)
   .replace('#include <map_fragment>','')
   .replace('#include <color_fragment>',`#include <color_fragment>\n${COLOR}`)
   .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\n${ROUGH}`)
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n${NORMAL}`);
 };
 material.customProgramCacheKey=()=>'skybloom-meadow-ground';
 const mesh=new THREE.Mesh(land,material);mesh.name='skybloom-ground';mesh.receiveShadow=true;
 return {mesh,noise,soil,aux};
}
