// Tidecrown market dressing: kit stalls and carts (props.glb, CC0, see NOTICE.md) under Tidecrown's striped awnings,
// set in rings around a plaza with its lanes and centre left open. Each stall keeps a trade (fish, cloth, shells,
// produce, pots) and heaps its counter with it; the hall's tables and the King's Way's edges through the square get
// their own goods, benches and stock. planMarket lays the stalls out as plain numbers (and their colliders);
// dressMarket builds them (what it adds beyond the plan is dressing without colliders, off the walks).
import * as THREE from 'three';
import { trs } from '../../world/kit';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { awningGeometry, type DistrictStreet, type Height, pointInPoly, polyDist, polyLineDist, stream, type TidecrownCollider, TideBatch, type TidecrownKit, type V2 } from './houses';

export interface MarketPlanOptions {
  /** Plaza centre and radius. */
  x: number;
  z: number;
  radius: number;
  height: Height;
  seed?: number;
  /** Directions kept free from the centre to the rim, as angles of (cos a, sin a) in world x/z. */
  lanes?: number[];
  /** Width of each lane, default 5. */
  laneWidth?: number;
  /** Streets crossing the plaza: stalls keep their paving (plus half a metre) clear. */
  streets?: DistrictStreet[];
  /** Radius around the centre kept open (fountain, statue), default radius * 0.3. */
  inner?: number;
  /** Ground kept free of stalls (a fountain or a hall standing in the plaza). */
  reserved?: V2[][];
  /** Rings of stalls as fractions of the radius, facing the centre (1) or away (-1); default two. */
  rings?: { f: number; facing: 1 | -1 }[];
}
export interface MarketOptions extends MarketPlanOptions {
  kit: TidecrownKit;
  name?: string;
  /** Market halls to set with tables of goods: centre, floor height and yaw (local x along the hall). */
  halls?: { x: number; y: number; z: number; yaw: number }[];
}
export interface MarketStall {
  kind: 'stall' | 'cart' | 'table';
  x: number;
  z: number;
  /** Rotation.y; the customer side is local +Z. */
  yaw: number;
  hx: number;
  hz: number;
}
export interface MarketPlan {
  stalls: MarketStall[];
  /** Crate stacks between neighbouring outer stalls. */
  stacks: { x: number; z: number; yaw: number }[];
  colliders: TidecrownCollider[];
}
export interface Market {
  group: THREE.Group;
  colliders: TidecrownCollider[];
  stalls: MarketStall[];
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

/** Half extents of each kind on the ground (with its goods), for spacing and colliders. */
const SIZE: Record<MarketStall['kind'], [number, number]> = { stall: [1.05, 0.62], cart: [1.65, 0.62], table: [1.5, 0.66] };

const corners = (x: number, z: number, hx: number, hz: number, yaw: number): V2[] => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz] as V2);
};

/**
 * Place stalls around a plaza: an outer ring facing in and an inner ring facing out, with an aisle between,
 * every lane, the centre and the reserved ground left clear; crate stacks between some outer stalls.
 */
export function planMarket(o: MarketPlanOptions): MarketPlan {
  const r = stream(o.seed ?? 3);
  const lanes = o.lanes ?? [];
  const laneW = o.laneWidth ?? 5;
  const inner = o.inner ?? o.radius * 0.3;
  const stalls: MarketStall[] = [];
  // A footprint is clear of a lane when every corner keeps half the lane width (plus a margin) off its ray.
  const inLane = (x: number, z: number, hx: number, hz: number, yaw: number) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [ax, az] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0]]) {
      const px = x + c * ax + s * az - o.x;
      const pz = z - s * ax + c * az - o.z;
      if (Math.hypot(px, pz) < inner) return true;
      for (const a of lanes) {
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const along = px * dx + pz * dz;
        if (along > -0.5 && Math.abs(px * dz - pz * dx) < laneW / 2 + 0.4) return true;
      }
    }
    return false;
  };
  const clear = (x: number, z: number, hx: number, hz: number, yaw: number) => {
    if (inLane(x, z, hx, hz, yaw)) return false;
    const q = corners(x, z, hx, hz, yaw);
    if ((o.reserved ?? []).some((p) => polyDist(q, p) < 0.6 || q.some(([px, pz]) => pointInPoly(px, pz, p)))) return false;
    return !(o.streets ?? []).some((st) => polyLineDist(q, st.points) < st.width / 2 + 0.5);
  };
  const fits = (x: number, z: number, hx: number, hz: number, yaw: number) => {
    if (!clear(x, z, hx, hz, yaw)) return false;
    return stalls.every((st) => Math.hypot(st.x - x, st.z - z) > Math.max(hx, hz) + Math.max(st.hx, st.hz) + 0.5);
  };

  const rings: { rad: number; facing: 1 | -1 }[] = o.rings
    ? o.rings.map((g) => ({ rad: Math.max(inner + 1.4, o.radius * g.f), facing: g.facing }))
    : [
        { rad: o.radius * 0.8, facing: 1 },
        { rad: Math.max(inner + 1.4, o.radius * 0.46), facing: -1 },
      ];
  for (const ring of rings) {
    const circ = Math.PI * 2 * ring.rad;
    let a = r() * Math.PI * 2;
    const end = a + Math.PI * 2;
    while (a < end) {
      const kind: MarketStall['kind'] = r() < 0.55 ? 'stall' : r() < 0.6 ? 'cart' : 'table';
      const [hx, hz] = SIZE[kind];
      const da = (hx * 2 + 1.1) / circ * Math.PI * 2;
      const mid = a + da / 2;
      const x = o.x + Math.cos(mid) * ring.rad;
      const z = o.z + Math.sin(mid) * ring.rad;
      // Front (+z local) toward the centre on the outer ring, outward on the inner one.
      const yaw = Math.atan2((o.x - x) * ring.facing, (o.z - z) * ring.facing);
      if (mid + da / 2 <= end && fits(x, z, hx, hz, yaw)) {
        stalls.push({ kind, x, z, yaw, hx, hz });
        a += da;
      } else a += 0.4 / ring.rad;
    }
  }
  const colliders: TidecrownCollider[] = [];
  for (const st of stalls) {
    const y = o.height(st.x, st.z);
    colliders.push({ x: st.x, z: st.z, hx: st.hx, hz: st.hz, c: Math.cos(st.yaw), s: Math.sin(st.yaw), y0: y - 1, y1: y + 3 });
  }
  // Crates and barrels stacked between the outer stalls.
  const stacks: MarketPlan['stacks'] = [];
  const outer = stalls.filter((st) => Math.hypot(st.x - o.x, st.z - o.z) > o.radius * 0.6);
  for (let i = 0; i < outer.length; i++) {
    if (r() < 0.4) continue;
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    if (Math.hypot(a.x - b.x, a.z - b.z) > 6 || !clear(x, z, 0.7, 0.6, a.yaw)) continue;
    const yaw = a.yaw + (r() - 0.5) * 0.5;
    stacks.push({ x, z, yaw });
    const y = o.height(x, z);
    colliders.push({ x, z, hx: 0.7, hz: 0.6, c: Math.cos(yaw), s: Math.sin(yaw), y0: y - 1, y1: y + 2 });
  }
  return { stalls, stacks, colliders };
}

// ------------------------------------------------------------------------------------------------
// Wares: what the stalls sell, as small shapes in one vertex-coloured material.

const lin = (hex: string) => new THREE.Color(hex);
let waresMaterial: THREE.MeshStandardMaterial | null = null;
function waresMat(): THREE.MeshStandardMaterial {
  return (waresMaterial ??= new THREE.MeshStandardMaterial({ name: 'tidecrown-wares', vertexColors: true, roughness: 0.42, metalness: 0.06 }));
}

/** `g` with a colour per vertex from its local position. */
function painted(g: THREE.BufferGeometry, col: (x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const p = g.getAttribute('position'), c = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const k = col(p.getX(i), p.getY(i), p.getZ(i));
    c.set([k.r, k.g, k.b, 1], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 4));
  return g;
}

/** A fish `len` long along +x (head at +x): dark back to pale belly, a fan of a tail. */
function fishGeometry(back: string, belly: string, len = 0.36): THREE.BufferGeometry {
  const h = len * 0.26;
  const tail = new THREE.ConeGeometry(len * 0.15, h, 4).rotateZ(-Math.PI / 2).scale(1, 1, 0.22).translate(-len * 0.5 - h * 0.42, 0, 0);
  const g = mergeGeometries([new THREE.SphereGeometry(0.5, 10, 6).scale(len, len * 0.26, len * 0.16), tail])!;
  const b = lin(back), w = lin(belly), t = new THREE.Color();
  return painted(g, (_x, y) => t.copy(w).lerp(b, THREE.MathUtils.smoothstep(y, -0.3 * h, 0.35 * h)));
}

const SHELL_TONES = ['#f3c7b8', '#f6e7d2', '#e8907a', '#d9b9e0', '#f2d9a0', '#ffffff'];
const CLOTH_TONES = ['#2b5b93', '#d9a536', '#f1eadb', '#8c2f2f', '#2b8f84', '#6e52c8', '#c8643a', '#3d6a3a', '#e7c6d6'];
let waresCache: ReturnType<typeof makeWares> | null = null;
function makeWares() {
  return {
    fish: [fishGeometry('#3e5f78', '#d6dee0'), fishGeometry('#4d7088', '#e2e6e2', 0.3), fishGeometry('#b5483c', '#f2c9b0', 0.34)],
    /** A conch and a scallop in each colour. */
    shells: SHELL_TONES.flatMap((c) => [
      painted(new THREE.ConeGeometry(0.05, 0.11, 7).rotateZ(1.3), () => lin(c)),
      painted(new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 0.9), () => lin(c)),
    ]),
    /** Bolts of cloth lying along z. */
    bolts: CLOTH_TONES.map((c) => painted(new THREE.CylinderGeometry(0.1, 0.1, 0.56, 12).rotateX(Math.PI / 2), () => lin(c))),
    /** Lengths of cloth hanging over an edge. */
    drapes: CLOTH_TONES.map((c) => painted(new THREE.BoxGeometry(0.5, 0.75, 0.02), () => lin(c))),
    string: painted(new THREE.BoxGeometry(0.012, 0.3, 0.012), () => lin('#3a2e24')),
  };
}

type Trade = 'fish' | 'cloth' | 'shells' | 'produce' | 'pots';
const TRADES: Trade[] = ['fish', 'cloth', 'shells', 'produce', 'pots', 'fish', 'cloth', 'produce'];

/** Build a planned market (or plan it here): stalls, carts and tables with their goods, the crate stacks. */
export function dressMarket(o: MarketOptions, plan: MarketPlan = planMarket(o)): Market {
  const r = stream((o.seed ?? 3) + 7);
  const k = o.kit;
  const P = k.over.props;
  const batch = new TideBatch(k, o.name ?? 'tidecrown-market');
  const m = new THREE.Matrix4();
  const at = (x: number, z: number, yaw: number) => (lx: number, ly: number, lz: number, ry = 0, s: number | THREE.Vector3 = 1) => {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const wx = x + c * lx + sn * lz;
    const wz = z - sn * lx + c * lz;
    return m.copy(trs(wx, o.height(wx, wz) + ly, wz, yaw + ry, s));
  };
  const W = waresMat(), rt = stream((o.seed ?? 3) + 101), { fish: FISH, shells: SHELLS, bolts: BOLTS, drapes: DRAPES, string: STRING } = (waresCache ??= makeWares());
  const ware = (g: THREE.BufferGeometry, m: THREE.Matrix4, shadow = false) => batch.addGeometry(g, W, m, shadow);
  const hang = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  /** A counter's goods by trade, from x0 to x1 at height y, centred on depth zc (customers toward +z). */
  const counter = (put: ReturnType<typeof at>, trade: Trade, y: number, x0: number, x1: number, zc: number, front: number) => {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    if (trade === 'fish' || trade === 'shells') {
      // A shallow tray, heaped.
      batch.put(k.props, 'Crate_Wooden', put(cx, y, zc, 0, new THREE.Vector3(w / 0.85, 0.17, 0.6)), P, null);
      if (trade === 'fish') {
        const n = Math.max(3, Math.round(w / 0.17));
        for (let j = 0; j < 2; j++) for (let i = 0; i < n - j; i++) {
          const fx = x0 + 0.1 + (i + 0.5 + j * 0.5) * (w - 0.2) / n;
          ware(pick(rt, FISH), put(fx, y + 0.17 + j * 0.05, zc + (rt() - 0.5) * 0.1, Math.PI / 2 + (rt() - 0.5) * 0.6 + j * Math.PI));
        }
      } else {
        for (let i = 0; i < Math.round(w * 16); i++) ware(pick(rt, SHELLS), put(x0 + 0.08 + rt() * (w - 0.16), y + 0.17 + rt() * 0.05, zc + (rt() - 0.5) * 0.42, rt() * 6.3));
        batch.put(k.props, 'Vase_4', put(x1 - 0.12, y, zc - 0.15, rt() * 6, 0.6), P, null, false);
      }
    } else if (trade === 'cloth') {
      // Bolts stacked three high, a length hung over the front.
      const n = Math.max(2, Math.floor(w / 0.22));
      for (let j = 0; j < 3; j++) for (let i = 0; i < n - j; i++) ware(pick(rt, BOLTS), put(x0 + (w - (n - j) * 0.21) / 2 + 0.105 + i * 0.21, y + 0.1 + j * 0.175, zc - 0.04, (rt() - 0.5) * 0.08), j === 0);
      ware(pick(rt, DRAPES), put(cx + (rt() - 0.5) * w * 0.4, y - 0.34, front + 0.02, (rt() - 0.5) * 0.06));
    } else {
      const set = trade === 'produce' ? (['FarmCrate_Apple', 'FarmCrate_Carrot', 'FarmCrate_Apple', 'Bag'] as const) : (['Vase_4', 'Vase_2', 'Pot_1', 'Mug', 'Vase_4', 'Pot_1'] as const);
      const n = Math.max(2, Math.round(w / 0.5));
      for (let i = 0; i < n; i++) {
        const piece = pick(rt, set);
        batch.put(k.props, piece, put(x0 + (i + 0.5) * (w / n), y, zc + (rt() - 0.5) * 0.15, (rt() - 0.5) * 0.6, piece === 'Bag' ? 0.6 : piece === 'Vase_2' ? 0.7 : 0.9), P, null, false);
      }
    }
  };
  /** Goods hung from a canopy's front rail at height y, depth z. */
  const hung = (put: ReturnType<typeof at>, trade: Trade, y: number, x0: number, x1: number, z: number) => {
    if (trade !== 'fish' && trade !== 'shells' && trade !== 'cloth') return;
    const n = trade === 'cloth' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * ((x1 - x0) / n);
      ware(STRING, put(x, y - 0.15, z, 0));
      if (trade === 'fish') ware(pick(rt, FISH), put(x, y - 0.3, z, Math.PI / 2 + (rt() - 0.5) * 0.4).multiply(hang));
      else if (trade === 'shells') for (let j = 0; j < 4; j++) ware(pick(rt, SHELLS), put(x, y - 0.33 - j * 0.11, z, rt() * 6));
      else ware(pick(rt, DRAPES), put(x, y - 0.68, z, (rt() - 0.5) * 0.3), true);
    }
  };
  for (const st of plan.stalls) {
    const put = at(st.x, st.z, st.yaw), trade = pick(rt, TRADES);
    const canopy = (w: number, cx: number, y: number, back: number, proj: number) => {
      const g = awningGeometry(w, proj, 0.42, Math.floor(r() * 3));
      g.translate(cx, y, back);
      batch.addGeometry(g.applyMatrix4(put(0, 0, 0)), k.mat.awning, null, true);
    };
    if (st.kind === 'stall') {
      // Kit stall frame without its cloth; Tidecrown stripes on top, the trade's goods on the counter and its rail.
      batch.put(k.props, 'Stall_Empty', put(0, 0, 0), { ...P, MI_Trim_Cloth: null }, null);
      canopy(2.2, 0, 2.66, -0.62, 1.32);
      counter(put, trade, 0.93, -0.82, 0.82, 0.04, 0.47);
      hung(put, trade, 2.2, -0.7, 0.7, 0.42);
      if (r() < 0.7) batch.put(k.props, pick(r, ['Barrel_Apples', 'Barrel', 'Crate_Wooden']), put(1.25 * (r() < 0.5 ? -1 : 1), 0, -0.1, r() * 6, 0.85), P, null);
      // Spare stock under the counter.
      batch.put(k.props, pick(rt, ['Bag', 'FarmCrate_Carrot', 'Bucket_Wooden_1', 'Pot_1']), put((rt() - 0.5) * 1.1, 0, -0.1, rt() * 6, 0.8), P, null, false);
    } else if (st.kind === 'cart') {
      batch.put(k.props, 'Stall_Cart_Empty', put(0.6, 0, 0), { ...P, MI_Trim_Cloth: null }, null);
      canopy(2.2, 0.3, 2.66, -0.62, 1.28);
      counter(put, trade, 0.95, -0.45, 1.05, 0.02, 0.53);
      hung(put, trade, 2.2, -0.4, 1.0, 0.4);
    } else {
      // An open trestle table under a lean-to awning on two iron poles.
      batch.put(k.props, 'Table_Large', put(0, 0, 0), P, null);
      counter(put, trade, 0.81, -1.3, 1.3, 0, 0.55);
      batch.put(k.props, pick(r, ['Barrel', 'Crate_Wooden', 'Barrel_Holder']), put(0, 0, -1.0, 0, 0.85), P, null);
      canopy(3.1, 0, 2.5, -0.7, 1.45);
      hung(put, trade, 2.05, -1.2, 1.2, 0.5);
      for (const sx of [-1.45, 1.45]) batch.put(k.village, 'Corner_ExteriorWide_Wood', put(sx, 0, 0.62, 0, new THREE.Vector3(0.45, 0.68, 0.45)), k.over.paint, new Map([[k.mat.paint, new THREE.Color('#2a3138')]]));
    }
  }
  // The halls: two rows of tables down each, an aisle between them, every table set out with a trade's goods.
  for (const h of o.halls ?? []) {
    const c = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    for (const lx of [-5.6, 0, 5.6]) for (const lz of [-2.05, 2.05]) {
      const x = h.x + c * lx + sn * lz, z = h.z - sn * lx + c * lz, yaw = h.yaw + (lz > 0 ? Math.PI : 0);
      const put = (ax: number, ay: number, az: number, ry = 0, sc: number | THREE.Vector3 = 1) => {
        const cc = Math.cos(yaw), ss = Math.sin(yaw);
        return m.copy(trs(x + cc * ax + ss * az, h.y + ay, z - ss * ax + cc * az, yaw + ry, sc));
      };
      batch.put(k.props, 'Table_Large', put(0, 0, 0), P, null);
      counter(put, pick(rt, TRADES), 0.81, -1.3, 1.3, 0, 0.55);
      batch.put(k.props, pick(rt, ['Barrel', 'Crate_Wooden', 'Bag', 'Barrel_Apples']), put((rt() < 0.5 ? -1 : 1) * 1.05, 0, -0.85, rt() * 6, 0.8), P, null);
    }
  }
  // Along the King's Way's edges through the square: benches facing the way, stock, a cart, a notice board.
  const way = o.streets?.[0];
  if (way) {
    const [ax, az] = way.points[0], [bx, bz] = way.points[way.points.length - 1], L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    // A footprint 3 along the way and 1.3 across, clear of the stalls, the stacks and the reserved ground.
    const free = (x: number, z: number, yaw: number) => {
      const q = corners(x, z, 1.5, 0.65, yaw);
      return Math.hypot(x - o.x, z - o.z) < o.radius - 2 &&
        !(o.reserved ?? []).some((poly) => q.some(([px, pz]) => pointInPoly(px, pz, poly)) || polyDist(q, poly) < 0.6) &&
        plan.stalls.every((st) => polyDist(q, corners(st.x, st.z, st.hx, st.hz, st.yaw)) > 0.7) &&
        plan.stacks.every((st) => polyDist(q, corners(st.x, st.z, 0.7, 0.6, st.yaw)) > 0.7);
    };
    let n = 0;
    for (let d = 12; d < L - 12; d += 4.5) for (const side of [-1, 1]) {
      const off = way.width / 2 + 1.0, x = ax + ux * d - uz * off * side, z = az + uz * d + ux * off * side;
      // Facing the way: local +z toward its centre line.
      const yaw = Math.atan2(uz * side, -ux * side);
      if (!free(x, z, yaw)) continue;
      const put = at(x, z, yaw), kind = n++ % 4;
      if (kind === 0) batch.put(k.props, 'Bench', put(0, 0, 0), P, null);
      else if (kind === 1) {
        batch.put(k.props, 'Crate_Wooden', put(-0.5, 0, -0.2, 0.2, 0.8), P, null);
        batch.put(k.props, 'Crate_Wooden', put(-0.45, 0.7, -0.22, 0.5, 0.65), P, null);
        batch.put(k.props, 'Barrel', put(0.45, 0, -0.1, rt() * 6, 0.85), P, null);
        batch.put(k.props, 'Bag', put(0.6, 0, 0.45, rt() * 6, 0.7), P, null, false);
      } else if (kind === 2) {
        batch.put(k.props, 'Bench', put(0, 0, 0), P, null);
        batch.put(k.props, 'Bucket_Wooden_1', put(1.7, 0, 0, rt() * 6, 1.2), P, null, false);
      } else {
        batch.put(k.props, 'Barrel_Apples', put(-0.4, 0, -0.1, rt() * 6, 0.85), P, null);
        batch.put(k.props, 'FarmCrate_Apple', put(0.35, 0, 0.15, 0.3, 1), P, null, false);
        batch.put(k.props, 'FarmCrate_Carrot', put(0.4, 0.23, 0.12, -0.2, 0.9), P, null, false);
      }
    }
  }
  for (const s of plan.stacks) {
    const put = at(s.x, s.z, s.yaw);
    batch.put(k.props, 'Crate_Wooden', put(0, 0, -0.3, 0, 0.8), P, null);
    if (r() < 0.6) batch.put(k.props, 'Crate_Wooden', put(0.05, 0.7, -0.32, 0.3, 0.7), P, null);
    batch.put(k.props, pick(r, ['Barrel', 'Barrel_Apples', 'Bag']), put(0.55, 0, 0.2, r() * 6, 0.8), P, null);
  }
  const group = batch.build();
  group.name = o.name ?? 'tidecrown-market';
  return { group, colliders: plan.colliders, stalls: plan.stalls };
}
