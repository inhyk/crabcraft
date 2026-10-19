import * as THREE from 'three';
import type { EndingObservation } from '../sim/features/endingPresentation.ts';
import type { EndingPresentationFrame } from './worldEndingPresentation.ts';
import { t } from '../i18n.ts';
import { CLASSES } from '../data/classes';
import { abilityName } from '../game/abilityLocale';
import { bossPhaseBanner, bossWarning } from '../game/bossLocale';
import { BOSS_PROFILES } from '../game/progression';
import { ACHIEVEMENTS } from '../game/achievements';
import { BOSS_YELLS, TOWNSFOLK_BARKS } from '../game/quests';
import { STAR_VICTORY_BARKS } from '../game/starDialogue';
import { C, N, type Vfx, type WardHandle } from '../game/vfx/vfx';
import { Sprite } from '../game/vfx/atlas';
import type { Fx } from '../game/vfx/effects';
import type { Unit } from '../game/unit';
import type { Hud } from '../ui/hud/hud';
import type { AudioManager } from '../core/audio';
import type { FollowCamera } from '../core/followCamera';
import type { CoreEvent, EntityRef, EventRecord, ChannelKind, MechId, Vec3 } from '../sim/types.ts';
import type { FeatureEvent, NpcFeatureEvent } from '../sim/features/types.ts';
import type { GameplayState, PublicProjectile } from '../../server/world/gameplay/protocol.ts';
import { canonicalRigId } from '../sim/data/rig-aliases.ts';

type EquipmentEvent = Extract<CoreEvent, { type: 'equipment' }>;
type QuestEvent = Extract<CoreEvent, { type: 'quest' }>;
type EndingEvent = Extract<CoreEvent, { type: 'endingReady' }>;
export interface WorldPresentationPorts {
  unit(ref: EntityRef): Unit | null;
  self(): Unit | null;
  vfx: Vfx;
  hud: Pick<Hud, 'floats' | 'messages' | 'chat' | 'castBar' | 'targetFrame' | 'bossFrame' | 'actionBar' | 'damageFlash'>;
  audio: Pick<AudioManager, 'sfx'>;
  follow: Pick<FollowCamera, 'shake' | 'cut' | 'yaw'>;
  time(): number;
  say(unit: Unit, text: string, yell: boolean): void;
  sandy?: () => boolean;
  onEquipment?: (event: EquipmentEvent) => void;
  onQuest?: (event: QuestEvent) => void;
  onEnding?: (event: EndingEvent) => void;
  onEndingPresentation?: (observation:EndingObservation|null,frame:EndingPresentationFrame|null)=>void;
  onExploration?: (state: { found: boolean; activeUntil: number; earned: readonly string[] }) => void;
  onIncomplete?: (feature: 'ending-choreography' | 'unknown-text') => void;
}
type ObservedProjectile = ReturnType<Vfx['observedProjectile']>;
interface Warning { order: number; endsAt: number; effects: { dispose(): void }[]; notice: HTMLElement | null }
const same = (a: EntityRef | null | undefined, b: EntityRef | null | undefined): boolean => !!a && !!b && a.area === b.area && a.id === b.id && a.life === b.life;
const key = (ref: EntityRef) => JSON.stringify([ref.area, ref.id, ref.life]);
const vector = (value: Readonly<Vec3>) => new THREE.Vector3(value.x, value.y, value.z);
const ability = (id: string) => Object.values(CLASSES).flatMap(c => c.abilities).find(a => a.id === id);
const unreachable = (value: never): never => { throw new Error(`Unmapped world presentation event: ${String(value)}`); };
const SHAKE: Record<MechId, readonly [number, number] | null> = { slam: [.5, .5], eclipse: [.5, .7], nova: [.4, .5], cross: [.3, .4], barrage: [.3, .4], undertow: [.55, .6], spray: null };
const ERRORS: Record<string, string> = { 'You are stunned.': '기절한 동안에는 움직일 수 없어요.', 'Another action is in progress.': '다른 행동을 마친 뒤 사용하세요.', 'Ability is not ready yet.': '아직 기술을 다시 사용할 수 없어요.', 'Not enough rage.': '분노가 부족해요.', 'Not enough mana.': '마나가 부족해요.', 'You have no target.': '먼저 대상을 선택하세요.', 'Invalid target.': '이 대상에게는 사용할 수 없어요.', 'Out of range.': '조금 더 가까이 다가가세요.', 'Target too close.': '대상과 조금 더 거리를 두세요.', 'Target not in line of sight.': '대상이 장애물에 가려져 있어요.', "You can't dance while in combat.": '전투 중에는 춤출 수 없어요.', 'Stand still to dance.': '멈춰 선 다음에 춤출 수 있어요.' };

export function channelLabel(kind: ChannelKind): string {
  switch (kind) {
    case 'recall': return t('광장으로 돌아가는 중', 'Returning to the square');
    case 'beacon': return t('등대 켜는 중', 'Lighting lighthouse');
    case 'waystone': return t('별빛 등불 켜는 중', 'Lighting waystone');
    case 'lighthouse-secret': return t('바위 속 비밀을 깨우는 중', 'Waking the secret in the stone');
    default: return unreachable(kind);
  }
}

/** Numeric events are observations only. This class owns no player, combat or reward methods. */
export class WorldPresentation {
  private state: GameplayState | null = null;
  private binding = '';
  private elapsed = 0;
  private lastOrder = -1;
  private pending: { record: EventRecord; expires: number }[] = [];
  private projectiles = new Map<number, { identity: string; effect: ObservedProjectile; expires: number }>();
  private warnings = new Map<string, Warning>();
  private wards = new Map<string, WardHandle>();
  private castKey = '';
  private endingKey = '';
  private recoveredEndingTick = -1;
  private disposed = false;
  private readonly temp = new THREE.Vector3();

  constructor(private readonly ports: WorldPresentationPorts) {}
  private get now(): number { return this.state ? Math.max(this.ports.time(), this.state.time + this.elapsed) : this.ports.time(); }
  private local(ref: EntityRef): boolean { return same(ref, this.state?.selfRef); }
  private missing(ref: EntityRef): boolean { return !this.state?.actors.some(actor => same(actor.ref, ref)); }
  private profile(ref: EntityRef) {
    const id = canonicalRigId(this.state?.actors.find(actor => same(actor.ref, ref))?.archetype ?? '');
    switch (id) { case 'corrodius': return BOSS_PROFILES.rust; case 'abyss': return BOSS_PROFILES.abyss; case 'eclipse': return BOSS_PROFILES.eclipse; case 'dawn': return BOSS_PROFILES.dawn; case 'frost': return BOSS_PROFILES.frost; default: return null; }
  }

  commit(state: GameplayState): void {
    if (this.disposed) return;
    const binding = JSON.stringify([state.header.session, state.header.area, state.header.epoch, state.header.catalog]);
    if (binding !== this.binding) { this.reset(); this.binding = binding; this.lastOrder = state.eventWatermark; }
    this.state = structuredClone(state); this.elapsed = 0;
    this.synchronize();
    this.ports.onEndingPresentation?.(structuredClone(state.recovery.endingPresentation??null),{session:state.header.session,area:state.header.area,epoch:state.header.epoch,catalog:state.header.catalog,sequence:state.header.sequence,selfRef:{...state.selfRef}});
  }

  events(records: readonly EventRecord[]): void {
    if (this.disposed || !this.state) return;
    for (const record of records) {
      if (record.order <= this.lastOrder) continue;
      this.lastOrder = record.order;
      if (!this.present(record) && this.pending.length < 256) this.pending.push({ record: structuredClone(record), expires: this.now + 5 });
    }
  }

  private synchronize(): void {
    const state = this.state; if (!state) return;
    const ids = new Set(state.projectiles.map(projectile => projectile.id));
    for (const [id, projectile] of this.projectiles) if (!ids.has(id)) { projectile.effect.dispose(); this.projectiles.delete(id); }
    for (const projectile of state.projectiles) this.syncProjectile(projectile);
    const activeWarnings = new Set<string>();
    for (const record of state.recovery.telegraphs) if (record.event.type === 'telegraph') {
      const id = key(record.event.src); activeWarnings.add(id); this.telegraph(record, record.event);
    }
    for (const [id] of this.warnings) if (!activeWarnings.has(id)) this.clearWarning(id);
    const warded = new Set<string>();
    for (const actor of state.actors) {
      if (actor.absorb <= 0 || actor.absorbUntil <= this.now || !actor.alive) continue;
      const id = key(actor.ref); warded.add(id);
      const unit = this.ports.unit(actor.ref);
      if (unit && !this.wards.get(id)?.alive) this.wards.set(id, this.ports.vfx.ward(unit, actor.absorbUntil - this.now));
    }
    for (const [id, effect] of this.wards) if (!warded.has(id)) { effect.pop(); this.wards.delete(id); }
    const channel = state.self.player.channel && state.self.player.channel.end > this.now ? state.self.player.channel : null;
    const cast = state.self.player.cast && state.self.player.cast.end > this.now ? state.self.player.cast : null;
    const castKey = channel ? `channel:${channel.kind}:${channel.start}:${channel.end}` : cast ? `cast:${cast.ability}:${cast.start}:${cast.end}` : '';
    if (castKey !== this.castKey) {
      this.castKey = castKey;
      if (channel) this.ports.hud.castBar.observe(() => channelLabel(channel.kind), channel.start, channel.end, true);
      else if (cast) { const definition = ability(cast.ability); if (definition) this.ports.hud.castBar.observe(() => abilityName(definition), cast.start, cast.end, false); }
      else this.ports.hud.castBar.observe(null, 0, 0);
    }
    const ending = state.recovery.endings.find(ending => this.local(ending.unit));
    const endingKey = ending ? JSON.stringify([key(ending.unit), ending.chapter, ending.replay]) : '';
    if (endingKey && endingKey !== this.endingKey) { this.ending({ type: 'endingReady', ...ending! }); this.recoveredEndingTick = state.header.tick; }
    this.endingKey = endingKey;
    this.ports.onExploration?.({ found: state.self.player.lighthouseSecretFound ?? false, activeUntil: state.features.exploration?.find(item => this.local(item.unit))?.activeUntil ?? 0, earned: [...state.self.achievements.earned] });
  }

  private syncProjectile(projectile: PublicProjectile): void {
    const identity = JSON.stringify([projectile.source, projectile.target, projectile.style]);
    let current = this.projectiles.get(projectile.id);
    if (current && current.identity !== identity) { current.effect.dispose(); this.projectiles.delete(projectile.id); current = undefined; }
    if (!current) { current = { identity, effect: this.ports.vfx.observedProjectile(vector(projectile), projectile.style), expires: this.now + Math.max(0, 6 - projectile.elapsed) }; this.projectiles.set(projectile.id, current); }
    current.expires = this.now + Math.max(0, 6 - projectile.elapsed);
    current.effect.setPosition(vector(projectile));
  }

  private clearWarning(id: string): void {
    const warning = this.warnings.get(id); if (!warning) return;
    for (const effect of warning.effects) effect.dispose();
    if (warning.notice) this.ports.hud.messages.clearWarning(warning.notice);
    this.warnings.delete(id);
  }
  private telegraph(record: EventRecord, event: Extract<CoreEvent, { type: 'telegraph' }>): void {
    const id = key(event.src), endsAt = record.tick / 30 + event.seconds;
    if (endsAt <= this.now) { this.clearWarning(id); return; }
    if (this.warnings.get(id)?.order === record.order) return;
    this.clearWarning(id);
    const remaining = endsAt - this.now, vfx = this.ports.vfx, effects: { dispose(): void }[] = [];
    const fx = (effect: Fx) => effects.push({ dispose: () => { if (effect.alive) vfx.fx.release(effect); } });
    for (const shape of event.shapes) {
      switch (shape.shape) {
        case 'circle': fx(vfx.telegraphCircle(vector(shape.at), shape.radius, remaining, shape.color ? new THREE.Color(shape.color) : undefined, vector(shape.ground))); break;
        case 'cone': fx(vfx.telegraphCone(vector(shape.at), shape.yaw, shape.range, shape.half, remaining, shape.color ? new THREE.Color(shape.color) : undefined, vector(shape.ground))); break;
        case 'lane': fx(vfx.telegraphLane(vector(shape.at), shape.yaw, shape.halfLength, shape.halfWidth, remaining, new THREE.Color(shape.color))); break;
        case 'undertow': effects.push(vfx.undertow(vector(shape.at), shape.radius, remaining)); break;
        default: unreachable(shape);
      }
    }
    const notice = this.ports.hud.messages.warn(bossWarning(event.mech, event.level), { persistent: true });
    this.warnings.set(id, { order: record.order, endsAt, effects, notice });
  }

  private footstep(volume: number, pitch: number): void { this.ports.audio.sfx(this.ports.sandy?.() ? 'sfx-footstep-sand' : 'sfx-footstep-stone', { volume, pitch }); }
  private ending(event: EndingEvent): void {
    if (!this.local(event.unit)) return;
    this.ports.onEnding?.(event);
    if(!this.ports.onEndingPresentation||!Object.hasOwn(this.state?.recovery??{},'endingPresentation'))this.ports.onIncomplete?.('ending-choreography');
    // Readiness alone never starts local actions; the private recovery observation owns the display.
  }

  /** false means a known, still-loading rig is required; absent AOI/life references are dropped. */
  private present(record: EventRecord): boolean {
    const event = record.event, { vfx, hud, audio, follow } = this.ports;
    switch (event.type) {
      case 'damage': { const unit = this.ports.unit(event.dst); if (!unit) return this.missing(event.dst);
        hud.floats.spawn(unit, this.local(event.dst) ? `-${event.amount}` : event.crit ? `${event.amount}!` : `${event.amount}`, this.local(event.dst) ? 'taken' : event.crit ? 'crit' : 'dmg');
        unit.flash(this.local(event.dst) ? '#ff2a1a' : '#ffffff', this.local(event.dst) ? .18 : .1);
        if (this.local(event.dst)) hud.damageFlash(event.amount / unit.maxHp);
        if (event.crit) follow.shake(unit.kind === 'boss' ? .18 : .12, .25);
        audio.sfx(event.crit ? 'sfx-crit' : 'sfx-hit', { volume: event.crit ? .8 : .55 }); return true; }
      case 'heal': { const unit = this.ports.unit(event.dst); if (!unit) return this.missing(event.dst); if (event.amount > 0) hud.floats.spawn(unit, event.crit ? `+${Math.round(event.amount)}!` : `+${Math.round(event.amount)}`, 'heal'); audio.sfx('sfx-heal', { volume: .6 }); return true; }
      case 'blocked': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); hud.floats.spawn(unit, event.reason === 'evade' ? t('회피', 'Evade') : t('흡수', 'Absorbed'), 'info'); return true; }
      case 'death': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); unit.express('dead', 999); unit.rig.face.setTint(null); vfx.deathPoof(unit); return true; }
      case 'buff': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); hud.floats.spawn(unit, t(`녹 ${event.stacks}중첩`, `Rust x${event.stacks}`), 'info'); return true; }
      case 'ward': if (event.stage === 'hit') this.wards.get(key(event.unit))?.hit(); else if (event.stage === 'down') { this.wards.get(key(event.unit))?.pop(); this.wards.delete(key(event.unit)); } return true;
      case 'castStart': audio.sfx('sfx-cast', { volume: .5 }); return true; // labels/progress are snapshot-owned
      case 'castEnd': if (this.local(event.unit) && event.result === 'interrupted') hud.castBar.fail(() => t(event.reason === 'Cancelled' ? '취소됨' : '중단됨', event.reason ?? 'Interrupted')); return true;
      case 'ability': return this.ability(event);
      case 'attack': return this.attack(event);
      case 'projectile': {
        if (event.stage === 'spawn') {
          if (!this.projectiles.has(event.id)) this.projectiles.set(event.id, { identity: JSON.stringify([event.src, event.target, event.style]), effect: vfx.observedProjectile(vector(event.from), event.style), expires: this.now + 6 });
        } else { const current = this.projectiles.get(event.id); const target = this.ports.unit(event.target); const at = event.landed && target ? target.centre(this.temp) : null;
          if (current) current.effect.finish(at);
          else if (at) { if (event.style === 'bubble') vfx.bubbleSplash(at); else vfx.impact(at, event.style === 'holy' ? C.holy : event.style === 'rust' ? C.ember : C.frost, .6); }
          this.projectiles.delete(event.id);
        }
        return true;
      }
      case 'press': if (this.local(event.unit)) hud.actionBar.press(event.slot); return true;
      case 'error': if (this.local(event.unit)) { hud.messages.error(t(ERRORS[event.reason] ?? event.reason, event.reason)); audio.sfx('sfx-error', { volume: .6 }); } return true;
      case 'target': if (this.local(event.unit)) { const target = event.target ? this.ports.unit(event.target) : null; hud.targetFrame.setUnit(target, target?.npcId ? `art/npc/${target.npcId}.webp` : null); if (target) audio.sfx('sfx-click', { volume: .35 }); } return true;
      case 'jump': if (!this.ports.unit(event.unit)) return this.missing(event.unit); audio.sfx('sfx-servo-whir', { volume: .35 }); return true;
      case 'footstep': if (!this.ports.unit(event.unit)) return this.missing(event.unit); this.footstep(.22, .12); return true;
      case 'recall': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); if (this.local(event.unit)) { follow.yaw = unit.yaw + Math.PI; follow.cut(); } vfx.mendGlow(unit); return true; }
      case 'dance': if (event.stage === 'moment') { if (event.moment === 'takeoff' || event.moment === 'spin_from' && event.move === 'break_spin') audio.sfx('sfx-servo-whir', { volume: .4 }); else if (event.moment === 'land' || event.moment === 'hit' && event.move === 'break_oneclaw') this.footstep(.55, .08); } return true;
      case 'xp': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); hud.floats.spawn(unit, `+${event.amount} XP`, 'xp'); if (this.local(event.unit)) hud.chat.system(t(`경험치 ${event.amount}을 얻었습니다.`, `You gain ${event.amount} experience.`)); return true; }
      case 'levelUp': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); vfx.levelUp(unit); audio.sfx('sfx-levelup'); if (this.local(event.unit)) hud.messages.banner(() => t(`레벨 ${event.level}`, `Level ${event.level}`), () => event.jump ? t('계속해서 성장하세요!', 'Keep growing!') : t(`껍질이 더 단단해졌어요. 체력 ${event.oldMaxHp} → ${event.maxHp}`, `Your shell hardens. Health ${event.oldMaxHp} to ${event.maxHp}`), 'level'); return true; }
      case 'aggro': audio.sfx('sfx-servo-whir', { volume: .25, pitch: .2 }); return true;
      case 'spawn': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); vfx.burrow(unit.pos); return true; }
      case 'leash': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); hud.floats.spawn(unit, t('회피', 'Evade'), 'info'); return true; }
      case 'freed': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); vfx.steamPuff(unit.pos); vfx.lootSparkle(unit.pos); audio.sfx('sfx-servo-whir'); return true; }
      case 'telegraph': this.telegraph(record, event); return true;
      case 'telegraphEnd': this.clearWarning(key(event.src)); return true;
      case 'impact': for (const shape of event.shapes) { switch (shape.fx) {
        case 'lane': vfx.telegraphLane(vector(shape.at), shape.yaw, shape.halfLength, shape.halfWidth, shape.seconds, new THREE.Color(shape.color)); break;
        case 'slam': vfx.slamImpact(vector(shape.at), shape.radius); break;
        case 'ring': vfx.ring(vector(shape.at), new THREE.Color(shape.color), shape.r0, shape.r1, shape.seconds, shape.inner); break;
        case 'spray': vfx.rustSpray(vector(shape.at), shape.yaw, shape.range, shape.half); break;
        default: unreachable(shape);
      }} if (event.loud && SHAKE[event.mech]) { const [amount, seconds] = SHAKE[event.mech]!; follow.shake(amount, seconds); audio.sfx('sfx-crit'); } return true;
      case 'boss': return this.boss(event);
      case 'say': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); const text = worldSayText(event.textKey); if (text) this.ports.say(unit, text, event.yell); else this.ports.onIncomplete?.('unknown-text'); return true; }
      case 'loot': { if (!this.local(event.recipient)) return true; const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); vfx.lootSparkle(unit.pos); hud.floats.spawn(unit, t('+1 녹슨 톱니', '+1 Rusted Cog'), 'info'); hud.chat.loot(t('전리품 획득: [녹슨 톱니].', 'You receive loot: [Rusted Cog].')); audio.sfx('sfx-click', { volume: .6 }); return true; }
      case 'victory': if (event.recipients.some(ref => this.local(ref))) { if (event.stage === 'banner') { const profile = this.profile(event.boss); hud.messages.banner(() => t('승리, 왕관 획득', 'VICTORY, Crown reclaimed'), () => profile?.name ?? '', 'boss'); const self = this.ports.self(); if (self) vfx.levelUp(self); } else hud.bossFrame.hide(); } return true;
      case 'feature': return this.feature(event.event);
      case 'quest': if (this.local(event.unit)) this.ports.onQuest?.(event); return true;
      case 'equipment': if (this.local(event.unit)) this.ports.onEquipment?.(event); return true;
      case 'achievement': if (this.local(event.unit)) { const item = ACHIEVEMENTS.find(item => item[0] === event.achievement); if (item) hud.messages.info(t(`🏆 업적 달성: ${item[1]}`, `🏆 Achievement: ${item[2]}`)); } return true;
      case 'discovery': if (this.local(event.unit)) { if (event.discovery === 'lighthouse-secret') { audio.sfx('sfx-quest-complete'); hud.messages.banner(() => t('등대지기의 비밀 무대', 'The keeper’s secret stage'), () => event.first ? t(`이스터에그 발견! 비밀의 게 댄스, ${event.coins} 코인`, `Easter egg found! Secret crab dance, ${event.coins} coins`) : t('돌아온 관객을 위한 작은 게들의 춤!', 'A little crab dance for a returning guest!'), 'zone'); } else { if (event.first) audio.sfx('sfx-quest-complete'); else hud.messages.info(t('보물은 이미 챙겼어요. 섬의 추억은 남아 있어요!', 'You already found this treasure. The memory is yours!')); } } return true;
      case 'endingReady': { const signature = JSON.stringify([key(event.unit), event.chapter, event.replay]); if (signature !== this.endingKey || record.tick !== this.recoveredEndingTick) this.ending(event); this.endingKey = signature; return true; }
      case 'action': case 'rootRebase': case 'respawn': case 'reward': case 'travelReady': return true; // applied pose/progression/transition are authoritative snapshots
      default: return unreachable(event);
    }
  }

  private ability(event: Extract<CoreEvent, { type: 'ability' }>): boolean {
    const unit = this.ports.unit(event.caster); if (!unit) return this.missing(event.caster);
    const target = event.target ? this.ports.unit(event.target) : null;
    if (event.target && !target) return this.missing(event.target);
    const { vfx, audio, follow, hud } = this.ports, range = event.range ?? 0;
    switch (`${event.ability}:${event.stage}`) {
      case 'crown-burst:start': vfx.tidalNova(unit.pos, range); vfx.ring(unit.pos, N.gold, .5, range, .8, .9); vfx.impact(unit.centre(this.temp), C.gold, 2); audio.sfx('sfx-crit', { volume: .7 }); follow.shake(.22, .4); break;
      case 'pincer-strike:hit': if (target) { vfx.slash(unit, target, C.gold, 1.25); follow.shake(.06, .15); } break;
      case 'shell-bash:hit': if (target) { vfx.impact(target.centre(this.temp), C.white, 1.3); vfx.ring(target.pos, N.gold, .3, 2.4, .4, .75); vfx.stunStars(target, event.stun ?? 0); follow.shake(.14, .22); hud.floats.spawn(target, t('기절', 'Stunned'), 'info'); } break;
      case 'sideways-charge:start': vfx.dashTrail(unit, .5); audio.sfx('sfx-servo-whir', { volume: .7 }); hud.floats.spawn(unit, t('+15 분노', '+15 Rage'), 'info'); break;
      case 'sideways-charge:hit': if (target) { vfx.impact(target.centre(this.temp), C.steel, 1.2); vfx.ring(target.pos, N.gold, .3, 2.2, .35, .8); follow.shake(.12, .2); audio.sfx('sfx-hit', { volume: .8 }); } break;
      case 'whirlpool:start': vfx.whirlpool(unit, range); audio.sfx('sfx-hit', { volume: .7 }); follow.shake(.1, .3); break;
      case 'frost-spray:start': vfx.frostSpray(unit.pos, event.yaw ?? unit.yaw, range, event.half ?? .55); audio.sfx('sfx-cast', { volume: .5 }); break;
      case 'steam-blink:start': if (event.from) vfx.steamPuff(vector(event.from)); vfx.steamPuff(unit.pos); audio.sfx('sfx-servo-whir', { volume: .6 }); break;
      case 'tidal-nova:start': vfx.tidalNova(unit.pos, range); follow.shake(.15, .3); audio.sfx('sfx-crit', { volume: .5 }); break;
      case 'smite:start': if (target) vfx.smite(target); audio.sfx('sfx-cast', { volume: .4 }); break;
      case 'smite:hit': if ((event.amount ?? 0) > 32) follow.shake(.08, .15); break;
      case 'mend-shell:start': vfx.mendGlow(unit); break;
      case 'barnacle-ward:start': audio.sfx('sfx-heal', { volume: .4 }); hud.floats.spawn(unit, t('따개비 보호막', 'Barnacle Ward'), 'info'); break;
      case 'holy-tide:hit': vfx.holyTide(unit.pos, range); follow.shake(.1, .25); break;
    }
    return true;
  }

  private attack(event: Extract<CoreEvent, { type: 'attack' }>): boolean {
    const unit = this.ports.unit(event.src); if (!unit) return this.missing(event.src);
    const target = event.target ? this.ports.unit(event.target) : null;
    if (event.target && !target) return this.missing(event.target);
    const { vfx, audio, follow, hud } = this.ports;
    switch (`${event.attack}:${event.stage}`) {
      case 'warrior-auto:hit': if (target) vfx.slash(unit, target, C.steel, .8); break;
      case 'enemy-claw:hit': if (target) vfx.sparks(target.centre(this.temp), C.ember, 6, 4); break;
      case 'enemy-sea-cast:start': if (event.at) vfx.ring(vector(event.at), C.water, 1.7, 1.7, .9, .85, 0); break;
      case 'enemy-sea-cast:hit': if (event.at) vfx.sparks(vector(event.at), C.water, 14, 4); break;
      case 'enemy-leap:start': audio.sfx('sfx-servo-whir', { volume: .5 }); hud.floats.spawn(unit, t('도약!', 'Leap!'), 'info'); break;
      case 'enemy-leap:hit': vfx.slamImpact(unit.pos, 1.6); follow.shake(.1, .2); break;
      case 'boss-claw:hit': if (target) { vfx.slash(unit, target, C.ember, 1.3); follow.shake(.08, .15); } break;
    }
    return true;
  }

  private boss(event: Extract<CoreEvent, { type: 'boss' }>): boolean {
    const unit = this.ports.unit(event.boss); if (!unit) return this.missing(event.boss);
    const { vfx, audio, follow, hud } = this.ports;
    switch (event.stage) {
      case 'engage': audio.sfx('sfx-boss-roar'); hud.bossFrame.show(unit); follow.shake(.25, .6); break;
      case 'awake': audio.sfx('sfx-boss-roar'); break;
      case 'phase': { const phase = event.phase === 3 ? 3 : 2; const [title, subtitle] = bossPhaseBanner(unit.level, phase); audio.sfx('sfx-boss-roar'); follow.shake(phase === 2 ? .3 : .35, phase === 2 ? .6 : .8); hud.messages.banner(title, subtitle, 'boss'); break; }
      case 'reset': hud.bossFrame.hide(); break;
      case 'death': if (unit.level >= 10) vfx.tidalNova(unit.pos, 8); else vfx.rustPeel(unit, 4.5); follow.shake(.35, 1.2); audio.sfx('sfx-boss-roar', { volume: .7, pitch: 0 }); break;
      case 'frame': if (event.show) hud.bossFrame.show(unit); else hud.bossFrame.hide(); break;
      default: unreachable(event.stage);
    }
    return true;
  }

  private feature(event: FeatureEvent | NpcFeatureEvent): boolean {
    const { hud, audio } = this.ports;
    switch (event.type) {
      case 'npcGreeting': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); unit.express(event.expression, event.seconds); return true; }
      case 'npcBark': { const unit = this.ports.unit(event.unit); if (!unit) return this.missing(event.unit); const text = npcBark(event.bank, event.index); if (text) this.ports.say(unit, text, false); return true; }
      case 'boatBoarded': case 'boatLeft': if (this.local(event.actor)) audio.sfx('sfx-click', { volume: .35 }); return true;
      case 'boatAchievement': return true; // shared achievement snapshot/event owns the personal notice
      case 'villageStarted': hud.messages.info(event.mode === 'hide' ? t('숨바꼭질이 시작됐어요!', 'Hide and seek has begun!') : t('술래잡기가 시작됐어요!', 'Tag has begun!')); return true;
      case 'villageCaught': if (this.local(event.actor)) hud.messages.info(t('잡혔어요!', 'You were caught!')); return true;
      case 'villageFinished': hud.messages.info(event.result === 'cancelled' ? t('놀이가 끝났어요.', 'The game has ended.') : event.result === 'seekers' ? t('술래의 승리!', 'Seekers win!') : t('도망자의 승리!', 'Runners win!')); return true;
      default: return unreachable(event);
    }
  }

  render(dt: number): void {
    if (this.disposed || !this.state) return;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid presentation delta');
    this.elapsed += dt;
    this.pending = this.pending.filter(item => item.expires > this.now && !this.present(item.record));
    for (const [id, warning] of this.warnings) if (warning.endsAt <= this.now) this.clearWarning(id);
    for (const [id, projectile] of this.projectiles) if (projectile.expires <= this.now) { projectile.effect.dispose(); this.projectiles.delete(id); }
    const channel = this.state.self.player.channel, cast = this.state.self.player.cast;
    if (this.castKey && (!channel || channel.end <= this.now) && (!cast || cast.end <= this.now)) { this.castKey = ''; this.ports.hud.castBar.observe(null, 0, 0); }
    const self = this.ports.self();
    if (!self || !same(self.ref, this.state.selfRef)) return;
    if (cast && cast.end > this.now) vfxCast(this.ports.vfx, self, cast.ability, this.temp);
    if (channel && channel.end > this.now) this.ports.vfx.beaconStream(self.socketPos('clawR', this.temp), vector(channel.to), THREE.MathUtils.clamp((this.now - channel.start) / (channel.end - channel.start), 0, 1));
    // Retry snapshot-owned recovery as rigs finish loading, without replaying historical events.
    for (const actor of this.state.actors) if (actor.absorb > 0 && actor.absorbUntil > this.now && !this.wards.get(key(actor.ref))?.alive) { const unit = this.ports.unit(actor.ref); if (unit) this.wards.set(key(actor.ref), this.ports.vfx.ward(unit, actor.absorbUntil - this.now)); }
  }

  reset(): void {
    this.ports.onEndingPresentation?.(null,null);
    for (const projectile of this.projectiles.values()) projectile.effect.dispose(); this.projectiles.clear();
    for (const [id] of this.warnings) this.clearWarning(id);
    for (const ward of this.wards.values()) ward.pop(); this.wards.clear();
    if (this.castKey) this.ports.hud.castBar.observe(null, 0, 0);
    this.ports.hud.bossFrame.hide();
    this.pending = []; this.state = null; this.binding = ''; this.elapsed = 0; this.lastOrder = -1; this.castKey = this.endingKey = ''; this.recoveredEndingTick = -1;
  }
  dispose(): void { if (!this.disposed) { this.reset(); this.disposed = true; } }
}

function vfxCast(vfx: Vfx, unit: Unit, id: string, temp: THREE.Vector3): void { vfx.castMotes(unit.socketPos('clawR', temp), id === 'smite' ? C.holy : id === 'mend-shell' ? C.heal : C.water, id === 'mend-shell' ? Sprite.Star : Sprite.Glow); }

const SHORE_KO = ['옆걸음하기 좋은 저녁이네요.', '앞으로 걸어 본 적 있어요? 저도 없어요.', '오늘 LED가 어둡네요. 녹 때문인가?', '그룩이 집게 씨름 세 판을 빚졌어요.', '등대가 방금 깜빡였나요?', '껍질을 닦았는데 아무도 몰라봐요!', '다리가 여섯인데도 돌길에서 넘어져요.', '주점 수프에서 승리의 향기가 나네요. 해초 향기도요.', '역시 옆걸음이 최고예요.', '선장님 수염이 지붕을 받칠 만큼 튼튼하대요.'];
const STAR = [['별빛 항구에 오신 걸 환영해요!', 'Welcome to Starhaven!'], ['바닷가 마을에서 다 같이 이사 왔어요.', 'We moved here together from the seaside town.'], ['새 집 앞에 꽃을 심었어요!', 'I planted flowers outside my new home!'], ['핍이 수정으로 새 도구를 만든대요.', 'Pip is making new tools from crystals.'], ['북쪽 유적의 일식은 조심하세요.', 'Be careful of the eclipse in the northern ruins.'], ['여기서도 친구들과 함께라서 든든해요.', 'I am glad our friends are here too.']];
function npcBark(bank: 'shore' | 'star' | 'starVictory', index: number): string | null { if (bank === 'shore') return TOWNSFOLK_BARKS[index] && SHORE_KO[index] ? t(SHORE_KO[index]!, TOWNSFOLK_BARKS[index]!) : null; const line = bank === 'star' ? STAR[index] : STAR_VICTORY_BARKS[index]; return line ? t(line[0], line[1]) : null; }

/** Source boss.ts dialogue keys, resolved at display time through the existing locale function. */
export function worldSayText(id: string): string | null {
  if (id === 'boss.leash') return t('달아나라, 작은 껍질아. 녹은 기억한다.', 'Run, little shell. The rust remembers.');
  if (id === 'boss.undertow') return BOSS_YELLS.undertow;
  if (id === 'boss.freed.thanks') return t('고마워. 그 안은 정말 어두웠어.', 'Thank you. It was very dark in there.');
  const [, profile, stage] = id.split('.'); if (!id.startsWith('boss.') || !profile || !stage || !(profile in BOSS_PROFILES)) return null;
  if (profile === 'rust') { switch (stage) { case 'engage': return BOSS_YELLS.engage; case 'awake': return BOSS_YELLS.wake; case 'phase2': return BOSS_YELLS.phase2; case 'phase3': return BOSS_YELLS.phase3; case 'death': return BOSS_YELLS.death; default: return null; } }
  if (stage === 'phase3') return t('왕관의 빛이여, 모든 것을 삼켜라!', 'Light of the crown, consume everything!');
  const lines: Record<string, Record<string, readonly [string, string]>> = {
    abyss: { engage: ['심해의 빛을 피할 수 있겠느냐!', 'Can you escape the light of the deep?'], death: ['심해가 다시 잠잠해지는구나…', 'The deep grows quiet once more…'], awake: ['네레이드가 심해에서 깨어났다.', 'Nereid awakens from the deep.'], phase2: ['깊은 바다의 힘이 깨어난다!', 'The power of the deep awakens!'] },
    eclipse: { engage: ['별의 문을 연 자여, 일식의 시험을 받아라!', 'You who opened the star gate, face the trial of the eclipse!'], death: ['일식이 걷히는구나… 두 세계를 부탁한다.', 'The eclipse fades… Take care of both worlds.'], awake: ['아스트라가 별의 왕좌에서 깨어났다.', 'Astra awakens upon the Star Throne.'], phase2: ['별의 그림자 속으로 들어오라!', 'Step into the shadow of the stars!'] },
    dawn: { engage: ['서리왕에게 가는 길은 내가 막겠다!', 'I guard the road to the Frost King!'], death: ['새벽의 빛을… 가둘 수는 없었구나.', 'The dawn… could never be imprisoned.'], awake: ['솔라칸이 황혼 성채에서 깨어났다.', 'Solarkan awakens in the Twilight Citadel.'], phase2: ['황혼의 불길 속으로 들어오라!', 'Step into the flames of twilight!'] },
    frost: { engage: ['너희 친구도 영원한 겨울 속에 갇힐 것이다!', 'Your friend shall remain imprisoned in eternal winter!'], death: ['얼어붙은 왕관에도… 봄이 오는구나.', 'Even the frozen crown… must welcome spring.'], awake: ['보레아스가 얼음 왕좌에서 깨어났다.', 'Boreas awakens upon the Frozen Throne.'], phase2: ['눈보라여, 얼어붙은 왕관을 지켜라!', 'Blizzard, defend the Frozen Crown!'] },
  };
  const line = lines[profile]?.[stage]; return line ? t(line[0], line[1]) : null;
}
