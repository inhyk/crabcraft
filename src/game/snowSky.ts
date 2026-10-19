import * as THREE from 'three';

/*
 * Frostlight sky and the light that agrees with it. A port of SNOWFLOW's atmosphere (atmosphere.wgsl,
 * skyBake.fragment.wgsl, sky.fragment.wgsl and render/sky.js, MIT, Copyright (c) 2026 Maksymilian Dendura;
 * see NOTICE.md): Nishita single scattering with the isotropic multiple-scattering pass, the solved snow
 * bounce below the horizon, the pale optically thick horizon, the Kasten-Young reddened sun, the solar disc
 * with limb darkening and its aureole, wind-aligned cirrus and the twilight grade with stars.
 *
 * SNOWFLOW bakes on the GPU and projects SH; here the integral runs once on the CPU into a small LUT that is
 * mirror-symmetric about the sun's azimuth, and the same numbers give the sun, hemisphere, fog and ice colours.
 */

export interface SnowSkyOptions {
  /** Bearing of the sun, degrees: 0 faces +Z, 90 faces +X. */
  azimuth?: number;
  /** Degrees above the horizon. SNOWFLOW's look hangs on 5 to 15. */
  elevation?: number;
  /** SNOWFLOW's sunIntensity slider; the shared radiometric scale is this times 5.5. */
  intensity?: number;
  /** 0 neutral white, 1 the full reddening of a low sun. */
  warmth?: number;
  /** SNOWFLOW's nightAmount: grades the dome toward moonlit blue so the aurora reads, and lets stars in. */
  night?: number;
  /** Atmosphere units to this renderer's linear units (SNOWFLOW's own exposure is 0.105). */
  exposure?: number;
  /** Thin high cloud, 0..1. */
  cloud?: number;
  /** Direction the wind blows on the ground (x, z), so cirrus streaks run with the sastrugi. */
  wind?: [number, number];
}

const EARTH_R = 6360000;
const ATMOS_R = 6420000;
const H_RAYLEIGH = 8000;
const H_MIE = 1200;
const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6];
const BETA_M = 21e-6;
const MIE_G = 0.76;
const MS_BOOST = 1.5;
const SHADOW_FILL = 0.5;
const SUN_SCALE_BASE = 5.5;
/** Fresh snow reflects most of what hits it, slightly more at the blue end. */
const SNOW_ALBEDO = [0.83, 0.86, 0.91];
/** SNOWFLOW's moonlit grade. */
const NIGHT_TINT = [0.25, 0.38, 0.65];
/** LUT size: u is the azimuth away from the sun (0..PI, mirrored), v is sqrt-warped elevation. */
const LUT_W = 64;
const LUT_H = 96;

function raySphereFar(oy: number, dx: number, dy: number, dz: number, r: number, ox = 0, oz = 0): number {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const d = b * b - c;
  return d < 0 ? -1 : -b + Math.sqrt(d);
}

const phaseRayleigh = (mu: number) => (3 / (16 * Math.PI)) * (1 + mu * mu);
function phaseMie(mu: number, g: number): number {
  const g2 = g * g;
  return (3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * mu, 1.5));
}

/** nishitaSky() before the ground handover and the grazing desaturation. `out` gets linear radiance. */
function scatter(d: readonly number[], s: readonly number[], sunScale: number, out: number[]): void {
  const oy = EARTH_R + 800;
  const [dx, dy, dz] = d;
  const atmos = raySphereFar(oy, dx, dy, dz, ATMOS_R);
  out[0] = out[1] = out[2] = 0;
  if (atmos < 0) return;
  const bIn = oy * dy, discr = bIn * bIn - (oy * oy - EARTH_R * EARTH_R);
  let march = atmos;
  if (discr > 0) { const near = -bIn - Math.sqrt(discr); if (near > 0) march = near; }
  const STEPS = 32, LIGHT_STEPS = 8, DIST_POWER = 2.5;
  const mu = dx * s[0] + dy * s[1] + dz * s[2];
  const pr = phaseRayleigh(mu), pm = phaseMie(mu, MIE_G);
  const sumR = [0, 0, 0], sumM = [0, 0, 0], shadR = [0, 0, 0], shadM = [0, 0, 0];
  let odR = 0, odM = 0, tPrev = 0;
  for (let i = 0; i < STEPS; i++) {
    // Power-law steps: almost all scattering happens in the first kilometres of a grazing ray.
    const tNext = march * Math.pow((i + 1) / STEPS, DIST_POWER), step = tNext - tPrev;
    const t = tPrev + step * 0.5; tPrev = tNext;
    const px = dx * t, py = oy + dy * t, pz = dz * t;
    const h = Math.sqrt(px * px + py * py + pz * pz) - EARTH_R;
    const dR = Math.exp(-h / H_RAYLEIGH) * step, dM = Math.exp(-h / H_MIE) * step;
    odR += dR; odM += dM;
    const lStep = raySphereFar(py, s[0], s[1], s[2], ATMOS_R, px, pz) / LIGHT_STEPS;
    let lR = 0, lM = 0, occluded = false;
    for (let j = 0; j < LIGHT_STEPS; j++) {
      const k = lStep * (j + 0.5);
      const qx = px + s[0] * k, qy = py + s[1] * k, qz = pz + s[2] * k;
      const lh = Math.sqrt(qx * qx + qy * qy + qz * qz) - EARTH_R;
      if (lh < 0) { occluded = true; break; }
      lR += Math.exp(-lh / H_RAYLEIGH) * lStep;
      lM += Math.exp(-lh / H_MIE) * lStep;
    }
    for (let c = 0; c < 3; c++) {
      if (occluded) {
        // In the planet's shadow: no direct sun, but multiple scattering still reaches it.
        const a = Math.exp(-(BETA_R[c] * odR + BETA_M * 1.1 * odM));
        shadR[c] += a * dR; shadM[c] += a * dM;
      } else {
        const a = Math.exp(-(BETA_R[c] * (odR + lR) + BETA_M * 1.1 * (odM + lM)));
        sumR[c] += a * dR; sumM[c] += a * dM;
      }
    }
  }
  const msPhase = 1 / (4 * Math.PI);
  for (let c = 0; c < 3; c++) {
    out[c] = sunScale * (sumR[c] * BETA_R[c] * pr + sumM[c] * BETA_M * pm)
      + sunScale * ((sumR[c] + shadR[c] * SHADOW_FILL) * BETA_R[c] * MS_BOOST + (sumM[c] + shadM[c] * SHADOW_FILL) * BETA_M * 0.4) * msPhase;
  }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The tail of nishitaSky(): snow below the horizon, then the pale thick horizon band. */
function finish(col: number[], dy: number, groundBounce: readonly number[]): void {
  if (dy < 0) {
    const down = 1 - smooth(-0.03, -0.005, dy);
    for (let c = 0; c < 3; c++) col[c] += (groundBounce[c] - col[c]) * down;
  }
  const grazing = (1 - smooth(0, 0.26, Math.abs(dy))) * 0.82;
  const pale = col[0] * 0.3 + col[1] * 0.42 + col[2] * 0.28;
  const tint = [0.97, 1, 1.06];
  for (let c = 0; c < 3; c++) col[c] += (pale * tint[c] - col[c]) * grazing;
}

/** Texel row to elevation sine and back: rows crowd the horizon, where the sky changes fastest. */
const rowElevation = (v: number) => { const s = v * 2 - 1; return Math.sign(s) * s * s * Math.PI * 0.5; };

export interface BakedSky {
  /** Toward the sun. */
  sunDir: [number, number, number];
  /** Hue of direct sunlight, max channel 1. */
  sunColor: [number, number, number];
  /** Direct solar irradiance at the ground in atmosphere units (SNOWFLOW's sunRadiance). */
  sunRadiance: [number, number, number];
  sunScale: number;
  /** Radiance leaving the snow, atmosphere units. */
  groundBounce: [number, number, number];
  /** Sky irradiance on a level surface, graded, atmosphere units. */
  skyUp: [number, number, number];
  /** Graded horizon radiance per LUT column (azimuth from the sun 0..PI), aureole included. */
  horizon: Float32Array;
  /** Graded zenith radiance. */
  zenith: [number, number, number];
  /** LUT_W x LUT_H RGBA, ungraded, atmosphere units. */
  lut: Float32Array;
  width: number;
  height: number;
}

/** The whole atmosphere solve. Pure, so tools can run it without a GPU. */
export function bakeSnowSky(opts: SnowSkyOptions = {}): BakedSky {
  const az = THREE.MathUtils.degToRad(opts.azimuth ?? 42), el = THREE.MathUtils.degToRad(opts.elevation ?? 11);
  const night = opts.night ?? 0;
  const sunDir: [number, number, number] = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const sunScale = (opts.intensity ?? 4.2) * SUN_SCALE_BASE;
  // Kasten-Young air mass reddens the beam; vertical optical depths are SNOWFLOW's.
  const zenithDeg = THREE.MathUtils.radToDeg(Math.acos(sunDir[1]));
  const denom = Math.cos(Math.acos(sunDir[1])) + 0.50572 * Math.pow(Math.max(1e-3, 96.07995 - zenithDeg), -1.6364);
  const airMass = Math.min(denom > 0 ? 1 / denom : 40, 40), warm = opts.warmth ?? 1;
  const tauR = [0.0464, 0.108, 0.265], tauM = 0.0252;
  const tr = tauR.map(t => Math.exp(-(t * warm + tauM) * airMass));
  const sunRadiance = tr.map(t => t * sunScale) as [number, number, number];
  const m = Math.max(...tr) || 1;
  const sunColor = tr.map(t => t / m) as [number, number, number];

  // Raw scattering for every texel. The pass is mirror-symmetric about the sun's azimuth.
  const raw = new Float32Array(LUT_W * LUT_H * 3), col = [0, 0, 0], dir = [0, 0, 0];
  for (let j = 0; j < LUT_H; j++) {
    const e = rowElevation(j / (LUT_H - 1)), ce = Math.cos(e), se = Math.sin(e);
    for (let i = 0; i < LUT_W; i++) {
      const phi = az + (i / (LUT_W - 1)) * Math.PI;
      dir[0] = Math.sin(phi) * ce; dir[1] = se; dir[2] = Math.cos(phi) * ce;
      scatter(dir, sunDir, sunScale, col);
      raw.set(col, (j * LUT_W + i) * 3);
    }
  }
  const grade = (v: number[]) => { for (let c = 0; c < 3; c++) v[c] *= 1 + (NIGHT_TINT[c] - 1) * night; return v; };
  const sample = (i: number, j: number, gb: readonly number[]) => {
    const k = (j * LUT_W + i) * 3, v = [raw[k], raw[k + 1], raw[k + 2]];
    finish(v, Math.sin(rowElevation(j / (LUT_H - 1))), gb);
    return v;
  };
  // Sky irradiance on level snow from the upper hemisphere (exact, so the bounce needs no iteration).
  const skyUp: [number, number, number] = [0, 0, 0];
  for (let j = LUT_H / 2; j < LUT_H; j++) {
    const e0 = Math.max(0, rowElevation((j - 0.5) / (LUT_H - 1))), e1 = Math.min(Math.PI / 2, rowElevation((j + 0.5) / (LUT_H - 1)));
    const band = Math.sin(e1) - Math.sin(e0), cosW = Math.sin(rowElevation(j / (LUT_H - 1)));
    for (let i = 0; i < LUT_W; i++) {
      const w = (i === 0 || i === LUT_W - 1 ? 0.5 : 1) * (2 * Math.PI / (LUT_W - 1)) * band * cosW;
      const v = grade(sample(i, j, [0, 0, 0]));
      for (let c = 0; c < 3; c++) skyUp[c] += v[c] * w;
    }
  }
  const groundBounce = SNOW_ALBEDO.map((a, c) => a * (sunRadiance[c] * Math.max(0, sunDir[1]) + skyUp[c]) / Math.PI) as [number, number, number];
  const lut = new Float32Array(LUT_W * LUT_H * 4);
  for (let j = 0; j < LUT_H; j++) for (let i = 0; i < LUT_W; i++) {
    const v = sample(i, j, groundBounce);
    lut.set([v[0], v[1], v[2], 1], (j * LUT_W + i) * 4);
  }
  // Horizon a breath above the sea, where the fogged far field meets the dome, with the aureole the dome adds.
  const horizon = new Float32Array(LUT_W * 3), jH = LUT_H / 2;
  for (let i = 0; i < LUT_W; i++) {
    const phi = (i / (LUT_W - 1)) * Math.PI, mu = Math.max(0, Math.cos(el) * Math.cos(phi));
    const v = sample(i, jH, groundBounce), glow = sunScale * Math.pow(mu, 64) * 0.28 * 0.5 * (1 - night);
    for (let c = 0; c < 3; c++) v[c] += sunColor[c] * glow;
    horizon.set(grade(v), i * 3);
  }
  const zenith = grade(sample(0, LUT_H - 1, groundBounce)) as [number, number, number];
  return { sunDir, sunColor, sunRadiance, sunScale, groundBounce, skyUp, horizon, zenith, lut, width: LUT_W, height: LUT_H };
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
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunScale;
uniform float exposure;
uniform float night;
uniform float time;
uniform vec2 windDir;
uniform float cloudAmount;
uniform vec3 hazeColor;
varying vec3 vWorld;
#include <common>
vec2 skHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float skNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(skHash22(i)*2.-1.,f),b=dot(skHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(skHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(skHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
float skFbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*skNoise(p);p=p*2.13+vec2(17.3,9.1);a*=.52;}return s;}
// The LUT is mirrored about the sun's azimuth and its rows crowd the horizon.
vec2 skyUV(vec3 d){
  vec2 h=d.xz;float l=length(h);
  vec2 s=normalize(sunDir.xz);
  float u=acos(clamp(l>1e-5?dot(h/l,s):1.,-1.,1.))/PI;
  float e=asin(clamp(d.y,-1.,1.))/PI_HALF;
  float v=.5+.5*sign(e)*sqrt(abs(e));
  return vec2(u,v)*(1.-1./vec2(${LUT_W}.,${LUT_H}.))+.5/vec2(${LUT_W}.,${LUT_H}.);
}
void main(){
  vec3 d=normalize(vWorld-cameraPosition);
  vec3 col=texture2D(skyLUT,skyUV(d)).rgb;
  // In atmosphere units from here to the grade; the LUT already carries the exposure.
  vec3 add=vec3(0.);
  // Solar disc, 0.53 degrees with limb darkening, and the aureole that warms a low sun's horizon.
  float mu=dot(d,sunDir);
  const float R=.0046;
  if(mu>cos(R)){float r=sqrt(max(0.,1.-mu*mu))/R;float limb=pow(max(0.,1.-r*r*.72),.42);add+=sunColor*sunScale*42.*limb*(1.-night);}
  float aureole=pow(max(0.,mu),1400.)*5.5+pow(max(0.,mu),64.)*.28;
  add+=sunColor*sunScale*aureole*.5*(1.-night);
  col+=add*exposure;
  // Cirrus: thin, high and wind-aligned, only there so the upper sky is not a flat wash.
  if(cloudAmount>.001&&d.y>0.){
    vec2 cp=d.xz*(1./max(.06,d.y))*.5+windDir*time*.004;
    float a=atan(windDir.x,windDir.y);float ca=cos(a),sa=sin(a);
    cp=mat2(ca,sa,-sa,ca)*cp;cp.x*=.28;
    float cloud=smoothstep(.06,.34,skFbm(cp));
    cloud*=smoothstep(0.,.22,d.y)*(1.-smoothstep(.55,1.,d.y)*.45)*cloudAmount;
    float lit=pow(max(0.,mu*.5+.5),3.);
    vec3 cc=mix(vec3(.52,.60,.74),sunColor*1.35,lit*.75)*(.55+sunScale*.06)*exposure;
    col=mix(col,cc,cloud*.62);
  }
  col*=mix(vec3(1.),vec3(.25,.38,.65),night);
  // Stars come in with the twilight grade.
  if(d.y>.025&&night>.001){
    vec2 uv=vec2(atan(d.x,d.z)/PI2+.5,acos(clamp(d.y,-1.,1.))/PI);
    vec2 cell=floor(uv*vec2(1100.,550.));
    float seed=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
    vec2 pt=fract(uv*vec2(1100.,550.))-.5;
    float star=(1.-smoothstep(.035,.21,length(pt)))*step(.991,seed);
    col+=vec3(3.5,5.,7.)*exposure*star*(.8+.2*sin(time*1.4+seed*500.))*night*smoothstep(.03,.2,d.y);
  }
  // The last degrees dissolve into the fog the far field already sits in, so no seam is drawn.
  col=mix(col,hazeColor,1.-smoothstep(-.01,.05,d.y));
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const toColor = (v: ArrayLike<number>, k: number, o = 0) => new THREE.Color().setRGB(v[o] * k, v[o + 1] * k, v[o + 2] * k, THREE.LinearSRGBColorSpace);

/** The baked sky as a dome, plus the sun, ambient, fog and ice colours read off the same atmosphere. */
export class SnowSky {
  readonly baked: BakedSky;
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  /** Direct sun, linear, renderer units: what a DirectionalLight's colour times intensity should be. */
  readonly sunLight: THREE.Color;
  readonly sunDir: THREE.Vector3;
  /** HemisphereLight colours at intensity 1: the graded sky over level snow, and the snow bounce from below. */
  readonly hemiSky: THREE.Color;
  readonly hemiGround: THREE.Color;
  /** Mean horizon and zenith for the ice's two-tone env(), and the bounce it sees below. */
  readonly skyHorizon: THREE.Color;
  readonly skyZenith: THREE.Color;
  readonly snowBounce: THREE.Color;
  private readonly exposure: number;
  private readonly sunAz: THREE.Vector2;
  constructor(opts: SnowSkyOptions = {}) {
    const b = this.baked = bakeSnowSky(opts);
    const k = this.exposure = opts.exposure ?? 0.105;
    const night = opts.night ?? 0;
    this.sunDir = new THREE.Vector3(...b.sunDir);
    this.sunAz = new THREE.Vector2(b.sunDir[0], b.sunDir[2]).normalize();
    this.sunLight = toColor(b.sunRadiance, k);
    // three.js irradiance from a HemisphereLight is mix(ground, sky) * intensity, diffuse is albedo / PI of it.
    this.hemiSky = toColor(b.skyUp, k);
    this.hemiGround = toColor(b.groundBounce, k * Math.PI);
    const mean = [0, 0, 0];
    for (let i = 0; i < b.width; i++) for (let c = 0; c < 3; c++) mean[c] += b.horizon[i * 3 + c] / b.width;
    this.skyHorizon = toColor(mean, k);
    this.skyZenith = toColor(b.zenith, k);
    this.snowBounce = toColor(b.groundBounce, k);
    const half = new Uint16Array(b.lut.length);
    for (let i = 0; i < b.lut.length; i++) half[i] = THREE.DataUtils.toHalfFloat(i % 4 === 3 ? 1 : b.lut[i] * k);
    const lut = new THREE.DataTexture(half, b.width, b.height, THREE.RGBAFormat, THREE.HalfFloatType);
    lut.minFilter = lut.magFilter = THREE.LinearFilter;
    lut.wrapS = lut.wrapT = THREE.ClampToEdgeWrapping;
    lut.colorSpace = THREE.NoColorSpace;
    lut.needsUpdate = true;
    const wind = new THREE.Vector2(...(opts.wind ?? [0.8, 0.6])).normalize();
    this.material = new THREE.ShaderMaterial({
      name: 'snowflow-sky',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        skyLUT: { value: lut },
        sunDir: { value: this.sunDir },
        sunColor: { value: new THREE.Color().setRGB(...b.sunColor, THREE.LinearSRGBColorSpace) },
        sunScale: { value: b.sunScale },
        exposure: { value: k },
        night: { value: night },
        time: { value: 0 },
        windDir: { value: wind },
        cloudAmount: { value: opts.cloud ?? 0.55 },
        hazeColor: { value: this.skyHorizon.clone() },
      },
    });
    // World teardown disposes materials, not the textures in their uniforms.
    this.material.addEventListener('dispose', () => lut.dispose());
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 20), this.material);
    this.mesh.name = 'snowflow-sky';
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }
  /** Graded horizon radiance looking along (x, z), renderer units. */
  horizonToward(x: number, z: number, out: THREE.Color): THREE.Color {
    const l = Math.hypot(x, z), c = l > 1e-6 ? (x * this.sunAz.x + z * this.sunAz.y) / l : 1;
    const f = (Math.acos(Math.min(1, Math.max(-1, c))) / Math.PI) * (this.baked.width - 1);
    const i = Math.min(this.baked.width - 2, Math.floor(f)), t = f - i, h = this.baked.horizon, k = this.exposure;
    return out.setRGB(
      (h[i * 3] * (1 - t) + h[i * 3 + 3] * t) * k,
      (h[i * 3 + 1] * (1 - t) + h[i * 3 + 4] * t) * k,
      (h[i * 3 + 2] * (1 - t) + h[i * 3 + 5] * t) * k,
      THREE.LinearSRGBColorSpace,
    );
  }
  /**
   * Fog colour for a camera looking along (x, z): the sky's own horizon in that direction, so a fully hazed
   * surface and the sky beside it are the same number (SNOWFLOW's aerialInscatterSky). The dome's lowest band
   * fades to the same colour.
   */
  fogColor(x: number, z: number, out: THREE.Color): THREE.Color {
    this.horizonToward(x, z, out);
    // Toward the sun the horizon carries the whole Mie forward peak. The fog is a short path, where SNOWFLOW
    // would not use the far-field value yet, so its luminance rolls off above the mean horizon instead of
    // whitening every distant trunk; the dome above the haze band still draws the full glow.
    const l = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722, knee = this.hazeKnee;
    if (l > knee) out.multiplyScalar((knee + (l - knee) / (1 + (l - knee) / knee)) / l);
    this.material.uniforms.hazeColor.value.copy(out);
    return out;
  }
  /** Mean horizon luminance: the fog may reach twice this toward the sun. */
  private get hazeKnee() { const h = this.skyHorizon; return h.r * 0.2126 + h.g * 0.7152 + h.b * 0.0722; }
  update(time: number): void {
    this.material.uniforms.time.value = time;
  }
  /**
   * Make `light` this sky's sun: its radiance, its direction, and a shadow box that follows the player. A low
   * sun stretches texels along its bearing, so the box is wide across the sun and short along it.
   */
  attachSun(light: THREE.DirectionalLight, mapSize = 2048): void {
    const c = light.color.copy(this.sunLight), m = Math.max(c.r, c.g, c.b) || 1;
    c.multiplyScalar(1 / m);
    light.intensity = m;
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    const cam = light.shadow.camera, along = SHADOW_HALF * this.sunDir.y;
    Object.assign(cam, { left: -SHADOW_HALF, right: SHADOW_HALF, bottom: -along - 22, top: along + 30, near: 1, far: SUN_DISTANCE + 130 });
    cam.updateProjectionMatrix();
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.12;
    this.shadowTexel.set((2 * SHADOW_HALF) / mapSize, (cam.top - cam.bottom) / mapSize);
    this.sunRig = light;
    this.followSun(0, 0, 0);
  }
  /** Re-centre the shadow box on (x, y, z), snapped to whole texels so shadow edges do not crawl. */
  followSun(x: number, y: number, z: number): void {
    const light = this.sunRig;
    if (!light) return;
    const p = this.tmp.set(x, y, z), r = this.sunRight, u = this.sunUp, t = this.shadowTexel;
    const pr = Math.round(p.dot(r) / t.x) * t.x, pu = Math.round(p.dot(u) / t.y) * t.y, pf = p.dot(this.sunDir);
    light.target.position.copy(r).multiplyScalar(pr).addScaledVector(u, pu).addScaledVector(this.sunDir, pf);
    light.position.copy(light.target.position).addScaledVector(this.sunDir, SUN_DISTANCE);
  }
  private sunRig: THREE.DirectionalLight | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly shadowTexel = new THREE.Vector2(1, 1);
  /** The shadow camera's own axes: three.js aims it from the light with world +Y as up. */
  private get sunRight() { return this._right ??= new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, this.sunDir).normalize(); }
  private get sunUp() { return this._up ??= new THREE.Vector3().crossVectors(this.sunDir, this.sunRight).normalize(); }
  private _right?: THREE.Vector3;
  private _up?: THREE.Vector3;
}

/** Half-width of the shadow box across the sun, metres. */
const SHADOW_HALF = 70;
/** How far up the sun ray the shadow camera sits: far enough to catch trees on the slopes toward the sun. */
const SUN_DISTANCE = 170;
