// Fur costumes for the cast (src/capture/cinema/fur): every hair drawn, rooted on the crab's own shell and
// limbs, riding its bones, blown by the shot's wind, with snow caked on the tips and ice crystals that
// glint. Plus the lens controls the macro shots need.
//
//   fur   { actor, outfit ('dwarf' | 'beast'), density (1), wind [x, y, z] (the snow's drift, world units
//           a second), blow (0.3: tip sway as a share of the hair's length at full gust), flutter (0.06:
//           the tips' own flick), swing (0.3: each lock's own sway, as a share of the gust),
//           wave (0.22: gust wavelength along the coat, metres of the rig), hz (2.2: gust rate),
//           lodPx (650: the actor's screen height in drawing-buffer pixels below which strands thin out),
//           key { dir [left, up, ahead] (toward the light in the actor's own frame; default the groom's
//           KEY, which the coat's shadow is cast from), color, k [[t, gain]...] or gain },
//           rim { dir [x, y, z] (camera space: x right, y up, z at the lens), color, k or gain }: lights
//           for the fur alone (a rim from behind makes it glow), led (gain or [[t, gain]...] on the
//           LED face's brightness, so a macro reads the fur and not the glare), inertia (0.25: how far
//           the tips swing back when the actor speeds up, per unit/s^2), fill (gain or [[t, gain]...]
//           on the sky and ambient light the fur takes, 1 = the scene's, lower to let the key shape it) }
//           shadow (false to go without the deep opacity map; or { res (2048), k (2.5: how dark a hair's
//           shade is per hair in front of it), at (a point the map is centred on; default the whole
//           coat), radius (world units round it, or [[t, units]...]) }: the coat's shadow from its key,
//           drawn every frame
//   focus { at (a point; default: the camera's own focus), range [[t, units]...], dist [[t, units]...] }
//           overrides the depth of field's focus each frame (racks within a shot)
//   lens  { near (camera near plane while the cue runs), until }
import * as THREE from 'three';
import { curve, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import type { Unit } from '../../../game/unit';
import type { JumperRig } from '../../../crab/rig';
import type { PartClass } from '../../../crab/template';
import { KEY, SHELL_C, SHELL_R, groom, type RigParts, type StrandSet } from '../fur/groom';
import { FurShadow } from '../fur/shadow';
import { BRAIDS, BRAID_LEN, BRAID_RING, OUTFITS, OUTFIT_HIDES, braidAxis } from '../fur/outfits';
import { bitsGeometry, bitsMaterial, hairMaterial, ribbon, strandUniforms } from '../fur/shader';

interface Engine {
  renderer: THREE.WebGLRenderer;
  setFocus(d: number, r?: number): void;
  dof: { cocMaterial: { worldFocusDistance: number } } | null;
}

function game(): { units: Unit[]; engine: Engine } | null {
  return (window as unknown as { app?: { current?: { game?: { units: Unit[]; engine: Engine } } } }).app?.current?.game ?? null;
}

function actorUnit(id: unknown): Unit | null {
  const us = game()?.units ?? [];
  for (let i = us.length - 1; i >= 0; i--) if (us[i].name === id) return us[i];
  return null;
}

function rigParts(rig: JumperRig): RigParts | null {
  const r = rig as unknown as { parts: Map<PartClass, THREE.SkinnedMesh>; template: { links: { name: string }[]; boneLinks: number[] } };
  if (!r.parts?.size) return null;
  return {
    meshes: r.parts,
    linkOfBone: r.template.boneLinks.map((li) => r.template.links[li].name),
    boneInverses: rig.skeleton.boneInverses,
  };
}

/** Grown once per outfit and density: every crab of the template shares the same skinned geometry. */
const groomed = new Map<string, { sets: StrandSet[]; sphere: THREE.Sphere; ribbons: THREE.InstancedBufferGeometry[]; bits: (THREE.InstancedBufferGeometry | null)[] }>();

function outfitSets(outfit: string, density: number, parts: RigParts) {
  const key = `${outfit}:${density}`;
  let g = groomed.get(key);
  if (!g) {
    const t0 = performance.now();
    const { sets, sphere } = groom(parts, OUTFITS[outfit] ?? [], outfit === 'beast' ? 2 : 1, density);
    g = {
      sets,
      sphere,
      ribbons: sets.map((s) => ribbon(s.layer.seg, s.count)),
      bits: sets.map((s) => (s.bits ? bitsGeometry(s.bits.strand, s.bits.at, s.bits.size, s.bits.spin, s.bits.shape) : null)),
    };
    groomed.set(key, g);
    const n = sets.reduce((a, s) => a + s.count, 0);
    console.info(`[fur] ${outfit}: ${n} strands in ${sets.length} sets, ${(performance.now() - t0).toFixed(0)} ms`);
  }
  return g;
}

interface Drawn {
  set: StrandSet;
  u: Record<string, THREE.IUniform>;
  hair: THREE.Mesh;
  bits: THREE.Mesh | null;
  bone: THREE.Object3D;
}

const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const P = new THREE.Vector3();

class Fur implements Effect {
  private drawn: Drawn[] = [];
  private beads: THREE.Mesh[] = [];
  /** Gear the costume replaces (OUTFIT_HIDES), shown again on dispose. */
  private hid: THREE.Object3D[] = [];
  private unit: Unit | null = null;
  private last = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private acc = new THREE.Vector3();
  private led: number | null = null;
  private lastT = NaN;
  private shadow: FurShadow | null = null;
  /** The coat's bounding sphere in bind space. */
  private sphere = new THREE.Sphere();
  constructor(private cue: FxCue) {}

  private attach(): boolean {
    const u = actorUnit(this.cue.actor);
    if (!u) return false;
    const rig = u.rig as JumperRig;
    const parts = rigParts(rig);
    if (!parts) return false;
    const outfit = String(this.cue.outfit ?? 'dwarf');
    const g = outfitSets(outfit, num(this.cue.density, 1), parts);
    this.sphere.copy(g.sphere);
    const sh = this.cue.shadow as { res?: number } | false | undefined;
    if (sh !== false) {
      this.shadow = new FurShadow(num(sh?.res, 2048));
      this.shadow.addShell(rig.bones[0], parts.boneInverses[0], SHELL_C, SHELL_R.clone().multiplyScalar(0.97));
    }
    g.sets.forEach((set, i) => {
      const u = strandUniforms(set.tex, set.stride, set.layer.points);
      const hairMat = hairMaterial(u, set.layer.look);
      if (this.shadow) Object.assign(hairMat.uniforms, this.shadow.uniforms);
      const hair = new THREE.Mesh(g.ribbons[i], hairMat);
      hair.name = `fur:${set.layer.name}`;
      hair.frustumCulled = false;
      hair.castShadow = false;
      hair.receiveShadow = false;
      const bone = rig.bones[set.bone];
      bone.add(hair);
      let bits: THREE.Mesh | null = null;
      if (g.bits[i]) {
        const bitsMat = bitsMaterial(u, 6);
        if (this.shadow) Object.assign(bitsMat.uniforms, this.shadow.uniforms);
        bits = new THREE.Mesh(g.bits[i]!, bitsMat);
        bits.name = `fur-snow:${set.layer.name}`;
        bits.frustumCulled = false;
        bone.add(bits);
      }
      this.shadow?.addHair(hair, u, hairMat);
      if (bits) this.shadow?.addBits(bits, u);
      this.drawn.push({ set, u, hair, bits, bone });
    });
    if (outfit === 'dwarf') {
      // Iron rings with a brass band closing the braids.
      const iron = new THREE.MeshStandardMaterial({ color: '#5b5f66', metalness: 0.9, roughness: 0.32 });
      const brass = new THREE.MeshStandardMaterial({ color: '#b58a3c', metalness: 0.95, roughness: 0.28 });
      for (let k = 0; k < BRAIDS.length; k++) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.0075, 20, 1, true), iron);
        iron.side = THREE.DoubleSide;
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.0035, 0.0007, 8, 24), brass);
        band.rotation.x = Math.PI / 2;
        const top = band.clone();
        band.position.y = -0.0026;
        top.position.y = 0.0026;
        ring.add(band, top);
        ring.name = 'fur:braid-ring';
        rig.bones[0].add(ring);
        this.beads.push(ring);
      }
    }
    this.unit = u;
    this.last.copy(u.pos);
    return true;
  }

  update(ctx: FxContext): void {
    if (!this.unit && !this.attach()) return;
    const u = this.unit!;
    const rig = u.rig as JumperRig;
    const visible = !u.hidden && rig.root.visible;
    const hides = OUTFIT_HIDES[String(this.cue.outfit)] ?? [];
    if (hides.length) {
      for (const o of rig.gearMeshes) {
        if (hides.includes(o.name) && o.visible) {
          o.visible = false;
          this.hid.push(o);
        }
      }
    }
    // Wind felt by the coat: the storm's, less the actor's own run.
    const dt = ctx.t - this.lastT;
    if (dt > 0 && dt < 0.2) {
      const v0 = this.vel.clone();
      this.vel.lerp(P.copy(u.pos).sub(this.last).divideScalar(dt), Math.min(1, dt * 8));
      this.acc.lerp(v0.sub(this.vel).divideScalar(-dt), Math.min(1, dt * 6));
    } else if (!(dt > 0)) {
      this.vel.set(0, 0, 0);
      this.acc.set(0, 0, 0);
    }
    this.lastT = ctx.t;
    this.last.copy(u.pos);
    const w = (this.cue.wind as number[]) ?? [2, -1, 3];
    // Speeding up leaves the tips behind; stopping swings them on ahead.
    const air = new THREE.Vector3(w[0], w[1] * 0.3, w[2]).sub(this.vel).addScaledVector(this.acc, -num(this.cue.inertia, 0.25));
    const speed = air.length();
    const blow = num(this.cue.blow, 0.3) * Math.min(1.8, Math.max(0.35, speed / 7));
    const dirW = speed > 1e-3 ? air.divideScalar(speed) : new THREE.Vector3(1, 0, 0);
    // Level of detail from the actor's size on screen.
    const dist = Math.max(0.05, ctx.camera.position.distanceTo(P.copy(u.pos).setY(u.pos.y + u.height * 0.5)));
    const px = (u.height * ctx.pxPerUnit) / dist;
    const density = Math.min(1, Math.max(0.12, px / num(this.cue.lodPx, 650)));
    const wave = num(this.cue.wave, 0.22);
    type Lamp = { dir?: number[]; color?: string; k?: [number, number][]; gain?: number } | undefined;
    const lampColor = (l: Lamp, col: THREE.Color) => col.set(l?.color ?? '#ffffff').multiplyScalar(l ? (l.k ? curve(l.k, ctx.t) : num(l.gain, 1)) : 0);
    // The key in the actor's frame, turned with its body into camera space.
    const key = this.cue.key as Lamp;
    rig.bones[0].getWorldQuaternion(Q);
    const keyWorld = new THREE.Vector3().fromArray(key?.dir ?? KEY).normalize().applyQuaternion(Q);
    const keyView = keyWorld.clone().transformDirection(ctx.camera.matrixWorldInverse);
    const rim = this.cue.rim as Lamp;
    const rimView = new THREE.Vector3().fromArray(rim?.dir ?? [0, 0, -1]).normalize();
    // The LED face, dimmed or brightened (restored on dispose).
    const face = rig.face as unknown as { intensity: number };
    if (this.cue.led !== undefined) {
      if (this.led === null) this.led = face.intensity;
      face.intensity = Array.isArray(this.cue.led) ? curve(this.cue.led as [number, number][], ctx.t) : num(this.cue.led, 1);
    }
    for (const d of this.drawn) {
      d.hair.visible = visible;
      if (d.bits) d.bits.visible = visible;
      if (!visible) continue;
      d.bone.updateWorldMatrix(true, false);
      d.bone.matrixWorld.decompose(P, Q, S);
      const local = dirW.clone().applyQuaternion(Q.invert()).normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(Q);
      const U = d.u;
      U.uTime.value = ctx.t;
      (U.uWind.value as THREE.Vector3).copy(local).multiplyScalar(blow);
      (U.uWindK.value as THREE.Vector3).copy(local).multiplyScalar((Math.PI * 2) / wave);
      U.uWaveSpeed.value = Math.PI * 2 * num(this.cue.hz, 2.2);
      U.uGust.value = 1;
      U.uFlutter.value = num(this.cue.flutter, 0.06) * Math.min(1.6, speed / 7);
      U.uSwing.value = num(this.cue.swing, 0.3);
      (U.uFlutterDir.value as THREE.Vector3).crossVectors(local, up).normalize();
      U.uScale.value = S.x;
      U.uPxSize.value = 1 / ctx.pxPerUnit;
      U.uDensity.value = density;
      (U.uKeyDir.value as THREE.Vector3).copy(keyView);
      lampColor(key, U.uKeyCol.value as THREE.Color);
      (U.uRimDir.value as THREE.Vector3).copy(rimView);
      lampColor(rim, U.uRimCol.value as THREE.Color);
      U.uFill.value = Array.isArray(this.cue.fill) ? curve(this.cue.fill as [number, number][], ctx.t) : num(this.cue.fill, 1);
      (d.hair.material as THREE.ShaderMaterial).uniforms.uWidthMul.value = Math.min(2.5, 1 / Math.sqrt(density));
    }
    const engine = game()?.engine;
    if (this.shadow && visible && engine) {
      // The map over the whole coat, or over a part of it a macro is on (finer texels there).
      const sh = (this.cue.shadow ?? {}) as { k?: number; at?: unknown; radius?: number | [number, number][] };
      const bone0 = rig.bones[0];
      bone0.updateWorldMatrix(true, false);
      const scale = new THREE.Vector3().setFromMatrixScale(bone0.matrixWorld).x;
      const toWorld = bone0.matrixWorld.clone().multiply(rigParts(rig)!.boneInverses[0]);
      const centre = sh.at ? ctx.point(sh.at) : this.sphere.center.clone().applyMatrix4(toWorld);
      const radius = Array.isArray(sh.radius) ? curve(sh.radius, ctx.t) : num(sh.radius, this.sphere.radius * scale * 1.05);
      this.shadow.render(engine.renderer, keyWorld, centre, radius, scale, num(sh.k, 2.5));
    }
    // The braid rings ride the braids' sway (the shader's wind at the ring, its random terms at their mean).
    const base = this.drawn.find((d) => d.set.layer.name === 'braids');
    this.beads.forEach((ring, k) => {
      ring.visible = visible && !!base;
      if (!base || !visible) return;
      const U = base.u;
      const b = BRAIDS[k];
      const inv = rigParts(rig)!.boneInverses[0];
      const root = b.root.clone().applyMatrix4(inv);
      const at = braidAxis(b.root, b.side, BRAID_RING).applyMatrix4(inv);
      const below = braidAxis(b.root, b.side, BRAID_RING + 0.05).applyMatrix4(inv);
      const ph = root.dot(U.uWindK.value as THREE.Vector3) - ctx.t * U.uWaveSpeed.value;
      const gust = U.uGust.value * (0.5 + 0.2 * Math.sin(ph) + 0.09 * Math.sin(ph * 2.7 + 2.3));
      const k2 = (BRAID_LEN / 3) * BRAID_RING * BRAID_RING;
      const sway = (U.uWind.value as THREE.Vector3).clone().multiplyScalar(gust * k2);
      ring.position.copy(at).add(sway);
      const dir = below.sub(at).add((U.uWind.value as THREE.Vector3).clone().multiplyScalar(gust * (BRAID_LEN / 3) * 0.1)).normalize();
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    });
  }

  dispose(): void {
    for (const d of this.drawn) {
      d.hair.removeFromParent();
      (d.hair.material as THREE.Material).dispose();
      if (d.bits) {
        d.bits.removeFromParent();
        (d.bits.material as THREE.Material).dispose();
      }
    }
    for (const b of this.beads) {
      b.removeFromParent();
      b.geometry.dispose();
    }
    this.shadow?.dispose();
    this.shadow = null;
    for (const o of this.hid) o.visible = true;
    if (this.led !== null && this.unit) (this.unit.rig.face as unknown as { intensity: number }).intensity = this.led;
    this.led = null;
    this.drawn = [];
    this.beads = [];
    this.hid = [];
    this.unit = null;
  }
}

class Focus implements Effect {
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    if (ctx.t < this.cue.t || ctx.t > num(this.cue.until, Infinity)) return;
    const g = game();
    if (!g) return;
    const dist = this.cue.dist as [number, number][] | undefined;
    // Without a point or distances the stage's own focus (set from the camera's) stands.
    const d = dist ? curve(dist, ctx.t) : this.cue.at ? ctx.camera.position.distanceTo(ctx.point(this.cue.at)) : g.engine.dof?.cocMaterial.worldFocusDistance;
    if (d === undefined) return;
    const range = this.cue.range as [number, number][] | undefined;
    g.engine.setFocus(d, range ? curve(range, ctx.t) : undefined);
  }
  dispose(): void {}
}

class Lens implements Effect {
  private near: number | null = null;
  private cam: THREE.PerspectiveCamera | null = null;
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    const on = ctx.t >= this.cue.t && ctx.t <= num(this.cue.until, Infinity);
    const cam = ctx.camera;
    if (this.near === null) {
      this.near = cam.near;
      this.cam = cam;
    }
    const want = on ? num(this.cue.near, cam.near) : this.near;
    if (Math.abs(cam.near - want) > 1e-6) {
      cam.near = want;
      cam.updateProjectionMatrix();
    }
  }
  dispose(): void {
    if (this.cam && this.near !== null) {
      this.cam.near = this.near;
      this.cam.updateProjectionMatrix();
    }
  }
}

registerEffect('fur', (cue) => new Fur(cue));
registerEffect('focus', (cue) => new Focus(cue));
registerEffect('lens', (cue) => new Lens(cue));
