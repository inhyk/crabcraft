/** Per-resident ending coordination. No reward planner, shared world pause or persisted phase state. */
import type { AreaDefinition, AreaServices, CoreEvent, EntityRef, PlayerCommand, PlayerSim, Vec3 } from '../types.ts';
import { immutable, sameRef } from '../events.ts';
import { canPresentFrostEnding } from '../data/progression.ts';
import { rigCatalog, type RigSpec } from '../data/rig-catalog.ts';
import { EndingPresentationController, type CastSpec, type EndingObservation } from './endingPresentation.ts';
export interface EndingIntegrationOptions {
 readonly incarnation:string;
 readonly stage:{readonly centre:Vec3;readonly yaw:number;readonly cast:readonly CastSpec[]};
 readonly appearance:(owner:EntityRef)=>RigSpec|null;
}
/** Metadata only: no placement changes to either supplied world. Hero is supplied at admission. */
export function createEndingStage(shore:AreaDefinition,finalWorld:AreaDefinition):EndingIntegrationOptions['stage'] {
 const frost=finalWorld.bosses.find(b=>b.profile==='frost');
 if(shore.world!=='w1'||finalWorld.world!=='w4'||!frost?.freedArchetype)throw new Error('Canonical shore and Frost metadata required');
 const cast=[...shore.npcs.map(n=>{if(!n.archetype)throw new Error('Ending NPC archetype required');return {archetype:n.archetype};}),...(shore.townsfolk??[]).map(n=>({archetype:n.archetype})),{archetype:frost.freedArchetype}];
 for(const actor of cast)rigCatalog(actor.archetype);
 if(cast.length>23)throw new Error('Ending cast capacity exceeded');
 return immutable({centre:shore.spawn.position,yaw:shore.spawn.yaw,cast});
}
type CancelReason=Parameters<EndingPresentationController['cancel']>[0];
interface Entry {ref:EntityRef;controller:EndingPresentationController;revision:number;pending:boolean;lock:boolean;combat:number;hp:number}
interface CaptureBinding {ref:EntityRef;id:string;revision:number}
export class PersonalEndings {
 private readonly options:EndingIntegrationOptions;
 private serial=0;private entries=new Map<number,Entry>();private requests=new Map<number,EntityRef>();private interrupted=new Map<number,CancelReason>();private captures=new Map<string,CaptureBinding>();
 private readonly services:AreaServices;private readonly neutralize:(ref:EntityRef)=>void;
 constructor(services:AreaServices,options:EndingIntegrationOptions,neutralize:(ref:EntityRef)=>void) {
  this.services=services;this.neutralize=neutralize;
  const worst=JSON.stringify([options.incarnation,0xffffffff,0xffffffff,Number.MAX_SAFE_INTEGER]);
  if(!options.incarnation||new TextEncoder().encode(worst).byteLength>128||typeof options.appearance!=='function'||options.stage.cast.length>23||![options.stage.centre.x,options.stage.centre.y,options.stage.centre.z,options.stage.yaw].every(Number.isFinite))throw new Error('Unsupported ending configuration');
  for(const spec of options.stage.cast)rigCatalog(spec.archetype);
  this.options={...options,stage:immutable(options.stage)};
 }
 private player(ref:EntityRef):PlayerSim|null {return this.services.player(ref);}
 private entry(ref:EntityRef):Entry|undefined {const entry=this.entries.get(ref.id);return entry&&sameRef(entry.ref,ref)?entry:undefined;}
 private active(entry:Entry):boolean {return !['finished','cancelled'].includes(entry.controller.phaseName);}
 canReplay(ref:EntityRef):boolean {const entry=this.entry(ref);return !entry||!entry.pending&&!this.active(entry);}
 locks(ref:EntityRef):boolean {return !!this.entry(ref)?.lock;}
 allows(ref:EntityRef,command:PlayerCommand):boolean {return !this.locks(ref)||command.kind==='endingControl';}
 record(event:CoreEvent):void {
  if(event.type==='endingReady'){if(this.player(event.unit))this.requests.set(event.unit.id,{...event.unit});}
  else if(event.type==='damage'){if(this.entry(event.dst))this.interrupted.set(event.dst.id,'damage');if(event.src&&this.entry(event.src))this.interrupted.set(event.src.id,'combat');}
  else if(event.type==='death'&&this.entry(event.unit))this.interrupted.set(event.unit.id,'death');
 }
 private unlock(entry:Entry):void {if(!entry.lock)return;const player=this.player(entry.ref);if(player){this.neutralize(entry.ref);player.state.target=null;player.state.controlsLocked=false;}entry.lock=false;}
 private dirty(entry:Entry):void {if(entry.revision===Number.MAX_SAFE_INTEGER)throw new Error('Ending transition revision exhausted');entry.revision++;entry.pending=true;}
 cancel(ref:EntityRef,reason:CancelReason):void {
  if(this.requests.has(ref.id)&&sameRef(this.requests.get(ref.id)!,ref))this.requests.delete(ref.id);const entry=this.entry(ref);if(!entry||!this.active(entry))return;
  entry.controller.cancel(reason);this.unlock(entry);this.dirty(entry);
 }
 forget(ref:EntityRef):void {this.cancel(ref,'retired');if(this.requests.has(ref.id)&&sameRef(this.requests.get(ref.id)!,ref))this.requests.delete(ref.id);if(this.entry(ref)){this.entries.delete(ref.id);this.interrupted.delete(ref.id);}for(const[token,b]of this.captures)if(sameRef(b.ref,ref))this.captures.delete(token);}
 command(ref:EntityRef,command:Extract<PlayerCommand,{kind:'endingControl'}>):boolean {
  const entry=this.entry(ref);if(!entry||entry.pending||!this.player(ref)||!entry.controller.command(command.id,command.action))return false;
  if(!this.active(entry)||entry.controller.phaseName==='credits')this.unlock(entry);this.dirty(entry);return true;
 }
 /** Fixed stage after pending hits/projectiles, never from snapshot/drain. */
 step():void {
  for(const entry of this.entries.values()){
   const player=this.player(entry.ref),unit=this.services.getUnit(entry.ref);if(!player||!unit){this.forget(entry.ref);continue;}
   if(!this.active(entry))continue;
   const interruption=this.interrupted.get(entry.ref.id);
   if(!unit.alive||interruption||unit.hp<entry.hp||unit.lastCombat>entry.combat){this.cancel(entry.ref,!unit.alive?'death':interruption??(unit.hp<entry.hp?'damage':'combat'));continue;}
   entry.hp=unit.hp;
   if(entry.pending)continue;
   const before=entry.controller.phaseName;if(before!=='credits')entry.controller.step();
   if(entry.controller.phaseName==='credits'&&before!=='credits'){this.unlock(entry);this.dirty(entry);}
  }
  for(const ref of this.requests.values()){
   const player=this.player(ref),unit=this.services.getUnit(ref);if(!player||!unit){this.requests.delete(ref.id);continue;}
   const old=this.entry(ref);if(old&&(old.pending||this.active(old))){this.requests.delete(ref.id);continue;}
   const member=this.services.context.members.find(m=>sameRef(m.unit,ref));
   if(!unit.alive||unit.hidden||member?.seatedBoat||member?.villagePlaying||!canPresentFrostEnding(this.services.context.mode,Number(this.services.world.slice(1)) as 1|2|3|4,player.state.flags,this.services.bossByProfile('frost')?.state??null,player.state.controlsLocked))continue;
   // Existing combat activity is allowed to resolve; never create invulnerability for a cinematic.
   if(this.services.time-unit.lastCombat<5)continue;
   const appearance=this.options.appearance(ref);if(!appearance)continue;
   if(this.serial===Number.MAX_SAFE_INTEGER)throw new Error('Ending incarnation exhausted');
   const id=JSON.stringify([this.options.incarnation,ref.id,ref.life,++this.serial]);
   const controller=new EndingPresentationController({id,owner:ref,centre:this.options.stage.centre,yaw:this.options.stage.yaw,cast:[{archetype:unit.archetype,appearance},...this.options.stage.cast]});
   this.neutralize(ref);player.state.target=null;player.state.talkTarget=null;player.state.controlsLocked=true;
   this.entries.set(ref.id,{ref:{...ref},controller,revision:1,pending:true,lock:true,combat:unit.lastCombat,hp:unit.hp});this.requests.delete(ref.id);
  }
  this.interrupted.clear();
 }
 pending():boolean {return [...this.entries.values()].some(e=>e.pending);}
 observation(ref:EntityRef):Readonly<EndingObservation>|null {const entry=this.entry(ref);return this.player(ref)&&entry&&!entry.pending?entry.controller.snapshot():null;}
 bindCapture(captureId:string,ref:EntityRef):void {const entry=this.entry(ref);if(entry?.pending)this.captures.set(captureId,{ref:{...ref},id:entry.controller.id,revision:entry.revision});}
 markCapture(captureId:string):void {const binding=this.captures.get(captureId);this.captures.delete(captureId);if(!binding)return;const entry=this.entry(binding.ref);if(entry&&entry.pending&&entry.revision===binding.revision&&entry.controller.id===binding.id)entry.pending=false;}
 discardCapture(captureId:string):void {this.captures.delete(captureId);}
 dispose():void {for(const entry of this.entries.values())this.unlock(entry);this.entries.clear();this.requests.clear();this.interrupted.clear();this.captures.clear();}
 debug(){return immutable({serial:this.serial,entries:[...this.entries.values()].map(e=>({ref:e.ref,revision:e.revision,pending:e.pending,lock:e.lock,combat:e.combat,hp:e.hp,controller:e.controller.debug()})),requests:[...this.requests.values()],interrupted:[...this.interrupted],captures:[...this.captures]});}
}
