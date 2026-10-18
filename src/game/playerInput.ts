import type { InputAccumulator } from '../sim/input.ts';
import type { ChannelKind } from '../sim/types.ts';

/** Only the browser controls used at the input boundary, with no gameplay dependencies. */
export interface PlayerInputGame {
  readonly controlsLocked: boolean;
  readonly input: {
    isDown(code: string): boolean;
    isButtonDown(button: 0 | 1 | 2): boolean;
    wasPressed(code: string): boolean;
  };
  readonly follow: {
    yaw: number;
    readonly steering: boolean;
    readonly forwardYaw: number;
  };
}

/** Called once per render frame, before any number of fixed simulation ticks. */
export function sampleHeld(
  game: PlayerInputGame,
  accumulator: InputAccumulator,
  dt: number,
  currentChannel: ChannelKind | null = null,
): void {
  const input = game.input;
  const free = !game.controlsLocked;
  let forward = free
    ? Number(input.isDown('KeyW') || input.isDown('ArrowUp')) - Number(input.isDown('KeyS') || input.isDown('ArrowDown'))
    : 0;
  if (free && input.isButtonDown(0) && input.isButtonDown(2)) forward = 1;
  const turn = free
    ? Number(input.isDown('KeyQ') || input.isDown('ArrowLeft')) - Number(input.isDown('KeyE') || input.isDown('ArrowRight'))
    : 0;
  if (turn && !input.isButtonDown(0)) game.follow.yaw += turn * 2.9 * dt;
  accumulator.sampleHeld({
    forward,
    strafe: free ? Number(input.isDown('KeyA')) - Number(input.isDown('KeyD')) : 0,
    turn,
    sprint: free && (input.isDown('ShiftLeft') || input.isDown('ShiftRight')),
    steeringYaw: free && game.follow.steering ? game.follow.forwardYaw : null,
    heldChannel: input.isDown('KeyT') ? 'recall' : input.isDown('KeyF') ? currentChannel ?? 'beacon' : null,
  });
}

/** GUI callbacks queue their own commands; only legacy Player.update edges are captured here. */
export function captureEdges(game: PlayerInputGame, accumulator: InputAccumulator): void {
  if (game.controlsLocked) return;
  if (game.input.wasPressed('Space')) accumulator.push({ kind: 'jump' });
  if (game.input.wasPressed('KeyB')) accumulator.push({ kind: 'dance' });
}
