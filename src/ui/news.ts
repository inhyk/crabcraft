// Update news: the release notes for each version, opened from the title menu. The same text is
// published on the wiki (프로젝트 › Crabcraft 업데이트 안내 모음). Notes live in
// public/release-notes.json, newest first; the release that bumps package.json adds its entry.
import { h } from './dom';
import { t } from '../i18n';
import './videos.css';
import './news.css';

export interface NewsItem { head: string; body?: string }
export interface NewsNote { version: string; date: string; wiki?: string; sections: { title: string; items: NewsItem[] }[] }

const SEEN_KEY = 'cc.news.seen';
let notes: Promise<NewsNote[]> | null = null;

/** The notes, newest first. A missing or broken file means no news, never an error screen. */
export function loadNews(): Promise<NewsNote[]> {
  notes ??= fetch(`${import.meta.env.BASE_URL}release-notes.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { notes: [] }))
    .then((data: { notes?: unknown }) => (Array.isArray(data.notes) ? data.notes.filter(isNote) : []))
    .catch(() => []);
  return notes;
}

function isNote(n: unknown): n is NewsNote {
  const v = n as NewsNote;
  return !!v && typeof v.version === 'string' && typeof v.date === 'string' && Array.isArray(v.sections) &&
    v.sections.every((s) => typeof s.title === 'string' && Array.isArray(s.items) && s.items.every((i) => typeof i.head === 'string'));
}

/** True when the newest note has not been opened on this device yet. */
export function hasUnseenNews(list: NewsNote[]): boolean {
  if (!list.length) return false;
  try { return localStorage.getItem(SEEN_KEY) !== list[0].version; } catch { return false; }
}

let dialog: HTMLDialogElement | null = null;

export function openNews(list: NewsNote[]): void {
  if (dialog || !list.length) return;
  window.dispatchEvent(new Event('blur'));
  try { localStorage.setItem(SEEN_KEY, list[0].version); } catch { /* private window: the dot just stays */ }
  const close = h('button', { type: 'button', class: 'videos-close', 'aria-label': t('닫기', 'Close'), autofocus: true }, '×');
  const notesEl = list.map((n) =>
    h('article', { class: 'news-note' },
      h('h3', { class: 'news-version' }, `v${n.version}`, h('span', { class: 'news-date' }, n.date)),
      ...n.sections.map((s) => h('section', null,
        h('h4', null, s.title),
        h('ul', null, ...s.items.map((i) => h('li', null, h('strong', null, i.head), i.body ? h('p', null, i.body) : null))),
      )),
      n.wiki ? h('a', { class: 'news-wiki', href: n.wiki, target: '_blank', rel: 'noopener' }, t('위키에서 보기', 'Read on the wiki')) : null,
    ));
  const d = h('dialog', { class: 'videos-dialog news-dialog' }, close, h('h2', { class: 'cc-title' }, t('업데이트 소식', 'Update news')), h('div', { class: 'news-body' }, ...notesEl)) as HTMLDialogElement;
  dialog = d;
  close.addEventListener('click', () => d.close());
  // Keys stay inside the dialog so the game never sees them (as in the video dialog).
  const onKey = (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); d.close(); } };
  const guard = (e: KeyboardEvent) => { if (!d.contains(e.target as Node)) onKey(e); };
  d.addEventListener('keydown', onKey);
  window.addEventListener('keydown', guard, true);
  d.addEventListener('close', () => { window.removeEventListener('keydown', guard, true); d.remove(); dialog = null; });
  document.body.append(d);
  d.showModal();
}
