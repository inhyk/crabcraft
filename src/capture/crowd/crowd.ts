// The crowd: one real crab rig per slot (createCrab, the game's own gear and LED faces), posed
// every frame from the recorded Jumper clips by the program's cues. A crab's pose is a pure
// function of the song clock: the cue that started last for it plays, faded in over the one
// before, each clip window anchored at the crab's slot so a crowd of hundreds stays in its rows.
import * as THREE from 'three';
import { createCrab, createEnemyCrab } from '../../crab/index';
import type { JumperRig } from '../../crab/rig';
import { loadCrabTemplate } from '../../crab/template';
import { JOINT_NAMES, type CrabRig, type CrabSpec, type Expression, type RaceId } from '../../crab/types';
import { RACES, RACE_ORDER } from '../../data/races';
import { getMotionLibrary, type ClipId, type LoadedClip } from '../../motion/library';
import { NJ, Pose, headingOf, rebaseRoot, sampleClip } from '../../motion/pose';
import type { World } from '../../world/types';
import {
  formationSlots,
  mulberry32,
  selects,
  waveDelay,
  type Cue,
  type CrowdProgram,
  type FaceCue,
  type Site,
  type Slot,
} from './program';

/** The hero: a human priest in Jumper Red with the circlet (the breakdance videos' hero). */
export const HERO_SPEC: CrabSpec = { race: 'human', sex: 'male', classId: 'priest', shell: 0, crest: 2, led: 0, name: 'Pinchwick' };

const DEFAULT_FADE = 0.25;
/** A one-shot window that ends eases back to standing over this long (clip seconds at speed 1). */
const RELEASE = 0.35;

type RigX = CrabRig & Pick<JumperRig, 'look' | 'applyLook'> & { links?: THREE.Object3D[]; useShadowProxy?: (on: boolean) => void; setLod?: (l: number) => void };

interface Entry {
  cue: Cue;
  /** Song second the window starts for this crab. */
  s: number;
  /** Song second it lets go (eases to standing), Infinity if never. */
  until: number;
  mirror: boolean;
  turn: number;
}

interface FaceEntry {
  at: number;
  expr: Expression;
}

export interface CrowdCrab {
  slot: Slot;
  rig: RigX;
  spec: CrabSpec;
  entries: Entry[];
  faces: FaceEntry[];
  faceNow: Expression | null;
  /** Ground under the slot, world units. */
  ground: number;
  lod: number;
  /** Idle phase offset, seconds. */
  idlePhase: number;
  supports: THREE.Object3D[];
  rawLift: number;
  liftTrack?: Float64Array;
}

/** Joint index each joint mirrors to, and the sign of the mirrored angle. */
interface MirrorMap {
  to: Int8Array;
  sign: Float32Array;
}

/** Planar anchor of a clip window: its start pose, and its end relative to the start. */
interface Anchor {
  x: number;
  z: number;
  yaw: number;
  dx: number;
  dz: number;
  dyaw: number;
  /** Clip seconds the drift is removed over. */
  a: number;
  b: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** A seeded crowd: every race, mostly in Jumper Red or their first paint, random gear. */
export function crowdSpecs(n: number, seed: number): CrabSpec[] {
  const rnd = mulberry32(seed * 104729 + 3);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length) % a.length];
  const out: CrabSpec[] = [];
  for (let i = 0; i < n; i++) {
    const race: RaceId = RACE_ORDER[(i + Math.floor(rnd() * 3)) % RACE_ORDER.length];
    const r = RACES[race];
    out.push({
      race,
      sex: rnd() < 0.5 ? 'male' : 'female',
      classId: pick(['warrior', 'mage', 'priest'] as const),
      // Half the crowd in the race's first paint, the rest any of its paints.
      shell: rnd() < 0.5 ? 0 : Math.floor(rnd() * r.shellColors.length),
      crest: Math.floor(rnd() * r.crestStyles.length),
      led: Math.floor(rnd() * r.ledColors.length),
      name: `crowd-${i}`,
    });
  }
  return out;
}

export class Crowd {
  readonly crabs: CrowdCrab[] = [];
  readonly group = new THREE.Group();
  hero: CrowdCrab | null = null;
  /** World height of the hero's body standing at home. */
  heroStandY = 0;
  private lib = getMotionLibrary();
  private anchors = new Map<string, Anchor>();
  private mirror: MirrorMap | null = null;
  private pa = new Pose();
  private pb = new Pose();
  private tmp = new Pose();
  private idleP = new Pose();
  private site: Site;
  private siteY = 0;
  /** Ground at a formation point: the deck where there is one, else the terrain. */
  groundAt: (x: number, z: number) => number;
  private cos = 1;
  private sin = 0;
  private supportPoint = new THREE.Vector3();
  /** Per-frame audit of the opt-in cinematic terrain fit, in world units. */
  terrainAudit: { minClearance: number; maxLift: number } | null = null;

  constructor(
    readonly program: CrowdProgram,
    world: World,
  ) {
    this.group.name = 'crowd';
    this.site = program.site ?? { x: 0, z: 0, yaw: 0 };
    this.cos = Math.cos(this.site.yaw);
    this.sin = Math.sin(this.site.yaw);
    this.siteY = world.heightAt(this.site.x, this.site.z);
    this.groundAt = (x, z) => {
      const w = this.toWorld(x, 0, z);
      return world.heightAt(w.x, w.z);
    };
  }

  /** Stand the formation on something else (the deck), heights in world units. */
  setGround(fn: (x: number, z: number) => number | null, originY: number): void {
    const terrain = this.groundAt;
    this.groundAt = (x, z) => fn(x, z) ?? terrain(x, z);
    this.siteY = originY;
  }

  /** Formation coordinates to world (x left, z front of the formation). */
  toWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    // Formation +z is the site's facing; +x its left (yaw rotates +Z toward +X).
    return out.set(this.site.x + this.cos * x + this.sin * z, this.siteY + y, this.site.z - this.sin * x + this.cos * z);
  }

  /** World direction of a formation direction. */
  dirToWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.cos * x + this.sin * z, y, -this.sin * x + this.cos * z);
  }

  get siteYaw(): number {
    return this.site.yaw;
  }

  /** Build every crab and load every clip the cues use. */
  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const p = this.program;
    const slots = formationSlots(p.formation);
    const specs = crowdSpecs(slots.length, p.formation.seed ?? 7);
    const clips = new Set<ClipId>(['idle', ...p.cues.map((c) => c.clip)]);
    await this.lib.preload([...clips]);
    for (const id of clips) if (!this.lib.get(id)) throw new Error(`crowd: clip ${id} did not load`);
    this.mirror = await mirrorMap();

    let done = 0;
    const make = async (s: Slot): Promise<void> => {
      const spec = s.hero ? HERO_SPEC : specs[s.index];
      const rig = (await (p.actor && s.hero ? createEnemyCrab(p.actor) : createCrab(spec))) as RigX;
      if (p.exactMotion) rig.applyLook({ ...rig.look,
        posture: { scale: rig.look.posture.scale, bodyHeight: 1, stanceWidth: 1, hunch: 0 }, twitch: false,
      });
      rig.useShadowProxy?.(true);
      // Class weapons ride the claw sockets; a share of the crowd dances empty-clawed.
      // (Seeded per slot: crabs finish dressing in any order.)
      const keep = mulberry32(((p.formation.seed ?? 7) * 31 + 5) ^ Math.imul(s.index + 1, 2654435761))();
      if (!s.hero && keep >= (p.formation.weapons ?? 1)) {
        rig.root.traverse((o) => {
          if (o.name.startsWith('socket:claw')) for (const ch of [...o.children]) ch.removeFromParent();
        });
      }
      const w = this.toWorld(s.x, 0, s.z);
      const ground = this.groundAt(s.x, s.z);
      rig.root.position.set(w.x, ground, w.z);
      rig.root.rotation.y = this.site.yaw;
      this.group.add(rig.root);
      const c: CrowdCrab = {
        slot: s,
        rig,
        spec: { ...rig.spec },
        entries: this.schedule(s),
        faces: this.faceSchedule(s, p.faces ?? []),
        faceNow: null,
        ground,
        lod: 0,
        idlePhase: s.rnd * 2.5,
        supports: (rig.links ?? []).filter((o) => /^(LM|RM|LR|RR)_foot_tip_link$|^(LF|RF)_palm_pad_b_link$/.test(o.name)),
        rawLift: 0,
      };
      this.crabs[s.index] = c;
      if (s.hero) {
        this.hero = c;
        this.heroStandY = ground + rig.body.position.y;
      }
      onProgress?.(++done, slots.length);
    };
    // A few at a time: each one dresses its gear.
    for (let i = 0; i < slots.length; i += 16) await Promise.all(slots.slice(i, i + 16).map(make));
    if (p.terrainClearance !== undefined && p.terrainLiftRate !== undefined) {
      // Minimal speed-limited envelope above the required support lift. Looking ahead makes
      // the rise gradual without allowing a foot to sink while a causal filter catches up.
      const n = Math.ceil((p.length + 4) * 60) + 1;
      const step = p.terrainLiftRate / 60;
      for (const c of this.crabs) {
        const track = new Float64Array(n);
        for (let i = 0; i < n; i++) { this.poseCrab(c, i / 60 - 2); track[i] = c.rawLift; }
        for (let i = 1; i < n; i++) track[i] = Math.max(track[i], track[i - 1] - step);
        for (let i = n - 2; i >= 0; i--) track[i] = Math.max(track[i], track[i + 1] - step);
        c.liftTrack = track;
      }
    }
  }

  private schedule(s: Slot): Entry[] {
    const f = this.program.formation;
    const out: Entry[] = [];
    this.program.cues.forEach((cue) => {
      if (!selects(cue.who, s)) return;
      const speed = cue.speed ?? 1;
      const delay = waveDelay(cue.wave, s, f) + (cue.jitter ? (s.rnd * 2 - 1) * cue.jitter : 0);
      const start = cue.at + delay - ((cue.sync ?? cue.from) - cue.from) / speed;
      const mirror = cue.mirror === true || (cue.mirror === 'left' && s.x > 0) || (cue.mirror === 'right' && s.x < 0);
      let turn = cue.turn ?? 0;
      if (cue.faceTo) turn = Math.atan2(cue.faceTo[0] - s.x, cue.faceTo[1] - s.z);
      out.push({ cue, s: start, until: cue.until !== undefined ? cue.until + delay : Infinity, mirror, turn });
    });
    // Stable: equal starts keep program order (the later cue wins).
    return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.s - b.e.s || a.i - b.i).map((x) => x.e);
  }

  private faceSchedule(s: Slot, faces: FaceCue[]): FaceEntry[] {
    return faces
      .filter((fc) => selects(fc.who, s))
      .map((fc) => ({ at: fc.at + waveDelay(fc.wave, s, this.program.formation), expr: fc.expr }))
      .sort((a, b) => a.at - b.at);
  }

  /** Pose every crab for song time `t`. `dt` drives the faces; `pxPerUnit` picks the LOD. */
  update(t: number, dt: number, camera: THREE.PerspectiveCamera, pxPerUnit: number): void {
    const cam = camera.position;
    this.terrainAudit = this.program.terrainClearance === undefined ? null : { minClearance: Infinity, maxLift: 0 };
    for (const c of this.crabs) {
      this.poseCrab(c, t);
      // Faces: the latest face cue that has started.
      let expr: Expression | null = null;
      for (const f of c.faces) if (f.at <= t) expr = f.expr;
      if (expr && expr !== c.faceNow) {
        c.rig.face.setExpression(expr, 1e6);
        c.faceNow = expr;
      }
      c.rig.update(dt);
      // Far LOD under ~90 px of shell height, back over ~110 px (the game's rule).
      const d = cam.distanceTo(c.rig.root.position);
      const px = pxPerUnit / Math.max(d, 0.1);
      c.lod = px < (c.lod ? 110 : 90) ? 1 : 0;
      c.rig.setLod?.(c.lod);
    }
  }

  /** The hero's body position (world), for the camera. */
  heroBody(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.hero) return this.toWorld(0, 0.5, 0, out);
    return this.hero.rig.body.getWorldPosition(out);
  }

  private poseCrab(c: CrowdCrab, t: number): void {
    const E = c.entries;
    let k = -1;
    for (let i = 0; i < E.length; i++) if (E[i].s <= t) k = i;
    const out = this.pa;
    let turn = 0;
    if (k < 0) {
      this.idle(c, t, out);
    } else {
      const cur = E[k];
      this.entryPose(c, cur, t, out);
      turn = cur.turn;
      const fade = cur.cue.fade ?? DEFAULT_FADE;
      const w = smooth((t - cur.s) / Math.max(1e-3, fade));
      if (w < 1) {
        const prev = this.pb;
        let pturn = 0;
        if (k > 0) {
          this.entryPose(c, E[k - 1], t, prev);
          pturn = E[k - 1].turn;
        } else this.idle(c, t, prev);
        prev.blend(out, w);
        out.copy(prev);
        turn = pturn + wrap(turn - pturn) * w;
      }
    }
    this.apply(c, out, turn, t);
  }

  private idle(c: CrowdCrab, t: number, out: Pose): void {
    sampleClip(this.lib.get('idle')!, t + c.idlePhase, true, out);
  }

  /** One cue's pose for this crab at song time t (eased back to standing once it lets go). */
  private entryPose(c: CrowdCrab, e: Entry, t: number, out: Pose): void {
    const cue = e.cue;
    const clip = this.lib.get(cue.clip)!;
    const speed = cue.speed ?? 1;
    const end = Math.min(cue.to ?? clip.length, clip.length);
    let ct = cue.from + (t - e.s) * speed;
    let release = 0;
    let a = cue.from;
    if (cue.loop) {
      const lf = Math.max(cue.from, cue.loopFrom ?? cue.from);
      const span = end - lf;
      if (ct >= end && span > 1e-3) {
        ct = lf + ((ct - end) % span);
        a = lf;
      }
    } else if (ct > end) {
      if (!cue.hold) release = smooth((ct - end) / (RELEASE * speed));
      ct = end;
    }
    if (t > e.until) release = Math.max(release, smooth((t - e.until) / RELEASE));
    this.sampleWindow(clip, ct, a, end, out);
    if (e.mirror) this.mirrorPose(out);
    if (release > 0) {
      this.idle(c, t, this.idleP);
      out.blend(this.idleP, release);
    }
  }

  /**
   * Sample a clip at `ct`, its planar position and heading taken relative to the window's start
   * (`a`), with the window's net drift and wrapped heading change removed over [a, b]: every
   * window starts and ends on the crab's slot, facing front, and a spin keeps its turns.
   */
  private sampleWindow(clip: LoadedClip, ct: number, a: number, b: number, out: Pose): void {
    if (clip.local) {
      sampleClip(clip, ct, clip.loop, out);
      return;
    }
    const key = `${clip.id}:${a}:${b}`;
    let an = this.anchors.get(key);
    if (!an) {
      sampleClip(clip, a, false, this.tmp, true);
      const x = this.tmp.pos[0];
      const z = this.tmp.pos[2];
      const yaw = headingOf(this.tmp.rot);
      sampleClip(clip, b, false, this.tmp, true);
      rebaseRoot(this.tmp, x, z, yaw);
      an = { x, z, yaw, dx: this.tmp.pos[0], dz: this.tmp.pos[2], dyaw: wrap(headingOf(this.tmp.rot)), a, b };
      this.anchors.set(key, an);
    }
    sampleClip(clip, ct, false, out, true);
    rebaseRoot(out, an.x, an.z, an.yaw);
    const u = an.b > an.a ? Math.min(1, Math.max(0, (ct - an.a) / (an.b - an.a))) : 0;
    if (u > 0) rebaseRoot(out, an.dx * u, an.dz * u, an.dyaw * u);
  }

  /** Left and right swapped: joints across the mirror map, the body across the crab's mid plane. */
  private mirrorPose(p: Pose): void {
    const m = this.mirror!;
    const q = this.tmp.q;
    q.set(p.q);
    for (let i = 0; i < NJ; i++) p.q[i] = m.sign[i] * q[m.to[i]];
    p.pos[0] = -p.pos[0];
    p.rot[1] = -p.rot[1];
    p.rot[2] = -p.rot[2];
  }

  private apply(c: CrowdCrab, p: Pose, turn: number, t: number): void {
    const rig = c.rig;
    rig.setPose(p.q);
    const m = rig.metersToUnits;
    rig.body.position.set(p.pos[0] * m, p.pos[1] * m, p.pos[2] * m);
    rig.body.quaternion.set(p.rot[0], p.rot[1], p.rot[2], p.rot[3]);
    rig.root.rotation.y = this.site.yaw + turn;
    if (this.program.terrainClearance !== undefined) {
      // Each recorded pose starts at its uncorrected slot height, so seeking is deterministic.
      // Fit the actual animated support points, not just the terrain under the body's centre.
      rig.root.position.y = c.ground;
      rig.root.updateMatrixWorld(true);
      let lift = 0;
      let minGap = Infinity;
      for (const node of c.supports) {
        const w = node.getWorldPosition(this.supportPoint);
        const dx = w.x - this.site.x, dz = w.z - this.site.z;
        const ground = this.groundAt(this.cos * dx - this.sin * dz, this.sin * dx + this.cos * dz);
        const gap = w.y - ground;
        minGap = Math.min(minGap, gap);
        lift = Math.max(lift, this.program.terrainClearance - gap);
      }
      c.rawLift = lift;
      if (c.liftTrack) {
        const x = Math.min(c.liftTrack.length - 1, Math.max(0, (t + 2) * 60));
        const i = Math.floor(x), j = Math.min(i + 1, c.liftTrack.length - 1);
        lift = Math.max(lift, c.liftTrack[i] + (c.liftTrack[j] - c.liftTrack[i]) * (x - i));
      }
      rig.root.position.y += lift;
      if (this.terrainAudit) {
        this.terrainAudit.minClearance = Math.min(this.terrainAudit.minClearance, minGap + lift);
        this.terrainAudit.maxLift = Math.max(this.terrainAudit.maxLift, lift);
      }
    }
  }

  dispose(): void {
    for (const c of this.crabs) c.rig.dispose();
    this.crabs.length = 0;
    this.group.removeFromParent();
  }
}

/**
 * The robot's left-right mirror: LF to RF, LM to RM, LR to RR, each angle negated where the two
 * joints' limits are each other's negatives (the URDF's mirrored axes), kept where they match.
 */
async function mirrorMap(): Promise<MirrorMap> {
  const t = await loadCrabTemplate();
  const to = new Int8Array(NJ);
  const sign = new Float32Array(NJ);
  const idx = new Map<string, number>(JOINT_NAMES.map((n, i) => [n, i]));
  JOINT_NAMES.forEach((name, i) => {
    const other = name.startsWith('L') ? `R${name.slice(1)}` : `L${name.slice(1)}`;
    const j = idx.get(other)!;
    to[i] = j;
    const a = t.links[t.jointLinks[i]];
    const b = t.links[t.jointLinks[j]];
    const neg = Math.abs(a.lower + b.upper) + Math.abs(a.upper + b.lower);
    const same = Math.abs(a.lower - b.lower) + Math.abs(a.upper - b.upper);
    sign[i] = neg < same ? -1 : 1;
  });
  return { to, sign };
}
