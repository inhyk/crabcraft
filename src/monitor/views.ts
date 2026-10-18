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

type Actor = { player: MonitorPlayer; unit: Unit | null; dance: BreakRoutine | null; seq: number; loading: boolean; failed: boolean };
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
  private goal = new THREE.Vector3();
  private aim = new THREE.Vector3();
  paused = false;

  constructor() {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(480, 270, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    initAssets(this.renderer);
    this.frame = requestAnimationFrame(t => this.render(t));
  }

  sync(players: MonitorPlayer[], tiles: Map<string, Tile>) {
    this.tiles = tiles;
    const ids = new Set(players.map(p => p.id));
    for (const [id, actor] of this.actors) if (!ids.has(id)) {
      actor.unit?.rig.root.removeFromParent(); actor.unit?.dispose(); this.actors.delete(id);
    }
    for (const player of players) {
      const existing = this.actors.get(player.id);
      if (existing) { existing.player = player; continue; }
      this.actors.set(player.id, { player, unit: null, dance: null, seq: 0, loading: false, failed: false });
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
    // Bound GPU work, including high-refresh displays. No offscreen or background rendering.
    if (document.hidden || this.paused || time - this.last < 1000 / 12) return;
    const dt = Math.min(.12, (time - this.last) / 1000); this.last = time;
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
      const s = p.state;
      this.goal.set(s.x, s.y, s.z);
      u.pos.lerp(this.goal, u.pos.distanceToSquared(this.goal) > 100 ? 1 : 1 - Math.exp(-12 * dt));
      u.setYaw(u.yaw + Math.atan2(Math.sin(s.yaw - u.yaw), Math.cos(s.yaw - u.yaw)) * (1 - Math.exp(-12 * dt)));
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
    for (const [id, tile] of visible) {
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
      const width = Math.min(640, Math.max(240, Math.round(tile.canvas.clientWidth))), height = Math.round(width * 9 / 16);
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

  clear() {
    this.sync([], new Map());
  }

  dispose() {
    this.stopped = true; cancelAnimationFrame(this.frame); this.clear();
    for (const stage of this.stages.values()) stage.value?.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}
