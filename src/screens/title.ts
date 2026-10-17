// Title screen: painted key art, logo, main menu.
import type { App, Screen } from '../app';
import { h, art } from '../ui/dom';
import {t} from '../i18n';
import './title.css';

export default class TitleScreen implements Screen {
  private root: HTMLElement | null = null;

  enter(app: App): void {
    const play = () => void app.audio.playMusic('music-title');
    const btn = (label: string, onClick: () => void, cls = 'cc-btn') =>
      h('button', { class: cls, onclick: () => { app.audio.sfx('sfx-click'); onClick(); }, onmouseenter: () => app.audio.sfx('sfx-hover', { volume: 0.4 }) }, label);

    this.root = h(
      'div',
      { class: 'title-screen cc-fade', onpointerdown: play },
      h('div', { class: 'title-bg', style: `background-image: url("${art('art/title-bg.webp')}")` }),
      h('div', { class: 'title-rays cc-passive' }),
      h('div', { class: 'title-shade cc-passive' }),
      h('div', { class: 'title-logo-wrap' },
        h('img', { class: 'title-logo', src: art('art/logo.webp'), alt: 'World of Crabcraft', onerror: (e: Event) => ((e.target as HTMLElement).style.display = 'none') }),
        h('h1', { class: 'cc-title title-fallback' }, 'World of Crabcraft'),
      ),
      h('nav', { class: 'title-menu' },
        btn(app.account.label,()=>app.account.show(),'cc-btn ghost'),
        btn(t('새 모험 시작','Enter World'), () => void app.go('create')),
        app.spec ? btn(t(`${app.spec.name || '내 게'}로 이어하기`,`Continue as ${app.spec.name || 'your crab'}`), () => void app.go('game'), 'cc-btn ghost') : null,
        btn(t('멀티플레이','Multiplayer'), () => {
          const url = new URL(location.href);
          url.searchParams.set('multiplayer', '1');
          history.replaceState(null, '', url);
          void app.go(app.spec ? 'game' : 'create');
        }, 'cc-btn ghost'),
        btn(t('로봇 모드','Robot Mode'), () => void app.go('robot'), 'cc-btn ghost'),
        btn(t('만든 사람들','Credits'), () => void app.go('credits'), 'cc-btn ghost'),
      ),
      h('footer', { class: 'title-footer cc-passive' },
        h('div', null, t('이 세계의 모든 게는 점퍼 로봇이에요. 걷기와 인사, 춤은 실제 로봇 동작 정책으로 만들어졌어요.','Every crab in this world is a Jumper robot. Every walk, wave and dance is a real policy rollout.')),
        h('div', { class: 'cc-small' }, 'Crab Robot Open-source Challenge 2026 | Apache-2.0'),
      ),
    );
    app.ui.append(this.root);
    // If the browser already allows audio (returning visitor), start the music right away.
    if (app.audio.ctx.state === 'running') play();
  }

  exit(): void {
    this.root?.remove();
  }
}
