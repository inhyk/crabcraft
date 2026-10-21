// Tidecrown's keepers: named crabs at fixed posts in the capital who are not game units. They stay out of g.units, so
// the residents' count, targeting, combat and the shared sims never see them. A feature adds one from TidecrownHub's
// constructor (the hub's `keepers`), before the first entry:
//
//   const vault = hub.keepers.add({ id: 'tc-vault', x, z, yaw, spec, name: ['금고지기 벨', 'Bell'], title: [...],
//     talk: () => openVault(vault) });
//
// From then on the registry builds its crab behind the capital's loading screen (resolved off walls onto the ground),
// draws it with the game's cull, detail and shadow rules, puts its name plate up, offers the nearest keeper's F prompt
// through world2's portal prompt (TidecrownHub.point/label/use), turns it toward whoever comes near and waves now and
// then, shows and hides it with the capital, compiles its shaders before the screen lifts, and disposes it. `talk`
// opens the keeper's dialogue (start it with `greet()`); a keeper without `talk` has no F point of its own. On a server
// world nothing is built.
import * as THREE from 'three';
import { createCrab } from '../../crab/provider';
import type { CrabRig, CrabSpec } from '../../crab/types';
import { t } from '../../i18n';
import { createMotionController } from '../../motion/provider';
import type { Game } from '../game';
import { Unit } from '../unit';
import { turnToward, yawTo } from '../util';
import type { TidecrownIsland } from './island';

/** A line in Korean and English. */
export type Text = readonly [ko: string, en: string];

export interface KeeperDef {
  /** The crab's npcId. */
  readonly id: string;
  /** Its post in the capital and the way it faces there. */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly spec: CrabSpec;
  /** NPC extras from the gear kit (e.g. 'captain-hat'). */
  readonly extras?: readonly string[];
  readonly name: Text;
  readonly title: Text | (() => string);
  /** Defaults to art/portraits/<race>-<sex>.webp. */
  readonly portrait?: string;
  /** Size against a resident's (1). */
  readonly scale?: number;
  /** A piece built once for this crab and set on its head socket, in the rig's link space (metres); how far its top
   *  rises above the shell, for the name plate. */
  readonly head?: () => { piece: THREE.Object3D; top: number };
  /** The F prompt; defaults to "Talk to <name>". */
  readonly prompt?: Text | (() => string);
  /** A minimap label in gold (as the hub's ships and portal). */
  readonly marker?: Text;
  /** F at the keeper: opens their dialogue. */
  readonly talk?: () => void;
}

export interface Keeper {
  readonly def: KeeperDef;
  /** The crab, once loaded. */
  readonly unit: Unit | null;
  /** Where it stands (on the ground, off walls, once loaded); the same vector throughout. */
  readonly at: THREE.Vector3;
  readonly portrait: string;
  /** Turns to the player, smiles and waves (a talk starts with it). */
  greet(): void;
}

class Post implements Keeper {
  unit: Unit | null = null;
  readonly at: THREE.Vector3;
  readonly portrait: string;
  lastHello = -100;
  head: THREE.Object3D | null = null;
  building: Promise<void> | null = null;
  constructor(readonly def: KeeperDef, private readonly g: Game) {
    this.at = new THREE.Vector3(def.x, 0, def.z);
    this.portrait = def.portrait ?? `art/portraits/${def.spec.race}-${def.spec.sex}.webp`;
  }
  greet(): void {
    const u = this.unit, p = this.g.player;
    if (!u) return;
    p.setTarget(null);
    u.setYaw(yawTo(u.pos.x, u.pos.z, p.unit.pos.x, p.unit.pos.z));
    u.express('happy', 1.2);
    u.act('gesture_hello');
  }
}

const say = (text: Text | (() => string)) => (typeof text === 'function' ? text() : t(...text));

export class TidecrownKeepers {
  private readonly posts: Post[] = [];
  private shown = false;
  private readonly cam = new THREE.Vector3();

  constructor(private readonly g: Game) {}

  /** Registers a keeper; its crab is built on the next entry into the capital. */
  add(def: KeeperDef): Keeper {
    if (this.posts.some((p) => p.def.id === def.id)) throw new Error(`Keeper ${def.id} is registered twice`);
    const post = new Post(def, this.g);
    this.posts.push(post);
    return post;
  }

  /** The keepers' crabs (for the shader warm-up). */
  get units(): Unit[] { return this.posts.flatMap((p) => (p.unit ? [p.unit] : [])); }

  /** Builds every keeper not built yet, one after another and each once (a retry after a failed load adds nothing twice). */
  async load(island: TidecrownIsland): Promise<void> {
    if (this.g.serverMode) return;
    for (const post of this.posts) if (!post.unit) await (post.building ??= this.build(post, island).finally(() => { post.building = null; }));
  }

  private async build(post: Post, island: TidecrownIsland): Promise<void> {
    const def = post.def, rig = await createCrab(def.spec, [...(def.extras ?? [])]);
    (rig as CrabRig & { useShadowProxy?: (on: boolean) => void }).useShadowProxy?.(true);
    if (def.head) {
      const { piece, top } = def.head();
      rig.getSocket('head').add(piece);
      (rig as CrabRig & { updateNameplate?: (top: number) => void }).updateNameplate?.(top);
      post.head = piece;
    }
    if (def.scale) rig.root.scale.setScalar(def.scale);
    const unit = new Unit(t(...def.name), 'npc', 'friendly', rig, createMotionController(rig));
    unit.npcId = def.id;
    unit.title = say(def.title);
    unit.hidden = true;
    rig.root.visible = false;
    unit.measure();
    this.g.scene.add(rig.root);
    const out = new THREE.Vector2();
    island.resolve(def.x, def.z, unit.radius + 0.2, out);
    post.at.set(out.x, island.height(out.x, out.y), out.y);
    post.unit = unit;
    if (this.shown) this.place(post);
  }

  private place(post: Post): void {
    const u = post.unit;
    if (!u) return;
    u.hidden = false;
    // Drawn from the start, so the warm-up behind the loading screen compiles its shaders; culling follows next frame.
    u.rig.root.visible = true;
    u.teleport(this.g.world, post.at.x, post.at.z, post.def.yaw);
    this.g.hud.plates.also.add(u);
  }

  show(): void {
    if (this.shown || this.g.serverMode) return;
    this.shown = true;
    for (const post of this.posts) this.place(post);
  }

  hide(): void {
    this.shown = false;
    for (const { unit: u } of this.posts) {
      if (!u) continue;
      if (this.g.hud.dialogue.unit === u) this.g.hud.dialogue.close();
      u.hidden = true;
      u.rig.root.visible = false;
      this.g.hud.plates.also.delete(u);
    }
  }

  /** The nearest keeper with an F point, shown and loaded; null if none. */
  nearest(x: number, z: number): Keeper | null {
    if (!this.shown) return null;
    let best: Post | null = null, d = Infinity;
    for (const post of this.posts) {
      if (!post.unit || !post.def.talk) continue;
      const dd = Math.hypot(x - post.at.x, z - post.at.z);
      if (dd < d) { d = dd; best = post; }
    }
    return best;
  }

  /** The keeper standing at `at` (a point nearest() gave). */
  keeperAt(at: THREE.Vector3): Keeper | null { return this.posts.find((p) => p.at === at) ?? null; }

  prompt(k: Keeper): string {
    return k.def.prompt ? say(k.def.prompt) : t(`${k.def.name[0]}에게 말 걸기`, `Talk to ${k.def.name[1]}`);
  }

  /** Gold minimap marks for the keepers that have one. */
  markers(): { at: THREE.Vector3; label: string }[] {
    return this.shown ? this.posts.flatMap((p) => (p.unit && p.def.marker ? [{ at: p.at, label: t(...p.def.marker) }] : [])) : [];
  }

  update(dt: number, time: number): void {
    if (!this.shown) return;
    const g = this.g, player = g.player.unit;
    const camera = g.camera.position, pxPerUnit = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(g.camera.fov / 2)));
    for (const post of this.posts) {
      const u = post.unit;
      if (!u) continue;
      u.name = t(...post.def.name);
      u.title = say(post.def.title);
      const near = u.distTo(player), talking = g.hud.dialogue.unit === u;
      // Facing whoever comes near; back to the post once they go.
      u.setYaw(turnToward(u.yaw, talking || near < 7 ? yawTo(u.pos.x, u.pos.z, player.pos.x, player.pos.z) : post.def.yaw, 2.4, dt));
      if (!talking && near < 5 && time - post.lastHello > 35 && !u.motion.action) {
        u.act('gesture_hello');
        u.express('happy', 1.2);
        post.lastHello = time;
      }
      u.feedLocomotion(dt);
      // The game draws only its own units; keepers get the same culling, detail and shadow rules.
      const d = this.cam.copy(camera).distanceTo(u.pos);
      u.culled = d > 80;
      u.rig.root.visible = !u.culled && !u.hidden;
      u.lod = (u.height * pxPerUnit) / Math.max(d, 0.1) < (u.lod ? 110 : 90) ? 1 : 0;
      u.rig.setLod?.(u.lod);
      u.setShadows(d < 18);
      u.updateVisual(dt);
    }
  }

  dispose(): void {
    this.hide();
    for (const post of this.posts) {
      const u = post.unit;
      if (!u) continue;
      this.g.scene.remove(u.rig.root);
      post.head?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
      });
      u.dispose();
      post.unit = null;
      post.head = null;
    }
  }
}
