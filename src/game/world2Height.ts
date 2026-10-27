import {MathUtils} from 'three';
import {STAR_OBJECTIVES} from './world2Settlement';
import {STAR_GRID,starSurfaceHeight} from '../sim/world/ground';
import {STAR_CAMP,STAR_CRATER,STAR_KEEP_POINTS,starBluff,starCoast,starFbm,starNoise,starSand} from './starFieldLayout';

const {nx:NX,nz:NZ,step:STEP,minX:MIN_X,minZ:MIN_Z}=STAR_GRID;
const smooth=MathUtils.smoothstep;

function naturalHeight(x:number,z:number){
  const r=Math.hypot(x/115,(z-10)/140),coast=MathUtils.smoothstep(r,.83,1.04);
  return 7*(1-MathUtils.smoothstep(Math.hypot(x-27,z+19),5,28))+3+Math.sin(x*.08)*Math.cos(z*.06)*1.8+Math.max(0,r-.65)*12-coast*21;
}

const rect=(x:number,z:number,ax:number,bx:number,az:number,bz:number)=>Math.hypot(Math.max(ax-x,0,x-bx),Math.max(az-z,0,z-bz));
/** Distance outside the town, the avenue and the boss floor (0 inside them). */
const playDistance=(x:number,z:number)=>Math.min(Math.max(0,Math.hypot(x,z+75)-24),rect(x,z,-9,9,-100,105),rect(x,z,-54,54,3,100));

/** The pre-2026-10-28 island: town, avenue and arena level, the exploration medallions flattened. */
export function starBaseHeight(x:number,z:number){
  let y=naturalHeight(x,z);
  for(const kind of ['explore-west','explore-east'] as const){
    const p=STAR_OBJECTIVES[kind]!,d=Math.hypot(x-p[0],z-p[1]);
    if(d<13)y=MathUtils.lerp(naturalHeight(...p),y,MathUtils.smoothstep(d,8,13));
  }
  // Keep the existing town, avenue and boss floor level; blend their outer edges into hills.
  return MathUtils.lerp(3,y,MathUtils.smoothstep(playDistance(x,z),0,6));
}

/**
 * 0 where gameplay needs the old ground exactly (town, avenue, arena, objectives and their approaches), rising to 1
 * in the open country. Zero reaches 3 m past each area, beyond the 2 m grid's reach into a triangle, so every point
 * inside an area keeps its exact height.
 */
export function starReliefKeep(x:number,z:number){
  let keep=smooth(playDistance(x,z),3,15);
  for(const [kind,p] of Object.entries(STAR_OBJECTIVES)){
    const d=Math.hypot(x-p[0],z-p[1]),explore=kind.startsWith('explore-');
    keep=Math.min(keep,smooth(d,explore?16:7,explore?27:15));
  }
  for(const [px,pz,r] of STAR_KEEP_POINTS)keep=Math.min(keep,smooth(Math.hypot(x-px,z-pz),r,r+8));
  return keep;
}

/**
 * The country's shape, added outside the play areas: broad grassy rises, dunes along the beaches, bluffs where the
 * coast faces the open sea, the stargazer's knoll and the fallen star's crater. Underwater the island is unchanged.
 */
export function starRelief(x:number,z:number){
  const {r}=starCoast(x,z);
  if(r>.97)return 0;
  const bluff=starBluff(x,z),sand=starSand(x,z),shore=1-smooth(r,.86,.93);
  // Rounded rises with flat-bottomed hollows between them, fading toward the shore.
  const f=starFbm(x/42,z/42,3,3),rises=(Math.max(0,f+.1)*4.2+f*1.1)*(1-smooth(r,.74,.88)*.7);
  // Swells a few metres across break up the meadows.
  const swell=starNoise(x/11,z/11,5)*.55*(1-sand);
  // Dunes: crests across the sea wind, a long windward back and a short lee, wandering along their length.
  const s=(x*.8+z*.6)/9+starNoise(x/27,z/27,9)*1.4,c=s-Math.floor(s),dune=(c<.72?smooth(c,0,.72):1-smooth(c,.72,1))*(.55+.45*starNoise(x/19,z/19,11));
  const dunes=dune*1.5*sand*shore;
  // Beaches drop to a gentle strand; bluffs stand up from the sea and break off steeply at the waterline.
  const beachTarget=1.4-4.8*smooth(r,.84,.935),base=naturalHeight(x,z);
  const beach=(beachTarget-base)*(1-bluff)*smooth(r,.77,.83)*(1-smooth(r,.935,.97));
  const cliff=bluff*(4.6+1.6*starNoise(x/14,z/14,13))*smooth(r,.64,.8)*(1-smooth(r,.872,.902));
  // The stargazer's knoll: a rounded hill with a level crown for the camp.
  const dk=Math.hypot(x-STAR_CAMP.x,z-STAR_CAMP.z)/STAR_CAMP.r,knoll=3.4*smooth(1-dk,0,.65);
  // The crater: a bowl and the rim it threw up, ragged round the edge.
  const dc=Math.hypot(x-STAR_CRATER.x,z-STAR_CRATER.z)/(STAR_CRATER.r*(1+.08*starNoise(x*.4,z*.4,17)));
  const crater=-2.1*Math.max(0,1-dc*dc)+.95*Math.exp(-(((dc-1.12)/.32)**2));
  return rises+swell+dunes+beach+cliff+knoll+crater;
}

function shapedHeight(x:number,z:number){
  return starBaseHeight(x,z)+starRelief(x,z)*starReliefKeep(x,z);
}

export function buildStarHeights(){
  const heights=new Float32Array(NX*NZ);
  for(let z=0;z<NZ;z++)for(let x=0;x<NX;x++)heights[z*NX+x]=shapedHeight(MIN_X+x*STEP,MIN_Z+z*STEP);
  return heights;
}

export {starSurfaceHeight};
