import * as THREE from 'three';
import {CLOUD_Y} from './skybloomClouds';
import {SKY_SPRING,SKY_TREE} from './skyTreeLayout';
import {SKY_TREE_TIME} from './skyTreeMaterials';

/*
 * The root waterfall: a spring leaves the world tree's foot between its northern flanks, runs a short channel to
 * the lip and pours over it. The sheet leaves the lip with a little speed, widens as it falls (width ~ u^.6), tears
 * into ropes and dissolves into spray long before the cloud tops; spray puffs ride its lower half and its foot.
 * One mesh, one draw: aKind 0 channel, 1 sheet, 2 spray billboard. uv.y runs 0..1 down the water.
 */

type Height=(x:number,z:number)=>number;
const FALL_VERT=/* glsl */`
attribute float aKind;
attribute vec2 aCorner;
uniform float uSkTime;
varying vec2 vUv;
varying float vKind;
varying float vAlong;
#include <fog_pars_vertex>
void main(){
  vUv=uv;vKind=aKind;
  vec4 mvPosition=modelViewMatrix*vec4(position,1.);
  if(aKind>1.5){
    // Spray: a camera-facing puff that drifts and swells.
    float s=aCorner.y;mvPosition=viewMatrix*vec4(position+vec3(sin(uSkTime*.4+position.y)*1.2,sin(uSkTime*.3+position.x)*.6,0.),1.);
    mvPosition.xy+=(uv-.5)*s*(1.+.08*sin(uSkTime*.7+position.z));
  }
  vAlong=aCorner.x;
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const FALL_FRAG=/* glsl */`
uniform float uSkTime;
uniform vec3 uWater;
uniform vec3 uFoam;
uniform vec3 uMist;
varying vec2 vUv;
varying float vKind;
varying float vAlong;
#include <fog_pars_fragment>
float wH(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float wN(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(wH(i),wH(i+vec2(1,0)),u.x),mix(wH(i+vec2(0,1)),wH(i+1.),u.x),u.y);}
void main(){
  vec3 col;float a;
  if(vKind<.5){
    // Channel: quick water over stones, foam at the banks and where it speeds up toward the lip.
    float s=wN(vec2(vUv.x*6.,vAlong*.9-uSkTime*2.2))*.6+wN(vec2(vUv.x*15.,vAlong*2.3-uSkTime*3.6))*.4;
    float bank=1.-smoothstep(.0,.22,min(vUv.x,1.-vUv.x));
    col=mix(uWater*.82,uFoam,clamp(smoothstep(.55,.85,s)*.7+bank*.55+smoothstep(.75,1.,vUv.y)*.35,0.,1.));
    a=smoothstep(0.,.08,min(vUv.x,1.-vUv.x))*.9*smoothstep(0.,.12,vUv.y);
  }else if(vKind<1.5){
    // The sheet: two scales of streaks pouring faster as it falls, tearing into ropes, then into spray.
    float u=vUv.y,speed=3.5+vAlong*.12;
    float s=wN(vec2(vUv.x*8.,vAlong*.16-uSkTime*speed*.16))*.6+wN(vec2(vUv.x*21.,vAlong*.45-uSkTime*speed*.45))*.4;
    float edge=smoothstep(0.,.2+.2*u,vUv.x)*smoothstep(1.,.8-.2*u,vUv.x);
    float tear=smoothstep(.08,.6,u);
    float body=edge*mix(.95,smoothstep(.3+.25*u,.75,s),tear);
    col=mix(uWater,uFoam,clamp(smoothstep(.4,.8,s)*.85+(1.-smoothstep(0.,.05,u))*.7+u*.5,0.,1.));
    col=mix(col,uMist,smoothstep(.45,.9,u));
    a=body*(1.-smoothstep(.5,.95,u))*.95;
  }else{
    vec2 p=vUv-.5;float r=length(p)*2.;
    a=(1.-smoothstep(.15,1.,r))*(.7+.3*wN(p*3.+vAlong*7.))*.55;
    col=mix(uMist,uFoam,smoothstep(-.3,.45,p.y));
  }
  if(a<.01)discard;
  gl_FragColor=vec4(col,a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function skyRootFall(height:Height,quality:'high'|'low'):THREE.Mesh{
 const pos:number[]=[],uv:number[]=[],kind:number[]=[],corner:number[]=[],idx:number[]=[];
 const X=SKY_TREE.x,Z=SKY_TREE.z,lx=SKY_SPRING.x,lz=SKY_SPRING.z;
 const az=Math.atan2(lz-Z,lx-X),ux=Math.cos(az),uz=Math.sin(az);
 let nx=lx/(128*128),nz=(lz-2)/(155*155);{const l=Math.hypot(nx,nz);nx/=l;nz/=l;}
 const strip=(rows:number,cols:number,at:(u:number,v:number)=>[number,number,number],k:number,len:number)=>{
  const base=pos.length/3;
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const u=j/rows,v=i/cols,[x,y,z]=at(u,v);pos.push(x,y,z);uv.push(v,u);kind.push(k);corner.push(u*len,0);}
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=base+j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;idx.push(a,c,b,b,c,d);}
 };
 // Channel: from inside the trunk's foot to the lip, a little wider as it goes, laid on the ground.
 const r0=6.2,r1=Math.hypot(lx-X,lz-Z),chLen=r1-r0;
 strip(14,4,(u,v)=>{const r=r0+chLen*u,w=1.3+1.1*u,cx=X+ux*r,cz=Z+uz*r,ox=-uz*(v-.5)*w,oz=ux*(v-.5)*w,x=cx+ox,z=cz+oz;return [x,height(x,z)+.08,z];},0,chLen);
 // Sheet: off the lip and down to the spray, widening, a slight bow outward.
 const lipY=height(lx-nx*.3,lz-nz*.3)-.05,L=lipY-(CLOUD_Y+14),rows=quality==='high'?34:22;
 const sx=-nz,sz=nx;
 strip(rows,6,(u,v)=>{const drop=L*Math.pow(u,1.1),t=Math.sqrt(2*drop/9.8),out=.35+2.4*t+drop*.03,w=2.5*(1+3.4*Math.pow(u,.6)),bow=(1-4*(v-.5)*(v-.5))*.25*w,s=(v-.5)*w;
  return [lx+nx*(out+bow)+sx*s,lipY+.15-drop-(u<.02?0:0),lz+nz*(out+bow)+sz*s];},1,L);
 // Spray: puffs along the lower half of the sheet and a bank at its foot.
 const n=quality==='high'?22:14;let seed=7;const r=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
 for(let i=0;i<n;i++){
  const u=.42+.58*(i/n),drop=L*u,t=Math.sqrt(2*drop/9.8),out=.35+2.4*t+drop*.03+(r()-.3)*3,w=2.5*(1+3.4*Math.pow(u,.6)),s=(r()-.5)*w*1.1,size=5+u*14+r()*5;
  const cx=lx+nx*out+sx*s,cy=lipY-drop+(r()-.5)*4,cz=lz+nz*out+sz*s,base=pos.length/3;
  for(const [a,b] of [[0,0],[1,0],[1,1],[0,1]]){pos.push(cx,cy,cz);uv.push(a,b);kind.push(2);corner.push(r(),size);}
  idx.push(base,base+1,base+2,base,base+2,base+3);
 }
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 geo.setAttribute('aKind',new THREE.Float32BufferAttribute(kind,1));geo.setAttribute('aCorner',new THREE.Float32BufferAttribute(corner,2));geo.setIndex(idx);
 geo.computeBoundingSphere();geo.boundingSphere!.radius+=12;
 const mat=new THREE.ShaderMaterial({name:'sky-root-fall',vertexShader:FALL_VERT,fragmentShader:FALL_FRAG,transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:true,
  uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uWater:{value:new THREE.Color('#7fd6e6')},uFoam:{value:new THREE.Color('#f4fbff')},uMist:{value:new THREE.Color('#dde6f3')}}])});
 mat.uniforms.uSkTime=SKY_TREE_TIME;
 const mesh=new THREE.Mesh(geo,mat);mesh.name='sky-root-fall';mesh.renderOrder=4;
 return mesh;
}
