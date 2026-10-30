import * as THREE from 'three';
import type {HeatHazeSource} from '../core/heatHaze';
import type {EmberLava, LavaZone} from './emberLava';

/*
 * World V's heat haze (core/heatHaze.ts draws it): where the air shimmers and how hot it is.
 * Layer A, the molten sea: the plane at 0.15 m beyond the island's shore ellipse (the same ellipse emberLava's sea
 * shader welds its crust to). Hot near the shore, where the volcano's outflow keeps it open; further out it follows
 * broad cool rafts and hot leads.
 * Layer B, the flows: a map baked once over the volcano (1 m texels) of the crater lake and the tongues (R), the
 * analytic lobes used where the simulation cannot run (G), and the surface the lava lies on (B). The tongues are
 * splatted from their own vertices with the temperature they are shaded with (aLA.w), so the air shimmers hardest over
 * the hot runs near the crater and less over the cooler, crusted ones. Where the simulation
 * runs, its lobes add their own heat from the live field (temperature and thickness), so a fresh lobe shimmers and a
 * crusted one goes quiet.
 */

const SEA_Y=.15;

const GLSL=/* glsl */`
uniform sampler2D uHzFlow;
uniform vec4 uHzBox;   // min x, min z, 1 / size x, 1 / size z
uniform sampler2D uHzLobes;
uniform vec4 uHzGrid;  // the simulation's origin x, z and size x, z (m)
uniform float uHzSim;
float hzVal(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);
  return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);}
vec4 hazeLayers(vec2 p){
  float e=length(vec2(p.x/128.,(p.y-2.)/155.));
  vec2 ge=vec2(p.x/16384.,(p.y-2.)/24025.)/max(e,1e-3);
  float shore=(e-.899)/max(length(ge),1e-5);
  float raft=mix(.4,1.,smoothstep(.35,.7,hzVal(p/120.+3.1)));
  float sea=smoothstep(-1.,4.,shore)*mix(.95,raft,smoothstep(25.,80.,shore));
  vec2 fu=(p-uHzBox.xy)*uHzBox.zw;
  float flow=0.,base=0.;
  if(all(greaterThan(fu,vec2(0.)))&&all(lessThan(fu,vec2(1.)))){
    vec4 f=texture2D(uHzFlow,fu);
    flow=f.r;base=f.b;
    vec2 g=(p-uHzGrid.xy)/uHzGrid.zw;
    if(uHzSim>.5){
      if(all(greaterThan(g,vec2(0.)))&&all(lessThan(g,vec2(1.)))){
        vec4 s=texture2D(uHzLobes,g);
        flow=max(flow,smoothstep(.3,.95,s.b)*smoothstep(.03,.2,s.g));base+=s.r;
      }
    }else flow=max(flow,f.g);
  }
  return vec4(sea,${SEA_Y.toFixed(2)},flow,base);
}
`;

const smooth=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Heat over a tongue from its shading temperature (0..1): crusted runs keep some, the hot ones near the crater all. */
const tongueHeat=(t:number)=>.45+.55*smooth(.3,.95,t);

/** Pure bake of the flow map: RGBA (crater and tongues, analytic lobes, surface height, 1) over `box`, `nx` x `nz`.
 * `splats` holds x, z, heat triples (tongue vertices), each spread over its texel and the eight round it. */
export function bakeEmberHazeFlow(zones:readonly LavaZone[],surface:(x:number,z:number)=>number,box:{x:number;z:number;w:number;h:number},nx:number,nz:number,splats:Float32Array=new Float32Array(0)):Float32Array{
 const data=new Float32Array(nx*nz*4),spl=new Float32Array(nx*nz);
 for(let k=0;k<splats.length;k+=3){
  const i=Math.floor((splats[k]-box.x)/box.w*nx),j=Math.floor((splats[k+1]-box.z)/box.h*nz),v=splats[k+2];
  for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
   const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nx||jj>=nz)continue;
   const w=di||dj?.7:1,q=jj*nx+ii;spl[q]=Math.max(spl[q],v*w);
  }
 }
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const x=box.x+(i+.5)/nx*box.w,z=box.z+(j+.5)/nz*box.h;
  let flow=0,toe=0;
  for(const zn of zones){
   const c=Math.hypot(x-zn.x,z-zn.z);
   if(c>zn.radius+3)continue;
   // The crater: the lake, not its rampart. A tongue: its own width (the zone adds a metre), crusted, so a little less.
   if(zn.kind==='crater')flow=Math.max(flow,1-smooth(zn.radius*.55,zn.radius*.8,c));
   else if(zn.kind==='tongue')flow=Math.max(flow,.75*(1-smooth(zn.radius-1.5,zn.radius+1.5,c)));
   else toe=Math.max(toe,.6*(1-smooth(zn.radius-2,zn.radius+1,c)));
  }
  flow=Math.max(flow,spl[j*nx+i]);
  const k=(j*nx+i)*4;data[k]=flow;data[k+1]=toe;data[k+2]=surface(x,z);data[k+3]=1;
 }
 return data;
}

export class EmberHaze implements HeatHazeSource {
 readonly glsl=GLSL;
 readonly uniforms:Record<string,THREE.IUniform>;
 /** Ten metres over the crater floor (about ly + 27), the highest hot surface: four and a half scale heights of hot air. */
 readonly top:number;
 /** The player, set while World V is shown (EmberAir.apply). */
 focus:THREE.Vector3|null=null;
 private readonly flowTex:THREE.DataTexture;
 private baked=false;
 private readonly box:{x:number;z:number;w:number;h:number};
 private readonly sim={value:0};
 /** Tongue vertices as x, z, heat (bakeEmberHazeFlow). */
 private readonly splats:Float32Array;

 constructor(readonly root:THREE.Object3D,private readonly lava:EmberLava){
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  for(const z of lava.zones){minX=Math.min(minX,z.x-z.radius);maxX=Math.max(maxX,z.x+z.radius);minZ=Math.min(minZ,z.z-z.radius);maxZ=Math.max(maxZ,z.z+z.radius);}
  const sp:number[]=[],v=new THREE.Vector3();
  lava.root.updateMatrixWorld(true);
  lava.root.traverse(o=>{
   const m=o as THREE.Mesh;if(!m.isMesh||!/^lava-tongue-\d+$/.test(m.name))return;
   const pos=m.geometry.getAttribute('position'),la=m.geometry.getAttribute('aLA');if(!pos||!la)return;
   for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(m.matrixWorld);sp.push(v.x,v.z,tongueHeat(la.getW(i)));minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);}
  });
  this.splats=new Float32Array(sp);
  if(!(maxX>minX)){minX=-1;maxX=1;minZ=-1;maxZ=1;}
  this.top=lava.surfaceY(0,-128)+10;
  this.box={x:minX-4,z:minZ-4,w:maxX-minX+8,h:maxZ-minZ+8};
  const nx=Math.min(256,Math.ceil(this.box.w)),nz=Math.min(256,Math.ceil(this.box.h));
  this.flowTex=new THREE.DataTexture(new Uint16Array(nx*nz*4),nx,nz,THREE.RGBAFormat,THREE.HalfFloatType);
  this.flowTex.minFilter=this.flowTex.magFilter=THREE.LinearFilter;this.flowTex.wrapS=this.flowTex.wrapT=THREE.ClampToEdgeWrapping;
  this.flowTex.colorSpace=THREE.NoColorSpace;this.flowTex.name='EmberHaze.Flow';
  this.uniforms={
   uHzFlow:{value:this.flowTex},
   uHzBox:{value:new THREE.Vector4(this.box.x,this.box.z,1/this.box.w,1/this.box.h)},
   uHzLobes:lava.flow.uniforms.uFR0,
   uHzGrid:lava.flow.uniforms.uFGrid,
   uHzSim:this.sim,
  };
 }

 /** The bake waits for the first frame World V's haze is drawn. */
 prepare(){
  if(!this.baked){
   this.baked=true;
   const img=this.flowTex.image as {data:Uint16Array;width:number;height:number};
   const f=bakeEmberHazeFlow(this.lava.zones,(x,z)=>this.lava.surfaceY(x,z),this.box,img.width,img.height,this.splats);
   for(let i=0;i<f.length;i++)img.data[i]=THREE.DataUtils.toHalfFloat(f[i]);
   this.flowTex.needsUpdate=true;
  }
  this.sim.value=this.lava.flowOn&&this.lava.flow.uniforms.uFR0.value?1:0;
 }
}
