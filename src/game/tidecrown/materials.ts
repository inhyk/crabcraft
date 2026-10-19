// Runtime materials for the castle kit's TC_* names. The kit ships no textures: its stone takes World I's ashlar and
// round tiles, cloned (World I stylises the shared ones) and re-tinted to warm limestone and sea-blue slate. Every
// material reads vertex colour, where the kit bakes its ambient occlusion.
import * as THREE from 'three';
import type { Kit } from '../../world/kit';
import { addPatch, plankMaterial, stylise, WORLD_UNIFORMS } from '../../world/materials';
import { GLSL_NOISE } from '../../world/noise';
import { noiseTexture } from '../../world/terrain';
import { crestTexture, sailTexture } from './banners';

export const TC_MATERIAL_NAMES = [
  'TC_Limestone', 'TC_LimestoneDark', 'TC_Slate', 'TC_Gold', 'TC_Nacre', 'TC_Glass', 'TC_LanternGlow', 'TC_Iron', 'TC_Wood',
  // The districts' kits (tidecrown-city.glb, tidecrown-harbor.glb).
  'TC_Seaglass', 'TC_SeaglassDeep', 'TC_Copper', 'TC_Banner', 'TC_DeckWood', 'TC_WoodDark', 'TC_Sail', 'TC_Rope', 'TC_PaintBlue',
] as const;
export type TcMaterialName = (typeof TC_MATERIAL_NAMES)[number];
export type TidecrownMaterials = Record<TcMaterialName, THREE.Material>;

/** Own texture objects over the shared images, so the repeat can differ from World I. */
function retile(m: THREE.MeshStandardMaterial, repeat: number): void {
  for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap'] as const) {
    const t = m[key];
    if (!t) continue;
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(repeat, repeat);
    c.userData.tidecrown = true;
    m[key] = c;
  }
}

/**
 * A kit stone re-coloured by its own luminance: `tint` at the texture's mean brightness, `contrast` keeping the
 * course lines. A broad world-space mottle and darker footings weather the big faces.
 */
function stone(source: THREE.MeshStandardMaterial | null, name: string, tint: string, mean: number, contrast: number, repeat: number, sat: number): THREE.MeshStandardMaterial {
  const m = (source?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
  m.name = name;
  m.color.set('#ffffff');
  m.metalness = 0;
  m.metalnessMap = null;
  m.roughness = 0.88;
  m.side = THREE.FrontSide;
  m.vertexColors = true;
  retile(m, repeat);
  const c = new THREE.Color(tint);
  const v = (x: number) => x.toFixed(4);
  addPatch(m, `tc-stone-${name}-${tint}-${contrast}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTcW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTcW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTcW;\n${GLSL_NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) / ${v(mean)};
          vec3 c = vec3(${v(c.r)}, ${v(c.g)}, ${v(c.b)}) * mix(1.0, l, ${v(contrast)});
          float mottle = cc_vnoise(vTcW.xz * 0.045 + vTcW.y * 0.03) * 0.6 + cc_vnoise(vTcW.xy * 0.13 + vTcW.zy * 0.11) * 0.4;
          c *= 0.9 + 0.16 * mottle;
          // Rain streaks and a damp footing.
          float streak = smoothstep(0.62, 0.9, cc_vnoise(vec2(dot(vTcW.xz, vec2(0.7, 0.7)) * 0.9, vTcW.y * 0.04)));
          c *= 1.0 - 0.08 * streak;
          diffuseColor.rgb = c;
        }`,
      );
  });
  stylise(m, sat, [1.02, 1.0, 0.97]);
  return m;
}

/** Leaded panes in sea-blue and gold, lit from inside. */
function stainedGlass(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'TC_Glass', color: '#14202c', emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.1, vertexColors: true });
  addPatch(m, 'tc-glass', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTcG;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTcG = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vTcG;\n${GLSL_NOISE}`).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec2 q = vec2(vTcG.x + vTcG.z, vTcG.y) * 1.4;
        vec2 cell = floor(q), f = fract(q);
        float lead = smoothstep(0.0, 0.08, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
        float k = cc_hash12(cell);
        vec3 pane = k < 0.5 ? vec3(0.16, 0.42, 0.95) : k < 0.72 ? vec3(0.1, 0.7, 0.78) : vec3(1.0, 0.72, 0.28);
        totalEmissiveRadiance *= pane * lead * (0.8 + 0.4 * cc_vnoise(q * 0.7));
      }`,
    );
  });
  return m;
}

/** Mother-of-pearl: an iridescent film whose thickness swirls across the shell, shifting pink, teal and gold. */
function nacre(): THREE.MeshPhysicalMaterial {
  const swirl = noiseTexture().clone();
  swirl.wrapS = swirl.wrapT = THREE.RepeatWrapping;
  swirl.repeat.set(0.06, 0.06);
  swirl.userData.tidecrown = true;
  return new THREE.MeshPhysicalMaterial({
    name: 'TC_Nacre',
    color: '#f2e8f0',
    roughness: 0.28,
    metalness: 0.15,
    iridescence: 1,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [250, 800],
    iridescenceThicknessMap: swirl,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffd6ec'),
    vertexColors: true,
  });
}

/**
 * Seaglass: thick sea-worn glass lit from within. The film shifts colour with the view, the rim glows (the glass
 * gathers light at its edges), a slow caustic shimmer runs up through it, and the colour drifts from `low` at the foot
 * to `high` up a tower. Opaque enough to sort as one piece.
 */
function seaglass(name: string, low: string, high: string, glow: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    name, color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.05, metalness: 0.05,
    iridescence: 0.85, iridescenceIOR: 1.5, iridescenceThicknessRange: [200, 650], clearcoat: 1, clearcoatRoughness: 0.03,
    specularIntensity: 1, envMapIntensity: 2.4, transparent: true, opacity: 0.93, vertexColors: true,
  });
  const lo = new THREE.Color(low), hi = new THREE.Color(high);
  const v3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  addPatch(m, `tc-seaglass-${name}`, (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSgW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSgW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSgW;\nuniform float uTime;\n${GLSL_NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float sgN = cc_vnoise(vec2(vSgW.x + vSgW.z, vSgW.y) * 0.3);
        vec3 sgCol = mix(${v3(lo)}, ${v3(hi)}, smoothstep(0.15, 0.85, fract(vSgW.y / 90.0) + (sgN - 0.5) * 0.35));
        diffuseColor.rgb = sgCol * 0.45;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 V = normalize(cameraPosition - vSgW);
          vec3 Nw = normalize(cross(dFdx(vSgW), dFdy(vSgW)));
          float rim = pow(1.0 - abs(dot(Nw, V)), 2.2);
          float caustic = cc_vnoise(vec2(vSgW.x * 0.6 + vSgW.z * 0.4, vSgW.y * 0.45 - uTime * 0.35)) * cc_vnoise(vec2(vSgW.z * 0.7 - vSgW.x * 0.3, vSgW.y * 0.8 + uTime * 0.21));
          totalEmissiveRadiance = sgCol * ${glow.toFixed(2)} * (0.45 + 1.7 * rim + 1.4 * smoothstep(0.22, 0.6, caustic));
        }`,
      );
  });
  return m;
}

/** The kit's planks (village.glb MI_WoodTrim): the harbour's UVs take one plank per strip of its dark floor band. */
function deckWood(village: Kit, name: string, tint: string): THREE.MeshStandardMaterial {
  const src = village.material('MI_WoodTrim');
  const m = (src?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
  m.name = name;
  m.color.set(tint);
  m.vertexColors = true;
  m.metalness = 0;
  for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
    const t = m[key];
    if (!t) continue;
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.offset.set(0, 0.31);
    c.userData.tidecrown = true;
    m[key] = c;
  }
  stylise(m, 1.1, [1.02, 1.0, 0.96]);
  return m;
}

/** One material per TC_* name. `village` is World I's village kit (its stone textures). */
export function tidecrownMaterials(village: Kit): TidecrownMaterials {
  const brick = village.material('MI_Brick'), tiles = village.material('MI_RoundTiles');
  const wood = plankMaterial();
  wood.name = 'TC_Wood';
  wood.vertexColors = true;
  return {
    TC_Limestone: stone(brick, 'TC_Limestone', '#e8e1d3', 0.25, 0.85, 0.62, 1.05),
    TC_LimestoneDark: stone(brick, 'TC_LimestoneDark', '#d2c8b4', 0.25, 1.0, 0.8, 1.05),
    TC_Slate: stone(tiles, 'TC_Slate', '#35577d', 0.19, 1.1, 0.73, 1.15),
    TC_Gold: new THREE.MeshStandardMaterial({ name: 'TC_Gold', color: '#c9a24a', metalness: 0.85, roughness: 0.35, vertexColors: true }),
    TC_Nacre: nacre(),
    TC_Glass: stainedGlass(),
    TC_LanternGlow: new THREE.MeshStandardMaterial({ name: 'TC_LanternGlow', color: '#53f2e4', emissive: '#53f2e4', emissiveIntensity: 3.2, roughness: 0.2, vertexColors: true }),
    TC_Iron: new THREE.MeshStandardMaterial({ name: 'TC_Iron', color: '#3b3f46', metalness: 0.75, roughness: 0.42, vertexColors: true }),
    TC_Wood: wood,
    // Sea-blue to teal for the towers' glass, violet to orchid for their spirals and crystals.
    TC_Seaglass: seaglass('TC_Seaglass', '#1ea9b4', '#3f7cf0', 1),
    TC_SeaglassDeep: seaglass('TC_SeaglassDeep', '#7a4cf5', '#c25cf0', 1.25),
    // Verdigris: the round tiles turned sea-green, the course lines kept.
    TC_Copper: stone(tiles, 'TC_Copper', '#5d9d8a', 0.19, 1.05, 0.73, 1.1),
    TC_Banner: new THREE.MeshStandardMaterial({ name: 'TC_Banner', map: crestTexture(false), roughness: 0.85, side: THREE.DoubleSide, vertexColors: true }),
    TC_DeckWood: deckWood(village, 'TC_DeckWood', '#ffffff'),
    TC_WoodDark: deckWood(village, 'TC_WoodDark', '#9a8676'),
    TC_Sail: new THREE.MeshStandardMaterial({ name: 'TC_Sail', map: sailTexture(), roughness: 0.92, side: THREE.DoubleSide, vertexColors: true }),
    TC_Rope: new THREE.MeshStandardMaterial({ name: 'TC_Rope', color: '#a68a62', roughness: 0.95, vertexColors: true }),
    TC_PaintBlue: new THREE.MeshStandardMaterial({ name: 'TC_PaintBlue', color: '#2b5a9c', roughness: 0.6, metalness: 0.05, vertexColors: true }),
  };
}

/** Material overrides for the districts' kits: their wood takes the planks (the castle's TC_Wood is procedural). */
export function districtOverrides(mats: TidecrownMaterials, harbour: boolean): Record<string, THREE.Material> {
  const o = { ...(mats as unknown as Record<string, THREE.Material>) };
  if (harbour) o.TC_Wood = mats.TC_DeckWood;
  return o;
}
