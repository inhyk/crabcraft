import type {CharacterId} from '../types.ts';
import type {DungeonRunKey} from './dungeon.ts';
import {dungeonFor,type DungeonTier} from '../data/dungeons.ts';
import {freezeValue} from '../events.ts';
export interface DungeonFeatureAward {readonly schema:'dungeon-award-v1';readonly id:string;readonly run:DungeonRunKey;readonly tier:DungeonTier;readonly recipient:CharacterId;readonly baseXp:number;readonly coins:number}
export const MAX_FEATURE_AWARD_PAGE=100;
export const MAX_FEATURE_AWARD_RECEIPTS=256;
/** Reject getters, hidden fields, sparse arrays and excessive graphs before reading JSON values. */
export function detachFeatureData<T>(input:T,maxBytes=262144):T {
 const active=new Set<object>();let nodes=0;
 const visit=(value:unknown,depth:number):unknown=>{
  if(++nodes>16384||depth>16)throw new Error('Invalid feature data complexity');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||active.has(value)||Object.getOwnPropertySymbols(value).length)throw new Error('Invalid feature data');
  const array=Array.isArray(value),keys=Object.getOwnPropertyNames(value);if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('Invalid feature prototype');
  if(array&&(keys.length!==value.length+1||keys.some(k=>k!=='length'&&(!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=value.length))))throw new Error('Invalid feature array');
  active.add(value);const out:Record<string,unknown>|unknown[]=array?[]:{};
  for(const k of keys){if(array&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(value,k)!;if(!d.enumerable||!('value'in d)||k==='__proto__')throw new Error('Invalid feature descriptor');Object.defineProperty(out,k,{value:visit(d.value,depth+1),enumerable:true,writable:true,configurable:true});}active.delete(value);return out;
 };
 const out=visit(input,0);if(new TextEncoder().encode(JSON.stringify(out)).length>maxBytes)throw new Error('Feature data byte limit');return out as T;
}
function fields(value:unknown,names:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid feature object');const v=value as Record<string,unknown>;if(Object.keys(v).length!==names.length||names.some(k=>!Object.hasOwn(v,k)))throw new Error('Invalid feature fields');return v;}
function text(value:unknown,max:number):asserts value is string {if(typeof value!=='string'||!value.length||new TextEncoder().encode(value).length>max||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value))throw new Error('Invalid feature identity');}
export function dungeonAwardId(run:DungeonRunKey,recipient:CharacterId):string{return JSON.stringify(['dungeon-award-v1',run.area,run.runId,recipient]);}
/** Amounts are immutable journal facts, deliberately not recomputed from the newest tier catalog. */
export function validateDungeonFeatureAward(value:unknown,recipient?:CharacterId):Readonly<DungeonFeatureAward>{
 const v=fields(detachFeatureData(value,8192),['schema','id','run','tier','recipient','baseXp','coins']),run=fields(v.run,['area','runId']);
 if(v.schema!=='dungeon-award-v1'||!dungeonFor(v.tier as number))throw new Error('Invalid dungeon award schema/tier');text(run.area,256);text(run.runId,512);if(run.runId.length>128)throw new Error('Invalid feature run');text(v.recipient,512);text(v.id,2048);
 if(v.id!==dungeonAwardId(run as unknown as DungeonRunKey,v.recipient)||recipient!==undefined&&v.recipient!==recipient)throw new Error('Invalid dungeon award identity');for(const n of [v.baseXp,v.coins])if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw new Error('Invalid dungeon award amount');return freezeValue(v as unknown as DungeonFeatureAward);
}
