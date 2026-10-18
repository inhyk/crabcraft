import { upgradeCost } from './equipment.ts';
import type { AreaContext, Chapter } from '../types.ts';
/** Numeric rules extracted from S1 progression.ts, reviewed 28816e2. */
export const LEVEL_XP: readonly number[] = Object.freeze([0,300,900,1400,2000,2700,3500,4400,5400,6500,7600,8800,10100,11500,13000,14600,16300,18100,20000,22000]);
export function xpForLevel(level:number):number { const n=Math.max(0,Math.floor(level)-20);return level<=20?LEVEL_XP[Math.max(0,Math.floor(level)-1)]:22000+2200*n+100*n*(n-1); }
export function levelForXp(xp:number):number { return xp<22000?LEVEL_XP.reduce((level,threshold,i)=>xp>=threshold?i+1:level,1):20+Math.floor((-2100+Math.sqrt(4410000+400*(xp-22000)))/200); }
export const patrolReward=(level:number):number=>180+Math.max(1,level)*50;
export const forgeCost=upgradeCost;
export const canChallenge=(level:number,required:number,rustCleared:boolean,abyssCleared=false,chapter=1):boolean=>level>=required&&(required===300?chapter===4&&abyssCleared:required===100?chapter===3&&abyssCleared:required===20?chapter===2&&abyssCleared:chapter===1&&(required===3||rustCleared));
export const canTravelTo=(chapter:Chapter, flags:Readonly<Record<string,boolean>>):boolean=>chapter===1||(chapter>=5?!!flags.frostCleared:chapter===4?!!flags.finalCleared:!!flags.abyssCleared&&(chapter===2||!!flags.trueCleared));

/** Story unlock differs from replay: only the Frost victory opens the four-island ending. */
export const canReplayFrostEnding=(chapter:Chapter,flags:Readonly<Record<string,boolean>>,bossState:string,controlsLocked=false):boolean=>chapter===4&&!!flags.frostCleared&&bossState==='dead'&&!controlsLocked;

/** Public areas have no story controller; only trusted personal completion can authorize their ending. */
export function canPresentFrostEnding(mode:AreaContext['mode'],chapter:Chapter,flags:Readonly<Record<string,boolean>>,bossState:string|null,controlsLocked=false):boolean {if(mode==='public'&&bossState===null)return chapter===4&&!!flags.frostCleared&&!controlsLocked;return canReplayFrostEnding(chapter,flags,bossState??'dormant',controlsLocked);}
