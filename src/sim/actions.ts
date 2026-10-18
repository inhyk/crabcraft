import type { ActionData, ActionId, ActionRequest, ActionState, CoreEvent, HitPlan, PendingHit, SimUnit } from './types.ts';
import { copyValue } from './events.ts';
import { Ids } from './random.ts';
import { resetLocomotionOrigin } from './unit.ts';
export class Actions {
  private ids = new Ids();
  private data: ActionData;
  private emit: (event: CoreEvent) => void;
  private resolve: (plan: HitPlan) => void;
  constructor(data: ActionData, emit: (event: CoreEvent) => void, resolve: (plan: HitPlan) => void) { this.data=data;this.emit=emit;this.resolve=resolve; }
  get nextGeneration(): number { return this.ids.nextValue; }
  effective(unit: Readonly<SimUnit>): ActionState | null { for(let i=unit.actions.length-1;i>=0;i--){ const a=unit.actions[i]!;if(a.targetWeight>0&&(!a.ended||this.data.clip(a.id).hold))return a;}return null; }
  play(unit: SimUnit, request: ActionRequest, hit?: PendingHit): void {
    const clip=this.data.clip(request.id); // validate required data before interrupting anything
    if(!Number.isFinite(clip.length)||clip.length<=0||![request.from,request.speed,request.fade].every(Number.isFinite)||request.speed<=0||request.from<0||request.fade<0)throw new RangeError('Invalid action');
    const shape=this.data.archetype(unit.archetype);
    if(request.carryRoot)this.data.root(request.id,Math.min(request.from,clip.length));
    const generation=this.ids.next();
    if(hit){ if(!Number.isFinite(hit.left)||hit.left<0)throw new RangeError('Invalid pending hit'); const previous=unit.pendingHit;unit.pendingHit=null;if(previous)this.resolve(previous.plan);unit.pendingHit=copyValue(hit); }
    for(const a of unit.actions)if(a.targetWeight>0)this.interrupt(unit,a,Math.max(.05,request.fade));
    const action:ActionState={...request,generation,start:request.from,clipTime:request.from,fadeIn:Math.max(.0001,request.fade),fadeOut:Math.max(.05,request.fade),weight:0,targetWeight:1,ended:false,interrupted:false,root:request.carryRoot?{curve:request.id,dataVersion:this.data.version,metersToUnits:shape.metersToUnits,committed:false,committedClipTime:null,rebase:null}:null};
    unit.actions.push(action);this.emit({type:'action',unit:unit.ref,action});
  }
  stop(unit:SimUnit,id?:ActionId,fade?:number):void { for(const a of unit.actions)if(!id||a.id===id)this.interrupt(unit,a,fade===undefined?a.fadeOut:Math.max(.0001,fade));this.emit({type:'action',unit:unit.ref,action:this.effective(unit)}); }
  private end(a:ActionState):number {const clip=this.data.clip(a.id);return Math.min(clip.length,a.to??clip.length,clip.hold?(clip.holdAt??clip.length):clip.length);}
  private fade(unit:SimUnit,a:ActionState):void {if(a.targetWeight<=0)return;a.targetWeight=0;if(!a.root||a.root.committed)return;const t=Math.min(a.clipTime,this.end(a));const root=this.data.root(a.root.curve,t);const c=Math.cos(unit.yaw),s=Math.sin(unit.yaw),m=a.root.metersToUnits;unit.x+=(root.x*c+root.z*s)*m;unit.z+=(-root.x*s+root.z*c)*m;unit.yaw+=root.yaw;resetLocomotionOrigin(unit);a.root.committed=true;a.root.committedClipTime=t;a.root.rebase={...root};this.emit({type:'rootRebase',unit:unit.ref,generation:a.generation,root:{...root},position:{x:unit.x,y:unit.y,z:unit.z},yaw:unit.yaw});}
  private interrupt(unit:SimUnit,a:ActionState,fade:number):void {this.fade(unit,a);a.fadeOut=fade;if(!a.ended){a.interrupted=true;a.ended=true;}}
  private moments(unit:SimUnit,a:ActionState,from:number,to:number):void {if(!a.carryRoot||!a.id.startsWith('break_')||a.interrupted)return;for(const [name,times]of Object.entries(this.data.clip(a.id).events))for(const t of times)if(t>from&&t<=to)this.emit({type:'dance',unit:unit.ref,stage:'moment',moment:name,move:a.id});}
  update(unit:SimUnit,dt:number):void {if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid action dt');for(const a of unit.actions){const clip=this.data.clip(a.id),end=this.end(a);a.weight=a.targetWeight>a.weight?Math.min(1,a.weight+dt/a.fadeIn):Math.max(a.targetWeight,a.weight-dt/a.fadeOut);if(dt===0)continue;const previous=a.clipTime;a.clipTime+=dt*a.speed;this.moments(unit,a,previous===a.start?previous-1e-6:previous,Math.min(a.clipTime,end));if(a.loop&&a.to!==null){const from=Math.max(a.start,a.loopFrom??a.start),span=end-from;if(span>.001&&a.clipTime>=end){a.clipTime=from+((a.clipTime-end)%span);this.moments(unit,a,from-1e-6,a.clipTime);}else if(a.clipTime>end)a.clipTime=end;continue;}if(!a.loop&&!clip.hold&&a.targetWeight>0&&a.clipTime>=end-a.fadeOut*a.speed)this.fade(unit,a);if(!a.loop&&a.clipTime>=end){a.ended=true;a.clipTime=end;}}unit.actions=unit.actions.filter(a=>!(a.targetWeight===0&&a.weight<=0));}
  updateHit(unit:SimUnit,dt:number):void {if(!unit.pendingHit)return;unit.pendingHit.left-=dt;if(unit.pendingHit.left<=0){const plan=unit.pendingHit.plan;unit.pendingHit=null;this.resolve(plan);}}
}
