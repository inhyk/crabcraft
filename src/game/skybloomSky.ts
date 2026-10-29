import * as THREE from 'three';

/*
 * Skybloom's high-altitude late morning. One analytic sky (skybloomRadiance) is baked once on the CPU into a small
 * LUT, mirror-symmetric about the sun's bearing (the snowSky.ts / dawnSky.ts pattern); the dome, the cloud sea's far
 * field, the fog, the sun, the hemisphere light and the environment map all read the same numbers, so the deep blue
 * zenith, the pale haze at the horizon and the white sea of clouds below it are one sky everywhere. The dome adds the
 * sun's disc, wind-combed cirrus and a few sunlit cumulus towers rising out of the cloud sea on the shader side.
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

// The palette (style-w6.md), linear, renderer units before the tone map. Thin dry air: a saturated blue overhead,
// paling through cornflower to a cool white haze that sits on the cloud sea; a shade warmer under the sun.
const ZENITH = lin(0x2a64c8), ZENITH_SUN = lin(0x3172d2);
const MID = lin(0x6aa8ea), MID_SUN = lin(0x86b8ec);
const HORIZON = lin(0xd3e3f2).map(c => c * 1.22) as V3, HORIZON_SUN = lin(0xecf0ee).map(c => c * 1.22) as V3;
/** The cloud sea seen edge-on at the horizon: white toward the sun, lavender-blue in its own shade away from it. */
const SEA_SUN = lin(0xeef1f4), SEA_AWAY = lin(0xd4dcef);
const SUN_TINT = lin(0xfff2d6);

/**
 * Sky radiance toward a direction given by its elevation (radians) and the cosine of its bearing from the sun's.
 * Linear RGB, renderer units. Pure, so tools can bake or probe it without a GPU.
 */
export function skybloomRadiance(elev: number, cosPhi: number, sunElev: number, gain = 1): V3 {
  const toward = sat(cosPhi * 0.5 + 0.5), t2 = toward * toward, t4 = t2 * t2;
  const e = Math.max(elev, 0);
  let col = mix3(mix3(ZENITH, ZENITH_SUN, t2), mix3(MID, MID_SUN, t4), Math.exp(-e * 2.1));
  const hor = mix3(HORIZON, HORIZON_SUN, Math.pow(toward, 3));
  col = mix3(col, hor, Math.exp(-e * (9 + 4 * (1 - toward))));
  // Mie glow round the sun: tight and white, the air is too clean for a wide halo.
  const mu = Math.cos(elev) * Math.cos(sunElev) * cosPhi + Math.sin(elev) * Math.sin(sunElev);
  const m = Math.max(0, mu), glow = 0.12 * Math.pow(m, 6) + 0.9 * Math.pow(m, 64);
  for (let c = 0; c < 3; c++) col[c] += SUN_TINT[c] * glow;
  // Below the horizon lies the cloud sea, hazed to one colour per bearing.
  // Seen edge-on and far off, the sunlit sea is the whitest thing in the frame: brighter than the haze above it.
  if (elev < 0) { const sea = mix3(SEA_AWAY, SEA_SUN, Math.pow(toward, 1.6)), k = 1.35 + 0.1 * toward; col = mix3(col, [sea[0] * k, sea[1] * k, sea[2] * k], smooth(0, -0.025, elev)); }
  return [col[0] * gain, col[1] * gain, col[2] * gain];
}

/** Texel row to elevation and back: rows crowd the horizon. */
const rowElevation = (v: number) => { const s = v * 2 - 1; return Math.sign(s) * s * s * Math.PI * 0.5; };

/** GLSL shared by the dome and the cloud sea: the LUT lookup. Needs skyLUT and skySunDir. */
export const SKYBLOOM_SKY_GLSL = /* glsl */ `
uniform sampler2D skyLUT;
uniform vec3 skySunDir;
vec3 skybloomSky(vec3 d){
  vec2 h=d.xz;float l=length(h);
  vec2 s=normalize(skySunDir.xz);
  float u=acos(clamp(l>1e-5?dot(h/l,s):1.,-1.,1.))/3.14159265;
  float e=asin(clamp(d.y,-1.,1.))/1.57079633;
  float v=.5+.5*sign(e)*sqrt(abs(e));
  return texture2D(skyLUT,vec2(u,v)*(1.-1./vec2(${LUT_W}.,${LUT_H}.))+.5/vec2(${LUT_W}.,${LUT_H}.)).rgb;
}
`;

/** Shared 2D gradient noise for the sky's clouds. */
const NOISE_GLSL = /* glsl */ `
vec2 sbHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float sbNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(sbHash(i)*2.-1.,f),b=dot(sbHash(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(sbHash(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(sbHash(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4+.5;}
#ifdef SKY_LOW
const int SB_OCT=3;
#else
const int SB_OCT=5;
#endif
float sbFbm(vec2 p){float s=0.,a=.5;for(int i=0;i<SB_OCT;i++){s+=a*sbNoise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,-1.7);a*=.5;}return s;}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vWorld=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}
`;

/**
 * Cumulus towers rising out of the cloud sea along the horizon: bearing (rad, from +Z toward +X), top elevation
 * (rad), half-width (rad). Spread so most views have one in frame without crowding the world tree to the north.
 */
const TOWERS: readonly (readonly [number, number, number])[] = [
  [0.62, 0.075, 0.13], [1.55, 0.05, 0.1], [2.35, 0.095, 0.16], [3.45, 0.06, 0.11],
  [4.2, 0.085, 0.14], [5.05, 0.055, 0.12], [5.75, 0.07, 0.1],
];

const SKY_FRAGMENT = /* glsl */ `
${SKYBLOOM_SKY_GLSL}
${NOISE_GLSL}
uniform vec3 sunColor;
uniform float time;
uniform vec3 hazeColor;
uniform vec3 cloudShade;
uniform vec3 cloudLit;
uniform vec3 cloudDeep;
uniform vec3 towers[${TOWERS.length}];
varying vec3 vWorld;
void main(){
  vec3 d=normalize(vWorld-cameraPosition);
  vec3 col=skybloomSky(d);
  float mu=dot(d,skySunDir);
  // The sun: a small hot disc (about 0.9 degrees) with a tight white halo.
  float r=acos(clamp(mu,-1.,1.));
  col+=sunColor*((1.-smoothstep(.0075,.0095,r))*14.+exp(-r*70.)*1.1);
  vec2 sdir=normalize(skySunDir.xz);
  float toward=pow(max(0.,dot(normalize(d.xz+1e-5),sdir)*.5+.5),1.5);
  // High cirrus, combed by the wind: thin, bright, only where the blue is deep enough to show it.
  if(d.y>.04){
    vec2 cp=d.xz/(d.y+.1)*.9+vec2(time*.004,time*.0015);
    cp=mat2(.8,.6,-.6,.8)*cp;
    float streak=sbFbm(vec2(cp.x*.35,cp.y*2.6)+sbFbm(cp*.6)*1.2);
    float cir=smoothstep(.58,.86,streak)*smoothstep(.04,.25,d.y)*(1.-smoothstep(.65,.98,d.y)*.6);
    col=mix(col,mix(cloudShade*1.2,cloudLit*1.05,.55+.45*toward),cir*.55);
  }
  // Cumulus towers boiling up out of the cloud sea at the horizon: each the union of six round lumps of different
  // sizes (a cauliflower outline, taller in the middle) over a wide low dome, lit on the flank toward the sun and hazed
  // because they are tens of kilometres off. Every lump is a whole disc and the foot dissolves into the horizon haze
  // through noise, so no straight edge shows from any view (r4: the old lumps were columns with vertical sides and
  // read as rectangular cards).
  if(d.y>-.03&&d.y<.2){
    float az=atan(d.x,d.z);
    float inside=-1.,top=1.;vec2 nrm=vec2(0.,1.);
    for(int i=0;i<${TOWERS.length};i++){
      vec3 t=towers[i];
      float da=atan(sin(az-t.x),cos(az-t.x));
      if(abs(da)>t.z*1.5)continue;
      // The wide low dome the lumps stand on, flattened: its inside in the same (radian) units as the lumps'.
      vec2 qb=vec2(da/(t.z*1.08),d.y/(t.y*.42));
      float lb=length(qb),inb=(1.-lb)*t.y*.3;
      if(inb>inside){inside=inb;nrm=normalize(vec2(qb.x/(t.z*1.08),qb.y/(t.y*.42))+1e-6);top=t.y;}
      for(int j=0;j<6;j++){
        float fj=float(j),s1=fract(sin(fj*12.99+t.x*7.13)*43758.5),s2=fract(sin(fj*7.31+t.x*3.17)*24634.6);
        // Outer lumps low and wide, inner ones stacked higher and smaller.
        float ox=(s1-.5)*1.7*t.z*(1.-fj/7.);
        float r=t.z*(.26+.22*s2)*(1.-.25*fj/6.);
        float cy=max(r*.45,(t.y-r)*(1.-abs(ox)/(t.z*1.15)));
        vec2 q=vec2(da-ox,d.y-cy);
        float lq=length(q),inn=r-lq;
        if(inn>inside){inside=inn;nrm=lq>1e-5?q/lq:vec2(0.,1.);top=t.y;}
      }
    }
    float edge=.0045*(sbFbm(vec2(az*60.,d.y*90.)+3.)-.5)+.002*(sbFbm(vec2(az*190.,d.y*240.)+11.)-.5);
    float dens=smoothstep(-.0015,.003,inside+edge);
    // The foot sinks into the haze on a wavering line, never a level cut.
    dens*=smoothstep(-.012,.016,d.y+.012*(sbFbm(vec2(az*35.,1.7))-.5));
    if(dens>0.){
      vec3 across=vec3(cos(az),0.,-sin(az));
      vec3 n=normalize(across*nrm.x+vec3(0.,1.,0.)*nrm.y-d*.45);
      float bill=sbFbm(vec2(az*70.,d.y*110.)+7.);
      float lit=clamp(dot(n,skySunDir)*.7+.42+(bill-.5)*.5,0.,1.);
      vec3 cc=mix(cloudShade,cloudLit*mix(.92,1.08,toward),lit);
      // A shaded base: the lower fifth of each tower sits in its own shade.
      cc=mix(cc,cloudDeep,(1.-smoothstep(.0,top*.22,d.y))*.6);
      cc=mix(cc,hazeColor,.3);
      col=mix(col,cc,dens);
    }
  }
  // A haze band on the horizon itself; below it the dome is the far cloud sea (past the camera's far plane), as
  // bright as the sea's own far field so the two meet without a grey strip.
  col=mix(col,hazeColor,(1.-smoothstep(-.005,.065,d.y))*smoothstep(-.035,-.006,d.y)*.85);
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const toColor = (v: ArrayLike<number>, k = 1) => new THREE.Color().setRGB(v[0] * k, v[1] * k, v[2] * k, THREE.LinearSRGBColorSpace);

export interface SkybloomSkyOptions {
  /** Bearing of the sun, degrees: 0 faces +Z, 90 faces +X. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Overall sky brightness. */
  gain?: number;
}

/** The baked sky as a dome, plus the sun, hemisphere, fog, cloud and environment colours read off the same sky. */
export class SkybloomSky {
  readonly sunDir: THREE.Vector3;
  readonly lut: THREE.DataTexture;
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  /** Direct sun hue (max channel 1) and its intensity. */
  readonly sunColor: THREE.Color;
  readonly sunIntensity: number;
  /** HemisphereLight colours at intensity 1: the sky over level ground, and the cool bounce off grass and cloud. */
  readonly hemiSky: THREE.Color;
  readonly hemiGround: THREE.Color;
  /** Mean horizon and zenith, for materials that fake a two-tone sky reflection. */
  readonly skyHorizon: THREE.Color;
  readonly skyZenith: THREE.Color;
  /** The cloud sea's sunlit tops and its lavender shade, renderer units (lit by this sun and this sky). */
  readonly cloudLit: THREE.Color;
  readonly cloudShade: THREE.Color;
  /** The deep lanes between billows: bluer and darker than the flank shade (clear late-morning air, #9dc0e5 family). */
  readonly cloudDeep: THREE.Color;
  /** Uniforms anything that reflects or fades into this sky shares with the dome. */
  readonly uniforms: { skyLUT: { value: THREE.DataTexture }; skySunDir: { value: THREE.Vector3 } };
  /** scene.environmentIntensity while Skybloom is shown: glints and a little directional fill; the hemisphere does the rest. */
  readonly envIntensity = 0.22;
  private readonly horizon: Float32Array;
  private readonly sunAz: THREE.Vector2;
  private readonly elevation: number;
  private readonly gain: number;
  private env: THREE.Texture | null = null;
  constructor(opts: SkybloomSkyOptions) {
    const az = THREE.MathUtils.degToRad(opts.azimuth), el = this.elevation = THREE.MathUtils.degToRad(opts.elevation), gain = this.gain = opts.gain ?? 1;
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.sunAz = new THREE.Vector2(this.sunDir.x, this.sunDir.z).normalize();
    const data = new Uint16Array(LUT_W * LUT_H * 4);
    for (let j = 0; j < LUT_H; j++) {
      const e = rowElevation(j / (LUT_H - 1));
      for (let i = 0; i < LUT_W; i++) {
        const v = skybloomRadiance(e, Math.cos((i / (LUT_W - 1)) * Math.PI), el, gain), k = (j * LUT_W + i) * 4;
        data[k] = THREE.DataUtils.toHalfFloat(v[0]); data[k + 1] = THREE.DataUtils.toHalfFloat(v[1]);
        data[k + 2] = THREE.DataUtils.toHalfFloat(v[2]); data[k + 3] = THREE.DataUtils.toHalfFloat(1);
      }
    }
    const lut = this.lut = new THREE.DataTexture(data, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
    lut.minFilter = lut.magFilter = THREE.LinearFilter;
    lut.wrapS = lut.wrapT = THREE.ClampToEdgeWrapping;
    lut.colorSpace = THREE.NoColorSpace;
    lut.needsUpdate = true;
    // Horizon a breath above the cloud sea per bearing, for the fog.
    this.horizon = new Float32Array(LUT_W * 3);
    const mean: V3 = [0, 0, 0];
    for (let i = 0; i < LUT_W; i++) {
      const v = skybloomRadiance(0.015, Math.cos((i / (LUT_W - 1)) * Math.PI), el, gain);
      this.horizon.set(v, i * 3);
      for (let c = 0; c < 3; c++) mean[c] += v[c] / LUT_W;
    }
    this.skyHorizon = toColor(mean);
    this.skyZenith = toColor(skybloomRadiance(Math.PI / 2, 1, el, gain));
    // Irradiance on level ground from the dome (cosine weighted).
    const up: V3 = [0, 0, 0];
    let wsum = 0;
    for (let j = 0; j < 24; j++) {
      const e = ((j + 0.5) / 24) * Math.PI / 2, w = Math.sin(e) * Math.cos(e);
      for (let i = 0; i < 32; i++) {
        const v = skybloomRadiance(e, Math.cos(((i + 0.5) / 32) * Math.PI), el, gain);
        for (let c = 0; c < 3; c++) up[c] += v[c] * w;
        wsum += w;
      }
    }
    for (let c = 0; c < 3; c++) up[c] /= wsum;
    // A high sun in thin air: warm white (#fff2d6), barely reddened.
    this.sunColor = toColor(SUN_TINT);
    this.sunIntensity = 4.2;
    // three.js HemisphereLight irradiance is the colour itself; the dome mean is about pi x radiance. The fill keeps
    // its blue so shade reads blue-violet (#5a6a9a range) against the warm sun, never black or olive.
    this.hemiSky = toColor([up[0] * 7.6, up[1] * 4.1, up[2] * 1.35] as V3, 1);
    // From below: sunlit grass and cream stone bounce, warm green-gold (shade on undersides keeps the lit hue).
    this.hemiGround = toColor(lin(0xb3b07a), 0.6);
    // The cloud sea's three tones, set where SKY_VIEW's exposure, AgX look and grade (game.ts) put them on screen:
    // sunlit tops #f2f5fa, flank shade #b9c8e6, the deep lanes between billows #a4bde0 (style-w6.md, refs 6.5 / 9.6).
    // Solved back through that pipeline, so they stay right only while SKY_VIEW does.
    this.cloudLit = toColor([1.2, 1.3, 1.65]);
    this.cloudShade = toColor([0.363, 0.433, 0.725]);
    this.cloudDeep = toColor([0.271, 0.373, 0.656]);
    this.uniforms = { skyLUT: { value: lut }, skySunDir: { value: this.sunDir } };
    const towers = TOWERS.map(([a, h, w]) => new THREE.Vector3(a, h, w));
    this.material = new THREE.ShaderMaterial({
      name: 'skybloom-sky',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        ...this.uniforms,
        sunColor: { value: toColor(SUN_TINT, gain) },
        time: { value: 0 },
        hazeColor: { value: this.skyHorizon.clone() },
        cloudShade: { value: this.cloudShade.clone().multiplyScalar(1.05) },
        cloudLit: { value: this.cloudLit.clone().multiplyScalar(0.95) },
        cloudDeep: { value: this.cloudDeep.clone() },
        towers: { value: towers },
      },
    });
    // World teardown disposes materials, not the textures in their uniforms.
    this.material.addEventListener('dispose', () => { lut.dispose(); this.env?.dispose(); });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(850, 48, 24), this.material);
    this.mesh.name = 'skybloom-sky';
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }
  /**
   * Skybloom's own environment map (PMREM, built once): this sky above, the sunlit cloud sea below, so glazed tile,
   * gilt and water reflect a blue sky and white cloud instead of another world's sea. The sun's disc is left out
   * (the directional light draws its highlight).
   */
  environment(renderer: THREE.WebGLRenderer): THREE.Texture {
    if (this.env) return this.env;
    const W = 128, H = 64, data = new Uint16Array(W * H * 4), el = this.elevation;
    // Grass albedo (#6f8f5a) under this sun and sky: radiance = albedo x irradiance / pi.
    const grass = lin(0x6f8f5a), eGround = this.sunIntensity * Math.sin(el) + this.hemiSky.g;
    const bounce: V3 = [grass[0] * eGround / Math.PI, grass[1] * eGround / Math.PI, grass[2] * eGround / Math.PI];
    // Equirect: u is the bearing (three.js: u = atan(dir.z, dir.x) / 2pi + .5), v the elevation.
    for (let j = 0; j < H; j++) {
      const e = ((j + 0.5) / H - 0.5) * Math.PI;
      for (let i = 0; i < W; i++) {
        const phi = ((i + 0.5) / W - 0.5) * 2 * Math.PI, dx = Math.cos(phi), dz = Math.sin(phi);
        const cosb = dx * this.sunAz.x + dz * this.sunAz.y;
        let v = skybloomRadiance(e, cosb, el, this.gain);
        // Below the horizon an island object sees the meadow it stands on, not the cloud sea: sunlit grass bounce.
        // (A bright cloud floor here lit every downward leaf card white and washed the frame milky.)
        if (e < 0) v = mix3(v, bounce, smooth(-0.02, -0.3, e));
        const o = (j * W + i) * 4;
        data[o] = THREE.DataUtils.toHalfFloat(v[0]); data[o + 1] = THREE.DataUtils.toHalfFloat(v[1]);
        data[o + 2] = THREE.DataUtils.toHalfFloat(v[2]); data[o + 3] = THREE.DataUtils.toHalfFloat(1);
      }
    }
    const eq = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    eq.mapping = THREE.EquirectangularReflectionMapping; eq.colorSpace = THREE.LinearSRGBColorSpace;
    eq.minFilter = eq.magFilter = THREE.LinearFilter; eq.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer), rt = pmrem.fromEquirectangular(eq);
    pmrem.dispose(); eq.dispose();
    return (this.env = rt.texture);
  }
  /** Horizon radiance looking along (x, z). */
  horizonToward(x: number, z: number, out: THREE.Color): THREE.Color {
    const l = Math.hypot(x, z), c = l > 1e-6 ? (x * this.sunAz.x + z * this.sunAz.y) / l : 1;
    const f = (Math.acos(Math.min(1, Math.max(-1, c))) / Math.PI) * (LUT_W - 1);
    const i = Math.min(LUT_W - 2, Math.floor(f)), t = f - i, h = this.horizon;
    return out.setRGB(h[i * 3] * (1 - t) + h[i * 3 + 3] * t, h[i * 3 + 1] * (1 - t) + h[i * 3 + 4] * t, h[i * 3 + 2] * (1 - t) + h[i * 3 + 5] * t, THREE.LinearSRGBColorSpace);
  }
  /** Fog colour for a camera looking along (x, z): the sky's own horizon that way. The dome's lowest band fades to it. */
  fogColor(x: number, z: number, out: THREE.Color): THREE.Color {
    this.horizonToward(x, z, out);
    this.material.uniforms.hazeColor.value.copy(out);
    return out;
  }
  /** Fog density: clean high air; thinner still straight down from high above, so the aerial view stays crisp. */
  fogDensity(cameraY: number, lookY: number): number {
    return FOG_DENSITY * (1 - 0.6 * smooth(50, 150, cameraY) * smooth(0.45, 0.85, -lookY));
  }
  update(time: number): void {
    this.material.uniforms.time.value = time;
  }
  setQuality(q: 'high' | 'low'): void {
    const low = q === 'low', m = this.material;
    if (('SKY_LOW' in m.defines) === low) return;
    m.defines = low ? { SKY_LOW: '' } : {};
    m.needsUpdate = true;
  }
  get sunElevation() { return this.elevation; }
}

/**
 * Haze over everything but the cloud sea (FogExp2 density): about 6 percent at 200 m, so the town, the trees and
 * the hero isles keep their colour, half by the mid isles at 640 m, blue past a kilometre.
 */
const FOG_DENSITY = 0.0013;
