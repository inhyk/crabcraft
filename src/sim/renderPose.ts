/** Exact render sampling from authority-captured inputs. Never advances gameplay or clocks. */
import {numericClip,motionData} from './data/pose.ts';
import {Pose,CLAW_JOINTS,sampleClip,rebaseRoot,sampleLocomotionPose} from './pose.ts';
import type {ActionState,SimUnit,ActionId} from './types.ts';
export const RENDER_POSE_RECIPE_VERSION=1 as const;
export const renderPoseProviderVersion=motionData.version;
/** Smoothed velocity in robot units, then shared gait phase and idle time at the last sample. */
export type LocomotionPoseRecipe=readonly [vx:number,vz:number,yawRate:number,phase:number,idleT:number];
export interface RenderPoseLayer {
 readonly id:ActionId;readonly time:number;readonly weight:number;
 readonly loop:boolean;readonly upper:boolean;readonly carryRoot:boolean;
 readonly rebase?:Readonly<{x:number;z:number;yaw:number}>;
}
export interface RenderPoseRecipe {
 readonly version:typeof RENDER_POSE_RECIPE_VERSION;
 /** null is the measured initial HOME pose, not missing data. */
 readonly locomotion:LocomotionPoseRecipe|null;
 /** Last applied order/weights, independent of subsequently changed action state. */
 readonly layers:readonly RenderPoseLayer[];
}
export interface AppliedRenderPose {appliedQ:number[];appliedPosition:[number,number,number];appliedRotation:[number,number,number,number]}
export function captureRenderPoseRecipe(locomotion:LocomotionPoseRecipe|null,actions:readonly ActionState[]):RenderPoseRecipe {
 const layers=actions.filter(a=>a.weight>0).map(a=>{
  const layer:RenderPoseLayer={id:a.id,time:a.clipTime,weight:a.weight,loop:a.loop&&a.to===null,upper:a.upper,carryRoot:a.carryRoot,...(a.root?.rebase?{rebase:Object.freeze({...a.root.rebase})}:{})};
  return Object.freeze(layer);
 });
 return Object.freeze({version:RENDER_POSE_RECIPE_VERSION,locomotion:locomotion===null?null:Object.freeze([...locomotion]) as LocomotionPoseRecipe,layers:Object.freeze(layers)});
}
export function homeRenderPoseRecipe():RenderPoseRecipe{return captureRenderPoseRecipe(null,[]);}
/** Shared with the authoritative pose stage, retaining its sequential Float32 blend writes. */
export function blendRenderPoseLayers(base:Pose,layers:readonly RenderPoseLayer[],out=new Pose()):Pose {
 out.copy(base);const tmp=new Pose();
 for(const layer of layers){
  sampleClip(numericClip(layer.id),layer.time,layer.loop,tmp,layer.carryRoot);
  if(layer.rebase)rebaseRoot(tmp,layer.rebase.x,layer.rebase.z,layer.rebase.yaw);
  out.blend(tmp,layer.weight,layer.upper?CLAW_JOINTS:undefined);
 }
 return out;
}
/** Returns the snapshot of inputs used at the last applied pose stage, not live action state. */
export function createRenderPoseRecipe(unit:Readonly<SimUnit>):RenderPoseRecipe{return unit.pose.renderRecipe;}
export function evaluateRenderPoseRecipe(recipe:RenderPoseRecipe):AppliedRenderPose {
 if(recipe.version!==RENDER_POSE_RECIPE_VERSION)throw new Error(`Unsupported render pose recipe ${recipe.version}`);
 const out=blendRenderPoseLayers(sampleLocomotionPose(recipe.locomotion),recipe.layers);
 return {appliedQ:Array.from(out.q),appliedPosition:Array.from(out.pos) as [number,number,number],appliedRotation:Array.from(out.rot) as [number,number,number,number]};
}
/** Wire boundary guard. Numbers are transported losslessly; no quantization is applied here. */
export function isRenderPoseRecipe(value:unknown):value is RenderPoseRecipe {
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
 if(!object(value)||value.version!==RENDER_POSE_RECIPE_VERSION||Object.keys(value).some(k=>!['version','locomotion','layers'].includes(k)))return false;
 if(value.locomotion!==null&&(!Array.isArray(value.locomotion)||value.locomotion.length!==5||!value.locomotion.every(finite)||value.locomotion[3]<0||value.locomotion[4]<0))return false;
 if(!Array.isArray(value.layers))return false;
 for(const l of value.layers){
  if(!object(l)||Object.keys(l).some(k=>!['id','time','weight','loop','upper','carryRoot','rebase'].includes(k))||typeof l.id!=='string'||!finite(l.time)||l.time<0||!finite(l.weight)||l.weight<=0||l.weight>1||typeof l.loop!=='boolean'||typeof l.upper!=='boolean'||typeof l.carryRoot!=='boolean')return false;
  try{numericClip(l.id);}catch{return false;}
  const r=l.rebase;if(r!==undefined&&(!object(r)||Object.keys(r).length!==3||!['x','z','yaw'].every(k=>finite(r[k]))))return false;
 }
 return true;
}
