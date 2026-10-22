import * as THREE from 'three';
import { SNOW_GROUND_GLSL, SNOW_FINE_GLSL } from './snowTerrain';
import type { SnowFarShadow } from './snowFarShadow';

/*
 * Spindrift: low streamers of snow the wind lifts off the drifts and carries downwind, thickest where it leaves a
 * crest. One draw of ribbons placed on the GPU around the player. Each streamer lives a few seconds: it is born on
 * the better of two random spots (crest and windward slope score highest), runs downwind along the ground at the
 * wind's local veer, hugging the baked ground, and fades out. The ribbon turns about its own axis toward the eye,
 * so it reads as a band from the side and as a streak on the snow from above, and its texture streams faster than
 * the ribbon moves, the way grains outrun the gust that carries them. Snow is kept off the village, the roads and
 * the arena ice (snowKeep). The far sun shadow map darkens streamers that run through shade.
 */

/** Streamers on high; low draws half. */
const COUNT = 420;
/** Segments along a streamer. */
const SEG = 12;
/** Side of the square the streamers are born in, centred on the player, m. */
const SPAN = 136;

const VERTEX = /* glsl */ `
attribute vec4 aDrift;
uniform float sdTime;
uniform vec2 sdCenter;
uniform sampler2D snowGroundTex;
uniform vec4 snowGroundRect;
uniform sampler2DShadow snowFarMap;
uniform mat4 snowFarMatrix;
uniform vec4 snowFarInfo;
varying vec2 vSdUV;
varying float vSdAlpha;
varying float vSdLen;
varying float vSdSeed;
varying float vSdSun;
varying vec3 vSdWorld;
${SNOW_GROUND_GLSL}
${SNOW_FINE_GLSL}
#include <common>
#include <fog_pars_vertex>
vec2 sdHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float sdGround(vec2 p){vec2 uv=(p-snowGroundRect.xy)*snowGroundRect.z;return all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))?textureLod(snowGroundTex,uv,0.).r:SG_SEA;}
// Where the wind lifts snow: crests (the ground above its neighbours) and slopes rising downwind; none where kept.
float sdLift(vec2 p){
  const float E=3.;
  float h=sdGround(p),hx=sdGround(p+vec2(E,0.)),hX=sdGround(p-vec2(E,0.)),hz=sdGround(p+vec2(0.,E)),hZ=sdGround(p-vec2(0.,E));
  float lap=(hx+hX+hz+hZ)*.25-h;
  vec2 g=vec2(hx-hX,hz-hZ)/(2.*E);
  return clamp(.1+smoothstep(.03,.4,-lap)+smoothstep(.04,.3,dot(g,SG_WIND))*.55,0.,1.)*snowKeep(p);
}
vec2 sdWrap(vec2 q){return sdCenter+mod(q-sdCenter+${(SPAN / 2).toFixed(1)},${SPAN.toFixed(1)})-${(SPAN / 2).toFixed(1)};}
void main(){
  float period=mix(3.4,5.8,aDrift.x),k=(sdTime+aDrift.y*period)/period,cyc=floor(k),life=k-cyc;
  // The better of two spots, world-anchored, so a streamer never slides with the player.
  vec2 anchor=floor(sdCenter/${SPAN.toFixed(1)})*${SPAN.toFixed(1)};
  vec2 p1=sdWrap(anchor+sdHash(vec2(aDrift.z*97.3,cyc))*${SPAN.toFixed(1)}),p2=sdWrap(anchor+sdHash(vec2(aDrift.w*61.7,cyc+.5))*${SPAN.toFixed(1)});
  float w1=sdLift(p1),w2=sdLift(p2),w=max(w1,w2);vec2 born=w2>w1?p2:p1;
  float ang=atan(SG_WIND.y,SG_WIND.x)+snowWindField(born).x;
  vec2 dir=vec2(cos(ang),sin(ang)),side=vec2(-dir.y,dir.x);
  float speed=mix(3.8,6.5,aDrift.x),len=mix(3.5,8.5,aDrift.w);
  float s=(position.x-1.)*len;
  vec2 xz=born+dir*(speed*life*period+s)+side*sin(s*.55+aDrift.z*6.3+sdTime*1.1)*.4;
  float g=sdGround(xz);
  vec3 axis=normalize(vec3(dir.x,sdGround(xz+dir*.6)-sdGround(xz-dir*.6),dir.y)*vec3(1.,1./1.2,1.));
  vec3 foot=vec3(xz.x,g+.05,xz.y),eye=normalize(cameraPosition-foot);
  // Turned about its axis toward the eye, never lying flatter than a slight lean.
  vec3 up=cross(axis,eye);up=normalize((up.y<0.?-up:up)+vec3(0.,.3,0.));
  float tall=mix(.3,1.1,aDrift.y)*(.45+.55*position.x)*(.4+.6*w);
  vec3 wp=foot+up*tall*position.y;
  vSdUV=position.xy;vSdLen=len;vSdSeed=aDrift.z;vSdWorld=wp;
  float edge=1.-abs(dot(axis,eye));
  float dist=length(xz-sdCenter),near=length(cameraPosition-wp);
  vSdAlpha=w*smoothstep(0.,.22,life)*(1.-smoothstep(.62,1.,life))*snowKeep(xz)*smoothstep(.04,.35,edge)
    *(1.-smoothstep(${(SPAN / 2 - 24).toFixed(1)},${(SPAN / 2 - 2).toFixed(1)},dist))*smoothstep(1.2,4.,near);
  // Through shade or sun: one hardware-filtered tap of the far sun map.
  vSdSun=1.;
  if(snowFarInfo.x>.5){vec4 c=snowFarMatrix*vec4(wp+vec3(0.,.25,0.),1.);if(c.x>0.&&c.x<1.&&c.y>0.&&c.y<1.&&c.z<1.)vSdSun=texture(snowFarMap,vec3(c.xy,c.z-snowFarInfo.z));}
  vec4 mvPosition=viewMatrix*vec4(wp,1.);
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float sdTime;
uniform float sdStrength;
uniform vec3 sdSunDir;
uniform vec3 sdSunLight;
uniform vec3 sdSky;
uniform vec3 sdBounce;
uniform float sdGain;
varying vec2 vSdUV;
varying float vSdAlpha;
varying float vSdLen;
varying float vSdSeed;
varying float vSdSun;
varying vec3 vSdWorld;
#include <common>
#include <fog_pars_fragment>
vec2 sdH2(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float sdN(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(sdH2(i)*2.-1.,f),b=dot(sdH2(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(sdH2(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(sdH2(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
void main(){
  float u=vSdUV.x,v=vSdUV.y,along=u*vSdLen;
  // Wisps stretched along the wind, streaming faster than the streamer itself.
  float n=sdN(vec2(along*.35-sdTime*1.7,v*3.2+vSdSeed*17.))*.55+sdN(vec2(along*1.15-sdTime*3.9,v*7.+vSdSeed*9.))*.45;
  float body=smoothstep(0.,.1,v)*pow(1.-v,1.3)*smoothstep(0.,.45,u)*(1.-smoothstep(.86,1.,u));
  float a=min(vSdAlpha*body*smoothstep(-.35,.45,n)*sdStrength,.7);
  if(a<.002)discard;
  // Fine powder scatters white: a little sun every way, much more looking toward it (Henyey-Greenstein, g .55),
  // the sky and the snow below. Taken as luminance, so a low sun gilds the snow but never turns powder to sand.
  vec3 V=normalize(vSdWorld-cameraPosition);
  float mu=dot(V,sdSunDir),hg=min((1.-.3025)/pow(1.3025-1.1*mu,1.5),3.);
  vec3 e=sdSunLight*(.2+hg*.3)*vSdSun+sdSky+sdBounce*.3;
  vec3 col=mix(vec3(.9,.94,1.),normalize(sdSunLight)*1.6,.12*vSdSun*smoothstep(.2,.9,mu))*dot(e,vec3(.2126,.7152,.0722))*sdGain*RECIPROCAL_PI;
  gl_FragColor=vec4(col,a);
  #include <fog_fragment>
}
`;

export interface SnowSpindriftOptions {
  sunDir: THREE.Vector3;
  /** Direct sun and hemisphere sky, renderer units (SnowSky.sunLight, hemiSky). */
  sunLight: THREE.Color;
  sky: THREE.Color;
  /** Light the snow throws back up (SnowSky.hemiGround). */
  bounce: THREE.Color;
  /** The baked ground the streamers hug (SnowTerrain.uniforms). */
  ground: { snowGroundTex: { value: THREE.Texture | null }; snowGroundRect: { value: THREE.Vector4 } };
  far: SnowFarShadow;
}

export class SnowSpindrift {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  constructor(opts: SnowSpindriftOptions) {
    const per = (SEG + 1) * 2, pos = new Float32Array(COUNT * per * 3), seed = new Float32Array(COUNT * per * 4), idx: number[] = [];
    let s = 20261019;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < COUNT; i++) {
      const h = [rnd(), rnd(), rnd(), rnd()], o = i * per;
      for (let j = 0; j <= SEG; j++) for (let r = 0; r < 2; r++) {
        const k = o + j * 2 + r;
        pos.set([j / SEG, r, 0], k * 3);
        seed.set(h, k * 4);
      }
      for (let j = 0; j < SEG; j++) { const a = o + j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDrift', new THREE.BufferAttribute(seed, 4));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      sdTime: { value: 0 },
      sdCenter: { value: new THREE.Vector2() },
      sdStrength: { value: 2.2 },
      sdGain: { value: 2.4 },
      sdSunDir: { value: opts.sunDir },
      sdSunLight: { value: opts.sunLight },
      sdSky: { value: opts.sky },
      sdBounce: { value: opts.bounce },
      snowGroundTex: opts.ground.snowGroundTex,
      snowGroundRect: opts.ground.snowGroundRect,
      ...opts.far.uniforms,
    };
    const mat = new THREE.ShaderMaterial({
      name: 'frostlight-spindrift', vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'frostlight-spindrift';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.userData.streamers = COUNT;
  }

  update(time: number, x: number, z: number): void {
    this.uniforms.sdTime.value = time;
    (this.uniforms.sdCenter.value as THREE.Vector2).set(x, z);
  }

  setQuality(q: 'high' | 'low'): void {
    this.mesh.geometry.setDrawRange(0, (q === 'low' ? COUNT / 2 : COUNT) * SEG * 6);
    this.mesh.userData.drawn = q === 'low' ? COUNT / 2 : COUNT;
  }
}
