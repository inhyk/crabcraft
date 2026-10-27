import * as THREE from 'three';
import {STAR_GRID} from '../sim/world/ground';
import {starGroundColor} from './world2Ground';
import {starTrailDistance} from './world2Settlement';
import {STAR_CRATER,starCoast,starSand} from './starFieldLayout';

/*
 * Starhaven's ground by moonlight: beach sand by the sea, meadow grass inland, packed earth in the town and along the
 * pilgrim trails, bare stone where the bluffs break off. The mesh is the gameplay height grid itself (one vertex per
 * STAR_GRID sample, so collision and picture agree); per vertex it carries the region's tint (starGroundColor) and how
 * sandy, grassy and worn the ground is. The shader paints the rest in world space from one small tileable noise
 * texture read at six scales, each turned a different way, so nothing repeats: broad lush and dry patches, clumps,
 * blades, pebbles, wind ripples on the sand and wet sand at the waterline, strata on the bluffs, scorched glassy
 * ground in the fallen star's crater. Detail fades to its mean before it can shimmer, and a few specks of star-moss
 * glow in the grass.
 */

const SIZE = 256;
/** Tileable noise, four channels: fbm, cellular F1 (pebbles), fine blade noise, cellular F2 - F1 (cracks). */
function noiseTexture(): THREE.DataTexture {
  const hash = (i: number, j: number, s: number) => {
    let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
  const wrap = (i: number, p: number) => ((i % p) + p) % p;
  // Periodic gradient noise with `p` cells across the texture.
  const grad = (x: number, y: number, p: number, s: number) => {
    const fx = x * p / SIZE, fy = y * p / SIZE, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10), qu = q(u), qv = q(v);
    const g = (i: number, j: number, dx: number, dy: number) => { const a = hash(wrap(ix + i, p), wrap(iy + j, p), s) * Math.PI * 2; return Math.cos(a) * dx + Math.sin(a) * dy; };
    const a = g(0, 0, u, v), b = g(1, 0, u - 1, v), c = g(0, 1, u, v - 1), d = g(1, 1, u - 1, v - 1);
    return a + (b - a) * qu + (c - a) * qv + (a - b - c + d) * qu * qv;
  };
  const fbm = (x: number, y: number, p0: number, oct: number, s: number) => { let sum = 0, amp = .5, p = p0; for (let i = 0; i < oct; i++) { sum += grad(x, y, p, s + i) * amp; amp *= .5; p *= 2; } return sum; };
  // Cellular: jittered points in a periodic grid of `p` cells.
  const cell = (x: number, y: number, p: number, s: number) => {
    const fx = x * p / SIZE, fy = y * p / SIZE, ix = Math.floor(fx), iy = Math.floor(fy);
    let f1 = 9, f2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j, px = cx + .1 + .8 * hash(wrap(cx, p), wrap(cy, p), s), py = cy + .1 + .8 * hash(wrap(cx, p), wrap(cy, p), s + 7);
      const d = Math.hypot(fx - px, fy - py);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return [f1, f2];
  };
  const data = new Uint8Array(SIZE * SIZE * 4);
  const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const o = (y * SIZE + x) * 4, [f1, f2] = cell(x, y, 24, 3);
    data[o] = u8(.5 + fbm(x, y, 4, 6, 11) * .95);
    data[o + 1] = u8(Math.min(1, f1 / .75));
    data[o + 2] = u8(.5 + (fbm(x, y, 64, 2, 23) * .7 + grad(x, y, 128, 31) * .3) * 1.1);
    data[o + 3] = u8(Math.min(1, (f2 - f1) / .5));
  }
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.name = 'starhaven-ground-noise'; t.needsUpdate = true;
  return t;
}

const GROUND_HEAD = /* glsl */ `
uniform sampler2D sgTex;
uniform float sgTime;
uniform float sgDetail;
varying vec3 vSgW;
varying vec3 vSgN;
varying vec3 vSgSoil;
// One texture, many scales: each read is turned and shifted so no two scales line up.
vec4 sgT(vec2 p,float s,float a){float c=cos(a),d=sin(a);return texture2D(sgTex,vec2(c*p.x-d*p.y,d*p.x+c*p.y)/s+a*3.7);}
float sgH(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
`;

const GROUND_COLOR = /* glsl */ `
vec2 sgP=vSgW.xz;
// The pixel's ground footprint: detail is faded to its mean before it is a pixel wide.
float sgFoot=length(fwidth(sgP));
float sgF1=1.-smoothstep(.05,.22,sgFoot),sgF2=1.-smoothstep(.012,.06,sgFoot),sgF3=1.-smoothstep(.004,.016,sgFoot);
float sgMacro=sgT(sgP,170.,.3).r,sgMacro2=sgT(sgP,61.,1.1).r,sgMid=sgT(sgP,14.,2.).r;
float sgFine=mix(.5,sgT(sgP,3.3,.7).r,sgF1);
vec4 sgClump=sgT(sgP,2.1,2.6);
float sgBlade=mix(.5,sgT(sgP,.47,1.9).b,sgF2),sgBlade2=mix(.5,sgT(sgP,.19,.9).b,sgF3);
vec3 sgNw=normalize(vSgN);
float sgSlope=1.-sgNw.y;
// Coverage, ragged at every scale so no edge follows a contour or the grid.
float sgSand=smoothstep(.35,.65,vSgSoil.x+(sgMid-.5)*.45+(sgFine-.5)*.3);
float sgWorn=smoothstep(.3,.7,vSgSoil.z+(sgMid-.5)*.5+(sgFine-.5)*.35);
float sgGrass=smoothstep(.38,.62,vSgSoil.y+(sgMacro2-.5)*.35+(sgFine-.5)*.4+(sgClump.g-.5)*.25*sgF1)*(1.-sgSand)*(1.-sgWorn*.85);
float sgRock=smoothstep(.36,.55,sgSlope+(sgMid-.5)*.25);
// Crater: scorched, glassy and cracked inside, ash thrown out round the rim.
float sgCd=length(sgP-vec2(${STAR_CRATER.x.toFixed(1)},${STAR_CRATER.z.toFixed(1)}))/${STAR_CRATER.r.toFixed(1)};
float sgScorch=1.-smoothstep(.75,1.7,sgCd+(sgMid-.5)*.6+(sgFine-.5)*.3);
// Region tint (vertex colour) is the meadow's moonlit green, the sand's lavender grey or the town's earth.
vec3 sgTint=vColor.rgb;
// Meadow: broad lush and dry swathes, darker hollows, clumps and blades.
vec3 sgG=sgTint*(.78+.44*sgMacro);
sgG=mix(sgG,sgG*vec3(1.18,1.12,.82),smoothstep(.52,.72,sgMacro2)*.55);
sgG*=mix(1.,.62,smoothstep(.5,.78,sgMid)*.6);
sgG*=.8+.4*sgClump.r;
sgG*=.72+.56*sgBlade;sgG*=.86+.28*sgBlade2;
// Sand: pale and fine, rippled across the sea wind, darker and wet where the sea reaches it.
float sgRipPhase=dot(sgP,vec2(-.6,.8))*4.2+sgT(sgP,9.,.4).r*7.+sgFine*2.;
float sgRip=sin(sgRipPhase)*.5+.5;
vec3 sgS=vec3(.40,.385,.44)*(.86+.28*sgMid)*(.92+.16*sgFine);
sgS*=mix(1.,.9+.2*sgRip,sgF1);
float sgWet=1.-smoothstep(-.6,.55,vSgW.y+(sgMid-.5)*.5);
sgS=mix(sgS,sgS*vec3(.5,.52,.6),sgWet);
// Shells and pebbles on the strand.
float sgPeb=(1.-smoothstep(.1,.16,sgClump.g))*step(.62,sgH(floor(sgP/2.1*24.)))*sgF2;
sgS=mix(sgS,vec3(.62,.6,.64),sgPeb*.7);
// Packed earth: dark, gritty, pebbles worn flat.
vec3 sgE=vec3(.19,.172,.168)*(.8+.4*sgMid)*(.85+.3*sgFine);
float sgEPeb=(1.-smoothstep(.16,.26,sgClump.g))*sgF1;
sgE=mix(sgE,vec3(.3,.29,.31)*(.8+.4*sgClump.r),sgEPeb*.6);
sgE=mix(sgE,sgTint*.55,.25);
// Stone of the bluffs: dark slate in beds, a violet glint of crystal in the partings.
float sgBed=vSgW.y*1.7+sgT(sgP,23.,1.3).r*2.4;
float sgBedF=fract(sgBed);
vec3 sgR=vec3(.15,.15,.19)*(.7+.6*sgT(vec2(sgP.x+sgP.y,vSgW.y*3.),4.,.2).r)*(.86+.28*step(.5,fract(floor(sgBed)*.618)));
sgR*=1.-.45*(1.-smoothstep(.0,.08,sgBedF))*sgF1;
vec3 sgCol=sgE;
sgCol=mix(sgCol,sgS,sgSand);
sgCol=mix(sgCol,sgG,sgGrass);
sgCol=mix(sgCol,sgR,sgRock);
vec3 sgAsh=mix(vec3(.07,.06,.08),vec3(.03,.025,.04),smoothstep(.2,.9,1.-sgCd))*(.8+.4*sgFine);
sgCol=mix(sgCol,sgAsh,sgScorch);
// Far off, a whole meadow averages out: keep its broad patches, nothing finer.
diffuseColor.rgb=sgCol;
// Micro relief for the light: blades and clumps, ripples, pebbles, bedding, the crater's glassy cracks.
float sgRelief=sgGrass*((sgBlade-.5)*.02+(sgClump.r-.5)*.03)+sgSand*(1.-sgWet)*(sgRip-.5)*.022*sgF1+(1.-sgGrass)*(1.-sgSand)*(sgEPeb*.012+(sgFine-.5)*.01)+sgRock*smoothstep(0.,.1,sgBedF)*.06*sgF1;
float sgCrack=(1.-smoothstep(.02,.07,sgClump.a))*smoothstep(1.05,.55,sgCd)*sgF1;
sgRelief-=sgCrack*.03*sgScorch;
`;

const GROUND_ROUGH = /* glsl */ `
// Dew on the grass catches the moon, wet sand mirrors it, dry sand and earth are dull, the crater glass is slick.
roughnessFactor=mix(mix(mix(.92,.88,sgSand),.58+.18*sgClump.r,sgGrass),.74,sgRock);
roughnessFactor=mix(roughnessFactor,.28,sgWet*sgSand);
roughnessFactor=mix(roughnessFactor,.38,sgScorch*smoothstep(1.,.4,sgCd));
`;

const GROUND_NORMAL = /* glsl */ `
if(sgDetail>.5){
  // The relief's slope from screen derivatives, back into the ground plane.
  vec2 dpx=dFdx(sgP),dpy=dFdy(sgP);float dhx=dFdx(sgRelief),dhy=dFdy(sgRelief),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dhx*dpy.y-dhy*dpx.y,dpx.x*dhy-dpy.x*dhx)/det,-.8,.8):vec2(0.);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

const GROUND_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
if(sgDetail>.5){
  // Star-moss: a few glowing specks in the grass, teal or violet, each breathing on its own clock.
  vec2 cell=floor(sgP/.9);float r=sgH(cell),r2=sgH(cell+17.3);
  vec2 c=(cell+.2+.6*vec2(r,r2))*.9;float d=length(sgP-c);
  float on=step(.93,r)*sgGrass*(1.-sgWorn);
  float speck=on*(1.-smoothstep(.02,.06,d))*(.55+.45*sin(sgTime*(.6+r*1.3)+r2*40.))*sgF2;
  totalEmissiveRadiance+=mix(vec3(.12,.55,.5),vec3(.42,.22,.75),step(.5,r2))*speck*1.6;
  // Embers of the fallen star still glow in the crater's cracks.
  totalEmissiveRadiance+=vec3(.42,.2,.8)*sgCrack*sgScorch*(.55+.45*sin(sgTime*.7+sgMid*9.))*.8;
}
`;

export interface StarGround {
  mesh: THREE.Mesh;
  texture: THREE.DataTexture;
  update(time: number, quality: 'high' | 'low'): void;
}

/** The island's ground over the gameplay grid; `height` is the island surface (HiddenWorld.height). */
export function starGround(height: (x: number, z: number) => number, anisotropy: number): StarGround {
  const {nx, nz, step, minX, minZ} = STAR_GRID;
  const land = new THREE.PlaneGeometry((nx - 1) * step, (nz - 1) * step, nx - 1, nz - 1); land.rotateX(-Math.PI / 2);
  const pos = land.attributes.position, colors: number[] = [], soil: number[] = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = height(x, z);
    pos.setY(i, y); starGroundColor(x, z, y, c); colors.push(c.r, c.g, c.b);
    soil.push(...starSoil(x, z, y));
  }
  if (Math.abs(pos.getX(0) - minX) > 1e-6 || Math.abs(pos.getZ(0) - minZ) > 1e-6) throw new Error('starGround: mesh and grid disagree');
  land.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  land.setAttribute('aSoil', new THREE.Float32BufferAttribute(soil, 3));
  land.computeVertexNormals();
  const texture = noiseTexture(); texture.anisotropy = anisotropy;
  const uniforms = {sgTex: {value: texture}, sgTime: {value: 0}, sgDetail: {value: 1}};
  // `map` holds the noise for the anisotropy setting and disposal; the shader reads it itself.
  const material = new THREE.MeshStandardMaterial({map: texture, vertexColors: true, roughness: .9, metalness: 0});
  material.name = 'starhaven-night-ground';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSoil;\nvarying vec3 vSgW;\nvarying vec3 vSgN;\nvarying vec3 vSgSoil;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSgW=(modelMatrix*vec4(transformed,1.)).xyz;vSgN=normalize(mat3(modelMatrix)*objectNormal);vSgSoil=aSoil;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_HEAD}`)
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${GROUND_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GROUND_NORMAL}`)
      .replace('#include <emissivemap_fragment>', GROUND_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'starhaven-night-ground';
  const mesh = new THREE.Mesh(land, material); mesh.name = 'star-island-ground'; mesh.receiveShadow = true;
  return {mesh, texture, update(time, quality) { uniforms.sgTime.value = time; uniforms.sgDetail.value = quality === 'low' ? 0 : 1; }};
}

const smooth = THREE.MathUtils.smoothstep;
/** Per vertex: how sandy, how grassy and how worn the ground is (0..1 each). */
export function starSoil(x: number, z: number, y: number): [number, number, number] {
  const {r} = starCoast(x, z);
  const sand = Math.max(starSand(x, z), 1 - smooth(y, -.8, .9));
  const trail = 1 - smooth(starTrailDistance(x, z), 1.3, 3.6);
  const rect = (ax: number, bx: number, az: number, bz: number) => Math.hypot(Math.max(ax - x, 0, x - bx), Math.max(az - z, 0, z - bz));
  // Inside the town the ground is trodden earth with grass in the quiet corners; the arena's ring is bare.
  const town = 1 - smooth(rect(-50, 50, 6, 97), 0, 7), avenue = 1 - smooth(Math.abs(x), 6, 9.5) * 1;
  const arena = 1 - smooth(Math.hypot(x, z + 75), 22, 28);
  const crater = 1 - smooth(Math.hypot(x - STAR_CRATER.x, z - STAR_CRATER.z), STAR_CRATER.r * .9, STAR_CRATER.r * 1.6);
  const worn = Math.max(trail * .9, town * .55, avenue * (z > -100 && z < 105 ? .8 : 0), arena * .9, crater);
  const grass = Math.max(0, 1 - sand * 1.1 - smooth(r, .9, .95)) * (1 - town * .35) * (1 - arena) * (1 - crater * .8);
  return [sand, grass, worn];
}
