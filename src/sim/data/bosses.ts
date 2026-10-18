import type { BossProfileId, MechId } from '../types.ts';
export type { BossProfileId } from '../types.ts';
export interface BossProfile { level:number; hp:number; damage:number; tempo:number; color:string; reward:number; coins:number }
export const BOSS_PROFILES: Readonly<Record<BossProfileId, Readonly<BossProfile>>> = Object.freeze({
  rust:Object.freeze({level:3,hp:1300,damage:1,tempo:1,color:'#ff672e',reward:500,coins:150}),
  abyss:Object.freeze({level:10,hp:2600,damage:2.1,tempo:.85,color:'#58e5ff',reward:1000,coins:500}),
  eclipse:Object.freeze({level:20,hp:6200,damage:3.2,tempo:.78,color:'#bf8aff',reward:1500,coins:1200}),
  dawn:Object.freeze({level:100,hp:24000,damage:20,tempo:.95,color:'#ffb44f',reward:3200,coins:5000}),
  frost:Object.freeze({level:300,hp:90000,damage:38,tempo:.9,color:'#8feaff',reward:18000,coins:15000}),
});
export function mechanicOrder(profile:BossProfileId,phase:number):readonly MechId[]{
  if(profile==='frost')return phase===1?['eclipse','spray','barrage','undertow','slam']:phase===2?['undertow','nova','eclipse','barrage','spray','cross']:['eclipse','undertow','barrage','nova','spray','cross','slam'];
  if(profile==='dawn')return phase===1?['cross','barrage','slam','nova','spray']:phase===2?['barrage','eclipse','cross','nova','undertow','slam']:['cross','barrage','eclipse','nova','cross','undertow','barrage','slam'];
  if(profile==='eclipse')return phase===1?['slam','eclipse','nova','cross','barrage']:['eclipse','nova','undertow','cross','barrage','eclipse'];
  if(profile==='abyss')return phase===1?['slam','nova','spray','cross','barrage']:['nova','undertow','slam','cross','barrage','nova'];
  return phase===1?['slam','spray']:phase===2?['undertow','slam','spray','cross','slam']:['slam','spray','undertow','cross','barrage'];
}
export function mechanicFraction(dawn:boolean,kind:MechId):number{return (dawn?{slam:.26,nova:.30,eclipse:.34,cross:.24,barrage:.22,undertow:.24,spray:.2}:{slam:.26,nova:.32,eclipse:.38,cross:.28,barrage:.24,undertow:.24,spray:.2})[kind];}
export function mechanicRadius(dawn:boolean,kind:MechId):number{return kind==='eclipse'?(dawn?14:11):kind==='slam'?(dawn?4.8:3.4):kind==='nova'?(dawn?8:6):dawn?6.5:5.5;}
