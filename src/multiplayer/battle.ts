import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Unit } from '../game/unit';
import type { HitOptions } from '../game/combat';
import type { Enemy } from '../game/enemies';
import type { CombatEvent, EntityState, WorldState } from '../../server/combatProtocol';

/** Only the elected host runs enemy AI and resolves hits. Guests submit attacks. */
export class BattleSync {
  active = false;
  host = '';
  ownId = '';
  applying = false;
  private elapsed = 0;
  private goals = new Map<Unit, EntityState>();
  private units = new Map<string, Unit>();
  private keys = new Map<Unit, string>();
  private effectAt = 0;
  private serial = 0;
  private sceneClock = 0;
  private originalMood: Game['world']['setMood'];
  private originalBeacon: Game['world']['setBeaconLit'];
  private credited = new Set<string>();
  constructor(private game: Game, private send: (packet: unknown) => void, private peers: () => Map<string, { unit: Unit | null }>) {
    this.originalMood=game.world.setMood.bind(game.world);
    this.originalBeacon=game.world.setBeaconLit.bind(game.world);
    game.world.setMood=(m,instant)=>{
      if (this.active && !this.authority && !this.applying) this.event({kind:'environment',target:'world',environment:{mood:m}});
      else this.originalMood(m,instant);
    };
    game.world.setBeaconLit=lit=>{
      if (this.active && !this.authority && !this.applying) { if(lit) this.event({kind:'environment',target:'world',environment:{beacon:true}}); }
      else this.originalBeacon(lit);
    };
    game.enemies.forEach((e, i) => this.register(`e${i}`, e.unit));
    this.register('b3', game.boss.unit); this.register('b10', game.finalBoss.unit);
    this.register('f3', game.boss.freed); this.register('f10', game.finalBoss.freed);
    for (const [id, u] of this.units) u.onAction = action => {
      if (this.active && this.authority && !this.applying) this.event({ kind: 'animation', target: id, action });
    };
  }
  get authority() { return !this.active || (!!this.host && this.host === this.ownId); }
  private register(id: string, u: Unit) { this.units.set(id, u); this.keys.set(u, id); }
  private event(event: CombatEvent) { this.send({ type: 'combat', event }); }
  join(ownId: string, host: string, world: WorldState | null) {
    this.active = true; this.ownId = ownId; this.host = host;
    if (world) this.apply(world, true);
    if (world && this.authority) {
      for (const e of this.game.enemies) e.resumeAuthority();
      for (const b of [this.game.boss,this.game.finalBoss]) b.resumeAuthority();
    }
    this.elapsed = 1;
  }
  leave() { this.active = false; this.host = ''; this.goals.clear(); }
  elect(host: string) {
    const was = this.authority; this.host = host;
    if (!was && this.authority) {
      // The former follower has the latest checkpoint. Discard any delayed local swings.
      for (const u of this.units.values()) u.cancelPendingHit();
      for (const e of this.game.enemies) e.resumeAuthority();
      for (const b of [this.game.boss, this.game.finalBoss]) b.resumeAuthority();
      this.goals.clear(); this.elapsed = 1;
      this.game.hud.messages.info('친구가 나가서 내가 전투를 이어받았어요.');
    }
  }
  /** null means continue the regular local damage pipeline. */
  routeDamage(src: Unit | null, dst: Unit, amount: number, o: HitOptions): number | null {
    if (!this.active || this.applying) return null;
    if (!this.authority && dst.hostile) {
      const target = this.keys.get(dst);
      if (src === this.game.player.unit && target && dst.alive && !dst.invulnerable) {
        this.event({ kind: 'attack', target, amount: Math.max(1, Math.min(2000, Math.round(amount))), crit: o.crit, rage: o.rage });
        src.lastCombat = dst.lastCombat = this.game.time;
        if (o.rage) this.game.player.gainRage(o.rage);
        return amount;
      }
      return 0;
    }
    if (dst.kind === 'remote') {
      if (this.authority && src?.hostile && dst.alive) {
        const target = [...this.peers()].find(([, p]) => p.unit === dst)?.[0];
        if (target) {
          const dmg = Math.max(1, Math.round(amount));
          this.event({ kind: 'hit', target, source: this.keys.get(src), amount: dmg, crit: o.crit });
          dst.hp = Math.max(0, dst.hp - dmg); dst.lastCombat = this.game.time;
          return dmg;
        }
      }
      return 0;
    }
    return null;
  }
  onDamage(src: Unit | null, dst: Unit, amount: number, o: HitOptions) {
    if (!this.active || !this.authority || this.applying) return;
    const target = this.keys.get(dst);
    if (target) this.event({ kind: 'hit', target, source: src ? this.keys.get(src) : undefined, amount, crit: o.crit });
  }
  onDeath(dst: Unit) {
    if (!this.active || !this.authority || this.applying) return;
    const target = this.keys.get(dst);
    if (target) { this.event({ kind: 'death', target, serial: ++this.serial }); this.publish(); }
  }
  challenge(target: 'b3' | 'b10') {
    if (!this.active || this.authority) return false;
    this.event({ kind: 'challenge', target }); return true;
  }
  condition(u: Unit) {
    if (!this.active || this.authority) return;
    const target=this.keys.get(u); if (!target) return;
    const now=this.game.time;
    this.event({kind:'condition',target,condition:{stun:Math.min(2,Math.max(0,u.stunUntil-now)),slow:Math.min(4,Math.max(0,u.slowUntil-now)),slowPct:Math.min(0.5,u.slowPct),pushX:u.pushX,pushZ:u.pushZ,pushTime:Math.max(0,u.pushTime)}});
  }
  receive(id: string, e: CombatEvent) {
    const g = this.game, u = this.units.get(e.target);
    if (this.authority) {
      const src = this.peers().get(id)?.unit;
      if (!src || !src.alive) return;
      if (e.kind === 'attack' && u?.hostile && u.alive && !u.hidden && !u.invulnerable && src.distTo(u) < 38) {
        g.combat.damage(src, u, e.amount!, { crit: e.crit }); this.publish();
      } else if (e.kind === 'environment' && e.environment) {
        const env=e.environment;
        if(env.beacon) g.world.setBeaconLit(true);
        if(env.mood===1 && src.level>=3) g.world.setMood(1);
        if(env.mood===2 && g.journey?.abyssCleared) g.world.setMood(2);
        this.publish();
      } else if (e.kind === 'condition' && u?.hostile && u.alive && !u.invulnerable && src.distTo(u)<38 && e.condition) {
        const f=e.condition;
        u.stunUntil=Math.max(u.stunUntil,g.time+f.stun);
        if (f.stun>0) { u.cancelPendingHit(); g.vfx.stunStars(u,f.stun); }
        if (f.slow>0) { u.slowUntil=Math.max(u.slowUntil,g.time+f.slow); u.slowPct=f.slowPct; }
        if (f.pushTime>0 && u.kind !== 'boss') { u.pushX=f.pushX; u.pushZ=f.pushZ; u.pushTime=f.pushTime; }
      } else if (e.kind === 'challenge') {
        const b = e.target === 'b3' ? g.boss : g.finalBoss;
        if (src.level >= b.profile.level && (b === g.boss || g.journey?.rustCleared) && !g.encounter.engaged) b.wake();
      }
      return;
    }
    if (id !== this.host) return;
    this.applying = true;
    try {
      if (e.kind === 'hit') {
        if (e.target === this.ownId) g.combat.damage(this.units.get(e.source ?? '') ?? null, g.player.unit, e.amount!, { crit: e.crit });
        else if (u && u.alive) {
          g.hud.floats.spawn(u, e.crit ? `${e.amount}!` : `${e.amount}`, e.crit ? 'crit' : 'dmg');
          u.flash('#ffffff', 0.1); u.lastCombat = g.time;
          g.audio.sfx('sfx-hit', { volume: 0.4 });
        }
      } else if (e.kind === 'animation' && u && e.action && e.action !== 'death') u.act(e.action as Parameters<Unit['act']>[0]);
      else if (e.kind === 'death' && u && !this.credited.has(`${id}:${e.serial}`)) {
        // A boss killing its adds can publish a checkpoint before its own death event.
        // Award from the unique event even when that checkpoint already marked the unit dead.
        this.credited.add(`${id}:${e.serial}`);
        if (this.credited.size>256) this.credited.delete(this.credited.values().next().value!);
        if (u.alive) g.combat.kill(u, g.player.unit);
        else g.onUnitDied(u, g.player.unit);
      } else if (e.kind === 'effect' && e.target === this.ownId && e.effect) {
        const p = g.player.unit, f = e.effect;
        p.stunUntil = Math.max(p.stunUntil, g.time + f.stun);
        if (f.rustFor > 0) { p.rust = f.rust; p.rustUntil = g.time + f.rustFor; }
        if (f.pushTime > 0) { p.pushX = f.pushX; p.pushZ = f.pushZ; p.pushTime = f.pushTime; }
      }
    } finally { this.applying = false; }
  }
  private snapshot(): WorldState {
    const g = this.game, now = g.time;
    return { weather: {...g.world.getEnvironment(),clock:this.sceneClock}, entities: [...this.units].map(([id,u]) => {
      const e = u.kind === 'scrapling' || u.kind === 'scavenger' ? u.ctrl as Enemy : null;
      const round = (n: number) => Math.round(n * 1000) / 1000;
      return { id, x: round(u.pos.x), y: round(u.pos.y), z: round(u.pos.z), yaw: round(u.yaw), hp: u.hp, maxHp: u.maxHp,
        level: u.level, alive: u.alive, hidden: u.hidden, invulnerable: u.invulnerable, targetable: u.targetable,
        stun: Math.min(60,Math.max(0,u.stunUntil-now)), slow: Math.min(60,Math.max(0,u.slowUntil-now)), slowPct: u.slowPct,
        rust: u.rust, rustFor: Math.min(60,Math.max(0,u.rustUntil-now)), ...(e ? { enemyState: e.state, xp: e.stats.xp } : {}) };
    }), bosses: [g.boss.networkState('b3'),g.finalBoss.networkState('b10')], rust: !!g.journey?.rustCleared, abyss: !!g.journey?.abyssCleared };
  }
  private publish() { if (this.active && this.authority) this.send({ type: 'world', world: this.snapshot() }); }
  apply(world: WorldState, instant = false) {
    if (!this.active) return;
    const g = this.game;
    this.applying = true;
    try {
      if (world.weather) {
        const current=g.world.getEnvironment();
        if (instant || current.mood!==world.weather.mood) this.originalMood(world.weather.mood,instant);
        if (current.beacon!==world.weather.beacon) this.originalBeacon(world.weather.beacon);
        this.sceneClock=world.weather.clock;
      }
      for (const s of world.entities) {
        const u = this.units.get(s.id); if (!u) continue;
        if (instant || u.hidden !== s.hidden || u.alive !== s.alive || u.pos.distanceToSquared(new THREE.Vector3(s.x,s.y,s.z)) > 100) u.pos.set(s.x,s.y,s.z);
        if (u.alive && !s.alive) { u.cancelPendingHit(); u.act('death'); u.express('dead',999); }
        if (!u.alive && s.alive) { u.motion.stop(undefined,0); u.express('neutral',0.1); }
        Object.assign(u, { hp:s.hp,maxHp:s.maxHp,level:s.level,alive:s.alive,hidden:s.hidden,invulnerable:s.invulnerable,targetable:s.targetable,
          stunUntil:g.time+s.stun,slowUntil:g.time+s.slow,slowPct:s.slowPct,rust:s.rust,rustUntil:g.time+s.rustFor });
        if (s.enemyState) { const e = u.ctrl as Enemy; e.state=s.enemyState; e.stats.xp=s.xp ?? e.stats.xp; }
        this.goals.set(u,s);
      }
      for (const s of world.bosses) (s.id === 'b3' ? g.boss : g.finalBoss).applyNetwork(s);
      if (g.journey) { g.journey.rustCleared=world.rust; g.journey.abyssCleared=world.abyss; }
    } finally { this.applying = false; }
  }
  update(dt: number) {
    if (!this.active) return;
    if (this.authority) {
      if ((this.elapsed += dt) >= 0.1) { this.elapsed = 0; this.publish(); }
      if ((this.effectAt += dt) >= 0.2) {
        this.effectAt = 0;
        for (const [id, p] of this.peers()) {
          const u = p.unit; if (!u) continue;
          const stun = Math.max(0,u.stunUntil-this.game.time), rustFor=Math.max(0,u.rustUntil-this.game.time);
          if (stun || rustFor || u.pushTime > 0) this.event({ kind:'effect',target:id,effect:{stun,rust:u.rust,rustFor,pushX:u.pushX,pushZ:u.pushZ,pushTime:Math.max(0,u.pushTime)} });
        }
      }
    } else {
      for (const [u,s] of this.goals) {
        const k=1-Math.exp(-25*dt);
        u.pos.x+=(s.x-u.pos.x)*k; u.pos.y+=(s.y-u.pos.y)*k; u.pos.z+=(s.z-u.pos.z)*k;
        u.setYaw(u.yaw+Math.atan2(Math.sin(s.yaw-u.yaw),Math.cos(s.yaw-u.yaw))*k);
        u.feedLocomotion(dt);
      }
    }
  }
  worldTime(localElapsed: number, dt: number) {
    this.sceneClock=this.active ? this.sceneClock+dt : localElapsed;
    return this.sceneClock;
  }
  dispose() {
    this.game.world.setMood=this.originalMood; this.game.world.setBeaconLit=this.originalBeacon;
    for (const u of this.units.values()) u.onAction=null; this.leave(); }
}
