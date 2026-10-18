import './monitor.css';
import { h } from '../ui/dom';
import { COAST } from '../world/layout';
import type { MonitorPlayer, MonitorSnapshot } from '../../server/monitor';
import type { Views } from './views';

const WORLD_NAMES = ['위치 확인 중', '클로헤이븐', '별빛 항구', '새벽의 섬', '서리빛 설원'];
const WORLD_EN = ['', 'CLAWHAVEN', 'STARHAVEN', 'DAWNREACH', 'FROSTLIGHT'];
const host = location.hostname;
const environment = host === 'crab-dev.seonn.dev' ? 'DEV' : host === 'crab.seonn.dev' ? 'MAIN' : 'LOCAL';
const root = document.getElementById('monitor')!;
const connection = h('span', { class: 'connection', role: 'status' }, '연결 중');
const total = h('strong', null, '0');
const updated = h('span', { class: 'updated' }, '첫 데이터를 기다립니다');
const notice = h('section', { class: 'notice', role: 'status', hidden: true });
const search = h('input', { type: 'search', placeholder: '유저 이름 또는 방 검색', 'aria-label': '유저 이름 또는 방 검색' });
const density = h('select', { 'aria-label': '화면 크기' }, h('option', { value: 'normal' }, '기본 화면'), h('option', { value: 'compact' }, '작게 보기'), h('option', { value: 'large' }, '크게 보기'));
const pause = h('button', { type: 'button', 'aria-pressed': 'false' }, '일시정지');
const retry = h('button', { type: 'button' }, '다시 연결');
const worlds = h('main', { class: 'worlds', id: 'worlds' });
const heading = h('header', { class: 'masthead' },
  h('div', { class: 'brand' }, h('span', { class: 'eyebrow' }, 'WORLD OF CRABCRAFT'), h('h1', null, '개발자 모니터')),
  h('span', { class: `environment ${environment.toLowerCase()}` }, environment),
  h('div', { class: 'summary' }, h('span', null, '접속 유저 ', total), connection),
);
root.append(heading,
  h('div', { class: 'toolbar' }, search, density, pause, updated), notice,
  h('p', { class: 'scope' }, '온라인 유저 관전 화면. 타일을 누르면 확대됩니다. 위치 지도에는 검색과 관계없이 모든 유저가 표시됩니다.'), worlds);

type Card = { root: HTMLElement; canvas: HTMLCanvasElement; message: HTMLElement; name: HTMLElement; meta: HTMLElement; health: HTMLElement; status: HTMLElement; number: HTMLElement };
type Section = { root: HTMLElement; count: HTMLElement; cards: HTMLElement; empty: HTMLElement; grid: HTMLCanvasElement; pins: HTMLElement; markers: Map<string, HTMLButtonElement>; players: MonitorPlayer[] };
const cards = new Map<string, Card>(), sections = new Map<number, Section>();
let snapshot: MonitorSnapshot | null = null, views: Views | null = null, viewsLoading = false;
let timer = 0, busy = false, paused = false, disposed = false, fresh = false, generation = 0;
let receipt = 0, retryDelay = 500;
let terminal = false;

for (const area of [1, 2, 3, 4, 0]) {
  const count = h('span', { class: 'world-count' }, '0명');
  const grid = h('canvas', { width: 320, height: 220, 'aria-hidden': 'true' });
  const pins = h('div', { class: 'map-pins' });
  const map = h('div', { class: 'minimap', 'aria-label': `${WORLD_NAMES[area]} 전체 유저 위치` }, grid, pins, h('span', { class: 'north' }, 'N ↑'));
  const list = h('div', { class: 'tiles' });
  const empty = h('div', { class: 'empty' }, '접속 중인 유저가 없습니다');
  const section = h('section', { class: 'world', id: `world-${area}` },
    h('div', { class: 'world-heading' }, h('span', { class: 'world-index' }, area ? `0${area}` : '?'), h('h2', null, WORLD_NAMES[area]), h('span', { class: 'world-en' }, WORLD_EN[area]), count),
    h('div', { class: 'world-body' }, h('aside', { class: 'map-panel' }, map, h('p', null, '전체 유저 위치', h('span', null, '같은 위치의 유저는 묶어 표시'))), h('div', { class: 'feeds' }, empty, list)));
  if (!area) section.hidden = true;
  worlds.append(section); sections.set(area, { root: section, count, cards: list, empty, grid, pins, markers: new Map(), players: [] });
}

function makeCard(p: MonitorPlayer): Card {
  const canvas = h('canvas', { width: 480, height: 270, 'aria-label': `${p.spec.name} 관전 화면` });
  const message = h('span', { class: 'view-message' }, '관전 화면 준비 중');
  const name = h('strong'), meta = h('span', { class: 'player-meta' }), number = h('span', { class: 'player-number' });
  const health = h('span', { class: 'health-fill' }), status = h('span', { class: 'player-status' });
  const el = h('button', { type: 'button', class: 'tile', id: `player-${p.id}`, 'aria-expanded': 'false' },
    h('span', { class: 'view' }, canvas, message, number, status),
    h('span', { class: 'player-info' }, name, meta), h('span', { class: 'health', 'aria-label': '체력' }, health));
  el.addEventListener('click', () => {
    const expand = !el.classList.contains('expanded');
    for (const c of cards.values()) { c.root.classList.remove('expanded'); c.root.setAttribute('aria-expanded', 'false'); }
    el.classList.toggle('expanded', expand); el.setAttribute('aria-expanded', String(expand));
  });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { el.classList.remove('expanded'); el.setAttribute('aria-expanded', 'false'); } });
  return { root: el, canvas, message, name, meta, health, status, number };
}

function drawMap(area: number, section: Section, numbers: Map<string, number>) {
  const positioned = section.players.filter(p => p.state);
  const bounds = area === 1 ? [-230, 270, -250, 250] : [-150, 150, -175, 175];
  for (const p of positioned) {
    bounds[0] = Math.min(bounds[0], p.state!.x - 20); bounds[1] = Math.max(bounds[1], p.state!.x + 20);
    bounds[2] = Math.min(bounds[2], p.state!.z - 20); bounds[3] = Math.max(bounds[3], p.state!.z + 20);
  }
  const xy = (x: number, z: number) => [16 + (x - bounds[0]) / (bounds[1] - bounds[0]) * 288, 16 + (z - bounds[2]) / (bounds[3] - bounds[2]) * 188];
  const ctx = section.grid.getContext('2d')!;
  ctx.fillStyle = '#101d23'; ctx.fillRect(0, 0, 320, 220);
  ctx.strokeStyle = '#23363a'; ctx.lineWidth = 1;
  for (let x = 0; x <= 320; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 220); ctx.stroke(); }
  for (let y = 0; y <= 220; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(320, y); ctx.stroke(); }
  ctx.fillStyle = '#233731'; ctx.strokeStyle = '#66877b'; ctx.beginPath();
  if (area === 1) COAST.forEach(([x, z], i) => { const [px, py] = xy(x, z); if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  else {
    const [cx, cy] = xy(0, 0), [ex, ey] = xy(110, 140);
    ctx.ellipse(cx, cy, ex - cx, ey - cy, 0, 0, Math.PI * 2);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const clusters = new Map<string, { x: number; y: number; players: MonitorPlayer[] }>();
  for (const p of positioned) {
    const [x, y] = xy(p.state!.x, p.state!.z), key = `${Math.round(x / 16)},${Math.round(y / 16)}`;
    const group = clusters.get(key);
    if (group) group.players.push(p); else clusters.set(key, { x, y, players: [p] });
  }
  const markerIds = new Set<string>();
  for (const group of clusters.values()) {
    const ids = group.players.map(p => p.id), key = ids.join(',');
    markerIds.add(key);
    const names = group.players.map(p => p.spec.name).join(', ');
    let pin = section.markers.get(key);
    if (!pin) {
      pin = h('button', { class: 'pin', type: 'button' });
      let index = 0;
      pin.addEventListener('click', () => {
        search.value = ''; render();
        const card = cards.get(ids[index++ % ids.length]);
        card?.root.scrollIntoView({ block: 'center', behavior: 'instant' }); card?.root.focus({ preventScroll: true });
      });
      section.markers.set(key, pin); section.pins.append(pin);
    }
    pin.style.left = `${group.x / 3.2}%`; pin.style.top = `${group.y / 2.2}%`;
    pin.title = names; pin.setAttribute('aria-label', `${names} 화면으로 이동`);
    pin.textContent = ids.length > 1 ? `${ids.length}명` : String(numbers.get(ids[0]));
  }
  for (const [key, pin] of section.markers) if (!markerIds.has(key)) { pin.remove(); section.markers.delete(key); }
}

function render() {
  if (!snapshot) return;
  const players = [...snapshot.players].sort((a, b) => a.room.localeCompare(b.room) || a.spec.name.localeCompare(b.spec.name) || a.id.localeCompare(b.id));
  const ids = new Set(players.map(p => p.id)), numbers = new Map(players.map((p, i) => [p.id, i + 1]));
  for (const [id, card] of cards) if (!ids.has(id)) { card.root.remove(); cards.delete(id); }
  total.textContent = String(players.length);
  const term = search.value.trim().toLocaleLowerCase();
  for (const section of sections.values()) section.players = [];
  for (const p of players) {
    const section = sections.get(p.area ?? 0) ?? sections.get(0)!;
    section.players.push(p);
    let card = cards.get(p.id);
    if (!card) { card = makeCard(p); cards.set(p.id, card); }
    if (card.root.parentElement !== section.cards) section.cards.append(card.root);
    card.root.hidden = !`${p.spec.name} ${p.room}`.toLocaleLowerCase().includes(term);
    card.name.textContent = p.spec.name;
    card.number.textContent = String(numbers.get(p.id));
    const s = p.state, stale = !p.updatedAt || snapshot.at - p.updatedAt > 5000;
    card.status.textContent = !s ? '위치 대기' : stale ? '수신 지연' : s.alive ? '관전 중' : '사망';
    card.root.classList.toggle('stale', stale);
    card.meta.textContent = `${p.public ? '공개' : '비공개'} ${p.room}${s ? ` / Lv.${s.level ?? 1} / ${Math.round(s.x)}, ${Math.round(s.z)}` : ''}`;
    card.health.style.width = `${s ? Math.max(0, Math.min(100, s.hp / s.maxHp * 100)) : 0}%`;
    card.health.parentElement!.setAttribute('aria-label', s ? `체력 ${Math.round(s.hp)} / ${Math.round(s.maxHp)}` : '체력 수신 대기');
    card.root.setAttribute('aria-label', `${p.spec.name} 관전 화면 확대`);
  }
  for (const [area, section] of sections) {
    if (!area) section.root.hidden = section.players.length === 0;
    section.count.textContent = `${section.players.length}명`;
    const shown = section.players.filter(p => !cards.get(p.id)!.root.hidden).length;
    section.empty.hidden = shown > 0;
    section.empty.textContent = section.players.length ? '검색 조건에 맞는 유저가 없습니다' : '접속 중인 유저가 없습니다';
    section.root.classList.toggle('unoccupied', !section.players.length);
    drawMap(area, section, numbers);
  }
  const tiles = new Map([...cards].filter(([, c]) => !c.root.hidden).map(([id, c]) => [id, { canvas: c.canvas, message: c.message }]));
  views?.sync(players, tiles);
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
    snapshot = null; views?.clear(); cards.clear(); total.textContent = '0';
    for (const s of sections.values()) { s.cards.replaceChildren(); s.pins.replaceChildren(); s.markers.clear(); s.count.textContent = '0명'; s.empty.hidden = false; s.empty.textContent = '접근 권한 확인 필요'; }
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
      snapshot = data as MonitorSnapshot; receipt = Date.now(); fresh = true; retryDelay = 500;
      connection.textContent = '실시간 연결'; connection.dataset.state = 'live'; notice.hidden = true;
      updated.textContent = `${new Date(receipt).toLocaleTimeString('ko-KR', { hour12: false })} 갱신`;
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
density.addEventListener('change', () => { root.dataset.density = density.value; });
pause.addEventListener('click', () => {
  paused = !paused; generation++; clearTimeout(timer);
  pause.textContent = paused ? '다시 시작' : '일시정지'; pause.setAttribute('aria-pressed', String(paused));
  if (views) views.paused = paused || !fresh;
  connection.textContent = paused ? '일시정지' : '다시 연결 중'; connection.dataset.state = paused ? 'paused' : '';
  if (!paused) void poll();
});
retry.addEventListener('click', () => { if (!paused) void poll(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); if (views) views.paused = true; }
  else if (!paused) { connection.textContent = '다시 연결 중'; void poll(); }
});
window.addEventListener('pagehide', () => { disposed = true; generation++; clearTimeout(timer); views?.dispose(); });
void poll();
