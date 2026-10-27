// Starhaven's quest breadcrumbs, drawn instead of the gold discs and the ground chevron while World II is shown
// (ObjectiveMarker.star): small moonlit glints hovering a hand above the ground and flowing toward the next
// waypoint, each a four-pointed star of silver light with a faint teal halo that twinkles on its own clock. Nothing
// lies on the ground (a lit disc on the grass reads as a decal), and nothing is gold (gold is World I's guidance).
import * as THREE from 'three';
import type { World } from '../world/types';

const GLINTS = 9;
const SPACING = 2.2;
const MOTES = 14;

/** The objective's mark on the ground: a thin moonlit ring with a slowly turning dashed ring outside it. */
const ringFrag = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * 2.4;
  float r = length(p), a = atan(p.y, p.x);
  float w = fwidth(r) * 1.5;
  float ring = 1.0 - smoothstep(0.03, 0.03 + w, abs(r - 1.55));
  float dash = (1.0 - smoothstep(0.02, 0.02 + w, abs(r - 1.95))) * step(0.45, fract(a / 6.2831853 * 16.0 + uTime * 0.04));
  float glow = exp(-pow((r - 1.55) / 0.35, 2.0)) * 0.25 + exp(-r * r * 1.4) * 0.08;
  float k = (ring * 1.2 + dash * 0.7 + glow) * uAlpha * (0.8 + 0.2 * sin(uTime * 2.0));
  if (k < 0.002) discard;
  gl_FragColor = vec4(mix(vec3(0.45, 0.95, 0.9), vec3(1.2, 1.25, 1.4), ring) * k, k);
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
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GLINTS * 3), 3));
    this.bright = new THREE.BufferAttribute(new Float32Array(GLINTS), 1);
    g.setAttribute('aBright', this.bright);
    g.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({length: GLINTS}, (_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1 * .5 + .5), 1));
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
    // The objective itself: a ring on the ground and motes drifting up from it (in place of a light pillar).
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: ringFrag, uniforms: {uTime: {value: 0}, uAlpha: {value: 1}},
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.name = 'star-guide-ring'; this.ring.renderOrder = 7; this.ring.frustumCulled = false;
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    this.moteBright = new THREE.BufferAttribute(new Float32Array(MOTES), 1);
    mg.setAttribute('aBright', this.moteBright);
    mg.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({length: MOTES}, (_, i) => (Math.sin(i * 78.233) * 43758.5453) % 1 * .5 + .5), 1));
    this.motes = new THREE.Points(mg, this.mat);
    this.motes.name = 'star-guide-motes'; this.motes.frustumCulled = false; this.motes.renderOrder = 7;
    this.target.add(this.ring, this.motes);
    parent.add(this.target);
    this.hide();
  }
  private ring: THREE.Mesh;
  private ringMat: THREE.ShaderMaterial;
  private motes: THREE.Points;
  private moteBright: THREE.BufferAttribute;
  /** The objective's ring and motes (shown even when the glints are not). */
  readonly target = new THREE.Group();

  hide(): void { this.group.visible = false; this.target.visible = false; }

  /** The ring and motes at the objective: shown from 5 m off, faded in over the next 8. */
  private mark(time: number, world: World, target: THREE.Vector3 | null, dist: number, show: boolean): void {
    this.target.visible = show && !!target && dist > 5;
    if (!target || !this.target.visible) return;
    const y = world.heightAt(target.x, target.z);
    this.ring.position.set(target.x, y + 0.06, target.z);
    this.ringMat.uniforms.uTime.value = time;
    this.ringMat.uniforms.uAlpha.value = Math.min(1, (dist - 5) / 8);
    const pos = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      const s = (Math.sin(i * 12.9898) * 43758.5453) % 1, life = (time * (0.12 + 0.05 * Math.abs(s)) + i / MOTES) % 1;
      const a = i * 2.39996 + time * 0.2, r = 0.4 + 1.2 * Math.abs(Math.sin(i * 3.7));
      pos.setXYZ(i, target.x + Math.cos(a) * r, y + 0.3 + life * 3.2, target.z + Math.sin(a) * r);
      this.moteBright.setX(i, Math.sin(life * Math.PI) * 0.9 * this.ringMat.uniforms.uAlpha.value);
    }
    pos.needsUpdate = true; this.moteBright.needsUpdate = true;
  }

  /** Same contract as ObjectiveMarker's crumbs: from the player toward `via` (or the target). */
  update(time: number, world: World, from: THREE.Vector3, target: THREE.Vector3 | null, via: THREE.Vector3 | null, combat: boolean, show: boolean): void {
    const dist = target ? Math.hypot(target.x - from.x, target.z - from.z) : 0;
    this.mark(time, world, target, dist, show);
    this.group.visible = show && !!target && !combat && dist > 10;
    if (!target || !this.group.visible) return;
    this.mat.uniforms.uTime.value = time;
    const lead = via ?? target;
    const leadDist = Math.max(0.001, Math.hypot(lead.x - from.x, lead.z - from.z));
    const dx = (lead.x - from.x) / leadDist, dz = (lead.z - from.z) / leadDist;
    const flow = (time * 2.6) % SPACING;
    const n = Math.min(GLINTS, Math.floor((Math.min(dist, leadDist + 2) - 4) / SPACING));
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < GLINTS; i++) {
      const d = 3 + i * SPACING + flow, x = from.x + dx * d, z = from.z + dz * d;
      const k = i < n ? 1 - i / GLINTS : 0, fadeIn = i === 0 ? flow / SPACING : 1;
      pos.setXYZ(i, x, world.heightAt(x, z) + 0.38 + 0.06 * Math.sin(time * 2.1 + i * 1.3), z);
      this.bright.setX(i, k * fadeIn);
    }
    pos.needsUpdate = true;
    this.bright.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
    this.motes.geometry.dispose();this.ring.geometry.dispose();this.ringMat.dispose();this.target.removeFromParent();
    this.group.removeFromParent();
  }
}
