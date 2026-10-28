import * as THREE from 'three';
import {SKY_ARENA,SKY_WAY_FIELD,skyHeight,skyOnPath,skyRenderedHeight,skyWayFieldData} from './skyGroundLayout';
import {SKY_DETAIL,SKY_GRASS} from './skyGround';

/*
 * Skybloom's ways: irregular cream limestone flags with grass in the joints. One mesh hugs the ground under the whole
 * network (a 0.5 m grid a few centimetres up) and its shader lays the stones, so nothing tiles and nothing is a grid:
 * a cellular tiling of flags, each a little domed and chipped at the arris, from several beds of limestone (cream,
 * honey, a few grey-blue). The middle of each way is trodden smooth and a touch darker, the joints there are grit;
 * toward the edges moss and grass fill the joints, stones go missing and the turf laps over, so the ways end softly
 * in the meadow. The ways' shape comes from one baked field (skyGroundLayout.skyWayFieldData: signed distance, across,
 * kind at 0.5 m), so curved garden paths cost the same as straight ones; `covers` reads the same field.
 */

const CELL=.5,LIFT=.03,REACH=.26;

const HEAD=/* glsl */`
uniform sampler2D spField; // r signed distance past the paved edge, g across (0 middle .. 1 edge), b kind (1 avenue)
uniform vec4 spFieldMap;   // minX, minZ, 1/width, 1/height (m)
uniform vec3 spHole;
uniform float sgDetail;
uniform vec3 spTurfA,spTurfB;
varying vec3 vSpW;
vec2 spHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float spHash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float spNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(spHash22(i)*2.-1.,f),b=dot(spHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(spHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(spHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
float spSmin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
// Irregular flags: a cellular tiling stretched a little along the way; distance to the stone's outline (m, negative inside).
float spFlags(vec2 q,float size,out float id,out vec2 local){
  vec2 p=q/size,i=floor(p),f=fract(p);float f1=8.,f2=8.;vec2 c1=vec2(0.),c2=vec2(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)),o=.1+.8*spHash22(i+g),d=g+o-f;float l=dot(d,d);
    if(l<f1){f2=f1;c2=c1;f1=l;c1=i+g+o;}else if(l<f2){f2=l;c2=i+g+o;}
  }
  vec2 m=(c1+c2)*.5,n=normalize(c2-c1);
  id=spHash12(c1*1.37);local=(p-c1)*size;
  return dot(p-m,n)*size+.011+.016*fract(id*5.3);
}
float spDome(float de,float id,vec2 l,float h){float x=clamp(de/.05,0.,1.),e=1.-(1.-x)*(1.-x);return e*(.8+.2*fract(id*5.3)-dot(l,l)/(h*h)*.2);}
`;

const COLOR=/* glsl */`
vec2 spP=vSpW.xz;
vec2 spDpx=dFdx(spP),spDpy=dFdy(spP);
float spFoot=length(abs(spDpx)+abs(spDpy));
vec4 spF=texture2D(spField,(spP-spFieldMap.xy)*spFieldMap.zw);
float spSd=spF.r,spKind=step(.5,spF.b),spAcrossN=spF.g;
if(length(spP-spHole.xy)<spHole.z)discard;
float spN1=spNoise(spP*.29+1.7)*.6+spNoise(spP*.81-4.1)*.4,spN2=spNoise(spP*2.3+4.);
float spRag=spNoise(spP*1.1+2.3)*.6+spNoise(spP*3.7)*.4;
float spAlpha=1.-smoothstep(-.02,${REACH.toFixed(2)},spSd+spRag*.14);
if(spAlpha<.004)discard;
float spId;vec2 spLoc;
vec2 spQ=spP+vec2(spNoise(spP*1.7),spNoise(spP*1.7+7.))*.05;
float spSize=spKind>.5?.92:.72;
float spOut=spFlags(spQ,spSize,spId,spLoc);
spOut+=spNoise(spP*11.+spId*9.)*.012;
float spH=spDome(-spOut,spId,spLoc,spSize*.5);
float spFw=max(spFoot*.5,1e-4),spBlur=smoothstep(.08,.3,spFoot);
float spJ=(1.-smoothstep(-spFw,spFw,-spOut-.006))*min(1.,.03/spFw)*(1.-spBlur*.7);
// Toward the edges the flags thin out: grass between them and over the missing ones.
float spEdge=smoothstep(-1.1,-.05,spSd+spRag*.25);
float spSkip=step(fract(spId*13.7),.02+.62*spEdge*spEdge+.08*smoothstep(.2,.6,spN1));
// The middle of each way is trodden smooth; moss and grass hold where feet do not go.
float spMid=1.-smoothstep(.25,.9,spAcrossN);
float spMossy=clamp((1.-spMid)*.85+spN1*.4+spEdge*.5,0.,1.);
// Limestone from several beds: cream, honey, a pale grey-blue; each stone weathered to its own value.
float spV=fract(spId*17.13);
vec3 spStone=mix(vec3(.62,.55,.42),vec3(.8,.73,.57),fract(spId*3.7));
spStone=mix(spStone,vec3(.66,.5,.33),step(.86,spV)*.75);
spStone=mix(spStone,vec3(.5,.54,.56),step(spV,.08)*.7);
spStone*=.86+.28*(spNoise(spP*4.3+spId*13.)*.5+.5);
float spNear=1.-smoothstep(.006,.03,spFoot);
if(spNear>0.)spStone*=1.+spNoise(spP*39.)*.12*spNear+spNoise(spP*91.)*.08*(1.-smoothstep(.003,.008,spFoot));
spStone=mix(spStone,vec3(.66,.6,.47)*(.9+.2*(spN1*.5+.5)),spBlur);
// Lichen on the crowns of stones off the beaten line: pale sage and a few gold rosettes.
float spLich=smoothstep(.55,.82,spNoise(spP*2.9+spId*5.)*.5+.5)*spMossy*(1.-spBlur);
spStone=mix(spStone,vec3(.52,.58,.4),spLich*.45);
spStone=mix(spStone,vec3(.82,.62,.24),smoothstep(.86,.93,spNoise(spP*7.+spId)*.5+.5)*spMossy*.5*(1.-spBlur));
// The trodden middle: smoother, a little darker and warmer.
spStone*=mix(1.,.9,spMid*.7);
// One value step under the cream walls: the paving is a wide surface and must not be the frame's brightest (advisor #21 b).
spStone*=.72;
// Joints: grass and moss at the edges, dark grit in the trodden middle.
vec3 spTurf=mix(spTurfA,spTurfB,spN2*.5+.5)*(.75+.5*(spNoise(spP*6.)*.5+.5));
vec3 spGrit=mix(vec3(.26,.22,.15),spTurfA*.8,.35);
vec3 spJoint=mix(spGrit,spTurf,smoothstep(.1,.45,spMossy));
float spGap=spSkip;
vec3 spCol=mix(spStone,spJoint,spJ);
spCol=mix(spCol,spTurf,spGap*(1.-spBlur*.5));
// The turf laps over the outer stones.
float spLip=smoothstep(-.18,0.,spSd+spRag*.1);
spCol=mix(spCol,spTurf,spLip*.85);
float spRecess=(1.-smoothstep(0.,.4,spH))*(1.-spGap)*(1.-spBlur)*.3;
spCol*=1.-spRecess;
diffuseColor.rgb=spCol;
diffuseColor.a*=spAlpha;
`;

const ROUGH=/* glsl */`
roughnessFactor=mix(mix(.86,.7+.12*fract(spId*7.31),spMid),.95,max(spGap,spJ));
`;

const NORMAL=/* glsl */`
if(sgDetail>.5){
  float h=(spH*(1.-spGap)*.06+spNoise(spP*9.)*.004*spNear)*(1.-spBlur);
  vec2 dpx=spDpx,dpy=spDpy;float dhx=dFdx(h),dhy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dhx*dpy.y-dhy*dpx.y,dpx.x*dhy-dpy.x*dhx)/det,-1.,1.):vec2(0.);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

/** Skybloom's ways: the avenue and the garden paths (skyGroundLayout.SKY_WAYS), one mesh, one draw. */
export function skyPaving():THREE.Group{
 const root=new THREE.Group();root.name='world6-skybloom-paving';
 const F=SKY_WAY_FIELD,hole={x:SKY_ARENA.x,z:SKY_ARENA.z,r:SKY_ARENA.r};
 const minX=F.minX,minZ=F.minZ,maxX=F.minX+F.w*F.cell,maxZ=F.minZ+F.h*F.cell;
 const data=skyWayFieldData();
 const ground=(x:number,z:number)=>Math.max(skyHeight(x,z),skyRenderedHeight(x,z));
 const nx=Math.ceil((maxX-minX)/CELL),nz=Math.ceil((maxZ-minZ)/CELL);
 const vid=new Int32Array((nx+1)*(nz+1)).fill(-1),pos:number[]=[],index:number[]=[];
 const vert=(i:number,j:number)=>{const k=j*(nx+1)+i;if(vid[k]<0){const x=minX+i*CELL,z=minZ+j*CELL;vid[k]=pos.length/3;pos.push(x,ground(x,z)+LIFT,z);}return vid[k];};
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  // The mesh's cells are the field's texels (same origin, same 0.5 m).
  const cx=minX+(i+.5)*CELL,cz=minZ+(j+.5)*CELL;
  if(data[(j*F.w+i)*4]>REACH+CELL*.72||Math.hypot(cx-hole.x,cz-hole.z)<hole.r-CELL*.72)continue;
  const a=vert(i,j),b=vert(i+1,j),c=vert(i,j+1),d=vert(i+1,j+1);index.push(a,c,b,b,c,d);
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(index);geo.computeVertexNormals();geo.computeBoundingSphere();
 const half=new Uint16Array(data.length);for(let k=0;k<data.length;k++)half[k]=THREE.DataUtils.toHalfFloat(data[k]);
 const field=new THREE.DataTexture(half,F.w,F.h,THREE.RGBAFormat,THREE.HalfFloatType);
 field.magFilter=field.minFilter=THREE.LinearFilter;field.colorSpace=THREE.NoColorSpace;field.name='skybloom-way-field';field.needsUpdate=true;
 const uniforms={
  spField:{value:field},spFieldMap:{value:new THREE.Vector4(F.minX,F.minZ,1/(F.w*F.cell),1/(F.h*F.cell))},
  spHole:{value:new THREE.Vector3(hole.x,hole.z,hole.r)},sgDetail:SKY_DETAIL,
  spTurfA:{value:SKY_GRASS.deep.clone().multiplyScalar(.85)},spTurfB:{value:SKY_GRASS.lit.clone()},
 };
 const material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.85,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
 material.name='skybloom-limestone-paving';
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSpW;').replace('#include <fog_vertex>','#include <fog_vertex>\nvSpW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\n${HEAD}`)
   .replace('#include <color_fragment>',`#include <color_fragment>\n${COLOR}`)
   .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\n${ROUGH}`)
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n${NORMAL}`);
 };
 material.customProgramCacheKey=()=>'skybloom-limestone-paving';
 const surface=new THREE.Mesh(geo,material);surface.name='skybloom-paving-surface';surface.receiveShadow=true;surface.renderOrder=-1;
 root.add(surface);
 root.userData.covers=(x:number,z:number)=>skyOnPath(x,z)&&Math.hypot(x-hole.x,z-hole.z)>=hole.r;
 root.userData.stats={field:[F.w,F.h],cells:index.length/6,vertices:pos.length/3};
 root.userData.wayField=field;
 return root;
}
