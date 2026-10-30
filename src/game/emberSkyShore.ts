import * as THREE from 'three';
import type {LavaZone} from './emberLava';
import {EMBER_NOISE} from './emberNoise';

/*
 * Emberreach's coast. The play disc used to end in a smooth slope into the lava sea; now a basalt coast rings it:
 * - columns: hexagonal basalt prisms in staggered rows round the island, tall at the rim and stepping down to the sea
 *   (a 15 m columnar cliff under the north terraces, a low causeway in the south), a skirt of them round the volcano's
 *   foot where the cone stands over the sea; colonnade joints, soot near the lava, a glowing contact line where they
 *   stand in it;
 * - spatter: rounded glassy lumps and cooled lava toes along the waterline.
 * - crust: a band of cooled black crust on the sea in front of the columns, its plates parting toward the open lava,
 *   the cracks between them hotter the further out, the outermost plates adrift; the island no longer ends in a line.
 * Two instanced draws and the crust band. Nothing here is walkable (outside FRONTIER_BOUNDS, max .8 of the island ellipse) and nothing
 * stands in the lava zones; heights inside the play zones are untouched.
 */

export interface ShoreOptions {
 height:(x:number,z:number)=>number;
 /** height(0, -72): the cone is CylinderGeometry(8, 28, 38) at (0, ly + 9, -128). */
 ly:number;
 zones:readonly LavaZone[];
 quality:'high'|'low';
}

const RX=128,RZ=155,CZ=2;
const CONE={x:0,z:-128,baseR:28};
const fract=(v:number)=>v-Math.floor(v);
const rnd=(n:number)=>fract(Math.sin(n*127.1+311.7)*43758.5453);

/** Column tops, cracks and soot; shared by both shore meshes through `kind` (0 columns, 1 spatter). */
function shoreMaterial(kind:0|1):THREE.MeshStandardMaterial{
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:kind?.5:.86,metalness:0});
 m.name=kind?'ember-shore-spatter':'ember-shore-columns';
 m.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec3 vShW;\nvarying float vShSeed;\n'+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
{vec4 w=modelMatrix*instanceMatrix*vec4(transformed,1.);vShW=w.xyz;vShSeed=fract(sin(dot(instanceMatrix[3].xz,vec2(12.9898,78.233)))*43758.5453);}`);
  shader.fragmentShader=`varying vec3 vShW;\nvarying float vShSeed;
float shH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float shN(vec2 p){vec2 i=floor(p),f=fract(p),w=f*f*(3.-2.*f);return mix(mix(shH(i),shH(i+vec2(1,0)),w.x),mix(shH(i+vec2(0,1)),shH(i+vec2(1,1)),w.x),w.y);}
`+shader.fragmentShader
   .replace('#include <color_fragment>',`#include <color_fragment>
float shJoint=0.,shLow=smoothstep(2.4,.2,vShW.y);
{
  float n=shN(vShW.xz*1.7+vShW.y*.9)*.6+shN(vShW.xz*5.3-vShW.y*2.1)*.4;
  ${kind===0?`// Colonnade joints: irregular horizontal cracks every metre or so, offset per column.
  float j=fract(vShW.y/(.75+.35*vShSeed)+vShSeed*7.);
  shJoint=(1.-smoothstep(.0,.05,j))+(1.-smoothstep(.0,.04,1.-j))*.5;
  shJoint*=.55+.45*shN(vShW.xz*3.+vShW.y);`:''}
  vec3 c=diffuseColor.rgb*(.78+.4*n);
  c*=1.-shJoint*.55;
  // Soot and glassy spatter near the lava, a little sulfur crust in the cracks above it.
  c=mix(c,vec3(.018,.015,.017),shLow*.75);
  // Column tops: weathered dark basalt under a skin of ash in patches, cracked across, never pale cut faces.
  float shUp=smoothstep(.8,.95,normalize(cross(dFdx(vShW),dFdy(vShW))).y);
  c=mix(c,c*(.55+.25*n),shUp);
  c=mix(c,vec3(.2,.19,.2),shUp*smoothstep(.55,.8,shN(vShW.xz*2.3+vShSeed*4.))*.6);
  c=mix(c,vec3(.32,.27,.09),smoothstep(.82,.95,n)*smoothstep(1.2,2.6,vShW.y)*(1.-smoothstep(4.,6.,vShW.y))*.35);
  diffuseColor.rgb=c;
}`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.42,shLow*.7);')
   .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
{
  // Where the rock stands in the lava it glows, flickering along the contact line, and the cracks above it smoulder.
  // Broken into patches along the coast so the island never ends in one unbroken neon line; the crust takes over.
  float contact=1.-smoothstep(.12,.75,vShW.y-.15+shN(vShW.xz*1.3)*.35);
  contact*=.2+.8*smoothstep(.4,.75,shN(vShW.xz*.4+vShSeed*5.));
  totalEmissiveRadiance+=vec3(2.,.46,.07)*contact*(.65+.35*shN(vShW.xz*.7+vShSeed*9.));
  totalEmissiveRadiance+=vec3(1.4,.3,.05)*shJoint*smoothstep(3.5,.6,vShW.y)*.6;
}`);
 };
 m.customProgramCacheKey=()=>'ember-shore-'+kind;
 return m;
}

/** A hexagonal prism, base at y = 0, height 1, radius 1, flat faces. */
function prism():THREE.BufferGeometry{
 const g=new THREE.CylinderGeometry(1,1,1,6,1,false);g.translate(0,.5,0);
 // Drop the bottom cap: it is always under the lava.
 const idx=g.getIndex()!,keep:number[]=[];const pos=g.getAttribute('position');
 for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);if(pos.getY(a)<.01&&pos.getY(b)<.01&&pos.getY(c)<.01)continue;keep.push(a,b,c);}
 g.setIndex(keep);
 const flat=g.toNonIndexed();flat.computeVertexNormals();g.dispose();
 flat.deleteAttribute('uv');
 return flat;
}

/** A rounded lump with a lumpy surface (cooled spatter and lava toes), centred, radius about 1. */
function lump():THREE.BufferGeometry{
 const g=new THREE.IcosahedronGeometry(1,2),p=g.getAttribute('position');
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
  const n=.82+.22*Math.sin(x*3.1+z*2.3)*Math.cos(y*2.7+x*1.3)+.08*Math.sin(x*9.7+y*7.1+z*8.3);
  p.setXYZ(i,x*n,y*n*.62,z*n);
 }
 g.deleteAttribute('uv');g.computeVertexNormals();
 return g;
}

/** The crust band on the sea: island-ellipse rings e0..e1 (skipping the cone's foot), a few centimetres over the lava.
 *  uv.x runs 0 at e .872 (the outer columns' feet) to 1 at e1; inside that (between the columns) it is negative: solid crust. */
function crustBand(o:ShoreOptions):THREE.Mesh{
 const e0=.85,e1=1.02,nA=720,nR=8,pos:number[]=[],uv:number[]=[],idx:number[]=[];
 for(let j=0;j<=nR;j++)for(let i=0;i<=nA;i++){
  const th=i/nA*Math.PI*2,e=e0+(e1-e0)*j/nR,x=RX*e*Math.sin(th),z=CZ+RZ*e*Math.cos(th);
  pos.push(x,.21,z);uv.push((e-.872)/(e1-.872),Math.hypot(x-CONE.x,z-CONE.z));
 }
 for(let j=0;j<nR;j++)for(let i=0;i<nA;i++){const a=j*(nA+1)+i,b=a+1,c=a+nA+1,d=c+1;idx.push(a,c,b,b,c,d);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.9,metalness:0,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
 m.name='ember-shore-crust';
 const zones=o.zones.slice(0,8).map(zn=>new THREE.Vector3(zn.x,zn.z,zn.radius+3));while(zones.length<8)zones.push(new THREE.Vector3(0,-1e4,0));
 m.onBeforeCompile=shader=>{
  shader.uniforms.ecZones={value:zones};
  shader.vertexShader='varying vec3 vCrW;\nvarying vec2 vCrT;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvCrT=uv;').replace('#include <project_vertex>','#include <project_vertex>\nvCrW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader='varying vec3 vCrW;\nvarying vec2 vCrT;\nuniform vec3 ecZones[8];\n'+shader.fragmentShader
   .replace('#include <common>','#include <common>\n'+EMBER_NOISE)
   .replace('#include <color_fragment>',`#include <color_fragment>
vec2 crP=vCrW.xz;
float crFoot=length(abs(dFdx(crP))+abs(dFdy(crP)));
// Outward position across the band, wobbled so the band's edges never follow the ellipse.
float crT=vCrT.x+egNoise(crP*.035)*.22+egNoise(crP*.11)*.08;
vec3 crC=egCells(crP*.55+vec2(egNoise(crP*.3),egNoise(crP*.3+4.))*.35);
// Plates part toward the open lava: each plate (cell) drops out past its own reach; the cracks widen outward.
float crKeep=crT-crC.y*.55;
float crFade=min(smoothstep(30.,38.,vCrT.y),1.);
for(int i=0;i<8;i++)crFade*=smoothstep(0.,6.,length(crP-ecZones[i].xy)-ecZones[i].z);
if(crKeep>.42||crFade<.01)discard;
float crW=.008+.1*smoothstep(-.1,.45,crKeep);
float crCrack=1.-smoothstep(crW,crW+.03+crFoot*.4,crC.x);
float crRim=1.-smoothstep(.0,.03+crFoot*.4,abs(crKeep-.42)*2.);
vec3 crCol=mix(vec3(.05,.045,.05),vec3(.1,.09,.095),crC.y)*(.85+.3*(egNoise(crP*2.1)*.5+.5));
crCol=mix(crCol,vec3(.24,.22,.23),smoothstep(.25,0.,crT)*.5*smoothstep(.4,.7,egNoise(crP*.8)*.5+.5));
diffuseColor.rgb=egSrgb(mix(crCol,vec3(.12,.04,.02),max(crCrack,crRim)));
float crGlow=max(crCrack,crRim*.45)*crFade;`)
   .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
float crOut=smoothstep(-.3,.42,crKeep);
totalEmissiveRadiance+=mix(vec3(1.,.2,.035),vec3(1.,.42,.1),smoothstep(.0,.42,crKeep))*crGlow*(.1+1.5*crOut*crOut);`)
   .replace('#include <dithering_fragment>','#include <dithering_fragment>\ngl_FragColor.a=1.;');
 };
 m.customProgramCacheKey=()=>'ember-shore-crust';
 const mesh=new THREE.Mesh(g,m);mesh.name='ember-coast-crust';mesh.receiveShadow=true;
 return mesh;
}

export interface ShoreBuild {root:THREE.Group;columns:number;spatter:number}

export function buildEmberShore(o:ShoreOptions):ShoreBuild{
 const root=new THREE.Group();root.name='ember-basalt-coast';
 const coneBase=o.ly-10;
 const inLava=(x:number,z:number,pad:number)=>o.zones.some(zn=>Math.hypot(x-zn.x,z-zn.z)<zn.radius+pad);
 const at=(e:number,th:number)=>[RX*e*Math.sin(th),CZ+RZ*e*Math.cos(th)] as const;
 type Col={x:number;z:number;top:number;r:number;rot:number;tx:number;tz:number;shade:number};
 const cols:Col[]=[];
 const high=o.quality==='high';
 // Rows round the island. Where the coast is a cliff every row keeps near the terrace's level, so the island ends in
 // a wall of columns standing in the lava; where it is a causeway the rows step down to the sea. A low row of broken
 // stumps stands out in the lava in front of both.
 const rows=[.823,.839,.855,.871,.886];
 const perim=Math.PI*(3*(RX+RZ)-Math.sqrt((3*RX+RZ)*(RX+3*RZ)))*.85;
 const step=high?2.5:3.3,count=Math.round(perim/step);
 const cliffAt=(th:number)=>{const v=.5+.32*Math.sin(th*3+1.3)+.22*Math.sin(th*7.1+.4)+.12*Math.sin(th*13.7);return Math.min(1,Math.max(0,(v-.35)/.4));};
 rows.forEach((re,ri)=>{
  const t=ri/(rows.length-1);
  for(let k=0;k<count;k++){
   const s=k*1009+ri*7919;
   const th=(k+(ri%2)*.5+(rnd(s)-.5)*.3)/count*Math.PI*2;
   const e=re+(rnd(s+1)-.5)*.005;
   const [x,z]=at(e,th);
   // The cone stands over the coast in the north: its own skirt below takes over there.
   if(Math.hypot(x-CONE.x,z-CONE.z)<CONE.baseR+2)continue;
   if(inLava(x,z,2))continue;
   const [ix,iz]=at(.8,th),inner=o.height(ix,iz),sea=.15,c=cliffAt(th);
   const jit=(rnd(s+2)-.4)*(ri===0?1.5:1.1);
   const stair=inner+(sea+.9-inner)*Math.pow(t,.85),cliff=inner-.25-t*1.1;
   // A column never ends below the ground it stands on.
   const top=Math.max(stair+(cliff-stair)*c+jit,o.height(x,z)+.6,sea+.5+rnd(s+3)*.6);
   const r=(1.2+rnd(s+4)*.5)*(high?1:1.25);
   cols.push({x,z,top,r,rot:rnd(s+5)*Math.PI,tx:(rnd(s+6)-.5)*.1,tz:(rnd(s+7)-.5)*.1,shade:rnd(s+8)});
  }
 });
 for(let k=0;k<Math.round(count*.55);k++){
  const s=k*331+11,th=(k+rnd(s))/Math.round(count*.55)*Math.PI*2,[x,z]=at(.902+rnd(s+1)*.012,th);
  if(Math.hypot(x-CONE.x,z-CONE.z)<CONE.baseR+4||inLava(x,z,2)||rnd(s+2)<.3)continue;
  cols.push({x,z,top:.35+rnd(s+3)*1.6,r:.9+rnd(s+4)*.6,rot:rnd(s+5)*Math.PI,tx:(rnd(s+6)-.5)*.3,tz:(rnd(s+7)-.5)*.3,shade:rnd(s+8)});
 }
 // The volcano's foot where it stands over the sea: a skirt of columns stepping down from the cone into the lava.
 const ring=[{r:CONE.baseR+.8,drop:0},{r:CONE.baseR+2.9,drop:.45},{r:CONE.baseR+5,drop:.85}];
 ring.forEach((rg,ri)=>{
  const n=Math.round(Math.PI*2*rg.r/(high?2.4:3.2));
  for(let k=0;k<n;k++){
   const s=k*613+ri*3301+17,a=(k+(ri%2)*.5)/n*Math.PI*2;
   const x=CONE.x+Math.sin(a)*rg.r,z=CONE.z+Math.cos(a)*rg.r,ground=o.height(x,z);
   if(ground>coneBase-1.5||inLava(x,z,1.5))continue;
   const top=Math.max(coneBase+1.2+(.15-coneBase)*rg.drop+(rnd(s)-.3)*1.4,ground+.5,.6+rnd(s+1)*.6);
   cols.push({x,z,top,r:1.2+rnd(s+2)*.5,rot:rnd(s+3)*Math.PI,tx:(rnd(s+4)-.5)*.16,tz:(rnd(s+5)-.5)*.16,shade:rnd(s+6)});
  }
 });
 const base=-3.2,dummy=new THREE.Object3D(),colour=new THREE.Color();
 const colMesh=new THREE.InstancedMesh(prism(),shoreMaterial(0),cols.length);
 cols.forEach((c,i)=>{
  dummy.position.set(c.x,base,c.z);dummy.rotation.set(c.tx,c.rot,c.tz);dummy.scale.set(c.r,c.top-base,c.r);dummy.updateMatrix();
  colMesh.setMatrixAt(i,dummy.matrix);
  // Basalt #2d3038 to #3a3d45, a few lit ash-grey and one in twelve rust-stained.
  colour.set(c.shade>.92?'#4a3a36':c.shade>.75?'#45474f':'#33363e').multiplyScalar(.85+.3*rnd(i*3.7));
  colMesh.setColorAt(i,colour);
 });
 colMesh.name='ember-coast-columns';colMesh.castShadow=true;colMesh.receiveShadow=true;colMesh.computeBoundingSphere();
 // Spatter and cooled toes along the waterline, in front of the outer columns and round the cone's foot.
 const spat:{x:number;z:number;s:number;sy:number;rot:number}[]=[];
 const nSp=Math.round(perim/(high?1.6:2.4));
 for(let k=0;k<nSp;k++){
  const s=k*271+5,th=(k+rnd(s))/nSp*Math.PI*2,e=.9+rnd(s+1)*.022,[x,z]=at(e,th);
  if(Math.hypot(x-CONE.x,z-CONE.z)<CONE.baseR+4||inLava(x,z,2))continue;
  const big=rnd(s+2)>.8;
  spat.push({x,z,s:big?1.6+rnd(s+3)*1.6:.5+rnd(s+3)*.9,sy:big?.55:.8,rot:rnd(s+4)*6.28});
 }
 for(let k=0;k<(high?90:50);k++){
  const s=k*97+3,a=rnd(s)*Math.PI*2,r=CONE.baseR+6+rnd(s+1)*2.5,x=CONE.x+Math.sin(a)*r,z=CONE.z+Math.cos(a)*r;
  if(o.height(x,z)>coneBase-1.5||inLava(x,z,1.5))continue;
  spat.push({x,z,s:.6+rnd(s+2)*1.4,sy:.7,rot:rnd(s+3)*6.28});
 }
 const spMesh=new THREE.InstancedMesh(lump(),shoreMaterial(1),spat.length);
 spat.forEach((p,i)=>{
  dummy.position.set(p.x,.15+p.s*.05,p.z);dummy.rotation.set(0,p.rot,0);dummy.scale.set(p.s*1.3,p.s*p.sy,p.s);dummy.updateMatrix();
  spMesh.setMatrixAt(i,dummy.matrix);spMesh.setColorAt(i,colour.set(i%5?'#1c1a20':'#2a2629').multiplyScalar(.8+.4*rnd(i*1.3)));
 });
 spMesh.name='ember-coast-spatter';spMesh.receiveShadow=true;spMesh.computeBoundingSphere();
 root.add(colMesh,spMesh,crustBand(o));
 return {root,columns:cols.length,spatter:spat.length};
}
