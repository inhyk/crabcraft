// dusk-rubble: what a burning street leaves on the ground. Heaps of broken stone, charred timbers and
// roof slates with embers glowing in their cracks, and soot spread over the paving with live coals in
// it, so a close shot's foreground is debris, not clean cobbles. Static: built once, ember glow
// breathing with the shot clock.
//
//   piles   [[x, z, radius, count, lean?]...]  pieces heaped toward each centre (lean: beams propped up)
//   ash     [[x, z, width, length, yaw?]...]   soot and coals laid on the ground
//   size    a piece's scale (1: stones about 0.3 across, beams about 1.6 long)
//   ember   glow in the cracks (0 for cold rubble)     seed
import * as THREE from 'three';
import { mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Ground = (x: number, z: number) => number;

/** A rough shape: vertices pushed in and out by a hash of their position, flat shaded. */
function rough(g: THREE.BufferGeometry, k: number, seed: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const p = geo.getAttribute('position');
  const key = (x: number, y: number, z: number) => Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = key(+x.toFixed(3), +y.toFixed(3), +z.toFixed(3));
    const f = 1 + k * ((h - Math.floor(h)) * 2 - 1);
    p.setXYZ(i, x * f, y * (0.85 + 0.15 * f), z * f);
  }
  geo.computeVertexNormals();
  return geo;
}

const EMBER_VS = /* glsl */ `varying vec3 vRubbleW;\n`;
const EMBER_FS = /* glsl */ `
  uniform float uTime, uEmber;
  varying vec3 vRubbleW;
  ${NOISE}
`;

class Rubble implements Effect {
  private group = new THREE.Group();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private uTime = { value: 0 };
  private ashMat: THREE.ShaderMaterial | null = null;

  constructor(cue: FxCue, scene: THREE.Scene, ground: Ground) {
    const rnd = mulberry(num(cue.seed, 7) * 977 + 3);
    const size = num(cue.size, 1);
    const uEmber = { value: num(cue.ember, 1) };
    const ember = (m: THREE.MeshStandardMaterial, k: number) => {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.uTime;
        sh.uniforms.uEmber = uEmber;
        sh.vertexShader = EMBER_VS + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vRubbleW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = EMBER_FS + sh.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           float en = fbm(vRubbleW * 9.0 + vec3(0.0, uTime * 0.25, 0.0));
           float crack = (1.0 - smoothstep(0.0, 0.035, abs(en - 0.5))) * smoothstep(0.35, 0.75, fbm(vRubbleW * 2.3));
           crack *= 0.7 + 0.3 * sin(uTime * 3.0 + vRubbleW.x * 7.0);
           totalEmissiveRadiance = vec3(1.0, 0.28, 0.04) * crack * uEmber * ${k.toFixed(2)};`,
        );
      };
      return m;
    };
    // Kinds: broken stone, charred beam, slate.
    const kinds = [
      { geo: rough(new THREE.IcosahedronGeometry(0.17 * size, 1), 0.35, 1), mat: ember(new THREE.MeshStandardMaterial({ color: '#4a3a32', roughness: 0.95, flatShading: true }), 1.2), w: 0.55 },
      { geo: rough(new THREE.BoxGeometry(0.2 * size, 0.18 * size, 1.6 * size, 1, 1, 4), 0.25, 2), mat: ember(new THREE.MeshStandardMaterial({ color: '#1c130e', roughness: 0.9, flatShading: true }), 3.2), w: 0.2 },
      { geo: rough(new THREE.BoxGeometry(0.42 * size, 0.04 * size, 0.3 * size), 0.3, 3), mat: ember(new THREE.MeshStandardMaterial({ color: '#2e2a2e', roughness: 0.8, flatShading: true }), 0.8), w: 0.25 },
    ];
    const piles = (cue.piles as number[][]) ?? [];
    const per: THREE.Matrix4[][] = kinds.map(() => []);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    for (const [px, pz, r, n, lean = 0] of piles) {
      for (let i = 0; i < n; i++) {
        const u = rnd();
        const k = u < kinds[0].w ? 0 : u < kinds[0].w + kinds[1].w ? 1 : 2;
        const a = rnd() * Math.PI * 2;
        const d = r * Math.pow(rnd(), 0.75);
        const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
        // Heaped toward the middle.
        const heap = (1 - d / Math.max(r, 0.01)) * r * 0.25;
        const s = 0.6 + 0.9 * rnd();
        let y = ground(x, z) + heap * rnd() + 0.05 * s * size;
        if (k === 1 && rnd() < lean) {
          // A beam propped up on the heap.
          e.set(-(0.35 + 0.6 * rnd()), rnd() * Math.PI * 2, (rnd() - 0.5) * 0.4, 'YXZ');
          y += 0.45 * s * size;
        } else e.set((rnd() - 0.5) * (k === 0 ? 3 : 0.5), rnd() * Math.PI * 2, (rnd() - 0.5) * (k === 0 ? 3 : 0.35), 'YXZ');
        q.setFromEuler(e);
        sc.setScalar(s);
        per[k].push(m.compose(pos.set(x, y, z), q, sc).clone());
      }
    }
    kinds.forEach((kd, i) => {
      this.geos.push(kd.geo);
      this.mats.push(kd.mat);
      if (!per[i].length) return;
      const mesh = new THREE.InstancedMesh(kd.geo, kd.mat, per[i].length);
      per[i].forEach((mm, j) => mesh.setMatrixAt(j, mm));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    });
    // Soot and coals: a ground card per patch, following the ground at its corners.
    const ash = (cue.ash as number[][]) ?? [];
    if (ash.length) {
      this.ashMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uEmber: { value: num(cue.ember, 1) } }]),
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vW;
          #include <fog_pars_vertex>
          void main() {
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            vec4 mvPosition = viewMatrix * w;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uEmber;
          varying vec2 vUv; varying vec3 vW;
          ${NOISE}
          #include <fog_pars_fragment>
          void main() {
            vec2 q = vUv * 2.0 - 1.0;
            float edge = 1.0 - smoothstep(0.55, 1.0, max(abs(q.x), abs(q.y)) + (fbm(vW * 0.9) - 0.5) * 0.7);
            float soot = fbm(vec3(vW.xz * 0.7, 1.0));
            float a = edge * smoothstep(0.35, 0.6, soot + 0.12);
            // Coals: small hot specks in the soot, breathing.
            float c = fbm(vec3(vW.xz * 9.0, uTime * 0.15));
            float coal = smoothstep(0.7, 0.8, c) * edge * smoothstep(0.45, 0.65, soot);
            float fl = 0.75 + 0.25 * sin(uTime * 4.0 + vW.x * 3.0 + vW.z * 2.0);
            vec3 col = vec3(0.025, 0.018, 0.015) * (0.6 + 0.8 * soot) + vec3(2.4, 0.5, 0.06) * coal * fl * uEmber;
            gl_FragColor = vec4(col, clamp(a * 0.9 + coal, 0.0, 1.0));
            #include <fog_fragment>
          }`,
      });
      for (const [x, z, w, l, yaw = 0] of ash) {
        const g = new THREE.PlaneGeometry(w, l, Math.max(1, Math.round(w / 1.5)), Math.max(1, Math.round(l / 1.5)));
        g.rotateX(-Math.PI / 2);
        g.rotateY(yaw);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) p.setY(i, ground(x + p.getX(i), z + p.getZ(i)) + 0.03);
        g.translate(x, 0, z);
        this.geos.push(g);
        const mesh = new THREE.Mesh(g, this.ashMat);
        mesh.renderOrder = 2;
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
      this.mats.push(this.ashMat);
    }
    scene.add(this.group);
  }

  update(ctx: FxContext): void {
    this.uTime.value = ctx.t;
    if (this.ashMat) this.ashMat.uniforms.uTime.value = ctx.t;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

registerEffect('dusk-rubble', (cue, scene, ground) => new Rubble(cue, scene, ground));
