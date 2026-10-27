import * as THREE from 'three';
import {injectStarLight} from './starLight';
import {STAR_GRID} from '../sim/world/ground';
import {onIslandPath,type IslandPath} from './islandPaths';
import {starGroundColor} from './world2Ground';
import {starFieldValue, starShade, starSoil} from './starGround';
import {STAR_DETAIL,starNoise} from './starFieldLayout';
import {starTrailDistance} from './world2Settlement';

/*
 * The meadow underfoot: tufts of three blades on a world-locked jittered lattice that travels with the view, so
 * every tuft stays where it grew while the patch follows the camera. One instanced draw, no per-instance data: the
 * vertex shader finds its lattice cell from gl_InstanceID, reads the gameplay height grid (the exact triangles of
 * starSurfaceHeight), the density and height map (grass where the ground is grassy, none on the paving, in the
 * buildings, on the sand or the arena) and the region tint, and bends each blade in the wind and away from the
 * player. Far tufts thin out and shrink before the edge of the patch, where the ground shader's grass takes over.
 */

const MAP = 1;
const MAP_MIN_X = -140, MAP_MIN_Z = -160, MAP_W = 280, MAP_H = 320;

const VERT_HEAD = /* glsl */ `
uniform sampler2D smHeight;
uniform sampler2D smMask;
uniform sampler2D smTint;
uniform vec4 smGrid;     // minX, minZ, step, nx
uniform float smGridNz;
uniform vec4 smMap;      // minX, minZ, 1/width, 1/height
uniform vec3 smCenter;   // patch centre x, z; lattice spacing
uniform float smN;       // tufts across the patch
uniform float smTime;
uniform vec3 smPlayer;
attribute vec3 aBlade;   // height along the blade 0..1, side -1..1, blade index 0..2
varying vec3 vSmCol;
varying float vSmT;
varying float vSmAo;
varying float vSmTurf;
varying vec3 vSmN;
vec2 smHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float smHeightAt(vec2 p){
  vec2 g=clamp((p-smGrid.xy)/smGrid.z,vec2(0.),vec2(smGrid.w-1.,smGridNz-1.));
  vec2 i=min(floor(g),vec2(smGrid.w-2.,smGridNz-2.)),f=g-i;ivec2 c=ivec2(i);
  float a=texelFetch(smHeight,c,0).r,b=texelFetch(smHeight,c+ivec2(0,1),0).r,d=texelFetch(smHeight,c+ivec2(1,0),0).r,e=texelFetch(smHeight,c+ivec2(1,1),0).r;
  return f.x+f.y<=1.?a+(d-a)*f.x+(b-a)*f.y:e+(b-e)*(1.-f.x)+(d-e)*(1.-f.y);
}
`;

const VERT_BODY = /* glsl */ `
float smId=float(gl_InstanceID);
vec2 smCell=floor(smCenter.xy/smCenter.z)+vec2(mod(smId,smN),floor(smId/smN))-floor(smN*.5);
vec2 smR=smHash22(smCell),smR2=smHash22(smCell+71.3);
vec2 smRoot=(smCell+.15+.7*smR)*smCenter.z;
vec2 smUv=(smRoot-smMap.xy)*smMap.zw;
vec4 smM=texture2D(smMask,smUv);
float smDist=length(smRoot-smCenter.xy)/(smN*smCenter.z*.5);
// Clumps: the nearest of a jittered 2.4 m lattice of seeds; blades of one clump share height, lean and tone, and
// stand taller at its heart. Bare patches: a slow noise thins the sward to nothing in places.
vec2 smCc=floor(smRoot/2.4-.5),smBest=vec2(0.);float smCd=9.;
// The four lattice cells round the root (its jittered seeds keep to the middle of their cells, so this finds the nearest).
for(int j=0;j<=1;j++)for(int i=0;i<=1;i++){vec2 c=smCc+vec2(i,j),q=(c+.3+.4*smHash22(c+3.7))*2.4;float d=length(smRoot-q);if(d<smCd){smCd=d;smBest=c;}}
vec2 smK=smHash22(smBest+11.1),smK2=smHash22(smBest+29.3);
vec2 smPc=floor(smRoot/9.),smPf=fract(smRoot/9.);smPf=smPf*smPf*(3.-2.*smPf);
float smPatch=mix(mix(smHash22(smPc).x,smHash22(smPc+vec2(1.,0.)).x,smPf.x),mix(smHash22(smPc+vec2(0.,1.)).x,smHash22(smPc+1.).x,smPf.x),smPf.y);
// Bare patches are bare (no stray blades left standing in them: those read as confetti); mown turf has none.
float smTurf=1.-smoothstep(.36,.5,smM.g);
float smBare=max(smoothstep(.16,.3,smPatch+(smK.x-.5)*.25),smTurf);
float smHeart=1.-smoothstep(.4,1.6,smCd);
// Thin out toward the patch's edge (and wherever the map says sparse); shrink before vanishing.
float smKeep=smM.r*(1.-smoothstep(.62,.96,smDist))*mix(0.,1.,smBare)*mix(.72+.28*smHeart,1.,smTurf);
float smLive=step(smR2.x,smKeep);
float smScale=smLive*smM.g*(.55+.6*smR2.y)*mix(1.,.35,smoothstep(.55,.95,smDist))*smoothstep(0.,.25,smKeep-smR2.x+.1);
smScale*=(.62+.7*smK.y)*(.7+.45*smHeart)*mix(.6,1.,smBare);
// The fields' large-scale value: tussock beds stand taller, trodden ground is grazed short.
float smLush=max(.5-smM.a,0.)*2.,smWear=max(smM.a-.5,0.)*2.;
smScale*=1.+.6*smLush-.45*smWear;
// Each blade of the tuft: its own lean, height and turn; the clump's common lean on top.
float smB=aBlade.z,smA=smR.x*6.2831+smB*2.1,smLean=.3+.4*fract(smR.y*7.+smB*.37);
vec2 smDir=normalize(vec2(cos(smA),sin(smA))+vec2(cos(smK2.x*6.28),sin(smK2.x*6.28))*.9),smSide=vec2(-smDir.y,smDir.x);
vec2 smOff=smDir*(.05+.06*smB)*(smB>0.?1.:0.);
// Short turf on the town's mown lawns (map height under .5): finer blades, so they read as a sward, not confetti.
float smH=(.26+.26*fract(smR2.y*5.3+smB*.61))*smScale,smW=(.042+.026*fract(smR.x*3.1+smB))*mix(1.,.7,smTurf);
float smT=aBlade.x;
// Wind: slow swells and quick flutter; the player's crab parts the grass round it.
vec2 smBase=smRoot+smOff;
float smGust=sin(smTime*.8+dot(smBase,vec2(.11,.07)))*.5+sin(smTime*1.9+dot(smBase,vec2(-.23,.31)))*.25;
vec2 smWind=vec2(.8,.6)*(.18+.14*smGust)+smSide*sin(smTime*3.1+smR.x*20.)*.04;
vec2 smAway=smBase-smPlayer.xz;float smPd=length(smAway);
smWind+=smPd>1e-3?smAway/smPd*(1.-smoothstep(.4,1.4,smPd))*.9:vec2(0.);
vec2 smBend=(smDir*smLean+smWind)*smT*smT*smH;
float smGround=smHeightAt(smBase);
// A full blade that narrows late (not a straight spike), so tips read soft.
float smTaper=1.-smT*smT;
vec3 transformed=vec3(smBase.x+smSide.x*aBlade.y*smW*smTaper+smBend.x,smGround+smT*smH*(1.-.3*smT*length(smDir*smLean+smWind)),smBase.y+smSide.y*aBlade.y*smW*smTaper+smBend.y);
if(smScale<.02)transformed=vec3(0.,-1e4,0.);
// Lit as the ground it stands in (the terrain's own normal, so a blade is never darker than the turf round it),
// turned only a little toward its own face.
float smGx=smHeightAt(smBase+vec2(.6,0.))-smHeightAt(smBase-vec2(.6,0.)),smGz=smHeightAt(smBase+vec2(0.,.6))-smHeightAt(smBase-vec2(0.,.6));
vec3 objectNormal=vec3(0.,1.,0.);// Per blade: turned toward its own face and curling over toward the tip, so each blade shades a little differently.
vec2 smTilt=(smDir*(.18+.3*smT)+(smR2-.5)*.35)*(1.-.5*smTurf);
vSmN=normalize(vec3(-smGx/1.2+smTilt.x,1.,-smGz/1.2+smTilt.y));
vec3 smTint=texture2D(smTint,smUv).rgb;
// Tone by clump: some greener, some silvered, some going to seed (warmer, paler).
vec3 smClumpTone=smK2.y<.33?vec3(.92,1.06,1.02):smK2.y<.66?vec3(1.06,1.04,1.1):vec3(1.14,1.08,.9);
// Value varies clump by clump (some deep, some silvered) so a field reads as tussocks, not one flat sheet.
vSmCol=smTint*(.9+.2*smR2.y)*mix(.6+.8*smK.x,1.02+.2*smK.x,smTurf)*mix(.68+.64*smPatch,.8+.4*smPatch,smTurf)*smClumpTone*mix(vec3(1.),vec3(1.18,1.1,.8),step(.86,smR.y));
// Large-scale value on top: the beds deep and teal, the trodden turf silvered and pale.
vSmCol*=mix(vec3(1.),vec3(.5,.64,.68),smLush)*mix(vec3(1.),vec3(1.6,1.56,1.5),smWear);
vSmT=smT;vSmAo=mix(smM.b,1.,smTurf*.6);vSmTurf=smTurf;
`;

export interface StarMeadow {
  mesh: THREE.Mesh;
  update(time: number, camera: THREE.Camera, player: THREE.Vector3, quality: 'high' | 'low'): void;
  stats: {mapCells: number; grassCells: number; instances: number};
}

/** `exclude`: discs (x, z, r) where nothing grows: buildings, stalls, props. */
export function starMeadow(height: (x: number, z: number) => number, paths: readonly IslandPath[], exclude: readonly (readonly [number, number, number])[]): StarMeadow {
  const {nx, nz, step, minX, minZ} = STAR_GRID;
  const hData = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hData[j * nx + i] = height(minX + i * step, minZ + j * step);
  const hTex = new THREE.DataTexture(hData, nx, nz, THREE.RedFormat, THREE.FloatType); hTex.needsUpdate = true;
  // Density (r), blade height (g), a soft occlusion (b) from the nearby paving and walls and the fields' large-scale
  // value (a: 0 lush, .5 plain, 1 worn; starFieldValue); tint at the same texels.
  const W = MAP_W / MAP, H = MAP_H / MAP, mask = new Uint8Array(W * H * 4), tint = new Uint8Array(W * H * 4), c = new THREE.Color();
  let grassCells = 0;
  const smooth = THREE.MathUtils.smoothstep;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = MAP_MIN_X + (i + .5) * MAP, z = MAP_MIN_Z + (j + .5) * MAP, y = height(x, z);
    const [sand, grass, worn] = starSoil(x, z, y);
    let d = Math.max(0, grass - sand * 1.4) * (1 - worn * .9);
    let near = Infinity;
    for (const [ex, ez, er] of exclude) near = Math.min(near, Math.hypot(x - ex, z - ez) - er);
    d *= smooth(near, 0, 1.2);
    const town = Math.abs(x) < 54 && z > 3 && z < 100;
    let tall = 0;
    // Grass strips along the trails' and the starroad's edges, outside the town: a taller fringe where the worn
    // earth meets the meadow, ragged so it never follows the kerb exactly.
    if (!town && d < .9) {
      const t = starTrailDistance(x, z), rag = starNoise(x / 3, z / 3, 41);
      const trailEdge = (1 - smooth(Math.abs(t - 1.9 - rag * .5), .25, .9)) * (t > 1.3 ? 1 : 0);
      const roadEdge = z < 0 && z > -58 ? (1 - smooth(Math.abs(Math.abs(x) - 6.2 - rag * .6), .3, 1.1)) * (Math.abs(x) > 5 ? 1 : 0) : 0;
      tall = Math.max(trailEdge, roadEdge) * smooth(rag, .05, .3) * (1 - sand);
      d = Math.max(d, tall * .95);
    }
    // Round the sanctum: no grass on the floor or at the obelisks' feet, sparse tussocks in the ring outside.
    const ra = Math.hypot(x, z + 75);
    if (ra < 25) {
      let foot = 9;
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; foot = Math.min(foot, Math.hypot(x - Math.sin(a) * 21, z + 75 - Math.cos(a) * 21)); }
      const ring = ra > 19.4 && foot > 2.1 && !(Math.abs(x) < 5.5 && z > -58) ? smooth(starNoise(x / 2.5, z / 2.5, 57), .15, .45) * .6 : 0;
      d = ring; tall = Math.max(tall, ring);
    }
    if (Math.hypot(x, z - 55) < 8) d = 0;
    // Off the stones by a hand's width: test the cell's corners against the ways.
    for (const [ox, oz] of [[0, 0], [-.45, -.45], [.45, -.45], [-.45, .45], [.45, .45]]) if (onIslandPath(paths, x + ox, z + oz)) { d = 0; break; }
    const o = (j * W + i) * 4;
    // The town's lawns are a full, short sward: dense or nothing, never a scatter of single blades.
    mask[o] = Math.round(Math.min(1, d * (town ? 1.8 : 1.15)) * 255);
    mask[o + 1] = Math.round((town ? .34 : Math.max(tall, .8 + .2 * (1 - worn))) * 255);
    mask[o + 2] = Math.round((1 - starShade(x, z)) * 255); mask[o + 3] = Math.round(starFieldValue(x, z, y) * 255);
    starGroundColor(x, z, y, c);
    tint[o] = Math.round(Math.min(1, c.r) * 255); tint[o + 1] = Math.round(Math.min(1, c.g) * 255); tint[o + 2] = Math.round(Math.min(1, c.b) * 255); tint[o + 3] = 255;
    if (d > .2) grassCells++;
  }
  const mkTex = (data: Uint8Array) => { const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  const maskTex = mkTex(mask), tintTex = mkTex(tint);

  // A tuft: three blades, each two segments and a tip (5 vertices, 3 triangles).
  const blade: number[] = [], index: number[] = [];
  for (let b = 0; b < 3; b++) {
    const o = blade.length / 3;
    blade.push(0, -1, b, 0, 1, b, .5, -1, b, .5, 1, b, 1, 0, b);
    index.push(o, o + 1, o + 2, o + 2, o + 1, o + 3, o + 2, o + 3, o + 4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(blade.length).fill(0), 3));
  geo.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 3));
  geo.setIndex(index);
  const params = {high: {s: .26, n: 160}, low: {s: .38, n: 100}};
  geo.instanceCount = params.high.n ** 2;
  const uniforms = {
    smHeight: {value: hTex}, smMask: {value: maskTex}, smTint: {value: tintTex},
    smGrid: {value: new THREE.Vector4(minX, minZ, step, nx)}, smGridNz: {value: nz},
    smMap: {value: new THREE.Vector4(MAP_MIN_X, MAP_MIN_Z, 1 / MAP_W, 1 / MAP_H)},
    smCenter: {value: new THREE.Vector3(0, 0, params.high.s)}, smN: {value: params.high.n},
    smTime: {value: 0}, smPlayer: {value: new THREE.Vector3()}, sgDetail: STAR_DETAIL,
  };
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .62, side: THREE.DoubleSide});
  material.name = 'starhaven-meadow-grass';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <beginnormal_vertex>', VERT_BODY)
      .replace('#include <begin_vertex>', '');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSmCol;\nvarying float vSmT;\nvarying float vSmAo;\nvarying float vSmTurf;\nvarying vec3 vSmN;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n// Dark in the thatch, the tips catching the moon (silvered); mown turf stays close to the ground\'s own value.\nfloat smTip=smoothstep(.45,1.,vSmT);\ndiffuseColor.rgb=vSmCol*mix(mix(.5,1.,vSmTurf),mix(1.1,1.2,vSmTurf),smoothstep(0.,.8,vSmT))*mix(.6,1.,vSmAo);\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.8,2.1,2.6)+vec3(.03,.042,.065),smTip*(1.-.6*vSmTurf));')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(.9,.6,vSmT);')
      // Both faces lit as the front: grass is thin enough to let the moon through.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n// Both faces lit as the turf they stand in: the terrain\'s world normal, whichever face is seen.\nnormal=normalize((viewMatrix*vec4(vSmN,0.)).xyz);');
    // Lamp pools and crystal glow light each blade where it stands (starLight.ts).
    injectStarLight(shader, null);
  };
  material.customProgramCacheKey = () => 'starhaven-meadow-grass';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'starhaven-meadow'; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
  // For QA: where grass may grow (r of each 1 m texel from MAP_MIN_X, MAP_MIN_Z).
  mesh.userData.mask = {data: mask, width: W, height: H, minX: MAP_MIN_X, minZ: MAP_MIN_Z, cell: MAP};
  const fwd = new THREE.Vector3();
  let current: 'high' | 'low' = 'high';
  return {
    mesh,
    stats: {mapCells: W * H, grassCells, instances: geo.instanceCount},
    update(time, camera, player, quality) {
      if (quality !== current) { current = quality; const p = params[quality]; geo.instanceCount = p.n ** 2; uniforms.smN.value = p.n; uniforms.smCenter.value.z = p.s; }
      const p = params[quality], reach = p.n * p.s * .5;
      camera.getWorldDirection(fwd);
      const l = Math.hypot(fwd.x, fwd.z) || 1;
      // The patch sits ahead of the camera so what is in view is covered, little is spent behind it.
      uniforms.smCenter.value.x = camera.position.x + fwd.x / l * reach * .72;
      uniforms.smCenter.value.y = camera.position.z + fwd.z / l * reach * .72;
      uniforms.smTime.value = time; uniforms.smPlayer.value.copy(player);
    },
  };
}
