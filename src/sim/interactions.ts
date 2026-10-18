import type { AreaDefinition, AreaServices, ChannelState, EntityRef, PlayerCommand, PlayerSim } from './types.ts';
import { activeObjective, QUESTS, questAccept, questBump, questComplete } from './data/quests.ts';
import { canTravelTo, forgeCost } from './data/progression.ts';
export interface WorldInteractionState {beaconLit:boolean}
type Interaction=AreaDefinition['interactions'][number];
/** Per-player NPC/objective/channel rules. Renderer events are observations only. */
export class InteractionRules {
 readonly services:AreaServices;readonly world:WorldInteractionState;
 constructor(services:AreaServices,world:WorldInteractionState){this.services=services;this.world=world;}
 private player(ref:EntityRef):PlayerSim|null {const s=this.services,p=s.player(ref),u=s.getUnit(ref);if(!p||!u?.alive||u.hidden||p.state.controlsLocked)return null;const member=s.context.members.find(m=>m.character===p.state.character);if(member?.villagePlaying||member?.seatedBoat)return null;return p;}
 private near(player:PlayerSim,position:{x:number;y:number;z:number},range:number):boolean {const u=this.services.getUnit(player.state.unit);return !!u&&Math.hypot(u.x-position.x,u.y-position.y,u.z-position.z)<=range;}
 private validate(player:PlayerSim,id:string):Interaction|null {const s=this.services,point=s.definition.interactions.find(i=>i.id===id);if(!point||!this.player(player.state.unit)||!this.near(player,point.position,point.range)||!s.policy.canInteract(s.context,player.state,id))return null;
  if(point.kind==='beacon'&&!(player.state.quests.status.q3==='done'||player.state.flags.beaconLit||activeObjective(player.state.quests,'beacon')))return null;
  if((point.kind==='crystal'||point.kind==='waystone'||point.kind==='explore')&&(!point.objective||!activeObjective(player.state.quests,point.objective)))return null;
  if(point.kind==='gate'){const chapter=point.destination==='w1'?1:point.destination==='w2'?2:3;if(!canTravelTo(chapter,player.state.flags))return null;const u=s.getUnit(player.state.unit)!;if(s.time-u.lastCombat<5)return null;}
  return point;
 }
 private npc(player:PlayerSim,id:string):boolean {const s=this.services,npc=s.definition.npcs.find(n=>n.id===id);return !!npc&&this.near(player,npc.position,8)&&s.policy.canInteract(s.context,player.state,`npc:${id}`);}
 interact(ref:EntityRef,id:string):boolean {const player=this.player(ref);if(!player)return false;const s=this.services;
  if(id.startsWith('npc:')){const npc=id.slice(4);if(!this.npc(player,npc))return false;const unit=s.players().find(u=>u.npcId===npc);player.state.talkTarget=unit?.ref??null;if(npc==='silvermoon')questBump(player,s,'deliver');if(npc==='coralline')questBump(player,s,'deliver-supplies');return true;}
  const point=this.validate(player,id);if(!point)return false;
  if(point.kind==='beacon'||point.kind==='waystone'){if(player.state.channel||player.state.cast||player.state.dash)return false;const unit=s.getUnit(ref)!;player.state.target=null;unit.yaw=Math.atan2(point.position.x-unit.x,point.position.z-unit.z);player.startChannel(point.kind==='beacon'?'beacon':'waystone',point.kind==='beacon'?2:1.5,point.position,point.id);return true;}
  if(point.kind==='crystal'||point.kind==='explore'){questBump(player,s,point.objective!);return true;}
  if(point.kind==='gate'&&point.destination){s.emit({type:'travelReady',unit:ref,destination:point.destination,gate:point.id});return true;}
  return false;
 }
 command(ref:EntityRef,command:PlayerCommand):boolean {const p=this.player(ref);if(!p)return false;const s=this.services;
  if(command.kind==='interact')return this.interact(ref,command.targetId);
  if(command.kind==='travel')return this.interact(ref,command.gateId);
  if(command.kind==='forgeBuy'){if(command.npcId!=='pip'||!this.npc(p,'pip')||p.state.attackRank>=100||p.state.coins<forgeCost(p.state.attackRank))return false;p.state.coins-=forgeCost(p.state.attackRank);p.state.attackRank++;return true;}
  if(command.kind==='questAccept'||command.kind==='questTurnIn'){const def=QUESTS[command.questId];if(!def||def.chapter!==p.state.quests.chapter||!this.npc(p,command.npcId))return false;
   if(command.kind==='questAccept'){if(def.giver!==command.npcId||p.state.quests.status[def.id]!=='available'||def.id==='q4')return false;return questAccept(p,s,def.id);}
   if(def.turnIn!==command.npcId||p.state.quests.status[def.id]!=='ready')return false;return questComplete(p,s,def.id);
  }return false;
 }
 completeChannel(player:PlayerSim,channel:ChannelState):void {if(channel.kind==='recall')return;const point=channel.targetId?this.validate(player,channel.targetId):null;if(!point||point.kind!==channel.kind)return;
  if(point.kind==='waystone'){questBump(player,this.services,point.objective!);return;}
  this.world.beaconLit=!this.world.beaconLit;
  for(const unit of this.services.players()){const p=this.services.player(unit.ref);if(!p)continue;p.state.flags.beaconLit=this.world.beaconLit;if(this.world.beaconLit)questBump(p,this.services,'beacon');}
 }
 update():void {for(const unit of this.services.players()){const p=this.player(unit.ref);if(!p)continue;for(const point of this.services.definition.interactions)if(point.kind==='explore'&&this.validate(p,point.id))questBump(p,this.services,point.objective!);}}
 debugState():{beaconLit:boolean}{return {beaconLit:this.world.beaconLit};}
}
