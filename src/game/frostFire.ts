import * as THREE from 'three';

/*
 * Fire for Frostlight's camps and Boreas's braziers: licking tongues and soft halos as points, additive, sized in
 * world units (as snowVillage.ts's lanterns). A hearth burns amber; Boreas's cold fire burns the aurora's colours,
 * green at the root to violet at the tip, its hue drifting slowly per flame.
 */

const TONGUE_VERT = /* glsl */ `
attribute vec3 aFlame; // x seed, y height, z hue (0 hearth, 1 aurora)
uniform float uTime;
uniform float uPx;
varying float vSeed;
varying float vHue;
#include <fog_pars_vertex>
void main(){
 float seed=aFlame.x,f=.8+.2*sin(uTime*(9.+aFlame.z*-4.)+seed*7.)*sin(uTime*6.1+seed*3.);
 float size=aFlame.y*f;
 vec4 mvPosition=modelViewMatrix*vec4(position+vec3(0.,size*.42,0.),1.);
 gl_PointSize=clamp(size*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,320.);
 gl_Position=projectionMatrix*mvPosition;vSeed=seed;vHue=aFlame.z;
 #include <fog_vertex>
}`;
const TONGUE_FRAG = /* glsl */ `
uniform float uTime;
varying float vSeed;
varying float vHue;
#include <fog_pars_fragment>
void main(){
 vec2 c=gl_PointCoord;float y=1.-c.y,x=c.x-.5;
 float slow=1.-vHue*.45;
 x+=(sin(y*7.+uTime*9.*slow+vSeed*5.)*.07+sin(y*13.-uTime*14.*slow+vSeed)*.025)*y;
 float w=.3*pow(max(1.-y,0.),.7)*smoothstep(0.,.22,y)+.02;
 float a=smoothstep(w,w*.35,abs(x))*smoothstep(1.,.75,y);
 if(a<.01)discard;
 float k=clamp(y*1.25+abs(x)/w*.4,0.,1.);
 vec3 hearth=mix(vec3(2.6,2.1,1.2),vec3(2.2,.55,.1),k);
 // Cold fire: white-cyan root, aurora green body, a violet tip that wanders with time.
 float drift=.5+.5*sin(uTime*.37+vSeed*2.);
 vec3 cold=mix(vec3(1.5,2.4,2.3),mix(vec3(.25,1.9,1.05),vec3(.25,1.45,1.9),drift),smoothstep(.0,.45,k));
 cold=mix(cold,vec3(1.05,.45,1.9),smoothstep(.55,1.,k));
 gl_FragColor=vec4(mix(hearth,cold,vHue)*a,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
   gl_FragColor.rgb*=1.-smoothstep(fogNear,fogFar,vFogDepth);
  #endif
 #endif
}`;
const HALO_VERT = /* glsl */ `
attribute vec4 aGlow; // rgb, size
uniform float uTime;
uniform float uPx;
varying vec3 vColor;
#include <fog_pars_vertex>
void main(){
 vec4 mvPosition=modelViewMatrix*vec4(position,1.);
 float f=.9+.1*sin(uTime*5.3+position.x*3.1)*sin(uTime*3.7+position.z);
 gl_PointSize=clamp(aGlow.w*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,400.);
 gl_Position=projectionMatrix*mvPosition;vColor=aGlow.rgb*f;
 #include <fog_vertex>
}`;
const HALO_FRAG = /* glsl */ `
varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
 float r=length(gl_PointCoord-.5)*2.;
 float a=exp(-r*r*4.5)*.85+exp(-r*r*40.)*.5;
 if(a<.003)discard;
 gl_FragColor=vec4(vColor*a,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
   gl_FragColor.rgb*=1.-smoothstep(fogNear,fogFar,vFogDepth);
  #endif
 #endif
}`;

export interface Flame { x: number; y: number; z: number; size: number; cold: boolean }
export interface Halo { x: number; y: number; z: number; size: number; color: THREE.ColorRepresentation; power?: number }

export interface FireSet {
  group: THREE.Group;
  update(time: number): void;
}

/** One draw for every tongue and one for every halo. Each flame spawns `per` tongues around its centre. */
export function frostFire(name: string, flames: readonly Flame[], halos: readonly Halo[], seed = 1, per = 5): FireSet {
  let s = seed >>> 0;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const group = new THREE.Group(); group.name = name;
  const pos: number[] = [], attr: number[] = [];
  for (const f of flames) for (let i = 0; i < per; i++) {
    const a = r() * 6.283, d = r() * f.size * .2, big = i === 0 ? 1 : .55 + r() * .4;
    pos.push(f.x + Math.sin(a) * d, f.y, f.z + Math.cos(a) * d); attr.push(r() * 50, f.size * big, f.cold ? 1 : 0);
  }
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {uTime: {value: 0}, uPx: {value: 450}}]);
  const mats: THREE.ShaderMaterial[] = [];
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aFlame', new THREE.Float32BufferAttribute(attr, 3));
    const m = new THREE.ShaderMaterial({name: `${name}-tongues`, vertexShader: TONGUE_VERT, fragmentShader: TONGUE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, uniforms});
    const pts = new THREE.Points(g, m); pts.name = `${name}-tongues`; pts.frustumCulled = false; pts.renderOrder = 2; group.add(pts); mats.push(m);
  }
  if (halos.length) {
    const g = new THREE.BufferGeometry(), c = new THREE.Color();
    g.setAttribute('position', new THREE.Float32BufferAttribute(halos.flatMap(h => [h.x, h.y, h.z]), 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(halos.flatMap(h => { c.set(h.color).multiplyScalar(h.power ?? .55); return [c.r, c.g, c.b, h.size]; }), 4));
    const m = new THREE.ShaderMaterial({name: `${name}-halos`, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, uniforms});
    const pts = new THREE.Points(g, m); pts.name = `${name}-halos`; pts.frustumCulled = false; pts.renderOrder = 2; group.add(pts); mats.push(m);
  }
  // Point sizes are in world units: half the drawing buffer's height in pixels scales them.
  const buffer = new THREE.Vector2();
  for (const o of group.children) o.onBeforeRender = rr => { rr.getDrawingBufferSize(buffer); uniforms.uPx.value = buffer.y / 2; };
  return {group, update(time) { uniforms.uTime.value = time; }};
}
