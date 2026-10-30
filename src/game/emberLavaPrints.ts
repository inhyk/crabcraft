import type { LavaFlow } from './emberLavaFlow';

/*
 * Prints in World V's simulated lava: a crab wading through a lobe parts it, a trench round its legs with the pushed-out
 * lava piled as a berm, which closes again over a few seconds once it has passed; in cooled crust it leaves a shallow
 * dent with a cracked rim that stays (it only sinks with the rock). The lava itself does it (emberLavaFlow.ts, the press
 * in the yield-film pass); this file picks the crabs that press and draws the broken skin.
 *
 * Every visible, living crab standing on the reach presses (the local player, other players, NPCs), at most eight, the
 * nearest to the local player first. A crab more than PRESS_LIFT above the ground under it is in the air and does not.
 * The tongues on the cone and the crater lip are analytic meshes and take no prints.
 */

/** What a crab needs to press the lava (Unit has all of it). */
export interface LavaWader {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
  readonly alive: boolean;
  readonly hidden: boolean;
  readonly rig: { readonly root: { readonly visible: boolean } };
}

/** Body radius to press radius: the legs reach past the shell's collision circle. */
const PRESS_SCALE = 1.1;
/** Over this height above the ground a crab is jumping or flying, m. */
const PRESS_LIFT = .35;
const MAX_WADERS = 8;

const pick: LavaWader[] = [];
const dist: number[] = [];

/** Sets the flow's presses for this frame from the crabs; `focus` is the local player (nearest crabs win). */
export function pressLava(flow: LavaFlow, waders: readonly LavaWader[] | undefined, focus?: LavaWader) {
  flow.clearPresses();
  if (!waders || !flow.prints) return;
  pick.length = 0; dist.length = 0;
  const fx = focus?.pos.x ?? 0, fz = focus?.pos.z ?? 0;
  for (const u of waders) {
    if (!u.alive || u.hidden || !u.rig.root.visible) continue;
    const { x, y, z } = u.pos;
    const k = flow.cellAt(x, z);
    if (k < 0 || flow.base[k * 4 + 1] < .5 || y - flow.base[k * 4] > PRESS_LIFT) continue;
    const d = (x - fx) ** 2 + (z - fz) ** 2;
    // Insertion into the nearest MAX_WADERS (a handful of crabs at most stand in the lava).
    let i = pick.length;
    if (i === MAX_WADERS) { if (d >= dist[i - 1]) continue; i--; } else { pick.push(u); dist.push(d); }
    while (i > 0 && dist[i - 1] > d) { pick[i] = pick[i - 1]; dist[i] = dist[i - 1]; i--; }
    pick[i] = u; dist[i] = d;
  }
  for (const u of pick) flow.setPress(u.pos.x, u.pos.z, Math.min(Math.max(u.radius * PRESS_SCALE, .4), 1.6));
  pick.length = 0;
}

/** Fragment uniform of the prints (LavaFlow.uniforms.uFR2: broken-skin glow, dent in cold rock, print memory). */
export const PRINT_FRAG_HEAD = 'uniform sampler2D uFR2;';

/** Inside FLOW_COLOR's block, at its end (it uses the block's crust and heat terms). Where a crab broke the skin the
 * cracks open wide and the inside's heat shows, more the more it broke, re-skinning as the glow fades; the closing
 * trench is lava on the move (it has a time term while the print memory lasts). Round a dent in cold rock the crust is
 * cracked into fine plates, a dull red deep in them while the rock is still warm; that has no time term. */
export const PRINT_COLOR = /* glsl */ `
{
  vec4 pp=texture2D(uFR2,vFU);
  float pg=pp.r,pd=pp.g,pm=pp.b;
  lStatic*=1.-step(1e-3,pg+pm);
  float ow=cw+.14*pg;
  float open=1.-smoothstep(ow-aS-.01,ow+aS+.01,lC.r);
  float br=pg*open;
  lCrack=max(lCrack,br);
  diffuseColor.rgb*=1.-br;
  lEmit+=lavaBB(inner*mix(.75,1.,pg)*(.86+.14*nz))*br;
  float cold=1.-hot;
  float rim=smoothstep(.003,.02,-pd)*cold,flr=smoothstep(.008,.04,pd)*cold;
  // The rim breaks along the plates' cracks (opened wider) and new fine cracks between them; the floor is crust crushed
  // to a duller, paler grit, glassy skin gone.
  float rp=1.-smoothstep(cw*2.2-aS,cw*2.2+aS,lC.r);
  float rf=1.-smoothstep(.0,.12+fwidth(lC.b),lC.b);
  float rc=max(rp,rf*(.5+.5*nz))*max(rim,.55*flr);
  lCrack=max(lCrack,rc);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.05,.045,.043)*(.7+.6*nz),.8*flr*(1.-rc));
  diffuseColor.rgb*=1.-.85*rc;
  lCav*=1.-.6*rc;
  lEmit+=lavaBB(inner*.9)*rc*smoothstep(.12,.3,T);
  lGloss*=1.-max(br,max(rc,flr));
}
`;
