import type { Game } from './game';
import type { Unit } from './unit';
import { spectateOf, type Chapter, type Spectate } from '../spectate';

type Signal = 'loading' | 'connecting' | 'live' | 'nosignal';

/**
 * The monitor's spectator view (docs/features/developer-monitor.md). The game runs as an invisible member of the
 * observed room: the relay's checkpoints and events drive monsters, bosses, boats and games as on a player's
 * screen, and nothing is ever sent. The hidden local crab stands on the followed player's crab, so the follow
 * camera, region effects and streaming follow them. The parent monitor hears the view's state and may point it
 * at another player or room without reloading.
 */
export class Spectator {
  room: string;
  follow: string;
  /** The world to show until the room's welcome says which it is. */
  area: Chapter;
  private tracking: Unit | null = null;
  private signal: Signal = 'loading';
  private readonly screen = document.createElement('div');

  constructor(private readonly game: Game, target: Spectate) {
    this.room = target.room; this.follow = target.follow; this.area = target.area;
    const p = game.player.unit;
    p.hidden = true; p.targetable = false; p.invulnerable = true;
    game.musicOn = false;
    this.screen.className = 'cc-spectate-signal';
    this.screen.textContent = 'NO SIGNAL';
    this.screen.hidden = true;
    document.body.append(this.screen);
    window.addEventListener('message', this.receive);
    this.show('connecting');
  }

  private readonly receive = (e: MessageEvent) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'cc-spectate') return;
    const next = spectateOf(e.data);
    if (!next) return;
    const moved = next.room !== this.room;
    this.room = next.room; this.follow = next.follow; this.area = next.area; this.tracking = null;
    if (moved) void this.game.multiplayer?.observe(next.room);
  };

  /** The room's world, from the URL and then from its welcome: be there before its checkpoint applies (a shared shard ignores another world's). */
  arrive(area: unknown): void {
    const g = this.game, battle = g.multiplayer?.battle;
    if (!battle || typeof area !== 'number' || !Number.isInteger(area) || area < 1 || area > 6 || area === g.world2.chapter) return;
    // Travel is checked against personal progress; a spectator has none, as when a room's host moves everyone.
    battle.applying = true;
    try { g.world2.go(area as Chapter, false); } finally { battle.applying = false; }
  }

  update(dt: number): void {
    const g = this.game, u = g.multiplayer?.peerUnit(this.follow) ?? null;
    this.show(u ? 'live' : g.multiplayer?.welcomed ? 'nosignal' : 'connecting');
    if (!u) { this.tracking = null; return; }
    const p = g.player.unit, f = g.follow, behind = u.yaw + Math.PI;
    const jumped = p.pos.distanceToSquared(u.pos) > 900;
    p.pos.copy(u.pos); p.setYaw(u.yaw);
    if (u !== this.tracking || jumped) {
      this.tracking = u;
      f.lookHeight = Math.max(0.8, u.height * 0.85 + 0.25);
      f.yaw = behind; f.cut();
    } else f.yaw += Math.atan2(Math.sin(behind - f.yaw), Math.cos(behind - f.yaw)) * (1 - Math.exp(-2 * dt));
  }

  private show(signal: Signal): void {
    if (signal === this.signal) return;
    this.signal = signal;
    this.screen.hidden = signal !== 'nosignal';
    if (window.parent !== window) window.parent.postMessage({ type: 'cc-spectator', state: signal, room: this.room, follow: this.follow }, location.origin);
  }

  dispose(): void {
    window.removeEventListener('message', this.receive);
    this.screen.remove();
  }
}
