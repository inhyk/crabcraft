// Feasibility spike (docs/server-world.md): one World I area simulated headless in Node with the
// game's own classes. Player (movement, GCD, cooldowns, casts, auto-attack, resources, XP),
// abilities.ts, Combat, Enemy (wander, aggro, packs, chase, leap, leash, respawn), Boss (Corrodius'
// phases and mechanics) and Unit (status effects, hit timing) are the shipped code, bundled as is.
// Only what they reach for in the browser is replaced: the rig and motion controller by stubs, the
// HUD, audio, camera shake and effects by no-ops, input by scripted bots, and the single local
// player by one Game view per simulated player (see SimGame.viewFor).
import * as THREE from 'three';
import { CLASSES } from '../../../src/data/classes';
import type { ClassId, CrabRig, CrabSpec, RaceId } from '../../../src/crab/types';
import { Boss } from '../../../src/game/boss';
import { Combat, type HitOptions } from '../../../src/game/combat';
import { Enemy, ENEMY_STATS, type EnemyKind } from '../../../src/game/enemies';
import { Player } from '../../../src/game/player';
import { BOSS_PROFILES, xpForLevel } from '../../../src/game/progression';
import { QuestLog } from '../../../src/game/quests';
import { Unit, type Reaction, type UnitKind } from '../../../src/game/unit';
import { mulberry32, yawTo } from '../../../src/game/util';
import type { MotionController, MotionId, MotionPlayOptions } from '../../../src/motion/types';
import type { Poi, World } from '../../../src/world/types';

// ------------------------------------------------------------------ browser stand-ins

/** Absorbs any property read or call: the HUD, audio, camera shake and effects on a server. */
const NOOP: any = new Proxy(() => {}, {
  get(_t, k) {
    if (k === 'then') return undefined;
    if (k === Symbol.toPrimitive) return () => 0;
    return NOOP;
  },
  apply() {
    return NOOP;
  },
});
/** An object whose own fields are real and everything else is NOOP. */
const partial = <T extends object>(own: T): T & Record<string, any> =>
  new Proxy(own, { get: (t, k) => (k in t ? (t as any)[k] : NOOP) }) as T & Record<string, any>;

/** A rig with no meshes: a root to hold position and yaw, one socket, a face that ignores everything. */
function stubRig(spec: CrabSpec): CrabRig {
  const root = new THREE.Group();
  const socket = new THREE.Object3D();
  socket.position.set(0, 0.8, 0.3);
  root.add(socket);
  return {
    root,
    metersToUnits: 1,
    body: root,
    spec,
    face: { setExpression() {}, setTint() {} } as unknown as CrabRig['face'],
    setJoint() {},
    setPose() {},
    getSocket: () => socket,
    applySpec: async () => {},
    update() {},
    dispose() {},
  };
}

/**
 * Plays nothing and sends no clip events, so every swing lands on Unit.act's fallback timer
 * (the clip's own hit moment plus 0.1 s, src/motion/skills.ts): deterministic and data-only.
 */
function stubMotion(): MotionController {
  let action: MotionId | null = null;
  let left = 0;
  return {
    setLocomotion() {},
    play(id: MotionId, o?: MotionPlayOptions) {
      action = id;
      left = o?.loop ? Infinity : 0.8;
    },
    stop() {
      action = null;
    },
    get action() {
      return action;
    },
    update(dt: number) {
      if ((left -= dt) <= 0) action = null;
    },
    dispose() {},
  };
}

class ScriptedInput {
  readonly down = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  dx = 0;
  isDown(code: string) {
    return this.down.has(code);
  }
  wasPressed() {
    return false;
  }
  isButtonDown() {
    return false;
  }
  wasClicked() {
    return false;
  }
}

interface Projectile {
  x: number;
  y: number;
  z: number;
  target: Unit;
  speed: number;
  t: number;
  onHit: () => void;
}

// ------------------------------------------------------------------ the simulated area

/**
 * normal: World I's own enemies; dense: one enemy per player near the same homes; spread: dense, with
 * 40 % of the players around Clawhaven (square, forge, chapel, tavern, grove) instead of hunting;
 * boss: Corrodius with every player in his arena.
 */
export type Scenario = 'normal' | 'dense' | 'spread' | 'boss';

export interface SimStats {
  actions: number;
  damageEvents: number;
  kills: number;
  playerDeaths: number;
  xp: number;
  mechs: number;
  projectiles: number;
}

const CLASS_ORDER: ClassId[] = ['warrior', 'mage', 'priest'];
const RACE_ORDER: RaceId[] = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'];
const v2 = new THREE.Vector2();
const tv1 = new THREE.Vector3();
const tv2 = new THREE.Vector3();

export class SimClient {
  readonly input = new ScriptedInput();
  readonly follow = partial({ steering: true, forwardYaw: 0, yaw: 0 });
  readonly quests = new QuestLog();
  player!: Player;
  combat!: Combat;
  deadUntil = -1;
  nextThink = 0;
  slot = 0;
  wander: THREE.Vector3 | null = null;
  /** Where a player who is not hunting strolls (spread scenario), else null. */
  home: THREE.Vector3 | null = null;
  constructor(readonly index: number) {}
  get unit(): Unit {
    return this.player.unit;
  }
}

export class SimGame {
  time = 0;
  readonly units: Unit[] = [];
  readonly enemies: Enemy[] = [];
  readonly clients: SimClient[] = [];
  readonly stats: SimStats = { actions: 0, damageEvents: 0, kills: 0, playerDeaths: 0, xp: 0, mechs: 0, projectiles: 0 };
  // What enemies.ts, boss.ts, combat.ts and player.ts read from the Game.
  readonly world2 = { chapter: 1 };
  readonly journey = { rustCleared: false, onKill() {}, onBossDefeated() {} };
  readonly controlsLocked = false;
  readonly god = false;
  readonly zone = 'The Brine Shore';
  readonly multiplayer = null;
  readonly villageGames = null;
  readonly dawnBoss = undefined;
  readonly hud = partial({ dialogue: { unit: null, isOpen: false, typing: false } });
  readonly audio = NOOP;
  readonly follow = NOOP;
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10);
  readonly vfx: any;
  readonly combat: Pick<Combat, 'damage' | 'heal' | 'kill'>;
  /** Stand-in for Game.player where shared code still assumes one local player (see the doc). */
  readonly player: any;
  boss: Boss | null = null;
  private readonly adds: Enemy[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly sharedCombat: Combat;
  private readonly clientOf = new Map<Unit, SimClient>();
  private readonly huntPoints: THREE.Vector3[] = [];
  private lastMech: string | null = null;
  private readonly rnd = mulberry32(7);

  constructor(readonly world: World, readonly scenario: Scenario) {
    // A camera far above the map: canRespawnUnseen() then only checks for nearby players.
    this.camera.position.set(0, 5000, 0);
    this.camera.lookAt(0, 10000, 0);
    this.camera.updateMatrixWorld(true);
    this.vfx = partial({
      // Ranged damage lands when the effect's homing orb arrives (vfx.projectile's onHit).
      projectile: (from: THREE.Vector3, target: Unit, _style: string, speed: number, onHit: () => void) => {
        this.stats.projectiles++;
        this.projectiles.push({ x: from.x, y: from.y, z: from.z, target, speed, t: 0, onHit });
      },
    });
    this.sharedCombat = new Combat(this as never);
    const game = this;
    this.combat = {
      damage(src: Unit | null, dst: Unit, amount: number, o?: HitOptions) {
        game.stats.damageEvents++;
        return game.combatFor(src, dst).damage(src, dst, amount, o);
      },
      heal(src: Unit | null, dst: Unit, amount: number, crit?: boolean) {
        return game.combatFor(src, dst).heal(src, dst, amount, crit);
      },
      kill(dst: Unit, src: Unit | null) {
        return game.combatFor(src, dst).kill(dst, src);
      },
    };
    this.player = {
      get unit() {
        return game.clients[0]?.unit;
      },
      onDamaged() {},
      gainRage() {},
      onWardHit() {},
      /** Enemies ask the local player for sight; here it is sight from the enemy's own target. */
      lineOfSight(t: Unit) {
        const p = game.combatTarget(t);
        const from = tv1.set(p.pos.x, p.pos.y + p.height * 0.8, p.pos.z);
        const to = t.centre(tv2);
        const hit = game.world.raycastSolid(from, to);
        return hit === null || hit >= from.distanceTo(to) - t.radius - 0.3;
      },
    };
  }

  /** Player-dealt hits run in the attacker's view, hits on a player in the victim's (rage, pushback, wards). */
  private combatFor(src: Unit | null, dst: Unit): Combat {
    return (dst && this.clientOf.get(dst)?.combat) || (src && this.clientOf.get(src)?.combat) || this.sharedCombat;
  }

  get partyLevel(): number {
    let l = 1;
    for (const c of this.clients) l = Math.max(l, c.unit.level);
    return l;
  }

  combatTarget(from: Unit): Unit {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const c of this.clients) {
      const u = c.unit;
      if (!u.alive) continue;
      const d = (u.pos.x - from.pos.x) ** 2 + (u.pos.z - from.pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best ?? this.clients[0].unit;
  }

  combatPlayers(): Unit[] {
    return this.clients.map((c) => c.unit).filter((u) => u.alive && !u.hidden);
  }

  say(): void {}

  addUnit(name: string, kind: UnitKind, reaction: Reaction, spec: CrabSpec): Unit {
    const u = new Unit(name, kind, reaction, stubRig(spec), stubMotion());
    u.radius = kind === 'boss' ? 2.2 : 0.55;
    u.height = kind === 'boss' ? 3.8 : 1;
    u.onAction = () => this.stats.actions++;
    this.units.push(u);
    return u;
  }

  // ---------------------------------------------------------------- setup

  /** The enemies game.ts places in World I, from the same spawn data and rules. */
  private worldOneJobs(): { kind: EnemyKind; home: THREE.Vector3; radius: number; pack: number }[] {
    const w = this.world;
    const jobs: { kind: EnemyKind; home: THREE.Vector3; radius: number; pack: number }[] = [];
    const packSizes = [3, 2, 2, 3, 2, 2];
    const scrap = w.spawns.find((s) => s.id === 'scraplings')!;
    let total = 0;
    scrap.points.forEach((pt, i) => {
      const n = Math.min(packSizes[i % packSizes.length], 12 - total);
      if (n <= 0) return;
      total += n;
      for (let k = 0; k < n; k++) jobs.push({ kind: 'scrapling', home: pt, radius: Math.min(scrap.radius, 6), pack: i });
    });
    const scav = w.spawns.find((s) => s.id === 'scavengers')!;
    for (let k = 0; k < Math.max(3, scav.points.length); k++) jobs.push({ kind: 'scavenger', home: scav.points[k % scav.points.length], radius: Math.min(scav.radius, 4), pack: 100 + k });
    const shore = w.pois.shore.position;
    for (let i = 0; i < 3; i++) {
      let best = shore.clone();
      let delta = Infinity;
      for (let dx = -22; dx <= 22; dx += 2)
        for (let dz = -22; dz <= 22; dz += 2) {
          const x = shore.x + dx + i * 4;
          const z = shore.z + dz;
          const y = w.heightAt(x, z);
          const d = Math.abs(y - 0.4);
          if (d < delta && Math.hypot(dx, dz) > 6) {
            w.resolveCollision(x, z, 0.8, v2);
            if (Math.hypot(v2.x - x, v2.y - z) < 0.2) {
              delta = d;
              best.set(x, y, z);
            }
          }
        }
      jobs.push({ kind: 'scrapling', home: best, radius: 2, pack: 200 + i });
    }
    const seaHomes: THREE.Vector3[] = [];
    for (const [ax, az] of [[118, 24], [130, 43], [130, 65], [142, 84], [156, 102], [174, 83]]) {
      let best: THREE.Vector3 | null = null;
      let score = Infinity;
      for (let dx = -28; dx <= 28; dx += 2)
        for (let dz = -24; dz <= 24; dz += 2) {
          const x = ax + dx;
          const z = az + dz;
          const y = w.heightAt(x, z);
          if (y > -0.15 || y < -0.9 || seaHomes.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
          w.resolveCollision(x, z, 1.3, v2);
          if (Math.hypot(v2.x - x, v2.y - z) > 0.15) continue;
          const s = Math.abs(y + 0.55) + Math.hypot(dx, dz) * 0.008;
          if (s < score) {
            score = s;
            best = new THREE.Vector3(x, y, z);
          }
        }
      if (best) {
        seaHomes.push(best);
        jobs.push({ kind: 'jellyfish', home: best, radius: 3, pack: 300 + seaHomes.length });
      }
    }
    return jobs;
  }

  /** A walkable dry point within `r` of `c`, or `c`. */
  private landNear(c: THREE.Vector3, r: number): THREE.Vector3 {
    for (let k = 0; k < 30; k++) {
      const a = this.rnd() * Math.PI * 2;
      const d = this.rnd() * r;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      this.world.resolveCollision(x, z, 0.6, v2);
      if (Math.hypot(v2.x - x, v2.y - z) < 0.2 && this.world.heightAt(x, z) > 0.1) return new THREE.Vector3(x, this.world.heightAt(x, z), z);
    }
    return c.clone();
  }

  setup(players: number, mobsPerPlayer = 1, level = 5): void {
    const w = this.world;
    let jobs = this.worldOneJobs();
    const land = jobs.filter((j) => j.kind !== 'jellyfish');
    // A shared area needs more mobs than one player's world: copy packs near their homes.
    if (this.scenario === 'dense' || this.scenario === 'spread') {
      const want = Math.max(jobs.length, Math.ceil(players * mobsPerPlayer));
      for (let i = 0; jobs.length < want; i++) {
        const j = land[i % land.length];
        jobs.push({ ...j, home: this.landNear(j.home, 18), pack: 1000 + i });
      }
    }
    this.huntPoints.push(...land.map((j) => j.home));
    const packs = new Map<number, Enemy[]>();
    for (const j of jobs) {
      const u = this.addUnit(ENEMY_STATS[j.kind].name, j.kind, 'hostile', { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: j.kind });
      const a = this.rnd() * Math.PI * 2;
      const r = j.kind === 'jellyfish' ? 0 : this.rnd() * j.radius * 0.6;
      u.teleport(w, j.home.x + Math.cos(a) * r, j.home.z + Math.sin(a) * r, this.rnd() * Math.PI * 2);
      const e = new Enemy(this as never, u, j.kind, j.home.clone(), j.radius);
      this.enemies.push(e);
      let pk = packs.get(j.pack);
      if (!pk) packs.set(j.pack, (pk = []));
      pk.push(e);
      e.pack = pk;
    }

    let arena: Poi | null = null;
    if (this.scenario === 'boss') {
      // Corrodius on open sand: the wreck deck is one of the colliders this spike does not bake.
      const at = this.landNear(w.pois.shore.position, 4);
      arena = { id: 'bossArena', position: at, yaw: 0, radius: 12 };
      const spec: CrabSpec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Corrodius' };
      const bu = this.addUnit('Corrodius', 'boss', 'hostile', spec);
      const fu = this.addUnit('Little Red', 'freed', 'friendly', spec);
      this.boss = new Boss(this as never, bu, arena, fu, BOSS_PROFILES.rust);
      // Enough health to outlast the run; phases are forced on a timer in tick().
      bu.maxHp = bu.hp = 1_000_000;
      for (let i = 0; i < 3; i++) {
        const u = this.addUnit('Scrapling', 'scrapling', 'hostile', spec);
        const e = new Enemy(this as never, u, 'scrapling', at.clone(), 4);
        e.isAdd = true;
        e.despawn();
        this.adds.push(e);
        this.enemies.push(e);
      }
    }

    for (let i = 0; i < players; i++) {
      const c = new SimClient(i);
      const classId = CLASS_ORDER[i % CLASS_ORDER.length];
      const spec: CrabSpec = { race: RACE_ORDER[i % RACE_ORDER.length], sex: i % 2 ? 'female' : 'male', classId, shell: i % 4, crest: i % 4, led: i % 4, name: `Bot${i}` };
      const u = this.addUnit(spec.name, 'player', 'player', spec);
      // One Game per player: Player reads input, camera and "the" player from it.
      const view = Object.create(this) as Record<string, unknown>;
      view.input = c.input;
      view.follow = c.follow;
      view.quests = c.quests;
      c.player = new Player(view as never, u, CLASSES[classId]);
      view.player = c.player;
      c.combat = new Combat(view as never);
      c.player.restoreXp(xpForLevel(level));
      c.quests.accept('q1');
      this.clientOf.set(u, c);
      this.clients.push(c);
      const towns = [w.pois.spawn, w.pois.forge, w.pois.chapel, w.pois.tavern, w.pois.grove];
      if (this.scenario === 'spread' && i % 5 < 2) c.home = towns[i % towns.length].position;
      const at = arena ? this.landNear(arena.position, 9) : c.home ? this.landNear(c.home, 12) : this.landNear(this.huntPoints[i % this.huntPoints.length], 10);
      u.teleport(w, at.x, at.z, this.rnd() * Math.PI * 2);
    }
    if (this.boss) this.boss.wake();
  }

  // ---------------------------------------------------------------- outcomes (Game.onUnitDied)

  onUnitDied(u: Unit, killer: Unit | null): void {
    if (u.kind === 'player') {
      this.stats.playerDeaths++;
      const c = this.clientOf.get(u);
      if (c) c.deadUntil = this.time + 3.6;
      return;
    }
    const kc = killer ? this.clientOf.get(killer) : undefined;
    if (u.kind === 'scrapling' || u.kind === 'scavenger' || u.kind === 'jellyfish') {
      const e = u.ctrl as Enemy;
      if (kc) {
        this.stats.kills++;
        if (!e.isAdd) {
          kc.player.coins += Math.max(5, Math.round(e.stats.xp / 4));
          kc.player.gainXp(e.stats.xp);
          this.stats.xp += e.stats.xp;
        }
        if (u.kind === 'scrapling') kc.quests.bump('kill-scrapling');
        else if (u.kind === 'scavenger') kc.quests.bump('kill-scavenger');
      }
      for (const m of e.pack) if (m !== e && m.unit.alive) m.aggro(false);
    }
  }

  spawnAdd(x: number, z: number): Enemy | null {
    const e = this.adds.find((a) => a.state === 'gone');
    if (!e) return null;
    e.respawnAt(x, z);
    e.aggro(false);
    return e;
  }

  // ---------------------------------------------------------------- one tick

  tick(dt: number): void {
    this.time += dt;
    for (const c of this.clients) this.think(c);
    for (const c of this.clients) c.player.update(dt);
    for (const e of this.enemies) e.update(dt);
    if (this.boss) {
      this.boss.update(dt);
      const m = this.boss.mechName;
      if (m && m !== this.lastMech) this.stats.mechs++;
      this.lastMech = m;
      // Walk the fight through its phases: below 60 % adds, Undertow and Cross; below 25 % enrage.
      const u = this.boss.unit;
      if (this.boss.engaged && this.time > 20 && this.boss.phase === 1) u.hp = Math.min(u.hp, u.maxHp * 0.55);
      if (this.boss.engaged && this.time > 40 && this.boss.phase === 2) u.hp = Math.min(u.hp, u.maxHp * 0.2);
    }
    this.separate();
    for (const u of this.units) if (u.rustUntil && this.time >= u.rustUntil) u.rust = u.rustUntil = 0;
    for (const c of this.clients) if (!c.unit.alive && c.deadUntil >= 0 && this.time >= c.deadUntil) this.respawn(c);
    this.updateProjectiles(dt);
    // Pending swings land from Unit.updateVisual (the clip's hit moment); it must run on a server too.
    for (const u of this.units) u.updateVisual(dt);
  }

  private respawn(c: SimClient): void {
    c.deadUntil = -1;
    c.player.respawn();
    const home = this.boss ? this.boss.arena.position : this.huntPoints[c.index % this.huntPoints.length];
    const at = this.landNear(home, 10);
    c.unit.teleport(this.world, at.x, at.z);
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const dest = p.target.centre(tv1);
      const dx = dest.x - p.x;
      const dy = dest.y - p.y;
      const dz = dest.z - p.z;
      const len = Math.hypot(dx, dy, dz);
      const step = p.speed * dt;
      if (len <= step || !p.target.alive || p.t >= 6) {
        this.projectiles.splice(i, 1);
        p.onHit();
        continue;
      }
      p.x += (dx / len) * step;
      p.y += (dy / len) * step;
      p.z += (dz / len) * step;
    }
  }

  /** Game.separate(): keep crabs from standing inside each other. */
  private separate(): void {
    const list = this.units.filter((u) => u.alive && !u.hidden && (u.hostile || u.kind === 'player'));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = (a.radius + b.radius) * 0.85;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        const wa = a.kind === 'boss' ? 0 : a.kind === 'player' ? 0.2 : 0.5;
        const wb = b.kind === 'boss' ? 0 : b.kind === 'player' ? 0.2 : 0.5;
        const sum = wa + wb || 1;
        a.pos.x -= dx * push * (wa / sum);
        a.pos.z -= dz * push * (wa / sum);
        b.pos.x += dx * push * (wb / sum);
        b.pos.z += dz * push * (wb / sum);
      }
    }
  }

  // ---------------------------------------------------------------- bots

  /** A scripted player: pick the nearest enemy, walk into range, cycle abilities. */
  private think(c: SimClient): void {
    const p = c.player;
    const u = p.unit;
    c.input.down.clear();
    if (!u.alive) return;
    if (c.home) {
      // A player in town: stroll between points near the square, stop now and then.
      if (!c.wander || Math.hypot(c.wander.x - u.pos.x, c.wander.z - u.pos.z) < 1.5) c.wander = this.rnd() < 0.3 ? u.pos.clone() : this.landNear(c.home, 14);
      if (Math.hypot(c.wander.x - u.pos.x, c.wander.z - u.pos.z) >= 1.5) {
        c.follow.forwardYaw = yawTo(u.pos.x, u.pos.z, c.wander.x, c.wander.z);
        c.input.down.add('KeyW');
      }
      return;
    }
    let t = p.target;
    if (!t || !t.alive || t.hidden || !t.targetable) {
      t = null;
      if (this.boss?.unit.targetable && this.boss.unit.alive && c.index % 10 < 7) t = this.boss.unit;
      else {
        let bestD = 45 * 45;
        for (const o of this.units) {
          if (!o.hostile || !o.alive || o.hidden || !o.targetable) continue;
          const d = (o.pos.x - u.pos.x) ** 2 + (o.pos.z - u.pos.z) ** 2;
          if (d < bestD) {
            bestD = d;
            t = o;
          }
        }
      }
      p.setTarget(t);
    }
    if (!t) {
      if (!c.wander || Math.hypot(c.wander.x - u.pos.x, c.wander.z - u.pos.z) < 2) c.wander = this.landNear(this.huntPoints[Math.floor(this.rnd() * this.huntPoints.length)], 8);
      c.follow.forwardYaw = yawTo(u.pos.x, u.pos.z, c.wander.x, c.wander.z);
      c.input.down.add('KeyW');
      return;
    }
    const gap = u.gapTo(t);
    const melee = p.cls.id === 'warrior';
    c.follow.forwardYaw = yawTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
    if (gap > (melee ? 1.2 : 12)) c.input.down.add('KeyW');
    if (this.time >= c.nextThink) {
      c.nextThink = this.time + 0.4;
      c.slot = (c.slot % 4) + 1;
      p.useAbility(c.slot);
    }
  }
}
