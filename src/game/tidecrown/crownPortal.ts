// The capital's gateway: the shape of the worlds' star portals (a stepped dais, a ring of voussoirs, two rings of light
// and a swirling veil) in Tidecrown's limestone and gold, its rings and runes the Seaglass Quarter's teal and violet
// glass, a gold crown on the keystone. One mesh per material and no light of its own, so it costs a handful of draws
// and changes no world's light count.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ARCH = { r: 3.25, rise: 4.1, base: 1.15 } as const;
const RING_Y = 3.25, STRETCH = 1.27;
/** Just above the keystone's top (base + rise + its 0.72 proud edge). */
const CROWN_Y = ARCH.base + ARCH.rise + 0.95;

/** One part placed in the portal's frame, flattened so every family merges into a single geometry. */
function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0, ry = 0, tint?: THREE.Color): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(1, 1, 1));
  const out = (g.index ? g.toNonIndexed() : g).applyMatrix4(m);
  out.deleteAttribute('uv');
  const c = tint ?? new THREE.Color(1, 1, 1), n = out.attributes.position.count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return out;
}

export class CrownPortal {
  readonly root = new THREE.Group();
  private readonly inner: THREE.Mesh;
  private readonly motes: THREE.Points;
  private readonly veil: THREE.ShaderMaterial;
  private readonly crown: THREE.Group;

  constructor(position: THREE.Vector3, yaw: number, label: string, scale = 1) {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
    this.root.scale.setScalar(scale);
    this.root.name = label;
    const stone: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], teal: THREE.BufferGeometry[] = [], violet: THREE.BufferGeometry[] = [];
    // Warm limestone with a little variation from block to block, so the courses read as cut stone.
    const lime = (k: number) => new THREE.Color('#efe6d2').multiplyScalar(0.86 + 0.14 * Math.abs(Math.sin(k * 12.9898) * 43758.5453 % 1));
    // Dais: three steps, the top one ringed in gold, a seaglass inlay in its floor.
    for (let i = 0; i < 3; i++) stone.push(placed(new THREE.CylinderGeometry(3.8 - i * 0.35, 4 - i * 0.35, 0.22, 56), 0, 0.11 + i * 0.2, 0, 0, 0, lime(i)));
    gold.push(placed(new THREE.TorusGeometry(3.12, 0.06, 6, 72).rotateX(Math.PI / 2), 0, 0.62, 0));
    teal.push(placed(new THREE.RingGeometry(1.7, 1.95, 64, 1).rotateX(-Math.PI / 2), 0, 0.64, 0));
    // The arch: thirteen cut voussoirs on the star portals' ellipse with open joints and a glass rune on each face; the
    // keystone stands proud and carries the crown. A gold line runs round each face's outer edge.
    const at = (a: number, off: number) => new THREE.Vector2(Math.cos(a) * (ARCH.r + off), ARCH.base + Math.sin(a) * (ARCH.rise + off));
    const N = 13, joint = 0.012;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI + joint, a1 = ((i + 1) / N) * Math.PI - joint, key = i === (N - 1) / 2, depth = key ? 1.0 : 0.84;
      const outline: THREE.Vector2[] = [];
      for (let k = 0; k <= 3; k++) outline.push(at(a0 + ((a1 - a0) * k) / 3, -0.5));
      for (let k = 3; k >= 0; k--) outline.push(at(a0 + ((a1 - a0) * k) / 3, key ? 0.72 : 0.5));
      const block = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth, steps: 1, curveSegments: 1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
      stone.push(placed(block.translate(0, 0, -depth / 2), 0, 0, 0, 0, 0, lime(i + 5)));
      const m = at((a0 + a1) / 2, key ? 0.1 : 0), rz = (a0 + a1) / 2 - Math.PI / 2;
      for (const s of [1, -1]) (i % 2 ? teal : violet).push(placed(new THREE.OctahedronGeometry(key ? 0.22 : 0.15), m.x, m.y, s * (depth / 2 + 0.07), rz));
    }
    for (const s of [1, -1]) {
      const trim = new THREE.TorusGeometry(ARCH.r + 0.5, 0.045, 5, 64, Math.PI).scale(1, (ARCH.rise + 0.5) / (ARCH.r + 0.5), 1);
      gold.push(placed(trim, 0, ARCH.base, s * 0.47));
    }
    // Piers under the springing: a limestone plinth on the dais and a gold cap the arch stands on.
    for (const side of [-1, 1]) {
      stone.push(placed(new THREE.CylinderGeometry(0.62, 0.72, 0.56, 12), side * ARCH.r, 0.9, 0, 0, 0, lime(side + 20)));
      gold.push(placed(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 12), side * ARCH.r, 1.17, 0));
    }
    // The rings of light: violet seaglass outside, teal within, both drawn tall like the star portals'.
    violet.push(placed(new THREE.TorusGeometry(2.8, 0.085, 8, 96).scale(1, STRETCH, 1), 0, RING_Y, 0));
    const innerGeo = placed(new THREE.TorusGeometry(2.55, 0.05, 6, 96).scale(1, STRETCH, 1), 0, 0, 0);
    // A crown on the keystone: a gold band of five points round a teal gem, turning slowly.
    const crownGold: THREE.BufferGeometry[] = [placed(new THREE.CylinderGeometry(0.42, 0.36, 0.26, 20, 1, true), 0, 0, 0)];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      crownGold.push(placed(new THREE.ConeGeometry(0.1, 0.34, 6), Math.cos(a) * 0.38, 0.29, Math.sin(a) * 0.38));
      crownGold.push(placed(new THREE.SphereGeometry(0.055, 8, 6), Math.cos(a) * 0.38, 0.48, Math.sin(a) * 0.38));
    }
    const gem = placed(new THREE.OctahedronGeometry(0.2), 0, 0.12, 0);
    const mats = {
      stone: new THREE.MeshStandardMaterial({ name: 'TC_PortalStone', color: '#ffffff', vertexColors: true, roughness: 0.82, metalness: 0.04 }),
      gold: new THREE.MeshStandardMaterial({ name: 'TC_PortalGold', color: '#d6ad52', vertexColors: true, roughness: 0.32, metalness: 0.85 }),
      teal: new THREE.MeshStandardMaterial({ name: 'TC_PortalTeal', color: '#8ff7ee', vertexColors: true, emissive: '#1fb3bd', emissiveIntensity: 1.7, roughness: 0.18, metalness: 0.3 }),
      violet: new THREE.MeshStandardMaterial({ name: 'TC_PortalViolet', color: '#d9c0ff', vertexColors: true, emissive: '#7a4cf5', emissiveIntensity: 1.8, roughness: 0.18, metalness: 0.3 }),
    };
    const mesh = (list: THREE.BufferGeometry[], m: THREE.Material, shadow: boolean, name: string) => {
      const o = new THREE.Mesh(mergeGeometries(list, false)!, m);
      o.name = name;
      o.castShadow = shadow;
      o.receiveShadow = true;
      for (const g of list) g.dispose();
      return o;
    };
    this.root.add(mesh(stone, mats.stone, true, 'crown-portal-stone'), mesh(gold, mats.gold, true, 'crown-portal-gold'), mesh(teal, mats.teal, false, 'crown-portal-teal'), mesh(violet, mats.violet, false, 'crown-portal-violet'));
    this.inner = new THREE.Mesh(innerGeo, mats.teal);
    this.inner.position.y = RING_Y;
    this.root.add(this.inner);
    this.crown = new THREE.Group();
    this.crown.position.set(0, CROWN_Y, 0);
    this.crown.add(mesh(crownGold, mats.gold, true, 'crown-portal-crown'), new THREE.Mesh(gem, mats.teal));
    this.root.add(this.crown);
    // The veil: a slow swirl of the quarter's two glass colours, brightest toward the rim.
    this.veil = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec2 v;uniform float time;void main(){vec2 p=(v-.5)*2.;float r=length(p);float swirl=sin(atan(p.y,p.x)*5.+r*12.-time*1.2);float edge=smoothstep(1.,.45,r);vec3 c=mix(vec3(.12,.66,.7),vec3(.48,.3,.96),swirl*.5+.5);gl_FragColor=vec4(c,(.1+.08*swirl+.12*smoothstep(.55,.95,r))*edge);}',
    });
    const veil = new THREE.Mesh(new THREE.CircleGeometry(2.5, 64), this.veil);
    veil.position.y = RING_Y;
    veil.scale.y = STRETCH;
    veil.name = 'crown-portal-veil';
    this.root.add(veil);
    const n = 64, coords = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, r = 2.6 + Math.sin(i * 8.3) * 0.45;
      coords.set([Math.cos(a) * r, RING_Y + Math.sin(a) * r * STRETCH, Math.sin(i * 3.7) * 0.7], i * 3);
    }
    const dust = new THREE.BufferGeometry();
    dust.setAttribute('position', new THREE.BufferAttribute(coords, 3));
    this.motes = new THREE.Points(dust, new THREE.PointsMaterial({ color: '#c9fff8', size: 0.07, transparent: true, opacity: 0.85, depthWrite: false }));
    this.root.add(this.motes);
  }

  update(time: number): void {
    this.inner.rotation.y = Math.sin(time * 0.3) * 0.15;
    this.motes.rotation.y = time * 0.06;
    this.crown.rotation.y = time * 0.4;
    this.crown.position.y = CROWN_Y + Math.sin(time * 1.4) * 0.05;
    this.veil.uniforms.time.value = time;
  }

  dispose(): void {
    const mats = new Set<THREE.Material>();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      m.geometry.dispose();
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
    });
    for (const m of mats) m.dispose();
  }
}
