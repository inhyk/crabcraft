import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe, tube} from '../world/geom';
import {rng} from '../world/noise';
import {addPatch} from '../world/materials';
import {FROST_NOISE} from './frostPaving';
import type {IslandPath} from './islandPaths';
import {dawnRope, dawnSandstone, dawnWood, solidPart, woodPart} from './dawnMaterials';

/*
 * Dawnharbor's harbour front, south of the town. Walkable: a paved promenade along the shore, joined to the avenue.
 * Past the walk limit (DAWN_BOUNDS, radial 0.81), so pure scenery and never solid: a sandstone parapet with lamp
 * piers, the paved quay, the quay wall dropping to the water (dressed courses, wet and weeded below the tide line),
 * a timber pier reached by a stair, a moored sailing boat and skiffs with their lines, one skiff drawn up on the
 * sand, a fishing boat riding at anchor, and net racks. Shapes are procedural; dressing with kit props is in
 * dawnDressing.ts.
 */

const RX = 122, RZ = 149, CZ = 3;
/** The harbour's span along the shore, as angles round the island (0 is due south, +x positive). */
export const HARBOUR_A0 = -.34, HARBOUR_A1 = .27;
/** Radial positions (of the island's ellipse): promenade centre, parapet, quay deck centre, quay wall face. */
const R_PROM = .796, R_PARA = .818, R_QUAY = .838, R_WALL = .886;
/** The quay's built deck runs from the island's own edge (radial 0.86, where it drops) out to the wall. */
const R_DECK0 = .852;
/** The pier's angle (x ≈ -8) and its deck height; the sea is at y = 0.2. */
const PIER_A = -.0763, DECK_Y = 1.35, SEA_Y = .2;

export const coastAt = (rr: number, a: number) => new THREE.Vector2(Math.sin(a) * RX * rr, CZ + Math.cos(a) * RZ * rr);
/** Outward unit normal of the island's ellipse at angle a. */
const outward = (a: number) => { const p = coastAt(1, a); return new THREE.Vector2(p.x / (RX * RX), (p.y - CZ) / (RZ * RZ)).normalize(); };
const arc = (rr: number, a0: number, a1: number, n: number) => Array.from({length: n + 1}, (_, i) => coastAt(rr, a0 + (a1 - a0) * i / n));

/** The promenade, its link to the avenue and the quay deck, paved with the town's streets. */
export function harbourPaths(): IslandPath[] {
  const prom = arc(R_PROM, HARBOUR_A0 + .03, HARBOUR_A1 - .02, 7).map(p => [p.x, p.y] as [number, number]);
  const quay = arc(R_QUAY, HARBOUR_A0, HARBOUR_A1, 7).map(p => [p.x, p.y] as [number, number]);
  return [
    {points: [[0, 93], [0, prom.length ? coastAt(R_PROM, 0).y - 1 : 117]], width: 6, trim: true},
    {points: prom, width: 6.4, trim: true},
    {points: quay, width: 6.2, trim: false},
  ];
}

const QUAY_HEAD = /* glsl */ `
varying vec2 vQw;
varying vec3 vQW;
${FROST_NOISE}
`;
/** Dressed courses on the quay's face: uv is (metres along the wall, height y). */
function quayWallMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnharbor-quay-wall', color: '#ffffff', roughness: .9});
  addPatch(m, 'dawn-quay-wall', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vQw;\nvarying vec3 vQW;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvQw=uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvQW=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${QUAY_HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        float ch=.46,row=floor(vQw.y/ch),fy=fract(vQw.y/ch);
        float bl=mix(.9,1.5,fpHash12(vec2(row,3.)));float xs=vQw.x+fpHash12(vec2(row,9.))*bl,col=floor(xs/bl),fx=fract(xs/bl);
        float id=fpHash12(vec2(col,row));
        float jx=min(fx,1.-fx)*bl,jy=min(fy,1.-fy)*ch,j=min(jx,jy);
        float joint=1.-smoothstep(.012,.03,j+fpNoise(vQw*9.)*.006);
        vec3 c=mix(vec3(.42,.3,.18),vec3(.58,.47,.32),id)*(.85+.25*(fpNoise(vQw*3.+id*7.)*.5+.5));
        c*=.92+.12*fpNoise(vQw*17.);
        // Each block's face is pillowed: darker toward its edges.
        c*=.8+.2*smoothstep(0.,.12,j);
        c=mix(c,vec3(.12,.09,.06),joint*.8);
        // Tide: wet and dark below the high-water line, weed and algae just above the sea, a salt line at the top.
        float y=vQW.y,hw=1.25+fpNoise(vec2(vQw.x*.3,1.))*.15;
        float wet=1.-smoothstep(hw-.1,hw+.05,y);
        c=mix(c,c*vec3(.45,.43,.4),wet);
        float weed=(1.-smoothstep(.25,.85+fpNoise(vec2(vQw.x*1.3,3.))*.25,y))*smoothstep(-.6,.1,y);
        c=mix(c,mix(vec3(.05,.08,.03),vec3(.12,.15,.06),fpNoise(vQw*6.)*.5+.5),weed*.85);
        c=mix(c,vec3(.75,.72,.64),(1.-smoothstep(0.,.06,abs(y-hw-.04)))*.35);
        diffuseColor.rgb*=c;
        float qWet=wet;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(.9,.45,qWet);');
  });
  m.customProgramCacheKey = () => 'dawn-quay-wall';
  return m;
}

/** Painted clinker hull: uv.x along the boat (0 stern, 1 bow), uv.y round the section (0 gunwale, 1 keel). */
function hullMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnharbor-hull', color: '#ffffff', roughness: .7, vertexColors: true, side: THREE.DoubleSide});
  addPatch(m, 'dawn-hull', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vHu;\nvarying vec3 vHW;\nattribute float aInside;\nvarying float vIn;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvHu=uv;vIn=aInside;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvHW=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vHu;\nvarying vec3 vHW;\nvarying float vIn;\n${FROST_NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // Strakes: seven planks round the section, each lap a dark line with a lit edge above it.
        float sk=vHu.y*7.,fs=fract(sk),lap=1.-smoothstep(0.,.08,fs),edge=smoothstep(.9,1.,fs);
        float grain=fpNoise(vec2(vHu.x*40.,floor(sk)*3.7+vHu.y*30.))*.5+.5;
        vec3 wood=mix(vec3(.28,.19,.12),vec3(.48,.36,.24),grain);
        // Paint (vertex colour) above the waterline band, worn through along the laps and at the stem.
        float wear=smoothstep(.55,.85,fpNoise(vec2(vHu.x*9.,sk*2.))*.5+.5+lap*.3+smoothstep(.85,1.,abs(vHu.x-.5)*2.)*.3);
        vec3 paint=mix(vColor.rgb,vColor.rgb*.7,fpNoise(vHW.xz*3.)*.5+.5);
        vec3 c=mix(paint,wood,wear*.8);
        // A white sheer stripe under the gunwale and dark antifouling below the waterline.
        c=mix(c,vec3(.78,.75,.68),step(vHu.y,.08)*(1.-wear*.5));
        float wl=vHW.y-${(SEA_Y + .12).toFixed(2)};
        c=mix(c,vec3(.17,.06,.04),(1.-smoothstep(-.02,.02,wl))*step(vIn,.5));
        c=mix(c,c*.6,(1.-smoothstep(.0,.25,abs(wl)))*.6*step(vIn,.5));
        c*=1.-lap*.45;c*=1.+edge*.12;
        // Inside: bare oiled planks, darker in the bilge.
        c=mix(c,wood*mix(1.,.55,smoothstep(.5,1.,vHu.y)),vIn);
        diffuseColor.rgb=c;`);
  });
  m.customProgramCacheKey = () => 'dawn-hull';
  return m;
}

/** A knotted net: square meshes of cord, the gaps discarded. Plane uv in metres. */
function netMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnharbor-net', color: '#ffffff', roughness: .95, side: THREE.DoubleSide, alphaTest: .5});
  addPatch(m, 'dawn-net', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vNu;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvNu=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vNu;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec2 g=vNu/.12,f=abs(fract(g)-.5);
        float w=fwidth(g.x)+fwidth(g.y);
        float cord=smoothstep(.44-w,.44,max(f.x,f.y));
        // Past a cell a pixel, keep the cords' share of the pixels, dithered, so the net stays a net.
        float dith=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
        diffuseColor.a=w<.6?cord:step(dith,.28);
        diffuseColor.rgb*=mix(vec3(.3,.25,.17),vec3(.5,.42,.28),fract(sin(dot(floor(g),vec2(12.9,78.2)))*43758.5));`);
  });
  m.customProgramCacheKey = () => 'dawn-net';
  return m;
}

interface HullSpec {len: number; beam: number; depth: number; paint: string; seed: number}
/** A double-ended clinker hull (outer and inner skins, a capping rail), stern at -z, bow at +z, gunwale at y = 0. */
function hullGeometry(h: HullSpec): {outer: THREE.BufferGeometry; rail: THREE.BufferGeometry} {
  const NS = 22, NR = 9, pos: number[] = [], uv: number[] = [], inside: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color(h.paint);
  const sheer = (t: number) => .12 * Math.pow(Math.abs(t * 2 - 1), 2.2) + (t > .5 ? .06 * (t * 2 - 1) : 0);
  const beam = (t: number) => h.beam / 2 * Math.pow(Math.sin(Math.PI * Math.min(.999, Math.max(.001, t * .96 + .02))), t > .5 ? .62 : .5);
  const depth = (t: number) => h.depth * (.55 + .45 * Math.pow(Math.sin(Math.PI * t), .5));
  const surf = (t: number, s: number, side: number, inset: number) => {
    const th = s * Math.PI / 2, w = Math.max(0, beam(t) - inset), d = Math.max(.01, depth(t) - inset);
    return new THREE.Vector3(side * w * Math.pow(Math.cos(th), .8), sheer(t) - d * Math.pow(Math.sin(th), 1.25), (t - .5) * h.len);
  };
  for (const [skin, inset] of [[0, 0], [1, .04]] as const) for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) for (let j = 0; j <= NR; j++) {
      const t = i / NS, s = j / NR, p = surf(t, s, side, inset);
      pos.push(p.x, p.y, p.z); uv.push(t, s); inside.push(skin); col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
      const a = base + i * (NR + 1) + j, b = a + NR + 1;
      // Wind each skin so its front face looks outward (outer) or inward (inner).
      if ((side > 0) !== (skin === 1)) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const outer = new THREE.BufferGeometry();
  outer.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  outer.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  outer.setAttribute('aInside', new THREE.Float32BufferAttribute(inside, 1));
  outer.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  outer.setIndex(idx); outer.computeVertexNormals();
  // The capping rail along each gunwale.
  const rails: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) rails.push(tube(Array.from({length: NS + 1}, (_, i) => surf(i / NS, 0, side, .02).add(new THREE.Vector3(0, .02, 0))), () => .035, 5));
  return {outer: outer.toNonIndexed(), rail: mergeGeometries(rails.map(g => solidPart(g, new THREE.Matrix4())), false)!};
}

export interface DawnHarbour {group: THREE.Group; update(time: number): void}

export function dawnHarbour(height: (x: number, z: number) => number): DawnHarbour {
  const group = new THREE.Group(); group.name = 'dawnharbor-harbour';
  const stone: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [], rope: THREE.BufferGeometry[] = [], hulls: THREE.BufferGeometry[] = [], nets: THREE.BufferGeometry[] = [];
  const R = rng(4242);
  const yawOf = (d: THREE.Vector2) => Math.atan2(d.x, d.y);
  const M = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  const box = new THREE.BoxGeometry(1, 1, 1);
  // A bevelled block for masonry, centred, long along local x.
  const bevel = (w: number, h: number, d: number) => {
    const s = new THREE.Shape(), b = Math.min(.05, h * .2);
    s.moveTo(-w / 2 + b, -h / 2); s.lineTo(w / 2 - b, -h / 2); s.lineTo(w / 2, -h / 2 + b); s.lineTo(w / 2, h / 2 - b); s.lineTo(w / 2 - b, h / 2); s.lineTo(-w / 2 + b, h / 2); s.lineTo(-w / 2, h / 2 - b); s.lineTo(-w / 2, -h / 2 + b); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: d - .06, bevelEnabled: true, bevelThickness: .03, bevelSize: .025, bevelSegments: 1});
    return g.translate(0, 0, -(d - .06) / 2);
  };

  // Parapet: plinth, wall and coping in 2.4 m bays along the walk limit, a taller pier every fifth bay with a lamp.
  const lampSpots: {x: number; y: number; z: number; yaw: number}[] = [];
  {
    const n = Math.round((HARBOUR_A1 - HARBOUR_A0) * RZ * R_PARA / 2.4);
    const wall = bevel(2.36, .62, .42), cap = bevel(2.42, .12, .56), plinth = bevel(2.4, .2, .54), pier = bevel(.7, 1.05, .7), pierCap = bevel(.82, .14, .82);
    for (let i = 0; i <= n; i++) {
      const a = HARBOUR_A0 + (HARBOUR_A1 - HARBOUR_A0) * i / n, p = coastAt(R_PARA, a), o = outward(a), yaw = yawOf(o), y = height(p.x, p.y);
      if (i < n) {
        const a2 = HARBOUR_A0 + (HARBOUR_A1 - HARBOUR_A0) * (i + .5) / n, q = coastAt(R_PARA, a2), yq = height(q.x, q.y), oy = yawOf(outward(a2));
        stone.push(solidPart(plinth, M(q.x, yq + .02, q.y, oy)), solidPart(wall, M(q.x, yq + .43, q.y, oy)), solidPart(cap, M(q.x, yq + .8, q.y, oy)));
      }
      if (i % 5 === 0) {
        stone.push(solidPart(pier, M(p.x, y + .45, p.y, yaw)), solidPart(pierCap, M(p.x, y + 1.02, p.y, yaw)));
        lampSpots.push({x: p.x, y: y + 1.09, z: p.y, yaw: yawOf(o.clone().negate())});
      }
    }
    [wall, cap, plinth, pier, pierCap].forEach(g => g.dispose());
  }

  // The quay wall: a strip from the deck down below the sea; the deck over the shore behind it; returns at both ends.
  // uv is (metres along, metres down the face or across the deck), so one course pattern dresses all three.
  const wallGeo = (() => {
    const n = 90, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: number[], ub: number[], uc: number[], ud: number[]) => {
      const k = pos.length / 3; pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z); uv.push(...ua, ...ub, ...uc, ...ud); idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    };
    let along = 0;
    const A0 = HARBOUR_A0 - .01, A1 = HARBOUR_A1 + .01, TOP = 4.02, FOOT = -2.5;
    for (let i = 0; i < n; i++) {
      const a = A0 + (A1 - A0) * i / n, b = A0 + (A1 - A0) * (i + 1) / n;
      const pa = coastAt(R_WALL, a), pb = coastAt(R_WALL, b), qa = coastAt(R_DECK0, a), qb = coastAt(R_DECK0, b), L = pa.distanceTo(pb);
      const v = (p: THREE.Vector2, y: number) => new THREE.Vector3(p.x, y, p.y);
      // Face (seen from the sea) and deck (seen from above): wound so their fronts face out and up.
      quad(v(pa, TOP), v(pa, FOOT), v(pb, TOP), v(pb, FOOT), [along, TOP], [along, FOOT], [along + L, TOP], [along + L, FOOT]);
      const w = pa.distanceTo(qa);
      quad(v(qa, TOP), v(pa, TOP), v(qb, TOP), v(pb, TOP), [along, 20 + w], [along, 20], [along + L, 20 + w], [along + L, 20]);
      along += L;
    }
    for (const [a, s] of [[A0, -1], [A1, 1]] as const) {
      const p = coastAt(R_WALL, a), q = coastAt(R_DECK0, a), v = (p: THREE.Vector2, y: number) => new THREE.Vector3(p.x, y, p.y), w = p.distanceTo(q);
      if (s < 0) quad(v(q, TOP), v(q, FOOT), v(p, TOP), v(p, FOOT), [0, TOP], [0, FOOT], [w, TOP], [w, FOOT]);
      else quad(v(p, TOP), v(p, FOOT), v(q, TOP), v(q, FOOT), [0, TOP], [0, FOOT], [w, TOP], [w, FOOT]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  })();
  {
    const coping = bevel(1.16, .26, .78);
    const n = Math.round((HARBOUR_A1 - HARBOUR_A0) * RZ * R_WALL / 1.2);
    for (let i = 0; i < n; i++) {
      const a = HARBOUR_A0 + (HARBOUR_A1 - HARBOUR_A0) * (i + .5) / n, p = coastAt(R_WALL - .0012, a), o = outward(a);
      // Leave the stair's head open.
      if (Math.abs(a - PIER_A) < .008) continue;
      stone.push(solidPart(coping, M(p.x, 4.0 + (R() - .5) * .025, p.y, yawOf(o) + (R() - .5) * .02)));
      // Iron mooring rings and stone bollards along the edge.
      if (i % 6 === 3) {
        const b = coastAt(R_WALL - .006, a);
        stone.push(solidPart(lathe([[0, 0], [.2, 0], [.2, .08], [.15, .14], [.13, .5], [.18, .56], [.18, .62], [.1, .68], [0, .7]], 16), M(b.x, 4.1, b.y)));
      }
    }
    coping.dispose();
  }

  // The pier: a stair down the wall, then a timber deck on log piles out into the sea.
  const pierPoint = coastAt(R_WALL, PIER_A), pierDir = outward(PIER_A), pierYaw = yawOf(pierDir), side = new THREE.Vector2(pierDir.y, -pierDir.x);
  const at = (along: number, across: number) => new THREE.Vector2(pierPoint.x + pierDir.x * along + side.x * across, pierPoint.y + pierDir.y * along + side.y * across);
  const PIER_LEN = 21, PIER_W = 2.6, STAIR = 3.8;
  {
    const plank = new THREE.BoxGeometry(1, 1, 1);
    // Stair: two stringers and treads from the quay top to the deck.
    const steps = 11;
    for (let k = 0; k < steps; k++) {
      const f = (k + .5) / steps, p = at(.15 + f * STAIR, 0), y = 4.02 - (4.02 - DECK_Y) * (k + 1) / steps + .03;
      wood.push(woodPart(plank, M(p.x, y, p.y, pierYaw + Math.PI / 2, PIER_W - .5, .07, STAIR / steps + .04), '#000', 0));
    }
    for (const s of [-1, 1]) {
      const a = at(STAIR / 2 + .15, s * (PIER_W / 2 - .2)), slope = Math.atan2(4.02 - DECK_Y, STAIR);
      wood.push(woodPart(plank, M(a.x, (4.02 + DECK_Y) / 2 - .12, a.y, pierYaw, .08, .3, Math.hypot(STAIR, 4.02 - DECK_Y) + .2, slope), null, 0, new THREE.Vector3(0, 0, 1)));
      // A hand rope on posts beside the stair.
      const top = at(.3, s * (PIER_W / 2 - .05)), bot = at(STAIR, s * (PIER_W / 2 - .05));
      for (const [q, y] of [[top, 4.02], [bot, DECK_Y]] as const) wood.push(woodPart(new THREE.CylinderGeometry(.07, .08, 1.1, 8), M(q.x, y + .5, q.y), null, 0, new THREE.Vector3(0, 1, 0)));
      rope.push(solidPart(tube(sag(new THREE.Vector3(top.x, 5.0, top.y), new THREE.Vector3(bot.x, DECK_Y + 1.0, bot.y), .12, 10), () => .022, 5), new THREE.Matrix4()));
    }
    // Deck planks across the pier, each a little different, with gaps; stringers under them.
    const n = Math.floor((PIER_LEN - STAIR) / .25);
    for (let k = 0; k < n; k++) {
      const p = at(STAIR + .1 + k * .25 + .12, (R() - .5) * .06), w = PIER_W + (R() - .5) * .1;
      wood.push(woodPart(plank, M(p.x, DECK_Y + (R() - .5) * .012, p.y, pierYaw + Math.PI / 2 + (R() - .5) * .02, w, .06, .22), null, 0));
    }
    for (const s of [-.9, -.3, .3, .9]) { const p = at(STAIR + (PIER_LEN - STAIR) / 2, s); wood.push(woodPart(plank, M(p.x, DECK_Y - .12, p.y, pierYaw, .14, .18, PIER_LEN - STAIR + .2), null, 0, new THREE.Vector3(0, 0, 1))); }
    // Piles every 2.4 m on both sides, bracing and a fender log.
    for (let d = STAIR + .4; d <= PIER_LEN + .01; d += 2.4) for (const s of [-1, 1]) {
      const p = at(d, s * (PIER_W / 2 + .08)), bottom = Math.min(height(p.x, p.y), SEA_Y - 1) - 1.5, top = DECK_Y + (Math.abs(d - PIER_LEN) < 1.3 ? .9 : .25);
      wood.push(woodPart(new THREE.CylinderGeometry(.16, .19, top - bottom, 10), M(p.x, (top + bottom) / 2, p.y, R() * 6), null, 0, new THREE.Vector3(0, 1, 0)));
      // Rope lashing at the top, a dark tide line on the pile is the shader's wet band.
      rope.push(solidPart(new THREE.TorusGeometry(.19, .03, 5, 14).rotateX(Math.PI / 2), M(p.x, DECK_Y - .32, p.y)));
    }
    for (const s of [-1, 1]) { const a = at(STAIR + (PIER_LEN - STAIR) / 2, s * (PIER_W / 2 + .26)); wood.push(woodPart(plank, M(a.x, DECK_Y - .45, a.y, pierYaw, .2, .22, PIER_LEN - STAIR), null, 0, new THREE.Vector3(0, 0, 1))); }
    // A ladder down from the pier's end into the water.
    const lad = at(PIER_LEN + .25, .5);
    for (const s of [-.25, .25]) { const q = at(PIER_LEN + .25, .5 + s); wood.push(woodPart(plank, M(q.x, DECK_Y - .9, q.y, pierYaw, .06, 2.2, .06), null, 0, new THREE.Vector3(0, 1, 0))); }
    for (let r = 0; r < 6; r++) wood.push(woodPart(plank, M(lad.x, DECK_Y - .2 - r * .32, lad.y, pierYaw + Math.PI / 2, .56, .05, .05), null, 0));
    // Bollards on the deck.
    for (const [d, s] of [[STAIR + 2, -1], [STAIR + 8, 1], [PIER_LEN - .6, -1], [PIER_LEN - .6, 1]] as const) {
      const p = at(d, s * (PIER_W / 2 - .25));
      wood.push(woodPart(lathe([[0, 0], [.14, 0], [.14, .32], [.18, .38], [.18, .44], [0, .46]], 12), M(p.x, DECK_Y + .03, p.y), null, 0, new THREE.Vector3(0, 1, 0)));
    }
    plank.dispose();
    lampSpots.push((() => { const p = at(PIER_LEN - .1, 0); return {x: p.x, y: DECK_Y + .03, z: p.y, yaw: pierYaw + Math.PI}; })());
  }

  // Boats: a sailing boat alongside the pier, two skiffs, one drawn up on the sand, a fishing boat at anchor.
  const boats: {g: THREE.Group; bob: number; base: THREE.Vector3}[] = [];
  const hullMat = hullMaterial(), woodMat = dawnWood('dawnharbor-boat-wood'), ropeMat = dawnRope();
  const sailMat = new THREE.MeshStandardMaterial({name: 'dawnharbor-sail', color: '#d9c7a2', roughness: .95, side: THREE.DoubleSide});
  const boat = (spec: HullSpec, x: number, y: number, z: number, yaw: number, opts: {mast?: number; oars?: boolean; tilt?: number; float?: boolean; furled?: boolean}) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(0, yaw, opts.tilt ?? 0); group.add(g);
    const {outer, rail} = hullGeometry(spec);
    const hull = new THREE.Mesh(outer, hullMat); hull.castShadow = hull.receiveShadow = true; g.add(hull);
    const parts: THREE.BufferGeometry[] = [solidPart(rail, new THREE.Matrix4())];
    const w: THREE.BufferGeometry[] = [];
    const plank = new THREE.BoxGeometry(1, 1, 1);
    // Thwarts, a keel line and stem posts.
    for (const t of [.3, .5, .7]) { const z = (t - .5) * spec.len, hw = spec.beam / 2 * Math.pow(Math.sin(Math.PI * t), .55) - .06; w.push(woodPart(plank, M(0, -.26, z, 0, hw * 2, .05, .24), null, 0)); }
    for (const e of [-1, 1]) w.push(woodPart(plank, M(0, -spec.depth * .4 + .13, e * spec.len * .49, 0, .07, spec.depth + .28, .1, e * .25), null, 0, new THREE.Vector3(0, 1, 0)));
    if (opts.oars) for (const s of [-1, 1]) {
      w.push(woodPart(new THREE.CylinderGeometry(.025, .025, 2.6, 6), M(s * .28, -.2, -.1, 0, 1, 1, 1, Math.PI / 2 - .05, s * .12), null, 0, new THREE.Vector3(0, 1, 0)));
      w.push(woodPart(plank, M(s * .36, -.24, 1.2, 0, .02, .12, .5, 0, s * .12), '#2f6f73', .9, new THREE.Vector3(0, 0, 1)));
    }
    if (opts.mast) {
      const mast = opts.mast;
      w.push(woodPart(new THREE.CylinderGeometry(.06, .09, mast, 10), M(0, mast / 2 - spec.depth * .6, spec.len * .14), null, 0, new THREE.Vector3(0, 1, 0)));
      // Boom with the sail furled along it, and the shrouds.
      w.push(woodPart(new THREE.CylinderGeometry(.045, .05, spec.len * .55, 8), M(0, .9, spec.len * .14 - spec.len * .27, 0, 1, 1, 1, Math.PI / 2), null, 0, new THREE.Vector3(0, 1, 0)));
      const furl = new THREE.CapsuleGeometry(.14, spec.len * .45, 4, 10).rotateX(Math.PI / 2);
      const fp = furl.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < fp.count; i++) { const z = fp.getZ(i); fp.setX(i, fp.getX(i) * (1 + .25 * Math.sin(z * 7))); fp.setY(i, fp.getY(i) * (1 + .3 * Math.sin(z * 5 + 1)) + .02); }
      furl.computeVertexNormals();
      const sail = new THREE.Mesh(furl.translate(0, 1.07, spec.len * .14 - spec.len * .27), sailMat); sail.castShadow = true; g.add(sail);
      for (const s of [-1, 1]) parts.push(solidPart(tube([new THREE.Vector3(0, mast - spec.depth * .6 - .2, spec.len * .14), new THREE.Vector3(s * spec.beam * .48, .02, spec.len * .1)], () => .012, 4), new THREE.Matrix4()));
      parts.push(solidPart(tube([new THREE.Vector3(0, mast - spec.depth * .6 - .2, spec.len * .14), new THREE.Vector3(0, .1, spec.len * .5)], () => .012, 4), new THREE.Matrix4()));
    }
    const woodMesh = new THREE.Mesh(mergeGeometries(w, false)!, woodMat); woodMesh.castShadow = true; g.add(woodMesh);
    const ropeMesh = new THREE.Mesh(mergeGeometries(parts, false)!, ropeMat); g.add(ropeMesh);
    w.forEach(x => x.dispose()); parts.forEach(x => x.dispose()); plank.dispose(); rail.dispose();
    if (opts.float !== false) boats.push({g, bob: R() * 6, base: g.position.clone()});
    return g;
  };
  const moorL = at(STAIR + 9, PIER_W / 2 + 1.5), moorR = at(STAIR + 6, -(PIER_W / 2 + 1.1));
  boat({len: 7.6, beam: 2.3, depth: .95, paint: '#2e6f78', seed: 1}, moorL.x, SEA_Y + .5, moorL.y, pierYaw + .03, {mast: 7.2});
  boat({len: 4.6, beam: 1.5, depth: .62, paint: '#c58a3a', seed: 2}, moorR.x, SEA_Y + .3, moorR.y, pierYaw - .06, {oars: true});
  const moorR2 = at(STAIR + 12.5, -(PIER_W / 2 + 1.05));
  boat({len: 4.2, beam: 1.4, depth: .58, paint: '#e1dccd', seed: 3}, moorR2.x, SEA_Y + .3, moorR2.y, pierYaw + .1, {oars: true});
  // Drawn up on the sand west of the pier, heeled over on its bilge.
  {
    const ba = HARBOUR_A0 - .05, p = coastAt(.874, ba), y = Math.max(height(p.x, p.y), SEA_Y) + .45;
    boat({len: 4.4, beam: 1.45, depth: .6, paint: '#a4473a', seed: 4}, p.x, y, p.y, yawOf(outward(ba)) + 2.6, {tilt: .28, float: false, oars: true});
  }
  // At anchor off the harbour, where the old ship rode.
  boat({len: 9.5, beam: 2.9, depth: 1.15, paint: '#3a5878', seed: 5}, 17, SEA_Y + .62, 146, -.25 + Math.PI, {mast: 9});
  // Mooring lines from the boats' bows and sterns to the pier's bollards and piles.
  for (const [b, d0, d1] of [[moorL, STAIR + 5.5, STAIR + 12.5], [moorR, STAIR + 3.6, STAIR + 8.2], [moorR2, STAIR + 10.5, STAIR + 15]] as const) {
    const s = Math.sign((b.x - pierPoint.x) * side.x + (b.y - pierPoint.y) * side.y);
    for (const d of [d0, d1]) {
      const pile = at(d, s * (PIER_W / 2 + .1)), off = at(d + (d === d0 ? 1.4 : -1.4), s * (PIER_W / 2 + .9));
      rope.push(solidPart(tube(sag(new THREE.Vector3(pile.x, DECK_Y + .1, pile.y), new THREE.Vector3(off.x, SEA_Y + .7, off.y), .25, 10), () => .02, 5), new THREE.Matrix4()));
    }
  }

  // Net racks on the quay: two poles and a cross bar with a net hanging in folds; a heap of net on the pier.
  for (const [a, len] of [[PIER_A + .05, 3.6], [PIER_A - .12, 3.2], [.17, 3.4]] as const) {
    const p = coastAt(R_QUAY + .004, a), o = outward(a), t = new THREE.Vector2(o.y, -o.x), y = height(p.x, p.y);
    for (const s of [-1, 1]) wood.push(woodPart(new THREE.CylinderGeometry(.06, .07, 2.1, 8), M(p.x + t.x * s * len / 2, y + 1.05, p.y + t.y * s * len / 2), null, 0, new THREE.Vector3(0, 1, 0)));
    wood.push(woodPart(new THREE.CylinderGeometry(.05, .05, len + .3, 8), M(p.x, y + 2.05, p.y, yawOf(t), 1, 1, 1, Math.PI / 2), null, 0, new THREE.Vector3(0, 1, 0)));
    const net = new THREE.PlaneGeometry(len - .1, 1.9, 24, 12), np = net.getAttribute('position') as THREE.BufferAttribute, nu = net.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < np.count; i++) {
      const u = np.getX(i), v = np.getY(i), drop = (1.9 / 2 - v);
      np.setXYZ(i, u, v + .07 * Math.sin(u * 3.1) * drop / 1.9, Math.sin(u * 4.2 + v * 1.3) * .09 * (drop / 1.9) + .05);
      nu.setXY(i, u, v);
    }
    net.computeVertexNormals();
    nets.push(solidPart(net, M(p.x, y + 1.08, p.y, yawOf(t) - Math.PI / 2), true));
  }

  const addMesh = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow = true) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat); mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh);
  };
  addMesh(stone, dawnSandstone('dawnharbor-quay-stone'), 'dawnharbor-quay-stone');
  const wallMesh = new THREE.Mesh(wallGeo, quayWallMaterial()); wallMesh.name = 'dawnharbor-quay-wall'; wallMesh.receiveShadow = true; group.add(wallMesh);
  addMesh(wood, dawnWood('dawnharbor-pier-wood'), 'dawnharbor-pier');
  addMesh(rope, ropeMat, 'dawnharbor-ropes', false);
  addMesh(iron, new THREE.MeshStandardMaterial({color: '#222'}), 'dawnharbor-iron');
  addMesh(nets, netMaterial(), 'dawnharbor-nets');
  void hulls; box.dispose();
  group.userData.boats = boats.length + 1;
  group.userData.lampSpots = lampSpots;
  return {group, update(time) {
    for (const b of boats) { b.g.position.y = b.base.y + Math.sin(time * .9 + b.bob) * .05; b.g.rotation.z = Math.sin(time * .7 + b.bob) * .025; b.g.rotation.x = Math.sin(time * .55 + b.bob * 1.3) * .012; }
  }};
}

/** Points along a rope hung between a and b, sagging by `sag` of its length. */
function sag(a: THREE.Vector3, b: THREE.Vector3, s: number, n: number): THREE.Vector3[] {
  const L = a.distanceTo(b);
  return Array.from({length: n + 1}, (_, i) => { const t = i / n; return a.clone().lerp(b, t).add(new THREE.Vector3(0, -4 * s * L * t * (1 - t) * .5, 0)); });
}
