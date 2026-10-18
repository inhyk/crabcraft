/** Input-driven authoritative player. Contains no camera, renderer, keyboard or socket state. */
import type { AreaServices, ChannelKind, CharacterId, ClassId, EntityRef, PlayerIntent, PlayerSim, PlayerState, SimUnit, Vec3 } from './types.ts';
import { armorMultiplier } from './data/equipment.ts';
import { CLASSES, type AbilityDef } from './data/classes.ts';
import { abilityNeedsTarget, executeAbility, isMeleeAbility, launchAt, playAction } from './abilities.ts';
import { damp, turnToward, yawTo } from './math.ts';
import { distTo, gapTo, lineOfSight, moveTo, speedMul, teleport } from './unit.ts';
import { levelForXp, xpForLevel } from './data/progression.ts';
import { freshQuests } from './data/quests.ts';
import { BREAK_ROUTINE } from './data/actions.ts';
import { validCommand } from './input.ts';
export const GCD=1;
export const JUMP_CLIP=Object.freeze({from:.8,to:1.56,speed:1.15});
const NEUTRAL:PlayerIntent={seq:0,forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null,commands:[]};
const sameRef=(a:EntityRef|null,b:EntityRef|null)=>a===b || !!(a&&b&&a.area===b.area&&a.id===b.id&&a.life===b.life);

export function createPlayerState(character:CharacterId,unit:SimUnit,classId:ClassId,now=0):PlayerState {
  const cls=CLASSES[classId],mana=cls.resource==='mana';
  unit.maxHp=unit.hp=cls.baseHp;
  return {character,unit:unit.ref,classId,resource:mana?120:0,maxResource:mana?120:100,xp:0,coins:0,attackRank:0,armorRank:0,weaponOwned:false,armorOwned:false,baseMaxHp:cls.baseHp,gcdStart:now,gcdEnd:now,cooldowns:{},cast:null,channel:null,target:null,warded:false,nextSwing:now,lastAttack:now-10,queued:null,velX:0,velZ:0,jumpT:0,spinT:0,lastSpend:now-10,targetDeadAt:0,dash:null,deadUntil:null,role:'authoritative',controlsLocked:false,talkTarget:null,quests:freshQuests(1),flags:{},cogMisses:0,achievements:{earned:[],distance:0},lighthouseSecretFound:false};
}
export class PlayerController implements PlayerSim {
  readonly services:AreaServices;
  readonly state:PlayerState;
  readonly unit:SimUnit;
  private held:PlayerIntent={...NEUTRAL};
  lastConsumedSeq=-1;
  private footstep=0;
  private danceIndex=-1;
  private danceTime=0;
  constructor(services:AreaServices,unit:SimUnit,state:PlayerState) { this.services=services;this.unit=unit;this.state=state; }
  get damageTakenMultiplier():number{return armorMultiplier(this.state.armorRank);}
  get isRage():boolean{return CLASSES[this.state.classId].resource==='rage';}
  get inCombat():boolean{return this.services.time-this.unit.lastCombat<5;}
  get heldIntent():PlayerIntent{return {...this.held,commands:[]};}
  neutralizeInput(newSession=false):void {this.held={...NEUTRAL};if(newSession)this.lastConsumedSeq=0;this.interruptCast();this.cancelChannel();this.cancelDance(0);this.state.queued=null;this.state.dash=null;this.state.velX=this.state.velZ=0;this.services.cancelPendingHit(this.unit.ref);}
  /** Accepted intents execute commands immediately at old Area time; held fields persist. */
  applyIntent(intent:PlayerIntent):void {
    if(!intent||typeof intent!=='object')return;
    if(!Number.isSafeInteger(intent.seq)||intent.seq<0||intent.seq<=this.lastConsumedSeq)return;
    if(![intent.forward,intent.strafe,intent.turn].every(n=>Number.isFinite(n)&&n>=-1&&n<=1)||typeof intent.sprint!=='boolean'||(intent.steeringYaw!==null&&!Number.isFinite(intent.steeringYaw))||!Array.isArray(intent.commands)||intent.commands.length>32||![null,'recall','beacon','waystone'].includes(intent.heldChannel))return;
    // Validate every command before accepting any field, so malformed frames have no partial effect.
    if(!intent.commands.every(validCommand))return;
    this.lastConsumedSeq=intent.seq;this.held={...intent,commands:[]};
    for(const command of intent.commands){
      switch(command.kind){
        case 'target':{if(command.target===null)this.setTarget(null);else{const target=this.services.getUnit(command.target);if(target&&!target.hidden&&target.targetable)this.setTarget(target);}break;}
        case 'ability':this.useAbility(command.slot);break;
        case 'jump':this.jump();break;
        case 'dance':this.toggleDance();break;
        case 'cancel':this.interruptCast();this.cancelChannel();this.cancelDance();this.state.queued=null;break;
        case 'channelStart':if(command.channel==='recall')this.startRecall();else this.services.runCommand(this.unit.ref,command);break;
        default:this.services.runCommand(this.unit.ref,command);break;
      }
    }
  }
  private locked():boolean {const m=this.services.context.members.find(m=>sameRef(m.unit,this.unit.ref));return this.state.controlsLocked || !!m?.seatedBoat || !!m?.featureLocked;}
  private villagePlaying():boolean{return !!this.services.context.members.find(m=>sameRef(m.unit,this.unit.ref))?.villagePlaying;}
  update(dt:number):void {
    const g=this.services,u=this.unit,s=this.state,now=g.time;
    if(!u.alive){if(s.deadUntil!==null&&now>=s.deadUntil)this.respawn();return;}
    const free=!this.locked(),stunned=now<u.stunUntil;
    let fwd=free?this.held.forward:0,strafe=free?this.held.strafe:0,turn=free?this.held.turn:0;
    if(stunned||s.dash)fwd=strafe=turn=0;
    if(stunned){this.interruptCast('You are stunned.');this.cancelChannel();g.cancelPendingHit(u.ref);}
    const steering=free&&this.held.steeringYaw!==null&&!stunned&&!s.dash;
    if(this.danceIndex>=0&&(fwd||strafe||turn||stunned||s.dash||steering||s.cast||s.channel||this.inCombat))this.cancelDance();
    this.updateDance(dt);
    if(steering)u.yaw=this.held.steeringYaw!;else if(turn)u.yaw+=turn*2.9*dt;
    const moving=fwd!==0||strafe!==0;
    if(moving){this.interruptCast();this.cancelChannel();}
    const target=s.target?g.getUnit(s.target):null;
    if(!moving&&!turn&&!steering&&target?.alive&&!sameRef(target.ref,u.ref)&&(s.cast||now-s.lastAttack<1.6))u.yaw=turnToward(u.yaw,yawTo(u.x,u.z,target.x,target.z),9,dt);
    const talk=s.talkTarget?g.getUnit(s.talkTarget):null;
    if(talk&&!moving&&!turn&&!steering&&!stunned&&!s.dash)u.yaw=turnToward(u.yaw,yawTo(u.x,u.z,talk.x,talk.z),4.5,dt);
    if(s.jumpT>0)s.jumpT-=dt;
    let nx=u.x,nz=u.z;
    if(s.dash){this.updateDash(dt);nx=u.x;nz=u.z;}
    else {
      const speed=5*(free&&!stunned&&moving&&this.held.sprint?1.65:1)*speedMul(u,now);
      let lx=strafe,lz=fwd;const length=Math.hypot(lx,lz);if(length){lx/=length;lz/=length;}
      if(lz<0){lz*=.62;lx*=.8;}
      const sin=Math.sin(u.yaw),cos=Math.cos(u.yaw),k=moving?12:16;
      s.velX=damp(s.velX,(lx*cos+lz*sin)*speed,k,dt);s.velZ=damp(s.velZ,(-lx*sin+lz*cos)*speed,k,dt);
      nx+=s.velX*dt;nz+=s.velZ*dt;
    }
    if(u.pushTime>0){const pushDt=Math.min(dt,u.pushTime);u.pushTime=Math.max(0,u.pushTime-dt);nx+=u.pushX*pushDt;nz+=u.pushZ*pushDt;}
    // Boats own rider position in the deterministic feature stage; locked riders stay put here.
    if(!g.context.members.find(m=>sameRef(m.unit,u.ref))?.seatedBoat)moveTo(u,g.query,nx,nz,dt);
    s.spinT=Math.max(0,s.spinT-dt);
    const velocity=Math.hypot(s.velX,s.velZ);
    if(velocity>1&&s.jumpT<=0){this.footstep-=dt*velocity/5;if(this.footstep<=0){this.footstep=.34;g.emit({type:'footstep',unit:u.ref});}}
    this.updateCombat();this.updateResources(dt);
  }
  private jump():void {
    const g=this.services,s=this.state,u=this.unit;
    if(!u.alive||this.locked()||s.jumpT>0||g.time<u.stunUntil||s.dash)return;
    this.cancelDance();s.jumpT=(JUMP_CLIP.to-JUMP_CLIP.from)/JUMP_CLIP.speed;
    playAction(g,u,'jump',JUMP_CLIP);g.emit({type:'jump',unit:u.ref});this.interruptCast();this.cancelChannel();
  }
  private updateCombat():void {
    const g=this.services,u=this.unit,s=this.state,now=g.time;
    let t=s.target?g.getUnit(s.target):null;
    if(s.target&&!t)this.setTarget(null);
    if(t&&(t.hidden||(!t.alive&&now-s.targetDeadAt>1.5)))this.setTarget(null);
    if(t&&!t.alive&&s.targetDeadAt===0)s.targetDeadAt=now;
    if(s.cast){const c=s.cast,target=c.target?g.getUnit(c.target):null,ab=CLASSES[s.classId].abilities.find(a=>a.id===c.ability)!;
      if(c.target&&!target?.alive)this.interruptCast('Invalid target');
      else if(now>=c.end){s.cast=null;playAction(g,u,'cast',{upper:true,part:'release',fade:.1});g.emit({type:'castEnd',unit:u.ref,channel:false,result:'done'});if(target&&abilityNeedsTarget(ab)&&!this.checkReach(ab,target))return;this.commit(ab,target);}
    }
    if(s.channel){const ch=s.channel;if(this.held.heldChannel!==ch.kind)this.cancelChannel();else if(now>=ch.end){s.channel=null;playAction(g,u,'cast',{upper:true,part:'release',fade:.1});g.emit({type:'castEnd',unit:u.ref,channel:true,result:'done'});this.finishChannel(ch.kind,ch.targetId,ch.to,ch.start,ch.end);}}
    if(s.queued&&now>=s.gcdEnd&&!s.cast){const queued=s.queued;s.queued=null;const a=CLASSES[s.classId].abilities.find(a=>a.id===queued);if(a)this.useAbility(a.slot);}
    t=s.target?g.getUnit(s.target):null;
    if(!this.villagePlaying()&&t?.alive&&t.reaction==='hostile'&&!t.hidden&&!s.cast&&!s.channel&&!s.dash&&now>=s.nextSwing&&u.alive&&now>=u.stunUntil){
      if(this.isRage){if(gapTo(u,t)<=1.5){s.nextSwing=now+2;s.lastAttack=now;this.cancelDance();playAction(g,u,'attack_swipe',{upper:true},{attack:'warrior-auto',source:u.ref,target:t.ref});}}
      else if(distTo(u,t)<=20&&lineOfSight(g.query,u,t)){s.nextSwing=now+1.8;s.lastAttack=now;this.cancelDance();const holy=s.classId==='priest';launchAt(g,u,t,holy?'holy':'spark',22,{attack:'ranged-auto',source:u.ref,target:t.ref,school:holy?'holy':'frost'});}
    }
  }
  private updateResources(dt:number):void {
    const g=this.services,s=this.state,u=this.unit,now=g.time,ooc=now-u.lastCombat>5;
    if(this.isRage){if(now-u.lastCombat>3)s.resource=Math.max(0,s.resource-4*dt);}
    else s.resource=Math.min(s.maxResource,s.resource+(ooc?10:now-s.lastSpend>5?5:2.8)*dt);
    let regen=ooc?u.maxHp*.05:0;if(now<u.blessingUntil||u.encounterBlessing)regen+=u.maxHp*.02;
    if(regen>0&&u.hp<u.maxHp)u.hp=Math.min(u.maxHp,u.hp+regen*dt);
    if(u.absorb>0&&now>=u.absorbUntil){u.absorb=0;this.dropWard();}
  }
  useAbility(slot:number):void {
    const g=this.services,s=this.state,u=this.unit,ab=CLASSES[s.classId].abilities[slot-1];if(!ab||!u.alive||this.locked()||this.villagePlaying())return;
    this.cancelDance(.12);g.emit({type:'press',unit:u.ref,slot});const now=g.time;
    if(now<u.stunUntil)return this.error('You are stunned.');
    if(s.channel)return this.error('Another action is in progress.');
    if(s.cast){if(now>s.cast.end-.3)s.queued=ab.id;else this.error('Another action is in progress.');return;}
    const cooldown=s.cooldowns[ab.id],left=cooldown?Math.max(0,cooldown.end-now):0,wait=Math.max(s.gcdEnd-now,left);
    if(wait>0){if(wait<.4&&left<.4)s.queued=ab.id;else this.error('Ability is not ready yet.');return;}
    if(s.resource<ab.cost)return this.error(this.isRage?'Not enough rage.':'Not enough mana.');
    let target:SimUnit|null=null;if(abilityNeedsTarget(ab)){target=s.target?g.getUnit(s.target):null;if(!target)return this.error('You have no target.');if(!target.alive||target.reaction!=='hostile'||target.hidden)return this.error('Invalid target.');if(!this.checkReach(ab,target))return;}
    s.gcdStart=now;s.gcdEnd=now+GCD;s.lastAttack=now;
    if(ab.castTime>0){s.cast={ability:ab.id,start:now,end:now+ab.castTime,target:target?.ref??null};playAction(g,u,'cast',{upper:true,loop:true,fade:.15});g.emit({type:'castStart',unit:u.ref,seconds:ab.castTime,ability:ab.id});}
    else this.commit(ab,target);
  }
  private checkReach(ab:AbilityDef,t:SimUnit):boolean {
    const u=this.unit;let error='';if(isMeleeAbility(ab))error=gapTo(u,t)>1.8?'Out of range.':'';
    else if(distTo(u,t)-t.radius>ab.range)error='Out of range.';
    else if(ab.id==='sideways-charge'&&gapTo(u,t)<2)error='Target too close.';
    else if(!lineOfSight(this.services.query,u,t))error='Target not in line of sight.';
    if(error)this.error(error);return !error;
  }
  private commit(ab:AbilityDef,target:SimUnit|null):void {const g=this.services,s=this.state;if(s.resource<ab.cost)return this.error(this.isRage?'Not enough rage.':'Not enough mana.');s.resource-=ab.cost;if(ab.cost>0)s.lastSpend=g.time;if(ab.generates)this.gainRage(ab.generates);if(ab.cooldown>0)s.cooldowns[ab.id]={start:g.time,end:g.time+ab.cooldown};s.lastAttack=g.time;executeAbility(g,this,ab,target);}
  interruptCast(reason='Interrupted'):void {if(!this.state.cast)return;this.state.cast=null;this.services.stopAction(this.unit.ref,'cast',.15);this.services.emit({type:'castEnd',unit:this.unit.ref,channel:false,result:'interrupted',reason});}
  cancelChannel():void {if(!this.state.channel)return;this.state.channel=null;this.services.stopAction(this.unit.ref,'cast',.2);this.services.emit({type:'castEnd',unit:this.unit.ref,channel:true,result:'interrupted',reason:'Interrupted'});}
  startChannel(kind:ChannelKind,seconds:number,to:Readonly<Vec3>,targetId:string|null=null):void {if(!this.unit.alive||this.locked()||this.services.time<this.unit.stunUntil)return;this.cancelDance();this.interruptCast();this.cancelChannel();const start=this.services.time,end=start+seconds;this.state.channel={kind,start,end,to:{...to},targetId};this.state.velX=this.state.velZ=0;playAction(this.services,this.unit,'cast',{upper:true,loop:true,fade:.2});this.services.emit({type:'castStart',unit:this.unit.ref,seconds,channel:{kind,to:{...to},start,end}});}
  private startRecall():void {if(this.state.channel)return;this.startChannel('recall',2,{x:this.unit.x,y:this.unit.y+1,z:this.unit.z});}
  private finishChannel(kind:ChannelKind,targetId:string|null,to:Readonly<Vec3>,start=0,end=0):void {if(kind==='recall'){if(this.locked())return;this.state.velX=this.state.velZ=0;this.state.dash=null;this.state.queued=null;this.setTarget(null);teleport(this.unit,this.services.query,this.services.definition.recall.position.x,this.services.definition.recall.position.z,this.services.definition.recall.yaw);this.services.emit({type:'recall',unit:this.unit.ref});}else this.services.completeChannel(this.unit.ref,{kind,targetId,to:{...to},start,end});}
  setTarget(target:SimUnit|null):void {if(sameRef(this.state.target,target?.ref??null))return;this.state.target=target?.ref??null;this.state.targetDeadAt=target&&!target.alive?this.services.time:0;this.services.emit({type:'target',unit:this.unit.ref,target:this.state.target});}
  startDash(target:SimUnit):void{this.state.dash={target:target.ref,t:0};this.state.velX=this.state.velZ=0;}
  private updateDash(dt:number):void {const g=this.services,s=this.state,u=this.unit,d=s.dash!,t=g.getUnit(d.target);if(!t){s.dash=null;u.lift=0;return;}d.t+=dt;const step=26*dt;u.yaw=yawTo(u.x,u.z,t.x,t.z);if(gapTo(u,t)<=.6+step||d.t>.9||!t.alive){s.dash=null;u.lift=0;g.emit({type:'ability',caster:u.ref,ability:'sideways-charge',stage:'hit',target:t.ref});s.nextSwing=Math.min(s.nextSwing,g.time+.1);return;}const k=step/Math.max(.001,distTo(u,t));u.x+=(t.x-u.x)*k;u.z+=(t.z-u.z)*k;u.lift=Math.sin(Math.min(1,d.t/.45)*Math.PI)*.25;}
  gainRage(amount:number):void{if(this.isRage)this.state.resource=Math.min(this.state.maxResource,this.state.resource+amount);}
  onHurt(damage:number):void {this.cancelDance(.12);if(this.isRage)this.gainRage(damage*.5);const c=this.state.cast;if(c){const ab=CLASSES[this.state.classId].abilities.find(a=>a.id===c.ability)!;if(ab.castTime>0)c.end=Math.min(c.end+.25,c.start+ab.castTime+.75);}}
  onWardHit(broken:boolean):void{if(!this.state.warded)return;if(broken){this.state.warded=false;this.unit.absorb=0;}this.services.emit({type:'ward',unit:this.unit.ref,stage:broken?'down':'hit'});}
  private dropWard():void {if(!this.state.warded)return;this.state.warded=false;this.services.emit({type:'ward',unit:this.unit.ref,stage:'down'});}
  onDeath():void {this.interruptCast();this.cancelChannel();this.cancelDance(0);this.state.queued=null;this.state.dash=null;this.state.deadUntil=this.services.time+3.6;}
  gainXp(amount:number):void {if(!Number.isFinite(amount)||amount<=0)return;const g=this.services,u=this.unit,s=this.state;s.xp=Math.min(Number.MAX_SAFE_INTEGER,s.xp+amount);g.emit({type:'xp',unit:u.ref,amount});const target=levelForXp(s.xp);if(target-u.level>10){const before=u.maxHp;this.restoreXp(s.xp);g.emit({type:'levelUp',unit:u.ref,level:u.level,oldMaxHp:before,maxHp:u.maxHp,jump:true});}else while(s.xp>=xpForLevel(u.level+1)){const before=u.maxHp;u.level++;this.updateLevelStats();g.emit({type:'levelUp',unit:u.ref,level:u.level,oldMaxHp:before,maxHp:u.maxHp,jump:false});}}
  restoreXp(xp:number):void {this.state.xp=Number.isFinite(xp)?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,xp)):0;this.unit.level=levelForXp(this.state.xp);this.updateLevelStats();}
  private updateLevelStats():void{const s=this.state,u=this.unit;u.maxHp=u.hp=Math.round(s.baseMaxHp*(1+.15*(u.level-1)));if(!this.isRage)s.maxResource=s.resource=120+20*(u.level-1);}
  respawn():void {
    const g=this.services,u=this.unit,s=this.state;this.cancelDance(0);g.cancelPendingHit(u.ref);g.stopAction(u.ref,undefined,0);
    s.unit=g.respawnUnit(u.ref);u.alive=true;u.hp=u.maxHp;u.hidden=false;s.resource=this.isRage?0:s.maxResource;s.cast=null;s.channel=null;s.dash=null;s.queued=null;s.deadUntil=null;
    u.stunUntil=u.slowUntil=u.rustUntil=0;u.rust=0;u.absorb=0;u.lift=0;u.pushTime=0;this.dropWard();s.velX=s.velZ=0;s.jumpT=s.spinT=0;u.lastCombat=-1e9;this.setTarget(null);
    const spawn=g.definition.spawn;teleport(u,g.query,spawn.position.x,spawn.position.z,spawn.yaw);g.emit({type:'respawn',unit:u.ref,position:{x:u.x,y:u.y,z:u.z},yaw:u.yaw});
  }
  private toggleDance():void {if(this.danceIndex>=0){this.cancelDance();return;}const u=this.unit,s=this.state;if(!u.alive||this.locked())return;if(this.inCombat)return this.error("You can't dance while in combat.");if(this.services.time<u.stunUntil)return this.error('You are stunned.');if(s.cast||s.channel||s.dash)return this.error('Another action is in progress.');if(s.jumpT>0||Math.hypot(s.velX,s.velZ)>.6)return this.error('Stand still to dance.');s.velX=s.velZ=0;this.danceIndex=0;this.danceTime=0;this.startDanceStep();this.services.emit({type:'dance',unit:u.ref,stage:'start'});}
  private startDanceStep():void {const step=BREAK_ROUTINE[this.danceIndex];playAction(this.services,this.unit,step.id,{from:step.from,to:step.to,speed:1,fade:step.fade,carryRoot:true});this.services.emit({type:'dance',unit:this.unit.ref,stage:'moment',moment:'step',move:step.id});}
  private updateDance(dt:number):void {if(this.danceIndex<0)return;const step=BREAK_ROUTINE[this.danceIndex],action=[...this.unit.actions].reverse().find(a=>a.targetWeight>0&&!a.ended);if(action&&action.id!==step.id){this.cancelDance();return;}const next=BREAK_ROUTINE[this.danceIndex+1],length=step.to-step.from;this.danceTime+=dt;if(this.danceTime>=length-(next?.fade??0)){this.danceIndex++;this.danceTime=dt;if(this.danceIndex>=BREAK_ROUTINE.length){this.danceIndex=-1;return;}this.startDanceStep();}}
  private cancelDance(fade=.25):void {if(this.danceIndex<0)return;this.services.stopAction(this.unit.ref,BREAK_ROUTINE[this.danceIndex].id,fade);this.danceIndex=-1;this.services.emit({type:'dance',unit:this.unit.ref,stage:'stop'});}
  error(reason:string):void{this.services.emit({type:'error',unit:this.unit.ref,reason});}
  debugState():object{return {held:this.heldIntent,lastConsumedSeq:this.lastConsumedSeq,footstep:this.footstep,danceIndex:this.danceIndex,danceTime:this.danceTime};}
}
export function createPlayer(services:AreaServices,unit:SimUnit,state:PlayerState):PlayerController{return new PlayerController(services,unit,state);}
