// Kingdom requests (왕국 의뢰): the King of Tidecrown's own errands, apart from the chapter quests. He offers the first
// one not done whose level and world unlock the player has; one is active at a time. Progress counts in the worlds
// only and only for this player: enemies this player kills (in a relay room a member who is not the authority needs to
// have been fighting it), world bosses whose victory this player stood in, dungeons this player cleared, arrivals of
// this client, island treasures this character found. The log lives in the character's journey save (`kingdom`) and
// pays its coins and XP once: a request is marked done before it pays, and done requests are never offered again.
import { language, t } from '../../i18n';
import type { Boss } from '../boss';
import type { Enemy } from '../enemies';
import type { SimEvent } from '../events';
import type { Game } from '../game';
import type { Unit } from '../unit';
import { HUB_WORLDS } from '../tidecrownHub';
import type { Text } from './keepers';

export type KingdomRequestId = 'patrol' | 'voyage' | 'treasure' | 'crown' | 'tour' | 'shield' | 'depths' | 'frontier';
type Goal =
  | { kind: 'kill' | 'leave' | 'treasure' | 'boss' | 'dungeon'; count: number }
  /** Every world open when the request is accepted. */
  | { kind: 'tour' };
type Chapter = 1 | 2 | 3 | 4 | 5 | 6;

export interface KingdomRequest {
  readonly id: KingdomRequestId;
  readonly title: Text;
  /** What the king asks, in his words. */
  readonly offer: Text;
  readonly goal: Goal;
  /** The objective line ("Defeat enemies: 3/5"). */
  readonly label: Text;
  /** Offered from this level, and once this world is open (2: World II, 3: World III, 4: World IV). */
  readonly level?: number;
  readonly world?: 2 | 3 | 4;
  readonly coins: number;
  readonly xp: number;
}

export const KINGDOM_REQUESTS: readonly KingdomRequest[] = [
  {
    id: 'patrol', title: ['왕국 순찰', 'Royal Patrol'], goal: { kind: 'kill', count: 5 }, label: ['적 물리치기', 'Defeat enemies'], coins: 60, xp: 150,
    offer: ['왕국의 길에 적들이 나타나 주민들이 걱정하고 있단다. 아무 월드에서나 적 5마리를 물리쳐 다오.', 'Enemies roam the roads and my people are worried. Defeat 5 enemies in any world.'],
  },
  {
    id: 'voyage', title: ['첫 항해', 'First Voyage'], goal: { kind: 'leave', count: 1 }, label: ['수도에서 월드로 떠나기', 'Leave the capital for a world'], coins: 40, xp: 100,
    offer: ['이 수도에서는 모든 월드로 갈 수 있단다. 긴 부두의 아라 선장, 바다유리 포탈, 남쪽 숲길 가운데 하나로 수도를 떠나 월드에 가 보거라.', 'From my capital you can reach every world. Leave by Captain Ara on the long pier, the Seaglass portal or the south forest road, and go to a world.'],
  },
  {
    id: 'treasure', title: ['섬의 보물', 'Island Treasure'], goal: { kind: 'treasure', count: 1 }, label: ['섬의 보물 상자 찾기', 'Find an island treasure chest'], coins: 80, xp: 200,
    offer: ['클로헤이븐 앞바다의 섬에 보물 상자가 숨어 있단다. 바닷가에서 배를 타고 가서 하나를 찾아보거라.', 'Treasure chests hide on the islands off Clawhaven. Take a boat from the shore and find one.'],
  },
  {
    id: 'crown', title: ['보스와의 대결', 'Face a Boss'], goal: { kind: 'boss', count: 1 }, label: ['월드 보스 물리치기', 'Defeat a world boss'], level: 3, coins: 150, xp: 500,
    offer: ['월드마다 왕관을 지키는 보스가 있단다. 월드 보스 하나를 물리쳐 다오. 클로헤이븐의 보스는 등대를 켜야 깨어난단다.', 'Every world has a boss guarding a crown. Defeat one world boss. Clawhaven’s bosses wake only when the lighthouse is lit.'],
  },
  {
    id: 'tour', title: ['왕국 순방', 'Royal Tour'], goal: { kind: 'tour' }, label: ['다녀오기', 'Visit'], world: 2, coins: 300, xp: 1500,
    offer: ['내 왕국은 아주 넓단다. 지금 갈 수 있는 월드를 모두 한 번씩 다녀오거라.', 'My kingdom is wide. Visit every world you can travel to now.'],
  },
  {
    id: 'shield', title: ['왕국의 방패', 'Shield of the Realm'], goal: { kind: 'kill', count: 40 }, label: ['적 물리치기', 'Defeat enemies'], level: 10, world: 2, coins: 500, xp: 3000,
    offer: ['먼 월드에서도 적들이 몰려오는구나. 아무 월드에서나 적 40마리를 물리쳐 다오.', 'Enemies gather in the far worlds too. Defeat 40 enemies in any world.'],
  },
  {
    id: 'depths', title: ['던전 원정', 'Dungeon Expedition'], goal: { kind: 'dungeon', count: 1 }, label: ['던전 끝내기', 'Clear a dungeon'], level: 35, world: 3, coins: 2000, xp: 6000,
    offer: ['깊은 던전에 강한 파수병들이 있단다. ⚔ 던전 메뉴에서 원정을 골라 세 번의 전투를 모두 이겨 내거라.', 'Strong sentinels wait in the dungeons. Pick an expedition from the ⚔ Dungeons menu and win all three waves.'],
  },
  {
    id: 'frontier', title: ['왕국의 수호자', 'Guardian of the Realm'], goal: { kind: 'kill', count: 100 }, label: ['적 물리치기', 'Defeat enemies'], world: 4, coins: 10000, xp: 60000,
    offer: ['너라면 왕국의 끝까지 지킬 수 있겠구나. 아무 월드에서나 적 100마리를 물리쳐 다오.', 'You can guard my kingdom to its very edge. Defeat 100 enemies in any world.'],
  },
];
const BY_ID = new Map(KINGDOM_REQUESTS.map((r) => [r.id, r]));
const TREASURES = ['treasure', 'moonTreasure', 'sunsetTreasure'] as const;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
/** How long a hit marks an enemy as this player's fight (a relay member's kill credit). */
const FIGHT = 8;
const MAX_RUNS = 4;

interface Active { id: KingdomRequestId; n: number; worlds: Chapter[]; seen: Chapter[] }
/** The save's shape (journey JSON `kingdom`); every field optional. */
export interface KingdomSave { done?: KingdomRequestId[]; active?: Active; runs?: string[] }
export interface KingdomLine { text: string; done: boolean }

const chapters = (v: unknown, within?: readonly number[]): Chapter[] =>
  Array.isArray(v) ? [...new Set(v.filter((c): c is Chapter => Number.isInteger(c) && c >= 1 && c <= 6 && (!within || within.includes(c))))].sort() : [];

export class KingdomRequests {
  private readonly done = new Set<KingdomRequestId>();
  private active: Active | null = null;
  /** Dungeon runs already counted (a relay room can show the same clear again). */
  private runs: string[] = [];
  /** When this player last hit each enemy. */
  private readonly hits = new WeakMap<Unit, number>();
  /** Where this client was last frame: 0 the capital, else the world's chapter; undefined before the first frame. */
  private where: number | undefined;
  private told = false;
  private trackerKey = '';
  private readonly unlisten: () => void;

  constructor(private readonly g: Game) {
    this.unlisten = g.events.listen((e) => this.observe(e));
  }

  // ------------------------------------------------------------------ offers

  /** The world `chapter` is open by the journey's own unlocks (creator travel does not count). */
  private open(chapter: Chapter): boolean {
    const j = this.g.journey;
    return chapter === 1 || (!!j && (chapter >= 5 ? j.frostCleared : chapter === 4 ? j.finalCleared : chapter === 3 ? j.abyssCleared && j.trueCleared : j.abyssCleared));
  }
  unlocked(r: KingdomRequest): boolean { return this.g.player.level >= (r.level ?? 1) && (!r.world || this.open(r.world)); }
  /** What the player still needs before `r` is offered. */
  lockReason(r: KingdomRequest): string {
    const level = r.level && this.g.player.level < r.level ? r.level : 0, world = r.world && !this.open(r.world) ? r.world : 0;
    if (level && world) return t(`월드 ${ROMAN[world]}가 열리고 ${level}레벨이 되면 다시 찾아오거라.`, `Come back when World ${ROMAN[world]} is open and you reach level ${level}.`);
    if (world) return t(`월드 ${ROMAN[world]}가 열리면 다시 찾아오거라.`, `Come back when World ${ROMAN[world]} is open.`);
    return t(`${level}레벨이 되면 다시 찾아오거라.`, `Come back when you reach level ${level}.`);
  }
  isDone(id: KingdomRequestId): boolean { return this.done.has(id); }
  get allDone(): boolean { return KINGDOM_REQUESTS.every((r) => this.done.has(r.id)); }
  /** The active request. */
  get current(): KingdomRequest | null { return this.active ? BY_ID.get(this.active.id)! : null; }
  /** What the king offers now: the first request not done whose unlocks are met (none while one is active). */
  get offer(): KingdomRequest | null { return this.active ? null : KINGDOM_REQUESTS.find((r) => !this.done.has(r.id) && this.unlocked(r)) ?? null; }
  /** The next request still locked, when nothing is offered. */
  get waiting(): KingdomRequest | null { return KINGDOM_REQUESTS.find((r) => !this.done.has(r.id) && !this.unlocked(r)) ?? null; }

  // ------------------------------------------------------------------ progress

  private count(r: KingdomRequest): number { return r.goal.kind === 'tour' ? this.active?.id === r.id ? this.active.worlds.length : this.openWorlds().length : r.goal.count; }
  private value(r: KingdomRequest): number {
    if (r.goal.kind === 'treasure') return Math.min(r.goal.count, TREASURES.filter((id) => this.g.achievements?.has(id)).length);
    const a = this.active?.id === r.id ? this.active : null;
    return !a ? 0 : r.goal.kind === 'tour' ? a.seen.length : Math.min(a.n, r.goal.count);
  }
  get ready(): boolean { const r = this.current; return !!r && this.value(r) >= this.count(r); }
  private openWorlds(): Chapter[] { return ([1, 2, 3, 4, 5, 6] as const).filter((c) => this.open(c)); }

  /** The objective lines of `r` (the active one, or an offer as it would start). */
  lines(r: KingdomRequest): KingdomLine[] {
    if (r.goal.kind === 'tour') {
      const a = this.active?.id === r.id ? this.active : null;
      return (a?.worlds ?? this.openWorlds()).map((c) => {
        const w = HUB_WORLDS[c - 1];
        return { text: t(`월드 ${ROMAN[c]} · ${w.ko} ${r.label[0]}`, `${r.label[1]} World ${ROMAN[c]} · ${w.en}`), done: !!a?.seen.includes(c) };
      });
    }
    const v = this.value(r), n = this.count(r);
    return [{ text: `${t(...r.label)}: ${v}/${n}`, done: v >= n }];
  }

  private bump(kind: Goal['kind']): void {
    const r = this.current, a = this.active;
    if (!r || !a || r.goal.kind !== kind || r.goal.kind === 'tour' || this.ready) return;
    a.n = Math.min(r.goal.count, a.n + 1);
    this.progressed(r);
  }

  private progressed(r: KingdomRequest): void {
    const line = this.lines(r).find((l) => !l.done) ?? this.lines(r).at(-1)!;
    if (this.ready) {
      if (this.told) return;
      this.told = true;
      this.g.hud.messages.banner(() => t('왕국 의뢰 완료', 'Kingdom Request Complete'), () => t(`${r.title[0]} · 타이드크라운의 왕에게 돌아가세요`, `${r.title[1]} · Return to the King of Tidecrown`), 'quest');
      this.g.hud.chat.quest(t(`왕국 의뢰 「${r.title[0]}」 목표 완료! 타이드크라운의 마리너스 왕에게 보상을 받으세요.`, `Kingdom request "${r.title[1]}" complete! See King Marinus in Tidecrown for your reward.`));
      this.g.audio.sfx('sfx-quest-accept', { volume: 0.7 });
    } else this.g.hud.messages.info(`👑 ${line.text}`);
    this.g.journey?.save();
  }

  /** Kills, boss victories and the hits that make a relay member's kill its own. */
  private observe(e: SimEvent): void {
    const g = this.g, me = g.player.unit;
    if (g.spectator) return;
    if (e.type === 'attack' && e.src === me && e.target) this.hits.set(e.target, g.time);
    else if (e.type === 'ability' && e.caster === me && e.target) this.hits.set(e.target, g.time);
    else if (e.type === 'projectile' && e.stage === 'hit' && e.src === me) this.hits.set(e.target, g.time);
    else if (e.type === 'damage' && e.src === me) this.hits.set(e.dst, g.time);
    else if (e.type === 'death' && this.current?.goal.kind === 'kill') {
      const u = e.unit, enemy = u.ctrl as Enemy | null;
      if (u.kind !== 'scrapling' && u.kind !== 'scavenger' && u.kind !== 'jellyfish') return;
      if (!enemy || enemy.isAdd || enemy.isDungeonOnly || e.killer !== me || g.world2.inTidecrown || g.dungeons?.active) return;
      // A relay member hears of every kill in its room, credited to itself: only its own fights count.
      if (g.multiplayer?.battle.authority === false && !(g.time - (this.hits.get(u) ?? -1e9) < FIGHT || g.player.target === u)) return;
      this.bump('kill');
    } else if (e.type === 'victory' && e.stage === 'banner' && this.current?.goal.kind === 'boss') {
      const arena = (e.boss.ctrl as Boss | null)?.arena;
      if (!arena || g.world2.inTidecrown || Math.hypot(me.pos.x - arena.position.x, me.pos.z - arena.position.z) > arena.radius + 25) return;
      this.bump('boss');
    }
  }

  /** Arrivals, dungeon clears, treasures, and the tracker line; every frame. */
  update(): void {
    const g = this.g, w2 = g.world2;
    if (g.spectator) return;
    const where = g.dungeons?.active ? this.where : w2.inTidecrown ? 0 : w2.chapter;
    if (this.where === undefined) this.where = where;
    else if (where !== undefined && where !== this.where) {
      const from = this.where;
      this.where = where;
      if (where > 0) this.arrived(where as Chapter, from === 0);
    }
    const r = this.current;
    if (r?.goal.kind === 'dungeon') {
      const s = g.dungeons?.state;
      if (s?.phase === 'clear' && !this.runs.includes(s.run) && s.members.includes(g.player.unit.name) && g.player.level >= s.level) {
        this.runs = [...this.runs, s.run].slice(-MAX_RUNS);
        this.bump('dungeon');
      }
    }
    if (r?.goal.kind === 'treasure' && this.ready && !this.told) this.progressed(r);
    this.track();
  }

  private arrived(chapter: Chapter, fromCapital: boolean): void {
    const r = this.current, a = this.active;
    if (!r || !a) return;
    if (r.goal.kind === 'leave' && fromCapital) this.bump('leave');
    else if (r.goal.kind === 'tour' && a.worlds.includes(chapter) && !a.seen.includes(chapter) && !this.ready) {
      a.seen = [...a.seen, chapter].sort() as Chapter[];
      this.progressed(r);
    }
  }

  private track(): void {
    const r = this.current, ready = this.ready;
    const key = r ? `${language()}|${r.id}|${ready}|${this.lines(r).map((l) => `${l.text}${l.done}`).join('|')}` : '';
    if (key === this.trackerKey) return;
    this.trackerKey = key;
    this.g.hud.tracker.setKingdom(r ? { title: t(...r.title), lines: this.lines(r), ready: ready ? t('타이드크라운의 왕에게 돌아가 보상을 받으세요.', 'Return to the King of Tidecrown for your reward.') : null } : null);
  }

  // ------------------------------------------------------------------ the king's answers

  /** Takes the offer `id` (only the one offered now). */
  accept(id: KingdomRequestId): boolean {
    const r = this.offer;
    if (!r || r.id !== id) return false;
    this.active = { id, n: 0, worlds: r.goal.kind === 'tour' ? this.openWorlds() : [], seen: [] };
    // Already met (a treasure found before): the king's own page says so, no announcement follows.
    this.told = this.ready;
    const g = this.g;
    g.audio.sfx('sfx-quest-accept');
    g.hud.chat.quest(t(`왕국 의뢰 수락: ${r.title[0]}`, `Kingdom request accepted: ${r.title[1]}`));
    g.hud.messages.banner(() => t('왕국 의뢰 수락', 'Kingdom Request Accepted'), () => t(...r.title), 'quest');
    g.journey?.save();
    return true;
  }

  /** Pays the active request once it is ready; the request is done before anything is paid. */
  turnIn(): KingdomRequest | null {
    const r = this.current, g = this.g;
    if (!r || !this.ready || this.done.has(r.id)) return null;
    this.done.add(r.id);
    this.active = null;
    this.told = false;
    g.player.coins = Math.min(Number.MAX_SAFE_INTEGER, g.player.coins + r.coins);
    // Exactly the stated XP: the growth blessing does not multiply the king's reward.
    g.player.gainXp(r.xp, false);
    g.journey?.save();
    g.audio.sfx('sfx-quest-complete');
    g.hud.messages.banner(() => t('왕국 의뢰 완료', 'Kingdom Request Complete'), () => t(`${r.title[0]} · +${r.coins.toLocaleString()} 코인 · +${r.xp.toLocaleString()} XP`, `${r.title[1]} · +${r.coins.toLocaleString()} coins · +${r.xp.toLocaleString()} XP`), 'quest');
    g.hud.chat.system(t(`왕국 의뢰 보상: +${r.coins.toLocaleString()} 코인 · +${r.xp.toLocaleString()} XP`, `Kingdom request reward: +${r.coins.toLocaleString()} coins · +${r.xp.toLocaleString()} XP`));
    return r;
  }

  // ------------------------------------------------------------------ save

  /** For the journey save; undefined while untouched, so an untouched save keeps its old shape. */
  snapshot(): KingdomSave | undefined {
    if (!this.done.size && !this.active) return undefined;
    const out: KingdomSave = {};
    if (this.done.size) out.done = KINGDOM_REQUESTS.filter((r) => this.done.has(r.id)).map((r) => r.id);
    if (this.active) out.active = { ...this.active };
    if (this.runs.length) out.runs = [...this.runs];
    return out;
  }

  /** From the journey save; anything missing or malformed falls back to a fresh log. */
  restore(value: unknown): void {
    this.done.clear();
    this.active = null;
    this.runs = [];
    this.told = false;
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.done)) for (const id of v.done) if (BY_ID.has(id as KingdomRequestId)) this.done.add(id as KingdomRequestId);
    if (Array.isArray(v.runs)) this.runs = v.runs.filter((s): s is string => typeof s === 'string' && s.length <= 64).slice(-MAX_RUNS);
    const a = v.active as Record<string, unknown> | undefined, r = a && BY_ID.get(a.id as KingdomRequestId);
    if (!a || typeof a !== 'object' || !r || this.done.has(r.id)) return;
    const worlds = r.goal.kind === 'tour' ? chapters(a.worlds) : [];
    if (r.goal.kind === 'tour' && !worlds.length) return;
    const n = Number.isInteger(a.n) && (a.n as number) >= 0 ? Math.min(a.n as number, r.goal.kind === 'tour' ? 0 : r.goal.count) : 0;
    this.active = { id: r.id, n, worlds, seen: chapters(a.seen, worlds) };
    // A request restored already complete does not announce itself again.
    this.told = this.ready;
  }

  dispose(): void {
    this.unlisten();
    this.g.hud.tracker.setKingdom(null);
  }
}
