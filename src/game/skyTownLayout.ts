import type {Collision} from '../world/collision';

/*
 * World VI town plan, shared by the scenery (skyTown.ts, skyHarbour.ts) and the colliders the server bakes
 * (layoutSkyTown, called from layoutFrontier for chapter 6 only). Numbers only, no three.js.
 * Houses keep the old footprints (x = +-30, z = 38 / 56 / 74, the 5.3 x 5.8 boxes in realmLayout.ts) and turn their
 * doors to the cross streets that end at x = +-23. Roads: the high street x in [-4, 4] from z = 94 north, cross
 * streets z +- 2 at 38 / 56 / 74 out to x = +-23, the spawn lane z in [82, 86] from x = -12 to 0.
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
/** Market stalls facing the high street (yaw: local +z toward the road). */
export const SKY_STALLS: {x: number; z: number; yaw: number; goods: 'seeds' | 'kites'}[] = [
  {x: -11.5, z: 19, yaw: Math.PI / 2, goods: 'seeds'},
  {x: 11.5, z: 21, yaw: -Math.PI / 2, goods: 'kites'},
];
/** A hand cart of pollen jars and sacks beside the kite stall. */
export const SKY_CART = {x: 10.5, z: 14.5, yaw: -2.2};
/** Carved lantern posts: pairs framing each cross street, then staggered down the road to the sanctuary. */
export const SKY_LANTERNS: [number, number][] = [
  [-5.6, 79], [5.6, 69], [-5.6, 69], [5.6, 79], [-5.6, 61], [5.6, 61], [-5.6, 51], [5.6, 51], [-5.6, 43], [5.6, 43], [-5.6, 33], [5.6, 33],
  [-5.6, 11], [5.6, -1], [-5.6, -14], [5.6, -28],
];
/** Cloth banners on tall poles: the harbour gate, the market entrance, the road out of town. */
export const SKY_BANNERS: [number, number][] = [[-6.5, 91], [6.5, 91], [-8, 29], [8, 29], [-7.5, -6], [7.5, -6]];
/** Benches with planters around them (yaw: the way a sitter faces). */
export const SKY_BENCHES: {x: number; z: number; yaw: number}[] = [
  {x: 9, z: 47, yaw: -Math.PI / 2}, {x: -9, z: 65, yaw: Math.PI / 2}, {x: -9.5, z: 26.5, yaw: Math.PI / 2 + .3},
];
/** Harbour: a boardwalk from the end of the high street to a pier head out over the cloud sea. */
export const SKY_PIER = {x: 0, z0: 95, z1: 150, half: 2.6, headZ: 131, headHalf: 5.2, gateZ: 104};
export const SKY_AIRSHIP = {x: 7.9, z: 141, yaw: 0};
/** Cargo on the grass beside the boardwalk (box half sizes). */
export const SKY_CARGO: {x: number; z: number; hx: number; hz: number}[] = [
  {x: 5.4, z: 109, hx: 1.3, hz: 1.6}, {x: -5.2, z: 113, hx: 1.1, hz: 1.2},
];

/** Solids the town adds in World VI (stalls, posts, cargo); World V never calls this. */
export function layoutSkyTown(col: Collision, heightAt: (x: number, z: number) => number) {
  const post = (x: number, z: number, r: number, h: number) => { const y = heightAt(x, z); col.addCircle(x, z, r, y - 1, y + h); };
  for (const s of SKY_STALLS) { const y = heightAt(s.x, s.z); col.addBox(s.x, s.z, 2.4, 1.3, -s.yaw, y - 1, y + 3.4); }
  { const y = heightAt(SKY_CART.x, SKY_CART.z); col.addBox(SKY_CART.x, SKY_CART.z, 1.1, .8, -SKY_CART.yaw, y - 1, y + 1.6); }
  for (const [x, z] of SKY_LANTERNS) post(x, z, .3, 3.6);
  for (const [x, z] of SKY_BANNERS) post(x, z, .26, 6.5);
  for (const c of SKY_CARGO) { const y = heightAt(c.x, c.z); col.addBox(c.x, c.z, c.hx, c.hz, 0, y - 1, y + 2.2); }
  for (const sx of [-1, 1]) post(SKY_PIER.x + sx * 3.25, SKY_PIER.gateZ, .3, 5.5);
}
