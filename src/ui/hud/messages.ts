// Centre-screen text (red errors, yellow quest progress, orange boss warnings, big banners) and the
// chat log in the bottom-left corner.
import { h } from '../dom';
import {t} from '../../i18n';

type BannerText = string | (() => string);
const bannerText = (copy: BannerText): string => typeof copy === 'function' ? copy() : copy;

export class Messages {
  readonly el: HTMLElement;
  private errors: HTMLElement;
  private warnEl: HTMLElement;
  private bannerEl: HTMLElement;
  private discoveryEl: HTMLElement;
  private bannerCopy: {el:HTMLElement;bigEl:HTMLElement;subEl:HTMLElement;big:BannerText;sub:BannerText} | null = null;
  private discoveryCopy: (() => {title:string;body:string} | null) | null = null;
  private discoveryTimer = 0;
  private lastError = '';
  private lastErrorAt = 0;

  constructor() {
    this.errors = h('div', { class: 'msg-errors' });
    this.warnEl = h('div', { class: 'msg-warn' });
    this.bannerEl = h('div');
    this.discoveryEl = h('section', {class:'memory-discovery',hidden:true,role:'status','aria-live':'polite','aria-atomic':'true'});
    this.el = h('div', { class: 'messages hud-keep', style: 'position:absolute;inset:0;pointer-events:none' }, this.bannerEl, this.errors, this.warnEl, this.discoveryEl);
  }

  private push(el: HTMLElement, ms: number): void {
    this.errors.append(el);
    while (this.errors.children.length > 3) this.errors.firstElementChild?.remove();
    setTimeout(() => el.remove(), ms);
  }

  error(text: string): void {
    const now = performance.now();
    if (text === this.lastError && now - this.lastErrorAt < 600) return;
    this.lastError = text;
    this.lastErrorAt = now;
    this.push(h('div', { class: 'cc-error' }, text), 1700);
  }

  info(text: string): void {
    this.push(h('div', { class: 'info' }, text), 2500);
  }

  warn(text: string, options: {persistent?:boolean} = {}): HTMLElement {
    const notice=h('div',{class:options.persistent?'mechanic-warning':''},text);
    this.warnEl.replaceChildren(notice);
    this.el.classList.add('combat-warning');
    // General announcements expire with their animation. Mechanics follow the simulation clock,
    // so a paused solo game cannot lose its instruction before the attack actually happens.
    if(!options.persistent)notice.addEventListener('animationend',()=>this.clearWarning(notice),{once:true});
    return notice;
  }

  clearWarning(notice?:HTMLElement):void {
    // An old encounter/animation must not erase a newer warning.
    if(notice&&this.warnEl.firstElementChild!==notice)return;
    this.warnEl.replaceChildren();this.el.classList.remove('combat-warning');
  }

  /** Longer discoveries get their own reading card, so quest-ready banners cannot replace them. */
  discovery(copy: () => {title:string;body:string} | null): void {
    this.discoveryCopy = copy;
    this.renderDiscovery();
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = window.setTimeout(() => this.closeDiscovery(), 12000);
  }

  private renderDiscovery(): void {
    const copy = this.discoveryCopy?.();
    if (!copy) return;
    this.discoveryEl.replaceChildren(
      h('div', {class:'memory-heading'},
        h('span', null, t('✧ 잊힌 섬의 기억','✧ Memories of the island')),
        h('button', {type:'button',class:'memory-close','aria-label':t('발견한 이야기 닫기','Close discovery'),title:t('닫기 · Esc','Close · Esc'),onclick:()=>this.closeDiscovery()}, '×')),
      h('h2', {class:'memory-title cc-title'}, copy.title),
      h('p', {class:'memory-body'}, copy.body),
    );
    this.discoveryEl.hidden = false;
    this.el.classList.add('discovering');
  }

  closeDiscovery(): boolean {
    const wasOpen = !this.discoveryEl.hidden;
    clearTimeout(this.discoveryTimer);
    this.discoveryCopy = null;
    this.discoveryEl.hidden = true;
    this.el.classList.remove('discovering');
    return wasOpen;
  }

  refreshLanguage(): void { this.renderDiscovery(); this.renderBanner(); }
  dispose(): void { this.closeDiscovery(); this.bannerCopy = null; this.bannerEl.replaceChildren(); }

  /** Big gold text mid-screen: zone names, quest accepted/completed, level up. */
  banner(big: BannerText, sub: BannerText, kind: 'zone' | 'quest' | 'level' | 'boss' = 'quest'): void {
    const bigEl = h('div', {class:'big cc-title'});
    const subEl = h('div', {class:'sub'});
    const el = h('div', {class:`cc-banner ${kind}`}, bigEl,
      kind === 'zone' ? h('div', {class:'rule'}) : null, subEl);
    this.bannerEl.replaceChildren(el);
    this.bannerCopy = {el,bigEl,subEl,big,sub};
    this.renderBanner();
    // Keep the original animation and expiry when Settings changes language.
    setTimeout(() => {
      el.remove();
      if (this.bannerCopy?.el === el) this.bannerCopy = null;
    }, 4300);
  }

  private renderBanner(): void {
    const copy = this.bannerCopy;
    if (!copy) return;
    copy.bigEl.textContent = bannerText(copy.big);
    const sub = bannerText(copy.sub);
    copy.subEl.textContent = sub;
    copy.subEl.hidden = !sub;
  }

}

export class ChatLog {
  readonly el: HTMLElement;
  private idleTimer = 0;

  constructor() {
    this.el = h('div', { class: 'chat hud-i' });
  }

  private add(cls: string, ...parts: (string | Node)[]): void {
    this.el.append(h('div', { class: `line ${cls}` }, ...parts));
    while (this.el.children.length > 9) this.el.firstElementChild?.remove();
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.el.classList.add('idle'), 12000);
  }

  system(text: string): void {
    this.add('sys', text);
  }
  loot(text: string): void {
    this.add('loot', text);
  }
  quest(text: string): void {
    this.add('quest', text);
  }
  say(name: string, text: string): void {
    this.add('say', h('b', null, t(`${name}: `,`${name} says: `)), text);
  }
  yell(name: string, text: string): void {
    this.add('yell', h('b', null, t(`${name}의 외침: `,`${name} yells: `)), text);
  }
  whisper(name: string, text: string): void {
    this.add('whisper', t(`${name}의 귓속말: ${text}`,`${name} whispers: ${text}`));
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
  }
}
