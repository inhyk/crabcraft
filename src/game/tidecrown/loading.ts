// Entering Tidecrown: the game start's loading painting (the same classes), shown above the zone line's black. The bar
// follows the real steps (the module import, the island's build steps by their `info.steps` names, the first frames):
// each step's share is its typical time, and within a step the bar runs toward the step's end over that time (scaled
// by how this machine has kept pace so far) as a CSS transition, which the compositor keeps moving while a step blocks
// the main thread.
import { t } from '../../i18n';
import { art, h } from '../../ui/dom';

const ART = 'art/loading-tidecrown.webp';
/** `open`: its time varies widely (the network, the GPU's shader cache), so the bar eases toward the step's end over
 * six times the typical time instead of running there in it. */
type Step = readonly [id: string, ms: number, ko: string, en: string, open?: boolean];
/** The first entry's steps in order, with their typical ms (medians of six runs of the production build). */
const STEPS: readonly Step[] = [
  ['import', 400, '타이드크라운으로 가는 중', 'Travelling to Tidecrown', true],
  ['layout', 1490, '거리와 성벽 자리 잡는 중', 'Laying out the streets and walls'],
  ['assets', 690, '석재와 지붕 실어 오는 중', 'Hauling stone and roof slates', true],
  ['terrain', 420, '언덕과 물가 다듬는 중', 'Shaping the hills and shores'],
  ['structures', 160, '성벽과 크라운셸 성 쌓는 중', 'Raising the walls and Crownshell Keep'],
  ['city', 340, '집과 항구 짓는 중', 'Building the houses and harbour'],
  ['foliage', 10, '숲과 풀밭 가꾸는 중', 'Growing the woods and meadows'],
  ['atmosphere', 25, '하늘과 바다 칠하는 중', 'Painting the sky and sea'],
  // The residents' crabs (tidecrownResidents.ts), first entry only.
  ['residents', 500, '주민들 맞이하는 중', 'Greeting the townsfolk', true],
  // The first frames: every material's shader compiles here (about 1 s; 7 s while the GPU's shader cache is cold).
  ['settle', 1000, '도시 풍경 그리는 중', 'Painting the city view', true],
];
/** Not this machine's pace but the network's. */
const FETCHED = new Set(['import', 'assets']);
const FADE_IN = 380, FADE_OUT = 450;
/** A re-entry takes well under a second: the painting stays this long from its start, so it never flashes. */
const MIN_SHOWN = 900;
/** The bar's last run, once every step is done and it is not yet full. */
const SWEEP = 100;

const tips = () => [
  t('크라운셸 성 꼭대기에서 청록빛 등불이 빛나요. 길을 잃으면 그 빛을 따라 성으로 가 보세요.', 'A teal lantern shines atop Crownshell Keep. Lost? Follow its light to the castle.'),
  t('여섯 껍질의 다리에는 여섯 종족마다 영웅 게 석상이 하나씩 서 있어요.', 'The Bridge of Six Shells has a hero crab statue for each of the six peoples.'),
  t('운하에는 곤돌라가 떠 있어요. 한 척은 큰 운하를 오가요.', 'Gondolas float on the canals, and one glides up and down the Grand Canal.'),
  t('왕관 항구에는 금빛 집게 선수상을 단 갈레온, 금빛집게호가 정박해 있어요.', 'The Goldclaw, a galleon with a gold claw figurehead, is moored in the Crown Harbour.'),
  t('숲길을 따라 남쪽으로 내려가면 왕의 길을 지나 클로헤이븐으로 가요.', 'Walk south down the forest road to take the King’s Road to Clawhaven.'),
  t('긴 부두의 아라 선장에게 말을 걸면 금빛집게호를 타고 다른 월드로 갈 수 있어요.', 'Talk to Captain Ara on the long pier to sail the Goldclaw to another world.'),
  t('바다유리 구역의 포탈로도 다른 월드에 갈 수 있어요.', 'The portal in the Seaglass Quarter leads to the other worlds too.'),
  t('모든 월드의 포탈 옆에 왕관 포탈이 있어요. 들어가면 이 항구로 와요.', 'Every world has a crown portal beside its own. Step in to come to this harbour.'),
];

export class TidecrownLoading {
  /** Resolves once the painting has faded in. */
  readonly shown: Promise<void>;
  private readonly el: HTMLElement;
  private readonly bar = h('i');
  private readonly label = h('div', { class: 'ld-label' });
  private readonly steps: readonly Step[];
  private readonly t0 = performance.now();
  private readonly done = new Set<string>();
  /** The step in progress, when it began, and the bar's current run (target and end time). */
  private at = -1;
  private began = this.t0;
  private target = 0;
  private ends = this.t0;
  /** Actual over typical time of the steps this machine has run so far. */
  private pace = 1;
  private spent = 0;
  private typical = 0;
  private gone = false;

  /** `first`: the island is built on this entry; a re-entry runs one short step. */
  constructor(parent: HTMLElement, first: boolean) {
    this.steps = first ? STEPS : [['enter', MIN_SHOWN, STEPS[0][2], STEPS[0][3]]];
    const list = tips(), artEl = h('div', { class: 'ld-art', style: `background-image:url("${art(ART)}");opacity:0;transition:opacity .3s ease` });
    // (starhaven: the wrapping subtitle every later world's painting uses.)
    this.el = h(
      'div',
      { class: 'loading starhaven tidecrown-loading', style: `z-index:2001;pointer-events:none;opacity:0;transition:opacity ${FADE_IN}ms ease;word-break:keep-all` },
      artEl,
      h('div', { class: 'ld-shade' }),
      // A re-entry is up under a second: the title and tip come with the screen, not risen in after it.
      h('div', { class: 'ld-zone', style: first ? undefined : 'animation:none' }, h('div', { class: 'ld-title cc-title' }, t('타이드크라운', 'Tidecrown')), h('div', { class: 'ld-sub' }, t('왕국의 수도  |  여섯 종족이 함께 세운 항구 도시', 'The capital  |  A harbour city the six peoples built together'))),
      h('div', { class: 'ld-foot' }, h('div', { class: 'ld-tip', style: first ? undefined : 'animation:none' }, h('span', { class: 'ld-tip-k' }, t('도움말', 'Tip')), list[Math.floor(Math.random() * list.length)]), h('div', { class: 'ld-bar' }, this.bar), this.label),
    );
    const probe = new Image();
    probe.onload = () => { artEl.style.opacity = '1'; this.el.dataset.art = 'loaded'; };
    probe.onerror = () => { this.el.classList.add('fallback'); artEl.style.opacity = '1'; this.el.dataset.art = 'fallback'; };
    probe.src = art(ART);
    parent.append(this.el);
    // Resolve the starting styles, so the fade and the bar's first run are transitions.
    void getComputedStyle(this.el).opacity;
    void getComputedStyle(this.bar).transform;
    this.el.style.opacity = '1';
    this.next();
    this.shown = new Promise((r) => setTimeout(r, FADE_IN));
  }

  /** Steps that have finished (the island's step names, 'import', 'settle'); a later one implies the ones before it. */
  reached(...ids: string[]): void {
    for (const id of ids) this.done.add(id);
    this.next();
  }

  /**
   * Resolves inside the `n`th next frame's callbacks. The bar's current run is on the compositor once the first of those
   * frames ends, so it keeps moving through a block that starts after it (in a later task, or a later frame).
   */
  frames(n: number): Promise<void> {
    return new Promise((r) => { const step = () => (--n > 0 ? requestAnimationFrame(step) : r()); requestAnimationFrame(step); });
  }

  /** Waits for the bar to be full (a re-entry's run ends at MIN_SHOWN, anything else within SWEEP), then the welcome. */
  async finish(): Promise<void> {
    const now = performance.now(), hold = this.t0 + MIN_SHOWN - now;
    if (hold <= 0) this.reached(...this.steps.map(([id]) => id));
    const left = Math.max(hold, this.ends - now, 0);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    // Exactly full as the painting goes, whether or not the run's last frame has landed.
    this.bar.style.transition = 'none';
    this.bar.style.transform = 'scaleX(1)';
    this.label.textContent = t('타이드크라운에 오신 걸 환영해요', 'Welcome to Tidecrown');
  }

  /** Fade out and go. */
  hide(): void {
    if (this.gone) return;
    this.gone = true;
    this.el.style.transition = `opacity ${FADE_OUT}ms ease`;
    this.el.style.opacity = '0';
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), FADE_OUT + 50);
  }

  /** Moves on past the last finished step: its label, and a run to its end over its typical time at this pace; past
   * the last step, a short run to full. */
  private next(): void {
    let i = this.steps.length;
    while (i > 0 && !this.done.has(this.steps[i - 1][0])) i--;
    if (i <= this.at) return;
    const now = performance.now(), passed = this.at < 0 ? [] : this.steps.slice(this.at, i);
    if (passed.length && !passed.some(([id]) => FETCHED.has(id))) {
      this.spent += now - this.began;
      this.typical += passed.reduce((s, [, ms]) => s + ms, 0);
      this.pace = Math.min(4, Math.max(0.4, this.spent / this.typical));
    }
    this.at = i;
    this.began = now;
    if (i >= this.steps.length) {
      if (this.target < 1 || this.ends - now > SWEEP) this.run(1, SWEEP);
      return;
    }
    const total = this.steps.reduce((s, [, ms]) => s + ms, 0), upTo = this.steps.slice(0, i + 1).reduce((s, [, ms]) => s + ms, 0);
    const [, ms, ko, en, open] = this.steps[i];
    this.label.textContent = t(ko, en);
    // An open step's curve is 55% of the way at the typical time and 92% at three times it.
    if (open) this.run(upTo / total, 6 * ms * this.pace, 'cubic-bezier(.15,.7,.3,1)');
    else this.run(upTo / total, ms * this.pace);
  }

  private run(f: number, ms: number, ease = 'linear'): void {
    this.target = f;
    this.ends = performance.now() + ms;
    this.bar.style.transition = `transform ${Math.round(ms)}ms ${ease}`;
    this.bar.style.transform = `scaleX(${f.toFixed(4)})`;
  }
}
