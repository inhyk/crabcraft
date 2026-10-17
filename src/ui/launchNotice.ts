import { h } from './dom';
import { t } from '../i18n';
import './launchNotice.css';

/** Show the requested preparation message before starting the renderer or loading a game. */
export function showLaunchNotice(root: HTMLElement): Promise<void> {
  return new Promise(resolve => {
    const button = h('button', { type: 'button', class: 'launch-notice-start' }, t('확인했어요 · 시작하기', 'Got it · Start'));
    const dialog = h('dialog', { class: 'launch-notice', 'aria-labelledby': 'launch-notice-title' },
      h('p', { class: 'launch-notice-brand' }, 'WORLD OF CRABCRAFT'),
      h('h1', { id: 'launch-notice-title' }, t('모험을 시작하기 전에', 'Before your adventure')),
      h('div', { class: 'launch-notice-item' }, h('span', { 'aria-hidden': 'true' }, '🔋'), h('p', null, t('충전하면서 플레이해 주세요.', 'Please keep your computer plugged in while playing.'))),
      h('div', { class: 'launch-notice-item' }, h('span', { 'aria-hidden': 'true' }, '🖥️'), h('p', null, t('컴퓨터로 실행해 주세요.', 'Please play on a computer.'))),
      button,
    ) as HTMLDialogElement;
    dialog.addEventListener('cancel', event => event.preventDefault());
    button.addEventListener('click', () => { dialog.close(); dialog.remove(); resolve(); }, { once: true });
    root.append(dialog);
    dialog.showModal();
    button.focus();
  });
}
