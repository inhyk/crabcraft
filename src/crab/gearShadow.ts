// Gear shadows in one draw per piece. A gear piece (a sword, a tabard, a crest) is split into one mesh
// per material, and each cast its own shadow: up to 18 shadow draws for a dressed crab. With the
// crab's shadow proxy on, the piece's solid meshes are merged (positions only, in the piece's frame)
// into one shadow-only mesh under the piece, so it follows the piece and hides with it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shadowOnly } from '../core/shadowPass';

const SHADOW = 'gear-shadow';
const cache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
const rel = new THREE.Matrix4();

/** Meshes whose shadow the merged one can stand in for: plain, opaque, no cut-out. */
function mergeable(m: THREE.Mesh): boolean {
  const mat = m.material as THREE.MeshStandardMaterial;
  return (
    m.castShadow && !(m as THREE.SkinnedMesh).isSkinnedMesh && !m.morphTargetInfluences && !Array.isArray(mat) &&
    !mat.alphaTest && !mat.alphaMap && !mat.displacementMap && mat.side === THREE.FrontSide
  );
}

/**
 * Merge (proxy on) or restore (proxy off) the shadows of every gear piece. Meshes in `detail` hide at the far LOD,
 * so they keep casting their own shadow (and stop with it) instead of joining the merged one.
 */
export function syncGearShadows(pieces: readonly THREE.Object3D[], material: THREE.Material | null, detail: readonly THREE.Object3D[] = []): void {
  const own = new Set(detail);
  for (const piece of pieces) {
    const old = piece.children.find((c) => c.name === SHADOW);
    old?.removeFromParent();
    const merged: THREE.Mesh[] = [];
    piece.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.userData.gearShadowMerged) m.castShadow = true;
      delete m.userData.gearShadowMerged;
      if (mergeable(m) && !own.has(m)) merged.push(m);
    });
    if (!material || merged.length < 2) continue;
    const mesh = new THREE.Mesh(geometryFor(piece, merged), material);
    mesh.name = SHADOW;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    shadowOnly(mesh);
    piece.add(mesh);
    for (const m of merged) {
      m.castShadow = false;
      m.userData.gearShadowMerged = true;
    }
  }
}

function geometryFor(piece: THREE.Object3D, meshes: THREE.Mesh[]): THREE.BufferGeometry {
  // Clones of one piece share their geometries: key on them.
  const key = meshes.map((m) => m.geometry.uuid).join(',');
  let byKey = cache.get(meshes[0].geometry);
  if (!byKey) cache.set(meshes[0].geometry, (byKey = new Map()));
  let g = byKey.get(key);
  if (g) return g;
  const list = meshes.map((m) => {
    rel.identity();
    for (let o: THREE.Object3D | null = m; o && o !== piece; o = o.parent) {
      o.updateMatrix();
      rel.premultiply(o.matrix);
    }
    const src = m.geometry.getAttribute('position');
    const pos = new Float32Array(src.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) v.fromBufferAttribute(src, i).applyMatrix4(rel).toArray(pos, i * 3);
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (m.geometry.index) out.setIndex(m.geometry.index.clone());
    return out;
  });
  const indexed = list.every((l) => l.index);
  g = mergeGeometries(indexed ? list : list.map((l) => (l.index ? l.toNonIndexed() : l)), false) ?? new THREE.BufferGeometry();
  g.name = SHADOW;
  g.computeBoundingSphere();
  byKey.set(key, g);
  return g;
}
