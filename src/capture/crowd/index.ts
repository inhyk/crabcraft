// The crowd capture scene (dev server, `?capture=1&screen=crowd` only; a production build leaves
// it out): Clawhaven with a formation of hundreds of crabs dancing the recorded Jumper clips to a
// program a capture script loads (tools/crowd/capture.mjs). Everything on screen is a function of
// the song clock the script sets with seek(): the crabs' poses, the camera, the flashes and the
// world's own animation, so a shot renders the same however it is reached.
//
// window.__crowd:
//   load(program, { layout })  build the formation and load its clips; resolves with stats
//   seek(t)                    put the song clock at t seconds (it then runs with the page clock)
//   time                       the song clock now
//   probe()                    the song clock, the shot, draw calls and triangles of the last frame
import * as THREE from 'three';
import type { App } from '../../app';
import { Vfx } from '../../game/vfx/vfx';
import { createWorld } from '../../world/index';
import type { World } from '../../world/types';
import { placeCamera } from './camera';
import { Crowd } from './crowd';
import { normalizeProgram, type CrowdProgram, type Fx } from './program';
import { buildDeck, type Deck } from './stage';

export interface CrowdApi {
  ready: boolean;
  load(program: CrowdProgram, opts?: { layout?: 'land' | 'port' }): Promise<CrowdStats>;
  seek(t: number): void;
  readonly time: number;
  probe(): { t: number; shot: number; calls: number; triangles: number };
  crowd: Crowd | null;
  world: World;
  camera: THREE.PerspectiveCamera;
}

export interface CrowdStats {
  crabs: number;
  clips: string[];
  site: { x: number; z: number; yaw: number; y: number };
  loadSeconds: number;
}

const VIEW = {
  bloom: { intensity: 0.95, threshold: 0.88 },
  dof: { focusDistance: 20, focusRange: 40, bokehScale: 2.2 },
  vignette: { offset: 0.3, darkness: 0.5 },
};

/** The stage lights' level at t: each 'lights' effect ramps from the level before it. */
function lightLevel(p: CrowdProgram, t: number): number {
  let level = 0;
  for (const fx of p.fx ?? []) {
    if (fx.kind !== 'lights' || fx.at > t) continue;
    const k = Math.min(1, (t - fx.at) / Math.max(1e-3, fx.d ?? 1.2));
    level += (fx.level - level) * k;
  }
  return level;
}

/** Flare of the last pulse at or before t, 1 on it and decaying. */
function pulseAt(pulses: number[] | undefined, t: number): number {
  if (!pulses?.length) return 0;
  let last = -Infinity;
  for (const k of pulses) if (k <= t && k > last) last = k;
  return Number.isFinite(last) ? Math.exp(-(t - last) / 0.12) : 0;
}

export async function startCrowdScene(app: App): Promise<void> {
  const engine = app.engine;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 3000);
  const world = await createWorld({ renderer: engine.renderer, scene, quality: engine.quality });
  engine.setView(scene, camera, VIEW);
  const vfx = new Vfx(scene);
  // Fireworks over the bay burst far behind a crowd hundreds strong: their own effects layer, three
  // times the game's size (spread, climb and fall; the sparks keep their size on screen).
  const sky = new Vfx(scene);
  const SKY_SCALE = 3;
  sky.group.scale.setScalar(SKY_SCALE);
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:40';
  app.overlay.append(flash);

  let crowd: Crowd | null = null;
  let deck: Deck | null = null;
  let program: CrowdProgram | null = null;
  let port = false;
  let t0 = 0;
  let anchor = performance.now();
  let lastT = 0;
  let shot = 0;
  const songTime = () => t0 + (performance.now() - anchor) / 1000;

  const fire = (fx: Fx, now: number) => {
    if (!crowd) return;
    if (fx.kind === 'firework') {
      const p = crowd.toWorld(fx.p[0], fx.p[1], fx.p[2]).sub(sky.group.position).divideScalar(SKY_SCALE);
      sky.firework(p, new THREE.Color(fx.color ?? '#ffd76a').multiplyScalar(1.6), (fx.height ?? 18) / SKY_SCALE);
    } else if (fx.kind === 'mood') world.setMood(fx.mood);
    else if (fx.kind === 'beacon') world.setBeaconLit(fx.on);
    void now;
  };

  engine.onFrame((f) => {
    if (!crowd || !program) {
      world.update(f.dt, f.elapsed, camera);
      return;
    }
    const t = songTime();
    const st = placeCamera(camera, crowd, program.shots, t, port);
    shot = st.shot;
    engine.setFocus(st.focus, st.focusRange);
    const pxPerUnit = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.updateMatrixWorld();
    crowd.update(t, f.dt, camera, pxPerUnit);
    for (const fx of program.fx ?? []) if (fx.at > lastT && fx.at <= t) fire(fx, t);
    let a = 0;
    for (const fx of program.fx ?? []) if (fx.kind === 'flash' && t >= fx.at && t < fx.at + fx.d) a = Math.max(a, fx.a * (1 - (t - fx.at) / fx.d));
    flash.style.opacity = a.toFixed(3);
    lastT = t;
    if (deck) {
      const level = lightLevel(program, t);
      const pulse = pulseAt(program.pulses, t);
      for (const s of deck.spots) s.intensity = deck.spotIntensity * level * (1 + 0.9 * pulse);
      // A torch right at the lens would fill the frame with its glow.
      for (const m of deck.flameMeshes) m.visible = m.position.distanceTo(camera.position) > 7;
    }
    vfx.update(f.dt);
    sky.update(f.dt);
    // The world's water, clouds and sway run on the song clock too.
    world.update(f.dt, 1000 + t, camera);
  });

  const api: CrowdApi = {
    ready: true,
    crowd: null,
    world,
    camera,
    async load(given, opts = {}) {
      const start = performance.now();
      const p = normalizeProgram(given);
      crowd?.dispose();
      deck?.group.removeFromParent();
      deck = null;
      program = p;
      port = opts.layout === 'port';
      crowd = new Crowd(p, world);
      api.crowd = crowd;
      if (p.deck) {
        deck = await buildDeck(crowd, p.deck);
        scene.add(deck.group);
        const d = deck;
        crowd.setGround((x, z) => d.heightAt(x, z), p.deck.y);
      }
      scene.add(crowd.group);
      await crowd.load();
      sky.group.position.copy(crowd.toWorld(0, 0, 0));
      api.seek(0);
      const site = p.site ?? { x: 0, z: 0, yaw: 0 };
      return {
        crabs: crowd.crabs.length,
        clips: [...new Set(p.cues.map((c) => c.clip))],
        site: { ...site, y: crowd.groundAt(0, 0) },
        loadSeconds: (performance.now() - start) / 1000,
      };
    },
    seek(t) {
      t0 = t;
      anchor = performance.now();
      lastT = t;
      if (program && crowd) {
        // Snap to the mood and the beacon in force at t (both otherwise ease in over seconds).
        for (const kind of ['mood', 'beacon']) {
          const last = (program.fx ?? []).filter((f) => f.kind === kind && f.at <= t).pop();
          if (last) fire(last, t);
        }
        vfx.clear();
        sky.clear();
      }
    },
    get time() {
      return songTime();
    },
    probe() {
      const info = engine.renderer.info.render;
      return { t: +songTime().toFixed(4), shot, calls: info.calls, triangles: info.triangles };
    },
  };
  (window as unknown as { __crowd: CrowdApi }).__crowd = api;
  await app.blackout(false, 0);
}
