// Zone lines: a segment on the ground that fires once when the local player crosses it in one
// direction, and re-arms after they step back. The King's Road line leads from World I to Tidecrown.
import { t } from '../i18n';
import { KINGS_ROAD_LINE } from '../world/layout';
import type { Game } from './game';
import type { HiddenWorld } from './world2';

export interface ZoneLineSpec {
  id: string;
  a: readonly [number, number];
  b: readonly [number, number];
  /** Unit direction (x, z) a crossing must go. */
  dir: readonly [number, number];
  /** How far back on the near side the player must be before the line fires again. */
  rearm?: number;
  onCross(): void;
}

/** Moves longer than this in one frame are teleports, not crossings. */
const MAX_STEP = 6;

export class ZoneLine {
  fired = 0;
  private armed = true;
  private prev: { x: number; z: number; d: number } | null = null;
  constructor(readonly spec: ZoneLineSpec) {}

  /** Signed distance past the line along its direction, and where along the segment (0..1). */
  private measure(x: number, z: number): { d: number; t: number } {
    const { a, b, dir } = this.spec;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    return { d: (x - a[0]) * dir[0] + (z - a[1]) * dir[1], t: ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez) };
  }

  /** Feed the watched position each frame, or null while the line is out of play. True on the frame it fires. */
  watch(pos: { x: number; z: number } | null): boolean {
    if (!pos) {
      this.prev = null;
      return false;
    }
    const { d } = this.measure(pos.x, pos.z);
    const prev = this.prev;
    this.prev = { x: pos.x, z: pos.z, d };
    if (d < -(this.spec.rearm ?? 1.5)) this.armed = true;
    if (!prev || !this.armed || prev.d >= 0 || d < 0) return false;
    if (Math.hypot(pos.x - prev.x, pos.z - prev.z) > MAX_STEP) return false;
    // Where the step met the line must lie on the segment.
    const k = prev.d / (prev.d - d);
    const hit = this.measure(prev.x + (pos.x - prev.x) * k, prev.z + (pos.z - prev.z) * k);
    if (hit.t < 0 || hit.t > 1) return false;
    this.armed = false;
    this.fired++;
    this.spec.onCross();
    return true;
  }
}

type TidecrownWorld = HiddenWorld & { enterTidecrown?: () => unknown };

/** World I's north edge on the King's Road: enters Tidecrown through a short fade, or turns the player back until it opens. */
export function kingsRoadLine(game: Game): ZoneLine {
  let lastNotice = -Infinity;
  let busy = false;
  return new ZoneLine({
    id: 'tidecrown',
    a: KINGS_ROAD_LINE.a,
    b: KINGS_ROAD_LINE.b,
    dir: KINGS_ROAD_LINE.dir,
    onCross() {
      const world2 = game.world2 as TidecrownWorld;
      if (typeof world2.enterTidecrown === 'function') {
        if (busy) return;
        busy = true;
        void (async () => {
          try {
            await game.app.blackout(true, 350);
            if (game.alive) await Promise.race([Promise.resolve(world2.enterTidecrown!()), new Promise((r) => setTimeout(r, 15000))]);
          } catch (err) {
            console.warn('enterTidecrown failed', err);
          } finally {
            await game.app.blackout(false, 600);
            busy = false;
          }
        })();
        return;
      }
      // Not open yet: say so (not more than every few seconds) and step the player back off the line.
      const now = performance.now();
      if (now - lastNotice > 5000) {
        lastNotice = now;
        const text = t('타이드크라운으로 가는 길은 곧 열려요.', 'The road to Tidecrown opens soon.');
        game.hud.chat.system(text);
        game.hud.messages.info(text);
      }
      const u = game.player.unit;
      const { a, dir } = KINGS_ROAD_LINE;
      const back = Math.max(0, (u.pos.x - a[0]) * dir[0] + (u.pos.z - a[1]) * dir[1]) + 2.2;
      u.teleport(game.world, u.pos.x - dir[0] * back, u.pos.z - dir[1] * back);
    },
  });
}

/** The lines of World I, watched while the player walks there in their own game. */
export class ZoneLines {
  readonly lines: ZoneLine[];
  constructor(private game: Game) {
    this.lines = [kingsRoadLine(game)];
  }
  update(): void {
    const g = this.game;
    const inPlay = g.world2.chapter === 1 && !g.dungeons?.active && !g.ending.active && !g.spectator && g.player.unit.alive && g.world.root.visible;
    const pos = inPlay ? g.player.unit.pos : null;
    for (const line of this.lines) line.watch(pos);
  }
}
