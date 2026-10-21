// Quest tracker (right side), quest log (L) and the NPC dialogue window with typewriter text.
import { h } from '../dom';
import {language,t} from '../../i18n';
import type { Game } from '../../game/game';
import type { Unit } from '../../game/unit';
import { QUESTS, QUEST_ORDER, npcName, type QuestId, type QuestLog } from '../../game/quests';
import { portraitStyle } from './frames';
import { starMemory } from '../../game/starMemories';

export class QuestTracker {
  readonly el: HTMLElement;
  private list: HTMLElement;
  /** The active kingdom request (the King of Tidecrown's), under the quests. */
  private kingdom = h('div', { class: 'qt-kingdom' });
  private key = '#';
  private seen = new Set<QuestId>();

  constructor(onClick: (q: QuestId) => void) {
    this.list = h('div', { class: 'qt-list' });
    this.el = h('div', { class: 'qt' }, h('div', { class: 'qt-head' }, t('퀘스트','Quests')), this.list, this.kingdom);
    this.list.addEventListener('click', (e) => {
      const q = (e.target as HTMLElement).closest('[data-q]')?.getAttribute('data-q') as QuestId | null;
      if (q) onClick(q);
    });
  }

  update(log: QuestLog, flashId?: string): void {
    const active = log.active();
    this.el.querySelector('.qt-head')!.textContent=t('퀘스트','Quests');
    const tracked = log.trackedQuest;
    const key = language()+tracked+active.map((id) => `${id}:${log.status[id]}:${QUESTS[id].objectives.map((o) => log.value(o)).join('.')}`).join('|');
    if (key === this.key && !flashId) return;
    this.key = key;
    this.list.replaceChildren();
    this.el.style.display = active.length || this.kingdom.childElementCount ? '' : 'none';
    for (const id of active) {
      const def = QUESTS[id];
      const isNew = !this.seen.has(id);
      this.seen.add(id);
      const q = h('div', { class: `qt-q hud-i${isNew ? ' new' : ''}${tracked === id ? ' tracked' : ''}`, 'data-q': id }, h('div', { class: 'qt-title' }, `${tracked === id ? '◆ ' : ''}${def.title}`));
      if (log.status[id] === 'ready') {
        q.append(h('div', { class: 'qt-ready' }, def.readyHint));
      } else {
        for (const o of def.objectives) {
          const v = log.value(o);
          const done = v >= o.count;
          const line = o.count > 1 ? `${o.label}: ${v}/${o.count}` : o.label;
          q.append(h('div', { class: `qt-obj${done ? ' done' : ''}${flashId === o.id ? ' flash' : ''}` }, done ? line : `- ${line}`));
        }
      }
      this.list.append(q);
    }
  }

  /** Shows the active kingdom request's objectives, or the turn-in hint once they are met; null clears it. */
  setKingdom(entry: { title: string; lines: { text: string; done: boolean }[]; ready: string | null } | null): void {
    this.kingdom.replaceChildren();
    if (entry) {
      const q = h('div', { class: 'qt-q hud-i' }, h('div', { class: 'qt-title' }, `👑 ${entry.title}`));
      if (entry.ready) q.append(h('div', { class: 'qt-ready' }, entry.ready));
      else for (const l of entry.lines) q.append(h('div', { class: `qt-obj${l.done ? ' done' : ''}` }, l.done ? l.text : `- ${l.text}`));
      this.kingdom.append(q);
    }
    this.el.style.display = this.list.childElementCount || this.kingdom.childElementCount ? '' : 'none';
  }
}

export class QuestLogPanel {
  readonly el: HTMLElement;
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private selected: QuestId | null = null;
  open = false;

  constructor(private readonly game: Game) {
    this.listEl = h('div', { class: 'qlog-list' });
    this.detailEl = h('div', { class: 'qlog-detail cc-scroll' });
    this.el = h(
      'div',
      { class: 'qlog cc-parchment hud-i hidden' },
      this.listEl,
      this.detailEl,
      h('button', { class: 'dlg-x', onclick: () => this.toggle(false) }, 'X'),
    );
  }

  toggle(force?: boolean, select?: QuestId): void {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (select) this.selected = select;
    if (this.open) this.render();
    this.game.audio.sfx('sfx-click', { volume: 0.5 });
  }

  render(): void {
    const log = this.game.quests;
    const listScroll = this.listEl.scrollTop;
    const known = QUEST_ORDER.filter((id) => log.inChapter(id) && log.status[id] !== 'locked' && log.status[id] !== 'available');
    const offers = this.game.world2.chapter >= 2 ? QUEST_ORDER.filter(id => log.inChapter(id) && log.status[id] === 'available') : [];
    const visible = [...known, ...offers];
    if (!this.selected || !visible.includes(this.selected)) this.selected = log.trackedQuest ?? known.find((id) => log.status[id] !== 'done') ?? offers[0] ?? known[0] ?? null;
    this.listEl.replaceChildren(h('h3', null, t('퀘스트 기록','Quest Log')));
    if (!visible.length) this.listEl.append(h('div', { class: 'qlog-empty' }, this.game.world2.chapter>=2 ? t('별빛 마을 주민들의 머리 위 ! 표시를 찾아 F로 대화하세요.','Look for ! above the villagers and press F to talk.') : t('광장에 있는 브라인비어드 선장에게 말을 걸어 보세요.','No quests yet. Captain Brinebeard in the square looks like he needs help.')));
    for (const id of visible) {
      if (id === offers[0]) this.listEl.append(h('h4', {class:'qlog-offers-heading'}, `${t('주민들의 부탁','Villager requests')} · ${offers.length}`));
      const st = log.status[id];
      const label = st === 'available' ? t('! 수락 가능','! Available') : st === 'done' ? t('완료','Completed') : st === 'ready' ? t('보상 받기','Ready to turn in') : t('진행 중','In progress');
      const item = h('button', { type:'button', 'data-q':id, 'aria-pressed':String(id === this.selected), class: `qlog-item${id === this.selected ? ' sel' : ''}${st === 'done' ? ' done' : ''}` }, QUESTS[id].title, h('span', { class: 'st' }, label));
      item.addEventListener('click', () => {
        const focused = document.activeElement === item;
        this.selected = id;
        this.render();
        this.detailEl.scrollTop = 0;
        if (focused) this.listEl.querySelector<HTMLButtonElement>(`[data-q="${id}"]`)?.focus({preventScroll:true});
      });
      this.listEl.append(item);
    }
    // Selecting a quest redraws the list; keep its place in compact scrollable layouts.
    this.listEl.scrollTop = listScroll;
    this.detailEl.replaceChildren();
    if (!this.selected) return;
    const def = QUESTS[this.selected];
    const available = log.status[this.selected] === 'available';
    this.detailEl.append(h('h2', null, def.title));
    if (available) this.detailEl.append(h('div', {class:'qlog-giver'}, t(`부탁한 주민 · ${npcName(def.giver)}`,`Requested by · ${npcName(def.giver)}`)),h('p',{class:'qlog-offer-note'},t('아직 받지 않은 부탁이에요. 주민을 찾아가 F로 대화하면 퀘스트를 받을 수 있어요.','You have not accepted this request yet. Find the villager and press F to talk.')));
    this.detailEl.append(h('p', null, def.summary), h('div', { class: 'cc-divider' }), h('div', { class: 'dlg-sec' }, t('목표','Objectives')));
    const ul = h('ul', { class: 'dlg-obj' });
    for (const o of def.objectives) {
      const v = log.value(o);
      ul.append(h('li', null, o.count > 1 ? `${o.label}: ${v}/${o.count}` : `${o.label}${v >= o.count ? t(' (완료)',' (done)') : ''}`));
    }
    this.detailEl.append(ul);
    if (available || ['active', 'ready'].includes(log.status[this.selected])) {
      const tracked = log.trackedQuest === this.selected;
      const button = h('button', { class:'cc-btn qlog-track', 'aria-pressed':String(tracked), onclick:()=>{
        if (!this.selected || !log.track(this.selected)) return;
        this.game.hud.tracker.update(log);
        this.game.journey?.save();
        this.game.audio.sfx('sfx-click', {volume:.5});
        this.render();
      } }, available ? (tracked ? t('◆ 이 주민에게 길 안내 중','◆ Guiding to this villager') : t('◇ 이 주민에게 길 안내','◇ Find this villager')) : (tracked ? t('◆ 이 퀘스트 길 안내 중','◆ Tracking this quest') : t('◇ 이 퀘스트 길 안내','◇ Track this quest')));
      this.detailEl.append(button,h('p',{class:'qlog-track-hint'},available ? t('기록창을 닫으면 미니맵과 금빛 길잡이가 이 주민을 가리켜요. 가까이 가서 F를 누르세요.','Close the journal and follow the minimap and golden guide to this villager. Press F nearby.') : t('선택하면 미니맵과 금빛 길잡이가 이 목표를 가리켜요.','The minimap and golden guide will point to this quest.')));
    }
    if (log.status[this.selected] === 'ready') this.detailEl.append(h('p', { style: 'margin-top:10px;font-style:italic' }, def.readyHint));
    const memories = def.objectives.flatMap(o => {
      const memory = starMemory(o.kind);
      return memory ? [{ ...memory, found: log.objectiveDone(o) }] : [];
    });
    if (memories.length) {
      const found = memories.filter(memory => memory.found);
      const journal = h('section', { class:'qlog-memories', 'aria-label':t('발견한 기억','Discovered memories') },
        h('div', { class:'dlg-sec' }, `${t('발견한 기억','Discovered memories')} · ${found.length}/${memories.length}`));
      if (!found.length) journal.append(h('p', { class:'qlog-memory-hint' }, t('섬의 세 장소를 탐험하면 발견한 이야기가 여기에 남아요.','Explore the three island landmarks to keep their stories here.')));
      for (const memory of found) journal.append(h('article', { class:'qlog-memory' }, h('h3', null, memory.title), h('p', null, memory.body)));
      this.detailEl.append(journal);
    }
    if (!available) {
      this.detailEl.append(h('div', { class: 'dlg-sec' }, t('이야기','Story')));
      for (const para of def.offer) this.detailEl.append(h('p', null, para));
    }
    this.detailEl.append(h('div', { class: 'dlg-sec' }, t('보상','Reward')), h('div', { class: 'dlg-reward' }, h('span', { class: 'xp' }, `${def.xp} XP`)));
  }
}

export interface DialogueButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface DialoguePage {
  unit: Unit;
  portraitArt: string | null;
  questTitle?: string;
  questId?: QuestId;
  paragraphs: string[];
  objectives?: string[];
  rewardXp?: number;
  rewardCoins?: number;
  rewardItem?: string;
  buttons: DialogueButton[];
}

export class DialogueWindow {
  readonly el: HTMLElement;
  private pic: HTMLElement;
  private initial: HTMLElement;
  private nameEl: HTMLElement;
  private titleEl: HTMLElement;
  private body: HTMLElement;
  private textEl: HTMLElement;
  private buttonsEl: HTMLElement;
  private paras: { el: HTMLElement; text: string }[] = [];
  private shown = 0;
  private total = 0;
  private talkT = 0;
  unit: Unit | null = null;
  questId: QuestId | null = null;
  onClose: (() => void) | null = null;

  constructor(private readonly game: Game) {
    this.pic = h('div', { class: 'pic' });
    this.initial = h('div', { class: 'initial' });
    this.nameEl = h('div', { class: 'dlg-name' });
    this.titleEl = h('div', { class: 'dlg-title' });
    this.textEl = h('div', { class: 'dlg-text' });
    this.textEl.addEventListener('click', () => this.skipTyping());
    this.body = h('div', { class: 'dlg-body' });
    this.buttonsEl = h('div', { class: 'dlg-buttons' });
    this.el = h(
      'div',
      { class: 'dlg cc-parchment hud-i hidden' },
      h('div', { class: 'dlg-head' }, h('div', { class: 'dlg-portrait' }, this.initial, this.pic), h('div', null, this.nameEl, this.titleEl)),
      this.body,
      this.buttonsEl,
      h('button', { class: 'dlg-x', title: 'Close (Esc)', onclick: () => this.close() }, 'X'),
    );
  }

  get isOpen(): boolean {
    return !!this.unit;
  }

  get typing(): boolean {
    return this.shown < this.total;
  }

  /** The highlighted button (Accept, Complete Quest), or the only one (Goodbye). */
  choosePrimary(): void {
    const b = (this.buttonsEl.querySelector('.cc-btn:not(.ghost)') ?? this.buttonsEl.querySelector('.cc-btn')) as HTMLButtonElement | null;
    b?.click();
  }

  skipTyping(): void {
    this.shown = this.total;
    this.render();
  }

  open(p: DialoguePage): void {
    const u = p.unit;
    this.unit = u;
    this.questId = p.questId ?? null;
    this.el.classList.remove('hidden');
    // restart the slide-in
    this.el.style.animation = 'none';
    void this.el.offsetWidth;
    this.el.style.animation = '';
    this.initial.textContent = u.name.replace(/^(Captain|Lady|Sister|Mama|Old)\s+/, '').charAt(0);
    this.pic.className = 'pic';
    this.pic.setAttribute('style', portraitStyle(p.portraitArt, u.portrait));
    this.nameEl.textContent = u.name;
    this.titleEl.textContent = u.title ? `<${u.title}>` : '';
    this.body.replaceChildren();
    if (p.questTitle) this.body.append(h('div', { class: 'dlg-qtitle' }, p.questTitle));
    this.textEl.replaceChildren();
    this.paras = [];
    for (const t of p.paragraphs) {
      const el = h('p', { class: t.startsWith('(') ? 'em' : '' });
      this.textEl.append(el);
      this.paras.push({ el, text: t });
    }
    this.body.append(this.textEl);
    if (p.objectives?.length) {
      this.body.append(h('div', { class: 'dlg-sec' }, t('목표','Objectives')));
      const ul = h('ul', { class: 'dlg-obj' });
      for (const o of p.objectives) ul.append(h('li', null, o));
      this.body.append(ul);
    }
    if (p.rewardXp || p.rewardCoins || p.rewardItem) {
      this.body.append(h('div', { class: 'dlg-sec' }, t('보상','Rewards')));
      const r = h('div', { class: 'dlg-reward' });
      if (p.rewardCoins) r.append(h('span', { class: 'coins' }, t(`🪙 ${p.rewardCoins.toLocaleString()} 코인`, `🪙 ${p.rewardCoins.toLocaleString()} coins`)));
      if (p.rewardXp) r.append(h('span', { class: 'xp' }, `${p.rewardXp} XP`));
      if (p.rewardItem) r.append(h('span', { class: 'item' }, h('i'), p.rewardItem));
      this.body.append(r);
    }
    this.buttonsEl.replaceChildren();
    for (const b of p.buttons) {
      const btn = h('button', { class: `cc-btn small${b.primary ? '' : ' ghost'}`, 'data-action': b.label }, b.label);
      btn.addEventListener('click', () => {
        this.game.audio.sfx('sfx-click', { volume: 0.6 });
        b.onClick();
      });
      btn.addEventListener('mouseenter', () => this.game.audio.sfx('sfx-hover', { volume: 0.3 }));
      this.buttonsEl.append(btn);
    }
    this.total = this.paras.reduce((n, x) => n + x.text.length, 0);
    this.shown = 0;
    this.talkT = 0;
    this.render();
  }

  close(): void {
    if (!this.unit) return;
    const u = this.unit;
    this.unit = null;
    this.questId = null;
    this.el.classList.add('hidden');
    u.express('happy', 1);
    this.onClose?.();
  }

  update(dt: number): void {
    if (!this.unit) return;
    if (this.shown < this.total) {
      this.shown = Math.min(this.total, this.shown + dt * 62);
      this.render();
      this.talkT -= dt;
      if (this.talkT <= 0) {
        this.talkT = 0.3;
        this.unit.express('talk', 0.4);
      }
    }
  }

  private render(): void {
    let left = Math.floor(this.shown);
    for (const p of this.paras) {
      const n = Math.max(0, Math.min(p.text.length, left));
      left -= p.text.length;
      const txt = p.text.slice(0, n);
      if (p.el.textContent !== txt) {
        p.el.textContent = txt;
        if (n > 0 && n < p.text.length) p.el.append(h('span', { class: 'caret' }));
      }
    }
  }
}
