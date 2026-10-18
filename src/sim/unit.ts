import type { ActionData, EntityRef, Reaction, SimUnit, UnitKind, Vec2Out, Vec3, WorldQuery } from './types.ts';
import { angleDiff, clamp, damp, distXZ } from './math.ts';
import { immutable } from './events.ts';
export function createUnit(ref: EntityRef, archetype: string, kind: UnitKind, reaction: Reaction, data: ActionData, position: Readonly<Vec3> = {x:0,y:0,z:0}): SimUnit {
  const shape = data.archetype(archetype);
  if (!(shape.radius > 0 && shape.height > 0 && shape.metersToUnits > 0) || ![shape.radius,shape.height,shape.metersToUnits].every(Number.isFinite)) throw new RangeError('Invalid archetype');
  return {ref:immutable(ref),archetype,kind,reaction,...position,level:1,yaw:0,radius:shape.radius,height:shape.height,hp:100,maxHp:100,alive:true,hidden:false,targetable:true,invulnerable:false,stunUntil:0,slowUntil:0,slowPct:0,rust:0,rustUntil:0,absorb:0,absorbMax:0,absorbUntil:0,blessingUntil:0,encounterBlessing:false,lastCombat:-1e9,pushX:0,pushZ:0,pushTime:0,lift:0,npcId:null,pose:{locomotionTime:0,localVx:0,localVz:0,yawRate:0,locomotionWeights:{},previousX:position.x,previousZ:position.z,previousYaw:0,appliedQ:[],appliedPosition:[0,0,0],appliedRotation:[0,0,0,1],gaitPhase:0,controllerVx:0,controllerVz:0,controllerYaw:0,locomotionQ:[],locomotionPosition:[0,0,0],locomotionRotation:[0,0,0,1]},actions:[],pendingHit:null};
}
function collision(query: WorldQuery,x: number,z: number,radius: number): Vec2Out { return query.resolveCollision(x,z,radius,{x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}}); }
export function teleport(unit: SimUnit, query: WorldQuery, x: number, z: number, yaw?: number): void { const p=collision(query,x,z,unit.radius); unit.x=p.x;unit.z=p.y;unit.y=query.heightAt(p.x,p.y);if(yaw!==undefined)unit.yaw=yaw;unit.pushTime=0;unit.pose.localVx=unit.pose.localVz=unit.pose.yawRate=0;resetLocomotionOrigin(unit); }
export function moveTo(unit: SimUnit,query: WorldQuery,x:number,z:number,dt:number):void { const p=collision(query,x,z,unit.radius);unit.x=p.x;unit.z=p.y;const gy=query.heightAt(p.x,p.y)+unit.lift;unit.y=Math.abs(gy-unit.y)>3?gy:damp(unit.y,gy,18,dt); }
export const distTo = (a: Readonly<SimUnit>,b: Readonly<SimUnit>):number => distXZ(a,b);
export const gapTo = (a: Readonly<SimUnit>,b: Readonly<SimUnit>):number => Math.max(0,distTo(a,b)-a.radius-b.radius);
export const centre = (unit: Readonly<SimUnit>):Vec3 => ({x:unit.x,y:unit.y+unit.height*.5,z:unit.z});
export function lineOfSight(query: WorldQuery,from:Readonly<SimUnit>,to:Readonly<SimUnit>):boolean {const eye={x:from.x,y:from.y+from.height*.8,z:from.z},at=centre(to);const hit=query.raycastSolid(eye,at);return hit===null || hit>=Math.hypot(eye.x-at.x,eye.y-at.y,eye.z-at.z)-to.radius-.3;}
export const speedMul = (unit: Readonly<SimUnit>,now:number):number => (now<unit.slowUntil?1-unit.slowPct:1)*(now<unit.rustUntil?1-.1*unit.rust:1);

export function resetLocomotionOrigin(unit:SimUnit):void {unit.pose.previousX=unit.x;unit.pose.previousZ=unit.z;unit.pose.previousYaw=unit.yaw;}
export function feedLocomotion(unit:SimUnit,dt:number):void {if(dt<=0)return;const p=unit.pose;let dx=(unit.x-p.previousX)/dt,dz=(unit.z-p.previousZ)/dt;const speed=Math.hypot(dx,dz);if(speed>14){dx*=14/speed;dz*=14/speed;}const sin=Math.sin(unit.yaw),cos=Math.cos(unit.yaw);p.localVx=damp(p.localVx,dx*cos-dz*sin,14,dt);p.localVz=damp(p.localVz,dx*sin+dz*cos,14,dt);p.yawRate=damp(p.yawRate,clamp(angleDiff(unit.yaw,p.previousYaw)/dt,-6,6),12,dt);resetLocomotionOrigin(unit);}
