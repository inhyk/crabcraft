import type { AreaServices, DebugValue, EnemySim, EntityRef, HitPlan, ImpactShape, MechId, Poi, SimUnit, TelegraphShape, Vec3 } from './types.ts';
import { BOSS_PROFILES, mechanicFraction, mechanicOrder, mechanicRadius, type BossProfileId } from './data/bosses.ts';
import { angleDiff, creatureAction, creatureHitDelay, distance, eligible, gap, moveCreature, speedMul, turn } from './enemy.ts';
export const BOSS_HP=1300;
export type BossState='dormant'|'waking'|'idle'|'fight'|'dying'|'dead';
interface ActiveMech {kind:MechId;t:number;dur:number;at:Vec3;yaw:number;fired:boolean;swung:boolean}
const pos=(u:Readonly<Vec3>):Vec3=>({x:u.x,y:u.y,z:u.z});
export class Boss {
  readonly services:AreaServices;readonly actor:SimUnit;readonly arena:Poi;readonly freed:SimUnit;readonly profile:BossProfileId;
  state:BossState='dormant';phase=1;enraged=false;readonly adds:EnemySim[]=[];
  private nextSwing=0;private nextMech=0;private mechIndex=0;private mech:ActiveMech|null=null;private stateT=0;
  private freedStarted=false;private outside=0;private freedT=-1;private freedYaw=0;
  constructor(services:AreaServices,actor:SimUnit,arena:Poi,freed:SimUnit,profile:BossProfileId='rust'){
    this.services=services;this.actor=actor;this.arena=structuredClone(arena);this.freed=freed;this.profile=profile;
    actor.level=this.stats.level;actor.hp=actor.maxHp=this.stats.hp;actor.invulnerable=true;actor.hidden=true;actor.targetable=false;
    freed.hidden=true;freed.targetable=false;
  }
  get unit():EntityRef{return this.actor.ref;}get stats(){return BOSS_PROFILES[this.profile];}get isDawn():boolean{return this.profile==='dawn';}
  get engaged():boolean{return this.state==='fight';}get telegraphActive():boolean{return !!this.mech&&!this.mech.fired;}
  get mechName():MechId|null{return this.mech?.kind??null;}get stateTime():number{return this.stateT;}get freedTime():number{return this.freedT;}
  private participants():readonly SimUnit[]{return this.services.players().filter(p=>!this.isDawn||p.level>=100);}
  private target():SimUnit|null{
    if(!this.isDawn)return this.services.targetFor(this.unit);
    return this.participants().filter(p=>eligible(this.services,p)).slice().sort((a,b)=>distance(this.actor,a)-distance(this.actor,b)||a.ref.id-b.ref.id)[0]??null;
  }
  private unlocked():boolean{return this.participants().some(p=>p.level>=this.stats.level);}
  private available():boolean{return this.services.bossAvailable(this.profile);}
  private yell(key:string,unit=this.unit,yell=true):void{this.services.emit({type:'say',unit,textKey:key,yell});}
  wake():void{
    if(this.state!=='dormant'||!this.available()||(this.isDawn&&!this.unlocked()))return;
    const u=this.actor,s=this.services;this.state='waking';this.stateT=0;u.hidden=false;u.x=this.arena.position.x;u.z=this.arena.position.z;u.y=s.query.heightAt(u.x,u.z);u.yaw=this.arena.yaw;u.lift=-u.height;
  }
  onDamaged(source:EntityRef|null):void{if(this.state==='idle'&&source&&this.services.getUnit(source)&&this.unlocked())this.engage();}
  private engage():void{
    if(!this.available()||!this.unlocked())return;this.state='fight';for(const p of this.participants())p.encounterBlessing=true;
    this.nextSwing=this.services.time+1.2;this.nextMech=this.services.time+4;this.yell(`boss.${this.profile}.engage`);this.services.emit({type:'boss',boss:this.unit,stage:'engage'});
  }
  sleep():void{if(this.state==='dead'||this.state==='dying')return;this.reset();this.state='dormant';this.actor.hidden=true;this.actor.invulnerable=true;this.actor.targetable=false;this.services.cancelPendingHit(this.unit);this.services.stopAction(this.unit,undefined,.2);}
  reset():void{
    if(this.state==='dormant'||this.state==='dead'||this.state==='dying')return;const s=this.services,u=this.actor;
    this.clearMech();for(const a of this.adds)a.despawn();this.adds.length=0;
    u.hp=u.maxHp;u.alive=true;u.stunUntil=u.slowUntil=0;this.phase=1;this.enraged=false;s.stopAction(this.unit,undefined,.2);
    u.x=this.arena.position.x;u.z=this.arena.position.z;u.y=s.query.heightAt(u.x,u.z);u.yaw=this.arena.yaw;u.lift=0;
    this.state='idle';this.outside=0;this.mechIndex=0;s.cancelPendingHit(this.unit);s.emit({type:'boss',boss:this.unit,stage:'reset'});
  }
  onDeath():void{
    if(this.state==='dying'||this.state==='dead')return;
    this.state='dying';this.stateT=0;this.clearMech();for(const a of this.adds){const u=this.services.getUnit(a.unit);if(u?.alive)this.services.combat.kill(a.unit,null);}
    this.yell(`boss.${this.profile}.death`);this.services.emit({type:'boss',boss:this.unit,stage:'death'});this.actor.targetable=false;
  }
  update(dt:number):void{
    const s=this.services,u=this.actor,p=this.target(),now=s.time;this.stateT+=dt;const unlocked=this.unlocked();u.invulnerable=!unlocked;
    if(this.state==='idle')u.targetable=unlocked;
    if(this.state==='dormant'||this.state==='dead'){this.updateFreed(dt);return;}
    if(this.state==='waking'){
      const k=Math.min(1,this.stateT/2.4);u.lift=-u.height*(1-k)*(1-k);u.y=s.query.heightAt(u.x,u.z)+u.lift;
      if(k>=1){u.lift=0;this.state='idle';u.targetable=unlocked;creatureAction(s,u,'attack_slam');this.yell(`boss.${this.profile}.awake`);s.emit({type:'boss',boss:this.unit,stage:'awake'});}return;
    }
    if(this.state==='idle'){
      if(unlocked&&p&&eligible(s,p)&&distance(p,this.arena.position)<this.arena.radius*.9)this.engage();
      u.yaw=turn(u.yaw,p?.alive?Math.atan2(p.x-u.x,p.z-u.z):this.arena.yaw,.8,dt);return;
    }
    if(this.state==='dying'){this.updateDeath(dt);return;}
    if(!p||!eligible(s,p)){this.reset();return;}
    const fromArena=distance(p,this.arena.position);this.outside=fromArena>this.arena.radius+30?this.outside+dt:0;
    if(this.outside>4){this.yell('boss.leash');this.reset();return;}
    const frac=u.hp/u.maxHp;if(this.phase===1&&frac<(this.isDawn?.75:.6))this.enterPhase2();if(this.phase===2&&frac<(this.isDawn?.4:.25))this.enterPhase3();
    const stunned=!this.isDawn&&now<u.stunUntil;
    if(this.mech)this.updateMech(dt);
    else if(!stunned){
      const g=gap(u,p),want=Math.atan2(p.x-u.x,p.z-u.z);u.yaw=turn(u.yaw,want,this.enraged?3:2.2,dt);
      if(g>1){const speed=this.isDawn?(this.enraged?4.2:3.4):(this.enraged?2.8:2)*speedMul(u,now),d=distance(u,p)||1;moveCreature(s,u,u.x+(p.x-u.x)/d*speed*dt,u.z+(p.z-u.z)/d*speed*dt,dt);}
      if(g<=1.6&&now>=this.nextSwing&&Math.abs(angleDiff(want,u.yaw))<.8){this.nextSwing=now+(this.isDawn?(this.enraged?1.3:1.8):(this.enraged?1.8:2.6));creatureAction(s,u,'attack_swipe',{upper:true,speed:this.enraged?1.4:1},{attack:'boss-claw',source:this.unit,target:p.ref});}
      if(now>=this.nextMech)this.startMech();
    }
  }
  private enterPhase2():void{
    this.phase=2;this.yell(`boss.${this.profile}.phase2`);this.services.emit({type:'boss',boss:this.unit,stage:'phase',phase:2});
    for(let i=0;i<(this.profile==='rust'?3:0);i++){const a=this.actor.yaw+Math.PI+(i-1)*.9,r=this.actor.radius+3.5,add=this.services.spawnAdd(this.unit,this.actor.x+Math.sin(a)*r,this.actor.z+Math.cos(a)*r);if(add)this.adds.push(add);}
    this.mechIndex=0;this.nextMech=this.services.time+3;
  }
  private enterPhase3():void{this.phase=3;this.enraged=true;this.yell(`boss.${this.profile}.phase3`);this.services.emit({type:'boss',boss:this.unit,stage:'phase',phase:3});this.nextMech=this.services.time+2.5;}
  private startMech():void{
    const p=this.target();if(!p)return;const s=this.services,u=this.actor,order=mechanicOrder(this.profile,this.phase),kind=order[this.mechIndex++%order.length];
    const m:ActiveMech={kind,t:0,dur:1.5,at:pos(u),yaw:u.yaw,fired:false,swung:false},speedUp=(this.enraged?.8:1)*this.stats.tempo;
    if(kind==='slam'){m.dur=1.5*speedUp;m.at=pos(p);}
    else if(kind==='spray'){m.dur=1.1*speedUp;m.yaw=Math.atan2(p.x-u.x,p.z-u.z);u.yaw=m.yaw;}
    else if(kind==='eclipse')m.dur=2.8*speedUp;
    else if(kind==='nova'){m.dur=2.2*speedUp;if(this.stats.level>=20)m.dur=Math.max(m.dur,1.9);m.at=pos(p);}
    else if(kind==='cross'){m.dur=Math.max(2.6,3.1*speedUp);m.yaw=Math.atan2(p.x-u.x,p.z-u.z);}
    else if(kind==='barrage'){m.dur=Math.max(2.6,3*speedUp);m.at=pos(p);m.yaw=Math.atan2(p.x-u.x,p.z-u.z);}
    else{m.dur=2.6;this.yell('boss.undertow');}
    if(this.isDawn)m.dur=Math.max(m.dur,kind==='nova'?2.4:kind==='eclipse'?2.8:kind==='undertow'?3:kind==='slam'?1.6:1.3);
    const shapes=this.telegraphShapes(kind,m.at,m.yaw);this.mech=m;s.emit({type:'telegraph',src:this.unit,mech:kind,level:this.stats.level,seconds:m.dur,shapes});
    this.nextMech=s.time+m.dur+(this.isDawn?(this.phase===3?.9:this.phase===2?1.2:1.8):(this.phase===3?4.2:this.phase===2?5.5:6));
  }
  private radius(kind:MechId){return mechanicRadius(this.isDawn,kind);}
  private get laneLength(){return this.isDawn?15:12;}private get laneWidth(){return this.isDawn?1.4:1.8;}
  private get barrageRadius(){return this.isDawn?3:2.6;}private get innerRadius(){return this.isDawn?3:4.5;}
  private crossAngles(yaw:number):number[]{return this.isDawn?[yaw,yaw+Math.PI/4,yaw+Math.PI/2,yaw+3*Math.PI/4]:[yaw,yaw+Math.PI/2];}
  private barragePoints(at:Vec3,yaw:number):Vec3[]{const points=this.isDawn?[[0,0],[6,0],[-6,0],[0,6],[0,-6]]:[[-6,0],[0,0],[6,0]];return points.map(([x,z])=>({x:at.x+x*Math.cos(yaw)+z*Math.sin(yaw),y:at.y,z:at.z-x*Math.sin(yaw)+z*Math.cos(yaw)}));}
  private telegraphShapes(kind:MechId,at:Vec3,yaw:number):TelegraphShape[]{
    if(kind==='cross')return this.crossAngles(yaw).map(a=>({shape:'lane',at:pos(at),yaw:a,halfLength:this.laneLength,halfWidth:this.laneWidth,color:'#ffb64d'}));
    if(kind==='barrage')return this.barragePoints(at,yaw).map(p=>{const ground=this.deckUnder(p,this.barrageRadius,0,Math.PI);return {shape:'circle',at:pos(p),radius:this.barrageRadius,color:'#cf8aff',ground};});
    if(kind==='spray'){const ground=this.deckUnder(at,11,yaw,.55);return [{shape:'cone',at:pos(at),yaw,range:11,half:.55,ground}];}
    const radius=this.radius(kind),color=kind==='eclipse'?'#a050ff':kind==='nova'?this.stats.color:undefined,ground=this.deckUnder(at,radius,0,Math.PI);
    const shapes:TelegraphShape[]=[{shape:'circle',at:pos(at),radius,color,ground}];
    if(kind==='eclipse')shapes.push({shape:'circle',at:pos(at),radius:this.innerRadius,color:'#71ffca',ground:this.deckUnder(at,this.innerRadius,0,Math.PI)});
    if(kind==='undertow')shapes.push({shape:'undertow',at:pos(at),radius});return shapes;
  }
  private deckUnder(at:Vec3,reach:number,yaw:number,half:number):Vec3{
    const cone=half<3,r=reach*(cone?.85:.7),put=(a:number,d:number):Vec3=>{const x=at.x+Math.sin(a)*d,z=at.z+Math.cos(a)*d;return {x,y:this.services.query.heightAt(x,z),z};};
    const a=put(cone?yaw:0,cone?0:r),b=put(cone?yaw-half*.8:2*Math.PI/3,r),c=put(cone?yaw+half*.8:4*Math.PI/3,r),gy=this.services.query.heightAt(at.x,at.z);
    at.y=cone?gy:(a.y+b.y+c.y)/3;if(Math.abs(at.y-gy)>.5)at.y=gy;
    const bx=b.x-a.x,by=b.y-a.y,bz=b.z-a.z,cx=c.x-a.x,cy=c.y-a.y,cz=c.z-a.z;
    let x=by*cz-bz*cy,y=bz*cx-bx*cz,z=bx*cy-by*cx,n=Math.hypot(x,y,z);if(n===0)return {x:0,y:1,z:0};x/=n;y/=n;z/=n;if(y<0){x=-x;y=-y;z=-z;}
    if(y<.985){n=Math.hypot(x,z);const k=n>0?Math.sqrt(1-.985*.985)/n:0;x*=k;z*=k;y=.985;}return {x,y,z};
  }
  private updateMech(dt:number):void{
    const m=this.mech!,s=this.services,u=this.actor;m.t+=dt;
    if(m.kind==='slam')u.yaw=turn(u.yaw,Math.atan2(m.at.x-u.x,m.at.z-u.z),3,dt);
    const lead=creatureHitDelay(s,m.kind==='spray'?'attack_swipe':'attack_slam');
    if(!m.swung&&m.t>m.dur-lead){m.swung=true;creatureAction(s,u,m.kind==='spray'?'attack_swipe':'attack_slam',m.kind==='spray'?{upper:true}:{speed:1.2});if(m.kind==='spray')s.emit({type:'impact',src:this.unit,mech:'spray',shapes:this.impactShapes('spray',m.at,m.yaw),loud:false});}
    if(m.kind==='undertow')for(const p of this.participants())if(p.alive&&m.t<m.dur-.3){const d=distance(u,p);if(d<18&&d>u.radius+p.radius+.3){p.pushX=(u.x-p.x)/d*3.2;p.pushZ=(u.z-p.z)/d*3.2;p.pushTime=.05;}}
    if(m.t<m.dur)return;m.fired=true;if(m.kind!=='spray')s.emit({type:'impact',src:this.unit,mech:m.kind,shapes:this.impactShapes(m.kind,m.at,m.yaw),loud:true});
    const points=m.kind==='barrage'?this.barragePoints(m.at,m.yaw):[];
    for(const p of this.participants()){
      if(!p.alive)continue;const d=distance(p,m.at),dx=p.x-m.at.x,dz=p.z-m.at.z;
      let hit=false;
      if(m.kind==='spray'){const a=Math.atan2(dx,dz);hit=d<11+p.radius&&Math.abs(angleDiff(a,m.yaw))<.55+Math.atan2(p.radius,Math.max(1,d));}
      else if(m.kind==='eclipse')hit=d>this.innerRadius&&d<this.radius('eclipse')+p.radius*.5;
      else if(m.kind==='cross')hit=this.crossAngles(m.yaw).some(a=>Math.abs(dx*Math.cos(a)-dz*Math.sin(a))<this.laneWidth+p.radius*.5&&Math.abs(dx*Math.sin(a)+dz*Math.cos(a))<this.laneLength);
      else if(m.kind==='barrage')hit=points.some(at=>distance(p,at)<this.barrageRadius+p.radius*.5);
      else hit=(m.kind==='undertow'?distance(u,p):d)<this.radius(m.kind)+p.radius*.5;
      if(!hit)continue;
      const damage=m.kind==='spray'?(6+3*s.random.next())*this.stats.damage:p.maxHp*mechanicFraction(this.isDawn,m.kind);
      s.combat.damage(this.unit,p.ref,damage);
      if(m.kind==='slam')p.stunUntil=Math.max(p.stunUntil,s.time+.5);
      if(m.kind==='spray'){p.rust=Math.min(5,(s.time<p.rustUntil?p.rust:0)+1);p.rustUntil=s.time+10;s.emit({type:'buff',unit:p.ref,buff:'rust',stacks:p.rust});}
    }
    this.mech=null;s.emit({type:'telegraphEnd',src:this.unit,cancelled:false});
  }
  private impactShapes(kind:MechId,at:Vec3,yaw:number):ImpactShape[]{
    if(kind==='cross')return this.crossAngles(yaw).map(a=>({fx:'lane',at:pos(at),yaw:a,halfLength:this.laneLength,halfWidth:this.laneWidth,seconds:.4,color:'#ffd390'}));
    if(kind==='barrage')return this.barragePoints(at,yaw).map(p=>({fx:'slam',at:{x:p.x,y:this.services.query.heightAt(p.x,p.z),z:p.z},radius:this.barrageRadius}));
    if(kind==='spray')return [{fx:'spray',at:pos(at),yaw,range:11,half:.55}];
    if(kind==='eclipse')return [{fx:'ring',at:pos(at),color:'#b577ff',r0:this.radius(kind),r1:this.innerRadius,seconds:.8,inner:.9}];
    const shapes:ImpactShape[]=[];if(kind==='nova')shapes.push({fx:'ring',at:pos(at),color:this.stats.color,r0:.5,r1:this.radius(kind)+1,seconds:.6,inner:.85},{fx:'ring',at:pos(at),color:this.stats.color,r0:1,r1:this.radius(kind),seconds:.8,inner:.7});shapes.push({fx:'slam',at:pos(at),radius:this.radius(kind)});return shapes;
  }
  private clearMech():void{this.mech=null;this.services.emit({type:'telegraphEnd',src:this.unit,cancelled:true});}
  resolveHit(plan:HitPlan):boolean{
    if(plan.attack!=='boss-claw')return false;const s=this.services,u=s.getUnit(plan.source),p=s.getUnit(plan.target);
    if(u===this.actor&&u.alive&&p?.alive&&(!this.isDawn||p.level>=100)&&gap(u,p)<=2.4){s.combat.damage(this.unit,p.ref,(7+3*s.random.next())*this.stats.damage*(this.enraged?1.25:1));s.emit({type:'attack',src:this.unit,attack:'boss-claw',stage:'hit',target:p.ref});}return true;
  }
  private updateDeath(dt:number):void{
    const t=this.stateT,u=this.actor,s=this.services;if(t>2.2&&!this.freedStarted){this.freedStarted=true;this.releaseFreed();}
    if(t>6){u.lift=-Math.min(1,(t-6)/4)*u.height*.7;u.y=s.query.heightAt(u.x,u.z)+u.lift;}
    if(t>10.5){u.hidden=true;this.state='dead';this.stateT=0;}this.updateFreed(dt);
  }
  private releaseFreed():void{
    const s=this.services,f=this.freed,u=this.actor,p=this.target(),toward=p?Math.atan2(p.x-u.x,p.z-u.z):u.yaw;
    f.hidden=false;f.alive=true;f.x=u.x;f.z=u.z;f.y=s.query.heightAt(f.x,f.z);f.yaw=toward;this.freedT=0;this.freedYaw=toward;s.emit({type:'freed',unit:f.ref});
  }
  private updateFreed(dt:number):void{
    if(this.freedT<0)return;const s=this.services,f=this.freed,u=this.actor,p=this.target();this.freedT+=dt;const t=this.freedT;
    if(t<1.2){const k=t/1.2,out=u.radius+1.6;moveCreature(s,f,u.x+Math.sin(this.freedYaw)*out*k,u.z+Math.cos(this.freedYaw)*out*k,dt);}
    else if(t<1.6){if(p)f.yaw=turn(f.yaw,Math.atan2(p.x-f.x,p.z-f.z),6,dt);}
    else if(t<4.6){if(!f.npcId){f.npcId='bowed';creatureAction(s,f,'gesture_bow');this.yell('boss.freed.thanks',f.ref,false);}}
    else if(t<12){const spawn=s.definition.spawn.position,wreck=s.definition.pois.wreck?.position??spawn,dx=wreck.x-spawn.x,dz=wreck.z-spawn.z,d=Math.hypot(dx,dz),x=d?dx/d:0,z=d?dz/d:0;f.yaw=turn(f.yaw,Math.atan2(x,z)+Math.PI/2,4,dt);moveCreature(s,f,f.x+x*3.4*dt,f.z+z*3.4*dt,dt);if(t>10.5)f.lift=-(t-10.5)*.8;}
    else{f.hidden=true;f.alive=false;this.freedT=-1;}
  }
  debugState():DebugValue{return structuredClone({unit:this.unit,profile:this.profile,state:this.state,phase:this.phase,enraged:this.enraged,adds:this.adds.map(a=>a.unit),nextSwing:this.nextSwing,nextMech:this.nextMech,mechIndex:this.mechIndex,mech:this.mech,stateT:this.stateT,freedStarted:this.freedStarted,outside:this.outside,freedT:this.freedT,freedYaw:this.freedYaw}) as unknown as DebugValue;}
}
