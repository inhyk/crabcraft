// First-time control hints: a small card at the first spawn with the five things a new crab needs.
// Each row ticks itself off when the player does it; the card leaves once everything is ticked,
// six seconds after all but one are, when it is closed, or after 46 s of play, and never comes back
// (cc.hintsSeen).
import { h } from '../dom';
import {t} from '../../i18n';
import { localStorageGet, localStorageSet } from '../../app';

export type HintStep = 'move' | 'look' | 'target' | 'ability' | 'interact';

const KEY = 'cc.hintsSeen';

const ROWS: { step: HintStep; keys: string[]; text: string }[] = [
  { step: 'move', keys: ['W', 'A', 'S', 'D'], text: 'Move. A and D scuttle sideways' },
  { step: 'look', keys: ['Right drag'], text: 'Look around and steer' },
  { step: 'target', keys: ['Tab'], text: 'Target the nearest enemy' },
  { step: 'ability', keys: ['1', '2', '3', '4'], text: 'Fight with your abilities' },
  { step: 'interact', keys: ['F'], text: 'Talk to crabs, hold at the beacon' },
];

export class ControlHints {
  readonly el: HTMLElement;
  private rows = new Map<HintStep, HTMLElement>();
  private done = new Set<HintStep>();
  private shownFor = 0;
  active = false;
  private chapter:1|2|3=1;

  constructor() {
    const list = h('div', { class: 'hints-list' });
    for (const r of ROWS) {
      const row = h('div', { class: 'hints-row' }, h('span', { class: 'hints-keys' }, ...r.keys.map((k) => h('kbd', null, k))), h('span', { class: 'hints-text' }, r.text));
      this.rows.set(r.step, row);
      list.append(row);
    }
    const close = h('button', { class: 'hints-x', title: 'Hide these hints', onclick: () => this.dismiss() }, 'X');
    this.el = h(
      'div',
      { class: 'hints hud-i' },
      h('div', { class: 'hints-head' }, 'Getting started'),
      close,
      list,
      h('div', { class: 'hints-foot' }, 'All controls are in the menu (Esc).'),
    );
    this.refreshLanguage();
  }

  setChapter(chapter:1|2|3):void{if(this.chapter!==chapter){this.chapter=chapter;this.refreshLanguage();}}

  refreshLanguage(): void {
    const texts=['이동하기 · Shift로 달리기 · A/D 옆걸음','주변을 보고 방향 조절하기','가장 가까운 적 선택하기','기술로 싸우기','게와 대화 · 등불 앞에서 길게 누르기'];
    for(const [i,r] of ROWS.entries()){
      const row=this.rows.get(r.step)!;
      row.querySelector('.hints-text')!.textContent=r.step==='interact'&&this.chapter===2?t('대화·수정 채집 · 등불 앞에서 길게 누르기','Talk, gather crystals; hold at waystones'):t(texts[i],r.text);
      if(r.step==='look')row.querySelector('kbd')!.textContent=t('우클릭 드래그','Right drag');
    }
    this.el.querySelector('.hints-head')!.textContent=t('처음 시작하기','Getting started');
    this.el.querySelector('.hints-foot')!.textContent=t('모든 조작 방법은 메뉴(Esc)에 있어요.','All controls are in the menu (Esc).');
    (this.el.querySelector('.hints-x') as HTMLElement).title=t('안내 닫기','Hide these hints');
  }

  /** Shows the card unless this player has already seen it. */
  start(): void {
    if (localStorageGet(KEY)) return;
    this.active = true;
    this.shownFor = 0;
    // Mount first, reveal a frame later so the slide-in transition plays.
    requestAnimationFrame(() => this.el.classList.add('on'));
  }

  mark(step: HintStep): void {
    if (!this.active || this.done.has(step)) return;
    this.done.add(step);
    this.rows.get(step)?.classList.add('done');
    if (this.done.size === ROWS.length) setTimeout(() => this.dismiss(), 1200);
    // Four of five is plenty: the last one usually never comes (keyboard players never right drag).
    else if (this.done.size === ROWS.length - 1) this.shownFor = Math.max(this.shownFor, 40);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.shownFor += dt;
    if (this.shownFor > 46) this.dismiss();
  }

  dismiss(): void {
    if (!this.active) return;
    this.active = false;
    localStorageSet(KEY, '1');
    this.el.classList.remove('on');
  }
}
