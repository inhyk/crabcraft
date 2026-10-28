// Goldsand's quest guidance on the ground (ObjectiveMarker.dawn): instead of the flat additive gold discs and
// chevron, small brass sun discs set in the sand (a domed boss, eight rays) lie along the way to the next waypoint,
// and a brass arrowhead at the player's feet points it out. They are lit like the town's brass (sun, Goldsand's
// environment map), so the low sun glints on them; a soft glow runs along the row toward the waypoint so the line
// still reads in shade. Same positions, count and spacing as the crumbs they replace; the objective's light pillar
// stays the shared one.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../world/types';

const DISCS = 9;
const SPACING = 2.2;

/** A brass sun lying flat: a disc with eight rays, its edges bevelled, and a low dome at its centre. */
function sunDisc(): THREE.BufferGeometry {
  const s = new THREE.Shape(), n = 8, tip = .3, base = .2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, w = Math.PI / n * .42;
    const p = (r: number, b: number) => [Math.cos(b) * r, Math.sin(b) * r] as const;
    const [x0, y0] = p(base, a - w), [x1, y1] = p(tip, a), [x2, y2] = p(base, a + w);
    if (i === 0) s.moveTo(x0, y0); else s.lineTo(x0, y0);
    s.lineTo(x1, y1); s.lineTo(x2, y2);
    // The rim between this ray and the next.
    for (let k = 1; k < 4; k++) { const [x, y] = p(base, a + w + (Math.PI * 2 / n - 2 * w) * k / 4); s.lineTo(x, y); }
  }
  s.closePath();
  const plate = new THREE.ExtrudeGeometry(s, { depth: .012, bevelEnabled: true, bevelThickness: .01, bevelSize: .012, bevelSegments: 2, curveSegments: 4 });
  plate.rotateX(-Math.PI / 2);
  const boss = new THREE.SphereGeometry(.11, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .32, 1).translate(0, .02, 0);
  const g = mergeGeometries([plate.toNonIndexed(), boss.toNonIndexed()].map((x) => { x.deleteAttribute('uv'); return x; }), false)!;
  plate.dispose(); boss.dispose();
  return g;
}

/** Brass lit by the scene; the instance colour drives a glow (emissive) instead of tinting the metal. */
function brass(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'goldsand-guide-brass', color: '#c9a24a', metalness: .85, roughness: .3 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined(USE_INSTANCING_COLOR)||defined(USE_COLOR)\ntotalEmissiveRadiance+=vColor.rgb;\n#endif');
  };
  m.customProgramCacheKey = () => 'goldsand-guide-brass';
  return m;
}

export class DawnGuide {
  private discs: THREE.InstancedMesh;
  private arrow: THREE.Mesh;
  private arrowMat: THREE.MeshStandardMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private col = new THREE.Color();
  private glow = new THREE.Color('#ffb04a');

  constructor(parent: THREE.Group) {
    const mat = brass();
    this.discs = new THREE.InstancedMesh(sunDisc(), mat, DISCS);
    this.discs.name = 'goldsand-guide-discs';
    this.discs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DISCS * 3), 3);
    this.discs.frustumCulled = false;
    this.discs.receiveShadow = true;
    // The arrowhead: a flat brass chevron with bevelled edges, tip toward +z.
    const sh = new THREE.Shape();
    sh.moveTo(0, .5); sh.lineTo(.38, .06); sh.lineTo(.2, .06); sh.lineTo(0, .28); sh.lineTo(-.2, .06); sh.lineTo(-.38, .06); sh.closePath();
    const ag = new THREE.ExtrudeGeometry(sh, { depth: .012, bevelEnabled: true, bevelThickness: .01, bevelSize: .01, bevelSegments: 1 });
    ag.rotateX(Math.PI / 2);
    this.arrowMat = new THREE.MeshStandardMaterial({ name: 'goldsand-guide-arrow', color: '#c9a24a', metalness: .85, roughness: .3, emissive: '#ff9a3a', emissiveIntensity: .25 });
    this.arrow = new THREE.Mesh(ag, this.arrowMat);
    this.arrow.name = 'goldsand-guide-arrow';
    this.arrow.frustumCulled = false;
    this.arrow.receiveShadow = true;
    parent.add(this.discs, this.arrow);
    this.hide();
  }

  hide(): void {
    this.discs.visible = this.arrow.visible = false;
  }

  /** As ObjectiveMarker's chevron and crumbs: `from` the player, `lead` the next waypoint, `dist` to the target. */
  update(time: number, world: World, from: THREE.Vector3, lead: THREE.Vector3, dist: number, show: boolean): void {
    this.arrow.visible = show;
    this.discs.visible = show && dist > 10;
    if (!show) return;
    const leadDist = Math.max(0.001, Math.hypot(lead.x - from.x, lead.z - from.z));
    const dx = (lead.x - from.x) / leadDist, dz = (lead.z - from.z) / leadDist, yaw = Math.atan2(dx, dz);
    const cx = from.x + dx * 1.55, cz = from.z + dz * 1.55;
    this.arrow.position.set(cx, world.heightAt(cx, cz) + 0.03, cz);
    this.arrow.rotation.set(0, yaw, 0);
    this.arrow.scale.setScalar(0.8);
    this.arrowMat.emissiveIntensity = 0.18 + 0.12 * Math.sin(time * 5);
    if (!this.discs.visible) return;
    // The glow's crest runs out along the row and starts again from the player's feet.
    const pulse = (time * 4.2) % (DISCS * SPACING + 4) - 2;
    const n = Math.min(DISCS, Math.floor((Math.min(dist, leadDist + 2) - 4) / SPACING));
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    for (let i = 0; i < DISCS; i++) {
      // Fixed spacing (set in the sand, they do not slide); a glow runs along the row toward the waypoint.
      const d = 3 + i * SPACING, x = from.x + dx * d, z = from.z + dz * d;
      this.p.set(x, world.heightAt(x, z) + 0.012, z);
      const k = i < n ? 1 - i / DISCS : 0;
      const sc = (0.75 + 0.35 * k) * (i < n ? 1 : 0.0001);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.discs.setMatrixAt(i, this.m);
      const t = (d - 3 - pulse) / 1.8, wave = Math.exp(-t * t);
      this.col.copy(this.glow).multiplyScalar((0.05 + 0.3 * wave) * k);
      this.discs.setColorAt(i, this.col);
    }
    this.discs.instanceMatrix.needsUpdate = true;
    if (this.discs.instanceColor) this.discs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.discs.geometry.dispose();
    (this.discs.material as THREE.Material).dispose();
    this.discs.dispose();
    this.arrow.geometry.dispose();
    this.arrowMat.dispose();
    this.discs.removeFromParent();
    this.arrow.removeFromParent();
  }
}
