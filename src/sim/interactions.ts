import type { AreaDefinition, AreaServices, ChannelState, EntityRef, PlayerCommand, PlayerSim } from './types.ts';
import { activeObjective, QUESTS, questAccept, questBump, questComplete, questTrack } from './data/quests.ts';
import { worldChapter } from './math.ts';
import { canChallenge, canReplayFrostEnding, canTravelTo, forgeCost } from './data/progression.ts';
import { teleport } from './unit.ts';
import { BOSS_PROFILES } from './data/bosses.ts';
export interface WorldInteractionState {beaconLit:boolean}
type Interaction=AreaDefinition['interactions'][number];
/** Per-player NPC/objective/channel rules. Renderer events are observations only. */
export class InteractionRules {
 readonly services:AreaServices;readonly world:WorldInteractionState;
 private readonly portals=new Map<string,{ref:EntityRef;armed:boolean;readyAt:number}>();
 constructor(services:AreaServices,world:WorldInteractionState){this.services=services;this.world=world;}
 private player(ref:EntityRef):PlayerSim|null {const s=this.services,p=s.player(ref),u=s.getUnit(ref);if(!p||!u?.alive||u.hidden||p.state.controlsLocked)return null;const member=s.context.members.find(m=>m.character===p.state.character);if(member?.villagePlaying||member?.seatedBoat)return null;return p;}
 private near(player:PlayerSim,position:{x:number;y:number;z:number},range:number):boolean {const u=this.services.getUnit(player.state.unit);return !!u&&Math.hypot(u.x-position.x,u.y-position.y,u.z-position.z)<=range;}
 private validate(player:PlayerSim,id:string):Interaction|null {const s=this.services,point=s.definition.interactions.find(i=>i.id===id);if(!point||!this.player(player.state.unit)||!this.near(player,point.position,point.range)||!s.policy.canInteract(s.context,player.state,id))return null;
  if(point.objective?.startsWith('dawn-')){const u=s.getUnit(player.state.unit)!;if(s.world!=='w3'||Math.hypot(u.x-point.position.x,u.y-point.position.y,u.z-point.position.z)>=point.range)return null;}
  if(point.kind==='beacon'&&!(player.state.quests.status.q3==='done'||player.state.flags.beaconLit||activeObjective(player.state.quests,'beacon')))return null;
  if((point.kind==='crystal'||point.kind==='waystone'||point.kind==='explore')&&(!point.objective||!activeObjective(player.state.quests,point.objective)))return null;
  if(point.kind==='gate'){const chapter=worldChapter(point.destination!);if(!canTravelTo(chapter,player.state.flags))return null;const u=s.getUnit(player.state.unit)!;if(s.encounterActive()||s.time-u.lastCombat<5)return null;}
  return point;
 }
 private npc(player:PlayerSim,id:string):boolean {const s=this.services,npc=s.definition.npcs.find(n=>n.id===id);return !!npc&&this.near(player,npc.position,8)&&s.policy.canInteract(s.context,player.state,`npc:${id}`);}
 interact(ref:EntityRef,id:string):boolean {const player=this.player(ref);if(!player)return false;const s=this.services;
  if(id.startsWith('npc:')){const npc=id.slice(4);if(!this.npc(player,npc))return false;const unit=s.npcById(npc);player.state.talkTarget=unit?.ref??null;if(npc==='brinebeard'&&s.world==='w3')questBump(player,s,'dawn-letter');if(npc==='silvermoon')questBump(player,s,'deliver');if(npc==='coralline')questBump(player,s,'deliver-supplies');return true;}
  const point=this.validate(player,id);if(!point)return false;
  if(point.kind==='beacon'||point.kind==='waystone'){if(player.state.channel||player.state.cast||player.state.dash)return false;const unit=s.getUnit(ref)!;player.state.target=null;unit.yaw=Math.atan2(point.position.x-unit.x,point.position.z-unit.z);player.startChannel(point.kind==='beacon'?'beacon':'waystone',point.kind==='beacon'?2:1.5,point.position,point.id);return true;}
  if(point.kind==='crystal'||point.kind==='explore'){questBump(player,s,point.objective!);return true;}
  if(point.kind==='gate'&&point.destination){s.emit({type:'travelReady',unit:ref,destination:point.destination,gate:point.id});return true;}
  return false;
 }
 command(ref:EntityRef,command:PlayerCommand):boolean {const p=this.player(ref);if(!p)return false;const s=this.services;
  if(command.kind==='questTrack')return questTrack(p.state.quests,command.questId);
  if(command.kind==='endingReplay'){if(!canReplayFrostEnding(worldChapter(s.world),p.state.flags,s.bossByProfile('frost')?.state??'dormant',p.state.controlsLocked))return false;s.emit({type:'endingReady',unit:p.state.unit,chapter:4,replay:true});return true;}
  if(command.kind==='bossChallenge'){
   const boss=s.bossByProfile(command.profile),definition=s.definition.bosses.find(b=>b.profile===command.profile),u=s.getUnit(ref)!;if(!boss||!definition)return false;
   const stats=BOSS_PROFILES[command.profile],chapter=worldChapter(s.world);
   const joining=boss.engaged&&Math.hypot(u.x-definition.arena.position.x,u.z-definition.arena.position.z)>definition.arena.radius+3;
   if(boss.state==='dying'||stats.level<20&&!this.world.beaconLit||!canChallenge(u.level,stats.level,!!p.state.flags.rustCleared,!!p.state.flags.abyssCleared,chapter)||s.time-u.lastCombat<5||s.encounterActive()&&!joining)return false;
   if(command.profile==='abyss'&&s.bossByProfile('rust')?.state!=='dead')return false;
   if(!joining){boss.wake();p.respawn();}else{p.cancelChannel();p.interruptCast();p.state.target=null;}
   const unit=s.getUnit(p.state.unit)!;const distance=Math.min(9,definition.arena.radius*.85);teleport(unit,s.query,definition.arena.position.x+Math.sin(definition.arena.yaw)*distance,definition.arena.position.z+Math.cos(definition.arena.yaw)*distance,definition.arena.yaw+Math.PI);return true;
  }
  if(command.kind==='channelStart'){if(command.channel==='recall'||!command.targetId)return false;const point=s.definition.interactions.find(i=>i.id===command.targetId);return !!point&&point.kind===command.channel&&this.interact(ref,point.id);}
  if(command.kind==='interact')return this.interact(ref,command.targetId);
  if(command.kind==='travel')return this.interact(ref,command.gateId);
  if(command.kind==='forgeBuy'){if(command.npcId!=='pip'||!this.npc(p,'pip')||p.state.attackRank>=100||p.state.coins<forgeCost(p.state.attackRank))return false;p.state.coins-=forgeCost(p.state.attackRank);p.state.attackRank++;return true;}
  if(command.kind==='questAccept'||command.kind==='questTurnIn'){const def=QUESTS[command.questId];if(!def||def.chapter!==p.state.quests.chapter||!this.npc(p,command.npcId))return false;
   if(command.kind==='questAccept'){if(def.giver!==command.npcId||p.state.quests.status[def.id]!=='available'||def.id==='q4')return false;if(def.id==='q3')p.state.flags.beaconLit=this.world.beaconLit;return questAccept(p,s,def.id);}
   if(def.turnIn!==command.npcId||p.state.quests.status[def.id]!=='ready')return false;return questComplete(p,s,def.id);
  }return false;
 }
 completeChannel(player:PlayerSim,channel:ChannelState):void {if(channel.kind==='recall')return;const point=channel.targetId?this.validate(player,channel.targetId):null;if(!point||point.kind!==channel.kind)return;
  if(point.kind==='waystone'){questBump(player,this.services,point.objective!);return;}
  this.world.beaconLit=!this.world.beaconLit;
  if(!this.world.beaconLit){this.services.bossByProfile('rust')?.sleep();this.services.bossByProfile('abyss')?.sleep();player.state.target=null;}
  for(const unit of this.services.players()){const p=this.services.player(unit.ref);if(!p)continue;p.state.flags.beaconLit=this.world.beaconLit;if(this.world.beaconLit)questBump(p,this.services,'beacon');}
 }
 purgeActor(ref:EntityRef):void {for(const [character,p]of this.portals)if(p.ref.area===ref.area&&p.ref.id===ref.id&&p.ref.life===ref.life)this.portals.delete(character);}
 update():void {
  const s=this.services,characters=new Set<string>();for(const unit of s.players()){const p=this.player(unit.ref);if(!p)continue;characters.add(p.state.character);for(const point of s.definition.interactions)if(point.kind==='explore'&&this.validate(p,point.id))questBump(p,s,point.objective!);
   let portal=this.portals.get(p.state.character);if(!portal||portal.ref.id!==unit.ref.id||portal.ref.life!==unit.ref.life){portal={ref:{...unit.ref},armed:false,readyAt:s.time+3};this.portals.set(p.state.character,portal);}
   const gates=s.definition.interactions.filter(i=>i.kind==='gate'),base=gates[0],special=gates[1];let gate=base;if(special&&Math.hypot(unit.x-special.position.x,unit.y-special.position.y,unit.z-special.position.z)<(s.world==='w3'?7:6))gate=special;if(!gate)continue;
   const distance=Math.hypot(unit.x-gate.position.x,unit.z-gate.position.z);if(distance>4.5)portal.armed=true;if(portal.armed&&distance<1.7&&s.time>portal.readyAt){portal.armed=false;portal.readyAt=s.time+3;this.interact(unit.ref,gate.id);}
  }for(const character of this.portals.keys())if(!characters.has(character))this.portals.delete(character);
 }
 debugState():{beaconLit:boolean;portals:readonly {character:string;ref:EntityRef;armed:boolean;readyAt:number}[]}{return {beaconLit:this.world.beaconLit,portals:[...this.portals].map(([character,p])=>({character,...p,ref:{...p.ref}}))};} 
}
