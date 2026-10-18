/** Numeric NPC/resident rules from game/npcs.ts. Camera culling never changes server actions. */
import type { ActionId, EntityRef, SimUnit, Vec3 } from '../types.ts';
import { copyValue } from '../events.ts';
import { damp, TAU, turnToward, yawTo } from '../math.ts';
import { pick, rand } from '../random.ts';
import { distTo, feedLocomotion, moveTo } from '../unit.ts';
import { FeatureNavigation } from './nav.ts';
import { sameRef, validDt } from './types.ts';
import type { NpcBarkBank, NpcFeatureContext, NumericTownsfolkOptions } from './types.ts';

const GESTURES:Readonly<Record<string,readonly ActionId[]>>={
  brinebeard:['gesture_salute','gesture_paw'],silvermoon:['gesture_bow','gesture_paw'],
  coralline:['gesture_bow','gesture_paw'],grukk:['claw_left','claw_right'],
  hoofclaw:['gesture_paw','gesture_hello'],rattlebolt:['gesture_paw','claw_left'],pip:['claw_right','gesture_salute'],
};
const ARRIVAL_GESTURES:readonly ActionId[]=['gesture_paw','gesture_hello','claw_left','gesture_salute'];
function playerFor(context:NpcFeatureContext,ref:EntityRef):SimUnit|null {
  return context.players().find(p=>p.alive&&!p.hidden&&sameRef(p.ref,ref))??null;
}
/** Server adaptation of the single local player: nearest eligible human, stable ID tie break. */
function nearestPlayer(context:NpcFeatureContext,unit:SimUnit):SimUnit|null {
  let result:SimUnit|null=null,distance=Infinity;
  for(const p of context.players()){
    if(!p.alive||p.hidden||p.ref.area!==unit.ref.area)continue;
    const d=distTo(unit,p);
    if(d<distance||d===distance&&result&&(p.ref.id<result.ref.id||p.ref.id===result.ref.id&&p.ref.life<result.ref.life)){result=p;distance=d;}
  }
  return result;
}
function available(context:NpcFeatureContext,unit:SimUnit,life:EntityRef):boolean {
  return context.authority&&unit.alive&&!unit.hidden&&sameRef(unit.ref,life)&&!context.endingActive&&!context.externallyOwned(unit.ref);
}

export class NumericNpc {
  readonly unit:SimUnit;
  readonly npcId:string;
  private context:NpcFeatureContext;
  private life:EntityRef;
  private homeYaw:number;
  private gestures:readonly ActionId[];
  private helloCd=0;
  private gestureAt:number;
  private speaker:EntityRef|null=null;
  private lookAt:Vec3|null=null;
  constructor(context:NpcFeatureContext,unit:SimUnit,options:{npcId:string;homeYaw:number;gestures?:readonly ActionId[]}) {
    const gestures=options.gestures??GESTURES[options.npcId];
    if(!Number.isFinite(options.homeYaw)||!gestures?.length)throw new RangeError('Missing numeric NPC heading/gestures');
    this.context=context;this.unit=unit;this.life={...unit.ref};this.npcId=options.npcId;this.homeYaw=options.homeYaw;this.gestures=[...gestures];
    unit.npcId=options.npcId;this.gestureAt=context.time+rand(context.rng,6,16);
  }
  get talking():boolean {return this.speaker!==null;}
  /** Area validates interaction range/policy first. Conversation coordinates are numeric, not a camera. */
  setConversation(speaker:EntityRef|null,lookAt:Readonly<Vec3>|null=null):boolean {
    if(!available(this.context,this.unit,this.life))return false;
    if(speaker&&(speaker.area!==this.unit.ref.area||!playerFor(this.context,speaker)))return false;
    if(lookAt&&![lookAt.x,lookAt.y,lookAt.z].every(Number.isFinite))return false;
    this.speaker=speaker?{...speaker}:null;this.lookAt=speaker&&lookAt?{...lookAt}:null;return true;
  }
  step(dt:number):void {
    validDt(dt);const g=this.context,u=this.unit;if(!available(g,u,this.life))return;
    const speaker=this.speaker?playerFor(g,this.speaker):null;
    if(this.speaker&&!speaker){this.speaker=null;this.lookAt=null;}
    const p=speaker??nearestPlayer(g,u),d=p?distTo(u,p):Infinity,near=!!p&&d<9;
    const look=this.talking&&this.lookAt?this.lookAt:p;
    const want=look&&(near||this.talking)?yawTo(u.x,u.z,look.x,look.z):this.homeYaw;
    u.yaw=turnToward(u.yaw,want,2.6,dt);
    if(p&&d<7&&g.time>this.helloCd&&!this.talking&&!g.hasAction(u)){
      this.helloCd=g.time+40;g.playAction(u,'gesture_hello');
      g.emit({type:'npcGreeting',unit:{...u.ref},player:{...p.ref},expression:'happy',seconds:1.5});
    }else if(g.time>this.gestureAt&&!this.talking&&!g.hasAction(u)){
      this.gestureAt=g.time+rand(g.rng,14,26);g.playAction(u,pick(g.rng,this.gestures));
    }
    if(d>12)this.helloCd=Math.min(this.helloCd,g.time+3);
    feedLocomotion(u,dt);
  }
  debug() {return copyValue({unit:this.life,npcId:this.npcId,homeYaw:this.homeYaw,gestures:this.gestures,
    helloCd:this.helloCd,gestureAt:this.gestureAt,speaker:this.speaker,lookAt:this.lookAt});}
}

export class NumericTownsfolk {
  readonly unit:SimUnit;
  frozen=false;
  private context:NpcFeatureContext;
  private life:EntityRef;
  private points:readonly Readonly<Vec3>[];
  private radius:number;
  private dest:Vec3={x:0,y:0,z:0};
  private walking=false;
  private pauseUntil:number;
  private speed:number;
  private sideways=false;
  private velX=0;
  private velZ=0;
  private barkCd=0;
  private stuckFor=0;
  private route:FeatureNavigation|null=null;
  private clearDest={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};
  constructor(context:NpcFeatureContext,unit:SimUnit,options:NumericTownsfolkOptions) {
    validateOptions(options);this.context=context;this.unit=unit;this.life={...unit.ref};
    this.points=copyValue(options.points);this.radius=options.wanderRadius;
    this.speed=rand(context.rng,1.3,2.1);this.pauseUntil=context.time+rand(context.rng,0,4);
    this.route=this.navigation(options);
    if(options.relocated)this.pauseUntil=context.time+1;
  }
  private navigation(options:NumericTownsfolkOptions):FeatureNavigation|null {
    return options.route?new FeatureNavigation(this.context.query,{points:options.route.points,radius:this.unit.radius+options.route.radiusPadding,step:options.route.step}):null;
  }
  relocate(options:NumericTownsfolkOptions):void {
    validateOptions(options);this.points=copyValue(options.points);this.radius=options.wanderRadius;this.route=this.navigation(options);
    this.walking=false;this.velX=this.velZ=this.stuckFor=0;this.pauseUntil=this.context.time+1;this.frozen=false;
  }
  /** Area checks interactable range and selects the speaker's chapter/progression bank. */
  bark(speaker:EntityRef,bank:NpcBarkBank):boolean {
    const g=this.context,u=this.unit,p=playerFor(g,speaker);
    if(!available(g,u,this.life)||!p||p.ref.area!==u.ref.area||g.time<this.barkCd||!['shore','star','starVictory'].includes(bank))return false;
    this.barkCd=g.time+4;
    // Source always draws the shore index, even when selecting a second Starhaven line.
    const shoreIndex=Math.floor(g.rng.next()*10),index=bank==='shore'?shoreIndex:Math.floor(g.rng.next()*6);
    u.yaw=yawTo(u.x,u.z,p.x,p.z);g.emit({type:'npcBark',unit:{...u.ref},player:{...p.ref},bank,index});
    this.walking=false;this.pauseUntil=g.time+4;g.playAction(u,'gesture_hello');return true;
  }
  step(dt:number):void {
    validDt(dt);const g=this.context,u=this.unit;if(!available(g,u,this.life))return;
    if(this.frozen){feedLocomotion(u,dt);return;}
    let tx=0,tz=0;
    if(!this.walking&&g.time>this.pauseUntil){
      const base=pick(g.rng,this.points),a=rand(g.rng,0,TAU),r=rand(g.rng,0,this.radius);
      this.dest={x:base.x+Math.cos(a)*r,y:0,z:base.z+Math.sin(a)*r};
      if(this.route){g.query.resolveCollision(this.dest.x,this.dest.z,u.radius+.15,this.clearDest);this.dest={x:this.clearDest.x,y:0,z:this.clearDest.y};}
      this.stuckFor=0;this.walking=true;this.sideways=g.rng.next()<.55;this.speed=rand(g.rng,1.3,2.1);
    }
    if(this.walking){
      const d=Math.hypot(this.dest.x-u.x,this.dest.z-u.z);
      if(d<.5){
        this.walking=false;this.pauseUntil=g.time+rand(g.rng,3,9);
        if(g.rng.next()<.35)g.playAction(u,pick(g.rng,ARRIVAL_GESTURES));
      }else{
        const next=this.route?.waypoint(u,this.dest,g.time)??this.dest,nx=next.x-u.x,nz=next.z-u.z,nd=Math.hypot(nx,nz);
        if(nd>.001){tx=nx/nd;tz=nz/nd;}
        const travel=Math.atan2(tx,tz);u.yaw=turnToward(u.yaw,this.sideways?travel+Math.PI/2:travel,3,dt);
      }
    }
    const p=nearestPlayer(g,u),pd=p?distTo(u,p):Infinity;
    if(p&&pd<u.radius+p.radius+.4&&pd>.01){tx+=(u.x-p.x)/pd*1.5;tz+=(u.z-p.z)/pd*1.5;}
    this.velX=damp(this.velX,tx*this.speed,6,dt);this.velZ=damp(this.velZ,tz*this.speed,6,dt);
    const ox=u.x,oz=u.z;moveTo(u,g.query,u.x+this.velX*dt,u.z+this.velZ*dt,dt);
    this.stuckFor=this.walking&&Math.hypot(u.x-ox,u.z-oz)<this.speed*dt*.2?this.stuckFor+dt:0;
    if(this.stuckFor>.5){this.walking=false;this.pauseUntil=g.time+rand(g.rng,.5,2);}
    feedLocomotion(u,dt);
  }
  debug() {return copyValue({unit:this.life,points:this.points,radius:this.radius,dest:this.dest,walking:this.walking,
    pauseUntil:this.pauseUntil,speed:this.speed,sideways:this.sideways,velX:this.velX,velZ:this.velZ,barkCd:this.barkCd,
    stuckFor:this.stuckFor,frozen:this.frozen,route:this.route?.debug()??null});}
}
function validateOptions(options:NumericTownsfolkOptions):void {
  if(!options.points.length||!Number.isFinite(options.wanderRadius)||options.wanderRadius<0||options.points.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))throw new RangeError('Invalid resident wander definition');
  if(options.route&&(!Number.isFinite(options.route.radiusPadding)||options.route.radiusPadding<0||!Number.isFinite(options.route.step)||options.route.step<=0||options.route.points.some(p=>![p.x,p.y,p.z].every(Number.isFinite))))throw new RangeError('Invalid resident route definition');
}
