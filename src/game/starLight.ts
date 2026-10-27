import * as THREE from 'three';

/*
 * Light Starhaven's lamps and crystals throw on the ground, as light rather than paint. Every source is static, so
 * their irradiance on the ground is baked once on the CPU into one half-float map over the island (0.5 m texels):
 * a lamp is a point a lantern's height up, with the inverse-square and cosine falloff that make a pool about as wide
 * as the lamp is tall; a crystal cluster is a low source whose light hugs its foot. The ground, the paving and the
 * meadow add the map to their diffuse lighting (so it is multiplied by their own colour and lights each grass blade
 * where it stands, instead of a decal lying over them); walls near a lamp get the same lamps analytically.
 */

/** The high street's lanterns: two rows at the paving's kerbs, every six metres from the harbour to the stairs. */
export const STAR_LAMPS: readonly (readonly [number, number])[] = Array.from({length: 26}, (_, i) => {
  const side = i % 2 ? 1 : -1, z = 86 - Math.floor(i / 2) * 6;
  return [side * 5.75, z] as const;
});
/**
 * What stands at each lamp place (starLanterns.ts): iron posts of three heights, a crook post with a hung lantern, a
 * crystal lamp on a stone plinth (cool light), or nothing (a gap: the street's rhythm is not a metronome). Rows run
 * from the harbour (z 86) to the stairs, left then right.
 */
export type StarLampKind = 'post' | 'tall' | 'short' | 'crook' | 'crystal' | 'none';
export const STAR_LAMP_KIND: readonly StarLampKind[] = [
  'post', 'post', 'crook', 'tall', 'none', 'crystal', 'post', 'short', 'crystal', 'crook', 'tall', 'post', 'crook', 'none',
  'post', 'crystal', 'crook', 'post', 'tall', 'none', 'crystal', 'crystal', 'post', 'crook', 'short', 'post',
];
/** Light colour and strength per lamp place (crystal lamps cool and softer, gaps dark). */
export const STAR_LAMP_LIGHT: readonly [THREE.Color, number][] = STAR_LAMP_KIND.map((k) => k === 'none' ? [new THREE.Color('#000000'), 0] : k === 'crystal' ? [new THREE.Color('#9fe4ff'), .55] : [new THREE.Color('#ffb45e'), k === 'short' ? .8 : k === 'tall' ? 1.15 : 1]);
/** The lantern's glass centre above its foot (starLanterns.ts). */
export const STAR_LAMP_LIFT = 3.28;
/** Linear warm lamp light: radiant intensity of one lantern (irradiance at 1 m). */
const LAMP_COLOR = new THREE.Color('#ffb45e');
const LAMP_I = 95;
/** Where a lamp's light is cut to nothing (a window, so pools end softly instead of on a grid). */
const LAMP_REACH = 6.5;

export interface StarGlowSource { x: number; z: number; color: THREE.ColorRepresentation; strength: number; radius: number }

const MAP_MIN_X = -140, MAP_MIN_Z = -160, MAP_W = 280, MAP_H = 320, TEXEL = .5;
const NX = MAP_W / TEXEL, NZ = MAP_H / TEXEL;

/** Shared by every material that takes the baked light. */
export const STAR_LIGHT_UNIFORMS = {
  slMap: {value: null as THREE.DataTexture | null},
  slRect: {value: new THREE.Vector4(MAP_MIN_X, MAP_MIN_Z, 1 / MAP_W, 1 / MAP_H)},
};

const fmt = (n: number) => n.toFixed(3);
const LAMP_GLSL_ARRAY = `const vec2 SL_LAMP[${STAR_LAMPS.length}]=vec2[${STAR_LAMPS.length}](${STAR_LAMPS.map(([x, z]) => `vec2(${fmt(x)},${fmt(z)})`).join(',')});
const vec3 SL_LAMPC[${STAR_LAMPS.length}]=vec3[${STAR_LAMPS.length}](${STAR_LAMP_LIGHT.map(([c, k]) => `vec3(${fmt(c.r * k / LAMP_COLOR.r)},${fmt(c.g * k / LAMP_COLOR.g)},${fmt(c.b * k / LAMP_COLOR.b)})`).join(',')});`;

/** GLSL: `starBakedLight(xz)` the ground's baked irradiance; `starLampLight(p, n)` the lamps' on any surface. */
export const STAR_LIGHT_GLSL = /* glsl */ `
uniform sampler2D slMap;
uniform vec4 slRect;
${LAMP_GLSL_ARRAY}
vec3 starBakedLight(vec2 xz){vec2 uv=(xz-slRect.xy)*slRect.zw;return texture2D(slMap,uv).rgb;}
vec3 starWorldFromView(vec3 v){vec3 p=v-viewMatrix[3].xyz;return vec3(dot(p,viewMatrix[0].xyz),dot(p,viewMatrix[1].xyz),dot(p,viewMatrix[2].xyz));}
// Lamps on a surface of any facing (walls, posts): the six nearest along the street. The glass's height is the
// paving's plus the lift; the street is level enough for a constant.
vec3 starLampLight(vec3 p,vec3 n){
  if(abs(p.x)>16.||p.z<${fmt(STAR_LAMPS[STAR_LAMPS.length - 1][1] - LAMP_REACH)}||p.z>${fmt(STAR_LAMPS[0][1] + LAMP_REACH)})return vec3(0.);
  float k=clamp(floor((${fmt(STAR_LAMPS[0][1])}-p.z)/6.+.5),0.,${fmt(STAR_LAMPS.length / 2 - 1)});
  vec3 e=vec3(0.);
  for(int j=-1;j<=1;j++)for(int s=0;s<2;s++){
    int i=int(k)*2+j*2+s;if(i<0||i>=${STAR_LAMPS.length})continue;
    vec3 L=vec3(SL_LAMP[i].x,${fmt(3 + STAR_LAMP_LIFT)},SL_LAMP[i].y)-p;float d2=dot(L,L);
    float w=clamp(1.-d2*d2/${fmt(LAMP_REACH ** 4)},0.,1.),id=inversesqrt(d2),down=max(L.y*id,0.);
    // The lantern's roof sends its light down: a cos^2 lobe about the vertical.
    e+=SL_LAMPC[i]*max(dot(n,L*id),0.)/d2*w*w*down*down;
  }
  return e*vec3(${fmt(LAMP_COLOR.r * LAMP_I)},${fmt(LAMP_COLOR.g * LAMP_I)},${fmt(LAMP_COLOR.b * LAMP_I)});
}
// The lamps' images in wet stone: a tight highlight per lamp (Blinn-Phong, shin its sharpness).
vec3 starLampGlint(vec3 p,vec3 n,vec3 V,float shin){
  if(abs(p.x)>16.||p.z<${fmt(STAR_LAMPS[STAR_LAMPS.length - 1][1] - 30.)}||p.z>${fmt(STAR_LAMPS[0][1] + 30.)})return vec3(0.);
  float k=clamp(floor((${fmt(STAR_LAMPS[0][1])}-p.z)/6.+.5),0.,${fmt(STAR_LAMPS.length / 2 - 1)});
  float e=0.;
  // Reflections reach further than light: the next few lamps toward the eye too.
  for(int j=-3;j<=3;j++)for(int s=0;s<2;s++){
    int i=int(k)*2+j*2+s;if(i<0||i>=${STAR_LAMPS.length})continue;
    vec3 L=vec3(SL_LAMP[i].x,${fmt(3 + STAR_LAMP_LIFT)},SL_LAMP[i].y)-p;float d2=dot(L,L);L*=inversesqrt(d2);
    float h=max(dot(n,normalize(L+V)),0.);
    e+=pow(h,shin)*(shin+8.)/25.13/(1.+d2*.02)*SL_LAMPC[i].g;
  }
  return e*vec3(${fmt(LAMP_COLOR.r)},${fmt(LAMP_COLOR.g)},${fmt(LAMP_COLOR.b)});
}
`;

/** Door lanterns (world positions of their glass), set by the settlement before its walls first compile. */
let DOOR_LAMPS: readonly (readonly [number, number, number])[] = [];
export function setStarDoorLamps(points: readonly (readonly [number, number, number])[]) { DOOR_LAMPS = points; }
const DOOR_I = 9, DOOR_REACH = 4.5;
/** GLSL: `starDoorLight(p, n)`, the door lanterns' warm light on a wall (empty when there are none). */
function doorLightGLSL() {
  if (!DOOR_LAMPS.length) return 'vec3 starDoorLight(vec3 p,vec3 n){return vec3(0.);}';
  return `const vec3 SL_DOOR[${DOOR_LAMPS.length}]=vec3[${DOOR_LAMPS.length}](${DOOR_LAMPS.map(([x, y, z]) => `vec3(${fmt(x)},${fmt(y)},${fmt(z)})`).join(',')});
vec3 starDoorLight(vec3 p,vec3 n){
  float e=0.;
  for(int i=0;i<${DOOR_LAMPS.length};i++){
    vec3 L=SL_DOOR[i]-p;float d2=dot(L,L);if(d2>${fmt(DOOR_REACH * DOOR_REACH)})continue;
    float w=1.-d2/${fmt(DOOR_REACH * DOOR_REACH)};
    e+=max(dot(n,L*inversesqrt(d2)),0.)/(d2+.25)*w*w;
  }
  return e*vec3(${fmt(LAMP_COLOR.r * DOOR_I)},${fmt(LAMP_COLOR.g * DOOR_I)},${fmt(LAMP_COLOR.b * DOOR_I)});
}`;
}
/**
 * Adds the baked light to a MeshStandardMaterial's diffuse. `world` is a GLSL expression for the fragment's world
 * position (vec3); `lamps` also lights it from the lanterns analytically (for upright surfaces off the baked ground).
 */
export function injectStarLight(shader: {uniforms: Record<string, THREE.IUniform>; fragmentShader: string}, world: string | null, opts: {baked?: boolean; lamps?: boolean; scale?: number} = {}) {
  Object.assign(shader.uniforms, STAR_LIGHT_UNIFORMS);
  const baked = opts.baked ?? true, lamps = opts.lamps ?? false, s = fmt(opts.scale ?? 1);
  const wp = world ?? 'starWorldFromView(-vViewPosition)';
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${STAR_LIGHT_GLSL}\n${lamps ? doorLightGLSL() : ''}`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 slP=${wp};vec3 slN=inverseTransformDirection(normal,viewMatrix);vec3 slE=vec3(0.);
  ${baked ? 'slE+=starBakedLight(slP.xz)*clamp(slN.y*.6+.4,0.,1.);' : ''}
  ${lamps ? 'slE+=starLampLight(slP,slN)+starDoorLight(slP,slN);' : ''}
  reflectedLight.indirectDiffuse+=slE*${s}*BRDF_Lambert(diffuseColor.rgb);
}`);
}

/** Bakes the lamps and the given glows into the map (call once the island's crystals are placed). */
export function bakeStarLight(glows: readonly StarGlowSource[]): THREE.DataTexture {
  const acc = new Float32Array(NX * NZ * 3);
  const c = new THREE.Color();
  const each = (x: number, z: number, r: number, f: (dx: number, dz: number) => number) => {
    const i0 = Math.max(0, Math.floor((x - r - MAP_MIN_X) / TEXEL)), i1 = Math.min(NX - 1, Math.ceil((x + r - MAP_MIN_X) / TEXEL));
    const j0 = Math.max(0, Math.floor((z - r - MAP_MIN_Z) / TEXEL)), j1 = Math.min(NZ - 1, Math.ceil((z + r - MAP_MIN_Z) / TEXEL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = f(MAP_MIN_X + (i + .5) * TEXEL - x, MAP_MIN_Z + (j + .5) * TEXEL - z);
      if (v <= 0) continue;
      const o = (j * NX + i) * 3;acc[o] += c.r * v;acc[o + 1] += c.g * v;acc[o + 2] += c.b * v;
    }
  };
  c.copy(LAMP_COLOR).multiplyScalar(LAMP_I);
  const h = STAR_LAMP_LIFT, h2 = h * h;
  for (const [i, [x, z]] of STAR_LAMPS.entries()) { const [lc, lk] = STAR_LAMP_LIGHT[i]; if (!lk) continue; c.copy(lc).multiplyScalar(LAMP_I * lk); each(x, z, LAMP_REACH, (dx, dz) => {
    const d2 = dx * dx + dz * dz + h2, w = Math.max(0, 1 - d2 * d2 / LAMP_REACH ** 4);
    const c = h / Math.sqrt(d2);
    return c * c * c / d2 * w * w;
  }); }
  for (const g of glows) {
    c.set(g.color).multiplyScalar(g.strength);
    const r = g.radius;
    each(g.x, g.z, r * 2.2, (dx, dz) => { const q = (dx * dx + dz * dz) / (r * r); return Math.exp(-q * 1.6) * Math.max(0, 1 - q / 4.84); });
  }
  const data = new Uint16Array(NX * NZ * 4);
  for (let i = 0; i < NX * NZ; i++) {
    data[i * 4] = THREE.DataUtils.toHalfFloat(acc[i * 3]);data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(acc[i * 3 + 1]);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(acc[i * 3 + 2]);data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;tex.needsUpdate = true;
  tex.name = 'starhaven-ground-light';
  STAR_LIGHT_UNIFORMS.slMap.value?.dispose();
  STAR_LIGHT_UNIFORMS.slMap.value = tex;
  return tex;
}

/** For QA: the baked irradiance (linear RGB) at a point. */
export function sampleStarLight(x: number, z: number): [number, number, number] {
  const t = STAR_LIGHT_UNIFORMS.slMap.value;if (!t) return [0, 0, 0];
  const i = Math.min(NX - 1, Math.max(0, Math.floor((x - MAP_MIN_X) / TEXEL))), j = Math.min(NZ - 1, Math.max(0, Math.floor((z - MAP_MIN_Z) / TEXEL)));
  const d = t.image.data as Uint16Array, o = (j * NX + i) * 4, f = THREE.DataUtils.fromHalfFloat;
  return [f(d[o]), f(d[o + 1]), f(d[o + 2])];
}
