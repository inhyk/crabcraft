import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {boulderGeometry} from './snowRocks';
import {STAR_BOAT,STAR_CAMP} from './starFieldLayout';
import {STAR_STORY_SOLIDS} from './starFieldSpots';

/*
 * Two small stories out in Starhaven's fields, built in the island's own materials:
 * - the stargazer's camp on the knoll south-east of the village: a canvas tent pitched to the wind, a brass
 *   telescope on its tripod aimed at the aurora, a fire in a ring of stones with a kettle by it, a stool and a bag;
 * - a fishermen's clinker skiff hauled up the western beach, listing on the sand, oars shipped, with its gear by it.
 * Geometry is merged per material (canvas, wood, brass, paint, stone); the fire is a small additive flame and one
 * warm light.
 */

type Put = (name: string, x: number, z: number, yaw?: number, scale?: number, dy?: number) => void;

const rot = (x: number, z: number, yaw: number): [number, number] => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];

/** A tapered pole from a to b. */
function pole(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b), g = new THREE.CylinderGeometry(r1, r0, len, sides, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}
const tint = (g: THREE.BufferGeometry, c: THREE.Color, jitter = 0, seed = 0) => {
  const n = g.getAttribute('position').count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = 1 + (Math.sin((i >> 2) * 12.9898 + seed) * .5) * jitter; col.set([c.r * k, c.g * k, c.b * k], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
};

/** The tent's canvas: two sagging pitches over a ridge, a closed back, the front flaps tied open. */
function tentCanvas(): THREE.BufferGeometry {
  const L = 2.6, W = 1.25, H = 1.45, n = 10, m = 6, pos: number[] = [], col: number[] = [];
  const at = (side: number, u: number, v: number) => {
    // u along the ridge (-1..1), v from ridge (0) to hem (1); the cloth sags between the poles and bellies in the wind.
    const sag = .1 * Math.sin(v * Math.PI) * (1 - u * u * .6) + (side > 0 ? .04 : -.03) * Math.sin(v * Math.PI) * Math.cos(u * 1.4);
    return new THREE.Vector3(side * (W * v - sag), H * (1 - v) - sag * .4, u * L / 2);
  };
  const shade = (side: number, u: number, v: number) => { const s = .82 + .18 * Math.sin(u * 23 + v * 7) * .3 + (side > 0 ? .06 : 0) - v * .1; return [s, s * .94, s * .8]; };
  for (const side of [-1, 1]) for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const u0 = -1 + 2 * i / n, u1 = -1 + 2 * (i + 1) / n, v0 = j / m, v1 = (j + 1) / m;
    const quad = [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
    for (const [u, v] of side > 0 ? quad : [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]) { const p = at(side, u, v); pos.push(p.x, p.y, p.z); col.push(...shade(side, u, v)); }
  }
  // Back wall, and the two front flaps folded back against the pitches.
  const back = [at(-1, -1, 1), at(1, -1, 1), at(1, -1, 0)];
  for (const p of back) { pos.push(p.x, p.y, p.z); col.push(.74, .7, .6); }
  for (const side of [-1, 1]) {
    const a = at(side, 1, 0), b = at(side, 1, 1), c = new THREE.Vector3(side * W * .95, .1, L / 2 - .55);
    for (const p of side > 0 ? [a, b, c] : [a, c, b]) { pos.push(p.x, p.y, p.z); col.push(.7, .66, .56); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A clinker-built skiff, open, about 4.4 m: five lapped strakes each side, inside and out, with a gunwale. */
function skiffHull(): {paint: THREE.BufferGeometry; wood: THREE.BufferGeometry} {
  const L = 4.4, B = .78, D = .62, nu = 28, strakes = 5, perStrake = 3;
  const nv = strakes * perStrake;
  // Section at u (0 stern .. 1 bow): half beam and depth, a full transom-less double-ender, the bow finer.
  const half = (u: number) => B * Math.pow(Math.sin(Math.PI * Math.min(.999, Math.max(.001, u))), u > .5 ? .75 : .62);
  const sheer = (u: number) => .12 * Math.pow(2 * u - 1, 2);
  const point = (u: number, v: number, inset: number) => {
    // v: 0 keel .. 1 gunwale; each strake overlaps the one below (a small outward step at its lower edge).
    const k = Math.min(strakes - 1, Math.floor(v * strakes)), f = v * strakes - k;
    const lap = (1 - f) * .018 * (k > 0 ? 1 : 0);
    const w = half(u) * Math.sin(v * Math.PI / 2) + lap - inset, y = -D * (1 - Math.pow(v, 1.25)) * Math.sin(Math.PI * Math.min(1, Math.max(0, u)) * .5 + Math.PI * .25) + sheer(u) * v;
    return [Math.max(0, w), y + inset * .6, (u - .5) * L];
  };
  const build = (inset: number, flip: boolean, colour: (k: number, v: number) => number[]) => {
    const pos: number[] = [], col: number[] = [];
    for (const side of [-1, 1]) for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
      const P = (u: number, v: number) => { const p = point(u, v, inset); return [p[0] * side, p[1], p[2]]; };
      let quad = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v0), P(u1, v1), P(u0, v1)];
      if ((side > 0) !== flip) quad = [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]];
      const c = colour(Math.floor((j + .5) / perStrake), (j + .5) / nv);
      for (const p of quad) { pos.push(...p); col.push(...c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  // Outside: weathered teal paint, a pale sheer strake, tar-dark below the waterline.
  const paint = build(0, false, (k, v) => k === strakes - 1 ? [.62, .58, .48] : v < .3 ? [.1, .09, .085] : [.13 + .02 * (k % 2), .3, .33]);
  // Inside: bare planking, darker at the bottom where bilge water stands.
  const inside = build(.035, true, (k, v) => { const s = .5 + .08 * (k % 2) + v * .2; return [.36 * s, .24 * s, .15 * s]; });
  // The gunwale: a cap along each sheer, two thwarts across.
  const parts = [inside];
  for (const side of [-1, 1]) for (let i = 0; i < nu; i++) {
    const a = point(i / nu, 1, 0), b = point((i + 1) / nu, 1, 0);
    parts.push(tint(pole(new THREE.Vector3(a[0] * side, a[1] + .01, a[2]), new THREE.Vector3(b[0] * side, b[1] + .01, b[2]), .035, .035, 4), new THREE.Color(.28, .19, .12)));
  }
  for (const z of [-.55, .7]) {
    const u = z / L + .5, w = half(u) * Math.sin(.8 * Math.PI / 2) - .04, y = point(u, .8, 0)[1];
    const g = new THREE.BoxGeometry(w * 2, .045, .24); g.translate(0, y, z); parts.push(tint(g, new THREE.Color(.34, .23, .14)));
  }
  return {paint, wood: mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p), false)!};
}

export interface StarStories { root: THREE.Group; update(time: number): void }

export function starStories(height: (x: number, z: number) => number, put: Put): StarStories {
  const root = new THREE.Group(); root.name = 'starhaven-stories';
  const canvas: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [], brass: THREE.BufferGeometry[] = [], stone: THREE.BufferGeometry[] = [], paint: THREE.BufferGeometry[] = [];
  const C = (h: string) => new THREE.Color(h);
  const {x: cx, z: cz} = STAR_CAMP, cy = height(cx, cz);
  const place = (g: THREE.BufferGeometry, x: number, z: number, yaw: number, dy = 0, pitch = 0, roll = 0) => {
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, z) + dy, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(1, 1, 1)));
    return g;
  };

  // Tent, its ridge pole, two uprights, guy lines and pegs; mouth turned to the fire.
  const tent = STAR_STORY_SOLIDS[0], tentYaw = Math.atan2(cx - tent.x, cz - tent.z);
  canvas.push(place(tentCanvas(), tent.x, tent.z, tentYaw, -.02));
  const tp = (x: number, y: number, z: number) => { const [a, b] = rot(x, z, tentYaw); return new THREE.Vector3(tent.x + a, height(tent.x + a, tent.z + b) + y, tent.z + b); };
  wood.push(tint(pole(tp(0, 1.47, -1.36), tp(0, 1.47, 1.36), .03, .03), C('#4a3423')));
  for (const z of [-1.3, 1.3]) wood.push(tint(pole(tp(0, -.05, z), tp(0, 1.5, z), .035, .03), C('#4a3423')));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const peg = tp(sx * 2.1, 0, sz * 1.9);
    wood.push(tint(pole(tp(sx * 1.25, .05, sz * 1.0), peg.clone().setY(peg.y + .05), .006, .006, 3), C('#8d7d62')));
    wood.push(tint(pole(peg.clone().setY(peg.y - .1), peg.clone().setY(peg.y + .14), .02, .015, 4), C('#5b412b')));
  }
  // Bedroll by the tent's mouth.
  const roll = new THREE.CapsuleGeometry(.17, .55, 4, 10); roll.rotateZ(Math.PI / 2);
  const [rx, rz] = rot(.2, 1.9, tentYaw);
  canvas.push(tint(place(roll, tent.x + rx, tent.z + rz, tentYaw, .17), C('#6b3f4a'), .08));

  // Telescope on its tripod, looking south and up at the aurora.
  const tel = STAR_STORY_SOLIDS[1], ty = height(tel.x, tel.z), head = new THREE.Vector3(tel.x, ty + 1.25, tel.z);
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + .3, foot = new THREE.Vector3(tel.x + Math.cos(a) * .55, 0, tel.z + Math.sin(a) * .55); foot.y = height(foot.x, foot.z) - .03; wood.push(tint(pole(foot, head, .022, .016), C('#3d2c22'))); }
  const tube = new THREE.LatheGeometry([[0, -.62], [.05, -.62], [.055, -.5], [.05, -.48], [.05, .2], [.058, .22], [.058, .3], [.07, .34], [.075, .55], [.082, .58], [.06, .58]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  tube.applyMatrix4(new THREE.Matrix4().compose(head.clone().add(new THREE.Vector3(0, .12, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(-.75, Math.PI + .35, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
  brass.push(tint(tube, C('#c9a25e')));

  // The fire: a ring of stones, crossed logs, embers; a kettle and the camper's things round it.
  const ring = boulderGeometry({r: .16, h: .12, seed: 77}, 4);
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, g = ring.clone(); stone.push(tint(place(g, cx + Math.cos(a) * .55, cz + Math.sin(a) * .55, a * 3, -.02), C('#4a4854'), .2, k)); }
  ring.dispose();
  for (let k = 0; k < 4; k++) { const a = k * .9 + .4; wood.push(tint(pole(new THREE.Vector3(cx + Math.cos(a) * .42, cy + .04, cz + Math.sin(a) * .42), new THREE.Vector3(cx - Math.cos(a) * .1, cy + .28, cz - Math.sin(a) * .1), .05, .04, 7), C('#2d221c'), .2, k)); }
  put('Pot_1', cx + .85, cz + .3, .4, .55);
  put('Stool', cx - 1.2, cz - .9, .8, .9);
  put('Bag', cx + 1.0, cz + 1.4, 2.1, .9);
  put('Bucket_Wooden_1', tel.x - .9, tel.z + .6, 0, .75);
  put('CandleStick_Stand', tent.x + 1.6, tent.z - 1.2, 0, .8);

  // The skiff, hauled up and listing on the sand, oars shipped; its gear left beside it.
  const {x: bx, z: bz, yaw: byaw} = STAR_BOAT, hull = skiffHull();
  const lay = (g: THREE.BufferGeometry) => place(g, bx, bz, byaw, .32, -.06, .18);
  paint.push(lay(hull.paint)); wood.push(lay(hull.wood));
  for (const s of [-1, 1]) {
    const oar = new THREE.LatheGeometry([[0, -1.3], [.02, -1.28], [.022, .9], [.07, 1], [.075, 1.3], [0, 1.32]].map(([r, y]) => new THREE.Vector2(r, y)), 6);
    oar.scale(1, 1, .35); oar.rotateX(Math.PI / 2); oar.rotateY(s * .08); oar.translate(s * .3, .1, -.2);
    wood.push(tint(lay(oar), C('#7a5a3c')));
  }
  const [gx, gz] = rot(1.6, 1.1, byaw);
  put('Barrel', bx + gx, bz + gz, .3, .8);
  put('Crate_Wooden', bx + gx * 1.5 + .8, bz + gz * 1.5 - .4, .9, .75);
  put('Rope_2', bx - gx * .9, bz - gz * .9, 1.2, 1);
  put('Bucket_Metal', bx + gx * .7 - .6, bz + gz * .7 + .9, 0, .7);

  const merge = (list: THREE.BufferGeometry[]) => { const g = mergeGeometries(list.map((p) => p.index ? p.toNonIndexed() : p), false)!; list.forEach((p) => p.dispose()); return g; };
  const add = (list: THREE.BufferGeometry[], mat: THREE.MeshStandardMaterial, name: string) => { const mesh = new THREE.Mesh(merge(list), mat); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); };
  add(canvas, new THREE.MeshStandardMaterial({vertexColors: true, color: '#b5a688', roughness: .92, side: THREE.DoubleSide}), 'starhaven-camp-canvas');
  add(wood, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .85}), 'starhaven-story-wood');
  add(brass, new THREE.MeshStandardMaterial({vertexColors: true, metalness: .85, roughness: .32}), 'starhaven-camp-brass');
  add(stone, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .8}), 'starhaven-camp-stones');
  add(paint, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .7}), 'starhaven-skiff-hull');

  // Flame: two crossed quads, an animated tongue of fire, additive; embers glow under it.
  const time = {value: 0};
  const flameGeo = mergeGeometries([new THREE.PlaneGeometry(.5, .75), new THREE.PlaneGeometry(.5, .75).rotateY(Math.PI / 2)], false)!;
  flameGeo.translate(0, .37, 0);
  const flame = new THREE.Mesh(flameGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: {time},
    vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: /* glsl */ `varying vec2 v;uniform float time;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
      void main(){vec2 q=v;float t=time*2.2;float w=n(vec2(q.x*4.,q.y*3.-t))*.5+n(vec2(q.x*9.,q.y*7.-t*1.7))*.25;
        float body=1.-smoothstep(.0,.42,abs(q.x-.5+(w-.37)*.35*q.y)*(1.+q.y*1.6)/(1.-q.y*.75));
        float f=body*smoothstep(1.,.15,q.y+w*.35)*smoothstep(0.,.08,q.y);
        vec3 c=mix(vec3(1.,.35,.06),vec3(1.,.82,.45),smoothstep(.3,.8,f));gl_FragColor=vec4(c*f*1.6,f);}`,
  }));
  flame.position.set(cx, cy + .02, cz); flame.name = 'starhaven-camp-flame';
  const embers = new THREE.Mesh(new THREE.CircleGeometry(.32, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({color: '#1a0d08', emissive: '#ff5a1a', emissiveIntensity: 1.6, roughness: 1}));
  embers.position.set(cx, cy + .03, cz);
  // The fire's light on the ground is painted by the ground shader (starGround.ts), not a point light.
  root.add(flame, embers);
  root.userData = {camp: [cx, cz], boat: [bx, bz]};
  return {root, update(t) { time.value = t; }};
}
