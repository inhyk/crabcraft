import * as THREE from 'three';
import { DAWN_WIND } from '../sim/world/dawnGround';

/*
 * Sand kicked up by running crabs on Goldsand: Frostlight's snow spray (snowSpray.ts, after SNOWFLOW's spray field,
 * MIT, Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md) with sand's physics and colour. Grains are heavy:
 * they arc out behind a foot and fall straight back; a thin warm dust hangs a moment longer and drifts downwind.
 *
 * Grains live in a fixed ring on the CPU (no allocation per frame; when it is full the oldest grain is reused).
 * Every frame the live ones are packed into two instanced vec4 attributes and drawn as one mesh of camera-facing
 * quads, each shaded as a small sphere: wrapped sun diffuse, a forward-scatter glow when dust hangs between the eye
 * and the low sun, and sky fill from the scene's hemisphere and point lights.
 */

const CAPACITY = 2048;
/** Live grains allowed on low quality; per-kick counts are halved there too. */
const LOW_LIMIT = 640;
/** Wind the dust drifts with, m/s, Goldsand's prevailing wind. */
const WIND_X = DAWN_WIND[0] * 0.9, WIND_Z = DAWN_WIND[1] * 0.9;
/** A dragged foot restamps every stride; it throws this much of a touchdown's sand. */
const SLIDE = 0.3;

const VERTEX = /* glsl */ `
attribute vec4 sprayA; // world xyz, radius
attribute vec4 sprayB; // age01, seed, kind (0 dust, 1 grain), alpha
uniform vec3 spraySunDir;
varying vec2 vCorner;
varying vec2 vRot;
varying vec4 vState;
varying vec3 vViewPos;
varying vec3 vSunView;
#include <common>
#include <fog_pars_vertex>
void main(){
  // Spin hashed off the seed, so a burst is not a field of identical discs.
  float ang=sprayB.y*6.2831853+sprayB.x*(sprayB.y-.5)*3.;
  float cs=cos(ang),sn=sin(ang);
  vec2 c=position.xy;
  vRot=vec2(c.x*cs-c.y*sn,c.x*sn+c.y*cs);
  vec4 mvPosition=viewMatrix*vec4(sprayA.xyz,1.);
  mvPosition.xy+=vRot*sprayA.w;
  vCorner=c;vState=sprayB;vViewPos=mvPosition.xyz;
  vSunView=normalize((viewMatrix*vec4(spraySunDir,0.)).xyz);
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 spraySunColor;
uniform float sprayFill;
varying vec2 vCorner;
varying vec2 vRot;
varying vec4 vState;
varying vec3 vViewPos;
varying vec3 vSunView;
#include <common>
#include <lights_pars_begin>
#include <fog_pars_fragment>
float sprayHash(vec2 p){p=fract(p*vec2(.1031,.1030));p+=dot(p,p.yx+33.33);return fract((p.x+p.y)*p.x);}
float sprayNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(sprayHash(i),sprayHash(i+vec2(1.,0.)),u.x),mix(sprayHash(i+vec2(0.,1.)),sprayHash(i+1.),u.x),u.y)*2.-1.;}
float sprayPhase(float mu,float g){float g2=g*g;return (1.-g2)/(4.*PI*pow(1.+g2-2.*g*mu,1.5));}
void main(){
  float r2=dot(vCorner,vCorner);
  if(r2>1.)discard;
  float kind=vState.z;
  // A perfect circle gives a billboard away; wobble the rim off the corner's angle.
  float wob=1.+.34*sprayNoise(vCorner*inversesqrt(max(r2,1e-6))*2.4+vState.y*37.);
  float r=sqrt(r2)/wob;
  if(r>1.)discard;
  // Soft-edged dust, harder-edged thrown grains. Density comes from overlap, so a single puff stays thin.
  float edge=mix(pow(clamp(1.-r*r,0.,1.),1.8),smoothstep(1.,.6,r),kind);
  float alpha=vState.w*edge*mix(.4,.9,kind);
  if(alpha<.004)discard;
  // Lit as a sphere: the normal comes from the quad's own coordinates.
  vec3 V=normalize(-vViewPos);
  vec3 N=normalize(vec3(vRot,0.)+V*sqrt(max(0.,1.-r2)));
  vec3 L=vSunView;
  // Golden quartz sand; the dust is the same sand ground finer, paler and a little pink.
  vec3 albedo=mix(vec3(.62,.46,.3),vec3(.5,.36,.22),kind)*(.9+.2*fract(vState.y*7.3));
  vec3 col=albedo*RECIPROCAL_PI*spraySunColor*max(0.,(dot(N,L)+.35)/1.35)*1.2;
  // Mineral dust scatters forward: a puff between the eye and the low sun glows.
  col+=spraySunColor*albedo*sprayPhase(dot(-V,L),.6)*.9*(1.-kind);
  vec3 irr=ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
  for(int i=0;i<NUM_HEMI_LIGHTS;i++)irr+=getHemisphereLightIrradiance(hemisphereLights[i],N);
  #endif
  #if NUM_POINT_LIGHTS > 0
  for(int i=0;i<NUM_POINT_LIGHTS;i++){vec3 d=pointLights[i].position-vViewPos;float l=length(d);
    irr+=pointLights[i].color*getDistanceAttenuation(l,pointLights[i].distance,pointLights[i].decay)*max(0.,(dot(N,d/l)+.75)/1.75);}
  #endif
  col+=albedo*RECIPROCAL_PI*irr*sprayFill;
  // A quartz grain now and then flashes as it tumbles through the sun.
  col+=spraySunColor*kind*.25*pow(max(0.,sin(vState.y*91.+vState.x*38.)),16.);
  gl_FragColor=vec4(col,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface SandSprayOptions {
  /** Light the grains answer to. Its world direction and radiance are read every frame. */
  sun: THREE.DirectionalLight;
  /** Ground that is not sand (paving, the arena floor). */
  bare?: (x: number, z: number) => boolean;
  /** Multiplier on the sky fill, standing in for the environment light the ground also gets. */
  fill?: number;
}

/** One draw for every airborne grain of sand in the world. Fed by SandFootfalls, stepped once a frame. */
export class SandSpray {
  readonly mesh: THREE.Mesh;
  readonly stats = { kicks: 0, emitted: 0, onPaving: 0, recycled: 0 };
  private readonly pos = new Float32Array(CAPACITY * 3);
  private readonly vel = new Float32Array(CAPACITY * 3);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  private readonly seed = new Float32Array(CAPACITY);
  private readonly kind = new Float32Array(CAPACITY);
  private readonly drag = new Float32Array(CAPACITY);
  private readonly grav = new Float32Array(CAPACITY);
  private readonly grow = new Float32Array(CAPACITY);
  private readonly opacity = new Float32Array(CAPACITY);
  private readonly floor = new Float32Array(CAPACITY);
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly sunDir: THREE.Vector3;
  private readonly sunColor: THREE.Color;
  private readonly tmp = new THREE.Vector3();
  /** Ring: `head` is the next slot written, the `count` slots behind it are in flight. */
  private head = 0;
  private count = 0;
  private drawn = 0;
  private low = false;
  private fx = 0;
  private fz = 0;

  constructor(private readonly parent: THREE.Object3D, private readonly opts: SandSprayOptions) {
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('sprayA', this.a);
    this.geo.setAttribute('sprayB', this.b);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      name: 'goldsand-sand-spray',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, {
        spraySunDir: { value: new THREE.Vector3(0, 1, 0) },
        spraySunColor: { value: new THREE.Color() },
        sprayFill: { value: opts.fill ?? 1.2 },
      }]),
      lights: true,
      fog: true,
      transparent: true,
      depthWrite: false,
    });
    this.sunDir = this.mat.uniforms.spraySunDir.value;
    this.sunColor = this.mat.uniforms.spraySunColor.value;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'sand-spray';
    // Corners are placed in the shader from world positions; the mesh's own transform only steers sorting.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** Grains in flight. */
  get live(): number { return this.drawn; }

  /**
   * Sand thrown by a foot landing (or a planted foot dragged a stride), called from the branch that stamps the
   * print so the two always agree. The kick goes up and back against travel; faster bodies throw more and higher,
   * and a walk throws nothing. `vx, vz` is the body's ground velocity, `s` its size.
   */
  kick(x: number, ground: number, z: number, vx: number, vz: number, s: number, touchdown: boolean): void {
    const speed = Math.hypot(vx, vz);
    if (speed < 1.2) return;
    if (this.opts.bare?.(x, z)) { this.stats.onPaving++; return; }
    const limit = this.low ? LOW_LIMIT : CAPACITY;
    // Taper well before the ring wraps, so a crowd thins its spray instead of cutting grains off mid-air.
    const room = Math.min(1, Math.max(0, (1 - this.count / limit) * 3.5));
    const near = THREE.MathUtils.clamp(1.5 - Math.hypot(x - this.fx, z - this.fz) / 14, 0.35, 1);
    const k = (touchdown ? 1 : SLIDE) * room * near * (this.low ? 0.5 : 1) * Math.min(s, 2);
    if (k <= 0) return;
    this.stats.kicks++;
    const impact = Math.min(1.7, 0.2 + speed / 6.5);
    const fx = vx / speed, fz = vz / speed, rs = Math.sqrt(s), R = Math.random;
    const dust = round((1.2 + 2.6 * impact) * k), grains = round((3 + 5 * impact) * k), veil = round(0.6 * impact * impact * k);
    // Grains: heavy, arcing out behind the foot and straight back down.
    for (let n = 0; n < grains; n++) {
      const sx = R() - 0.5, sz = R() - 0.5, back = 0.6 + R() * 1.5 * impact;
      this.emit(x + sx * 0.12 * s, ground + 0.03 * s, z + sz * 0.12 * s,
        -fx * back + sx * 1.1 + vx * 0.25, (1.1 + R() * 1.9) * (0.6 + 0.4 * impact) * rs, -fz * back + sz * 1.1 + vz * 0.25,
        (0.012 + R() * 0.012) * s, 0.5 + R() * 0.35, 1, 0.35, 9.81, 0, 1, ground);
    }
    // Dust: the fines a footfall lifts, slow to settle.
    for (let n = 0; n < dust; n++) {
      const sx = R() - 0.5, sz = R() - 0.5, back = 0.2 + R() * 0.8 * impact;
      this.emit(x + sx * 0.18 * s, ground + 0.03 * s + R() * 0.05 * s, z + sz * 0.18 * s,
        -fx * back + sx * 0.7 + vx * 0.2, (0.5 + R() * 1.1) * (0.45 + 0.55 * impact) * rs, -fz * back + sz * 0.7 + vz * 0.2,
        (0.06 + R() * 0.06) * s, 0.8 + R() * 0.7, 0, 3, 1.2, 1.7, 0.75, ground);
    }
    for (let n = 0; n < veil; n++) {
      const sx = R() - 0.5, sz = R() - 0.5;
      this.emit(x + sx * 0.3 * s, ground + 0.08 * s, z + sz * 0.3 * s,
        -fx * 0.3 + vx * 0.3 + sx * 0.4, (0.15 + R() * 0.3) * rs, -fz * 0.3 + vz * 0.3 + sz * 0.4,
        (0.22 + R() * 0.18) * s, 1.3 + R() * 0.8, 0, 2.2, 0.3, 1.5, 0.35, ground);
    }
  }

  /** Advance every grain and upload the live ones. `x, z` is where the eye is (the player). */
  update(dt: number, x: number, z: number, quality: 'high' | 'low' = 'high'): void {
    this.low = quality === 'low';
    this.fx = x;
    this.fz = z;
    const sun = this.opts.sun;
    sun.getWorldPosition(this.sunDir);
    sun.target.getWorldPosition(this.tmp);
    this.sunDir.sub(this.tmp).normalize();
    this.sunColor.copy(sun.color).multiplyScalar(sun.intensity);

    const h = Math.min(Math.max(dt, 0), 1 / 30);
    const { pos, vel, age, life } = this;
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array;
    const start = (this.head - this.count + CAPACITY) % CAPACITY;
    let out = 0, dead = 0, open = true, cx = 0, cy = 0, cz = 0;
    for (let n = 0; n < this.count; n++) {
      const i = (start + n) % CAPACITY;
      if (age[i] >= life[i]) { if (open) dead++; continue; }
      open = false;
      age[i] += h;
      if (age[i] >= life[i]) continue;
      const o = i * 3, kd = Math.min(1, this.drag[i] * h);
      vel[o] += (WIND_X - vel[o]) * kd;
      vel[o + 2] += (WIND_Z - vel[o + 2]) * kd;
      vel[o + 1] += (-this.grav[i] - this.drag[i] * vel[o + 1]) * h;
      pos[o] += vel[o] * h;
      pos[o + 1] += vel[o + 1] * h;
      pos[o + 2] += vel[o + 2] * h;
      // Sand landing on sand: a grain stops dead and is gone; dust settles and fades.
      if (pos[o + 1] < this.floor[i]) {
        pos[o + 1] = this.floor[i];
        vel[o] *= 0.2; vel[o + 1] = 0; vel[o + 2] *= 0.2;
        age[i] += h * (this.kind[i] > 0.5 ? 12 : 2.5);
      }
      const t = Math.min(1, age[i] / life[i]);
      const radius = this.size[i] * (1 + t * this.grow[i]);
      const q = out * 4;
      A[q] = pos[o];
      // Keep the quad out of the ground so a settling puff is not sliced flat by the terrain.
      A[q + 1] = Math.max(pos[o + 1], this.floor[i] + radius * 0.75);
      A[q + 2] = pos[o + 2];
      A[q + 3] = radius;
      B[q] = t;
      B[q + 1] = this.seed[i];
      B[q + 2] = this.kind[i];
      // Fade in fast, out slowly.
      B[q + 3] = Math.min(1, t * 8) * (1 - t) * (1 - t) * this.opacity[i];
      cx += pos[o]; cy += pos[o + 1]; cz += pos[o + 2];
      out++;
    }
    this.count -= dead;
    this.drawn = out;
    this.geo.instanceCount = out;
    this.mesh.visible = out > 0;
    if (out > 0) {
      this.mesh.position.set(cx / out, cy / out, cz / out);
      for (const attr of [this.a, this.b]) { attr.clearUpdateRanges(); attr.addUpdateRange(0, out * 4); attr.needsUpdate = true; }
    }
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number,
    kind: number, drag: number, grav: number, grow: number, opacity: number, floor: number): void {
    const i = this.head;
    this.head = (i + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++; else this.stats.recycled++;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.grow[i] = grow;
    this.opacity[i] = opacity;
    this.floor[i] = floor;
    this.seed[i] = (((i * 0.618034 + x * 0.137 + z * 0.311) % 1) + 1) % 1;
    this.stats.emitted++;
  }

}

/** Stochastic rounding: fractional counts stay right on average without per-emitter state. */
function round(n: number): number {
  return Math.floor(n + Math.random());
}
