import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {facetedStarCrystal} from './starCrystal';
import {STAR_FALLEN, STAR_FALLEN_CAPITAL, STAR_FALLEN_DRUMS, STAR_PILGRIM, STAR_SCORCHES, STAR_TABLE} from './starFieldLayout';
import type {StarGlowSource} from './starLight';

/*
 * The eclipse's marks out in the fields (star r5, layout in starFieldLayout.ts): the observatory's toppled column, its
 * fluted drums broken and lying outward from the ring with the capital rolled beyond; the astronomer's table by the
 * armillary, the night's charts weighed down on it, a brass glass on its tripod still aimed at the eclipse and the
 * stool knocked over; the pilgrim's pack, bedroll, staff and tipped lantern (still burning) by the starroad; and
 * the star's shards lying burst round each scorch. Three draws: the props in vertex colour, the paper, the glow.
 */

const rnd = (i: number) => { const a = Math.sin(i * 97.31 + 3.7) * 43758.5453; return a - Math.floor(a); };
const UP = new THREE.Vector3(0, 1, 0);

function colour(g: THREE.BufferGeometry, c: THREE.ColorRepresentation, jitter = 0, seed = 0): THREE.BufferGeometry {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count, col = new Float32Array(n * 3), base = new THREE.Color(c), t = new THREE.Color();
  for (let i = 0; i < n; i += 3) {
    // One tone per triangle, a little varied, so painted surfaces read as worked material rather than one flat fill.
    const k = 1 + (rnd(seed + i * .37) - .5) * jitter;
    t.copy(base).multiplyScalar(k);
    for (let j = 0; j < 3; j++) t.toArray(col, (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/** A tapered pole from a to b. */
function pole(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 7): THREE.BufferGeometry {
  const len = a.distanceTo(b), g = new THREE.CylinderGeometry(r1, r0, len, sides, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
/** A fluted column drum lying on its side, its ends broken: length along x, centred. */
function drum(len: number, r: number, seed: number, brokenA: boolean, brokenB: boolean): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, 40, 3, false);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), rr = Math.hypot(x, z);
    // Twenty shallow flutes with sharp arrises; the ends chipped and split where the drum broke.
    const flute = 1 - .045 * Math.pow(Math.abs(Math.sin(a * 10)), .6);
    let dy = 0;
    const end = y > 0 ? brokenB : brokenA;
    if (Math.abs(Math.abs(y) - len / 2) < 1e-4 && end) dy = Math.sign(y) * (-.22 + .22 * Math.sin(a * 2 + seed) + .1 * Math.sin(a * 7 + seed * 3)) * (rr / r) * r;
    if (rr > 1e-4) p.setXYZ(i, x * flute, y + dy, z * flute); else p.setY(i, y + (end ? Math.sign(y) * -.12 * r : 0));
  }
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Star charts: dark-blue paper inked in silver, the eclipse drawn in phases, a constellation and notes. */
function chartTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#d9d2bf'; x.fillRect(0, 0, 256, 128);
  // Two sheets side by side: the eclipse's phases, and a star map.
  x.strokeStyle = '#2b2a3a'; x.fillStyle = '#2b2a3a'; x.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) { const cx = 20 + i * 22, cy = 34; x.beginPath(); x.arc(cx, cy, 8, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(cx + 16 - i * 8, cy, 8, 0, Math.PI * 2); x.fill(); }
  x.beginPath(); x.arc(64, 82, 20, 0, Math.PI * 2); x.fill();
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; x.beginPath(); x.moveTo(64 + Math.cos(a) * 22, 82 + Math.sin(a) * 22); x.lineTo(64 + Math.cos(a) * (30 + (k % 3) * 6), 82 + Math.sin(a) * (30 + (k % 3) * 6)); x.stroke(); }
  for (let k = 0; k < 9; k++) { x.fillRect(110, 64 + k * 6, 10 + rnd(k) * 6, 1); }
  x.beginPath(); x.moveTo(130, 0); x.lineTo(130, 128); x.strokeStyle = '#9e9583'; x.stroke();
  x.strokeStyle = '#2b2a3a';
  const stars: [number, number][] = [];
  for (let k = 0; k < 40; k++) { const sx = 140 + rnd(k + 9) * 108, sy = 8 + rnd(k + 19) * 112; stars.push([sx, sy]); x.fillRect(sx, sy, 1.5 + rnd(k) * 1.5, 1.5 + rnd(k) * 1.5); }
  x.beginPath(); for (let k = 0; k < 6; k++) { const [sx, sy] = stars[k * 3]; if (k) x.lineTo(sx, sy); else x.moveTo(sx, sy); } x.stroke();
  x.beginPath(); x.arc(196, 64, 46, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(196, 64, 30, 0, Math.PI * 2); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.name = 'starhaven-eclipse-charts';
  return t;
}

export interface StarEclipseStory { root: THREE.Group; glows: StarGlowSource[]; update(time: number): void }

/** The props (no colliders here: starFieldLayout.starEclipseSolids are registered with the story's solids). */
export function starEclipseStory(height: (x: number, z: number) => number): StarEclipseStory {
  const root = new THREE.Group(); root.name = 'starhaven-eclipse-story';
  const props: THREE.BufferGeometry[] = [], paper: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  const STONE = '#8f8a9f', TRIM = '#b2a283', WOOD = '#4d3d34', CANVAS = '#6f6a62', BRASS = '#b99a5c', IRON = '#2c2c34';
  const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0) => { g.applyMatrix4(m.compose(v.set(x, y, z), q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ')), s)); return g; };

  // The fallen column: drums along the fall, sunk a little into the turf, each turned and rolled.
  const fallYaw = Math.atan2(-STAR_FALLEN.dz, STAR_FALLEN.dx);
  STAR_FALLEN_DRUMS.forEach((p, i) => {
    const x = STAR_FALLEN.x + STAR_FALLEN.dx * p.d - STAR_FALLEN.dz * p.side, z = STAR_FALLEN.z + STAR_FALLEN.dz * p.d + STAR_FALLEN.dx * p.side;
    props.push(colour(place(drum(p.len, .6, i * 3 + 1, i > 0, true), x, height(x, z) + .5, z, fallYaw + p.turn, rnd(i) * 1.2), STONE, .12, i * 50));
  });
  {
    const c = STAR_FALLEN_CAPITAL, x = STAR_FALLEN.x + STAR_FALLEN.dx * c.d - STAR_FALLEN.dz * c.side, z = STAR_FALLEN.z + STAR_FALLEN.dz * c.d + STAR_FALLEN.dx * c.side;
    const cap = new THREE.CylinderGeometry(.86, .67, .32, 8);
    props.push(colour(place(cap, x, height(x, z) + .52, z, .4, 1.25, .2), TRIM, .1, 300));
  }
  // The stump's broken top: a ring of chips round the standing column's foot.
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4, d = 1.1 + rnd(k + 40) * 1.6, x = STAR_FALLEN.x + Math.cos(a) * d, z = STAR_FALLEN.z + Math.sin(a) * d, r = .1 + rnd(k + 41) * .14;
    const chip = new THREE.DodecahedronGeometry(r, 1);chip.scale(1, .55, .8);
    props.push(colour(place(chip, x, height(x, z) + r * .3, z, rnd(k) * 6), STONE, .2, 400 + k));
  }

  // The astronomer's table: a trestle of dark wood, two charts weighed down, a brass glass on a tripod, a book.
  {
    const {x, z, yaw} = STAR_TABLE, y = height(x, z), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const local = (lx: number, lz: number): [number, number] => [x + lx * cy + lz * sy, z - lx * sy + lz * cy];
    const top = new THREE.BoxGeometry(1.5, .07, .82, 3, 1, 2);
    props.push(colour(place(top, x, y + .86, z, yaw), WOOD, .25, 500));
    for (const [lx, lz] of [[-.62, -.32], [.62, -.32], [-.62, .32], [.62, .32]] as const) {
      const [px, pz] = local(lx, lz);
      props.push(colour(pole(new THREE.Vector3(px, y - .05, pz), new THREE.Vector3(px + (lx > 0 ? -.03 : .03), y + .84, pz), .045, .035, 6), WOOD, .2, 510));
    }
    {const [ax, az] = local(-.62, 0), [bx, bz] = local(.62, 0);props.push(colour(pole(new THREE.Vector3(ax, y + .22, az), new THREE.Vector3(bx, y + .22, bz), .03, .03, 5), WOOD, .2, 520));}
    // Charts (UV across the texture's two halves), each a little askew, a stone on one corner and a candle stub on the other.
    for (const [k, lx, lz, turn] of [[0, -.32, .05, .12], [1, .3, -.02, -.2]] as const) {
      const sheet = new THREE.PlaneGeometry(.6, .44);sheet.rotateX(-Math.PI / 2);
      const uv = sheet.getAttribute('uv');for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * .5 + k * .5);
      const [px, pz] = local(lx, lz);paper.push(place(sheet, px, y + .898 + k * .002, pz, yaw + turn));
    }
    {const [px, pz] = local(-.55, .22);const w = new THREE.DodecahedronGeometry(.06, 1);w.scale(1, .6, 1);props.push(colour(place(w, px, y + .93, pz, 0), STONE, .2, 530));}
    {const [px, pz] = local(.6, .3);props.push(colour(place(new THREE.CylinderGeometry(.025, .028, .06, 8), px, y + .93, pz, 0), '#cfc6b0', 0, 540));}
    // A closed book.
    {const [px, pz] = local(.48, -.28);props.push(colour(place(new THREE.BoxGeometry(.24, .05, .17), px, y + .92, pz, yaw + .5), '#3a2a46', .15, 550));}
    // The brass glass on a short tripod at the table's end, aimed up at the eclipse in the north.
    {
      const [px, pz] = local(.95, .5), gy = height(px, pz);
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; props.push(colour(pole(new THREE.Vector3(px + Math.cos(a) * .32, gy, pz + Math.sin(a) * .32), new THREE.Vector3(px, gy + 1.15, pz), .02, .016, 5), WOOD, .2, 560 + k)); }
      const tube = pole(new THREE.Vector3(px + .05, gy + 1.1, pz + .32), new THREE.Vector3(px - .03, gy + 1.42, pz - .55), .055, .04, 10);
      props.push(colour(tube, BRASS, .1, 570));
      props.push(colour(pole(new THREE.Vector3(px + .055, gy + 1.11, pz + .35), new THREE.Vector3(px + .06, gy + 1.105, pz + .42), .035, .035, 10), IRON, 0, 571));
    }
    // The stool, knocked over.
    {
      const [px, pz] = local(-.2, -.95), gy = height(px, pz);
      const seat = new THREE.CylinderGeometry(.2, .2, .05, 12);
      props.push(colour(place(seat, px, gy + .2, pz, .3, 1.5), WOOD, .2, 580));
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; props.push(colour(pole(new THREE.Vector3(px - .02, gy + .2 + Math.sin(a) * .13, pz + Math.cos(a) * .13), new THREE.Vector3(px + .45, gy + .08 + Math.sin(a) * .2, pz + Math.cos(a) * .22), .022, .018, 5), WOOD, .2, 590 + k)); }
    }
  }

  // The pilgrim's pack: a canvas sack slumped against a stone, the bedroll strapped on, the staff and the lantern dropped.
  {
    const {x, z, yaw} = STAR_PILGRIM, y = height(x, z);
    const sack = new THREE.SphereGeometry(.34, 16, 12);
    {const p = sack.getAttribute('position');for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i), pz = p.getZ(i); const sag = py < 0 ? 1 + .25 * (-py / .34) : 1 - .15 * (py / .34); p.setXYZ(i, px * sag * (1 + .05 * Math.sin(py * 30)), py * .9, pz * sag * .78); }sack.computeVertexNormals();}
    props.push(colour(place(sack, x, y + .28, z, yaw, -.25), CANVAS, .18, 600));
    const flap = new THREE.SphereGeometry(.36, 12, 6, 0, Math.PI * 2, 0, .9);flap.scale(1, .5, .82);
    props.push(colour(place(flap, x, y + .5, z - .02, yaw, -.3), '#5b564f', .12, 610));
    const roll = new THREE.CylinderGeometry(.12, .12, .62, 12);roll.rotateZ(Math.PI / 2);
    props.push(colour(place(roll, x, y + .66, z + .05, yaw, -.2), '#4b5a6e', .12, 620));
    for (const dx of [-.18, .18]) { const strap = new THREE.TorusGeometry(.13, .012, 4, 14);strap.rotateY(Math.PI / 2);props.push(colour(place(strap, x + dx * Math.cos(yaw), y + .66, z - dx * Math.sin(yaw) + .05, yaw), '#2d241f', 0, 630)); }
    // The staff, lying where it fell, its crook toward the road.
    const sx = x + 1.1, sz = z + .6, sy = height(sx, sz);
    props.push(colour(pole(new THREE.Vector3(sx - .8, sy + .04, sz + .5), new THREE.Vector3(sx + .75, sy + .05, sz - .45), .03, .025, 6), WOOD, .2, 640));
    const crook = new THREE.TorusGeometry(.11, .022, 5, 10, Math.PI * 1.2);crook.rotateX(Math.PI / 2);
    props.push(colour(place(crook, sx + .82, sy + .06, sz - .53, .6), WOOD, .2, 641));
    // The lantern on its side, still lit: iron frame and cap, warm glass.
    const lx = x - .7, lz = z + .65, ly = height(lx, lz) + .1;
    const cap = new THREE.ConeGeometry(.1, .1, 6);cap.rotateZ(Math.PI / 2);cap.translate(.16, 0, 0);
    const base = new THREE.CylinderGeometry(.1, .1, .03, 6);base.rotateZ(Math.PI / 2);base.translate(-.13, 0, 0);
    const ring = new THREE.TorusGeometry(.06, .01, 4, 10);ring.rotateY(Math.PI / 2);ring.translate(.24, 0, 0);
    for (const g of [cap, base, ring]) props.push(colour(place(g, lx, ly, lz, 1.9, 0, .15), IRON, 0, 650));
    const pane = new THREE.CylinderGeometry(.075, .085, .24, 6);pane.rotateZ(Math.PI / 2);
    glow.push(colour(place(pane, lx, ly, lz, 1.9, 0, .15), '#ffb35a', 0, 660));
  }

  // The star's shards round each scorch: burst, half buried, glowing faintly at the break.
  STAR_SCORCHES.forEach((sc, si) => {
    for (let k = 0; k < 9; k++) {
      const a = k * 2.39996 + si, d = (k ? .45 + rnd(si * 20 + k) * sc.r * .9 : 0), x = sc.x + Math.cos(a) * d, z = sc.z + Math.sin(a) * d;
      const h = k ? .18 + rnd(si * 30 + k) * .35 : .75, w = h * (.28 + .1 * rnd(k + si));
      const g = facetedStarCrystal();g.scale(w, h, w * .85);
      glow.push(colour(place(g, x, height(x, z) + h * .25, z, a, (k ? .9 + .5 * rnd(k) : .45) * Math.cos(a), (k ? .9 : .45) * Math.sin(a)), k ? '#9b7cff' : '#b49cff', .2, 700 + si * 20 + k));
    }
  });

  const propMat = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .8, metalness: .05});
  propMat.name = 'starhaven-eclipse-props';
  const propMesh = new THREE.Mesh(mergeGeometries(props, false)!, propMat);props.forEach((g) => g.dispose());
  propMesh.name = 'starhaven-eclipse-props';propMesh.castShadow = propMesh.receiveShadow = true;

  const paperMat = new THREE.MeshStandardMaterial({map: chartTexture(), roughness: .9});
  paperMat.name = 'starhaven-eclipse-charts';
  const paperMesh = new THREE.Mesh(mergeGeometries(paper, false)!, paperMat);paper.forEach((g) => g.dispose());
  paperMesh.name = 'starhaven-eclipse-charts';paperMesh.receiveShadow = true;

  // Glowing pieces: lantern glass and star shards, their own colour as light (vertex colour), breathing slowly.
  const time = {value: 0};
  const glowMat = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .25, metalness: .2, flatShading: true});
  glowMat.name = 'starhaven-eclipse-glow';
  glowMat.onBeforeCompile = (shader) => {
    shader.uniforms.seTime = time;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float seTime;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vColor.rgb*(1.1+.25*sin(seTime*1.3+vColor.r*20.));');
  };
  glowMat.customProgramCacheKey = () => 'starhaven-eclipse-glow';
  const glowMesh = new THREE.Mesh(mergeGeometries(glow, false)!, glowMat);glow.forEach((g) => g.dispose());
  glowMesh.name = 'starhaven-eclipse-glow';glowMesh.castShadow = true;
  root.add(propMesh, paperMesh, glowMesh);

  root.userData = {drums: STAR_FALLEN_DRUMS.length, scorches: STAR_SCORCHES.length, props: true};
  return {root, glows: starEclipseGlows(), update(t) { time.value = t; }};
}

/** The scorches' light on the ground, without building the props (the ground bake runs before the settlement). */
export function starEclipseGlows(): StarGlowSource[] {
  return [
    {x: STAR_PILGRIM.x - .7, z: STAR_PILGRIM.z + .65, radius: 1.4, color: '#ffa850', strength: 1.6},
    ...STAR_SCORCHES.map((sc) => ({x: sc.x, z: sc.z, radius: sc.r * .8, color: '#8f6bff', strength: .9})),
  ];
}
