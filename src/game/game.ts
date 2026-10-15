import {t} from '../i18n';
import {loadingLabel,loadingTips,regionName,regionSubtitle} from './worldLocale';
// The game session: loads the world and every crab, runs the frame loop, routes input, and glues
// quests, combat, AI, effects, music and the HUD together.
import * as THREE from 'three';
import {starMemory} from './starMemories';
import { HiddenWorld } from './world2';
import { Multiplayer } from '../multiplayer/client';
import type { App } from '../app';
import { localStorageGet, localStorageSet } from '../app';
import type { FrameInfo, QualitySetting } from '../core/engine';
import { FollowCamera } from '../core/followCamera';
import { createCrab, createEnemyCrab } from '../crab/provider';
import type { CrabRig, CrabSpec, RaceId } from '../crab/types';
import { createMotionController } from '../motion/provider';
import { createWorld } from '../world/provider';
import type { PoiId, World } from '../world/types';
import { CLASSES } from '../data/classes';
import { RACES, RACE_ORDER } from '../data/races';
import { h, art } from '../ui/dom';
import { Hud } from '../ui/hud/hud';
import type { QuestMark } from '../ui/hud/plates';
import { Boss } from './boss';
import { BossJourney } from './bossJourney';
import { BOSS_PROFILES } from './progression';
import { Combat } from './combat';
import { DebugTools } from './debug';
import { CameraDirector } from './director';
import { EndingSequence } from './ending';
import { Enemy, ENEMY_STATS, type EnemyKind } from './enemies';
import { Npc, Townsfolk } from './npcs';
import { NavHints } from './nav';
import { ObjectiveMarker } from './objective';
import { Player } from './player';
import {
  NPCS,
  QUESTS,
  QuestLog,
  RATTLEBOLT_AFTER,
  RATTLEBOLT_Q3,
  type NpcId,
  type QuestId,
} from './quests';
import { PortraitStudio, snapshotMap } from './snapshots';
import { Unit, type Reaction, type UnitKind } from './unit';
import { mulberry32, pick, yawTo } from './util';
import { Vfx, C } from './vfx/vfx';

type CreateCrabWithExtras = (spec: CrabSpec, extras?: string[]) => Promise<CrabRig>;
// The contract's createCrab takes one argument; the real model accepts gear extras as a second.
const createCrabX = createCrab as unknown as CreateCrabWithExtras;

export const DEFAULT_SPEC: CrabSpec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Pinchwick' };

const CULL_DIST = 80;
const SHADOW_DIST = 18;

const ZONES: { name: string; anchors: PoiId[] }[] = [
  { name: 'Clawhaven', anchors: ['spawn', 'forge', 'chapel', 'tavern'] },
  { name: 'Moonpool Grove', anchors: ['grove'] },
  { name: 'The Brine Shore', anchors: ['shore'] },
  { name: 'Saltmere Lighthouse', anchors: ['lighthouse', 'beacon'] },
  { name: 'The Iron Wreck', anchors: ['wreck', 'bossArena'] },
];

const TOWNSFOLK_NAMES = ['Clawdia', 'Shelldon', 'Pinchy', 'Barnaby', 'Coral', 'Sandy', 'Scuttles', 'Nippy', 'Marina', 'Kelpie', 'Tidewell', 'Bubbles'];
const TOWNSFOLK_TITLES: Record<RaceId, string> = {
  human: 'Lamplighter',
  orc: 'Net Mender',
  dwarf: 'Tinker',
  undead: 'Tavern Regular',
  nightelf: 'Pearl Diver',
  tauren: 'Stew Taster',
};

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  readonly combat: Combat;
  readonly quests = new QuestLog();
  readonly ending: EndingSequence;
  world!: World;
  vfx!: Vfx;
  hud!: Hud;
  follow!: FollowCamera;
  director!: CameraDirector;
  player!: Player;
  boss!: Boss;
  finalBoss!: Boss;
  worldBoss!: Boss;
  world2!: HiddenWorld;
  journey: BossJourney | null = null;

  get encounter(): Boss {
    if (this.world2?.chapter===2 && this.worldBoss) return this.worldBoss;
    return this.finalBoss && this.finalBoss.state !== 'dormant' && this.finalBoss.state !== 'dead' ? this.finalBoss : this.boss;
  }
  objective!: ObjectiveMarker;
  nav!: NavHints;
  /** Next waypoint of the quest hint (debug and playtest read it). */
  hintVia: THREE.Vector3 | null = null;
  units: Unit[] = [];
  enemies: Enemy[] = [];
  npcs: Npc[] = [];
  townsfolk: Townsfolk[] = [];
  private adds: Enemy[] = [];
  time = 0;
  god = false;
  debug: DebugTools | null = null;
  loaded = false;
  alive = true;
  cinematic = false;
  zone = '';
  musicOn = true;
  private music = '';
  private combatMusicUntil = 0;
  private zoneCandidate = '';
  private zoneSince = 0;
  private deadUntil = 0;
  private respawning = false;
  private offFrame: (() => void) | null = null;
  private offAfter: (() => void) | null = null;
  private loadingEl: HTMLElement | null = null;
  private cogMisses = 0;
  private robotConfirmUntil = 0;
  beaconLit = false;
  private readyFlag = false;
  multiplayer: Multiplayer | null = null;

  constructor(readonly app: App) {
    this.combat = new Combat(this);
    this.ending = new EndingSequence(this);
  }

  get engine() {
    return this.app.engine;
  }
  get input() {
    return this.app.input;
  }
  get audio() {
    return this.app.audio;
  }

  /** Movement, abilities and targeting are off (dead, cutscene, menu). */
  get controlsLocked(): boolean {
    return this.cinematic || this.ending.active || !this.player.unit.alive || this.respawning || this.hud.menu.open;
  }

  // ================================================================ loading

  async load(): Promise<void> {
    const app = this.app;
    const spec: CrabSpec = { ...DEFAULT_SPEC, ...(app.spec ?? {}) };
    if (!CLASSES[spec.classId]) spec.classId = 'warrior';
    if (!RACES[spec.race]) spec.race = 'human';
    this.showLoading();
    const progress = (f: number, label: string) => this.setLoading(f, label);

    const musicVol = Number(localStorageGet('cc.musicVol') ?? NaN);
    const sfxVol = Number(localStorageGet('cc.sfxVol') ?? NaN);
    if (Number.isFinite(musicVol)) app.audio.setMusicVolume(musicVol);
    if (Number.isFinite(sfxVol)) app.audio.setSfxVolume(sfxVol);
    void app.audio.preload(['sfx-hit', 'sfx-crit', 'sfx-cast', 'sfx-heal', 'sfx-click', 'sfx-error', 'sfx-quest-accept', 'sfx-quest-complete', 'sfx-levelup']);

    progress(0.02, 'Raising the tide');
    this.world = await createWorld({
      renderer: app.engine.renderer,
      scene: this.scene,
      quality: app.engine.quality,
      onProgress: (f, label) => progress(0.05 + f * 0.5, label),
    });
    if (!this.alive) return;
    this.world2 = new HiddenWorld(this);
    progress(0.56, 'Building Starhaven');
    await this.world2.buildSettlement();
    this.engine.setView(this.scene, this.camera, { bloom: { intensity: 0.9, threshold: 0.9 }, vignette: { offset: 0.3, darkness: 0.5 } });
    this.vfx = new Vfx(this.scene);
    this.vfx.density = app.engine.quality === 'low' ? 0.55 : 1;
    this.objective = new ObjectiveMarker(this.vfx.fx);
    this.scene.add(this.objective.group);
    this.nav = new NavHints(this.world);

    progress(0.58, 'Waking the crabs of Clawhaven');
    const pois = this.world.pois;
    const playerRig = await createCrab(spec);
    const pu = this.addUnit(spec.name || 'Pinchwick', 'player', 'player', playerRig);
    this.player = new Player(this, pu, CLASSES[spec.classId]);

    // Named NPCs
    const npcRigs = await Promise.all(
      NPCS.map((n) =>
        createCrabX({ race: n.race, sex: n.sex, classId: n.classId, shell: n.shell, crest: n.crest, led: n.led, name: n.name }, n.extras),
      ),
    );
    NPCS.forEach((def, i) => {
      const poi = pois[def.poi];
      const u = this.addUnit(def.name, 'npc', 'friendly', npcRigs[i]);
      u.teleport(this.world, poi.position.x, poi.position.z, poi.yaw);
      this.npcs.push(new Npc(this, u, def, poi));
    });

    // Townsfolk: every race walks the streets.
    progress(0.66, 'Polishing shells');
    const town = this.world.spawns.find((s) => s.id === 'townsfolk');
    const rnd = mulberry32(1337);
    const folkSpecs: CrabSpec[] = [];
    // One of every race plus two more; with the named NPCs the square is busy without costing frames.
    const races: RaceId[] = [...RACE_ORDER, 'nightelf', 'undead'];
    races.forEach((race, i) => {
      const rd = RACES[race];
      folkSpecs.push({
        race,
        sex: i % 2 ? 'female' : 'male',
        classId: pick(['warrior', 'mage', 'priest'] as const, rnd),
        shell: Math.floor(rnd() * rd.shellColors.length),
        crest: Math.floor(rnd() * rd.crestStyles.length),
        led: Math.floor(rnd() * rd.ledColors.length),
        name: TOWNSFOLK_NAMES[i % TOWNSFOLK_NAMES.length],
      });
    });
    const folkRigs = await Promise.all(folkSpecs.map((s) => createCrab(s)));
    const folkPoints = town?.points.length ? town.points : [pois.spawn.position];
    folkSpecs.forEach((s, i) => {
      const u = this.addUnit(s.name, 'townsfolk', 'friendly', folkRigs[i]);
      u.title = `${RACES[s.race].name} ${TOWNSFOLK_TITLES[s.race]}`;
      const base = folkPoints[i % folkPoints.length];
      const a = rnd() * Math.PI * 2;
      const r = rnd() * (town?.radius ?? 5);
      u.teleport(this.world, base.x + Math.cos(a) * r, base.z + Math.sin(a) * r, rnd() * Math.PI * 2);
      this.townsfolk.push(new Townsfolk(this, u, folkPoints, town?.radius ?? 6));
    });

    // Enemies
    progress(0.76, 'Rusting the Scraplings');
    const packSizes = [3, 2, 2, 3, 2, 2];
    const MAX_SCRAPLINGS = 12;
    const enemyJobs: { kind: EnemyKind; home: THREE.Vector3; radius: number; pack: number }[] = [];
    const scrap = this.world.spawns.find((s) => s.id === 'scraplings');
    if (scrap) {
      let total = 0;
      scrap.points.forEach((pt, i) => {
        const n = Math.min(packSizes[i % packSizes.length], MAX_SCRAPLINGS - total);
        if (n <= 0) return;
        total += n;
        for (let k = 0; k < n; k++) enemyJobs.push({ kind: 'scrapling', home: pt, radius: Math.min(scrap.radius, 6), pack: i });
      });
      // Make sure the quest is always doable on small spawn lists.
      for (let k = 0; total < 7; k++, total++) enemyJobs.push({ kind: 'scrapling', home: scrap.points[k % scrap.points.length], radius: scrap.radius, pack: k % scrap.points.length });
    }
    const scav = this.world.spawns.find((s) => s.id === 'scavengers');
    if (scav) {
      for (let k = 0; k < Math.max(3, scav.points.length); k++) enemyJobs.push({ kind: 'scavenger', home: scav.points[k % scav.points.length], radius: Math.min(scav.radius, 4), pack: 100 + k });
    }
    const enemyRigs = await Promise.all(enemyJobs.map((j) => createEnemyCrab(j.kind)));
    const packs = new Map<number, Enemy[]>();
    enemyJobs.forEach((j, i) => {
      const u = this.addUnit(ENEMY_STATS[j.kind].name, j.kind, 'hostile', enemyRigs[i]);
      const a = rnd() * Math.PI * 2;
      const r = rnd() * j.radius * 0.6;
      u.teleport(this.world, j.home.x + Math.cos(a) * r, j.home.z + Math.sin(a) * r, rnd() * Math.PI * 2);
      const e = new Enemy(this, u, j.kind, j.home.clone(), j.radius);
      this.enemies.push(e);
      let pk = packs.get(j.pack);
      if (!pk) packs.set(j.pack, (pk = []));
      pk.push(e);
      e.pack = pk;
    });

    // Boss, his adds, and the little crab inside.
    progress(0.84, 'Something stirs in the Iron Wreck');
    const [bossRig, freedRig, ...addRigs] = await Promise.all([
      createEnemyCrab('corrodius'),
      createCrab({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 1, led: 0, name: 'Little Red' }),
      createEnemyCrab('scrapling'),
      createEnemyCrab('scrapling'),
      createEnemyCrab('scrapling'),
    ]);
    const bu = this.addUnit('Corrodius, the Rust Tyrant', 'boss', 'hostile', bossRig);
    const fu = this.addUnit('Little Red', 'freed', 'friendly', freedRig);
    fu.title = 'Free at last';
    this.boss = new Boss(this, bu, pois.bossArena, fu);
    const abyssRig = await createCrab({ race: 'nightelf', sex: 'female', classId: 'mage', shell: 2, crest: 3, led: 2, name: 'Nereid' });
    abyssRig.root.scale.multiplyScalar(3.5);
    const abyssUnit = this.addUnit(BOSS_PROFILES.abyss.name, 'boss', 'hostile', abyssRig);
    const pearlRig = await createCrab({ race: 'nightelf', sex: 'female', classId: 'priest', shell: 2, crest: 1, led: 2, name: 'Pearl' });
    const pearl = this.addUnit('Pearl', 'freed', 'friendly', pearlRig);
    pearl.title = '심해에서 돌아온 빛';
    this.finalBoss = new Boss(this, abyssUnit, pois.bossArena, pearl, BOSS_PROFILES.abyss);
    const eclipseRig=await createCrab({race:'undead',sex:'female',classId:'priest',shell:3,crest:3,led:2,name:'Astra'});
    eclipseRig.root.scale.multiplyScalar(4.5);
    const eclipseUnit=this.addUnit(BOSS_PROFILES.eclipse.name,'boss','hostile',eclipseRig);
    const starRig=await createCrab({race:'undead',sex:'female',classId:'priest',shell:2,crest:2,led:2,name:'Star'});
    const star=this.addUnit('돌아온 별빛','freed','friendly',starRig);
    this.worldBoss=new Boss(this,eclipseUnit,this.world2.arena,star,BOSS_PROFILES.eclipse);
    this.director = new CameraDirector(this);
    this.director.bossSee.apply(eclipseRig.root);
    this.director.bossSee.apply(abyssRig.root);
    // His armour thins where it covers the player's crab, the player's claws where they cross the
    // face of the NPC it talks to (both get their own copies of the shared crab materials).
    this.director.bossSee.apply(bossRig.root);
    this.director.playerSee.apply(playerRig.root);
    for (const r of addRigs) {
      const u = this.addUnit('Scrapling', 'scrapling', 'hostile', r);
      const e = new Enemy(this, u, 'scrapling', pois.bossArena.position.clone(), 4);
      e.isAdd = true;
      e.despawn();
      this.adds.push(e);
      this.enemies.push(e);
    }

    // Player start
    const spawn = pois.spawn;
    pu.teleport(this.world, spawn.position.x, spawn.position.z, spawn.yaw);

    this.follow = new FollowCamera(this.camera, {
      distance: 7.5,
      minDistance: 2.5,
      maxDistance: 22,
      lookHeight: Math.max(0.8, pu.height * 0.85 + 0.25),
      raycast: (a, b) => this.world.raycastSolid(a, b),
    });
    this.follow.yaw = pu.yaw + Math.PI;
    this.follow.pitch = 0.3;

    progress(0.9, 'Painting the portraits');
    this.hud = new Hud(this);
    this.app.ui.append(this.hud.root);
    this.hud.root.style.visibility = 'hidden';
    this.hud.dialogue.onClose = () => {
      for (const n of this.npcs) n.talking = false;
    };
    this.wireQuestEvents();
    this.engine.onResolutionChange = () => {
      if (this.hud.menu.open) this.hud.menu.updateResNote();
    };

    // Pose everyone once, then take portraits and the minimap picture.
    for (const u of this.units) u.updateVisual(0.016);
    for (const u of this.units) u.measure();
    this.follow.lookHeight = Math.max(0.8, pu.height * 0.85 + 0.25);
    const studio = new PortraitStudio(this.engine.renderer, this.scene.environment);
    const shotByKind = new Map<string, string>();
    for (const u of this.units) {
      if (u.kind === 'townsfolk') continue;
      const key = u.kind === 'scrapling' || u.kind === 'scavenger' ? u.kind : `id${u.id}`;
      let shot = shotByKind.get(key);
      if (!shot) {
        try {
          shot = studio.shoot(u.rig);
        } catch {
          shot = '';
        }
        shotByKind.set(key, shot);
      }
      u.portrait = shot;
    }
    studio.dispose();
    this.hud.playerFrame.setUnit(pu, `art/portraits/${spec.race}-${spec.sex}.webp`);
    try {
      this.hud.minimap.setSnapshot(this.takeMapSnapshot());
    } catch (err) {
      console.warn('minimap snapshot failed', err);
    }

    // Compile every shader before the first frame so nothing hitches mid-fight.
    progress(0.96, 'Lighting the lamps');
    this.vfx.fx.prewarm();
    this.camera.position.set(pu.pos.x, pu.pos.y + 3, pu.pos.z - 6);
    this.camera.lookAt(pu.pos);
    // The boss is hidden until the beacon wakes him; compile his see-through materials now too.
    bu.rig.root.visible = true;
    try {
      await this.engine.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* compileAsync is an optimisation only */
    }
    bu.rig.root.visible = !bu.hidden;
    if (!this.alive) return;

    this.debug = new DebugTools(this);
    progress(1, 'Welcome to Clawhaven');
    this.offFrame = this.engine.onFrame(this.frame);
    this.offAfter = this.engine.onAfterFrame(() => {
      if (!this.readyFlag && this.loaded) {
        this.readyFlag = true;
        (window as unknown as { __ready: boolean }).__ready = true;
      }
    });
    this.loaded = true;
    this.hideLoading();
    // The HUD fades in once the loading painting has mostly gone, instead of showing through it.
    const hudRoot = this.hud.root;
    hudRoot.style.opacity = '0';
    hudRoot.style.visibility = '';
    setTimeout(() => {
      hudRoot.style.transition = 'opacity 0.8s ease';
      hudRoot.style.opacity = '1';
      setTimeout(() => {
        hudRoot.style.transition = '';
        hudRoot.style.opacity = '';
      }, 900);
    }, 700);
    this.journey = new BossJourney(this);
    this.intro();
    this.multiplayer = new Multiplayer(this);
  }

  private addUnit(name: string, kind: UnitKind, reaction: Reaction, rig: CrabRig): Unit {
    // Shadows from the simplified body (the real crab rig offers it; see JumperRig.useShadowProxy).
    (rig as CrabRig & { useShadowProxy?: (on: boolean) => void }).useShadowProxy?.(true);
    const u = new Unit(name, kind, reaction, rig, createMotionController(rig));
    this.scene.add(rig.root);
    this.units.push(u);
    return u;
  }

  takeMapSnapshot() {
    const pts: THREE.Vector3[] = Object.values(this.world.pois).map((p) => p.position);
    for (const s of this.world.spawns) pts.push(...s.points);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let topY = 0;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      topY = Math.max(topY, p.y);
    }
    const pad = 45;
    const hide: THREE.Object3D[] = [this.vfx.group, this.objective.group, ...this.units.map((u) => u.rig.root)];
    return snapshotMap(this.engine.renderer, this.scene, { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, topY: topY + 70 }, hide);
  }

  private showLoading(): void {
    const tips=loadingTips();
    const tip = tips[Math.floor(Math.random() * tips.length)];
    const img = `art/loading-${1 + Math.floor(Math.random() * 2)}.webp`;
    const el = h(
      'div',
      { class: 'loading' },
      h('div', { class: 'ld-art', style: `background-image:url("${art(img)}")` }),
      h('div', { class: 'ld-shade' }),
      h('div', { class: 'ld-zone' }, h('div', { class: 'ld-title cc-title' }, regionName('Clawhaven')), h('div', { class: 'ld-sub' }, t('해안 지대  |  여섯 종족이 함께 사는 항구 마을','The Tidelands  |  Harbour town of six peoples'))),
      h(
        'div',
        { class: 'ld-foot' },
        h('div', { class: 'ld-tip' }, h('span', { class: 'ld-tip-k' }, t('도움말','Tip')), tip),
        h('div', { class: 'ld-bar' }, h('i')),
        h('div', { class: 'ld-label' }, t('불러오는 중','Loading')),
      ),
    );
    const probe = new Image();
    probe.onerror = () => el.classList.add('fallback');
    probe.src = art(img);
    this.loadingEl = el;
    this.app.ui.append(el);
  }

  private setLoading(f: number, label: string): void {
    const el = this.loadingEl;
    if (!el) return;
    (el.querySelector('.ld-bar > i') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
    (el.querySelector('.ld-label') as HTMLElement).textContent = loadingLabel(label);
  }

  private hideLoading(): void {
    const el = this.loadingEl;
    if (!el) return;
    this.loadingEl = null;
    el.classList.add('out');
    setTimeout(() => el.remove(), 1000);
  }

  private intro(): void {
    if(this.world2.chapter===2) {
      this.zone=this.world2.regionAt(this.player.unit.pos.x,this.player.unit.pos.z);this.zoneCandidate=this.zone;this.hud.minimap.setZone(regionName(this.zone),false);
      this.hud.chat.system(t('WORLD II · 주민들의 이사를 돕고 유적을 탐험해 20레벨에 일식의 여왕에게 도전하세요.','WORLD II · Help the settlers, explore the ruins, and challenge the Eclipse Queen at level 20.'));
      this.updateMusic(true);return;
    }
    const name = this.player.unit.name;
    this.zone = this.zoneAt(this.player.unit.pos);
    this.zoneCandidate = this.zone;
    this.hud.messages.banner(regionName(this.zone), regionSubtitle(this.zone), 'zone');
    this.hud.minimap.setZone(regionName(this.zone), false);
    this.hud.chat.system(t(`${name}님, 클로헤이븐에 오신 걸 환영해요!`,`Welcome to Clawhaven, ${name}!`));
    this.hud.chat.system(t('분수 옆 브라인비어드 선장이 기다려요. 가까이 가서 F를 누르세요.','Captain Brinebeard by the fountain has work for you. Walk up to him and press F.'));
    this.hud.tracker.update(this.quests);
    const brine = this.npcById('brinebeard');
    // After the zone banner (4.3 s) has faded, so the greeting bubble does not sit on top of it.
    setTimeout(() => {
      if (!this.alive || !brine) return;
      brine.unit.act('gesture_hello');
      this.say(brine.unit, t('어서 와! 이쪽이야, 새 친구!','Ahoy! Over here, fresh shell!'));
    }, 4600);
    setTimeout(() => this.alive && this.hud.hints.start(), 900);
    this.updateMusic(true);
  }

  // ================================================================ frame

  private readonly frame = (f: FrameInfo): void => {
    if (!this.loaded) return;
    const dt = f.dt;
    const paused = this.hud.menu.open && !this.multiplayer?.battle.active;
    this.handleInput();
    if (!paused) {
      this.time += dt;
      this.player.update(dt);
      if (this.multiplayer?.battle.authority !== false) {
        for (const e of this.enemies) e.update(dt);
        if(this.world2.chapter===1){this.boss.update(dt);this.finalBoss.update(dt);}else this.worldBoss.update(dt);
      }
      this.journey?.update(dt);
      for (const n of this.npcs) n.update(dt); if(this.multiplayer?.battle.authority!==false)for (const t of this.townsfolk) t.update(dt);
      if (this.multiplayer?.battle.authority !== false) this.separate();
      this.ending.update(dt);
      this.updateDeath();
      this.updateStatuses();
    }
    this.multiplayer?.update(dt);
    // Visual updates (culled when far away, simplified when small on screen)
    const cam = this.camera.position;
    // Screen pixels per world unit at distance 1 (CSS pixels, so Retina does not change the LOD).
    const pxPerUnit = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    for (const u of this.units) {
      const d = cam.distanceTo(u.pos);
      const culled = d > CULL_DIST * (u.kind === 'boss' ? 1.6 : 1);
      u.culled = culled;
      u.setShadows(d < SHADOW_DIST * (u.kind === 'boss' ? 2 : 1));
      u.rig.root.visible = !culled && !u.hidden;
      // Far LOD under ~90 px of shell height; back to full detail over ~110 px (no flicker).
      const px = (u.height * pxPerUnit) / Math.max(d, 0.1);
      u.lod = px < (u.lod ? 110 : 90) ? 1 : 0;
      u.rig.setLod?.(u.lod);
      if (!paused) u.updateVisual(dt);
    }
    if (!paused) this.vfx.update(dt);
    this.updateSelection();
    const goal = this.ending.active || !this.player.unit.alive ? null : this.objectivePos();
    this.hintVia = goal ? this.world2.chapter===2 ? goal : this.nav.waypoint(this.player.unit.pos, goal, this.time) : null;
    this.objective.update(this.time, this.world, this.player.unit.pos, goal, this.hintVia, this.player.inCombat);
    if (!this.ending.active) this.director.update(dt);
    const worldTime=this.multiplayer?.battle.worldTime(f.elapsed,dt) ?? f.elapsed;
    this.world.update(dt, worldTime, this.camera);
    this.world2.update(dt,worldTime);
    this.updateZone();
    this.updateInteractPrompt();
    this.updateMusic();
    this.hud.update(dt);
    this.debug?.update(dt);
  };

  private updateStatuses(): void {
    const now = this.time;
    for (const u of this.units) {
      if (!u.alive || u.hidden || u.culled) continue;
      if (now < u.slowUntil && u.kind !== 'player') this.vfx.chill(u);
      if (u.rustUntil && now >= u.rustUntil) {
        u.rust = 0;
        u.rustUntil = 0;
      }
    }
  }

  /** Keep crabs from standing inside each other. */
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
        // Heavier crabs move less; the boss and the player barely budge.
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

  private updateSelection(): void {
    const t = this.player.target;
    const sel = this.vfx.selection;
    if (!t || t.hidden || this.ending.active) {
      sel.mesh.visible = false;
      return;
    }
    sel.mesh.visible = true;
    sel.mesh.position.set(t.pos.x, this.world.heightAt(t.pos.x, t.pos.z) + 0.06, t.pos.z);
    const r = t.radius * 1.45 + 0.15;
    sel.mesh.scale.set(r, 1, r);
    const col = sel.u.uColor.value as THREE.Color;
    if (!t.alive) col.setRGB(0.4, 0.4, 0.4);
    else if (t.hostile) col.copy(C.red).multiplyScalar(1.3);
    else if (t.kind === 'npc') col.setRGB(1.6, 1.3, 0.3);
    else col.setRGB(0.4, 1.6, 0.5);
    sel.u.uAlpha.value = 0.8 + Math.sin(this.time * 4) * 0.15;
    (sel.u.uParam.value as THREE.Vector4).x = 0.8;
  }

  // ================================================================ input

  private handleInput(): void {
    const inp = this.input;
    const hud = this.hud;
    if (this.ending.active) return;
    if (inp.wasPressed('Escape')) {
      if (hud.menu.open) hud.menu.close();
      else if (hud.dialogue.isOpen) hud.dialogue.close();
      else if (hud.questLog.open) hud.questLog.toggle(false);
      else if (this.player.cast || this.player.channel) {
        this.player.interruptCast('Cancelled');
        this.player.cancelChannel();
      } else if (this.player.target) this.player.setTarget(null);
      else this.toggleMenu();
      return;
    }
    if (hud.menu.open) return;
    if (inp.wasPressed('KeyL')) hud.questLog.toggle();
    if (inp.wasPressed('KeyM')) this.toggleMusic();
    if (inp.wasPressed('Enter') || inp.wasPressed('NumpadEnter')) {
      hud.bubbles.enabled = !hud.bubbles.enabled;
      if (!hud.bubbles.enabled) hud.bubbles.clear();
      hud.messages.info(hud.bubbles.enabled ? t('말풍선 켜짐','Chat bubbles on') : t('말풍선 꺼짐','Chat bubbles off'));
    }
    if (inp.wasPressed('KeyR')) {
      if (this.time < this.robotConfirmUntil) {
        void this.app.go('robot');
        return;
      }
      this.robotConfirmUntil = this.time + 3;
      hud.messages.info(t('R을 다시 누르면 로봇 모드로 이동합니다. 진행 중인 모험 화면이 닫힙니다.','Press R again to open Robot Mode and leave this adventure.'));
    }
    if (this.controlsLocked) return;
    const hints = hud.hints;
    if (hints.active) {
      if (inp.isDown('KeyW') || inp.isDown('KeyA') || inp.isDown('KeyS') || inp.isDown('KeyD')) hints.mark('move');
      if ((inp.isButtonDown(0) || inp.isButtonDown(2)) && Math.abs(inp.dx) > 2) hints.mark('look');
      if (inp.wasPressed('Tab')) hints.mark('target');
      for (let i = 1; i <= 4; i++) if (inp.wasPressed(`Digit${i}`)) hints.mark('ability');
      if (inp.wasPressed('KeyF')) hints.mark('interact');
    }
    if (inp.wasPressed('Tab')) this.player.tabTarget();
    for (let i = 1; i <= 4; i++) if (inp.wasPressed(`Digit${i}`) || inp.wasPressed(`Numpad${i}`)) this.player.useAbility(i);
    if (inp.wasPressed('KeyF')) {
      // F also drives the dialogue: finish the text, then take the main choice.
      if (hud.dialogue.isOpen && hud.dialogue.typing) hud.dialogue.skipTyping();
      else if (hud.dialogue.isOpen) hud.dialogue.choosePrimary();
      else this.interact();
    }
    for (const b of [0, 2] as const) {
      if (inp.wasClicked(b)) {
        const u = this.player.pick(inp.mouseX, inp.mouseY);
        if (u) {
          this.player.setTarget(u);
          if (!u.hostile && this.player.unit.distTo(u) < 7) this.talkTo(u);
        }
      }
    }
    // Walking away closes the dialogue.
    const du = hud.dialogue.unit;
    if (du && this.player.unit.distTo(du) > 8) hud.dialogue.close();
  }

  toggleMenu(): void {
    if (this.hud.menu.open) this.hud.menu.close();
    else {
      this.hud.dialogue.close();
      this.hud.menu.show();
    }
    this.audio.sfx('sfx-click', { volume: 0.5 });
  }

  toggleMusic(): void {
    this.musicOn = !this.musicOn;
    if (!this.musicOn) {
      this.audio.stopMusic(0.8);
      this.music = '';
    } else this.updateMusic(true);
    this.hud.actionBar.setMusicIcon(this.musicOn);
    this.hud.messages.info(this.musicOn ? t('음악 켜짐','Music on') : t('음악 꺼짐','Music off'));
  }

  setQuality(q: QualitySetting): void {
    this.engine.setQualitySetting(q);
    localStorageSet('cc.quality', q);
    this.vfx.density = q === 'low' ? 0.55 : 1;
  }

  // ================================================================ interaction and dialogue

  private findInteractable(): { kind: 'unit'; unit: Unit } | { kind: 'beacon' } | {kind:'world2';node:NonNullable<ReturnType<HiddenWorld['interactable']>>} | {kind:'portal'} | null {
    const p = this.player.unit;
    let best: Unit | null = null;
    let bestScore = Infinity;
    for (const u of this.units) {
      if ((u.kind !== 'npc' && u.kind !== 'townsfolk') || u.hidden) continue;
      const d = p.distTo(u) - u.radius;
      if (d > 3.4) continue;
      // Named crabs win over passers-by, quest givers win over everyone.
      const score = d - (u.kind === 'npc' ? 2 : 0) - (this.questMark(u) ? 3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    if (best) return { kind: 'unit', unit: best };
    if(Math.hypot(p.pos.x-this.world2.portalPosition.x,p.pos.z-this.world2.portalPosition.z)<4)return {kind:'portal'};
    if(this.world2.chapter===2){const node=this.world2.interactable();return node?{kind:'world2',node}:null;}
    const b = this.world.pois.beacon;
    const o = QUESTS.q3.objectives[1];
    // The flame is up on the gallery: you have to climb, standing under it does not count.
    const gy = this.world.heightAt(b.position.x, b.position.z);
    const flameY = Math.max(b.position.y, gy);
    if (
      ((this.quests.status.q3 === 'active' && !this.quests.objectiveDone(o)) || this.quests.status.q3 === 'done' || this.beaconLit) &&
      Math.hypot(p.pos.x - b.position.x, p.pos.z - b.position.z) < b.radius + 3.5 &&
      Math.abs(p.pos.y - flameY) < 3
    ) {
      return { kind: 'beacon' };
    }
    return null;
  }

  private updateInteractPrompt(): void {
    if (this.ending.active || !this.player.unit.alive || this.hud.dialogue.isOpen || this.player.channel || this.hud.menu.open) {
      this.hud.prompt.hide();
      return;
    }
    const it = this.findInteractable();
    if (!it) this.hud.prompt.hide();
    else if(it.kind==='portal')this.hud.prompt.show('F',this.world2.chapter===2?t('월드 1로 돌아가기','Return to World I'):t('월드 2로 이동','Travel to World II'));
    else if(it.kind==='world2')this.hud.prompt.show('F',it.node.kind.startsWith('lamp')?t('길게 눌러 별빛 등불 켜기','Hold to light waystone'):t('별빛 수정 채집하기','Gather star crystal'));
    else if (it.kind === 'beacon') this.hud.prompt.show('F', this.beaconLit?t('등대 끄기','Turn off lighthouse'):t('등대 켜기','Light lighthouse'));
    else this.hud.prompt.show('F', t(`${it.unit.name}에게 말 걸기`,`${it.unit.kind === 'npc' ? 'Talk to' : 'Chat with'} ${it.unit.name}`));
  }

  private interact(): void {
    const it = this.findInteractable();
    if (!it) return;
    if(it.kind==='portal'){this.world2.travel();return;}
    if(it.kind==='world2'){
      this.player.setTarget(null);
      const node=it.node;
      if(node.kind.startsWith('lamp')){
        this.player.unit.setYaw(yawTo(this.player.unit.pos.x,this.player.unit.pos.z,node.position.x,node.position.z));
        this.player.startChannel(t('별빛 등불 켜는 중','Lighting waystone'),1.5,'KeyF',node.mesh.position.clone(),()=>{
          if(this.world2.chapter===2&&this.player.unit.pos.distanceTo(node.position)<3.5)this.world2.collect(node.kind);
        });
      }else this.world2.collect(node.kind);
      return;
    }
    if (it.kind === 'beacon') {
      const b = this.world.pois.beacon;
      const to = this.beaconPoint(v1).clone();
      this.player.setTarget(null);
      this.player.unit.setYaw(yawTo(this.player.unit.pos.x, this.player.unit.pos.z, b.position.x, b.position.z));
      this.player.startChannel(this.beaconLit?t('등대 끄는 중','Turning off lighthouse'):t('등대 켜는 중','Lighting lighthouse'), 2, 'KeyF', to, () => this.setLighthouse(!this.beaconLit));
      return;
    }
    this.player.setTarget(it.unit);
    this.talkTo(it.unit);
  }

  /** Where the flame is: the beacon POI, lifted if it sits on the ground. */
  private beaconPoint(out: THREE.Vector3): THREE.Vector3 {
    const b = this.world.pois.beacon.position;
    const gy = this.world.heightAt(b.x, b.z);
    return out.set(b.x, Math.max(b.y, gy) + (b.y > gy + 1 ? 0 : 3), b.z);
  }

  talkTo(u: Unit): void {
    if (u.kind === 'townsfolk') {
      (u.ctrl as Townsfolk).faceToward(this.player.unit);
      (u.ctrl as Townsfolk).bark();
      return;
    }
    const npc = u.ctrl as Npc;
    if (!npc || !(npc instanceof Npc)) return;
    this.openNpc(npc);
  }

  private openNpc(npc: Npc): void {
    const q = this.quests;
    const id = npc.def.id;
    const u = npc.unit;
    npc.talking = true;
    u.setYaw(yawTo(u.pos.x, u.pos.z, this.player.unit.pos.x, this.player.unit.pos.z));
    if(this.world2.chapter===2&&id==='coralline'&&q.status.w6==='active')q.bump('deliver-supplies');
    if (this.world2.chapter===1 && id === 'silvermoon' && q.status.q2 === 'active') q.bump('deliver');
    const portrait = `art/npc/${id}.webp`;
    const bye = { label: t('다음에 만나요','Goodbye'), onClick: () => this.hud.dialogue.close() };
    const ready = q.readyAt(id);
    if (ready) {
      const def = QUESTS[ready];
      this.hud.dialogue.open({
        unit: u,
        portraitArt: portrait,
        questTitle: def.title,
        paragraphs: def.complete,
        rewardXp: def.xp,
        buttons: [{ label: def.completeButton ?? t('보상 받기','Complete Quest'), primary: true, onClick: () => this.turnIn(ready) }],
      });
      return;
    }
    const offer = q.offeredBy(id);
    if (offer) {
      const def = QUESTS[offer];
      this.hud.dialogue.open({
        unit: u,
        portraitArt: portrait,
        questTitle: def.title,
        paragraphs: def.offer,
        objectives: def.objectives.map((o) => (o.count > 1 ? `${o.label}: 0/${o.count}` : o.label)),
        rewardXp: def.xp,
        buttons: [
          { label: t('퀘스트 받기','Accept quest'), primary: true, onClick: () => this.acceptQuest(offer) },
          { label: t('나중에 할게요','Maybe later'), onClick: () => this.hud.dialogue.close() },
        ],
      });
      return;
    }
    const prog = q.inProgressAt(id);
    if (prog && !(id === 'silvermoon' && prog === 'q4')) {
      this.hud.dialogue.open({ unit: u, portraitArt: portrait, questTitle: QUESTS[prog].title, paragraphs: [QUESTS[prog].progress], buttons: [bye] });
      return;
    }
    let line = npc.nextLine();
    if (this.world2.chapter===1 && id === 'rattlebolt') line = q.status.q3 === 'active' ? RATTLEBOLT_Q3 : this.beaconLit ? RATTLEBOLT_AFTER : line;
    if (this.world2.chapter===1 && id === 'silvermoon' && q.status.q4 === 'active') line = 'Go, little moon. The blessing of the pool goes with you. Corrodius waits on the Iron Wreck.';
    if (id === 'coralline') {
      const p = this.player.unit;
      if (p.hp < p.maxHp) this.combat.heal(u, p, p.maxHp - p.hp);
      this.vfx.mendGlow(p);
      u.act('gesture_bow');
    }
    if (id === 'grukk') {
      u.act('claw_left', { onEnd: () => u.act('claw_right') });
    }
    this.hud.dialogue.open({ unit: u, portraitArt: portrait, paragraphs: [line], buttons: [bye] });
  }

  acceptQuest(id: QuestId): void {
    this.quests.accept(id);
    this.hud.dialogue.close();
  }

  turnIn(id: QuestId): void {
    const def = QUESTS[id];
    const giverOfNext = this.npcById(def.turnIn ?? 'brinebeard');
    this.quests.complete(id);
    if (id === 'q4') {
      this.hud.dialogue.close();
      this.journey!.root.open = true;
      this.hud.messages.info('첫 보스의 여정 완료! 해안 순찰로 10레벨에 도전하세요.');
      this.journey?.save();
      return;
    }
    // Chain straight into the next offer from the same crab, like the old games.
    const next = giverOfNext ? this.quests.offeredBy(giverOfNext.def.id) : null;
    if (next && giverOfNext) {
      setTimeout(() => {
        if (this.alive && !this.ending.active) this.openNpc(giverOfNext);
      }, 350);
      this.hud.dialogue.close();
    } else {
      this.hud.dialogue.close();
    }
  }

  npcById(id: NpcId): Npc | undefined {
    return this.npcs.find((n) => n.def.id === id);
  }

  say(u: Unit, text: string, yell = false): void {
    this.hud.bubbles.say(this, u, text, yell);
    if (yell) this.hud.chat.yell(u.name, text);
    else if (u.kind !== 'townsfolk' || this.player.unit.distTo(u) < 15) this.hud.chat.say(u.name, text);
  }

  // ================================================================ quests

  private wireQuestEvents(): void {
    const ev = this.quests.events;
    ev.on('accepted', (id) => {
      const def = QUESTS[id];
      this.audio.sfx('sfx-quest-accept');
      this.hud.chat.quest(t(`퀘스트 수락: ${def.title}`,`Quest accepted: ${def.title}`));
      if(id==='w7'&&this.journey?.trueCleared)this.quests.bump('eclipse-boss');
      if (id === 'q4' && this.journey?.rustCleared) this.quests.bump('boss');
      if (id === 'q4') this.hud.messages.banner(def.title, 'New quest: defeat Corrodius on the Iron Wreck', 'quest');
      else this.hud.messages.banner(t('퀘스트 수락','Quest Accepted'), def.title, 'quest');
      this.hud.tracker.update(this.quests);
      this.journey?.save();
    });
    ev.on('progress', ({ objective, value }) => {
      const txt = objective.count > 1 ? `${objective.label}: ${value}/${objective.count}` : `${objective.label}`;
      this.hud.messages.info(txt);
      const memory=starMemory(objective.kind);
      if(memory){
        this.hud.messages.banner(memory.title,memory.body,'quest');
        this.hud.chat.system(`${memory.title} · ${memory.body}`);
        this.audio.sfx('sfx-quest-complete',{volume:.5});
      }
      this.hud.tracker.update(this.quests, objective.id);
      if (this.hud.questLog.open) this.hud.questLog.render();
    });
    ev.on('ready', (id) => {
      const def = QUESTS[id];
      this.hud.messages.info(t(`${def.title} · 목표 완료`,`${def.title} (Complete)`));
      this.hud.chat.quest(t(`${def.title} 목표 완료. ${def.readyHint}`,`${def.title} completed. ${def.readyHint}`));
      this.audio.sfx('sfx-quest-accept', { volume: 0.7 });
      this.hud.tracker.update(this.quests);
      this.journey?.save();
    });
    ev.on('completed', (id) => {
      const def = QUESTS[id];
      this.audio.sfx('sfx-quest-complete');
      this.hud.messages.banner(t('퀘스트 완료','Quest Complete'), def.title, 'quest');
      this.hud.chat.quest(t(`${def.title} 완료!`,`${def.title} completed.`));
      this.player.gainXp(def.xp);
      this.hud.tracker.update(this.quests);
      if (id === 'q3') this.onBeaconQuestDone();
      this.journey?.save();
    });
  }

  setLighthouse(lit:boolean) {
    if(this.world2.chapter!==1)return;
    if(this.multiplayer?.battle.requestLighthouse(lit))return;
    this.beaconLit=lit;this.world.setBeaconLit(lit);this.world.setMood(lit?1:3);
    if(!lit){this.boss.sleep();this.finalBoss.sleep();this.player.setTarget(null);}
    else this.quests.bump('beacon');
    this.hud.messages.banner(lit?t('등대를 켰어요','Lighthouse lit'):t('등대를 껐어요','Lighthouse off'),lit?t('밤이 찾아왔습니다. 보스에 도전할 수 있어요.','Night has fallen. You can challenge the bosses.'):t('아침이 되었습니다. 보스는 다시 잠들었어요.','Morning has returned. The bosses are asleep again.'),'zone');
    this.journey?.save();
  }

  lightBeacon(): void {
    if (this.beaconLit) return;
    this.beaconLit = true;
    this.world.setMood(1);
    this.world.setBeaconLit(true);
    const at = this.beaconPoint(v1);
    this.vfx.beaconBlaze(at);
    this.vfx.levelUp(this.player.unit);
    this.audio.sfx('sfx-beacon');
    this.follow.shake(0.2, 0.6);
    this.hud.messages.banner('The Beacon Blazes', 'Light returns to Saltmere', 'quest');
    this.quests.bump('beacon');
  }

  private onBeaconQuestDone(): void {
    const activeShore=this.world2.chapter===1&&this.beaconLit;
    this.hud.chat.whisper(t('실버문 여사','Lady Silvermoon'),activeShore?t('빛이 돌아왔어요! 만을 보세요… 철의 난파선이 깨어납니다.','The light returns! Look to the bay... the Iron Wreck is waking.'):t('빛을 되찾아 줘서 고마워요. 등대를 다시 켜면 난파선에 도전할 수 있어요.','Thank you for restoring the light. Relight the lighthouse when you are ready to face the wreck.'));
    // These are personal quest rewards, not part of the delayed world-state reveal.
    // Grant them now so travelling during the scene cannot strand the next shore quest.
    this.player.unit.blessingUntil = Infinity;
    this.vfx.mendGlow(this.player.unit);
    this.hud.chat.system(t('실버문 여사의 달샘 축복을 받았어요. 전투 중에도 껍질이 천천히 회복됩니다.','Lady Silvermoon blesses you with moonwater. Your shell slowly mends while you fight.'));
    this.quests.accept('q4');
    setTimeout(() => {
      // The player may have switched off the lighthouse or left the shore in the meantime.
      if (!this.alive||this.world2.chapter!==1||!this.beaconLit||this.journey?.rustCleared) return;
      this.boss.wake();
      this.audio.sfx('sfx-boss-roar');
      this.follow.shake(0.3, 1.2);
      this.hud.messages.warn(t('철의 난파선에서 코로디우스가 깨어납니다!','Corrodius stirs on the Iron Wreck!'));
    }, 2600);
  }

  questMark(u: Unit): QuestMark {
    if (u.kind !== 'npc') return null;
    const id = u.npcId as NpcId;
    const q = this.quests;
    if (q.readyAt(id)) return '?ready';
    if (this.world2.chapter===1 && id === 'silvermoon' && q.status.q2 === 'active') return '?ready';
    if (q.offeredBy(id)) return '!';
    if (q.inProgressAt(id)) return '?';
    return null;
  }

  /** Where the golden hint points: the nearest quest enemy, the quest NPC, or the POI. */
  objectivePos(): THREE.Vector3 | null {
    const cur = this.quests.current();
    if (!cur) return this.world2.chapter===2&&!this.journey?.trueCleared ? this.world2.arena.position : null;
    const p = this.player.unit.pos;
    if (cur.step === 'objective' && cur.objective) {
      const k = cur.objective.kind;
      if(this.world2.chapter===2){const point=this.world2.objectivePoint(k);if(point)return point;if(k==='eclipse-boss')return this.world2.arena.position;}
      const kind: EnemyKind | null = k === 'kill-scrapling' || k === 'collect-cog' ? 'scrapling' : k === 'kill-scavenger' ? 'scavenger' : null;
      if (kind) {
        const area = this.world.pois[cur.poi].position;
        let best: Unit | null = null;
        let bestD = Infinity;
        for (const e of this.enemies) {
          if (e.kind !== kind || e.isAdd || !e.unit.alive || e.unit.hidden) continue;
          if (Math.hypot(e.home.x - area.x, e.home.z - area.z) > 70) continue;
          const d = Math.hypot(e.unit.pos.x - p.x, e.unit.pos.z - p.z);
          if (d < bestD) {
            bestD = d;
            best = e.unit;
          }
        }
        // Far away: point at the area. Close: point at the nearest crab.
        if (best && (bestD < 40 || Math.hypot(area.x - p.x, area.z - p.z) < 40)) return best.pos;
        return area;
      }
      if (k === 'boss' && !this.boss.unit.hidden && this.boss.unit.alive) return this.boss.unit.pos;
      if (k === 'beacon') return this.world.pois.beacon.position;
    }
    if (cur.poi.startsWith('npc:')) {
      const npc = this.npcById(cur.poi.slice(4) as NpcId);
      if (npc) return npc.unit.pos;
    }
    return this.world.pois[cur.poi].position;
  }

  get partyLevel(): number {
    return Math.max(this.player.level, ...this.units.filter(u => u.kind === 'remote' && u.alive && !u.hidden).map(u => u.level));
  }
  combatTarget(from: Unit): Unit {
    const targets = [this.player.unit, ...this.units.filter(u => u.kind === 'remote' && !u.hidden)].filter(u => u.alive);
    return targets.sort((a,b) => from.distTo(a)-from.distTo(b))[0] ?? this.player.unit;
  }
  combatPlayers(): Unit[] { return this.units.filter(u => (u.kind === 'player' || u.kind === 'remote') && u.alive && !u.hidden); }

  // ================================================================ combat outcomes

  onUnitDied(u: Unit, killer: Unit | null): void {
    if (u.kind === 'player') {
      this.playerDied();
      return;
    }
    const byPlayer = killer?.kind === 'player' || killer?.kind === 'remote';
    if (u.kind === 'scrapling' || u.kind === 'scavenger') {
      const e = u.ctrl as Enemy;
      if (byPlayer) {
        if (!e.isAdd) { this.player.gainXp(e.stats.xp); this.journey?.onKill(); }
        if (u.kind === 'scrapling') {
          this.quests.bump('kill-scrapling');
          this.tryLootCog(u);
        } else this.quests.bump('kill-scavenger');
      }
      // Killing the pack leader makes the rest come running.
      for (const m of e.pack) if (m !== e && m.unit.alive) m.aggro(false);
    }
    if (u.kind === 'boss') {
      const boss = u.ctrl as Boss;
      if(boss===this.worldBoss)this.quests.bump('eclipse-boss');
      this.journey?.onBossDefeated(boss);
      this.player.unit.blessingUntil = 0;
      setTimeout(() => {
        if (!this.alive) return;
        if (boss === this.boss) this.quests.bump('boss');
        this.hud.messages.banner('VICTORY · 왕관 획득', boss.profile.name, 'boss');
        this.vfx.levelUp(this.player.unit);
      }, 1800);
      setTimeout(() => this.alive && this.hud.bossFrame.hide(), 5000);
    }
  }

  private tryLootCog(u: Unit): void {
    const o = QUESTS.q1.objectives[1];
    if (this.quests.status.q1 !== 'active' || this.quests.objectiveDone(o)) return;
    const drop = Math.random() < 0.7 || this.cogMisses >= 2;
    if (!drop) {
      this.cogMisses++;
      return;
    }
    this.cogMisses = 0;
    setTimeout(() => {
      if (!this.alive) return;
      this.vfx.lootSparkle(u.pos);
      this.hud.floats.spawn(u, '+1 Rusted Cog', 'info');
      this.hud.chat.loot('You receive loot: [Rusted Cog].');
      this.audio.sfx('sfx-click', { volume: 0.6 });
      this.quests.bump('collect-cog');
    }, 450);
  }

  private playerDied(): void {
    this.deadUntil = this.time + 3.6;
    this.player.interruptCast();
    this.player.cancelChannel();
    this.hud.dialogue.close();
    this.engine.canvas.style.transition = 'filter 2s ease';
    this.engine.canvas.style.filter = 'grayscale(1) brightness(0.75)';
    this.hud.showDeath(true);
    this.hud.chat.system(t('쓰러졌어요. 잠시 뒤 다시 일어납니다.','You have fallen. You will awaken shortly.'));
    if (this.boss.engaged) this.say(this.boss.unit, 'Another shell for the scrap heap!', true);
    if (!this.multiplayer?.battle.active) for (const e of this.enemies) e.evade();
  }

  private updateDeath(): void {
    if (this.player.unit.alive || this.respawning || this.time < this.deadUntil) return;
    this.respawning = true;
    void (async () => {
      await this.app.blackout(true, 900);
      if (!this.alive) return;
      const spawn = this.world.pois.spawn;
      this.world2.resetPortalArrival();
      this.player.respawn();
      const p = this.player.unit;
      p.teleport(this.world, spawn.position.x, spawn.position.z, spawn.yaw);
      this.follow.yaw = p.yaw + Math.PI;
      if (!this.multiplayer?.battle.active) { this.boss.reset(); this.finalBoss.reset(); this.worldBoss.reset(); }
      this.engine.canvas.style.transition = '';
      this.engine.canvas.style.filter = '';
      this.hud.showDeath(false);
      this.respawning = false;
      await this.app.blackout(false, 900);
      this.vfx.mendGlow(p);
      this.hud.messages.info(this.world2.chapter===2
        ?t('껍질을 회복하고 별빛 항구의 포탈 곁으로 돌아왔어요.','Shell mended, you return to the portal in Starhaven.')
        :t('껍질을 회복하고 클로헤이븐 광장으로 돌아왔어요.','Shell mended, you return to Clawhaven Square.'));
    })();
  }

  /** Called by the boss in phase 2. */
  spawnAdd(x: number, z: number): Enemy | null {
    const e = this.adds.find((a) => a.state === 'gone');
    if (!e) return null;
    e.respawnAt(x, z);
    e.aggro(false);
    return e;
  }

  /** Direction from town toward the open sea (past the wreck). */
  seaDirection(): THREE.Vector3 {
    const a = this.world.pois.spawn.position;
    const b = this.world.pois.wreck.position;
    return v2.set(b.x - a.x, 0, b.z - a.z).normalize().clone();
  }

  // ================================================================ zones and music

  zoneAt(p: THREE.Vector3): string {
    let best = ZONES[0].name;
    let bestD = Infinity;
    for (const z of ZONES) {
      for (const id of z.anchors) {
        const poi = this.world.pois[id];
        if (!poi) continue;
        const d = Math.hypot(p.x - poi.position.x, p.z - poi.position.z) - Math.min(poi.radius, 20) * 0.5;
        if (d < bestD) {
          bestD = d;
          best = z.name;
        }
      }
    }
    return best;
  }

  private updateZone(): void {
    const z = this.world2.chapter===2 ? this.world2.regionAt(this.player.unit.pos.x,this.player.unit.pos.z) : this.zoneAt(this.player.unit.pos);
    if (z !== this.zoneCandidate) {
      this.zoneCandidate = z;
      this.zoneSince = this.time;
    }
    if (z !== this.zone && this.time - this.zoneSince > 0.6 && !this.ending.active) {
      this.zone = z;
      this.hud.messages.banner(regionName(z), regionSubtitle(z), 'zone');
    }
    this.hud.minimap.setZone(regionName(this.zone), this.player.inCombat);
  }

  private updateMusic(force = false): void {
    if (!this.musicOn || this.ending.active) return;
    let want = 'music-town';
    const now = this.time;
    if (this.encounter.engaged || (this.zone === 'The Iron Wreck' && this.quests.status.q4 === 'active' && this.boss.state !== 'dead' && this.boss.state !== 'dying')) {
      want = 'music-boss';
    } else if (this.player.inCombat && this.zone !== 'Clawhaven') {
      this.combatMusicUntil = now + 6;
      want = 'music-combat';
    } else if (now < this.combatMusicUntil) want = 'music-combat';
    if (want !== this.music || force) {
      this.music = want;
      void this.audio.playMusic(want, want === 'music-combat' ? 1.2 : 2.2);
    }
  }

  // ================================================================ teardown

  dispose(): void {
    this.alive = false;
    this.offFrame?.();
    this.offAfter?.();
    this.engine.onResolutionChange = null;
    this.journey?.dispose();
    this.journey = null;
    this.multiplayer?.dispose();
    this.multiplayer = null;
    this.debug?.dispose();
    this.hud?.dispose();
    this.hideLoading();
    for (const u of this.units) u.dispose();
    this.units = [];
    this.vfx?.dispose();
    this.objective?.dispose();
    this.world2?.dispose();
    this.world?.dispose();
    this.engine.canvas.style.filter = '';
    this.engine.canvas.style.transition = '';
    (window as unknown as { __ready?: boolean }).__ready = false;
  }
}
