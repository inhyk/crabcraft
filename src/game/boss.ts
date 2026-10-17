// Corrodius, the Rust Tyrant (docs/design.md "Boss fight"). Three phases, telegraphed Anchor Slam,
// Rust Spray cone with a stacking slow, Scrapling adds and Undertow in phase 2, enrage in phase 3,
// and the death sequence where a small red crab steps out of the armour and walks into the sea.
import type { BossState } from '../../server/combatProtocol';
import {t} from '../i18n';
import {bossWarning} from './bossLocale';
import * as THREE from 'three';
import type { Poi } from '../world/types';
import type { Game } from './game';
import type { Unit } from './unit';
import type { Enemy } from './enemies';
import { skillDelay, skillWindow } from '../motion/skills';
import { BOSS_YELLS } from './quests';
import { BOSS_PROFILES, type BossProfile } from './progression';
import { C } from './vfx/vfx';
import type { Fx } from './vfx/effects';
import { angleDiff, rand, turnToward, yawTo } from './util';

export const BOSS_HP = 1300;
/** How far past the arena edge the player may kite before Corrodius gives up (after a grace period). */
const ARENA_LEASH = 30;
// The slam and spray mechanics land at a fixed moment (the telegraph's end); the swing starts as
// long before it as the clip takes to reach its own hit, so the claws meet the deck on the impact.
const SLAM_RATE = 1.2;
const SLAM_LEAD = skillDelay('attack_slam', 'hit', skillWindow('attack_slam', 'move', SLAM_RATE)) ?? 0.55;
const SPRAY_LEAD = skillDelay('attack_swipe', 'hit') ?? 0.4;

type Mech = NonNullable<BossState['mech']>['kind'];
type State = 'dormant' | 'waking' | 'idle' | 'fight' | 'dying' | 'dead';

const v1 = new THREE.Vector3();
const g1 = new THREE.Vector3();
const g2 = new THREE.Vector3();
const g3 = new THREE.Vector3();
const gn = new THREE.Vector3();

interface ActiveMech {
  kind: Mech;
  t: number;
  dur: number;
  at: THREE.Vector3;
  yaw: number;
  fx: Fx[];
  fired: boolean;
  swung: boolean;
}

export class Boss {
  state: State = 'dormant';
  phase = 1;
  enraged = false;
  readonly adds: Enemy[] = [];
  private nextSwing = 0;
  private nextMech = 0;
  private mechIndex = 0;
  private mech: ActiveMech | null = null;
  private stateT = 0;
  private freedStarted = false;
  private outside = 0;

  constructor(private readonly game: Game, readonly unit: Unit, readonly arena: Poi, readonly freed: Unit, readonly profile: BossProfile = BOSS_PROFILES.rust) {
    unit.ctrl = this;
    unit.level = profile.level;
    unit.name = profile.name;
    unit.title = profile.title;
    unit.maxHp = unit.hp = profile.hp;
    unit.invulnerable = true;
    unit.hidden = true;
    unit.targetable = false;
    unit.rig.root.visible = false;
    unit.setBaseTint(profile.color);
    freed.hidden = true;
    freed.targetable = false;
    freed.rig.root.visible = false;
    this.freedBaseScale = freed.rig.root.scale.x;
  }

  get engaged(): boolean {
    return this.state === 'fight';
  }

  get telegraphActive(): boolean {
    return !!this.mech && !this.mech.fired;
  }

  get mechName(): string | null {
    return this.mech?.kind ?? null;
  }

  private warning:HTMLElement|null=null;
  private remoteMechId = -1;
  networkState(id: 'b3' | 'b10' | 'b20'): BossState {
    const m = this.mech;
    return { id, state:this.state,phase:this.phase,enraged:this.enraged,
      timeline:this.state==='waking'||this.state==='dying'||this.freedT>=0 ? {state:Math.min(60,this.stateT),freed:this.freedT,freedYaw:this.freedYaw,released:this.freedStarted} : undefined,
      mech:m ? {
      id:this.mechIndex,kind:m.kind,at:[m.at.x,m.at.y,m.at.z],yaw:m.yaw,left:Math.max(0,m.dur-m.t),
    } : null };
  }
  applyNetwork(s: BossState): void {
    const g=this.game;
    if (s.phase > this.phase && s.state === 'fight') g.hud.messages.banner(() => (t(`${s.phase}단계`,`PHASE ${s.phase}`)),() => (this.profile.name),'boss');
    this.state=s.state; this.phase=s.phase; this.enraged=s.enraged;
    const timeline=s.timeline;
    if(timeline&&Number.isFinite(timeline.state)&&Number.isFinite(timeline.freed)&&Number.isFinite(timeline.freedYaw)&&typeof timeline.released==='boolean'){
      this.stateT=THREE.MathUtils.clamp(timeline.state,0,60);
      this.freedT=THREE.MathUtils.clamp(timeline.freed,-1,13);
      this.freedYaw=THREE.MathUtils.clamp(timeline.freedYaw,-10000,10000);
      this.freedStarted=timeline.released;
      if(this.freedStarted&&this.freedT>=1.6)this.freed.npcId='bowed';
      const growth=this.freedT>=0&&this.freedT<1.2 ? .3+.7*this.freedT/1.2 : 1;
      this.freed.rig.root.scale.setScalar(this.freedBaseScale*growth);
      this.freed.lift=this.freedT>10.5 ? -(this.freedT-10.5)*.8 : 0;
    } else this.stateT=0; // Legacy checkpoints retain their previous restart behavior.

    this.unit.setBaseTint(this.enraged ? '#fff4d9' : this.profile.color);
    if (this.state === 'fight') g.hud.bossFrame.show(this.unit);
    else if (g.encounter === this) g.hud.bossFrame.hide();
    const m=s.mech;
    if (!m) {
      const old=this.mech;
      if (old && s.state === 'fight') {
        this.impactVisual(old.kind,old.at,old.yaw);
      }
      this.clearMech(); this.remoteMechId=-1; return;
    }
    if (m.id === this.remoteMechId && this.mech) {
      // Followers do not simulate attacks. Keep the latest checkpoint time for host election
      // without recreating the visible warning/telegraphs on every room snapshot.
      this.mech.t=Math.max(0,this.mech.dur-m.left);
      return;
    }
    this.clearMech(); this.remoteMechId=m.id;
    const at=new THREE.Vector3(...m.at),fx:Fx[]=[];
    const duration=Math.max(0.05,m.left);
    fx.push(...this.mechTelegraphs(m.kind,at,m.yaw,duration));
    this.mech={kind:m.kind,t:0,dur:duration,at,yaw:m.yaw,fx,fired:false,swung:false};
    this.mechIndex=m.id;
    this.warning=g.hud.messages.warn(bossWarning(m.kind,this.profile.level),{persistent:true});
  }
  resumeAuthority(): void {
    // Preserve replicated attack and cinematic timelines; restart only local scheduling timers.
    this.nextSwing=this.game.time+1; this.nextMech=this.game.time+3;
    this.outside=0; this.unit.cancelPendingHit();
    if (this.profile.level===3) { this.adds.length=0; this.adds.push(...this.game.enemies.filter(e=>e.isAdd && e.unit.alive && !e.unit.hidden)); }
  }

  /** The beacon is lit: Corrodius heaves himself up on the deck. */
  wake(): void {
    if (this.game.multiplayer?.battle.challenge(this.profile.level === 20 ? 'b20' : this.profile.level === 10 ? 'b10' : 'b3')) return;
    if (this.state !== 'dormant') return;
    if(this.profile.level<20 && this.game.world.getEnvironment?.().beacon===false)return;
    const g = this.game;
    const u = this.unit;
    this.state = 'waking';
    this.stateT = 0;
    u.hidden = false;
    u.rig.root.visible = true;
    u.teleport(g.world, this.arena.position.x, this.arena.position.z, this.arena.yaw);
    u.lift = -u.height;
  }

  onDamaged(src: Unit | null): void {
    if (this.state === 'idle' && src && (this.game.partyLevel ?? this.game.player.level) >= this.profile.level) this.engage();
  }

  private engage(): void {
    const g = this.game;
    if(this.profile.level<20&&g.world.getEnvironment?.().beacon===false)return;
    if ((g.partyLevel ?? g.player.level) < this.profile.level) return;
    this.state = 'fight';
    if(this.profile.level<20)g.world.setMood?.(1);
    g.player.unit.blessingUntil = Infinity;
    this.nextSwing = g.time + 1.2;
    this.nextMech = g.time + 4;
    this.unit.express('angry', 3);
    g.say(this.unit, this.profile.level === 20 ? t('별의 문을 연 자여, 일식의 시험을 받아라!','You who opened the star gate, face the trial of the eclipse!') : this.profile.level >= 10 ? t('심해의 빛을 피할 수 있겠느냐!','Can you escape the light of the deep?') : BOSS_YELLS.engage, true);
    g.audio.sfx('sfx-boss-roar');
    g.hud.bossFrame.show(this.unit);
    g.follow.shake(0.25, 0.6);
  }

  sleep():void {
    if(this.state==='dead'||this.state==='dying')return;
    this.reset();this.state='dormant';this.unit.hidden=true;this.unit.invulnerable=true;this.unit.targetable=false;
    this.unit.cancelPendingHit();this.unit.motion.stop(undefined,.2);
  }

  reset(): void {
    const g = this.game;
    const u = this.unit;
    if (this.state === 'dormant' || this.state === 'dead' || this.state === 'dying') return;
    this.clearMech();
    for (const a of this.adds) a.despawn();
    this.adds.length = 0;
    u.hp = u.maxHp;
    u.alive = true;
    u.stunUntil = u.slowUntil = 0;
    this.phase = 1;
    this.enraged = false;
    u.setBaseTint(this.profile.color);
    u.motion.stop(undefined, 0.2);
    u.teleport(g.world, this.arena.position.x, this.arena.position.z, this.arena.yaw);
    this.state = 'idle';
    this.outside = 0;
    this.mechIndex = 0;
    u.cancelPendingHit();
    g.hud.bossFrame.hide();
  }

  onDeath(): void {
    const g = this.game;
    this.state = 'dying';
    this.stateT = 0;
    this.clearMech();
    for (const a of this.adds) if (a.unit.alive) g.combat.kill(a.unit, null);
    g.say(this.unit, this.profile.level === 20 ? t('일식이 걷히는구나… 두 세계를 부탁한다.','The eclipse fades… Take care of both worlds.') : this.profile.level >= 10 ? t('심해가 다시 잠잠해지는구나…','The deep grows quiet once more…') : BOSS_YELLS.death, true);
    if (this.profile.level >= 10) g.vfx.tidalNova(this.unit.pos, 8);
    else g.vfx.rustPeel(this.unit, 4.5);
    g.follow.shake(0.35, 1.2);
    g.audio.sfx('sfx-boss-roar', { volume: 0.7, pitch: 0 });
    this.unit.targetable = false;
  }

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    const p = g.combatTarget?.(u) ?? g.player.unit;
    this.stateT += dt;
    const unlocked = (g.partyLevel ?? p.level) >= this.profile.level;
    u.invulnerable = !unlocked;
    if (this.state === 'idle') u.targetable = unlocked;
    switch (this.state) {
      case 'dormant':
      case 'dead':
        this.updateFreed(dt);
        return;
      case 'waking': {
        const k = Math.min(1, this.stateT / 2.4);
        u.lift = -u.height * (1 - k) * (1 - k);
        u.pos.y = g.world.heightAt(u.pos.x, u.pos.z) + u.lift;
        if (this.stateT < 2.4 && Math.random() < 0.5) g.vfx.burrow(v1.set(u.pos.x + rand(-2, 2), u.pos.y - u.lift, u.pos.z + rand(-2, 2)));
        if (k >= 1) {
          u.lift = 0;
          this.state = 'idle';
          u.targetable = unlocked;
          u.act('attack_slam');
          g.say(u, this.profile.level === 20 ? t('아스트라가 별의 왕좌에서 깨어났다.','Astra awakens upon the Star Throne.') : this.profile.level >= 10 ? t('네레이드가 심해에서 깨어났다.','Nereid awakens from the deep.') : BOSS_YELLS.wake, true);
          g.audio.sfx('sfx-boss-roar');
        }
        u.feedLocomotion(dt);
        return;
      }
      case 'idle': {
        // Wait on the deck; anyone stepping onto it is noticed.
        if (unlocked && p.alive && !(p.kind === 'player' && g.controlsLocked) && Math.hypot(p.pos.x - this.arena.position.x, p.pos.z - this.arena.position.z) < this.arena.radius * 0.9) this.engage();
        u.setYaw(turnToward(u.yaw, p.alive ? yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z) : this.arena.yaw, 0.8, dt));
        u.feedLocomotion(dt);
        return;
      }
      case 'dying': {
        this.updateDeath(dt);
        return;
      }
      case 'fight':
        break;
    }

    // Leash: the player died, or left the wreck and stayed away.
    const fromArena = Math.hypot(p.pos.x - this.arena.position.x, p.pos.z - this.arena.position.z);
    this.outside = fromArena > this.arena.radius + ARENA_LEASH ? this.outside + dt : 0;
    if (!p.alive || this.outside > 4) {
      if (p.alive) g.say(u, t('달아나라, 작은 껍질아. 녹은 기억한다.','Run, little shell. The rust remembers.'), true);
      this.reset();
      return;
    }

    // Phase changes
    const frac = u.hp / u.maxHp;
    if (this.phase === 1 && frac < 0.6) this.enterPhase2();
    if (this.phase === 2 && frac < 0.25) this.enterPhase3();
    if (this.enraged) {
      g.vfx.heatVent(u);
      if (Math.random() < 0.3) g.vfx.heatVent(u);
    }

    const stunned = u.stunned(now);
    if (this.mech) {
      this.updateMech(dt);
    } else if (!stunned) {
      // Chase and claw.
      const gap = u.gapTo(p);
      const want = yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z);
      u.setYaw(turnToward(u.yaw, want, this.enraged ? 3 : 2.2, dt));
      if (gap > 1.0) {
        const sp = (this.enraged ? 2.8 : 2.0) * u.speedMul(now);
        const d = u.distTo(p) || 1;
        u.moveTo(g.world, u.pos.x + ((p.pos.x - u.pos.x) / d) * sp * dt, u.pos.z + ((p.pos.z - u.pos.z) / d) * sp * dt, dt);
      }
      if (gap <= 1.6 && now >= this.nextSwing && Math.abs(angleDiff(want, u.yaw)) < 0.8) {
        this.nextSwing = now + (this.enraged ? 1.8 : 2.6);
        u.act('attack_swipe', {
          upper: true,
          hitAt: 0.35,
          speed: this.enraged ? 1.4 : 1,
          onHit: () => {
            if (!u.alive || !p.alive || u.gapTo(p) > 2.4) return;
            g.combat.damage(u, p, rand(7, 10) * this.profile.damage * (this.enraged ? 1.25 : 1));
            g.vfx.slash(u, p, C.ember, 1.3);
            g.follow.shake(0.08, 0.15);
          },
        });
      }
      if (now >= this.nextMech) this.startMech();
    }
    u.feedLocomotion(dt);
  }

  private enterPhase2(): void {
    const g = this.game;
    this.phase = 2;
    g.say(this.unit, this.profile.level === 20 ? t('별의 그림자 속으로 들어오라!','Step into the shadow of the stars!') : this.profile.level >= 10 ? t('깊은 바다의 힘이 깨어난다!','The power of the deep awakens!') : BOSS_YELLS.phase2, true);
    g.audio.sfx('sfx-boss-roar');
    g.follow.shake(0.3, 0.6);
    g.hud.messages.banner(() => (t('2단계','PHASE II')),() => (this.profile.level === 20 ? t('검은 일식 · 초록 원 안쪽이 안전합니다!','Black Eclipse · Stay inside the green circle!') : this.profile.level >= 10 ? t('심해 파동 · 푸른 원을 벗어나세요!','Tidal Nova · Leave the blue circle!') : t('녹의 하수인들이 깨어납니다!','The rustlings awaken!')), 'boss');
    const u = this.unit;
    for (let i = 0; i < (this.profile.level >= 10 ? 0 : 3); i++) {
      const a = u.yaw + Math.PI + (i - 1) * 0.9;
      const r = u.radius + 3.5;
      const add = g.spawnAdd(u.pos.x + Math.sin(a) * r, u.pos.z + Math.cos(a) * r);
      if (add) this.adds.push(add);
    }
    this.mechIndex = 0;
    this.nextMech = g.time + 3;
  }

  private enterPhase3(): void {
    const g = this.game;
    this.phase = 3;
    this.enraged = true;
    this.unit.setBaseTint('#fff1d6');
    this.unit.express('angry', 999);
    g.say(this.unit, this.profile.level >= 10 ? t('왕관의 빛이여, 모든 것을 삼켜라!','Light of the crown, consume everything!') : BOSS_YELLS.phase3, true);
    g.audio.sfx('sfx-boss-roar');
    g.follow.shake(0.35, 0.8);
    g.hud.messages.banner(() => (t('3단계 · 폭주','PHASE III · ENRAGE')),() => (this.profile.level === 20 ? t('별의 왕관이 폭주합니다!','The Star Crown is enraged!') : this.profile.level >= 10 ? t('심해의 왕관이 폭주합니다!','The Deep Crown is enraged!') : t('갑옷이 새하얗게 달아오릅니다!','The armour burns white-hot!')), 'boss');
    this.nextMech = g.time + 2.5;
  }

  private startMech(): void {
    const g = this.game;
    const u = this.unit;
    const p = g.combatTarget?.(u) ?? g.player.unit;
    const order: Mech[] = this.profile.level === 20 ? (this.phase === 1 ? ['slam','eclipse','nova','cross','barrage'] : ['eclipse','nova','undertow','cross','barrage','eclipse']) : this.profile.level >= 10 ?
      (this.phase === 1 ? ['slam', 'nova', 'spray', 'cross', 'barrage'] : ['nova', 'undertow', 'slam', 'cross', 'barrage', 'nova']) :
      this.phase === 1 ? ['slam', 'spray'] : this.phase === 2 ? ['undertow', 'slam', 'spray', 'cross', 'slam'] : ['slam', 'spray', 'undertow', 'cross', 'barrage'];
    const kind = order[this.mechIndex++ % order.length];
    const m: ActiveMech = { kind, t: 0, dur: 1.5, at: new THREE.Vector3(), yaw: u.yaw, fx: [], fired: false, swung: false };
    const speedUp = (this.enraged ? 0.8 : 1) * this.profile.tempo;
    if (kind === 'slam') { m.dur=1.5*speedUp; m.at.copy(p.pos); }
    else if (kind === 'spray') {
      m.dur=1.1*speedUp; m.at.copy(u.pos);
      m.yaw=yawTo(u.pos.x,u.pos.z,p.pos.x,p.pos.z); u.setYaw(m.yaw);
    } else if (kind === 'eclipse') { m.dur=2.8*speedUp; m.at.copy(u.pos); }
    else if (kind === 'nova') {
      m.dur=2.2*speedUp;
      if (this.profile.level === 20) m.dur=Math.max(m.dur,1.9);
      m.at.copy(p.pos);
    } else if (kind === 'cross') {
      m.dur=Math.max(2.6,3.1*speedUp); m.at.copy(u.pos);
      m.yaw=yawTo(u.pos.x,u.pos.z,p.pos.x,p.pos.z);
    } else if (kind === 'barrage') {
      m.dur=Math.max(2.6,3*speedUp); m.at.copy(p.pos);
      m.yaw=yawTo(u.pos.x,u.pos.z,p.pos.x,p.pos.z);
    } else {
      m.dur=2.6; m.at.copy(u.pos); g.say(u,BOSS_YELLS.undertow,true);
    }
    m.fx.push(...this.mechTelegraphs(kind,m.at,m.yaw,m.dur));
    this.warning=g.hud.messages.warn(bossWarning(kind,this.profile.level),{persistent:true});
    this.mech = m;
    this.nextMech = g.time + m.dur + (this.phase === 3 ? 4.2 : this.phase === 2 ? 5.5 : 6);
  }

  private barragePoints(at: THREE.Vector3, yaw: number): THREE.Vector3[] {
    return [-6,0,6].map(offset => new THREE.Vector3(at.x+Math.cos(yaw)*offset,at.y,at.z-Math.sin(yaw)*offset));
  }

  /** One layout for host and followers; shape dimensions also match damage tests below. */
  private mechTelegraphs(kind: Mech, at: THREE.Vector3, yaw: number, duration: number): Fx[] {
    const vfx=this.game.vfx;
    if (kind==='cross') return [yaw,yaw+Math.PI/2].map(a=>vfx.telegraphLane(at,a,12,1.8,duration,new THREE.Color('#ffb64d')));
    if (kind==='barrage') return this.barragePoints(at,yaw).map(p=>vfx.telegraphCircle(p,2.6,duration,new THREE.Color('#cf8aff'),this.deckUnder(p,2.6,0,Math.PI)));
    if (kind==='spray') return [vfx.telegraphCone(at,yaw,11,.55,duration,undefined,this.deckUnder(at,11,yaw,.55))];
    const radius=kind==='eclipse'?11:kind==='slam'?3.4:kind==='nova'?6:5.5;
    const color=kind==='eclipse'?new THREE.Color('#a050ff'):kind==='nova'?new THREE.Color(this.profile.color):undefined;
    const fx=[vfx.telegraphCircle(at,radius,duration,color,this.deckUnder(at,radius,0,Math.PI))];
    if(kind==='eclipse')fx.push(vfx.telegraphCircle(at,4.5,duration,new THREE.Color('#71ffca'),this.deckUnder(at,4.5,0,Math.PI)));
    if(kind==='undertow')vfx.undertow(at,5.5,duration);
    return fx;
  }

  /**
   * The plane of the deck under a telegraph (the wreck's deck tilts by up to half a unit across a
   * cone, enough to bury a flat mark): fitted through three points inside the mark, the mark's origin
   * moved onto it. Returns the plane's normal.
   */
  private deckUnder(at: THREE.Vector3, reach: number, yaw: number, half: number): THREE.Vector3 {
    const w = this.game.world;
    const cone = half < 3;
    const r = reach * (cone ? 0.85 : 0.7);
    const put = (out: THREE.Vector3, a: number, d: number) => {
      out.set(at.x + Math.sin(a) * d, 0, at.z + Math.cos(a) * d);
      out.y = w.heightAt(out.x, out.z);
      return out;
    };
    if (cone) {
      put(g1, yaw, 0);
      put(g2, yaw - half * 0.8, r);
      put(g3, yaw + half * 0.8, r);
    } else {
      put(g1, 0, r);
      put(g2, (Math.PI * 2) / 3, r);
      put(g3, (Math.PI * 4) / 3, r);
    }
    // Height of the plane at the origin: the apex of a cone, the centroid of a circle's samples.
    const gy = w.heightAt(at.x, at.z);
    at.y = cone ? gy : (g1.y + g2.y + g3.y) / 3;
    if (Math.abs(at.y - gy) > 0.5) at.y = gy;
    const n = gn.crossVectors(g2.sub(g1), g3.sub(g1)).normalize();
    if (!Number.isFinite(n.y)) n.set(0, 1, 0);
    if (n.y < 0) n.negate();
    // Never more than ~10 degrees: a sample off the deck edge must not stand the mark up.
    if (!(n.y >= 0.985)) n.set(n.x, 0, n.z).setLength(Math.sqrt(1 - 0.985 * 0.985)).setY(0.985);
    return n;
  }

  private updateMech(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const m = this.mech!;
    m.t += dt;
    if (m.kind === 'slam') {
      u.setYaw(turnToward(u.yaw, yawTo(u.pos.x, u.pos.z, m.at.x, m.at.z), 3, dt));
      if (!m.swung && m.t > m.dur - SLAM_LEAD) {
        m.swung = true;
        u.act('attack_slam', { speed: SLAM_RATE });
      }
      if (m.t >= m.dur) {
        m.fired = true;
        this.impactVisual('slam',m.at);
        g.follow.shake(0.5, 0.5);
        g.audio.sfx('sfx-crit');
        for (const p of g.combatPlayers?.() ?? [g.player.unit]) if (p.alive && Math.hypot(p.pos.x - m.at.x, p.pos.z - m.at.z) < 3.4 + p.radius * 0.5) {
          g.combat.damage(u, p, p.maxHp * 0.26);
          p.stunUntil = Math.max(p.stunUntil, g.time + 0.5);
        }
        this.finishMech();
      }
    } else if (m.kind === 'spray') {
      if (!m.swung && m.t > m.dur - SPRAY_LEAD) {
        m.swung = true;
        u.act('attack_swipe', { upper: true });
        this.impactVisual('spray',m.at,m.yaw);
      }
      if (m.t >= m.dur) {
        m.fired = true;
        for (const p of g.combatPlayers?.() ?? [g.player.unit]) {
        const d = Math.hypot(p.pos.x - m.at.x, p.pos.z - m.at.z);
        const a = yawTo(m.at.x, m.at.z, p.pos.x, p.pos.z);
        if (p.alive && d < 11 + p.radius && Math.abs(angleDiff(a, m.yaw)) < 0.55 + Math.atan2(p.radius, Math.max(1, d))) {
          g.combat.damage(u, p, rand(6, 9) * this.profile.damage);
          p.rust = Math.min(5, (g.time < p.rustUntil ? p.rust : 0) + 1);
          p.rustUntil = g.time + 10;
          g.hud.floats.spawn(p, t(`녹 ${p.rust}중첩`,`Rust x${p.rust}`), 'info');
        }
        }
        this.finishMech();
      }
    } else if (m.kind === 'eclipse') {
      if (!m.swung && m.t > m.dur - SLAM_LEAD) { m.swung=true; u.act('attack_slam', {speed:SLAM_RATE}); }
      if (m.t >= m.dur) {
        m.fired=true; this.impactVisual('eclipse',m.at);
        g.follow.shake(0.5,0.7); g.audio.sfx('sfx-crit');
        for (const p of g.combatPlayers?.() ?? [g.player.unit]) {
          const d=Math.hypot(p.pos.x-m.at.x,p.pos.z-m.at.z);
          if(p.alive && d>4.5 && d<11+p.radius*0.5) g.combat.damage(u,p,p.maxHp*0.38);
        }
        this.finishMech();
      }
    } else if (m.kind === 'nova') {
      if (!m.swung && m.t > m.dur - SLAM_LEAD) { m.swung = true; u.act('attack_slam', { speed: SLAM_RATE }); }
      if (m.t >= m.dur) {
        m.fired = true;
        this.impactVisual('nova',m.at);
        g.follow.shake(0.4, 0.5);
        g.audio.sfx('sfx-crit');
        for (const p of g.combatPlayers?.() ?? [g.player.unit]) if (p.alive && Math.hypot(p.pos.x - m.at.x, p.pos.z - m.at.z) < 6 + p.radius * 0.5) g.combat.damage(u, p, p.maxHp * 0.32);
        this.finishMech();
      }
    } else if (m.kind==='cross' || m.kind==='barrage') {
      if (!m.swung && m.t>m.dur-SLAM_LEAD) { m.swung=true; u.act('attack_slam',{speed:SLAM_RATE}); }
      if (m.t>=m.dur) {
        m.fired=true; this.impactVisual(m.kind,m.at,m.yaw);g.follow.shake(.3,.4);g.audio.sfx('sfx-crit');
        const points=m.kind==='barrage'?this.barragePoints(m.at,m.yaw):[];
        for(const p of g.combatPlayers?.()??[g.player.unit]) {
          if(!p.alive)continue;
          const dx=p.pos.x-m.at.x,dz=p.pos.z-m.at.z;
          const x=dx*Math.cos(m.yaw)-dz*Math.sin(m.yaw),z=dx*Math.sin(m.yaw)+dz*Math.cos(m.yaw);
          const hit=m.kind==='cross'
            ? (Math.abs(x)<1.8+p.radius*.5&&Math.abs(z)<12)||(Math.abs(z)<1.8+p.radius*.5&&Math.abs(x)<12)
            : points.some(at=>Math.hypot(p.pos.x-at.x,p.pos.z-at.z)<2.6+p.radius*.5);
          if(hit)g.combat.damage(u,p,p.maxHp*(m.kind==='cross'?.28:.24));
        }
        this.finishMech();
      }
    } else {
      // Undertow: drag the player toward the hull, then slam everything around it.
      for (const p of g.combatPlayers?.() ?? [g.player.unit]) if (p.alive && m.t < m.dur - 0.3) {
        const d = u.distTo(p);
        if (d < 18 && d > u.radius + p.radius + 0.3) {
          const pull = 3.2;
          p.pushX = ((u.pos.x - p.pos.x) / d) * pull;
          p.pushZ = ((u.pos.z - p.pos.z) / d) * pull;
          p.pushTime = 0.05;
        }
      }
      if (!m.swung && m.t > m.dur - SLAM_LEAD) {
        m.swung = true;
        u.act('attack_slam', { speed: SLAM_RATE });
      }
      if (m.t >= m.dur) {
        m.fired = true;
        this.impactVisual('undertow',m.at);
        g.follow.shake(0.55, 0.6);
        g.audio.sfx('sfx-crit');
        for (const p of g.combatPlayers?.() ?? [g.player.unit]) if (p.alive && u.distTo(p) < 5.5 + p.radius * 0.5) g.combat.damage(u, p, p.maxHp * 0.24);
        this.finishMech();
      }
    }
  }

  private impactVisual(kind:Mech,at:THREE.Vector3,yaw=0):void {
    const vfx=this.game.vfx;
    if(kind==='cross'){for(const a of [yaw,yaw+Math.PI/2])vfx.telegraphLane(at,a,12,1.8,.4,new THREE.Color('#ffd390'));return;}
    if(kind==='barrage'){for(const p of this.barragePoints(at,yaw)){p.y=this.game.world.heightAt(p.x,p.z);vfx.slamImpact(p,2.6);}return;}
    if(kind==='spray'){vfx.rustSpray(at,yaw,11,.55);return;}
    if(kind==='eclipse'){vfx.ring(at,new THREE.Color('#b577ff'),11,4.5,.8,.9);return;}
    if(kind==='nova'){
      const color=new THREE.Color(this.profile.color);
      vfx.ring(at,color,.5,7,.6,.85);vfx.ring(at,color,1,6,.8,.7);
    }
    vfx.slamImpact(at,kind==='nova'?6:kind==='slam'?3.4:5.5);
  }

  refreshLanguage():void {
    this.unit.name=this.profile.name;this.unit.title=this.profile.title;
    this.refreshWarning();
  }

  refreshWarning():void {
    if(this.mech)this.warning=this.game.hud.messages.warn(bossWarning(this.mech.kind,this.profile.level),{persistent:true});
  }

  private clearMechWarning():void {
    if(this.warning)this.game.hud.messages.clearWarning(this.warning);
    this.warning=null;
  }

  private finishMech():void {
    this.clearMechWarning();this.mech=null;
  }

  private clearMech(): void {
    this.clearMechWarning();
    if (!this.mech) return;
    for (const f of this.mech.fx) this.game.vfx.fx.release(f);
    this.mech = null;
  }

  /** Debug F9: drop to the next phase threshold, then to zero. */
  debugAdvance(): void {
    const g = this.game;
    const u = this.unit;
    if (this.state === 'idle') this.engage();
    if (this.state !== 'fight') return;
    const target = this.phase === 1 ? 0.58 : this.phase === 2 ? 0.23 : 0;
    const dmg = u.hp - u.maxHp * target;
    if (target === 0) g.combat.damage(g.player.unit, u, u.hp + 10, { crit: true });
    else if (dmg > 0) g.combat.damage(g.player.unit, u, dmg, { crit: true });
  }

  // ---------------------------------------------------------------- death sequence

  private updateDeath(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const t = this.stateT;
    if (t > 2.2 && !this.freedStarted) {
      this.freedStarted = true;
      this.releaseFreed();
    }
    if (t > 6) {
      // The empty hull settles into the deck.
      u.lift = -Math.min(1, (t - 6) / 4) * u.height * 0.7;
      u.pos.y = g.world.heightAt(u.pos.x, u.pos.z) + u.lift;
    }
    if (t > 10.5) {
      u.hidden = true;
      u.rig.root.visible = false;
      this.state = 'dead';
      this.stateT = 0;
    }
    this.updateFreed(dt);
  }

  private freedT = -1;
  private freedYaw = 0;

  private releaseFreed(): void {
    const g = this.game;
    const f = this.freed;
    const u = this.unit;
    f.hidden = false;
    f.rig.root.visible = true;
    f.alive = true;
    const p = g.combatTarget?.(u) ?? g.player.unit;
    const toward = yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z);
    f.teleport(g.world, u.pos.x, u.pos.z, toward);
    f.rig.root.scale.setScalar(this.freedBaseScale * 0.3);
    this.freedT = 0;
    this.freedYaw = toward;
    g.vfx.steamPuff(f.pos);
    g.vfx.lootSparkle(f.pos);
    g.audio.sfx('sfx-servo-whir');
  }

  private freedBaseScale = 0;

  private updateFreed(dt: number): void {
    if (this.freedT < 0) return;
    const g = this.game;
    const f = this.freed;
    const u = this.unit;
    const p = g.combatTarget?.(u) ?? g.player.unit;
    this.freedT += dt;
    const freedTime = this.freedT;
    // 0..1.2 grow and step out of the hull
    if (freedTime < 1.2) {
      const k = freedTime / 1.2;
      f.rig.root.scale.setScalar(this.freedBaseScale * (0.3 + 0.7 * k));
      const out = u.radius + 1.6;
      f.moveTo(g.world, u.pos.x + Math.sin(this.freedYaw) * out * k, u.pos.z + Math.cos(this.freedYaw) * out * k, dt);
    } else if (freedTime < 1.6) {
      f.rig.root.scale.setScalar(this.freedBaseScale);
      f.setYaw(turnToward(f.yaw, yawTo(f.pos.x, f.pos.z, p.pos.x, p.pos.z), 6, dt));
    } else if (freedTime < 4.6) {
      if (!f.npcId) {
        f.npcId = 'bowed';
        f.act('gesture_bow');
        f.express('love', 3);
        g.say(f, t('고마워. 그 안은 정말 어두웠어.','Thank you. It was very dark in there.'));
      }
    } else if (freedTime < 12) {
      // Scuttle sideways into the sea.
      const sea = g.seaDirection();
      const yaw = Math.atan2(sea.x, sea.z) + Math.PI / 2;
      f.setYaw(turnToward(f.yaw, yaw, 4, dt));
      f.moveTo(g.world, f.pos.x + sea.x * 3.4 * dt, f.pos.z + sea.z * 3.4 * dt, dt);
      if (freedTime > 10.5) f.lift = -(freedTime - 10.5) * 0.8;
      if (Math.random() < 0.3) g.vfx.smoke(f.pos, C.foam, 1, 0.5, 0.6, 0.3, 0.6);
    } else {
      f.hidden = true;
      f.alive = false;
      f.rig.root.visible = false;
      this.freedT = -1;
    }
    f.feedLocomotion(dt);
  }
}
