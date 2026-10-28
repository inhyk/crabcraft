import * as THREE from 'three';

/*
 * Where the island meets the lava sea: a band of crust on top of the 'molten-sea' plane (y .15, owned by the lava
 * session; this never goes below it). From the rock outward the sea is chilled black against the cold basalt, then
 * breaks into plates with glowing cracks, then gives way to the open molten sea; steam rises where they touch.
 * The band reads one baked map of the distance from the coast (the island's shore, the columns and the volcano's foot)
 * so it follows the real coastline. Two draws: the band and the steam.
 */

const BOX={minX:-170,minZ:-192,sizeX:340,sizeZ:388};
const RES=256;
const RX=128,RZ=155,CZ=2;
/** The island's shore in ellipse units, and the volcano's foot (cone base radius 28 plus its column skirt). */
const SHORE_E=.9,CONE={x:0,z:-128,r:34};

/** Signed metres from the coast, positive out over the lava. Pure. */
export function coastDistance(x:number,z:number):number{
 const e=Math.hypot(x/RX,(z-CZ)/RZ),r=Math.hypot(x,z-CZ);
 const island=(e-SHORE_E)*(e>.02?r/e:140);
 const cone=Math.hypot(x-CONE.x,z-CONE.z)-CONE.r;
 return Math.min(island,cone);
}

const BAND_PARS=/* glsl */`
uniform sampler2D uCoast;
uniform vec4 uCoastBox;
uniform float uCrustTime;
varying vec3 vCrW;
vec2 crH2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}
float crN(vec2 p){vec2 i=floor(p),f=fract(p),w=f*f*(3.-2.*f);float a=crH2(i).x,b=crH2(i+vec2(1,0)).x,c=crH2(i+vec2(0,1)).x,d=crH2(i+vec2(1,1)).x;return mix(mix(a,b,w.x),mix(c,d,w.x),w.y);}
// Distance to the nearest plate edge (F2 - F1 of a cellular field) and the plate's own id.
vec2 crCells(vec2 p){vec2 i=floor(p),f=fract(p);float f1=8.,f2=8.,id=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(x,y),o=crH2(i+g);vec2 r=g+o-f;float d=dot(r,r);
    if(d<f1){f2=f1;f1=d;id=o.x;}else if(d<f2)f2=d;}
  return vec2(sqrt(f2)-sqrt(f1),id);}
`;

export interface CrustOptions {quality:'high'|'low'}

export class EmberCrust {
 readonly root=new THREE.Group();
 private readonly texture:THREE.DataTexture;
 private readonly uniforms:{uCoast:{value:THREE.Texture};uCoastBox:{value:THREE.Vector4};uCrustTime:{value:number}};
 private readonly steamMat:THREE.ShaderMaterial;
 constructor(o:CrustOptions){
  this.root.name='ember-shore-crust';
  const d=new Uint16Array(RES*RES);
  for(let j=0;j<RES;j++)for(let i=0;i<RES;i++)d[j*RES+i]=THREE.DataUtils.toHalfFloat(coastDistance(BOX.minX+(i+.5)/RES*BOX.sizeX,BOX.minZ+(j+.5)/RES*BOX.sizeZ));
  this.texture=new THREE.DataTexture(d,RES,RES,THREE.RedFormat,THREE.HalfFloatType);
  this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;this.texture.colorSpace=THREE.NoColorSpace;this.texture.needsUpdate=true;
  this.uniforms={uCoast:{value:this.texture},uCoastBox:{value:new THREE.Vector4(BOX.minX,BOX.minZ,1/BOX.sizeX,1/BOX.sizeZ)},uCrustTime:{value:0}};
  // The band: an annulus round the island ellipse wide enough to take in the volcano's foot in the north.
  const seg=o.quality==='high'?220:150,rings=[.86,.9,.94,.98,1.02,1.07,1.12],pos:number[]=[],idx:number[]=[];
  for(let k=0;k<rings.length;k++)for(let i=0;i<=seg;i++){const t=i/seg*Math.PI*2;pos.push(RX*rings[k]*Math.sin(t),.2,CZ+RZ*rings[k]*Math.cos(t));}
  for(let k=0;k<rings.length-1;k++)for(let i=0;i<seg;i++){const a=k*(seg+1)+i,b=a+1,c=a+seg+1,e=c+1;idx.push(a,c,b,b,c,e);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(pos.map((_,i)=>i%3===1?1:0),3));g.setIndex(idx);
  const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.7,metalness:0,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});
  m.name='ember-shore-crust';m.userData.noEmberHeat=true;
  const u=this.uniforms;
  m.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,u);
   shader.vertexShader='varying vec3 vCrW;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvCrW=(modelMatrix*vec4(transformed,1.)).xyz;');
   shader.fragmentShader=BAND_PARS+shader.fragmentShader
    .replace('#include <color_fragment>',`#include <color_fragment>
float crD=texture2D(uCoast,(vCrW.xz-uCoastBox.xy)*uCoastBox.zw).r;
float crWob=(crN(vCrW.xz*.18)-.5)*5.+(crN(vCrW.xz*.9)-.5)*1.2;
float crE=crD+crWob;
vec2 crC=crCells(vCrW.xz*.42);
vec2 crF=crCells(vCrW.xz*1.3+7.);
// Black chilled crust against the rock; further out it breaks into plates whose seams glow, then the sea takes over.
float crCover=1.-smoothstep(6.,13.,crE+crC.y*4.);
float crSeam=(1.-smoothstep(.03,.12,crC.x))*smoothstep(1.5,6.,crE)+(1.-smoothstep(.02,.07,crF.x))*smoothstep(3.,9.,crE)*.5;
diffuseColor.rgb=mix(vec3(.012,.011,.013),vec3(.05,.042,.045),crN(vCrW.xz*2.1)*.6+crC.y*.4);
diffuseColor.a=crCover*smoothstep(-1.5,.2,crD);`)
    .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=.62+.3*crN(vCrW.xz*3.);')
    .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
{
  float flick=.75+.25*sin(uCrustTime*1.7+crC.y*40.+vCrW.x*.1);
  // The seam glows; a thin molten line runs where the crust has pulled off the rock.
  float contact=(1.-smoothstep(.0,1.,abs(crD-.6+crWob*.15)))*.8;
  totalEmissiveRadiance+=vec3(3.2,.8,.12)*crSeam*flick*diffuseColor.a+vec3(2.4,.55,.08)*contact;
}`);
  };
  m.customProgramCacheKey=()=>'ember-shore-crust';
  const band=new THREE.Mesh(g,m);band.name='ember-shore-crust-band';band.renderOrder=2;band.receiveShadow=false;
  // Steam where the lava touches the rock: billboards scattered along the coastline, rising and thinning.
  const n=o.quality==='high'?150:80,quad=new THREE.PlaneGeometry(1,1),sg=new THREE.InstancedBufferGeometry();
  sg.index=quad.index;sg.setAttribute('position',quad.getAttribute('position'));sg.instanceCount=n;
  const base=new Float32Array(n*4),rnd=(k:number)=>{const s=Math.sin(k*127.1+311.7)*43758.5453;return s-Math.floor(s);};
  for(let i=0;i<n;i++){
   // Walk outward from the ellipse until the coast distance crosses zero, so steam sits on the real waterline.
   const t=rnd(i*3.1)*Math.PI*2;let e=.85,x=0,z=0;
   for(let s=0;s<60;s++){x=RX*e*Math.sin(t);z=CZ+RZ*e*Math.cos(t);if(coastDistance(x,z)>.5)break;e+=.005;}
   base.set([x,z,rnd(i*7.7),rnd(i*9.3)],i*4);
  }
  sg.setAttribute('aBase',new THREE.InstancedBufferAttribute(base,4));
  sg.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,5,0),220);
  this.steamMat=new THREE.ShaderMaterial({
   name:'ember-shore-steam',transparent:true,depthWrite:false,fog:true,
   blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
   uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),uTime:{value:0}},
   vertexShader:/* glsl */`
attribute vec4 aBase;
uniform float uTime;
varying vec2 vUv;varying float vA;varying float vDepth;varying float vH;
void main(){
  float life=7.+aBase.w*5.;
  float age=fract(uTime/life+aBase.z);
  float h=age*(6.+5.*aBase.w);
  vec3 c=vec3(aBase.x+sin(aBase.z*30.+uTime*.3)*age*1.5,.4+h,aBase.y+cos(aBase.w*30.+uTime*.25)*age*1.5);
  float size=2.+age*7.;
  vec4 mv=viewMatrix*vec4(c,1.);
  mv.xy+=position.xy*size;
  vUv=position.xy+.5;vA=smoothstep(0.,.12,age)*(1.-smoothstep(.45,1.,age));vDepth=-mv.z;vH=h;
  gl_Position=projectionMatrix*mv;
}`,
   fragmentShader:/* glsl */`
uniform vec3 fogColor;uniform float fogDensity;
varying vec2 vUv;varying float vA;varying float vDepth;varying float vH;
void main(){
  vec2 c=vUv-.5;float r=length(c)*2.;
  float a=vA*(1.-smoothstep(.2,1.,r))*.22;
  if(a<.003)discard;
  // Pale steam lit warm from the lava below, cooler as it rises.
  vec3 col=mix(vec3(.9,.42,.2),vec3(.42,.4,.43),smoothstep(.5,5.,vH));
  col=mix(col,fogColor,1.-exp(-fogDensity*fogDensity*vDepth*vDepth));
  gl_FragColor=vec4(col*a,a);
}`,
  });
  const steam=new THREE.Mesh(sg,this.steamMat);steam.name='ember-shore-steam';steam.renderOrder=3;
  this.root.add(band,steam);
 }
 update(time:number){this.uniforms.uCrustTime.value=time%600;this.steamMat.uniforms.uTime.value=time;}
}
