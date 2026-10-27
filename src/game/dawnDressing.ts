import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Scatter, StaticBatch, trs, type Kit} from '../world/kit';
import {addPatch} from '../world/materials';
import {rng} from '../world/noise';
import {tube} from '../world/geom';
import {DAWN_POINTS} from './dawnQuests';
import {lanternFlame} from './frostLantern';
import {coastAt} from './dawnHarbour';
import {dawnMarket} from './dawnMarket';
import {dawnGlows, dawnRope, dawnSandstone, dawnWood, solidPart, woodPart} from './dawnMaterials';
import {DAWN_GATES, dawnLampPosts, roadClearance} from './world3Colliders';

/*
 * Dawnharbor's lived-in dressing from the licensed kits (props.glb, nature.glb): the market round the town square
 * (stalls under striped awnings, their counters laid with goods, crates and barrels beside them), a fish market and
 * fishing gear on the harbour promenade, benches and planters facing the sea, flowers and lanterns at every door,
 * and laundry drying on lines behind the houses. Nothing here is solid (as before); every piece keeps clear of the
 * villagers' posts, the quest points, the lamps and the gates, which the QA checks.
 */

/** The town square's centre (its paved radius is 9.5). */
const SQ = {x: 0, z: 53};

/** Awnings: the kit's cloth recoloured as canvas striped across the stall, a colour per stall from its world position. */
function awningCloth(base: THREE.Material): THREE.Material {
  const m = base.clone() as THREE.MeshStandardMaterial;
  m.name = 'dawnharbor-awning';
  addPatch(m, 'dawnharbor-awning', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAwW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAwW=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAwW;')
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));
          // Stripes run front to back: across the tangent of the square (or of the shore) the stall stands on.
          vec2 d=vAwW.xz-vec2(${SQ.x.toFixed(1)},${SQ.z.toFixed(1)});
          float ang=atan(d.y,d.x),r=length(d),s=step(.5,fract(ang*r/.42));
          float k=fract(sin(floor(ang*2.2)*91.7+floor(r*.1)*13.1)*4375.85);
          vec3 c1=k<.34?vec3(.07,.32,.33):k<.67?vec3(.62,.36,.06):vec3(.52,.14,.12);
          vec3 c2=vec3(.8,.74,.62);
          diffuseColor.rgb=mix(c1,c2,s)*(.55+.9*smoothstep(.03,.4,l));
        }`);
  });
  return m;
}

/** Laundry: cloth pieces coloured per vertex, swaying on the line in the shader. */
function laundryMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnharbor-laundry', color: '#ffffff', roughness: .95, side: THREE.DoubleSide, vertexColors: true});
  const u = {lnTime: {value: 0}};
  addPatch(m, 'dawnharbor-laundry', (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float lnTime;\nattribute float aHang;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n{float ph=position.x*.7+position.z*.5;transformed+=vec3(.6,0.,.8)*aHang*(.14*sin(lnTime*1.6+ph)+.06*sin(lnTime*3.7+ph*2.));}');
  });
  m.userData.time = u.lnTime;
  return m;
}

export interface DawnDressing {group: THREE.Group; update(time: number): void; stats: Record<string, number>}

/** Raise the dressing; `npcSpots` are the villagers' posts (DawnIsland.town), `height` the gameplay surface. */
export function dawnDressing(height: (x: number, z: number) => number, kits: {props: Kit; nature: Kit}, doors: readonly {pos: THREE.Vector3; yaw: number}[], npcSpots: readonly (readonly [number, number])[], opts: {yardLaundry?: boolean} = {}): DawnDressing {
  const {props, nature} = kits;
  const group = new THREE.Group(); group.name = 'dawnharbor-dressing';
  const R = rng(9137);
  // Kit hardware reads as brass in Goldsand (lanterns, hoops, fittings), never black iron.
  const brass = (props.materials.get('MI_Trim_Metal')!.clone()) as THREE.MeshStandardMaterial;
  brass.name = 'goldsand-kit-brass'; brass.color.set('#e0b45a'); brass.metalness = .8; brass.roughness = .4;
  const over: Record<string, THREE.Material> = {MI_Trim_Cloth: awningCloth(props.materials.get('MI_Trim_Cloth')!), MI_Trim_Metal: brass};
  const batch = new StaticBatch(props, 'dawnharbor-props'), plants = new Scatter(nature, 'dawnharbor-plants');
  const stats: Record<string, number> = {stalls: 0, goods: 0, benches: 0, planters: 0, doorPots: 0, lanterns: 0, laundry: 0, gear: 0};
  // Keep-out discs: villagers' posts (and the paths they walk between), quest points, lamps and gates.
  const keep: [number, number, number][] = [
    ...npcSpots.map(([x, z]) => [x, z, 2.6] as [number, number, number]),
    ...Object.values(DAWN_POINTS).map(([x, z]) => [x, z, 2.6] as [number, number, number]),
    ...dawnLampPosts().map(({x, z}) => [x, z, 1.2] as [number, number, number]),
    ...DAWN_GATES.map(({x, z}) => [x, z, 5] as [number, number, number]),
    [13, 97, 4.5],
  ];
  const clear = (x: number, z: number, r: number) => keep.every(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) >= kr + r);
  const put = (piece: string, x: number, z: number, yaw = 0, s = 1, dy = 0, o = over) => { if (!props.has(piece)) return false; batch.add(piece, trs(x, height(x, z) + dy, z, yaw, s), {override: o}); return true; };
  const putAt = (piece: string, m: THREE.Matrix4) => { if (props.has(piece)) batch.add(piece, m, {override: over}); };
  const plant = (piece: string, x: number, y: number, z: number, yaw: number, s: number) => { if (nature.has(piece)) plants.add(piece, trs(x, y, z, yaw, s)); };
  const local = (x: number, z: number, yaw: number, lx: number, lz: number) => [x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z - Math.sin(yaw) * lx + Math.cos(yaw) * lz] as const;

  // The souk: canopy stalls in two rows (dawnMarket.ts), along the cross street's north side facing it and south of
  // the square facing the street there; stock beside each from the kit.
  const stallSpots: [number, number, number][] = [
    ...[-17, -13.5, -10, 10, 13.5, 17].map(x => [x, 59.3, Math.PI] as [number, number, number]),
    ...[-13, -9, 9, 13].map(x => [x, 40.8, 0] as [number, number, number]),
  ];
  const souk: {x: number; z: number; yaw: number}[] = [];
  for (const [k, [x, z, yaw0]] of stallSpots.entries()) {
    const yaw = yaw0 + (R() - .5) * .08;
    if (!clear(x, z, 1.3) || roadClearance(x, z) < .9) continue;
    souk.push({x, z, yaw}); stats.stalls++;
    const [bx, bz] = local(x, z, yaw, k % 2 ? 1.72 : -1.72, -.6), [sx, sz] = local(x, z, yaw, .5, .2);
    put(k % 3 ? 'Barrel' : 'Bag', bx, bz, R() * 6, .9);
    put('Stool', sx, sz, R() * 6, .9);
  }
  const market = dawnMarket(souk, height);
  group.add(market.group); stats.goods += market.goods;

  // The fish market and fishing gear on the promenade: carts, barrels and buckets of the catch, lobster pots, rope.
  for (const [a, cart] of [[-.17, true], [-.03, false], [.12, true], [.21, false]] as const) {
    const p = coastAt(.798, a), out = coastAt(.9, a), yaw = Math.atan2(out.x - p.x, out.y - p.y) + Math.PI;
    if (!clear(p.x, p.y, 1.5)) continue;
    if (cart) {
      put('Stall_Cart_Empty', p.x, p.y, yaw); stats.stalls++;
      for (let j = 0; j < 3; j++) { const [gx, gz] = local(p.x, p.y, yaw, -1.4 + j * .5, .05); put(j === 1 ? 'Bucket_Wooden_1' : 'FarmCrate_Apple', gx, gz, yaw, 1, .82); stats.goods++; }
      const [bx, bz] = local(p.x, p.y, yaw, 1.4, -.2); put('Barrel', bx, bz, R() * 6);
    } else {
      // A gear corner: lobster pots, rope coils, a chain, crates and a bucket.
      const items: [string, number, number, number, number][] = [['Cage_Small', 0, 0, 0, 1], ['Cage_Small', .55, .35, 0, .9], ['Cage_Small', .25, .1, .74, .85], ['Rope_2', -1.1, .2, 0, 1], ['Rope_1', -1.2, -.5, 0, 1.1], ['Crate_Wooden', 1.4, -.3, 0, 1], ['Bucket_Wooden_1', -.5, -.7, 0, 1], ['Chain_Coil', .8, -1., 0, .9]];
      for (const [piece, lx, lz, dy, s] of items) { const [gx, gz] = local(p.x, p.y, yaw, lx, lz); put(piece, gx, gz, R() * 6, s, dy); stats.gear++; }
    }
  }
  // Benches facing the sea and planters between them, all along the promenade.
  for (let k = 0; k < 9; k++) {
    const a = -.3 + k * .065, p = coastAt(.808, a), out = coastAt(.9, a), yaw = Math.atan2(out.x - p.x, out.y - p.y);
    if (!clear(p.x, p.y, 1.5)) continue;
    if (k % 2) { put('Bench', p.x, p.y, yaw); stats.benches++; }
    else {
      put('Vase_2', p.x, p.y, R() * 6, 1.25); plant(k % 4 ? 'Bush_Common_Flowers' : 'Plant_1', p.x, height(p.x, p.y) + .55, p.y, R() * 6, .42); stats.planters++;
    }
  }

  // Garden beds along the avenue: raised sandstone kerbs round dark soil, planted; and the lookout benches.
  const beds: THREE.BufferGeometry[] = [], soil: THREE.BufferGeometry[] = [];
  const kerb = (w: number) => { const g = new THREE.BoxGeometry(w, .42, .28, 1, 1, 1); return g; };
  for (const side of [-1, 1]) for (const z of [16, 0, -18]) {
    const x = side * 17, W = 8.6, D = 3.6, y = height(x, z);
    // Keep any quest point clear of the bed.
    if (Object.values(DAWN_POINTS).some(([qx, qz]) => Math.abs(qx - x) < W / 2 + 1.5 && Math.abs(qz - z) < D / 2 + 1.5)) continue;
    for (const [lx, lz, w, rot] of [[0, -D / 2, W, 0], [0, D / 2, W, 0], [-W / 2, 0, D, 1], [W / 2, 0, D, 1]] as const) {
      const g = kerb(w + (rot ? -.28 : .28));
      beds.push(solidPart(g, trs(x + lx, y + .17, z + lz, rot ? Math.PI / 2 : 0))); g.dispose();
    }
    const top = new THREE.PlaneGeometry(W - .3, D - .3, 8, 4).rotateX(-Math.PI / 2), tp = top.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) tp.setY(i, .05 * Math.sin(tp.getX(i) * 3.1) * Math.sin(tp.getZ(i) * 2.3));
    top.computeVertexNormals(); soil.push(solidPart(top, trs(x, y + .3, z))); top.dispose();
    for (let i = 0; i < 9; i++) {
      const px = x - W / 2 + .9 + i * (W - 1.8) / 8, pz = z + (i % 2 ? .6 : -.6);
      // Desert planting: agave-like rosettes, dusty bushes and wiry grass.
      plant(['Plant_7_Big', 'Bush_Common', 'Grass_Wispy_Tall', 'Plant_1', 'Bush_Common'][i % 5], px, y + .28, pz, R() * 6, .45 + R() * .2);
    }
    stats.planters++;
  }
  for (const [x, z, yaw] of [[-57, 68, 0], [-72, 40, .5], [59, 62, -.3]] as const) { put('Bench', x, z, yaw); stats.benches++; }
  if (beds.length) {
    const m = new THREE.Mesh(mergeGeometries(beds, false)!, dawnSandstone('dawnharbor-bed-stone')); m.name = 'dawnharbor-garden-beds'; m.castShadow = m.receiveShadow = true; group.add(m);
    const sm = new THREE.MeshStandardMaterial({name: 'dawnharbor-soil', color: '#3d2a1c', roughness: 1});
    const s2 = new THREE.Mesh(mergeGeometries(soil, false)!, sm); s2.name = 'dawnharbor-garden-soil'; s2.receiveShadow = true; group.add(s2);
  }

  // Doors: a pot of flowers to one side and a lantern on the wall over the other.
  const glows: {pos: THREE.Vector3; size: number}[] = [];
  for (const d of doors) {
    const ox = Math.sin(d.yaw), oz = Math.cos(d.yaw), rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);
    const px = d.pos.x + ox * .45 - rx * 2.05, pz = d.pos.z + oz * .45 - rz * 2.05;
    if (clear(px, pz, .5)) {
      put(R() < .5 ? 'Vase_2' : 'Vase_4', px, pz, R() * 6, .9);
      plant(['Bush_Common_Flowers', 'Flower_4_Group', 'Flower_3_Group'][stats.doorPots % 3], px, height(px, pz) + .42, pz, R() * 6, .3);
      stats.doorPots++;
    }
    // Fronts on the avenue and round the square: a bench against the wall past the lantern, and a big potted plant.
    if (Math.abs(d.pos.x) < 14 || Math.hypot(d.pos.x - SQ.x, d.pos.z - SQ.z) < 22) {
      const bx = d.pos.x + ox * .42 + rx * 1.15, bz = d.pos.z + oz * .42 + rz * 1.15;
      if (clear(bx, bz, .9) && roadClearance(bx, bz) > .2 && put('Bench', bx, bz, d.yaw, .9)) stats.benches++;
      const vx = d.pos.x + ox * .5 + rx * 2.35, vz = d.pos.z + oz * .5 + rz * 2.35;
      if (clear(vx, vz, .5) && roadClearance(vx, vz) > .2 && put('Vase_4', vx, vz, R() * 6, 1.35)) {
        plant(stats.planters % 2 ? 'Plant_7_Big' : 'Bush_Common_Flowers', vx, height(vx, vz) + .62, vz, R() * 6, .5); stats.planters++;
      }
    }
    const lm = trs(d.pos.x, d.pos.y + .55, d.pos.z, d.yaw, .7);
    putAt('Lantern_Wall', lm); glows.push({pos: lanternFlame(lm), size: 1.1}); stats.lanterns++;
  }

  // Laundry: a line from each house's back corner to a forked pole, shirts and sheets pegged along it.
  const laundry: THREE.BufferGeometry[] = [], poles: THREE.BufferGeometry[] = [], lines: THREE.BufferGeometry[] = [];
  const COLS = ['#e8e2d2', '#5a8fa0', '#c9a24a', '#e9e5da', '#b3574a', '#7f9b6a'];
  // The desert quarter (dawnHouses.ts) hangs its laundry on the roofs instead.
  for (const d of opts.yardLaundry === false ? [] : doors) {
    const ox = Math.sin(d.yaw), oz = Math.cos(d.yaw), rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);
    // From the wall beside the door, back along the house side to a pole out in the yard.
    const a = new THREE.Vector3(d.pos.x - ox * 6.6 + rx * 3.4, d.pos.y + 1.4, d.pos.z - oz * 6.6 + rz * 3.4);
    const bx = a.x + rx * 5.2 - ox * 1.2, bz = a.z + rz * 5.2 - oz * 1.2;
    if (!clear(bx, bz, .6) || roadClearance(bx, bz) < 1) continue;
    const by = height(bx, bz);
    poles.push(woodPart(new THREE.CylinderGeometry(.05, .06, 3.1, 7), trs(bx, by + 1.5, bz), null, 0, new THREE.Vector3(0, 1, 0)));
    poles.push(woodPart(new THREE.BoxGeometry(.5, .06, .06), trs(bx, by + 2.95, bz, Math.atan2(rx, rz)), null, 0));
    const b = new THREE.Vector3(bx, by + 2.95, bz), L = a.distanceTo(b), pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -.35 * 4 * t * (1 - t), 0))); }
    lines.push(solidPart(tube(pts, () => .012, 4), new THREE.Matrix4()));
    // Pieces hang from the sagging line: a sheet, shirts, cloths.
    const along = b.clone().sub(a).setY(0).normalize(), yaw = Math.atan2(along.x, along.z) - Math.PI / 2;
    let t = .12;
    while (t < .88) {
      const w = R() < .3 ? 1.1 : .55 + R() * .2, h = w > 1 ? .95 : .55 + R() * .25, top = a.clone().lerp(b, t).add(new THREE.Vector3(0, -.35 * 4 * t * (1 - t) - .02, 0));
      const g = new THREE.PlaneGeometry(w, h, 4, 4), gp = g.getAttribute('position') as THREE.BufferAttribute, hang = new Float32Array(gp.count), col = new Float32Array(gp.count * 3), c = new THREE.Color(COLS[Math.floor(R() * COLS.length)]);
      for (let i = 0; i < gp.count; i++) { const v = (h / 2 - gp.getY(i)) / h; hang[i] = v; gp.setZ(i, Math.sin(gp.getX(i) * 5) * .03 * v); col.set([c.r, c.g, c.b], i * 3); }
      g.translate(0, -h / 2, 0);
      g.setAttribute('aHang', new THREE.BufferAttribute(hang, 1)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.applyMatrix4(trs(top.x, top.y, top.z, yaw + (R() - .5) * .15));
      g.deleteAttribute('uv'); laundry.push(g); stats.laundry++;
      t += (w + .18) / L;
    }
  }
  const lmat = laundryMaterial();
  if (laundry.length) { const g = mergeGeometries(laundry, false)!; laundry.forEach(x => x.dispose()); const m = new THREE.Mesh(g, lmat); m.name = 'dawnharbor-laundry'; m.castShadow = true; group.add(m); }
  if (poles.length) { const m = new THREE.Mesh(mergeGeometries(poles, false)!, dawnWood('dawnharbor-laundry-poles')); m.castShadow = true; m.name = 'dawnharbor-laundry-poles'; group.add(m); }
  if (lines.length) { const m = new THREE.Mesh(mergeGeometries(lines, false)!, dawnRope()); m.name = 'dawnharbor-laundry-lines'; group.add(m); }

  group.add(batch.build());
  group.add(plants.build({boundsPadding: .3}));
  const glow = dawnGlows(glows, '#ffbf73', 'dawnharbor-door-lantern-glows');
  group.add(glow);
  group.userData.stats = stats;
  return {group, stats, update(time) { lmat.userData.time.value = time; (glow.material as THREE.ShaderMaterial).uniforms.uTime.value = time; }};
}
