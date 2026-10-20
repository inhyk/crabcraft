// The undead's summon assembles: the molten boulders that heave out of the ground round him fly
// together behind him into a towering rock golem (the original's Infernal): boulder legs and pelvis,
// a torso round a rib-caged chest that blazes white-gold, wide boulder shoulders, arms ending in huge
// pincer fists, a sunken head whose two eyes light last. It straightens up and looms over him.
// Everything is a function of the shot clock (seek-safe).
//
//   night-golem { at, right, src, arc, rise, fly, crouch, stand, blaze, eyes, loom, glow, rim, ... }
//       at     the golem's base point (ground), right [x, z] the screen-right unit (it faces the lens)
//       src    the point the boulders rise round (the caster), arc [a0, a1] (x = cos, z = sin)
//       rise   [t0, t1] the boulders climb out of the ground; fly [t0, t1] they fly into place
//       stand  [t0, t1] it straightens from its crouch; loom [t0, t1] it leans over him, fists forward
//       blaze  [t0, t1] the chest blazes; eyes t the eyes light
import * as THREE from 'three';
import { mulberry, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, hdr, Rocks, track } from './night-kit';

type V3 = [number, number, number];
/** A golem part: group (leg stays put, body leans, arm swings from its shoulder, head nods), slot, scale, turn. */
interface Part {
  g: 'leg' | 'body' | 'armL' | 'armR' | 'head';
  p: V3;
  s: V3;
  r?: V3;
  /** Heaves up in place out of the ground (legs, pelvis) instead of flying in. */
  inPlace?: boolean;
  /** Assembly order 0..1 (when it flies in, within `fly`). */
  o: number;
}

const SHOULDER_Y = 4.6;
const SHOULDER_X = 2.0;
const PELVIS_Y = 2.3;
const CHEST: V3 = [0, 3.75, 0.62];
const HEAD: V3 = [0, 5.35, 0.3];

/** One arm, in the shoulder's frame (x outward for the right arm; mirrored for the left). */
const ARM: { p: V3; s: V3; r?: V3; o: number }[] = [
  { p: [0.35, -0.95, 0.05], s: [0.62, 0.85, 0.62], o: 0.5 },
  { p: [0.45, -1.9, 0.2], s: [0.72, 0.75, 0.72], o: 0.58 },
  { p: [0.5, -2.55, 0.3], s: [0.66, 0.5, 0.66], o: 0.64 },
  // The fist: a great palm and two prongs curling toward each other, a crab's pincer.
  { p: [0.55, -3.15, 0.38], s: [0.92, 0.78, 0.9], o: 0.7 },
  { p: [0.98, -3.8, 0.42], s: [0.4, 0.55, 0.42], r: [0, 0, 0.25], o: 0.76 },
  { p: [0.86, -4.3, 0.46], s: [0.27, 0.42, 0.3], r: [0, 0, -0.45], o: 0.8 },
  { p: [0.12, -3.8, 0.42], s: [0.38, 0.52, 0.4], r: [0, 0, -0.25], o: 0.78 },
  { p: [0.26, -4.28, 0.46], s: [0.26, 0.4, 0.28], r: [0, 0, 0.45], o: 0.82 },
];

const PARTS: Part[] = [
  // Legs and pelvis heave up where they stand.
  { g: 'leg', p: [-1.0, 0.5, 0.1], s: [0.85, 0.65, 0.9], inPlace: true, o: 0 },
  { g: 'leg', p: [1.0, 0.5, 0.1], s: [0.85, 0.65, 0.9], inPlace: true, o: 0.04 },
  { g: 'leg', p: [-0.95, 1.5, -0.15], s: [0.75, 0.85, 0.75], inPlace: true, o: 0.08 },
  { g: 'leg', p: [0.95, 1.5, -0.15], s: [0.75, 0.85, 0.75], inPlace: true, o: 0.12 },
  { g: 'body', p: [0, PELVIS_Y, -0.3], s: [1.15, 0.7, 0.85], inPlace: true, o: 0.16 },
  // The torso: a belly, a back wall behind the chest cavity, flanks and an upper back.
  { g: 'body', p: [0, 2.95, -0.25], s: [0.95, 0.6, 0.8], o: 0.2 },
  { g: 'body', p: [-0.55, 3.75, -0.62], s: [0.9, 1.0, 0.75], o: 0.24 },
  { g: 'body', p: [0.55, 3.75, -0.62], s: [0.9, 1.0, 0.75], o: 0.27 },
  { g: 'body', p: [-1.08, 3.75, 0.05], s: [0.55, 1.0, 0.72], o: 0.3 },
  { g: 'body', p: [1.08, 3.75, 0.05], s: [0.55, 1.0, 0.72], o: 0.33 },
  { g: 'body', p: [0, 4.55, -0.45], s: [1.35, 0.72, 0.85], o: 0.36 },
  // Shoulders: the widest thing on it, and the traps that bury its head.
  { g: 'body', p: [-SHOULDER_X, SHOULDER_Y + 0.15, -0.1], s: [1.08, 0.92, 1.0], o: 0.4 },
  { g: 'body', p: [SHOULDER_X, SHOULDER_Y + 0.15, -0.1], s: [1.08, 0.92, 1.0], o: 0.43 },
  { g: 'body', p: [-1.15, 5.0, -0.35], s: [0.72, 0.55, 0.72], o: 0.46 },
  { g: 'body', p: [1.15, 5.0, -0.35], s: [0.72, 0.55, 0.72], o: 0.48 },
  // Arms.
  ...ARM.map((a) => ({ g: 'armR' as const, p: [SHOULDER_X + a.p[0], SHOULDER_Y + a.p[1], a.p[2]] as V3, s: a.s, r: a.r, o: a.o })),
  ...ARM.map((a) => ({
    g: 'armL' as const,
    p: [-SHOULDER_X - a.p[0], SHOULDER_Y + a.p[1], a.p[2]] as V3,
    s: a.s,
    r: a.r ? ([a.r[0], -a.r[1], -a.r[2]] as V3) : undefined,
    o: a.o + 0.02,
  })),
  // Ribs: three dark pairs over the cavity, outer ends high, a glowing seam down the middle.
  ...[0, 1, 2].flatMap((k) =>
    [-1, 1].map((sd) => ({ g: 'body' as const, p: [sd * 0.5, 3.18 + k * 0.47, 0.85 - k * 0.04] as V3, s: [0.46, 0.15, 0.2] as V3, r: [0, 0, sd * 0.42] as V3, o: 0.86 + k * 0.03 })),
  ),
  // The head, sunk between the shoulders: skull, brow, jaw.
  { g: 'head', p: HEAD, s: [0.86, 0.72, 0.78], o: 0.9 },
  { g: 'head', p: [HEAD[0], HEAD[1] + 0.3, HEAD[2] + 0.45], s: [0.78, 0.2, 0.32], o: 0.95 },
  { g: 'head', p: [HEAD[0], HEAD[1] - 0.42, HEAD[2] + 0.36], s: [0.55, 0.24, 0.4], o: 0.97 },
];

const EYES: V3[] = [
  [-0.27, HEAD[1] + 0.0, HEAD[2] + 0.78],
  [0.27, HEAD[1] + 0.0, HEAD[2] + 0.78],
];

const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / Math.max(1e-6, b - a)));
  return k * k * (3 - 2 * k);
};

interface Rock {
  part: Part;
  src: THREE.Vector3; // hover point (x, z on the ground ring; y = hover height)
  start: number;
  fly0: number;
  fly1: number;
  rot0: THREE.Euler;
  spin: THREE.Vector3;
  slot: THREE.Quaternion;
  scale: THREE.Vector3;
  glow: number;
}

class Golem implements Effect {
  private rocks: Rocks;
  private glows: Billboards;
  private light: THREE.PointLight;
  private eyeLight: THREE.PointLight;
  private data: Rock[] = [];
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private basis = new THREE.Matrix4();
  private S: number;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const S = (this.S = num(cue.scale, 1));
    this.rocks = new Rocks(scene, PARTS.length, { cells: 1.5, crack: '#ffc23a', crack2: '#8dff3a', ...cue }, num(cue.seed, 77));
    const rnd = mulberry(num(cue.seed, 77) * 7 + 3);
    const [a0, a1] = (cue.arc as [number, number]) ?? [0, Math.PI * 2];
    const [r0, r1] = (cue.rise as [number, number]) ?? [3.5, 6];
    const [f0, f1] = (cue.fly as [number, number]) ?? [6, 7.8];
    const flyDur = num(cue.flyDur, 0.75);
    const R = num(cue.radius, 4.2);
    const fliers = PARTS.filter((p) => !p.inPlace).length;
    let k = 0;
    for (const part of PARTS) {
      const f = part.inPlace ? 0 : (k++ + 0.5) / fliers;
      const angle = a0 + (a1 - a0) * ((f * 7.31) % 1) + (rnd() - 0.5) * 0.2;
      const fly0 = f0 + (f1 - flyDur - f0) * part.o;
      this.data.push({
        part,
        src: new THREE.Vector3(Math.cos(angle) * R * (0.45 + 0.55 * rnd()), 0.4 + 2.2 * rnd(), Math.sin(angle) * R * (0.45 + 0.55 * rnd())),
        start: part.inPlace ? fly0 - 0.9 : r0 + (r1 - r0) * rnd(),
        fly0,
        fly1: fly0 + (part.inPlace ? 0.9 : flyDur * (0.85 + 0.3 * rnd())),
        rot0: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
        spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.8),
        slot: new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.r ?? [0, 0, 0]))),
        scale: new THREE.Vector3(...part.s).multiplyScalar(S),
        glow: 0.75 + 0.5 * rnd(),
      });
    }
    // Chest and eye glows (positions set per frame from the pose).
    const u = {
      uChest: { value: new THREE.Vector3() },
      uEyeL: { value: new THREE.Vector3() },
      uEyeR: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uS: { value: S },
      uChestK: { value: 0 },
      uEyeK: { value: 0 },
      uHot: { value: hdr(cue.hot ?? '#fff6d8', 1) },
      uGold: { value: hdr(cue.gold ?? '#ffc04a', 1) },
      uGreen: { value: hdr(cue.color ?? '#9dff4a', 1) },
    };
    this.glows = new Billboards(scene, {
      count: 9,
      seed: 78,
      sprite: 2,
      decl: 'uniform vec3 uChest, uEyeL, uEyeR, uUp, uHot, uGold, uGreen; uniform float uChestK, uEyeK, uS;',
      uniforms: u,
      renderOrder: 6,
      body: /* glsl */ `
        int i = int(idx * 8.0 + 0.5);
        float fl = 0.9 + 0.1 * sin(tau * 23. + idx * 7.) * sin(tau * 7.3);
        if (i == 0) { pos = uChest; size = 0.5 + 0.25 * uChestK; col = vec4(uHot * 3.0, min(1., uChestK) * fl); }
        else if (i == 1) { pos = uChest; size = 0.8 + 0.45 * uChestK; col = vec4(uGold * 1.6, min(1., uChestK * 0.6) * fl); }
        else if (i == 2) { pos = uChest - uUp * 0.1; size = 1.2 + 0.9 * uChestK; col = vec4(mix(uGold, uGreen, 0.5) * 0.6, min(0.5, uChestK * 0.22)); }
        else if (i == 3) { pos = uEyeL; size = 0.2; col = vec4(uHot * 8.0, uEyeK); }
        else if (i == 4) { pos = uEyeR; size = 0.2; col = vec4(uHot * 8.0, uEyeK); }
        else if (i == 5) { pos = uEyeL; size = 0.7; col = vec4(uGold * 2.6, uEyeK * 0.85); }
        else if (i == 6) { pos = uEyeR; size = 0.7; col = vec4(uGold * 2.6, uEyeK * 0.85); }
        else if (i == 7) { pos = mix(uEyeL, uEyeR, 0.5); size = 1.5; col = vec4(mix(uGold, uGreen, 0.4) * 0.8, uEyeK * 0.4); }
        else { pos = uChest + uUp * 0.1 * uS; size = 0.16 + 0.08 * uChestK; vel = uUp; stretch = 1.1; col = vec4(uHot * 4.0, min(1., uChestK) * fl); }
        size *= uS; stretch *= uS;`,
    });
    // The seam glow is a velocity-stretched quad; its sprite is the soft glow, fine for a seam.
    this.light = new THREE.PointLight(new THREE.Color(String(cue.gold ?? '#ffc04a')), 0, 14 * S, 1.4);
    this.eyeLight = new THREE.PointLight(new THREE.Color(String(cue.gold ?? '#ffc04a')), 0, 5 * S, 1.6);
    scene.add(this.light, this.eyeLight);
  }

  /** The pose at t: body lift and lean, arm raise, head nod (radians/units). */
  private pose(t: number) {
    const [s0, s1] = (this.cue.stand as [number, number]) ?? [7.8, 8.7];
    const [l0, l1] = (this.cue.loom as [number, number]) ?? [8.8, 11.5];
    const st = smooth(s0, s1, t);
    const lm = smooth(l0, l1, t);
    const crouch = num(this.cue.crouch, 0.9);
    const eyesAt = num(this.cue.eyes, 10);
    const breathe = Math.sin(t * 2.1) * 0.04;
    return {
      lift: -crouch * (1 - st) + breathe,
      lean: 0.2 * (1 - st) - 0.08 * st * (1 - lm) + num(this.cue.leanTo, 0.3) * lm,
      armOut: (0.12 * (1 - st) + 0.3 * st) * (1 - lm) + num(this.cue.spread, 0.25) * lm,
      armFwd: 0.15 * (1 - lm) + num(this.cue.reach, 0.75) * lm,
      // Head down while it gathers, up as it stands, then lowered at him as the eyes light.
      nod: 0.35 * (1 - st) - 0.12 * st * (1 - lm) + 0.12 * lm + 0.16 * smooth(eyesAt - 0.4, eyesAt + 0.2, t),
    };
  }

  /** A part's slot in the golem's frame at the pose (local units). */
  private slot(part: Part, pose: ReturnType<Golem['pose']>, out: THREE.Vector3, rot: THREE.Quaternion): void {
    out.set(...part.p);
    rot.identity();
    if (part.g === 'leg') {
      out.multiplyScalar(this.S);
      return;
    }
    if (part.g === 'armL' || part.g === 'armR') {
      const sd = part.g === 'armR' ? 1 : -1;
      // Into the shoulder's frame, swing out (about z) and forward (about x), back out.
      out.x -= sd * SHOULDER_X;
      out.y -= SHOULDER_Y;
      this.e.set(-pose.armFwd, 0, sd * pose.armOut);
      this.q2.setFromEuler(this.e);
      out.applyQuaternion(this.q2);
      rot.premultiply(this.q2);
      out.x += sd * SHOULDER_X;
      out.y += SHOULDER_Y;
    } else if (part.g === 'head') {
      out.sub(this.v.set(0, HEAD[1] - 0.4, 0));
      this.q2.setFromAxisAngle(this.s.set(1, 0, 0), pose.nod);
      out.applyQuaternion(this.q2);
      rot.premultiply(this.q2);
      out.add(this.v);
    }
    // The whole upper body: lean about the pelvis (+ toward the lens), then lift.
    out.y -= PELVIS_Y;
    this.q2.setFromAxisAngle(this.s.set(1, 0, 0), pose.lean);
    out.applyQuaternion(this.q2);
    rot.premultiply(this.q2);
    out.y += PELVIS_Y + pose.lift;
    out.multiplyScalar(this.S);
  }

  update(ctx: FxContext): void {
    const t = ctx.t;
    const base = ctx.point(this.cue.at);
    const [rx, rz] = (this.cue.right as [number, number]) ?? [1, 0];
    const right = new THREE.Vector3(rx, 0, rz).normalize();
    const fwd = new THREE.Vector3(-rz, 0, rx).normalize(); // toward the lens
    this.basis.makeBasis(right, new THREE.Vector3(0, 1, 0), fwd);
    const frame = new THREE.Quaternion().setFromRotationMatrix(this.basis);
    const src = ctx.point(this.cue.src ?? this.cue.at);
    const pose = this.pose(t);
    const glowK = track(this.cue.glow, t, 0.7);
    const [b0, b1] = (this.cue.blaze as [number, number]) ?? [8.0, 8.7];
    const blaze = smooth(b0 - 0.5, b0 + 0.15, t) * (1 + 1.6 * (1 - smooth(b0 + 0.15, b1 + 0.6, t)));
    const eyesAt = num(this.cue.eyes, 10);
    const eyes = smooth(eyesAt - 0.08, eyesAt + 0.12, t) * (1 + 0.8 * Math.exp(-Math.max(0, t - eyesAt - 0.12) * 3));
    const until = num(this.cue.until, Infinity);
    const local = new THREE.Vector3();
    const slotRot = new THREE.Quaternion();
    const world = new THREE.Vector3();
    this.data.forEach((r, i) => {
      if (t < r.start || t > until) {
        this.rocks.setScaled(i, base, this.q.identity(), this.s.setScalar(0), 0);
        return;
      }
      this.slot(r.part, pose, local, slotRot);
      world.copy(local).applyQuaternion(frame).add(base);
      this.q.copy(frame).multiply(slotRot).multiply(r.slot);
      const mean = (r.scale.x + r.scale.y + r.scale.z) / 3;
      let glow = r.glow * glowK;
      if (r.part.inPlace) {
        // Heaves up out of the ground into its slot.
        const k = smooth(r.start, r.fly1, t);
        world.y -= (1 - k) * (r.scale.y * 2 + 0.6 * this.S);
        this.e.set(r.rot0.x * 0.15 * (1 - k), r.rot0.y * 0.15 * (1 - k), 0);
        this.q.multiply(this.q2.setFromEuler(this.e));
        glow *= 1 + 1.5 * Math.exp(-Math.max(0, t - r.fly1) * 2.5);
      } else {
        // Climbs out of the ground round the caster and hovers, tumbling.
        const gx = src.x + r.src.x;
        const gz = src.z + r.src.z;
        const g = ctx.ground(gx, gz);
        const rk = Math.min(1, (t - r.start) / 1.4);
        const re = 1 - (1 - rk) ** 3;
        const tl = t - r.start;
        const hover = this.v.set(gx, g - mean + (r.src.y + mean) * re + Math.sin(t * 1.3 + i) * 0.1 * re, gz);
        this.e.set(r.rot0.x + r.spin.x * tl, r.rot0.y + r.spin.y * tl, r.rot0.z + r.spin.z * tl);
        const tumble = this.q2.setFromEuler(this.e);
        const fk = smooth(r.fly0, r.fly1, t);
        if (fk <= 0) {
          world.copy(hover);
          this.q.copy(tumble);
        } else {
          // Pulled along an arc into its slot, turning into place, snapping home with a flare.
          const mid = hover.clone().lerp(world, 0.5);
          mid.y += 1.0 + 0.25 * hover.distanceTo(world);
          const a = hover.clone().lerp(mid, fk);
          const b = mid.lerp(world, fk);
          world.copy(a.lerp(b, fk));
          this.q.copy(tumble.slerp(this.q.clone(), fk));
          glow *= 1 + 0.6 * Math.sin(fk * Math.PI) + 1.6 * (fk >= 1 ? Math.exp(-(t - r.fly1) * 2.5) : 0);
        }
      }
      // The blaze runs out through every crack.
      glow *= 1 + num(this.cue.blazeCracks, 0.6) * blaze;
      this.rocks.setScaled(i, world, this.q, r.scale, glow);
    });
    const chest = this.v.set(0, 0, 0);
    const p: Part = { g: 'body', p: CHEST, s: [1, 1, 1], o: 0 };
    this.slot(p, pose, chest, slotRot);
    const chestW = chest.clone().applyQuaternion(frame).add(base);
    const eyeW = EYES.map((e) => {
      this.slot({ g: 'head', p: e, s: [1, 1, 1], o: 0 }, pose, local, slotRot);
      return local.clone().applyQuaternion(frame).add(base);
    });
    const smoulder = smooth(num(this.cue.lit, 7.4), b0, t) * 0.35;
    const chestK = t > until ? 0 : smoulder + blaze;
    const gu = this.glows.u;
    (gu.uChest.value as THREE.Vector3).copy(chestW);
    (gu.uEyeL.value as THREE.Vector3).copy(eyeW[0]);
    (gu.uEyeR.value as THREE.Vector3).copy(eyeW[1]);
    (gu.uUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(this.q2.setFromAxisAngle(this.s.set(1, 0, 0), pose.lean)).applyQuaternion(frame);
    gu.uChestK.value = chestK * num(this.cue.chestGain, 1);
    gu.uEyeK.value = t > until ? 0 : eyes;
    this.glows.set(t, ctx, chestK > 0.001 || eyes > 0.001);
    const ru = this.rocks.mat.uniforms;
    (ru.uHeatPos.value as THREE.Vector3).copy(chestW);
    ru.uHeat.value = num(this.cue.heat, 3.5) * chestK;
    this.rocks.commit(ctx);
    this.light.position.copy(chestW).addScaledVector(fwd, 0.6 * this.S);
    this.light.intensity = num(this.cue.light, 60) * chestK;
    this.eyeLight.position.copy(eyeW[0]).lerp(eyeW[1], 0.5).addScaledVector(fwd, 0.3);
    this.eyeLight.intensity = num(this.cue.eyeLight, 8) * (t > until ? 0 : eyes);
  }

  dispose(): void {
    this.rocks.dispose();
    this.glows.dispose();
    for (const l of [this.light, this.eyeLight]) {
      l.removeFromParent();
      l.dispose();
    }
  }
}

registerEffect('night-golem', (cue, scene) => new Golem(cue, scene));
