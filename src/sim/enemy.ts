import type { ActionId, ActionRequest, AreaServices, DebugValue, EnemySpawn, EntityRef, HitPlan, SimUnit, Vec3 } from './types.ts';
import { angleDiff, turnToward as turn, distXZ as distance } from './math.ts';
import { gapTo as gap, moveTo, speedMul, lineOfSight as unitLineOfSight } from './unit.ts';
export { angleDiff, turn, distance, gap, speedMul };
import { enemyStats, RESPAWN_CLEAR, type EnemyStats } from './data/enemies.ts';

export function moveCreature(s:AreaServices,u:SimUnit,x:number,z:number,dt:number):void{moveTo(u,s.query,x,z,dt);}
export function creatureAction(s:AreaServices,u:SimUnit,id:ActionId,opts:Partial<ActionRequest>={},hit?:HitPlan):void{
  const c=s.actionData.clip(id),skill=id==='attack_swipe'||id==='attack_slam';
  const from=skill?(c.events.window_from?.[0]??0)+.25:0;
  const to=c.events.window_to?.[0]??c.length;
  const request:ActionRequest={id,part:'move',upper:false,from,to,loopFrom:null,loop:false,speed:id==='attack_swipe'?1.25:id==='attack_slam'?1.2:1,fade:.12,carryRoot:false,...opts};
  const at=c.events.hit?.[0];
  s.startAction(u.ref,request,hit?{left:at===undefined?.3:Math.max(0,(at-request.from)/request.speed),plan:hit}:undefined);
}
export function creatureHitDelay(s:AreaServices,id:'attack_swipe'|'attack_slam',speed=id==='attack_swipe'?1.25:1.2):number{
  const hit=s.actionData.clip(id).events.hit?.[0];
  if(hit===undefined)throw new Error(`Missing canonical hit event: ${id}`);
  return Math.max(0,(hit-(s.actionData.clip(id).events.window_from?.[0]??0)-.25)/speed);
}
export const eligible=(s:AreaServices,p:SimUnit):boolean=>p.alive&&!p.hidden&&!s.player(p.ref)?.state.controlsLocked;
export function lineOfSight(s:AreaServices,a:SimUnit,b:SimUnit):boolean{return unitLineOfSight(s.query,a,b);}
export type EnemyState='idle'|'chase'|'leash'|'dead'|'gone';
export class Enemy {
  readonly services:AreaServices;readonly actor:SimUnit;readonly spawn:EnemySpawn;
  state:EnemyState='idle';stats:EnemyStats;pack:Enemy[]=[];
  seaCast:{id:number;x:number;y:number;z:number;until:number}|null=null;
  private nextSwing=0;private wanderAt=0;private wander:Vec3|null=null;private wanderSideways=false;
  private leapCd=0;private leap:{fromX:number;fromZ:number;toX:number;toZ:number;t:number}|null=null;
  private deadAt=0;private rise=0;private velX=0;private velZ=0;
  constructor(services:AreaServices,actor:SimUnit,spawn:EnemySpawn){
    this.services=services;this.actor=actor;this.spawn=structuredClone(spawn);this.stats=this.scaledStats();
    actor.level=this.stats.level;actor.hp=actor.maxHp=this.stats.hp;
    this.wanderAt=services.time+this.rand(1,6);this.leapCd=services.time+2;
  }
  get unit():EntityRef{return this.actor.ref;}get spawnId():string{return this.spawn.id;}
  get kind(){return this.spawn.kind;}get isAdd():boolean{return this.spawn.role==='add';}get isEcho():boolean{return this.spawn.role==='echo';}
  private rand(a:number,b:number){return a+(b-a)*this.services.random.next();}
  private scaledStats():EnemyStats{
    const s=this.services,players=s.players(),partyLevel=Math.max(1,...players.map(p=>p.level)),chapter=s.world==='w1'?1:s.world==='w2'?2:3;
    const rustCleared=players.some(p=>s.player(p.ref)?.state.flags.rustCleared===true);
    return enemyStats(this.kind,s.policy.enemyLevel(this.spawn,{partyLevel,rustCleared,chapter}),chapter,this.spawn.role);
  }
  onDamaged(source:EntityRef|null):void{if(this.state==='idle'&&source&&this.services.getUnit(source))this.aggro(true);}
  aggro(withPack:boolean):void{
    if(this.state!=='idle'||!this.actor.alive)return;this.state='chase';this.nextSwing=Math.max(this.nextSwing,this.services.time+.6);
    this.services.emit({type:'aggro',unit:this.unit});if(withPack)for(const e of this.pack)if(e!==this)e.aggro(false);
  }
  evade():void{if(this.state==='chase'){this.state='leash';this.actor.invulnerable=true;}}
  onDeath():void{this.state='dead';this.deadAt=this.services.time;this.leap=null;this.actor.lift=0;}
  despawn():void{this.state='gone';this.actor.alive=false;this.actor.hidden=true;this.leap=null;this.services.cancelPendingHit(this.unit);}
  respawnAt(x:number,z:number):void{
    const s=this.services,u=this.actor;this.stats=this.scaledStats();u.level=this.stats.level;u.maxHp=this.stats.hp;
    s.respawnUnit(this.unit);u.alive=true;u.hidden=false;u.hp=u.maxHp;u.invulnerable=false;u.stunUntil=u.slowUntil=0;u.lift=0;
    s.stopAction(this.unit,undefined,0);u.x=x;u.z=z;u.y=s.query.heightAt(x,z);u.yaw=this.rand(0,Math.PI*2);
    this.state='idle';this.rise=.6;this.leap=null;this.seaCast=null;s.emit({type:'spawn',unit:this.unit});
  }
  update(dt:number):void{
    const s=this.services,u=this.actor,now=s.time,p=s.targetFor(this.unit);
    if(this.state==='gone'||(this.isEcho&&s.world!=='w2'))return;
    if(this.state==='idle'&&u.hp>=u.maxHp&&(!p||distance(u,p)>20)){
      this.stats=this.scaledStats();u.level=this.stats.level;u.hp=u.maxHp=this.stats.hp;
    }
    if(this.state==='dead'){
      const t=now-this.deadAt;if(t>8&&!u.hidden){u.lift=-Math.min(1.4,(t-8)*.9)*u.height;u.y=s.query.heightAt(u.x,u.z)+u.lift;if(t>9.6)u.hidden=true;}
      const nearby=s.players().filter(p=>distance(p,this.spawn.home)<RESPAWN_CLEAR).length;
      const respawn=s.policy.enemyPopulation(this.spawn,nearby).respawnSeconds;
      if(!this.isAdd&&t>respawn&&nearby===0){const a=this.rand(0,Math.PI*2),r=this.kind==='jellyfish'?0:this.rand(0,this.spawn.wanderRadius*.7);this.respawnAt(this.spawn.home.x+Math.cos(a)*r,this.spawn.home.z+Math.sin(a)*r);}return;
    }
    if(this.rise>0){this.rise=Math.max(0,this.rise-dt);u.lift=-this.rise*1.3*u.height;}
    if(this.leap){this.updateLeap(dt);return;}
    const stunned=now<u.stunUntil;let tx=0,tz=0,speed=0,face:number|null=null;
    if(this.state==='idle'){
      if(p&&eligible(s,p)&&distance(u,p)<this.stats.aggro&&Math.abs(p.y-u.y)<3)this.aggro(true);
      if(now>this.wanderAt){this.wanderAt=now+this.rand(4,9);const a=this.rand(0,Math.PI*2),r=this.rand(0,this.spawn.wanderRadius);this.wander={x:this.spawn.home.x+Math.cos(a)*r,y:0,z:this.spawn.home.z+Math.sin(a)*r};this.wanderSideways=s.random.next()<.6;}
      if(this.wander){const dx=this.wander.x-u.x,dz=this.wander.z-u.z,d=Math.hypot(dx,dz);if(d<.4)this.wander=null;else{tx=dx/d;tz=dz/d;speed=1.3;face=Math.atan2(tx,tz)+(this.wanderSideways?Math.PI/2:0);}}
    }else if(this.state==='chase'){
      if(!p||!eligible(s,p)||(!this.isAdd&&distance(u,this.spawn.home)>this.stats.leash)){this.state='leash';u.invulnerable=true;s.emit({type:'leash',unit:this.unit});}
      else{const g=gap(u,p);face=Math.atan2(p.x-u.x,p.z-u.z);if(g>(this.kind==='jellyfish'?3.5:.9)){const d=distance(u,p)||1;tx=(p.x-u.x)/d;tz=(p.z-u.z)/d;speed=this.stats.speed;}
        if(this.kind==='jellyfish'&&!stunned&&g<5&&now>=this.nextSwing&&lineOfSight(s,p,u)){
          this.nextSwing=now+this.stats.swing;const at={x:p.x,y:Math.max(.2,s.query.heightAt(p.x,p.z)+.28),z:p.z};
          this.seaCast={id:(this.seaCast?.id??0)+1,...at,until:now+.9};s.emit({type:'attack',src:this.unit,attack:'enemy-sea-cast',stage:'start',target:p.ref,at});
          creatureAction(s,u,'attack_swipe',{upper:true},{attack:'enemy-sea-cast',source:this.unit,target:p.ref,at});
        }else if(this.kind==='scavenger'&&!stunned&&now>this.leapCd&&g>3.5&&g<10&&lineOfSight(s,p,u))this.startLeap(p);
        else if(this.kind!=='jellyfish'&&!stunned&&g<=1.15&&now>=this.nextSwing){this.nextSwing=now+this.stats.swing*this.rand(.9,1.1);creatureAction(s,u,'attack_swipe',{upper:true},{attack:'enemy-claw',source:this.unit,target:p.ref});}
      }
    }else if(this.state==='leash'){
      const dx=this.spawn.home.x-u.x,dz=this.spawn.home.z-u.z,d=Math.hypot(dx,dz);u.hp=Math.min(u.maxHp,u.hp+u.maxHp*.5*dt);
      if(d<1){this.state='idle';u.invulnerable=false;u.hp=u.maxHp;}else{tx=dx/d;tz=dz/d;speed=7;face=Math.atan2(tx,tz);}
    }
    speed=(stunned?0:speed)*speedMul(u,now);this.velX+=(tx*speed-this.velX)*(1-Math.exp(-10*dt));this.velZ+=(tz*speed-this.velZ)*(1-Math.exp(-10*dt));
    let nx=u.x+this.velX*dt,nz=u.z+this.velZ*dt;if(u.pushTime>0){u.pushTime-=dt;nx+=u.pushX*dt;nz+=u.pushZ*dt;}
    if(this.kind==='jellyfish'&&s.world==='w1'){
      const out={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};s.query.resolveCollision(nx,nz,u.radius,out);const depth=s.query.heightAt(out.x,out.y);
      if(depth>-.08||depth<-.95||Math.hypot(out.x-this.spawn.home.x,out.y-this.spawn.home.z)>this.stats.leash){nx=u.x;nz=u.z;if(this.state==='chase'){this.state='leash';u.invulnerable=true;}else if(this.state==='leash'){nx=this.spawn.home.x;nz=this.spawn.home.z;this.state='idle';u.invulnerable=false;u.hp=u.maxHp;this.velX=this.velZ=0;}this.wander=null;}
    }
    moveCreature(s,u,nx,nz,dt);if(face!==null&&!stunned)u.yaw=turn(u.yaw,face,7,dt);
  }
  private startLeap(p:SimUnit):void{
    const u=this.actor,d=distance(u,p)||1,back=(u.radius+p.radius+.2)/d;
    this.leap={fromX:u.x,fromZ:u.z,toX:p.x+(u.x-p.x)*back,toZ:p.z+(u.z-p.z)*back,t:0};this.leapCd=this.services.time+this.rand(7,9);u.yaw=Math.atan2(p.x-u.x,p.z-u.z);
    creatureAction(this.services,u,'jump',{fade:.06,from:.95,to:1.6,speed:.87});this.services.emit({type:'attack',src:this.unit,attack:'enemy-leap',stage:'start',target:p.ref});
  }
  private updateLeap(dt:number):void{
    const l=this.leap!,u=this.actor,s=this.services;l.t+=dt;const k=Math.min(1,l.t/.75);u.lift=Math.sin(k*Math.PI)*2.2;
    moveCreature(s,u,l.fromX+(l.toX-l.fromX)*k,l.fromZ+(l.toZ-l.fromZ)*k,dt);u.y=s.query.heightAt(u.x,u.z)+u.lift;
    if(k>=1){this.leap=null;u.lift=0;s.resolveHit({attack:'enemy-leap',source:this.unit});this.nextSwing=s.time+.8;}
  }
  resolveHit(plan:HitPlan):boolean{
    if(!['enemy-claw','enemy-sea-cast','enemy-leap'].includes(plan.attack))return false;
    const s=this.services,u=s.getUnit(plan.source);if(!u||u!==this.actor||!u.alive)return true;
    const p=plan.attack==='enemy-leap'?s.targetFor(this.unit):'target'in plan?s.getUnit(plan.target):null;if(!p||!p.alive)return true;
    if(plan.attack==='enemy-claw'){if(gap(u,p)>2)return true;s.combat.damage(this.unit,p.ref,this.rand(...this.stats.dmg));}
    else if(plan.attack==='enemy-sea-cast'){if(s.time<u.stunUntil||s.world!=='w1'||distance(u,p)>9)return true;s.emit({type:'attack',src:this.unit,attack:plan.attack,stage:'hit',target:p.ref,at:{...plan.at}});if(distance(p,plan.at)<1.7)s.combat.damage(this.unit,p.ref,this.rand(...this.stats.dmg));return true;}
    else{if(gap(u,p)<1.6)s.combat.damage(this.unit,p.ref,this.rand(8,11));}
    s.emit({type:'attack',src:this.unit,attack:plan.attack,stage:'hit',target:p.ref,at:plan.attack==='enemy-leap'?{x:u.x,y:u.y,z:u.z}:undefined});return true;
  }
  debugState():DebugValue{return structuredClone({unit:this.unit,spawnId:this.spawnId,state:this.state,stats:this.stats,seaCast:this.seaCast,nextSwing:this.nextSwing,wanderAt:this.wanderAt,wander:this.wander,wanderSideways:this.wanderSideways,leapCd:this.leapCd,leap:this.leap,deadAt:this.deadAt,rise:this.rise,velX:this.velX,velZ:this.velZ,pack:this.pack.map(e=>e.spawnId)}) as unknown as DebugValue;}
}
