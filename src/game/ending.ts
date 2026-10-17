// The celebration: the whole town gathers in a ring around the player in Clawhaven Square, every
// crab plays the recorded dances, fireworks burst over the bay, the camera orbits slowly with
// depth of field, then the credits roll.
import * as THREE from 'three';
import {t as tr} from '../i18n';
import type { MotionId } from '../motion/types';
import type { Game } from './game';
import type { Unit } from './unit';
import { ENDING_BARKS } from './quests';
import { C } from './vfx/vfx';
import { easeInOut, pick, rand, yawTo } from './util';

const DANCES: MotionId[] = ['dance_crab', 'dance_brazilian', 'dance_dream_wings', 'dance_maze'];
const FIREWORK_COLORS = [C.gold, C.redHot, C.water, C.purple, C.green, C.holy];
const LENGTH = 30;

/** Two staggered rings so the whole town fits around the hero in a small square. */
function ringSlots(n: number): { a: number; r: number }[] {
  const inner = Math.ceil(n / 2);
  const out: { a: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ring = i < inner ? 0 : 1;
    const k = ring === 0 ? i : i - inner;
    const m = ring === 0 ? inner : n - inner;
    out.push({ a: ((k + (ring ? 0.5 : 0)) / m) * Math.PI * 2, r: ring ? 6.4 : 4.2 });
  }
  return out;
}

export class EndingSequence {
  active = false;
  private t = 0;
  private started = false;
  private nextFirework = 0;
  private nextBark = 0;
  private dancers: Unit[] = [];
  private crowdHomes: { unit:Unit; x:number; z:number; yaw:number }[] = [];
  private centre = new THREE.Vector3();
  private orbit0 = 0;
  private finishing = false;
  private captionIndex = -1;
  private mode:'chapter'|'final'='final';
  private onFinished:(()=>void)|null=null;
  private sequence = 0;

  constructor(private readonly game: Game) {}

  async start(mode:'chapter'|'final'='final',onFinished?:()=>void): Promise<void> {
    if (this.active) return;
    const g = this.game;
    const sequence = ++this.sequence;
    this.started = false;
    this.active = true;this.mode=mode;this.onFinished=onFinished??null;this.finishing=false;this.captionIndex=-1;
    g.journey?.closeChapterEnding();
    g.world2.showEpilogue();
    g.hud.dialogue.close();
    g.hud.questLog.toggle(false);
    g.player.setTarget(null);
    g.hud.setCinematic(true);
    g.say(g.npcById('brinebeard')!.unit, tr('클로헤이븐 주민들! 모이게! 우리의 영웅이 돌아왔어!','Clawhaven! Gather round! Our hero is back!'), true);
    if (g.musicOn) void g.audio.playMusic('music-ending', 2.5);
    await g.app.blackout(true, 1100);
    if (!g.alive || sequence !== this.sequence) return;
    // Under the black: drop any dialogue shot and its long lens before the ending camera takes over.
    g.follow.cut();

    g.world.setMood(2);
    g.world.setBeaconLit(true);g.beaconLit=true;
    for (const e of g.enemies) if (e.state !== 'gone') e.despawn();
    for (const a of g.boss.adds) a.despawn();

    const spawn = g.world.pois.spawn;
    const p = g.player.unit;
    // Everyone in town, every race.
    const crowd = [...g.npcs.map((n) => n.unit), ...g.townsfolk.map((t) => t.unit),...(this.mode==='final'&&g.journey?.finalCleared?[g.dawnBoss.freed]:[])];
    this.crowdHomes = crowd.map(unit=>({unit,x:unit.pos.x,z:unit.pos.z,yaw:unit.yaw}));
    const n = crowd.length;
    const slots = ringSlots(n);
    const c = this.openSquare(spawn.position, spawn.yaw, slots);
    p.motion.stop(undefined, 0);
    p.teleport(g.world, c.x, c.z, spawn.yaw);
    this.centre.copy(p.pos);

    crowd.forEach((u, i) => {
      const s = slots[i];
      const x = this.centre.x + Math.sin(s.a + spawn.yaw) * s.r;
      const z = this.centre.z + Math.cos(s.a + spawn.yaw) * s.r;
      u.hidden = false;
      u.motion.stop(undefined, 0);
      u.teleport(g.world, x, z, yawTo(x, z, this.centre.x, this.centre.z));
    });
    this.dancers = [p, ...crowd];
    this.dancers.forEach((u, i) => {
      u.express(i % 3 === 0 ? 'love' : 'happy', 60);
      u.act(DANCES[i % DANCES.length], { loop: true, fade: 0.3, speed: rand(0.95, 1.05) });
    });
    this.orbit0 = spawn.yaw + Math.PI * 0.85;
    g.engine.setView(g.scene, g.camera, {
      bloom: { intensity: 1.15, threshold: 0.8 },
      dof: { focusDistance: 9, focusRange: 7, bokehScale: 2.2 },
      vignette: { offset: 0.25, darkness: 0.65 },
      saturation: 0.08,
    });
    this.t = 0;
    this.started = true;
    this.nextFirework = 1.2;
    this.nextBark = 2.5;
    this.placeCamera(0);
    await g.app.blackout(false, 1400);
  }

  /** Shared travel can end a guest's celebration before its local dance has finished. */
  cancel(): void {
    if (!this.active) return;
    ++this.sequence;
    this.active = this.started = false;
    this.onFinished = null;
    const g = this.game;
    for (const u of this.dancers) u.motion.stop(undefined, .3);
    this.dancers = [];
    for (const home of this.crowdHomes) home.unit.teleport(g.world,home.x,home.z,home.yaw);
    this.crowdHomes = [];
    g.hud.setCaption('');g.hud.showSkip(false);g.hud.setCinematic(false);
    g.follow.cut();
    g.resumeAfterEnding();
    // Invalidate the pre-dance blackout too; its late continuation checks sequence.
    void g.app.blackout(false, 0);
  }

  /** A spot near the square where the whole ring fits on open, level ground (fountains get in the way). */
  private openSquare(base: THREE.Vector3, yaw: number, slots: { a: number; r: number }[]): THREE.Vector3 {
    const w = this.game.world;
    const tmp = new THREE.Vector2();
    let best = base.clone();
    let bestScore = -Infinity;
    for (const dist of [0, 4, 8, 12]) {
      for (let k = 0; k < (dist === 0 ? 1 : 8); k++) {
        const a = yaw + (k / 8) * Math.PI * 2;
        const cx = base.x + Math.sin(a) * dist;
        const cz = base.z + Math.cos(a) * dist;
        const y0 = w.heightAt(cx, cz);
        let score = -dist * 0.6;
        for (const s of slots) {
          const x = cx + Math.sin(s.a + yaw) * s.r;
          const z = cz + Math.cos(s.a + yaw) * s.r;
          const r = w.resolveCollision(x, z, 0.6, tmp);
          const blocked = Math.hypot(r.x - x, r.y - z) > 0.05 || Math.abs(w.heightAt(x, z) - y0) > 0.6;
          score += blocked ? -1 : 1;
        }
        const own = w.resolveCollision(cx, cz, 0.6, tmp);
        if (Math.hypot(own.x - cx, own.y - cz) > 0.05) score -= slots.length;
        if (score > bestScore) {
          bestScore = score;
          best = new THREE.Vector3(cx, y0, cz);
        }
      }
    }
    return best;
  }

  private placeCamera(t: number): void {
    const g = this.game;
    // Start high and wide over the ring, then settle inside it at crab height.
    const k = easeInOut(Math.min(1, t / 12));
    const r = 11 - 7 * k;
    const hgt = 6.5 - 4 * k;
    const a = this.orbit0 + t * 0.16;
    const cam = g.camera;
    cam.position.set(this.centre.x + Math.sin(a) * r, this.centre.y + hgt, this.centre.z + Math.cos(a) * r);
    cam.lookAt(this.centre.x, this.centre.y + 0.9 + (1 - k) * 0.6, this.centre.z);
    g.engine.setFocus(cam.position.distanceTo(this.centre), 6 + (1 - k) * 5);
  }

  update(dt: number): void {
    if (!this.active || !this.started) return;
    const g = this.game;
    this.t += dt;
    const t = this.t;
    this.placeCamera(t);

    const captions = this.mode==='chapter' ? [[1.5,tr('심해의 왕관을 되찾았습니다. 해안에 평화가 돌아왔어요.','The deep-sea crown is reclaimed. Peace has returned to the shore.')],[8,tr('온 마을의 게들이 영웅과 함께 춤을 춥니다.','The whole village dances with its hero.')],[15,tr('함께 모험해 줘서 고마워요!','Thank you for sharing this adventure!')],[22.5,tr('첫 번째 모험의 끝 · 별빛 너머에는 새로운 섬이 기다립니다.','The first adventure ends. Beyond the stars, a new island awaits.')]] as const : [
      [1.5, tr('솔라칸을 물리치고 친구 미라를 구했습니다. 세 섬에 새 아침이 밝았어요.','Solarkan is defeated and Mira is free. Dawn returns to all three islands.')],
      [8, tr('돌아온 친구와 네 왕관의 영웅을 위해, 온 마을이 함께 춤을 춥니다.','The village dances for its rescued friend and the hero of four crowns.')],
      [15, tr('잊힌 별의 섬은 더 이상 혼자가 아닙니다. 우리의 모험은 전설이 되었습니다.','The Isle of Forgotten Stars is no longer alone. Our adventure has become a legend.')],
      [22.5, tr(`TRUE ENDING · 함께해 줘서 고마워요, ${g.player.unit.name}.`,`TRUE ENDING · Thank you for joining us, ${g.player.unit.name}.`)],
    ] as const;
    let idx = -1;
    for (let i = 0; i < captions.length; i++) if (t >= captions[i][0]) idx = i;
    if (idx !== this.captionIndex) {
      this.captionIndex = idx;
      g.hud.setCaption(idx >= 0 ? captions[idx][1] : '');
    }
    if (t > 4) g.hud.showSkip(true);

    if (t >= this.nextFirework) {
      this.nextFirework = t + rand(0.5, 1.3);
      // Over the bay, and now and then right above the square so the camera always catches some.
      const sea = g.seaDirection();
      const a = Math.random() * Math.PI * 2;
      const base = Math.random() < 0.5 ? this.centre.clone().addScaledVector(sea, rand(16, 34)) : this.centre.clone().add(new THREE.Vector3(Math.cos(a) * rand(14, 24), 0, Math.sin(a) * rand(14, 24)));
      base.y = g.world.heightAt(base.x, base.z);
      g.vfx.firework(base, pick(FIREWORK_COLORS), rand(7, 12));
      if (Math.random() < 0.4) g.audio.sfx('sfx-crit', { volume: 0.25, delay: 1.2 });
    }
    if (t >= this.nextBark && this.dancers.length > 1) {
      this.nextBark = t + rand(1.6, 3.2);
      g.say(pick(this.dancers.slice(1)), pick(ENDING_BARKS.map((line,i)=>tr(['만세!','다 같이 춤춰요!','내 다리 조심!','빛이 돌아왔어!','최고의 밤이야!','꿈은 아니겠지?'][i],line))));
    }
    const skip = t > 4 && (g.input.wasPressed('Space') || g.input.wasPressed('Escape') || g.input.wasPressed('Enter'));
    if ((t >= LENGTH || skip) && !this.finishing) {
      this.finishing = true;
      if(this.mode==='chapter'){
        const finished = this.onFinished;
        this.cancel();
        finished?.();
      }else void g.app.go('ending', { name: g.player.unit.name, musicOn: g.musicOn });
    }
  }
}
