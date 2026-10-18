import type { Area, AreaServices, AwardMailbox, CharacterId, CharacterRegistry, EarnedGrant, EntityRef, PlayerSim, PlayerState, SimUnit, TransferCoordinator, TransferDTO, WorldId } from './types.ts';
import { levelForXp } from './data/progression.ts';
import { setQuestChapter } from './data/quests.ts';
const copy=<T>(value:T):T=>structuredClone(value);
const sameRef=(a:EntityRef|null,b:EntityRef|null):boolean=>a===null?b===null:b!==null&&a.area===b.area&&a.id===b.id&&a.life===b.life;
const remaining=(deadline:number,now:number):number=>Math.max(0,deadline-now);
const age=(start:number,now:number):number=>Math.max(0,now-start);
export function captureTransfer(services:AreaServices,player:PlayerSim,appliedGrantIds:readonly string[]=[]):TransferDTO {
 const p=player.state,u=services.getUnit(p.unit);if(!u||!u.alive)throw new Error('travel-unavailable');const member=services.context.members.find(m=>m.character===p.character);if(member?.seatedBoat||member?.villagePlaying)throw new Error('travel-busy');const now=services.time;
 return copy({version:'s2-transfer-v1',character:p.character,classId:p.classId,archetype:u.archetype,hp:u.hp,maxHp:u.maxHp,resource:p.resource,maxResource:p.maxResource,xp:p.xp,coins:p.coins,attackRank:p.attackRank,baseMaxHp:p.baseMaxHp,
 cooldowns:Object.fromEntries(Object.entries(p.cooldowns).map(([id,c])=>[id,{startAge:age(c.start,now),endRemaining:remaining(c.end,now)}])),gcd:{startAge:age(p.gcdStart,now),endRemaining:remaining(p.gcdEnd,now)},
 status:{stunRemaining:remaining(u.stunUntil,now),slowRemaining:remaining(u.slowUntil,now),slowPct:u.slowPct,rustRemaining:remaining(u.rustUntil,now),rust:u.rust,absorbRemaining:remaining(u.absorbUntil,now),absorb:u.absorb,absorbMax:u.absorbMax,blessingRemaining:remaining(u.blessingUntil,now)},history:{combatAge:age(u.lastCombat,now),spendAge:age(p.lastSpend,now),attackAge:age(p.lastAttack,now),nextSwingRemaining:remaining(p.nextSwing,now)},quests:p.quests,flags:p.flags,cogMisses:p.cogMisses,appliedGrantIds:[...appliedGrantIds]});
}
/** Restores only retained values onto a newly allocated actor at its admitted spawn. */
export function restoreTransfer(dto:TransferDTO,unit:SimUnit,state:PlayerState,now:number,destinationWorld:WorldId):void {
 if(dto.version!=='s2-transfer-v1'||state.character!==dto.character)throw new Error('transfer-identity');const d=copy(dto);
 Object.assign(unit,{hp:d.hp,maxHp:d.maxHp,alive:true,level:levelForXp(d.xp),stunUntil:now+d.status.stunRemaining,slowUntil:now+d.status.slowRemaining,slowPct:d.status.slowRemaining>0?d.status.slowPct:0,rustUntil:now+d.status.rustRemaining,rust:d.status.rustRemaining>0?d.status.rust:0,absorbUntil:now+d.status.absorbRemaining,absorb:d.status.absorbRemaining>0?d.status.absorb:0,absorbMax:d.status.absorbMax,blessingUntil:now+d.status.blessingRemaining,encounterBlessing:false,lastCombat:now-d.history.combatAge,pushX:0,pushZ:0,pushTime:0,lift:0,pendingHit:null,actions:[]});
 Object.assign(state,{unit:unit.ref,resource:d.resource,maxResource:d.maxResource,xp:d.xp,coins:d.coins,attackRank:d.attackRank,baseMaxHp:d.baseMaxHp,cooldowns:Object.fromEntries(Object.entries(d.cooldowns).map(([id,c])=>[id,{start:now-c.startAge,end:now+c.endRemaining}])),gcdStart:now-d.gcd.startAge,gcdEnd:now+d.gcd.endRemaining,lastSpend:now-d.history.spendAge,lastAttack:now-d.history.attackAge,nextSwing:now+d.history.nextSwingRemaining,quests:d.quests,flags:d.flags,cogMisses:d.cogMisses,warded:d.status.absorbRemaining>0&&d.status.absorb>0,cast:null,channel:null,target:null,queued:null,velX:0,velZ:0,jumpT:0,spinT:0,targetDeadAt:0,dash:null,deadUntil:null,controlsLocked:false,talkTarget:null});
 setQuestChapter(state.quests,destinationWorld==='w1'?1:destinationWorld==='w2'?2:3);
}
export class InMemoryCharacterRegistry implements CharacterRegistry {
 private readonly owners=new Map<CharacterId,EntityRef>();
 owner(character:CharacterId):EntityRef|null {return copy(this.owners.get(character)??null);}
 compareAndSwap(character:CharacterId,expected:EntityRef|null,next:EntityRef|null):boolean {if(!sameRef(this.owners.get(character)??null,expected))return false;if(next)this.owners.set(character,copy(next));else this.owners.delete(character);return true;}
}
function freezeGrant(grant:EarnedGrant):EarnedGrant {const g=copy(grant);Object.freeze(g.victim);for(const o of g.objectives)Object.freeze(o);Object.freeze(g.objectives);Object.freeze(g.flags);return Object.freeze(g);}
/** Retains acknowledged IDs: pruning is a host lifecycle decision, never an eviction. */
export class InMemoryAwardMailbox implements AwardMailbox {
 private readonly entries=new Map<string,{grant:EarnedGrant;applied:boolean}>();
 record(grant:EarnedGrant,alreadyAppliedToOwner:boolean):'recorded'|'duplicate' {const old=this.entries.get(grant.id);if(old){if(JSON.stringify(old.grant)!==JSON.stringify(grant))throw new Error('grant-id-content-conflict');if(alreadyAppliedToOwner)old.applied=true;return 'duplicate';}this.entries.set(grant.id,{grant:freezeGrant(grant),applied:alreadyAppliedToOwner});return 'recorded';}
 pending(character:CharacterId):readonly EarnedGrant[] {return [...this.entries.values()].filter(e=>e.grant.recipient===character&&!e.applied).map(e=>copy(e.grant));}
 acknowledgeApplied(character:CharacterId,grantId:string):void {const e=this.entries.get(grantId);if(!e||e.grant.recipient!==character)throw new Error('unknown-grant');e.applied=true;}
 debugState():readonly {grant:EarnedGrant;applied:boolean}[] {return copy([...this.entries.values()]);}
}
export class InMemoryTransferCoordinator implements TransferCoordinator {
 readonly characters:CharacterRegistry;readonly awards:AwardMailbox;
 constructor(characters:CharacterRegistry=new InMemoryCharacterRegistry(),awards:AwardMailbox=new InMemoryAwardMailbox()){this.characters=characters;this.awards=awards;}
 /** Record before acknowledging. A mailbox exception leaves the source entitlement intact. */
 journal(area:Area):void {for(const entry of area.pendingGrants()){this.awards.record(entry.grant,entry.appliedHere);area.acknowledgeGrant(entry.grant.id);}}
 deliver(area:Area,character:CharacterId):void {for(const grant of this.awards.pending(character)){const result=area.receiveGrant(grant);if(result!=='not-owner')this.awards.acknowledgeApplied(character,grant.id);}}
 transfer(character:CharacterId,source:Area,destination:Area,gate:string,hostTick:number):{ok:true;ref:EntityRef}|{ok:false;reason:string} {
  if(source===destination)return {ok:false,reason:'same-area'};const owner=this.characters.owner(character);if(!owner||owner.area!==source.services.id)return {ok:false,reason:'not-owner'};
  const player=source.services.playerByCharacter(character),unit=player&&source.services.getUnit(player.state.unit),member=source.services.context.members.find(m=>m.character===character);
  if(!player||!unit?.alive||!sameRef(owner,unit.ref)||member?.seatedBoat||member?.villagePlaying||player.state.controlsLocked)return {ok:false,reason:'travel-busy'};
  const point=source.services.definition.interactions.find(i=>i.id===gate&&i.kind==='gate');
  if(!point||point.destination!==destination.services.world||Math.hypot(unit.x-point.position.x,unit.y-point.position.y,unit.z-point.position.z)>point.range||!source.services.policy.canInteract(source.services.context,player.state,gate))return {ok:false,reason:'invalid-gate'};
  const chapter=destination.services.world==='w1'?1:destination.services.world==='w2'?2:3;
  if(chapter>=2&&(!player.state.flags.abyssCleared||chapter===3&&!player.state.flags.trueCleared))return {ok:false,reason:'locked-world'};
  if(source.services.encounterActive()||source.services.time-unit.lastCombat<5)return {ok:false,reason:'in-combat'};
  let admission:ReturnType<Area['reserveAdmission']>=null,departure:ReturnType<Area['stageDeparture']>|null=null,arrival:ReturnType<Area['stageArrival']>|null=null;
  try {admission=destination.reserveAdmission(character,destination.services.definition.spawn.id,hostTick);if(!admission)return {ok:false,reason:'destination-full'};departure=source.stageDeparture(unit.ref);arrival=destination.stageArrival(admission,departure.dto);this.journal(source);
   if(!this.characters.compareAndSwap(character,owner,arrival.newRef))throw new Error('registry-conflict');
  }catch(error){if(arrival)destination.abortArrival(arrival.token);if(departure)source.abortDeparture(departure.token);if(admission)destination.releaseAdmission(admission.token);return {ok:false,reason:error instanceof Error?error.message:'transfer-failed'};}
  // Contract: no observer/tick/I/O here, these operations cannot fail after registry CAS.
  source.commitDeparture(departure!.token);const ref=destination.activateArrival(arrival!.token);destination.releaseAdmission(admission!.token);return {ok:true,ref};
 }
}
