// The tribute's snow city: Frostlight's village houses (the Medieval Village MegaKit, dressed for snow as in
// snowVillage.ts) raised into a walled city on the plateau, where the dwarf's road ends. A gatehouse between two
// towers closes the road, a crenellated wall runs either side, and stone terraces climb behind it to a keep, each
// terrace lined with lit houses. While the cue runs the world's own meshes and pines inside `clear` are hidden.
//
//   snow-city  at: [x, z] gate centre on the wall line, yaw: front direction (0 faces +z), clear: [x0, z0, x1, z1]
//              world box emptied of the world's meshes (and kit pines) smaller than `max` (default 60), and the
//              usual envelope (t, until)
import * as THREE from 'three';
import { snowCover } from '../../../game/snowCover';
import { TownBuilder, type WallSet } from '../../../world/buildings';
import { worldBox } from '../../../world/geom';
import { type Kit, loadKit, type PlaceOptions, StaticBatch, trs } from '../../../world/kit';
import { addPatch, stylise } from '../../../world/materials';
import { envelope, glowTexture, mulberry, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Ground = (x: number, z: number) => number;
const H = 3; // storey height of the kit
/** Fortifications and the keep are the village kit scaled up: the city is built to outlast its houses. */
const FORT = 1.5;
const KEEP = 1.3;

/** Kit batch that tints the window glass per placement (lit, dim or dark rooms), as the village does. */
const FLUSH = /^(Window_|Door_|DoorFrame_)/;
class TintBatch extends StaticBatch {
  constructor(kit: Kit, name: string, private tint: Map<THREE.Material, () => number>) {
    super(kit, name);
  }
  override add(piece: string, m: THREE.Matrix4, opts: PlaceOptions = {}): void {
    super.add(piece, m, FLUSH.test(piece) ? { ...opts, castShadow: false } : opts);
  }
  override addGeometry(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4 | null, castShadow = true): void {
    const f = this.tint.get(mat);
    if (f) {
      geo = geo.clone();
      const n = geo.getAttribute('position').count, v = f(), c = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) c.set([v, v, v, 1], i * 4);
      geo.setAttribute('color', new THREE.BufferAttribute(c, 4));
      castShadow = false;
    }
    super.addGeometry(geo, mat, m, castShadow);
  }
}

interface Place {
  /** City frame: x along the wall, z out of the gate (negative is inside), y above the plateau at the gate. */
  m(lx: number, y: number, lz: number, yaw?: number, s?: number | THREE.Vector3): THREE.Matrix4;
  world(lx: number, lz: number): [number, number];
}

async function raise(at: [number, number], yaw: number, ground: Ground): Promise<THREE.Group> {
  const [village, props] = await Promise.all([loadKit('models/world/village.glb'), loadKit('models/world/props.glb')]);
  const group = new THREE.Group();
  group.name = 'tribute-snow-city';
  const variants = new Map<THREE.Material, THREE.Material>();
  const snowy = (m: THREE.Material) => {
    let v = variants.get(m);
    if (v) return v;
    v = m.clone();
    const sm = v as THREE.MeshStandardMaterial;
    if (!/Metal/.test(m.name)) {
      sm.metalness = 0;
      sm.metalnessMap = null;
    }
    if (!/Cloth|Vine/.test(m.name)) sm.side = THREE.FrontSide;
    stylise(v, m.name === 'MI_RoundTiles' ? 1.05 : 0.98, [1.0, 0.99, 0.98]);
    snowCover(v, { cover: m.name === 'MI_RoundTiles' ? 2.2 : m.name.startsWith('MI_Trim_Cloth') ? 1.15 : m.name === 'MI_UnevenBrick' ? 1.4 : 1 });
    variants.set(m, v);
    return v;
  };
  const glass = new THREE.MeshStandardMaterial({ name: 'snow-city-window', color: '#2a1a0c', emissive: '#ff9a3c', emissiveIntensity: 3.2, roughness: 0.3, side: THREE.DoubleSide, vertexColors: true });
  addPatch(glass, 'snow-city-window', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.r;');
  });
  const vOver: Record<string, THREE.Material> = {};
  const pOver: Record<string, THREE.Material> = {};
  for (const [name, m] of village.materials) vOver[name] = snowy(m);
  for (const [name, m] of props.materials) pOver[name] = snowy(m);
  vOver.MI_WindowGlass = glass;
  const pick = mulberry(7451);
  const lit = () => {
    const r = pick();
    return r < 0.12 ? 0.06 : r < 0.3 ? 0.35 + pick() * 0.2 : 0.8 + pick() * 0.5;
  };
  const homes = new TintBatch(village, 'snow-city-homes', new Map([[glass as THREE.Material, lit]]));
  const builder = new TownBuilder(village, homes, null, vOver);
  const stone = snowy(village.materials.get('MI_UnevenBrick')!);
  const kitProps = new StaticBatch(props, 'snow-city-props');

  const c = Math.cos(yaw), s = Math.sin(yaw);
  const y0 = ground(at[0], at[1]);
  const P: Place = {
    world: (lx, lz) => [at[0] + c * lx + s * lz, at[1] - s * lx + c * lz],
    m: (lx, y, lz, ry = 0, sc = 1) => {
      const [x, z] = P.world(lx, lz);
      return trs(x, y0 + y, z, yaw + ry, sc);
    },
  };
  const pos = (lx: number, y: number, lz: number) => {
    const [x, z] = P.world(lx, lz);
    return new THREE.Vector3(x, y0 + y, z);
  };
  /** Lowest ground under a city-frame rectangle, relative to the gate, so plinths reach down far enough. */
  const low = (lx: number, lz: number, hx: number, hz: number) => {
    let m = Infinity;
    for (let i = 0; i <= 4; i++)
      for (let j = 0; j <= 4; j++) {
        const [x, z] = P.world(lx + (i / 2 - 1) * hx, lz + (j / 2 - 1) * hz);
        m = Math.min(m, ground(x, z));
      }
    return m - y0;
  };
  /** A stone block in the city frame from `bottom` to `top`, centred on lx, lz. */
  const block = (lx: number, lz: number, w: number, d: number, bottom: number, top: number, ry = 0) => {
    const g = worldBox(w, top - bottom, d, 0.5).translate(0, (top + bottom) / 2, 0).applyMatrix4(P.m(lx, 0, lz, ry));
    homes.addGeometry(g, stone, null, true);
  };
  const glows: { p: THREE.Vector3; size: number; color: string }[] = [];
  const lantern = (lx: number, y: number, lz: number, ry: number, sc: number) => {
    const m = P.m(lx, y, lz, ry, sc);
    kitProps.add('Lantern_Wall', m, { override: pOver, castShadow: false });
    glows.push({ p: new THREE.Vector3(0, 0.55, 1.1).applyMatrix4(m), size: 2.2 * sc, color: '#ffb257' });
  };

  type HouseArgs = { sx: number; sz: number; floors: number; ground: WallSet; upper: WallSet; ridge: 'x' | 'z'; door?: number; noRoof?: boolean; round?: boolean; wide?: boolean; chimney?: boolean; seed: number };
  const house = (base: THREE.Matrix4, at3: THREE.Vector3, o: HouseArgs) =>
    builder.house(base, { sx: o.sx, sz: o.sz, floors: o.floors, ground: o.ground, upper: o.upper, ridge: o.ridge, doors: o.door === undefined ? [] : [{ side: 'front', index: o.door, round: true, big: o.sx >= 3 }], wide: o.wide ?? o.seed % 3 !== 0, round: o.round ?? o.seed % 2 === 0, shutters: true, chimney: o.chimney ?? true, dormer: o.floors > 1 && o.seed % 2 === 1, noRoof: o.noRoof, seed: o.seed }, at3);
  /**
   * A stone tower two kit modules square, `floors` storeys at `scale`, standing on y: brick faces with a few lit
   * slit windows, stone quoins at the corners (the kit's are timber), and either a round tiled spire or a
   * crenellated top.
   */
  const tower = (lx: number, y: number, lz: number, floors: number, scale: number, seed: number, spire = true) => {
    const base = P.m(lx, y, lz, 0, scale);
    const r = mulberry(seed * 977 + 13);
    const sides: [number, (i: number) => [number, number]][] = [
      [0, (i) => [-1 + 2 * i, 2]],
      [Math.PI, (i) => [1 - 2 * i, -2]],
      [-Math.PI / 2, (i) => [-2, 1 - 2 * i]],
      [Math.PI / 2, (i) => [2, -1 + 2 * i]],
    ];
    const m = new THREE.Matrix4();
    for (let f = 0; f < floors; f++)
      for (const [ry, at2] of sides)
        for (let i = 0; i < 2; i++) {
          const [x, z] = at2(i);
          const lit = f > 0 && r() < (f === floors - 1 ? 0.6 : 0.3);
          m.multiplyMatrices(base, trs(x, f * H, z, ry));
          homes.add(lit ? 'Wall_UnevenBrick_Window_Thin_Round' : 'Wall_UnevenBrick_Straight', m, { override: vOver });
          if (lit) homes.add('Window_Thin_Round1', m, { override: vOver });
        }
    const top = floors * H * scale, half = 2 * scale;
    for (const [qx, qz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [cx, cz] = [lx + qx * half, lz + qz * half];
      homes.addGeometry(worldBox(0.75 * scale, top + 0.3, 0.75 * scale, 0.5).translate(0, (top + 0.3) / 2, 0).applyMatrix4(P.m(cx, y, cz)), stone, null, true);
    }
    // A string course of stone at every other storey breaks the height.
    for (let f = 2; f < floors; f += 2) block(lx, lz, half * 2 + 0.35, half * 2 + 0.35, y + f * H * scale - 0.18, y + f * H * scale + 0.18);
    if (spire) homes.add('Roof_Tower_RoundTiles', new THREE.Matrix4().multiplyMatrices(base, trs(0, floors * H, 0, 0, 0.92)), { override: vOver });
    else {
      block(lx, lz, half * 2 + 0.6, half * 2 + 0.6, y + top - 0.1, y + top + 0.35);
      for (const [qx, qz, ry] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]])
        for (const k of [-1, 0, 1]) {
          const ox = qx === 0 ? k * half * 0.66 : qx * (half + 0.05), oz = qz === 0 ? k * half * 0.66 : qz * (half + 0.05);
          block(lx + ox, lz + oz, half * 0.42, 0.7, y + top + 0.35, y + top + 1.7, ry);
        }
    }
    // Plinth down to the snow where the ground falls away.
    block(lx, lz, half * 2 + 0.2, half * 2 + 0.2, low(lx, lz, half, half) - 0.5, y + 0.05);
  };
  /** Crenellated wall from (x0, z0) to (x1, z1) in the city frame, outer face to the left of travel. */
  const wall = (x0: number, z0: number, x1: number, z1: number, courses: number) => {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = uz, nz = -ux; // outward normal
    const ry = Math.atan2(nx, nz); // kit walls face their local +z
    const mod = 2 * FORT, n = Math.max(1, Math.round(len / mod)), step = len / n, top = courses * H * FORT, depth = 3;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * step, lx = x0 + ux * t, lz = z0 + uz * t;
      const bottom = low(lx, lz, step / 2, 1.5);
      for (let k = 0; k < courses; k++) homes.add('Wall_UnevenBrick_Straight', P.m(lx, k * H * FORT, lz, ry, new THREE.Vector3(step / 2, FORT, FORT)), { override: vOver });
      // Core and footing behind the face, and a merlon on the outer edge of every module.
      block(lx - nx * depth / 2, lz - nz * depth / 2, step + 0.02, depth, Math.min(0, bottom) - 0.6, top, ry);
      block(lx - nx * 0.45, lz - nz * 0.45, step * 0.46, 0.9, top, top + 1.5, ry);
    }
  };

  // ------------------------------------------------------------------ the front: gatehouse and wall
  const gateTop = 2 * H * FORT;
  // Gate block: three kit modules wide at the fort scale, a great round door in the middle.
  const gb = P.m(0, 0, -1.5, 0, FORT);
  house(gb, pos(0, 0, -1.5), { sx: 3, sz: 2, floors: 2, ground: 'stone', upper: 'stone', ridge: 'x', door: 1, noRoof: true, round: true, wide: false, chimney: false, seed: 5 });
  block(0, -1.5, 9.2, 6.2, low(0, -1.5, 4.6, 3) - 0.5, 0.05);
  for (let i = 0; i < 5; i++) block(-3.6 + i * 1.8, 1.1, 0.9, 0.8, gateTop, gateTop + 1.4);
  block(0, -1.5, 9.1, 6.1, gateTop - 0.1, gateTop + 0.2);
  // Two gate towers forward of the wall, and their banners and lamps.
  for (const side of [-1, 1]) {
    tower(side * 7.6, 0, -0.5, 4, FORT, 11 + side);
    kitProps.add('Banner_1', P.m(side * 7.6, 9.6, 2.55, 0, 2.2), { override: pOver });
    lantern(side * 3.2, 4.2, 1.6, 0, 1.4);
    lantern(side * 7.6, 13.5, 2.55, 0, 1.2);
  }
  kitProps.add('Banner_2', P.m(0, 5.2, 1.65, 0, 2.0), { override: pOver });
  // The wall: out to the corners, then back along the sides toward the ice.
  wall(-10.6, 0, -40, 0, 2);
  wall(40, 0, 10.6, 0, 2);
  wall(-40, 0, -40, -46, 2);
  wall(40, -46, 40, 0, 2);
  for (const side of [-1, 1]) {
    tower(side * 24, 0, -0.8, 3, FORT, 21 + side, false);
    tower(side * 40, 0, -0.5, 4, FORT, 31 + side);
    tower(side * 40, 0, -24, 3, FORT, 41 + side, false);
    lantern(side * 24, 9.5, 2.3, 0, 1.2);
    lantern(side * 40, 12, 2.6, 0, 1.2);
  }

  // ------------------------------------------------------------- terraces climbing to the keep
  const T2 = 9, T3 = 18, T4 = 27;
  const rnd = mulberry(9203);
  const STYLES: [WallSet, WallSet][] = [
    ['stone', 'timber'],
    ['plasterBase', 'timber'],
    ['stone', 'plaster'],
    ['plasterBase', 'plaster'],
  ];
  /** A row of houses facing the gate along lz on level y, from x0 to x1, leaving the central street open. */
  const row = (lz: number, y: number, x0: number, x1: number, floors: [number, number], street = 4.5) => {
    let x = x0;
    while (x < x1) {
      const sx = [2, 3, 3, 4][Math.floor(rnd() * 4)];
      const w = sx * 2;
      const cx = x + w / 2;
      x += w + 0.6 + rnd() * 1.6;
      if (cx + w / 2 > x1 || Math.abs(cx) < street + w / 2) continue;
      const sz = rnd() < 0.5 ? 3 : 4;
      const f = floors[0] + Math.floor(rnd() * (floors[1] - floors[0] + 1));
      const seed = Math.floor(rnd() * 1e6);
      const [g, u] = STYLES[seed % 4];
      const zz = lz + (rnd() - 0.5) * 1.2, ry = (rnd() - 0.5) * 0.08;
      house(P.m(cx, y, zz, ry), pos(cx, y, zz), { sx, sz, floors: f, ground: g, upper: u, ridge: sz === 4 && rnd() < 0.4 ? 'z' : 'x', door: Math.floor((sx - 1) / 2), seed });
      block(cx, zz, w + 0.24, sz * 2 + 0.24, Math.min(y, low(cx, zz, sx, sz)) - 0.5, y + 0.05, ry);
    }
  };
  /** A stone terrace from lz front to back, x half-width, top at y, with a parapet along its front edge. */
  const terrace = (front: number, back: number, half: number, y: number) => {
    const lz = (front + back) / 2, d = front - back;
    block(0, lz, half * 2, d, low(0, lz, half, d / 2) - 0.8, y);
    for (let x = -half + 1; x < half; x += 2.4) if (Math.abs(x) > 3.2) block(x, front - 0.3, 1.6, 0.5, y, y + 0.9);
    lantern(-3.4, y - 1.6, front + 0.05, 0, 1.0);
    lantern(3.4, y - 1.6, front + 0.05, 0, 1.0);
  };
  /** Straight stone stair up the central street from (lz0, y0) to (lz1, y1). */
  const stair = (lz0: number, y0s: number, lz1: number, y1: number) => {
    const n = Math.max(2, Math.round((y1 - y0s) / 0.35)), d = (lz0 - lz1) / n;
    for (let i = 0; i < n; i++) block(0, lz0 - (i + 0.5) * d, 5, d + 0.02, y0s - 0.4, y0s + ((i + 1) * (y1 - y0s)) / n);
  };
  row(-9.5, 0, -37, 37, [2, 3]);
  terrace(-15, -31, 34, T2);
  stair(-11, 0, -15, T2);
  row(-21, T2, -32, 32, [2, 3]);
  row(-27.5, T2, -30, 30, [2, 3], 3.5);
  terrace(-31, -45, 26, T3);
  stair(-26.5, T2, -31, T3);
  row(-37, T3, -25, 25, [2, 3]);
  terrace(-45, -64, 18, T4);
  stair(-40.5, T3, -45, T4);

  // ------------------------------------------------------------------------------------ the keep
  const kb = P.m(0, T4, -53, 0, KEEP);
  house(kb, pos(0, T4, -53), { sx: 4, sz: 5, floors: 3, ground: 'stone', upper: 'stone', ridge: 'z', door: 1, round: true, wide: false, chimney: false, seed: 61 });
  for (const side of [-1, 1]) {
    tower(side * 7.9, T4, -47.4, 6, KEEP, 71 + side);
    kitProps.add('Banner_1', P.m(side * 7.9, T4 + 13, -44.7, 0, 2.0), { override: pOver });
    tower(side * 13, T4, -58, 4, KEEP, 81 + side);
  }
  tower(0, T4, -62, 8, KEEP, 91);
  lantern(-2.2, T4 + 2.5, -46.5, 0, 1.2);
  lantern(2.2, T4 + 2.5, -46.5, 0, 1.2);

  group.add(homes.build(), kitProps.build());
  // Warm halos round the lamps: they carry through the storm where the lamps themselves do not.
  const tex = glowTexture();
  for (const g of glows) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: g.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    sp.position.copy(g.p);
    sp.scale.setScalar(g.size);
    group.add(sp);
  }
  return group;
}

const cities = new Map<string, Promise<THREE.Group>>();

class City implements Effect {
  private group: THREE.Group | null = null;
  private hidden: THREE.Object3D[] = [];
  private culled: [THREE.BatchedMesh, number][] = [];
  private cleared = false;
  private gone = false;
  constructor(private cue: FxCue, private scene: THREE.Scene, ground: Ground) {
    const at = (cue.at as [number, number]) ?? [0, -52];
    const yaw = num(cue.yaw, 0);
    const key = `${at.join(',')}:${yaw}`;
    let city = cities.get(key);
    if (!city) cities.set(key, (city = raise(at, yaw, ground)));
    void city.then((g) => {
      if (this.gone) return;
      this.group = g;
      g.visible = false;
      scene.add(g);
    });
  }
  /** Hide the world's meshes and kit pines inside the clear box (once), so nothing grows through the city. */
  private clear(): void {
    this.cleared = true;
    const [x0, z0, x1, z1] = (this.cue.clear as number[]) ?? [0, 0, 0, 0];
    const max = num(this.cue.max, 60);
    const root = this.scene.getObjectByName(String(this.cue.root ?? 'WORLD IV · Frostlight'));
    const box = new THREE.Box3(), c = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Matrix4();
    const inside = (v: THREE.Vector3) => v.x >= x0 && v.x <= x1 && v.z >= z0 && v.z <= z1;
    root?.updateMatrixWorld(true);
    root?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
      const batched = mesh as unknown as THREE.BatchedMesh;
      if (batched.isBatchedMesh) {
        const info = (batched as unknown as { _instanceInfo: { active: boolean; visible: boolean }[] })._instanceInfo;
        for (let i = 0; i < info.length; i++) {
          if (!info[i].active || !info[i].visible) continue;
          batched.getMatrixAt(i, m);
          c.setFromMatrixPosition(m).applyMatrix4(batched.matrixWorld);
          if (!inside(c)) continue;
          batched.setVisibleAt(i, false);
          this.culled.push([batched, i]);
        }
        return;
      }
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
      box.getCenter(c);
      box.getSize(s);
      if (Math.max(s.x, s.z) > max || !inside(c)) return;
      this.hidden.push(mesh);
    });
  }
  update(ctx: FxContext): void {
    const on = envelope(this.cue, ctx.t) > 0;
    if (on && !this.cleared) this.clear();
    for (const o of this.hidden) o.visible = !on;
    for (const [b, i] of this.culled) b.setVisibleAt(i, !on);
    if (this.group) this.group.visible = on;
  }
  dispose(): void {
    this.gone = true;
    for (const o of this.hidden) o.visible = true;
    for (const [b, i] of this.culled) b.setVisibleAt(i, true);
    this.hidden = [];
    this.culled = [];
    this.group?.removeFromParent();
    this.group = null;
  }
}

registerEffect('snow-city', (cue, scene, ground) => new City(cue, scene, ground));
