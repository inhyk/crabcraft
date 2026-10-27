import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {boulderGeometry} from './snowRocks';
import {facetedStarCrystal} from './starCrystal';
import {STAR_CAMP,STAR_CRATER,STAR_DETAIL,starNoise,starSand} from './starFieldLayout';
import {starBoulders,starCraterShards,starPlayDistance} from './starFieldSpots';
import {nearStarObjective,starTrailDistance} from './world2Settlement';
import {trs,type Scatter} from '../world/kit';
import {starWildClumps,STAR_WILD_TINTS} from './starWilds';

/*
 * Starhaven's fields: sculpted boulders of dark island stone with violet crystal veins and moss on their shoulders
 * (the forest's old rock spots, the bluff tops, the crater's rim, loose stones in the grass), the fallen star's shards
 * glowing in its crater, clumps of moon-flowers that breathe teal and violet light, and the licensed kit's ferns,
 * clover, tall grass and wildflowers through the meadows. One draw each: boulders and shards are merged, flowers
 * instanced, kit plants join the island's batched, wind-blown foliage.
 */

const TRI = /* glsl */ `
vec2 sbHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float sbNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(sbHash22(i)*2.-1.,f),b=dot(sbHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(sbHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(sbHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
`;

/** Dark island stone: banded, mottled, veined with crystal that glows faintly, moss on what faces the sky. */
function boulderMaterial(time: {value: number}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .78});
  m.name = 'starhaven-boulder';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.sbTime = time; shader.uniforms.sgDetail = STAR_DETAIL;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nvarying float vSbG;\nvarying vec3 vSbW;\nvarying vec3 vSbN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSbG=aGround;vSbW=(modelMatrix*vec4(transformed,1.)).xyz;vSbN=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRI}\nuniform float sbTime;\nuniform float sgDetail;\nvarying float vSbG;\nvarying vec3 vSbW;\nvarying vec3 vSbN;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 sbN=normalize(vSbN),sbA=abs(sbN)/(abs(sbN.x)+abs(sbN.y)+abs(sbN.z));
        #define SB3(f,o) (sbNoise(vSbW.zy*f+o)*sbA.x+sbNoise(vSbW.xz*f+o)*sbA.y+sbNoise(vSbW.xy*f+o)*sbA.z)
        float sbFoot=length(fwidth(vSbW));
        float sbNear=1.-smoothstep(.01,.05,sbFoot);
        // vColor: r the occlusion of grooves and partings, g the tone of the bed.
        vec3 sbStone=mix(vec3(.085,.085,.11),vec3(.2,.19,.215),vColor.g*.8+(SB3(.9,3.)*.5+.5)*.35);
        sbStone*=.75+.5*(SB3(3.3,1.)*.5+.5);
        sbStone*=mix(1.,.8+.4*(SB3(14.,7.)*.5+.5),sbNear);
        sbStone*=.55+.45*vColor.r;
        // Crystal veins: thin wandering lines through the stone.
        float sbVn=abs(SB3(.55,11.)+SB3(1.7,5.)*.35);
        float sbVein=(1.-smoothstep(.015,.04,sbVn))*step(.45,SB3(.23,2.)*.5+.5)*(1.-smoothstep(.02,.12,sbFoot));
        sbStone=mix(sbStone,vec3(.42,.3,.62),sbVein*.75);
        // Moss and lichen on the shoulders, damp soil at the foot.
        float sbMoss=smoothstep(.45,.8,sbN.y+SB3(1.4,9.)*.35)*smoothstep(-.1,.4,SB3(.7,4.));
        sbStone=mix(sbStone,mix(vec3(.05,.1,.07),vec3(.12,.16,.1),SB3(5.,2.)*.5+.5),sbMoss*.85);
        float sbFoot2=1.-smoothstep(.0,.22+SB3(2.,6.)*.08,vSbW.y-vSbG);
        sbStone=mix(sbStone,vec3(.05,.06,.05),sbFoot2*.7);
        diffuseColor.rgb=sbStone;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(.72,.92,sbMoss),.3,sbVein);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif(sgDetail>.5)totalEmissiveRadiance+=vec3(.36,.2,.7)*sbVein*(.35+.25*sin(sbTime*.9+vSbW.x*.7+vSbW.z*.5));')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        if(sgDetail>.5){
          #define SBF(q) (sbNoise((q).zy*9.+1.)*sbA.x+sbNoise((q).xz*9.+1.)*sbA.y+sbNoise((q).xy*9.+1.)*sbA.z)
          float e=.02,f0=SBF(vSbW);
          vec3 g=vec3(SBF(vSbW+vec3(e,0.,0.))-f0,SBF(vSbW+vec3(0.,e,0.))-f0,SBF(vSbW+vec3(0.,0.,e))-f0)/e;
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          g=(g-dot(g,nW)*nW)*.015*(1.-sbMoss*.6)*sbNear;
          nW=normalize(nW-g);
          normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'starhaven-boulder';
  return m;
}

/** A moon-flower: a curved stem, two leaves and a nodding bell of five petals. aGlow: 0 stem and leaves, 1 bell. */
function moonFlowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const glow = (g: THREE.BufferGeometry, v: number) => { g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count).fill(v), 1)); g.deleteAttribute('uv'); return g; };
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(.02, .2, 0), new THREE.Vector3(.07, .38, 0), new THREE.Vector3(.14, .44, 0)]);
  parts.push(glow(new THREE.TubeGeometry(curve, 6, .009, 4, false), 0));
  for (const [a, h] of [[0, .08], [2.4, .14]] as const) {
    const leaf = new THREE.PlaneGeometry(.05, .16, 1, 2); const p = leaf.getAttribute('position');
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + .08; p.setXYZ(i, p.getX(i) * Math.sin(y / .16 * Math.PI), y, y * y * 1.6); }
    leaf.rotateY(a); leaf.translate(0, h, 0); parts.push(glow(leaf.toNonIndexed(), 0));
  }
  // The bell: a short lathe flared at the mouth, hanging from the stem's tip.
  const bell = new THREE.LatheGeometry([new THREE.Vector2(.004, 0), new THREE.Vector2(.03, -.02), new THREE.Vector2(.045, -.06), new THREE.Vector2(.07, -.1), new THREE.Vector2(.085, -.105)], 10);
  const bp = bell.getAttribute('position');
  for (let i = 0; i < bp.count; i++) { const a = Math.atan2(bp.getZ(i), bp.getX(i)), lobe = 1 + .22 * Math.cos(a * 5) * Math.min(1, -bp.getY(i) / .1); bp.setXYZ(i, bp.getX(i) * lobe, bp.getY(i), bp.getZ(i) * lobe); }
  bell.rotateZ(-.5); bell.translate(.14, .44, 0); parts.push(glow(bell.toNonIndexed(), 1));
  const g = mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p), false)!;
  parts.forEach((p) => p.dispose());
  g.computeVertexNormals();
  return g;
}

export interface StarFields { root: THREE.Group; update(time: number): void }

/** Within reach of a sanctum obelisk's foot (the twelve old column footprints, r 21 round the floor). */
const throneNear = (x: number, z: number) => { for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (Math.hypot(x - Math.sin(a) * 21, z + 75 - Math.cos(a) * 21) < 2.4) return true; } return false; };

/** Boulders, shards and moon-flowers (meshes of their own); `scatter` receives the kit's meadow plants. */
export function starFields(height: (x: number, z: number) => number, scatter: Scatter, natureNames: readonly string[], clear: (name: string, x: number, z: number, scale: number) => boolean): StarFields {
  const root = new THREE.Group(); root.name = 'starhaven-fields';
  const time = {value: 0};
  const rand = (i: number) => { const a = Math.sin(i * 57.3 + 7.7) * 43758.5453; return a - Math.floor(a); };

  // Boulders: ten sculpted shapes, each placed turned, stretched and sunk into the slope; one merged mesh.
  const shapes = Array.from({length: 10}, (_, i) => boulderGeometry({r: 1, h: .7 + .1 * (i % 3), seed: 4100 + i * 37}, 9));
  const placed: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  const boulders = starBoulders();
  for (const [i, b] of boulders.entries()) {
    const g = shapes[b.shape].clone();
    // Sink by the slope under the stone so no side floats on a hillside.
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, y = height(b.x + Math.cos(a) * b.r, b.z + Math.sin(a) * b.r * .7); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    e.set((rand(i) - .5) * .25, b.yaw, (rand(i + 1) - .5) * .25);
    m.compose(v.set(b.x, lo - .06 * b.r, b.z), q.setFromEuler(e), new THREE.Vector3(b.r, b.h / .75, b.r * (.85 + .3 * rand(i + 2))));
    g.applyMatrix4(m);
    const p = g.getAttribute('position'), ground = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) ground[k] = height(p.getX(k), p.getZ(k));
    g.setAttribute('aGround', new THREE.BufferAttribute(ground, 1));
    placed.push(g);
  }
  shapes.forEach((s) => s.dispose());
  const boulderGeo = mergeGeometries(placed, false)!; placed.forEach((g) => g.dispose());
  const boulderMesh = new THREE.Mesh(boulderGeo, boulderMaterial(time));
  boulderMesh.name = 'starhaven-field-boulders'; boulderMesh.castShadow = boulderMesh.receiveShadow = true;
  root.add(boulderMesh);

  // Loose stones where the ground lies bare: round the sanctum's ring, on the ruin's plaza, beside the starroad and
  // along the trails' edges, gathered in little drifts (a big one, two or three middling, a few chips). Too small to
  // be solid; one merged mesh in the boulders' stone.
  {
    const small = Array.from({length: 6}, (_, i) => boulderGeometry({r: 1, h: .55 + .1 * (i % 3), seed: 7300 + i * 53}, 3));
    const loose: THREE.BufferGeometry[] = [];
    const zones: {x: number; z: number; r0: number; r1: number; n: number}[] = [
      {x: 0, z: -75, r0: 19.6, r1: 28, n: 46}, {x: 80, z: -40, r0: 3.5, r1: 15, n: 22}, {x: STAR_CRATER.x, z: STAR_CRATER.z, r0: STAR_CRATER.r * 1.05, r1: STAR_CRATER.r * 1.7, n: 12},
      {x: 0, z: -30, r0: 5.6, r1: 10, n: 18},
    ];
    let seed = 0;
    for (const zn of zones) for (let k = 0; k < zn.n; k++) {
      seed++;
      const a = rand(seed * 3.1) * Math.PI * 2, d = zn.r0 + (zn.r1 - zn.r0) * Math.sqrt(rand(seed * 5.7));
      let cx = zn.x + Math.cos(a) * d, cz = zn.z + Math.sin(a) * d;
      // The starroad zone is two strips either side of the paving.
      if (zn.x === 0 && zn.z === -30) { cx = (rand(seed) < .5 ? -1 : 1) * (5.4 + rand(seed * 2.3) * 3.5); cz = -6 - rand(seed * 4.1) * 46; }
      if (Math.abs(cx) < 5.3 && cz > -60 && cz < 92) continue;
      if (zn.z === -75 && throneNear(cx, cz)) continue;
      if (nearStarObjective(cx, cz, -9) || starTrailDistance(cx, cz) < 1.4) continue;
      const drift = 2 + Math.floor(rand(seed * 7.7) * 4);
      for (let j = 0; j < drift; j++) {
        const big = j === 0, r = big ? .22 + .2 * rand(seed + j * 11) : .07 + .13 * rand(seed + j * 13);
        const x = cx + (j ? (rand(seed * 9 + j) - .5) * 1.6 : 0), z = cz + (j ? (rand(seed * 8 + j) - .5) * 1.6 : 0);
        const g = small[(seed + j) % small.length].clone();
        e.set((rand(seed + j * 3) - .5) * .5, rand(seed + j * 5) * 6.28, (rand(seed + j * 7) - .5) * .5);
        m.compose(v.set(x, height(x, z) - r * .25, z), q.setFromEuler(e), new THREE.Vector3(r, r * (.6 + .4 * rand(seed + j)), r * (.8 + .4 * rand(seed + j * 2))));
        g.applyMatrix4(m);
        const p = g.getAttribute('position'), ground = new Float32Array(p.count);
        for (let k2 = 0; k2 < p.count; k2++) ground[k2] = height(p.getX(k2), p.getZ(k2));
        g.setAttribute('aGround', new THREE.BufferAttribute(ground, 1));
        loose.push(g);
      }
    }
    small.forEach((g) => g.dispose());
    const looseMesh = new THREE.Mesh(mergeGeometries(loose, false)!, boulderMesh.material);
    loose.forEach((g) => g.dispose());
    looseMesh.name = 'starhaven-loose-stones'; looseMesh.castShadow = looseMesh.receiveShadow = true;
    root.add(looseMesh);
  }

  // The fallen star's shards: faceted crystal, bright inside, half buried and tilted out from the impact.
  const shardGeo: THREE.BufferGeometry[] = [];
  for (const s of starCraterShards()) {
    const g = facetedStarCrystal();
    e.set(s.tilt * Math.cos(s.yaw), s.yaw, s.tilt * Math.sin(s.yaw));
    m.compose(v.set(s.x, height(s.x, s.z) + s.h * .55, s.z), q.setFromEuler(e), new THREE.Vector3(s.w, s.h, s.w * .85));
    g.applyMatrix4(m); shardGeo.push(g);
  }
  const shards = new THREE.Mesh(mergeGeometries(shardGeo, false)!, new THREE.MeshStandardMaterial({color: '#b49cff', emissive: '#8a50ff', emissiveIntensity: 2.1, vertexColors: true, flatShading: true, metalness: .3, roughness: .18}));
  shardGeo.forEach((g) => g.dispose());
  shards.name = 'starhaven-crater-shards'; shards.castShadow = true;
  // No light of its own (each point light costs every lit pixel on the island): the ground glows round it instead.
  root.add(shards);

  // Moon-flowers: clumps in the moss of the crystalwood, round the crater, on the camp's knoll and by the trails.
  const spots: [number, number, number][] = [];
  const clumps: [number, number, number, number][] = [[-75, -15, 9, 14], [-58, -42, 7, 10], [-92, -24, 6, 8], [STAR_CRATER.x, STAR_CRATER.z, 11, 12], [STAR_CAMP.x, STAR_CAMP.z, 9, 9], [60, -52, 7, 8], [-48, 40, 6, 7], [52, 28, 6, 7], [18, -50, 5, 6], [-22, -48, 6, 7], [88, 2, 5, 6], [-86, 50, 5, 6]];
  for (const [ci, [cx, cz, cr, n]] of clumps.entries()) for (let k = 0; k < n; k++) {
    const a = k * 2.39996 + ci, d = cr * Math.sqrt((k + .5) / n), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (starPlayDistance(x, z) < 2 || starTrailDistance(x, z) < 1.9 || nearStarObjective(x, z, .5) || starSand(x, z) > .4) continue;
    if (Math.hypot(x - STAR_CRATER.x, z - STAR_CRATER.z) < STAR_CRATER.r * .8) continue;
    // Each clump spot grows three to five flowers close together.
    const count = 3 + Math.floor(rand(ci * 50 + k) * 3);
    for (let f = 0; f < count; f++) spots.push([x + (rand(ci * 90 + k * 7 + f) - .5) * .7, z + (rand(ci * 91 + k * 5 + f) - .5) * .7, ci * 100 + k * 10 + f]);
  }
  // The wilds' clumps (starWilds.ts): bigger flowers of one colour, each clump lighting its patch of ground.
  const wild: [number, number, number, number, number][] = [];
  for (const [ci, c] of starWildClumps().entries()) for (let k = 0; k < c.n; k++) {
    const a = k * 2.39996 + ci, d = c.r * Math.sqrt((k + .5) / c.n);
    for (let f = 0; f < 3; f++) wild.push([c.x + Math.cos(a) * d + (rand(ci * 70 + k * 3 + f) - .5) * .6, c.z + Math.sin(a) * d + (rand(ci * 71 + k * 3 + f) - .5) * .6, 50000 + ci * 100 + k * 10 + f, c.tint, 1.5 + .5 * rand(ci * 13 + k + f)]);
  }
  const flowerGeo = moonFlowerGeometry();
  const flowerMat = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .55, side: THREE.DoubleSide});
  flowerMat.name = 'starhaven-moonflower';
  flowerMat.onBeforeCompile = (shader) => {
    shader.uniforms.sbTime = time; shader.uniforms.sgDetail = STAR_DETAIL;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vMfGlow;\nvarying float vMfPhase;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMfGlow=aGlow;vMfPhase=instanceMatrix[3].x*1.7+instanceMatrix[3].z*.9;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float sbTime;\nuniform float sgDetail;\nvarying float vMfGlow;\nvarying float vMfPhase;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(vec3(.05,.1,.075),vColor.rgb*.7+.2,vMfGlow);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vColor.rgb*vMfGlow*(.9+.5*sin(sbTime*(.8+fract(vMfPhase)*.6)+vMfPhase))*1.4;');
  };
  flowerMat.customProgramCacheKey = () => 'starhaven-moonflower';
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, Math.max(1, spots.length + wild.length));
  const teal = new THREE.Color('#5ff0d6'), violet = new THREE.Color('#b47dff'), pale = new THREE.Color('#c9d6ff'), col = new THREE.Color();
  spots.forEach(([x, z, i], k) => {
    const s = .8 + .5 * rand(i + 3);
    flowers.setMatrixAt(k, trs(x, height(x, z) - .01, z, rand(i) * 6.28, s, (rand(i + 1) - .5) * .25, (rand(i + 2) - .5) * .25));
    col.copy(rand(i + 4) < .45 ? teal : rand(i + 4) < .85 ? violet : pale);
    flowers.setColorAt(k, col);
  });
  wild.forEach(([x, z, i, tint, s], k) => {
    flowers.setMatrixAt(spots.length + k, trs(x, height(x, z) - .01, z, rand(i) * 6.28, s, (rand(i + 1) - .5) * .3, (rand(i + 2) - .5) * .3));
    flowers.setColorAt(spots.length + k, col.set(STAR_WILD_TINTS[tint]));
  });
  flowers.count = spots.length + wild.length;
  flowers.name = 'starhaven-moonflowers'; flowers.receiveShadow = true;
  root.add(flowers);

  // The kit's meadow plants: ferns and clover in the hollows, tall wispy grass on the rises, wildflowers here and there.
  const pick = (re: RegExp) => natureNames.filter((n) => re.test(n));
  const families: [string[], number][] = [[pick(/^Fern_1$/), .9], [pick(/^Clover_[12]$/), .7], [pick(/^Grass_Wispy_Tall$|^Grass_Common_Tall$/), .8], [pick(/^Flower_[34]_Single$/), .75], [pick(/^Plant_(1|7)(_Big)?$/), .7]];
  let accents = 0;
  for (let i = 0; i < 1600; i++) {
    const x = (rand(i + 6000) - .5) * 215, z = (rand(i + 6500) - .5) * 260 + 10;
    if (Math.hypot(x / 108, (z - 10) / 130) > .86 || starPlayDistance(x, z) < 1.5 || starSand(x, z) > .3) continue;
    if (starTrailDistance(x, z) < 2.2 || nearStarObjective(x, z, .5) || Math.hypot(x - STAR_CRATER.x, z - STAR_CRATER.z) < STAR_CRATER.r * 1.3) continue;
    // Gathered in drifts, not sprinkled evenly.
    const n = starNoise(x / 17, z / 17, 77);
    if (n < .05) continue;
    const fam = families[Math.floor(rand(i + 7000) * families.length)], names = fam[0];
    if (!names.length) continue;
    const name = names[i % names.length], s = fam[1] * (.75 + .5 * rand(i + 7100));
    if (!clear(name, x, z, s)) continue;
    scatter.add(name, trs(x, height(x, z), z, rand(i + 7200) * 6.28, s));accents++;
  }
  root.userData = {boulders: boulders.length, solidBoulders: boulders.filter((b) => b.solid).length, shards: starCraterShards().length, moonflowers: spots.length + wild.length, wildFlowers: wild.length, accents};
  return {root, update(t) { time.value = t; }};
}
