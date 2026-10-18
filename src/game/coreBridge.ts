import * as THREE from 'three';
import type { Game } from './game';
import type { Unit } from './unit';
import type { SimEvent } from './events';
import { QUESTS, type QuestId } from './quests';
import { createArea, type SimulationArea } from '../sim/area.ts';
import { InputAccumulator } from '../sim/input.ts';
import type { CoreEvent, EntityRef, PlayerCommand, WorldId } from '../sim/types.ts';
import type { PlayerController } from '../sim/player.ts';
import { sampleHeld, captureEdges } from './playerInput';
import { teleport, moveTo, feedLocomotion } from '../sim/unit.ts';
import { realActionData, actionRequest } from '../sim/data/actions.ts';
import { loadBakedWorld, type BakedCollision } from '../sim/world/baked.ts';
import { createWorld1Definition } from '../sim/areas/world1.ts';
import { createWorld2Definition } from '../sim/areas/world2.ts';
import { createWorld3Definition } from '../sim/areas/world3.ts';
import { createWorld4Definition } from '../sim/areas/world4.ts';
import { canonicalEnemyLevel, canonicalEnemyRespawn } from '../sim/data/enemies.ts';

class RecordMap<T> extends Map<string,T>{
  private record:()=>Record<string,T>;
  constructor(record:()=>Record<string,T>){super();this.record=record;}
  override get size(){return Object.keys(this.record()).length;}
  override get(key:string){return this.record()[key];}
  override set(key:string,value:T){this.record()[key]=value;return this;}
  override has(key:string){return Object.hasOwn(this.record(),key);}
  override delete(key:string){const found=this.has(key);delete this.record()[key];return found;}
  override clear(){for(const key of Object.keys(this.record()))delete this.record()[key];}
  override entries(){return new Map(Object.entries(this.record())).entries();}
  override keys(){return new Map(Object.entries(this.record())).keys();}
  override values(){return new Map(Object.entries(this.record())).values();}
  override [Symbol.iterator](){return this.entries();}
  override forEach(callback:(value:T,key:string,map:Map<string,T>)=>void,thisArg?:unknown){for(const [key,value]of this.entries())callback.call(thisArg,value,key,this);}
}
/** Browser input/view boundary. Numeric Player/Combat/Enemy/Boss remain the only active rules. */
export class CoreGameBridge {
  readonly areas:ReadonlyMap<WorldId,SimulationArea>;
  readonly input=new InputAccumulator();
  readonly game:Game;
  private active:WorldId;
  private remainder=0;
  private views=new Map<string,Unit>();
  private corePlayer:PlayerController;
  private enemyViews=new Map<string,Unit>();
  get area(){return this.areas.get(this.active)!;}
  get player(){return this.corePlayer;}
  static async create(game:Game):Promise<CoreGameBridge>{
    const ids:WorldId[]=['w1','w2','w3','w4'];
    const queries=await Promise.all(ids.map(async id=>{const response=await fetch(`${import.meta.env.BASE_URL}world/collision-${id}.json`);if(!response.ok)throw new Error(`Cannot load ${id} simulation geometry`);return loadBakedWorld(await response.json() as BakedCollision);}));
    const baseScraps=game.enemies.filter(e=>e.kind==='scrapling'&&!e.isAdd).length-3;
    const population={scrapling:Math.max(0,baseScraps),scavenger:game.enemies.filter(e=>e.kind==='scavenger'&&!e.isEcho).length,jellyfish:game.enemies.filter(e=>e.kind==='jellyfish').length,shallowPatrols:3};
    const builders=[createWorld1Definition,createWorld2Definition,createWorld3Definition,createWorld4Definition];
    const definitions=queries.map((query,i)=>builders[i]!({query,personalProps:{heightAt:query.heightAt.bind(query),resolveCollision:(x,z,r,out)=>query.collision.resolve(x,z,r,out)},fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population}));
    const areas=new Map<WorldId,SimulationArea>();
    for(let i=0;i<ids.length;i++){const world=ids[i]!,definition=definitions[i]!;areas.set(world,createArea({id:`browser-${world}`,definition,query:queries[i]!,actionData:realActionData,seed:1337+i,context:{mode:'public',members:[],pvp:'disabled'},limits:{eventCount:10000,inputCommandsPerTick:32,timers:1000,projectiles:1000},policy:{enemyLevel:(spawn,ctx)=>canonicalEnemyLevel(spawn.kind,ctx.chapter,spawn.role),enemyPopulation:spawn=>({desired:1,respawnSeconds:canonicalEnemyRespawn(spawn.kind,i+1,spawn.role)}),damageAllowed:(_context,_source,target)=>!(target.kind==='player'&&game.god),canInteract:()=>true}}));}
    return new CoreGameBridge(game,areas,`w${game.world2.chapter}` as WorldId);
  }
  private constructor(game:Game,areas:Map<WorldId,SimulationArea>,world:WorldId){
    this.game=game;this.areas=areas;this.active=world;
    const old=game.player,position=old.unit.pos.clone();
    const ref=this.area.attachFresh('local',old.cls.id,old.unit.rig.spec.race,this.area.services.definition.spawn.id);
    this.corePlayer=this.area.services.player(ref) as PlayerController;
    const state=this.corePlayer.state;this.corePlayer.restoreXp(old.xp);
    for(const key of ['resource','maxResource','coins','attackRank','armorRank','weaponOwned','armorOwned','baseMaxHp','gcdStart','gcdEnd'] as const)state[key]=old[key] as never;
    state.cooldowns=Object.fromEntries(old.cooldowns);state.quests={chapter:game.quests.chapter,status:{...game.quests.status},progress:Object.fromEntries(game.quests.progress),tracked:{...game.quests.tracked},cogs:game.quests.cogs};
    for(const key of ['rustCleared','abyssCleared','trueCleared','finalCleared','frostCleared','firstEndingSeen'] as const)state.flags[key]=game.journey?.[key]??false;state.flags.frostEndingStarted=state.flags.frostCleared??false;
    Object.assign(this.corePlayer.unit,{x:position.x,y:position.y,z:position.z,yaw:old.unit.yaw,hp:old.unit.hp});
    const counters={scrapling:0,scavenger:0,jellyfish:0,shallow:0};
    const baseScraps=game.enemies.filter(e=>e.kind==='scrapling'&&!e.isAdd).length-3;
    for(const enemy of game.enemies){if(enemy.isAdd)continue;let key:string;if(enemy.isEcho)key='echo';else if(enemy.kind==='scrapling'){const index=counters.scrapling++;key=index<baseScraps?`scrapling:${index}`:`shallow:${counters.shallow++}`;}else key=`${enemy.kind}:${counters[enemy.kind]++}`;this.enemyViews.set(key,enemy.unit);}
    for(const [id,area]of areas){for(const [profile,view]of [['rust',game.boss],['abyss',game.finalBoss],['eclipse',game.worldBoss],['dawn',game.dawnBoss],['frost',game.frostBoss]] as const){const boss=[...area.bosses.values()].find(b=>b.profile===profile);if(!boss)continue;const unit=area.services.getUnit(boss.unit)!;Object.assign(unit,{alive:view.unit.alive,hp:view.unit.hp,hidden:view.unit.hidden,targetable:view.unit.targetable,invulnerable:view.unit.invulnerable});if(view.state==='dead'){(boss as unknown as {state:string}).state='dead';unit.alive=false;unit.hp=0;}
      this.bind(view.unit,unit.ref,area);const freed=[...area.units.values()].find(u=>u.kind==='freed'&&u.npcId===area.services.definition.bosses.find(b=>b.profile===profile)!.freedNpcId)!;this.bind(view.freed,freed.ref,area);
      for(const key of ['state','phase','enraged'] as const)Object.defineProperty(view,key,{configurable:true,get:()=>Reflect.get(boss,key),set:value=>Reflect.set(boss,key,value)});
      for(const key of ['engaged','telegraphActive','mechName'] as const)Object.defineProperty(view,key,{configurable:true,get:()=>Reflect.get(boss,key)});
      view.wake=()=>boss.wake();view.reset=()=>boss.reset();view.sleep=()=>boss.sleep();
    }void id;}
    this.bindActiveViews();this.bindPlayer();this.bindQuests();
  }
  private bind(view:Unit,ref:EntityRef,area=this.area):void{const unit=area.services.getUnit(ref);if(!unit)throw new Error('Cannot bind missing numeric actor');view.bindSimulation(unit,area.services,{action:(id,o)=>area.services.startAction(unit.ref,actionRequest(area.services.actionData,id,{upper:o.upper,part:o.part,from:o.from,to:o.to,speed:o.speed,loop:o.loop,fade:o.fade,carryRoot:o.carryRoot})),teleport:(x,z,yaw)=>teleport(unit,area.services.query,x,z,yaw),moveTo:(x,z,dt)=>moveTo(unit,area.services.query,x,z,dt),feed:dt=>feedLocomotion(unit,dt)});this.views.set(`${ref.area}:${ref.id}`,view);}
  unit(ref:EntityRef|null|undefined):Unit|null{if(!ref)return null;const view=this.views.get(`${ref.area}:${ref.id}`);return view?.ref?.life===ref.life?view:null;}
  private bindActiveViews():void {
    this.bind(this.game.player.unit,this.corePlayer.state.unit);
    for(const n of this.game.npcs){const u=this.area.services.npcById(n.def.id);if(u)this.bind(n.unit,u.ref);}
    for(const e of this.area.enemies.values()){const definition=this.area.services.definition.enemies.find(s=>s.id===e.spawnId),view=definition?.legacySlot?this.enemyViews.get(definition.legacySlot):null;if(view){this.bind(view,e.unit);const old=this.game.enemies.find(x=>x.unit===view)!;for(const key of ['state','stats'] as const)Object.defineProperty(old,key,{configurable:true,get:()=>Reflect.get(e,key),set:value=>Reflect.set(e,key,value)});}}
  }
  private bindPlayer():void {
    const p=this.game.player;
    for(const key of ['resource','maxResource','xp','coins','attackRank','armorRank','weaponOwned','armorOwned','baseMaxHp','gcdStart','gcdEnd','nextSwing','lastAttack','velX','velZ','jumpT','spinT','lastSpend','targetDeadAt'] as const)Object.defineProperty(p,key,{configurable:true,get:()=>this.corePlayer.state[key],set:value=>{(this.corePlayer.state as unknown as Record<string,unknown>)[key]=value;}});
    Object.defineProperty(p,'cooldowns',{configurable:true,value:new RecordMap(()=>this.corePlayer.state.cooldowns)});
    Object.defineProperty(p,'target',{configurable:true,get:()=>this.unit(this.corePlayer.state.target),set:(view:Unit|null)=>this.command({kind:'target',target:view?.ref??null})});
    Object.defineProperty(p,'cast',{configurable:true,get:()=>{const c=this.corePlayer.state.cast;return c?{...c,ability:p.cls.abilities.find(a=>a.id===c.ability)!,target:this.unit(c.target)}:null;}});
    Object.defineProperty(p,'channel',{configurable:true,get:()=>{const c=this.corePlayer.state.channel;return c?{...c,label:c.kind,key:c.kind==='recall'?'KeyT':'KeyF',to:new THREE.Vector3(c.to.x,c.to.y,c.to.z),onDone:()=>{throw new Error('Core channel completion belongs to Area');}}:null;}});
    p.setTarget=view=>this.command({kind:'target',target:view?.ref??null});p.useAbility=slot=>this.command({kind:'ability',slot:slot as 1|2|3|4|5});p.toggleBreakdance=()=>this.command({kind:'dance'});
    p.gainXp=amount=>this.corePlayer.gainXp(amount);p.restoreXp=xp=>this.corePlayer.restoreXp(xp);p.gainRage=amount=>this.corePlayer.gainRage(amount);
    p.interruptCast=reason=>this.corePlayer.interruptCast(reason);p.cancelChannel=()=>this.corePlayer.cancelChannel();p.respawn=()=>this.corePlayer.respawn();
    p.returnToSquare=()=>this.command({kind:'channelStart',channel:'recall'});
    p.startChannel=(_label,_seconds,key,to)=>{if(key==='KeyT'){this.command({kind:'channelStart',channel:'recall'});return;}const point=this.area.services.definition.interactions.filter(i=>i.kind==='beacon'||i.kind==='waystone').sort((a,b)=>Math.hypot(a.position.x-to.x,a.position.z-to.z)-Math.hypot(b.position.x-to.x,b.position.z-to.z))[0];if(point)this.command({kind:'interact',targetId:point.id});};
  }
  private bindQuests():void {const q=this.game.quests;for(const key of ['status','tracked','cogs','chapter'] as const)Object.defineProperty(q,key,{configurable:true,get:()=>this.corePlayer.state.quests[key],set:value=>{(this.corePlayer.state.quests as unknown as Record<string,unknown>)[key]=value;}});Object.defineProperty(q,'progress',{configurable:true,value:new RecordMap(()=>this.corePlayer.state.quests.progress)});q.accept=id=>this.command({kind:'questAccept',questId:id,npcId:QUESTS[id].giver});q.complete=id=>this.command({kind:'questTurnIn',questId:id,npcId:QUESTS[id].turnIn??QUESTS[id].giver});q.track=id=>{this.command({kind:'questTrack',questId:id});return true;};}
  command(command:PlayerCommand):void{this.input.push(command);}
  update(dt:number):void {
    const g=this.game;sampleHeld(g,this.input,dt,this.corePlayer.state.channel?.kind??null);captureEdges(g,this.input);
    this.remainder+=Math.min(dt,.25);
    while(this.remainder>=1/30){this.corePlayer.state.controlsLocked=g.cinematic||g.ending.active;this.corePlayer.state.talkTarget=g.talkPartner?.ref??null;this.area.step(new Map([[this.corePlayer.state.unit.id,this.input.next()]]));g.time=this.area.services.time;this.remainder-=1/30;for(const record of this.area.drainEvents())this.event(record.event);}
  }
  private event(event:CoreEvent):void {
    const g=this.game;
    if(event.type==='action'){const view=this.unit(event.unit);if(event.action)view?.onAction?.(event.action.id);return;}
    if(event.type==='rootRebase'||event.type==='reward'||event.type==='respawn'||event.type==='equipment'||event.type==='endingReady'||event.type==='travelReady')return;
    if(event.type==='quest'){const id=event.quest as QuestId;if(event.stage==='accepted')g.quests.events.emit('accepted',id);else if(event.stage==='ready')g.quests.events.emit('ready',id);else if(event.stage==='completed')g.quests.events.emit('completed',id);else if(event.objective){const objective=QUESTS[id].objectives.find(o=>o.id===event.objective);if(objective)g.quests.events.emit('progress',{quest:id,objective,value:event.value??0});}return;}
    if(event.type==='dance'&&event.stage==='stop'){this.unit(event.unit)?.onBreakdanceStop?.();return;}
    const mapped:Record<string,unknown>={...event};for(const key of ['unit','src','dst','caster','target','boss','killer'] as const){if(key in mapped){const ref=mapped[key] as EntityRef|null|undefined;mapped[key]=this.unit(ref);if(ref&&mapped[key]===null)return;}}
    if(event.type==='attack')mapped.attack=({'warrior-auto':'auto','enemy-claw':'claw','enemy-sea-cast':'seaCast','enemy-leap':'leap','boss-claw':'bossClaw'} as Record<string,string>)[event.attack]??'auto';
    if(event.type==='castStart'){if(event.ability)mapped.ability=g.player.cls.abilities.find(a=>a.id===event.ability);if(event.channel)mapped.channel={...event.channel,label:event.channel.kind==='recall'?'Recall':event.channel.kind==='beacon'?'Light beacon':'Restore light'};}
    if(event.type==='say')mapped.text=event.textKey;
    g.events.emit(mapped as unknown as SimEvent);
  }
  diagnostics(){return {world:this.active,ref:this.corePlayer.state.unit,tick:this.area.services.tick,actorCount:this.area.units.size,definition:this.area.services.definition.world,position:{x:this.corePlayer.unit.x,y:this.corePlayer.unit.y,z:this.corePlayer.unit.z}};}
}
