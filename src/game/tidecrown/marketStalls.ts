// Tidecrown market dressing: kit stalls and carts (props.glb, CC0, see NOTICE.md) under Tidecrown's striped awnings,
// set in two rings around a plaza with its lanes and centre left open, heaped with crates, barrels, sacks and coin.
import * as THREE from 'three';
import { trs } from '../../world/kit';
import { awningGeometry, type DistrictStreet, type Height, polyLineDist, stream, type TidecrownCollider, TideBatch, type TidecrownKit } from './houses';

export interface MarketOptions {
  kit: TidecrownKit;
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
  name?: string;
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
export interface Market {
  group: THREE.Group;
  colliders: TidecrownCollider[];
  stalls: MarketStall[];
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

/** Half extents of each kind on the ground (with its goods), for spacing and colliders. */
const SIZE: Record<MarketStall['kind'], [number, number]> = { stall: [1.05, 0.62], cart: [1.65, 0.62], table: [1.5, 0.66] };

/**
 * Place stalls around a plaza: an outer ring facing in and an inner ring facing out, with an aisle between,
 * every lane and the centre left clear. Returns the batched meshes and one collider per stall.
 */
export function dressMarket(o: MarketOptions): Market {
  const r = stream(o.seed ?? 3);
  const k = o.kit;
  const P = k.over.props;
  const batch = new TideBatch(k, o.name ?? 'tidecrown-market');
  const lanes = o.lanes ?? [];
  const laneW = o.laneWidth ?? 5;
  const inner = o.inner ?? o.radius * 0.3;
  const stalls: MarketStall[] = [];
  const colliders: TidecrownCollider[] = [];
  const m = new THREE.Matrix4();
  const at = (x: number, z: number, yaw: number) => (lx: number, ly: number, lz: number, ry = 0, s: number | THREE.Vector3 = 1) => {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const wx = x + c * lx + sn * lz;
    const wz = z - sn * lx + c * lz;
    return m.copy(trs(wx, o.height(wx, wz) + ly, wz, yaw + ry, s));
  };
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
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const q: [number, number][] = [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]);
    return !(o.streets ?? []).some((st) => polyLineDist(q, st.points) < st.width / 2 + 0.5);
  };
  const fits = (x: number, z: number, hx: number, hz: number, yaw: number) => {
    if (!clear(x, z, hx, hz, yaw)) return false;
    return stalls.every((st) => Math.hypot(st.x - x, st.z - z) > Math.max(hx, hz) + Math.max(st.hx, st.hz) + 0.5);
  };

  const rings: { rad: number; facing: 1 | -1 }[] = [
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

  const goods = ['FarmCrate_Apple', 'FarmCrate_Carrot', 'FarmCrate_Apple', 'Vase_4', 'Bag', 'Coin_Pile', 'Mug'] as const;
  for (const st of stalls) {
    const put = at(st.x, st.z, st.yaw);
    const canopy = (w: number, cx: number, y: number, back: number, proj: number) => {
      const g = awningGeometry(w, proj, 0.42, Math.floor(r() * 3));
      g.translate(cx, y, back);
      batch.addGeometry(g.applyMatrix4(put(0, 0, 0)), k.mat.awning, null, true);
    };
    if (st.kind === 'stall') {
      // Kit stall frame without its cloth; Tidecrown stripes on top, produce on the counter.
      batch.put(k.props, 'Stall_Empty', put(0, 0, 0), { ...P, MI_Trim_Cloth: null }, null);
      canopy(2.2, 0, 2.66, -0.62, 1.32);
      for (let i = 0; i < 3; i++) batch.put(k.props, pick(r, goods), put(-0.55 + i * 0.55, 0.93, 0.08, (r() - 0.5) * 0.4, 0.95), P, null, false);
      if (r() < 0.7) batch.put(k.props, pick(r, ['Barrel_Apples', 'Barrel', 'Crate_Wooden']), put(1.25 * (r() < 0.5 ? -1 : 1), 0, -0.1, r() * 6, 0.85), P, null);
    } else if (st.kind === 'cart') {
      batch.put(k.props, 'Stall_Cart_Empty', put(0.6, 0, 0), { ...P, MI_Trim_Cloth: null }, null);
      canopy(2.2, 0.3, 2.66, -0.62, 1.28);
      for (let i = 0; i < 3; i++) batch.put(k.props, pick(r, goods), put(-0.25 + i * 0.5, 0.95, 0.05, (r() - 0.5) * 0.4, 0.95), P, null, false);
    } else {
      // An open trestle table under a lean-to awning on two iron poles.
      batch.put(k.props, 'Table_Large', put(0, 0, 0), P, null);
      for (let i = 0; i < 4; i++) batch.put(k.props, pick(r, ['FarmCrate_Carrot', 'FarmCrate_Apple', 'Vase_2', 'Bag', 'Coin_Pile', 'Vase_4']), put(-1.05 + i * 0.7, 0.81, (r() - 0.5) * 0.2, (r() - 0.5) * 0.6, 0.9), P, null, false);
      batch.put(k.props, pick(r, ['Barrel', 'Crate_Wooden', 'Barrel_Holder']), put(0, 0, -1.0, 0, 0.85), P, null);
      canopy(3.1, 0, 2.5, -0.7, 1.45);
      for (const sx of [-1.45, 1.45]) batch.put(k.village, 'Corner_ExteriorWide_Wood', put(sx, 0, 0.62, 0, new THREE.Vector3(0.45, 0.68, 0.45)), k.over.paint, new Map([[k.mat.paint, new THREE.Color('#2a3138')]]));
    }
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    const y = o.height(st.x, st.z);
    colliders.push({ x: st.x, z: st.z, hx: st.hx, hz: st.hz, c, s, y0: y - 1, y1: y + 3 });
  }

  // Crates and barrels stacked between the outer stalls, sacks against them.
  const outer = stalls.filter((st) => Math.hypot(st.x - o.x, st.z - o.z) > o.radius * 0.6);
  for (let i = 0; i < outer.length; i++) {
    if (r() < 0.4) continue;
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    if (Math.hypot(a.x - b.x, a.z - b.z) > 6 || !clear(x, z, 0.7, 0.6, a.yaw)) continue;
    const yaw = a.yaw + (r() - 0.5) * 0.5;
    const put = at(x, z, yaw);
    batch.put(k.props, 'Crate_Wooden', put(0, 0, -0.3, 0, 0.8), P, null);
    if (r() < 0.6) batch.put(k.props, 'Crate_Wooden', put(0.05, 0.7, -0.32, 0.3, 0.7), P, null);
    batch.put(k.props, pick(r, ['Barrel', 'Barrel_Apples', 'Bag']), put(0.55, 0, 0.2, r() * 6, 0.8), P, null);
    const y = o.height(x, z);
    colliders.push({ x, z, hx: 0.7, hz: 0.6, c: Math.cos(yaw), s: Math.sin(yaw), y0: y - 1, y1: y + 2 });
  }

  const group = batch.build();
  group.name = o.name ?? 'tidecrown-market';
  return { group, colliders, stalls };
}
