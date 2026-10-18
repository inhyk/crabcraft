import * as THREE from 'three';
import { SNOW_DEFORM_READ, type SnowDeform } from './snowDeform';
import type { Unit } from './unit';

/*
 * The Frostlight snow surface. Reads SnowDeform for prints and berms, adds wind-carved ripples and fine
 * grain, and ports SNOWFLOW's back-scatter subsurface term and grazing-angle glints (shading.wgsl, MIT,
 * Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md) onto a MeshStandardMaterial.
 */

export interface SnowSurfaceOptions {
  /** Light the glints and back-scatter answer to. Its world direction and radiance are read every frame. */
  sun: THREE.DirectionalLight;
  /** Height relief of prints in the normal, 1 = true slope. */
  relief?: number;
  glints?: number;
  subsurface?: number;
}

const SURFACE_FRAGMENT_HEAD = /* glsl */ `
${SNOW_DEFORM_READ}
uniform vec3 snowSunDir;
uniform vec3 snowSunColor;
uniform float snowRelief;
uniform float snowGlintStrength;
uniform float snowScatterStrength;
varying vec3 vSnowWorld;
// Sastrugi: ripples carved across the prevailing wind, warped so they never read as a pattern, plus grain.
vec2 snowDetailGrad(vec2 p,float fade){
  vec2 wd=vec2(.8,.6);
  float warp=sdNoise2(p*.31)*2.6;
  float ph=dot(p,wd)*2.4+warp;
  float amp=.03*(.55+.45*sdNoise2(p*.11+3.7));
  vec2 g=wd*cos(ph)*2.4*amp*smoothstep(1.,.25,fade);
  float e=.05,f=8.;
  float n0=sdNoise2(p*f),nx=sdNoise2((p+vec2(e,0.))*f),nz=sdNoise2((p+vec2(0.,e))*f);
  g+=vec2(nx-n0,nz-n0)/e*.0045*(1.-smoothstep(.03,.16,fade));
  return g;
}
// One octave of crystal sparkle: each world cell owns one jittered facet, so a glint is nailed to the ground.
float snowGlintOctave(vec2 p,float cell,vec3 N,vec3 H,vec3 T,vec3 B,float sharp){
  vec2 id=floor(p/cell);
  vec2 r=sdHash22(id),r2=sdHash22(id+vec2(19.73,7.31));
  if(r2.x>.62)return 0.;
  vec2 c=(id+.5+(r-.5)*.72)*cell;
  float d=length(p-c)/(cell*.22);
  float disc=clamp(1.-d*d,0.,1.);
  if(disc<=0.)return 0.;
  float ang=r.y*6.2831853;
  vec3 facet=normalize(N+(T*cos(ang)+B*sin(ang))*(.10+r2.y*.26));
  return disc*pow(clamp(dot(facet,H),0.,1.),sharp);
}
// Gated on a grazing view: snow sparkles looking across it into the sun and stays matte looking down.
float snowGlints(vec2 p,vec3 N,vec3 V,vec3 L,float footprint){
  vec3 H=normalize(V+L);
  vec3 up=abs(N.y)>.95?vec3(1.,0.,0.):vec3(0.,1.,0.);
  vec3 T=normalize(cross(up,N)),B=cross(N,T);
  float graze=pow(1.-clamp(dot(N,V),0.,1.),2.2);
  float nl=clamp(dot(N,L),0.,1.);
  float gate=graze*smoothstep(.02,.35,nl)*(1.-smoothstep(.55,.95,nl)*.55);
  if(gate<=.001)return 0.;
  float sum=0.;
  float a=.12,b=.36;
  sum+=snowGlintOctave(p,a,N,H,T,B,420.)*(1.-smoothstep(a*.55,a*2.2,footprint));
  sum+=snowGlintOctave(p+vec2(53.1,17.9),b,N,H,T,B,900.)*(1.-smoothstep(b*.55,b*2.2,footprint))*1.35;
  return sum*gate;
}
// Light that entered the snow and left toward the eye. Thin edges (berm crests, far walls of prints)
// transmit brightly and wide; deep snow transmits little and comes back blue.
vec3 snowSubsurface(vec3 N,vec3 L,vec3 V,float thickness){
  vec3 tint=mix(vec3(.94,.965,1.),vec3(.55,.72,1.),clamp(thickness,0.,1.));
  vec3 h=normalize(L+N*.28);
  float back=pow(clamp(dot(V,-h),0.,1.),mix(3.,9.,thickness))*mix(1.,.3,thickness);
  return tint*back;
}
`;

/** Patch a snow ground material in place. Call the returned function once a frame before it draws. */
export function applySnowSurface(material: THREE.MeshStandardMaterial, deform: SnowDeform, opts: SnowSurfaceOptions): () => void {
  const sunDir = new THREE.Vector3(0, 1, 0), sunColor = new THREE.Color();
  const uniforms = {
    ...deform.uniforms,
    snowSunDir: { value: sunDir },
    snowSunColor: { value: sunColor },
    snowRelief: { value: opts.relief ?? 1.15 },
    snowGlintStrength: { value: opts.glints ?? 8 },
    snowScatterStrength: { value: opts.subsurface ?? 0.55 },
  };
  const tmp = new THREE.Vector3();
  material.userData.snowSurface = uniforms;
  // The light can move or be re-tinted, so its world direction and radiance are read every frame.
  const refresh = () => {
    opts.sun.getWorldPosition(sunDir);
    opts.sun.target.getWorldPosition(tmp);
    sunDir.sub(tmp).normalize();
    sunColor.copy(opts.sun.color).multiplyScalar(opts.sun.intensity);
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSnowWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURFACE_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec2 sW=vSnowWorld.xz;
        float sFall=snowDeformFalloff(sW);
        vec4 sD=snowDeformAt(sW)*sFall;
        float sPit=clamp(sD.r/.12,0.,1.),sRim=clamp(sD.g/.05,0.,1.);
        float sFoot=length(fwidth(sW));
        // A print is a cavity: darker, bluer at the floor, packed snow a touch greyer.
        diffuseColor.rgb*=mix(vec3(1.),vec3(.78,.86,1.),sPit*.8+sD.b*.1);
        diffuseColor.rgb*=1.+sRim*.05;`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        vec3 sNW;
        {
          float e=snowDeformSize/snowDeformRes;
          vec2 g=vec2(snowDeformHeight(sW+vec2(e,0.))-snowDeformHeight(sW-vec2(e,0.)),
                      snowDeformHeight(sW+vec2(0.,e))-snowDeformHeight(sW-vec2(0.,e)))/(2.*e)*sFall*snowRelief;
          g+=snowDetailGrad(sW,sFoot);
          sNW=inverseTransformDirection(normal,viewMatrix);
          sNW=normalize(sNW+vec3(-g.x,0.,-g.y));
          normal=normalize((viewMatrix*vec4(sNW,0.)).xyz);
        }`)
      .replace('#include <opaque_fragment>', /* glsl */ `{
          vec3 sL=normalize(snowSunDir);
          vec3 sV=inverseTransformDirection(normalize(vViewPosition),viewMatrix);
          // Sun visibility from the direct light three.js already shadowed, so neither term shines in shade.
          float sLam=max(dot(sNW,sL),0.);
          float sExpect=dot(BRDF_Lambert(diffuseColor.rgb)*snowSunColor*sLam,vec3(.333));
          float sVis=sExpect>1e-4?clamp(dot(reflectedLight.directDiffuse,vec3(.333))/sExpect,0.,1.):0.;
          float sThick=clamp(1.-sPit*.75-sRim*.6,0.,1.);
          outgoingLight+=snowSunColor*diffuseColor.rgb*snowSubsurface(sNW,sL,sV,sThick)*snowScatterStrength*mix(.35,1.,sVis);
          outgoingLight+=snowSunColor*snowGlints(sW,sNW,sV,sL,sFoot)*snowGlintStrength*sVis;
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'frostlight-snow-surface';
  refresh();
  return refresh;
}

const FEET = ['LM', 'RM', 'LR', 'RR'] as const;
interface FootState { nodes: THREE.Object3D[]; down: boolean[]; last: Float32Array }
type LinkedRig = { linkNode?: (name: string) => THREE.Object3D };

/**
 * Turns walking crabs into brushes. A foot leaves one print when it touches down, and another only after it
 * has moved a stride while still down, so a sliding foot ploughs a groove instead of stamping every frame.
 */
export class SnowFootfalls {
  private readonly state = new WeakMap<Unit, FootState | null>();
  private readonly p = new THREE.Vector3();

  update(units: readonly Unit[], deform: SnowDeform, height: (x: number, z: number) => number, cx: number, cz: number): void {
    const reach = deform.size * 0.42;
    for (const u of units) {
      if (!u.alive || u.hidden || !u.rig.root.visible) continue;
      const pos = u.pos;
      if (Math.abs(pos.x - cx) > reach || Math.abs(pos.z - cz) > reach) continue;
      let st = this.state.get(u);
      if (st === undefined) { st = this.bind(u); this.state.set(u, st); }
      if (!st) continue;
      const s = THREE.MathUtils.clamp(u.height, 0.5, 4);
      for (let i = 0; i < st.nodes.length; i++) {
        st.nodes[i].getWorldPosition(this.p);
        const contact = this.p.y - height(this.p.x, this.p.z) < 0.09 * s;
        if (contact) {
          const dx = this.p.x - st.last[i * 2], dz = this.p.z - st.last[i * 2 + 1];
          if (!st.down[i] || dx * dx + dz * dz > (0.2 * s) ** 2) {
            deform.brush({ x: this.p.x, z: this.p.z, radius: 0.11 * s, elongation: 1.3, yaw: u.yaw, depth: 0.09 * s, berm: 0.035 * s, compression: 0.55, roughness: 0.7, seed: (this.p.x * 7.13 + this.p.z * 3.71) % 97 });
            st.last[i * 2] = this.p.x;
            st.last[i * 2 + 1] = this.p.z;
          }
        }
        st.down[i] = contact;
      }
    }
  }

  private bind(u: Unit): FootState | null {
    const rig = u.rig as unknown as LinkedRig;
    if (typeof rig.linkNode !== 'function') return null;
    try {
      const nodes = FEET.map((f) => rig.linkNode!(`${f}_foot_tip_link`));
      return { nodes, down: nodes.map(() => true), last: new Float32Array(nodes.length * 2).fill(1e6) };
    } catch {
      return null;
    }
  }
}
