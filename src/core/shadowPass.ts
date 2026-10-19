// Shadow-only meshes: drawn into shadow maps, skipped by every camera pass. The engine marks the
// shadow-map pass; a shadow-only mesh then passes the frustum test only there. Before the engine
// tracks it (a page without the engine) such a mesh draws everywhere, as any other mesh does.
import type * as THREE from 'three';

const pass = { tracked: false, shadow: false };
const castersByScene = new WeakMap<THREE.Object3D, THREE.Light[]>();

/** Mark this renderer's shadow-map pass for shadowOnly() meshes. */
export function trackShadowPass(renderer: THREE.WebGLRenderer): void {
  const sm = renderer.shadowMap;
  const render = sm.render.bind(sm);
  sm.render = (lights, scene, camera) => {
    castersByScene.set(scene, lights);
    pass.shadow = true;
    try {
      render(lights, scene, camera);
    } finally {
      pass.shadow = false;
    }
  };
  pass.tracked = true;
}

/** Keep `mesh` out of camera passes (it must stay frustumCulled; the shadow pass still draws it). */
export function shadowOnly(mesh: THREE.Mesh): void {
  const test = mesh.intersectsFrustum.bind(mesh);
  mesh.intersectsFrustum = (frustum) => (!pass.tracked || pass.shadow) && test(frustum);
}

/** The shadow-casting lights of `scene`'s last render (empty before its first). */
export function shadowLights(scene: THREE.Object3D): readonly THREE.Light[] {
  return castersByScene.get(scene) ?? [];
}
