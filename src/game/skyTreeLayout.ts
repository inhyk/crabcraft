import type {Collision} from '../world/collision';

/*
 * World VI's world tree and sanctuary, as numbers both the scenery (skyWorldTree.ts, skySanctuary.ts) and the
 * colliders (layoutFrontier(6) via layoutSkyTree) read, so the server's solids sit exactly under the meshes.
 */

/** Trunk foot: the old landmark spot, north of the sanctuary court, 13 to 15 m from the island's north lip. */
export const SKY_TREE={x:0,z:-112};
/** Sanctuary court centre and radius (the boss arena). */
export const SKY_COURT={x:0,z:-72,radius:20};
/** Trunk core radius at the ground (without the buttress flanks) and the fork's height. */
export const SKY_TRUNK={radius:7.4,fork:31};
/**
 * Buttress flanks as [azimuth (atan2(z,x) from the trunk), reach (m), strength]: each runs out into a surface root.
 * The crown leans south and west, so the northern flanks are the big ones; they reach the lip and pour over it.
 */
export const SKY_BUTTRESSES:readonly (readonly [number,number,number])[]=[
 [1.08,15,.9],[2.05,14.5,.85],[2.95,16,.95],[3.85,18,1.1],[4.72,17,1.15],[5.5,18,1.1],[.25,16,.95],
];
/** The two root arches: they leave the trunk and dive back into the ground at these feet. */
export const SKY_ROOT_ARCH_FEET:readonly (readonly [number,number])[]=[[24.5,-100],[-24.5,-100]];
/**
 * The root gate over the approach road, behind the arena camera and clear of the lighthouse and quest points: a tall
 * pointed arch whose crown rises out of the approach views' frame, so its posts frame the trunk instead of crossing it.
 */
export const SKY_GATE={z:-40,halfSpan:9.2,height:21};
/** Where the spring leaves the roots and pours over the north lip (x, z on the lip). */
export const SKY_SPRING={x:-4.5,z:-126.2};

/** World VI only: the trunk with its buttress flanks, the root arches' feet and the gate posts. */
export function layoutSkyTree(col:Collision,heightAt:(x:number,z:number)=>number){
 const y=heightAt(SKY_TREE.x,SKY_TREE.z);
 col.addCircle(SKY_TREE.x,SKY_TREE.z,SKY_TRUNK.radius+.4,y-1,y+SKY_TRUNK.fork);
 // Each flank is a wall of wood tapering out from the trunk: two circles along it keep crabs off its blade.
 for(const [a,reach,s] of SKY_BUTTRESSES)for(const [f,r] of [[.6,1.9*s],[.8,1.2*s]] as const){
  const x=SKY_TREE.x+Math.cos(a)*reach*f,z=SKY_TREE.z+Math.sin(a)*reach*f,g=heightAt(x,z);col.addCircle(x,z,r,g-1,g+3.5);
 }
 for(const [x,z] of SKY_ROOT_ARCH_FEET){const g=heightAt(x,z);col.addCircle(x,z,1.3,g-1,g+3);}
 for(const side of [-1,1]){const x=side*SKY_GATE.halfSpan,g=heightAt(x,SKY_GATE.z);col.addCircle(x,SKY_GATE.z,1.35,g-1,g+12);}
}
