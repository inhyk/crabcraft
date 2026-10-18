import {CHAT_MAX} from '../../chat/filter.ts';
import {copyValue,freezeValue} from '../../../src/sim/events.ts';
import {createRenderPoseRecipe,evaluateRenderPoseRecipe,isRenderPoseRecipe,renderPoseProviderVersion} from '../../../src/sim/renderPose.ts';
import type {RenderPoseRecipe} from '../../../src/sim/renderPose.ts';
/** Gameplay v3. Pure bounded binary values shared by server and browser; v2 is untouched. */
import { ACHIEVEMENT_IDS } from '../../../src/sim/persistence.ts';
import type { CommandResult } from './events.ts';
import type { AreaSnapshot, BossObservation, EntityRef, EventRecord, PlayerState, ProjectileState, SimUnit, NumericPoseState } from '../../../src/sim/types.ts';
import { encodeInput, decodeInput } from './intents.ts';
import { encodeEvents, validateEvent, selectEvents, validateEventPayload, validateResult } from './events.ts';
export const MAGIC=0x5747, VERSION=3;
export const LIMITS=Object.freeze({fragmentBytes:16384,messageBytes:2097152,fragments:256,actors:2048,projectiles:4096,events:512,commands:32,depth:24,nodes:300000,stringBytes:4096,array:16384,object:256,assemblySeconds:5});
export interface WireBinding {session:string;area:string;epoch:number;catalog:string}
export interface WireHeader extends WireBinding {sequence:number;tick:number;acceptedInput:number;consumedInput:number}
export interface GameplayCatalog {version:string;poseProviderVersion:string;archetypes:readonly string[];actions:readonly string[];abilities:readonly string[];quests:readonly string[];npcs:readonly string[];interactions:readonly string[];gates:readonly string[];objectives:readonly string[];flags:readonly string[];jointCount:number;appearanceLimits:Readonly<Record<string,{shell:number;crest:number;led:number}>>}
export type Value=null|boolean|number|string|Value[]|{[key:string]:Value};
export type Validator=(value:unknown)=>void;
export function fail(message:string):never {throw new Error(`gameplay-v3: ${message}`);}
export function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail('invalid integer');}
export function number(value:unknown):asserts value is number {if(typeof value!=='number'||!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))fail('invalid numeric value');}
export function text(value:unknown,max=128):asserts value is string {if(typeof value!=='string'||!value.length||value.length>max)fail('invalid text');}
export function bool(value:unknown):void {if(typeof value!=='boolean')fail('invalid boolean');}
export function choice(...values:readonly unknown[]):Validator {return v=>{if(!values.includes(v))fail('unknown discriminator');};}
export function nullable(check:Validator):Validator{return v=>{if(v!==null)check(v);};}
export function list(check:Validator,max:number=LIMITS.array,min=0):Validator {return v=>{if(!Array.isArray(v)||v.length<min||v.length>max)fail('invalid list');v.forEach(x=>check(x));};}
export function object(value:unknown,required:Record<string,Validator>,optional:Record<string,Validator>={}):asserts value is Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('invalid object');
 for(const key of Object.keys(value))if(!Object.hasOwn(required,key)&&!Object.hasOwn(optional,key))fail(`unknown field ${key}`);
 const record=value as Record<string,unknown>;for(const [key,check]of Object.entries(required)){if(!Object.hasOwn(record,key))fail(`missing ${key}`);check(record[key]);}
 for(const[key,check]of Object.entries(optional))if(Object.hasOwn(record,key)&&record[key]!==undefined)check(record[key]);
}
export function mapValues(value:unknown,check:Validator,keys?:readonly string[],max=256):void {if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>max)fail('invalid map');for(const[k,v]of Object.entries(value)){text(k);if(['__proto__','constructor','prototype'].includes(k)||keys&&!keys.includes(k))fail('unknown catalog key');check(v);}}
export function catalogValue(values:readonly string[]):Validator {return v=>{text(v);if(!values.includes(v))fail(`unknown catalog value ${v}`);};}
export function reference(value:unknown,area?:string):asserts value is EntityRef {object(value,{area:text,id:v=>integer(v,1,0xffffffff),life:v=>integer(v,1,0xffffffff)});if(area&&value.area!==area)fail('foreign area ref');}
export function vector(value:unknown):void {object(value,{x:number,y:number,z:number});}
export function tuple(value:unknown,count:number):void {list(number,count,count)(value);}
export function binding(value:unknown):asserts value is WireBinding {object(value,{session:text,area:text,epoch:v=>integer(v,1),catalog:text});}
export function header(value:unknown):asserts value is WireHeader {object(value,{session:text,area:text,epoch:v=>integer(v,1),catalog:text,sequence:v=>integer(v,1),tick:integer,acceptedInput:integer,consumedInput:integer});if(Number(value.consumedInput)>Number(value.acceptedInput))fail('consumed input exceeds accepted');}
export function sameBinding(a:WireBinding,b:WireBinding):boolean {return a.session===b.session&&a.area===b.area&&a.epoch===b.epoch&&a.catalog===b.catalog;}
export function clone<T>(value:T):T{return decodeValue(encodeValue(value)) as T;}
const KEYS=('ref area id life archetype kind reaction level x y z yaw radius height hp maxHp alive hidden targetable invulnerable stunUntil slowUntil slowPct rust rustUntil absorb absorbMax absorbUntil blessingUntil encounterBlessing pushX pushZ pushTime lift npcId pose actions locomotionTime localVx localVz yawRate previousX previousZ previousYaw appliedQ appliedPosition appliedRotation gaitPhase controllerVx controllerVz controllerYaw locomotionQ locomotionPosition locomotionRotation locomotionWeights part upper from to loopFrom loop speed fade carryRoot generation start clipTime fadeIn fadeOut weight targetWeight ended interrupted root curve dataVersion metersToUnits committed committedClipTime rebase character unit classId resource maxResource xp coins attackRank armorRank weaponOwned armorOwned baseMaxHp gcdStart gcdEnd cooldowns cast channel target warded nextSwing lastAttack queued velX velZ jumpT spinT lastSpend targetDeadAt dash t deadUntil role controlsLocked talkTarget quests flags cogMisses chapter status progress cogs tracked ability end targetId source style elapsed bornStep hit anchorVersion type src dst amount crit school reason stage seconds caster range half stun landed slot moment move oldMaxHp jump attack at mech shapes cancelled boss phase show textKey yell recipient item recipients grant appliedHere position quest objective value operation result request destination gate header sequence tick acceptedInput consumedInput session epoch catalog full baseline eventWatermark selfRef actors removed projectiles self features recovery events results world time state weapon armor boat village environment telegraphs ending order inputSequence commandIndex revision durable poseDelta mask values fields appearance shell crest led name race sex lighthouseSecretFound endings replay poses poseRecipe recipe locomotion layers version bosses profile enraged stateTime freedTime showFrame').split(' ');
const KEY_INDEX=new Map<string,number>();KEYS.forEach((key,index)=>{if(!KEY_INDEX.has(key))KEY_INDEX.set(key,index);});
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
class Writer {
 bytes=new Uint8Array(1024);view=new DataView(this.bytes.buffer);offset=0;
 need(n:number){if(this.offset+n>LIMITS.messageBytes)fail('message size limit');if(this.offset+n>this.bytes.length){const next=new Uint8Array(Math.min(LIMITS.messageBytes,Math.max(this.bytes.length*2,this.offset+n)));next.set(this.bytes);this.bytes=next;this.view=new DataView(next.buffer);}}
 u8(n:number){this.need(1);this.view.setUint8(this.offset++,n);}
 u16(n:number){this.need(2);this.view.setUint16(this.offset,n,true);this.offset+=2;}
 u32(n:number){this.need(4);this.view.setUint32(this.offset,n,true);this.offset+=4;}
 f32(n:number){number(n);if(Math.fround(n)!==n)fail('lossy f32 forbidden');this.need(4);this.view.setFloat32(this.offset,n,true);this.offset+=4;}
 f64(n:number){number(n);this.need(8);this.view.setFloat64(this.offset,n,true);this.offset+=8;}
 raw(b:Uint8Array){this.need(b.length);this.bytes.set(b,this.offset);this.offset+=b.length;}
 string(s:string){const b=encoder.encode(s);if(b.length>LIMITS.stringBytes)fail('string size limit');this.u16(b.length);this.raw(b);}
 finish(){return this.bytes.slice(0,this.offset);}
}
class Reader {
 offset=0;bytes:Uint8Array;view:DataView;
 constructor(bytes:Uint8Array){if(!(bytes instanceof Uint8Array)||bytes.length>LIMITS.messageBytes)fail('invalid bytes');this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
 need(n:number){if(this.offset+n>this.bytes.length)fail('truncated bytes');}
 u8(){this.need(1);return this.view.getUint8(this.offset++);}
 u16(){this.need(2);const n=this.view.getUint16(this.offset,true);this.offset+=2;return n;}
 u32(){this.need(4);const n=this.view.getUint32(this.offset,true);this.offset+=4;return n;}
 f32(){this.need(4);const n=this.view.getFloat32(this.offset,true);this.offset+=4;number(n);return n;}
 f64(){this.need(8);const n=this.view.getFloat64(this.offset,true);this.offset+=8;number(n);return n;}
 raw(n:number){this.need(n);const b=this.bytes.slice(this.offset,this.offset+n);this.offset+=n;return b;}
 string(){const n=this.u16();if(n>LIMITS.stringBytes)fail('string size limit');return decoder.decode(this.raw(n));}
 end(){if(this.offset!==this.bytes.length)fail('trailing bytes');}
}
interface ValuePrefix {bytes:Uint8Array;strings:ReadonlyMap<string,number>;nodes:number;hash:number}
function valueEncoder(prefix?:ValuePrefix){
 const w=new Writer(),seen=new Set<object>(),strings=new Map<string,number>(prefix?.strings);let nodes=prefix?.nodes??0;if(prefix)w.raw(prefix.bytes);
 const write=(v:unknown,depth:number)=>{
  if(++nodes>LIMITS.nodes||depth>LIMITS.depth)fail('value complexity limit');
  if(v===null){w.u8(0);return;}if(v===false||v===true){w.u8(v?2:1);return;}if(typeof v==='number'){w.u8(3);w.f64(v);return;}if(typeof v==='string'){const index=strings.get(v);if(index!==undefined){w.u8(9);w.u16(index);}else{if(strings.size>=65535)fail('string table limit');strings.set(v,strings.size);w.u8(4);w.string(v);}return;}
  if(!v||typeof v!=='object'||seen.has(v))fail('non-value or cyclic data');seen.add(v);
  if(Array.isArray(v)){
   if(v.length>LIMITS.array)fail('array size limit');const numeric=v.length>0&&v.every(n=>typeof n==='number'),exact32=numeric&&v.every(n=>Number.isFinite(n)&&Math.fround(n)===n);w.u8(exact32?8:numeric?7:5);w.u16(v.length);
   if(numeric){nodes+=v.length;if(nodes>LIMITS.nodes)fail('value complexity limit');v.forEach(n=>exact32?w.f32(n):w.f64(n));}else v.forEach(n=>write(n,depth+1));
  }else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('non-plain data');const entries=Object.entries(v).filter(([,x])=>x!==undefined);
   if(entries.length>LIMITS.object)fail('object size limit');w.u8(6);w.u16(entries.length);
   for(const[k,x]of entries){if(['__proto__','constructor','prototype'].includes(k))fail('unsafe map key');const i=KEY_INDEX.get(k)??-1;w.u16(i+1);if(i<0)w.string(k);write(x,depth+1);}
  }seen.delete(v);
 };
 return {w,write,beginRecord(size:number){if(++nodes>LIMITS.nodes)fail('value complexity limit');w.u8(6);w.u16(size);},field(k:string,v:unknown){const index=KEY_INDEX.get(k)??-1;w.u16(index+1);if(index<0)w.string(k);write(v,1);},prefix():ValuePrefix{const bytes=w.finish();return{bytes,strings:new Map(strings),nodes,hash:checksum(bytes)};}};
}
export function encodeValue(value:unknown):Uint8Array {const valueWriter=valueEncoder();valueWriter.write(value,0);return valueWriter.w.finish();}
export function decodeValue(bytes:Uint8Array):Value {
 const r=new Reader(bytes),strings:string[]=[];let nodes=0;
 const read=(depth:number):Value=>{
  if(++nodes>LIMITS.nodes||depth>LIMITS.depth)fail('value complexity limit');const tag=r.u8();
  if(tag===0)return null;if(tag===1)return false;if(tag===2)return true;if(tag===3)return r.f64();if(tag===4){if(strings.length>=65535)fail('string table limit');const s=r.string();strings.push(s);return s;}if(tag===9){const index=r.u16();if(index>=strings.length)fail('unknown string reference');return strings[index];}
  if(tag===5||tag===7||tag===8){const length=r.u16();if(length>LIMITS.array)fail('array size limit');if(tag===7||tag===8){nodes+=length;if(nodes>LIMITS.nodes)fail('value complexity limit');}return Array.from({length},()=>tag===8?r.f32():tag===7?r.f64():read(depth+1));}
  if(tag===6){const length=r.u16();if(length>LIMITS.object)fail('object size limit');const result:Record<string,Value>={};for(let i=0;i<length;i++){const keyId=r.u16();if(keyId>KEYS.length)fail('unknown dictionary key');const k=keyId?KEYS[keyId-1]:r.string();if(Object.hasOwn(result,k)||['__proto__','constructor','prototype'].includes(k))fail('duplicate/unsafe key');result[k]=read(depth+1);}return result;}
  return fail('unknown binary tag');
 };const result=read(0);r.end();return result;
}
function checksum(bytes:Uint8Array,start=0,seed=2166136261):number {let n=seed;for(let i=start;i<bytes.length;i++)n=Math.imul(n^bytes[i],16777619);return n>>>0;}
export function encodeMessage(kind:1|2|16|17,h:WireHeader,payload:unknown):Uint8Array[] {
 header(h);const body=encodeValue(payload);return frameMessage(kind,h,body,checksum(body));
}
function frameMessage(kind:1|2|16|17,h:WireHeader,body:Uint8Array,hash:number):Uint8Array[] {
 const hbytes=encodeValue(h),overhead=4+2+hbytes.length+2+2+4+4;
 const room=LIMITS.fragmentBytes-overhead;if(room<1)fail('oversized header');const count=Math.max(1,Math.ceil(body.length/room));if(count>LIMITS.fragments)fail('fragment count limit');
 return Array.from({length:count},(_,i)=>{const w=new Writer();w.u16(MAGIC);w.u8(VERSION);w.u8(kind);w.u16(hbytes.length);w.raw(hbytes);w.u16(i);w.u16(count);w.u32(body.length);w.u32(hash);w.raw(body.slice(i*room,(i+1)*room));return w.finish();});
}
export interface DecodedMessage {kind:1|2|16|17;header:WireHeader;payload:Value;interrupted:boolean}
/** One bounded in-flight group. No snapshot state changes until every fragment validates. */
export class FragmentAssembler {
 private binding:WireBinding;
 private pending:{kind:DecodedMessage['kind'];header:WireHeader;count:number;total:number;hash:number;started:number;parts:Map<number,Uint8Array>;size:number;interrupted:boolean}|null=null;
 constructor(expected:WireBinding){binding(expected);this.binding=clone(expected);}
 reset(expected:WireBinding){binding(expected);this.binding=clone(expected);this.pending=null;}
 clear(){this.pending=null;}
 get retainedBytes(){return this.pending?.size??0;}
 accept(bytes:Uint8Array,now:number):DecodedMessage|null {
  number(now);if(bytes.length>LIMITS.fragmentBytes)fail('fragment size limit');
  if(this.pending&&now-this.pending.started>LIMITS.assemblySeconds){this.pending=null;fail('fragment timeout; resync required');}
  const r=new Reader(bytes);if(r.u16()!==MAGIC||r.u8()!==VERSION)fail('unsupported protocol');const kind=r.u8();if(![1,2,16,17].includes(kind))fail('unknown packet kind');
  const h=decodeValue(r.raw(r.u16()));header(h);if(!sameBinding(h,this.binding))fail('stale stream binding');
  const index=r.u16(),count=r.u16(),total=r.u32(),hash=r.u32();integer(count,1,LIMITS.fragments);integer(index,0,count-1);integer(total,1,LIMITS.messageBytes);
  const part=r.raw(bytes.length-r.offset);if(!part.length||part.length>total)fail('invalid fragment payload');
  let p=this.pending,interrupted=false;
  if(p&&(p.kind!==kind||p.header.sequence!==h.sequence)){if(kind===1&&h.sequence>p.header.sequence){p=null;this.pending=null;interrupted=true;}else fail('interleaved group; resync required');}
  if(p&&(JSON.stringify(p.header)!==JSON.stringify(h)||p.count!==count||p.total!==total||p.hash!==hash||now<p.started))fail('inconsistent fragment group');
  if(!p)p={kind:kind as DecodedMessage['kind'],header:h,count,total,hash,started:now,parts:new Map(),size:0,interrupted};
  if(p.parts.has(index))fail('duplicate fragment');if(p.size+part.length>total)fail('fragment total exceeded');
  p.parts.set(index,part);p.size+=part.length;this.pending=p;if(p.parts.size<count)return null;
  this.pending=null;if(p.size!==total)fail('fragment size mismatch');const merged=new Uint8Array(total);let offset=0;
  for(let i=0;i<count;i++){const b=p.parts.get(i)!;merged.set(b,offset);offset+=b.length;}if(checksum(merged)!==hash)fail('fragment checksum mismatch');
  return {kind:p.kind,header:p.header,payload:decodeValue(merged),interrupted:p.interrupted};
 }
}
export function actionState(value:unknown,c:GameplayCatalog):void {
 const nonnegative=(v:unknown)=>{number(v);if(v<0)fail('negative action value');};
 object(value,{id:catalogValue(c.actions),part:choice('move','channel','release'),upper:bool,from:nonnegative,to:nullable(number),loopFrom:nullable(number),loop:bool,speed:nonnegative,fade:nonnegative,carryRoot:bool,generation:v=>integer(v,1),start:number,clipTime:number,fadeIn:nonnegative,fadeOut:nonnegative,weight:v=>{number(v);if(v<0||v>1)fail('action weight');},targetWeight:choice(0,1),ended:bool,interrupted:bool,root:nullable(v=>object(v,{curve:catalogValue(c.actions),dataVersion:text,metersToUnits:nonnegative,committed:bool,committedClipTime:nullable(number),rebase:nullable(x=>object(x,{x:number,z:number,yaw:number}))}))});
}
export type PublicPose=Pick<NumericPoseState,'appliedQ'|'appliedPosition'|'appliedRotation'|'localVx'|'localVz'>;
export interface PoseDelta {appliedQ?:{mask:number;values:number[]};appliedPosition?:{mask:number;values:number[]};appliedRotation?:{mask:number;values:number[]};localVx?:number;localVz?:number}
function poseState(value:unknown,c:GameplayCatalog):void {
 object(value,{appliedQ:v=>tuple(v,c.jointCount),appliedPosition:v=>tuple(v,3),appliedRotation:v=>tuple(v,4),localVx:number,localVz:number});
}
function poseDelta(value:unknown,c:GameplayCatalog):void {
 const patch=(length:number)=>(v:unknown)=>{object(v,{mask:x=>integer(x,1,2**length-1),values:list(number,length,1)});let count=0;for(let i=0;i<length;i++)if(Number(v.mask)&2**i)count++;if((v.values as number[]).length!==count)fail('pose patch cardinality');};
 object(value,{}, {appliedQ:patch(c.jointCount),appliedPosition:patch(3),appliedRotation:patch(4),localVx:number,localVz:number});
}
function applyPoseDelta(previous:PublicPose,delta:PoseDelta):PublicPose {
 const pose=clone(previous);for(const key of ['appliedQ','appliedPosition','appliedRotation']as const){const change=delta[key];if(!change)continue;let index=0;for(let i=0;i<pose[key].length;i++)if(change.mask&2**i)pose[key][i]=change.values[index++];}
 if(delta.localVx!==undefined)pose.localVx=delta.localVx;if(delta.localVz!==undefined)pose.localVz=delta.localVz;return pose;
}
export interface Appearance {race:'human'|'orc'|'dwarf'|'undead'|'nightelf'|'tauren';sex:'male'|'female';classId:'warrior'|'mage'|'priest';shell:number;crest:number;led:number;name:string}
export type WireAppearance=Appearance;
export type PublicActor=Omit<SimUnit,'pendingHit'|'lastCombat'|'pose'>&{appearance:Appearance|null;pose:PublicPose};
export type PublicProjectile=Omit<ProjectileState,'hit'|'anchorVersion'>;
export type SelfPlayer=Omit<PlayerState,'character'|'achievements'>&{lighthouseSecretFound?:boolean};
export interface AchievementView {distance:number;earned:readonly string[]}
export interface SelfView {player:SelfPlayer;achievements:AchievementView;inCombat:boolean}
export interface FeatureView {
 environment:{beacon:boolean;clock:number;mode:AreaSnapshot['features']['mode'];pvp:AreaSnapshot['features']['pvp']};
 exploration?:readonly {unit:EntityRef;activeUntil:number}[];
 boat:null|{x:number;z:number;yaw:number;speed:number;seats:readonly(EntityRef|null)[]};
 village:null|{id:string;mode:'hide'|'tag';phase:'ready'|'play'|'done';left:number;starter:EntityRef;seeker:EntityRef;members:readonly EntityRef[];caught:readonly EntityRef[];result:string};
}
export interface RecoveryView {bosses?:readonly BossObservation[];telegraphs:readonly EventRecord[];endings:readonly {unit:EntityRef;chapter:4;replay:boolean}[]}
export interface RenderPoseSource {recipe:RenderPoseRecipe;localVx:number;localVz:number}
export interface ActorUpdate {ref:EntityRef;fields:Partial<Omit<PublicActor,'ref'>>;poseDelta?:PoseDelta;poseRecipe?:number}
export interface SnapshotPayload {
 full:boolean;baseline:number;eventWatermark:number;world:AreaSnapshot['world'];time:number;selfRef:EntityRef;
 poses:readonly RenderPoseSource[];actors:readonly ActorUpdate[];removed:readonly EntityRef[];projectiles:readonly PublicProjectile[];
 self:SelfView;features:FeatureView;recovery:RecoveryView;events:readonly EventRecord[];results:readonly CommandResult[];
}
const ACTOR_FIELDS=['archetype','kind','reaction','level','x','y','z','yaw','radius','height','hp','maxHp','alive','hidden','targetable','invulnerable','stunUntil','slowUntil','slowPct','rust','rustUntil','absorb','absorbMax','absorbUntil','blessingUntil','encounterBlessing','pushX','pushZ','pushTime','lift','npcId','pose','actions','appearance'] as const;
function actorShape(value:unknown,c:GameplayCatalog,area:string,withPose:boolean):void {
 const numeric=['x','y','z','yaw','radius','height','hp','maxHp','stunUntil','slowUntil','slowPct','rust','rustUntil','absorb','absorbMax','absorbUntil','blessingUntil','pushX','pushZ','pushTime','lift'];
 object(value,{appearance:nullable(v=>validateAppearance(v,c)),ref:v=>reference(v,area),archetype:catalogValue(c.archetypes),kind:choice('player','npc','townsfolk','scrapling','scavenger','jellyfish','boss','freed'),reaction:choice('hostile','friendly','neutral','player'),level:v=>integer(v,1),...Object.fromEntries(numeric.map(k=>[k,number])),...Object.fromEntries(['alive','hidden','targetable','invulnerable','encounterBlessing'].map(k=>[k,bool])),npcId:nullable(text),...(withPose?{pose:(v:unknown)=>poseState(v,c)}:{}),actions:list(v=>actionState(v,c),64)});
 if(Number(value.hp)<0||Number(value.hp)>Number(value.maxHp)||Number(value.maxHp)<=0||Number(value.radius)<=0||Number(value.height)<=0||Number(value.slowPct)<0||Number(value.slowPct)>1)fail('invalid actor relationship');
}
export function validateActor(value:unknown,c:GameplayCatalog,area:string):asserts value is PublicActor {actorShape(value,c,area,true);}
function renderSource(value:unknown):void {object(value,{recipe:v=>{if(!isRenderPoseRecipe(v)||v.layers.length>64)fail('invalid render recipe');},localVx:number,localVz:number});}
function validateSelf(value:unknown,c:GameplayCatalog,area:string):void {
 object(value,{inCombat:bool,player:v=>{
  const numeric=['resource','maxResource','xp','coins','baseMaxHp','gcdStart','gcdEnd','nextSwing','lastAttack','velX','velZ','jumpT','spinT','lastSpend','targetDeadAt'];
  object(v,{unit:x=>reference(x,area),classId:choice('warrior','mage','priest'),...Object.fromEntries(numeric.map(k=>[k,number])),attackRank:integer,armorRank:integer,weaponOwned:bool,armorOwned:bool,cooldowns:x=>mapValues(x,y=>object(y,{start:number,end:number}),[...c.abilities,'boss-xp-blessing']),cast:nullable(x=>object(x,{ability:catalogValue(c.abilities),start:number,end:number,target:nullable(r=>reference(r,area))})),channel:nullable(x=>object(x,{kind:choice('recall','beacon','waystone','lighthouse-secret'),start:number,end:number,targetId:nullable(text),to:vector})),target:nullable(x=>reference(x,area)),warded:bool,queued:nullable(catalogValue(c.abilities)),dash:nullable(x=>object(x,{target:r=>reference(r,area),t:number})),deadUntil:nullable(number),role:choice('authoritative'),controlsLocked:bool,talkTarget:nullable(x=>reference(x,area)),quests:x=>object(x,{chapter:v=>integer(v,1,6),status:v=>mapValues(v,choice('locked','available','active','ready','done'),c.quests),progress:v=>mapValues(v,number,c.objectives),cogs:integer,tracked:v=>mapValues(v,catalogValue(c.quests),['1','2','3','4','5','6'])}),flags:x=>mapValues(x,bool,c.flags),cogMisses:integer,lighthouseSecretFound:bool,xp:integer,coins:integer});
  if(Number(v.xp)<0||Number(v.coins)<0||Number(v.resource)<0||Number(v.resource)>Number(v.maxResource))fail('invalid self progress');
 },achievements:v=>object(v,{distance:number,earned:list(catalogValue(ACHIEVEMENT_IDS),ACHIEVEMENT_IDS.length)})});
}
function validateFeatures(v:unknown,area:string):void {
 const ref=(x:unknown)=>reference(x,area);
 object(v,{environment:x=>object(x,{beacon:bool,clock:number,mode:choice('public','party-encounter','legacy-room'),pvp:choice('disabled','party-only')}),boat:nullable(x=>{object(x,{x:number,z:number,yaw:number,speed:number,seats:list(nullable(ref),2,2)});const seats=x.seats as (EntityRef|null)[];if(seats[0]&&seats[1]&&seats[0].id===seats[1].id)fail('duplicate boat seat');}),village:nullable(x=>object(x,{id:text,mode:choice('hide','tag'),phase:choice('ready','play','done'),left:number,starter:ref,seeker:ref,members:list(ref,100),caught:list(ref,100),result:choice('','seekers','runners','cancelled')}))},{exploration:list(x=>object(x,{unit:ref,activeUntil:number}),1)});
}
function validateProjectile(v:unknown,area:string):void {object(v,{id:x=>integer(x,1,0xffffffff),source:x=>reference(x,area),target:x=>reference(x,area),style:choice('bubble','spark','holy','rust'),x:number,y:number,z:number,speed:number,elapsed:number,bornStep:integer});}
function checkSnapshot(p:unknown,c:GameplayCatalog,area:string,ownedPublic=false,publicChecked=false):asserts p is SnapshotPayload {
 object(p,{full:bool,baseline:integer,eventWatermark:v=>integer(v,-1),world:choice('w1','w2','w3','w4','w5','w6'),time:number,selfRef:v=>reference(v,area),poses:publicChecked?()=>{}:list(ownedPublic?()=>{}:renderSource,LIMITS.actors),actors:publicChecked?()=>{}:list(v=>{object(v,{ref:x=>reference(x,area),fields:x=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!ACTOR_FIELDS.includes(k as typeof ACTOR_FIELDS[number])))fail('unknown actor field');}},{poseDelta:x=>poseDelta(x,c),poseRecipe:x=>integer(x,0,LIMITS.actors-1)});},LIMITS.actors),removed:publicChecked?()=>{}:list(v=>reference(v,area),LIMITS.actors),projectiles:publicChecked?()=>{}:list(v=>validateProjectile(v,area),LIMITS.projectiles),self:v=>validateSelf(v,c,area),features:v=>validateFeatures(v,area),recovery:v=>object(v,{telegraphs:list(x=>{validateEvent(x,c,area);if((x as EventRecord).event.type!=='telegraph')fail('non-telegraph recovery');},64),endings:list(x=>object(x,{unit:v=>reference(v,area),chapter:choice(4),replay:bool}),1)},{bosses:list(x=>object(x,{unit:v=>reference(v,area),profile:choice('rust','abyss','eclipse','dawn','frost','ember','sky'),state:choice('dormant','waking','idle','fight','dying','dead'),phase:integer,enraged:bool,stateTime:number,freed:v=>reference(v,area),freedTime:number,showFrame:bool}),5)}),events:list(v=>validateEvent(v,c,area),LIMITS.events),results:list(validateResult,256)});
 const snapshot=p as unknown as SnapshotPayload;
 if(snapshot.full?(snapshot.baseline!==0||snapshot.removed.length>0):snapshot.baseline<1)fail('invalid baseline');
 if(snapshot.self.player.unit.id!==snapshot.selfRef.id||snapshot.self.player.unit.life!==snapshot.selfRef.life)fail('self reference mismatch');
 if(publicChecked)return;
 const ids=new Set<number>();for(const r of snapshot.actors){if(ids.has(r.ref.id))fail('duplicate actor update');ids.add(r.ref.id);if(r.poseRecipe!==undefined&&(r.poseRecipe>=snapshot.poses.length||r.fields.pose||r.poseDelta))fail('invalid/ambiguous recipe index');if(r.poseDelta&&(snapshot.full||r.fields.pose))fail('ambiguous pose patch');if(snapshot.full&&!ownedPublic)actorShape({ref:r.ref,...r.fields},c,area,r.poseRecipe===undefined);}
 for(const r of snapshot.removed){if(ids.has(r.id))fail('duplicate actor removal');ids.add(r.id);}
 const pids=new Set<number>();for(const r of snapshot.projectiles){if(pids.has(r.id))fail('duplicate projectile');pids.add(r.id);}
}
export function validateSnapshot(p:unknown,c:GameplayCatalog,area:string):asserts p is SnapshotPayload {checkSnapshot(p,c,area);}
export function projectActor(unit:Readonly<SimUnit>,appearance:Appearance|null):PublicActor {return copyValue(Object.fromEntries([['ref',unit.ref],...ACTOR_FIELDS.map(k=>[k,k==='appearance'?appearance:k==='pose'?{appliedQ:unit.pose.appliedQ,appliedPosition:unit.pose.appliedPosition,appliedRotation:unit.pose.appliedRotation,localVx:unit.pose.localVx,localVz:unit.pose.localVz}:unit[k]])])) as PublicActor;}
export function projectSelf(player:Readonly<PlayerState>,achievements:AchievementView,inCombat:boolean):SelfView {const {character:_character,achievements:_achievements,...rest}=player as PlayerState&{achievements?:AchievementView};return copyValue({player:rest,achievements,inCombat});}
export interface ObservationInput {
 binding:WireBinding;sequence:number;tick:number;acceptedInput:number;consumedInput:number;selfRef:EntityRef;
 snapshot:AreaSnapshot;prepared?:PreparedObservation;events:readonly EventRecord[];visibleIds:ReadonlySet<number>;full:boolean;eventWatermark:number;
 features:FeatureView;recovery:RecoveryView;achievements:AchievementView;appearances:Readonly<Record<string,Appearance>>;results?:readonly CommandResult[];
}
export type WorldControl=
 | {type:'inputAck'}
 | {type:'chatLine';channel:'area'|'party';line:{sender:EntityRef;name:string;text:string;at:number}}
 | {type:'chatPreferences';enabled:boolean;partyOnly:boolean}
 | {type:'chatResult';inputSequence:number;operation:'say'|'preferences'|'block'|'mute'|'report';ok:boolean;target?:EntityRef;blocked?:boolean;muted?:boolean;error?:string}
 | {type:'party';state:null|{code:string;leader:string;members:readonly {id:string;name:string;ref:EntityRef|null;world:AreaSnapshot['world'];online:boolean}[];pvp:boolean}}
 | {type:'queued';world:'w1'|'w2'|'w3'|'w4'|'w5'|'w6';position:number}
 | {type:'error';code:string;retryable:boolean}
 | {type:'restarting';retryAfterSeconds:number}
 | {type:'resync';lastSequence:number;reason:'baseline'|'gap'|'fragment'|'catalog'};
export function validateControl(v:unknown):asserts v is WorldControl {
 if(!v||typeof v!=='object')fail('invalid control');const type=(v as WorldControl).type;
 if(type==='inputAck')object(v,{type:choice(type)});
 else if(type==='chatLine')object(v,{type:choice(type),channel:choice('area','party'),line:x=>object(x,{sender:reference,name:v=>text(v,64),text:v=>{if(typeof v!=='string'||!v.length||[...v].length>CHAT_MAX)fail('invalid filtered chat text');},at:integer})});
 else if(type==='chatPreferences')object(v,{type:choice(type),enabled:bool,partyOnly:bool});
 else if(type==='chatResult'){object(v,{type:choice(type),inputSequence:x=>integer(x,1),operation:choice('say','preferences','block','mute','report'),ok:bool},{target:reference,blocked:bool,muted:bool,error:text});if(v.operation!=='block'&&v.blocked!==undefined||v.operation!=='mute'&&v.muted!==undefined)fail('private/unrelated moderation state');if(v.ok){if(v.error!==undefined)fail('successful chat result has error');if(['block','mute','report'].includes(v.operation as string)&&v.target===undefined)fail('chat result missing target');if(v.operation==='block'&&v.blocked===undefined||v.operation==='mute'&&v.muted===undefined)fail('chat result missing state');}else if(v.error===undefined)fail('chat failure missing error');}
 else if(type==='party')object(v,{type:choice(type),state:nullable(s=>{object(s,{code:x=>{if(typeof x!=='string'||! /^[0-9A-F]{6}$/.test(x))fail('invalid party code');},leader:text,members:list(m=>object(m,{id:text,name:x=>text(x,64),ref:nullable(reference),world:choice('w1','w2','w3','w4','w5','w6'),online:bool}),8,1),pvp:bool});const members=s.members as {id:string}[];if(new Set(members.map(m=>m.id)).size!==members.length||!members.some(m=>m.id===s.leader))fail('invalid party membership');})});
 else if(type==='queued')object(v,{type:choice(type),world:choice('w1','w2','w3','w4','w5','w6'),position:x=>integer(x,1)});
 else if(type==='error')object(v,{type:choice(type),code:text,retryable:bool});
 else if(type==='restarting')object(v,{type:choice(type),retryAfterSeconds:number});
 else if(type==='resync')object(v,{type:choice(type),lastSequence:integer,reason:choice('baseline','gap','fragment','catalog')});else fail('unknown control');
}
export function encodeControl(h:WireHeader,value:WorldControl):Uint8Array[] {validateControl(value);return encodeMessage(17,h,value);}
export interface GameplayProtocol {
 readonly catalog:GameplayCatalog;
 encodeObservation(input:ObservationInput):Uint8Array[];
 encodeEvents(header:WireHeader,payload:import('./events.ts').EventPayload):Uint8Array[];
 encodeInput(packet:import('./intents.ts').InputPacket):Uint8Array;
 decodeInput(bytes:Uint8Array,expected:WireBinding):import('./intents.ts').GameplayInput;
 decodeClientMessage(bytes:Uint8Array,expected:WireBinding):{kind:'input';intent:import('./intents.ts').GameplayInput}|{kind:'resync';sequence:number;lastSequence:number;reason:string};
 encodeControl:typeof encodeControl;
 reset(binding:WireBinding):void;
}
/** One instance per connection: binding, sequence and successful baseline advancement remain connection-owned. */
export function createGameplayProtocol(catalog:GameplayCatalog):GameplayProtocol {
 catalog=clone(catalog);text(catalog.version);integer(catalog.jointCount,1,30);if(catalog.poseProviderVersion!==renderPoseProviderVersion)fail('pose provider mismatch');const catalogSignature=JSON.stringify(catalog);let previousRecipes=new Map<number,RenderPoseSource>();let previous:readonly PublicActor[]=[],prior:WireHeader|null=null;let previousPublic:PublicBaseline|null=null;let controlBinding:WireBinding|null=null,controlSequence=0,resyncPending=false;
 return {
  catalog:clone(catalog),encodeEvents:(h,p)=>encodeEvents(h,p,catalog),encodeControl,
  encodeInput:p=>encodeInput(p,catalog),decodeInput:(b,e)=>decodeInput(b,e,catalog),
  decodeClientMessage(bytes,expected){
   const m=new FragmentAssembler(expected).accept(bytes,0);if(!m)fail('client message must fit one frame');
   if(m.kind===16)return {kind:'input',intent:decodeInput(bytes,expected,catalog)};
   if(m.kind!==17||m.header.tick||m.header.acceptedInput||m.header.consumedInput)fail('forged client control');validateControl(m.payload);
   if(m.payload.type!=='resync')fail('client cannot publish server control');
   if(!controlBinding||!sameBinding(controlBinding,expected)){controlBinding=clone(expected);controlSequence=0;resyncPending=false;}
   if(m.header.sequence<=controlSequence||resyncPending)fail('stale or outstanding recovery request');controlSequence=m.header.sequence;resyncPending=true;
   return {kind:'resync',sequence:m.header.sequence,lastSequence:m.payload.lastSequence,reason:m.payload.reason};
  },
  reset(next){binding(next);previous=[];previousRecipes=new Map();previousPublic=null;prior=null;if(!controlBinding||!sameBinding(controlBinding,next)){controlBinding=clone(next);controlSequence=0;resyncPending=false;}},
  encodeObservation(input){
   const h:WireHeader={...input.binding,sequence:input.sequence,tick:input.tick,acceptedInput:input.acceptedInput,consumedInput:input.consumedInput};header(h);
   if(h.catalog!==catalog.version||input.snapshot.area!==h.area||input.snapshot.tick!==h.tick)fail('snapshot identity mismatch');
   if(prior&&(!sameBinding(prior,h)||h.sequence<=prior.sequence||h.tick<prior.tick||h.acceptedInput<prior.acceptedInput||h.consumedInput<prior.consumedInput))fail('snapshot stream regression; reset required');
   const player=input.snapshot.players.find(p=>p.unit.id===input.selfRef.id&&p.unit.life===input.selfRef.life);if(!player)fail('missing owned self');
   const prepared=input.prepared?preparedObservations.get(input.prepared):undefined;
   if(input.prepared&&(!prepared||prepared.source!==input.snapshot||prepared.catalog!==catalogSignature))fail('forged/stale prepared observation');
   const full=input.full||!prior;let actors:readonly PublicActor[],recipes:Map<number,RenderPoseSource>,baseline:PublicBaseline,publicFields:PublicSnapshotFields,projection:PreparedProjection|undefined;
   if(prepared){baseline=preparedBaseline(prepared,input.visibleIds,input.selfRef.id);projection=preparedProjection(prepared,baseline,full?null:previousPublic!);publicFields=projection.fields;actors=baseline.actors;recipes=baseline.recipes;}
   else {
   actors=input.snapshot.units.filter(u=>input.visibleIds.has(u.ref.id)||u.ref.id===input.selfRef.id).map(u=>{
    const appearance=input.appearances[`${u.ref.id}:${u.ref.life}`]??null;if(u.kind==='player'&&!appearance)fail('missing player appearance');return projectActor(u,appearance);
   });
   const old=new Map(previous.map(a=>[a.ref.id,a])),updates:ActorUpdate[]=[],ids=new Set(actors.map(a=>a.ref.id));
   const poses:RenderPoseSource[]=[],posePool=new Map<string,number>();recipes=new Map<number,RenderPoseSource>();
   const units=new Map(input.snapshot.units.map(u=>[u.ref.id,u]));
   for(const a of actors){
    validateActor(a,catalog,h.area);const prev=full?null:old.get(a.ref.id),sameLife=!!prev&&prev.ref.life===a.ref.life;
    let fields:Partial<Omit<PublicActor,'ref'>>;
    fields={};for(const k of ACTOR_FIELDS){if(k==='pose')continue;if(!sameLife||!equalValue(prev![k],a[k]))(fields as Record<string,unknown>)[k]=a[k];}
    const recipe={recipe:createRenderPoseRecipe(units.get(a.ref.id)!),localVx:a.pose.localVx,localVz:a.pose.localVz};renderSource(recipe);recipes.set(a.ref.id,recipe);
    let index:number|undefined;if(!sameLife||!equalValue(previousRecipes.get(a.ref.id),recipe)){const key=recipeKey(recipe);index=posePool.get(key);if(index===undefined){index=poses.length;posePool.set(key,index);poses.push(recipe);}}
    if(Object.keys(fields).length||index!==undefined)updates.push({ref:a.ref,fields,...(index===undefined?{}:{poseRecipe:index})});
   }
   const projectiles=input.snapshot.projectiles.filter(p=>ids.has(p.source.id)||ids.has(p.target.id)).map(({hit:_hit,anchorVersion:_anchor,...p})=>p);
   publicFields={world:input.snapshot.world,time:input.snapshot.time,poses,actors:updates,removed:full?[]:previous.filter(a=>!ids.has(a.ref.id)).map(a=>a.ref),projectiles};
   baseline=makePublicBaseline(actors,recipes);
   }
   const ownUnit=input.snapshot.units.find(u=>u.ref.id===input.selfRef.id&&u.ref.life===input.selfRef.life);if(!ownUnit)fail('missing owned actor');
   const payload:SnapshotPayload={...publicFields,full,baseline:full?0:prior!.sequence,eventWatermark:input.eventWatermark,selfRef:input.selfRef,self:projectSelf(player,input.achievements,input.snapshot.time-ownUnit.lastCombat<5),features:input.features,recovery:input.recovery,events:selectEvents(input.events,input.selfRef,player.character,baseline.ids),results:input.results??[]};
   checkSnapshot(payload,catalog,h.area,!!prepared,!!projection?.validated);if(projection)projection.validated=true;if(payload.results.some(r=>r.inputSequence>h.consumedInput))fail('result precedes input consumption');const encoded=projection?encodePreparedSnapshot(h,payload,projection.prefix):encodeMessage(1,h,payload);previous=actors;previousRecipes=recipes;previousPublic=baseline;prior=clone(h);if(full)resyncPending=false;return encoded;
  },
 };
}
function validateAppearance(v:unknown,c:GameplayCatalog):void {
 object(v,{race:catalogValue(Object.keys(c.appearanceLimits)),sex:choice('male','female'),classId:choice('warrior','mage','priest'),shell:integer,crest:integer,led:integer,name:x=>text(x,64)});
 const limits=c.appearanceLimits[v.race as string];for(const k of ['shell','crest','led'] as const)integer(v[k],0,limits[k]-1);
}
export interface GameplayState {
 header:WireHeader;sequence:number;world:AreaSnapshot['world'];time:number;eventWatermark:number;selfRef:EntityRef;
 actors:readonly PublicActor[];projectiles:readonly PublicProjectile[];self:SelfView;features:FeatureView;recovery:RecoveryView;
}
export type ReceivedGameplay=
 | {kind:'snapshot';state:GameplayState;events:readonly EventRecord[];results:readonly CommandResult[]}
 | {kind:'events';events:readonly EventRecord[];results:readonly CommandResult[]}
 | {kind:'control';control:WorldControl};
export class GameplayReceiver {
 private binding:WireBinding;private catalog:GameplayCatalog;private assembler:FragmentAssembler;
 private current:GameplayState|null=null;private last:WireHeader|null=null;private eventOrder=-1;
 needsResync=false;
 constructor(expected:WireBinding,catalog:GameplayCatalog){binding(expected);if(expected.catalog!==catalog.version)fail('catalog mismatch');if(catalog.poseProviderVersion!==renderPoseProviderVersion)fail('pose provider mismatch');this.binding=clone(expected);this.catalog=clone(catalog);this.assembler=new FragmentAssembler(expected);}
 get state():GameplayState|null{return this.current?clone(this.current):null;}
 get header():WireHeader|null{return this.last?clone(this.last):null;}
 get retainedBytes():number{return this.assembler.retainedBytes;}
 reset(expected:WireBinding):void {binding(expected);if(expected.catalog!==this.catalog.version)fail('catalog mismatch');if(expected.session===this.binding.session&&expected.epoch<=this.binding.epoch)fail('epoch must advance');this.binding=clone(expected);this.assembler.reset(expected);this.current=null;this.last=null;this.eventOrder=-1;this.needsResync=false;}
 accept(bytes:Uint8Array,now:number):ReceivedGameplay|null {
  try{
   const message=this.assembler.accept(bytes,now);if(!message)return null;
   const h=message.header;if(message.interrupted)this.needsResync=true;
   if(this.last&&(h.sequence<=this.last.sequence||h.tick<this.last.tick||h.acceptedInput<this.last.acceptedInput||h.consumedInput<this.last.consumedInput))fail('stale observation');
   if(message.kind===1){
    validateSnapshot(message.payload,this.catalog,h.area);const p=message.payload;if(p.results.some(r=>r.inputSequence>h.consumedInput))fail('result precedes input consumption');
    if(!p.full&&(this.needsResync||!this.current||p.baseline!==this.current.sequence||h.sequence!==(this.last?.sequence??0)+1))fail('missing baseline or sequence gap');
    if(this.current&&(p.selfRef.id!==this.current.selfRef.id||p.selfRef.life!==this.current.selfRef.life))fail('self life changed without epoch reset');
    if(p.eventWatermark<this.eventOrder||p.events.some(e=>e.tick>h.tick||e.order>p.eventWatermark))fail('invalid event watermark');
    const actors=new Map<number,PublicActor>(p.full?[]:this.current!.actors.map(a=>[a.ref.id,clone(a)])),poses=new Map<number,PublicPose>();
    for(const r of p.removed){const old=actors.get(r.id);if(!old||old.ref.life!==r.life)fail('unknown/stale removal');actors.delete(r.id);}
    for(const r of p.actors){
     const old=actors.get(r.ref.id);if(old&&r.ref.life<old.ref.life)fail('stale actor life');
     if(!old||old.ref.life!==r.ref.life)for(const key of ACTOR_FIELDS)if(!(key==='pose'&&r.poseRecipe!==undefined)&&!Object.hasOwn(r.fields,key))fail('partial new actor life');
     const actor={...old,...r.fields,ref:r.ref};if(r.poseRecipe!==undefined){let pose=poses.get(r.poseRecipe);if(!pose){const source=p.poses[r.poseRecipe];pose={...evaluateRenderPoseRecipe(source.recipe),localVx:source.localVx,localVz:source.localVz};poses.set(r.poseRecipe,pose);}actor.pose=clone(pose);}if(r.poseDelta){if(!old)fail('pose delta without actor');actor.pose=applyPoseDelta(old.pose,r.poseDelta);}validateActor(actor,this.catalog,h.area);actors.set(actor.ref.id,actor);
    }
    if(actors.size>LIMITS.actors)fail('actor capacity');const self=actors.get(p.selfRef.id);if(!self||self.ref.life!==p.selfRef.life||self.kind!=='player')fail('missing exact self actor');
    let order=p.full?-1:this.eventOrder;for(const e of p.events){if(e.order<=order)fail('replayed/unordered event');order=e.order;}
    const next:GameplayState={header:h,sequence:h.sequence,world:p.world,time:p.time,eventWatermark:p.eventWatermark,selfRef:p.selfRef,actors:[...actors.values()].sort((a,b)=>a.ref.id-b.ref.id),projectiles:p.projectiles,self:p.self,features:p.features,recovery:p.recovery};
    const deliver=p.full?[]:p.events;
    this.current=clone(next);this.last=clone(h);this.eventOrder=p.eventWatermark;this.needsResync=false;
    return {kind:'snapshot',state:clone(next),events:clone(deliver),results:clone(p.results)};
   }
   if(this.needsResync||h.sequence!==(this.last?.sequence??0)+1)fail('missing publication sequence');
   if(message.kind===2){
    validateEventPayload(message.payload,this.catalog,h.area);const p=message.payload;if(p.results.some(r=>r.inputSequence>h.consumedInput))fail('result precedes input consumption');
    if(!this.current||p.baselineSequence!==this.current.sequence)fail('events before actor baseline');
    let order=this.eventOrder;for(const e of p.events){if(e.order<=order||e.tick>h.tick)fail('replayed/unordered event');order=e.order;}
    this.last=clone(h);this.eventOrder=order;return {kind:'events',events:clone(p.events),results:clone(p.results)};
   }
   if(message.kind!==17)fail('server cannot send input');validateControl(message.payload);if(message.payload.type==='resync')fail('server cannot request client baseline');
   this.last=clone(h);return {kind:'control',control:clone(message.payload)};
  }catch(error){this.needsResync=true;this.assembler.clear();throw error;}
 }
}
/** Project only the owning character's feature/progression recovery from the real Area snapshot. */
export function projectObservationExtras(snapshot:AreaSnapshot,character:string,visibleIds:ReadonlySet<number>):Pick<ObservationInput,'features'|'recovery'|'achievements'> {
 const self=snapshot.players.find(p=>p.character===character);if(!self)fail('missing feature owner');
 const bindings=snapshot.features.bindings,resolve=(id:string):EntityRef=>{const ref=bindings[id];if(!ref)fail('missing exact feature binding');reference(ref,snapshot.area);return ref;};
 const boat=snapshot.features.boat,village=snapshot.features.village;
 const features:FeatureView={environment:{beacon:snapshot.features.beaconLit,clock:snapshot.time,mode:snapshot.features.mode,pvp:snapshot.features.pvp},boat:{x:boat.x,z:boat.z,yaw:boat.yaw,speed:boat.speed,seats:boat.seats.map(id=>id===null?null:resolve(id))},village:village?{id:village.id,mode:village.mode,phase:village.phase,left:village.left,starter:resolve(village.starter),seeker:resolve(village.seeker),members:village.members.map(resolve),caught:village.caught.map(resolve),result:village.result}:null};
 const telegraphs=snapshot.recovery.telegraphs.filter(e=>e.event.type==='telegraph'&&visibleIds.has(e.event.src.id));
 const endings=snapshot.recovery.endings.filter(e=>e.unit.id===self.unit.id&&e.unit.life===self.unit.life);
 const exploration=(snapshot.features as AreaSnapshot['features']&{exploration?:readonly {unit:EntityRef;activeUntil:number}[]}).exploration;
 if(exploration)features.exploration=exploration.filter(e=>e.unit.id===self.unit.id&&e.unit.life===self.unit.life);
 const bosses=snapshot.recovery.bosses.filter(b=>visibleIds.has(b.unit.id));
 return clone({features,recovery:{telegraphs,endings,bosses},achievements:self.achievements});
}

function equalValue(a:unknown,b:unknown):boolean {
 if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equalValue(v,b[i]));
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equalValue((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}

/** Unforgeable per-publication token. It exposes no personal state or actor payload. */
export interface PreparedObservation {readonly kind:'gameplay-prepared-v1';readonly area:string;readonly tick:number}
interface PreparedPublicData {baselines:Map<string,PublicBaseline>;full:Map<PublicBaseline,PreparedProjection>;changes:WeakMap<PublicBaseline,Map<PublicBaseline,PreparedProjection>>;cachedGroups:number;cachedBytes:number;source:AreaSnapshot;catalog:string;actors:ReadonlyMap<number,PublicActor>;recipes:ReadonlyMap<number,RenderPoseSource>;poseKeys:ReadonlyMap<number,string>;fullFields:ReadonlyMap<number,Partial<Omit<PublicActor,'ref'>>>;deltas:WeakMap<PublicActor,{actor:PublicActor;fields:Partial<Omit<PublicActor,'ref'>>}>}
const preparedObservations=new WeakMap<PreparedObservation,PreparedPublicData>();
function assertDeepFrozen(value:unknown,seen=new Set<object>(),depth=0):void {
 if(depth>LIMITS.depth)fail('prepared snapshot depth');if(value===null||typeof value!=='object')return;
 if(seen.has(value))return;seen.add(value);
 if(!Object.isFrozen(value)||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('prepared snapshot requires deeply frozen plain values');
 for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')fail('symbol in prepared snapshot');const descriptor=Object.getOwnPropertyDescriptor(value,key)!;if(!Object.hasOwn(descriptor,'value'))fail('accessor in prepared snapshot');assertDeepFrozen(descriptor.value,seen,depth+1);}
}
/** Host calls once for its owned immutable Area.snapshot(), before its per-viewer AOI loop. */
export function prepareObservationSnapshot(snapshot:AreaSnapshot,appearances:ObservationInput['appearances'],catalog:GameplayCatalog):PreparedObservation {
 assertDeepFrozen(snapshot);integer(snapshot.units.length,0,LIMITS.actors);if(catalog.poseProviderVersion!==renderPoseProviderVersion)fail('pose provider mismatch');
 const actors=new Map<number,PublicActor>(),recipes=new Map<number,RenderPoseSource>(),poseKeys=new Map<number,string>(),fullFields=new Map<number,Partial<Omit<PublicActor,'ref'>>>();
 for(const unit of snapshot.units){
  if(actors.has(unit.ref.id))fail('duplicate prepared actor');
  const appearance=appearances[`${unit.ref.id}:${unit.ref.life}`]??null;if(unit.kind==='player'&&!appearance)fail('missing prepared player appearance');
  const actor=Object.freeze(Object.fromEntries([['ref',unit.ref],...ACTOR_FIELDS.map(k=>[k,k==='appearance'?freezeValue(copyValue(appearance)):k==='pose'?Object.freeze({appliedQ:unit.pose.appliedQ,appliedPosition:unit.pose.appliedPosition,appliedRotation:unit.pose.appliedRotation,localVx:unit.pose.localVx,localVz:unit.pose.localVz}):unit[k]])])) as PublicActor;validateActor(actor,catalog,snapshot.area);
  const recipe={recipe:createRenderPoseRecipe(unit),localVx:actor.pose.localVx,localVz:actor.pose.localVz};renderSource(recipe);
  actors.set(unit.ref.id,actor);recipes.set(unit.ref.id,freezeValue(copyValue(recipe)));poseKeys.set(unit.ref.id,recipeKey(recipe));fullFields.set(unit.ref.id,freezeValue(Object.fromEntries(ACTOR_FIELDS.filter(k=>k!=='pose').map(k=>[k,actor[k]]))));
 }
 const token:PreparedObservation=Object.freeze({kind:'gameplay-prepared-v1',area:snapshot.area,tick:snapshot.tick});
 preparedObservations.set(token,{source:snapshot,catalog:JSON.stringify(clone(catalog)),actors,recipes,poseKeys,fullFields,deltas:new WeakMap(),baselines:new Map(),full:new Map(),changes:new WeakMap(),cachedGroups:0,cachedBytes:0});return token;
}

/** End one synchronous publication; connection baselines contain only detached public values. */
export function releasePreparedObservation(token:PreparedObservation):void {preparedObservations.delete(token);}

function recipeKey(recipe:RenderPoseSource):string {return JSON.stringify(recipe,(_key,value)=>typeof value==='number'&&Object.is(value,-0)?'negative-zero':value);}

// A cache bound is a reuse limit, never a packet/actor/AOI acceptance limit. Excess groups take the same uncached path.
const MAX_PREPARED_GROUPS=100,MAX_PREPARED_PREFIX_BYTES=LIMITS.messageBytes;
const PUBLIC_SNAPSHOT_FIELDS=['world','time','poses','actors','removed','projectiles'] as const;
const PRIVATE_SNAPSHOT_FIELDS=['full','baseline','eventWatermark','selfRef','self','features','recovery','events','results'] as const;
type PublicSnapshotFields=Pick<SnapshotPayload,'world'|'time'|'poses'|'actors'|'removed'|'projectiles'>;
interface PublicBaseline {actors:readonly PublicActor[];byId:ReadonlyMap<number,PublicActor>;ids:ReadonlySet<number>;recipes:Map<number,RenderPoseSource>;recipeKeys:ReadonlyMap<number,string>}
interface PreparedProjection {fields:PublicSnapshotFields;prefix:ValuePrefix;validated:boolean}
function makePublicBaseline(actors:readonly PublicActor[],recipes:Map<number,RenderPoseSource>,keys?:ReadonlyMap<number,string>):PublicBaseline {return{actors,byId:new Map(actors.map(a=>[a.ref.id,a])),ids:new Set(actors.map(a=>a.ref.id)),recipes,recipeKeys:keys??new Map([...recipes].map(([id,recipe])=>[id,recipeKey(recipe)]))};}
function preparedBaseline(p:PreparedPublicData,visible:ReadonlySet<number>,self:number):PublicBaseline {
 const actors=p.source.units.filter(u=>visible.has(u.ref.id)||u.ref.id===self).map(u=>p.actors.get(u.ref.id)!),key=actors.map(a=>a.ref.id).join(','),cached=p.baselines.get(key);if(cached)return cached;
 const baseline=makePublicBaseline(Object.freeze(actors),new Map(actors.map(a=>[a.ref.id,p.recipes.get(a.ref.id)!])),new Map(actors.map(a=>[a.ref.id,p.poseKeys.get(a.ref.id)!])));if(p.baselines.size<MAX_PREPARED_GROUPS)p.baselines.set(key,baseline);return baseline;
}
function preparedProjection(p:PreparedPublicData,current:PublicBaseline,previous:PublicBaseline|null):PreparedProjection {
 const cache=previous?p.changes.get(previous):p.full,cached=cache?.get(current);if(cached)return cached;
 const poses:RenderPoseSource[]=[],pool=new Map<string,number>(),updates:ActorUpdate[]=[];
 for(const actor of current.actors){const prev=previous?.byId.get(actor.ref.id),sameLife=!!prev&&prev.ref.life===actor.ref.life,cachedFields=prev?p.deltas.get(prev):undefined;let fields:Partial<Omit<PublicActor,'ref'>>;
  if(!sameLife)fields=p.fullFields.get(actor.ref.id)!;
  else if(cachedFields?.actor===actor)fields=cachedFields.fields;
  else{fields={};for(const k of ACTOR_FIELDS)if(k!=='pose'&&!equalValue(prev![k],actor[k]))(fields as Record<string,unknown>)[k]=actor[k];p.deltas.set(prev!,{actor,fields:freezeValue(fields)});}
  let index:number|undefined;const key=current.recipeKeys.get(actor.ref.id)!;if(!sameLife||previous!.recipeKeys.get(actor.ref.id)!==key){index=pool.get(key);if(index===undefined){index=poses.length;pool.set(key,index);poses.push(current.recipes.get(actor.ref.id)!);}}
  if(Object.keys(fields).length||index!==undefined)updates.push({ref:actor.ref,fields,...(index===undefined?{}:{poseRecipe:index})});
 }
 const fields:PublicSnapshotFields={world:p.source.world,time:p.source.time,poses,actors:updates,removed:previous?previous.actors.filter(a=>!current.ids.has(a.ref.id)).map(a=>a.ref):[],projectiles:p.source.projectiles.filter(f=>current.ids.has(f.source.id)||current.ids.has(f.target.id)).map(({hit:_hit,anchorVersion:_version,...flight})=>flight)};
 const writer=valueEncoder();writer.beginRecord(PUBLIC_SNAPSHOT_FIELDS.length+PRIVATE_SNAPSHOT_FIELDS.length);for(const key of PUBLIC_SNAPSHOT_FIELDS)writer.field(key,fields[key]);const projection={fields,prefix:writer.prefix(),validated:false};
 if(p.cachedGroups<MAX_PREPARED_GROUPS&&p.cachedBytes+projection.prefix.bytes.length<=MAX_PREPARED_PREFIX_BYTES){let target=cache;if(!target&&previous){target=new Map();p.changes.set(previous,target);}target!.set(current,projection);p.cachedGroups++;p.cachedBytes+=projection.prefix.bytes.length;}
 return projection;
}
function encodePreparedSnapshot(h:WireHeader,payload:SnapshotPayload,prefix:ValuePrefix):Uint8Array[] {
 const writer=valueEncoder(prefix);for(const key of PRIVATE_SNAPSHOT_FIELDS)writer.field(key,payload[key]);const body=writer.w.finish();return frameMessage(1,h,body,checksum(body,prefix.bytes.length,prefix.hash));
}
