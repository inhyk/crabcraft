// Places the castle kit on Tidecrown's layout: one static batch per structure or wall side (one draw per material in
// each, culled as a unit), the King's Stair, the bridge abutments, the lantern in the claw crown and the statues.
import * as THREE from 'three';
import { type Kit, StaticBatch, trs } from '../../world/kit';
import { lanternSpot, statueSpots, TC_FOOTPRINTS, type TcPlacement, TC_LEVEL, TC_PIECES, TC_T, TC_YAW, tcAxis } from './layout';
import { STATUE_HEIGHT } from './statues';
import type { TidecrownMaterials } from './materials';
import { buildBanners } from './banners';

type Height = (x: number, z: number) => number;

/** World-unit UVs (box projection) and a white vertex colour, so procedural stone matches the kit's texel density. */
export function worldUV(g: THREE.BufferGeometry, density = 0.5, up = density): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const uv = new Float32Array(p.count * 2), col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay > ax && ay > az ? [p.getX(i), p.getZ(i)] : ax > az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv.set([u * density, v * (ay > ax && ay > az ? density : up)], i * 2);
    const occ = n.getY(i) < -0.5 ? 0.7 : 1;
    col.set([occ, occ, occ, 1], i * 4);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geo;
}

/**
 * The battered foundation under a placement (layout.ts decides which need one): a tapered block, or a drum under a
 * tower, from its bottom up to the piece's base, with a projecting plinth course where the kit piece sits on it and
 * offset courses every 7 down a tall one. Dark limestone at the kit's texel density (0.5 along, 0.475 up), darker
 * toward the foot.
 */
function foundationGeometry(p: TcPlacement): THREE.BufferGeometry[] {
  const f = TC_FOOTPRINTS[p.piece], fd = p.foundation;
  if (!f || !fd) return [];
  const top = p.y + 0.05, H = top - fd.y, out: THREE.BufferGeometry[] = [];
  const course = Math.min(0.7, H * 0.3);
  const shade = (g: THREE.BufferGeometry, y0: number, y1: number) => {
    const pos = g.getAttribute('position'), col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const k = 0.8 + 0.2 * THREE.MathUtils.smoothstep(pos.getY(i), y0, y1);
      col.set([k, k, k, 1], i * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    return g;
  };
  if ('r' in f) {
    // Drum: the cylinder's own u runs round it, so the coursing has no seam.
    const drum = (r0: number, r1: number, y0: number, y1: number) => {
      const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 28, 1, true).toNonIndexed();
      const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * (r0 + r1) * 0.5, (pos.getY(i) + (y0 + y1) / 2) * 0.475);
      g.translate(p.x, (y0 + y1) / 2, p.z);
      return shade(g, fd.y, fd.y + 3);
    };
    const r = f.r * p.sx;
    out.push(drum(r + fd.toe, r, fd.y, top));
    if (H > 2.5) out.push(drum(r + 0.35, r + 0.35, top - course, top), drum(r + 0.05, r + 0.35, top - course - 0.3, top - course));
    for (let y = top - 7.5; y > fd.y + 3; y -= 7) {
      const off = (fd.toe * (top - y)) / H;
      out.push(drum(r + off + 0.3, r + off + 0.3, y - 0.45, y), drum(r + off, r + off + 0.3, y - 0.7, y - 0.45));
    }
    return out;
  }
  // Block: a box whose foot spreads by the toe, turned and placed like the piece.
  const block = (hx: number, hz: number, toe: number, y0: number, y1: number) => {
    const g = new THREE.BoxGeometry(2 * hx, y1 - y0, 2 * hz);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) continue;
      pos.setX(i, pos.getX(i) + Math.sign(pos.getX(i)) * toe);
      pos.setZ(i, pos.getZ(i) + Math.sign(pos.getZ(i)) * toe);
    }
    g.computeVertexNormals();
    g.applyMatrix4(trs(p.x, (y0 + y1) / 2, p.z, p.yaw));
    return shade(worldUV(g, 0.5, 0.475), fd.y, fd.y + 3);
  };
  const hx = f.hx * p.sx, hz = f.hz * p.sz;
  out.push(block(hx, hz, fd.toe, fd.y, top));
  if (H > 2.5) out.push(block(hx + 0.35, hz + 0.35, 0, top - course, top), block(hx + 0.35, hz + 0.35, -0.3, top - course - 0.3, top - course));
  for (let y = top - 7.5; y > fd.y + 3; y -= 7) {
    const off = (fd.toe * (top - y)) / H;
    out.push(block(hx + off + 0.3, hz + off + 0.3, 0, y - 0.45, y), block(hx + off + 0.3, hz + off + 0.3, -0.3, y - 0.7, y - 0.45));
  }
  return out;
}

/** A box in axis coordinates (t along the axis, s across), base at y, in world space. */
function axisBox(t: number, s: number, y: number, w: number, h: number, d: number, tilt = 0): THREE.BufferGeometry {
  const [x, z] = tcAxis(t, s);
  const g = new THREE.BoxGeometry(w, h, d);
  if (tilt) g.applyMatrix4(new THREE.Matrix4().makeRotationX(tilt));
  g.applyMatrix4(trs(x, y + h / 2, z, TC_YAW));
  return worldUV(g);
}

/** The King's Stair: 32 steps up the keep rock between balustrades, newels with gold braziers at foot and head. */
function buildStair(batch: StaticBatch, mats: TidecrownMaterials): THREE.Vector3[] {
  const { stairFoot: t0, stairTop: t1 } = TC_T, steps = 32, run = (t1 - t0) / steps, rise = (TC_LEVEL.plateau - TC_LEVEL.upper) / steps;
  const L = mats.TC_Limestone, D = mats.TC_LimestoneDark, G = mats.TC_Gold;
  for (let i = 0; i < steps; i++) {
    const top = TC_LEVEL.upper + rise * (i + 1), base = TC_LEVEL.upper - 1.5;
    batch.addGeometry(axisBox(t0 + run * (i + 0.5), 0, base, 16, top - base, run + 0.02), i % 2 ? L : D, null);
  }
  // Balustrades: stepped blocks that follow the flight, with a cap.
  for (const s of [-1, 1]) {
    for (let i = 0; i < steps; i += 2) {
      const top = TC_LEVEL.upper + rise * (i + 2) + 1.4, base = TC_LEVEL.upper - 1.5;
      batch.addGeometry(axisBox(t0 + run * (i + 1), s * 8.6, base, 1.4, top - base, run * 2 + 0.02), D, null);
      batch.addGeometry(axisBox(t0 + run * (i + 1), s * 8.6, top, 1.7, 0.35, run * 2 + 0.04), L, null);
    }
  }
  // Landing at the head, flush with the rock.
  batch.addGeometry(axisBox(t1 + 3, 0, TC_LEVEL.plateau - 2, 22, 2.02, 6), L, null);
  const braziers: THREE.Vector3[] = [];
  for (const [t, y] of [[t0 - 1.5, TC_LEVEL.upper], [t1 + 1, TC_LEVEL.plateau]] as const) {
    for (const s of [-1, 1]) {
      batch.addGeometry(axisBox(t, s * 9.4, y - 0.5, 3, 4.4, 3), D, null);
      batch.addGeometry(axisBox(t, s * 9.4, y + 3.9, 3.4, 0.5, 3.4), L, null);
      const [x, z] = tcAxis(t, s * 9.4);
      const bowl = new THREE.CylinderGeometry(1.4, 0.6, 1, 14).toNonIndexed();
      bowl.applyMatrix4(trs(x, y + 4.9, z));
      batch.addGeometry(worldUV(bowl), G, null);
      braziers.push(new THREE.Vector3(x, y + 5.6, z));
    }
  }
  return braziers;
}

export interface TidecrownStructures {
  group: THREE.Group;
  lantern: THREE.Group;
  lanternAt: THREE.Vector3;
  braziers: THREE.Vector3[];
  flame: THREE.MeshStandardMaterial;
  /** Placements by batch, for the QA report. */
  batches: Record<string, number>;
}

/** Split-rail fences along the overlook's drop, from World I's village kit. */
function overlookFences(village: Kit, height: Height): THREE.Group {
  const batch = new StaticBatch(village, 'tc-overlook-fences');
  const run = (t: number, s0: number, s1: number) => {
    const n = Math.round(Math.abs(s1 - s0) / 2.05);
    for (let i = 0; i < n; i++) {
      const s = s0 + ((s1 - s0) * (i + 0.5)) / n, [x, z] = tcAxis(t, s);
      batch.add(i % 3 === 2 ? 'Prop_WoodenFence_Extension1' : 'Prop_WoodenFence_Single', trs(x, height(x, z) - 0.05, z, TC_YAW + Math.sin(i * 2.3) * 0.06));
    }
  };
  run(TC_T.overlook + 1.5, -3.6, -12);
  run(TC_T.overlook + 3.4, 5, 11);
  return batch.build();
}

export function buildTidecrownStructures(kit: Kit, village: Kit, mats: TidecrownMaterials, placements: TcPlacement[], height: Height, statues: THREE.Object3D[]): TidecrownStructures {
  const group = new THREE.Group();
  group.name = 'tidecrown-structures';
  const override = mats as unknown as Record<string, THREE.Material>;
  const batches = new Map<string, StaticBatch>();
  const count: Record<string, number> = {};
  for (const p of placements) {
    if (!kit.has(p.piece)) continue;
    let b = batches.get(p.batch);
    if (!b) batches.set(p.batch, (b = new StaticBatch(kit, p.batch)));
    b.add(p.piece, trs(p.x, p.y, p.z, p.yaw, new THREE.Vector3(p.sx, p.sy, p.sz)), { override });
    for (const g of foundationGeometry(p)) b.addGeometry(g, mats.TC_LimestoneDark, null);
    count[p.batch] = (count[p.batch] ?? 0) + 1;
  }
  group.add(overlookFences(village, height));
  const stair = new StaticBatch(kit, 'tc-stair');
  const braziers = buildStair(stair, mats);
  group.add(stair.build());
  for (const b of batches.values()) group.add(b.build());
  group.add(buildBanners(placements));
  // Brazier flames at the stair's foot and head: they bloom and flicker (island update).
  const flame = new THREE.MeshStandardMaterial({ name: 'tc-brazier-flame', color: '#ffb35a', emissive: '#ff8a2a', emissiveIntensity: 3, transparent: true, opacity: 0.9, depthWrite: false });
  const flames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 2.4, 7).translate(0, 1.1, 0), flame, braziers.length);
  braziers.forEach((b, i) => flames.setMatrixAt(i, trs(b.x, b.y - 0.75, b.z, i)));
  flames.name = 'tc-brazier-flames';
  flames.castShadow = false;
  flames.computeBoundingSphere();
  group.add(flames);
  // The lantern stays its own mesh: it pulses and blooms.
  const lanternAt = new THREE.Vector3(...lanternSpot(height));
  const lantern = new THREE.Group();
  lantern.name = 'tc-lantern';
  if (kit.has('TC_Lantern')) {
    const lb = new StaticBatch(kit, 'tc-lantern-orb');
    lb.add('TC_Lantern', trs(lanternAt.x, lanternAt.y, lanternAt.z), { override, castShadow: false });
    lantern.add(lb.build());
  }
  group.add(lantern);
  // Hero statues on their plinths, facing the bridge's centre line.
  const spots = statueSpots();
  statues.forEach((st, i) => {
    const s = spots[i];
    if (!s) return;
    st.position.set(s.x, s.y, s.z);
    st.rotation.set(0, s.yaw, 0);
    st.scale.setScalar(TC_PIECES.statue.h / STATUE_HEIGHT);
    st.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    group.add(st);
  });
  return { group, lantern, lanternAt, braziers, flame, batches: count };
}
