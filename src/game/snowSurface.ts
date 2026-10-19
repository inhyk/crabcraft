import * as THREE from 'three';
import type { SnowDeform } from './snowDeform';
import type { SnowSpray } from './snowSpray';
import type { Unit } from './unit';
import { addPatch } from '../world/materials';
import { SNOW_SURFACE_GLSL } from './snowTerrain';
import { SNOW_FAR_SHADOW_GLSL, type SnowFarShadow } from './snowFarShadow';

/*
 * The Frostlight snow material: the most important pixels in the world. Ports SNOWFLOW's snow.fragment.wgsl and
 * shading.wgsl (MIT, Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md) onto a MeshStandardMaterial whose
 * vertices the clipmap (snowTerrain.ts) has already placed.
 *
 * Normals are summed as slopes before they become a normal: the landform's slope read per pixel from the baked
 * ground, the footprint-filtered sastrugi, ripples and grain, and the footprint field; a generated grain map at
 * three tiling scales is folded in last (triplanar on steep faces). Lighting swaps Lambert for wrapped diffuse,
 * filters the sun's shadow wider than three.js does, adds back-scatter that survives in shadow, a narrow
 * grazing-only glint, and occlusion that darkens toward blue. Compression, ice and loose berm mass from the
 * footprint field are surface states, not separate materials.
 */

export interface SnowSurfaceOptions {
  /** Light the glints and back-scatter answer to. Its world direction and radiance are read every frame. */
  sun: THREE.DirectionalLight;
  /** The sky's horizon and zenith radiance, for the sky the snow reflects. */
  skyHorizon: THREE.Color;
  skyZenith: THREE.Color;
  /** Height relief of prints in the normal, 1 = true slope. */
  relief?: number;
  glints?: number;
  subsurface?: number;
  /** The island-wide sun shadow the snow falls back to past the live shadow box. */
  far?: SnowFarShadow;
}

/** Tileable grain: rounded crystals with dark crevices (SNOWFLOW detailBake). RG normal, B cavity. */
function grainTexture(size = 256): THREE.DataTexture {
  const h = new Float32Array(size * size), cav = new Float32Array(size * size);
  const hash = (x: number, y: number, s: number) => {
    let k = Math.imul(((x % s) + s) % s, 0x27d4eb2d) ^ Math.imul(((y % s) + s) % s, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
    k = Math.imul(k ^ (k >>> 15), 0x2c1b3c6d); k = Math.imul(k ^ (k >>> 12), 0x297a2d39); k ^= k >>> 15;
    return k >>> 0;
  };
  const layer = (cells: number, w: number, cw: number) => {
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const gx = (i + 0.5) / size * cells, gy = (j + 0.5) / size * cells, ix = Math.floor(gx), iy = Math.floor(gy);
      let best = 0, c = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const r = hash(ix + dx, iy + dy, cells);
        const cx = ix + dx + 0.25 + (r & 1023) / 1023 * 0.5, cy = iy + dy + 0.25 + (r >>> 10 & 1023) / 1023 * 0.5;
        const rad = 0.3 + (r >>> 20 & 255) / 255 * 0.26, d = Math.hypot(gx - cx, gy - cy) / rad;
        if (d < 1) { best = Math.max(best, Math.sqrt(1 - d * d) * (0.55 + (r >>> 28) / 15 * 0.45)); c = Math.min(c, 1 - (1 - d) * 0.5); }
      }
      h[j * size + i] += best * w; cav[j * size + i] += c * cw;
    }
  };
  layer(20, 1, 0.55); layer(45, 0.42, 0.3); layer(97, 0.17, 0.15);
  const data = new Uint8Array(size * size * 4), k = size * 0.045;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
    const dx = (at(i + 1, j) - at(i - 1, j)) * k, dy = (at(i, j + 1) - at(i, j - 1)) * k, l = Math.hypot(dx, dy, 1);
    data.set([(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, cav[j * size + i] * 255, 255], (j * size + i) * 4);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.name = 'frostlight-snow-grain';
  t.needsUpdate = true;
  return t;
}

const SURFACE_FRAGMENT_HEAD = /* glsl */ `
uniform vec3 snowSunDir;
uniform vec3 snowSunColor;
uniform vec3 snowSkyHorizon;
uniform vec3 snowSkyZenith;
uniform float snowPrintRelief;
uniform float snowGlintStrength;
uniform float snowScatterStrength;
uniform sampler2D snowGrain;
varying vec3 vSnowWorld;
varying vec4 vSnowInfo;
varying vec4 vSnowWind;
float snowWrapAmt=.32;
float snowSunVis=1.;
// Where the far shadow map is read (only past the live map's edge): this pixel and its landform normal.
vec3 snowFarW=vec3(0.),snowFarN=vec3(0.,1.,0.);
vec3 snowUnpack(vec2 rg){vec2 xy=rg*2.-1.;return vec3(xy,sqrt(max(0.,1.-dot(xy,xy))));}
// Reoriented normal mapping: the detail keeps the base's tilt.
vec3 snowRNM(vec3 base,vec3 detail){vec3 t=base+vec3(0.,0.,1.),u=detail*vec3(-1.,-1.,1.);return normalize(t*dot(t,u)-u*t.z);}
// Grain normal at one tiling scale; triplanar on steep faces so it never smears up a slope.
vec3 snowDetail(vec3 w,vec3 N,float scale,float steep,vec3 dx,vec3 dy){
  vec3 n=snowUnpack(textureGrad(snowGrain,w.xz*scale,dx.xz*scale,dy.xz*scale).xy);
  if(steep>.01){
    vec3 a=snowUnpack(textureGrad(snowGrain,w.xy*scale,dx.xy*scale,dy.xy*scale).xy);
    vec3 b=snowUnpack(textureGrad(snowGrain,w.zy*scale,dx.zy*scale,dy.zy*scale).xy);
    vec3 m=abs(N);n=normalize(mix(n,(a*m.z+b*m.x+n*m.y)/(m.x+m.y+m.z),steep));
  }
  return n;
}
// One octave of crystal facets: each world cell owns at most one jittered facet, nailed to the ground.
float snowGlintOctave(vec2 p,float cell,vec3 N,vec3 H,vec3 T,vec3 B,float sharp){
  vec2 id=floor(p/cell);
  vec2 r=sdHash22(id),r2=sdHash22(id+vec2(19.73,7.31));
  if(r2.x>.55)return 0.;
  vec2 c=(id+.5+(r-.5)*.72)*cell;
  float d=length(p-c)/(cell*.17);
  float disc=clamp(1.-d*d,0.,1.);
  if(disc<=0.)return 0.;
  float ang=r.y*6.2831853;
  vec3 facet=normalize(N+(T*cos(ang)+B*sin(ang))*(.10+r2.y*.24));
  return disc*pow(clamp(dot(facet,H),0.,1.),sharp);
}
// Only looking across the snow into a low sun; looking down it stays matte.
float snowGlints(vec2 p,vec3 N,vec3 V,vec3 L,float fp){
  vec3 H=normalize(V+L);
  vec3 up=abs(N.y)>.95?vec3(1.,0.,0.):vec3(0.,1.,0.);
  vec3 T=normalize(cross(up,N)),B=cross(N,T);
  float graze=pow(1.-clamp(dot(N,V),0.,1.),3.2);
  float nl=clamp(dot(N,L),0.,1.);
  float gate=graze*smoothstep(.02,.35,nl)*(1.-smoothstep(.55,.95,nl)*.55);
  if(gate<=.001)return 0.;
  float a=.052,b=.185,sum=0.;
  float fa=1.-smoothstep(a*.55,a*2.2,fp),fb=1.-smoothstep(b*.55,b*2.2,fp);
  if(fa>.001)sum+=snowGlintOctave(p,a,N,H,T,B,780.)*fa;
  #ifndef SNOW_LOW
  if(fb>.001)sum+=snowGlintOctave(p+vec2(53.1,17.9),b,N,H,T,B,1500.)*fb*1.35;
  #endif
  return sum*gate;
}
// Light that entered the snow and left toward the eye. Thin edges transmit brightly and wide; deep snow
// little, near straight through, and blue, because red is absorbed first.
vec3 snowSubsurface(vec3 N,vec3 L,vec3 V,float thickness){
  vec3 tint=mix(vec3(.94,.965,1.),vec3(.55,.72,1.),clamp(thickness,0.,1.));
  vec3 h=normalize(L+N*.28);
  float back=pow(clamp(dot(V,-h),0.,1.),mix(3.,9.,thickness))*mix(1.,.3,thickness);
  return tint*back;
}
`;

/** Wrapped diffuse in place of Lambert: snow's millimetre mean free path carries light past the terminator. */
const SNOW_DIRECT = /* glsl */ `
#undef RE_Direct
#define RE_Direct RE_Direct_Snow
void RE_Direct_Snow(const in IncidentLight directLight,const in vec3 geometryPosition,const in vec3 geometryNormal,const in vec3 geometryViewDir,const in vec3 geometryClearcoatNormal,const in PhysicalMaterial material,inout ReflectedLight reflectedLight){
  float nl=dot(geometryNormal,directLight.direction);
  // Energy-normalised, so a low sun still models the relief: it softens the terminator, it does not lift the field.
  float wrap=max(0.,(nl+snowWrapAmt)/((1.+snowWrapAmt)*(1.+snowWrapAmt)));
  reflectedLight.directSpecular+=saturate(nl)*directLight.color*BRDF_GGX(directLight.direction,geometryViewDir,geometryNormal,material)*material.multiScatteringCompensation;
  vec3 F=F_Schlick(material.specularColor,material.specularF90,saturate(dot(geometryViewDir,normalize(directLight.direction+geometryViewDir))));
  reflectedLight.directDiffuse+=wrap*directLight.color*BRDF_Lambert(material.diffuseContribution)*(1.-F);
  // The sun's own visibility, cast shadows included, for the terms added after lighting.
  if(dot(directLight.direction,normalize((viewMatrix*vec4(snowSunDir,0.)).xyz))>.9995)snowSunVis=dot(directLight.color,vec3(1.))/max(1e-5,dot(snowSunColor,vec3(1.)));
}
`;

/**
 * The sun's shadow on snow, filtered wider than three.js's five taps: ten hardware-compared taps on a rotated
 * Vogel disk 2.6 texels across. A low sun stretches every texel along its bearing, and the default filter leaves
 * that stair-stepping on the brightest, flattest surface in the frame.
 */
const SNOW_SHADOW = /* glsl */ `
#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS > 0
${SNOW_FAR_SHADOW_GLSL}
float snowGetShadow(sampler2DShadow shadowMap,vec2 shadowMapSize,float shadowIntensity,float shadowBias,float shadowRadius,vec4 shadowCoord){
  shadowCoord.xyz/=shadowCoord.w;shadowCoord.z+=shadowBias;
  if(shadowCoord.x<0.||shadowCoord.x>1.||shadowCoord.y<0.||shadowCoord.y>1.||shadowCoord.z>1.)return mix(1.,snowFarShadowAt(snowFarW,snowFarN),shadowIntensity);
  float radius=2.6/shadowMapSize.x,phi=interleavedGradientNoise(gl_FragCoord.xy)*PI2,s=0.;
  #ifdef SNOW_LOW
  const int TAPS=5;
  #else
  const int TAPS=10;
  #endif
  for(int i=0;i<TAPS;i++)s+=texture(shadowMap,vec3(shadowCoord.xy+vogelDiskSample(i,TAPS,phi)*radius,shadowCoord.z));
  // Hand over to the far map toward the shadow box's edge, so a wide view never shows where the live map ends.
  vec2 sb=min(shadowCoord.xy,1.-shadowCoord.xy);
  float live=smoothstep(0.,.08,min(sb.x,sb.y));s/=float(TAPS);
  if(live<1.)s=mix(snowFarShadowAt(snowFarW,snowFarN),s,live);
  return mix(1.,s,shadowIntensity);
}
#else
#define snowGetShadow getShadow
float snowFarShadowAt(vec3 w,vec3 n){return 1.;}
#endif
`;

const SNOW_STATE = /* glsl */ `
  vec3 sW=vSnowWorld;vec2 sXZ=sW.xz;
  vec3 sDx=dFdx(sW),sDy=dFdy(sW);
  // World size of this pixel, and its narrow axis (the one grazing views do not inflate).
  float sFoot=max(length(vec2(length(sDx.xz),length(sDy.xz))),1e-4);
  float sFootMin=max(min(length(sDx.xz),length(sDy.xz)),1e-4);
  float sKeep=vSnowInfo.y,sFineKeep=vSnowInfo.z,sSea=vSnowInfo.w;
  // The landform's slope per pixel from the bake, filtered to the pixel's own footprint.
  vec2 sGUV=snowGroundUV(sXZ),sGdx=dFdx(sGUV),sGdy=dFdy(sGUV);
  vec2 sGrad=snowGroundIn(sGUV)?textureGrad(snowGroundTex,sGUV,sGdx,sGdy).yz:vec2(0.);
  // Footprint field: depression, berm, compression, ice. The gradient's step widens with the pixel.
  vec4 sD=vec4(0.);vec2 sDG=vec2(0.);float sDepW=0.;
  float sFall=snowDeformFalloff(sXZ);
  if(sFall>.001){
    float texel=snowDeformSize/snowDeformRes,e=max(texel*2.,sFootMin*1.4),eu=e/snowDeformSize;
    vec2 uv=fract(sXZ/snowDeformSize);
    vec4 c=texture2D(snowDeformTex,uv),xa=texture2D(snowDeformTex,uv+vec2(eu,0.)),xb=texture2D(snowDeformTex,uv-vec2(eu,0.));
    vec4 za=texture2D(snowDeformTex,uv+vec2(0.,eu)),zb=texture2D(snowDeformTex,uv-vec2(0.,eu));
    sDG=vec2((xa.g-xa.r)-(xb.g-xb.r),(za.g-za.r)-(zb.g-zb.r))/(2.*e)*sFall*snowPrintRelief;
    float wide=clamp(sFootMin/(texel*4.),0.,1.)*.8;
    sD=mix(c,(c+xa+xb+za+zb)*.2,wide)*sFall;
    // How steeply the print wall falls here: its rim is where the occlusion and the broken crust sit.
    sDepW=clamp(length(vec2(xa.r-xb.r,za.r-zb.r))/(2.*e)*sFall*1.6,0.,1.);
  }
  float sComp=clamp(sD.b,0.,1.),sIce=clamp(sD.a,0.,1.),sLoose=clamp(sD.g*7.,0.,1.);
  // The village and the paving margins are trodden all winter.
  sComp=max(sComp,(1.-smoothstep(0.,.5,sKeep))*.28*(1.-sSea));
  vec3 sN0=normalize(vec3(-sGrad.x,1.,-sGrad.y));
  // Exposed rock: on the outcrops and the coast cliffs, gated by slope so snow keeps the flatter faces.
  float sCoast=smoothstep(.02,.18,sSea)*(1.-smoothstep(.8,.98,sSea));
  float sRock=sCoast*smoothstep(.30,.55,1.-sN0.y);
  // Wind-scoured blue ice on the frozen sea, in streaks along the wind.
  float sScour=0.;
  if(sSea>.5){vec2 q=vec2(dot(sXZ,SG_WIND),dot(sXZ,vec2(-SG_WIND.y,SG_WIND.x)));sScour=smoothstep(.12,.42,sgNoised(q*vec2(.012,.05)).x+.35*sgNoised(q*vec2(.05,.2)).x)*smoothstep(.5,1.,sSea);}
  sIce=max(sIce,sScour*.8);
  // Albedo sits in a high, slightly blue band and never reaches white.
  vec3 sAlb=vec3(.79,.86,.97);float sRough=.62,sThick=1.;
  sAlb=mix(sAlb,vec3(.6,.67,.79),sComp*.8);sRough=mix(sRough,.36,sComp);sThick=mix(sThick,.35,sComp);
  sAlb=mix(sAlb,vec3(.42,.57,.72),sIce*.8);sRough=mix(sRough,.08,sIce);sThick=mix(sThick,.15,sIce);
  if(sLoose>.001){
    // Broken, thrown snow at a berm: brighter, rougher, chunky.
    float chunk=sdNoise2(sXZ*34.)*.5+.5;
    sAlb=mix(sAlb,vec3(.84,.9,1.),sLoose*.55)*(1.-sLoose*.12*chunk);sRough=mix(sRough,.78,sLoose*.7);sThick=mix(sThick,1.,sLoose*.6);
  }
  if(sRock>.001){
    // Dark, cool rock with faint bedding and lichen-free mottling, projected from the side it faces.
    vec3 an=abs(sN0);
    float mottle=(sdNoise2(sW.xy*.9)*an.z+sdNoise2(sW.zy*.9)*an.x+sdNoise2(sXZ*.9)*an.y)/(an.x+an.y+an.z)*.5+.5;
    float bed=sin(sW.y*4.1+sdNoise2(sXZ*.21)*3.)*.5+.5;
    vec3 rc=mix(vec3(.045,.05,.06),vec3(.115,.12,.13),mottle*.75+bed*.25);
    sAlb=mix(sAlb,rc,sRock);sRough=mix(sRough,.86,sRock);sThick=mix(sThick,0.,sRock);
  }
  diffuseColor.rgb=sAlb;
  snowWrapAmt=mix(.32,.08,max(sComp*.6,sRock));
  snowFarW=sW;snowFarN=sN0;
`;

const SNOW_NORMAL = /* glsl */ `
  vec3 sN;
  {
    vec2 g=sGrad+sDG;
    vec3 f=snowFine(sXZ,sFoot,sFineKeep*(1.-sRock),sSea,1.,vSnowWind);
    g+=f.yz;
    // Broken crust at a print's rim: clumps, not a bevel.
    if(sLoose+sDepW>.01){vec3 cl=sgNoised(sXZ*26.);g+=cl.yz*.0028*(sLoose+sDepW)*(1.-smoothstep(.01,.05,sFoot));}
    sN=normalize(vec3(-g.x,1.,-g.y));
    float steep=smoothstep(.45,.85,1.-sN.y);
    vec3 acc=vec3(0.,0.,1.);
    float f0=1.-smoothstep(.003,.016,sFoot);
    #ifndef SNOW_LOW
    if(f0>.001)acc=snowRNM(acc,mix(vec3(0.,0.,1.),snowDetail(sW,sN,7.5,steep,sDx,sDy),f0));
    #endif
    float f1=1.-smoothstep(.016,.1,sFoot);
    if(f1>.001)acc=snowRNM(acc,mix(vec3(0.,0.,1.),snowDetail(sW,sN,1.7,steep,sDx,sDy),f1*.85));
    float f2=1.-smoothstep(.08,.6,sFoot);
    if(f2>.001)acc=snowRNM(acc,mix(vec3(0.,0.,1.),snowDetail(sW,sN,.31,steep,sDx,sDy),f2*.6));
    vec3 up=abs(sN.y)>.99?vec3(1.,0.,0.):vec3(0.,1.,0.);
    vec3 T=normalize(cross(up,sN)),B=cross(sN,T);
    float s=mix(.2,.1,sComp)*mix(1.,.4,sIce)+sRock*.5;
    sN=normalize(sN+(T*acc.x+B*acc.y)*s);
  }
  normal=normalize((viewMatrix*vec4(sN,0.)).xyz);
`;

const SNOW_AFTER = /* glsl */ `
  {
    vec3 sL=normalize(snowSunDir),sV=normalize(cameraPosition-vSnowWorld);
    // Sky the snow reflects, sharper and stronger on ice.
    vec3 R=reflect(-sV,sN);
    vec3 sky=mix(snowSkyHorizon,snowSkyZenith,smoothstep(0.,.6,R.y));
    float fr=pow(1.-clamp(dot(sN,sV),0.,1.),5.);
    outgoingLight+=sky*fr*mix(.05,.45,sIce)*(1.-sRock*.8)*(1.-sComp*.3)+sky*.05*sIce;
    // Back-scatter is only partly shadowed: light reaches a shaded drift lip through the snow.
    outgoingLight+=snowSunColor*diffuseColor.rgb*snowSubsurface(sN,sL,sV,sThick)*snowScatterStrength*(1.-sRock)*mix(.42,1.,snowSunVis);
    outgoingLight+=snowSunColor*snowGlints(sXZ,sN,sV,sL,sFoot)*snowGlintStrength*snowSunVis*(1.-sIce*.6)*(1.-sRock)*(1.-sComp*.5);
    // Occlusion scales everything and goes blue where it darkens, the way a hollow in snow does.
    float cav=textureGrad(snowGrain,sXZ*1.7,sDx.xz*1.7,sDy.xz*1.7).b;
    float ao=mix(1.,cav,.35*(1.-smoothstep(.02,.25,sFoot)))*(1.-clamp(sD.r*1.9,0.,1.)*.38)*(1.-sDepW*.22);
    outgoingLight*=ao*mix(vec3(1.),vec3(.55,.72,1.),(1.-ao)*.95);
  }
`;

/**
 * Patch the clipmap's snow material in place. Call the returned function once a frame before it draws.
 * The clipmap's vertex patch (SnowTerrain) must already be on the material; this adds the fragment side.
 */
export function applySnowSurface(material: THREE.MeshStandardMaterial, deform: SnowDeform, opts: SnowSurfaceOptions): () => void {
  const sunDir = new THREE.Vector3(0, 1, 0), sunColor = new THREE.Color();
  const grain = grainTexture();
  const uniforms = {
    ...deform.uniforms,
    snowSunDir: { value: sunDir },
    snowSunColor: { value: sunColor },
    snowSkyHorizon: { value: opts.skyHorizon },
    snowSkyZenith: { value: opts.skyZenith },
    snowPrintRelief: { value: opts.relief ?? 1.15 },
    snowGlintStrength: { value: opts.glints ?? 2.2 },
    snowScatterStrength: { value: opts.subsurface ?? 0.42 },
    snowGrain: { value: grain },
    ...(opts.far?.uniforms ?? { snowFarMap: { value: null }, snowFarMatrix: { value: new THREE.Matrix4() }, snowFarInfo: { value: new THREE.Vector4() } }),
  };
  const tmp = new THREE.Vector3();
  material.userData.snowSurface = uniforms;
  // The scene's environment map belongs to another world; the snow reflects this sky instead.
  material.envMapIntensity = 0;
  material.addEventListener('dispose', () => grain.dispose());
  const refresh = () => {
    opts.sun.getWorldPosition(sunDir);
    opts.sun.target.getWorldPosition(tmp);
    sunDir.sub(tmp).normalize();
    sunColor.copy(opts.sun.color).multiplyScalar(opts.sun.intensity);
  };
  addPatch(material, 'frostlight-snow-surface', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SNOW_SURFACE_GLSL}\n${SURFACE_FRAGMENT_HEAD}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${SNOW_DIRECT}`)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${SNOW_SHADOW}`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(/getShadow\( directionalShadowMap/g, 'snowGetShadow( directionalShadowMap'))
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SNOW_STATE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=sRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SNOW_NORMAL}`)
      .replace('#include <opaque_fragment>', `${SNOW_AFTER}\n#include <opaque_fragment>`);
  });
  refresh();
  return refresh;
}

const FEET = ['LM', 'RM', 'LR', 'RR'] as const;
/** `ux, uz` is the body at frame `seen`, `vx, vz` its smoothed ground velocity. */
interface FootState { nodes: THREE.Object3D[]; down: boolean[]; last: Float32Array; ux: number; uz: number; vx: number; vz: number; seen: number }
type LinkedRig = { linkNode?: (name: string) => THREE.Object3D };

/**
 * Turns walking crabs into brushes. A foot leaves one print when it touches down, and another only after it
 * has moved a stride while still down, so a sliding foot ploughs a groove instead of stamping every frame.
 * Each stamp also kicks powder into `spray`, so spray and prints always come from the same footfall.
 */
export class SnowFootfalls {
  private readonly state = new WeakMap<Unit, FootState | null>();
  private readonly p = new THREE.Vector3();
  private frame = 0;

  update(units: readonly Unit[], deform: SnowDeform, height: (x: number, z: number) => number, cx: number, cz: number, spray?: SnowSpray, dt = 1 / 60): void {
    const reach = deform.size * 0.42;
    this.frame++;
    for (const u of units) {
      if (!u.alive || u.hidden || !u.rig.root.visible) continue;
      const pos = u.pos;
      if (Math.abs(pos.x - cx) > reach || Math.abs(pos.z - cz) > reach) continue;
      let st = this.state.get(u);
      if (st === undefined) { st = this.bind(u); this.state.set(u, st); }
      if (!st) continue;
      // Body velocity from its own motion, so remote players, NPCs and knockbacks all count. A body that was
      // out of range last frame, or jumped faster than 30 m/s (a teleport), starts again from rest.
      if (dt > 1e-4) {
        const mx = (pos.x - st.ux) / dt, mz = (pos.z - st.uz) / dt, w = 1 - Math.exp(-dt * 10);
        if (st.seen !== this.frame - 1 || mx * mx + mz * mz > 900) { st.vx = 0; st.vz = 0; } else { st.vx += (mx - st.vx) * w; st.vz += (mz - st.vz) * w; }
      }
      st.ux = pos.x;
      st.uz = pos.z;
      st.seen = this.frame;
      const s = THREE.MathUtils.clamp(u.height, 0.5, 4);
      for (let i = 0; i < st.nodes.length; i++) {
        st.nodes[i].getWorldPosition(this.p);
        const ground = height(this.p.x, this.p.z);
        const contact = this.p.y - ground < 0.09 * s;
        if (contact) {
          const dx = this.p.x - st.last[i * 2], dz = this.p.z - st.last[i * 2 + 1];
          if (!st.down[i] || dx * dx + dz * dz > (0.2 * s) ** 2) {
            deform.brush({ x: this.p.x, z: this.p.z, radius: 0.11 * s, elongation: 1.3, yaw: u.yaw, depth: 0.09 * s, berm: 0.035 * s, compression: 0.55, roughness: 0.7, seed: (this.p.x * 7.13 + this.p.z * 3.71) % 97 });
            spray?.kick(this.p.x, ground, this.p.z, st.vx, st.vz, s, !st.down[i]);
            st.last[i * 2] = this.p.x;
            st.last[i * 2 + 1] = this.p.z;
          }
        }
        st.down[i] = contact;
      }
    }
  }

  private bind(u: Unit): FootState | null {
    const rig = u.rig as unknown as LinkedRig;
    if (typeof rig.linkNode !== 'function') return null;
    try {
      const nodes = FEET.map((f) => rig.linkNode!(`${f}_foot_tip_link`));
      return { nodes, down: nodes.map(() => true), last: new Float32Array(nodes.length * 2).fill(1e6), ux: u.pos.x, uz: u.pos.z, vx: 0, vz: 0, seen: -1 };
    } catch {
      return null;
    }
  }
}
