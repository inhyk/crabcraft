/** Gameplay v3. Pure bounded binary values shared by server and browser; v2 is untouched. */
import type { CommandResult } from './events.ts';
import type { AreaSnapshot, EntityRef, EventRecord, PlayerState, ProjectileState, SimUnit } from '../../../src/sim/types.ts';
import { encodeInput, decodeInput } from './intents.ts';
import { encodeEvents, validateEvent, selectEvents, validateEventPayload, validateResult } from './events.ts';
export const MAGIC=0x5747, VERSION=3;
export const LIMITS=Object.freeze({fragmentBytes:16384,messageBytes:2097152,fragments:256,actors:2048,projectiles:4096,events:512,commands:32,depth:24,nodes:300000,stringBytes:4096,array:16384,object:256,assemblySeconds:5});
export interface WireBinding {session:string;area:string;epoch:number;catalog:string}
export interface WireHeader extends WireBinding {sequence:number;tick:number;acceptedInput:number;consumedInput:number}
export interface GameplayCatalog {version:string;archetypes:readonly string[];actions:readonly string[];abilities:readonly string[];quests:readonly string[];npcs:readonly string[];interactions:readonly string[];gates:readonly string[];objectives:readonly string[];flags:readonly string[];jointCount:number;appearanceLimits:Readonly<Record<string,{shell:number;crest:number;led:number}>>}
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
const KEYS=('ref area id life archetype kind reaction level x y z yaw radius height hp maxHp alive hidden targetable invulnerable stunUntil slowUntil slowPct rust rustUntil absorb absorbMax absorbUntil blessingUntil encounterBlessing pushX pushZ pushTime lift npcId pose actions locomotionTime localVx localVz yawRate previousX previousZ previousYaw appliedQ appliedPosition appliedRotation gaitPhase controllerVx controllerVz controllerYaw locomotionQ locomotionPosition locomotionRotation locomotionWeights part upper from to loopFrom loop speed fade carryRoot generation start clipTime fadeIn fadeOut weight targetWeight ended interrupted root curve dataVersion metersToUnits committed committedClipTime rebase character unit classId resource maxResource xp coins attackRank armorRank weaponOwned armorOwned baseMaxHp gcdStart gcdEnd cooldowns cast channel target warded nextSwing lastAttack queued velX velZ jumpT spinT lastSpend targetDeadAt dash t deadUntil role controlsLocked talkTarget quests flags cogMisses chapter status progress cogs tracked ability end targetId source style elapsed bornStep hit anchorVersion type src dst amount crit school reason stage seconds caster range half stun landed slot moment move oldMaxHp jump attack at mech shapes cancelled boss phase show textKey yell recipient item recipients grant appliedHere position quest objective value operation result request destination gate header sequence tick acceptedInput consumedInput session epoch catalog full baseline eventWatermark selfRef actors removed projectiles self features recovery events results world time state weapon armor boat village environment telegraphs ending order inputSequence commandIndex revision durable').split(' ');
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
class Writer {
 bytes=new Uint8Array(1024);view=new DataView(this.bytes.buffer);offset=0;
 need(n:number){if(this.offset+n>LIMITS.messageBytes)fail('message size limit');if(this.offset+n>this.bytes.length){const next=new Uint8Array(Math.min(LIMITS.messageBytes,Math.max(this.bytes.length*2,this.offset+n)));next.set(this.bytes);this.bytes=next;this.view=new DataView(next.buffer);}}
 u8(n:number){this.need(1);this.view.setUint8(this.offset++,n);}
 u16(n:number){this.need(2);this.view.setUint16(this.offset,n,true);this.offset+=2;}
 u32(n:number){this.need(4);this.view.setUint32(this.offset,n,true);this.offset+=4;}
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
 f64(){this.need(8);const n=this.view.getFloat64(this.offset,true);this.offset+=8;number(n);return n;}
 raw(n:number){this.need(n);const b=this.bytes.slice(this.offset,this.offset+n);this.offset+=n;return b;}
 string(){const n=this.u16();if(n>LIMITS.stringBytes)fail('string size limit');return decoder.decode(this.raw(n));}
 end(){if(this.offset!==this.bytes.length)fail('trailing bytes');}
}
export function encodeValue(value:unknown):Uint8Array {
 const w=new Writer(),seen=new Set<object>();let nodes=0;
 const write=(v:unknown,depth:number)=>{
  if(++nodes>LIMITS.nodes||depth>LIMITS.depth)fail('value complexity limit');
  if(v===null){w.u8(0);return;}if(v===false||v===true){w.u8(v?2:1);return;}if(typeof v==='number'){w.u8(3);w.f64(v);return;}if(typeof v==='string'){w.u8(4);w.string(v);return;}
  if(!v||typeof v!=='object'||seen.has(v))fail('non-value or cyclic data');seen.add(v);
  if(Array.isArray(v)){
   if(v.length>LIMITS.array)fail('array size limit');const numeric=v.length>0&&v.every(n=>typeof n==='number');w.u8(numeric?7:5);w.u16(v.length);
   if(numeric){nodes+=v.length;if(nodes>LIMITS.nodes)fail('value complexity limit');v.forEach(n=>w.f64(n));}else v.forEach(n=>write(n,depth+1));
  }else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('non-plain data');const entries=Object.entries(v).filter(([,x])=>x!==undefined);
   if(entries.length>LIMITS.object)fail('object size limit');w.u8(6);w.u16(entries.length);
   for(const[k,x]of entries){if(['__proto__','constructor','prototype'].includes(k))fail('unsafe map key');const i=KEYS.indexOf(k);w.u16(i+1);if(i<0)w.string(k);write(x,depth+1);}
  }seen.delete(v);
 };write(value,0);return w.finish();
}
export function decodeValue(bytes:Uint8Array):Value {
 const r=new Reader(bytes);let nodes=0;
 const read=(depth:number):Value=>{
  if(++nodes>LIMITS.nodes||depth>LIMITS.depth)fail('value complexity limit');const tag=r.u8();
  if(tag===0)return null;if(tag===1)return false;if(tag===2)return true;if(tag===3)return r.f64();if(tag===4)return r.string();
  if(tag===5||tag===7){const length=r.u16();if(length>LIMITS.array)fail('array size limit');if(tag===7){nodes+=length;if(nodes>LIMITS.nodes)fail('value complexity limit');}return Array.from({length},()=>tag===7?r.f64():read(depth+1));}
  if(tag===6){const length=r.u16();if(length>LIMITS.object)fail('object size limit');const result:Record<string,Value>={};for(let i=0;i<length;i++){const keyId=r.u16();if(keyId>KEYS.length)fail('unknown dictionary key');const k=keyId?KEYS[keyId-1]:r.string();if(Object.hasOwn(result,k)||['__proto__','constructor','prototype'].includes(k))fail('duplicate/unsafe key');result[k]=read(depth+1);}return result;}
  return fail('unknown binary tag');
 };const result=read(0);r.end();return result;
}
function checksum(bytes:Uint8Array):number {let n=2166136261;for(const b of bytes)n=Math.imul(n^b,16777619);return n>>>0;}
export function encodeMessage(kind:1|2|16|17,h:WireHeader,payload:unknown):Uint8Array[] {
 header(h);const body=encodeValue(payload),hash=checksum(body),hbytes=encodeValue(h),overhead=4+2+hbytes.length+2+2+4+4;
 const room=LIMITS.fragmentBytes-overhead;if(room<1)fail('oversized header');const count=Math.max(1,Math.ceil(body.length/room));if(count>LIMITS.fragments)fail('fragment count limit');
 return Array.from({length:count},(_,i)=>{const w=new Writer();w.u16(MAGIC);w.u8(VERSION);w.u8(kind);w.u16(hbytes.length);w.raw(hbytes);w.u16(i);w.u16(count);w.u32(body.length);w.u32(hash);w.raw(body.slice(i*room,(i+1)*room));return w.finish();});
}
export interface DecodedMessage {kind:1|2|16|17;header:WireHeader;payload:Value}
/** One bounded in-flight group. No snapshot state changes until every fragment validates. */
export class FragmentAssembler {
 private binding:WireBinding;
 private pending:{kind:DecodedMessage['kind'];header:WireHeader;count:number;total:number;hash:number;started:number;parts:Map<number,Uint8Array>;size:number}|null=null;
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
  let p=this.pending;
  if(p&&(p.kind!==kind||p.header.sequence!==h.sequence))fail('interleaved group; resync required');
  if(p&&(JSON.stringify(p.header)!==JSON.stringify(h)||p.count!==count||p.total!==total||p.hash!==hash||now<p.started))fail('inconsistent fragment group');
  if(!p)p={kind:kind as DecodedMessage['kind'],header:h,count,total,hash,started:now,parts:new Map(),size:0};
  if(p.parts.has(index))fail('duplicate fragment');if(p.size+part.length>total)fail('fragment total exceeded');
  p.parts.set(index,part);p.size+=part.length;this.pending=p;if(p.parts.size<count)return null;
  this.pending=null;if(p.size!==total)fail('fragment size mismatch');const merged=new Uint8Array(total);let offset=0;
  for(let i=0;i<count;i++){const b=p.parts.get(i)!;merged.set(b,offset);offset+=b.length;}if(checksum(merged)!==hash)fail('fragment checksum mismatch');
  return {kind:p.kind,header:p.header,payload:decodeValue(merged)};
 }
}
export function actionState(value:unknown,c:GameplayCatalog):void {
 const nonnegative=(v:unknown)=>{number(v);if(v<0)fail('negative action value');};
 object(value,{id:catalogValue(c.actions),part:choice('move','channel','release'),upper:bool,from:nonnegative,to:nullable(number),loopFrom:nullable(number),loop:bool,speed:nonnegative,fade:nonnegative,carryRoot:bool,generation:v=>integer(v,1),start:number,clipTime:number,fadeIn:nonnegative,fadeOut:nonnegative,weight:v=>{number(v);if(v<0||v>1)fail('action weight');},targetWeight:choice(0,1),ended:bool,interrupted:bool,root:nullable(v=>object(v,{curve:catalogValue(c.actions),dataVersion:text,metersToUnits:nonnegative,committed:bool,committedClipTime:nullable(number),rebase:nullable(x=>object(x,{x:number,z:number,yaw:number}))}))});
}
function poseState(value:unknown,c:GameplayCatalog):void {
 const scalar=['locomotionTime','localVx','localVz','yawRate','previousX','previousZ','previousYaw','gaitPhase','controllerVx','controllerVz','controllerYaw'];
 object(value,{...Object.fromEntries(scalar.map(k=>[k,number])),appliedQ:v=>tuple(v,c.jointCount),appliedPosition:v=>tuple(v,3),appliedRotation:v=>tuple(v,4),locomotionQ:v=>tuple(v,c.jointCount),locomotionPosition:v=>tuple(v,3),locomotionRotation:v=>tuple(v,4),locomotionWeights:v=>mapValues(v,number,c.actions)});
}
export interface Appearance {race:string;sex:'male'|'female';classId:'warrior'|'mage'|'priest';shell:number;crest:number;led:number;name:string}
export type PublicActor=Omit<SimUnit,'pendingHit'|'lastCombat'>&{appearance:Appearance|null};
export type PublicProjectile=Omit<ProjectileState,'hit'|'anchorVersion'>;
export type SelfPlayer=Omit<PlayerState,'character'|'achievements'>&{lighthouseSecretFound?:boolean};
export interface AchievementView {distance:number;earned:readonly string[]}
export interface SelfView {player:SelfPlayer;achievements:AchievementView}
export interface FeatureView {
 environment:{beacon:boolean;clock:number};
 boat:null|{x:number;z:number;yaw:number;speed:number;seats:readonly(EntityRef|null)[]};
 village:null|{id:string;mode:'hide'|'tag';phase:'ready'|'play'|'done';left:number;starter:EntityRef;seeker:EntityRef;members:readonly EntityRef[];caught:readonly EntityRef[];result:string};
}
export interface RecoveryView {telegraphs:readonly EventRecord[];endings:readonly {unit:EntityRef;chapter:4;replay:boolean}[]}
export interface ActorUpdate {ref:EntityRef;fields:Partial<Omit<PublicActor,'ref'>>}
export interface SnapshotPayload {
 full:boolean;baseline:number;eventWatermark:number;world:AreaSnapshot['world'];time:number;selfRef:EntityRef;
 actors:readonly ActorUpdate[];removed:readonly EntityRef[];projectiles:readonly PublicProjectile[];
 self:SelfView;features:FeatureView;recovery:RecoveryView;events:readonly EventRecord[];results:readonly CommandResult[];
}
const ACTOR_FIELDS=['archetype','kind','reaction','level','x','y','z','yaw','radius','height','hp','maxHp','alive','hidden','targetable','invulnerable','stunUntil','slowUntil','slowPct','rust','rustUntil','absorb','absorbMax','absorbUntil','blessingUntil','encounterBlessing','pushX','pushZ','pushTime','lift','npcId','pose','actions','appearance'] as const;
export function validateActor(value:unknown,c:GameplayCatalog,area:string):asserts value is PublicActor {
 const numeric=['x','y','z','yaw','radius','height','hp','maxHp','stunUntil','slowUntil','slowPct','rust','rustUntil','absorb','absorbMax','absorbUntil','blessingUntil','pushX','pushZ','pushTime','lift'];
 object(value,{appearance:nullable(v=>validateAppearance(v,c)),ref:v=>reference(v,area),archetype:catalogValue(c.archetypes),kind:choice('player','npc','townsfolk','scrapling','scavenger','jellyfish','boss','freed'),reaction:choice('hostile','friendly','neutral','player'),level:v=>integer(v,1),...Object.fromEntries(numeric.map(k=>[k,number])),...Object.fromEntries(['alive','hidden','targetable','invulnerable','encounterBlessing'].map(k=>[k,bool])),npcId:nullable(text),pose:v=>poseState(v,c),actions:list(v=>actionState(v,c),64)});
 if(Number(value.hp)<0||Number(value.hp)>Number(value.maxHp)||Number(value.maxHp)<=0||Number(value.radius)<=0||Number(value.height)<=0||Number(value.slowPct)<0||Number(value.slowPct)>1)fail('invalid actor relationship');
}
function validateSelf(value:unknown,c:GameplayCatalog,area:string):void {
 object(value,{player:v=>{
  const numeric=['resource','maxResource','xp','coins','baseMaxHp','gcdStart','gcdEnd','nextSwing','lastAttack','velX','velZ','jumpT','spinT','lastSpend','targetDeadAt'];
  object(v,{unit:x=>reference(x,area),classId:choice('warrior','mage','priest'),...Object.fromEntries(numeric.map(k=>[k,number])),attackRank:integer,armorRank:integer,weaponOwned:bool,armorOwned:bool,cooldowns:x=>mapValues(x,y=>object(y,{start:number,end:number}),c.abilities),cast:nullable(x=>object(x,{ability:catalogValue(c.abilities),start:number,end:number,target:nullable(r=>reference(r,area))})),channel:nullable(x=>object(x,{kind:choice('recall','beacon','waystone'),start:number,end:number,targetId:nullable(text),to:vector})),target:nullable(x=>reference(x,area)),warded:bool,queued:nullable(catalogValue(c.abilities)),dash:nullable(x=>object(x,{target:r=>reference(r,area),t:number})),deadUntil:nullable(number),role:choice('authoritative'),controlsLocked:bool,talkTarget:nullable(x=>reference(x,area)),quests:x=>object(x,{chapter:v=>integer(v,1,4),status:v=>mapValues(v,choice('locked','available','active','ready','done'),c.quests),progress:v=>mapValues(v,number,c.objectives),cogs:integer,tracked:v=>mapValues(v,catalogValue(c.quests),['1','2','3','4'])}),flags:x=>mapValues(x,bool,c.flags),cogMisses:integer},{lighthouseSecretFound:bool});
  if(Number(v.xp)<0||Number(v.coins)<0||Number(v.resource)<0||Number(v.resource)>Number(v.maxResource))fail('invalid self progress');
 },achievements:v=>object(v,{distance:number,earned:list(text,128)})});
}
function validateFeatures(v:unknown,area:string):void {
 const ref=(x:unknown)=>reference(x,area);
 object(v,{environment:x=>object(x,{beacon:bool,clock:number}),boat:nullable(x=>{object(x,{x:number,z:number,yaw:number,speed:number,seats:list(nullable(ref),2,2)});const seats=x.seats as (EntityRef|null)[];if(seats[0]&&seats[1]&&seats[0].id===seats[1].id)fail('duplicate boat seat');}),village:nullable(x=>object(x,{id:text,mode:choice('hide','tag'),phase:choice('ready','play','done'),left:number,starter:ref,seeker:ref,members:list(ref,100),caught:list(ref,100),result:choice('','seekers','runners','cancelled')}))});
}
function validateProjectile(v:unknown,area:string):void {object(v,{id:x=>integer(x,1,0xffffffff),source:x=>reference(x,area),target:x=>reference(x,area),style:choice('bubble','spark','holy','rust'),x:number,y:number,z:number,speed:number,elapsed:number,bornStep:integer});}
export function validateSnapshot(p:unknown,c:GameplayCatalog,area:string):asserts p is SnapshotPayload {
 object(p,{full:bool,baseline:integer,eventWatermark:v=>integer(v,-1),world:choice('w1','w2','w3','w4'),time:number,selfRef:v=>reference(v,area),actors:list(v=>{object(v,{ref:x=>reference(x,area),fields:x=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!ACTOR_FIELDS.includes(k as typeof ACTOR_FIELDS[number])))fail('unknown actor field');}});},LIMITS.actors),removed:list(v=>reference(v,area),LIMITS.actors),projectiles:list(v=>validateProjectile(v,area),LIMITS.projectiles),self:v=>validateSelf(v,c,area),features:v=>validateFeatures(v,area),recovery:v=>object(v,{telegraphs:list(x=>{validateEvent(x,c,area);if((x as EventRecord).event.type!=='telegraph')fail('non-telegraph recovery');},64),endings:list(x=>object(x,{unit:v=>reference(v,area),chapter:choice(4),replay:bool}),1)}),events:list(v=>validateEvent(v,c,area),LIMITS.events),results:list(validateResult,256)});
 const snapshot=p as unknown as SnapshotPayload;
 if(snapshot.full?(snapshot.baseline!==0||snapshot.removed.length>0):snapshot.baseline<1)fail('invalid baseline');
 if(snapshot.self.player.unit.id!==snapshot.selfRef.id||snapshot.self.player.unit.life!==snapshot.selfRef.life)fail('self reference mismatch');
 const ids=new Set<number>();for(const r of snapshot.actors){if(ids.has(r.ref.id))fail('duplicate actor update');ids.add(r.ref.id);if(snapshot.full)validateActor({ref:r.ref,...r.fields},c,area);}
 for(const r of snapshot.removed){if(ids.has(r.id))fail('duplicate actor removal');ids.add(r.id);}
 const pids=new Set<number>();for(const r of snapshot.projectiles){if(pids.has(r.id))fail('duplicate projectile');pids.add(r.id);}
}
export function projectActor(unit:Readonly<SimUnit>,appearance:Appearance|null):PublicActor {return clone(Object.fromEntries([['ref',unit.ref],...ACTOR_FIELDS.map(k=>[k,k==='appearance'?appearance:unit[k]])])) as PublicActor;}
export function projectSelf(player:Readonly<PlayerState>,achievements:AchievementView):SelfView {const {character:_character,achievements:_achievements,...rest}=player as PlayerState&{achievements?:AchievementView};return clone({player:rest,achievements});}
export interface ObservationInput {
 binding:WireBinding;sequence:number;tick:number;acceptedInput:number;consumedInput:number;selfRef:EntityRef;
 snapshot:AreaSnapshot;events:readonly EventRecord[];visibleIds:ReadonlySet<number>;full:boolean;eventWatermark:number;
 features:FeatureView;recovery:RecoveryView;achievements:AchievementView;appearances:Readonly<Record<string,Appearance>>;results?:readonly CommandResult[];
}
export type WorldControl=
 | {type:'inputAck'}
 | {type:'queued';world:'w1'|'w2'|'w3'|'w4';position:number}
 | {type:'error';code:string;retryable:boolean}
 | {type:'restarting';retryAfterSeconds:number}
 | {type:'resync';lastSequence:number;reason:'baseline'|'gap'|'fragment'|'catalog'};
export function validateControl(v:unknown):asserts v is WorldControl {
 if(!v||typeof v!=='object')fail('invalid control');const type=(v as WorldControl).type;
 if(type==='inputAck')object(v,{type:choice(type)});
 else if(type==='queued')object(v,{type:choice(type),world:choice('w1','w2','w3','w4'),position:x=>integer(x,1)});
 else if(type==='error')object(v,{type:choice(type),code:text,retryable:bool});
 else if(type==='restarting')object(v,{type:choice(type),retryAfterSeconds:number});
 else if(type==='resync')object(v,{type:choice(type),lastSequence:integer,reason:choice('baseline','gap','fragment','catalog')});else fail('unknown control');
}
export function encodeControl(h:WireHeader,value:WorldControl):Uint8Array[] {validateControl(value);return encodeMessage(17,h,value);}
export interface GameplayProtocol {
 readonly catalog:GameplayCatalog;
 encodeObservation(input:ObservationInput):Uint8Array[];
 encodeEvents:typeof encodeEvents;
 encodeInput(packet:import('./intents.ts').InputPacket):Uint8Array;
 decodeInput(bytes:Uint8Array,expected:WireBinding):import('./intents.ts').GameplayInput;
 decodeClientMessage(bytes:Uint8Array,expected:WireBinding):{kind:'input';intent:import('./intents.ts').GameplayInput}|{kind:'resync';lastSequence:number;reason:string};
 encodeControl:typeof encodeControl;
 reset(binding:WireBinding):void;
}
/** One instance per connection: its delta baseline is never shared among viewers. */
export function createGameplayProtocol(catalog:GameplayCatalog):GameplayProtocol {
 text(catalog.version);integer(catalog.jointCount,1,256);let previous:PublicActor[]=[],prior:WireHeader|null=null;
 return {
  catalog:clone(catalog),encodeEvents,encodeControl,
  encodeInput:p=>encodeInput(p,catalog),decodeInput:(b,e)=>decodeInput(b,e,catalog),
  decodeClientMessage(bytes,expected){
   const m=new FragmentAssembler(expected).accept(bytes,0);if(!m)fail('client message must fit one frame');
   if(m.kind===16)return {kind:'input',intent:decodeInput(bytes,expected,catalog)};
   if(m.kind!==17||m.header.tick||m.header.acceptedInput||m.header.consumedInput)fail('forged client control');validateControl(m.payload);
   if(m.payload.type!=='resync')fail('client cannot publish server control');return {kind:'resync',lastSequence:m.payload.lastSequence,reason:m.payload.reason};
  },
  reset(next){binding(next);previous=[];prior=null;},
  encodeObservation(input){
   const h:WireHeader={...input.binding,sequence:input.sequence,tick:input.tick,acceptedInput:input.acceptedInput,consumedInput:input.consumedInput};header(h);
   if(h.catalog!==catalog.version||input.snapshot.area!==h.area||input.snapshot.tick!==h.tick)fail('snapshot identity mismatch');
   if(prior&&(!sameBinding(prior,h)||h.sequence<=prior.sequence||h.tick<prior.tick||h.acceptedInput<prior.acceptedInput||h.consumedInput<prior.consumedInput))fail('snapshot stream regression; reset required');
   const player=input.snapshot.players.find(p=>p.unit.id===input.selfRef.id&&p.unit.life===input.selfRef.life);if(!player)fail('missing owned self');
   const actors=input.snapshot.units.filter(u=>input.visibleIds.has(u.ref.id)||u.ref.id===input.selfRef.id).map(u=>{const appearance=input.appearances[`${u.ref.id}:${u.ref.life}`]??null;if(u.kind==='player'&&!appearance)fail('missing player appearance');return projectActor(u,appearance);});
   const old=new Map(previous.map(a=>[a.ref.id,a])),full=input.full||!prior,updates:ActorUpdate[]=[],ids=new Set(actors.map(a=>a.ref.id));
   for(const a of actors){validateActor(a,catalog,h.area);const prev=full?null:old.get(a.ref.id);const fields:Partial<Omit<PublicActor,'ref'>>={};for(const k of ACTOR_FIELDS)if(!prev||prev.ref.life!==a.ref.life||JSON.stringify(prev[k])!==JSON.stringify(a[k]))(fields as Record<string,unknown>)[k]=a[k];if(Object.keys(fields).length)updates.push({ref:a.ref,fields});}
   const projectiles=input.snapshot.projectiles.filter(p=>ids.has(p.source.id)||ids.has(p.target.id)).map(({hit:_hit,anchorVersion:_anchor,...p})=>p);
   const payload:SnapshotPayload={full,baseline:full?0:prior!.sequence,eventWatermark:input.eventWatermark,world:input.snapshot.world,time:input.snapshot.time,selfRef:input.selfRef,actors:updates,removed:full?[]:previous.filter(a=>!ids.has(a.ref.id)).map(a=>a.ref),projectiles,self:projectSelf(player,input.achievements),features:input.features,recovery:input.recovery,events:selectEvents(input.events,input.selfRef,player.character,ids),results:input.results??[]};
   validateSnapshot(payload,catalog,h.area);const encoded=encodeMessage(1,h,payload);previous=clone(actors);prior=clone(h);return encoded;
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
 constructor(expected:WireBinding,catalog:GameplayCatalog){binding(expected);if(expected.catalog!==catalog.version)fail('catalog mismatch');this.binding=clone(expected);this.catalog=catalog;this.assembler=new FragmentAssembler(expected);}
 get state():GameplayState|null{return this.current?clone(this.current):null;}
 get header():WireHeader|null{return this.last?clone(this.last):null;}
 get retainedBytes():number{return this.assembler.retainedBytes;}
 reset(expected:WireBinding):void {binding(expected);if(expected.catalog!==this.catalog.version)fail('catalog mismatch');if(expected.session===this.binding.session&&expected.epoch<=this.binding.epoch)fail('epoch must advance');this.binding=clone(expected);this.assembler.reset(expected);this.current=null;this.last=null;this.eventOrder=-1;this.needsResync=false;}
 accept(bytes:Uint8Array,now:number):ReceivedGameplay|null {
  try{
   const message=this.assembler.accept(bytes,now);if(!message)return null;
   const h=message.header;
   if(this.last&&(h.sequence<=this.last.sequence||h.tick<this.last.tick||h.acceptedInput<this.last.acceptedInput||h.consumedInput<this.last.consumedInput))fail('stale observation');
   if(message.kind===1){
    validateSnapshot(message.payload,this.catalog,h.area);const p=message.payload;
    if(!p.full&&(this.needsResync||!this.current||p.baseline!==this.current.sequence||h.sequence!==(this.last?.sequence??0)+1))fail('missing baseline or sequence gap');
    if(this.current&&(p.selfRef.id!==this.current.selfRef.id||p.selfRef.life!==this.current.selfRef.life))fail('self life changed without epoch reset');
    if(p.eventWatermark<this.eventOrder||p.events.some(e=>e.tick>h.tick||e.order>p.eventWatermark))fail('invalid event watermark');
    const actors=new Map<number,PublicActor>(p.full?[]:this.current!.actors.map(a=>[a.ref.id,clone(a)]));
    for(const r of p.removed){const old=actors.get(r.id);if(!old||old.ref.life!==r.life)fail('unknown/stale removal');actors.delete(r.id);}
    for(const r of p.actors){
     const old=actors.get(r.ref.id);if(old&&r.ref.life<old.ref.life)fail('stale actor life');
     if(!old||old.ref.life!==r.ref.life)for(const key of ACTOR_FIELDS)if(!Object.hasOwn(r.fields,key))fail('partial new actor life');
     const actor={...old,...r.fields,ref:r.ref};validateActor(actor,this.catalog,h.area);actors.set(actor.ref.id,actor);
    }
    if(actors.size>LIMITS.actors)fail('actor capacity');const self=actors.get(p.selfRef.id);if(!self||self.ref.life!==p.selfRef.life||self.kind!=='player')fail('missing exact self actor');
    let order=this.eventOrder;for(const e of p.events){if(e.order<=order)fail('replayed/unordered event');order=e.order;}
    const next:GameplayState={header:h,sequence:h.sequence,world:p.world,time:p.time,eventWatermark:p.eventWatermark,selfRef:p.selfRef,actors:[...actors.values()].sort((a,b)=>a.ref.id-b.ref.id),projectiles:p.projectiles,self:p.self,features:p.features,recovery:p.recovery};
    const deliver=p.full?[]:p.events;
    this.current=clone(next);this.last=clone(h);this.eventOrder=p.eventWatermark;this.needsResync=false;
    return {kind:'snapshot',state:clone(next),events:clone(deliver),results:clone(p.results)};
   }
   if(this.needsResync||h.sequence!==(this.last?.sequence??0)+1)fail('missing publication sequence');
   if(message.kind===2){
    validateEventPayload(message.payload,this.catalog,h.area);const p=message.payload;
    if(!this.current||p.baselineSequence!==this.current.sequence)fail('events before actor baseline');
    let order=this.eventOrder;for(const e of p.events){if(e.order<=order||e.tick>h.tick)fail('replayed/unordered event');order=e.order;}
    this.last=clone(h);this.eventOrder=order;return {kind:'events',events:clone(p.events),results:clone(p.results)};
   }
   if(message.kind!==17)fail('server cannot send input');validateControl(message.payload);if(message.payload.type==='resync')fail('server cannot request client baseline');
   this.last=clone(h);return {kind:'control',control:clone(message.payload)};
  }catch(error){this.needsResync=true;this.assembler.clear();throw error;}
 }
}
