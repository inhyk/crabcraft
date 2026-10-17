// Videos: the three Crab Robot Challenge films, opened from the title menu and the Esc menu.
// A modal <dialog> lists them; picking one plays it in place. Files come same-origin from
// VITE_MEDIA_BASE (default /media), which the page's COEP header requires.
import { h } from './dom';
import { t } from '../i18n';
import type { AudioManager } from '../core/audio';
import './videos.css';

interface Film { id: string; ko: string; en: string; length: string }

const FILMS: Film[] = [
  { id: 'breakdance', ko: '브레이크댄스', en: 'Breakdance', length: '0:42' },
  { id: 'showcase', ko: '동작 모음', en: 'All the moves', length: '1:51' },
  { id: 'making-of', ko: '만든 과정', en: 'Making of', length: '1:38' },
];

const mediaBase = (import.meta.env.VITE_MEDIA_BASE || '/media').replace(/\/+$/, '');
const fileUrl = (id: string, ext: 'mp4' | 'jpg') => `${mediaBase}/videos/${id}.${ext}`;

let dialog: HTMLDialogElement | null = null;

/** Open the video list. Esc or × steps back: player, then list, then wherever it was opened. */
export function openVideos(audio: AudioManager): void {
  if (dialog) return;
  // Drop held movement keys, as the account dialog does.
  window.dispatchEvent(new Event('blur'));
  const body = h('div', { class: 'videos-body' });
  const heading = h('h2', { class: 'cc-title' });
  const close = h('button', { type: 'button', class: 'videos-close' }, '×');
  const d = h('dialog', { class: 'videos-dialog' }, close, heading, body) as HTMLDialogElement;
  dialog = d;
  let video: HTMLVideoElement | null = null;

  const stopVideo = () => {
    if (!video) return;
    video.removeEventListener('error', fail);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video = null;
    audio.hold(false);
  };

  // Focus starts on a film (the one just watched), not on ×, so Space or Enter plays instead of closing.
  const list = (focus = FILMS[0].id) => {
    stopVideo();
    heading.textContent = t('영상', 'Videos');
    close.setAttribute('aria-label', t('닫기', 'Close'));
    const cards = FILMS.map((f) => {
      const poster = h('img', { src: fileUrl(f.id, 'jpg'), alt: '', loading: 'lazy', onerror: (e: Event) => ((e.target as HTMLElement).style.visibility = 'hidden') });
      return h('button', { type: 'button', class: 'videos-card', 'data-video': f.id, onclick: () => play(f) },
        h('span', { class: 'videos-poster' }, poster, h('span', { class: 'videos-length' }, f.length)),
        h('span', { class: 'videos-name' }, t(f.ko, f.en)),
      );
    });
    body.replaceChildren(h('div', { class: 'videos-list' }, ...cards));
    d.classList.remove('playing');
    const card = cards[Math.max(0, FILMS.findIndex((f) => f.id === focus))];
    card.autofocus = true;
    if (d.open) card.focus();
  };

  const fail = () => {
    stopVideo();
    body.replaceChildren(h('p', { class: 'videos-error', role: 'alert' }, t('영상을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'This video could not be loaded. Please try again later.')));
    close.focus();
  };

  let current = FILMS[0].id;
  const play = (f: Film) => {
    current = f.id;
    heading.textContent = t(f.ko, f.en);
    close.setAttribute('aria-label', t('영상 닫기', 'Close video'));
    const v = h('video', { class: 'videos-player', controls: true, playsinline: true, preload: 'none', poster: fileUrl(f.id, 'jpg') }) as HTMLVideoElement;
    v.addEventListener('error', fail);
    v.src = fileUrl(f.id, 'mp4');
    video = v;
    body.replaceChildren(v);
    d.classList.add('playing');
    audio.hold(true);
    v.play().catch((e: unknown) => {
      // NotAllowedError leaves the controls for the player to press play; a missing file fails.
      if (video === v && e instanceof DOMException && e.name === 'NotSupportedError') fail();
    });
    v.focus();
  };

  const back = () => {
    if (d.classList.contains('playing') || body.querySelector('.videos-error')) list(current);
    else d.close();
  };

  close.addEventListener('click', back);
  // Keys stay inside the dialog so the game never sees them; Esc steps back one level. The window
  // guard covers keys aimed outside the dialog, e.g. at <body> after the focused element was replaced.
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); back(); }
  };
  const guard = (e: KeyboardEvent) => { if (!d.contains(e.target as Node)) onKey(e); };
  d.addEventListener('keydown', onKey);
  window.addEventListener('keydown', guard, true);
  d.addEventListener('cancel', (e) => {
    if (d.classList.contains('playing') || body.querySelector('.videos-error')) { e.preventDefault(); list(current); }
  });
  d.addEventListener('close', () => {
    window.removeEventListener('keydown', guard, true);
    stopVideo();
    d.remove();
    dialog = null;
  });

  list();
  document.body.append(d);
  d.showModal();
}
