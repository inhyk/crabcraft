import * as THREE from 'three';
import {SKY_GRID,SKY_MAP,SKY_PATHS,skyHeight} from './skyGroundLayout';
import {SKY_BLOOMS,SKY_DETAIL,SKY_GRASS} from './skyGround';

/*
 * Skybloom's meadow underfoot: grass clumps and wildflowers on world-locked jittered lattices that travel with the
 * camera (two instanced draws, no per-instance data). The vertex shader finds its cell from gl_InstanceID, reads the
 * terrain's own 2 m triangles from a height texture and the ground map (grass, worn, flowers, shade, drift colour,
 * blade height; skyGroundLayout.skyGroundMap), keeps off the paving by the ways' own segments, and bends each blade in
 * the wind and away from the crab. Far clumps thin and shrink before the patch's edge, where the ground shader's
 * painted grass and flower drifts take over.
 */

const HEAD=/* glsl */`
uniform sampler2D smHeight;
uniform sampler2D smSoil;
uniform sampler2D smAux;
uniform vec4 smGrid;   // minX, minZ, step, nx
uniform float smGridNz;
uniform vec4 smMap;    // minX, minZ, 1/width, 1/height
uniform vec3 smCenter; // patch centre x, z; lattice spacing
uniform float smN;
uniform float smTime;
uniform vec3 smPlayer;
uniform vec3 smCam;
uniform vec4 smSeg[6]; // the ways: ax, az, bx, bz
uniform float smHalf[6];
uniform vec3 smLit,smDeep,smDry,smShadeC;
uniform vec3 smB0,smB1,smB2,smB3;
vec2 smHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float smHeightAt(vec2 p){
  vec2 g=clamp((p-smGrid.xy)/smGrid.z,vec2(0.),vec2(smGrid.w-1.,smGridNz-1.));
  vec2 i=min(floor(g),vec2(smGrid.w-2.,smGridNz-2.)),f=g-i;ivec2 c=ivec2(i);
  float a=texelFetch(smHeight,c,0).r,b=texelFetch(smHeight,c+ivec2(0,1),0).r,d=texelFetch(smHeight,c+ivec2(1,0),0).r,e=texelFetch(smHeight,c+ivec2(1,1),0).r;
  return f.x+f.y<=1.?a+(d-a)*f.x+(b-a)*f.y:e+(b-e)*(1.-f.x)+(d-e)*(1.-f.y);
}
// Distance past the paving's edge (kerbs included), negative on the stones.
float smPathD(vec2 p){
  float best=1e3;
  for(int k=0;k<6;k++){vec4 s=smSeg[k];vec2 ab=s.zw-s.xy;float t=clamp(dot(p-s.xy,ab)/max(dot(ab,ab),1e-4),0.,1.);best=min(best,length(s.xy+ab*t-p)-smHalf[k]);}
  return best;
}
vec3 smBloom(float h){return h<.25?smB0:h<.5?smB1:h<.75?smB2:smB3;}
`;

/** Grass clumps: blades of a clump share height, lean and tone; tall at the forest's edge, short turf in town. */
const GRASS=/* glsl */`
float smId=float(gl_InstanceID);
vec2 smCell=floor(smCenter.xy/smCenter.z)+vec2(mod(smId,smN),floor(smId/smN))-floor(smN*.5);
vec2 smR=smHash22(smCell),smR2=smHash22(smCell+71.3);
vec2 smRoot=(smCell+.15+.7*smR)*smCenter.z;
vec2 smUv=(smRoot-smMap.xy)*smMap.zw;
vec4 smS=texture2D(smSoil,smUv),smA=texture2D(smAux,smUv);
float smDist=length(smRoot-smCenter.xy)/(smN*smCenter.z*.5);
vec2 smCc=floor(smRoot/2.2-.5),smBest=vec2(0.);float smCd=9.;
for(int j=0;j<=1;j++)for(int i=0;i<=1;i++){vec2 c=smCc+vec2(i,j),q=(c+.3+.4*smHash22(c+3.7))*2.2;float d=length(smRoot-q);if(d<smCd){smCd=d;smBest=c;}}
vec2 smK=smHash22(smBest+11.1),smK2=smHash22(smBest+29.3);
vec2 smPc=floor(smRoot/8.),smPf=fract(smRoot/8.);smPf=smPf*smPf*(3.-2.*smPf);
float smPatch=mix(mix(smHash22(smPc).x,smHash22(smPc+vec2(1.,0.)).x,smPf.x),mix(smHash22(smPc+vec2(0.,1.)).x,smHash22(smPc+1.).x,smPf.x),smPf.y);
float smHeart=1.-smoothstep(.4,1.5,smCd);
float smPd=smPathD(smRoot);
// Density: the map's grass, none where bare or on the stones; a grassy fringe laps the paving's edge.
float smKeep=smS.r*(1.-step(.5,smA.b))*smoothstep(-.12,.35,smPd)*(1.-smoothstep(.62,.96,smDist))*mix(.55,1.,smoothstep(.14,.32,smPatch+(smK.x-.5)*.3))*(.72+.28*smHeart);
smKeep*=mix(.4,1.,smoothstep(3.,11.,length(smRoot-smCam.xz)));
float smLive=step(smR2.x,smKeep);
float smTall=smA.a*(1.+.35*smoothstep(.2,1.2,smPd)*(1.-smoothstep(1.2,3.,smPd)));
float smScale=smLive*mix(1.,.35,smoothstep(.55,.95,smDist))*smoothstep(0.,.25,smKeep-smR2.x+.1)*(.62+.7*smK.y)*(.7+.45*smHeart);
float smB=aBlade.z,smAng=smR.x*6.2831+smB*2.1,smLean=.3+.4*fract(smR.y*7.+smB*.37);
vec2 smDir=normalize(vec2(cos(smAng),sin(smAng))+vec2(cos(smK2.x*6.28),sin(smK2.x*6.28))*.9),smSide=vec2(-smDir.y,smDir.x);
vec2 smOff=smDir*(.05+.07*smB)*(smB>0.?1.:0.);
float smH=(.22+.34*fract(smR2.y*5.3+smB*.61))*smScale*mix(.5,1.02,smTall),smW=.032+.022*fract(smR.x*3.1+smB);
float smT=aBlade.x;
vec2 smBase=smRoot+smOff;
float smGust=sin(smTime*.9+dot(smBase,vec2(.11,.07)))*.5+sin(smTime*2.1+dot(smBase,vec2(-.23,.31)))*.25;
vec2 smWind=vec2(.8,.6)*(.16+.16*smGust)+smSide*sin(smTime*3.3+smR.x*20.)*.04;
vec2 smAway=smBase-smPlayer.xz;float smPl=length(smAway);
smWind+=smPl>1e-3?smAway/smPl*(1.-smoothstep(.4,1.4,smPl))*.9:vec2(0.);
vec2 smBend=(smDir*smLean+smWind)*smT*smT*smH;
float smGround=smHeightAt(smBase);
float smTaper=1.-smT*smT;
vec3 transformed=vec3(smBase.x+smSide.x*aBlade.y*smW*smTaper+smBend.x,smGround+smT*smH*(1.-.3*smT*length(smDir*smLean+smWind)),smBase.y+smSide.y*aBlade.y*smW*smTaper+smBend.y);
if(smScale<.02)transformed=vec3(0.,-1e4,0.);
float smGx=smHeightAt(smBase+vec2(.6,0.))-smHeightAt(smBase-vec2(.6,0.)),smGz=smHeightAt(smBase+vec2(0.,.6))-smHeightAt(smBase-vec2(0.,.6));
vec3 objectNormal=vec3(0.,1.,0.);
vec2 smTilt=smDir*(.18+.3*smT)+(smR2-.5)*.35;
vSmN=normalize(vec3(-smGx/1.2+smTilt.x,1.,-smGz/1.2+smTilt.y));
// Tone by clump: lit green, deep green, a few going dry and pale, some blue-green in the shade.
vec3 smC=mix(smDeep,smLit,smK.x);
smC=mix(smC,smDry,step(.78,smK2.y)*.6);
smC=mix(smC,smShadeC,smA.r*.8+step(smK2.y,.12)*.35);
vSmCol=smC*(.85+.3*smR2.y)*(.75+.5*smPatch);
vSmTip=mix(smDry*1.15,smC*1.25,.35+.4*smK.y);
vSmT=smT;vSmAo=1.-smA.r*.7;
`;

/** Wildflowers: a stem and a five-petal head where the drifts are thick, the drift's colour with a stray of another. */
const FLOWER=/* glsl */`
float smId=float(gl_InstanceID);
vec2 smCell=floor(smCenter.xy/smCenter.z)+vec2(mod(smId,smN),floor(smId/smN))-floor(smN*.5);
vec2 smR=smHash22(smCell+5.1),smR2=smHash22(smCell+33.7);
vec2 smRoot=(smCell+.12+.76*smR)*smCenter.z;
vec2 smUv=(smRoot-smMap.xy)*smMap.zw;
vec4 smS=texture2D(smSoil,smUv),smA=texture2D(smAux,smUv);
float smDist=length(smRoot-smCenter.xy)/(smN*smCenter.z*.5);
float smKeep=smS.a*(1.-step(.5,smA.b))*smoothstep(.2,.8,smPathD(smRoot))*(1.-smoothstep(.6,.95,smDist));
float smLive=step(smR2.x,smKeep*1.1);
float smScale=smLive*mix(1.,.4,smoothstep(.55,.95,smDist))*(.75+.5*smR2.y);
// aBlade: x height 0..1 (stem) or 2 for the head, y the petal angle (head) or the stem side, z ring 0 centre .. 1 petal tip.
float smH=(.24+.22*smR.y)*smScale*(.8+.4*smA.a);
float smGust=sin(smTime*1.1+dot(smRoot,vec2(.13,.09)))*.5+.5;
vec2 smAway=smRoot-smPlayer.xz;float smPl=length(smAway);
vec2 smWind=vec2(.8,.6)*(.05+.07*smGust)+(smPl>1e-3?smAway/smPl*(1.-smoothstep(.3,1.2,smPl))*.25:vec2(0.));
float smGround=smHeightAt(smRoot);
vec3 transformed;
float smHead=step(1.5,aBlade.x);
float smPetalR=(.055+.035*smR2.x)*smScale;
if(smHead<.5){
  float t=aBlade.x;vec2 side=vec2(cos(smR.x*6.28),sin(smR.x*6.28))*aBlade.y*.008*smScale*(1.-t);
  transformed=vec3(smRoot.x+side.x+smWind.x*t*t*smH,smGround+t*smH,smRoot.y+side.y+smWind.y*t*t*smH);
}else{
  float a=aBlade.y+smR.y*6.28,r=aBlade.z*smPetalR;
  // Petals cup a little upward, the head nods with the wind.
  transformed=vec3(smRoot.x+cos(a)*r+smWind.x*smH,smGround+smH+aBlade.z*aBlade.z*smPetalR*.45,smRoot.y+sin(a)*r+smWind.y*smH);
}
if(smScale<.02)transformed=vec3(0.,-1e4,0.);
vec3 objectNormal=vec3(0.,1.,0.);
vSmN=normalize(vec3((smR2.x-.5)*.4,1.,(smR2.y-.5)*.4));
float smHue=smR2.y<.1?fract(smA.g+.5):smA.g;
vec3 smFc=smBloom(smHue)*(.88+.24*smR.y);
vSmCol=mix(smDeep*.8,smFc,smHead);
// A warm heart at the centre of every head.
vSmTip=mix(smFc,vec3(.9,.62,.18),smHead*(1.-smoothstep(.0,.35,aBlade.z))*.8);
vSmT=smHead;vSmAo=1.-smA.r*.6;
`;

const FRAG_COLOR=/* glsl */`#include <color_fragment>
float smTipF=smoothstep(.4,1.,vSmT);
diffuseColor.rgb=mix(vSmCol*mix(.55,1.,smoothstep(0.,.7,vSmT)),vSmTip,smTipF*.65)*vSmAo;
`;

/** An instanced lattice geometry: per-vertex aBlade triples (positions are built in the shader). */
function latticeGeometry(verts:number[],index:number[],count:number){
 const g=new THREE.InstancedBufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(new Array(verts.length).fill(0),3));
 g.setAttribute('aBlade',new THREE.Float32BufferAttribute(verts,3));
 g.setIndex(index);g.instanceCount=count;
 return g;
}

export interface SkyMeadow{root:THREE.Group;grass:THREE.Mesh;flowers:THREE.Mesh;setQuality(q:'high'|'low'):void;update(time:number,player:THREE.Vector3):void}
/** The meadow: grass and wildflowers, two instanced draws that follow the camera (set in onBeforeRender). */
export function skyMeadow(soil:THREE.DataTexture,aux:THREE.DataTexture):SkyMeadow{
 const {nx,nz,step,minX,minZ}=SKY_GRID;
 const hData=new Float32Array(nx*nz);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)hData[j*nx+i]=skyHeight(minX+i*step,minZ+j*step);
 const hTex=new THREE.DataTexture(hData,nx,nz,THREE.RedFormat,THREE.FloatType);hTex.needsUpdate=true;
 const segs:THREE.Vector4[]=[],halves:number[]=[];
 for(const p of SKY_PATHS)for(let k=1;k<p.points.length;k++){segs.push(new THREE.Vector4(p.points[k-1][0],p.points[k-1][1],p.points[k][0],p.points[k][1]));halves.push(p.width/2+(p.trim?.3:0));}
 while(segs.length<6){segs.push(new THREE.Vector4(1e4,1e4,1e4,1e4));halves.push(0);}
 if(segs.length>6)throw new Error('skyMeadow: more than six way segments');
 const shared={
  smHeight:{value:hTex},smSoil:{value:soil},smAux:{value:aux},
  smGrid:{value:new THREE.Vector4(minX,minZ,step,nx)},smGridNz:{value:nz},
  smMap:{value:new THREE.Vector4(SKY_MAP.minX,SKY_MAP.minZ,1/SKY_MAP.w,1/SKY_MAP.h)},
  smTime:{value:0},smPlayer:{value:new THREE.Vector3()},smCam:{value:new THREE.Vector3()},
  smSeg:{value:segs},smHalf:{value:halves},sgDetail:SKY_DETAIL,
  smLit:{value:SKY_GRASS.lit},smDeep:{value:SKY_GRASS.deep},smDry:{value:SKY_GRASS.dry},smShadeC:{value:SKY_GRASS.shade},
  smB0:{value:SKY_BLOOMS[0]},smB1:{value:SKY_BLOOMS[1]},smB2:{value:SKY_BLOOMS[2]},smB3:{value:SKY_BLOOMS[3]},
 };
 const make=(name:string,body:string,geo:THREE.InstancedBufferGeometry,params:{high:{s:number;n:number};low:{s:number;n:number}},roughness:number)=>{
  const uniforms={...shared,smCenter:{value:new THREE.Vector3(0,0,params.high.s)},smN:{value:params.high.n}};
  const material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness,side:THREE.DoubleSide});material.name=name;
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,uniforms);
   shader.vertexShader=shader.vertexShader
    .replace('#include <common>',`#include <common>\n${HEAD}\nattribute vec3 aBlade;\nvarying vec3 vSmCol;\nvarying vec3 vSmTip;\nvarying float vSmT;\nvarying float vSmAo;\nvarying vec3 vSmN;`)
    .replace('#include <beginnormal_vertex>',body)
    .replace('#include <begin_vertex>','');
   shader.fragmentShader=shader.fragmentShader
    .replace('#include <common>','#include <common>\nvarying vec3 vSmCol;\nvarying vec3 vSmTip;\nvarying float vSmT;\nvarying float vSmAo;\nvarying vec3 vSmN;')
    .replace('#include <color_fragment>',FRAG_COLOR)
    // Both faces lit as the turf they stand in.
    .replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nnormal=normalize((viewMatrix*vec4(vSmN,0.)).xyz);');
  };
  material.customProgramCacheKey=()=>name;
  const mesh=new THREE.Mesh(geo,material);mesh.name=name;mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.castShadow=false;
  const fwd=new THREE.Vector3();
  // The patch sits ahead of the camera so what is in view is covered and little is spent behind it.
  mesh.onBeforeRender=(_r,_s,camera)=>{
   const c=uniforms.smCenter.value,reach=uniforms.smN.value*c.z*.5;camera.getWorldDirection(fwd);
   const l=Math.hypot(fwd.x,fwd.z)||1,ahead=.72*Math.min(1,l*1.6);
   c.x=camera.position.x+fwd.x/l*reach*ahead;c.y=camera.position.z+fwd.z/l*reach*ahead;shared.smCam.value.copy(camera.position);
  };
  return {mesh,uniforms,params,geo};
 };
 // A clump: three blades, each two segments and a tip.
 const blade:number[]=[],bladeIdx:number[]=[];
 for(let b=0;b<3;b++){const o=blade.length/3;blade.push(0,-1,b,0,1,b,.5,-1,b,.5,1,b,1,0,b);bladeIdx.push(o,o+1,o+2,o+2,o+1,o+3,o+2,o+3,o+4);}
 const grassParams={high:{s:.27,n:150},low:{s:.4,n:90}};
 const grass=make('skybloom-meadow-grass',GRASS,latticeGeometry(blade,bladeIdx,grassParams.high.n**2),grassParams,.7);
 // A flower: a stem (one thin triangle pair) and a head of five petals round a centre.
 const fl:number[]=[0,-1,0,0,1,0,1,-1,0,1,1,0],flIdx:number[]=[0,1,2,2,1,3];
 const c0=fl.length/3;fl.push(2,0,0);
 for(let k=0;k<10;k++){const a=k/10*Math.PI*2;fl.push(2,a,k%2?.45:1);}
 for(let k=0;k<10;k++)flIdx.push(c0,c0+1+k,c0+1+(k+1)%10);
 const flowerParams={high:{s:.42,n:96},low:{s:.6,n:56}};
 const flowers=make('skybloom-meadow-flowers',FLOWER,latticeGeometry(fl,flIdx,flowerParams.high.n**2),flowerParams,.6);
 const root=new THREE.Group();root.name='skybloom-meadow';root.add(grass.mesh,flowers.mesh);
 let quality:'high'|'low'='high';
 return {
  root,grass:grass.mesh,flowers:flowers.mesh,
  setQuality(q){if(q===quality)return;quality=q;for(const m of [grass,flowers]){const p=m.params[q];m.geo.instanceCount=p.n**2;m.uniforms.smN.value=p.n;m.uniforms.smCenter.value.z=p.s;}},
  update(time,player){shared.smTime.value=time;shared.smPlayer.value.copy(player);},
 };
}
