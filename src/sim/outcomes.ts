import { immutable } from './events.ts';
import { DirtyContributionLedger, canonicalLedgerValue, initialPlannerCursor, planOutcomePage, residentOutcomePage, reserveDeathOutcome, sourceStepRequirements, stagedSourceBytes, validateContributionSummary, validateContributionSnapshot, validatePlannerCursor } from './ledger.ts';
import type { ContributionSnapshot, ContributionSummary, CreditBatch, DeathRecipe, DeathReservation, LedgerMode, PagedOutcomeSeal, PlannedPage, PlannerCursor, VictimRewardFacts } from './ledger.ts';
import { NumericExploration } from './features/exploration.ts';
import type { AreaServices, BossSim, CharacterId, Contribution, EarnedGrant, EntityRef, PlayerCommand, PlayerSim, ChannelState, TimerAction } from './types.ts';
import { enemyStats } from './data/enemies.ts';
import { BOSS_PROFILES } from './data/bosses.ts';
import { worldChapter } from './math.ts';
import { canChallenge, canPresentFrostEnding, patrolReward } from './data/progression.ts';
import { activeObjective, QUESTS, questBump } from './data/quests.ts';
import { InteractionRules } from './interactions.ts';
const key=(ref:EntityRef):string=>JSON.stringify([ref.area,ref.id,ref.life]);
const copy=<T>(value:T):T=>structuredClone(value);
interface Credit { character:CharacterId; cogEligible:boolean; cogMisses:number; flags:Record<string,boolean> }
export type SourceLedgerLimits={maxDirtyCreditEntries:number;maxDirtyCreditBytes:number;maxPendingDeaths:number;maxStagedBytes:number};
export type OutcomeCapture={token:string;generation:number;victim:EntityRef;recipe:DeathRecipe;initialCursor:PlannerCursor};
type LiveCredit={victim:EntityRef;throughVersion:number;summary:ContributionSummary|null};
type StagedDeath={capture:OutcomeCapture;reservation:Pick<DeathReservation,'random'|'residentGrants'>;cursor:PlannerCursor;verifiedResidents:Set<string>;bytes:number};
const compare=(a:string,b:string):number=>a<b?-1:a>b?1:0;
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
 private contributionCount=0;
 private acknowledgedCount=0;
 private appliedCount=0;
 readonly ledgerMode:LedgerMode;
 private readonly dirty:DirtyContributionLedger|null;
 private readonly sourceLimits:SourceLedgerLimits|null;
 private readonly liveCredits=new Map<number,LiveCredit>();
 private readonly currentSettled=new Map<number,number>();
 private readonly stagedDeaths=new Map<string,StagedDeath>();
 private stagedBytes=0;
 private summaryCount=0;
 private observationVersion=0;
 private nextOutcomeToken=1;
 private preparedRoster:string|null=null;
 private preparedLives=0;
 private readonly preparedVictims=new Set<string>();
 private readonly interactions:InteractionRules;
 private readonly exploration:NumericExploration;
 constructor(services:AreaServices,options?:{mode:'external-durable';limits:SourceLedgerLimits}){if(options&&(options.mode!=='external-durable'||new TextEncoder().encode(services.id).length>256))throw new Error('ledger-invalid-source-options');this.services=services;this.ledgerMode=options?.mode??'retained';this.sourceLimits=options?copy(options.limits):null;if(this.sourceLimits){const names=['maxDirtyCreditEntries','maxDirtyCreditBytes','maxPendingDeaths','maxStagedBytes'];if(Object.keys(this.sourceLimits).length!==names.length||names.some(k=>!Object.hasOwn(this.sourceLimits!,k)))throw new Error('ledger-invalid-limits');for(const n of Object.values(this.sourceLimits))if(!Number.isSafeInteger(n)||n<=0)throw new Error('ledger-invalid-limits');}this.dirty=this.sourceLimits?new DirtyContributionLedger(services.id,{maxEntries:this.sourceLimits.maxDirtyCreditEntries,maxBytes:this.sourceLimits.maxDirtyCreditBytes}):null;this.interactions=new InteractionRules(services,this);this.exploration=new NumericExploration(services);}
 recordContribution(victim:EntityRef,attacker:EntityRef,damage:number):void {if(this.dirty){this.recordExternalContribution(victim,attacker,damage);return;}if(!Number.isFinite(damage)||damage<=0||victim.area!==this.services.id)return;const player=this.services.player(attacker),unit=this.services.getUnit(victim);if(!player||!unit||unit.reaction!=='hostile')return;const k=key(victim);if(this.settled.has(k))return;let entry=this.credits.get(k);if(!entry){entry={victim:copy(victim),contributors:new Map()};this.credits.set(k,entry);}const p=player.state;if(!entry.contributors.has(p.character))this.contributionCount++;entry.contributors.set(p.character,{character:p.character,cogEligible:activeObjective(p.quests,'collect-cog'),cogMisses:p.cogMisses,flags:copy(p.flags)});}
 onUnitDied(victim:EntityRef,killer:EntityRef|null):void {
  if(this.dirty){this.onExternalDeath(victim,killer);return;}
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
 applyGrant(grant:EarnedGrant):'applied'|'duplicate'|'not-owner' {if(this.dirty)throw new Error('ledger-certified-grant-required');return this.applyOwnedGrant(grant);}
 /** Only the Area's generation/revision-certified wrapper may call this external boundary. */
 applyCertifiedGrant(grant:EarnedGrant):'applied'|'duplicate'|'not-owner' {return this.applyOwnedGrant(grant);}
 private applyOwnedGrant(grant:EarnedGrant):'applied'|'duplicate'|'not-owner' {
  for(const o of grant.objectives)if(o.kind==='cog-roll'&&(!Number.isFinite(o.amount)||o.amount<0||o.amount>=1))throw new Error('invalid-cog-roll');
  const s=this.services,p=s.playerByCharacter(grant.recipient);if(!p)return 'not-owner';let ids=this.applied.get(grant.recipient);if(ids?.has(grant.id))return 'duplicate';s.preflightEarnedGrants([grant]);
  const unit=s.getUnit(p.state.unit);if(!unit)return 'not-owner';const priorState=copy(p.state),priorUnit=copy(unit);let cogPresentation=false;
  try{s.outcomeTransaction(()=>{if(grant.objectives.some(o=>o.kind==='boss-xp-blessing'))p.state.cooldowns['boss-xp-blessing']={start:s.time,end:s.time+600};p.gainXp(grant.xp);p.state.coins=Math.min(Number.MAX_SAFE_INTEGER,p.state.coins+grant.coins);
  for(const flag of grant.flags)p.state.flags[flag]=true;
  for(const o of grant.objectives){if(o.kind==='boss-xp-blessing')continue;else if(o.kind==='clear-encounter-blessing'){const u=s.getUnit(p.state.unit);if(u){u.blessingUntil=0;u.encounterBlessing=false;}}else if(o.kind==='cog-roll'){const objective=QUESTS.q1.objectives.find(o=>o.kind==='collect-cog')!;if(p.state.quests.status.q1!=='active'||(p.state.quests.progress[objective.id]??0)>=objective.count)continue;if(o.amount<.7||p.state.cogMisses>=2){p.state.cogMisses=0;questBump(p,s,'collect-cog',1,true);cogPresentation=true;}else p.state.cogMisses++;}else if(o.kind==='cog-reset')p.state.cogMisses=0;else if(o.kind==='cog-miss')p.state.cogMisses++;else if(o.kind==='patrol-kill'){const kills=(p.state.quests.progress['patrol-kills']??0)+o.amount;p.state.quests.progress['patrol-kills']=kills%5;if(kills>=5){const u=s.getUnit(p.state.unit);if(u)p.gainXp(patrolReward(u.level)*Math.floor(kills/5));}}else questBump(p,s,o.kind,o.amount,true);}
  this.exploration.observePlayer(p,true);
  });}catch(error){Object.assign(p.state,priorState);Object.assign(unit,priorUnit);throw error;}
  if(!ids){ids=new Set();this.applied.set(grant.recipient,ids);}ids.add(grant.id);this.appliedCount++;const retained=this.grants.get(grant.id);if(retained)retained.appliedHere=true;if(cogPresentation)s.timers.schedule(s.time+.45,{kind:'lootPresentation',grantId:grant.id,corpse:copy(grant.victim),recipient:grant.recipient,item:'cog'});return 'applied';
 }
 pendingGrants():readonly {grant:EarnedGrant;appliedHere:boolean}[]{return [...this.grants.values()].filter(e=>!e.acknowledged).map(({grant,appliedHere})=>({grant:copy(grant),appliedHere}));}
 acknowledgeGrant(id:string):void {const entry=this.grants.get(id);if(!entry)throw new Error('unknown-grant');if(!entry.acknowledged){entry.acknowledged=true;this.acknowledgedCount++;}}
 appliedGrantIds(character:CharacterId):readonly string[]{return [...(this.applied.get(character)??[])];}
 restoreAppliedGrantIds(character:CharacterId,ids:readonly string[]):void {if(!ids.length)return;const known=this.applied.get(character)??new Set<string>();for(const id of ids)if(!known.has(id)){known.add(id);this.appliedCount++;}this.applied.set(character,known);}
 /** Recovery-only replacement after restoring the matching durable state; outbox history is retained. */
 replaceAppliedGrantIds(character:CharacterId,ids:readonly string[]):void {if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length===0||new TextEncoder().encode(id).length>512))throw new Error('invalid-applied-grant-ids');this.appliedCount+=ids.length-(this.applied.get(character)?.size??0);if(ids.length)this.applied.set(character,new Set(ids));else this.applied.delete(character);}
 /** Low-level exact durable-capture pruning; the owning Area validates ledger mode/revision/capture first. */
 pruneAppliedGrantIds(character:CharacterId,ids:readonly string[]):void {const known=this.applied.get(character);if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id||new TextEncoder().encode(id).length>512||!known?.has(id)))throw new Error('invalid-applied-grant-ids');for(const id of ids)known!.delete(id);this.appliedCount-=ids.length;if(known?.size===0)this.applied.delete(character);}
 resourceUsage():{contributionEntries:number;settledVictims:number;pendingGrants:number;acknowledgedGrantIds:number;appliedGrantIds:number} {return {contributionEntries:this.contributionCount,settledVictims:this.dirty?this.currentSettled.size:this.settled.size,pendingGrants:this.grants.size-this.acknowledgedCount,acknowledgedGrantIds:this.acknowledgedCount,appliedGrantIds:this.appliedCount};}
 /** Current residents only, including dead/projectile owners. Never a lifetime contributor list. */
 residentCreditSnapshots():readonly ContributionSnapshot[] {return immutable(this.services.players().flatMap(u=>{const p=this.services.player(u.ref);return p?[this.creditSnapshot(p)]:[];}).sort((a,b)=>compare(a.character,b.character)));}
 private creditSnapshot(player:PlayerSim):ContributionSnapshot {const p=player.state;return validateContributionSnapshot({character:p.character,cogEligible:activeObjective(p.quests,'collect-cog'),cogMisses:p.cogMisses,flags:p.flags});}
 private rosterKey():string {return canonicalLedgerValue(this.residentCreditSnapshots().map(c=>c.character));}
 private requireExternal():DirtyContributionLedger {if(!this.dirty)throw new Error('ledger-external-mode-required');return this.dirty;}
 private assertPrepared():void {if(this.preparedRoster===null||this.preparedRoster!==this.rosterKey())throw new Error('ledger-step-not-prepared');}
 /** Called outside the Area running/fail-stop block before any accepted input or damage. */
 preflightCreditCapacity(maxVictimLives:number,residents:readonly ContributionSnapshot[]):void {
  const dirty=this.requireExternal(),limits=this.sourceLimits!;this.preparedRoster=null;
  if(!Number.isSafeInteger(maxVictimLives)||maxVictimLives<0||!Array.isArray(residents)||residents.length>100)throw new Error('ledger-invalid-step-bound');
  const actual=this.residentCreditSnapshots();if(canonicalLedgerValue(residents)!==canonicalLedgerValue(actual))throw new Error('ledger-resident-snapshot-mismatch');
  const required=sourceStepRequirements(this.services.id,this.services.world,maxVictimLives,actual),max=Number.MAX_SAFE_INTEGER;
  dirty.assertCapacity(required.maxDirtyCreditEntries,required.maxDirtyCreditBytes);
  if(required.maxPendingDeaths>limits.maxPendingDeaths||required.maxStagedBytes>limits.maxStagedBytes||required.receiptsPerResident>256)throw new Error('ledger-unsupported-step-capacity');
  if(this.stagedDeaths.size)throw new Error('ledger-outcomes-pending');
  for(const c of actual)if((this.applied.get(c.character)?.size??0)+maxVictimLives>256)throw new Error('ledger-receipts-flush-required');
  this.pruneObsoleteLives();if(this.contributionSummariesNeeded().length)throw new Error('ledger-summary-required');
  if(this.nextOutcomeToken>max-maxVictimLives)throw new Error('ledger-outcome-token-exhausted');
  if(this.observationVersion>max-maxVictimLives*actual.length)throw new Error('ledger-observation-version-exhausted');
  this.preparedRoster=this.rosterKey();this.preparedLives=maxVictimLives;this.preparedVictims.clear();
 }
 private pruneObsoleteLives():void {for(const [id,life]of this.currentSettled)if(!this.services.getUnit({area:this.services.id,id,life}))this.currentSettled.delete(id);for(const [id,e]of this.liveCredits)if(!this.services.getUnit(e.victim)&&!this.dirty!.hasVictim(e.victim)){this.liveCredits.delete(id);if(e.summary)this.summaryCount--;}}
 contributionSummariesNeeded():readonly EntityRef[] {this.requireExternal();const chars=this.residentCreditSnapshots().map(c=>c.character),needed:EntityRef[]=[];for(const e of this.liveCredits.values())if(this.services.getUnit(e.victim)&&this.currentSettled.get(e.victim.id)!==e.victim.life&&(!e.summary||canonicalLedgerValue(e.summary.residents.map(r=>r.character))!==canonicalLedgerValue(chars)))needed.push(copy(e.victim));return immutable(needed);}
 /** Host installs the DB summary under its actor-generation barrier, after all dirty ACKs. */
 installContributionSummary(raw:ContributionSummary):void {const dirty=this.requireExternal(),summary=validateContributionSummary(raw),e=this.liveCredits.get(summary.victim.id);if(summary.victim.area!==this.services.id||!this.services.getUnit(summary.victim)||!e||key(e.victim)!==key(summary.victim)||this.currentSettled.get(summary.victim.id)===summary.victim.life||summary.state!=='open'||dirty.hasVictim(summary.victim)||summary.throughVersion!==e.throughVersion||canonicalLedgerValue(summary.residents.map(r=>r.character))!==canonicalLedgerValue(this.residentCreditSnapshots().map(r=>r.character)))throw new Error('ledger-invalid-summary-install');if(!e.summary)this.summaryCount++;e.summary=summary;this.preparedRoster=null;}
 captureDirtyCredits(limit:number):CreditBatch|null {return this.requireExternal().capture(limit);}
 markCreditsDurable(token:string):'acknowledged'|'not-current' {const d=this.requireExternal(),capture=d.activeCapture(),result=d.markDurable(token);if(result==='acknowledged'){for(const w of capture!.writes){const e=this.liveCredits.get(w.victim.id);if(e&&key(e.victim)===key(w.victim)&&e.summary){e.summary=null;this.summaryCount--;}}this.preparedRoster=null;}return result;}
 private newLiveCredit(victim:EntityRef):LiveCredit {const existing=this.liveCredits.get(victim.id);if(existing&&key(existing.victim)===key(victim))return existing;const summary:ContributionSummary={victim:copy(victim),sourceVersion:0,throughVersion:0,state:'open',totalContributors:0,storedEligibleTotal:0,residents:this.residentCreditSnapshots().map(c=>({character:c.character,priorCredit:null,eligibleBefore:0}))};const e={victim:copy(victim),throughVersion:0,summary:immutable(summary)};if(existing?.summary)this.summaryCount--;this.liveCredits.set(victim.id,e);this.summaryCount++;return e;}
 private useVictimBudget(victim:EntityRef):void {const k=key(victim);if(!this.preparedVictims.has(k)){if(this.preparedVictims.size>=this.preparedLives)throw new Error('ledger-atomic-life-bound-exceeded');this.preparedVictims.add(k);}}
 private recordExternalContribution(victim:EntityRef,attacker:EntityRef,damage:number):void {
  const s=this.services;if(!Number.isFinite(damage)||damage<=0||victim.area!==s.id)return;const p=s.player(attacker),u=s.getUnit(victim);if(!p||!u||u.reaction!=='hostile'||this.currentSettled.get(victim.id)===victim.life)return;
  this.assertPrepared();this.useVictimBudget(victim);const e=this.newLiveCredit(victim),credit=this.creditSnapshot(p),old=this.dirty!.writesForVictim(victim).find(w=>w.character===credit.character);if(old&&canonicalLedgerValue(old.credit)===canonicalLedgerValue(credit))return;
  if(this.observationVersion===Number.MAX_SAFE_INTEGER)throw new Error('ledger-observation-version-exhausted');const version=this.observationVersion+1;this.dirty!.record({victim,character:credit.character,version,credit});this.observationVersion=version;e.throughVersion=version;
 }
 private rewardFacts(victim:EntityRef):VictimRewardFacts|null {const s=this.services,u=s.getUnit(victim);if(!u)return null;if(u.kind==='scrapling'||u.kind==='scavenger'||u.kind==='jellyfish'){const c=s.controller(victim),spawnId=c&&'spawnId'in c&&typeof c.spawnId==='string'?c.spawnId:null,role=s.definition.enemies.find(e=>e.id===spawnId)?.role??(spawnId?.includes(':add:')?'add':'ordinary'),stats=enemyStats(u.kind,u.level,worldChapter(s.world),role);return{kind:u.kind,level:u.level,role,profile:null,xp:role==='add'?0:stats.xp,coins:role==='add'?0:Math.max(5,Math.round(stats.xp/4))};}if(u.kind==='boss'){const c=s.controller(victim),profile=c&&'profile'in c?c.profile:null;if(typeof profile==='string'&&Object.hasOwn(BOSS_PROFILES,profile)){const p=profile as BossSim['profile'];return{kind:'boss',level:u.level,role:'ordinary',profile:p,xp:BOSS_PROFILES[p].reward,coins:BOSS_PROFILES[p].coins,...(p==='eclipse'||p==='dawn'?{xpBlessingSeconds:600 as const}:{})};}}return null;}
 private onExternalDeath(victim:EntityRef,killer:EntityRef|null):void {
  const s=this.services,u=s.getUnit(victim);if(!u||this.currentSettled.get(victim.id)===victim.life)return;const facts=this.rewardFacts(victim);if(!facts)return;
  this.assertPrepared();this.useVictimBudget(victim);let e=this.newLiveCredit(victim);if(!e.summary)throw new Error('ledger-summary-required');
  // The DB total, not the RAM dirty cache, decides direct-kill fallback eligibility.
  if(killer&&e.summary.totalContributors===0&&!this.dirty!.writesForVictim(victim).length)this.recordExternalContribution(victim,killer,1);
  e=this.newLiveCredit(victim);const reservation=reserveDeathOutcome({schema:'world-death-v1',victim:copy(victim),world:s.world,throughVersion:e.throughVersion,facts,overrides:[...this.residentCreditSnapshots()],random:{algorithm:s.random.algorithm,state:s.random.state()}},e.summary!,this.dirty!.writesForVictim(victim));
  const recipe=reservation.recipe,initialCursor=initialPlannerCursor(recipe),token=JSON.stringify([s.id,'death',this.nextOutcomeToken]),capture=immutable({token,generation:this.nextOutcomeToken,victim:copy(victim),recipe,initialCursor}),charge=stagedSourceBytes(s.id,recipe,reservation.residentGrants);
  if(this.stagedDeaths.size>=this.sourceLimits!.maxPendingDeaths||this.stagedBytes+charge>this.sourceLimits!.maxStagedBytes)throw new Error('ledger-atomic-stage-bound-exceeded');
  s.preflightEarnedGrants(reservation.residentGrants);this.nextOutcomeToken++;this.stagedDeaths.set(token,{capture,reservation:{random:reservation.random,residentGrants:reservation.residentGrants},cursor:initialCursor,verifiedResidents:new Set(),bytes:charge});this.stagedBytes+=charge;
  // Stage first so fail-stop recovery retains every entitlement even if an event buffer faults.
  this.currentSettled.set(victim.id,victim.life);s.reserveOutcomeRandom(reservation.random.startState,reservation.random.drawCount,reservation.random.finalState);
  for(const grant of reservation.residentGrants)this.applyOwnedGrant(grant);
  // These timers hold only current resident contributors; offline pages never enter Area memory.
  if(facts.kind==='boss'&&reservation.residentGrants.length){const recipients=reservation.residentGrants.map(g=>g.recipient);s.timers.schedule(s.time+1.8,{kind:'victory',boss:copy(victim),recipients,stage:'banner'});s.timers.schedule(s.time+5,{kind:'victory',boss:copy(victim),recipients,stage:'end'});}
 }
 pendingDeathRecipes(limit:number):readonly OutcomeCapture[] {this.requireExternal();if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('ledger-invalid-capture-limit');return immutable([...this.stagedDeaths.values()].slice(0,limit).map(e=>e.capture));}
 private staged(capture:OutcomeCapture):StagedDeath {this.requireExternal();const e=this.stagedDeaths.get(capture.token);if(!e||canonicalLedgerValue(e.capture)!==canonicalLedgerValue(capture))throw new Error('ledger-stale-outcome-capture');return e;}
 planStagedOutcomePage(capture:OutcomeCapture,credits:readonly ContributionSnapshot[]):PlannedPage {const e=this.staged(capture);return planOutcomePage(e.capture.recipe,e.cursor,credits);}
 acceptStagedOutcomePage(capture:OutcomeCapture,page:PlannedPage,credits:readonly ContributionSnapshot[]):void {const e=this.staged(capture);if(canonicalLedgerValue(page.expectedCursor)!==canonicalLedgerValue(e.cursor))throw new Error('ledger-page-cursor-conflict');const local=residentOutcomePage(e.capture.recipe,page,credits);for(const grant of local){const reserved=e.reservation.residentGrants.find(g=>g.recipient===grant.recipient);if(!reserved||canonicalLedgerValue(reserved)!==canonicalLedgerValue(grant)||e.verifiedResidents.has(grant.recipient))throw new Error('ledger-resident-reservation-mismatch');}for(const grant of local)e.verifiedResidents.add(grant.recipient);e.cursor=immutable(page.nextCursor);}
 stagedOutcomeResult(capture:OutcomeCapture){const e=this.staged(capture);return immutable({cursor:e.cursor,residentGrants:e.reservation.residentGrants,random:e.reservation.random});}
 /** Host has authenticated the DB seal/digests; core checks exact capture, counts, RNG and local payloads. */
 retireJournaledOutcome(capture:OutcomeCapture,seal:PagedOutcomeSeal):void {const e=this.staged(capture),r=e.capture.recipe,c=validatePlannerCursor(r,seal.finalCursor);if(seal.format!=='paged-v1'||seal.digestScheme!=='sha256-chain-v1'||key(seal.victim)!==key(r.victim)||seal.key!==key(r.victim)||seal.codecVersion!==1||!(/^[a-f0-9]{64}$/.test(seal.contentDigest))||!(/^[a-f0-9]{64}$/.test(seal.recipeDigest))||seal.recipientCount!==r.expectedContributors||c.recipientCount!==r.expectedContributors||c.randomDraws!==r.expectedRandomDraws||canonicalLedgerValue(c)!==canonicalLedgerValue(e.cursor)||e.verifiedResidents.size!==e.reservation.residentGrants.length||this.dirty!.hasVictim(r.victim))throw new Error('ledger-incomplete-outcome-seal');this.stagedDeaths.delete(capture.token);this.stagedBytes-=e.bytes;const live=this.liveCredits.get(r.victim.id);if(live&&key(live.victim)===key(r.victim)){this.liveCredits.delete(r.victim.id);if(live.summary)this.summaryCount--;}this.preparedRoster=null;}
 externalResourceUsage(){this.requireExternal();return{...this.dirty!.resourceUsage(),liveVictims:this.liveCredits.size,summaries:this.summaryCount,pendingDeaths:this.stagedDeaths.size,stagedBytes:this.stagedBytes,settledCurrentLives:this.currentSettled.size};}
 encounterAvailable(profile:BossSim['profile']):boolean {if((profile==='rust'||profile==='abyss')&&(!this.beaconLit||this.services.world!=='w1'))return false;return this.services.players().some(u=>{const p=this.services.player(u.ref);return !!p&&u.alive&&!u.hidden&&canChallenge(u.level,BOSS_PROFILES[profile].level,!!p.state.flags.rustCleared,!!p.state.flags.abyssCleared,worldChapter(this.services.world));});}
 setSharedBeacon(lit:boolean):void {this.interactions.setSharedBeacon(lit);}
 command(player:EntityRef,command:PlayerCommand):boolean{if(command.kind==='interact'&&this.exploration.handles(command.targetId))return this.exploration.interact(player,command.targetId);if(command.kind==='channelStart'&&command.channel==='lighthouse-secret')return command.targetId==='lighthouse-secret'&&this.exploration.interact(player,command.targetId);return this.interactions.command(player,command);}
 interact(player:EntityRef,id:string):boolean{return this.exploration.handles(id)?this.exploration.interact(player,id):this.interactions.interact(player,id);}
 completeChannel(player:PlayerSim,channel:ChannelState):void {if(channel.kind==='lighthouse-secret')this.exploration.completeChannel(player,channel);else this.interactions.completeChannel(player,channel);}
 purgeActor(ref:EntityRef):void {this.interactions.purgeActor(ref);this.exploration.purgeActor(ref);}
 explorationSnapshot(){return this.exploration.snapshot();}
 update():void {this.interactions.update();this.exploration.update();const s=this.services,boss=s.bossByProfile('rust');if(s.world==='w1'&&this.beaconLit&&boss?.state==='dormant'&&s.players().some(u=>u.alive&&u.level>=3&&!s.player(u.ref)?.state.flags.rustCleared))boss.wake();if(s.world==='w4'){const frost=s.bossByProfile('frost');for(const u of s.players()){const p=s.player(u.ref);if(p&&!p.state.flags.frostEndingStarted&&canPresentFrostEnding(s.context.mode,4,p.state.flags,frost?.state??null,p.state.controlsLocked)){p.state.flags.frostEndingStarted=true;s.emit({type:'endingReady',unit:p.state.unit,chapter:4,replay:false});}}}}
 onTimer(action:TimerAction):void {const s=this.services;if(action.kind==='lootPresentation'){const p=s.playerByCharacter(action.recipient);if(p)s.emit({type:'loot',unit:action.corpse,recipient:p.state.unit,item:'cog'});}else if(action.kind==='victory'){const recipients=action.recipients.flatMap(c=>{const p=s.playerByCharacter(c);return p?[p.state.unit]:[];});s.emit({type:'victory',boss:action.boss,recipients,stage:action.stage});}}
 debugState():{contributions:Contribution[];grants:EarnedGrant[];acknowledgedGrantIds:string[];interactions:ReturnType<InteractionRules['debugState']>&{credits:readonly object[];settled:readonly string[];applied:readonly object[];exploration:ReturnType<NumericExploration['debugState']>}} {return {contributions:[...this.credits.values()].map(e=>({victim:copy(e.victim),contributors:[...e.contributors.keys()]})),grants:[...this.grants.values()].map(e=>copy(e.grant)),acknowledgedGrantIds:[...this.grants.values()].filter(e=>e.acknowledged).map(e=>e.grant.id),interactions:{...this.interactions.debugState(),exploration:this.exploration.debugState(),credits:[...this.credits.values()].map(e=>({victim:copy(e.victim),contributors:copy([...e.contributors.values()])})),settled:[...this.settled],applied:[...this.applied].map(([character,ids])=>({character,ids:[...ids]}))}};}
}
