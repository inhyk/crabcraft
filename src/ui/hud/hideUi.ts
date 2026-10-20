// H hides the whole interface so the world can be enjoyed on its own: the HUD, nameplates, chat,
// panels, the target ring and the quest guidance. H again or Esc brings it back. Moving, the camera
// and dancing keep working. A short note at the bottom says how to come back, then fades.
import { h } from '../dom';
import { t } from '../../i18n';
import type { Game } from '../../game/game';

const ROOT_CLASS = 'cc-ui-hidden';
const NOTE_MS = 2600;

export class HideUi {
  hidden = false;
  private readonly note = h('div', { class: 'hide-ui-note' });
  private noteTimer = 0;
  private objectiveWas = true;

  constructor(private readonly game: Game) {
    // The overlay layer stays visible while the screen's UI layer is hidden.
    game.app.overlay.append(this.note);
    // Capture phase: Esc that brings the UI back must not also open the game menu.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  toggle(on = !this.hidden): void {
    if (on === this.hidden) return;
    this.hidden = on;
    document.documentElement.classList.toggle(ROOT_CLASS, on);
    const objective = this.game.objective;
    if (on) {
      this.objectiveWas = objective.enabled;
      objective.enabled = false;
    } else objective.enabled = this.objectiveWas;
    clearTimeout(this.noteTimer);
    if (on) {
      this.note.replaceChildren(h('kbd', null, 'H'), '/', h('kbd', null, 'Esc'), t('UI 다시 보기', 'Show the interface'));
      this.note.classList.add('on');
      this.noteTimer = window.setTimeout(() => this.note.classList.remove('on'), NOTE_MS);
    } else this.note.classList.remove('on');
  }

  /** Called after the game has placed this frame's target ring. */
  update(): void {
    if (!this.hidden) return;
    // A window that needs an answer (sign-in, party, notice) brings the UI back with it.
    if (document.querySelector('dialog:modal')) {
      this.toggle(false);
      return;
    }
    this.game.vfx.selection.mesh.visible = false;
  }

  dispose(): void {
    this.toggle(false);
    window.removeEventListener('keydown', this.onKeyDown, true);
    clearTimeout(this.noteTimer);
    this.note.remove();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (document.querySelector('dialog:modal')) return;
    if (e.code === 'KeyH') {
      if (!e.repeat) this.toggle();
    } else if (e.code === 'Escape' && this.hidden) {
      this.toggle(false);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
}
