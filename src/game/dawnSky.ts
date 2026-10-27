import * as THREE from 'three';

/*
 * Dawnharbor's stolen dawn: the sun held a few degrees over the eastern sea. One sky function (dawnSkyRadiance)
 * is baked once on the CPU into a small LUT, mirror-symmetric about the sun's bearing like snowSky.ts; the dome,
 * the sea's reflections, the fog, the sun and the hemisphere light all read the same numbers, so the dust glowing
 * gold over the east, the deep desert blue overhead and the dusty rose band opposite the sun (the Belt of Venus
 * over the Earth's blue shadow) are one sky everywhere. The dome adds the solar disc with its halo and a few lit
 * cumulus on the shader side.
 */

const LUT_W = 64;
const LUT_H = 64;

type V3 = [number, number, number];
/** sRGB hex to linear. */
const lin = (hex: number): V3 => {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// The palette, linear. Brightness is in the renderer's units before tone mapping. A desert sunrise: deep clear
// blue overhead, a band of dust glowing gold round the sun and dusty peach-rose round the back of the sky.
const ZENITH_AWAY = lin(0x234d8c), ZENITH_SUN = lin(0x3563a3);
const MID_AWAY = lin(0x7f9fc8), MID_SUN = lin(0xd9b994);
const HORIZON_AWAY = lin(0xd9c0a8), HORIZON_SUN = lin(0xffbf73);
const BELT = lin(0xedbca2), EARTH_SHADOW = lin(0x8f9cbc);

export interface DawnSkyOptions {
  /** Bearing of the sun, degrees: 0 faces +Z, 90 faces +X. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Overall sky brightness. */
  gain?: number;
}

/**
 * Sky radiance toward a direction given by its elevation (radians) and the cosine of its bearing from the sun's.
 * Linear RGB, renderer units. Pure, so tools can bake or probe it without a GPU.
 */
export function dawnSkyRadiance(elev: number, cosPhi: number, sunElev: number, gain = 1): V3 {
  const toward = sat(cosPhi * 0.5 + 0.5), t2 = toward * toward, t4 = t2 * t2;
  const e = Math.max(elev, 0);
  // Upper sky: violet-blue, a shade warmer toward the sun.
  const zen = mix3(ZENITH_AWAY, ZENITH_SUN, t2);
  const mid = mix3(MID_AWAY, MID_SUN, t4);
  let col = mix3(zen, mid, Math.exp(-e * 2.6));
  // The horizon band: gold under the sun, lilac grey round the back.
  const hor = mix3(HORIZON_AWAY, HORIZON_SUN, Math.pow(toward, 3.2));
  col = mix3(col, hor, Math.exp(-e * (7 + 5 * (1 - toward))));
  // Opposite the sun: the Belt of Venus over the Earth's blue shadow.
  const away = (1 - toward) * (1 - toward);
  const belt = Math.exp(-(((e - 0.13) / 0.075) ** 2)) * away * 0.55;
  col = mix3(col, BELT, belt);
  col = mix3(col, EARTH_SHADOW, Math.exp(-e * 38) * away * 0.55);
  // Forward glow round a low sun, wide and warm, brightest on the horizon.
  const mu = Math.cos(elev) * Math.cos(sunElev) * cosPhi + Math.sin(elev) * Math.sin(sunElev);
  const m = Math.max(0, mu), glow = 0.55 * Math.pow(m, 6) + 1.4 * Math.pow(m, 48);
  const sunTint = lin(0xffc27a);
  for (let c = 0; c < 3; c++) col[c] += sunTint[c] * glow * (0.6 + 0.4 * Math.exp(-e * 4));
  if (elev < 0) col = mix3(col, mix3(hor, EARTH_SHADOW, 0.3), smooth(0, -0.08, elev));
  return [col[0] * gain, col[1] * gain, col[2] * gain];
}

/** Texel row to elevation and back: rows crowd the horizon. */
const rowElevation = (v: number) => { const s = v * 2 - 1; return Math.sign(s) * s * s * Math.PI * 0.5; };

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vWorld=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}
`;

/** GLSL shared by the dome and the sea: the LUT lookup. Needs dawnSkyLUT and dawnSunDir. */
export const DAWN_SKY_GLSL = /* glsl */ `
uniform sampler2D dawnSkyLUT;
uniform vec3 dawnSunDir;
vec3 dawnSky(vec3 d){
  vec2 h=d.xz;float l=length(h);
  vec2 s=normalize(dawnSunDir.xz);
  float u=acos(clamp(l>1e-5?dot(h/l,s):1.,-1.,1.))/3.14159265;
  float e=asin(clamp(d.y,-1.,1.))/1.57079633;
  float v=.5+.5*sign(e)*sqrt(abs(e));
  return texture2D(dawnSkyLUT,vec2(u,v)*(1.-1./vec2(${LUT_W}.,${LUT_H}.))+.5/vec2(${LUT_W}.,${LUT_H}.)).rgb;
}
`;

const SKY_FRAGMENT = /* glsl */ `
${DAWN_SKY_GLSL}
uniform vec3 sunColor;
uniform float time;
uniform vec3 hazeColor;
uniform vec3 cloudShade;
uniform vec3 cloudLit;
varying vec3 vWorld;
vec2 dkHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float dkNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(dkHash(i)*2.-1.,f),b=dot(dkHash(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(dkHash(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(dkHash(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4+.5;}
#ifdef DAWN_LOW
const int DK_OCT=3;
#else
const int DK_OCT=4;
#endif
float dkFbm(vec2 p){float s=0.,a=.5;for(int i=0;i<DK_OCT;i++){s+=a*dkNoise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,-1.7);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vWorld-cameraPosition);
  vec3 col=dawnSky(d);
  float mu=dot(d,dawnSunDir);
  // The sun: a large soft disc (stylised, about 1.3 degrees) with a hot core and a halo.
  float r=acos(clamp(mu,-1.,1.));
  float disc=1.-smoothstep(.019,.024,r);
  col+=sunColor*(disc*9.+exp(-r*55.)*1.6+exp(-r*14.)*.45);
  // Cumulus over the sea, lit from below and the side by the low sun. Each cloud is lit where its edge faces the
  // sun (its density falls off that way) and sits in lavender shade where it thickens away from it.
  if(d.y>-.02){
    float y=max(d.y,0.)+.03;
    vec2 cp=d.xz/y*.42+vec2(time*.003,time*.0012);
    vec2 sdir=normalize(dawnSunDir.xz);
    vec2 wq=vec2(dkFbm(cp*.35+7.),dkFbm(cp*.35-3.))*1.3;
    float band=smoothstep(.0,.05,d.y)*(1.-smoothstep(.3,.7,d.y));
    float cover=mix(.8,.7,band);
    float base=dkFbm(cp*.8+wq);
    float dens=smoothstep(cover,cover+.16,base)*band;
    float ahead=smoothstep(cover,cover+.16,dkFbm((cp+sdir*.22)*.8+wq))*band;
    float lit=clamp(.55+(dens-ahead)*2.2,0.,1.);
    float toward=pow(max(0.,dot(normalize(d.xz+1e-5),sdir)*.5+.5),2.);
    vec3 shade=mix(cloudShade,cloudShade*1.25+cloudLit*.15,toward);
    vec3 cc=mix(shade,cloudLit*mix(.75,1.25,toward),lit*(.45+.55*toward));
    // Silver-gold rims where thin cloud lies across the sun.
    cc+=sunColor*dens*(1.-dens)*4.*pow(max(mu,0.),10.)*1.8;
    col=mix(col,cc,dens*.94);
    // Higher, thinner altocumulus flecks catching the first light.
    vec2 ap=d.xz/(d.y+.12)*1.5+vec2(time*.002,0.);
    float an=dkFbm(ap*1.3+vec2(9.,4.))*(.75+.25*sin(ap.x*5.+dkNoise(ap*2.)*3.));
    float alto=smoothstep(.64,.82,an)*smoothstep(.1,.3,d.y)*(1.-smoothstep(.6,.95,d.y))*.6*(1.-dens);
    col=mix(col,mix(cloudShade*1.3,cloudLit*1.15,.35+.65*toward),alto);
  }
  // The last degrees dissolve into the fog the far sea already sits in.
  col=mix(col,hazeColor,1.-smoothstep(-.012,.045,d.y));
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const toColor = (v: ArrayLike<number>, k = 1) => new THREE.Color().setRGB(v[0] * k, v[1] * k, v[2] * k, THREE.LinearSRGBColorSpace);

/** The baked dawn as a dome, plus the sun, hemisphere and fog colours read off the same sky. */
export class DawnSky {
  readonly sunDir: THREE.Vector3;
  readonly lut: THREE.DataTexture;
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  /** Direct sun hue (max channel 1) and its intensity. */
  readonly sunColor: THREE.Color;
  readonly sunIntensity: number;
  /** HemisphereLight colours at intensity 1: the sky over level ground, the warm bounce off sand and grass. */
  readonly hemiSky: THREE.Color;
  readonly hemiGround: THREE.Color;
  /** Mean horizon and zenith, for materials that fake a two-tone sky reflection. */
  readonly skyHorizon: THREE.Color;
  readonly skyZenith: THREE.Color;
  /** Uniforms the sea (and anything else that reflects this sky) shares with the dome. */
  readonly uniforms: { dawnSkyLUT: { value: THREE.DataTexture }; dawnSunDir: { value: THREE.Vector3 } };
  private readonly horizon: Float32Array;
  private readonly sunAz: THREE.Vector2;
  private readonly elevation: number;
  constructor(opts: DawnSkyOptions) {
    const az = THREE.MathUtils.degToRad(opts.azimuth), el = this.elevation = THREE.MathUtils.degToRad(opts.elevation), gain = opts.gain ?? 1;
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.sunAz = new THREE.Vector2(this.sunDir.x, this.sunDir.z).normalize();
    const data = new Uint16Array(LUT_W * LUT_H * 4);
    for (let j = 0; j < LUT_H; j++) {
      const e = rowElevation(j / (LUT_H - 1));
      for (let i = 0; i < LUT_W; i++) {
        const v = dawnSkyRadiance(e, Math.cos((i / (LUT_W - 1)) * Math.PI), el, gain), k = (j * LUT_W + i) * 4;
        data[k] = THREE.DataUtils.toHalfFloat(v[0]); data[k + 1] = THREE.DataUtils.toHalfFloat(v[1]);
        data[k + 2] = THREE.DataUtils.toHalfFloat(v[2]); data[k + 3] = THREE.DataUtils.toHalfFloat(1);
      }
    }
    const lut = this.lut = new THREE.DataTexture(data, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
    lut.minFilter = lut.magFilter = THREE.LinearFilter;
    lut.wrapS = lut.wrapT = THREE.ClampToEdgeWrapping;
    lut.colorSpace = THREE.NoColorSpace;
    lut.needsUpdate = true;
    // Horizon a breath above the sea per bearing, for the fog.
    this.horizon = new Float32Array(LUT_W * 3);
    const mean: V3 = [0, 0, 0];
    for (let i = 0; i < LUT_W; i++) {
      const v = dawnSkyRadiance(0.02, Math.cos((i / (LUT_W - 1)) * Math.PI), el, gain);
      this.horizon.set(v, i * 3);
      for (let c = 0; c < 3; c++) mean[c] += v[c] / LUT_W;
    }
    this.skyHorizon = toColor(mean);
    this.skyZenith = toColor(dawnSkyRadiance(Math.PI / 2, 1, el, gain));
    // Irradiance on level ground from the dome (cosine weighted), and the sun's beam after the long low air path.
    const up: V3 = [0, 0, 0];
    let wsum = 0;
    for (let j = 0; j < 24; j++) {
      const e = ((j + 0.5) / 24) * Math.PI / 2, w = Math.sin(e) * Math.cos(e);
      for (let i = 0; i < 32; i++) {
        const v = dawnSkyRadiance(e, Math.cos(((i + 0.5) / 32) * Math.PI), el, gain);
        for (let c = 0; c < 3; c++) up[c] += v[c] * w;
        wsum += w;
      }
    }
    for (let c = 0; c < 3; c++) up[c] /= wsum;
    // The beam of a sun a few degrees up: gold, the blue mostly scattered out of it.
    const beam = lin(0xffe0a2);
    this.sunColor = toColor(beam);
    this.sunIntensity = 5.6;
    // three.js HemisphereLight irradiance is the colour itself; the dome mean is about pi x radiance.
    // The dome's fill, its red pulled back, so shade on the sand reads cool blue-violet against the gold sun.
    this.hemiSky = toColor([up[0] * 0.75, up[1] * 1.45, up[2] * 1.6] as V3, 1);
    // Warm bounce off sunlit sand (albedo about 0.35), lit by the sun's beam and the sky.
    const albedo: V3 = [0.46, 0.33, 0.19], sunE = this.sunIntensity * Math.sin(el) * 1.6;
    this.hemiGround = toColor([0, 1, 2].map(c => albedo[c] * (beam[c] * sunE + up[c] * 1.3)) as V3, 1.6);
    this.uniforms = { dawnSkyLUT: { value: lut }, dawnSunDir: { value: this.sunDir } };
    const sunTint = lin(0xffd9a0);
    this.material = new THREE.ShaderMaterial({
      name: 'dawn-sky',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        ...this.uniforms,
        sunColor: { value: toColor(sunTint, gain) },
        time: { value: 0 },
        hazeColor: { value: this.skyHorizon.clone() },
        cloudShade: { value: toColor(lin(0xa7a6c6), gain * 0.95) },
        cloudLit: { value: toColor(lin(0xffbf98), gain * 1.5) },
      },
    });
    // World teardown disposes materials, not the textures in their uniforms.
    this.material.addEventListener('dispose', () => lut.dispose());
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(850, 48, 24), this.material);
    this.mesh.name = 'dawn-sky';
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }
  /** Horizon radiance looking along (x, z). */
  horizonToward(x: number, z: number, out: THREE.Color): THREE.Color {
    const l = Math.hypot(x, z), c = l > 1e-6 ? (x * this.sunAz.x + z * this.sunAz.y) / l : 1;
    const f = (Math.acos(Math.min(1, Math.max(-1, c))) / Math.PI) * (LUT_W - 1);
    const i = Math.min(LUT_W - 2, Math.floor(f)), t = f - i, h = this.horizon;
    return out.setRGB(h[i * 3] * (1 - t) + h[i * 3 + 3] * t, h[i * 3 + 1] * (1 - t) + h[i * 3 + 4] * t, h[i * 3 + 2] * (1 - t) + h[i * 3 + 5] * t, THREE.LinearSRGBColorSpace);
  }
  /**
   * Fog colour for a camera looking along (x, z): the sky's own horizon that way, its glow toward the sun rolled off
   * so distant hills hazed toward the east do not whiten. The dome's lowest band fades to the same colour.
   */
  fogColor(x: number, z: number, out: THREE.Color): THREE.Color {
    this.horizonToward(x, z, out);
    const l = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722, h = this.skyHorizon, knee = (h.r * 0.2126 + h.g * 0.7152 + h.b * 0.0722) * 1.3;
    if (l > knee) out.multiplyScalar((knee + (l - knee) / (1 + (l - knee) / knee)) / l);
    this.material.uniforms.hazeColor.value.copy(out);
    return out;
  }
  /** Fog density: a morning haze along the ground, thin straight down from high above. */
  fogDensity(cameraY: number, lookY: number): number {
    return FOG_DENSITY * (1 - 0.7 * smooth(50, 150, cameraY) * smooth(0.45, 0.85, -lookY));
  }
  update(time: number): void {
    this.material.uniforms.time.value = time;
  }
  /** Low quality: three cloud octaves and a 1024 shadow map. */
  setQuality(q: 'high' | 'low'): void {
    const low = q === 'low', m = this.material;
    if (('DAWN_LOW' in m.defines) === low) return;
    m.defines = low ? { DAWN_LOW: '' } : {};
    m.needsUpdate = true;
    const light = this.sunRig;
    if (light) { light.shadow.mapSize.setScalar(low ? 1024 : 2048); light.shadow.map?.dispose(); light.shadow.map = null; this.shadowTexel.set((2 * SHADOW_HALF) / light.shadow.mapSize.x, (light.shadow.camera.top - light.shadow.camera.bottom) / light.shadow.mapSize.y); }
  }
  /** Make `light` this sky's sun, with a shadow box that follows the player, wide across the sun and short along it. */
  attachSun(light: THREE.DirectionalLight, mapSize = 2048): void {
    light.color.copy(this.sunColor);
    light.intensity = this.sunIntensity;
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    const cam = light.shadow.camera, along = SHADOW_HALF * Math.max(0.2, this.sunDir.y);
    Object.assign(cam, { left: -SHADOW_HALF, right: SHADOW_HALF, bottom: -along - 26, top: along + 34, near: 1, far: SUN_DISTANCE + 150 });
    cam.updateProjectionMatrix();
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.16;
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
  get sunElevation() { return this.elevation; }
  private sunRig: THREE.DirectionalLight | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly shadowTexel = new THREE.Vector2(1, 1);
  private get sunRight() { return this._right ??= new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, this.sunDir).normalize(); }
  private get sunUp() { return this._up ??= new THREE.Vector3().crossVectors(this.sunDir, this.sunRight).normalize(); }
  private _right?: THREE.Vector3;
  private _up?: THREE.Vector3;
}

/** Morning haze along the ground (FogExp2 density). */
const FOG_DENSITY = 0.0024;
/** Half-width of the shadow box across the sun, metres. */
const SHADOW_HALF = 72;
/** How far up the sun ray the shadow camera sits: far enough for the citadel's towers to shade the climb. */
const SUN_DISTANCE = 180;
