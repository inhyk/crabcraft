import {REASONS} from '../../chat/safety.ts';
import type { PlayerCommand, PlayerIntent } from '../../../src/sim/types.ts';
import { FragmentAssembler, LIMITS, bool, catalogValue, choice, clone, encodeMessage, fail, integer, number, object, reference, sameBinding, text } from './protocol.ts';
import type { GameplayCatalog, WireBinding, WireHeader } from './protocol.ts';
/** Feature commands are distinct ordered intents; Area validates their gameplay authorization. */
export type HostCommand=
 | {kind:'partyCreate'|'partyLeave'|'encounterLeave'}
 | {kind:'partyJoin';code:string}
 | {kind:'partyPvp';enabled:boolean}
 | {kind:'chatSay';channel:'area'|'party';text:string}
 | {kind:'chatPreferences';enabled?:boolean;partyOnly?:boolean}
 | {kind:'chatBlock';target:import('../../../src/sim/types.ts').EntityRef;blocked:boolean}
 | {kind:'chatMute';target:import('../../../src/sim/types.ts').EntityRef;muted:boolean}
 | {kind:'chatReport';target:import('../../../src/sim/types.ts').EntityRef;reason:typeof REASONS[number]};
export type GameplayCommand=PlayerCommand|HostCommand;
export const HOST_COMMANDS:readonly string[]=['partyCreate','partyJoin','partyLeave','partyPvp','encounterLeave','chatSay','chatPreferences','chatBlock','chatMute','chatReport'];
export interface GameplayInput extends Omit<PlayerIntent,'commands'> {readonly commands:readonly GameplayCommand[]}
export interface InputPacket {binding:WireBinding;intent:GameplayInput}
const axis=(v:unknown)=>{number(v);if(v< -1||v>1)fail('axis out of range');};
export function validateCommand(value:unknown,catalog:GameplayCatalog,area:string):void {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid command');const c=value as Record<string,unknown>;
 const kind=choice(c.kind),npc=catalogValue(catalog.npcs),quest=catalogValue(catalog.quests);
 switch(c.kind){
  case 'ability':object(c,{kind,slot:v=>integer(v,1,5)});break;
  case 'talk':object(c,{kind,target:v=>reference(v,area)});break;
  case 'target':object(c,{kind,target:v=>{if(v!==null)reference(v,area);}});break;
  case 'partyCreate':case 'partyLeave':case 'encounterLeave':
  case 'jump':case 'dance':case 'cancel':case 'endingReplay':case 'talkEnd':object(c,{kind});break;
  case 'channelStart':object(c,{kind,channel:choice('recall','beacon','waystone','lighthouse-secret')},{targetId:catalogValue(catalog.interactions)});break;
  case 'interact':object(c,{kind,targetId:catalogValue(catalog.interactions)});break;
  case 'questAccept':case 'questTurnIn':object(c,{kind,questId:quest,npcId:npc});break;
  case 'questTrack':object(c,{kind,questId:quest});break;
  case 'forgeBuy':case 'forgeUpgrade':object(c,{kind,npcId:npc},{slot:choice('weapon','armor'),request:v=>integer(v,1)});break;
  case 'travel':object(c,{kind,gateId:catalogValue(catalog.gates)});break;
  case 'bossChallenge':object(c,{kind,profile:choice('rust','abyss','eclipse','dawn','frost')});break;
  case 'chatSay':object(c,{kind,channel:choice('area','party'),text:v=>{if(typeof v!=='string'||v.length>LIMITS.stringBytes)fail('invalid chat text');}});break;
  case 'chatPreferences':object(c,{kind},{enabled:bool,partyOnly:bool});break;
  case 'chatBlock':object(c,{kind,target:reference,blocked:bool});break;
  case 'chatMute':object(c,{kind,target:reference,muted:bool});break;
  case 'chatReport':object(c,{kind,target:reference,reason:choice(...REASONS)});break;
  case 'partyJoin':object(c,{kind,code:v=>{if(typeof v!=='string'||! /^[0-9A-F]{6}$/.test(v))fail('invalid party code');}});break;
  case 'partyPvp':object(c,{kind,enabled:bool});break;
  case 'boat':object(c,{kind,command:v=>object(v,{action:choice('board','leave','call','drive'),throttle:axis,steer:axis})});break;
  case 'village':object(c,{kind,mode:choice('hide','tag','stop')});break;
  default:fail('unknown command');
 }
}
export function validateInput(value:unknown,catalog:GameplayCatalog,area:string):asserts value is GameplayInput {
 object(value,{seq:v=>integer(v,1),forward:axis,strafe:axis,turn:axis,sprint:bool,steeringYaw:v=>{if(v!==null){number(v);if(v< -Math.PI||v>Math.PI)fail('unnormalized steering yaw');}},heldChannel:choice(null,'recall','beacon','waystone','lighthouse-secret'),commands:v=>{if(!Array.isArray(v)||v.length>LIMITS.commands)fail('command capacity');v.forEach(c=>validateCommand(c,catalog,area));if(v.length!==1&&v.some(c=>HOST_COMMANDS.includes(c.kind)))fail('host command cannot mix with other commands');}});
}
export function encodeInput(packet:InputPacket,catalog:GameplayCatalog):Uint8Array {
 object(packet,{binding:v=>{object(v,{session:text,area:text,epoch:n=>integer(n,1),catalog:text});},intent:v=>validateInput(v,catalog,packet.binding.area)});
 if(packet.binding.catalog!==catalog.version)fail('catalog mismatch');const h:WireHeader={...packet.binding,sequence:packet.intent.seq,tick:0,acceptedInput:0,consumedInput:0};
 const chunks=encodeMessage(16,h,packet.intent);if(chunks.length!==1)fail('input exceeds frame capacity');return chunks[0];
}
export function decodeInput(bytes:Uint8Array,expected:WireBinding,catalog:GameplayCatalog):GameplayInput {
 if(expected.catalog!==catalog.version)fail('catalog mismatch');const message=new FragmentAssembler(expected).accept(bytes,0);
 if(!message||message.kind!==16)fail('input must be one complete frame');const h=message.header;
 if(h.tick!==0||h.acceptedInput!==0||h.consumedInput!==0)fail('forged input header');validateInput(message.payload,catalog,expected.area);
 if(h.sequence!==message.payload.seq)fail('input sequence mismatch');return message.payload;
}
export interface PreparedInput {readonly token:number;readonly intent:GameplayInput;readonly sequences:readonly number[];readonly commandOrigins:readonly {inputSequence:number;commandIndex:number}[]}
/** One WebSocket budget survives stream resets and also charges revoked in-flight inputs. */
export class InputRateBudget {
 private tokens=120;private time:number;
 constructor(now=0){number(now);this.time=now;}
 consume(now:number):void {number(now);if(now<this.time)fail('input clock regression');const tokens=Math.min(120,this.tokens+(now-this.time)*60);if(tokens<1)fail('input rate limit');this.tokens=tokens-1;this.time=now;}
}
/** Acceptance never claims simulation success. Prepare is replayable until commit after Area.step. */
export class InputSession {
 private binding:WireBinding;private catalog:GameplayCatalog;
 private queue:GameplayInput[]=[];private prepared:PreparedInput|null=null;private nextToken=1;
 private accepted=0;private consumed=0;private time:number;private lastReceived:number;
 private readonly budget:InputRateBudget;private revoked=false;private limit:number;private timeout:number;
 private held:Omit<GameplayInput,'seq'|'commands'>={forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null};
 constructor(binding:WireBinding,catalog:GameplayCatalog,options:{now?:number;maxQueued?:number;timeoutSeconds?:number;budget?:InputRateBudget}={}){
  this.binding=clone(binding);this.catalog=clone(catalog);this.time=options.now??0;this.lastReceived=this.time;number(this.time);this.budget=options.budget??new InputRateBudget(this.time);
  this.limit=options.maxQueued??128;integer(this.limit,1,1024);this.timeout=options.timeoutSeconds??.4;number(this.timeout);if(this.timeout<=0)fail('invalid timeout');
 }
 get acceptedInput(){return this.accepted;}get consumedInput(){return this.consumed;}get pendingCount(){return this.queue.length;}
 accept(bytes:Uint8Array,now:number):GameplayInput {
  if(this.revoked)fail('revoked input session');number(now);if(now<this.time)fail('input clock regression');const intent=decodeInput(bytes,this.binding,this.catalog);
  if(intent.seq<=this.accepted)fail('stale input sequence');if(this.queue.length>=this.limit)fail('input queue capacity');
  this.budget.consume(now);this.time=now;this.lastReceived=now;this.accepted=intent.seq;this.queue.push(clone(intent));return clone(intent);
 }
 /** Retain only the exact prior binding/sequence. Its pending commands and held controls are discarded. */
 revoke():void {this.revoked=true;this.queue=[];this.prepared=null;this.held={forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null};}
 discardRevoked(bytes:Uint8Array,now:number):void {
  if(!this.revoked)fail('input session is not revoked');number(now);if(now<this.time)fail('input clock regression');const intent=decodeInput(bytes,this.binding,this.catalog);
  if(intent.seq<=this.accepted)fail('stale input sequence');this.budget.consume(now);this.time=now;this.accepted=intent.seq;
 }
 prepareTick(now:number,maxCommands:number=LIMITS.commands):PreparedInput|null {
  number(now);if(now<this.time)fail('input clock regression');integer(maxCommands,1,LIMITS.commands);
  if(this.revoked)return null;if(this.prepared)return clone(this.prepared);if(!this.queue.length)return null;
  let count=0,n=0;for(const frame of this.queue){const host=frame.commands.some(c=>HOST_COMMANDS.includes(c.kind));if(n&&(host||this.queue[0].commands.some(c=>HOST_COMMANDS.includes(c.kind))))break;if(n&&count+frame.commands.length>maxCommands)break;if(frame.commands.length>maxCommands)fail('frame exceeds step command capacity');count+=frame.commands.length;n++;}
  const frames=this.queue.slice(0,n),last=frames.at(-1)!;
  const intent={...last,commands:frames.flatMap(f=>f.commands)};
  // Commands retain order even when later movement frames supersede held input.
  if(now-this.lastReceived>=this.timeout)Object.assign(intent,{forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null});
  integer(this.nextToken,1);this.prepared={token:this.nextToken++,intent:clone(intent),sequences:frames.map(f=>f.seq),commandOrigins:frames.flatMap(f=>f.commands.map((_,commandIndex)=>({inputSequence:f.seq,commandIndex})))};return clone(this.prepared);
 }
 commitConsumed(token:number):void {
  if(!this.prepared||this.prepared.token!==token)fail('unknown prepared input');
  const p=this.prepared;this.queue.splice(0,p.sequences.length);this.consumed=p.intent.seq;
  const {seq:_seq,commands:_commands,...held}=p.intent;this.held=held;this.prepared=null;
 }
 /** Host supplies held values via core timeout boundary, never invents a new input seq/ACK. */
 heldState(now:number):Omit<GameplayInput,'seq'|'commands'> {
  number(now);if(now<this.time)fail('input clock regression');
  return now-this.lastReceived>=this.timeout?{forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null}:clone(this.held);
 }
 reset(next:WireBinding,now:number):void {
  if(sameBinding(next,this.binding))fail('reset requires new stream');number(now);this.binding=clone(next);this.queue=[];this.prepared=null;this.accepted=this.consumed=0;this.time=this.lastReceived=now;this.revoked=false;
  this.held={forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null};
 }
}
