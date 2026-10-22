// Far LOD body in one draw. The dark, visor, metal, joint and rubber LOD classes are merged into one
// skinned geometry whose vertices carry their class's colour and surface (metalness, roughness,
// clearcoat, clearcoat roughness, specular intensity); one MeshPhysicalMaterial reads them per
// vertex, so it shades each class as its own material does, in one draw for five. (Env intensity
// stays the scene's: three ignores a material's own when it lights by scene.environment.)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { partMaterial } from './materials';
import type { PartClass } from './template';

const BODY: Exclude<PartClass, 'shell'>[] = ['dark', 'visor', 'metal', 'joint', 'rubber'];
const KEEP = ['position', 'normal', 'skinIndex', 'skinWeight'];

const cache = new WeakMap<Map<PartClass, THREE.BufferGeometry>, Map<string, THREE.BufferGeometry | null>>();
let material: THREE.MeshPhysicalMaterial | null = null;

/** The merged body for these LOD parts and part variant ('' factory, 'rust'); null without parts. */
export function lodBody(parts: Map<PartClass, THREE.BufferGeometry>, variant: string): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  let byVariant = cache.get(parts);
  if (!byVariant) cache.set(parts, (byVariant = new Map()));
  let geometry = byVariant.get(variant);
  if (geometry === undefined) {
    geometry = build(parts, variant);
    byVariant.set(variant, geometry);
  }
  return geometry ? { geometry, material: bodyMaterial() } : null;
}

function build(parts: Map<PartClass, THREE.BufferGeometry>, variant: string): THREE.BufferGeometry | null {
  const list: THREE.BufferGeometry[] = [];
  for (const cls of BODY) {
    const src = parts.get(cls);
    if (!src) continue;
    const m = partMaterial(cls, variant) as THREE.MeshPhysicalMaterial;
    const g = new THREE.BufferGeometry();
    for (const name of KEEP) if (src.getAttribute(name)) g.setAttribute(name, src.getAttribute(name));
    if (src.index) g.setIndex(src.index);
    const n = src.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const surf = new Float32Array(n * 4);
    const spec = new Float32Array(n);
    const s = [m.metalness, m.roughness, m.clearcoat ?? 0, m.clearcoatRoughness ?? 0];
    const sp = m.isMeshPhysicalMaterial ? m.specularIntensity : 1;
    for (let i = 0; i < n; i++) {
      col.set([m.color.r, m.color.g, m.color.b], i * 3);
      surf.set(s, i * 4);
      spec[i] = sp;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('surface', new THREE.BufferAttribute(surf, 4));
    g.setAttribute('specular', new THREE.BufferAttribute(spec, 1));
    list.push(g);
  }
  if (!list.length) return null;
  const merged = mergeGeometries(list, false);
  if (!merged) return null;
  merged.name = 'crab-body-lod';
  // Generous bounds, as for the parts: the rig poses far from the bind pose.
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.45);
  return merged;
}

/** Reads the surface per vertex; a clone (see-through, effects) keeps the patch. */
class LodBodyMaterial extends THREE.MeshPhysicalMaterial {
  constructor(params?: THREE.MeshPhysicalMaterialParameters) {
    super(params);
    this.onBeforeCompile = patch;
    this.customProgramCacheKey = () => 'crab-body-lod';
  }
}

function patch(sh: THREE.WebGLProgramParametersWithUniforms): void {
  sh.vertexShader =
    'attribute vec4 surface;\nattribute float specular;\nvarying vec4 vSurface;\nvarying float vSpecular;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSurface = surface;\n\tvSpecular = specular;');
  const lights = THREE.ShaderChunk.lights_physical_fragment
    .replace('material.clearcoat = clearcoat;', 'material.clearcoat = vSurface.z;')
    .replace('material.clearcoatRoughness = clearcoatRoughness;', 'material.clearcoatRoughness = vSurface.w;')
    .replace('float specularIntensityFactor = specularIntensity;', 'float specularIntensityFactor = vSpecular;');
  sh.fragmentShader =
    'varying vec4 vSurface;\nvarying float vSpecular;\n' +
    sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurface.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurface.x;')
      .replace('#include <lights_physical_fragment>', lights);
}

function bodyMaterial(): THREE.MeshPhysicalMaterial {
  if (material) return material;
  // Clearcoat on so the coat layer compiles; each vertex sets its own coat (0 for the standard parts,
  // which then shade as MeshStandardMaterial: ior 1.5 gives the same 0.04 base reflectance).
  material = new LodBodyMaterial({ vertexColors: true, color: 0xffffff, metalness: 1, roughness: 1, clearcoat: 1, clearcoatRoughness: 1 });
  material.name = 'crab-body-lod';
  return material;
}
