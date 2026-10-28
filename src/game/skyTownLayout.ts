import type {Collision} from '../world/collision';
import {skyPathDistance} from './skyGroundLayout';

/*
 * World VI town plan, shared by the scenery (skyTown.ts, skyHarbour.ts) and the colliders the server bakes
 * (layoutSkyTown, called from layoutFrontier for chapter 6 only, in place of the shared frontier house boxes).
 * Numbers only, no three.js. Houses keep the old spots (x = +-30, z = 38 / 56 / 74) and turn their doors to the
 * high street. The ways themselves (SKY_PATHS, skyGroundLayout.ts) belong to the ground lane and may bend: props that
 * stand near a way go through clearOfWays, so scenery and colliders both step off the paving wherever it runs.
 */
export type HouseRole = 'chandler' | 'lantern' | 'maps' | 'inn' | 'tea' | 'garden';
/** yaw turns the house's local +z (its street front) toward the high street. */
export const SKY_HOUSES: {x: number; z: number; yaw: number; role: HouseRole}[] = [
  {x: 30, z: 74, yaw: -Math.PI / 2, role: 'chandler'},
  {x: 30, z: 56, yaw: -Math.PI / 2, role: 'lantern'},
  {x: 30, z: 38, yaw: -Math.PI / 2, role: 'maps'},
  {x: -30, z: 74, yaw: Math.PI / 2, role: 'inn'},
  {x: -30, z: 56, yaw: Math.PI / 2, role: 'tea'},
  {x: -30, z: 38, yaw: Math.PI / 2, role: 'garden'},
];
/** House frame: half sizes of the ground floor along the street front (WX) and out of the door (WZ), floor heights. */
export const HOUSE = {WX: 5.1, WZ: 4.6, G: 3.3, JET: .3, U: 2.9};
/** A point in a house's frame (local x along the front, local z out of the door) in world x, z. */
export function houseToWorld(hs: {x: number; z: number; yaw: number}, lx: number, lz: number): [number, number] {
  const c = Math.cos(hs.yaw), s = Math.sin(hs.yaw);
  return [hs.x + lx * c + lz * s, hs.z - lx * s + lz * c];
}
/** Each trade's yard props in the house frame (lx, lz, radius): the solids in front of and beside the walls. */
const WZ = HOUSE.WZ, WX = HOUSE.WX;
export const HOUSE_YARD: Record<HouseRole, [number, number, number][]> = {
  chandler: [[4.25, WZ + 1.75, 1.0], [3.0, WZ + 2.6, .5]],
  lantern: [[2.75, WZ + 1.7, .2], [5.05, WZ + 1.7, .2], [-3.6, WZ + 1.6, .85]],
  maps: [[-3.6, WZ + 1.4, .45], [3.9, WZ + 1.3, .5]],
  inn: [[3.6, WZ + 2.2, 1.25], [-WX - .58, 1.95, .85], [5.3, WZ + 3.6, .15]],
  tea: [[2.8, WZ + 2.1, 1.05], [4.5, WZ + 1.8, 1.05], [2.0, WZ + 3.2, .15], [5.2, WZ + 3.2, .15]],
  garden: [[3.8, WZ + 1.7, 1.0], [-3.5, WZ + 1.5, .9], [2.7, WZ + 2.6, .35]],
};

/**
 * Moves (x, z) straight away from the nearest way until its paved edge is at least `gap` m off, so a prop planned
 * beside today's straight streets still stands beside them after the ground lane bends them. Deterministic.
 */
export function clearOfWays(x: number, z: number, gap: number): [number, number] {
  for (let k = 0; k < 24; k++) {
    const d = skyPathDistance(x, z);
    if (d >= gap) break;
    const e = .25, gx = skyPathDistance(x + e, z) - skyPathDistance(x - e, z), gz = skyPathDistance(x, z + e) - skyPathDistance(x, z - e), l = Math.hypot(gx, gz) || 1;
    const step = Math.min(1.5, gap - d + .05);
    x += gx / l * step; z += gz / l * step;
  }
  return [x, z];
}
const away = <T extends {x: number; z: number}>(o: T, gap: number): T => { const [x, z] = clearOfWays(o.x, o.z, gap); return {...o, x, z}; };

/** Market stalls facing the high street (yaw: local +z toward the road). */
export const SKY_STALLS: {x: number; z: number; yaw: number; goods: 'seeds' | 'kites'}[] = [
  away({x: -11.5, z: 19, yaw: Math.PI / 2, goods: 'seeds' as const}, 4.4),
  away({x: 11.5, z: 21, yaw: -Math.PI / 2, goods: 'kites' as const}, 4.4),
];
/** A hand cart of pollen jars and sacks beside the kite stall. */
export const SKY_CART = away({x: 10.5, z: 14.5, yaw: -2.2}, 2.2);
/**
 * Carved lantern posts, gathered where people stop: the market (two by the stalls), the harbour head (by the sheds)
 * and each bench scene. Hanging lanterns on the houses and festoons over the street ends light the rest of the town.
 */
export const SKY_LANTERNS: [number, number][] = [
  [-14.6, 23.4], [14.2, 16.6], [-6.4, 98.5], [7.2, 96.8],
  ...([[10.6, 45.6], [-10.6, 66.4], [-11.2, 28.2]] as [number, number][]),
].map(([x, z]) => clearOfWays(x, z, 1.2));
/** Cloth banners on tall poles: a pair at the harbour gate, a cluster of three round the market. */
export const SKY_BANNERS: [number, number][] = ([[-6.5, 91], [6.5, 91], [-15.2, 16.2], [15.6, 24.4], [16.8, 13.6]] as [number, number][])
  .map(([x, z]) => clearOfWays(x, z, 1.3));
/** Benches with planters around them (yaw: the way a sitter faces). */
export const SKY_BENCHES: {x: number; z: number; yaw: number}[] = [
  {x: 9, z: 47, yaw: -Math.PI / 2}, {x: -9, z: 65, yaw: Math.PI / 2}, {x: -9.5, z: 26.5, yaw: Math.PI / 2 + .3},
].map(b => away(b, 2.4));
/** Festoons of paper lanterns across the street end in front of three houses: the two poles' house-frame spots. */
export const SKY_FESTOONS: {house: number; poles: [[number, number], [number, number]]}[] = [
  {house: 0, poles: [[-3.5, WZ + 3.0], [3.5, WZ + 3.8]]},
  {house: 1, poles: [[-3.4, WZ + 3.8], [3.4, WZ + 3.6]]},
  {house: 5, poles: [[-3.5, WZ + 3.6], [3.5, WZ + 3.9]]},
];
export const festoonPoles = (f: (typeof SKY_FESTOONS)[number]) => f.poles.map(([lx, lz]) => { const [x, z] = houseToWorld(SKY_HOUSES[f.house], lx, lz); return clearOfWays(x, z, .6); });

/** Harbour: a boardwalk from the end of the high street to a pier head out over the cloud sea. */
export const SKY_PIER = {x: 0, z0: 95, z1: 150, half: 2.6, headZ: 131, headHalf: 5.2, gateZ: 101.5};
export const SKY_AIRSHIP = {x: 7.9, z: 141, yaw: 0};
/** Mooring mast east of the chandler's: a second airship rides at its top, seen from the arrival and from the air. */
export const SKY_MAST = {x: 45, z: 58, height: 14};
/** The harbour's sail-roofed buildings beside the boardwalk head, open to it (local +z): a cargo shed and the harbourmaster's booth. */
export const SKY_SHEDS: {x: number; z: number; yaw: number; hx: number; hz: number; kind: 'cargo' | 'booth'}[] = [
  {x: 10.8, z: 98.6, yaw: -Math.PI / 2 + .14, hx: 3.0, hz: 2.3, kind: 'cargo'},
  {x: -9.6, z: 96.8, yaw: Math.PI / 2 - .1, hx: 1.9, hz: 1.7, kind: 'booth'},
];
/** Cargo waiting on the grass by the sheds (box half sizes). */
export const SKY_CARGO: {x: number; z: number; hx: number; hz: number}[] = [
  {x: 5.6, z: 101.6, hx: 1.2, hz: 1.4}, {x: -5.3, z: 101.2, hx: 1.1, hz: 1.2},
];

/** The gardener's lean-to glasshouse on the north side of the house at (-30, 38) (box half sizes). */
export const SKY_GLASSHOUSE = {x: -30, z: 44.5, hx: 3.2, hz: 1.4};

/**
 * Solids the town adds in World VI: the six houses (exact footprints, replacing the shared frontier boxes), their
 * yards, stalls, cart, posts, banners, festoon poles, sheds, cargo, the harbour gate and the mooring mast; and a rope
 * across the harbour gate, since the boardwalk rides above the falling meadow and gameplay heights stay on the ground.
 * World V never calls this.
 */
export function layoutSkyTown(col: Collision, heightAt: (x: number, z: number) => number) {
  const post = (x: number, z: number, r: number, h: number) => { const y = heightAt(x, z); col.addCircle(x, z, r, y - 1, y + h); };
  for (const hs of SKY_HOUSES) {
    // Ground floor and plinth (the balcony and jetty ride above a crab's head).
    const y = heightAt(hs.x, hs.z); col.addBox(hs.x, hs.z, WX + .25, WZ + .25, hs.yaw, y - 2, y + 12);
    for (const [lx, lz, r] of HOUSE_YARD[hs.role]) { const [x, z] = houseToWorld(hs, lx, lz); post(x, z, r, 2.6); }
  }
  for (const s of SKY_STALLS) { const y = heightAt(s.x, s.z); col.addBox(s.x, s.z, 2.4, 1.3, s.yaw, y - 1, y + 3.4); }
  { const y = heightAt(SKY_CART.x, SKY_CART.z); col.addBox(SKY_CART.x, SKY_CART.z, 1.1, .8, SKY_CART.yaw, y - 1, y + 1.6); }
  for (const [x, z] of SKY_LANTERNS) post(x, z, .3, 3.6);
  for (const [x, z] of SKY_BANNERS) post(x, z, .26, 6.5);
  for (const f of SKY_FESTOONS) for (const [x, z] of festoonPoles(f)) post(x, z, .16, 3.6);
  for (const s of SKY_SHEDS) { const y = heightAt(s.x, s.z); col.addBox(s.x, s.z, s.hx, s.hz, s.yaw, y - 2, y + 4.5); }
  for (const c of SKY_CARGO) { const y = heightAt(c.x, c.z); col.addBox(c.x, c.z, c.hx, c.hz, 0, y - 1, y + 2.2); }
  for (const sx of [-1, 1]) post(SKY_PIER.x + sx * 3.25, SKY_PIER.gateZ, .4, 5.5);
  { const y = heightAt(SKY_PIER.x, SKY_PIER.gateZ); col.addBox(SKY_PIER.x, SKY_PIER.gateZ, 3.0, .2, 0, y - 1, y + 3); }
  post(SKY_MAST.x, SKY_MAST.z, 2.3, SKY_MAST.height);
  { const g = SKY_GLASSHOUSE, y = heightAt(g.x, g.z); col.addBox(g.x, g.z, g.hx, g.hz, 0, y - 1, y + 3); }
}
