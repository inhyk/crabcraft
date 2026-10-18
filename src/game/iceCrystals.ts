import * as THREE from 'three';

/*
 * Grown ice formations for Frostlight. The crystal shape (a six-sided tapered prism with a point, its hexagon
 * broken per seed) and the ice shading (flat facets from derivatives, path absorption, refraction with
 * dispersion, back-lit glow, a frosted foot that attaches it to the drift) are ported from SNOWFLOW's
 * crystal.wgsl and crystal.fragment.wgsl (MIT, Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md).
 * SNOWFLOW refracts into a baked sky LUT; this world has none, so `env()` is the island's own sky gradient
 * over a snow bounce.
 */

export interface Crystal {
  x: number;
  y: number;
  z: number;
  /** Growth axis, need not be normalised. */
  axis: [number, number, number];
  height: number;
  radius: number;
  seed: number;
}

const fract = (v: number) => v - Math.floor(v);
function hash21(x: number, y: number): number {
  let p3x = fract(x * 0.1031), p3y = fract(y * 0.1031), p3z = fract(x * 0.1031);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  return fract((p3x + p3y) * p3z);
}

/** Local vertex `v` (0..5 base ring, 6..11 shoulder ring, 12 apex), +Y along the growth axis. */
function crystalLocal(v: number, height: number, radius: number, seed: number): [number, number, number] {
  if (v === 12) return [(hash21(seed, 7.31) - 0.5) * radius * 0.5, height, (hash21(7.31, seed) - 0.5) * radius * 0.5];
  const ring = v < 6 ? 0 : 1, k = v % 6;
  const ang = k * 1.04719755 + seed * 6.2831853;
  // Each radial direction gets its own length: no regular hexagon, which reads as manufactured.
  const wob = 0.72 + 0.56 * hash21(k + seed * 31, seed * 17);
  const r = ring ? radius * wob * 0.68 : radius * wob;
  return [Math.cos(ang) * r, ring ? height * 0.58 : 0, Math.sin(ang) * r];
}

/** One non-indexed geometry for many crystals, so every facet is flat and a whole formation is one draw. */
export function crystalGeometry(list: readonly Crystal[]): THREE.BufferGeometry {
  const pos: number[] = [], h01: number[] = [], seeds: number[] = [];
  const axis = new THREE.Vector3(), ex = new THREE.Vector3(), ez = new THREE.Vector3(), ref = new THREE.Vector3();
  const pts: THREE.Vector3[] = Array.from({ length: 13 }, () => new THREE.Vector3());
  const hs = new Float32Array(13);
  for (const c of list) {
    axis.set(...c.axis);
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    axis.normalize();
    ref.set(Math.abs(axis.y) < 0.9 ? 0 : 1, 0, Math.abs(axis.y) < 0.9 ? 1 : 0);
    ex.crossVectors(ref, axis).normalize();
    ez.crossVectors(axis, ex);
    for (let v = 0; v < 13; v++) {
      const [lx, ly, lz] = crystalLocal(v, c.height, c.radius, c.seed);
      pts[v].set(c.x, c.y, c.z).addScaledVector(ex, lx).addScaledVector(axis, ly).addScaledVector(ez, lz);
      hs[v] = ly / c.height;
    }
    const tri = (a: number, b: number, d: number) => {
      for (const i of [a, b, d]) { pos.push(pts[i].x, pts[i].y, pts[i].z); h01.push(hs[i]); seeds.push(c.seed); }
    };
    for (let k = 0; k < 6; k++) {
      const k1 = (k + 1) % 6;
      tri(k, 6 + k, k1);
      tri(k1, 6 + k, 6 + k1);
      tri(6 + k, 12, 6 + k1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH01', new THREE.Float32BufferAttribute(h01, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * A formation: one main crystal and satellites leaning out of it, like ice that grew from one seed.
 * `rand` is a deterministic 0..1 source, so the island looks the same for every player.
 */
export function crystalCluster(x: number, y: number, z: number, height: number, spread: number, count: number, rand: () => number, out: Crystal[] = []): Crystal[] {
  const lean = () => (rand() - 0.5) * 0.14;
  out.push({ x, y: y - 0.25, z, axis: [lean(), 1, lean()], height, radius: spread * 0.42, seed: rand() * 97 });
  for (let j = 0; j < count; j++) {
    const a = (j / count + rand() * 0.18) * Math.PI * 2, d = spread * (0.35 + rand() * 0.45);
    const tilt = 0.25 + rand() * 0.45;
    out.push({
      x: x + Math.sin(a) * d, y: y - 0.2, z: z + Math.cos(a) * d,
      axis: [Math.sin(a) * tilt, 1, Math.cos(a) * tilt],
      height: height * (0.22 + rand() * 0.42),
      radius: spread * (0.12 + rand() * 0.14),
      seed: rand() * 97,
    });
  }
  return out;
}

export interface IceOptions {
  sun: THREE.DirectionalLight;
  skyHorizon?: THREE.ColorRepresentation;
  skyZenith?: THREE.ColorRepresentation;
  snowBounce?: THREE.ColorRepresentation;
  /** Overall brightness of the back-lit glow. */
  scatter?: number;
}

const ICE_VERTEX = /* glsl */ `
attribute float aH01;
attribute float aSeed;
varying vec3 vWorld;
varying float vH01;
varying float vSeed;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vWorld=w.xyz;vH01=aH01;vSeed=aSeed;
  vec4 mvPosition=viewMatrix*w;
  gl_Position=projectionMatrix*mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const ICE_FRAGMENT = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyHorizon;
uniform vec3 skyZenith;
uniform vec3 snowBounce;
uniform float scatter;
varying vec3 vWorld;
varying float vH01;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
vec2 icHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float icNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(icHash22(i)*2.-1.,f),b=dot(icHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(icHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(icHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
// What the ice sees: the island's sky above the horizon, lit snow below it.
vec3 env(vec3 d){
  if(d.y<0.)return snowBounce*(.55+.45*smoothstep(-1.,0.,d.y));
  return mix(skyHorizon,skyZenith,smoothstep(0.,.6,d.y))+sunColor*.03*pow(max(dot(d,sunDir),0.),12.);
}
float wrapDiffuse(float nl,float w){return max(0.,(nl+w)/((1.+w)*(1.+w)));}
void main(){
  #include <logdepthbuf_fragment>
  vec3 V=normalize(cameraPosition-vWorld);
  vec3 L=normalize(sunDir);
  // Flat facet normal from the geometry: the facet-to-facet jump in reflected sky is the look of ice.
  vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
  if(dot(N,V)<0.)N=-N;
  float NdotV=clamp(dot(N,V),1e-4,1.),NdotL=dot(N,L);
  // Frost where it comes out of the drift, so it looks grown rather than placed.
  float grain=icNoise(vWorld.xz*6.+vSeed*19.)*.5+.5;
  float frost=clamp((1.-smoothstep(.01,.22,vH01))*(.45+.6*grain),0.,1.);
  // Optical path: long edge-on and near the thick base, short face-on and at the tip.
  float path=clamp((.16+.42*(1.-vH01))*(.7+2.*(1.-NdotV)),.02,1.4);
  // A little stronger than SNOWFLOW's hand-sized crystals: these are cliff-sized, so the blue carries.
  vec3 transmit=exp(-vec3(3.4,.95,.38)*path);
  vec3 mirror=reflect(-V,N);
  vec3 rr=refract(-V,N,1./1.305),rg=refract(-V,N,1./1.309),rb=refract(-V,N,1./1.317);
  if(dot(rr,rr)<.5)rr=mirror;
  if(dot(rg,rg)<.5)rg=mirror;
  if(dot(rb,rb)<.5)rb=mirror;
  vec3 color=vec3(env(rr).r,env(rg).g,env(rb).b)*transmit;
  // Back-lit: the sun behind a crystal lights it along its whole length instead of leaving a silhouette.
  vec3 hS=normalize(L+N*.42);
  float through=pow(clamp(dot(V,-hS),0.,1.),2.2);
  vec3 deepTint=mix(vec3(.42,.74,1.),vec3(.86,.95,1.),exp(-path*2.5));
  color+=sunColor*RECIPROCAL_PI*deepTint*through*scatter*1.6;
  color+=env(N)*deepTint*.35;
  // Inclusions: bubbles and growth bands frozen into the body, so a prism is not one flat tint.
  float band=icNoise(vec2(vWorld.y*1.7+vSeed*5.,vSeed))*.5+.5;
  float bubbles=smoothstep(.55,.95,icNoise(vWorld.xz*1.3+vWorld.y*2.1+vSeed*11.)*.5+.5);
  color*=mix(.78,1.18,band);
  color+=deepTint*bubbles*.18*(1.-vH01);
  if(frost>.002){
    vec3 fa=vec3(.88,.915,.965);
    vec3 fc=fa*RECIPROCAL_PI*sunColor*wrapDiffuse(NdotL,.62)+fa*env(N)*.55;
    color=mix(color,fc,frost*.9);
  }
  float rough=mix(.045,.42,frost);
  float F=.021+.979*pow(1.-NdotV,5.);
  color=mix(color,env(mirror),F*(1.-frost*.75));
  if(NdotL>0.){
    vec3 H=normalize(V+L);
    float a2=rough*rough*rough*rough,nh=clamp(dot(N,H),0.,1.);
    float dd=nh*nh*(a2-1.)+1.;
    float D=a2/(PI*dd*dd);
    float k=(rough+1.)*(rough+1.)/8.;
    float Vis=1./((NdotV*(1.-k)+k)*(NdotL*(1.-k)+k)*4.);
    float Fs=.021+.979*pow(1.-clamp(dot(V,H),0.,1.),5.);
    color+=sunColor*D*Vis*Fs*NdotL;
  }
  float alpha=clamp(.56+.34*(1.-exp(-path*2.2))+.26*(1.-NdotV)+frost*.55,0.,1.);
  gl_FragColor=vec4(color,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Blended but depth-writing: the first facet at a pixel shows the snow behind it, every facet behind that is
 * depth-rejected, so no crystal is ever blended over another one.
 */
export function iceMaterial(opts: IceOptions): { material: THREE.ShaderMaterial; refresh: () => void } {
  const sunDir = new THREE.Vector3(0, 1, 0), sunColor = new THREE.Color(), tmp = new THREE.Vector3();
  const material = new THREE.ShaderMaterial({
    vertexShader: ICE_VERTEX,
    fragmentShader: ICE_FRAGMENT,
    transparent: true,
    depthWrite: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      sunDir: { value: sunDir },
      sunColor: { value: sunColor },
      // Linear values, the same numbers the island's sky shader writes.
      skyHorizon: { value: opts.skyHorizon ? new THREE.Color(opts.skyHorizon) : new THREE.Color().setRGB(0.32, 0.49, 0.65) },
      skyZenith: { value: opts.skyZenith ? new THREE.Color(opts.skyZenith) : new THREE.Color().setRGB(0.015, 0.045, 0.13) },
      snowBounce: { value: opts.snowBounce ? new THREE.Color(opts.snowBounce) : new THREE.Color().setRGB(0.55, 0.65, 0.78) },
      scatter: { value: opts.scatter ?? 0.9 },
    }]),
  });
  // merge() clones values, so keep the live objects the refresh writes into.
  material.uniforms.sunDir.value = sunDir;
  material.uniforms.sunColor.value = sunColor;
  const refresh = () => {
    opts.sun.getWorldPosition(sunDir);
    opts.sun.target.getWorldPosition(tmp);
    sunDir.sub(tmp).normalize();
    sunColor.copy(opts.sun.color).multiplyScalar(opts.sun.intensity);
  };
  refresh();
  return { material, refresh };
}
