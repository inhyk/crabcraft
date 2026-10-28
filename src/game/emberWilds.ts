import * as THREE from 'three';
import type {LavaZone} from './emberLava';
import {EMBER_FEATURES,EMBER_PATHS} from './emberGroundLayout';
import {emberGround} from './emberGround';
import {emberPaving} from './emberPaving';
import {emberRocks} from './emberRocks';
import {emberPlants,emberRubble} from './emberPlants';
import {emberCourt} from './emberCourt';
import {refreshEmberDetail} from './emberNoise';
import {emberCamp} from './emberCamp';

export interface EmberWildsOptions {
 height: (x: number, z: number) => number;
 /** height(0, -72): the forge court's floor level. */
 ly: number;
 /** EmberLava.zones, read at runtime: nothing is placed on the lava. */
 zones: readonly LavaZone[];
}

/** World V's ground lane: terrain, roads, the wilds and the forge court, one group under the island root. */
export class EmberWilds {
 readonly root = new THREE.Group();
 private readonly updaters: ((time: number) => void)[] = [];
 constructor(opts: EmberWildsOptions) {
  this.root.name = 'ember-wilds';
  const ground = emberGround({height: opts.height, zones: opts.zones, features: EMBER_FEATURES});
  this.root.add(ground.mesh); this.updaters.push(ground.update);
  const paving = emberPaving(opts.height, EMBER_PATHS);
  this.root.add(paving.root); this.updaters.push(paving.update);
  const court = emberCourt({height: opts.height, ly: opts.ly});
  this.root.add(court.root); this.updaters.push(court.update);
  const rocks = emberRocks({height: opts.height, zones: opts.zones, features: EMBER_FEATURES, extra: court.addColumns, rubble: emberRubble(opts.zones, EMBER_FEATURES)});
  this.root.add(rocks.rocks, rocks.crystals); this.updaters.push(rocks.update);
  this.root.userData.rocks = rocks.stats;
  const plants = emberPlants({height: opts.height, zones: opts.zones, features: rocks.features});
  this.root.add(...plants.meshes);
  this.root.userData.plants = plants.stats;
  // Kit props load after the island is built; the camp appears when they arrive.
  emberCamp(opts.height).then((g) => { this.root.add(g); this.root.userData.camp = g.children.length; }).catch((e) => console.warn('ember camp', e));
 }
 update(time: number) { refreshEmberDetail(time); for (const u of this.updaters) u(time); }
}
