import * as THREE from 'three';

/*
 * Emberreach's air: a smoky volcanic sky baked once on the CPU into a small radiance LUT (snowSky.ts's pattern), and the
 * sun, hemisphere, fog and environment map read off the same numbers so every surface agrees with the dome.
 *
 * The look: a low amber sun veiled by ash, a smoky amber horizon lit from below by the lava sea, a darker cool violet
 * zenith, a smoke shelf leaning off the volcano to the north, ash banks low on the horizon (drawn in the dome shader so
 * they drift) and the dark hazed silhouettes of the other islands of the archipelago on the rim of the lava sea.
 * Shade is violet-grey, never black: the hemisphere's sky is the dome's own irradiance graded toward violet, its ground
 * is the lava's warm bounce.
 */

export interface EmberSkyOptions {
  /** Bearing of the sun, degrees: 0 faces +Z (south), 90 faces +X (east). */
  azimuth?: number;
  /** Degrees above the horizon. */
  elevation?: number;
}

/** LUT size: u is the full azimuth (atan2(x, z)), v the warped elevation (rows crowd the horizon). */
const LUT_W = 256;
const LUT_H = 128;
/** Distant island silhouettes round the horizon. */
const RIM_W = 1024;

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (v: number) => v - Math.floor(v);
const hash3 = (x: number, y: number, z: number) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy), l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy), uz);
}
const fbm3 = (x: number, y: number, z: number, oct = 4) => { let s = 0, a = .5, n = 0; for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; x = x * 2.07 + 5.3; y = y * 2.07 + 1.7; z = z * 2.07 + 9.1; a *= .5; } return s / n; };

/** The horizon band against the first pass (11:30): 38% darker, so lava, forges and windows outshine the sky. */
const HZ_DIM = .62;
const lin = (hex: string) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b] as [number, number, number]; };
/** Palette (sRGB hex, used linear). */
const P = {
  hzSun: lin('#cf8c5c'), hzAway: lin('#9a5048'), mid: lin('#3a2a32'), zenith: lin('#2a1d24'),
  lava: lin('#ff5a1e'), smoke: lin('#2b2329'), smokeLit: lin('#8a4a36'), seaDark: lin('#24120f'), sun: lin('#ffb070'),
};
/** Rows crowd the horizon: v in 0..1 to elevation in radians and back (the shader inverts it). */
const rowElevation = (v: number) => { const s = v * 2 - 1; return Math.sign(s) * Math.pow(Math.abs(s), 1.5) * Math.PI * .5; };

export interface BakedEmberSky {
  sunDir: [number, number, number];
  /** LUT_W x LUT_H RGBA, linear. */
  lut: Float32Array;
  /** Horizon radiance per LUT column (a breath above the sea), linear. */
  horizon: Float32Array;
  /** Cosine-weighted irradiance of the upper hemisphere on a level surface. */
  skyUp: [number, number, number];
  /** Island rim: R top elevation (radians), G vent glow. */
  rim: Float32Array;
}

/** The smoke shelf the volcano's plume spreads into, leaning downwind (north-west). */
function shelfAt(dx: number, dy: number, dz: number): number {
  const h = Math.hypot(dx, dz) || 1, nx = dx / h, nz = dz / h, eDeg = Math.asin(clamp(dy, -1, 1)) * 180 / Math.PI;
  const toward = nx * -.42 + nz * -.91;
  const band = smooth(.05, .8, toward) * smooth(3, 13, eDeg) * (1 - smooth(32, 72, eDeg));
  if (band <= 0) return 0;
  return band * (.45 + .75 * smooth(.32, .72, fbm3(dx * 3.1 + 7, dy * 6.5, dz * 3.1, 4)));
}

/** Pure, so tools can bake it without a GPU. */
export function bakeEmberSky(opts: EmberSkyOptions = {}): BakedEmberSky {
  const az = THREE.MathUtils.degToRad(opts.azimuth ?? 72), el = THREE.MathUtils.degToRad(opts.elevation ?? 19);
  const sunDir: [number, number, number] = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const sh = Math.hypot(sunDir[0], sunDir[2]), shx = sunDir[0] / sh, shz = sunDir[2] / sh;
  const radiance = (dx: number, dy: number, dz: number, out: number[]) => {
    const e = Math.asin(clamp(dy, -1, 1)), eDeg = e * 180 / Math.PI, h = Math.hypot(dx, dz) || 1;
    const toward = (dx / h) * shx + (dz / h) * shz, side = Math.pow(toward * .5 + .5, 2.2);
    const mu = Math.max(0, dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2]);
    const shelf = shelfAt(dx, dy, dz);
    for (let c = 0; c < 3; c++) {
      const hz = (P.hzAway[c] + (P.hzSun[c] - P.hzAway[c]) * side) * HZ_DIM;
      let v: number;
      if (eDeg >= 0) {
        // The amber band stays within ~8 degrees of the horizon; above it the smoke is dark plum to the zenith.
        v = hz + (P.mid[c] - hz) * smooth(0, 8, eDeg);
        v += (P.zenith[c] - v) * smooth(6, 55, eDeg);
        // The lava sea lights the low haze from below all round.
        v += P.lava[c] * .15 * Math.exp(-eDeg / 2.4);
        const under = Math.exp(-eDeg / 9);
        v += ((P.smoke[c] + P.smokeLit[c] * under + P.sun[c] * .35 * Math.pow(mu, 3)) - v) * shelf * .78;
        v += P.sun[c] * (.08 * Math.pow(mu, 5) + .35 * Math.pow(mu, 42) + 1.1 * Math.pow(mu, 420)) * (1 - shelf * .55);
      } else {
        // Below the horizon only the environment map sees it: the crusted sea with its glow.
        const sea = P.seaDark[c] + P.lava[c] * .1;
        v = hz * .8 + P.lava[c] * .22 + (sea - (hz * .8 + P.lava[c] * .22)) * smooth(0, 22, -eDeg);
      }
      out[c] = v;
    }
  };
  const lut = new Float32Array(LUT_W * LUT_H * 4), col = [0, 0, 0];
  for (let j = 0; j < LUT_H; j++) {
    const e = rowElevation((j + .5) / LUT_H), ce = Math.cos(e), se = Math.sin(e);
    for (let i = 0; i < LUT_W; i++) {
      const phi = ((i + .5) / LUT_W - .5) * TAU;
      radiance(Math.sin(phi) * ce, se, Math.cos(phi) * ce, col);
      lut.set([col[0], col[1], col[2], 1], (j * LUT_W + i) * 4);
    }
  }
  const horizon = new Float32Array(LUT_W * 3);
  for (let i = 0; i < LUT_W; i++) {
    const phi = ((i + .5) / LUT_W - .5) * TAU, e = .02;
    radiance(Math.sin(phi) * Math.cos(e), Math.sin(e), Math.cos(phi) * Math.cos(e), col);
    horizon.set(col, i * 3);
  }
  // Irradiance on a level surface: integrate the upper rows, cosine-weighted.
  const skyUp: [number, number, number] = [0, 0, 0];
  for (let j = LUT_H / 2; j < LUT_H; j++) {
    const e0 = Math.max(0, rowElevation(j / LUT_H)), e1 = rowElevation((j + 1) / LUT_H);
    const band = Math.sin(e1) - Math.sin(e0), cosW = Math.sin((e0 + e1) * .5);
    for (let i = 0; i < LUT_W; i++) for (let c = 0; c < 3; c++) skyUp[c] += lut[(j * LUT_W + i) * 4 + c] * (TAU / LUT_W) * band * cosW;
  }
  // The rest of the archipelago: a few hazed islands on the rim of the sea, two with smoking vents of their own.
  const rim = new Float32Array(RIM_W * 2);
  const isles = [
    { a: 205, w: 16, h: 1.5, vent: .9 }, { a: 238, w: 7, h: .8, vent: 0 }, { a: 128, w: 11, h: 1.1, vent: 0 },
    { a: 300, w: 22, h: 2.1, vent: 1 }, { a: 330, w: 6, h: .7, vent: 0 }, { a: 40, w: 13, h: 1, vent: .6 }, { a: 95, w: 5, h: .55, vent: 0 },
  ];
  for (let i = 0; i < RIM_W; i++) {
    const deg = ((i + .5) / RIM_W) * 360;
    let top = -1, glow = 0;
    for (const s of isles) {
      const d = Math.abs(((deg - s.a + 540) % 360) - 180) / s.w;
      if (d >= 1) continue;
      const ragged = .82 + .3 * fbm3(deg * .35, s.a, 1, 3);
      // A volcanic island is a cone with a notched summit; the others are low ragged tablelands.
      const prof = s.vent ? Math.pow(1 - d, 1.25) * (1 - .18 * smooth(.08, 0, d)) : Math.pow(1 - d * d, .6) * .75;
      const hDeg = s.h * prof * ragged;
      if (hDeg > top) { top = hDeg; glow = s.vent * smooth(.16, 0, d); }
    }
    rim[i * 2] = THREE.MathUtils.degToRad(top);
    rim[i * 2 + 1] = glow;
  }
  return { sunDir, lut, horizon, skyUp, rim };
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vWorld=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D skyLUT;
uniform sampler2D rimMap;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float exposure;
uniform float time;
uniform vec3 hazeColor;
uniform vec3 cloudDark;
uniform vec3 cloudLit;
uniform vec3 lavaGlow;
uniform float clouds;
varying vec3 vWorld;
#include <common>
vec2 skHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float skNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(skHash22(i)*2.-1.,f),b=dot(skHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(skHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(skHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
float skFbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*skNoise(p);p=p*2.11+vec2(17.3,9.1);a*=.5;}return s;}
vec2 skyUV(vec3 d){
  float u=atan(d.x,d.z)/PI2+.5;
  float e=asin(clamp(d.y,-1.,1.))/PI_HALF;
  return vec2(u,.5+.5*sign(e)*pow(abs(e),.6667));
}
void main(){
  vec3 d=normalize(vWorld-cameraPosition);
  vec3 col=texture2D(skyLUT,skyUV(d)).rgb;
  float mu=dot(d,sunDir);
  // Ash banks low on the horizon: thick, slow, lit gold on the sun side and red from the lava underneath.
  float veil=0.;
  if(d.y>-.02&&clouds>0.){
    vec2 cp=d.xz/max(.07,d.y+.05)*.42+vec2(time*.006,time*.0025);
    float n=skFbm(cp*vec2(.55,1.))+.35*skFbm(cp*2.3+3.1);
    float band=smoothstep(-.01,.05,d.y)*(1.-smoothstep(.16,.5,d.y));
    float c=smoothstep(.02,.42,n)*band*clouds;
    float lit=pow(max(0.,mu*.5+.5),5.);
    float under=exp(-max(d.y,0.)*14.);
    vec3 cc=cloudDark+cloudLit*lit*(.6+.6*smoothstep(.2,.7,n))+lavaGlow*under*.35;
    col=mix(col,cc,c*.82);
    veil=c;
  }
  // A veiled sun: a soft disc the ash dims and reddens, no hard limb.
  float R=.016;
  float disc=smoothstep(cos(R*1.6),cos(R*.55),mu);
  col+=sunColor*disc*mix(1.3,.35,veil)*(1.-veil*.3);
  // The rest of the archipelago on the rim of the sea, hazed, a vent glowing on the tallest.
  vec2 rim=texture2D(rimMap,vec2(atan(d.x,d.z)/PI2+.5,.5)).rg;
  float e=asin(clamp(d.y,-1.,1.));
  if(e<rim.r){
    float depth=clamp((rim.r-e)/max(rim.r,.003),0.,1.);
    vec3 isle=mix(hazeColor*.62,hazeColor*.78,depth*.5);
    isle+=lavaGlow*rim.g*smoothstep(.75,0.,depth)*.9;
    col=mix(col,isle,smoothstep(0.,.0025,rim.r-e));
  }
  col*=exposure;
  // The last degree dissolves into the fog the lava sea already sits in, so no seam is drawn.
  col=mix(col,hazeColor,1.-smoothstep(-.012,.012,d.y));
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FOG_DENSITY = .0026;
/**
 * World V's view exposure (game.ts EMBER_VIEW). It opens the lit surfaces and the emitters; the dome and the fog divide
 * it back out so the sky keeps its own values and stays darker than the lava, the forges and the windows.
 */
export const EMBER_EXPOSURE = 1.75;

export class EmberSky {
  readonly baked: BakedEmberSky;
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  readonly sunDir: THREE.Vector3;
  /** Direct sun, linear: colour (max channel 1) and intensity for the DirectionalLight. */
  readonly sunColor = new THREE.Color('#ffbd84');
  readonly sunIntensity = 3.4;
  /**
   * HemisphereLight: a violet-grey fill from the smoke above and violet-grey from below, so shade sits at about
   * #3b3546 on screen and never goes black. The lava's warm bounce from below is the heat light's (emberSkyHeat.ts),
   * only within 15 m of lava.
   */
  readonly hemiSky = new THREE.Color('#9a94c0');
  readonly hemiGround = new THREE.Color('#3b3546');
  readonly hemiIntensity = 1.6;
  /** Mean horizon, linear. */
  readonly skyHorizon: THREE.Color;
  readonly envIntensity = .5;
  private readonly lut: THREE.DataTexture;
  private readonly rimTex: THREE.DataTexture;
  private env: THREE.Texture | null = null;
  private readonly exposure = 1 / EMBER_EXPOSURE;
  private readonly sunAz: number;
  constructor(opts: EmberSkyOptions = {}) {
    const b = this.baked = bakeEmberSky(opts);
    this.sunDir = new THREE.Vector3(...b.sunDir);
    this.sunAz = Math.atan2(b.sunDir[0], b.sunDir[2]);
    const mean = [0, 0, 0];
    for (let i = 0; i < LUT_W; i++) for (let c = 0; c < 3; c++) mean[c] += b.horizon[i * 3 + c] / LUT_W;
    this.skyHorizon = new THREE.Color().setRGB(mean[0], mean[1], mean[2], THREE.LinearSRGBColorSpace);
    const half = new Uint16Array(b.lut.length);
    for (let i = 0; i < b.lut.length; i++) half[i] = THREE.DataUtils.toHalfFloat(b.lut[i]);
    this.lut = new THREE.DataTexture(half, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
    this.lut.minFilter = this.lut.magFilter = THREE.LinearFilter;
    this.lut.wrapS = THREE.RepeatWrapping; this.lut.wrapT = THREE.ClampToEdgeWrapping;
    this.lut.colorSpace = THREE.NoColorSpace; this.lut.needsUpdate = true;
    const rim = new Uint16Array(RIM_W * 4);
    for (let i = 0; i < RIM_W; i++) { rim[i * 4] = THREE.DataUtils.toHalfFloat(b.rim[i * 2]); rim[i * 4 + 1] = THREE.DataUtils.toHalfFloat(b.rim[i * 2 + 1]); rim[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1); }
    this.rimTex = new THREE.DataTexture(rim, RIM_W, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    this.rimTex.minFilter = this.rimTex.magFilter = THREE.LinearFilter;
    this.rimTex.wrapS = THREE.RepeatWrapping; this.rimTex.colorSpace = THREE.NoColorSpace; this.rimTex.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      name: 'ember-sky', vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        skyLUT: { value: this.lut }, rimMap: { value: this.rimTex }, sunDir: { value: this.sunDir },
        sunColor: { value: new THREE.Color('#ffc890') }, exposure: { value: this.exposure }, time: { value: 0 },
        hazeColor: { value: this.skyHorizon.clone() }, cloudDark: { value: new THREE.Color('#2e2529') },
        cloudLit: { value: new THREE.Color('#7e4a2e') }, lavaGlow: { value: new THREE.Color('#ff5a1e') }, clouds: { value: 1 },
      },
    });
    this.material.addEventListener('dispose', () => { this.lut.dispose(); this.rimTex.dispose(); this.env?.dispose(); });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 20), this.material);
    this.mesh.name = 'ember-sky'; this.mesh.renderOrder = -100; this.mesh.frustumCulled = false;
  }
  /** Horizon radiance looking along (x, z), linear. */
  horizonToward(x: number, z: number, out: THREE.Color): THREE.Color {
    const f = (Math.atan2(x, z) / TAU + .5) * LUT_W - .5, i0 = Math.floor(f), t = f - i0, h = this.baked.horizon;
    const a = ((i0 % LUT_W) + LUT_W) % LUT_W, b = (a + 1) % LUT_W, k = this.exposure;
    return out.setRGB((h[a * 3] * (1 - t) + h[b * 3] * t) * k, (h[a * 3 + 1] * (1 - t) + h[b * 3 + 1] * t) * k, (h[a * 3 + 2] * (1 - t) + h[b * 3 + 2] * t) * k, THREE.LinearSRGBColorSpace);
  }
  /**
   * Fog colour for a camera looking along (x, z): the ash haze is the horizon in that direction, a little darker and
   * greyer than the glowing band itself so far rock fades into smoke rather than into light. The dome's lowest band
   * fades to the same colour.
   */
  fogColor(x: number, z: number, out: THREE.Color): THREE.Color {
    this.horizonToward(x, z, out);
    const l = out.r * .2126 + out.g * .7152 + out.b * .0722;
    out.lerp(this.tmpColor.setRGB(l, l * .96, l * 1.1, THREE.LinearSRGBColorSpace), .45).multiplyScalar(.7);
    this.material.uniforms.hazeColor.value.copy(out);
    return out;
  }
  /** FogExp2 density: thick along the ground, thin for a high camera looking down (the aerial view sees the island). */
  fogDensity(cameraY: number, lookY: number): number {
    return FOG_DENSITY * (1 - .62 * smooth(50, 150, cameraY) * smooth(.45, .85, -lookY));
  }
  /** Prefiltered environment from the same dome (built on first use; needs the renderer). */
  environment(renderer: THREE.WebGLRenderer): THREE.Texture {
    if (this.env) return this.env;
    const scene = new THREE.Scene(), mat = this.material.clone();
    // The environment lights surfaces, which take the view exposure like every other light: the dome at its own scale.
    mat.uniforms.clouds.value = .6; mat.uniforms.exposure.value = 1; mat.uniforms.hazeColor.value = this.skyHorizon.clone().multiplyScalar(.8);
    mat.uniforms.skyLUT.value = this.lut; mat.uniforms.rimMap.value = this.rimTex; mat.uniforms.sunDir.value = this.sunDir;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), mat); scene.add(dome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.env = pmrem.fromScene(scene, 0, .1, 100).texture;
    pmrem.dispose(); dome.geometry.dispose(); mat.dispose();
    return this.env;
  }
  update(time: number) { this.material.uniforms.time.value = time; }
  /**
   * Make `light` this sky's sun: colour, intensity and direction, with one fixed shadow box over the whole island. A
   * low sun lays the island along its bearing into a short box: wide across the sun, short along it.
   */
  attachSun(light: THREE.DirectionalLight, mapSize = 2048): void {
    light.color.copy(this.sunColor); light.intensity = this.sunIntensity; light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.target.position.set(0, 8, -12);
    light.position.copy(light.target.position).addScaledVector(this.sunDir, 230);
    const cam = light.shadow.camera;
    Object.assign(cam, { left: -150, right: 150, bottom: -78, top: 84, near: 40, far: 440 });
    cam.updateProjectionMatrix();
    light.shadow.bias = -.0003; light.shadow.normalBias = .1;
  }
  /** Bearing of the sun, radians (atan2(x, z)). */
  get sunAzimuth() { return this.sunAz; }
  private readonly tmpColor = new THREE.Color();
}
