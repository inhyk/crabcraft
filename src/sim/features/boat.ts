/** Two-seat skiff rules extracted from game/shoreBoat.ts and boat achievements.ts. */
import type { EntityRef, SimUnit } from '../types.ts';
import { copyValue } from '../events.ts';
import { resetLocomotionOrigin, teleport } from '../unit.ts';
import { actorForRef, sameRef, validBindings, validDt, validStamp } from './types.ts';
import type { BoatAchievement, BoatCommand, BoatState, FeatureContext, FeatureObservation } from './types.ts';

const home = (): BoatState => ({x:151,z:18.5,yaw:Math.PI/2,speed:0,seats:[null,null]});
export class NumericBoat {
  private state: BoatState = home();
  private throttle = 0;
  private steer = 0;
  private inputAt = -10;
  private sequence = -1;
  private epoch: number;
  private serial = 0;
  private voyage = '';
  private bindings = new Map<string, EntityRef>();
  private seatedBefore = new Map<string, EntityRef>();
  private distance = new Map<string, number>();
  private previous = new Map<string, {x:number;z:number}>();
  private earned = new Map<string, Set<BoatAchievement>>();
  private context: FeatureContext;
  private villagePlaying: () => boolean;
  constructor(context: FeatureContext, options: {villagePlaying: () => boolean}) {
    this.context=context;this.villagePlaying=options.villagePlaying;this.epoch=context.authorityEpoch;
  }
  snapshot(): BoatState { return copyValue(this.state); }
  debug() { return copyValue({state:this.state,throttle:this.throttle,steer:this.steer,inputAt:this.inputAt,
    voyage:this.voyage,serial:this.serial,sequence:this.sequence,epoch:this.epoch,bindings:[...this.bindings],seatedBefore:[...this.seatedBefore],previous:[...this.previous],distance:[...this.distance],earned:[...this.earned].map(([id,s])=>[id,[...s]])}); }
  seated(ref: EntityRef): boolean {
    const actor=actorForRef(this.context,ref);
    return !!actor&&this.state.seats.includes(actor.id)&&this.bound(actor.id)===actor.unit;
  }
  private bound(id:string):SimUnit|null {
    const unit=this.context.resolve(id),ref=this.bindings.get(id);
    return unit&&ref&&sameRef(unit.ref,ref)?unit:null;
  }
  nearby(ref:EntityRef):boolean {
    const a=actorForRef(this.context,ref);return !!a&&this.context.chapter===1&&(this.seated(ref)||this.canSummon(a.unit)||this.canBoard(a.unit));
  }
  private canSummon(unit:SimUnit):boolean {
    return !this.state.seats.some(Boolean)&&Math.hypot(this.state.x-151,this.state.z-18.5)>12&&Math.hypot(unit.x-144,unit.z-19)<4.5;
  }
  private canBoard(unit:SimUnit):boolean {
    return Math.hypot(unit.x-this.state.x,unit.z-this.state.z)<12&&Math.abs(this.state.speed)<.5
      &&unit.y>.15&&Math.abs(unit.y-this.context.query.heightAt(unit.x,unit.z))<2;
  }
  landing(radius=1.2):{x:number;z:number}|null {
    const g=this.context,s=this.state,r=Math.max(.8,radius),out={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};
    for(const angle of [0,-.35,.35,-.7,.7,-1.2,1.2,Math.PI])for(let d=5;d<=11;d+=.75){
      const a=s.yaw+angle,x=s.x+Math.sin(a)*d,z=s.z+Math.cos(a)*d,y=g.query.heightAt(x,z);
      if(y<.25||y>2.8)continue;
      if(![[0,0],[-r,0],[r,0],[0,-r],[0,r]].every(([dx,dz])=>{const h=g.query.heightAt(x+dx,z+dz);return h>.15&&Math.abs(h-y)<1.05;}))continue;
      if(g.actors().some(({id,unit:u})=>u.alive&&!u.hidden&&!s.seats.includes(id)&&Math.hypot(u.x-x,u.z-z)<r+u.radius+.2))continue;
      g.query.resolveCollision(x,z,r,out);if(Math.hypot(out.x-x,out.y-z)>.4)continue;
      return {x,z};
    }
    return null;
  }
  request(ref:EntityRef,c:BoatCommand):boolean {
    this.checkEpoch();const g=this.context,a=actorForRef(g,ref);
    if(!g.authority||!a?.unit.alive||g.chapter!==1||this.villagePlaying())return false;
    if(!c||!['board','leave','call','drive'].includes(c.action)||![c.throttle,c.steer].every(v=>Number.isFinite(v)&&v>=-1&&v<=1))return false;
    const {id,unit:u}=a,seat=this.state.seats.indexOf(id);
    if(c.action==='call'){
      if(this.state.seats.some(Boolean)||Math.hypot(u.x-144,u.z-19)>=4.5)return false;
      this.resetHome();return true;
    }
    if(c.action==='leave'){
      if(seat<0||!this.seated(ref))return false;
      this.leave(id,u);return true;
    }
    if(c.action==='board'){
      if(seat>=0||g.encounterEngaged||!this.canBoard(u))return false;
      const free=this.state.seats.indexOf(null);if(free<0)return false;
      if(!this.state.seats.some(Boolean))this.voyage=`${g.areaId}:boat:${g.authorityEpoch}:${++this.serial}`;
      this.state.seats[free]=id;this.bindings.set(id,{...u.ref});if(this.state.exits)delete this.state.exits[id];
      return true;
    }
    if(seat!==0||!this.seated(ref))return false;
    this.throttle=c.throttle;this.steer=c.steer;this.inputAt=g.time;return true;
  }
  private leave(id:string,u:SimUnit):void {
    const land=this.landing(u.radius),exit=land??{x:143,z:23};
    this.state.exits=Object.fromEntries(Object.entries({...this.state.exits,[id]:{...exit,shore:!!land}}).slice(-8));
    this.state.seats[this.state.seats.indexOf(id)]=null;this.bindings.delete(id);this.seatedBefore.delete(id);this.previous.delete(id);
    teleport(u,this.context.query,exit.x,exit.z);this.compact();
    this.context.emit({type:'boatLeft',actor:{...u.ref},id,...exit,shore:!!land,voyage:this.voyage});
    if(land)this.achievement(id,u,'landfall');
    if(!land&&!this.state.seats.some(Boolean))this.resetHome();
  }
  private compact():void {this.state.seats=[...this.state.seats.filter((id):id is string=>id!==null),null,null].slice(0,2) as BoatState['seats'];this.throttle=this.steer=this.state.speed=0;}
  private resetHome():void {this.state={...home(),exits:this.state.exits};this.throttle=this.steer=0;this.inputAt=-10;this.bindings.clear();}
  /** Call only at an accepted fixed-step transport boundary; the adapter validates room/life mappings. */
  applyObservation(observation:FeatureObservation<BoatState>):boolean {
    this.checkEpoch();
    if(!validStamp(this.context,observation,this.sequence)||!validBoat(observation.state)
      ||!validBindings(this.context,observation.state.seats.filter((id):id is string=>id!==null),observation.bindings))return false;
    const s=copyValue(observation.state);
    if(s.seats.some(Boolean)&&(!this.voyage||!this.state.seats.some(Boolean)))this.voyage=`${this.context.areaId}:boat:${this.epoch}:observed:${observation.sequence}`;
    for(const id of s.seats)if(id){
      const ref=observation.bindings[id],before=this.seatedBefore.get(id);
      if(before&&!sameRef(before,ref)){this.seatedBefore.delete(id);this.previous.delete(id);}
      this.bindings.set(id,{...ref});
    }
    for(const id of this.bindings.keys())if(!s.seats.includes(id))this.bindings.delete(id);
    this.state=s;this.sequence=observation.sequence;return true;
  }
  private checkEpoch():void {
    if(this.epoch===this.context.authorityEpoch)return;
    this.epoch=this.context.authorityEpoch;this.sequence=-1;this.throttle=this.steer=0;this.inputAt=-10;
    if(this.context.authority&&this.state.seats.some(Boolean))this.voyage=`${this.context.areaId}:boat:${this.epoch}:${++this.serial}`;
  }
  step(dt:number):void {
    validDt(dt);this.checkEpoch();const g=this.context;
    if(g.chapter!==1){this.reset(false);return;}
    if(g.authority){
      let removed=false;
      for(let i=0;i<2;i++){const id=this.state.seats[i];if(id&&!this.bound(id)?.alive){this.state.seats[i]=null;this.bindings.delete(id);removed=true;}}
      if(removed){this.compact();if(!this.state.seats.some(Boolean)&&!this.landing())this.resetHome();}
      if(!this.state.seats[0]&&this.state.seats[1]||!this.state.seats.some(Boolean)&&this.state.speed!==0)this.compact();
      const active=g.time-this.inputAt<.4&&!!this.state.seats[0],target=active?this.throttle*6:0;
      this.state.speed+=(target-this.state.speed)*Math.min(1,dt*2.5);
      this.state.yaw+=(active?this.steer:0)*dt*.9*Math.min(1,Math.abs(this.state.speed)+.2);
      const s=this.state,x=s.x+Math.sin(s.yaw)*s.speed*dt,z=s.z+Math.cos(s.yaw)*s.speed*dt;
      const clear=x>105&&x<265&&z>-78&&z<96&&[-3.8,0,3.8].every(d=>[-1.6,0,1.6].every(w=>g.query.heightAt(x+Math.sin(s.yaw)*d+Math.cos(s.yaw)*w,z+Math.cos(s.yaw)*d-Math.sin(s.yaw)*w)<.2));
      if(clear){s.x=x;s.z=z;}else s.speed=0;
      s.yaw=Math.atan2(Math.sin(s.yaw),Math.cos(s.yaw));
    }
    this.placePassengers(dt);
  }
  private placePassengers(dt:number):void {
    const g=this.context,s=this.state;
    for(const [id,ref] of this.seatedBefore)if(!s.seats.includes(id)){
      const u=g.resolve(id);if(u?.alive&&sameRef(u.ref,ref)){
        const exit=s.exits?.[id]??{x:143,z:23,shore:false};teleport(u,g.query,exit.x,exit.z,exit.shore?undefined:-Math.PI/2);
        g.emit({type:'boatLeft',actor:{...u.ref},id,...exit,voyage:this.voyage});
        if(exit.shore)this.achievement(id,u,'landfall');
      }
      this.seatedBefore.delete(id);this.previous.delete(id);
    }
    s.seats.forEach((id,i)=>{
      if(!id)return;const u=this.bound(id);if(!u?.alive)return;
      if(!this.seatedBefore.has(id)){
        g.clearControls(u);this.seatedBefore.set(id,{...u.ref});
        g.emit({type:'boatBoarded',actor:{...u.ref},id,seat:i,voyage:this.voyage});
      }
      g.stopActions(u);
      const offset=i===0?1.65:-1.65;
      u.x=s.x+Math.sin(s.yaw)*offset;u.y=.88+Math.sin(g.time*1.8)*.055;u.z=s.z+Math.cos(s.yaw)*offset;u.yaw=s.yaw;u.pushTime=0;
      u.pose.localVx=u.pose.localVz=u.pose.yawRate=0;resetLocomotionOrigin(u);
      if(g.ownsProgression(id)){
        const previous=this.previous.get(id),d=previous?Math.hypot(s.x-previous.x,s.z-previous.z):0;
        if(previous&&dt>0&&d<Math.max(2,dt*12))this.distance.set(id,(this.distance.get(id)??0)+d);
        this.previous.set(id,{x:s.x,z:s.z});
        if((this.distance.get(id)??0)>=10)this.achievement(id,u,'sail');
        if(s.seats.every(Boolean))this.achievement(id,u,'crew');
      }
    });
  }
  private achievement(id:string,unit:SimUnit,achievement:BoatAchievement):void {
    if(!this.context.ownsProgression(id))return;
    const earned=this.earned.get(id)??new Set<BoatAchievement>();if(earned.has(achievement))return;
    earned.add(achievement);this.earned.set(id,earned);
    this.context.emit({type:'boatAchievement',actor:{...unit.ref},id,achievement,key:`${this.voyage}:${id}:${achievement}`,distance:this.distance.get(id)??0});
  }
  /** Trusted personal save initialization; never accepts remote snapshot progression. */
  restoreProgress(id:string, value:{distance:number;earned:readonly string[]}):boolean {
    if(!this.context.ownsProgression(id)||!value||!Number.isFinite(value.distance)||value.distance<0||!Array.isArray(value.earned))return false;
    this.distance.set(id,Math.min(1e7,value.distance));
    this.earned.set(id,new Set(value.earned.filter((s):s is BoatAchievement=>s==='sail'||s==='crew'||s==='landfall')));return true;
  }
  /** Disconnect/Area disposal. reset(false) avoids teleporting into a newly entered world. */
  reset(dock=true):void {
    if(dock&&this.context.chapter===1)for(const [id,ref] of this.seatedBefore){const u=this.context.resolve(id);if(u?.alive&&sameRef(u.ref,ref)){this.context.stopActions(u);teleport(u,this.context.query,143,23,-Math.PI/2);}}
    this.state=home();this.throttle=this.steer=0;this.inputAt=-10;this.bindings.clear();this.seatedBefore.clear();this.previous.clear();
  }
}
function validBoat(s:BoatState):boolean {
  return !!s&&[s.x,s.z,s.yaw,s.speed].every(Number.isFinite)&&Array.isArray(s.seats)&&s.seats.length===2
    &&s.seats.every(id=>id===null||typeof id==='string'&&id.length>0)&&!(s.seats[0]&&s.seats[0]===s.seats[1])
    &&(!s.exits||Object.values(s.exits).every(e=>e&&Number.isFinite(e.x)&&Number.isFinite(e.z)&&typeof e.shore==='boolean'));
}
