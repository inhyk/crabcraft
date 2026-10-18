import type { ActionId, ActionRequest, Admission, Area as AreaContract, AreaContext, AreaDebugState, AreaOptions, AreaServices, AreaSnapshot, BossSim, CharacterId, ClassId, CombatController, DebugValue, EarnedGrant, EnemySim, EntityId, EntityRef, HitPlan, PendingHit, PlayerIntent, PlayerSim, ProjectileState, SimUnit, StagedArrival, StagedDeparture, TimerAction, TransferDTO } from './types.ts';
import { Actions } from './actions.ts';
import { Combat } from './combat.ts';
import { resolvePlayerHit } from './abilities.ts';
import { Enemy } from './enemy.ts';
import { Boss } from './boss.ts';
import { copyValue, Events, immutable, sameRef } from './events.ts';
import { PlayerController, createPlayer, createPlayerState } from './player.ts';
import { Projectiles } from './projectiles.ts';
import { Ids, Random } from './random.ts';
import { Timers } from './timers.ts';
import { createUnit, feedLocomotion, teleport } from './unit.ts';
import { advanceNumericPose } from './pose.ts';
import { WorldRules } from './outcomes.ts';
import { captureTransfer, restoreTransfer } from './transfer.ts';
import { freshQuests, setQuestChapter } from './data/quests.ts';

const DT = 1 / 30;
const MAX_PLAYERS = 100;
interface Arrival { token:string; admission:Admission; unit:SimUnit; player:PlayerController; dto:TransferDTO }
/** One independently owned, fixed-step authority. Query/provider inputs are pure services. */
export class SimulationArea implements AreaContract {
  readonly services:AreaServices;
  private unitMap=new Map<EntityId,SimUnit>();
  private playerMap=new Map<EntityId,PlayerController>();
  private enemyMap=new Map<EntityId,Enemy>();
  private bossMap=new Map<EntityId,Boss>();
  private controllerMap=new Map<EntityId,CombatController>();
  private clock=0;
  private stepId=0;
  private context:AreaContext;
  private options:AreaOptions;
  private ids=new Ids();
  private tokenIds=new Ids();
  private rng:Random;
  private events:Events;
  private actions:Actions;
  private flights:Projectiles;
  readonly timers:Timers;
  private combat:Combat;
  private worldRules:WorldRules;
  private running=false;
  private disposed=false;
  private failed=false;
  private reservations=new Map<string,Admission>();
  private departures=new Map<string,StagedDeparture>();
  private nextEcho=45;
  private arrivals=new Map<string,Arrival>();
  get units():ReadonlyMap<EntityId,SimUnit>{return this.unitMap;}
  get players():ReadonlyMap<EntityId,PlayerSim>{return this.playerMap;}
  get enemies():ReadonlyMap<EntityId,EnemySim>{return this.enemyMap;}
  get bosses():ReadonlyMap<EntityId,BossSim>{return this.bossMap;}
  get projectiles():ReadonlyMap<number,ProjectileState>{return this.flights.states;}
  constructor(options:AreaOptions){
    if(!options.id)throw new Error('Area instance ID required');
    for(const n of Object.values(options.limits))if(!Number.isSafeInteger(n)||n<0)throw new RangeError('Invalid area limit');
    this.options={...options,definition:immutable(options.definition),limits:immutable(options.limits)};
    this.context=immutable({...options.context,members:[]});
    if(options.context.members.length)throw new Error('Attach actors before supplying membership');
    this.rng=new Random(options.seed);this.events=new Events(options.limits.eventCount);this.timers=new Timers(options.limits.timers);
    const self=this;
    this.services={
      id:options.id,world:options.definition.world,query:options.query,actionData:options.actionData,definition:this.options.definition,policy:options.policy,random:this.rng,ids:this.ids,timers:this.timers,
      get time(){return self.clock;},get tick(){return self.stepId;},get context(){return self.context;},get combat(){return self.combat;},
      getUnit:ref=>this.getUnit(ref),controller:ref=>this.getUnit(ref)?this.controllerMap.get(ref.id)??null:null,
      player:ref=>this.getUnit(ref)?this.playerMap.get(ref.id)??null:null,
      npcById:id=>[...this.unitMap.values()].find(u=>u.npcId===id)??null,
      playerByCharacter:character=>[...this.playerMap.values()].find(p=>p.state.character===character)??null,
      players:()=>[...this.playerMap.values()].map(p=>this.unitMap.get(p.state.unit.id)!),
      targetFor:ref=>this.targetFor(ref),hostilesNear:(x,z,r)=>[...this.unitMap.values()].filter(u=>u.alive&&!u.hidden&&u.reaction==='hostile'&&Math.hypot(u.x-x,u.z-z)-u.radius<=r),
      emit:event=>this.events.emit(this.stepId,event),outcomeTransaction:run=>this.events.transaction(run),
      startAction:(ref,action,hit)=>this.startAction(ref,action,hit),stopAction:(ref,id,fade)=>this.stopAction(ref,id,fade),
      cancelPendingHit:ref=>{const u=this.getUnit(ref);if(u)u.pendingHit=null;},resolveHit:plan=>this.resolveHit(plan),
      launch:input=>this.flights.launch(input,this.stepId),spawnAdd:(boss,x,z)=>this.spawnAdd(boss,x,z),
      respawnUnit:ref=>this.respawnUnit(ref),bossAvailable:profile=>this.worldRules.encounterAvailable(profile),
      runCommand:(ref,command)=>this.worldRules.command(ref,command),bossByProfile:profile=>[...this.bossMap.values()].find(b=>b.profile===profile)??null,
      encounterActive:()=>[...this.bossMap.values()].some(b=>b.engaged),
      completeChannel:(ref,ch)=>{const p=this.services.player(ref);if(p)this.worldRules.completeChannel(p,ch);},
      recordContribution:(victim,attacker,damage)=>this.worldRules.recordContribution(victim,attacker,damage),
      onUnitDied:(victim,killer)=>this.worldRules.onUnitDied(victim,killer),applyEarnedGrant:grant=>this.worldRules.applyGrant(grant),
    };
    this.combat=new Combat(this.services);this.worldRules=new WorldRules(this.services);
    this.actions=new Actions(options.actionData,e=>this.services.emit(e),p=>this.resolveHit(p));
    this.flights=new Projectiles(options.limits.projectiles,r=>this.getUnit(r),e=>this.services.emit(e),p=>this.resolveHit(p));
    this.populate();
  }
  private boundary():void {if(this.disposed)throw new Error('Area disposed');if(this.failed)throw new Error('Area failed; host must retire it');if(this.running)throw new Error('Requires between-tick boundary');}
  private getUnit(ref:EntityRef):SimUnit|null {if(!ref||ref.area!==this.services.id)return null;const u=this.unitMap.get(ref.id);return u&&sameRef(u.ref,ref)?u:null;}
  private makeUnit(archetype:string,kind:SimUnit['kind'],reaction:SimUnit['reaction'],position:{x:number;y:number;z:number}):SimUnit {const unit=createUnit({area:this.services.id,id:this.ids.next(),life:1},archetype,kind,reaction,this.options.actionData,position);teleport(unit,this.options.query,position.x,position.z);return unit;}
  private populate():void {
    for(const n of this.options.definition.npcs){const u=this.makeUnit('human','npc','friendly',n.position);u.npcId=n.id;u.yaw=n.yaw;this.unitMap.set(u.ref.id,u);}
    for(const spawn of this.options.definition.enemies){const u=this.makeUnit(spawn.kind,spawn.kind,'hostile',spawn.home);this.unitMap.set(u.ref.id,u);const e=new Enemy(this.services,u,spawn);this.enemyMap.set(u.ref.id,e);this.controllerMap.set(u.ref.id,e);if(spawn.role!=='ordinary')e.despawn();}
    for(const e of this.enemyMap.values())e.pack=[...this.enemyMap.values()].filter(other=>this.options.definition.enemies.find(s=>s.id===other.spawnId)?.pack===this.options.definition.enemies.find(s=>s.id===e.spawnId)?.pack);
    for(const config of this.options.definition.bosses){const freed=this.makeUnit('human','freed','friendly',config.arena.position);freed.npcId=config.freedNpcId;freed.hidden=true;freed.targetable=false;this.unitMap.set(freed.ref.id,freed);const u=this.makeUnit(`boss-${config.profile}`,'boss','hostile',config.arena.position);u.yaw=config.arena.yaw;this.unitMap.set(u.ref.id,u);const b=new Boss(this.services,u,config.arena,freed,config.profile);this.bossMap.set(u.ref.id,b);this.controllerMap.set(u.ref.id,b);}
  }
  private targetFor(ref:EntityRef):SimUnit|null {const source=this.getUnit(ref);if(!source)return null;let best:SimUnit|null=null,distance=Infinity;for(const p of this.playerMap.values()){const u=this.getUnit(p.state.unit)!;if(!u.alive||u.hidden||!u.targetable)continue;const d=Math.hypot(source.x-u.x,source.z-u.z);if(d<distance){best=u;distance=d;}}return best;}
  private startAction(ref:EntityRef,request:ActionRequest,hit?:PendingHit):void {const u=this.getUnit(ref);if(u)this.actions.play(u,request,hit);}
  private stopAction(ref:EntityRef,id?:ActionId,fade?:number):void {const u=this.getUnit(ref);if(u)this.actions.stop(u,id,fade);}
  private resolveHit(plan:HitPlan):void {if(!this.getUnit(plan.source))return;if('target' in plan&&!this.getUnit(plan.target))return;const e=this.enemyMap.get(plan.source.id),b=this.bossMap.get(plan.source.id);if(e?.resolveHit(plan)||b?.resolveHit(plan))return;if(!resolvePlayerHit(this.services,plan))throw new Error(`Unhandled hit ${plan.attack}`);}
  private spawnAdd(boss:EntityRef,x:number,z:number):EnemySim|null {
    if(!this.bossMap.has(boss.id)||!this.getUnit(boss))return null;
    const pool=[...this.enemyMap.values()].filter(e=>e.spawn.pack===`boss:${boss.id}`);
    let e=pool.find(e=>e.state==='gone'||e.state==='dead');
    if(!e){if(pool.length>=3)return null;const u=this.makeUnit('scrapling','scrapling','hostile',{x,y:this.options.query.heightAt(x,z),z});const spawn={id:`${boss.id}:add:${pool.length}`,kind:'scrapling' as const,home:{x,y:u.y,z},wanderRadius:1,pack:`boss:${boss.id}`,fixedLevel:1,role:'add' as const};this.unitMap.set(u.ref.id,u);e=new Enemy(this.services,u,spawn);this.enemyMap.set(u.ref.id,e);this.controllerMap.set(u.ref.id,e);}
    e.respawnAt(x,z);e.aggro(false);return e;
  }
  private respawnUnit(ref:EntityRef):EntityRef {const u=this.getUnit(ref);if(!u)throw new Error('Stale respawn');if(ref.life>=0xffffffff)throw new RangeError('Life exhausted');const next=immutable({...ref,life:ref.life+1});const p=this.playerMap.get(ref.id);if(p&&this.options.characters&&!this.options.characters.compareAndSwap(p.state.character,ref,next))throw new Error('Character registry mismatch');this.purgeReferences(ref);u.ref=next;if(p)p.state.unit=u.ref;this.context=immutable({...this.context,members:this.context.members.map(m=>sameRef(m.unit,ref)?{...m,unit:u.ref}:m)});return u.ref;}
  private purgeReferences(ref:EntityRef):void {
    for(const p of this.playerMap.values()){const s=p.state;if(s.target&&sameRef(s.target,ref))s.target=null;if(s.talkTarget&&sameRef(s.talkTarget,ref))s.talkTarget=null;if(s.cast?.target&&sameRef(s.cast.target,ref))p.interruptCast();if(s.dash&&sameRef(s.dash.target,ref))s.dash=null;}
    for(const u of this.unitMap.values()){const plan=u.pendingHit?.plan;if(plan&&(sameRef(plan.source,ref)||'target' in plan&&sameRef(plan.target,ref)))u.pendingHit=null;}
    this.flights.purge(ref);
    this.timers.removeWhere(a=>a.kind==='respawn'?sameRef(a.player,ref):a.kind==='bossWake'?sameRef(a.boss,ref):false);
  }
  private timer(action:TimerAction):void {if(action.kind==='respawn'){const p=this.services.player(action.player);if(p&&!this.getUnit(action.player)?.alive)p.respawn();}else if(action.kind==='bossWake'){if(this.getUnit(action.boss))this.bossMap.get(action.boss.id)?.wake();}else if(action.kind==='echoSpawn'){const e=[...this.enemyMap.values()].find(e=>e.spawnId===action.spawnId),spawn=this.options.definition.enemies.find(s=>s.id===action.spawnId);if(e&&spawn)e.respawnAt(spawn.home.x,spawn.home.z);}else this.worldRules.onTimer(action);}
  step(inputs:ReadonlyMap<EntityId,PlayerIntent>):void {
    this.boundary();if(this.departures.size||this.arrivals.size)throw new Error('Transfer transaction active');
    // Fail before actor work when undrained history leaves no room for even the first observation.
    this.events.assertRoom(1);
    for(const [id,input] of inputs)if(!this.playerMap.has(id)||!Array.isArray(input.commands)||input.commands.length>this.options.limits.inputCommandsPerTick)throw new RangeError('Invalid/oversized actor input');
    this.running=true;
    try {
      for(const [id,p] of this.playerMap){const input=inputs.get(id);if(!input)continue;p.applyIntent(input);}
      this.clock+=DT;this.stepId++;
      this.timers.update(this.clock,a=>this.timer(a));
      for(const p of this.playerMap.values()){p.update(DT);feedLocomotion(p.unit,DT);}
      for(const e of [...this.enemyMap.values()]){e.update(DT);const u=this.getUnit(e.unit);if(u)feedLocomotion(u,DT);}
      for(const b of this.bossMap.values()){b.update(DT);const u=this.getUnit(b.unit);if(u)feedLocomotion(u,DT);}
      this.worldRules.update();this.separate();
      if(this.services.world==='w2'&&this.clock>=this.nextEcho&&!this.services.encounterActive()){for(const e of this.enemyMap.values())if(e.isEcho&&e.state==='gone')e.respawnAt(e.spawn.home.x,e.spawn.home.z);this.nextEcho=this.clock+120;}
      for(const u of this.unitMap.values())if(u.alive&&!u.hidden&&u.rustUntil&&this.clock>=u.rustUntil){u.rust=0;u.rustUntil=0;}
      for(const u of this.unitMap.values())this.actions.updateHit(u,DT);
      this.flights.update(DT);
      for(const u of this.unitMap.values()){this.actions.update(u,DT);advanceNumericPose(u,DT);}
    }catch(error){this.failed=true;throw error;}finally{this.running=false;}
  }
  private separate():void {const list=[...this.unitMap.values()].filter(u=>u.alive&&!u.hidden&&(u.reaction==='hostile'||u.kind==='player'));for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i]!,b=list[j]!,dx=b.x-a.x,dz=b.z-a.z,min=(a.radius+b.radius)*.85,d2=dx*dx+dz*dz;if(d2>=min*min||d2<1e-6)continue;const d=Math.sqrt(d2),push=(min-d)/d,wa=a.kind==='boss'?0:a.kind==='player'?.2:.5,wb=b.kind==='boss'?0:b.kind==='player'?.2:.5,sum=wa+wb||1;a.x-=dx*push*wa/sum;a.z-=dz*push*wa/sum;b.x+=dx*push*wb/sum;b.z+=dz*push*wb/sum;}}
  snapshot():AreaSnapshot {this.boundary();return immutable({area:this.services.id,world:this.services.world,tick:this.stepId,time:this.clock,units:[...this.unitMap.values()].sort((a,b)=>a.ref.id-b.ref.id),players:[...this.playerMap.values()].map(p=>p.state).sort((a,b)=>a.unit.id-b.unit.id),projectiles:[...this.flights.states.values()].sort((a,b)=>a.id-b.id)});}
  debugState():AreaDebugState {this.boundary();const w=this.worldRules.debugState();return immutable({schema:'s2-debug-v1',definitionVersion:JSON.stringify(this.options.definition),actionDataVersion:this.options.actionData.version,snapshot:this.snapshot(),rng:{algorithm:this.rng.algorithm,state:this.rng.state()},allocators:{entity:this.ids.nextValue,action:this.actions.nextGeneration,projectile:this.flights.nextId,timer:this.timers.nextId,event:this.events.nextOrder},playerControllers:[...this.playerMap.values()].map(p=>p.debugState()) as DebugValue[],enemies:[...this.enemyMap.values()].map(e=>e.debugState()) as DebugValue[],bosses:[...this.bossMap.values()].map(b=>b.debugState()) as DebugValue[],timers:this.timers.snapshot(),contributions:w.contributions,grants:w.grants,acknowledgedGrantIds:w.acknowledgedGrantIds,heldIntents:[...this.playerMap.values()].map(p=>({actor:p.state.unit,intent:p.heldIntent,lastConsumedSeq:p.lastConsumedSeq})),lifecycle:{nextEcho:this.nextEcho,nextToken:this.tokenIds.nextValue,reservations:[...this.reservations.values()],departures:[...this.departures.values()],arrivals:[...this.arrivals.values()].map(a=>({token:a.token,admission:a.admission,unit:a.unit,state:a.player.state,dto:a.dto}))} as unknown as DebugValue,interactions:w.interactions as unknown as DebugValue,context:this.context});}
  drainEvents(){this.boundary();return this.events.drain();}
  applyContext(context:AreaContext):void {this.boundary();const ids=new Set<number>(),characters=new Set<string>();for(const m of context.members){const p=this.services.player(m.unit);if(!p||p.state.character!==m.character||ids.has(m.unit.id)||characters.has(m.character))throw new Error('Invalid membership');ids.add(m.unit.id);characters.add(m.character);}if(ids.size!==this.playerMap.size)throw new Error('Missing membership');this.context=immutable(context);}
  private spawn(id:string){const d=this.options.definition;const p=id===d.spawn.id?d.spawn:id===d.recall.id?d.recall:d.pois[id]??Object.values(d.pois).find(p=>p.id===id);if(!p)throw new Error('Unknown spawn');return p;}
  private createCharacter(character:CharacterId,classId:ClassId,archetype:string,spawnId:string){const spawn=this.spawn(spawnId),u=this.makeUnit(archetype,'player','player',spawn.position);teleport(u,this.options.query,spawn.position.x,spawn.position.z,spawn.yaw);const state=createPlayerState(character,u,classId,this.clock);state.quests=freshQuests();setQuestChapter(state.quests,this.services.world==='w1'?1:this.services.world==='w2'?2:3);return {unit:u,player:createPlayer(this.services,u,state)};}
  private activate(unit:SimUnit,player:PlayerController):void {this.unitMap.set(unit.ref.id,unit);this.playerMap.set(unit.ref.id,player);this.controllerMap.set(unit.ref.id,player);this.context=immutable({...this.context,members:[...this.context.members,{character:player.state.character,unit:unit.ref,party:null,villagePlaying:false,seatedBoat:null}]});}
  attachFresh(character:CharacterId,classId:ClassId,archetype:string,spawn:string):EntityRef {this.boundary();if(!character||this.services.playerByCharacter(character)||this.playerMap.size+this.reservations.size>=MAX_PLAYERS)throw new Error('Character admission rejected');if(this.options.characters?.owner(character))throw new Error('Character already owned');const created=this.createCharacter(character,classId,archetype,spawn);if(this.options.characters&&!this.options.characters.compareAndSwap(character,null,created.unit.ref))throw new Error('Character registry mismatch');this.activate(created.unit,created.player);return created.unit.ref;}
  reserveAdmission(character:CharacterId,spawn:string,hostTick:number):Admission|null {this.boundary();if(!Number.isSafeInteger(hostTick)||hostTick<0)throw new Error('Invalid host tick');for(const a of this.reservations.values())if(a.expiresAtHostTick<hostTick)this.releaseAdmission(a.token);this.spawn(spawn);if(this.services.playerByCharacter(character)||[...this.reservations.values()].some(a=>a.character===character)||this.playerMap.size+this.reservations.size>=MAX_PLAYERS)return null;const a=immutable({token:JSON.stringify([this.services.id,'admission',this.tokenIds.next()]),character,destination:this.services.id,spawn,expiresAtHostTick:hostTick+30});this.reservations.set(a.token,a);return a;}
  releaseAdmission(token:string):void {this.boundary();this.arrivals.delete(token);this.reservations.delete(token);}
  stageDeparture(ref:EntityRef):StagedDeparture {this.boundary();const p=this.services.player(ref);if(!p||[...this.departures.values()].some(d=>d.character===p.state.character))throw new Error('Invalid departure');const u=this.getUnit(ref)!;this.events.assertRoom(u.actions.length+this.playerMap.size*3+4);const d=immutable({token:JSON.stringify([this.services.id,'departure',this.tokenIds.next()]),character:p.state.character,source:this.services.id,sourceRef:ref,dto:captureTransfer(this.services,p,this.worldRules.appliedGrantIds(p.state.character))});this.departures.set(d.token,d);return d;}
  stageArrival(admission:Admission,dto:TransferDTO):StagedArrival {this.boundary();const a=this.reservations.get(admission.token);if(!a||JSON.stringify(a)!==JSON.stringify(admission)||a.character!==dto.character||this.arrivals.has(a.token))throw new Error('Invalid arrival');const owned=copyValue(dto),created=this.createCharacter(dto.character,dto.classId,dto.archetype,a.spawn);restoreTransfer(owned,created.unit,created.player.state,this.clock,this.services.world);this.arrivals.set(a.token,{token:a.token,admission:a,...created,dto:owned});return immutable({token:a.token,admission:a,newRef:created.unit.ref});}
  abortDeparture(token:string):void {this.boundary();this.departures.delete(token);}
  abortArrival(token:string):void {this.boundary();this.arrivals.delete(token);}
  commitDeparture(token:string):void {this.boundary();const d=this.departures.get(token);if(!d)throw new Error('Unknown departure');const u=this.getUnit(d.sourceRef)!;this.actions.stop(u,undefined,0);u.pendingHit=null;this.purgeReferences(d.sourceRef);this.playerMap.delete(u.ref.id);this.controllerMap.delete(u.ref.id);this.unitMap.delete(u.ref.id);this.context=immutable({...this.context,members:this.context.members.filter(m=>!sameRef(m.unit,d.sourceRef))});this.departures.delete(token);}
  activateArrival(token:string):EntityRef {this.boundary();const a=this.arrivals.get(token);if(!a)throw new Error('Unknown arrival');this.activate(a.unit,a.player);this.worldRules.restoreAppliedGrantIds(a.dto.character,a.dto.appliedGrantIds);this.arrivals.delete(token);this.reservations.delete(token);return a.unit.ref;}
  pendingGrants(){return immutable(this.worldRules.pendingGrants());}
  acknowledgeGrant(id:string):void {this.boundary();this.worldRules.acknowledgeGrant(id);}
  receiveGrant(grant:EarnedGrant){this.boundary();return this.worldRules.applyGrant(grant);}
  dispose():void {if(this.running)throw new Error('Requires between-tick boundary');if(this.disposed)return;if(this.pendingGrants().length)throw new Error('Unacknowledged grants');if(this.departures.size||this.arrivals.size)throw new Error('Transfer active');if(this.options.characters){for(const p of this.playerMap.values())if(!sameRef(this.options.characters.owner(p.state.character)??{area:'',id:0,life:0},p.state.unit))throw new Error('Character registry mismatch');for(const p of this.playerMap.values())this.options.characters.compareAndSwap(p.state.character,p.state.unit,null);}this.disposed=true;this.unitMap.clear();this.playerMap.clear();this.enemyMap.clear();this.bossMap.clear();this.controllerMap.clear();this.flights.clear();this.timers.clear();this.reservations.clear();}
}
export {SimulationArea as Area};
export function createArea(options:AreaOptions):SimulationArea{return new SimulationArea(options);}
