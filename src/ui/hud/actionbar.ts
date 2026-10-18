// Action bar (5 ability slots with cooldown sweeps, resource and range tints, tooltips), the XP
// bar, micro menu, cast bar and the contextual interaction prompt.
import {AbilityRange} from '../../game/abilityRange';
import { h } from '../dom';
import {t} from '../../i18n';
import type { Game } from '../../game/game';
import type { AbilityDef } from '../../data/classes';
import { GCD, xpForLevel } from '../../game/player';
import { abilityNeedsTarget, isMeleeAbility } from '../../game/abilities';
import {abilityName,abilityDescription} from '../../game/abilityLocale';
import { iconEl, iconSvg } from './icons';

interface Slot {
  ab: AbilityDef;
  el: HTMLElement;
  cd: HTMLElement;
  cdText: HTMLElement;
  state: string;
  wasCooling: boolean;
}

export class ActionBar {
  readonly el: HTMLElement;
  private slots: Slot[] = [];
  private xpFill: HTMLElement;
  private xpLabel: HTMLElement;
  private tooltip: HTMLElement | null = null;
  private tooltipSource: {ab:AbilityDef;anchor:HTMLElement} | null = null;
  private musicBtn: HTMLButtonElement;
  private microTitles: {el:HTMLElement;ko:string;en:string}[] = [];
  private xpBar: HTMLElement;
  private rangePreview: AbilityRange;
  private lastXp = '';

  constructor(private readonly game: Game, onLog: () => void, onMenu: () => void, onMusic: () => void) {
    this.rangePreview = new AbilityRange(game);
    const cls = game.player.cls;
    const slotsEl = h('div', { class: 'ab-slots hud-plate' });
    for (const ab of cls.abilities) {
      const cd = h('div', { class: 'ab-cd' });
      const cdText = h('div', { class: 'ab-cdtext' });
      const el = h(
        'div',
        { class: `ab-slot hud-i ${cls.resource}${ab.slot===5?' ultimate':''}` },
        iconEl(ab.id, ab.icon),
        cd,
        cdText,
        h('div', { class: 'ab-key' }, String(ab.slot)),
        ab.cost ? h('div', { class: 'ab-cost' }, String(ab.cost)) : null,
      );
      el.addEventListener('click', () => game.player.useAbility(ab.slot));
      el.addEventListener('mouseenter', () => this.showTip(ab, el));
      el.addEventListener('mouseleave', () => this.hideTip());
      slotsEl.append(el);
      this.slots.push({ ab, el, cd, cdText, state: '', wasCooling: false });
    }
    const micro = (icon: string, ko: string, en: string, fn: () => void) => {
      const b = h('button', { class: 'hud-i', title:t(ko,en) }) as HTMLButtonElement;
      this.microTitles.push({el:b,ko,en});
      b.innerHTML = iconSvg(icon);
      b.addEventListener('click', () => {
        game.audio.sfx('sfx-click', { volume: 0.5 });
        fn();
      });
      return b;
    };
    this.musicBtn = micro('music', '음악 (M)', 'Music (M)', onMusic);
    const microEl = h('div', { class: 'ab-micro hud-plate' }, micro('log', '퀘스트 기록 (L)', 'Quest Log (L)', onLog), this.musicBtn, micro('menu', '게임 메뉴 (Esc)', 'Game Menu (Esc)', onMenu));
    this.xpFill = h('div', { class: 'fill' });
    this.xpLabel = h('div', { class: 'ab-xp-label' });
    this.xpBar = h('div', { class: 'ab-xp hud-i', title:t('경험치','Experience') }, this.xpFill, h('div', { class: 'ticks' }));
    this.el = h(
      'div',
      { class: 'ab' },
      h('div', { class: 'ab-row' }, slotsEl, microEl),
      this.xpBar,
      this.xpLabel,
    );
  }

  setMusicIcon(on: boolean): void {
    this.musicBtn.innerHTML = iconSvg(on ? 'music' : 'music-off');
  }

  press(slot: number): void {
    const s = this.slots[slot - 1];
    if (!s) return;
    s.el.classList.add('pressed');
    setTimeout(() => s.el.classList.remove('pressed'), 110);
  }

  private showTip(ab: AbilityDef, anchor: HTMLElement): void {
    this.hideTip();
    this.tooltipSource={ab,anchor};
    this.rangePreview.show(ab);
    const cls = this.game.player.cls;
    const meta: string[] = [];
    if (ab.cost) meta.push(`${ab.cost} ${cls.resource === 'rage' ? t('분노','Rage') : t('마나','Mana')}`);
    meta.push(ab.castTime > 0 ? t(`시전 ${ab.castTime}초`,`${ab.castTime} sec cast`) : t('즉시 시전','Instant'));
    if (ab.cooldown > 0) meta.push(t(`재사용 ${ab.cooldown}초`,`${ab.cooldown} sec cooldown`));
    const range = ab.id==='steam-blink'?t(`최대 이동 ${ab.range}m`,`Travel up to ${ab.range} m`):ab.id==='frost-spray'?t(`전방 ${ab.range}m · 부채꼴`,`Forward ${ab.range} m · cone`):isMeleeAbility(ab) ? t('근접 거리 1.8m','Melee reach 1.8 m') : abilityNeedsTarget(ab) ? t(`사거리 ${ab.range}m`,`${ab.range} m range`) : ab.range > 0 ? t(`반경 ${ab.range}m`,`${ab.range} m radius`) : t('자신','Self');
    const tip = h(
      'div',
      { class: 'cc-tooltip' },
      h('div', { class: 't-title' }, abilityName(ab)),
      h('div', { class: 't-meta' }, meta.join('  |  ')),
      h('div', { class: 't-meta' }, range),
      ab.range>0?h('div',{class:'t-meta'},t('지면에 범위 표시 · 눈금 1m · 벽에 막힐 수 있어요','Ground preview · 1 m ticks · walls may block the skill')):null,
      h('div', { class: 't-desc' }, abilityDescription(ab)),
    );
    document.body.append(tip);
    const r = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - tr.width - 8, Math.max(8, r.left + r.width / 2 - tr.width / 2))}px`;
    tip.style.top = `${r.top - tr.height - 14}px`;
    this.tooltip = tip;
  }

  hideTip(): void {
    this.tooltip?.remove();
    this.tooltip = null;
    this.tooltipSource = null;
    this.rangePreview.show(null);
  }

  dispose():void {this.hideTip();this.rangePreview.dispose();}

  refreshLanguage(): void {
    for(const {el,ko,en} of this.microTitles)el.title=t(ko,en);
    this.xpBar.title=t('경험치','Experience');
    const source=this.tooltipSource;
    if(source)this.showTip(source.ab,source.anchor);
  }

  update(): void {
    this.rangePreview.update();
    const g = this.game;
    const p = g.player;
    const now = g.time;
    const gcdLeft = Math.max(0, p.gcdEnd - now);
    for (const s of this.slots) {
      const cdLeft = p.cooldownLeft(s.ab);
      let frac = 0;
      let text = '';
      let gcd = false;
      if (cdLeft > gcdLeft && cdLeft > 0) {
        frac = cdLeft / s.ab.cooldown;
        text = cdLeft > 1 ? String(Math.ceil(cdLeft)) : cdLeft.toFixed(1);
      } else if (gcdLeft > 0) {
        frac = gcdLeft / GCD;
        gcd = true;
      }
      const cooling = frac > 0;
      if (s.wasCooling && !cooling && s.ab.cooldown > 0 && !gcd) {
        s.el.classList.remove('ready-flash');
        void s.el.offsetWidth;
        s.el.classList.add('ready-flash');
      }
      s.wasCooling = cooling && !gcd;
      s.cd.style.setProperty('--cd', frac.toFixed(3));
      s.cd.classList.toggle('gcd', gcd);
      if (s.cdText.textContent !== text) s.cdText.textContent = text;
      const nores = p.resource < s.ab.cost;
      let oor = false;
      const t = p.target;
      if (abilityNeedsTarget(s.ab) && t && t.alive && t.hostile) {
        oor = isMeleeAbility(s.ab) ? p.unit.gapTo(t) > 1.8 : p.unit.distTo(t) - t.radius > s.ab.range;
      }
      const state = `${nores ? 'n' : ''}${oor ? 'o' : ''}`;
      if (state !== s.state) {
        s.state = state;
        s.el.classList.toggle('nores', nores);
        s.el.classList.toggle('oor', oor);
      }
    }
    const lvl = p.unit.level;
    let xpText: string;
    let frac: number;
    const lo=xpForLevel(lvl),hi=xpForLevel(lvl+1);
    frac=(p.xp-lo)/(hi-lo);
    xpText=t(`레벨 ${lvl}  |  ${Math.floor(p.xp-lo)} / ${hi-lo} XP · ∞`,`Level ${lvl}  |  ${Math.floor(p.xp-lo)} / ${hi-lo} XP · ∞`);
    if (xpText !== this.lastXp) {
      this.lastXp = xpText;
      this.xpLabel.textContent = xpText;
      this.xpFill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
    }
  }
}

export class CastBar {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;
  private time: HTMLElement;
  private spark: HTMLElement;
  private t0 = 0;
  private dur = 0;
  private channel = false;
  private active = false;
  private hideAt = 0;
  private labelSource: string | (() => string) = '';

  constructor(private readonly game: Game) {
    this.fill = h('div', { class: 'fill' });
    this.label = h('div', { class: 'label' });
    this.time = h('div', { class: 'time' });
    this.spark = h('div', { class: 'spark' });
    this.el = h('div', { class: 'castbar' }, h('div', { class: 'cc-bar cast' }, this.fill, this.label, this.time, this.spark));
  }

  start(name: string | (() => string), seconds: number, channel = false): void {
    this.t0 = this.game.time;
    this.dur = seconds;
    this.channel = channel;
    this.active = true;
    this.labelSource = name;
    this.refreshLanguage();
    this.el.className = `castbar on${channel ? ' channel' : ''}`;
  }

  finish(): void {
    if (!this.active) return;
    this.active = false;
    this.fill.style.transform = 'scaleX(1)';
    this.el.className = `castbar on done${this.channel ? ' channel' : ''}`;
    this.hideAt = this.game.time + 0.35;
  }

  fail(reason: string | (() => string)): void {
    this.active = false;
    this.labelSource = reason;
    this.el.className = 'castbar on fail';
    this.hideAt = this.game.time + 0.8;
    this.refreshLanguage();
  }

  update(): void {
    const now = this.game.time;
    this.refreshLanguage();
    if (this.active) {
      const k = Math.min(1, (now - this.t0) / this.dur);
      this.fill.style.transform = `scaleX(${k})`;
      this.spark.style.left = `${k * 100}%`;
      const left = Math.max(0, this.dur - (now - this.t0));
      this.time.textContent = left.toFixed(1);
    } else if (this.hideAt && now > this.hideAt) {
      this.hideAt = 0;
      this.el.classList.remove('on');
      this.time.textContent = '';
    }
  }

  refreshLanguage(): void {
    if(!this.active&&(!this.hideAt||this.game.time>this.hideAt))return;
    const text=typeof this.labelSource==='function'?this.labelSource():this.labelSource;
    if(this.label.textContent!==text)this.label.textContent=text;
  }
}

export class Prompt {
  readonly el: HTMLElement;
  private text = '';

  constructor() {
    this.el = h('div', { class: 'prompt' });
  }

  show(key: string, text: string): void {
    const t = `${key}|${text}`;
    if (t === this.text) return;
    this.text = t;
    this.el.replaceChildren(h('kbd', null, key), text);
    this.el.classList.add('on');
  }

  hide(): void {
    if (!this.text) return;
    this.text = '';
    this.el.classList.remove('on');
  }
}
