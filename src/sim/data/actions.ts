import type { ActionData, ActionId, ActionRequest, ClipRule } from '../types.ts';
import { motionData, numericClip, freezeNumeric } from './pose.ts';
import { numericArchetype } from './archetypes.ts';
import { launchAnchor, Pose, sampleClip, headingOf } from '../pose.ts';
export const BREAK_ROUTINE=motionData.routine as readonly {id:ActionId;label:string;from:number;to:number;fade:number}[];
export const ROUTINE=BREAK_ROUTINE;
const rules=freezeNumeric(Object.fromEntries(Object.keys(motionData.clips).map(id=>{const c=numericClip(id);return [id,{id:id as ActionId,length:c.length,hold:c.hold,holdAt:c.holdAt??null,events:c.events}];}))) as Readonly<Record<string,ClipRule>>;
export const realActionData:ActionData=Object.freeze({
 version:motionData.version,sourceHashes:motionData.sourceHashes,
 clip(id:ActionId){const c=rules[id];if(!c)throw new Error(`Unknown shipped action ${id}`);return c;},
 root(curve:string,t:number){if(!Number.isFinite(t))throw new Error('Nonfinite root sample time');const p=new Pose();sampleClip(numericClip(curve),t,false,p,true);return {x:p.pos[0],z:p.pos[2],yaw:headingOf(p.rot)};},
 archetype:numericArchetype,launchAnchor,
});
/** Unit.act defaults, including skill windows and the cast channel/release segments. */
export function actionRequest(data:ActionData,id:ActionId,opts:Partial<ActionRequest>={}):ActionRequest{
 data.clip(id);
 const part=opts.part??(opts.loop?'channel':'move');
 const w=motionData.windows[id]?.[part];
 const from=Math.max(0,opts.from??w?.from??0);
 const request:ActionRequest={id,part,upper:opts.upper??false,from,to:opts.to??w?.to??null,loopFrom:Math.max(from,opts.loopFrom??w?.loopFrom??from),loop:opts.loop??false,speed:opts.speed??w?.speed??1,fade:opts.fade??.12,carryRoot:opts.carryRoot??false};
 if(!Number.isFinite(request.speed)||request.speed<=0||!Number.isFinite(request.from)||!Number.isFinite(request.fade)||request.fade<0||request.to!==null&&(!Number.isFinite(request.to)||request.to<request.from))throw new Error('Invalid action window/rate/fade');
 return request;
}
/** S1 skill-derived hit clock. Explicit hitAt/from provenance remains with the caller. */
export function actionHitDelay(data:ActionData,request:ActionRequest):number|null{
 if(!motionData.windows[request.id])return null;
 const t=data.clip(request.id).events.hit?.[0];return t===undefined?null:Math.max(0,(t-request.from)/request.speed);
}
