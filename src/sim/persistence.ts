/** Strict new-character persistence. No legacy save normalization or offline policy defaults. */
import type { AbilityId, ChannelKind, ClassId, EarnedGrant, PlayerState, SimUnit, WorldId } from './types.ts';
import { CLASSES } from './data/classes.ts';
import { freshQuests, QUEST_ORDER, QUESTS } from './data/quests.ts';
import { levelForXp } from './data/progression.ts';
import { worldChapter } from './math.ts';

export const ACHIEVEMENT_IDS = Object.freeze(['sail','crew','landfall','island','treasure','moon','sunset','moonTreasure','sunsetTreasure','archipelago','rust','abyss','eclipse','dawn','secret']);
export const PERSONAL_FLAG_IDS = Object.freeze(['rustCleared','abyssCleared','trueCleared','finalCleared','frostCleared','firstEndingSeen','frostEndingStarted','beaconLit']);
export type CharacterAppearance = { race:'human'|'orc'|'dwarf'|'undead'|'nightelf'|'tauren'; sex:'male'|'female'; classId:ClassId; shell:number; crest:number; led:number; name:string };
export type CharacterIdentityV1 = { schema:'world-identity-v1'; classId:ClassId; archetype:string; appearance:CharacterAppearance };
export type LocationCheckpoint = { x:number; y:number; z:number; yaw:number };
export type DurationCheckpoint = { startAge:number; endRemaining:number };
export type AchievementCheckpoint = { earned:string[]; distance:number };
export type QuestCheckpoint = { chapter:1|2|3|4; status:Record<string,'locked'|'available'|'active'|'ready'|'done'>; progress:Record<string,number>; cogs:number; tracked:Partial<Record<1|2|3|4,string>> };
export type InterruptedActivity = {
 seated:boolean; village:boolean; controlsLocked:boolean;
 cast:({ability:AbilityId}&DurationCheckpoint)|null;
 channel:({kind:ChannelKind}&DurationCheckpoint)|null;
 dash:boolean; pendingHit:boolean; rootPending:boolean;
 motion:{velocityX:number;velocityZ:number;jumpRemaining:number;spinRemaining:number;pushX:number;pushZ:number;pushRemaining:number;lift:number;dashElapsed:number|null};
};
export type CharacterCheckpointV1 = {
 schema:'world-character-v1'; character:string; classId:ClassId; archetype:string; world:WorldId;
 location:LocationCheckpoint;
 progress:{ xp:number; coins:number; baseMaxHp:number; attackRank:number; armorRank:number; weaponOwned:boolean; armorOwned:boolean; quests:QuestCheckpoint; flags:Record<string,boolean>; cogMisses:number; achievements:AchievementCheckpoint; lighthouseSecretFound:boolean };
 survival:{ alive:boolean; hp:number; maxHp:number; resource:number; maxResource:number; respawnRemaining:number|null; cooldowns:Record<string,DurationCheckpoint>; gcd:DurationCheckpoint;
 statuses:{ stunRemaining:number; slowRemaining:number; slowPct:number; rustRemaining:number; rust:number; absorbRemaining:number; absorb:number; absorbMax:number; blessingRemaining:number; encounterBlessing:boolean; warded:boolean };
 history:{ combatAge:number; spendAge:number; attackAge:number; nextSwingRemaining:number } };
 activity:InterruptedActivity;
};
export type RestoredPlayerData = CharacterCheckpointV1;
export interface RestorePolicy { readonly version:string; restore(checkpoint:Readonly<CharacterCheckpointV1>,offlineSeconds:number):RestoredPlayerData }
export type IdentityJson = CharacterIdentityV1;
export type CheckpointJson = CharacterCheckpointV1;
export type GrantJson = { id:string; victim:{area:string;id:number;life:number}; recipient:string; xp:number;coins:number; objectives:{kind:string;amount:number}[];flags:string[] };
export type IdentityContext = { characterId:string; identity:CharacterIdentityV1 };
export interface CoreCharacterCodec {
 readonly version:1;
 validateIdentity(value:unknown):IdentityJson;
 fresh(context:IdentityContext):CheckpointJson;
 validateCheckpoint(value:unknown,context:IdentityContext):CheckpointJson;
 validateGrant(value:unknown,context:IdentityContext):GrantJson;
 toCore(value:CheckpointJson):CharacterCheckpointV1;
 toJson(value:CharacterCheckpointV1):CheckpointJson;
 grantToJson(value:EarnedGrant):GrantJson;
 grantFromJson(value:GrantJson):EarnedGrant;
}
function fail(path:string):never {throw new Error(`invalid-checkpoint:${path}`);}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
/** Validate data descriptors before reading values, so malformed inputs cannot execute getters. */
function detached<T>(input:T,maxBytes=262144):T {
 const active=new Set<object>();let nodes=0;
 function visit(value:unknown,depth:number):unknown {
  if(++nodes>32768||depth>32)fail('complexity');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||active.has(value))fail('json');
  const array=Array.isArray(value);if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('prototype');
  if(Object.getOwnPropertySymbols(value).length)fail('symbols');active.add(value);
  const keys=Object.keys(value);if(array&&(keys.length!==value.length||keys.some(k=>!/^\d+$/.test(k)||String(Number(k))!==k||Number(k)>=value.length)))fail('array');
  const out:Record<string,unknown>|unknown[]=array?[]:{};
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key)!;if(!('value'in d)||key==='__proto__')fail('descriptor');Object.defineProperty(out,key,{value:visit(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
  active.delete(value);return out;
 }
 const out=visit(input,0);if(new TextEncoder().encode(JSON.stringify(out)).length>maxBytes)fail('bytes');return out as T;
}
function object(value:unknown,path:string):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))fail(path);return value as Record<string,unknown>;}
function fields(value:unknown,keys:readonly string[],path:string):Record<string,unknown> {const v=object(value,path);if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail(path);return v;}
function finite(value:unknown,path:string,min=-Number.MAX_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER):asserts value is number {if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(path);}
function integer(value:unknown,path:string,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number {finite(value,path,min,max);if(!Number.isSafeInteger(value))fail(path);}
function bool(value:unknown,path:string):asserts value is boolean {if(typeof value!=='boolean')fail(path);}
function text(value:unknown,path:string,max=512):asserts value is string {if(typeof value!=='string'||value.length<1||new TextEncoder().encode(value).length>max||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value))fail(path);}
function member(value:unknown,values:readonly unknown[],path:string):void {if(!values.includes(value))fail(path);}
function duration(value:unknown,path:string):void {const d=fields(value,['startAge','endRemaining'],path);finite(d.startAge,path,0);finite(d.endRemaining,path,0);}
function location(value:unknown):void {const p=fields(value,['x','y','z','yaw'],'location');for(const [k,v]of Object.entries(p))finite(v,`location.${k}`);}
function identity(value:unknown):CharacterIdentityV1 {
 const v=fields(detached(value,4096),['schema','classId','archetype','appearance'],'identity');member(v.schema,['world-identity-v1'],'identity.schema');member(v.classId,Object.keys(CLASSES),'class');text(v.archetype,'archetype',256);
 const a=fields(v.appearance,['race','sex','classId','shell','crest','led','name'],'appearance');member(a.race,['human','orc','dwarf','undead','nightelf','tauren'],'appearance.race');member(a.sex,['male','female'],'appearance.sex');if(a.classId!==v.classId||a.race!==v.archetype)fail('appearance.identity');integer(a.shell,'appearance.shell',0,3);integer(a.crest,'appearance.crest',0,3);integer(a.led,'appearance.led',0,2);text(a.name,'appearance.name',96);if(a.name.length>24||a.name.trim()!==a.name)fail('appearance.name');return v as CharacterIdentityV1;
}
const PRE_SNOW_QUEST_IDS=Object.freeze(['q1','q2','q3','q4','w1','w2','w3','w4','w5','w6','w7','d1','d2','d3','d4','d5','d6','d7','d8','d9','d10','d11','d12','s1','s2']);
const ADDED_SNOW_QUEST_IDS=Object.freeze(['s3','s4','s5','s6','s7','s8','s9','s10','s11','s12']);
function quests(value:unknown,world:WorldId):void {
 const q=fields(value,['chapter','status','progress','cogs','tracked'],'quests');if(q.chapter!==worldChapter(world))fail('quests.chapter');
 const rawStatus=object(q.status,'quests.status');
 // The released v1 catalog had exactly25 entries. Upgrade only that complete known shape.
 if(Object.keys(rawStatus).length===PRE_SNOW_QUEST_IDS.length&&PRE_SNOW_QUEST_IDS.every(id=>Object.hasOwn(rawStatus,id))){
  const progress=object(q.progress,'quests.progress'),tracked=object(q.tracked,'quests.tracked');
  if(ADDED_SNOW_QUEST_IDS.some(id=>QUESTS[id].objectives.some(o=>Object.hasOwn(progress,o.id)))||Object.values(tracked).some(id=>ADDED_SNOW_QUEST_IDS.includes(id as string)))fail('quests.pre-snow.references');
  for(const id of ADDED_SNOW_QUEST_IDS)rawStatus[id]=q.chapter===4?'available':'locked';
 }
 const status=fields(q.status,QUEST_ORDER,'quests.status');for(const v of Object.values(status))member(v,['locked','available','active','ready','done'],'quest.status');
 const objectives=new Map(Object.values(QUESTS).flatMap(q=>q.objectives.map(o=>[o.id,o.count] as const)));objectives.set('patrol-kills',4);
 const progress=object(q.progress,'quests.progress');for(const [id,n]of Object.entries(progress)){if(!objectives.has(id))fail('quest.objective');integer(n,`quests.${id}`,0,objectives.get(id));}
 integer(q.cogs,'quests.cogs',0,4);if(q.cogs!==(progress['q1-cog']??0))fail('quests.cogs');
 const tracked=object(q.tracked,'quests.tracked');for(const [chapter,id]of Object.entries(tracked)){if(!['1','2','3','4'].includes(chapter)||typeof id!=='string'||!QUESTS[id]||QUESTS[id].chapter!==Number(chapter))fail('quests.tracked');}
 for(const id of QUEST_ORDER){const def=QUESTS[id];if(['ready','done'].includes(status[id] as string)&&!def.objectives.every(o=>(progress[o.id]??0)===o.count))fail(`quests.${id}.completion`);}
}
/** Strict detached validation, with only the complete released25-quest v1 catalog upgrade. No clamping or partial-shape repair. */
export function validateCheckpoint(value:unknown,context?:IdentityContext):CharacterCheckpointV1 {
 const c=fields(detached(value),['schema','character','classId','archetype','world','location','progress','survival','activity'],'root');member(c.schema,['world-character-v1'],'schema');text(c.character,'character');member(c.classId,Object.keys(CLASSES),'class');text(c.archetype,'archetype',256);member(c.world,['w1','w2','w3','w4'],'world');location(c.location);
 if(context&&(c.character!==context.characterId||c.classId!==context.identity.classId||c.archetype!==context.identity.archetype))fail('identity-mismatch');
 const p=fields(c.progress,['xp','coins','baseMaxHp','attackRank','armorRank','weaponOwned','armorOwned','quests','flags','cogMisses','achievements','lighthouseSecretFound'],'progress');
 integer(p.xp,'xp');integer(p.coins,'coins');integer(p.attackRank,'attackRank',0,100);integer(p.armorRank,'armorRank',0,100);bool(p.weaponOwned,'weaponOwned');bool(p.armorOwned,'armorOwned');if((p.attackRank>0)!==p.weaponOwned||(p.armorRank>0)!==p.armorOwned)fail('gear-ownership');
 const cls=CLASSES[c.classId as ClassId];if(p.baseMaxHp!==cls.baseHp)fail('baseMaxHp');integer(p.cogMisses,'cogMisses',0,2);bool(p.lighthouseSecretFound,'lighthouseSecretFound');quests(p.quests,c.world as WorldId);
 const flags=object(p.flags,'flags');for(const [id,v]of Object.entries(flags)){member(id,PERSONAL_FLAG_IDS,'flags.key');bool(v,'flags.value');}
 const achievements=fields(p.achievements,['earned','distance'],'achievements');if(!Array.isArray(achievements.earned)||new Set(achievements.earned).size!==achievements.earned.length)fail('achievements.earned');for(const id of achievements.earned)member(id,ACHIEVEMENT_IDS,'achievement');finite(achievements.distance,'achievements.distance',0);
 const s=fields(c.survival,['alive','hp','maxHp','resource','maxResource','respawnRemaining','cooldowns','gcd','statuses','history'],'survival');bool(s.alive,'alive');const level=levelForXp(p.xp),maxHp=Math.round(cls.baseHp*(1+.15*(level-1))),maxResource=cls.resource==='rage'?100:120+20*(level-1);if(s.maxHp!==maxHp||s.maxResource!==maxResource)fail('derived-stats');integer(s.maxHp,'maxHp',1);finite(s.hp,'hp',0,maxHp);finite(s.resource,'resource',0,maxResource);if(s.alive&&s.hp<=0)fail('alive.hp');if(s.alive&&s.respawnRemaining!==null)fail('alive.respawn');if(s.respawnRemaining!==null)finite(s.respawnRemaining,'respawnRemaining',0);if(!s.alive&&s.respawnRemaining===null)fail('dead.respawn');
 const abilityIds=cls.abilities.map(a=>a.id);for(const [id,d]of Object.entries(object(s.cooldowns,'cooldowns'))){member(id,[...abilityIds,'boss-xp-blessing'],'cooldown.ability');duration(d,'cooldown');}duration(s.gcd,'gcd');
 const st=fields(s.statuses,['stunRemaining','slowRemaining','slowPct','rustRemaining','rust','absorbRemaining','absorb','absorbMax','blessingRemaining','encounterBlessing','warded'],'statuses');for(const [k,n]of Object.entries(st))if(k==='encounterBlessing'||k==='warded')bool(n,k);else finite(n,k,0);finite(st.slowPct,'slowPct',0,1);integer(st.rust,'rust',0,5);finite(st.absorb,'absorb',0,st.absorbMax as number);
 const h=fields(s.history,['combatAge','spendAge','attackAge','nextSwingRemaining'],'history');for(const [k,n]of Object.entries(h))finite(n,k,0);
 const a=fields(c.activity,['seated','village','controlsLocked','cast','channel','dash','pendingHit','rootPending','motion'],'activity');for(const k of ['seated','village','controlsLocked','dash','pendingHit','rootPending'])bool(a[k],`activity.${k}`);
 const motion=fields(a.motion,['velocityX','velocityZ','jumpRemaining','spinRemaining','pushX','pushZ','pushRemaining','lift','dashElapsed'],'activity.motion');for(const [id,n]of Object.entries(motion)){if(id==='dashElapsed'&&n===null)continue;finite(n,`activity.motion.${id}`,['velocityX','velocityZ','pushX','pushZ','lift'].includes(id)?-Number.MAX_SAFE_INTEGER:0);}if((motion.dashElapsed!==null)!==a.dash)fail('activity.motion.dash');
 if(a.cast!==null){const cast=fields(a.cast,['ability','startAge','endRemaining'],'cast');member(cast.ability,abilityIds,'cast.ability');duration({startAge:cast.startAge,endRemaining:cast.endRemaining},'cast');}
 if(a.channel!==null){const channel=fields(a.channel,['kind','startAge','endRemaining'],'channel');member(channel.kind,['recall','beacon','waystone','lighthouse-secret'],'channel.kind');duration({startAge:channel.startAge,endRemaining:channel.endRemaining},'channel');}
 return freeze(c as CharacterCheckpointV1);
}
export type CheckpointCaptureInput = {unit:SimUnit;state:PlayerState;world:WorldId;time:number;activity:{seated:boolean;village:boolean;rootPending?:boolean}};
export function projectCheckpoint({unit:u,state:p,world,time,activity}:CheckpointCaptureInput):CharacterCheckpointV1 {
 finite(time,'capture.time',0);if(p.unit.area!==u.ref.area||p.unit.id!==u.ref.id||p.unit.life!==u.ref.life||u.kind!=='player')fail('capture.identity');
 const age=(t:number)=>Math.max(0,time-t),remaining=(t:number)=>Math.max(0,t-time),cycle=(d:{start:number;end:number})=>({startAge:age(d.start),endRemaining:remaining(d.end)});
 const personal=p as PlayerState&{achievements:AchievementCheckpoint;lighthouseSecretFound:boolean};
 return validateCheckpoint({schema:'world-character-v1',character:p.character,classId:p.classId,archetype:u.archetype,world,location:{x:u.x,y:u.y,z:u.z,yaw:u.yaw},progress:{xp:p.xp,coins:p.coins,baseMaxHp:p.baseMaxHp,attackRank:p.attackRank,armorRank:p.armorRank,weaponOwned:p.weaponOwned,armorOwned:p.armorOwned,quests:p.quests,flags:p.flags,cogMisses:p.cogMisses,achievements:personal.achievements,lighthouseSecretFound:personal.lighthouseSecretFound},survival:{alive:u.alive,hp:u.hp,maxHp:u.maxHp,resource:p.resource,maxResource:p.maxResource,respawnRemaining:p.deadUntil===null?null:remaining(p.deadUntil),cooldowns:Object.fromEntries(Object.entries(p.cooldowns).map(([id,d])=>[id,cycle(d)])),gcd:cycle({start:p.gcdStart,end:p.gcdEnd}),statuses:{stunRemaining:remaining(u.stunUntil),slowRemaining:remaining(u.slowUntil),slowPct:u.slowPct,rustRemaining:remaining(u.rustUntil),rust:u.rust,absorbRemaining:remaining(u.absorbUntil),absorb:u.absorb,absorbMax:u.absorbMax,blessingRemaining:remaining(u.blessingUntil),encounterBlessing:u.encounterBlessing,warded:p.warded},history:{combatAge:age(u.lastCombat),spendAge:age(p.lastSpend),attackAge:age(p.lastAttack),nextSwingRemaining:remaining(p.nextSwing)}},activity:{seated:activity.seated,village:activity.village,controlsLocked:p.controlsLocked,cast:p.cast?{ability:p.cast.ability,...cycle(p.cast)}:null,channel:p.channel?{kind:p.channel.kind,...cycle(p.channel)}:null,dash:p.dash!==null,pendingHit:u.pendingHit!==null,rootPending:activity.rootPending??u.actions.some(a=>a.root!==null&&!a.root.committed),motion:{velocityX:p.velX,velocityZ:p.velZ,jumpRemaining:Math.max(0,p.jumpT),spinRemaining:Math.max(0,p.spinT),pushX:u.pushX,pushZ:u.pushZ,pushRemaining:Math.max(0,u.pushTime),lift:u.lift,dashElapsed:p.dash?.t??null}}});
}
export function freshCheckpoint(context:IdentityContext,spawn:LocationCheckpoint):CharacterCheckpointV1 {
 const i=identity(context.identity),cls=CLASSES[i.classId],mana=cls.resource==='mana';location(spawn);
 return validateCheckpoint({schema:'world-character-v1',character:context.characterId,classId:i.classId,archetype:i.archetype,world:'w1',location:spawn,progress:{xp:0,coins:0,baseMaxHp:cls.baseHp,attackRank:0,armorRank:0,weaponOwned:false,armorOwned:false,quests:freshQuests(1),flags:{},cogMisses:0,achievements:{earned:[],distance:0},lighthouseSecretFound:false},survival:{alive:true,hp:cls.baseHp,maxHp:cls.baseHp,resource:mana?120:0,maxResource:mana?120:100,respawnRemaining:null,cooldowns:{},gcd:{startAge:0,endRemaining:0},statuses:{stunRemaining:0,slowRemaining:0,slowPct:0,rustRemaining:0,rust:0,absorbRemaining:0,absorb:0,absorbMax:0,blessingRemaining:0,encounterBlessing:false,warded:false},history:{combatAge:1e9,spendAge:10,attackAge:10,nextSwingRemaining:0}},activity:{seated:false,village:false,controlsLocked:false,cast:null,channel:null,dash:false,pendingHit:false,rootPending:false,motion:{velocityX:0,velocityZ:0,jumpRemaining:0,spinRemaining:0,pushX:0,pushZ:0,pushRemaining:0,lift:0,dashElapsed:null}}},context);
}
function canonical(value:unknown):string {if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;}
/** Caller chooses every offline rule; a throwing/invalid policy has no live mutation path. */
export function prepareRestore(checkpoint:CharacterCheckpointV1,offlineSeconds:number,policy:RestorePolicy):RestoredPlayerData {
 finite(offlineSeconds,'offlineSeconds',0);if(!policy||typeof policy.restore!=='function')fail('restorePolicy');text(policy.version,'restorePolicy.version',128);
 const source=validateCheckpoint(checkpoint),result=validateCheckpoint(policy.restore(source,offlineSeconds));if(result.character!==source.character||result.classId!==source.classId||result.archetype!==source.archetype)fail('restorePolicy.identity');
 if(canonical(result.progress)!==canonical(source.progress))fail('restorePolicy.progress');return result;
}
const GRANT_OBJECTIVES=Object.freeze(['kill-scrapling','kill-scavenger','patrol-kill','cog-roll','cog-reset','cog-miss','boss','eclipse-boss','dawn-boss','frost-boss','clear-encounter-blessing','boss-xp-blessing']);
export function validateEarnedGrant(value:unknown,recipient?:string):GrantJson {
 const g=fields(detached(value,16384),['id','victim','recipient','xp','coins','objectives','flags'],'grant'),v=fields(g.victim,['area','id','life'],'grant.victim');text(v.area,'victim.area',256);integer(v.id,'victim.id',1,0xffffffff);integer(v.life,'victim.life',1,0xffffffff);text(g.id,'grant.id');text(g.recipient,'grant.recipient');if(g.id!==JSON.stringify([v.area,v.id,v.life,g.recipient])||recipient!==undefined&&g.recipient!==recipient)fail('grant.identity');integer(g.xp,'grant.xp');integer(g.coins,'grant.coins');
 if(!Array.isArray(g.objectives)||g.objectives.length>16||!Array.isArray(g.flags)||g.flags.length>5)fail('grant.payload');const kinds=new Set<string>();for(const value of g.objectives){const o=fields(value,['kind','amount'],'grant.objective');member(o.kind,GRANT_OBJECTIVES,'grant.objective.kind');if(kinds.has(o.kind as string))fail('grant.objective.duplicate');kinds.add(o.kind as string);if(o.kind==='cog-roll'){finite(o.amount,'cog-roll',0,1);if(o.amount===1)fail('cog-roll');}else integer(o.amount,'grant.objective.amount',o.kind==='cog-reset'?0:1);}
 if(new Set(g.flags).size!==g.flags.length)fail('grant.flags');for(const flag of g.flags)member(flag,PERSONAL_FLAG_IDS.slice(0,5),'grant.flag');return freeze(g as GrantJson);
}
export function createCoreCharacterCodec(config:{identities:readonly {classId:ClassId;archetype:string}[];freshLocation:LocationCheckpoint}):CoreCharacterCodec {
 const allowed=new Set(config.identities.map(i=>{member(i.classId,Object.keys(CLASSES),'identity.catalog.class');member(i.archetype,['human','orc','dwarf','undead','nightelf','tauren'],'identity.catalog.archetype');return JSON.stringify([i.classId,i.archetype]);})),spawn=detached(config.freshLocation);if(!allowed.size)fail('identity.catalog');location(spawn);
 const validateIdentity=(value:unknown)=>{const i=identity(value);if(!allowed.has(JSON.stringify([i.classId,i.archetype])))fail('identity.catalog');return freeze(i);};
 const validate=(value:unknown,context?:IdentityContext)=>{const c=validateCheckpoint(value,context);if(!allowed.has(JSON.stringify([c.classId,c.archetype])))fail('identity.catalog');return c;};
 return Object.freeze({version:1,validateIdentity,fresh:(context:IdentityContext)=>{validateIdentity(context.identity);return freshCheckpoint(context,spawn);},validateCheckpoint:(value:unknown,context:IdentityContext)=>{validateIdentity(context.identity);return validate(value,context);},validateGrant:(value:unknown,context:IdentityContext)=>{validateIdentity(context.identity);return validateEarnedGrant(value,context.characterId);},toCore:(value:CheckpointJson)=>validate(value),toJson:(value:CharacterCheckpointV1)=>validate(value),grantToJson:(value:EarnedGrant)=>validateEarnedGrant(value),grantFromJson:(value:GrantJson)=>validateEarnedGrant(value)});
}
