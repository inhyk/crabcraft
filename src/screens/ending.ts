// Ending: the credits roll over the celebration painting, then Play Again / Robot Mode / Title.
import type { App, Screen } from '../app';
import { CreditsRoll } from '../game/creditsRoll';

export default class EndingScreen implements Screen {
  private roll: CreditsRoll | null = null;

  enter(app: App, params?: unknown): void {
    const options = params as { name?: string; musicOn?: boolean } | undefined;
    const name = options?.name ?? app.spec?.name ?? '';
    if (options?.musicOn === false) app.audio.stopMusic(.3);
    else void app.audio.playMusic('music-ending', 2);
    this.roll = new CreditsRoll(app, { mode: 'ending', playerName: name });
  }

  exit(): void {
    this.roll?.dispose();
    this.roll = null;
  }
}
