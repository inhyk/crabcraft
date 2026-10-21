// The mage's frost for the tribute's snow scene (snow-frost shots): a frost blast rolling along the
// ground into the lens, ice bursting out of the ground in the world's own crystal shapes and ice,
// a glowing crack running over the snow, and orbs of frost energy at a point or in a crab's claws.
//
//   snow-frost-blast  a billowing mist sheet with ice crystals tumbling in it, from `from` [x, z] to
//                     `to` [x, z] over `d` seconds (it fans out from `width0` to `width1` and its puffs
//                     grow from `size0` to `size1`, `flat` times wider than tall, centres `lift` sizes
//                     up); count, crystals,
//                     color (lit), color2 (shade), opacity, seed, envelope (until, fadeOut)
//   snow-frost-ice    crystal clusters bursting up around `at` [x, z], radius `r0`..`r1`, `count`,
//                     `height`; `gap` [yaw, half] leaves an arc open (toward the lens); `stagger`
//                     spreads the bursts, `rise` per cluster; `jut` [[t, scale]...] grows them later
//   snow-frost-crack  a glowing crack from `from` [x, z] along `yaw` for `length`, jagged, with
//                     `branches`; reaches its end `grow` seconds after t; color, width, gain
//   snow-frost-orb    frost energy: a white core in a blue halo, crackling arcs, splinters orbiting,
//                     motes drawn in and a light. At `at` (a point), or `actor` + `socket` (one claw)
//                     or `sockets` (the middle of both) + `up`. size, gain [[t, g]...], grow
//                     [[t, k]...], arcs, arcLen, arcWidth, arcColor, splinters, splinterSize, orbit,
//                     motes, reach, light, distance, color, core, flares
//                     [[t, d, k]...] (core and light swell k times, back over d), envelope
import * as THREE from 'three';
import { crystalCluster, crystalGeometry, type Crystal } from '../../../game/iceCrystals';
import { curve, envelope, glowTexture, mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);
const xz = (v: unknown, d: [number, number]): [number, number] => (Array.isArray(v) && v.length >= 2 ? [v[0] as number, v[1] as number] : d);

type Unit = { name: string; socketPos(n: string, out: THREE.Vector3): THREE.Vector3 };
function findUnit(name: unknown): Unit | null {
  const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
  return g?.units.find((u) => u.name === name) ?? null;
}

// ------------------------------------------------------------------------------------ frost blast

/** Camera-facing mist puffs: per-instance centre and size from the CPU, the billow in the shader. */
class Blast implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private iPos: THREE.InstancedBufferAttribute;
  private puffs: { lag: number; side: number; size: number; lift: number }[] = [];
  private ice: THREE.InstancedMesh;
  private bits: { lag: number; side: number; up: number; size: number; spin: THREE.Vector3; phase: number }[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    private ground: (x: number, z: number) => number,
  ) {
    const rnd = mulberry(num(cue.seed, 5) * 977 + 11);
    const count = Math.round(num(cue.count, 170));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // Dense at the rolling front, thinning back toward the source.
      this.puffs.push({ lag: rnd() ** 1.8, side: rnd() * 2 - 1, size: 0.6 + 0.8 * rnd(), lift: rnd() });
      for (let j = 0; j < 4; j++) seeds[i * 4 + j] = rnd();
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: cue.depthTest === true,
      uniforms: {
        uTime: { value: 0 },
        uC1: { value: new THREE.Color(String(cue.color ?? '#f2f6ff')) },
        uC2: { value: new THREE.Color(String(cue.color2 ?? '#8ea6dc')) },
        uA: { value: 0 },
        uFlat: { value: num(cue.flat, 1.5) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec4 iSeed; uniform float uFlat;
        varying vec2 vQ; varying vec4 vSeed; varying float vA;
        void main(){
          vQ = position.xy; vSeed = iSeed; vA = step(0.001, iPos.w);
          vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
          mv.xy += position.xy * iPos.w * vec2(uFlat, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uA; uniform vec3 uC1, uC2;
        varying vec2 vQ; varying vec4 vSeed; varying float vA;
        ${NOISE}
        void main(){
          float r = length(vQ);
          float ang = vSeed.x * 6.283 + uTime * (vSeed.y - 0.5) * 2.4;
          vec2 p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * vQ;
          float n = fbm(vec3(p * 1.7 + vSeed.zw * 9.0, uTime * 0.9 + vSeed.x * 4.0));
          float m = fbm(vec3(p * 4.3 - vSeed.wz * 5.0, uTime * 1.7 + vSeed.y * 6.0));
          // Ragged, curling edges: the blob is eaten away by two scales of noise.
          float a = smoothstep(0.95, 0.2, r + (n - 0.5) * 1.3 + (m - 0.5) * 0.55) * vA * uA * (0.4 + 0.6 * vSeed.w);
          if (a < 0.004) discard;
          // Lit from above, shaded blue underneath; the noise rolls through both.
          float lit = clamp(0.5 + 0.5 * vQ.y + (n - 0.5) * 0.9, 0.0, 1.0);
          gl_FragColor = vec4(mix(uC2, uC1, lit), a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
    // Ice crystals carried in the blast: stretched octahedra tumbling along with the front.
    const n = Math.round(num(cue.crystals, 70));
    const ig = new THREE.OctahedronGeometry(1, 0);
    ig.scale(0.32, 1, 0.32);
    const im = new THREE.MeshStandardMaterial({ color: '#e6f6ff', emissive: '#7cc4ff', emissiveIntensity: 1.4, roughness: 0.08, metalness: 0.2, flatShading: true, transparent: true, opacity: 0.92 });
    this.ice = new THREE.InstancedMesh(ig, im, n);
    this.ice.frustumCulled = false;
    // Over the mist (which draws without depth), still behind the world.
    this.ice.renderOrder = 8;
    for (let i = 0; i < n; i++) {
      this.bits.push({
        lag: rnd() ** 1.4 * 0.8,
        side: rnd() * 2 - 1,
        up: 0.08 + rnd() ** 1.6 * 1.3,
        size: 0.035 + rnd() ** 2 * 0.11,
        spin: new THREE.Vector3(rnd() * 14 - 7, rnd() * 14 - 7, rnd() * 14 - 7),
        phase: rnd() * 6.283,
      });
    }
    scene.add(this.ice);
  }

  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    const k = (ctx.t - this.cue.t) / num(this.cue.d, 0.4);
    const on = env > 0 && k > 0;
    this.mesh.visible = on;
    this.ice.visible = on;
    if (!on) return;
    const [x0, z0] = xz(this.cue.from, [0, 0]);
    const [x1, z1] = xz(this.cue.to, [0, 5]);
    const L = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / L;
    const dz = (z1 - z0) / L;
    // The front speeds up as it comes (and keeps going past the far end).
    const front = L * (k < 1 ? k ** 1.25 : 1 + (k - 1) * 1.25);
    const w0 = num(this.cue.width0, 0.6);
    const w1 = num(this.cue.width1, 5);
    const s0 = num(this.cue.size0, 0.45);
    const s1 = num(this.cue.size1, 4.2);
    const lift = num(this.cue.lift, 0.45);
    const a = this.iPos.array as Float32Array;
    this.puffs.forEach((p, i) => {
      const d = front * (1 - p.lag * 0.88);
      const f = Math.min(1.3, d / L);
      const half = w0 + (w1 - w0) * f;
      const side = p.side * half;
      const x = x0 + dx * d + dz * side;
      const z = z0 + dz * d - dx * side;
      // Smaller toward the flanks, so the sheet has no hard oval rim.
      const size = (s0 + (s1 - s0) * f) * p.size * (0.55 + 0.45 * smooth(k * 3)) * (1 - 0.45 * p.side * p.side);
      a[i * 4] = x;
      a[i * 4 + 1] = this.ground(x, z) + size * lift * (0.7 + 0.6 * p.lift);
      a[i * 4 + 2] = z;
      a[i * 4 + 3] = size;
    });
    this.iPos.needsUpdate = true;
    this.mat.uniforms.uTime.value = ctx.t;
    this.mat.uniforms.uA.value = env * num(this.cue.opacity, 0.85) * smooth(k * 8);
    this.bits.forEach((b, i) => {
      const d = front * (1 - b.lag);
      const f = Math.min(1.3, d / L);
      const side = b.side * (w0 + (w1 - w0) * f) * 0.8;
      const x = x0 + dx * d + dz * side;
      const z = z0 + dz * d - dx * side;
      this.v.set(x, this.ground(x, z) + b.up * (0.4 + f) + 0.15 * Math.sin(ctx.t * 9 + b.phase), z);
      const tt = ctx.t + b.phase;
      this.q.setFromEuler(this.e.set(b.spin.x * tt, b.spin.y * tt, b.spin.z * tt));
      const s = b.size * smooth(k * 6) * env;
      this.m4.compose(this.v, this.q, this.s.set(s, s, s));
      this.ice.setMatrixAt(i, this.m4);
    });
    this.ice.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.ice.removeFromParent();
    this.ice.geometry.dispose();
    (this.ice.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------- ice out of the ground

/**
 * Ice for the burst: lit like the world (the claws' and the orb's lights reach it), deep blue at the foot to a
 * white point, every facet its own depth, frosted rime creeping up from the snow, a cold rim and an inner glow.
 */
function frostIce(glow: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.18, metalness: 0.0, flatShading: true, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = { value: glow };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH01; attribute float aSeed; varying float vH; varying float vS; varying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = aH01; vS = aSeed; vWp = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vH; varying float vS; varying vec3 vWp; uniform float uGlow;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 fn = normalize(cross(dFdx(vWp), dFdy(vWp)));
        float facet = h31(floor(fn * 3.7) + vS);
        vec3 ice = mix(vec3(0.03, 0.1, 0.32), vec3(0.3, 0.6, 0.95), smoothstep(0.0, 0.7, vH));
        ice = mix(ice, vec3(0.85, 0.95, 1.0), smoothstep(0.75, 1.0, vH));
        ice *= (0.3 + 0.55 * facet) * (0.7 + 0.3 * vH);
        float rime = smoothstep(0.5, 0.72, fbm(vWp * 4.2 + vS) + (0.32 - vH) * 1.1);
        diffuseColor.rgb = mix(ice, vec3(0.8, 0.88, 0.95), rime * 0.8);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float ndv = abs(dot(normal, normalize(vViewPosition)));
        float veins = smoothstep(0.62, 0.7, fbm(vWp * vec3(2.0, 0.6, 2.0) + vS * 3.0));
        totalEmissiveRadiance += vec3(0.3, 0.62, 1.0) * (pow(1.0 - ndv, 3.0) * 0.55 + uGlow * 0.3 * vH * vH * (1.0 - rime) + veins * 0.35 * uGlow);`,
      );
  };
  return m;
}

class Ice implements Effect {
  private group = new THREE.Group();
  private items: { mesh: THREE.Mesh; at: number }[] = [];
  private own: THREE.Material | null = null;
  private geos: THREE.BufferGeometry[] = [];
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    const mat = frostIce(num(cue.glow, 0.6));
    this.own = mat;
    const [cx, cz] = xz(cue.at, [0, 0]);
    const r0 = num(cue.r0, 1);
    const r1 = num(cue.r1, 2);
    const count = Math.round(num(cue.count, 9));
    const height = num(cue.height, 1);
    const [gapYaw, gapHalf] = (cue.gap as [number, number]) ?? [0, 0];
    const stagger = num(cue.stagger, 0.2);
    const rnd = mulberry(num(cue.seed, 3) * 4057 + 1);
    for (let i = 0; i < count; i++) {
      // Around the ring, skipping the open arc.
      const span = Math.PI * 2 - gapHalf * 2;
      const a = gapYaw + gapHalf + span * ((i + 0.2 + 0.6 * rnd()) / count);
      const r = r0 + (r1 - r0) * rnd();
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const h = height * (0.6 + 0.6 * rnd()) * (0.75 + 0.5 * ((r - r0) / Math.max(1e-3, r1 - r0)));
      // Thin, jagged shards (`thin` < 1 slims them), several to a cluster.
      const list: Crystal[] = crystalCluster(0, 0, 0, h, h * 0.42 * num(cue.thin, 1), 3 + Math.floor(rnd() * 4), rnd);
      // Leaning away from the centre, as if thrown up by it.
      const lean = 0.25 + 0.3 * rnd();
      for (const c of list) {
        c.axis = [c.axis[0] + Math.sin(a) * lean, c.axis[1], c.axis[2] + Math.cos(a) * lean];
      }
      const geo = crystalGeometry(list);
      this.geos.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, ground(x, z) - 0.05, z);
      mesh.castShadow = true;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.items.push({ mesh, at: cue.t + stagger * rnd() });
    }
    scene.add(this.group);
  }

  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    const rise = num(this.cue.rise, 0.12);
    const jut = this.cue.jut ? curve(this.cue.jut as [number, number][], ctx.t) : 1;
    for (const it of this.items) {
      const k = (ctx.t - it.at) / rise;
      if (k <= 0 || env <= 0) {
        it.mesh.visible = false;
        continue;
      }
      // Springs up past full size and settles.
      const e = k >= 1 ? 1 : 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
      it.mesh.visible = true;
      it.mesh.scale.setScalar(Math.max(0.001, e * jut * env));
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.own?.dispose();
  }
}

// ------------------------------------------------------------------------------------- the crack

class Crack implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private reach = 1;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    const rnd = mulberry(num(cue.seed, 2) * 7349 + 3);
    const [x0, z0] = xz(cue.from, [0, 0]);
    const yaw = num(cue.yaw, 0);
    const length = num(cue.length, 4);
    const width = num(cue.width, 0.05);
    const pos: number[] = [];
    const dist: number[] = [];
    const side: number[] = [];
    /** A jagged run from (x, z) heading `a`, starting `d0` along the crack's reach. */
    const run = (x: number, z: number, a: number, len: number, d0: number, w: number, depth: number) => {
      const steps = Math.max(2, Math.round(len / 0.3));
      let px = x;
      let pz = z;
      let d = d0;
      for (let i = 0; i < steps; i++) {
        const turn = a + (rnd() - 0.5) * 1.1;
        const seg = len / steps;
        const nx = px + Math.sin(turn) * seg;
        const nz = pz + Math.cos(turn) * seg;
        const ww = w * (1 - (0.6 * i) / steps);
        // A flat quad on the snow, its cross-section -1..1 for the soft edge.
        const ox = Math.cos(turn) * ww;
        const oz = -Math.sin(turn) * ww;
        const quad: [number, number, number, number][] = [
          [px - ox, pz - oz, d, -1],
          [px + ox, pz + oz, d, 1],
          [nx + ox, nz + oz, d + seg, 1],
          [nx - ox, nz - oz, d + seg, -1],
        ];
        for (const j of [0, 1, 2, 0, 2, 3]) {
          const [qx, qz, qd, qs] = quad[j];
          pos.push(qx, ground(qx, qz) + 0.025, qz);
          dist.push(qd);
          side.push(qs);
        }
        if (depth > 0 && rnd() < num(cue.branches, 0.35)) run(nx, nz, turn + (rnd() < 0.5 ? -1 : 1) * (0.5 + 0.6 * rnd()), len * (0.25 + 0.3 * rnd()), d + seg, ww * 0.7, depth - 1);
        px = nx;
        pz = nz;
        d += seg;
        this.reach = Math.max(this.reach, d);
      }
    };
    run(x0, z0, yaw, length, 0, width, 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aD', new THREE.Float32BufferAttribute(dist, 1));
    geo.setAttribute('aS', new THREE.Float32BufferAttribute(side, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      uniforms: { uGrow: { value: 0 }, uColor: { value: new THREE.Color(String(cue.color ?? '#8fd4ff')) }, uGain: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `attribute float aD, aS; varying float vD, vS; void main(){ vD = aD; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uGrow, uGain, uTime; uniform vec3 uColor; varying float vD, vS;
        void main(){
          if (vD > uGrow) discard;
          float core = smoothstep(1.0, 0.0, abs(vS));
          float tip = smoothstep(uGrow, uGrow - 0.4, vD);
          float a = core * core * (0.6 + 0.4 * tip) * (0.85 + 0.15 * sin(uTime * 31.0 + vD * 9.0));
          gl_FragColor = vec4(uColor * uGain * a * (1.0 + 2.0 * (1.0 - tip)), a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    this.mesh.visible = env > 0;
    const k = smooth((ctx.t - this.cue.t) / num(this.cue.grow, 0.3));
    this.mat.uniforms.uGrow.value = k * (this.reach + 0.5);
    this.mat.uniforms.uGain.value = num(this.cue.gain, 3) * env;
    this.mat.uniforms.uTime.value = ctx.t;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// --------------------------------------------------------------------------------- frost energy

class Orb implements Effect {
  private group = new THREE.Group();
  private core: THREE.Sprite;
  private halo: THREE.Sprite;
  private light: THREE.PointLight;
  private arcGeo = new THREE.BufferGeometry();
  private arcPos: Float32Array;
  private arcMat: THREE.MeshBasicMaterial;
  private arcs: THREE.Mesh;
  private shards: THREE.InstancedMesh | null = null;
  private orbit: { r: number; e1: THREE.Vector3; e2: THREE.Vector3; w: number; ph: number; s: number }[] = [];
  private motes: THREE.Points | null = null;
  private moteSeeds: { dir: THREE.Vector3; ph: number; rate: number }[] = [];
  private unit: Unit | null = null;
  private c = new THREE.Vector3();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private seg = 7;
  constructor(private cue: FxCue, scene: THREE.Scene) {
    const color = String(cue.color ?? '#8fd0ff');
    const tex = glowTexture();
    const sprite = (c: THREE.Color) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    this.core = sprite(hdr(String(cue.core ?? '#ffffff'), 3.2));
    this.halo = sprite(hdr(color, 1.6));
    this.core.renderOrder = 9;
    this.halo.renderOrder = 8;
    this.group.add(this.halo, this.core);
    this.light = new THREE.PointLight(color, 0, num(cue.distance, 6), 1.6);
    this.group.add(this.light);
    const arcs = Math.round(num(cue.arcs, 7));
    this.arcPos = new Float32Array(arcs * this.seg * 6 * 3);
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    this.arcMat = new THREE.MeshBasicMaterial({ color: hdr(String(cue.arcColor ?? '#c4e6ff'), 3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.arcs = new THREE.Mesh(this.arcGeo, this.arcMat);
    this.arcs.frustumCulled = false;
    this.arcs.renderOrder = 9;
    scene.add(this.arcs);
    const rnd = mulberry(num(cue.seed, 4) * 3331 + 9);
    const n = Math.round(num(cue.splinters, 0));
    if (n > 0) {
      const g = new THREE.OctahedronGeometry(1, 0);
      g.scale(0.28, 1, 0.28);
      this.shards = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: hdr('#cdeeff', 1.8), toneMapped: false, transparent: true, opacity: 0.95 }), n);
      this.shards.frustumCulled = false;
      this.shards.renderOrder = 8;
      for (let i = 0; i < n; i++) {
        const nrm = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        const e1 = new THREE.Vector3(0, 1, 0).cross(nrm).normalize();
        if (e1.lengthSq() < 1e-4) e1.set(1, 0, 0);
        const e2 = nrm.clone().cross(e1).normalize();
        this.orbit.push({ r: 0.7 + 0.6 * rnd(), e1, e2, w: (rnd() < 0.5 ? -1 : 1) * (4 + 5 * rnd()), ph: rnd() * 6.283, s: 0.5 + 0.7 * rnd() });
      }
      this.group.add(this.shards);
    }
    const m = Math.round(num(cue.motes, 0));
    if (m > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 3), 3));
      geo.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(m), 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 500 }, uSize: { value: 0.03 }, uColor: { value: hdr(color, 2.5) } },
        vertexShader: /* glsl */ `attribute float aA; uniform float uScale, uSize; varying float vA;
          void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * uScale / max(0.2, -mv.z); }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA;
          void main(){ float a = pow(max(0.0, 1.0 - length(gl_PointCoord * 2.0 - 1.0)), 2.0) * vA; if (a < 0.01) discard; gl_FragColor = vec4(uColor * a, a); }`,
      });
      this.motes = new THREE.Points(geo, mat);
      this.motes.frustumCulled = false;
      this.motes.renderOrder = 9;
      for (let i = 0; i < m; i++) this.moteSeeds.push({ dir: new THREE.Vector3(rnd() - 0.5, rnd() - 0.4, rnd() - 0.5).normalize(), ph: rnd(), rate: 1.4 + rnd() * 1.2 });
      scene.add(this.motes);
    }
    scene.add(this.group);
  }

  private centre(ctx: FxContext): THREE.Vector3 {
    const cue = this.cue;
    if (cue.actor) {
      this.unit ??= findUnit(cue.actor);
      const u = this.unit;
      if (u) {
        const ss = (cue.sockets as string[]) ?? [String(cue.socket ?? 'clawR')];
        this.c.set(0, 0, 0);
        for (const s of ss) this.c.add(u.socketPos(s, this.v));
        this.c.multiplyScalar(1 / ss.length);
        this.c.y += num(cue.up, 0);
        return this.c;
      }
    }
    return this.c.copy(ctx.point(cue.at ?? [0, 0, 0]));
  }

  update(ctx: FxContext): void {
    const cue = this.cue;
    const t = ctx.t;
    const env = envelope(cue, t) * (cue.gain ? curve(cue.gain as [number, number][], t) : 1);
    const on = env > 0.001;
    this.group.visible = on;
    this.arcs.visible = on;
    if (this.motes) this.motes.visible = on;
    if (!on) {
      this.light.intensity = 0;
      return;
    }
    let flare = 1;
    for (const [ft, fd, fk] of (cue.flares as [number, number, number][]) ?? []) {
      const k = t - ft;
      if (k > -0.05 && k < fd) flare = Math.max(flare, 1 + (fk - 1) * (k < 0 ? 1 + k / 0.05 : (1 - k / fd) ** 2));
    }
    const size = num(cue.size, 0.12) * (cue.grow ? curve(cue.grow as [number, number][], t) : 1);
    const c = this.centre(ctx);
    this.group.position.copy(c);
    const flick = 1 + 0.12 * Math.sin(t * 47) + 0.08 * Math.sin(t * 73 + 1.3);
    this.core.scale.setScalar(size * 2.6 * flick * Math.sqrt(flare) * Math.min(1, env * 1.5));
    this.halo.scale.setScalar(size * 9 * Math.sqrt(flare) * (0.9 + 0.1 * flick));
    (this.core.material as THREE.SpriteMaterial).opacity = Math.min(1, env);
    (this.halo.material as THREE.SpriteMaterial).opacity = Math.min(1, env * 0.8);
    this.light.intensity = num(cue.light, 20) * env * flare * flick;
    // Arcs: jagged ribbons out of the core, re-struck every frame-and-a-bit.
    const rnd = mulberry(Math.floor(t * 30) * 131 + num(cue.seed, 4));
    const cam = ctx.camera.position;
    const len = size * num(cue.arcLen, 4.5) * Math.sqrt(flare);
    const wid = size * num(cue.arcWidth, 0.1);
    const p = this.arcPos;
    let o = 0;
    const arcs = p.length / (this.seg * 18);
    for (let i = 0; i < arcs; i++) {
      const dir = this.w.set(rnd() - 0.5, rnd() - 0.35, rnd() - 0.5).normalize();
      const live = rnd() < 0.75 * Math.min(1, env * 1.4);
      let ax = c.x + dir.x * size * 0.5;
      let ay = c.y + dir.y * size * 0.5;
      let az = c.z + dir.z * size * 0.5;
      const l = len * (0.45 + 0.55 * rnd());
      for (let s = 0; s < this.seg; s++) {
        const st = l / this.seg;
        const bx = ax + (dir.x + (rnd() - 0.5) * 1.3) * st;
        const by = ay + (dir.y + (rnd() - 0.5) * 1.3) * st;
        const bz = az + (dir.z + (rnd() - 0.5) * 1.3) * st;
        // Side vector: across the segment, facing the camera, thinning to the tip.
        const vx = cam.x - ax;
        const vy = cam.y - ay;
        const vz = cam.z - az;
        let nx = (by - ay) * vz - (bz - az) * vy;
        let ny = (bz - az) * vx - (bx - ax) * vz;
        let nz = (bx - ax) * vy - (by - ay) * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const ww = live ? (wid * (1 - s / this.seg)) / nl : 0;
        nx *= ww;
        ny *= ww;
        nz *= ww;
        const quad = [ax - nx, ay - ny, az - nz, ax + nx, ay + ny, az + nz, bx + nx, by + ny, bz + nz, bx - nx, by - ny, bz - nz];
        for (const j of [0, 1, 2, 0, 2, 3]) {
          p[o++] = quad[j * 3];
          p[o++] = quad[j * 3 + 1];
          p[o++] = quad[j * 3 + 2];
        }
        ax = bx;
        ay = by;
        az = bz;
      }
    }
    (this.arcGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.arcMat.opacity = Math.min(1, env);
    if (this.shards) {
      const R = size * num(cue.orbit, 4.5);
      this.orbit.forEach((s, i) => {
        const a = s.ph + t * s.w;
        const r = R * s.r;
        this.v.copy(s.e1).multiplyScalar(Math.cos(a) * r).addScaledVector(s.e2, Math.sin(a) * r);
        // Pointing along its travel.
        this.w.copy(s.e1).multiplyScalar(-Math.sin(a)).addScaledVector(s.e2, Math.cos(a)).normalize();
        this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.w);
        const k = size * num(cue.splinterSize, 0.8) * s.s * Math.min(1, env * 1.3);
        this.m4.compose(this.v, this.q, new THREE.Vector3(k, k, k));
        this.shards!.setMatrixAt(i, this.m4);
      });
      this.shards.instanceMatrix.needsUpdate = true;
    }
    if (this.motes) {
      const pa = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      const aa = this.motes.geometry.attributes.aA as THREE.BufferAttribute;
      const R = size * num(cue.reach, 9);
      this.moteSeeds.forEach((m, i) => {
        const ph = (t * m.rate + m.ph) % 1;
        const r = R * (1 - ph) ** 1.6;
        pa.setXYZ(i, c.x + m.dir.x * r, c.y + m.dir.y * r, c.z + m.dir.z * r);
        aa.setX(i, Math.min(1, env) * smooth(ph * 4) * (1 - smooth((ph - 0.85) * 6.6)));
      });
      pa.needsUpdate = true;
      aa.needsUpdate = true;
      const mm = this.motes.material as THREE.ShaderMaterial;
      mm.uniforms.uScale.value = ctx.pxPerUnit;
      mm.uniforms.uSize.value = size * 0.3;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.core.material.dispose();
    this.halo.material.dispose();
    this.light.dispose();
    this.arcs.removeFromParent();
    this.arcGeo.dispose();
    this.arcMat.dispose();
    if (this.shards) {
      this.shards.geometry.dispose();
      (this.shards.material as THREE.Material).dispose();
    }
    if (this.motes) {
      this.motes.removeFromParent();
      this.motes.geometry.dispose();
      (this.motes.material as THREE.Material).dispose();
    }
  }
}

// ----------------------------------------------------------------------------- the throne's sigil

/**
 * Folds away the lit glass inside `box` [x0, y0, z0, x1, y1, z1] of the world's aurora glass (the
 * throne's snowflake sigil reads as an icon behind him); the glass comes back on dispose.
 */
class Unsigil implements Effect {
  private attr: THREE.BufferAttribute | null = null;
  private saved: Float32Array | null = null;
  constructor(cue: FxCue, scene: THREE.Scene) {
    const m = scene.getObjectByName(String(cue.mesh ?? 'frostlight-aurora-glass')) as THREE.Mesh | undefined;
    const attr = m?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!m || !attr || m.geometry.index) return;
    const [x0, y0, z0, x1, y1, z1] = (cue.box as number[]) ?? [0, 0, 0, 0, 0, 0];
    m.updateMatrixWorld(true);
    const a = attr.array as Float32Array;
    this.saved = a.slice();
    const c = new THREE.Vector3();
    for (let i = 0; i < attr.count; i += 3) {
      c.set(0, 0, 0);
      for (let j = 0; j < 3; j++) c.add(new THREE.Vector3(a[(i + j) * 3], a[(i + j) * 3 + 1], a[(i + j) * 3 + 2]));
      c.multiplyScalar(1 / 3).applyMatrix4(m.matrixWorld);
      if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1 || c.z < z0 || c.z > z1) continue;
      for (let j = 1; j < 3; j++) for (let k = 0; k < 3; k++) a[(i + j) * 3 + k] = a[i * 3 + k];
    }
    attr.needsUpdate = true;
    this.attr = attr;
  }
  update(): void {}
  dispose(): void {
    if (!this.attr || !this.saved) return;
    (this.attr.array as Float32Array).set(this.saved);
    this.attr.needsUpdate = true;
  }
}

registerEffect('snow-frost-blast', (cue, scene, ground) => new Blast(cue, scene, ground));
registerEffect('snow-frost-ice', (cue, scene, ground) => new Ice(cue, scene, ground));
registerEffect('snow-frost-crack', (cue, scene, ground) => new Crack(cue, scene, ground));
registerEffect('snow-frost-orb', (cue, scene) => new Orb(cue, scene));
registerEffect('snow-frost-unsigil', (cue, scene) => new Unsigil(cue, scene));
