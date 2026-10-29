import * as THREE from 'three';
import type {LavaZone} from './emberLava';
import {EMBER_FISSURES,type EmberFeature} from './emberGroundLayout';
import {EMBER_DETAIL,EMBER_NOISE} from './emberNoise';

/*
 * Emberreach's ground: cool basalt and ash, so the crab, the enemies and the paths stand off it and every warm
 * thing on the island is light. One mesh (the old 2 m terrain grid on the exact gameplay heights) and one shader:
 * - basalt in broad value swells, ash drifted into the hollows of the hills and streaked by the wind, pumice gravel
 *   in patches, cooled pahoehoe sheets with ropes, cracked crust where the ground shrank;
 * - few glowing fissures (emberGroundLayout.ts), each with a dark crust lip and a soft halo on the ash;
 * - scorched, crazed ground glowing faintly in the cracks near the lava and down the shore to the molten sea;
 * - crystal light pooled on the ground, contact shade under rocks.
 * The fields that need distance (fissures, lava heat, contact shade, crystal light) are baked once into one RGBA8
 * map over the terrain; everything else is procedural from the world position, filtered by the pixel footprint.
 */

const RECT = {x0: -150, z0: -175, w: 300, h: 350};
const MAP = 512;
/** Fissure distance stored up to this many metres. */
const FISSURE_RANGE = 4;

/** Distance from (x, z) to segment ab. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
 const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
 return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Bakes the distance fields; each feature only visits the texels it reaches. */
function bakeGroundMap(zones: readonly LavaZone[], features: readonly EmberFeature[]) {
 const N = MAP, data = new Uint8Array(N * N * 4), sx = RECT.w / N, sz = RECT.h / N;
 const fis = new Float32Array(N * N).fill(FISSURE_RANGE), heat = new Float32Array(N * N), occ = new Float32Array(N * N), glow = new Float32Array(N * N);
 const visit = (x: number, z: number, reach: number, fn: (k: number, px: number, pz: number) => void) => {
  const i0 = Math.max(0, Math.floor((x - reach - RECT.x0) / sx)), i1 = Math.min(N - 1, Math.ceil((x + reach - RECT.x0) / sx));
  const j0 = Math.max(0, Math.floor((z - reach - RECT.z0) / sz)), j1 = Math.min(N - 1, Math.ceil((z + reach - RECT.z0) / sz));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * N + i, RECT.x0 + (i + .5) * sx, RECT.z0 + (j + .5) * sz);
 };
 for (const line of EMBER_FISSURES) for (let k = 1; k < line.length; k++) {
  const [ax, az] = line[k - 1], [bx, bz] = line[k];
  visit((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) / 2 + FISSURE_RANGE, (i, px, pz) => { fis[i] = Math.min(fis[i], segDist(px, pz, ax, az, bx, bz)); });
 }
 for (const zn of zones) visit(zn.x, zn.z, zn.radius + 10, (i, px, pz) => {
  const d = Math.hypot(px - zn.x, pz - zn.z) - zn.radius, t = Math.max(0, Math.min(1, 1 - d / 10));
  heat[i] = Math.max(heat[i], t * t * (3 - 2 * t));
 });
 for (const e of features) {
  const r = e.kind === 'arch' ? e.r + 1.5 : e.kind === 'charred' ? .9 : e.r, reach = r * .6 + 2.5;
  visit(e.x, e.z, r + reach, (i, px, pz) => {
   let d: number;
   if (e.kind === 'arch') { const s = Math.sin(e.yaw), c = Math.cos(e.yaw); d = segDist(px, pz, e.x - s * e.r, e.z - c * e.r, e.x + s * e.r, e.z + c * e.r) - 2; }
   else d = Math.hypot(px - e.x, pz - e.z) - r * .85;
   const t = Math.max(0, Math.min(1, 1 - d / reach));
   occ[i] = Math.max(occ[i], t * t * (e.kind === 'crystal' ? .35 : e.kind === 'charred' ? .45 : .75));
  });
  if (e.kind === 'crystal') {
   const reachG = 3 + e.r * 3.2;
   visit(e.x, e.z, reachG, (i, px, pz) => { const t = Math.max(0, 1 - Math.hypot(px - e.x, pz - e.z) / reachG); glow[i] = Math.min(1, glow[i] + t * t * (e.h > 3 ? 1 : .75)); });
  }
 }
 for (let i = 0; i < N * N; i++) {
  data[i * 4] = Math.round(fis[i] / FISSURE_RANGE * 255);
  data[i * 4 + 1] = Math.round(heat[i] * 255);
  data[i * 4 + 2] = Math.round((1 - occ[i]) * 255);
  data[i * 4 + 3] = Math.round(glow[i] * 255);
 }
 const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
 tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false;
 tex.name = 'ember-ground-fields'; tex.needsUpdate = true;
 return tex;
}

const HEAD = /* glsl */ `
uniform sampler2D egMap;
uniform vec4 egRect;
uniform float egDetail;
uniform float egTime;
varying vec3 vEgW;
${EMBER_NOISE}
`;

const COLOR = /* glsl */ `
vec2 egP=vEgW.xz;
vec2 egDpx=dFdx(egP),egDpy=dFdy(egP);
float egFoot=length(abs(egDpx)+abs(egDpy));
float egNear=1.-smoothstep(.03,.12,egFoot);
// Baked fields: fissure distance (m), lava heat, contact shade, crystal light.
vec2 egWarp=vec2(egNoise(egP*.9),egNoise(egP*.9+5.2))*.35+vec2(egNoise(egP*3.1),egNoise(egP*3.1-2.))*.08;
vec4 egM=texture2D(egMap,(egP+egWarp-egRect.xy)*egRect.zw);
float egFd=egM.r*${FISSURE_RANGE.toFixed(1)},egCrys=egM.a,egAo=egM.b;
// The shore heats up toward the molten sea (the island's ellipse, as ground.ts shapes it).
float egEdge=length(vec2(egP.x/128.,(egP.y-2.)/155.));
float egShore=smoothstep(.79,.9,egEdge+egNoise(egP*.08)*.02);
float egHeat=max(egM.g,egShore);
// Large scale: value swells over the basalt.
float egN1=egFbm(egP*.021+1.3),egN2=egFbm(egP*.073-4.1),egN3=egNoise(egP*.31+9.);
// Ash lies in the hills' hollows (ground.ts: sin(x .047) sin(z .035)) and in wind streaks running east-west.
float egHill=sin(egP.x*.047)*sin(egP.y*.035)*(1.-exp(-egP.x*egP.x/900.));
float egStreak=egNoise(vec2(egP.x*.07,egP.y*.19)+3.)*.5+.5;
float egAshF=-egHill*.45+egN2*.45+egStreak*.22+.2+egN3*.1+egNoise(egP*.9)*.09+egNoise(egP*2.7)*.05;
float egAsh=smoothstep(.52,.565,egAshF)*.85+smoothstep(.565,.8,egAshF)*.15;
// Ash settles only where the face looks up, and in patches: dark basalt shows between the drifts, so no field reads
// as one pale sheet (one did, and World V read as World IV's snow at dusk).
float egUp=smoothstep(.93,.99,inverseTransformDirection(normalize(vNormal),viewMatrix).y);
// Built from the swells' own noise (no extra octaves): ash on the high swells, so the low dark basalt shows between.
float egPatch=smoothstep(-.12,.2,egN1*.55+egN2*.5+egN3*.14)*egUp;
egAsh*=.3+.7*egPatch;
// Wind ripples on the drifts, crests running north-south.
float egRip=sin(egP.x*5.1+egNoise(egP*.7)*4.+egNoise(egP*2.3)*.8)*.5+.5;
egAsh*=1.-egHeat*.85;
// Cooled pahoehoe sheets: dark, smoother, with rope folds bowed downhill (south); none under the ash.
float egSheet=smoothstep(.05,.22,egFbm(egP*.017+17.)-.08)*(1.-egAsh)*(1.-egShore);
// Clinker (a'a) fields: rubbly blocks with dark gaps, where the sheets broke up.
float egAaM=smoothstep(.15,.55,egNoise(egP*.045+31.)+egNoise(egP*.4)*.12)*(1.-egSheet)*(1.-egAsh*.9)*(1.-egShore);
vec3 egAaC=egCells(egP*2.7+egWarp*2.);
float egAa=smoothstep(.02,.16+egFoot*.5,egAaC.x+egNoise(egP*9.)*.04);
float egRopeU=egP.y*1.35+sin(egP.x*.23+egN3*2.)*2.4+egFbm(egP*.12)*3.;
float egRope=(sin(egRopeU*6.2832)*.5+.5);
// Cracked crust where the ground shrank: polygons a metre or two across, more of them near heat.
float egCrackM=max(smoothstep(.32,.55,egNoise(egP*.037-8.)),egHeat*.9)*(1.-egSheet*.8)*(1.-egAsh);
vec3 egC=egCells(egP*mix(.42,.8,egHeat)+egWarp*.6+vec2(egNoise(egP*1.9),egNoise(egP*1.9+4.))*.12);
float egCrack=(1.-smoothstep(.0,.022+egFoot*.35,egC.x+egNoise(egP*6.)*.012))*egCrackM*(.55+.45*smoothstep(-.2,.4,egNoise(egP*.8+egC.y*7.)));
// Pumice gravel in patches: pale pebbles a hand across.
float egGravM=smoothstep(.3,.6,egNoise(egP*.09+21.))*(1.-egSheet)*(1.-egHeat*.8)*(1.-egAsh*.6);
float egPeb=0.,egPebId=0.;
if(egDetail>.5&&egNear>0.&&egGravM>0.){vec3 c=egCells(egP*6.3);egPebId=c.y;egPeb=(1.-smoothstep(.16,.3,c.z+egNoise(egP*30.)*.05))*step(.3+.5*(1.-egGravM),c.y)*egNear;}
// Colour (sRGB values, converted): basalt from charcoal to blue-grey, lit by the swells.
vec3 egBas=mix(vec3(.13,.145,.178),vec3(.26,.27,.308),smoothstep(-.45,.45,egN1));
egBas=mix(egBas,vec3(.2,.2,.22),smoothstep(.2,.7,egN2)*.4);
egBas*=.9+.2*(egN3*.5+.5);
// Mid-scale blotches of rougher and smoother rock, and grit up close.
egBas*=1.+egNoise(egP*.34+5.)*.16+egNoise(egP*1.1-2.)*.08;
egBas*=1.+(egNoise(egP*2.7)*.1+egNoise(egP*11.)*.1+egNoise(egP*29.)*.08)*(1.-smoothstep(.03,.25,egFoot));
vec3 egSheetC=mix(vec3(.12,.125,.15),vec3(.16,.16,.19),egRope)*(.92+.16*egN3);
vec3 egAshC=mix(vec3(.345,.335,.36),vec3(.42,.405,.43),egStreak)*(.9+.12*egN3)*(.9+.1*egRip*(1.-smoothstep(.03,.15,egFoot)))*(1.+egNoise(egP*13.)*.05*egNear);
vec3 egCol=mix(egBas,egSheetC,egSheet);
egCol=mix(egCol,egBas*mix(.45,.85+.45*egAaC.y,egAa),egAaM*(1.-smoothstep(.06,.3,egFoot)*.5));
egCol=mix(egCol,egAshC,egAsh);
egCol=mix(egCol,mix(vec3(.4,.39,.38),vec3(.5,.48,.46),egPebId),egPeb*.8);
// Large scale, read from the air: old cooled flows fanning south from the volcano (dark, smoother, glassy), their
// edges heaped into pale ash-dusted levees, and long ash streaks blown east-west across everything.
vec2 egV=egP-vec2(0.,-128.);
float egVd=length(egV),egVa=atan(egV.x,egV.y);
float egFlowN=egFbm(vec2(egVa*5.,egVd*.012)+vec2(egNoise(egP*.018)*.7,egNoise(egP*.05)*.15)+3.7);
float egFlowFar=1.-smoothstep(170.,250.,egVd);
float egFlow=smoothstep(.04,.1,egFlowN)*egFlowFar*(1.-egShore);
float egLevee=(1.-smoothstep(.0,.07+egFoot*.05,abs(egFlowN-.01)))*egFlowFar*(1.-egShore);
float egWind=smoothstep(.18,.5,egFbm(vec2(egP.x*.0065,egP.y*.032)+11.)+egNoise(egP*.06)*.12)*(.25+.75*egPatch);
// Between the flows the old ground lies under ash: broad pale plains against the dark tongues.
egCol=mix(egCol,egAshC,(1.-egFlow)*egFlowFar*.5*egPatch*(1.-egHeat));
egCol=mix(egCol,mix(vec3(.12,.125,.15),vec3(.16,.16,.185),egN3*.5+.5),egFlow*.72*(1.-egAsh*.5));
egCol=mix(egCol,egAshC*1.06,egLevee*.5);
egCol=mix(egCol,egAshC*1.06,egWind*.45*(1.-egFlow*.4));
// Heat scorches the ground darker and rust-red, crazed by finer cracks.
vec3 egScorch=mix(vec3(.16,.12,.12),vec3(.1,.08,.085),egN3*.5+.5);
egCol=mix(egCol,egScorch,smoothstep(.15,.85,egHeat)*.85);
egCol=mix(egCol,vec3(.08,.08,.09),egCrack*.6);
// Fissure: a black crust lip, a dusting of sulfur on a few, and a scorched halo across the ash.
float egLip=1.-smoothstep(.12,.75,egFd);
float egHalo=1.-smoothstep(.3,2.6,egFd);
egCol=mix(egCol,vec3(.1,.085,.085),egHalo*.6);
egCol=mix(egCol,vec3(.05,.045,.05),egLip*.7);
egCol=mix(egCol,vec3(.79,.69,.29),smoothstep(.35,.5,egFd)*(1.-smoothstep(.5,.75,egFd))*smoothstep(.55,.8,egNoise(egP*1.7)*.5+.5)*.5);
// Contact shade under the rocks, cool violet-grey rather than black.
egCol*=mix(vec3(.55,.52,.6),vec3(1.),egAo);
diffuseColor.rgb=egSrgb(egCol);
`;

const ROUGH = /* glsl */ `
roughnessFactor=mix(.93,.62+.2*egRope,egSheet);
roughnessFactor=mix(roughnessFactor,.98,egAsh);
roughnessFactor=mix(roughnessFactor,.72,egFlow*(1.-egAsh)*(1.-egWind*.6));
`;

const NORMAL = /* glsl */ `
if(egDetail>.5){
  float egScoria=(egNoise(egP*3.3)*.6+egNoise(egP*8.1)*.4)*(1.-egAsh*.8)*(1.-egSheet*.7);
  float egH=(egAa*egAaM*.06+egRope*.022*egSheet+egRip*.008*egAsh+egPeb*.03-egCrack*.03-egLip*.02+egScoria*.035+egNoise(egP*17.)*.008*(1.-egAsh*.6))*(1.-smoothstep(.04,.25,egFoot));
  normal=egBump(normal,egH,egDpx,egDpy);
}
`;

const EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // Fissure core: white-hot in the middle, orange at its walls, breathing slowly and dimming along its length.
  float w=.07+.06*(egNoise(egP*.5+3.)*.5+.5);
  float core=1.-smoothstep(w*.3,w+egFoot*.6,egFd);
  float pulse=.75+.25*sin(egTime*.9+egP.x*.3+egP.y*.2);
  float lenV=.55+.45*smoothstep(-.3,.4,egNoise(egP*.35+1.));
  vec3 hot=mix(vec3(1.,.24,.04),vec3(1.,.65,.25),1.-smoothstep(0.,w*.6,egFd));
  totalEmissiveRadiance+=hot*core*3.2*pulse*lenV;
  totalEmissiveRadiance+=vec3(1.,.3,.07)*exp(-egFd*2.2)*.22*lenV*(1.-core);
  // Heat glows in the crust cracks near the lava and the shore.
  float hc=(1.-smoothstep(.0,.02+egFoot*.3,egC.x))*smoothstep(.45,1.,egHeat)*smoothstep(-.1,.5,egNoise(egP*.5+egC.y*3.));
  totalEmissiveRadiance+=vec3(1.,.28,.05)*hc*(1.6+egNoise(egP*.4+egTime*.05)*.6)*smoothstep(.5,1.,egHeat);
  totalEmissiveRadiance+=vec3(.9,.25,.06)*smoothstep(.6,1.,egHeat)*.05;
  // Crystal light pooled on the ground.
  totalEmissiveRadiance+=vec3(1.,.42,.12)*egCrys*egCrys*.32*(.9+.1*sin(egTime*1.3+egP.x));
}
`;

export interface EmberGroundOptions {
 height: (x: number, z: number) => number;
 zones: readonly LavaZone[];
 features: readonly EmberFeature[];
}

/** The terrain mesh ('frontier-terrain', same grid and heights as before) with the Emberreach ground shader. */
export function emberGround(opts: EmberGroundOptions) {
 const geo = new THREE.PlaneGeometry(300, 350, 150, 175); geo.rotateX(-Math.PI / 2);
 const pos = geo.getAttribute('position');
 for (let i = 0; i < pos.count; i++) pos.setY(i, opts.height(pos.getX(i), pos.getZ(i)));
 geo.computeVertexNormals();
 const map = bakeGroundMap(opts.zones, opts.features);
 const uniforms = {
  egMap: {value: map},
  egRect: {value: new THREE.Vector4(RECT.x0, RECT.z0, 1 / RECT.w, 1 / RECT.h)},
  egDetail: EMBER_DETAIL,
  egTime: {value: 0},
 };
 const material = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .93, metalness: 0});
 material.name = 'ember-ground';
 material.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
   .replace('#include <common>', '#include <common>\nvarying vec3 vEgW;')
   .replace('#include <fog_vertex>', '#include <fog_vertex>\nvEgW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <common>', `#include <common>\n${HEAD}`)
   .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR}`)
   .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`)
   .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL}`)
   .replace('#include <emissivemap_fragment>', EMISSIVE);
 };
 material.customProgramCacheKey = () => 'ember-ground';
 const mesh = new THREE.Mesh(geo, material);
 mesh.name = 'frontier-terrain'; mesh.receiveShadow = true; mesh.castShadow = true;
 mesh.userData.emberGround = true;
 return {mesh, uniforms, update(time: number) { uniforms.egTime.value = time; }};
}
