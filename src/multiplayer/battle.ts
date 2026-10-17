import * as THREE from 'three';
import {t} from '../i18n';
import type { Game } from '../game/game';
import type { Unit } from '../game/unit';
import type { HitOptions } from '../game/combat';
import type { Enemy } from '../game/enemies';
import type { Npc } from '../game/npcs';
import type { CombatEvent, EntityState, WorldState } from '../../server/combatProtocol';

/** Only the elected host runs enemy AI and resolves hits. Guests submit attacks. */
export class BattleSync {
  active = false;
  host = '';
  ownId = '';
  applying = false;
  mode:'coop'|'pvp'='coop';
  parties:Record<string,number>={};
  private duelAt=new Map<string,number>();
  partyOf(id:string){return this.parties[id]??(this.mode==='coop'?1:0);}
  sameParty(a:string,b:string){return this.partyOf(a)>0&&this.partyOf(a)===this.partyOf(b);}
  setParty(party:number){
    if(!this.active||!Number.isInteger(party)||party<0||party>4)return;
    if(this.authority){this.parties[this.ownId]=party;this.publish();}else this.event({kind:'party',target:'world',party});
  }
  setMode(mode:'coop'|'pvp'){
    if(!this.active||!this.authority){this.game.hud.messages.info(t('방장이 협동 / 싸우기 모드를 선택해요.','The host chooses co-op or PvP mode.'));return;}
    if(this.game.encounter?.engaged){this.game.hud.messages.info(t('보스 전투가 끝난 뒤 모드를 바꿔 주세요.','Wait until the boss battle ends to change mode.'));return;}
    // Explicit teams belong to the room, so changing its combat rules keeps friends together.
    this.mode=mode;this.game.player.setTarget(null);this.publish();
  }
  private duel(id:string,target:string,amount:number,crit=false){
    if(this.mode!=='pvp'||id===target||this.sameParty(id,target)||!Number.isFinite(amount)||amount<=0)return;
    const src=id===this.ownId?this.game.player.unit:this.peers().get(id)?.unit;
    const dst=target===this.ownId?this.game.player.unit:this.peers().get(target)?.unit;
    if(!src?.alive||!dst?.alive||src.hidden||dst.hidden||src.distTo(dst)>38||this.game.time<(this.duelAt.get(id)??-1))return;
    this.duelAt.set(id,this.game.time+.06);
    const dmg=Math.min(Math.round(amount),Math.max(1,src.maxHp*2));
    src.lastCombat=dst.lastCombat=this.game.time;
    if(target===this.ownId){this.applying=true;try{this.game.combat.damage(src,dst,dmg,{crit});}finally{this.applying=false;}}
    else this.event({kind:'hit',target,amount:dmg,crit});
  }

  private elapsed = 0;
  private goals = new Map<Unit, EntityState>();
  private units = new Map<string, Unit>();
  private keys = new Map<Unit, string>();
  private effectAt = 0;
  private remotePush = new Map<string, { x: number; z: number; seconds: number }>();
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
      if (this.active && !this.authority && !this.applying) { this.event({kind:'environment',target:'world',environment:{beacon:lit}}); }
      else this.originalBeacon(lit);
    };
    game.enemies.forEach((e, i) => this.register(`e${i}`, e.unit));
    game.npcs?.forEach((n,i)=>this.register(`n${i}`,n.unit));
    game.townsfolk?.forEach((t,i)=>this.register(`t${i}`,t.unit));
    this.register('b3', game.boss.unit); this.register('b10', game.finalBoss.unit);
    this.register('b30',game.dawnBoss.unit);this.register('f30',game.dawnBoss.freed);
    this.register('b20', game.worldBoss.unit); this.register('f20', game.worldBoss.freed);
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
      for (const b of [this.game.boss,this.game.finalBoss,this.game.worldBoss,this.game.dawnBoss]) b.resumeAuthority();
    }
    this.elapsed = 1;
  }
  leave() { this.active = false; this.host = ''; this.goals.clear();this.mode='coop';this.parties={};this.duelAt.clear();this.remotePush.clear(); }
  elect(host: string) {
    const was = this.authority; this.host = host;
    if (!was && this.authority) {
      // The former follower has the latest checkpoint. Discard any delayed local swings.
      for (const u of this.units.values()) u.cancelPendingHit();
      for (const e of this.game.enemies) e.resumeAuthority();
      for (const b of [this.game.boss, this.game.finalBoss, this.game.worldBoss,this.game.dawnBoss]) b.resumeAuthority();
      this.goals.clear(); this.remotePush.clear(); this.elapsed = 1;
      this.game.hud.messages.info(t('친구가 나가서 내가 전투를 이어받았어요.','Your friend left. You are now hosting the battle.'));
    }
  }
  /** null means continue the regular local damage pipeline. */
  routeDamage(src: Unit | null, dst: Unit, amount: number, o: HitOptions): number | null {
    if (!this.active || this.applying) return null;
    if(src===this.game.player.unit&&dst.kind==='remote'){
      const target=[...this.peers()].find(([,p])=>p.unit===dst)?.[0];
      if(this.mode!=='pvp'||!target||this.sameParty(this.ownId,target))return 0;
      if(this.authority)this.duel(this.ownId,target,amount,!!o.crit);else this.event({kind:'duel',target,amount:Math.max(1,Math.round(amount)),crit:o.crit});
      if(o.rage)this.game.player.gainRage(o.rage);src.lastCombat=this.game.time;return amount;
    }
    if (!this.authority && dst.hostile) {
      const target = this.keys.get(dst);
      if (src === this.game.player.unit && target && dst.alive && !dst.invulnerable) {
        this.event({ kind: 'attack', target, amount: Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(amount))), crit: o.crit, rage: o.rage });
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
  challenge(target: 'b3' | 'b10' | 'b20' | 'b30') {
    if (!this.active || this.authority) return false;
    this.event({ kind: 'challenge', target }); return true;
  }
  requestLighthouse(lit:boolean) {
    if(!this.active||this.authority)return false;
    this.event({kind:'environment',target:'world',environment:{beacon:lit,mood:lit?1:3}});return true;
  }
  enterWorld2() {return this.travel(2);}
  travel(chapter:1|2|3) {
    if (!this.active || this.authority) return false;
    this.event({kind:'chapter',target:'world',chapter}); return true;
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
      if(e.kind==='party'){this.parties[id]=e.party!;this.publish();return;}
      if(e.kind==='duel'){this.duel(id,e.target,e.amount!,!!e.crit);return;}
      if (e.kind === 'attack' && u?.hostile && u.alive && !u.hidden && !u.invulnerable && src.distTo(u) < 38) {
        g.combat.damage(src, u, e.amount!, { crit: e.crit }); this.publish();
      } else if (e.kind === 'chapter') {
        if(!g.encounter.engaged&&e.chapter) { g.world2.go(e.chapter); this.publish(); }
      } else if (e.kind === 'environment' && e.environment) {
        const env=e.environment;
        if(typeof env.beacon==='boolean'){if(g.setLighthouse)g.setLighthouse(env.beacon);else g.world.setBeaconLit(env.beacon);}
        if(env.mood===3 && !g.world.getEnvironment().beacon)g.world.setMood(3);
        if(env.mood===1 && src.level>=3 && g.world2.chapter===1 && g.world.getEnvironment().beacon) g.world.setMood(1);
        if(env.mood===2 && g.journey?.abyssCleared) g.world.setMood(2);
        this.publish();
      } else if (e.kind === 'condition' && u?.hostile && u.alive && !u.invulnerable && src.distTo(u)<38 && e.condition) {
        const f=e.condition;
        u.stunUntil=Math.max(u.stunUntil,g.time+f.stun);
        if (f.stun>0) { u.cancelPendingHit(); g.vfx.stunStars(u,f.stun); }
        if (f.slow>0) { u.slowUntil=Math.max(u.slowUntil,g.time+f.slow); u.slowPct=f.slowPct; }
        if (f.pushTime>0 && u.kind !== 'boss') { u.pushX=f.pushX; u.pushZ=f.pushZ; u.pushTime=f.pushTime; }
      } else if (e.kind === 'challenge') {
        const b = e.target==='b30'?g.dawnBoss:e.target === 'b3' ? g.boss : e.target === 'b20' ? g.worldBoss : g.finalBoss;
        const chapter=b===g.dawnBoss?3:b===g.worldBoss?2:1;
        if (src.level >= b.profile.level && g.world2.chapter===chapter && (chapter===1?(b===g.boss||g.journey?.rustCleared):g.world2.canTravel(chapter)) && !g.encounter.engaged) b.wake();
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
        if (f.pushTime > 0) {
          // A slightly early next packet must not discard the previous packet's last frame.
          const left = Math.max(0, p.pushTime), seconds = left + f.pushTime;
          p.pushX = (p.pushX * left + f.pushX * f.pushTime) / seconds;
          p.pushZ = (p.pushZ * left + f.pushZ * f.pushTime) / seconds;
          p.pushTime = seconds;
        }
      }
    } finally { this.applying = false; }
  }
  private snapshot(): WorldState {
    const g = this.game, now = g.time;
    return {social:{mode:this.mode,parties:Object.fromEntries(Object.entries(this.parties).filter(([id])=>id===this.ownId||this.peers().has(id)))}, weather: {...g.world.getEnvironment(),clock:this.sceneClock}, entities: [...this.units].map(([id,u]) => {
      const e = u.kind === 'scrapling' || u.kind === 'scavenger' ? u.ctrl as Enemy : null;
      const round = (n: number) => Math.round(n * 1000) / 1000;
      return { id, x: round(u.pos.x), y: round(u.pos.y), z: round(u.pos.z), yaw: round(u.yaw), hp: u.hp, maxHp: u.maxHp,
        level: u.level, alive: u.alive, hidden: u.hidden, invulnerable: u.invulnerable, targetable: u.targetable,
        stun: Math.min(60,Math.max(0,u.stunUntil-now)), slow: Math.min(60,Math.max(0,u.slowUntil-now)), slowPct: u.slowPct,
        rust: u.rust, rustFor: Math.min(60,Math.max(0,u.rustUntil-now)), ...(e ? { enemyState: e.state, xp: e.stats.xp } : {}) };
    }), bosses: [g.boss.networkState('b3'),g.finalBoss.networkState('b10'),g.worldBoss.networkState('b20'),g.dawnBoss.networkState('b30')], chapter:g.world2.chapter,finalCleared:!!g.journey?.finalCleared, firstEnding:!!g.journey?.firstEndingSeen, trueCleared:!!g.journey?.trueCleared, rust: !!g.journey?.rustCleared, abyss: !!g.journey?.abyssCleared };
  }
  private publish() { if (this.active && this.authority) this.send({ type: 'world', world: this.snapshot() }); }
  apply(world: WorldState, instant = false) {
    if (!this.active) return;
    const g = this.game;
    this.mode=world.social?.mode??'coop';this.parties={...(world.social?.parties??{})};
    this.applying = true;
    try {
      if (g.journey) { g.journey.rustCleared=world.rust; g.journey.abyssCleared=world.abyss; g.journey.firstEndingSeen=world.firstEnding; g.journey.trueCleared=world.trueCleared;g.journey.finalCleared=!!world.finalCleared; }
      if(world.chapter!==g.world2.chapter)g.world2.go(world.chapter,false);
      if (world.weather) {
        const current=g.world.getEnvironment();
        if (instant || current.mood!==world.weather.mood) this.originalMood(world.weather.mood,instant);
        if (current.beacon!==world.weather.beacon) this.originalBeacon(world.weather.beacon);
        g.beaconLit=world.weather.beacon;
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
      for (const s of world.bosses) (s.id==='b30'?g.dawnBoss:s.id === 'b3' ? g.boss : s.id === 'b20' ? g.worldBoss : g.finalBoss).applyNetwork(s);
      if (g.journey) { g.journey.rustCleared=world.rust; g.journey.abyssCleared=world.abyss; }
    } finally { this.applying = false; }
    // Shared environment satisfies each player's active beacon objective, including late accepts.
    if(g.world2.chapter===1&&g.beaconLit)g.quests.bump('beacon');
  }
  update(dt: number) {
    if (!this.active) return;
    if (this.authority) {
      if ((this.elapsed += dt) >= 0.1) { this.elapsed = 0; this.publish(); }
      const peers = this.peers();
      // Remote proxies have no Player.update to expire forces. Integrate the intended movement
      // before the 5Hz effect packet, preserving short impulses and continuous pulls alike.
      for (const [id, p] of peers) {
        const u = p.unit;
        if (!u || u.pushTime <= 0 || dt <= 0) continue;
        const seconds = Math.min(dt, u.pushTime);
        const push = this.remotePush.get(id) ?? { x: 0, z: 0, seconds: 0 };
        push.x += u.pushX * seconds; push.z += u.pushZ * seconds; push.seconds += seconds;
        this.remotePush.set(id, push);
        u.pushTime = Math.max(0, u.pushTime - dt);
      }
      for (const id of this.remotePush.keys()) if (!peers.has(id)) this.remotePush.delete(id);
      if ((this.effectAt += dt) >= 0.2) {
        this.effectAt = 0;
        for (const [id, p] of peers) {
          const u = p.unit; if (!u) continue;
          const stun = Math.max(0,u.stunUntil-this.game.time), rustFor=Math.max(0,u.rustUntil-this.game.time);
          const push = this.remotePush.get(id);
          if (stun || rustFor || push) this.event({ kind:'effect',target:id,effect:{stun,rust:u.rust,rustFor,pushX:push ? push.x / push.seconds : 0,pushZ:push ? push.z / push.seconds : 0,pushTime:push?.seconds ?? 0} });
          this.remotePush.delete(id);
        }
      }
    } else {
      for (const [u,s] of this.goals) {
        const k=1-Math.exp(-25*dt);
        u.pos.x+=(s.x-u.pos.x)*k; u.pos.y+=(s.y-u.pos.y)*k; u.pos.z+=(s.z-u.pos.z)*k;
        // Dialogue is personal: preserve this guest's look toward their own speaker.
        // All idle NPCs and other units follow the authoritative shared orientation.
        if (!(u.kind === 'npc' && (u.ctrl as Npc | null)?.talking)) {
          u.setYaw(u.yaw+Math.atan2(Math.sin(s.yaw-u.yaw),Math.cos(s.yaw-u.yaw))*k);
        }
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
