// Tidecrown on World I's northern horizon: the capital stands in its real place (World I coordinates,
// keep at TIDECROWN_VIEW.keep), as a light silhouette for the fog to soften. One vertex-coloured mesh
// carries the land, walls and towers, terraced roofs, the keep with its carapace dome and the spire
// with its crown of six claws; window lights, the lantern glow and its beam are three more draws.
// The lantern answers the Saltmere beacon: it lights a little after the beacon and pulses after that.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tube } from './geom';
import { GRID, TIDECROWN_VIEW, type V2 } from './layout';
import { rng, smoothstep } from './noise';
import { polySignedDist, type Terrain } from './terrain';

const [KX, KZ] = TIDECROWN_VIEW.keep;

/** The city wall, traced from the concept plan (World I coordinates). */
const WALL: V2[] = [
  [-116, -396], [-137, -432], [-137, -591], [-97, -658], [-27, -706], [61, -727], [140, -729],
  [235, -640], [251, -603], [221, -581], [221, -470], [248, -443], [235, -417], [176, -394],
  [121, -400], [42, -396], [21, -396],
];
const scaled = (poly: V2[], f: number): V2[] => poly.map(([x, z]) => [KX + (x - KX) * f, KZ + (z - KZ) * f]);
/** Terraces step up toward the keep: city floor 6, then 17 and 29; the castle rock carries the keep at 46. */
const TERRACES: { poly: V2[]; top: number }[] = [
  { poly: scaled(WALL, 0.985), top: 6 },
  { poly: scaled(WALL, 0.74), top: 17 },
  { poly: scaled(WALL, 0.48), top: 29 },
];
/** The claw gate in the south wall's gap, and the land the city stands on. */
const GATE: V2 = [31.5, -397];
const SHORE: V2[] = [
  [-160, -362], [-250, -372], [-292, -520], [-262, -700], [-170, -748], [-40, -772], [80, -780], [160, -772],
  [262, -662], [282, -600], [252, -575], [252, -480], [278, -445], [262, -405], [190, -366], [120, -362], [42, -360], [0, -360],
];

export interface Skyline {
  group: THREE.Group;
  /** Lantern on (fades in after a short wait unless instant) or off. Repeated calls with the same value do nothing. */
  setLit(lit: boolean, instant: boolean): void;
  /** 0..1 night amount for the window lights. */
  setNight(n: number): void;
  update(dt: number, elapsed: number): void;
  readonly state: { lit: boolean; level: number; delay: number };
}

const tintTo = new THREE.Color('#9ea8c8');
const col = (hex: string) => new THREE.Color(hex).lerp(tintTo, 0.14);

/** Accumulates coloured, uv-less pieces for one merge. */
class Pieces {
  readonly list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, c: THREE.Color | ((n: THREE.Vector3, p: THREE.Vector3) => THREE.Color)): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.deleteAttribute('uv');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const out = new Float32Array(pos.count * 3);
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const cc = typeof c === 'function' ? c(n.fromBufferAttribute(nor, i), p.fromBufferAttribute(pos, i)) : c;
      out[i * 3] = cc.r;
      out[i * 3 + 1] = cc.g;
      out[i * 3 + 2] = cc.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
    this.list.push(geo);
  }
  merge(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    for (const p of this.list) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

/** Polygon (x, z) as a slab: flat top at `top`, sides down to `bottom`. */
function slab(poly: V2[], top: number, bottom: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false, curveSegments: 1 });
  // Shape (x, z) at depth d -> world (x, top - d, z): the depth-0 cap faces up.
  g.rotateX(Math.PI / 2);
  g.translate(0, top, 0);
  return g;
}

/** Box with its centre at x, y, z, turned by yaw. */
const box = (w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0) => new THREE.BoxGeometry(w, h, d).rotateY(yaw).translate(x, y, z);
/** Gable roof prism: ridge along local x. */
function gable(w: number, d: number, h: number, x: number, y: number, z: number, yaw: number): THREE.BufferGeometry {
  const s = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g.rotateY(yaw).translate(x, y, z);
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.1, 'rgba(210,255,250,0.95)');
  grd.addColorStop(0.28, 'rgba(90,240,235,0.45)');
  grd.addColorStop(0.6, 'rgba(40,190,220,0.12)');
  grd.addColorStop(1, 'rgba(20,120,200,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSkyline(terrain: Terrain): Skyline {
  const group = new THREE.Group();
  group.name = 'tidecrown-skyline';
  const P = new Pieces();
  const R = rng(1871);
  const windows: number[] = [];

  const stone = col('#dccfb8');
  const stoneShade = col('#b8a993');
  const paving = col('#b9a487');
  const rock = col('#8c7f74');
  const blue = col('#38508f');
  const pearl = col('#eadcf2');
  const spike = col('#c9a6d8');
  const ivory = col('#f3ead9');
  const gold = col('#d9b66c');
  const grass = col('#5b7a45');
  const forest = col('#45603a');
  const sand = col('#d6c296');
  const cliff = col('#6e4f3c');
  const roofs = ['#c2603f', '#b4523a', '#cd7650', '#a94a35', '#c96a45', '#7f8aa6'].map(col);
  const walls = ['#e4d8c2', '#d9c9ae', '#eadfcb', '#cdbb9c'].map(col);
  const byNormal = (top: THREE.Color, side: THREE.Color) => (n: THREE.Vector3) => (n.y > 0.6 ? top : side);

  // The north shore of World I running down to the estuary, so the land does not end at the grid edge.
  const xs: number[] = [];
  for (let x = GRID.minX; x <= 140; x += 15) xs.push(x);
  const rows = [GRID.minZ + 0.5, -262, -282, -302, -322, -338];
  const apron = new Float32Array(xs.length * rows.length);
  xs.forEach((x, i) => {
    const edge = terrain.heightAt(x, GRID.minZ + 0.5) - 0.4;
    rows.forEach((z, j) => {
      const t = j / (rows.length - 1);
      // Falls to the estuary, with a low rise north of the King's Gate; the bay keeps its coast.
      const hill = 8 * Math.exp(-(((x + 40) / 70) ** 2)) * Math.sin(t * Math.PI);
      let h = j === 0 ? edge : (edge - 4) * (1 - smoothstep(0, 1, t)) + hill - 1.2 * t + 0.5 * Math.sin(x * 0.13 + j * 1.7);
      const coastX = 128 + ((z + 260) * 68) / 140;
      if (j > 0) h = Math.min(h, -1.5 + (coastX - x) * 0.75);
      apron[j * xs.length + i] = h;
    });
  });
  {
    const pos: number[] = [];
    const v = (i: number, j: number) => pos.push(xs[i], apron[j * xs.length + i], rows[j]);
    for (let j = 0; j < rows.length - 1; j++)
      for (let i = 0; i < xs.length - 1; i++) {
        v(i, j); v(i + 1, j); v(i, j + 1);
        v(i + 1, j); v(i + 1, j + 1); v(i, j + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    P.add(g, (n, p) => (n.y < 0.8 ? cliff : p.y < 0.6 ? sand : Math.sin(p.x * 0.07 + p.z * 0.05) > 0.1 ? grass : forest));
  }

  // The city's land: the peninsula under the walls, reaching west.
  P.add(slab(SHORE, 2.2, -3), byNormal(grass, sand));
  TERRACES.forEach((t, k) => P.add(slab(t.poly, t.top, k === 0 ? -1 : TERRACES[k - 1].top - 1), byNormal(paving, stoneShade)));
  // Far hills behind the city.
  for (const [x, z, r, h] of [[-210, -760, 90, 46], [-60, -820, 120, 60], [300, -800, 110, 52], [-260, -560, 70, 30]] as [number, number, number, number][])
    P.add(new THREE.ConeGeometry(r, h, 7, 1, true).translate(x, h / 2 - 2, z), forest);

  // Walls (shaded at the foot) and round towers with blue caps at every corner and along the long runs.
  const wallShade = (_n: THREE.Vector3, p: THREE.Vector3) => stoneShade.clone().lerp(stone, smoothstep(1, 19, p.y));
  const tower = (x: number, z: number, r: number, h: number) => {
    P.add(new THREE.CylinderGeometry(r, r * 1.1, h, 8, 1, true).translate(x, h / 2 + 1, z), wallShade);
    P.add(new THREE.ConeGeometry(r * 1.3, r * 2.4, 8, 1, true).translate(x, h + 1 + r * 1.2, z), blue);
  };
  for (let i = 0; i < WALL.length; i++) {
    const [ax, az] = WALL[i];
    const [bx, bz] = WALL[(i + 1) % WALL.length];
    if (i === WALL.length - 2) continue; // the gate gap
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(-(bz - az), bx - ax);
    P.add(box(len, 18, 4, (ax + bx) / 2, 10, (az + bz) / 2, yaw), wallShade);
    P.add(box(len, 1.4, 5, (ax + bx) / 2, 19.6, (az + bz) / 2, yaw), stoneShade);
    const mids = Math.floor(len / 62);
    for (let m = 1; m <= mids; m++) tower(ax + ((bx - ax) * m) / (mids + 1), az + ((bz - az) * m) / (mids + 1), 3.8, 22);
  }
  for (const [x, z] of WALL) tower(x, z, 5.4, 27);

  // Houses on the terraces: walls, gable roofs, a few lit windows facing World I. Few on the lowest
  // terrace, where the wall hides them; tall town houses higher up.
  const band = (x: number, z: number) => {
    for (let k = TERRACES.length - 1; k >= 0; k--) if (polySignedDist(x, z, TERRACES[k].poly) > 0) return k;
    return -1;
  };
  const quota = [22, 54, 42];
  let houses = 0;
  for (let tries = 0; tries < 3000 && houses < quota[0] + quota[1] + quota[2]; tries++) {
    const x = -140 + R() * 400;
    const z = -730 + R() * 340;
    const w = 6 + R() * 6;
    const d = 5 + R() * 4;
    const tall = R();
    const k = band(x, z);
    const roofPick = R();
    const wallPick = R();
    const turn = R();
    const lit = R();
    if (k < 0 || quota[k] <= 0) continue;
    const t = TERRACES[k];
    const inner = TERRACES[k + 1];
    if (polySignedDist(x, z, t.poly) < 7 || (inner && polySignedDist(x, z, inner.poly) > -7)) continue;
    if (Math.hypot(x - KX, z - KZ) < 64 || Math.hypot(x + 18, z + 532) < 30) continue;
    const hh = k === 0 ? 12 + tall * 8 : 6 + tall * (k === 2 ? 9 : 6);
    const yaw = Math.atan2(x - KX, z - KZ) + (turn < 0.5 ? 0 : Math.PI / 2) + (turn - 0.5) * 0.4;
    const y = t.top;
    P.add(box(w, hh, d, x, y + hh / 2, z, yaw), walls[Math.floor(wallPick * walls.length)]);
    P.add(gable(w + 0.6, d + 0.8, 2.5 + d * 0.35, x, y + hh, z, yaw), roofs[Math.floor(roofPick * roofs.length)]);
    const ez = Math.abs(Math.cos(yaw)) * d * 0.5 + Math.abs(Math.sin(yaw)) * w * 0.5 + 0.3;
    if (lit < 0.75) windows.push(x + (lit - 0.375) * w * 0.8, y + hh * (0.35 + lit * 0.4), z + ez);
    quota[k]--;
    houses++;
  }

  // The Tide Cathedral in the middle town: a long nave and two west towers.
  {
    const cx = -18;
    const cz = -532;
    const y = TERRACES[1].top;
    const yaw = 0.35;
    P.add(box(16, 22, 42, cx, y + 11, cz, yaw), stone);
    P.add(gable(42, 17.5, 11, cx, y + 22, cz, yaw + Math.PI / 2), blue);
    for (const s of [-1, 1]) {
      const tx = cx + Math.cos(yaw) * 7 * s + Math.sin(yaw) * 22;
      const tz = cz - Math.sin(yaw) * 7 * s + Math.cos(yaw) * 22;
      P.add(box(6, 38, 6, tx, y + 19, tz, yaw), stone);
      P.add(new THREE.ConeGeometry(4.6, 16, 4, 1, true).rotateY(Math.PI / 4 + yaw).translate(tx, y + 46, tz), blue);
    }
    windows.push(cx + Math.sin(yaw) * 21.2, y + 13, cz + Math.cos(yaw) * 21.2);
  }

  // The Crownshell keep: castle rock, curtain and six towers, the carapace dome, the spire and its crown.
  const KEEP = 46;
  P.add(new THREE.CylinderGeometry(38, 52, KEEP - TERRACES[2].top + 2, 12, 1, true).translate(KX, (KEEP + TERRACES[2].top - 2) / 2, KZ), rock);
  P.add(new THREE.CircleGeometry(38, 12).rotateX(-Math.PI / 2).translate(KX, KEEP, KZ), paving);
  P.add(new THREE.CylinderGeometry(30, 31, 26, 12, 1, true).translate(KX, KEEP + 13, KZ), wallShade);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const tx = KX + Math.cos(a) * 31;
    const tz = KZ + Math.sin(a) * 31;
    P.add(new THREE.CylinderGeometry(4.6, 5, 46, 8, 1, true).translate(tx, KEEP + 23, tz), stone);
    P.add(new THREE.CylinderGeometry(5.6, 5.6, 2, 8, 1, true).translate(tx, KEEP + 46.5, tz), stoneShade);
    P.add(new THREE.ConeGeometry(6.2, 15, 8, 1, true).translate(tx, KEEP + 55, tz), blue);
    windows.push(tx, KEEP + 30, tz + 5);
  }
  const DOME = KEEP + 24;
  P.add(new THREE.SphereGeometry(30, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(KX, DOME, KZ), pearl);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const el = (i % 2 === 0 ? 0.36 : 0.72) * (Math.PI / 2);
    const nx = Math.cos(a) * Math.cos(el);
    const ny = Math.sin(el);
    const nz = Math.sin(a) * Math.cos(el);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny * 1.3, nz).normalize());
    P.add(new THREE.ConeGeometry(2.8, 10, 4, 1, true).translate(0, 4.5, 0).applyQuaternion(q).translate(KX + nx * 29, DOME + ny * 29, KZ + nz * 29), spike);
  }
  // Spire: a shaft from the dome's crown with two galleries and a flared cup at the top.
  const SPIRE0 = DOME + 26;
  const CUP = 174;
  P.add(new THREE.CylinderGeometry(3.6, 6.4, CUP - SPIRE0, 8, 1, true).translate(KX, (CUP + SPIRE0) / 2, KZ), stone);
  for (const [y, r] of [[SPIRE0 + 20, 6.6], [CUP - 16, 5.4]] as [number, number][]) P.add(new THREE.CylinderGeometry(r, r - 0.6, 2.6, 8).translate(KX, y, KZ), stoneShade);
  P.add(new THREE.CylinderGeometry(7.2, 3.6, 5, 8, 1, true).translate(KX, CUP + 2.5, KZ), gold);
  // Crown of six claws curving up and in round the lantern.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const pts = ([[6, CUP + 4], [10, CUP + 7.5], [11.6, CUP + 12], [10.4, CUP + 16], [7.2, CUP + 18.2], [4.2, CUP + 17.4]] as [number, number][]).map(
      ([r, y]) => new THREE.Vector3(KX + Math.cos(a) * r, y, KZ + Math.sin(a) * r),
    );
    P.add(tube(pts, (t) => 1.9 * (1 - t) + 0.25, 5), ivory);
  }
  P.add(new THREE.IcosahedronGeometry(3.6, 1).translate(KX, TIDECROWN_VIEW.lanternY, KZ), col('#6fb9b7'));

  // The claw gate and the bridge of six shells over the estuary.
  for (const s of [-1, 1]) {
    const pts = ([[11, 2], [12.5, 18], [11.5, 32], [7, 42], [1.6, 46]] as [number, number][]).map(([r, y]) => new THREE.Vector3(GATE[0] + r * s, y, GATE[1] - 2));
    P.add(tube(pts, (t) => 4.2 * (1 - t) + 0.5, 6), ivory);
  }
  P.add(box(9, 2.4, 64, GATE[0], 7.5, GATE[1] + 34), stoneShade);
  for (let i = 0; i < 4; i++) P.add(box(10, 7, 4, GATE[0], 3, GATE[1] + 10 + i * 15), stone);
  for (let i = 0; i < 6; i++) {
    const z = GATE[1] + 8 + i * 10;
    for (const s of [-1, 1]) P.add(box(1.6, 5, 1.6, GATE[0] + 4.2 * s, 11, z), ivory);
  }

  const solid = new THREE.Mesh(P.merge(), new THREE.MeshStandardMaterial({ name: 'tidecrown-skyline', vertexColors: true, roughness: 0.92, metalness: 0 }));
  solid.name = 'tidecrown-skyline-solid';
  solid.castShadow = solid.receiveShadow = false;
  group.add(solid);

  // Window lights: tiny warm points that ignore the fog, shown at night only.
  const winGeo = new THREE.BufferGeometry();
  winGeo.setAttribute('position', new THREE.Float32BufferAttribute(windows, 3));
  const winMat = new THREE.PointsMaterial({ color: '#ffc27a', size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const winPoints = new THREE.Points(winGeo, winMat);
  winPoints.name = 'tidecrown-skyline-windows';
  winPoints.visible = false;
  group.add(winPoints);

  // The lantern: a glow and a soft beam into the sky, both outside the fog.
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const glow = new THREE.Sprite(glowMat);
  glow.name = 'tidecrown-lantern-glow';
  glow.position.set(KX, TIDECROWN_VIEW.lanternY, KZ);
  glow.scale.setScalar(44);
  glow.renderOrder = 7;
  glow.visible = false;
  group.add(glow);
  const BEAM_H = 560;
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vN;
      varying vec3 vVP;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vVP = mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      uniform float uTime;
      varying float vH;
      varying vec3 vN;
      varying vec3 vVP;
      void main() {
        float facing = pow(abs(dot(normalize(vN), normalize(-vVP))), 2.0);
        float fall = pow(1.0 - vH, 1.6) * smoothstep(0.0, 0.015, vH);
        float shimmer = 0.85 + 0.15 * sin(vH * 40.0 - uTime * 2.2);
        float a = facing * fall * shimmer * uLevel;
        gl_FragColor = vec4(vec3(0.35, 0.95, 1.0) * a * 1.6, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 1.5, BEAM_H, 12, 1, true).translate(0, BEAM_H / 2, 0), beamMat);
  beam.name = 'tidecrown-lantern-beam';
  beam.position.set(KX, TIDECROWN_VIEW.lanternY + 2, KZ);
  beam.renderOrder = 6;
  beam.visible = false;
  group.add(beam);

  /** Seconds after the beacon before the lantern answers, and the fade in. */
  const DELAY = 2.5;
  const FADE_IN = 2;
  const state = { lit: false, level: 0, delay: 0 };
  let started = false;
  const apply = (elapsed: number) => {
    const k = state.level * state.level * (3 - 2 * state.level);
    const pulse = 0.86 + 0.14 * Math.sin(elapsed * 1.7);
    glow.visible = beam.visible = k > 0.001;
    glowMat.opacity = Math.min(1, k * (0.75 + 0.25 * pulse));
    glow.scale.setScalar(44 * (0.85 + 0.15 * k) * (0.94 + 0.06 * pulse));
    beamMat.uniforms.uLevel.value = k * (0.8 + 0.2 * pulse);
    beamMat.uniforms.uTime.value = elapsed;
  };
  return {
    group,
    state,
    setLit(lit, instant) {
      // Nothing animates before the world has run a frame (a save restored during loading).
      if (!started) instant = true;
      if (lit === state.lit) {
        if (instant) state.level = lit ? 1 : 0, state.delay = 0;
        return;
      }
      state.lit = lit;
      if (instant) {
        state.level = lit ? 1 : 0;
        state.delay = 0;
      } else state.delay = lit ? DELAY : 0;
      apply(0);
    },
    setNight(n) {
      winMat.opacity = n;
      winPoints.visible = n > 0.01;
    },
    update(dt, elapsed) {
      started = true;
      if (state.lit) {
        if (state.delay > 0) state.delay = Math.max(0, state.delay - dt);
        else state.level = Math.min(1, state.level + dt / FADE_IN);
      } else state.level = Math.max(0, state.level - dt / 1.2);
      apply(elapsed);
    },
  };
}
