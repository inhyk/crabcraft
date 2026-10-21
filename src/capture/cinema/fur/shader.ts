// Strand fur shaders for the cinema: every hair is a camera-facing ribbon bent along a Catmull-Rom curve
// whose control points live in a float texture (one row of texels per strand, see groom.ts), blown by a
// wind that travels across the coat in gusts. Shading is Kajiya-Kay with two shifted highlights, a
// hemisphere fill, a root-to-tip occlusion, light through the tips when the sun is behind them, and snow
// caught on the tips. The snow bits (clumps and ice crystals) ride the same curves.
import * as THREE from 'three';

/** Shared by the hair and the snow on it: a strand's point and tangent (d/dv) at v, wind included. */
const STRAND = /* glsl */ `
uniform highp sampler2D uStrands;
uniform int uStride;
uniform int uP;
uniform int uTexW;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uWindK;
uniform float uWaveSpeed;
uniform float uGust;
uniform float uFlutter;
uniform vec3 uFlutterDir;

vec4 texel(int i) { return texelFetch(uStrands, ivec2(i % uTexW, i / uTexW), 0); }

// Texel 0..P-1: points (xyz) with per-strand data in w: width, random, snow, random 2.
// Texel P: the root's surface normal (xyz) and the strand's stiffness (w). Then each point's sky
// occlusion, four to a texel, and after those its occlusion toward the key light (set 1).
float occAt(int base, float v, int set) {
  float s = v * float(uP - 1);
  int i = min(int(floor(s)), uP - 2);
  float u = s - float(i);
  int o = base + uP + 1 + set * ((uP + 3) / 4);
  vec4 a = texel(o + i / 4);
  vec4 b = texel(o + (i + 1) / 4);
  float x = a[i % 4];
  float y = b[(i + 1) % 4];
  return mix(x, y, u);
}
void strandAt(int id, float v, out vec3 pos, out vec3 tanV, out vec4 data, out vec4 nrm) {
  int base = id * uStride;
  vec4 d0 = texel(base);
  vec4 d1 = texel(base + 1);
  vec4 d2 = texel(base + 2);
  vec4 d3 = texel(base + 3);
  data = vec4(d0.w, d1.w, d2.w, d3.w);
  nrm = texel(base + uP);
  float s = v * float(uP - 1);
  int i = min(int(floor(s)), uP - 2);
  float u = s - float(i);
  vec3 p1 = texel(base + i).xyz;
  vec3 p2 = texel(base + i + 1).xyz;
  vec3 p0 = i > 0 ? texel(base + i - 1).xyz : 2.0 * p1 - p2;
  vec3 p3 = i + 2 < uP ? texel(base + i + 2).xyz : 2.0 * p2 - p1;
  vec3 a = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3;
  vec3 b = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
  pos = 0.5 * (2.0 * p1 + (p2 - p0) * u + a * u * u + b * u * u * u);
  tanV = 0.5 * ((p2 - p0) + 2.0 * a * u + 3.0 * b * u * u) * float(uP - 1);
  vec3 tip = texel(base + uP - 1).xyz;
  float len = length(tip - d0.xyz);
  // Gusts travel across the coat along the wind; each strand flutters a little on its own.
  float r = d1.w;
  float ph = dot(d0.xyz, uWindK) - uTime * uWaveSpeed;
  // Locks share r, so each lock catches the gust on its own beat.
  float gust = uGust * (0.55 + 0.22 * sin(ph) + 0.23 * sin(ph * 2.7 + 1.3 + r * 6.2831));
  float fl = uFlutter * sin(uTime * (11.0 + 7.0 * d3.w) + r * 40.0 + v * 4.0);
  float k = len / max(0.2, nrm.w);
  pos += (uWind * gust + uFlutterDir * fl) * k * v * v;
  tanV += (uWind * gust + uFlutterDir * fl) * k * 2.0 * v;
}
`;

const HAIR_VERT = /* glsl */ `
${STRAND}
uniform float uScale;
uniform float uPxSize;
uniform float uMinPx;
uniform float uWidthMul;
uniform float uTipWidth;
uniform float uDensity;
in float aV;
in float aSide;
out float vV;
out vec3 vT;
out vec3 vN;
out vec4 vData;
out vec3 vViewPos;
out float vOcc;
out float vShadow;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 pos; vec3 tanV; vec4 data; vec4 nrm;
  strandAt(gl_InstanceID, aV, pos, tanV, data, nrm);
  vOcc = occAt(gl_InstanceID * uStride, aV, 0);
  vShadow = occAt(gl_InstanceID * uStride, aV, 1);
  // Level of detail: a fixed random subset of strands, the survivors wider.
  if (fract(data.y * 13.37 + data.w * 7.91) > uDensity) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vec3 T = normalize((modelViewMatrix * vec4(tanV, 0.0)).xyz);
  vec3 V = normalize(-mvPosition.xyz);
  vec3 side = cross(T, V);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : normalize(cross(T, vec3(0.0, 1.0, 0.0)));
  float w = data.x * mix(1.0, uTipWidth, pow(aV, 0.8)) * uWidthMul * uScale;
  w = max(w, uMinPx * uPxSize * max(0.001, -mvPosition.z));
  mvPosition.xyz += side * aSide * 0.5 * w;
  gl_Position = projectionMatrix * mvPosition;
  vV = aV;
  vT = T;
  vN = normalize(normalMatrix * nrm.xyz);
  vData = data;
  vViewPos = mvPosition.xyz;
  #include <fog_vertex>
}
`;

/** Light from the scene's own lights (hemisphere, directional, point), Kajiya-Kay on a tangent T. */
const LIGHTING = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uRimDir;
uniform vec3 uRimCol;
uniform float uSpec1;
uniform float uSpec2;
uniform float uGloss1;
uniform float uGloss2;
uniform float uShift;
uniform float uBack;
uniform float uWrap;
float kk(vec3 T, vec3 H, float e) {
  float th = dot(T, H);
  return pow(max(0.0, sqrt(max(0.0, 1.0 - th * th))), e);
}
vec3 dirLight(vec3 L, vec3 lc, vec3 alb, vec3 T, vec3 T1, vec3 T2, vec3 N, vec3 V, float ao, float tipLit, float sparkle) {
  float tl = dot(T, L);
  float diff = sqrt(max(0.0, 1.0 - tl * tl));
  float facing = clamp((dot(N, L) + uWrap) / (1.0 + uWrap), 0.0, 1.0);
  vec3 H = normalize(L + V);
  float s1 = kk(T1, H, uGloss1) * uSpec1;
  float s2 = kk(T2, H, uGloss2) * uSpec2 * (0.4 + sparkle);
  float back = pow(max(0.0, dot(-V, L)), 4.0) * uBack * tipLit;
  // The coat's own shadow (toward the key, from the groom) darkens what the light would reach.
  float sh = mix(0.05, 1.0, vShadow);
  return lc * ((alb * diff + s1 + s2 * alb * 2.0) * facing * ao * sh + back * alb);
}
vec3 hairLight(vec3 alb, vec3 T, vec3 N, vec3 V, float ao, float tipLit, float sparkle) {
  vec3 col = ambientLightColor * alb * ao;
  #if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
    float h = dot(N, hemisphereLights[i].direction) * 0.5 + 0.5;
    col += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, h) * alb * ao;
  }
  #endif
  vec3 T1 = normalize(T + N * uShift);
  vec3 T2 = normalize(T - N * uShift * 1.6);
  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) col += dirLight(directionalLights[i].direction, directionalLights[i].color, alb, T, T1, T2, N, V, ao, tipLit, sparkle);
  #endif
  // The costume's own key and rim (view space), lighting the fur and nothing else. The rim only
  // shines through the tips and along the silhouette, where the coat turns away from the lens.
  col += dirLight(uKeyDir, uKeyCol, alb, T, T1, T2, N, V, ao, tipLit, sparkle);
  float edge = pow(1.0 - abs(dot(N, V)), 2.0);
  float through = pow(max(0.0, dot(-V, uRimDir)), 3.0);
  vec3 Hr = normalize(uRimDir + V);
  col += uRimCol * (alb * (through * uBack * tipLit + edge * 0.6) * (0.4 + 0.6 * ao) + kk(T1, Hr, uGloss1) * uSpec1 * edge * ao);
  #if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    vec3 lv = pointLights[i].position - vViewPos;
    float d = length(lv);
    vec3 L = lv / d;
    float att = getDistanceAttenuation(d, pointLights[i].distance, pointLights[i].decay);
    float tl = dot(T, L);
    float diff = sqrt(max(0.0, 1.0 - tl * tl));
    vec3 H = normalize(L + V);
    float s1 = kk(T1, H, uGloss1) * uSpec1;
    float back = pow(max(0.0, dot(-V, L)), 4.0) * uBack * tipLit;
    col += pointLights[i].color * att * (alb * diff * (0.35 + 0.65 * ao) + s1 * ao + back * alb);
  }
  #endif
  // Lambert's 1/pi, as the game's standard materials have it, so fur sits in the same light as the shell.
  return col * RECIPROCAL_PI;
}
`;

const HAIR_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uTipCol;
uniform float uTipAmt;
uniform vec3 uSnowCol;
uniform float uSnowLen;
uniform float uRootAO;
in float vV;
in vec3 vT;
in vec3 vN;
in vec4 vData;
in vec3 vViewPos;
in float vOcc;
in float vShadow;
#include <common>
#include <lights_pars_begin>
#include <fog_pars_fragment>
${LIGHTING}
void main() {
  vec3 T = normalize(vT);
  vec3 N = normalize(vN);
  vec3 V = normalize(-vViewPos);
  float r = vData.y;
  float r2 = vData.w;
  vec3 alb = mix(uColA, uColB, r);
  alb *= 0.82 + 0.36 * fract(r * 91.7);
  float tip = smoothstep(0.55, 1.0, vV) * uTipAmt * (0.35 + 0.9 * r2);
  alb = mix(alb, uTipCol, clamp(tip, 0.0, 1.0));
  // Only the snowiest hairs frost white at the tips; the rest carry their snow as clumps (the bits).
  float snow = smoothstep(0.55, 0.9, vData.z) * smoothstep(1.0 - uSnowLen * (0.5 + r2), 1.0, vV);
  alb = mix(alb, uSnowCol, clamp(snow, 0.0, 1.0));
  // Rime: specks of frost along snowy hairs, a finer layer than the snow bits.
  float speck = fract(sin(dot(vec2(r * 91.7 + r2 * 13.1, floor(vV * 30.0)), vec2(12.9898, 78.233))) * 43758.5453);
  float rime = step(0.88, speck) * smoothstep(0.2, 0.7, vData.z) * smoothstep(0.15, 0.5, vV);
  alb = mix(alb, uSnowCol, rime * 0.35);
  float ao = mix(uRootAO, 1.0, vOcc) * mix(0.55, 1.0, smoothstep(0.0, 0.6, vV));
  float sparkle = snow > 0.2 ? step(0.93, fract(r * 517.3 + vV * 3.1)) * 3.0 : 0.0;
  vec3 col = hairLight(alb, T, N, V, ao, vV, sparkle);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const BITS_VERT = /* glsl */ `
${STRAND}
uniform float uScale;
uniform float uPxSize;
uniform float uDensity;
in vec2 aCorner;
in float aStrand;
in float aAt;
in float aSize;
in vec4 aSpin;
out vec2 vCorner;
out vec4 vSpin;
out float vKind;
out vec3 vViewPos;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 pos; vec3 tanV; vec4 data; vec4 nrm;
  int id = int(aStrand);
  strandAt(id, aAt, pos, tanV, data, nrm);
  if (fract(data.y * 13.37 + data.w * 7.91) > uDensity) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec4 mvPosition = modelViewMatrix * vec4(pos + nrm.xyz * aSize * 0.35, 1.0);
  float s = max(abs(aSize) * uScale, 1.5 * uPxSize * max(0.001, -mvPosition.z));
  mvPosition.xy += aCorner * s;
  gl_Position = projectionMatrix * mvPosition;
  vCorner = aCorner;
  vSpin = aSpin;
  vKind = aSize < 0.0 ? 1.0 : 0.0;
  vViewPos = mvPosition.xyz;
  #include <fog_vertex>
}
`;

const BITS_FRAG = /* glsl */ `
uniform vec3 uSnowCol;
uniform float uGlint;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uRimDir;
uniform vec3 uRimCol;
in vec2 vCorner;
in vec4 vSpin;
in float vKind;
in vec3 vViewPos;
#include <common>
#include <lights_pars_begin>
#include <fog_pars_fragment>
void main() {
  vec2 c = vCorner;
  float r = length(c);
  vec3 V = normalize(-vViewPos);
  vec3 col;
  if (vKind > 0.5) {
    // An ice crystal: a six-pointed plate that flashes when it turns to mirror a light into the lens.
    float a = atan(c.y, c.x) + vSpin.w * 6.2831;
    float star = abs(cos(a * 3.0));
    float arm = smoothstep(0.08, 0.0, r * (1.0 - 0.75 * pow(star, 8.0)) - 0.12);
    float core = smoothstep(0.35, 0.0, r);
    float m = max(arm, core * 0.8);
    if (m < 0.35) discard;
    vec3 n = normalize(vSpin.xyz * 2.0 - 1.0);
    float g = 0.0;
    #if NUM_DIR_LIGHTS > 0
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
      vec3 R = reflect(-directionalLights[i].direction, n);
      g += pow(max(0.0, dot(R, V)), 60.0) * length(directionalLights[i].color);
    }
    #endif
    g += pow(max(0.0, dot(reflect(-uKeyDir, n), V)), 60.0) * length(uKeyCol);
    g += pow(max(0.0, dot(reflect(-uRimDir, n), V)), 60.0) * length(uRimCol);
    vec3 sky = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) sky += hemisphereLights[i].skyColor;
    #endif
    col = uSnowCol * sky * (0.75 + 0.25 * core) * RECIPROCAL_PI + vec3(0.85, 0.93, 1.0) * g * uGlint;
  } else {
    // A clump of packed snow: a lumpy ball lit from the sky.
    float lump = 0.82 + 0.1 * sin(atan(c.y, c.x) * 5.0 + vSpin.w * 20.0) + 0.06 * sin(atan(c.y, c.x) * 11.0 + vSpin.x * 30.0);
    if (r > lump) discard;
    vec3 n = normalize(vec3(c / lump, sqrt(max(0.0, 1.0 - r * r / (lump * lump)))));
    vec3 l = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) l += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, dot(n, hemisphereLights[i].direction) * 0.5 + 0.5);
    #endif
    #if NUM_DIR_LIGHTS > 0
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) l += directionalLights[i].color * max(0.0, dot(n, directionalLights[i].direction) * 0.8 + 0.2);
    #endif
    l += uKeyCol * max(0.0, dot(n, uKeyDir) * 0.8 + 0.2) + uRimCol * pow(max(0.0, -dot(vec3(0.0, 0.0, 1.0), uRimDir)), 2.0) * smoothstep(0.5, 1.0, r / lump);
    col = uSnowCol * l * (0.8 + 0.2 * n.z) * RECIPROCAL_PI;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface HairLook {
  colA: string;
  colB: string;
  tip: string;
  tipAmt: number;
  snow?: string;
  snowLen?: number;
  rootAO?: number;
  spec1?: number;
  spec2?: number;
  gloss1?: number;
  gloss2?: number;
  shift?: number;
  back?: number;
  wrap?: number;
  /** Tip width as a fraction of the root's. */
  tipWidth?: number;
}

/**
 * The uniforms a fur set's hair and snow share (the same objects in both materials, so one write a
 * frame moves both). Added after UniformsUtils.merge, which would clone the texture.
 */
export function strandUniforms(tex: THREE.DataTexture, stride: number, p: number): Record<string, THREE.IUniform> {
  return {
    uStrands: { value: tex },
    uStride: { value: stride },
    uP: { value: p },
    uTexW: { value: tex.image.width },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uWindK: { value: new THREE.Vector3() },
    uWaveSpeed: { value: 6 },
    uGust: { value: 1 },
    uFlutter: { value: 0 },
    uFlutterDir: { value: new THREE.Vector3(1, 0, 0) },
    uScale: { value: 1 },
    uPxSize: { value: 0.001 },
    uDensity: { value: 1 },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uKeyCol: { value: new THREE.Color(0, 0, 0) },
    uRimDir: { value: new THREE.Vector3(0, 0, -1) },
    uRimCol: { value: new THREE.Color(0, 0, 0) },
  };
}

const lin = (hex: string) => new THREE.Color(hex);

export function hairMaterial(shared: Record<string, THREE.IUniform>, look: HairLook): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name: 'cinema-fur',
    vertexShader: HAIR_VERT,
    fragmentShader: HAIR_FRAG,
    lights: true,
    fog: true,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      THREE.UniformsLib.fog,
      {
        uMinPx: { value: 0.4 },
        uWidthMul: { value: 1 },
        uTipWidth: { value: look.tipWidth ?? 0.25 },
        uColA: { value: lin(look.colA) },
        uColB: { value: lin(look.colB) },
        uTipCol: { value: lin(look.tip) },
        uTipAmt: { value: look.tipAmt },
        uSnowCol: { value: lin(look.snow ?? '#e9f0ff') },
        uSnowLen: { value: look.snowLen ?? 0.3 },
        uRootAO: { value: look.rootAO ?? 0.22 },
        uSpec1: { value: look.spec1 ?? 0.05 },
        uSpec2: { value: look.spec2 ?? 0.2 },
        uGloss1: { value: look.gloss1 ?? 90 },
        uGloss2: { value: look.gloss2 ?? 22 },
        uShift: { value: look.shift ?? 0.12 },
        uBack: { value: (look.back ?? 0.9) * 2 },
        uWrap: { value: look.wrap ?? 0.6 },
      },
    ]),
  });
  Object.assign(m.uniforms, shared);
  return m;
}

export function bitsMaterial(shared: Record<string, THREE.IUniform>, glint: number): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name: 'cinema-fur-snow',
    vertexShader: BITS_VERT,
    fragmentShader: BITS_FRAG,
    lights: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      THREE.UniformsLib.fog,
      { uSnowCol: { value: lin('#e6eeff') }, uGlint: { value: glint } },
    ]),
  });
  Object.assign(m.uniforms, shared);
  return m;
}

/** A ribbon of `seg` segments: v along it, side -1 / +1 across it. */
export function ribbon(seg: number, count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const v: number[] = [];
  const side: number[] = [];
  const pos: number[] = [];
  for (let i = 0; i <= seg; i++) {
    for (const s of [-1, 1]) {
      v.push(i / seg);
      side.push(s);
      pos.push(0, 0, 0);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.instanceCount = count;
  return g;
}

/** Quads for the snow bits; per instance: strand, v on it, size (negative: an ice crystal), spin. */
export function bitsGeometry(strand: Float32Array, at: Float32Array, size: Float32Array, spin: Float32Array): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  g.setAttribute('aStrand', new THREE.InstancedBufferAttribute(strand, 1));
  g.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 1));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
  g.instanceCount = strand.length;
  return g;
}
