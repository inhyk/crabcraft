// Starhaven's quest breadcrumbs, drawn instead of the gold discs and the ground chevron while World II is shown
// (ObjectiveMarker.star): small moonlit glints hovering a hand above the ground and flowing toward the next
// waypoint, each a four-pointed star of silver light with a faint teal halo that twinkles on its own clock. Nothing
// lies on the ground along the way, and nothing is gold (gold is World I's guidance). The goal itself is marked
// without a beam of light: a thin silver ring laid on the ground (following it, so it never floats or cuts in) with
// a slowly turning ring of star points, and a few motes of starlight drifting up out of it, seen from far off.
import * as THREE from 'three';
import type { World } from '../world/types';

const GLINTS = 9;
const SPACING = 2.2;
/** Motes rising from the goal's ring: they share the glints' draw (points after the glints). */
const MOTES = 12;
const RING_R0 = 1.05, RING_R1 = 2.1, RING_SEG = 72;

const ringVert = /* glsl */ `
attribute vec2 aLocal;
varying vec2 vLocal;
varying float vDepth;
void main() {
  vLocal = aLocal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const ringFrag = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vLocal;
varying float vDepth;
#ifdef USE_FOG
uniform float fogDensity;
#endif
void main() {
  float r = length(vLocal), a = atan(vLocal.y, vLocal.x);
  float px = fwidth(r) + 0.004;
  // A fine silver line, a fainter inner line, and twelve star points turning slowly between them.
  float line = 1.0 - smoothstep(0.0, 0.03 + px, abs(r - 1.62));
  float inner = (1.0 - smoothstep(0.0, 0.016 + px, abs(r - 1.32))) * 0.45;
  float at = a + uTime * 0.12, cell = floor(at / 6.2831853 * 12.0), ac = (cell + 0.5) / 12.0 * 6.2831853 - uTime * 0.12;
  vec2 sp = vec2(cos(ac), sin(ac)) * 1.47, q = vLocal - sp;
  float star = exp(-dot(q, q) * 900.0) * 1.6 + (exp(-abs(q.x) * 70.0) * exp(-q.y * q.y * 600.0) + exp(-abs(q.y) * 70.0) * exp(-q.x * q.x * 600.0)) * 0.5;
  star *= 0.55 + 0.45 * sin(uTime * 2.3 + cell * 1.7);
  // A soft teal glow on the ground inside the ring, breathing.
  float glow = exp(-pow((r - 1.5) / 0.32, 2.0)) * 0.18 * (0.8 + 0.2 * sin(uTime * 1.4));
  float k = (line + inner + star + glow) * uAlpha * (1.0 - smoothstep(1.9, 2.1, r));
  #ifdef USE_FOG
  float f = fogDensity * vDepth; k *= exp(-f * f);
  #endif
  if (k < 0.002) discard;
  vec3 col = mix(vec3(0.3, 0.85, 0.82), vec3(1.25, 1.3, 1.5), clamp(line + star, 0.0, 1.0));
  gl_FragColor = vec4(col * k, min(1.0, k) * 0.5);
}`;

const vert = /* glsl */ `
attribute float aBright;
attribute float aSeed;
uniform float uScale;
uniform float uTime;
varying float vBright;
varying float vSeed;
varying float vDepth;
void main() {
  vBright = aBright * (0.7 + 0.3 * sin(uTime * (3.0 + aSeed * 2.0) + aSeed * 40.0));
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  // 0.75 m across at any distance, never larger than at 4 m, never under 5 px far off.
  gl_PointSize = max(5.0, uScale * 0.75 / max(vDepth, 4.0));
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying float vBright;
varying float vSeed;
varying float vDepth;
#ifdef USE_FOG
uniform float fogDensity;
#endif
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  // Turned a little per glint, so the row does not look stamped.
  float a = vSeed * 0.6 - 0.3, c = cos(a), s = sin(a);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 60.0);
  float rays = exp(-abs(q.x) * 26.0) * exp(-q.y * q.y * 5.0) + exp(-abs(q.y) * 26.0) * exp(-q.x * q.x * 5.0);
  float halo = exp(-r2 * 7.0) * 0.22 * (1.0 - r2);
  float fogK = 1.0;
  #ifdef USE_FOG
  float f = fogDensity * vDepth; fogK = exp(-f * f);
  #endif
  float k = (core * 2.0 + rays * 0.7 + halo * 1.3) * vBright * fogK;
  if (k < 0.003) discard;
  vec3 col = mix(vec3(0.55, 1.0, 0.95), vec3(1.6, 1.65, 1.9), clamp(core * 1.4 + rays * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(col * k, min(1.0, k) * 0.6);
}`;

export class StarGuide {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private bright: THREE.BufferAttribute;
  private ring: THREE.Mesh;
  private ringMat: THREE.ShaderMaterial;
  private ringX = NaN;
  private ringZ = NaN;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'star-guide';
    parent.add(this.group);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {uScale: {value: 800}, uTime: {value: 0}}]),
      transparent: true, depthWrite: false, fog: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((GLINTS + MOTES) * 3), 3));
    this.bright = new THREE.BufferAttribute(new Float32Array(GLINTS + MOTES), 1);
    g.setAttribute('aBright', this.bright);
    g.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({length: GLINTS + MOTES}, (_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1 * .5 + .5), 1));
    this.points = new THREE.Points(g, this.mat);
    this.points.name = 'star-guide-glints';
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    const size = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, _s, camera) => {
      const h = renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(size).y;
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
      this.mat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    };
    this.group.add(this.points);
    // The goal's ring: a flat annulus whose vertices are set onto the ground whenever the goal moves.
    const rg = new THREE.RingGeometry(RING_R0, RING_R1, RING_SEG, 2).rotateX(-Math.PI / 2);
    const rp = rg.getAttribute('position') as THREE.BufferAttribute, local = new Float32Array(rp.count * 2);
    for (let i = 0; i < rp.count; i++) { local[i * 2] = rp.getX(i); local[i * 2 + 1] = rp.getZ(i); }
    rg.setAttribute('aLocal', new THREE.BufferAttribute(local, 2));
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: ringVert, fragmentShader: ringFrag,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {uTime: {value: 0}, uAlpha: {value: 1}}]),
      transparent: true, depthWrite: false, fog: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.name = 'star-guide-ring';
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 6;
    this.group.add(this.ring);
    this.hide();
  }

  hide(): void { this.group.visible = false; }

  /** Same contract as ObjectiveMarker: glints from the player toward `via` (or the target), the ring and motes at the target. */
  update(time: number, world: World, from: THREE.Vector3, target: THREE.Vector3 | null, via: THREE.Vector3 | null, combat: boolean, show: boolean): void {
    const dist = target ? Math.hypot(target.x - from.x, target.z - from.z) : 0;
    this.group.visible = show && !!target && dist > 5;
    if (!target || !this.group.visible) return;
    this.mat.uniforms.uTime.value = time;
    this.ringMat.uniforms.uTime.value = time;
    // The goal mark fades in past 5 m and stays when the player is in a fight (as the beam did).
    this.ringMat.uniforms.uAlpha.value = Math.min(1, (dist - 5) / 6);
    if (target.x !== this.ringX || target.z !== this.ringZ) this.placeRing(world, target.x, target.z);
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const crumbs = !combat && dist > 10;
    const lead = via ?? target;
    const leadDist = Math.max(0.001, Math.hypot(lead.x - from.x, lead.z - from.z));
    const dx = (lead.x - from.x) / leadDist, dz = (lead.z - from.z) / leadDist;
    const flow = (time * 2.6) % SPACING;
    const n = crumbs ? Math.min(GLINTS, Math.floor((Math.min(dist, leadDist + 2) - 4) / SPACING)) : 0;
    for (let i = 0; i < GLINTS; i++) {
      const d = 3 + i * SPACING + flow, x = from.x + dx * d, z = from.z + dz * d;
      const k = i < n ? 1 - i / GLINTS : 0, fadeIn = i === 0 ? flow / SPACING : 1;
      pos.setXYZ(i, x, world.heightAt(x, z) + 0.38 + 0.06 * Math.sin(time * 2.1 + i * 1.3), z);
      this.bright.setX(i, k * fadeIn);
    }
    // Motes: each rises from a point on the ring in a slow spiral to about 4 m, fading in and out on its own clock.
    const gy = world.heightAt(target.x, target.z), fade = Math.min(1, (dist - 5) / 6);
    for (let m = 0; m < MOTES; m++) {
      const period = 4.2 + (m % 5) * 0.55, ph = ((time + m * 1.37) / period) % 1;
      const a = m * 2.399 + ph * 1.6, r = 1.5 - ph * 0.9;
      pos.setXYZ(GLINTS + m, target.x + Math.cos(a) * r, gy + 0.25 + ph * (3.2 + (m % 3) * 0.5), target.z + Math.sin(a) * r);
      this.bright.setX(GLINTS + m, Math.sin(ph * Math.PI) * 0.85 * fade);
    }
    pos.needsUpdate = true;
    this.bright.needsUpdate = true;
  }

  /** Lay the ring onto the ground at (x, z): every vertex at the ground's height there, a hair above it. */
  private placeRing(world: World, x: number, z: number): void {
    this.ringX = x; this.ringZ = z;
    const p = this.ring.geometry.getAttribute('position') as THREE.BufferAttribute, l = this.ring.geometry.getAttribute('aLocal') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const vx = x + l.getX(i), vz = z + l.getY(i); p.setXYZ(i, vx, world.heightAt(vx, vz) + 0.06, vz); }
    p.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.group.removeFromParent();
  }
}
