// The cinema stage: staged shots inside the running game, for cinematic videos (dev server only).
// tools/cinema/capture.mjs opens the game in capture mode (src/capture/clock.ts) and imports this
// module itself, so nothing in the app references it and a production build never contains it.
//
// The game keeps running underneath: the world's water, sky, snow and lights, and the crabs'
// motion runtime. The stage hides the game's own crabs and HUD, stops their AI, travels to the
// shot's world and adds its own actors as ordinary units, so they walk, strafe and play clips
// exactly like the game's crabs. Paths, the camera and the screen effects are functions of the
// shot clock (seek(t), then the page clock), which the capture script steps frame by frame.
//
// window.__cinema:
//   init()            take over the game (call once, after it has loaded)
//   travel(chapter)   go to a world (7: Tidecrown); returns once the switch has started (wait for
//                     `chapter` to equal it and .loading to go)
//   stage(shot)       build a shot (types.ts ShotSpec); resolves when every actor is dressed
//   seek(t)           put the shot clock at t seconds
//   probe()           shot clock and the last frame's draw stats
import * as THREE from 'three';
import { getMotionLibrary } from '../../motion/library';
import { createCrab, createEnemyCrab } from '../../crab/provider';
import type { CrabRig } from '../../crab/types';
import type { Game } from '../../game/game';
import type { Unit } from '../../game/unit';
import { Vfx } from '../../game/vfx/vfx';
import type { ViewOptions } from '../../core/engine';
import { makeEffect, type Effect, type FxContext } from './fx';
import type { ActorSpec, CamKey, Ease, PathKey, Pt, ShotSpec, Track, V3 } from './types';

// Scene-specific effect kinds register themselves (fx.ts registerEffect).
import.meta.glob('./fx/*.ts', { eager: true });

interface Actor {
  spec: ActorSpec;
  unit: Unit;
  track: Track;
  /** Feet height where the actor stood at t = 0. */
  y0: number;
  yaw: number;
}

type AnyGame = Game & Record<string, unknown>;

const EASE: Record<Ease, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  smooth: (x) => x * x * (3 - 2 * x),
  sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Uniform Catmull-Rom between b and c with neighbours a and d. */
function cr(a: number, b: number, c: number, d: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
}

/** Keyed curve at t: the segment, its fraction and the neighbours (times eased over the whole span). */
function segment<K extends { t: number }>(keys: K[], t: number, ease: Ease): { a: K; b: K; p: K; n: K; k: number } {
  const t0 = keys[0].t;
  const t1 = keys[keys.length - 1].t;
  const tt = t1 > t0 ? t0 + EASE[ease](clamp01((t - t0) / (t1 - t0))) * (t1 - t0) : t0;
  let i = 0;
  while (i < keys.length - 2 && tt > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  return { a, b, p: keys[Math.max(0, i - 1)], n: keys[Math.min(keys.length - 1, i + 2)], k: b.t > a.t ? clamp01((tt - a.t) / (b.t - a.t)) : 0 };
}

const HUD_CSS = `
  body * { visibility: hidden !important; }
  canvas.cc-canvas, #cinema-overlay { visibility: visible !important; }
  * { cursor: none !important; }
`;

class CinemaStage {
  private g!: AnyGame;
  private shot: ShotSpec | null = null;
  private actors = new Map<string, Actor>();
  private effects: Effect[] = [];
  private vfx!: Vfx;
  private overlay = document.createElement('div');
  private t0 = 0;
  private anchor = 0;
  private lastT = 0;
  private overlayColor = '#000';
  private overlayA = 0;
  private shakeAmp = 0;
  private hidden: THREE.Object3D[] = [];
  private v = new THREE.Vector3();
  /**
   * Sub-pixel camera offset, drawing-buffer pixels, set by capture.mjs between the renders it
   * averages into one frame (supersampling: hairs thinner than a pixel come out at their true weight).
   */
  jitter: [number, number] = [0, 0];
  private buf = new THREE.Vector2();
  private started = false;
  /** The world's own fog, put back when a shot that overrode it ends. */
  private worldFog: THREE.Scene['fog'] | undefined;
  private myFog: THREE.Fog | THREE.FogExp2 | null = null;

  init(): void {
    if (this.started) return;
    this.started = true;
    const app = (window as unknown as { app: { current: { game: AnyGame }; engine: AnyGame['engine'] } }).app;
    const g = app.current.game;
    this.g = g;
    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    document.head.append(style);
    this.overlay.id = 'cinema-overlay';
    this.overlay.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none;z-index:2147483647;background:#000';
    document.body.append(this.overlay);
    g.follow.update = () => undefined;
    (g as unknown as { god: boolean }).god = true;
    (g as unknown as { creatorTravel: boolean }).creatorTravel = true;
    (g as unknown as { musicOn: boolean }).musicOn = false;
    (g as unknown as { objectivePos: () => null }).objectivePos = () => null;
    const p = g.player.unit;
    p.hidden = true;
    p.targetable = false;
    p.invulnerable = true;
    this.vfx = new Vfx(g.scene, (x, z) => g.world.heightAt(x, z));
    this.freeze();
    g.engine.onFrame((f) => this.frame(f.dt));
  }

  /** Stop every crab the game owns and hide it; the shot's actors are the only ones on screen. */
  private freeze(): void {
    const g = this.g;
    const noop = () => undefined;
    for (const e of g.enemies) (e as unknown as { update: () => void }).update = noop;
    for (const n of g.npcs) (n as unknown as { update: () => void }).update = noop;
    for (const t of (g as unknown as { townsfolk: { update: () => void }[] }).townsfolk) t.update = noop;
    for (const k of ['boss', 'finalBoss', 'worldBoss', 'dawnBoss', 'frostBoss', 'emberBoss', 'skyBoss', 'encounter']) {
      const b = g[k] as { update?: () => void } | undefined;
      if (b?.update) b.update = noop;
    }
    const mine = new Set([...this.actors.values()].map((a) => a.unit));
    for (const u of g.units) if (!mine.has(u)) u.hidden = true;
  }

  /** Chapter 7 is Tidecrown, laid over the current chapter; its entry is async (built on first use). */
  travel(chapter: number): boolean {
    const w = this.g.world2;
    if (chapter === 7) {
      if (w.inTidecrown || this.entering) return false;
      this.travelError = '';
      this.entering = true;
      void w.enterTidecrown().then(
        (ok) => {
          this.entering = false;
          if (!ok) this.travelError = 'Tidecrown refused the entry';
          w.tidecrownPeople?.hide();
          this.freeze();
        },
        (e) => {
          this.entering = false;
          this.travelError = String(e);
        },
      );
      return true;
    }
    if (w.inTidecrown && w.chapter === chapter) return w.exitTidecrown();
    if (w.chapter === chapter) return false;
    w.go(chapter as 1 | 2 | 3 | 4 | 5 | 6);
    return true;
  }

  /** Tidecrown's entry is under way. */
  private entering = false;
  /** Why the last travel failed, if it did. */
  travelError = '';

  /** The world on screen: 7 once Tidecrown has been entered and has settled. */
  get chapter(): number {
    const w = this.g.world2;
    if (this.entering) return 0;
    return w.inTidecrown ? 7 : w.chapter;
  }

  async stage(shot: ShotSpec): Promise<{ actors: number }> {
    const g = this.g;
    this.clear();
    this.shot = shot;
    g.world2.tidecrownPeople?.hide();
    this.freeze();
    if (shot.mood !== undefined) g.world.setMood(shot.mood, true);
    for (const name of shot.hide ?? []) {
      g.scene.traverse((o) => {
        if (o.name === name && o.visible) {
          o.visible = false;
          this.hidden.push(o);
        }
      });
    }
    this.setView(shot);
    const library = getMotionLibrary();
    await library.ready;
    await Promise.all([...new Set(Object.values(shot.tracks ?? {}).flatMap((track) => (track.acts ?? []).map((act) => act.clip)))].map((id) => library.load(id)));
    // Actors, dressed in parallel.
    const rigs = await Promise.all(
      shot.actors.map((a) => (a.enemy ? createEnemyCrab(a.enemy) : (createCrab as (s: unknown, e?: string[]) => Promise<CrabRig>)(a.spec, a.extras ?? []))),
    );
    shot.actors.forEach((a, i) => {
      const rig = rigs[i];
      (rig as CrabRig & { useShadowProxy?: (on: boolean) => void }).useShadowProxy?.(true);
      if (a.scale) rig.root.scale.multiplyScalar(a.scale);
      const unit = (g as unknown as { addUnit(n: string, k: string, r: string, rig: CrabRig): Unit }).addUnit(a.id, a.enemy ? 'scavenger' : 'npc', 'friendly', rig);
      unit.targetable = false;
      unit.invulnerable = true;
      const [x, z] = a.at.length === 3 ? [a.at[0], a.at[2]] : a.at;
      unit.teleport(g.world, x, z, a.yaw ?? 0);
      if (a.at.length === 3) unit.pos.y = a.at[1];
      if (a.tint) unit.setBaseTint(a.tint);
      unit.measure();
      this.actors.set(a.id, { spec: a, unit, track: shot.tracks?.[a.id] ?? {}, y0: unit.pos.y, yaw: a.yaw ?? 0 });
    });
    for (const cue of shot.fx ?? []) {
      const e = makeEffect(cue, g.scene, (x, z) => g.world.heightAt(x, z));
      if (e) this.effects.push(e);
    }
    this.seek(0);
    return { actors: this.actors.size };
  }

  private setView(shot: ShotSpec): void {
    const v = shot.view ?? {};
    const opts: ViewOptions = {
      bloom: { intensity: v.bloom?.intensity ?? 0.9, threshold: v.bloom?.threshold ?? 0.9, radius: v.bloom?.radius },
      vignette: v.vignette === null ? null : { offset: v.vignette?.offset ?? 0.3, darkness: v.vignette?.darkness ?? 0.5 },
      exposure: v.exposure,
      saturation: v.saturation,
      contrast: v.contrast,
    };
    if (v.dof) opts.dof = { focusDistance: 10, focusRange: shot.cam.range ?? 6, bokehScale: v.bokeh ?? 2.5 };
    this.g.engine.setView(this.g.scene, this.g.camera, opts);
  }

  clear(): void {
    const g = this.g;
    for (const a of this.actors.values()) {
      const i = g.units.indexOf(a.unit);
      if (i >= 0) g.units.splice(i, 1);
      a.unit.dispose();
      a.unit.rig.root.removeFromParent();
    }
    this.actors.clear();
    for (const e of this.effects) e.dispose();
    this.effects = [];
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    if (this.worldFog !== undefined) {
      g.scene.fog = this.worldFog;
      this.worldFog = undefined;
    }
    this.vfx.clear();
    this.shot = null;
  }

  seek(t: number): void {
    this.t0 = t;
    this.anchor = performance.now();
    this.lastT = t - 1e-6;
    this.vfx.clear();
    for (const e of this.effects) e.reset?.();
    // Pick up what each actor was doing at t: its latest clip (from where it would be by now) and face.
    for (const a of this.actors.values()) {
      const act = (a.track.acts ?? []).filter((c) => c.t < t).sort((x, y) => x.t - y.t).pop();
      if (act) {
        const from = act.part ? act.from : (act.from ?? 0) + (t - act.t) * (act.speed ?? 1);
        a.unit.act(act.clip as never, { loop: act.loop, speed: act.speed, from, to: act.to, upper: act.upper, fade: 0, part: act.part });
      }
      const face = (a.track.faces ?? []).filter((f) => f.t < t).sort((x, y) => x.t - y.t).pop();
      if (face) a.unit.express(face.expr, face.hold ?? 99);
    }
  }

  get time(): number {
    return this.t0 + (performance.now() - this.anchor) / 1000;
  }

  probe(): { t: number; calls: number; triangles: number } {
    const info = this.g.engine.renderer.info.render;
    return { t: +this.time.toFixed(4), calls: info.calls, triangles: info.triangles };
  }

  // ------------------------------------------------------------------------------------ per frame

  /** A point spec at the current time. */
  point(p: Pt | unknown, out = new THREE.Vector3()): THREE.Vector3 {
    const g = this.g;
    if (Array.isArray(p)) return out.set(p[0], p[1], p[2]);
    const o = p as { g?: V3; a?: string; o?: V3; y0?: boolean; body?: boolean };
    if (o.g) return out.set(o.g[0], g.world.heightAt(o.g[0], o.g[2]) + o.g[1], o.g[2]);
    if (o.a) {
      const a = this.actors.get(o.a);
      if (!a) return out.set(0, 0, 0);
      const [lx, ly, lz] = o.o ?? [0, 0, 0];
      const u = a.unit;
      const s = Math.sin(u.yaw);
      const c = Math.cos(u.yaw);
      if (o.body) {
        u.rig.body.getWorldPosition(out);
        return out.add(new THREE.Vector3(lx * c + lz * s, ly, -lx * s + lz * c));
      }
      // Local x is the actor's left: (cos yaw, 0, -sin yaw); forward (sin yaw, 0, cos yaw).
      return out.set(u.pos.x + lx * c + lz * s, (o.y0 ? a.y0 : u.pos.y) + ly, u.pos.z - lx * s + lz * c);
    }
    return out.set(0, 0, 0);
  }

  private frame(dt: number): void {
    const shot = this.shot;
    if (!shot) return;
    const g = this.g;
    const t = this.time;
    this.overlayA = 0;
    if (shot.mood !== undefined) g.world.setMood(shot.mood, true);
    // Tidecrown's houses stream their near detail around the camera: catch up fast after a cut.
    const tc = g.world2.inTidecrown ? g.world2.tidecrown : undefined;
    if (tc && !tc.detailed) tc.refine(40);
    for (const a of this.actors.values()) this.drive(a, t, dt);
    // The hidden player stands where the shot is, so snowfall, footprints and streaming follow it.
    const anchor = shot.anchor ?? (shot.actors[0] ? [this.actors.get(shot.actors[0].id)!.unit.pos.x, this.actors.get(shot.actors[0].id)!.unit.pos.z] : null);
    if (anchor) {
      const pu = g.player.unit;
      pu.pos.set(anchor[0], g.world.heightAt(anchor[0], anchor[1]), anchor[1]);
    }
    // Shake the effects ask for lands on the next frame's camera.
    const shake = this.shakeAmp;
    this.shakeAmp = 0;
    this.placeCamera(shot, t, shake);
    const ctx: FxContext = {
      t,
      dt,
      camera: g.camera,
      scene: g.scene,
      vfx: this.vfx,
      point: (p) => this.point(p),
      ground: (x, z) => g.world.heightAt(x, z),
      overlay: (color, a) => {
        if (a > this.overlayA) {
          this.overlayA = a;
          this.overlayColor = color;
        }
      },
      shake: (amp) => (this.shakeAmp += amp),
      pxPerUnit: g.engine.renderer.getDrawingBufferSize(this.buf).y / (2 * Math.tan(THREE.MathUtils.degToRad(g.camera.fov / 2))),
    };
    for (const e of this.effects) e.update(ctx);
    this.vfx.update(dt);
    if (shot.fog) this.applyFog(shot);
    this.overlay.style.opacity = this.overlayA.toFixed(3);
    this.overlay.style.background = this.overlayColor;
    this.lastT = t;
  }

  private drive(a: Actor, t: number, dt: number): void {
    const g = this.g;
    const u = a.unit;
    const tr = a.track;
    const crossed = (at: number) => at > this.lastT && at <= t;
    if (tr.show) {
      let vis = true;
      for (const [at, on] of tr.show) if (at <= t) vis = on;
      u.hidden = !vis;
    }
    if (tr.path?.length) {
      const keys = tr.path;
      const pos = this.pathAt(keys, t, tr.ease ?? 'linear');
      const ahead = this.pathAt(keys, t + 0.05, tr.ease ?? 'linear');
      const dx = ahead.x - pos.x;
      const dz = ahead.z - pos.z;
      let yaw = a.yaw;
      if (pos.yaw !== undefined) yaw = pos.yaw;
      else if (Math.hypot(dx, dz) > 0.002) yaw = Math.atan2(dx, dz) + (tr.faceOffset ?? 0);
      a.yaw = yaw;
      u.pos.set(pos.x, g.world.heightAt(pos.x, pos.z) + pos.lift, pos.z);
      u.setYaw(yaw);
    }
    if (a.spec.align || a.spec.sink) this.settle(a, !tr.path?.length);
    u.feedLocomotion(dt);
    for (const c of tr.acts ?? []) {
      if (!crossed(c.t)) continue;
      u.act(c.clip as never, { loop: c.loop, speed: c.speed, from: c.from, to: c.to, upper: c.upper, fade: c.fade, part: c.part });
    }
    for (const f of tr.faces ?? []) if (crossed(f.t)) u.express(f.expr, f.hold ?? 99);
  }

  /**
   * Square an actor to the ground under it (ActorSpec.align) and sink it (ActorSpec.sink). The
   * normal is sampled across the actor's own footprint, so a big crab follows the hill, not a bump.
   */
  private settle(a: Actor, still: boolean): void {
    const g = this.g;
    const u = a.unit;
    const { x, z } = u.pos;
    const h = (px: number, pz: number) => g.world.heightAt(px, pz);
    if (still) u.pos.y = h(x, z);
    u.pos.y -= a.spec.sink ?? 0;
    const s = 0.8 * (a.spec.scale ?? 1);
    const n = this.v.set(-(h(x + s, z) - h(x - s, z)) / (2 * s), 1, -(h(x, z + s) - h(x, z - s)) / (2 * s)).normalize();
    n.lerp(UP, 1 - Math.min(1, Math.max(0, a.spec.align ?? 0))).normalize();
    const tilt = new THREE.Quaternion().setFromUnitVectors(UP, n);
    u.rig.root.quaternion.copy(tilt.multiply(new THREE.Quaternion().setFromAxisAngle(UP, a.yaw)));
  }

  /** Position, lift and (if keyed) facing along a path at t. */
  private pathAt(keys: PathKey[], t: number, ease: Ease): { x: number; z: number; lift: number; yaw?: number } {
    if (keys.length === 1) return { x: keys[0].x, z: keys[0].z, lift: keys[0].lift ?? 0, yaw: keys[0].yaw };
    const { a, b, p, n, k } = segment(keys, t, ease);
    const spline = keys.length > 2;
    const lerp = (x: number, y: number) => x + (y - x) * k;
    const x = spline ? cr(p.x, a.x, b.x, n.x, k) : lerp(a.x, b.x);
    const z = spline ? cr(p.z, a.z, b.z, n.z, k) : lerp(a.z, b.z);
    const lift = lerp(a.lift ?? 0, b.lift ?? 0);
    let yaw: number | undefined;
    if (a.yaw !== undefined && b.yaw !== undefined) yaw = a.yaw + wrap(b.yaw - a.yaw) * EASE.smooth(k);
    else if (a.yaw !== undefined && (b.yaw === undefined && k === 0)) yaw = a.yaw;
    return { x, z, lift, yaw };
  }

  private placeCamera(shot: ShotSpec, t: number, shake: number): void {
    const cam = this.g.camera;
    const keys = shot.cam.keys;
    const { a, b, p, n, k } = segment<CamKey>(keys, t, shot.cam.ease ?? 'inout');
    const spline = shot.cam.spline !== false && keys.length > 2;
    const P = (key: CamKey, which: 'p' | 'l') => this.point(key[which]);
    const mix = (which: 'p' | 'l') => {
      const pa = P(a, which);
      const pb = P(b, which);
      if (!spline) return pa.lerp(pb, k);
      const pp = P(p, which);
      const pn = P(n, which);
      return new THREE.Vector3(cr(pp.x, pa.x, pb.x, pn.x, k), cr(pp.y, pa.y, pb.y, pn.y, k), cr(pp.z, pa.z, pb.z, pn.z, k));
    };
    const pos = mix('p');
    const look = mix('l');
    const fov = (a.fov ?? 40) + ((b.fov ?? a.fov ?? 40) - (a.fov ?? 40)) * k;
    const roll = (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * k;
    const amp = (shot.cam.shake ?? 0) + shake;
    if (amp > 0) {
      pos.x += amp * (Math.sin(t * 13.1) * 0.6 + Math.sin(t * 29.3 + 1) * 0.4);
      pos.y += amp * (Math.sin(t * 17.7 + 2) * 0.6 + Math.sin(t * 37.1) * 0.4) * 0.7;
      pos.z += amp * (Math.sin(t * 11.3 + 4) * 0.6 + Math.sin(t * 23.9 + 3) * 0.4);
    }
    cam.position.copy(pos);
    // Roll about the view axis: tilt "up" around the forward direction.
    const fwd = look.clone().sub(pos).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(fwd, -roll);
    cam.up.copy(up);
    cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const [jx, jy] = this.jitter;
    if (jx || jy) {
      const s = this.g.engine.renderer.getDrawingBufferSize(this.buf);
      cam.setViewOffset(s.x, s.y, jx, jy, s.x, s.y);
    } else if (cam.view?.enabled) cam.clearViewOffset();
    cam.updateMatrixWorld();
    const focus = shot.cam.focus ?? 'look';
    if (shot.view?.dof) {
      let d: number;
      if (typeof focus === 'number') d = focus;
      else if (focus === 'look') d = pos.distanceTo(look);
      else {
        const act = this.actors.get(focus);
        d = act ? pos.distanceTo(this.v.copy(act.unit.pos).add(new THREE.Vector3(0, act.unit.height * 0.6, 0))) : pos.distanceTo(look);
      }
      this.g.engine.setFocus(d, shot.cam.range ?? 6);
    }
  }

  private applyFog(shot: ShotSpec): void {
    const f = shot.fog!;
    const scene = this.g.scene;
    if (this.worldFog === undefined) this.worldFog = scene.fog;
    // A fog object of the shot's own, so the world's is untouched when it comes back.
    const want = f.density !== undefined ? THREE.FogExp2 : THREE.Fog;
    if (!(this.myFog instanceof want)) this.myFog = f.density !== undefined ? new THREE.FogExp2(f.color, f.density) : new THREE.Fog(f.color, f.near ?? 10, f.far ?? 200);
    const fog = this.myFog;
    if (fog instanceof THREE.FogExp2) fog.density = f.density ?? fog.density;
    else {
      fog.near = f.near ?? 10;
      fog.far = f.far ?? 200;
    }
    fog.color.set(f.color);
    scene.fog = fog;
  }
}

const stage = new CinemaStage();
(window as unknown as { __cinema: CinemaStage }).__cinema = stage;
export default stage;
