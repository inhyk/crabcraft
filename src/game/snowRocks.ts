import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SNOW_ROCKS, type SnowRock } from '../sim/world/snowGround';
import { rng } from '../world/noise';
import { addPatch } from '../world/materials';

/*
 * Frostlight's rock outcrops: crags that break through the drifts, for scale and for the horizon. Each is an
 * icosphere chipped by planes into flat fractured faces, jointed along a tilted bedding, roughened, and capped
 * with the snow its ledges hold. Placed by SNOW_ROCKS, which also shapes the drift around each (snowGround.ts) and
 * the colliders (world4Colliders.ts). The material lays snow on faces that can hold it and where the drift meets
 * the stone, reading the baked ground (snowTerrain.ts), so the contact is a soft skirt, not a seam.
 */

// 3D gradient noise for the CPU shape.
function hash3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x1b873593) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
function grad3(h: number, x: number, y: number, z: number): number {
  const a = ((h & 1023) / 1023) * Math.PI * 2, c = ((h >>> 10) & 1023) / 1023 * 2 - 1, s = Math.sqrt(1 - c * c);
  return Math.cos(a) * s * x + Math.sin(a) * s * y + c * z;
}
function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10), ux = q(fx), uy = q(fy), uz = q(fz);
  let out = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = k >> 2;
    const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
    out += w * grad3(hash3(ix + dx, iy + dy, iz + dz, seed), fx - dx, fy - dy, fz - dz);
  }
  return out;
}
const fbm3 = (x: number, y: number, z: number, seed: number, oct: number) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 17); a *= 0.5; f *= 2.13; }
  return s;
};

/** One crag in rock-local units: long axis x, up y, short axis z; 1 is the long half-axis. `detail` overrides the subdivision. */
export function cragGeometry(k: SnowRock, detail = k.r >= 6 ? 34 : 24): THREE.BufferGeometry {
  const R = rng(k.seed * 7919 + 13);
  // Edge subdivisions: ~12k vertices on the big crags, ~6k on the small, so planes, joints and grain all resolve.
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const g = mergeVertices(base);
  base.dispose();
  const hy = (1.9 * k.h) / k.r, sz = 0.55 + R() * 0.15;
  // Fracture planes: mostly steep, so the crag has faces, not a dome; a few low ones break the crown.
  const planes: [THREE.Vector3, number][] = [];
  for (let i = 0; i < 15; i++) {
    const az = R() * Math.PI * 2, el = i < 4 ? 0.45 + R() * 0.8 : -0.2 + R() * 0.55;
    const n = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const support = Math.hypot(n.x, n.y * hy, n.z * sz);
    // Crown planes cut shallower, so no crag ends in a table top.
    planes.push([n, support * (i < 4 ? 0.72 + R() * 0.2 : 0.56 + R() * 0.3)]);
  }
  // Bedding tilted off the horizontal, and one set of vertical joints across it.
  const tilt = 0.25 + R() * 0.35, tiltAz = R() * Math.PI * 2;
  const bed = new THREE.Vector3(Math.sin(tilt) * Math.cos(tiltAz), Math.cos(tilt), Math.sin(tilt) * Math.sin(tiltAz));
  const joint = new THREE.Vector3(Math.cos(tiltAz + 1.3), 0, Math.sin(tiltAz + 1.3));
  const layer = (0.085 + R() * 0.045) * hy, gap = 0.26 + R() * 0.12;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3(), dir = new THREE.Vector3(), outward = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    p.copy(dir);
    // The base flares, so the crag widens into the snow instead of sitting on it.
    if (p.y < 0) { const f = 1 + 0.3 * -p.y; p.x *= f; p.z *= f; }
    p.set(p.x, p.y * hy, p.z * sz);
    // Shattered crest: sharp ridges in the upper half before the planes square it off.
    const ridge = 1 - Math.abs(noise3(p.x * 1.4, p.y * 1.4 / hy, p.z * 1.4, k.seed + 3));
    outward.set(p.x, p.y / hy, p.z / sz).normalize();
    p.addScaledVector(outward, (ridge * ridge - 0.45) * 0.22 * THREE.MathUtils.smoothstep(dir.y, -0.2, 0.6));
    for (const [n, d] of planes) { const over = p.dot(n) - d; if (over > 0) p.addScaledVector(n, -over); }
    // Joints: a groove at each bedding plane and along the vertical set, so the faces break into blocks.
    // Both sets wander and fade, so the blocks differ in size and no face reads as a row of pipes.
    const wob = noise3(p.x * 0.9, p.y * 0.9, p.z * 0.9, k.seed + 7), keep = 0.5 + 0.5 * noise3(p.x * 1.7, p.y * 1.7, p.z * 1.7, k.seed + 8);
    const sb = p.dot(bed) / layer + wob * 0.5, fb = sb - Math.floor(sb);
    const sj = p.dot(joint) / gap + wob * 0.9, fj = sj - Math.floor(sj);
    const groove = Math.max(Math.exp(-((fb - 0.5) ** 2) * 90) * 0.085 * (0.55 + 0.45 * keep), Math.exp(-((fj - 0.5) ** 2) * 140) * 0.065 * keep * keep);
    const rough = fbm3(p.x * 2.6, p.y * 2.6, p.z * 2.6, k.seed, 4) * 0.05 + (Math.abs(noise3(p.x * 8, p.y * 8, p.z * 8, k.seed + 5)) - 0.25) * 0.03;
    p.addScaledVector(outward, rough - groove);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  // Snow pillows on what faces up: a little real thickness on ledges and the crown.
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    if (ny < 0.55) continue;
    const t = THREE.MathUtils.smoothstep(ny, 0.55, 0.92);
    const v = 0.5 + 0.5 * noise3(pos.getX(i) * 3.1, pos.getY(i) * 3.1, pos.getZ(i) * 3.1, k.seed + 9);
    pos.setY(i, pos.getY(i) + t * (0.025 + 0.035 * v));
  }
  g.computeVertexNormals();
  return g;
}

/** Squareness of a boulder's body (2 is an ellipsoid). */
const SQ = 2.7;
/** Polynomial smooth minimum: min(a, b) with the corner rounded over `k`. */
const smin = (a: number, b: number, k: number) => { const t = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - t * t * k * 0.25; };

export interface BoulderShape { r: number; h: number; seed: number }
/**
 * A field boulder in metres, long axis x, the ground line at y = 0: the crags' stone at a boulder's size. An
 * ellipsoid split by a few fracture planes whose edges are rounded off (smooth minimum of the radial distances),
 * worn smooth on top, stepped and grooved along a tilted bedding, cut by one joint set, a few sharp chips at the
 * corners, a snow pillow on what faces up. `detail` is the icosphere subdivision; about 2300 vertices on the big ones.
 * `sharp` divides the rounding of every edge (stones too small to have weathered round).
 */
export function boulderGeometry(b: BoulderShape, detail = b.r >= 1.1 ? 14 : b.r >= 0.6 ? 10 : 8, sharp = 1): THREE.BufferGeometry {
  const R = rng(b.seed * 7919 + 29);
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const g = mergeVertices(base);
  base.dispose();
  const ax = b.r, az = b.r * (0.62 + R() * 0.22), ay = b.h * (1.45 + R() * 0.25), s = Math.min(ax, az);
  // Fracture planes: steep ones give the faces, one or two shallow ones the worn crown.
  const planes: { n: THREE.Vector3; d: number; k: number }[] = [];
  const nSide = 5 + Math.floor(R() * 4);
  for (let i = 0; i < nSide + 2; i++) {
    const crown = i >= nSide, az0 = crown ? R() * Math.PI * 2 : (i / nSide) * Math.PI * 2 + (R() - 0.5) * 0.9;
    const el = crown ? 0.75 + R() * 0.55 : -0.15 + R() * 0.45;
    const n = new THREE.Vector3(Math.cos(el) * Math.cos(az0), Math.sin(el), Math.cos(el) * Math.sin(az0));
    const support = Math.hypot(n.x * ax, n.y * ay, n.z * az);
    planes.push({ n, d: support * (crown ? 0.78 + R() * 0.1 : 0.7 + R() * 0.16), k: (crown ? 0.25 * s : (0.035 + R() * 0.05) * s) / sharp });
  }
  // Chips: small sharp facets where a corner broke away.
  for (let i = 0; i < 3; i++) {
    const az0 = R() * Math.PI * 2, el = 0.2 + R() * 0.7;
    const n = new THREE.Vector3(Math.cos(el) * Math.cos(az0), Math.sin(el), Math.cos(el) * Math.sin(az0));
    planes.push({ n, d: Math.hypot(n.x * ax, n.y * ay, n.z * az) * (0.8 + R() * 0.08), k: 0.05 * s });
  }
  const tilt = 0.2 + R() * 0.4, tiltAz = R() * Math.PI * 2;
  const bed = new THREE.Vector3(Math.sin(tilt) * Math.cos(tiltAz), Math.cos(tilt), Math.sin(tilt) * Math.sin(tiltAz));
  const joint = new THREE.Vector3(Math.cos(tiltAz + 1.4), 0, Math.sin(tiltAz + 1.4));
  const layer = (0.2 + R() * 0.12) * Math.min(1, 0.6 + 0.4 * b.h), gap = (0.55 + R() * 0.3) * b.r;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // Vertex colour: r the occlusion of grooves and partings, g the tone of the bed a vertex lies in, b the drift line's scale.
  const col = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    // A superellipsoid, not an ellipsoid: steep sides and a broad crown, a block rather than a dome.
    let r = (Math.abs(d.x / ax) ** SQ + Math.abs(d.y / ay) ** SQ + Math.abs(d.z / az) ** SQ) ** (-1 / SQ);
    for (const q of planes) { const c = d.dot(q.n); if (c > 1e-3) r = smin(r, q.d / c, q.k); }
    // The foot widens into the snow.
    if (d.y < 0) r *= 1 + 0.22 * -d.y;
    p.copy(d).multiplyScalar(r);
    // Weathering: the crown is worn smooth, the faces keep their grain and their bedding.
    const worn = 1 - 0.65 * THREE.MathUtils.smoothstep(d.y, 0.35, 0.9);
    const lump = fbm3(p.x / s * 1.1, p.y / s * 1.1, p.z / s * 1.1, b.seed, 3) * 0.1 * s;
    const sb = p.dot(bed) / layer + noise3(p.x * 1.3, p.y * 1.3, p.z * 1.3, b.seed + 7) * 0.35, fb = sb - Math.floor(sb);
    const sj = p.dot(joint) / gap + noise3(p.x * 0.9, p.y * 0.9, p.z * 0.9, b.seed + 8) * 0.6, fj = sj - Math.floor(sj);
    // Each bed stands a little proud of the one above it: a stepped profile with a groove at the parting.
    const keep = 0.55 + 0.45 * noise3(p.x * 1.9, p.y * 1.9, p.z * 1.9, b.seed + 6);
    const gb = Math.exp(-((fb - 0.5) ** 2) * 28) * keep, gj = Math.exp(-((fj - 0.5) ** 2) * 90) * keep * keep;
    const step = (fb - 0.5) * 0.05 * worn, groove = (gb * 0.04 + gj * 0.05) * worn;
    const rough = (fbm3(p.x * 6.5, p.y * 6.5, p.z * 6.5, b.seed + 3, 3) * 0.022 + (Math.abs(noise3(p.x * 17, p.y * 17, p.z * 17, b.seed + 5)) - 0.25) * 0.008) * worn;
    p.addScaledVector(d, lump + rough + step - groove);
    pos.setXYZ(i, p.x, p.y - ay * 0.3, p.z);
    const bedTone = hash3(Math.floor(sb), 0, 0, b.seed) / 4294967296;
    col[i * 3] = 1 - 0.55 * Math.max(gb, gj) * worn;
    col[i * 3 + 1] = 0.78 + 0.44 * bedTone;
    col[i * 3 + 2] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  // A pillow of snow on what faces up, a few centimetres thick, thicker in the middle of a ledge.
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    if (ny < 0.5 || pos.getY(i) < 0) continue;
    const t = THREE.MathUtils.smoothstep(ny, 0.5, 0.9), v = 0.5 + 0.5 * noise3(pos.getX(i) * 2.3, pos.getY(i) * 2.3, pos.getZ(i) * 2.3, b.seed + 9);
    pos.setY(i, pos.getY(i) + t * (0.025 + 0.05 * v) * Math.min(1, 0.4 + b.r * 0.5));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Bank snow against a placed rock (world space): vertices within `rise` metres of the drift are pushed out from the
 * rock's axis, most at the ground, so the stone meets the snow in a concave fillet the material paints white.
 */
export function snowSkirt(g: THREE.BufferGeometry, cx: number, cz: number, ground: (x: number, z: number) => number, rise: number, reach: number, seed = 0): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz);
    if (l < 1e-4) continue;
    // A ragged drift line: higher on the windward side, a little uneven all round.
    const a = Math.atan2(dz, dx), top = rise * (0.75 + 0.35 * Math.sin(a * 3 + seed) * Math.sin(a * 2 - seed * 0.7) + 0.25 * Math.cos(a));
    const t = (y - ground(x, z)) / top;
    if (t >= 1) continue;
    // Below the drift line the push dies away again, so no buried vertex is thrown clear of a falling slope.
    const f = reach * (t >= 0 ? (1 - t) ** 2 : Math.max(0, 1 + t * 3) ** 2);
    pos.setXYZ(i, x + (dx / l) * f, y, z + (dz / l) * f);
  }
  g.computeVertexNormals();
  return g;
}

const ROCK_VERTEX_HEAD = /* glsl */ `
varying vec3 vRockWorld;
varying vec3 vRockNormal;
`;

const ROCK_FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D snowGroundTex;
uniform vec4 snowGroundRect;
uniform vec3 rockBedding;
varying vec3 vRockWorld;
varying vec3 vRockNormal;
float rkHash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float rkNoise(vec3 x){
  vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(mix(mix(rkHash(i),rkHash(i+vec3(1,0,0)),f.x),mix(rkHash(i+vec3(0,1,0)),rkHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(rkHash(i+vec3(0,0,1)),rkHash(i+vec3(1,0,1)),f.x),mix(rkHash(i+vec3(0,1,1)),rkHash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.-1.;
}
float rkFbm(vec3 p){return rkNoise(p)*.55+rkNoise(p*2.17+7.1)*.28+rkNoise(p*4.63-3.3)*.17;}
float rkGround(vec2 p){vec2 uv=(p-snowGroundRect.xy)*snowGroundRect.z;return textureLod(snowGroundTex,clamp(uv,0.,1.),0.).x;}
`;

/** The baked ground's uniforms (snowTerrain.ts), read for the snow skirt. */
export type SnowGroundUniforms = { snowGroundTex: { value: THREE.Texture | null }; snowGroundRect: { value: THREE.Vector4 } };
/**
 * The crags' stone: weathered, jointed, snow on what can hold it and a skirt where the drift meets it. World-space
 * meshes only. `skirt` scales the drift's height on the stone, `lie` how readily faces hold snow (1 for the crags)
 * and `lichen` how much ochre crust grows on the faces the sun reaches.
 */
export function rockMaterial(terrain: SnowGroundUniforms, skirt = 1, lie = 1, lichen = 0.35): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0 });
  mat.name = 'frostlight-rock';
  const uniforms = { snowGroundTex: terrain.snowGroundTex, snowGroundRect: terrain.snowGroundRect, rockBedding: { value: new THREE.Vector3(0.2, 0.97, 0.1).normalize() } };
  addPatch(mat, `frostlight-rock${skirt}${lie}${lichen}`, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ROCK_VERTEX_HEAD}`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRockWorld=(modelMatrix*vec4(transformed,1.)).xyz;vRockNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROCK_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 rW=vRockWorld,rN=normalize(vRockNormal);
        float rn1=rkFbm(rW*.42),rn2=rkNoise(rW*2.3),rn3=rkNoise(rW*9.);
        // Weathered stone: cool dark grey with a crystalline speckle, rust where water ran down the bedding, and
        // dark streaks under every ledge where melt runs down the face.
        float rBed=sin(dot(rW,rockBedding)*5.3+rn1*2.6)*.5+.5;
        float rStreak=smoothstep(.1,.6,rkNoise(vec3(rW.x*3.1,rW.y*.22,rW.z*3.1)))*(1.-rN.y*rN.y);
        float rSpeck=smoothstep(.55,.85,rkNoise(rW*31.));
        vec3 rRock=mix(vec3(.032,.036,.043),vec3(.088,.09,.096),clamp(.5+.55*rn1+.25*rn2,0.,1.));
        rRock=mix(rRock,rRock*vec3(1.22,1.,.82),smoothstep(.62,.95,rBed)*.55)*(1.+.18*rn3)*(1.-rStreak*.45)+rSpeck*.035;
        #ifdef USE_COLOR
         // Boulders carry their partings (r, occlusion) and the tone of each bed (g).
         rRock*=vColor.r*vColor.r*mix(1.,vColor.g,.85);
        #endif
        // Snow lies where the face can hold it, thicker in hollows of the noise, and skirts the drift line.
        float rLie=smoothstep(.5,.72,rN.y+.16*rn1+.07*rn2-${((1 - lie) * 0.4).toFixed(3)});
        float rSkirt=1.-smoothstep(${(0.04 * skirt).toFixed(3)},${(0.5 * skirt).toFixed(3)}+${(0.35 * skirt).toFixed(3)}*(rn2*.5+.5),rW.y-rkGround(rW.xz));
        #ifdef USE_COLOR
         // b scales the drift line and the snow lying on top: low on stones too small to hold either.
         rSkirt*=vColor.b;rLie*=smoothstep(.15,1.,vColor.b);
        #endif
        float rSnow=max(rLie,rSkirt);
        // Crustose lichen on the faces the low sun reaches (south, +z) and never under snow: ochre rosettes,
        // a rust one here and there, grey-green crust between, in patches, not a wash.
        float rFace=smoothstep(.1,.75,rN.z*.85+rN.x*.3)*(1.-smoothstep(.4,.75,rN.y));
        float rCell=rkNoise(rW*6.3+11.)*.6+rkNoise(rW*15.-4.)*.4,rWhere=rkNoise(rW*1.1+2.)*.5+.5;
        float rLich=smoothstep(.62,.74,rCell*.5+.5)*smoothstep(.45,.8,rWhere*rFace)*${lichen.toFixed(3)}*(1.-rSnow);
        vec3 rLc=mix(vec3(.19,.13,.035),vec3(.24,.085,.022),smoothstep(.6,.85,rkNoise(rW*.9+3.)*.5+.5));
        rLc=mix(rLc,vec3(.085,.09,.07),smoothstep(.2,.7,rkNoise(rW*3.3-7.))*.6);
        rRock=mix(rRock,rLc*(.85+.3*rn3),rLich*.85);
        diffuseColor.rgb=mix(rRock,vec3(.79,.86,.97),rSnow);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=mix(.86,.62,rSnow);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          // Grain, pitting and the fracture lines in the stone's normal; the snow stays smooth. Fades with distance.
          float rFade=(1.-rSnow*.85)*(1.-smoothstep(15.,45.,length(vViewPosition)));
          if(rFade>.01){
            vec3 q=rW;float e=.035;
            #define RK_H(x) (rkNoise((x)*2.7)*.4+rkNoise((x)*11.)*.18+abs(rkNoise((x)*5.3))*.22)
            float b0=RK_H(q);
            vec3 gw=vec3(RK_H(q+vec3(e,0.,0.))-b0,RK_H(q+vec3(0.,e,0.))-b0,RK_H(q+vec3(0.,0.,e))-b0)/e;
            vec3 nw=normalize(rN-(gw-dot(gw,rN)*rN)*.075*rFade);
            normal=normalize((viewMatrix*vec4(nw,0.)).xyz);
          }
          // Snow banked against the stone lies as the drift does: light it with the drift's normal.
          normal=normalize(mix(normal,(viewMatrix*vec4(0.,1.,0.,0.)).xyz,rSkirt*.7));
        }`);
  });
  return mat;
}

/** The crags as one group of meshes sharing one material. `ground` is the gameplay height; `terrain` the bake's uniforms. */
export function snowRocks(ground: (x: number, z: number) => number, terrain: SnowGroundUniforms): THREE.Group {
  const group = new THREE.Group();
  group.name = 'frostlight-rock-outcrops';
  const mat = rockMaterial(terrain);
  for (const k of SNOW_ROCKS) {
    const geo = cragGeometry(k);
    // Sink the crag until its widest section is under the lowest snow around it.
    let low = Infinity;
    for (let a = 0; a < 16; a++) for (const f of [0, 0.5, 1]) {
      const ang = (a / 16) * Math.PI * 2;
      low = Math.min(low, ground(k.x + Math.cos(ang) * k.r * f, k.z + Math.sin(ang) * k.r * f));
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'frostlight-rock';
    mesh.position.set(k.x, low - 0.32 * k.h, k.z);
    mesh.rotation.y = k.yaw;
    mesh.scale.setScalar(k.r);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.rock = k;
    group.add(mesh);
  }
  return group;
}
