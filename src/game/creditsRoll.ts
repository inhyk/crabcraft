// Credits roll over the ending illustration. Third-party sources are read from NOTICE.md at build
// time so the credits stay accurate as other branches add rows.
import '../ui/hud/hud.css';
import * as THREE from 'three';
import notice from '../../NOTICE.md?raw';
import type { App } from '../app';
import { t } from '../i18n';
import { h, art } from '../ui/dom';
import { NPCS } from './quests';
import { RACES } from '../data/races';
import { BOSS_PROFILES } from './progression';

export interface NoticeRow {
  material: string;
  source: string;
  license: string;
  usedFor: string;
}

/** Rows of the first markdown table under "Third-party material" (or the first table found). */
export function parseNotice(md: string): NoticeRow[] {
  const lines = md.split(/\r?\n/);
  let start = lines.findIndex((l) => /third-party/i.test(l) && l.trim().startsWith('#'));
  if (start < 0) start = 0;
  const rows: NoticeRow[] = [];
  let header: string[] | null = null;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|')) {
      if (header && rows.length) break;
      continue;
    }
    const cells = l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => clean(c));
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
    const col = (re: RegExp, dflt: number) => {
      const i = header!.findIndex((x) => re.test(x));
      return cells[i >= 0 ? i : dflt] ?? '';
    };
    rows.push({ material: col(/material|asset|name/, 0), source: col(/source|url|author/, 1), license: col(/licen/, 2), usedFor: col(/used|purpose/, 3) });
  }
  return rows;
}

function clean(s: string): string {
  return s
    .trim()
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<[^>]+>/g, '');
}

export interface RollOptions {
  mode: 'ending' | 'credits';
  playerName?: string;
}

export class CreditsRoll {
  private root: HTMLElement;
  private track: HTMLElement;
  private endEl: HTMLElement;
  private raf = 0;
  private y = 0;
  private last = 0;
  private done = false;
  private keyHandler: (e: KeyboardEvent) => void;
  private speed = 36;

  constructor(app: App, opts: RollOptions) {
    // Nothing to render behind the opaque roll.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    app.engine.setView(scene, new THREE.PerspectiveCamera(), { vignette: null });

    const bg = h('div', { class: 'credits-bg', style: `background-image:url("${art('art/ending.webp')}")` });
    const probe = new Image();
    probe.onerror = () => bg.classList.add('fallback');
    probe.src = art('art/ending.webp');

    const rows = parseNotice(notice);
    const sec = (...c: (Node | string | null)[]) => h('section', null, ...c);
    const p = (text: string, cls = '') => h('p', { class: cls }, text);
    const logo = h('img', { src: art('art/logo.webp'), alt: 'World of Crabcraft', style: 'width:100%;max-width:520px', onerror: (e: Event) => ((e.target as HTMLElement).replaceWith(h('h1', { class: 'cc-title' }, 'World of Crabcraft'))) });

    this.track = h(
      'div',
      { class: 'credits-track' },
      sec(logo, p(t('여섯 껍질, 하나의 바다.', 'Six shells. One tide.'), 'em')),
      sec(h('h2', { class: 'cc-title' }, t('만든 사람들', 'Created by')),
        p('서인혁 · 서인근', 'who')),
      sec(
        h('h2', { class: 'cc-title' }, t('주인공', 'Starring')),
        h('div', { class: 'who' }, 'Jumper'),
        h('div', { class: 'role' }, t('KingKong Robotics의 오픈 소스 게 로봇', 'the open-source crab robot by KingKong Robotics')),
        p(t('선장부터 폭군까지, 클로헤이븐의 모든 게는 Jumper 로봇입니다. 껍질, 바이저, 집게와 걷는 다리는 Apache License 2.0으로 공개되어 있습니다.', 'Every crab in Clawhaven, from the Captain to the Tyrant, is the Jumper robot body: its shell, visor, claws and walking legs, released under the Apache License 2.0.')),
        h('span', { class: 'lic' }, 'Apache-2.0  |  Copyright 2026 KingKong Robotics'),
      ),
      sec(
        h('h2', { class: 'cc-title' }, t('진짜 로봇의 움직임', 'Real Robot Motion')),
        p(t('게들의 걸음, 인사와 춤은 Jumper의 학습된 동작을 MuJoCo에서 실행해 기록한 것입니다. 실제 로봇이 배우는 것과 같은 모델을 사용했습니다.', "Every walk, gesture and dance you saw is a recorded rollout of Jumper's trained policies, simulated in MuJoCo on the same model the physical robot learns on.")),
        p(t('로봇 모드는 브라우저에서 학습된 제어기를 직접 실행합니다. 마을에서 R을 누르거나 아래의 로봇 모드를 선택해 보세요.', 'Robot Mode runs those policies live in your browser. Press R in town or pick Robot Mode below to drive the real controller.'), 'em'),
      ),
      sec(
        h('h2', { class: 'cc-title' }, t('함께한 게들', 'The Cast')),
        ...NPCS.flatMap((n) => [h('div', { class: 'who' }, n.name), h('div', { class: 'role' }, `${t(({human:'인간',orc:'오크',dwarf:'드워프',undead:'언데드',nightelf:'나이트 엘프',tauren:'타우렌'})[n.race],RACES[n.race].name)}, ${n.title}`)]),
        h('div', { class: 'who' }, BOSS_PROFILES.rust.name),
        h('div', { class: 'role' }, t('거대한 갑옷을 입은 작은 빨간 게', 'a small red crab in very large armour')),
        h('div', { class: 'who' }, BOSS_PROFILES.abyss.name),
        h('div', { class: 'role' }, t('심해의 왕관을 지키던 두 번째 군주', 'the second sovereign, keeper of the Deep Crown')),
        h('div', { class: 'who' }, BOSS_PROFILES.eclipse.name),
        h('div', { class: 'role' }, t('잊힌 별의 섬에 빛을 돌려준 마지막 왕관', 'the final crown that returned light to the Isle of Forgotten Stars')),
        h('div', { class: 'who' }, t('작은 빨간 게', 'Little Red')),
        h('div', { class: 'role' }, t('마침내 되찾은 자기 모습', 'himself, finally')),
        h('div', { class: 'who' }, t('클로헤이븐과 별빛 항구의 주민들', 'The townsfolk of Clawhaven and Starhaven')),
        h('div', { class: 'role' }, t('인간, 오크, 드워프, 언데드, 나이트 엘프와 타우렌. 모두 게랍니다.', 'Humans, Orcs, Dwarves, Undead, Night Elves and Tauren, all of them crabs')),
        opts.playerName ? h('div', { class: 'who' }, opts.playerName) : null,
        opts.playerName ? h('div', { class: 'role' }, t('두 세계를 구한 세 왕관의 영웅', 'the hero of the three crowns who saved both worlds')) : null,
      ),
      sec(
        h('h2', { class: 'cc-title' }, t('외부 자료와 출처', 'Third-Party Sources')),
        ...(rows.length
          ? rows.flatMap((r) => [
              h('div', { class: 'who' }, r.material),
              r.usedFor ? h('div', { class: 'role' }, r.usedFor) : null,
              h('div', { class: 'src' }, r.source),
              h('div', { class: 'lic' }, r.license),
              h('div', { style: 'height:18px' }),
            ])
          : [p(t('출처는 NOTICE.md를 확인해 주세요.', 'See NOTICE.md'))]),
      ),
      sec(
        h('h2', { class: 'cc-title' }, t('제작 배경', 'Made For')),
        p(t('2026 게 로봇 오픈 소스 챌린지', 'The Crab Robot Open-source Challenge 2026')),
        p(t('World of Crabcraft는 Apache License 2.0의 오픈 소스 게임입니다. three.js로 브라우저에서 구현했습니다.', 'World of Crabcraft is open source under the Apache License 2.0. Built in the browser with three.js.')),
      ),
      sec(h('h1', { class: 'cc-title' }, opts.mode==='ending' ? t('진짜 엔딩 · 세 왕관의 전설', 'TRUE ENDING · Legend of the Three Crowns') : t('함께해 주셔서 고마워요', 'Thank you for playing')), p(t('바다는 평온하고, 두 세계에 빛이 돌아왔습니다. 게들의 춤은 계속됩니다.', 'The tide is calm. Light returns to both worlds. The crabs are still dancing.'), 'em')),
    );

    const btn = (label: string, fn: () => void, ghost = false) => {
      const b = h('button', { class: `cc-btn${ghost ? ' ghost' : ''}` }, label);
      b.addEventListener('click', () => {
        app.audio.sfx('sfx-click');
        fn();
      });
      b.addEventListener('mouseenter', () => app.audio.sfx('sfx-hover', { volume: 0.4 }));
      return b;
    };
    this.endEl = h(
      'div',
      { class: 'credits-end' },
      opts.mode === 'ending' ? btn(t('계속 모험하기', 'Continue Adventure'), () => void app.go('game')) : null,
      btn(t('로봇 모드', 'Robot Mode'), () => void app.go('robot'), opts.mode === 'ending'),
      btn(t('처음 화면', 'Title'), () => void app.go('title'), true),
    );
    const thanks =
      opts.mode === 'ending'
        ? h(
            'div',
            { class: 'credits-thanks' },
            h('div', { class: 'cc-title' }, t('두 세계에 돌아온 빛', 'Light Returns to Both Worlds')),
            h('p', null, t(`${opts.playerName || '영웅'}님, 두 세계를 구했어요. 클로헤이븐의 등대와 잊힌 별의 섬이 다시 빛납니다. 별빛 항구의 친구들이 다음 모험을 기다리고 있어요.`, `${opts.playerName || 'Hero'}, you saved both worlds. Clawhaven’s lighthouse and the Isle of Forgotten Stars shine again. Your friends in Starhaven await your next adventure.`)),
          )
        : h('div', { class: 'credits-thanks' }, h('div', { class: 'cc-title' }, t('만든 사람들', 'Credits')));
    this.root = h(
      'div',
      { class: 'credits cc-fade' },
      bg,
      h('div', { class: 'credits-shade' }),
      thanks,
      h('div', { class: 'credits-roll' }, this.track),
      this.endEl,
      h('div', { class: 'credits-skip' }, t('스페이스 키로 건너뛰기', 'Space to skip')),
    );
    this.root.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) this.speed = this.speed === 36 ? 140 : 36;
    });
    this.keyHandler = (e) => {
      if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        this.finish();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.onResize);
    app.ui.append(this.root);
    setTimeout(() => this.endEl.classList.add('on'), opts.mode === 'credits' ? 1200 : 9000);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.done) {
      this.y += dt * this.speed;
      const max = this.endY();
      if (this.y >= max) this.finish();
      else this.track.style.transform = `translateY(${-this.y}px)`;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Scroll offset that centres the last card in the roll. */
  private endY(): number {
    const roll = this.track.parentElement!.clientHeight;
    const lastSec = this.track.lastElementChild as HTMLElement | null;
    return lastSec ? lastSec.offsetTop + lastSec.offsetHeight / 2 + roll * 0.5 : this.track.scrollHeight;
  }

  /** Jump to the end: last card visible, buttons up. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.track.style.transition = 'transform 1.2s ease';
    this.track.style.transform = `translateY(${-this.endY()}px)`;
    this.endEl.classList.add('on');
  }

  private readonly onResize = (): void => {
    // Wrapping changes the final card's offset after the roll has stopped.
    if (this.done) this.track.style.transform = `translateY(${-this.endY()}px)`;
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
