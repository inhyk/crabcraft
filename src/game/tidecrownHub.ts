// Tidecrown, the hub that links every world. In the capital the Goldclaw's captain on the long pier and the portal in
// the Seaglass Quarter offer every world, open or locked by the game's own unlock rules; every world has a crown
// portal beside its own gateway that leads back to the capital's harbour. Travel takes the worlds' portal path (a relay
// room's chapter request, else world2.go), so a room moves together and the quest chapter rules stay as they are. A
// server world does not host Tidecrown yet: nothing here is built there.
import * as THREE from 'three';
import { createCrab } from '../crab/provider';
import type { CrabSpec } from '../crab/types';
import { t } from '../i18n';
import { createMotionController } from '../motion/provider';
import type { Game } from './game';
import { CrownPortal } from './tidecrown/crownPortal';
import type { TidecrownIsland } from './tidecrown/island';
import { Unit } from './unit';
import { turnToward, yawTo } from './util';
import type { HiddenWorld } from './world2';

export type HubChapter = 1 | 2 | 3 | 4 | 5 | 6;
export interface Arrival { readonly x: number; readonly z: number; readonly yaw: number }

/** Every world by its quest chapter, as the travel choice names it. */
export const HUB_WORLDS: readonly { chapter: HubChapter; ko: string; en: string }[] = [
  { chapter: 1, ko: '클로헤이븐', en: 'Clawhaven' },
  { chapter: 2, ko: '별빛 항구', en: 'Starhaven' },
  { chapter: 3, ko: '새벽 항구', en: 'Dawnharbor' },
  { chapter: 4, ko: '눈꽃 마을', en: 'Snowfall Village' },
  { chapter: 5, ko: '잿불 군도', en: 'Emberreach' },
  { chapter: 6, ko: '하늘숲', en: 'Skybloom' },
];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/** Arrival by ship or portal: on the quay before the sea gate (at 213.6, 17.8), facing it and the city beyond. */
export const TC_HARBOUR_ARRIVAL: Arrival = { x: 221.5, z: 15.8, yaw: Math.atan2(213.6 - 221.5, 17.8 - 15.8) };
/** The captain at the foot of the galleon's gangplank on the long pier, looking back along it to the quay. */
const CAPTAIN: Arrival = { x: 261, z: 8.9, yaw: -Math.PI / 2 };
/** The Seaglass portal on the green east of the glass plaza, facing the great tower; its keeper at its right. */
const SEAGLASS: Arrival = { x: -50, z: -110, yaw: Math.atan2(-66 + 50, -122 + 110) };
/**
 * Each world's crown portal, beside one of its own gateways on open ground clear of the villagers' posts, facing into
 * its town (World I's is placed from the wreck): Starhaven south-east of its portal, past the carts on the cross street;
 * Dawnharbor south of the snow gate; the snow village and the two frontier harbours south of the portal they arrive by.
 */
const RETURNS: Record<Exclude<HubChapter, 1>, Arrival> = {
  2: { x: 12, z: 97, yaw: Math.PI }, 3: { x: 13, z: 97, yaw: Math.PI }, 4: { x: -13, z: 102, yaw: Math.PI },
  5: { x: -12, z: 97, yaw: Math.PI }, 6: { x: -12, z: 97, yaw: Math.PI },
};
/** How near a crown portal counts as at it (its prompt shows inside 4, a walk-in fires inside 1.7). */
const AT = 6;

/** '로' or '으로' after a Korean word. */
const ro = (word: string) => { const c = word.charCodeAt(word.length - 1) - 0xac00, f = c >= 0 && c < 11172 ? c % 28 : 0; return f === 0 || f === 8 ? '로' : '으로'; };

interface Keeper { unit: Unit; at: THREE.Vector3; yaw: number; name: [string, string]; title: [string, string]; portrait: string; lastHello: number }
type By = 'ship' | 'portal';

export class TidecrownHub {
  /** Each world's crown portal and where it stands. */
  private readonly returns = new Map<HubChapter, { portal: CrownPortal; at: Arrival }>();
  private seaglass: CrownPortal | null = null;
  private captain: Keeper | null = null;
  private keeper: Keeper | null = null;
  private loading: Promise<void> | null = null;
  private shown = false;
  /** The Seaglass ring's walk-in, armed once the player is clear of it. */
  private armed = false;
  /** A sail's landing, waiting for its world (at once alone, or once a relay room's host has moved). */
  private pending: { chapter: HubChapter; at: Arrival; until: number } | null = null;
  private told = false;
  private readonly cam = new THREE.Vector3();

  constructor(private readonly g: Game, private readonly w2: HiddenWorld, places: Record<HubChapter, { root: THREE.Object3D; height: (x: number, z: number) => number }>) {
    if (g.serverMode) return;
    const wreck = g.world.pois.wreck.position;
    // World I: on the grass west of the shore portal (wreck - 7, + 7), facing the village.
    const one = { x: wreck.x - 17, z: wreck.z + 3 };
    const at: Record<HubChapter, Arrival> = { 1: { ...one, yaw: Math.atan2(-one.x, -one.z) }, ...RETURNS };
    for (const chapter of [1, 2, 3, 4, 5, 6] as const) {
      const p = at[chapter], place = places[chapter];
      const portal = new CrownPortal(new THREE.Vector3(p.x, place.height(p.x, p.z), p.z), p.yaw, `crown-portal-w${chapter}`, 0.8);
      place.root.add(portal.root);
      this.returns.set(chapter, { portal, at: p });
    }
  }

  /** The crabs drawn here (for the shader warm-up behind the loading screen). */
  get units(): Unit[] { return [this.captain, this.keeper].flatMap((k) => (k ? [k.unit] : [])); }
  /** Where each world's crown portal stands (none on a server world). */
  get crownPortals(): { chapter: HubChapter; x: number; z: number; yaw: number }[] { return [...this.returns].map(([chapter, r]) => ({ chapter, ...r.at })); }

  /** Tidecrown's side, built on the first entry behind its loading screen: the Seaglass portal and the two crabs. */
  load(island: TidecrownIsland): Promise<void> {
    if (this.g.serverMode) return Promise.resolve();
    // Each piece once, so a retry after a failed crab load adds nothing twice.
    this.loading ??= (async () => {
      if (!this.seaglass) {
        this.seaglass = new CrownPortal(new THREE.Vector3(SEAGLASS.x, island.height(SEAGLASS.x, SEAGLASS.z), SEAGLASS.z), SEAGLASS.yaw, 'seaglass-portal');
        island.root.add(this.seaglass.root);
      }
      const side = { x: Math.cos(SEAGLASS.yaw) * 4.6 + Math.sin(SEAGLASS.yaw) * 1.6, z: -Math.sin(SEAGLASS.yaw) * 4.6 + Math.cos(SEAGLASS.yaw) * 1.6 };
      this.captain ??= await this.crab(island, CAPTAIN, { race: 'human', sex: 'female', classId: 'warrior', shell: 2, crest: 1, led: 0, name: 'Ara' }, ['captain-hat'], ['아라 선장', 'Captain Ara'], ['금빛집게호 선장', 'Captain of the Goldclaw'], 'tc-captain');
      this.keeper ??= await this.crab(island, { x: SEAGLASS.x + side.x, z: SEAGLASS.z + side.z, yaw: SEAGLASS.yaw }, { race: 'nightelf', sex: 'female', classId: 'mage', shell: 1, crest: 2, led: 2, name: 'Opal' }, [], ['포탈지기 오팔', 'Opal'], ['바다유리 포탈지기', 'Seaglass Portal Keeper'], 'tc-portal-keeper');
    })().catch((error) => { this.loading = null; throw error; });
    return this.loading;
  }

  private async crab(island: TidecrownIsland, at: Arrival, spec: CrabSpec, extras: string[], name: [string, string], title: [string, string], id: string): Promise<Keeper> {
    const rig = await createCrab(spec, extras);
    (rig as typeof rig & { useShadowProxy?: (on: boolean) => void }).useShadowProxy?.(true);
    const unit = new Unit(t(...name), 'npc', 'friendly', rig, createMotionController(rig));
    unit.npcId = id;
    unit.title = t(...title);
    unit.hidden = true;
    rig.root.visible = false;
    unit.measure();
    this.g.scene.add(rig.root);
    const out = new THREE.Vector2();
    island.resolve(at.x, at.z, unit.radius + 0.2, out);
    return { unit, at: new THREE.Vector3(out.x, island.height(out.x, out.y), out.y), yaw: at.yaw, name, title, portrait: `art/portraits/${spec.race}-${spec.sex}.webp`, lastHello: -100 };
  }

  show(): void {
    if (this.shown || this.g.serverMode) return;
    this.shown = true;
    this.armed = false;
    for (const k of [this.captain, this.keeper]) {
      if (!k) continue;
      k.unit.hidden = false;
      // Drawn from the start, so the warm-up behind the loading screen compiles its shaders; culling follows next frame.
      k.unit.rig.root.visible = true;
      k.unit.teleport(this.g.world, k.at.x, k.at.z, k.yaw);
      this.g.hud.plates.also.add(k.unit);
    }
    if (!this.told) {
      this.told = true;
      this.g.hud.chat.system(t('다른 월드로 가려면 왕관 항구 긴 부두의 아라 선장이나 바다유리 구역의 포탈을 찾아가세요.', 'To travel to another world, find Captain Ara on the Crown Harbour’s long pier or the portal in the Seaglass Quarter.'));
    }
  }

  hide(): void {
    this.shown = false;
    for (const k of [this.captain, this.keeper]) {
      if (!k) continue;
      if (this.g.hud.dialogue.unit === k.unit) this.g.hud.dialogue.close();
      k.unit.hidden = true;
      k.unit.rig.root.visible = false;
      this.g.hud.plates.also.delete(k.unit);
    }
  }

  /**
   * The hub point the player is at: in Tidecrown the nearer of the captain and the Seaglass portal, in a world its crown
   * portal within AT. Null otherwise. Stable vectors, as world2's other portals are.
   */
  point(): THREE.Vector3 | null {
    const p = this.g.player.unit.pos;
    if (this.w2.inTidecrown) {
      if (!this.shown || !this.captain || !this.seaglass) return null;
      const c = this.captain.at, s = this.seaglass.root.position;
      return Math.hypot(p.x - c.x, p.z - c.z) <= Math.hypot(p.x - s.x, p.z - s.z) ? c : s;
    }
    // Only while its world is the one shown (an ending shows World I over a later chapter).
    const r = this.returns.get(this.w2.chapter)?.portal.root;
    return r?.parent?.visible && Math.hypot(p.x - r.position.x, p.z - r.position.z) < AT ? r.position : null;
  }

  /** Minimap marks: the crown portal of the world shown, or in Tidecrown the captain's pier and the Seaglass portal. */
  markers(): { at: THREE.Vector3; label: string }[] {
    if (this.w2.inTidecrown) {
      return this.shown && this.captain && this.seaglass ? [{ at: this.captain.at, label: t('배편', 'Ships') }, { at: this.seaglass.root.position, label: t('포탈', 'Portal') }] : [];
    }
    const r = this.returns.get(this.w2.chapter)?.portal.root;
    return r?.parent?.visible ? [{ at: r.position, label: t('타이드크라운', 'Tidecrown') }] : [];
  }

  /** The prompt at the hub point the player is at. */
  label(): string | null {
    const at = this.point();
    if (!at) return null;
    if (at === this.captain?.at) return t('아라 선장에게 말 걸기 · 모든 월드로 가는 배', 'Talk to Captain Ara · Ships to every world');
    if (at === this.seaglass?.root.position) return t('바다유리 포탈 · 모든 월드로', 'Seaglass portal · To every world');
    return t('타이드크라운 · 왕관 항구로', 'To Tidecrown · Crown Harbour');
  }

  /** F at, or a walk into, the hub point the player is at; false if at none. */
  use(): boolean {
    const at = this.point();
    if (!at) return false;
    if (at === this.captain?.at) this.choose('ship');
    else if (at === this.seaglass?.root.position) this.choose('portal');
    else void this.toTidecrown();
    return true;
  }

  /** Whether the hub's travel is open here: not on a server world, whose server does not host Tidecrown yet. */
  get open(): boolean {
    return !this.g.serverMode && (this.g.zoneLines?.tidecrownOpen() ?? true);
  }

  /** From a world's crown portal into Tidecrown, onto the harbour quay, through the King's Road's fade and loading screen. */
  toTidecrown(): Promise<boolean> {
    const g = this.g, w2 = this.w2;
    if (!this.open) {
      g.hud.messages.info(t('타이드크라운으로 가는 길은 곧 열려요.', 'The road to Tidecrown opens soon.'));
      return Promise.resolve(false);
    }
    if (w2.inTidecrown || !w2.canEnterTidecrown(true)) return Promise.resolve(false);
    return this.fade(() => w2.enterTidecrown(TC_HARBOUR_ARRIVAL));
  }

  /**
   * Out of Tidecrown to `chapter`'s world through the same fade: onto `arrival` (World I's King's Road for the south
   * line) or else in front of that world's crown portal. False, with the reason shown, when it may not go.
   */
  sail(chapter: HubChapter, arrival?: Arrival): boolean {
    const g = this.g, w2 = this.w2;
    if (!w2.inTidecrown || !this.open) return false;
    const lock = w2.travelLock(chapter);
    if (lock) {
      g.hud.messages.info(lock);
      return false;
    }
    if (!w2.canEnterTidecrown(true)) return false;
    const at = arrival ?? this.dock(chapter);
    if (g.hud.dialogue.isOpen) g.hud.dialogue.close();
    void this.fade(() => {
      // The world under Tidecrown: leave onto the point; no chapter changes, so a room has nothing to follow.
      if (chapter === w2.chapter) return w2.exitTidecrown(at ?? undefined);
      // Another world: the portals' own request, so a relay room moves together; go() leaves Tidecrown first.
      this.pending = at ? { chapter, at, until: performance.now() + 20000 } : null;
      if (!g.multiplayer?.battle.travel(chapter)) w2.go(chapter);
      this.land();
      return true;
    });
    return true;
  }

  /** In front of `chapter`'s crown portal, facing away from it into the town. */
  private dock(chapter: HubChapter): Arrival | null {
    const r = this.returns.get(chapter)?.at;
    return r ? { x: r.x + Math.sin(r.yaw) * 4, z: r.z + Math.cos(r.yaw) * 4, yaw: r.yaw } : null;
  }

  private fade(move: () => Promise<boolean> | boolean): Promise<boolean> {
    const lines = this.g.zoneLines;
    return lines ? lines.travel(move).then(() => true) : Promise.resolve(move());
  }

  /** A sail's landing, once its world is up. */
  private land(): void {
    const p = this.pending;
    if (!p) return;
    if (performance.now() > p.until) {
      this.pending = null;
      return;
    }
    if (this.w2.inTidecrown || this.w2.chapter !== p.chapter) return;
    this.pending = null;
    const g = this.g;
    g.player.setTarget(null);
    g.player.unit.teleport(g.world, p.at.x, p.at.z, p.at.yaw);
    g.follow.yaw = p.at.yaw + Math.PI;
    g.follow.cut();
    this.w2.resetPortalArrival();
  }

  /** The travel choice: every world, open ones to pick and locked ones with the reason. */
  choose(by: By): void {
    const k = by === 'ship' ? this.captain : this.keeper;
    if (!k || !this.shown) return;
    const g = this.g, u = k.unit;
    g.player.setTarget(null);
    u.setYaw(yawTo(u.pos.x, u.pos.z, g.player.unit.pos.x, g.player.unit.pos.z));
    u.express('happy', 1.2);
    u.act('gesture_hello');
    // Open worlds in the gold style, locked ones dark behind a lock.
    const buttons = HUB_WORLDS.map((w) => {
      const locked = !this.w2.canTravel(w.chapter);
      return {
        label: `${locked ? '🔒 ' : ''}${t(`월드 ${ROMAN[w.chapter]} · ${w.ko}`, `World ${ROMAN[w.chapter]} · ${w.en}`)}`,
        primary: !locked,
        onClick: () => (locked ? this.refuse(by, w.chapter) : this.confirm(by, w.chapter)),
      };
    });
    buttons.push({ label: t('다음에 갈게요', 'Not now'), primary: false, onClick: () => g.hud.dialogue.close() });
    g.hud.dialogue.open({
      unit: u, portraitArt: k.portrait, questTitle: by === 'ship' ? t('금빛집게호 배편', 'Voyages of the Goldclaw') : t('바다유리 포탈', 'The Seaglass portal'),
      paragraphs: [by === 'ship'
        ? t('금빛집게호는 모든 월드로 가요. 어디로 갈까요? 🔒 표시는 아직 잠긴 곳이에요.', 'The Goldclaw sails to every world. Where to? A 🔒 world is still locked.')
        : t('이 포탈은 모든 월드로 이어져요. 어디로 갈까요? 🔒 표시는 아직 잠긴 곳이에요.', 'This portal opens onto every world. Where to? A 🔒 world is still locked.')],
      buttons,
    });
  }

  private confirm(by: By, chapter: HubChapter): void {
    const k = by === 'ship' ? this.captain : this.keeper, w = HUB_WORLDS[chapter - 1];
    if (!k) return;
    const place = t(`월드 ${ROMAN[chapter]} · ${w.ko}`, `World ${ROMAN[chapter]} · ${w.en}`);
    this.g.hud.dialogue.open({
      unit: k.unit, portraitArt: k.portrait, questTitle: place,
      paragraphs: [by === 'ship' ? t(`${w.ko}${ro(w.ko)} 출항할까요?`, `Set sail for ${w.en}?`) : t(`${w.ko}${ro(w.ko)} 가는 포탈을 열까요?`, `Open the way to ${w.en}?`)],
      buttons: [
        { label: by === 'ship' ? t('출항하기', 'Set sail') : t('포탈로 들어가기', 'Step through'), primary: true, onClick: () => void this.sail(chapter) },
        { label: t('다른 곳 고르기', 'Choose another'), primary: false, onClick: () => this.choose(by) },
      ],
    });
  }

  private refuse(by: By, chapter: HubChapter): void {
    const k = by === 'ship' ? this.captain : this.keeper, w = HUB_WORLDS[chapter - 1];
    if (!k) return;
    this.g.hud.dialogue.open({
      unit: k.unit, portraitArt: k.portrait, questTitle: `🔒 ${t(`월드 ${ROMAN[chapter]} · ${w.ko}`, `World ${ROMAN[chapter]} · ${w.en}`)}`,
      paragraphs: [this.w2.travelLock(chapter) ?? ''],
      buttons: [
        { label: t('다른 곳 고르기', 'Choose another'), primary: true, onClick: () => this.choose(by) },
        { label: t('다음에 갈게요', 'Not now'), primary: false, onClick: () => this.g.hud.dialogue.close() },
      ],
    });
  }

  update(dt: number, time: number): void {
    this.land();
    if (!this.w2.inTidecrown) {
      this.returns.get(this.w2.chapter)?.portal.update(time);
      return;
    }
    if (!this.shown) return;
    const g = this.g, player = g.player.unit;
    this.seaglass?.update(time);
    // The Seaglass ring opens the choice when walked into, as the worlds' portals travel when walked into.
    const s = this.seaglass?.root.position;
    if (s) {
      const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z);
      if (d > 4.5) this.armed = true;
      if (this.armed && d < 1.7 && player.alive && !g.hud.dialogue.isOpen && !g.controlsLocked) {
        this.armed = false;
        this.choose('portal');
      }
    }
    const camera = g.camera.position, pxPerUnit = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(g.camera.fov / 2)));
    for (const k of [this.captain, this.keeper]) {
      if (!k) continue;
      const u = k.unit;
      u.name = t(...k.name);
      u.title = t(...k.title);
      const near = u.distTo(player), talking = g.hud.dialogue.unit === u;
      // Facing whoever comes to the pier or the portal; back to the post once they go.
      u.setYaw(turnToward(u.yaw, talking || near < 7 ? yawTo(u.pos.x, u.pos.z, player.pos.x, player.pos.z) : k.yaw, 2.4, dt));
      if (!talking && near < 5 && time - k.lastHello > 35 && !u.motion.action) {
        u.act('gesture_hello');
        u.express('happy', 1.2);
        k.lastHello = time;
      }
      u.feedLocomotion(dt);
      // The game draws only its own units; these two get the same culling, detail and shadow rules.
      const d = this.cam.copy(camera).distanceTo(u.pos);
      u.culled = d > 80;
      u.rig.root.visible = !u.culled && !u.hidden;
      u.lod = (u.height * pxPerUnit) / Math.max(d, 0.1) < (u.lod ? 110 : 90) ? 1 : 0;
      u.rig.setLod?.(u.lod);
      u.setShadows(d < 18);
      u.updateVisual(dt);
    }
  }

  dispose(): void {
    this.hide();
    for (const r of this.returns.values()) r.portal.dispose();
    this.returns.clear();
    this.seaglass?.dispose();
    this.seaglass = null;
    for (const k of [this.captain, this.keeper]) {
      if (!k) continue;
      this.g.scene.remove(k.unit.rig.root);
      k.unit.dispose();
    }
    this.captain = this.keeper = null;
  }
}
