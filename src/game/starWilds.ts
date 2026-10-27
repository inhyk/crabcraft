import * as THREE from 'three';
import {starGroundColor} from './world2Ground';
import {starCoast, starNoise, starSand, STAR_CRATER} from './starFieldLayout';
import {starBoulders, starPlayDistance} from './starFieldSpots';
import {nearStarObjective, starForestSpots, starLots, starTrailDistance, STAR_TRAILS} from './world2Settlement';
import {starDoorLamps} from './starRooftops';
import type {StarGlowSource} from './starLight';

/*
 * Starhaven's wilds by moonlight (star r5): the fields outside the town are a value step lighter than the town's
 * lawns, swell lighter on the rises and sink darker in the hollows, and are dotted with light that also leads the
 * way: clumps of glowing moon-flowers every fifteen to twenty metres, fireflies over them and along the trails.
 * Positions only here (the ground bake and the flowers read the same lists), plus the fireflies' one draw.
 */

const smooth = THREE.MathUtils.smoothstep;
const rect = (x: number, z: number, ax: number, bx: number, az: number, bz: number) => Math.hypot(Math.max(ax - x, 0, x - bx), Math.max(az - z, 0, z - bz));
const rand = (i: number) => { const a = Math.sin(i * 73.13 + 19.7) * 43758.5453; return a - Math.floor(a); };

/** 0 in the town and on the sanctum's ring, 1 out in the wilds. */
export function starWildness(x: number, z: number): number {
  const town = 1 - smooth(rect(x, z, -50, 50, 6, 97), 3, 14);
  const arena = 1 - smooth(Math.hypot(x, z + 75), 26, 34);
  return (1 - town) * (1 - arena);
}

/** How far (x, z) stands above (+) or below (-) the ground round it within about 7 m, in metres. */
export function starRelief(height: (x: number, z: number) => number, x: number, z: number): number {
  let s = 0;
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; s += height(x + Math.cos(a) * 7, z + Math.sin(a) * 7); }
  return height(x, z) - s / 8;
}

const teal = new THREE.Color(), violet = new THREE.Color(), white = new THREE.Color(1, 1, 1);
/**
 * The ground's region tint with the wilds' moonlight: a value step over the town's turf, rises lighter and hollows
 * darker (the shape of the land reads from above), and slow teal and violet swathes tens of metres across.
 */
export function starWildTint(x: number, z: number, y: number, height: (x: number, z: number) => number, out: THREE.Color): THREE.Color {
  starGroundColor(x, z, y, out);
  const w = starWildness(x, z);
  if (w <= 0) return out;
  const relief = THREE.MathUtils.clamp(starRelief(height, x, z), -1.6, 1.6);
  const swathe = starNoise(x / 26, z / 26, 311) + starNoise(x / 9, z / 9, 312) * .25;
  teal.setRGB(.92, 1.06, 1.04);violet.setRGB(1.06, .94, 1.1);
  const hue = swathe > 0 ? teal.lerp(white, 1 - smooth(swathe, 0, .35)) : violet.lerp(white, 1 - smooth(-swathe, 0, .35));
  out.multiply(hue);
  return out.multiplyScalar(1 + w * (.5 + relief * .16 + swathe * .12));
}

export interface StarWildClump { x: number; z: number; r: number; n: number; tint: 0 | 1 | 2 }
let clumpCache: StarWildClump[] | null = null;
/**
 * Moon-flower clumps through the wilds, one every fifteen to twenty metres: Poisson-spaced on open meadow, off the
 * trails, the quest sites, the trees and the stones, more of them a few metres off a trail (where they lead).
 */
export function starWildClumps(): StarWildClump[] {
  if (clumpCache) return clumpCache;
  const out: StarWildClump[] = [];
  const trees = starForestSpots(), stones = starBoulders();
  for (let i = 0; i < 4000 && out.length < 64; i++) {
    const x = (rand(i + 11) - .5) * 210, z = (rand(i + 4011) - .5) * 250 + 10;
    if (starWildness(x, z) < .9 || starCoast(x, z).r > .8 || starSand(x, z) > .15) continue;
    if (starPlayDistance(x, z) < 4 || nearStarObjective(x, z, 1.5)) continue;
    const t = starTrailDistance(x, z);
    if (t < 3) continue;
    // Near a trail they guide; further out fewer of them.
    if (t > 9 && rand(i + 8011) < .45) continue;
    if (Math.hypot(x - STAR_CRATER.x, z - STAR_CRATER.z) < STAR_CRATER.r * 1.4) continue;
    if (trees.some((p) => Math.hypot(x - p.x, z - p.z) < 2.6)) continue;
    if (stones.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + 1.6)) continue;
    if (out.some((c) => Math.hypot(x - c.x, z - c.z) < 15)) continue;
    out.push({x, z, r: 1.1 + rand(i + 12011) * .9, n: 5 + Math.floor(rand(i + 16011) * 4), tint: (rand(i + 20011) < .5 ? 0 : rand(i + 20011) < .85 ? 1 : 2) as 0 | 1 | 2});
  }
  clumpCache = out;
  return out;
}
export const STAR_WILD_TINTS = ['#5ff0d6', '#b47dff', '#c9d6ff'] as const;

/** The clumps' light on the ground (starLight.ts bakes it). */
export function starWildGlows(): StarGlowSource[] {
  return starWildClumps().map((c) => ({x: c.x, z: c.z, radius: c.r + 1.1, color: STAR_WILD_TINTS[c.tint], strength: 1.1}));
}

const FLY_VERT = /* glsl */ `
uniform float ffTime;
uniform float ffScale;
attribute float aSeed;
varying float vFfGlow;
varying float vFfTone;
void main(){
  float s=aSeed*43.7;
  // A slow wander round its home, a bob, and a blink on its own clock (lit about a third of the time).
  vec3 p=position+vec3(sin(ffTime*.31+s)*.9+sin(ffTime*.73+s*1.7)*.3,sin(ffTime*.53+s*2.3)*.35,cos(ffTime*.27+s*.6)*.9+cos(ffTime*.81+s*1.3)*.3);
  float blink=sin(ffTime*(.55+fract(s)*.5)+s*6.2831);
  vFfGlow=smoothstep(.15,.85,blink);
  vFfTone=fract(s*.37);
  vec4 mv=modelViewMatrix*vec4(p,1.);
  float d=-mv.z;
  // Far ones fade into the haze rather than shrink to a dot.
  vFfGlow*=1.-smoothstep(55.,90.,d);
  gl_Position=projectionMatrix*mv;
  gl_PointSize=clamp(ffScale*(.9+.4*vFfGlow)/max(d,1.),2.5,40.);
  if(vFfGlow<.01)gl_Position=vec4(0.,0.,-2.,1.);
}`;
const FLY_FRAG = /* glsl */ `
varying float vFfGlow;
varying float vFfTone;
void main(){
  vec2 q=gl_PointCoord*2.-1.;float r=dot(q,q);
  if(r>1.)discard;
  // A hot core in a soft halo; pale green-gold or teal.
  float a=exp(-r*5.)*.75+exp(-r*28.)*1.6;
  vec3 c=mix(vec3(.75,1.,.55),vec3(.45,1.,.9),step(.55,vFfTone));
  gl_FragColor=vec4(c*a*vFfGlow*2.6,1.);
}`;

/** Fireflies over the clumps and along the trails outside the town: one draw of points, animated on the GPU. */
export class StarFireflies {
  readonly points: THREE.Points;
  private readonly uniforms = {ffTime: {value: 0}, ffScale: {value: 150}};
  readonly count: number;
  constructor(height: (x: number, z: number) => number) {
    const pos: number[] = [], seed: number[] = [];
    let k = 0;
    const put = (x: number, z: number) => { pos.push(x, height(x, z) + .35 + rand(k * 7 + 3) * 1.3, z); seed.push(rand(k * 11 + 5)); k++; };
    for (const [ci, c] of starWildClumps().entries()) for (let j = 0; j < 7; j++) { const a = rand(ci * 31 + j) * 6.28, d = .6 + rand(ci * 37 + j) * 3.2; put(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d); }
    for (const [ti, t] of STAR_TRAILS.entries()) for (let i = 1; i < t.length; i++) {
      const [ax, az] = t[i - 1], [bx, bz] = t[i], len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += 2.6) {
        const u = d / len, side = rand(ti * 900 + i * 50 + d) < .5 ? -1 : 1, off = 2.2 + rand(ti * 700 + i * 40 + d) * 4;
        const x = ax + (bx - ax) * u - (bz - az) / len * off * side, z = az + (bz - az) * u + (bx - ax) / len * off * side;
        if (starWildness(x, z) < .8) continue;
        put(x, z);
      }
    }
    this.count = k;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    geo.computeBoundingSphere();geo.boundingSphere!.radius += 3;
    const mat = new THREE.ShaderMaterial({uniforms: this.uniforms, vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
    mat.name = 'starhaven-fireflies';
    this.points = new THREE.Points(geo, mat);this.points.name = 'starhaven-fireflies';
  }
  update(time: number, pixelRatio: number, quality: 'high' | 'low') {
    this.uniforms.ffTime.value = time;this.uniforms.ffScale.value = 150 * pixelRatio;
    // Low quality keeps the clumps' fireflies and drops most of the trails'.
    this.points.geometry.setDrawRange(0, quality === 'low' ? this.count >> 1 : this.count);
  }
}

/**
 * The town's dead-end ways (end point and outward direction, star r5): the paving frays out there (starPaving.ts)
 * and a trodden earth path runs on to the nearest door, or a few metres into the grass when no door is near.
 */
export const STAR_WAY_ENDS: readonly (readonly [number, number, number, number, number])[] = [
  // x, z, direction x, z, way width
  [26, 55, 1, 0, 7], [-26, 55, -1, 0, 7], [-25, 36, -1, 0, 2.4], [20, 35, 1, 0, 2.4], [-22, 82, -1, 0, 2.4], [24, 84, 1, 0, 2.4],
];
export interface StarSpur { pts: [number, number][]; w: number }
let spurCache: StarSpur[] | null = null;
/** Each dead end's earth path: a curve from under the frayed stones to the nearest door (a step out from its sill). */
export function starWaySpurs(): StarSpur[] {
  if (spurCache) return spurCache;
  const doors = starDoorLamps(starLots()).map((d) => [d.pos.x + Math.sin(d.yaw) * 1.4, d.pos.z + Math.cos(d.yaw) * 1.4] as const);
  spurCache = STAR_WAY_ENDS.map(([x, z, dx, dz, width]) => {
    const sx = x - dx * 2, sz = z - dz * 2;
    let best: readonly [number, number] | null = null, bd = 24;
    for (const d of doors) { const l = Math.hypot(d[0] - sx, d[1] - sz), ahead = (d[0] - sx) * dx + (d[1] - sz) * dz; if (ahead > 2 && l < bd) { bd = l; best = d; } }
    const [ex, ez] = best ?? [sx + dx * 8, sz + dz * 8], reach = Math.max(3, Math.hypot(ex - sx, ez - sz) * .5);
    const cx = sx + dx * reach, cz = sz + dz * reach, pts: [number, number][] = [];
    for (let k = 0; k <= 16; k++) { const u = k / 16, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u; pts.push([a * sx + b * cx + c * ex, a * sz + b * cz + c * ez]); }
    return {pts, w: Math.min(2.2, width * .45 + .4) * (best ? 1 : .8)};
  });
  return spurCache;
}
/** 0..1: how trodden (x, z) is by the dead ends' earth paths. */
export function starSpurWear(x: number, z: number): number {
  let wear = 0;
  for (const s of starWaySpurs()) {
    const [x0, z0] = s.pts[0], [x1, z1] = s.pts[s.pts.length - 1];
    if (x < Math.min(x0, x1) - 4 || x > Math.max(x0, x1) + 4 || z < Math.min(z0, z1) - 4 || z > Math.max(z0, z1) + 4) continue;
    let best = 1e9, at = 0;
    for (let k = 1; k < s.pts.length; k++) {
      const [ax, az] = s.pts[k - 1], [bx, bz] = s.pts[k], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (d < best) { best = d; at = (k - 1 + u) / (s.pts.length - 1); }
    }
    // Narrower toward the door, ragged at the edge.
    const half = s.w * .5 * (1 - .35 * at) + starNoise(x / 1.7, z / 1.7, 331) * .25;
    wear = Math.max(wear, 1 - smooth(best, half * .55, half * 1.05));
  }
  return wear;
}
