// Zone lines: a segment on the ground that fires once when the local player crosses it in one
// direction, and re-arms after they step back. The King's Road line leads from World I to Tidecrown,
// and Tidecrown's south line leads back down the road.
import { t } from '../i18n';
import type { HeldInput } from '../sim/input';
import { TC_RETURN_LINE } from '../sim/world/tidecrownGround';
import { KINGS_ROAD_LINE, KINGS_ROAD_RETURN } from '../world/layout';
import type { Game } from './game';

type Segment = { readonly a: readonly [number, number]; readonly b: readonly [number, number]; readonly dir: readonly [number, number] };

export interface ZoneLineSpec extends Segment {
  id: string;
  /** The ground it lies on, in that ground's own coordinates. */
  realm: 'clawhaven' | 'tidecrown';
  /** How far back on the near side the player must be before the line fires again. */
  rearm?: number;
  onCross(): void;
}

/** Moves longer than this in one frame are teleports, not crossings. */
const MAX_STEP = 6;
/** Signed distance of (x, z) past a line along its direction. */
const past = (s: Segment, x: number, z: number) => (x - s.a[0]) * s.dir[0] + (z - s.a[1]) * s.dir[1];

export class ZoneLine {
  fired = 0;
  private armed = true;
  private prev: { x: number; z: number; d: number } | null = null;
  constructor(readonly spec: ZoneLineSpec) {}

  /** Signed distance past the line along its direction, and where along the segment (0..1). */
  private measure(x: number, z: number): { d: number; t: number } {
    const { a, b } = this.spec;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    return { d: past(this.spec, x, z), t: ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez) };
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

/** The zone lines of World I and Tidecrown, each watched while the player walks its own ground. */
export class ZoneLines {
  readonly lines: ZoneLine[];
  /** Set while a fade between World I and Tidecrown runs. */
  private travelling = false;
  private lastNotice = -Infinity;
  /** Server worlds: the walk back off a closed line, until the player is clear of it or the time runs out. */
  private nudge: { line: Segment; until: number; yaw: number } | null = null;
  constructor(private game: Game) {
    this.lines = [this.kingsRoad(), this.tidecrownSouth()];
  }

  /** Whether the King's Road leads into Tidecrown here: not on a server world, whose server does not host it yet. */
  tidecrownOpen(): boolean {
    return !this.game.serverMode;
  }

  update(): void {
    const g = this.game, w2 = g.world2, u = g.player.unit;
    const free = !g.dungeons?.active && !g.server?.dungeon?.active && !g.ending.active && !g.serverEndingActive && !g.spectator && u.alive;
    const clawhaven = free && w2.chapter === 1 && !w2.inTidecrown && g.world.root.visible;
    const tidecrown = free && w2.inTidecrown && !!w2.tidecrown?.root.visible;
    for (const line of this.lines) line.watch((line.spec.realm === 'tidecrown' ? tidecrown : clawhaven) ? u.pos : null);
  }

  /** Server worlds: the held input that walks the player back off a closed line, while that lasts. */
  serverHeld(): HeldInput | null {
    const n = this.nudge, u = this.game.player.unit;
    if (!n) return null;
    if (performance.now() > n.until || !u.alive || past(n.line, u.pos.x, u.pos.z) < -2.2) {
      this.nudge = null;
      return null;
    }
    return { forward: 1, strafe: 0, turn: 0, sprint: false, steeringYaw: n.yaw, heldChannel: null };
  }

  /** World I's north edge on the King's Road: into Tidecrown through a short fade, or turned back while it is closed. */
  private kingsRoad(): ZoneLine {
    const g = this.game;
    return new ZoneLine({
      id: 'tidecrown', realm: 'clawhaven', ...KINGS_ROAD_LINE,
      onCross: () => {
        if (!this.tidecrownOpen()) {
          this.turnBack(KINGS_ROAD_LINE);
          return;
        }
        // A fight or an expedition keeps the player here; Tidecrown says why.
        if (!g.world2.canEnterTidecrown(true)) {
          this.stepBack(KINGS_ROAD_LINE);
          return;
        }
        void this.travel(() => g.world2.enterTidecrown(), () => this.stepBack(KINGS_ROAD_LINE));
      },
    });
  }

  /** Tidecrown's south edge on the forest road: through the same fade onto the King's Road in World I, facing south. */
  private tidecrownSouth(): ZoneLine {
    const g = this.game;
    return new ZoneLine({
      id: 'clawhaven', realm: 'tidecrown', ...TC_RETURN_LINE,
      // Entered over another world (creator travel), it leads back to where the player stood there.
      onCross: () => void this.travel(() => g.world2.exitTidecrown(g.world2.chapter === 1 ? KINGS_ROAD_RETURN : undefined)),
    });
  }

  /** Fade to black, run the move, lift the fade; `refused` runs when the move resolves false. */
  private async travel(move: () => Promise<boolean> | boolean, refused?: () => void): Promise<void> {
    if (this.travelling) return;
    this.travelling = true;
    const app = this.game.app;
    try {
      await app.blackout(true, 350);
      const ok = this.game.alive ? await Promise.race([Promise.resolve(move()), new Promise<null>((r) => setTimeout(() => r(null), 15000))]) : null;
      if (ok === false) refused?.();
    } catch (err) {
      console.warn('zone line travel failed', err);
    } finally {
      await app.blackout(false, 600);
      this.travelling = false;
    }
  }

  /** The road is not open yet: say so (not more than every few seconds) and step the player back off the line. */
  private turnBack(line: Segment): void {
    const now = performance.now();
    if (now - this.lastNotice > 5000) {
      this.lastNotice = now;
      const text = t('타이드크라운으로 가는 길은 곧 열려요.', 'The road to Tidecrown opens soon.');
      this.game.hud.chat.system(text);
      this.game.hud.messages.info(text);
    }
    this.stepBack(line);
  }

  /** Back to the near side of a line: moved there in the player's own game, walked there on a server world. */
  private stepBack(line: Segment): void {
    const g = this.game, u = g.player.unit;
    if (g.serverMode) {
      this.nudge = { line, until: performance.now() + 1500, yaw: Math.atan2(-line.dir[0], -line.dir[1]) };
      return;
    }
    const back = Math.max(0, past(line, u.pos.x, u.pos.z)) + 2.2;
    u.teleport(g.world, u.pos.x - line.dir[0] * back, u.pos.z - line.dir[1] * back);
  }
}
