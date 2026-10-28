import * as THREE from 'three';

/*
 * The living volcano and the air round it, all on the GPU (no per-frame CPU work but a few uniforms):
 * - plume: shaded smoke puffs rising from the crater, spreading and leaning downwind, lit gold on the sun side and red
 *   from the crater underneath, fading into the shelf the sky already carries;
 * - fountain: embers thrown from the crater in ballistic arcs;
 * - air: ash flakes drifting down and embers rising off the lava, in a box that wraps round the camera, ash thicker
 *   toward the volcano, embers only where the heat map says the lava is near.
 * Embers and ash share one Points draw with premultiplied blending (ash covers, embers add).
 * The cone keeps its mesh; its material becomes layered basalt and ash with gullies and glowing fissures.
 */

export interface PlumeOptions {
 /** Crater centre at the rim's height. */
 crater:THREE.Vector3;
 sunDir:THREE.Vector3;
 sunColor:THREE.Color;
 /** Horizontal direction the wind blows toward (x, z). */
 wind:THREE.Vector2;
 heat:{uHeatMap:{value:THREE.Texture|null};uHeatBox:{value:THREE.Vector4}};
 quality:'high'|'low';
}

const FOG_PARS=/* glsl */`
uniform vec3 fogColor;
uniform float fogDensity;
float emberFog(float depth){return 1.-exp(-fogDensity*fogDensity*depth*depth);}
`;

/** A soft lumpy puff, baked once (64 x 64, alpha only). */
function puffTexture():THREE.DataTexture{
 const N=64,d=new Uint8Array(N*N*4);
 const h=(x:number,y:number)=>{const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);};
 const vn=(x:number,y:number)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);
  const a=h(ix%8,iy%8),b=h((ix+1)%8,iy%8),c=h(ix%8,(iy+1)%8),e=h((ix+1)%8,(iy+1)%8);return (a+(b-a)*ux)*(1-uy)+(c+(e-c)*ux)*uy;};
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  const u=(i+.5)/N*2-1,v=(j+.5)/N*2-1,r=Math.hypot(u,v);
  let n=0,a=.5,f=4;for(let o=0;o<4;o++){n+=a*vn((u*.5+.5)*f,(v*.5+.5)*f);a*=.5;f*=2;}
  const edge=1-Math.min(1,r/(.62+.38*n));
  const k=(j*N+i)*4;d[k]=d[k+1]=d[k+2]=255;d[k+3]=Math.round(255*Math.max(0,Math.min(1,Math.pow(Math.max(0,edge),1.15)*(.55+.7*n))));
  d[k]=Math.round(255*n);
 }
 const t=new THREE.DataTexture(d,N,N,THREE.RGBAFormat);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;
 return t;
}

const PLUME_VERT=/* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCrater;
uniform vec2 uWind;
varying vec2 vUv;
varying float vAge;
varying float vHeight;
varying float vDepth;
varying float vRot;
varying float vSeed;
void main(){
  float life=34.;
  float age=fract(uTime/life+aSeed.x);
  vAge=age;vSeed=aSeed.y;
  float h=pow(age,.72)*118.;
  float spread=3.+age*26.;
  vec2 side=vec2(cos(aSeed.z*6.283),sin(aSeed.z*6.283))*spread*aSeed.w*.55;
  vec2 drift=uWind*pow(age,1.7)*78.;
  float swirl=sin(uTime*.07+aSeed.y*20.)*age*5.;
  vec3 c=uCrater+vec3(side.x+drift.x+swirl,h,side.y+drift.y-swirl*.5);
  float size=(11.+age*52.)*(.75+.5*aSeed.y);
  vec4 mv=viewMatrix*vec4(c,1.);
  vRot=aSeed.z*6.283+uTime*.015*(aSeed.y-.5);
  float cr=cos(vRot),sr=sin(vRot);
  vec2 q=mat2(cr,sr,-sr,cr)*position.xy;
  mv.xy+=position.xy*size;
  vUv=q+.5;
  vHeight=h;
  vDepth=-mv.z;
  gl_Position=projectionMatrix*mv;
}
`;

const PLUME_FRAG=/* glsl */`
uniform sampler2D uPuff;
uniform vec3 uSunView;
uniform vec3 uSunColor;
uniform vec3 uSmoke;
uniform vec3 uSmokeHigh;
uniform vec3 uGlow;
varying vec2 vUv;
varying float vAge;
varying float vHeight;
varying float vDepth;
varying float vRot;
varying float vSeed;
${FOG_PARS}
void main(){
  vec4 p=texture2D(uPuff,vUv);
  float a=p.a*smoothstep(0.,.07,vAge)*(1.-smoothstep(.55,1.,vAge))*.92;
  if(a<.004)discard;
  // A sphere's normal across the billboard (screen-space), bent by the puff's own lumps.
  vec2 c=(vUv-.5)*2.;
  float cr=cos(-vRot),sr=sin(-vRot);c=mat2(cr,sr,-sr,cr)*c;
  vec3 n=normalize(vec3(c*1.1,sqrt(max(.05,1.-dot(c,c)))+(p.r-.5)*.6));
  float sun=max(0.,dot(n,uSunView)*.6+.4);
  vec3 base=mix(uSmoke,uSmokeHigh,smoothstep(8.,70.,vHeight))*(.7+.45*p.r);
  vec3 col=base*(.45+1.1*sun*uSunColor);
  // The crater lights the smoke from underneath: strong at the vent, gone a few tens of metres up.
  float under=exp(-vHeight/22.)*(.55+.45*clamp(-n.y*1.4+.5,0.,1.));
  col+=uGlow*under*(1.+.4*vSeed);
  col=mix(col,fogColor,emberFog(vDepth)*.85);
  gl_FragColor=vec4(col*a,a);
}
`;

const AIR_VERT=/* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uOrigin;
uniform vec3 uBox;
uniform vec3 uCrater;
uniform float uViewH;
uniform sampler2D uHeatMap;
uniform vec4 uHeatBox;
uniform vec2 uWind;
varying vec4 vCol;
varying float vDepth;
varying float vKind;
void main(){
  vec3 p;float a;vec3 col;float size;
  if(aSeed.w<.18){
    // Crater fountain: ballistic embers thrown out of the vent.
    float life=2.2+aSeed.y*1.4;
    float t=fract(uTime/life+aSeed.x)*life;
    float ang=aSeed.z*6.283;
    vec2 dir=vec2(cos(ang),sin(ang))*(2.+5.*aSeed.y);
    float up=13.+9.*fract(aSeed.x*7.3);
    p=uCrater+vec3(dir.x*t+uWind.x*t*t*.8,up*t-4.9*t*t,dir.y*t+uWind.y*t*t*.8);
    float k=t/life;
    a=(1.-smoothstep(.55,1.,k));
    col=mix(vec3(4.,1.7,.45),vec3(1.3,.25,.05),k);
    size=.14+.12*aSeed.y;
    vKind=1.;
  }else{
    // Wrapped round the camera: each particle drifts and comes back in from the far side of the box.
    vec3 s=aSeed.xyz*uBox;
    bool ember=aSeed.w<.42;
    vec3 drift=ember?vec3(uWind.x*.6+sin(uTime*.7+aSeed.x*40.)*.4,1.5+aSeed.y,uWind.y*.6+cos(uTime*.6+aSeed.z*40.)*.4):vec3(uWind.x*1.4+sin(uTime*.3+aSeed.z*30.)*.6,-.55-.3*aSeed.x,uWind.y*1.4+cos(uTime*.25+aSeed.x*30.)*.6);
    p=s+drift*uTime;
    p=mod(p-uOrigin+uBox*.5,uBox)-uBox*.5+uOrigin;
    p.y+=uBox.y*.3;
    vec4 hm=texture2D(uHeatMap,(p.xz-uHeatBox.xy)*uHeatBox.zw);
    float vol=exp(-length(p.xz-uCrater.xz)/75.);
    if(ember){
      float heat=clamp(hm.r*exp(-max(0.,p.y-.15)*.07)+hm.g*.8+vol*.15,0.,1.);
      a=heat*(.55+.45*sin(uTime*3.+aSeed.x*60.));
      col=vec3(3.2,1.1,.25)*(.6+.6*aSeed.y);
      size=.07+.07*aSeed.y;
      vKind=1.;
    }else{
      a=(.32+.5*vol)*(.6+.4*aSeed.y);
      col=mix(vec3(.21,.2,.22),vec3(.42,.4,.41),aSeed.z);
      size=.07+.1*aSeed.x;
      vKind=0.;
    }
    // Fade at the box walls so the wrap never pops.
    vec3 w=abs(p-uOrigin-vec3(0.,uBox.y*.3,0.))/(uBox*.5);
    a*=1.-smoothstep(.7,1.,max(w.x,max(w.y,w.z)));
  }
  vec4 mv=viewMatrix*vec4(p,1.);
  vDepth=-mv.z;
  gl_PointSize=clamp(size*projectionMatrix[1][1]*uViewH*.5/max(.5,vDepth),1.,24.);
  // Sub-pixel particles keep their energy as alpha instead of vanishing.
  float px=size*projectionMatrix[1][1]*uViewH*.5/max(.5,vDepth);
  a*=clamp(px,.25,1.);
  vCol=vec4(col,a);
  gl_Position=projectionMatrix*mv;
}
`;

const AIR_FRAG=/* glsl */`
varying vec4 vCol;
varying float vDepth;
varying float vKind;
${FOG_PARS}
void main(){
  float r=length(gl_PointCoord-.5)*2.;
  float a=vCol.a*(1.-smoothstep(.35,1.,r));
  if(a<.004)discard;
  float f=emberFog(vDepth);
  vec3 col=vKind>.5?vCol.rgb*(1.-f*.8):mix(vCol.rgb,fogColor,f);
  // Premultiplied: ash covers what is behind it, embers only add light.
  gl_FragColor=vec4(col*a,vKind>.5?0.:a);
}
`;

export class EmberPlume {
 readonly root=new THREE.Group();
 private readonly plumeMat:THREE.ShaderMaterial;
 private readonly airMat:THREE.ShaderMaterial;
 private readonly sunView=new THREE.Vector3();
 private readonly puff:THREE.DataTexture;
 constructor(o:PlumeOptions){
  this.root.name='ember-plume-and-air';
  const fog=THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  const high=o.quality==='high';
  // Plume: instanced billboards.
  const puffs=high?96:56;
  const quad=new THREE.PlaneGeometry(1,1),geo=new THREE.InstancedBufferGeometry();
  geo.index=quad.index;geo.setAttribute('position',quad.getAttribute('position'));geo.instanceCount=puffs;
  const seeds=new Float32Array(puffs*4);
  for(let i=0;i<puffs;i++){const f=(n:number)=>{const s=Math.sin((i+1)*n)*43758.5453;return s-Math.floor(s);};seeds.set([i/puffs+f(3.1)*.6/puffs,f(12.9),f(78.2),.35+.65*f(39.4)],i*4);}
  geo.setAttribute('aSeed',new THREE.InstancedBufferAttribute(seeds,4));
  geo.boundingSphere=new THREE.Sphere(o.crater.clone().add(new THREE.Vector3(o.wind.x*40,50,o.wind.y*40)),140);
  this.puff=puffTexture();
  this.plumeMat=new THREE.ShaderMaterial({
   name:'ember-plume',vertexShader:PLUME_VERT,fragmentShader:PLUME_FRAG,transparent:true,depthWrite:false,fog:true,
   blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
   uniforms:{...fog,uTime:{value:0},uCrater:{value:o.crater},uWind:{value:o.wind},uPuff:{value:this.puff},uSunView:{value:this.sunView},
    uSunColor:{value:o.sunColor.clone().multiplyScalar(1.15)},uSmoke:{value:new THREE.Color('#2a2427')},uSmokeHigh:{value:new THREE.Color('#5e5558')},uGlow:{value:new THREE.Color('#ff5a1e').multiplyScalar(1.6)}},
  });
  const plume=new THREE.Mesh(geo,this.plumeMat);plume.name='ember-volcano-plume';plume.renderOrder=3;plume.frustumCulled=true;
  // Air: fountain embers, rising embers and ash.
  const count=high?1700:800,fountain=high?150:80,all=count+fountain;
  const pg=new THREE.BufferGeometry(),ps=new Float32Array(all*4);
  for(let i=0;i<all;i++){const f=(n:number)=>{const s=Math.sin((i+1)*n)*43758.5453;return s-Math.floor(s);};const w=i<fountain?f(5.7)*.17:.18+f(5.7)*.82;ps.set([f(1.3),f(2.7),f(9.1),w],i*4);}
  pg.setAttribute('aSeed',new THREE.BufferAttribute(ps,4));
  pg.setAttribute('position',new THREE.BufferAttribute(new Float32Array(all*3),3));
  this.airMat=new THREE.ShaderMaterial({
   name:'ember-air',vertexShader:AIR_VERT,fragmentShader:AIR_FRAG,transparent:true,depthWrite:false,fog:true,
   blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
   uniforms:{...fog,uTime:{value:0},uOrigin:{value:new THREE.Vector3()},uBox:{value:new THREE.Vector3(96,38,96)},uCrater:{value:o.crater},
    uViewH:{value:900},uHeatMap:o.heat.uHeatMap,uHeatBox:o.heat.uHeatBox,uWind:{value:o.wind}},
  });
  const air=new THREE.Points(pg,this.airMat);air.name='ember-ash-and-embers';air.frustumCulled=false;air.renderOrder=4;
  this.root.add(plume,air);
  this.sunDir=o.sunDir;
 }
 private readonly sunDir:THREE.Vector3;
 update(time:number){this.plumeMat.uniforms.uTime.value=time;this.airMat.uniforms.uTime.value=time;}
 /** Per frame: the view-space sun for the puffs' shading, the box round the camera, the viewport height for point sizes. */
 view(camera:THREE.Camera,groundY:number,viewH:number){
  this.sunView.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
  const e=camera.matrixWorld.elements;this.airMat.uniforms.uOrigin.value.set(e[12],groundY,e[14]);
  this.airMat.uniforms.uViewH.value=viewH;
 }
 dispose(){this.puff.dispose();}
}

/**
 * The cone's surface: layered basalt and ash strata, oxidised red bands, gullies running down the slope (shading and a
 * bump from the same field), and fissures that glow brighter toward the crater. The mesh and its placement are
 * unchanged; the lava tongues lie on top of it as before.
 */
export function volcanoMaterial(cx:number,cz:number,baseY:number,topY:number):THREE.MeshStandardMaterial{
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.92,metalness:0});
 m.name='ember-volcano-strata';
 const u={uCone:{value:new THREE.Vector4(cx,cz,baseY,topY)}};
 m.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,u);
  shader.vertexShader='varying vec3 vVolW;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvVolW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=`uniform vec4 uCone;\nvarying vec3 vVolW;
float vHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vNoise(vec2 p){vec2 i=floor(p),f=fract(p),w=f*f*(3.-2.*f);return mix(mix(vHash(i),vHash(i+vec2(1,0)),w.x),mix(vHash(i+vec2(0,1)),vHash(i+vec2(1,1)),w.x),w.y);}
float vFbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vNoise(p);p=p*2.03+vec2(3.1,7.7);a*=.5;}return s;}
struct VolSurf{float gully;float strata;float hgt;float fissure;float top;};
VolSurf volSurf(){
  VolSurf s;
  vec2 d=vVolW.xz-uCone.xy;
  float ang=atan(d.x,d.y);
  float t=clamp((vVolW.y-uCone.z)/(uCone.w-uCone.z),0.,1.);
  s.top=t;
  // Gullies: streaks around the cone that run straight down the slope, deeper toward the top.
  float g=vFbm(vec2(ang*9.,vVolW.y*.05));
  float g2=vNoise(vec2(ang*31.,vVolW.y*.08));
  s.gully=smoothstep(.35,.7,g)*.7+g2*.3;
  // Strata: tilted bands of ash and lava, broken by noise.
  float y=vVolW.y+(vFbm(vec2(ang*3.,vVolW.y*.1))-.5)*5.+sin(ang*2.)*1.5;
  s.strata=fract(y/2.3);
  s.hgt=s.gully*.9+smoothstep(.0,.15,s.strata)*.35;
  // Fissures: thin lines along the fall line where the noise crosses its middle.
  float f=abs(vFbm(vec2(ang*7.+vVolW.y*.03,vVolW.y*.045))-.5);
  s.fissure=(1.-smoothstep(.0,.018+.01*t,f))*smoothstep(.35,.9,t)*smoothstep(.25,.6,vNoise(vec2(ang*4.,vVolW.y*.03)));
  return s;
}
`+shader.fragmentShader
   .replace('#include <color_fragment>',`#include <color_fragment>
VolSurf vs=volSurf();
{
  vec3 basalt=vec3(.032,.03,.036),ash=vec3(.1,.093,.1),ox=vec3(.085,.04,.03);
  float band=step(.62,vs.strata)*.8+step(.86,vs.strata)*.2;
  vec3 c=mix(basalt,ash,band*.85);
  c=mix(c,ox,smoothstep(.4,.55,vs.strata)*(1.-smoothstep(.55,.62,vs.strata))*.8);
  c*=.7+.6*vs.gully;
  // Ash settles lighter on the lower slopes, the summit is scorched dark and warm.
  c=mix(c,vec3(.13,.12,.125),smoothstep(.45,.0,vs.top)*.35);
  c=mix(c,vec3(.05,.025,.02),smoothstep(.75,1.,vs.top)*.6);
  diffuseColor.rgb=c;
}`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=.78+.18*vs.gully;')
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
{
  vec3 dpx=dFdx(-vViewPosition),dpy=dFdy(-vViewPosition);
  float hx=dFdx(vs.hgt),hy=dFdy(vs.hgt);
  vec3 r1=cross(dpy,normal),r2=cross(normal,dpx);
  float det=dot(dpx,r1);
  vec3 grad=sign(det)*(hx*r1+hy*r2);
  normal=normalize(abs(det)*normal-grad*1.6);
}`)
   .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
totalEmissiveRadiance+=vec3(3.2,.75,.12)*vs.fissure*(.55+.45*vNoise(vec2(vVolW.y*.3,0.)))+vec3(.5,.1,.02)*smoothstep(.86,1.,vs.top)*.35;`);
 };
 m.customProgramCacheKey=()=>'ember-volcano-strata';
 return m;
}
