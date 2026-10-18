/** Personal cast prototype. No Area membership, reward, world or live-actor mutation. */
import { BREAK_ROUTINE, realActionData, actionRequest } from '../data/actions.ts';
import { Actions } from '../actions.ts';
import { createUnit } from '../unit.ts';
import { advanceNumericPose } from '../pose.ts';
import { createRenderPoseRecipe, renderPoseProviderVersion, type RenderPoseRecipe } from '../renderPose.ts';
import type { CoreEvent, EntityRef, SimUnit, Vec3 } from '../types.ts';
import type { RigSpec } from '../data/rig-catalog.ts';
export type EndingPhase = 'blackout'|'opening'|'routine'|'finale'|'credits'|'finished'|'cancelled';
export interface CastRef { readonly endingId:string; readonly slot:number }
export interface CastSpec { readonly archetype:string; readonly appearance?:RigSpec }
export interface EndingCast extends CastSpec { readonly ref:CastRef; readonly position:Vec3; readonly yaw:number; readonly recipe:RenderPoseRecipe }
export interface EndingCue { readonly ordinal:number; readonly tick:number; readonly kind:'phase'|'step'|'moment'; readonly value:string }
export interface EndingObservation {
 readonly id:string; readonly owner:EntityRef; readonly tick:number; readonly sequence:number; readonly phase:EndingPhase; readonly phaseStartedTick:number;
 readonly orbitYaw:number; readonly celebrationStartedTick:number; readonly skipAvailableTick:number; readonly provider:string;
 readonly move:string|null; readonly cast:readonly EndingCast[]; readonly cues:readonly EndingCue[]; readonly reason:string|null;
}
export interface EndingOptions {id:string;owner:EntityRef;cast:readonly CastSpec[];centre:Vec3;yaw:number}
const HZ=30, BLACKOUT=33, OPENING=96, FINALE=375;
const DANCES=['dance_crab','dance_brazilian','dance_dream_wings','dance_maze'] as const;
function frozen<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
export class EndingPresentationController {
 private readonly options:EndingOptions;
 private readonly actors:SimUnit[];
 private readonly actions:Actions;
 private phase:EndingPhase='blackout';private tick=0;private sequence=0;private phaseStart=0;private ordinal=0;private cues:EndingCue[]=[];
 private stepIndex=0;private stepTime=0;private reason:string|null=null;
 constructor(options:EndingOptions) {
  if(!options.id||options.id.length>128||!options.owner.area||!Number.isSafeInteger(options.owner.id)||options.owner.id<1||!Number.isSafeInteger(options.owner.life)||options.owner.life<1||options.cast.length<1||options.cast.length>24||![options.centre.x,options.centre.y,options.centre.z,options.yaw].every(Number.isFinite))throw new Error('Invalid ending options');
  this.options=structuredClone(options);
  this.actions=new Actions(realActionData,event=>this.actionEvent(event),()=>{throw new Error('Presentation cast cannot hit');});
  this.actors=options.cast.map((spec,i)=>{
   const n=options.cast.length-1,inner=Math.ceil(n/2),ring=i-1<inner?0:1,k=ring===0?i-1:i-1-inner,m=ring===0?inner:n-inner;
   const angle=i===0?0:(k+(ring?.5:0))/Math.max(1,m)*Math.PI*2+options.yaw,r=i===0?0:ring?6.4:4.2;
   const u=createUnit({area:`presentation:${options.id}`,id:i+1,life:1},spec.archetype,'townsfolk','friendly',realActionData,{x:options.centre.x+Math.sin(angle)*r,y:options.centre.y,z:options.centre.z+Math.cos(angle)*r});
   u.yaw=i===0?options.yaw:angle+Math.PI;return u;
  });
 }
 private cue(kind:EndingCue['kind'],value:string):void {this.cues.push({ordinal:++this.ordinal,tick:this.tick,kind,value});if(this.cues.length>64)this.cues.shift();}
 private actionEvent(event:CoreEvent):void {if(event.type==='dance'&&event.stage==='moment')this.cue('moment',event.moment??'');}
 private enter(phase:EndingPhase):void {this.phase=phase;this.phaseStart=this.tick;this.sequence++;this.cue('phase',phase);
  if(phase==='opening'||phase==='finale')this.actors.forEach((u,i)=>this.actions.play(u,actionRequest(realActionData,DANCES[i%DANCES.length],{loop:true,fade:.3})));
  if(phase==='routine'){for(const u of this.actors)this.actions.stop(u,undefined,.5);this.stepIndex=0;this.stepTime=0;this.playStep();}
  if(phase==='credits'||phase==='finished'||phase==='cancelled')for(const u of this.actors)this.actions.stop(u,undefined,0);
 }
 private playStep():void {const step=BREAK_ROUTINE[this.stepIndex];this.actions.play(this.actors[0],actionRequest(realActionData,step.id,{from:step.from,to:step.to,speed:1,fade:step.fade,carryRoot:true}));this.cue('step',step.id);}
 /** Only the server scheduler calls this, exactly once per fixed tick. */
 step():void {
  if(this.phase==='finished'||this.phase==='cancelled')return;this.tick++;this.sequence++;
  if(this.phase==='blackout'&&this.tick>=BLACKOUT)this.enter('opening');
  else if(this.phase==='opening'&&this.tick-this.phaseStart>=OPENING)this.enter('routine');
  else if(this.phase==='routine'){
   this.stepTime+=1/HZ;const current=BREAK_ROUTINE[this.stepIndex],next=BREAK_ROUTINE[this.stepIndex+1];
   if(this.stepTime>=current.to-current.from-(next?.fade??0)){this.stepIndex++;this.stepTime=1/HZ;if(this.stepIndex===BREAK_ROUTINE.length)this.enter('finale');else this.playStep();}
  }else if(this.phase==='finale'&&this.tick-this.phaseStart>=FINALE)this.enter('credits');
  if(this.phase!=='credits')for(const u of this.actors){this.actions.update(u,1/HZ);advanceNumericPose(u,1/HZ);}
 }
 command(id:string,kind:'skip'|'continue'):boolean {
  if(id!==this.options.id)return false;
  if(kind==='skip'&&this.tick>=BLACKOUT+120&&['opening','routine','finale'].includes(this.phase)){this.reason='skip';this.enter('credits');return true;}
  if(kind==='continue'&&this.phase==='credits'){this.reason='complete';this.enter('finished');return true;}return false;
 }
 /** Restore activity=cancel, retirement and existing combat/damage/death interruption use this seam. */
 cancel(reason:'retired'|'restored'|'combat'|'damage'|'death'|'transferred'):void {if(this.phase==='finished'||this.phase==='cancelled')return;this.reason=reason;this.enter('cancelled');}
 snapshot():EndingObservation {return frozen({id:this.options.id,owner:{...this.options.owner},tick:this.tick,sequence:this.sequence,phase:this.phase,phaseStartedTick:this.phaseStart,orbitYaw:this.options.yaw+Math.PI*.85,celebrationStartedTick:BLACKOUT,skipAvailableTick:BLACKOUT+120,provider:renderPoseProviderVersion,reason:this.reason,move:this.phase==='routine'?BREAK_ROUTINE[this.stepIndex].id:null,cast:['credits','finished','cancelled'].includes(this.phase)?[]:this.actors.map((u,i)=>({...structuredClone(this.options.cast[i]),ref:{endingId:this.options.id,slot:i},position:{x:u.x,y:u.y,z:u.z},yaw:u.yaw,recipe:createRenderPoseRecipe(u)})),cues:this.cues.map(c=>({...c}))});}
}
