import * as THREE from 'three';
import { initAssets } from '../core/assets';
import { createCrab } from '../crab/provider';
import type { CrabSpec } from '../crab/types';
import { createMotionController } from '../motion/provider';
import type { MotionId } from '../motion/types';
import { Unit } from '../game/unit';
import { BreakRoutine } from '../game/breakdance';
import { ROUTINE } from '../motion/breakdance';
import type { MonitorPlayer } from '../../server/monitor';
import { scenery, type Scenery } from './scenery';

type Sample = { t: number; x: number; y: number; z: number; yaw: number };
type Actor = { player: MonitorPlayer; unit: Unit | null; dance: BreakRoutine | null; seq: number; loading: boolean; failed: boolean; samples: Sample[] };
/** Feeds show where a player was this long ago, so there are always two received positions to move between. */
const DELAY = 300;
/** The empty-server view circles Clawhaven's plaza: radius and height in metres, one turn in this many seconds. */
const TOWN_VIEW = { x: 8, z: 0, radius: 88, height: 36, turn: 240 };
type Tile = { canvas: HTMLCanvasElement; message: HTMLElement };
type Stage = { value?: Scenery; error?: boolean };

/** One WebGL context shared by every tile. Only visible tiles are rendered. */
export class Views {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  private camera = new THREE.PerspectiveCamera(48, 16 / 9, .1, 1800);
  private actors = new Map<string, Actor>();
  private tiles = new Map<string, Tile>();
  private stages = new Map<number, Stage>();
  private stopped = false;
  private last = 0;
  private frame = 0;
  private turn = 0;
  /** Server clock minus this browser's clock, from each snapshot's `at`. */
  private offset: number | null = null;
  private here = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private aim = new THREE.Vector3();
  paused = false;
  /** Drawn only while there are no tiles: the World I town from a slowly circling camera. */
  panorama: HTMLCanvasElement | null = null;

  constructor() {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(480, 270, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    initAssets(this.renderer);
    this.frame = requestAnimationFrame(t => this.render(t));
  }

  sync(players: MonitorPlayer[], tiles: Map<string, Tile>, at = Date.now()) {
    this.tiles = tiles;
    const offset = at - Date.now();
    this.offset = this.offset === null ? offset : this.offset + (offset - this.offset) * .2;
    const ids = new Set(players.map(p => p.id));
    for (const [id, actor] of this.actors) if (!ids.has(id)) {
      actor.unit?.rig.root.removeFromParent(); actor.unit?.dispose(); this.actors.delete(id);
    }
    for (const player of players) {
      const existing = this.actors.get(player.id);
      const actor = existing ?? { player, unit: null, dance: null, seq: 0, loading: false, failed: false, samples: [] };
      if (!existing) this.actors.set(player.id, actor);
      actor.player = player;
      const s = player.state, last = actor.samples.at(-1);
      if (!s || !player.updatedAt) { actor.samples = []; continue; }
      if (!last || player.updatedAt > last.t) {
        actor.samples.push({ t: player.updatedAt, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
        if (actor.samples.length > 12) actor.samples.shift();
      }
    }
  }

  private loadActor(actor: Actor) {
    // The marker also prevents duplicate asynchronous loads.
    actor.loading = true;
    void createCrab(actor.player.spec as CrabSpec).then(rig => {
      if (this.stopped || this.actors.get(actor.player.id) !== actor) { rig.dispose(); return; }
      const unit = new Unit(actor.player.spec.name, 'remote', 'friendly', rig, createMotionController(rig));
      actor.unit = unit; actor.dance = new BreakRoutine(unit); actor.loading = false;
      const s = actor.player.state;
      if (s) { unit.pos.set(s.x, s.y, s.z); unit.setYaw(s.yaw); }
    }).catch(() => { actor.loading = false; actor.failed = true; });
  }

  private stage(area: number) {
    let stage = this.stages.get(area);
    if (!stage) {
      stage = {}; this.stages.set(area, stage);
      const target = stage;
      void scenery(area, this.renderer).then(value => {
        if (this.stopped) { value.dispose(); return; }
        target.value = value;
      }).catch(() => { target.error = true; });
    }
    return stage;
  }

  private render(time: number) {
    if (this.stopped) return;
    this.frame = requestAnimationFrame(t => this.render(t));
    // Bound GPU work, including high-refresh displays: smooth for a few feeds, lighter for a full wall.
    const fps = this.tiles.size <= 4 ? 30 : this.tiles.size <= 9 ? 20 : 12;
    if (document.hidden || this.paused || time - this.last < 1000 / fps - 2) return;
    const dt = Math.min(.12, (time - this.last) / 1000); this.last = time;
    if (this.panorama && !this.tiles.size) { this.drawTown(this.panorama, dt, time); return; }
    const visible = [...this.tiles].filter(([, tile]) => {
      const r = tile.canvas.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
    const rooms = new Set(visible.map(([id]) => this.actors.get(id)?.player.room));
    for (const actor of this.actors.values()) {
      const { player: p, unit: u } = actor;
      if (!rooms.has(p.room) || !p.state || !p.area) continue;
      if (!u) { if (!actor.loading && !actor.failed) this.loadActor(actor); continue; }
      const stage = this.stage(p.area).value;
      if (stage && u.rig.root.parent !== stage.scene) stage.scene.add(u.rig.root);
      const s = p.state, yaw = this.place(actor, this.here);
      u.pos.copy(this.here); u.setYaw(yaw);
      u.hp = s.hp; u.maxHp = s.maxHp; u.alive = s.alive;
      u.feedLocomotion(dt);
      if (p.action && p.action.seq !== actor.seq) {
        actor.seq = p.action.seq;
        if (Date.now() - p.action.at < 2000) {
          const index = ROUTINE.findIndex(step => step.id === p.action!.name);
          if (p.action.name === 'breakdance_stop') actor.dance?.cancel();
          else if (index >= 0) actor.dance?.follow(index);
          else { actor.dance?.cancel(); u.act(p.action.name as MotionId); }
        }
      }
      actor.dance?.update(dt); u.updateVisual(dt);
    }
    // A wall of many feeds shares the frame budget: the biggest tile (an expanded one) every frame, the rest in turn.
    const order = [...visible].sort(([, a], [, b]) => b.canvas.clientWidth * b.canvas.clientHeight - a.canvas.clientWidth * a.canvas.clientHeight);
    const budget = 9, rest = order.slice(1), start = rest.length ? this.turn % rest.length : 0;
    const drawn = order.length <= budget ? order : [order[0]!, ...[...rest.slice(start), ...rest.slice(0, start)].slice(0, budget - 1)];
    this.turn += budget - 1;
    for (const [id, tile] of drawn) {
      const actor = this.actors.get(id), p = actor?.player;
      if (!p?.state || !p.area) { tile.message.textContent = '위치 수신 대기'; continue; }
      const stage = this.stage(p.area);
      if (!stage.value || !actor?.unit) {
        tile.message.textContent = stage.error || actor?.failed ? '관전 화면을 불러오지 못했습니다. 새로고침해 주세요.' : '관전 화면 준비 중';
        continue;
      }
      tile.message.textContent = '';
      // Separate shards/rooms may occupy the same coordinates. Never mix their actors in a tile.
      for (const other of this.actors.values()) if (other.unit) other.unit.rig.root.visible = other.player.room === p.room && other.player.area === p.area && !!other.player.state;
      const u = actor.unit;
      // Cells on the wall are not all 16:9; the picture takes the cell's own shape.
      const cw = tile.canvas.clientWidth || 480, ch = tile.canvas.clientHeight || 270;
      const width = Math.min(800, Math.max(120, Math.round(cw))), height = Math.max(68, Math.round(width * ch / cw));
      if (tile.canvas.width !== width || tile.canvas.height !== height) { tile.canvas.width = width; tile.canvas.height = height; }
      this.renderer.setSize(width, height, false);
      this.aim.copy(u.pos).y += 1;
      this.camera.position.set(u.pos.x - Math.sin(u.yaw) * 10, u.pos.y + 7, u.pos.z - Math.cos(u.yaw) * 10);
      this.camera.position.y = Math.max(this.camera.position.y, stage.value.height(this.camera.position.x, this.camera.position.z) + 2);
      const hit = stage.value.raycast(this.aim, this.camera.position);
      if (hit !== null) {
        this.goal.copy(this.camera.position).sub(this.aim);
        this.camera.position.copy(this.aim).addScaledVector(this.goal, Math.max(.6, hit - .45) / this.goal.length());
      }
      this.camera.aspect = width / height; this.camera.lookAt(this.aim); this.camera.updateProjectionMatrix();
      stage.value.update(dt, time / 1000, this.camera, u.pos);
      this.renderer.render(stage.value.scene, this.camera);
      tile.canvas.getContext('2d')?.drawImage(this.renderer.domElement, 0, 0);
    }
  }

  private drawTown(canvas: HTMLCanvasElement, dt: number, time: number) {
    const stage = this.stage(1).value;
    if (!stage) return;
    const cw = canvas.clientWidth || 1280, ch = canvas.clientHeight || 720;
    const width = Math.min(1280, Math.max(320, Math.round(cw))), height = Math.max(180, Math.round(width * ch / cw));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    this.renderer.setSize(width, height, false);
    const v = TOWN_VIEW, angle = time / 1000 / v.turn * Math.PI * 2;
    this.aim.set(v.x, stage.height(v.x, v.z) + 2, v.z);
    const x = v.x + Math.sin(angle) * v.radius, z = v.z + Math.cos(angle) * v.radius;
    this.camera.position.set(x, Math.max(this.aim.y + v.height, stage.height(x, z) + 12), z);
    this.camera.aspect = width / height; this.camera.lookAt(this.aim); this.camera.updateProjectionMatrix();
    stage.update(dt, time / 1000, this.camera, this.aim);
    this.renderer.render(stage.scene, this.camera);
    canvas.getContext('2d')?.drawImage(this.renderer.domElement, 0, 0);
  }

  /** Position between the two received samples around (now - DELAY) on the server clock; holds the newest when late. */
  private place(actor: Actor, out: THREE.Vector3): number {
    const list = actor.samples, s = actor.player.state!;
    if (!list.length) { out.set(s.x, s.y, s.z); return s.yaw; }
    const t = Date.now() + (this.offset ?? 0) - DELAY;
    let i = list.length - 1;
    while (i > 0 && list[i - 1]!.t > t) i--;
    const b = list[i]!, a = list[Math.max(0, i - 1)]!;
    if (t >= b.t || a === b) { out.set(b.x, b.y, b.z); return b.yaw; }
    if (t <= a.t) { out.set(a.x, a.y, a.z); return a.yaw; }
    // A jump of more than 30 m between samples is a teleport or portal: no sliding across the map.
    if ((b.x - a.x) ** 2 + (b.z - a.z) ** 2 > 900) { out.set(b.x, b.y, b.z); return b.yaw; }
    const k = (t - a.t) / (b.t - a.t);
    out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    return a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * k;
  }

  clear() {
    this.sync([], new Map());
  }

  dispose() {
    this.stopped = true; cancelAnimationFrame(this.frame); this.clear();
    for (const stage of this.stages.values()) stage.value?.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}
