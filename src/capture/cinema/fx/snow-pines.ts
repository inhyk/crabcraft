// Extra snow-laden pines for the tribute's snow scene: the world's own kit pines (snowPines.ts) planted
// where a shot needs a foreground edge or a backdrop, while the cue runs.
//
//   snow-pines  trees: [[x, z, s]...] (s scales the world's tree height, default 1), `sink` lowers
//               them into the snow (units), and the usual envelope (t, until)
import type * as THREE from 'three';
import { snowPines } from '../../../game/snowPines';
import { envelope, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

class Pines implements Effect {
  private group: THREE.Object3D | null = null;
  private gone = false;
  constructor(private cue: FxCue, scene: THREE.Scene, ground: (x: number, z: number) => number) {
    const sink = num(cue.sink, 0);
    const trees = ((cue.trees as number[][]) ?? []).map(([x, z, s]) => ({ x, z, s: s ?? 1 }));
    // The kit is cached after the world's own forest loads, so this resolves within the pre-roll.
    void snowPines(trees, (x, z) => ground(x, z) - sink).then((g) => {
      if (this.gone) return;
      this.group = g;
      g.visible = false;
      scene.add(g);
    });
  }
  update(ctx: FxContext): void {
    if (this.group) this.group.visible = envelope(this.cue, ctx.t) > 0;
  }
  dispose(): void {
    this.gone = true;
    this.group?.removeFromParent();
    this.group = null;
  }
}

registerEffect('snow-pines', (cue, scene, ground) => new Pines(cue, scene, ground));
