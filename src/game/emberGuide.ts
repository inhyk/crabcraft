// Emberreach's quest guidance on the ground (ObjectiveMarker.ember): instead of the flat additive gold discs and
// chevron, lava-stone markers lie along the way to the next waypoint: hexagonal plugs of dark basalt set in the ash,
// each split by a Y of glowing cracks, and a basalt arrowhead at the player's feet with a hot seam. Nothing gold or
// metallic (the low sun turned brass into pale dots); only the cracks glow, softly, and a brighter breath of heat runs
// along the row toward the waypoint so the line still reads in shade. Same positions, count and spacing as the
// crumbs they replace; the objective's light pillar stays the shared one.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../world/types';

const STUDS = 9;
const SPACING = 2.2;

/** A lava-stone marker: a bevelled hexagonal basalt plug and, proud of its face, a Y of cracks (aCore = 1). */
function stud(): THREE.BufferGeometry {
  const hex = new THREE.Shape();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3, r = .27 * (.94 + .1 * ((i * 7) % 3) / 2); if (i === 0) hex.moveTo(Math.cos(a) * r, Math.sin(a) * r); else hex.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  hex.closePath();
  const plate = new THREE.ExtrudeGeometry(hex, { depth: .02, bevelEnabled: true, bevelThickness: .02, bevelSize: .025, bevelSegments: 2, curveSegments: 1 });
  plate.rotateX(-Math.PI / 2);
  const parts: THREE.BufferGeometry[] = [plate.toNonIndexed()];
  // Three cracks from a point off centre, each kinked once, a hair above the plug's face.
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + .3;
    for (const [r0, r1, da] of [[.0, .12, 0], [.12, .25, .35 * (k % 2 ? 1 : -1)]] as const) {
      const c = new THREE.BoxGeometry(r1 - r0, .006, .022 - r0 * .04).translate((r0 + r1) / 2, .043, 0).rotateY(-(a + da)).translate(.02, 0, -.015);
      parts.push(c.toNonIndexed()); c.dispose();
    }
  }
  const tagged = parts.map((g, k) => {
    g.deleteAttribute('uv');
    g.setAttribute('aCore', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(k ? 1 : 0), 1));
    return g;
  });
  const g = mergeGeometries(tagged, false)!;
  plate.dispose();
  return g;
}

/** Basalt lit by the scene; the cracks are dark until their instance colour (the glow) lights them. */
function material(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'ember-guide-stone', color: '#34343b', metalness: 0, roughness: .82 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCore;\nvarying float vCore;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCore=aCore;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCore;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.05,.02,.015),vCore);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined(USE_INSTANCING_COLOR)||defined(USE_COLOR)\ntotalEmissiveRadiance+=vColor.rgb*mix(.025,1.,vCore);\n#endif');
  };
  m.customProgramCacheKey = () => 'ember-guide-stone';
  return m;
}

export class EmberGuide {
  private studs: THREE.InstancedMesh;
  private arrow: THREE.Mesh;
  private arrowMat: THREE.MeshStandardMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private col = new THREE.Color();
  private glow = new THREE.Color('#ff6a1e');

  constructor(parent: THREE.Group) {
    this.studs = new THREE.InstancedMesh(stud(), material(), STUDS);
    this.studs.name = 'ember-guide-studs';
    this.studs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STUDS * 3), 3);
    this.studs.frustumCulled = false;
    this.studs.receiveShadow = true;
    // The arrowhead: a flat basalt chevron with bevelled edges, tip toward +z, glowing faintly along its seams.
    const sh = new THREE.Shape();
    sh.moveTo(0, .5); sh.lineTo(.38, .06); sh.lineTo(.2, .06); sh.lineTo(0, .28); sh.lineTo(-.2, .06); sh.lineTo(-.38, .06); sh.closePath();
    const ag = new THREE.ExtrudeGeometry(sh, { depth: .012, bevelEnabled: true, bevelThickness: .01, bevelSize: .01, bevelSegments: 1 });
    ag.rotateX(Math.PI / 2);
    this.arrowMat = new THREE.MeshStandardMaterial({ name: 'ember-guide-arrow', color: '#2e2d33', metalness: 0, roughness: .8, emissive: '#ff4a10', emissiveIntensity: .35 });
    this.arrow = new THREE.Mesh(ag, this.arrowMat);
    this.arrow.name = 'ember-guide-arrow';
    this.arrow.frustumCulled = false;
    this.arrow.receiveShadow = true;
    parent.add(this.studs, this.arrow);
    this.hide();
  }

  hide(): void {
    this.studs.visible = this.arrow.visible = false;
  }

  /** As ObjectiveMarker's chevron and crumbs: `from` the player, `lead` the next waypoint, `dist` to the target. */
  update(time: number, world: World, from: THREE.Vector3, lead: THREE.Vector3, dist: number, show: boolean): void {
    this.arrow.visible = show;
    this.studs.visible = show && dist > 10;
    if (!show) return;
    const leadDist = Math.max(0.001, Math.hypot(lead.x - from.x, lead.z - from.z));
    const dx = (lead.x - from.x) / leadDist, dz = (lead.z - from.z) / leadDist, yaw = Math.atan2(dx, dz);
    const cx = from.x + dx * 1.55, cz = from.z + dz * 1.55;
    this.arrow.position.set(cx, world.heightAt(cx, cz) + 0.03, cz);
    this.arrow.rotation.set(0, yaw, 0);
    this.arrow.scale.setScalar(0.8);
    this.arrowMat.emissiveIntensity = 0.3 + 0.18 * Math.sin(time * 5);
    if (!this.studs.visible) return;
    // A breath of heat runs out along the row and starts again from the player's feet.
    const pulse = (time * 4.2) % (STUDS * SPACING + 4) - 2;
    const n = Math.min(STUDS, Math.floor((Math.min(dist, leadDist + 2) - 4) / SPACING));
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    for (let i = 0; i < STUDS; i++) {
      const d = 3 + i * SPACING, x = from.x + dx * d, z = from.z + dz * d;
      this.p.set(x, world.heightAt(x, z) + 0.006, z);
      const k = i < n ? 1 - i / STUDS : 0;
      const sc = (0.8 + 0.3 * k) * (i < n ? 1 : 0.0001);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.studs.setMatrixAt(i, this.m);
      const t = (d - 3 - pulse) / 1.8, wave = Math.exp(-t * t);
      this.col.copy(this.glow).multiplyScalar((0.6 + 2.2 * wave) * k);
      this.studs.setColorAt(i, this.col);
    }
    this.studs.instanceMatrix.needsUpdate = true;
    if (this.studs.instanceColor) this.studs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.studs.geometry.dispose();
    (this.studs.material as THREE.Material).dispose();
    this.studs.dispose();
    this.arrow.geometry.dispose();
    this.arrowMat.dispose();
    this.studs.removeFromParent();
    this.arrow.removeFromParent();
  }
}
