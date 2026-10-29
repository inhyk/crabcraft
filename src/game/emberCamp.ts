import * as THREE from 'three';
import {loadKit,StaticBatch,trs} from '../world/kit';
import {stylise} from '../world/materials';
import {EMBER_CAMP} from './emberGroundLayout';

/*
 * The crystal miners' camp in front of the east grotto (emberGroundLayout.ts EMBER_CAMP): an empty cart drawn up
 * to the shards, iron-bound crates and a barrel, a pick dropped by the ore heap, a coil of chain and a bucket.
 * Licensed kit props (props.glb, CC0, NOTICE.md) in their own material clones, sooted and dulled to sit on basalt
 * and ash under the amber sky. One batch per kit material; nothing within the lava zones (the grotto is far
 * from them) and every solid piece listed in EMBER_CAMP for the server.
 */
export async function emberCamp(height: (x: number, z: number) => number): Promise<THREE.Group> {
 const props = await loadKit('models/world/props.glb');
 const over: Record<string, THREE.Material> = {};
 for (const [n, m] of props.materials) {
  const v = m.clone() as THREE.MeshStandardMaterial; v.name = `ember-camp-${n}`;
  if (!/Metal/.test(n)) { v.metalness = 0; v.metalnessMap = null; }
  v.side = THREE.FrontSide;
  // Soot and ash: less colour, darker, a touch cool; the metal keeps a little more of its sheen.
  stylise(v, /Metal/.test(n) ? .55 : .5, /Metal/.test(n) ? [.62, .6, .62] : [.58, .52, .5]);
  over[n] = v;
 }
 const batch = new StaticBatch(props, 'ember-crystal-camp');
 const {x, z, yaw} = EMBER_CAMP, c = Math.cos(yaw), s = Math.sin(yaw);
 for (const p of EMBER_CAMP.pieces) {
  const wx = x + c * p.lx + s * p.lz, wz = z - s * p.lx + c * p.lz;
  batch.add(p.piece, trs(wx, height(wx, wz) - p.sink, wz, yaw + p.yaw, p.s, p.pitch ?? 0, p.roll ?? 0), {override: over, skip: ['MI_Trim_Cloth'], castShadow: p.solid !== undefined});
 }
 return batch.build();
}
