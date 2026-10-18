import './monitor.css';
import { h } from '../ui/dom';
import { COAST } from '../world/layout';
import type { MonitorPlayer, MonitorSnapshot } from '../../server/monitor';
import type { Views } from './views';

const WORLD_NAMES = ['위치 확인 중', '클로헤이븐', '별빛 항구', '새벽의 섬', '서리빛 설원', '잿불 군도', '하늘숲'];
const host = location.hostname;
const environment = host === 'crab-dev.seonn.dev' ? 'DEV' : host === 'crab.seonn.dev' ? 'MAIN' : 'LOCAL';
const root = document.getElementById('monitor')!;
const connection = h('span', { class: 'connection', role: 'status' }, '연결 중');
const total = h('strong', null, '0');
const updated = h('span', { class: 'updated' }, '--:--:--');
const notice = h('div', { class: 'notice', role: 'status', hidden: true });
const search = h('input', { type: 'search', placeholder: '이름 또는 방', 'aria-label': '유저 이름 또는 방 검색' });
const pause = h('button', { type: 'button', 'aria-pressed': 'false' }, '일시정지');
const retry = h('button', { type: 'button' }, '다시 연결');
// One wall of feeds, like a CCTV desk: every world on one screen, cells touching, no section headings.
const wall = h('main', { class: 'wall', id: 'wall' });
const empty = h('div', { class: 'wall-empty' }, '접속 중인 유저가 없습니다');
root.append(
  h('header', { class: 'bar' },
    h('span', { class: 'brand' }, 'CRABCRAFT MONITOR'),
    h('span', { class: `environment ${environment.toLowerCase()}` }, environment),
    h('span', { class: 'count' }, '접속 ', total, '명'), connection,
    h('span', { class: 'spacer' }), search, pause, updated),
  h('div', { class: 'stage' }, wall, empty, notice));

/** A live spectator view: the real game, invisible in the player's room, following them (src/spectate.ts). */
type Feed = { frame: HTMLIFrameElement; room: string; follow: string; live: boolean };
/** `gone`: when the player left the snapshot (0 while present). */
type Card = { root: HTMLElement; canvas: HTMLCanvasElement; mini: HTMLCanvasElement; message: HTMLElement; name: HTMLElement; meta: HTMLElement; world: HTMLElement; health: HTMLElement; status: HTMLElement; number: HTMLElement; feed: Feed | null; gone: number };
const cards = new Map<string, Card>();
/** Each live view is a whole game, so a TV runs only a few: the expanded tile first, then the wall in order.
 * The rest keep the light renderer (./views). `?live=0` turns live views off. */
const LIVE = (() => { const n = Number(new URLSearchParams(location.search).get('live') ?? 4); return Number.isInteger(n) && n >= 0 ? Math.min(n, 16) : 4; })();
/** Travel reconnects, so a traveller comes back under a new id: its tile and live view wait this long for its name. */
const TRAVEL_MS = 8000;
let snapshot: MonitorSnapshot | null = null, views: Views | null = null, viewsLoading = false;
let timer = 0, busy = false, paused = false, disposed = false, fresh = false, generation = 0;
let receipt = 0, retryDelay = 500;
let terminal = false;

function expand(el: HTMLElement | null) {
  for (const c of cards.values()) { c.root.classList.toggle('expanded', c.root === el); c.root.setAttribute('aria-expanded', String(c.root === el)); }
  render();
}

function makeCard(p: MonitorPlayer): Card {
  const canvas = h('canvas', { width: 480, height: 270, 'aria-label': `${p.spec.name} 관전 화면` });
  const mini = h('canvas', { class: 'mini', width: 176, height: 132, 'aria-hidden': 'true' });
  const message = h('span', { class: 'view-message' }, '관전 화면 준비 중');
  const name = h('strong'), meta = h('span', { class: 'player-meta' }), world = h('span', { class: 'osd-world' });
  const number = h('span', { class: 'cam' }), health = h('span', { class: 'health-fill' }), status = h('span', { class: 'player-status' });
  // Not a <button>: a live view is an iframe, which a button may not contain.
  const el = h('div', { class: 'tile', id: `player-${p.id}`, role: 'button', tabindex: 0, 'aria-expanded': 'false' },
    canvas, message, mini,
    h('span', { class: 'osd top' }, number, world, status),
    h('span', { class: 'osd bottom' }, name, meta),
    h('span', { class: 'health', 'aria-label': '체력' }, health));
  const toggle = () => expand(el.classList.contains('expanded') ? null : el);
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  return { root: el, canvas, mini, message, name, meta, world, health, status, number, feed: null, gone: 0 };
}

const retarget = (feed: Feed, area: number | null) =>
  feed.frame.contentWindow?.postMessage({ type: 'cc-spectate', observe: feed.room, follow: feed.follow, area: area ?? 1 }, location.origin);

/** Live views for the expanded tile and the first tiles of the wall; a moved player's view follows into the new room. */
function syncFeeds(players: MonitorPlayer[], ids: string[]) {
  const byId = new Map(players.map(p => [p.id, p]));
  const followable = (id: string) => { const p = byId.get(id); return !!p?.state && !!p.area; };
  const expanded = ids.find(id => cards.get(id)?.root.classList.contains('expanded'));
  const wanted = new Set(paused || terminal ? [] : [...new Set([...(expanded ? [expanded] : []), ...ids])].filter(followable).slice(0, LIVE));
  for (const [id, card] of cards) {
    const p = byId.get(id);
    if (card.gone) continue;
    if (!wanted.has(id) || !p) {
      if (card.feed) { card.feed.frame.remove(); card.feed = null; card.root.classList.remove('live-feed'); }
      continue;
    }
    if (!card.feed) {
      const frame = h('iframe', { class: 'feed', title: `${p.spec.name} 실시간 관전`, tabindex: -1, 'aria-hidden': 'true',
        src: `/?${new URLSearchParams({ observe: p.room, follow: p.id, area: String(p.area) })}` });
      card.canvas.after(frame);
      card.feed = { frame, room: p.room, follow: p.id, live: false };
    } else if (card.feed.room !== p.room || card.feed.follow !== p.id) {
      card.feed.room = p.room; card.feed.follow = p.id; card.feed.live = false; card.root.classList.remove('live-feed');
      retarget(card.feed, p.area);
    }
  }
}

/** The corner map of a feed: its world, everyone online there, this player in gold. */
function drawMini(area: number, canvas: HTMLCanvasElement, players: MonitorPlayer[], self: string) {
  const W = canvas.width, H = canvas.height, pad = 8;
  const bounds = area === 1 ? [-230, 270, -250, 250] : [-150, 150, -175, 175];
  for (const p of players) if (p.state) {
    bounds[0] = Math.min(bounds[0], p.state.x - 20); bounds[1] = Math.max(bounds[1], p.state.x + 20);
    bounds[2] = Math.min(bounds[2], p.state.z - 20); bounds[3] = Math.max(bounds[3], p.state.z + 20);
  }
  const scale = Math.min((W - pad * 2) / (bounds[1] - bounds[0]), (H - pad * 2) / (bounds[3] - bounds[2]));
  const ox = (W - (bounds[1] - bounds[0]) * scale) / 2, oz = (H - (bounds[3] - bounds[2]) * scale) / 2;
  const xy = (x: number, z: number) => [ox + (x - bounds[0]) * scale, oz + (z - bounds[2]) * scale];
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b1215cc'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f322c'; ctx.strokeStyle = '#5b7a6f'; ctx.lineWidth = 1; ctx.beginPath();
  if (area === 1) COAST.forEach(([x, z], i) => { const [px, py] = xy(x, z); if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  else {
    const [cx, cy] = xy(0, 0), [ex, ey] = xy(110, 140);
    ctx.ellipse(cx, cy, ex - cx, ey - cy, 0, 0, Math.PI * 2);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const p of [...players].sort(a => a.id === self ? 1 : -1)) {
    if (!p.state) continue;
    const [x, y] = xy(p.state.x, p.state.z), me = p.id === self;
    ctx.fillStyle = me ? '#ffd166' : '#8fdcbc'; ctx.beginPath(); ctx.arc(x, y, me ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
    if (me) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
}

/** Columns that make the largest 16:9 picture when every cell must fit on one screen. */
function layout(count: number) {
  const width = wall.clientWidth, height = wall.clientHeight;
  if (!count || !width || !height) return;
  let best = 1, bestArea = 0;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns), side = Math.min(width / columns, height / rows * 16 / 9);
    if (side > bestArea + .5) { bestArea = side; best = columns; }
  }
  wall.style.gridTemplateColumns = `repeat(${best}, minmax(0, 1fr))`;
  wall.style.gridTemplateRows = `repeat(${Math.ceil(count / best)}, minmax(0, 1fr))`;
}

function render() {
  if (!snapshot) return;
  const players = [...snapshot.players].sort((a, b) => (a.area || 99) - (b.area || 99) || a.room.localeCompare(b.room) || a.spec.name.localeCompare(b.spec.name) || a.id.localeCompare(b.id));
  const ids = new Set(players.map(p => p.id)), numbers = new Map(players.map((p, i) => [p.id, i + 1])), now = Date.now();
  for (const [id, card] of cards) if (!ids.has(id)) {
    card.gone ||= now;
    if (!card.feed || now - card.gone > TRAVEL_MS) { card.root.remove(); cards.delete(id); }
  }
  total.textContent = String(players.length);
  const term = search.value.trim().toLocaleLowerCase();
  const byWorld = new Map<number, MonitorPlayer[]>();
  for (const p of players) if (p.area) byWorld.set(p.area, [...(byWorld.get(p.area) ?? []), p]);
  const order: HTMLElement[] = [], wallIds: string[] = [];
  for (const p of players) {
    const world = p.area ?? 0;
    let card = cards.get(p.id);
    // Online names are unique, so a waiting tile with this name is this player back from travel.
    const back = card ? undefined : [...cards].find(([, c]) => c.gone && c.name.textContent === p.spec.name);
    if (back) { cards.delete(back[0]); card = back[1]; card.gone = 0; card.root.id = `player-${p.id}`; cards.set(p.id, card); }
    if (!card) { card = makeCard(p); cards.set(p.id, card); }
    const shown = `${p.spec.name} ${p.room}`.toLocaleLowerCase().includes(term);
    card.root.hidden = !shown;
    if (shown) { order.push(card.root); wallIds.push(p.id); }
    card.name.textContent = p.spec.name;
    card.number.textContent = `CAM ${String(numbers.get(p.id)).padStart(2, '0')}`;
    card.world.textContent = WORLD_NAMES[world] ?? WORLD_NAMES[0];
    const s = p.state, stale = !p.updatedAt || snapshot.at - p.updatedAt > 5000;
    card.status.textContent = !s ? 'NO SIGNAL' : stale ? '지연' : s.alive ? 'LIVE' : '사망';
    card.root.classList.toggle('stale', stale);
    card.root.classList.toggle('no-signal', !s);
    card.meta.textContent = `${p.public ? '공개' : '비공개'} ${p.room}${s ? ` · Lv.${s.level ?? 1} · ${Math.round(s.x)}, ${Math.round(s.z)}` : ''}`;
    card.health.style.width = `${s ? Math.max(0, Math.min(100, s.hp / s.maxHp * 100)) : 0}%`;
    card.health.parentElement!.setAttribute('aria-label', s ? `체력 ${Math.round(s.hp)} / ${Math.round(s.maxHp)}` : '체력 수신 대기');
    card.root.setAttribute('aria-label', `${p.spec.name} 관전 화면 크게 보기`);
    card.mini.hidden = !s || !world;
    if (s && world) drawMini(world, card.mini, byWorld.get(world) ?? [], p.id);
  }
  for (const card of cards.values()) if (card.gone) { card.status.textContent = '이동 중'; if (!card.root.hidden) order.push(card.root); }
  // Order by CSS, never by moving nodes: a moved iframe reloads its whole game.
  order.forEach((el, i) => { el.style.order = String(i); if (el.parentElement !== wall) wall.append(el); });
  for (const el of [...wall.children]) if (!order.includes(el as HTMLElement)) el.remove();
  empty.hidden = order.length > 0;
  empty.textContent = players.length ? '검색 조건에 맞는 유저가 없습니다' : '접속 중인 유저가 없습니다';
  layout(order.length);
  syncFeeds(players, wallIds);
  // A tile showing its live view needs no light rendering.
  const tiles = new Map([...cards].filter(([, c]) => !c.root.hidden && !c.feed?.live).map(([id, c]) => [id, { canvas: c.canvas, message: c.message }]));
  views?.sync(players, tiles, snapshot.at);
  if (players.length && !views && !viewsLoading) {
    viewsLoading = true;
    void import('./views').then(({ Views }) => {
      if (disposed) return;
      views = new Views(); views.paused = paused || !fresh; render();
    }).catch(() => { for (const c of cards.values()) c.message.textContent = '3D 화면을 사용할 수 없습니다. WebGL을 확인해 주세요.'; });
  }
}

function showError(code: string, status: number) {
  fresh = false;
  connection.textContent = '연결 끊김'; connection.dataset.state = 'error';
  if (views) views.paused = true;
  const messages: Record<string, string> = {
    signin: '개발자 계정으로 로그인해 주세요.',
    monitor_forbidden: '이 계정에는 모니터 접근 권한이 없습니다.',
    monitor_unconfigured: '개발자 모니터가 아직 활성화되지 않았습니다.',
    origin: '이 주소에서는 모니터에 접근할 수 없습니다.',
  };
  notice.hidden = false;
  notice.replaceChildren(h('strong', null, messages[code] ?? '서버 연결이 끊겼습니다. 마지막으로 받은 화면을 표시합니다.'), retry);
  if (status === 401 || status === 403 || code === 'monitor_unconfigured') {
    terminal = true;
    snapshot = null; views?.clear(); cards.clear(); wall.replaceChildren(); total.textContent = '0';
    empty.hidden = false; empty.textContent = '접근 권한 확인 필요';
  }
  if (status === 401) notice.append(h('a', { class: 'signin', href: '/api/account/google/start?return=%2Fmonitor%2F' }, 'Google로 로그인'));
}

async function poll() {
  if (disposed || busy || paused || document.hidden) return;
  clearTimeout(timer); busy = true; terminal = false;
  const current = generation;
  try {
    const res = await fetch('/api/account/monitor', { headers: { 'X-Crabcraft-Account': '1' }, cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (disposed || current !== generation || paused) return;
    if (!res.ok) {
      showError(data.error ?? 'unavailable', res.status);
      retryDelay = res.status === 401 || res.status === 403 || data.error === 'monitor_unconfigured' ? 10000 : 3000;
    } else {
      // Positions arrive every 200 ms; views.ts moves each feed smoothly between them.
      snapshot = data as MonitorSnapshot; receipt = Date.now(); fresh = true; retryDelay = 200;
      connection.textContent = '실시간'; connection.dataset.state = 'live'; notice.hidden = true;
      updated.textContent = new Date(receipt).toLocaleTimeString('ko-KR', { hour12: false });
      if (views) views.paused = false;
      render();
    }
  } catch {
    if (!disposed && current === generation) { showError('unavailable', 0); retryDelay = Math.min(10000, Math.max(1000, retryDelay * 2)); }
  } finally {
    busy = false;
    if (!disposed && !paused && !document.hidden && !terminal) timer = window.setTimeout(() => void poll(), retryDelay);
  }
}

search.addEventListener('input', render);
// A live view says when it shows its player; until then, or after losing them, the light renderer stays.
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'cc-spectator') return;
  for (const [id, card] of cards) {
    const feed = card.feed;
    if (!feed || feed.frame.contentWindow !== e.source) continue;
    // A view that missed a move (it was still loading) is pointed again.
    if (e.data.room !== feed.room || e.data.follow !== feed.follow) { feed.live = false; retarget(feed, snapshot?.players.find(p => p.id === id)?.area ?? null); }
    else feed.live = e.data.state === 'live';
    card.root.classList.toggle('live-feed', feed.live);
    render();
  }
});
pause.addEventListener('click', () => {
  paused = !paused; generation++; clearTimeout(timer);
  pause.textContent = paused ? '다시 시작' : '일시정지'; pause.setAttribute('aria-pressed', String(paused));
  if (views) views.paused = paused || !fresh;
  connection.textContent = paused ? '일시정지' : '다시 연결 중'; connection.dataset.state = paused ? 'paused' : '';
  render();
  if (!paused) void poll();
});
retry.addEventListener('click', () => { if (!paused) void poll(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') expand(null); });
window.addEventListener('resize', () => layout(wall.children.length));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); if (views) views.paused = true; }
  else if (!paused) { connection.textContent = '다시 연결 중'; void poll(); }
});
window.addEventListener('pagehide', () => { disposed = true; generation++; clearTimeout(timer); views?.dispose(); });
keepAwake();
void poll();

/** The home TV (LG StanbyME) starts its screen saver about 4.5 minutes after the last remote press. A playing
 * video keeps it away while the monitor is up: a 2 s, 16 px black clip, muted and looping. Wake Lock does the
 * same in browsers that have it. */
function keepAwake() {
  const video = h('video', { class: 'keep-awake', 'aria-hidden': 'true' });
  Object.assign(video, { muted: true, defaultMuted: true, loop: true, playsInline: true, autoplay: true });
  video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANKbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHtbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABmG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVhzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMAKDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAtYAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAKAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAKAAAAAQAAADxzdHN6AAAAAAAAAAAAAAAKAAACgwAAAAoAAAAKAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAABRzdGNvAAAAAAAAAAEAAAN6AAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi4zLjEwMAAAAAhmcmVlAAAC3m1kYXQAAAJwBgX//2zcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj01IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAC2WIhAR8mKAANiOAAAAABkGaOAj6gAAAAAZBmlQCPqAAAAAFQZpgEfUAAAAFQZqAEfUAAAAFQZqgEfUAAAAFQZrAEfUAAAAFQZrgEfUAAAAFQZsAEPUAAAAFQZsgP9Q=';
  document.body.append(video);
  const wake = () => {
    if (document.hidden) return;
    void video.play().catch(() => {});
    void navigator.wakeLock?.request('screen').catch(() => {});
  };
  document.addEventListener('visibilitychange', wake);
  wake();
}
