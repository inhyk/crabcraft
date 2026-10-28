// Emberreach's quest guidance on the ground (ObjectiveMarker.ember): instead of the flat additive gold discs and
// chevron, hexagonal brass studs set flush in the basalt lie along the way to the next waypoint, each with a coal
// in its socket, and a brass arrowhead at the player's feet points it out. The brass is lit by the scene (the low
// amber sun glints on it); only the coals glow, softly, and a brighter breath runs along the row toward the waypoint
// so the line still reads in shade without turning into a row of yellow dots. Same positions, count and spacing as
// the crumbs they replace; the objective's light pillar stays the shared one.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../world/types';

const STUDS = 9;
const SPACING = 2.2;

/** A hexagonal brass stud: a bevelled ring plate and, sunk in its socket, a coal (aCore = 1). */
function stud(): THREE.BufferGeometry {
  const hex = (r: number, rot = Math.PI / 6) => { const p = new THREE.Path(); for (let i = 0; i < 6; i++) { const a = rot + i * Math.PI / 3; if (i === 0) p.moveTo(Math.cos(a) * r, Math.sin(a) * r); else p.lineTo(Math.cos(a) * r, Math.sin(a) * r); } p.closePath(); return p; };
  const ring = new THREE.Shape(hex(.27).getPoints());
  ring.holes.push(hex(.15));
  const plate = new THREE.ExtrudeGeometry(ring, { depth: .016, bevelEnabled: true, bevelThickness: .012, bevelSize: .014, bevelSegments: 2, curveSegments: 1 });
  plate.rotateX(-Math.PI / 2);
  const coal = new THREE.CylinderGeometry(.16, .16, .03, 6, 1).rotateY(Math.PI / 6).translate(0, .004, 0);
  const parts = [plate.toNonIndexed(), coal.toNonIndexed()].map((g, k) => {
    g.deleteAttribute('uv');
    g.setAttribute('aCore', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(k), 1));
    return g;
  });
  const g = mergeGeometries(parts, false)!;
  plate.dispose(); coal.dispose();
  return g;
}

/** Brass lit by the scene; the coal is dark until its instance colour (the glow) lights it. */
function material(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'ember-guide-brass', color: '#9a6e36', metalness: .75, roughness: .55 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCore;\nvarying float vCore;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCore=aCore;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCore;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.03,.02,.02),vCore);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor*=1.-vCore;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.9,vCore);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined(USE_INSTANCING_COLOR)||defined(USE_COLOR)\ntotalEmissiveRadiance+=vColor.rgb*mix(.04,1.,vCore);\n#endif');
  };
  m.customProgramCacheKey = () => 'ember-guide-brass';
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
    // The arrowhead: a flat brass chevron with bevelled edges, tip toward +z, a coal-red line in its throat.
    const sh = new THREE.Shape();
    sh.moveTo(0, .5); sh.lineTo(.38, .06); sh.lineTo(.2, .06); sh.lineTo(0, .28); sh.lineTo(-.2, .06); sh.lineTo(-.38, .06); sh.closePath();
    const ag = new THREE.ExtrudeGeometry(sh, { depth: .012, bevelEnabled: true, bevelThickness: .01, bevelSize: .01, bevelSegments: 1 });
    ag.rotateX(Math.PI / 2);
    this.arrowMat = new THREE.MeshStandardMaterial({ name: 'ember-guide-arrow', color: '#9a6e36', metalness: .75, roughness: .55, emissive: '#ff5a16', emissiveIntensity: .12 });
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
    this.arrowMat.emissiveIntensity = 0.08 + 0.08 * Math.sin(time * 5);
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
      this.col.copy(this.glow).multiplyScalar((0.35 + 1.6 * wave) * k);
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
