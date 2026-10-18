// Title screen: painted key art, logo, main menu.
import type { App, Screen } from '../app';
import { h, art } from '../ui/dom';
import {t} from '../i18n';
import { openVideos } from '../ui/videos';
import { buildInfo, versionLabel } from '../version';
import { hasUnseenNews, loadNews, openNews } from '../ui/news';
import './title.css';

export default class TitleScreen implements Screen {
  private root: HTMLElement | null = null;

  enter(app: App): void {
    const play = () => void app.audio.playMusic('music-title');
    const btn = (label: string, onClick: () => void, cls = 'cc-btn') =>
      h('button', { class: cls, onclick: () => { app.audio.sfx('sfx-click'); onClick(); }, onmouseenter: () => app.audio.sfx('sfx-hover', { volume: 0.4 }) }, label);
    // Next to the version: shown once public/release-notes.json has a note; a dot marks a version
    // not opened on this device yet.
    const news = h('button', { type: 'button', class: 'title-news', hidden: true, onclick: () => { app.audio.sfx('sfx-click'); void loadNews().then((list) => { openNews(list); news.classList.remove('news-unseen'); }); } }, t('업데이트 소식', 'Update news'));
    void loadNews().then((list) => { news.hidden = !list.length; news.classList.toggle('news-unseen', hasUnseenNews(list)); });

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
        // The world is always online: entering takes the saved crab in, or makes one first.
        btn(t('입장하기','Enter World'), () => void app.go(app.spec ? 'game' : 'create')),
        app.spec ? btn(t('새 캐릭터 만들기','New character'), () => void app.go('create'), 'cc-btn ghost') : null,
        btn(t('로봇 모드','Robot Mode'), () => void app.go('robot'), 'cc-btn ghost'),
        btn(t('영상','Videos'), () => openVideos(app.audio), 'cc-btn ghost'),
        btn(t('만든 사람들','Credits'), () => void app.go('credits'), 'cc-btn ghost'),
      ),
      h('footer', { class: 'title-footer cc-passive' },
        h('div', null, t('이 세계의 모든 게는 점퍼 로봇이에요. 걷기와 인사, 춤은 실제 로봇 동작 정책으로 만들어졌어요.','Every crab in this world is a Jumper robot. Every walk, wave and dance is a real policy rollout.')),
        h('div', { class: 'cc-small' }, 'Crab Robot Open-source Challenge 2026 | Apache-2.0'),
        h('div', { class: 'cc-small title-version', 'data-env': buildInfo.env }, versionLabel(), news),
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
