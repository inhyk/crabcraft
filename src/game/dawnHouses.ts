import * as THREE from 'three';
import {addPatch} from '../world/materials';
import type {Kit} from '../world/kit';

/*
 * Dawnharbor's houses keep the kit's modules but not World I's colours: limewashed walls, sea-green glazed roof
 * tiles, sun-bleached driftwood frames, doors and shutters, honey sandstone footings. Each kit material used by the
 * town is a patched clone (the kit's own materials are shared with other worlds): the texture's luminance is kept
 * as the detail and remapped onto the coast's palette.
 */

const LUMA = 'float dhL=dot(diffuseColor.rgb,vec3(.299,.587,.114));';
const RAMPS: Record<string, {key: string; glsl: string; rough?: number}> = {
  // Limewash: near white with a warm cast, darker where the plaster's texture is (cracks, rough patches).
  MI_Plaster: {key: 'lime', glsl: 'diffuseColor.rgb=mix(vec3(.6,.57,.52),vec3(.86,.84,.79),smoothstep(.05,.45,dhL));', rough: .92},
  // Glazed sea-green tiles: deep in the overlaps, bright on the rounded backs.
  MI_RoundTiles: {key: 'tile', glsl: 'diffuseColor.rgb=mix(vec3(.018,.07,.075),vec3(.11,.33,.32),smoothstep(.02,.4,dhL));', rough: .48},
  // Driftwood: grey-brown, bleached, the kit's grain kept.
  MI_WoodTrim: {key: 'drift', glsl: 'diffuseColor.rgb=mix(vec3(.12,.1,.085),vec3(.47,.43,.37),smoothstep(.02,.35,dhL));'},
  // Sandstone footings and dressings.
  MI_UnevenBrick: {key: 'sand1', glsl: 'diffuseColor.rgb=mix(vec3(.2,.13,.07),vec3(.62,.49,.33),smoothstep(.03,.45,dhL));'},
  MI_Brick: {key: 'sand2', glsl: 'diffuseColor.rgb=mix(vec3(.22,.14,.08),vec3(.6,.47,.31),smoothstep(.03,.45,dhL));'},
  MI_RockTrim: {key: 'sand3', glsl: 'diffuseColor.rgb=mix(vec3(.24,.17,.1),vec3(.64,.53,.38),smoothstep(.03,.45,dhL));'},
};

/** Overrides for TownBuilder / StaticBatch: kit material name to Dawnharbor's clone. */
export function dawnHouseMaterials(village: Kit): Record<string, THREE.Material> {
  const out: Record<string, THREE.Material> = {};
  for (const [name, m] of village.materials) {
    const ramp = RAMPS[name];
    if (!ramp) continue;
    const c = m.clone() as THREE.MeshStandardMaterial;
    c.name = `dawnharbor-${name}`;
    c.metalness = 0; c.metalnessMap = null;
    if (ramp.rough !== undefined) { c.roughness = ramp.rough; c.roughnessMap = null; }
    // Closed shells: the inner faces never show.
    c.side = THREE.FrontSide;
    addPatch(c, `dawnharbor-${ramp.key}`, (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n{${LUMA}${ramp.glsl}}`);
    });
    out[name] = c;
  }
  return out;
}
