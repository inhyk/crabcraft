// Frostlight's quest guidance, drawn instead of the gold pillar and crumb discs while Frostlight is
// shown (ObjectiveMarker.frost). Over the objective a lantern shaft: warm at the snow, paling to ice
// as it rises and gone well below the sky, soft at its edges, with the falling snow glinting in it;
// under it a pool of lantern light laid on the ground's own height. Along the way small lantern motes
// hover a hand above the snow, flowing toward the next waypoint, each a candle-flame core in a round halo and a
// faint warm patch on the snow beneath that shows only from above (seen low, a lit disc on the snow foreshortens
// to a bright horizontal line beside the mote, which reads as a lens flare). Premultiplied light that covers part of what is behind it: on white snow it tints warm
// (and blooms in the grade), on dark ice it adds light instead of going brown.
import * as THREE from 'three';
import type { World } from '../world/types';

const MOTES = 9;
const SPACING = 2.2;
const SHAFT = 34;
const POOL = 3.2;
const POOL_GRID = 12;
const PATCH = 0.6;

const fogPars = /* glsl */ `
#ifdef USE_FOG
uniform float fogDensity;
#endif
float fogKeep(float depth) {
#ifdef USE_FOG
  float f = fogDensity * depth;
  return exp(-f * f);
#else
  return 1.0;
#endif
}
`;

const shaftVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDown;
void main() {
  vUv = uv;
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vDown = clamp((cameraPosition.y - wp.y) / max(length(cameraPosition - wp), 0.001), 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const shaftFrag = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uHeight;
uniform float uRadius;
uniform float uHeart;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDown;
${fogPars}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float h = vUv.y;
  float face = abs(dot(normalize(vN), normalize(vV)));
  // A narrow bright heart inside a wide soft glow.
  float heart = pow(face, 7.0);
  float glow = pow(face, 1.6);
  // Lit from the snow: rises out of the ground, thins with height, gone before the top.
  float rise = smoothstep(0.0, 0.02, h);
  float fall = exp(-h * 1.3) * (1.0 - smoothstep(0.55, 1.0, h));
  // Slow light drifting up the shaft.
  float drift = 0.78 + 0.22 * sin(vUv.x * 18.85 + h * 7.0 - uTime * 0.8) * sin(vUv.x * 12.57 - h * 4.0 + uTime * 0.5);
  // Snow falling through it, each flake catching the light for a moment.
  vec2 cell = vec2(vUv.x * 6.2832 * uRadius / 0.4, h * uHeight / 0.5 + uTime * 2.0);
  vec2 id = floor(cell);
  float r = hash(id);
  vec2 at = vec2(0.25 + 0.5 * hash(id + 7.1), 0.25 + 0.5 * hash(id + 3.7));
  float d = length(fract(cell) - at);
  float glint = step(0.82, r) * smoothstep(0.32, 0.0, d) * (0.55 + 0.45 * sin(uTime * 6.0 + r * 60.0));
  glint *= smoothstep(0.2, 0.7, face) * exp(-h * 2.0) * rise;
  // Amber at the snow, paling to lantern gold: saturated enough to read on white snow and sky.
  vec3 warm = vec3(1.5, 0.86, 0.3);
  vec3 pale = vec3(1.5, 1.0, 0.44);
  vec3 col = mix(warm, pale, smoothstep(0.02, 0.5, h));
  // The bright heart only up close: far off a thin bright line reads as a seam, a soft glow as light.
  heart *= uHeart;
  col = mix(col, vec3(2.0, 1.45, 0.75), heart * 0.8);
  float a = (0.05 + 0.75 * glow * drift + 0.45 * heart) * rise * fall + glint * 0.9;
  // Seen from high above a shaft is only a line: let it give way to its pool on the snow.
  a *= uAlpha * fogKeep(length(vV)) * (1.0 - 0.5 * smoothstep(0.3, 0.75, vDown));
  if (a < 0.002) discard;
  a = min(a, 1.0);
  gl_FragColor = vec4((col + vec3(1.8, 1.5, 1.1) * glint) * a, a * 0.85);
}`;

const poolVert = /* glsl */ `
varying vec2 vXY;
varying float vDepth;
varying float vInst;
void main() {
  vXY = position.xz;
  #ifdef USE_INSTANCING_COLOR
  vInst = instanceColor.r;
  #else
  vInst = 1.0;
  #endif
  #ifdef USE_INSTANCING
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #else
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  #endif
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

// A mote's light on the snow under it: the falloff of a point a hand above the ground, faded where the view
// grazes the snow (there the disc would be a thin bright streak) and lost under the sunlit snow's own light.
const patchVert = /* glsl */ `
varying vec2 vXY;
varying float vDepth;
varying float vInst;
varying float vDown;
void main() {
  vXY = position.xz;
  vInst = instanceColor.r;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 toCam = cameraPosition - wp.xyz;
  vDown = toCam.y / max(length(toCam), 0.001);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const patchFrag = /* glsl */ `
uniform float uAlpha;
uniform float uLift;
varying vec2 vXY;
varying float vDepth;
varying float vInst;
varying float vDown;
${fogPars}
void main() {
  float r = length(vXY);
  // The falloff less its value at the rim, so the light runs out to nothing there instead of ending in a disc.
  float e1 = pow(1.0 / (1.0 + uLift), 1.5);
  float e = max(0.0, (pow(1.0 / (1.0 + r * r * uLift), 1.5) - e1) / (1.0 - e1));
  float a = e * smoothstep(0.22, 0.55, vDown) * uAlpha * vInst * fogKeep(vDepth);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(1.5, 0.92, 0.42) * a, a * 0.5);
}`;

// Warm light on the snow: a soft round falloff and, for the shaft's pool, a slow ring going out.
const poolFrag = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uRing;
varying vec2 vXY;
varying float vDepth;
varying float vInst;
${fogPars}
void main() {
  float r = length(vXY);
  float glow = exp(-r * r * 3.2);
  float wave = fract(uTime * 0.35);
  float ring = uRing * exp(-pow((r - wave) * 9.0, 2.0)) * (1.0 - wave) * 0.6;
  float a = (glow * 0.62 + ring) * smoothstep(1.0, 0.82, r) * uAlpha * vInst * fogKeep(vDepth);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(1.5, 0.95, 0.42) * (0.9 + glow * 0.7) * a, a * 0.55);
}`;

const moteVert = /* glsl */ `
attribute float aBright;
uniform float uScale;
varying float vBright;
varying float vDepth;
void main() {
  vBright = aBright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  // Never larger than at 4 m: a mote by the lens would be a blur, not a lantern.
  gl_PointSize = max(3.0, uScale * 0.62 / max(vDepth, 4.0));
  gl_Position = projectionMatrix * mv;
}`;

// A tiny lantern: a candle-flame core, taller than wide and narrowing to its tip, in a round amber halo that
// fades to nothing at the sprite's edge. gl_PointCoord.y runs down the sprite.
const moteFrag = /* glsl */ `
varying float vBright;
varying float vDepth;
${fogPars}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  vec2 c = vec2(q.x * (1.5 + 1.1 * max(0.0, -q.y - 0.05)), q.y * 0.95 + 0.06);
  float core = exp(-dot(c, c) * 30.0);
  float halo = exp(-d2 * 4.5) * 0.42 * (1.0 - d2);
  float a = min(1.0, core * 1.15 + halo) * vBright * fogKeep(vDepth);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(1.5, 0.78, 0.26), vec3(2.4, 1.85, 1.05), core) * a, a * 0.7);
}`;

function material(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    fog: true,
    side,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export class FrostGuide {
  readonly group = new THREE.Group();
  private shaft: THREE.Mesh;
  private shaftMat: THREE.ShaderMaterial;
  private pool: THREE.Mesh;
  private poolMat: THREE.ShaderMaterial;
  private poolAt = new THREE.Vector3(Infinity, 0, 0);
  private motes: THREE.Points;
  private moteMat: THREE.ShaderMaterial;
  private moteBright: THREE.BufferAttribute;
  private patches: THREE.InstancedMesh;
  private patchMat: THREE.ShaderMaterial;
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(parent: THREE.Object3D) {
    this.group.name = 'frost-guide';
    parent.add(this.group);

    this.shaftMat = material(shaftVert, shaftFrag, { uTime: { value: 0 }, uAlpha: { value: 0 }, uHeight: { value: SHAFT }, uRadius: { value: 1 }, uHeart: { value: 1 } }, THREE.DoubleSide);
    this.shaftMat.polygonOffset = false;
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 1, 1, 40, 1, true).translate(0, 0.5, 0), this.shaftMat);
    this.shaft.name = 'frost-guide-shaft';
    this.shaft.frustumCulled = false;
    this.shaft.renderOrder = 7;

    this.poolMat = material(poolVert, poolFrag, { uTime: { value: 0 }, uAlpha: { value: 0 }, uRing: { value: 1 } });
    const pg = new THREE.PlaneGeometry(2, 2, POOL_GRID, POOL_GRID).rotateX(-Math.PI / 2);
    this.pool = new THREE.Mesh(pg, this.poolMat);
    this.pool.name = 'frost-guide-pool';
    this.pool.frustumCulled = false;
    this.pool.renderOrder = 6;

    this.moteMat = material(moteVert, moteFrag, { uScale: { value: 800 } });
    this.moteMat.polygonOffset = false;
    // Point size in pixels of the target being drawn: a mote is 0.62 m across at any resolution.
    const size = new THREE.Vector2();
    const moteScale = (renderer: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) => {
      const h = renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(size).y;
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
      this.moteMat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    };
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    this.moteBright = new THREE.BufferAttribute(new Float32Array(MOTES), 1);
    mg.setAttribute('aBright', this.moteBright);
    this.motes = new THREE.Points(mg, this.moteMat);
    this.motes.name = 'frost-guide-motes';
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 7;
    this.motes.onBeforeRender = moteScale;

    // Patch radius PATCH metres (the 2 m plane scaled); uLift is (radius / mote height)^2 for that falloff.
    this.patchMat = material(patchVert, patchFrag, { uAlpha: { value: 0.32 }, uLift: { value: (PATCH / 0.42) ** 2 } });
    this.patches = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.patchMat, MOTES);
    this.patches.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MOTES * 3), 3);
    this.patches.name = 'frost-guide-patches';
    this.patches.frustumCulled = false;
    this.patches.renderOrder = 6;

    this.group.add(this.shaft, this.pool, this.motes, this.patches);
    this.hide();
  }

  hide(): void {
    this.group.visible = false;
  }

  /** Same contract as ObjectiveMarker.update; `show` is its enabled-and-has-target. */
  update(time: number, world: World, from: THREE.Vector3, target: THREE.Vector3 | null, via: THREE.Vector3 | null, combat: boolean, show: boolean): void {
    this.group.visible = show && !!target;
    if (!target || !this.group.visible) return;
    const dist = Math.hypot(target.x - from.x, target.z - from.z);

    // The shaft and its pool: hidden once the crab stands in it, fading in over the last metres.
    const near = Math.min(1, Math.max(0, (dist - 4) / 8));
    const far = 1 - 0.3 * THREE.MathUtils.smoothstep(dist, 40, 140);
    this.shaft.visible = this.pool.visible = near > 0;
    if (near > 0) {
      const gy = world.heightAt(target.x, target.z);
      const r = 0.6 + Math.min(1.6, dist / 45);
      this.shaft.position.set(target.x, gy - 0.4, target.z);
      this.shaft.scale.set(r, SHAFT, r);
      const u = this.shaftMat.uniforms;
      u.uTime.value = time;
      u.uRadius.value = r;
      u.uHeart.value = 1 - THREE.MathUtils.smoothstep(dist, 15, 55);
      u.uAlpha.value = (0.82 + 0.1 * Math.sin(time * 1.7)) * near * far;
      if (this.poolAt.distanceToSquared(target) > 0.01) this.layPool(world, target);
      this.poolMat.uniforms.uTime.value = time;
      this.poolMat.uniforms.uAlpha.value = near;
    }

    // Lantern motes toward the next waypoint (the old crumbs' flow, spacing and fade).
    const showMotes = !combat && dist > 10;
    this.motes.visible = this.patches.visible = showMotes;
    if (!showMotes) return;
    const lead = via ?? target;
    const leadDist = Math.max(0.001, Math.hypot(lead.x - from.x, lead.z - from.z));
    const dx = (lead.x - from.x) / leadDist;
    const dz = (lead.z - from.z) / leadDist;
    const flow = (time * 2.6) % SPACING;
    const n = Math.min(MOTES, Math.floor((Math.min(dist, leadDist + 2) - 4) / SPACING));
    const pos = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      const d = 3 + i * SPACING + flow;
      const x = from.x + dx * d;
      const z = from.z + dz * d;
      const gy = world.heightAt(x, z);
      const k = i < n ? 1 - i / MOTES : 0;
      const fadeIn = i === 0 ? flow / SPACING : 1;
      const b = k * fadeIn * (0.85 + 0.15 * Math.sin(time * 5.3 + i * 1.7));
      pos.setXYZ(i, x, gy + 0.42 + 0.07 * Math.sin(time * 2.3 + i * 0.9), z);
      this.moteBright.setX(i, b);
      const sc = i < n ? PATCH : 0.0001;
      // A few cm up: the drawn snow rises over heightAt in drifts and prints, and would cut the disc's edge.
      this.m.compose(this.v.set(x, gy + 0.07, z), this.q, this.s.set(sc, 1, sc));
      this.patches.setMatrixAt(i, this.m);
      this.patches.instanceColor!.setX(i, b);
    }
    pos.needsUpdate = true;
    this.moteBright.needsUpdate = true;
    this.patches.instanceMatrix.needsUpdate = true;
    this.patches.instanceColor!.needsUpdate = true;
  }

  /** The pool's grid follows the ground under the objective (a few cm above it). */
  private layPool(world: World, target: THREE.Vector3): void {
    this.poolAt.copy(target);
    const gy = world.heightAt(target.x, target.z);
    this.pool.position.set(target.x, gy, target.z);
    this.pool.scale.set(POOL, 1, POOL);
    const p = this.pool.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, (world.heightAt(target.x + p.getX(i) * POOL, target.z + p.getZ(i) * POOL) - gy + 0.05));
    p.needsUpdate = true;
  }

  dispose(): void {
    for (const o of [this.shaft, this.pool, this.motes, this.patches]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}
