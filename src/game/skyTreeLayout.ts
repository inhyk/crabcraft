import type {Collision} from '../world/collision';

/*
 * World VI's world tree and sanctuary, as numbers both the scenery (skyWorldTree.ts, skySanctuary.ts) and the
 * colliders (layoutFrontier(6) via layoutSkyTree) read, so the server's solids sit exactly under the meshes.
 */

/** Trunk foot: the old landmark spot, north of the sanctuary court. */
export const SKY_TREE={x:0,z:-112};
/** Sanctuary court centre and radius (the boss arena). */
export const SKY_COURT={x:0,z:-72,radius:20};
/** Buttress flanks as [azimuth (atan2(z,x) from the trunk), reach (m), strength]: each runs out into a surface root. */
export const SKY_BUTTRESSES:readonly (readonly [number,number,number])[]=[
 [1.12,12.5,1],[2.02,12,.95],[2.95,11,.8],[3.9,11.5,.9],[4.72,12.5,1],[5.55,11,.85],[.28,11.5,.9],
];
/** The two root arches: they leave the trunk and dive back into the ground at these feet. */
export const SKY_ROOT_ARCH_FEET:readonly (readonly [number,number])[]=[[22.5,-101],[-22.5,-101]];
/** The root gate over the approach road, behind the arena camera and clear of the lighthouse and quest points: its two posts. */
export const SKY_GATE={z:-40,halfSpan:7.4,height:11.5};

/** World VI only: the trunk with its buttress flanks, the root arches' feet and the gate posts. */
export function layoutSkyTree(col:Collision,heightAt:(x:number,z:number)=>number){
 const y=heightAt(SKY_TREE.x,SKY_TREE.z);
 col.addCircle(SKY_TREE.x,SKY_TREE.z,6.2,y-1,y+36);
 // Each flank is a wall of wood tapering out from the trunk: two circles along it keep crabs off its blade.
 for(const [a,reach] of SKY_BUTTRESSES)for(const [f,r] of [[.62,1.7],[.82,1.1]] as const){
  const x=SKY_TREE.x+Math.cos(a)*reach*f,z=SKY_TREE.z+Math.sin(a)*reach*f,g=heightAt(x,z);col.addCircle(x,z,r,g-1,g+3);
 }
 for(const [x,z] of SKY_ROOT_ARCH_FEET){const g=heightAt(x,z);col.addCircle(x,z,1.2,g-1,g+3);}
 for(const side of [-1,1]){const x=side*SKY_GATE.halfSpan,g=heightAt(x,SKY_GATE.z);col.addCircle(x,SKY_GATE.z,1.25,g-1,g+SKY_GATE.height);}
}
