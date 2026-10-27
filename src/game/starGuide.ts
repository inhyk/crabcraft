// Starhaven's quest breadcrumbs, drawn instead of the gold discs and the ground chevron while World II is shown
// (ObjectiveMarker.star): small moonlit glints hovering a hand above the ground and flowing toward the next
// waypoint, each a four-pointed star of silver light with a faint teal halo that twinkles on its own clock. Nothing
// lies on the ground (a lit disc on the grass reads as a decal), and nothing is gold (gold is World I's guidance).
import * as THREE from 'three';
import type { World } from '../world/types';

const GLINTS = 9;
const SPACING = 2.2;

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
    this.hide();
  }

  hide(): void { this.group.visible = false; }

  /** Same contract as ObjectiveMarker's crumbs: from the player toward `via` (or the target). */
  update(time: number, world: World, from: THREE.Vector3, target: THREE.Vector3 | null, via: THREE.Vector3 | null, combat: boolean, show: boolean): void {
    const dist = target ? Math.hypot(target.x - from.x, target.z - from.z) : 0;
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
    this.group.removeFromParent();
  }
}
