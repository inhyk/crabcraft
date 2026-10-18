import { ACHIEVEMENT_IDS } from '../../../src/sim/persistence.ts';
import type { CoreEvent, EntityRef, EventRecord } from '../../../src/sim/types.ts';
import { actionState, bool, catalogValue, choice, encodeMessage, fail, integer, list, nullable, number, object, reference, text, vector } from './protocol.ts';
import type { GameplayCatalog, WireHeader } from './protocol.ts';
export interface CommandResult {inputSequence:number;commandIndex:number;status:'succeeded'|'failed'|'durable';code:string;request?:number;revision?:number}
export interface EventPayload {baselineSequence:number;events:readonly EventRecord[];results:readonly CommandResult[]}
function shape(value:unknown,impact=false):void {
 if(!value||typeof value!=='object')fail('invalid effect shape');const s=value as Record<string,unknown>,tag=impact?'fx':'shape',kind=s[tag],base={[tag]:choice(kind),at:vector};
 if(!impact&&kind==='circle')object(s,{...base,radius:number,ground:vector},{color:text});
 else if(!impact&&kind==='cone')object(s,{...base,yaw:number,range:number,half:number,ground:vector},{color:text});
 else if(!impact&&kind==='undertow')object(s,{...base,radius:number});
 else if(kind==='lane')object(s,{...base,yaw:number,halfLength:number,halfWidth:number,color:text,...(impact?{seconds:number}:{})});
 else if(impact&&kind==='slam')object(s,{...base,radius:number});
 else if(impact&&kind==='ring')object(s,{...base,color:text,r0:number,r1:number,seconds:number,inner:number});
 else if(impact&&kind==='spray')object(s,{...base,yaw:number,range:number,half:number});else fail('unknown shape');
}
export function validateEvent(value:unknown,c:GameplayCatalog,area:string):asserts value is EventRecord {
 object(value,{tick:integer,order:integer,event:v=>{
  if(!v||typeof v!=='object')fail('invalid event');const e=v as Record<string,unknown>,type=choice(e.type),ref=(x:unknown)=>reference(x,area),nref=nullable(ref),ability=catalogValue(c.abilities),school=choice('physical','frost','water','holy','rust'),mech=choice('slam','spray','undertow','cross','barrage','nova','eclipse'),style=choice('bubble','spark','holy','rust');
  switch(e.type){
   case 'damage':object(e,{type,src:nref,dst:ref,amount:number,crit:bool},{school});break;
   case 'heal':object(e,{type,src:nref,dst:ref,amount:number,crit:bool});break;
   case 'blocked':object(e,{type,unit:ref,reason:choice('evade','absorbed')});break;
   case 'death':object(e,{type,unit:ref,killer:nref});break;
   case 'buff':object(e,{type,unit:ref,buff:choice('rust'),stacks:number});break;
   case 'ward':object(e,{type,unit:ref,stage:choice('up','hit','down')},{seconds:number});break;
   case 'castStart':object(e,{type,unit:ref,seconds:number},{ability,channel:x=>object(x,{kind:choice('recall','beacon','waystone','lighthouse-secret'),to:vector,start:number,end:number})});break;
   case 'castEnd':object(e,{type,unit:ref,channel:bool,result:choice('done','interrupted')},{reason:text});break;
   case 'ability':object(e,{type,caster:ref,ability,stage:choice('start','hit')},{target:nref,from:vector,yaw:number,range:number,half:number,amount:number,stun:number});break;
   case 'projectile':if(e.stage==='spawn')object(e,{type,stage:choice('spawn'),id:x=>integer(x,1,0xffffffff),src:ref,target:ref,from:vector,style,speed:number});else object(e,{type,stage:choice('hit'),id:x=>integer(x,1,0xffffffff),src:ref,target:ref,style,landed:bool});break;
   case 'press':object(e,{type,unit:ref,slot:x=>integer(x,1,5)});break;
   case 'error':object(e,{type,unit:ref,reason:text});break;
   case 'target':object(e,{type,unit:ref,target:nref});break;
   case 'jump':case 'footstep':case 'recall':case 'aggro':case 'spawn':case 'leash':case 'freed':object(e,{type,unit:ref});break;
   case 'dance':object(e,{type,unit:ref,stage:choice('start','moment','stop')},{moment:text,move:catalogValue(c.actions)});break;
   case 'xp':object(e,{type,unit:ref,amount:number});break;
   case 'levelUp':object(e,{type,unit:ref,level:x=>integer(x,1),oldMaxHp:number,maxHp:number,jump:bool});break;
   case 'attack':object(e,{type,src:ref,attack:catalogValue([...c.abilities,'warrior-auto','ranged-auto','enemy-claw','enemy-sea-cast','enemy-leap','boss-claw']),stage:choice('start','hit')},{target:ref,at:vector});break;
   case 'telegraph':object(e,{type,src:ref,mech,level:x=>integer(x,1),seconds:number,shapes:list(x=>shape(x),64)});break;
   case 'telegraphEnd':object(e,{type,src:ref,cancelled:bool});break;
   case 'impact':object(e,{type,src:ref,mech,shapes:list(x=>shape(x,true),64),loud:bool});break;
   case 'boss':object(e,{type,boss:ref,stage:choice('engage','awake','phase','reset','death','frame')},{phase:integer,show:bool});break;
   case 'say':object(e,{type,unit:ref,textKey:text,yell:bool});break;
   case 'loot':object(e,{type,unit:ref,recipient:ref,item:choice('cog')});break;
   case 'victory':object(e,{type,boss:ref,recipients:list(ref,100),stage:choice('banner','end')});break;
   case 'action':object(e,{type,unit:ref,action:nullable(x=>actionState(x,c))});break;
   case 'rootRebase':object(e,{type,unit:ref,generation:x=>integer(x,1),root:x=>object(x,{x:number,z:number,yaw:number}),position:vector,yaw:number});break;
   case 'reward':object(e,{type,grant:x=>object(x,{id:v=>text(v,1024),victim:reference,recipient:text,xp:number,coins:number,objectives:list(y=>object(y,{kind:text,amount:number}),64),flags:list(catalogValue(c.flags),64)}),appliedHere:bool});break;
   case 'respawn':object(e,{type,unit:ref,position:vector,yaw:number});break;
   case 'quest':object(e,{type,unit:ref,quest:catalogValue(c.quests),stage:choice('accepted','progress','ready','completed')},{objective:catalogValue(c.objectives),value:number});break;
   case 'equipment':object(e,{type,unit:ref,slot:choice('weapon','armor'),operation:choice('buy','upgrade'),result:choice('bought','owned','busy','coins','upgraded','unowned','max')},{request:x=>integer(x,1)});break;
   case 'achievement':object(e,{type,unit:ref,achievement:catalogValue(ACHIEVEMENT_IDS)});break;
   case 'discovery':object(e,{type,unit:ref,discovery:choice('treasure','lighthouse-secret'),id:text,first:bool,coins:integer,activeUntil:nullable(number)});break;
   case 'endingReady':object(e,{type,unit:ref,chapter:choice(4),replay:bool});break;
   case 'travelReady':object(e,{type,unit:ref,destination:choice('w1','w2','w3','w4'),gate:catalogValue(c.gates)});break;
   case 'feature':object(e,{type,event:x=>validateFeatureEvent(x,area)});break;
   default:fail('unknown event');
  }
 }});
}
function validateFeatureEvent(v:unknown,area:string):void {
 if(!v||typeof v!=='object')fail('invalid feature event');const e=v as Record<string,unknown>,type=choice(e.type),ref=(x:unknown)=>reference(x,area);
 switch(e.type){
  case 'boatBoarded':object(e,{type,actor:ref,id:text,seat:x=>integer(x,0,1),voyage:text});break;
  case 'boatLeft':object(e,{type,actor:ref,id:text,x:number,z:number,shore:bool,voyage:text});break;
  case 'boatAchievement':object(e,{type,actor:ref,id:text,achievement:choice('sail','crew','landfall'),key:v=>text(v,512),distance:number});break;
  case 'villageStarted':object(e,{type,round:text,mode:choice('hide','tag'),members:list(text,100),seeker:text});break;
  case 'villageCaught':object(e,{type,round:text,actor:ref,id:text,outside:bool});break;
  case 'villageFinished':object(e,{type,round:text,result:choice('seekers','runners','cancelled'),key:v=>text(v,512)});break;
  case 'npcGreeting':object(e,{type,unit:ref,player:ref,expression:choice('happy'),seconds:choice(1.5)});break;
  case 'npcBark':object(e,{type,unit:ref,player:ref,bank:choice('shore','star','starVictory'),index:x=>integer(x,0,e.bank==='shore'?9:5)});break;
  default:fail('unknown feature event');
 }
}
export function validateResult(v:unknown):asserts v is CommandResult {
 object(v,{inputSequence:x=>integer(x,1),commandIndex:x=>integer(x,0,31),status:choice('succeeded','failed','durable'),code:text},{request:x=>integer(x,1),revision:integer});
 if(v.status==='durable'&&v.revision===undefined)fail('durable result requires committed revision');if(v.status!=='durable'&&v.revision!==undefined)fail('uncommitted revision');
}
export function validateEventPayload(p:unknown,c:GameplayCatalog,area:string):asserts p is EventPayload {
 object(p,{baselineSequence:x=>integer(x,1),events:list(v=>validateEvent(v,c,area),512),results:list(validateResult,256)});
 let order=-1;for(const e of p.events as EventRecord[]){if(e.order<=order)fail('unordered events');order=e.order;}
}
export function encodeEvents(header:WireHeader,payload:EventPayload,catalog:GameplayCatalog):Uint8Array[] {
 if(header.catalog!==catalog.version)fail('catalog mismatch');validateEventPayload(payload,catalog,header.area);return encodeMessage(2,header,payload);
}
const PERSONAL=new Set(['xp','quest','equipment','error','press','target','endingReady','travelReady','achievement','discovery']);
/** Privacy filtering precedes encoding. Actual source tick/order are retained, never resequenced. */
export function selectEvents(events:readonly EventRecord[],self:EntityRef,character:string,visible:ReadonlySet<number>):EventRecord[] {
 const same=(r:EntityRef)=>r.area===self.area&&r.id===self.id&&r.life===self.life;
 const hasVisible=(value:unknown):boolean=>{
  if(!value||typeof value!=='object')return false;
  if('area'in value&&'id'in value&&'life'in value){const r=value as EntityRef;return r.area===self.area&&visible.has(r.id);}
  return Object.values(value).some(x=>Array.isArray(x)?x.some(hasVisible):hasVisible(x));
 };
 return events.filter(record=>{
  const e=record.event as CoreEvent;
  if(e.type==='reward')return e.grant.recipient===character;
  if(PERSONAL.has(e.type))return 'unit'in e&&same(e.unit);
  if(e.type==='loot')return same(e.recipient);
  const generic=e as unknown as {type:string;event?:{type:string;actor?:EntityRef}};
  if(generic.type==='feature'&&generic.event?.type==='boatAchievement')return !!generic.event.actor&&same(generic.event.actor);
  // Shared village stage events contain stable public keys rather than unit references.
  if(generic.type==='feature'&&generic.event?.type.startsWith('village'))return true;
  return hasVisible(e);
 });
}
