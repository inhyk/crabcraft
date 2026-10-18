import type { AreaServices, BossSim, CharacterId, Contribution, EarnedGrant, EntityRef, PlayerCommand, PlayerSim, ChannelState, TimerAction } from './types.ts';
import { enemyStats } from './data/enemies.ts';
import { BOSS_PROFILES } from './data/bosses.ts';
import { worldChapter } from './math.ts';
import { canChallenge, canReplayFrostEnding, patrolReward } from './data/progression.ts';
import { activeObjective, QUESTS, questBump } from './data/quests.ts';
import { InteractionRules } from './interactions.ts';
const key=(ref:EntityRef):string=>JSON.stringify([ref.area,ref.id,ref.life]);
const copy=<T>(value:T):T=>structuredClone(value);
interface Credit { character:CharacterId; cogEligible:boolean; cogMisses:number; flags:Record<string,boolean> }
interface VictimCredit {victim:EntityRef;contributors:Map<CharacterId,Credit>}
const FLAGS:Readonly<Record<BossSim['profile'],string>>=Object.freeze({rust:'rustCleared',abyss:'abyssCleared',eclipse:'trueCleared',dawn:'finalCleared',frost:'frostCleared'});
/** Lifetime contribution ownership and synchronous real progression. No visual callback grants. */
export class WorldRules {
 readonly services:AreaServices;
 beaconLit=false;
 private readonly credits=new Map<string,VictimCredit>();
 private readonly settled=new Set<string>();
 private readonly grants=new Map<string,{grant:EarnedGrant;appliedHere:boolean;acknowledged:boolean}>();
 private readonly applied=new Map<CharacterId,Set<string>>();
 private readonly interactions:InteractionRules;
 constructor(services:AreaServices){this.services=services;this.interactions=new InteractionRules(services,this);}
 recordContribution(victim:EntityRef,attacker:EntityRef,damage:number):void {if(!Number.isFinite(damage)||damage<=0||victim.area!==this.services.id)return;const player=this.services.player(attacker),unit=this.services.getUnit(victim);if(!player||!unit||unit.reaction!=='hostile')return;const k=key(victim);if(this.settled.has(k))return;let entry=this.credits.get(k);if(!entry){entry={victim:copy(victim),contributors:new Map()};this.credits.set(k,entry);}const p=player.state;entry.contributors.set(p.character,{character:p.character,cogEligible:activeObjective(p.quests,'collect-cog'),cogMisses:p.cogMisses,flags:copy(p.flags)});}
 onUnitDied(victim:EntityRef,killer:EntityRef|null):void {
  const s=this.services,u=s.getUnit(victim),k=key(victim);if(!u||this.settled.has(k))return;
  // A kill source also contributes if direct kill() bypassed damage(), as in debug/trusted combat.
  if(killer&&!this.credits.get(k)?.contributors.size)this.recordContribution(victim,killer,1);
  this.settled.add(k);const entry=this.credits.get(k);if(!entry)return;
  const characters:CharacterId[]=[],planned:EarnedGrant[]=[];
  for(const original of [...entry.contributors.values()].sort((a,b)=>a.character<b.character?-1:a.character>b.character?1:0)){
   const player=s.playerByCharacter(original.character),credit:Credit=player?{character:original.character,cogEligible:activeObjective(player.state.quests,'collect-cog'),cogMisses:player.state.cogMisses,flags:player.state.flags}:original;
   let xp=0,coins=0;const objectives:{kind:string;amount:number}[]=[],flags:string[]=[];
   if(u.kind==='scrapling'||u.kind==='scavenger'||u.kind==='jellyfish'){
    const controller=s.controller(victim),spawnId=controller&&'spawnId' in controller&&typeof controller.spawnId==='string'?controller.spawnId:null,spawn=s.definition.enemies.find(e=>e.id===spawnId),role=spawn?.role??(spawnId?.includes(':add:')?'add':'ordinary');
    const stats=enemyStats(u.kind,u.level,worldChapter(s.world),role);
    if(role!=='add'){xp=stats.xp;coins=Math.max(5,Math.round(stats.xp/4));if(s.world!=='w1'||credit.flags.rustCleared)objectives.push({kind:'patrol-kill',amount:1});}
    if(u.kind==='scrapling'){objectives.push({kind:'kill-scrapling',amount:1});if(credit.cogEligible)objectives.push({kind:'cog-roll',amount:s.random.next()});}
    else if(u.kind==='scavenger')objectives.push({kind:'kill-scavenger',amount:1});
   }else if(u.kind==='boss'){
    const controller=s.controller(victim),profile=controller&&'profile' in controller?controller.profile:null;if(typeof profile!=='string'||!(profile in BOSS_PROFILES))continue;const id=profile as BossSim['profile'];xp=BOSS_PROFILES[id].reward;coins=BOSS_PROFILES[id].coins;flags.push(FLAGS[id]);if(id==='eclipse'||id==='dawn')objectives.push({kind:'boss-xp-blessing',amount:1});if(id!=='abyss')objectives.push({kind:id==='eclipse'?'eclipse-boss':id==='dawn'?'dawn-boss':id==='frost'?'frost-boss':'boss',amount:1});objectives.push({kind:'clear-encounter-blessing',amount:1});
   }else continue;
   const grant:EarnedGrant={id:JSON.stringify([victim.area,victim.id,victim.life,credit.character]),victim:copy(victim),recipient:credit.character,xp,coins,objectives,flags};
   planned.push(grant);this.grants.set(grant.id,{grant:copy(grant),appliedHere:false,acknowledged:false});characters.push(credit.character);
  }
  // All entitlements exist before mutating the first recipient. Capacity failure retains the full batch.
  s.preflightEarnedGrants(planned);
  for(const grant of planned){const appliedHere=this.applyGrant(grant)!=='not-owner';this.grants.get(grant.id)!.appliedHere=appliedHere;s.emit({type:'reward',grant,appliedHere});}
  if(u.kind==='boss'&&characters.length){s.timers.schedule(s.time+1.8,{kind:'victory',boss:copy(victim),recipients:characters,stage:'banner'});s.timers.schedule(s.time+5,{kind:'victory',boss:copy(victim),recipients:characters,stage:'end'});}
 }
 applyGrant(grant:EarnedGrant):'applied'|'duplicate'|'not-owner' {
  for(const o of grant.objectives)if(o.kind==='cog-roll'&&(!Number.isFinite(o.amount)||o.amount<0||o.amount>=1))throw new Error('invalid-cog-roll');
  const s=this.services,p=s.playerByCharacter(grant.recipient);if(!p)return 'not-owner';let ids=this.applied.get(grant.recipient);if(ids?.has(grant.id))return 'duplicate';s.preflightEarnedGrants([grant]);if(!ids){ids=new Set();this.applied.set(grant.recipient,ids);}
  const unit=s.getUnit(p.state.unit);if(!unit)return 'not-owner';const priorState=copy(p.state),priorUnit=copy(unit);let cogPresentation=false;
  try{s.outcomeTransaction(()=>{const grantsBlessing=grant.objectives.some(o=>o.kind==='boss-xp-blessing');if(grantsBlessing)p.state.cooldowns['boss-xp-blessing']={start:s.time,end:s.time+600};p.gainXp(grant.xp,!grantsBlessing);p.state.coins=Math.min(Number.MAX_SAFE_INTEGER,p.state.coins+grant.coins);
  for(const flag of grant.flags)p.state.flags[flag]=true;
  for(const o of grant.objectives){if(o.kind==='boss-xp-blessing')continue;else if(o.kind==='clear-encounter-blessing'){const u=s.getUnit(p.state.unit);if(u){u.blessingUntil=0;u.encounterBlessing=false;}}else if(o.kind==='cog-roll'){const objective=QUESTS.q1.objectives.find(o=>o.kind==='collect-cog')!;if(p.state.quests.status.q1!=='active'||(p.state.quests.progress[objective.id]??0)>=objective.count)continue;if(o.amount<.7||p.state.cogMisses>=2){p.state.cogMisses=0;questBump(p,s,'collect-cog',1,true);cogPresentation=true;}else p.state.cogMisses++;}else if(o.kind==='cog-reset')p.state.cogMisses=0;else if(o.kind==='cog-miss')p.state.cogMisses++;else if(o.kind==='patrol-kill'){const kills=(p.state.quests.progress['patrol-kills']??0)+o.amount;p.state.quests.progress['patrol-kills']=kills%5;if(kills>=5){const u=s.getUnit(p.state.unit);if(u)p.gainXp(patrolReward(u.level)*Math.floor(kills/5));}}else questBump(p,s,o.kind,o.amount,true);}
  });}catch(error){Object.assign(p.state,priorState);Object.assign(unit,priorUnit);throw error;}
  ids.add(grant.id);const retained=this.grants.get(grant.id);if(retained)retained.appliedHere=true;if(cogPresentation)s.timers.schedule(s.time+.45,{kind:'lootPresentation',grantId:grant.id,corpse:copy(grant.victim),recipient:grant.recipient,item:'cog'});return 'applied';
 }
 pendingGrants():readonly {grant:EarnedGrant;appliedHere:boolean}[]{return [...this.grants.values()].filter(e=>!e.acknowledged).map(({grant,appliedHere})=>({grant:copy(grant),appliedHere}));}
 acknowledgeGrant(id:string):void {const entry=this.grants.get(id);if(!entry)throw new Error('unknown-grant');entry.acknowledged=true;}
 appliedGrantIds(character:CharacterId):readonly string[]{return [...(this.applied.get(character)??[])];}
 restoreAppliedGrantIds(character:CharacterId,ids:readonly string[]):void {const known=this.applied.get(character)??new Set<string>();for(const id of ids)known.add(id);this.applied.set(character,known);}
 /** Recovery-only replacement after restoring the matching durable state; outbox history is retained. */
 replaceAppliedGrantIds(character:CharacterId,ids:readonly string[]):void {if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length===0||new TextEncoder().encode(id).length>512))throw new Error('invalid-applied-grant-ids');this.applied.set(character,new Set(ids));}
 encounterAvailable(profile:BossSim['profile']):boolean {if((profile==='rust'||profile==='abyss')&&(!this.beaconLit||this.services.world!=='w1'))return false;return this.services.players().some(u=>{const p=this.services.player(u.ref);return !!p&&u.alive&&!u.hidden&&canChallenge(u.level,BOSS_PROFILES[profile].level,!!p.state.flags.rustCleared,!!p.state.flags.abyssCleared,worldChapter(this.services.world));});}
 setSharedBeacon(lit:boolean):void {this.interactions.setSharedBeacon(lit);}
 command(player:EntityRef,command:PlayerCommand):boolean{return this.interactions.command(player,command);}
 interact(player:EntityRef,id:string):boolean{return this.interactions.interact(player,id);}
 completeChannel(player:PlayerSim,channel:ChannelState):void {this.interactions.completeChannel(player,channel);}
 purgeActor(ref:EntityRef):void {this.interactions.purgeActor(ref);}
 update():void {this.interactions.update();const s=this.services,boss=s.bossByProfile('rust');if(s.world==='w1'&&this.beaconLit&&boss?.state==='dormant'&&s.players().some(u=>u.alive&&u.level>=3&&!s.player(u.ref)?.state.flags.rustCleared))boss.wake();if(s.world==='w4'){const frost=s.bossByProfile('frost');for(const u of s.players()){const p=s.player(u.ref);if(p&&!p.state.flags.frostEndingStarted&&canReplayFrostEnding(4,p.state.flags,frost?.state??'dormant',p.state.controlsLocked)){p.state.flags.frostEndingStarted=true;s.emit({type:'endingReady',unit:p.state.unit,chapter:4,replay:false});}}}}
 onTimer(action:TimerAction):void {const s=this.services;if(action.kind==='lootPresentation'){const p=s.playerByCharacter(action.recipient);if(p)s.emit({type:'loot',unit:action.corpse,recipient:p.state.unit,item:'cog'});}else if(action.kind==='victory'){const recipients=action.recipients.flatMap(c=>{const p=s.playerByCharacter(c);return p?[p.state.unit]:[];});s.emit({type:'victory',boss:action.boss,recipients,stage:action.stage});}}
 debugState():{contributions:Contribution[];grants:EarnedGrant[];acknowledgedGrantIds:string[];interactions:ReturnType<InteractionRules['debugState']>&{credits:readonly object[];settled:readonly string[];applied:readonly object[]}} {return {contributions:[...this.credits.values()].map(e=>({victim:copy(e.victim),contributors:[...e.contributors.keys()]})),grants:[...this.grants.values()].map(e=>copy(e.grant)),acknowledgedGrantIds:[...this.grants.values()].filter(e=>e.acknowledged).map(e=>e.grant.id),interactions:{...this.interactions.debugState(),credits:[...this.credits.values()].map(e=>({victim:copy(e.victim),contributors:copy([...e.contributors.values()])})),settled:[...this.settled],applied:[...this.applied].map(([character,ids])=>({character,ids:[...ids]}))}};}
}
