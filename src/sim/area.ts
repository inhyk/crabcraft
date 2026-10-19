import {detachFeatureData,validateDungeonFeatureAward,MAX_FEATURE_AWARD_PAGE,MAX_FEATURE_AWARD_RECEIPTS,type DungeonFeatureAward} from './features/dungeon-awards.ts';
import {validateDungeonReturn,prepareInstanceExitCheckpoint,type DungeonReturnBinding,type DungeonCaptureBinding,type StagedInstanceExit} from './features/dungeon-persistence.ts';
import type {FeatureAwardReadToken,CertifiedFeatureAwardPage,FeatureAwardApplyResult,WorldQuery} from './types.ts';
import {DungeonController,dungeonPlayerEligible} from './features/dungeon.ts';
import {createDungeonDefinition,isDungeonQuery} from './areas/dungeon.ts';
import type {ContributionSummary,ContributionSnapshot, CreditBatch, PlannedPage, PagedOutcomeSeal} from './ledger.ts';
import {validateContributionSummary,validateSourceLedgerCapacity} from './ledger.ts';
import type { LedgerStepReadiness, ContributionSummaryRead, StagedOutcomeResult, OutcomeCapture, DurableLedgerBinding, GrantReadToken, CertifiedGrantPage, GrantApplyResult, CommandOutcome, CapturedPlayer, PlayerRetirement, CharacterCheckpointV1, RestoredPlayerData, EventRecord, PlayerCommand, ActionId, ActionRequest, Admission, Area as AreaContract, AreaContext, AreaDebugState, AreaOptions, AreaServices, AreaSnapshot, BossSim, CharacterId, ClassId, CombatController, DebugValue, EarnedGrant, EnemySim, EntityId, EntityRef, HitPlan, PendingHit, PlayerIntent, PlayerSim, ProjectileState, SimUnit, StagedArrival, StagedDeparture, TimerAction, TransferDTO } from './types.ts';
import { Actions } from './actions.ts';
import { populationRadius, validatePopulation, worldChapter } from './math.ts';
import { Combat } from './combat.ts';
import { playAction, resolvePlayerHit } from './abilities.ts';
import { Enemy } from './enemy.ts';
import { Boss } from './boss.ts';
import { copyValue, Events, immutable, sameRef } from './events.ts';
import { PlayerController, createPlayer, createPlayerState } from './player.ts';
import { Projectiles } from './projectiles.ts';
import { Ids, Random } from './random.ts';
import { Timers } from './timers.ts';
import { createUnit, feedLocomotion, teleport, isAttackTarget } from './unit.ts';
import { advanceNumericPose, initializeNumericPose } from './pose.ts';
import { WorldRules } from './outcomes.ts';
import { captureTransfer, restoreTransfer } from './transfer.ts';
import {projectCheckpoint,validateCheckpoint,validateEarnedGrant} from './persistence.ts';
import {DurableReceipts, durableRevision, externalCharacter} from './receipts.ts';
import {levelForXp} from './data/progression.ts';
import { NumericBoat } from './features/boat.ts';
import { NumericVillageGames } from './features/village.ts';
import { NumericNpc, NumericTownsfolk } from './features/npc.ts';
import type {FeatureContext, NpcFeatureContext, FeatureEvent} from './features/types.ts';
import { freshQuests, setQuestChapter } from './data/quests.ts';

const DT = 1 / 30;
const canonicalValue=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonicalValue(v))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(canonicalValue(v))])):value);
const baseStepVictimLives=(definition:AreaOptions['definition']):number=>2*(definition.enemies.filter(e=>e.role!=='dungeon').length+definition.bosses.length*4);
const capacity = (context:AreaContext):number => context.mode==='party-encounter'||context.mode==='dungeon'?8:100;
const instanceExitSources=new WeakMap<StagedInstanceExit,SimulationArea>();
interface RestoredArrival {instance?:StagedInstanceExit;instanceSource?:SimulationArea;ledger?:DurableLedgerBinding;token:string;admission:Admission;unit:SimUnit;player:PlayerController}
interface Arrival { ledger?:DurableLedgerBinding; token:string; admission:Admission; unit:SimUnit; player:PlayerController; dto:TransferDTO }
/** One independently owned, fixed-step authority. Query/provider inputs are pure services. */
export class SimulationArea implements AreaContract {
  readonly services:AreaServices;
  private unitMap=new Map<EntityId,SimUnit>();
  private playerMap=new Map<EntityId,PlayerController>();
  private enemyMap=new Map<EntityId,Enemy>();
  private bossMap=new Map<EntityId,Boss>();
  private controllerMap=new Map<EntityId,CombatController>();
  private ambientMap=new Map<EntityId,NumericTownsfolk>();
  private npcMap=new Map<EntityId,NumericNpc>();
  private boat:NumericBoat;
  private village:NumericVillageGames;
  private bossFrames=new Map<string,boolean>();
  private telegraphs=new Map<string,EventRecord>();
  private endings=new Map<EntityId,{unit:EntityRef;chapter:4;replay:boolean}>();
  private recoveryOrder=-1;
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
  private dungeon:DungeonController|null=null;
  private featureApplied=new Map<CharacterId,Map<string,Readonly<DungeonFeatureAward>>>();
  private dungeonReturns=new Map<CharacterId,Readonly<DungeonReturnBinding>>();
  private instanceExits=new Map<string,StagedInstanceExit>();
  private instanceArrivals=new Set<string>();
  private barriers=new Map<string,string>();
  private captures=new Map<string,CapturedPlayer>();
  private retirements=new Map<string,PlayerRetirement>();
  private summaryRead:ContributionSummaryRead|null=null;
  private receiptLedger=new DurableReceipts();
  private retirementLedger=new Map<string,DurableLedgerBinding>();
  private durableIds=new Map<CharacterId,Set<string>>();
  private revisions=new Map<CharacterId,number>();
  private restoredArrivals=new Map<string,RestoredArrival>();
  private commandOutcomes:CommandOutcome[]=[];
  private inputStage=false;
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
    if(options.dungeon){if(typeof options.dungeon.runId!=='string'||!options.dungeon.runId||options.dungeon.runId.length>128||Object.keys(options.dungeon).some(k=>!['runId','tier'].includes(k))||options.context.mode!=='dungeon'||options.context.pvp!=='disabled'||!isDungeonQuery(options.query)||canonicalValue(options.definition)!==canonicalValue(createDungeonDefinition(options.dungeon.tier)))throw new Error('Invalid dungeon Area configuration');}
    else if(options.context.mode==='dungeon'||options.definition.enemies.some(e=>e.role==='dungeon'))throw new Error('Dungeon options required');
    if(options.featureAwards&&(Object.keys(options.featureAwards).join()!=='maxPending'||!Number.isSafeInteger(options.featureAwards.maxPending)||options.featureAwards.maxPending<1||options.featureAwards.maxPending>MAX_FEATURE_AWARD_RECEIPTS))throw new Error('Invalid feature receipt limit');
    if(!options.id)throw new Error('Area instance ID required');
    if(options.ledgerMode!==undefined&&options.ledgerMode!=='retained'&&options.ledgerMode!=='external-durable')throw new Error('Invalid ledger mode');
    for(const n of Object.values(options.limits))if(!Number.isSafeInteger(n)||n<0)throw new RangeError('Invalid area limit');
    if(options.ledgerMode==='external-durable'&&(!options.ledgerLimits||['maxDirtyCreditEntries','maxDirtyCreditBytes','maxPendingDeaths','maxStagedBytes'].some(k=>!Number.isSafeInteger(options.ledgerLimits![k as keyof NonNullable<AreaOptions['ledgerLimits']>])||options.ledgerLimits![k as keyof NonNullable<AreaOptions['ledgerLimits']>]<=0)))throw new Error('Explicit source ledger limits required');
    if(options.ledgerMode==='external-durable')validateSourceLedgerCapacity(options.id,options.definition.world,options.ledgerLimits!,baseStepVictimLives(options.definition),capacity(options.context));
    const dungeonTier=options.dungeon?.tier,damageAllowed=options.policy.damageAllowed;
    const policy=options.dungeon?{...options.policy,damageAllowed:(context:AreaContext,source:Readonly<SimUnit>|null,target:Readonly<SimUnit>)=>!(source?.kind==='player'&&target.reaction==='hostile'&&source.level<dungeonTier!)&&damageAllowed(context,source,target)}:options.policy;
    this.options={...options,...(options.featureAwards?{featureAwards:immutable(options.featureAwards)}:{}),...(options.dungeon?{dungeon:immutable(options.dungeon)}:{}),definition:immutable(options.definition),limits:immutable(options.limits),policy:Object.freeze({...policy})};
    this.context=immutable({...options.context,members:[]});
    if(options.context.members.length)throw new Error('Attach actors before supplying membership');
    this.rng=new Random(options.seed);this.events=new Events(options.limits.eventCount);this.timers=new Timers(options.limits.timers);
    const self=this;
    this.services={
      ledgerMode:options.ledgerMode??'retained',id:options.id,world:options.definition.world,query:options.query,actionData:options.actionData,definition:this.options.definition,policy:this.options.policy,random:this.rng,ids:this.ids,timers:this.timers,
      get time(){return self.clock;},get tick(){return self.stepId;},get context(){return self.context;},get combat(){return self.combat;},
      reserveOutcomeRandom:(start,count,end)=>{if(!this.externalLedger)throw new Error('External ledger mode required');this.rng.reserve(start,count,end);},
      getUnit:ref=>this.getUnit(ref),controller:ref=>this.getUnit(ref)?this.controllerMap.get(ref.id)??null:null,
      player:ref=>this.getUnit(ref)?this.playerMap.get(ref.id)??null:null,
      npcById:id=>[...this.unitMap.values()].find(u=>u.npcId===id)??null,
      playerByCharacter:character=>[...this.playerMap.values()].find(p=>p.state.character===character)??null,
      players:()=>[...this.playerMap.values()].map(p=>this.unitMap.get(p.state.unit.id)!),
      targetFor:ref=>this.targetFor(ref),hostilesNear:(x,z,r,source)=>[...this.unitMap.values()].filter(u=>u.alive&&!u.hidden&&(source?!!this.getUnit(source)&&isAttackTarget(this.services,this.getUnit(source)!,u):u.reaction==='hostile')&&Math.hypot(u.x-x,u.z-z)-u.radius<=r),
      emit:event=>this.events.emit(this.stepId,event),outcomeTransaction:run=>this.events.transaction(()=>this.externalLedger?this.timers.transaction(run,()=>this.events.assertPendingRoom()):run()),
      startAction:(ref,action,hit)=>this.startAction(ref,action,hit),stopAction:(ref,id,fade)=>this.stopAction(ref,id,fade),
      cancelPendingHit:ref=>{const u=this.getUnit(ref);if(u)u.pendingHit=null;},resolveHit:plan=>this.resolveHit(plan),
      launch:input=>this.flights.launch(input,this.stepId),spawnAdd:(boss,x,z)=>this.spawnAdd(boss,x,z),
      respawnUnit:ref=>this.respawnUnit(ref),bossAvailable:profile=>this.worldRules.encounterAvailable(profile),
      runCommand:(ref,command,commandIndex)=>{const success=this.command(ref,command);if(this.inputStage&&commandIndex!==undefined)this.commandOutcomes.push(immutable({unit:ref,commandIndex,success}));return success;},bossByProfile:profile=>[...this.bossMap.values()].find(b=>b.profile===profile)??null,
      encounterActive:()=>[...this.bossMap.values()].some(b=>b.engaged),
      completeChannel:(ref,ch)=>{const p=this.services.player(ref);if(p)this.worldRules.completeChannel(p,ch);},
      preflightEarnedGrants:grants=>{const counts=new Map<string,Set<string>>();for(const g of grants){if(!this.services.playerByCharacter(g.recipient))continue;const ids=counts.get(g.recipient)??new Set(this.worldRules.appliedGrantIds(g.recipient).filter(id=>!this.durableIds.get(g.recipient)?.has(id)));if(!this.worldRules.appliedGrantIds(g.recipient).includes(g.id))ids.add(g.id);if(ids.size>256)throw new Error('Checkpoint receipt capacity exceeded');counts.set(g.recipient,ids);}},
      recordContribution:(victim,attacker,damage)=>this.worldRules.recordContribution(victim,attacker,damage),
      onUnitDied:(victim,killer)=>this.worldRules.onUnitDied(victim,killer),applyEarnedGrant:grant=>{if(this.externalLedger)throw new Error('External ledger requires certified delivery');return this.worldRules.applyGrant(grant);},
    };
    this.combat=new Combat(this.services);this.worldRules=new WorldRules(this.services,this.externalLedger?{mode:'external-durable',limits:options.ledgerLimits!}:undefined);
    this.actions=new Actions(options.actionData,e=>this.services.emit(e),p=>this.resolveHit(p));
    this.flights=new Projectiles(options.limits.projectiles,r=>this.getUnit(r),e=>this.services.emit(e),p=>this.resolveHit(p));
    for(const spawn of this.options.definition.enemies){if(spawn.role==='dungeon')continue;validatePopulation(this.options.policy.enemyPopulation(spawn,0));if(this.options.policy.populationRadius)populationRadius(this.options.policy.populationRadius(spawn));}
    // Personal ending recovery never pauses shared NPCs or village features.
    const feature:FeatureContext={areaId:options.id,chapter:worldChapter(this.services.world),authority:true,authorityEpoch:1,rng:this.rng,query:options.query,
      get time(){return self.clock;},get encounterEngaged(){return self.services.encounterActive();},endingActive:false,authorityId:null,
      actors:()=>[...this.playerMap.values()].map(p=>({id:`actor:${p.unit.ref.id}`,unit:p.unit})),
      townsfolk:()=>[...this.ambientMap.values()].map(n=>({id:`actor:${n.unit.ref.id}`,unit:n.unit})),
      resolve:id=>{const match=/^actor:(\d+)$/.exec(id);return match?this.unitMap.get(Number(match[1]))??null:null;},
      ownsProgression:id=>{const match=/^actor:(\d+)$/.exec(id);return !!match&&this.playerMap.has(Number(match[1]));},
      navPoints:Object.values(this.options.definition.pois).map(p=>p.position),
      clearControls:u=>this.clearControls(u),stopActions:u=>{if(u.actions.some(a=>a.targetWeight>0))this.actions.stop(u,undefined,0);},emit:e=>this.featureEvent(e)};
    this.boat=new NumericBoat(feature,{villagePlaying:()=>this.village.playing});
    this.village=new NumericVillageGames(feature,{boatOccupied:()=>this.boat.snapshot().seats.some(Boolean)});
    this.populate();
    if(options.dungeon)this.dungeon=new DungeonController(this.services,options.dungeon,[...this.enemyMap.values()]);
  }
  private boundary(observe=false,allowBarrier=false):void {if(this.disposed)throw new Error('Area disposed');if(this.failed&&!observe)throw new Error('Area failed; host must retire it');if(this.running)throw new Error('Requires between-tick boundary');if(!observe&&!allowBarrier&&this.barriers.size)throw new Error('Durability barrier active');}
  private get durableLedger():boolean{return this.externalLedger||!!this.options.featureAwards;}
  private get externalLedger():boolean {return this.options.ledgerMode==='external-durable';}
  private ledgerBoundary():void {this.boundary(false,true);if(!this.externalLedger)throw new Error('External ledger mode required');if(!this.barriers.size)throw new Error('Ledger operation requires durability barrier');}
  private ledgerPlayer(ref:EntityRef):PlayerController {const p=this.playerMap.get(ref.id);if(!p||!sameRef(p.unit.ref,ref))throw new Error('Stale ledger player');if(this.options.characters&&!sameRef(this.options.characters.owner(p.state.character)??{area:'',id:0,life:0},ref))throw new Error('Stale registry ledger owner');return p;}
  private durableCaptureBoundary():void {this.boundary(false,true);if(!this.barriers.size)throw new Error('Ledger operation requires durability barrier');}
  private featureBoundary():void {this.durableCaptureBoundary();if(!this.options.featureAwards)throw new Error('Feature awards not enabled');}
  bindFeatureLedger(ref:EntityRef,revision:number):void {this.featureBoundary();const p=this.ledgerPlayer(ref);this.receiptLedger.bind(ref,p.state.character,revision);this.receiptLedger.invalidate(ref,p.state.character);}
  beginFeatureAwardRead(ref:EntityRef,expectedRevision:number):FeatureAwardReadToken {this.featureBoundary();const p=this.ledgerPlayer(ref);return this.receiptLedger.beginFeature(ref,p.state.character,expectedRevision);}
  cancelFeatureAwardRead(token:FeatureAwardReadToken):void {this.featureBoundary();if(token.purpose!=='dungeon-feature')throw new Error('Wrong feature token purpose');this.receiptLedger.cancel(token);}
  appliedFeatureAwardIds(character:CharacterId):readonly string[] {this.boundary(true);return Object.freeze([...(this.featureApplied.get(character)?.keys()??[])]);}
  applyCertifiedFeatureAwards(token:FeatureAwardReadToken,page:CertifiedFeatureAwardPage):readonly FeatureAwardApplyResult[] {
    this.featureBoundary();const binding=this.receiptLedger.consume(detachFeatureData(token,4096),'dungeon-feature'),p=this.ledgerPlayer(binding.actor),raw=detachFeatureData(page);
    if(!raw||Object.keys(raw).sort().join()!=='awards,revision'||durableRevision(raw.revision)!==binding.durableRevision||!Array.isArray(raw.awards)||raw.awards.length>MAX_FEATURE_AWARD_PAGE)throw new Error('Invalid certified feature page');
    const entries=raw.awards.map(entry=>{if(!entry||Object.keys(entry).sort().join()!=='appliedRevision,award'||entry.appliedRevision!==null&&(durableRevision(entry.appliedRevision)>raw.revision))throw new Error('Invalid feature receipt proof');return {award:validateDungeonFeatureAward(entry.award,binding.character),appliedRevision:entry.appliedRevision};});
    if(new Set(entries.map(e=>e.award.id)).size!==entries.length)throw new Error('Duplicate feature award ID');
    const previous=this.featureApplied.get(binding.character)??new Map<string,Readonly<DungeonFeatureAward>>(),unpaid=entries.filter(e=>{const old=previous.get(e.award.id);if(old&&canonicalValue(old)!==canonicalValue(e.award))throw new Error('Feature award content conflict');return e.appliedRevision===null&&!old;});
    if(previous.size+unpaid.length>this.options.featureAwards!.maxPending)throw new Error('Feature receipts require flush');
    const priorState=copyValue(p.state),priorUnit=copyValue(p.unit);
    try{this.events.transaction(()=>{for(const {award}of unpaid){p.gainXp(award.baseXp);if(!priorUnit.alive)p.unit.hp=0;p.state.coins=Math.min(Number.MAX_SAFE_INTEGER,p.state.coins+award.coins);p.state.flags[`dungeonCleared${award.tier}`]=true;}});}catch(error){Object.assign(p.state,priorState);Object.assign(p.unit,priorUnit);throw error;}
    if(unpaid.length){for(const {award}of unpaid)previous.set(award.id,award);this.featureApplied.set(binding.character,previous);}
    const applied=new Set(unpaid.map(e=>e.award.id));return immutable(entries.map(e=>({id:e.award.id,result:applied.has(e.award.id)?'applied' as const:'duplicate' as const})));
  }
  bindDungeonReturn(ref:EntityRef,binding:DungeonReturnBinding,parentQuery:WorldQuery):void {this.boundary(false,true);if(!this.options.dungeon||isDungeonQuery(parentQuery))throw new Error('Dungeon return requires parent query');const p=this.ledgerPlayer(ref),value=validateDungeonReturn(binding,this.services.world,parentQuery,p.unit.radius),old=this.dungeonReturns.get(p.state.character);if(old&&(value.version<old.version||value.version===old.version&&canonicalValue(value)!==canonicalValue(old)))throw new Error('Stale dungeon return version');if(old&&value.version!==old.version&&this.durableLedger)this.receiptLedger.invalidate(ref,p.state.character);this.dungeonReturns.set(p.state.character,value);}
  private dungeonCaptureFor(p:PlayerController):DungeonCaptureBinding {const returning=this.dungeonReturns.get(p.state.character);if(!returning)throw new Error('Dungeon safe return binding required');const u=p.unit;return immutable({ref:u.ref,liveLocation:{x:u.x,y:u.y,z:u.z,yaw:u.yaw},returning});}
  stageInstanceExit(ref:EntityRef):StagedInstanceExit {
    this.boundary();if(!this.options.dungeon||this.instanceExits.size||this.departures.size||this.arrivals.size||this.restoredArrivals.size)throw new Error('Invalid instance exit');const p=this.ledgerPlayer(ref);
    if(this.appliedGrantIds(p.state.character).length||this.appliedFeatureAwardIds(p.state.character).length||this.receiptLedger.hasRead(p.state.character)||[...this.captures.values()].some(c=>c.checkpoint.character===p.state.character))throw new Error('Instance exit requires durable receipts');
    const binding=this.durableLedger?this.receiptLedger.current(ref,p.state.character):undefined;this.events.assertRoom(p.unit.actions.length+this.playerMap.size*3+4);
    const exit=immutable({token:JSON.stringify([this.services.id,'instance-exit',this.tokenIds.next()]),character:p.state.character,sourceRef:ref,run:{area:this.services.id,runId:this.options.dungeon.runId},checkpoint:prepareInstanceExitCheckpoint(this.checkpointFor(p)),capture:this.dungeonCaptureFor(p),...(binding?{revision:binding.durableRevision,sourceLedger:binding}:{}),combatMode:this.externalLedger?'external-durable' as const:'retained' as const,featureLedger:!!this.options.featureAwards,retainedGrantIds:this.externalLedger?[]:this.worldRules.appliedGrantIds(p.state.character),durableGrantIds:this.externalLedger?[]:[...(this.durableIds.get(p.state.character)??[])]});this.instanceExits.set(exit.token,exit);instanceExitSources.set(exit,this);return exit;
  }
  abortInstanceExit(token:string):void {this.boundary(false,true);this.instanceExits.delete(token);}
  validateInstanceExit(token:string):void {this.boundary(false,true);const exit=this.instanceExits.get(token),p=exit&&this.playerMap.get(exit.sourceRef.id);if(!exit||!p||!sameRef(p.unit.ref,exit.sourceRef)||canonicalValue(this.dungeonCaptureFor(p))!==canonicalValue(exit.capture)||canonicalValue(prepareInstanceExitCheckpoint(this.checkpointFor(p)))!==canonicalValue(exit.checkpoint)||this.appliedGrantIds(exit.character).length||this.appliedFeatureAwardIds(exit.character).length||this.durableLedger&&canonicalValue(this.receiptLedger.current(p.unit.ref,p.state.character))!==canonicalValue(exit.sourceLedger))throw new Error('Stale instance exit');this.events.assertRoom(p.unit.actions.length+this.playerMap.size*3+4);}
  commitInstanceExit(token:string,destination:EntityRef):void {this.boundary(false,true);const exit=this.instanceExits.get(token);if(!exit)throw new Error('Unknown instance exit');if(!destination||destination.area===this.services.id||!Number.isSafeInteger(destination.id)||destination.id<1||!Number.isSafeInteger(destination.life)||destination.life<1||this.options.characters&&!sameRef(this.options.characters.owner(exit.character)??{area:'',id:0,life:0},destination))throw new Error('Instance exit ownership switch required');this.validateInstanceExit(token);const p=this.playerMap.get(exit.sourceRef.id)!;this.actions.stop(p.unit,undefined,0);p.unit.pendingHit=null;this.removePlayer(exit.sourceRef);this.instanceExits.delete(token);}
  stageInstanceArrival(admission:Admission,exit:StagedInstanceExit):StagedArrival {
    this.boundary();const origin=instanceExitSources.get(exit);if(!origin||origin.instanceExits.get(exit.token)!==exit)throw new Error('Uncertified instance exit');if(origin.options.characters!==this.options.characters)throw new Error('Instance registry mismatch');origin.validateInstanceExit(exit.token);const owned=immutable(detachFeatureData(exit));if(this.options.dungeon||owned.run.area!==owned.sourceRef.area||owned.checkpoint.character!==owned.character||owned.checkpoint.world!==this.services.world||owned.combatMode!==(this.externalLedger?'external-durable':'retained')||owned.featureLedger!==!!this.options.featureAwards||this.options.characters&&!sameRef(this.options.characters.owner(owned.character)??{area:'',id:0,life:0},owned.sourceRef))throw new Error('Invalid instance arrival');
    validateDungeonReturn(owned.capture.returning,this.services.world,this.options.query,this.options.actionData.archetype(owned.checkpoint.archetype).radius);
    const staged=this.stageRestoredArrival(admission,owned.checkpoint,prepareInstanceExitCheckpoint(owned.checkpoint),this.durableLedger?{revision:durableRevision(owned.revision)}:undefined);
    const entry=this.restoredArrivals.get(staged.token)!;entry.instance=owned;entry.instanceSource=origin;this.instanceArrivals.add(staged.token);return staged;
  }
  validateInstanceArrival(token:string):void {this.boundary(false,true);const a=this.restoredArrivals.get(token);if(!this.instanceArrivals.has(token)||!a?.instance||!a.instanceSource)throw new Error('Unknown instance arrival');a.instanceSource.validateInstanceExit(a.instance.token);if(this.options.characters&&!sameRef(this.options.characters.owner(a.instance.character)??{area:'',id:0,life:0},a.instance.sourceRef))throw new Error('Instance source registry mismatch');}
  activateInstanceArrival(token:string):EntityRef {this.boundary(false,true);if(!this.instanceArrivals.has(token))throw new Error('Unknown instance arrival');const a=this.restoredArrivals.get(token)!,exit=a.instance!;if(a.instanceSource?.instanceExits.has(exit.token)||a.instanceSource?.services.getUnit(exit.sourceRef))throw new Error('Instance source not committed');if(this.options.characters&&!sameRef(this.options.characters.owner(exit.character)??{area:'',id:0,life:0},a.unit.ref))throw new Error('Instance arrival registry mismatch');this.instanceArrivals.delete(token);const ref=this.activateRestoredArrival(token);if(!this.externalLedger){this.worldRules.restoreAppliedGrantIds(exit.character,exit.retainedGrantIds);this.durableIds.set(exit.character,new Set(exit.durableGrantIds));}return ref;}
  evictForRecovery(ref:EntityRef):void {this.boundary(false,true);if(!this.options.dungeon)throw new Error('Only dungeon residents are evicted for recovery');if(!this.barriers.size)throw new Error('Recovery requires durability barrier');const p=this.ledgerPlayer(ref),character=p.state.character;if([...this.instanceExits.values()].some(e=>e.character===character))throw new Error('Instance exit active');this.events.assertRoom(p.unit.actions.length+this.playerMap.size*3+4);if(this.options.characters&&!this.options.characters.compareAndSwap(character,ref,null))throw new Error('Character registry mismatch');this.actions.stop(p.unit,undefined,0);p.unit.pendingHit=null;this.worldRules.replaceAppliedGrantIds(character,[]);this.removePlayer(ref);for(const [id,r]of this.retirements)if(r.capture.checkpoint.character===character){this.retirements.delete(id);this.retirementLedger.delete(id);this.barriers.delete(id);}}
  bindDurableLedger(ref:EntityRef,revision:number):void {this.ledgerBoundary();const p=this.ledgerPlayer(ref);this.receiptLedger.bind(ref,p.state.character,revision);}
  beginGrantRead(ref:EntityRef,expectedRevision:number):GrantReadToken {this.ledgerBoundary();const p=this.ledgerPlayer(ref);return this.receiptLedger.begin(ref,p.state.character,expectedRevision);}
  cancelGrantRead(token:GrantReadToken):void {this.ledgerBoundary();this.receiptLedger.cancel(token);}
  invalidateGrantRead(ref:EntityRef):void {this.boundary(false,true);if(this.durableLedger){const p=this.ledgerPlayer(ref);this.receiptLedger.invalidate(ref,p.state.character);}}
  applyCertifiedGrants(token:GrantReadToken,page:CertifiedGrantPage):readonly GrantApplyResult[] {
    this.ledgerBoundary();const binding=this.receiptLedger.consume(token);
    this.ledgerPlayer(binding.actor);
    if(!page||durableRevision(page.revision)!==binding.durableRevision||!Array.isArray(page.grants)||page.grants.length>100)throw new Error('Invalid certified grant page');
    const grants=page.grants.map(g=>validateEarnedGrant(g,binding.character));
    if(new Set(grants.map(g=>g.id)).size!==grants.length)throw new Error('Duplicate certified grant ID');
    this.services.preflightEarnedGrants(grants);const results:GrantApplyResult[]=[];
    for(const grant of grants){const result=this.worldRules.applyCertifiedGrant(grant);if(result==='not-owner')throw new Error('Certified grant owner changed');results.push({id:grant.id,result});}
    return immutable(results);
  }
  resourceUsage():Readonly<Record<string,number>> {this.boundary(true);return Object.freeze({...this.worldRules.resourceUsage(),...(this.externalLedger?this.worldRules.externalResourceUsage():{}),...(this.options.featureAwards?{featureReceipts:[...this.featureApplied.values()].reduce((n,m)=>n+m.size,0)}:{}),summaryReads:this.summaryRead?1:0,...this.receiptLedger.usage(),captures:this.captures.size,durableCharacters:this.durableIds.size,retirements:this.retirements.size});}
  private sourceDrainBoundary():void {this.boundary(true);if(!this.externalLedger)throw new Error('External ledger mode required');if(!this.failed&&!this.barriers.size)throw new Error('Source drain requires durability barrier');}
  private residentRefs(){return [...this.playerMap.values()].map(p=>({character:p.state.character,unit:p.unit.ref})).sort((a,b)=>a.character<b.character?-1:a.character>b.character?1:0);}
  private maxStepVictimLives():number {
    // Current/reserved slots plus at most one ordinary update respawn, one boss rematch,
    // one spawn per add slot, and each due lifecycle timer. No render-stage transitions.
    return baseStepVictimLives(this.options.definition)+this.timers.countDue(this.clock+DT,['echoSpawn','bossWake']);
  }
  prepareLedgerStep():LedgerStepReadiness {
    this.boundary(false,true);if(!this.externalLedger)return Object.freeze({ready:true});
    try{this.worldRules.preflightCreditCapacity(this.maxStepVictimLives(),this.worldRules.residentCreditSnapshots());return Object.freeze({ready:true});}
    catch(error){const message=error instanceof Error?error.message:'';for(const reason of ['flush-required','outcomes-pending','summary-required','receipts-flush-required'] as const)if(message===`ledger-${reason}`||message===`ledger: ${reason}`)return Object.freeze({ready:false,reason});throw error;}
  }
  contributionSummariesNeeded():readonly EntityRef[] {this.boundary(true);return this.worldRules.contributionSummariesNeeded();}
  beginContributionSummaryRead(limit:number):ContributionSummaryRead|null {
    this.ledgerBoundary();if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid summary limit');
    const victims=this.worldRules.contributionSummariesNeeded().slice(0,limit);if(!victims.length){this.summaryRead=null;return null;}
    this.summaryRead=immutable({token:JSON.stringify([this.services.id,'summary',this.tokenIds.next()]),area:this.services.id,tick:this.stepId,victims,residents:this.residentRefs()});return this.summaryRead;
  }
  cancelContributionSummaryRead(read:ContributionSummaryRead):void {this.ledgerBoundary();if(this.summaryRead&&canonicalValue(this.summaryRead)===canonicalValue(read))this.summaryRead=null;}
  installContributionSummaries(read:ContributionSummaryRead,summaries:readonly ContributionSummary[]):void {
    this.ledgerBoundary();if(!this.summaryRead||canonicalValue(this.summaryRead)!==canonicalValue(read))throw new Error('Stale contribution summary read');this.summaryRead=null;
    if(read.tick!==this.stepId||canonicalValue(read.residents)!==canonicalValue(this.residentRefs()))throw new Error('Stale contribution summary roster');
    if(!Array.isArray(summaries)||summaries.length!==read.victims.length)throw new Error('Incomplete contribution summary batch');const values=summaries.map(validateContributionSummary);
    if(new Set(values.map(s=>JSON.stringify(s.victim))).size!==values.length||values.some(s=>!read.victims.some(v=>sameRef(v,s.victim))))throw new Error('Contribution summary victim mismatch');
    for(const summary of values)this.worldRules.installContributionSummary(summary);
  }
  captureDirtyCredits(limit:number):CreditBatch|null {this.sourceDrainBoundary();return this.worldRules.captureDirtyCredits(limit);}
  markCreditsDurable(token:string):'acknowledged'|'not-current' {this.sourceDrainBoundary();return this.worldRules.markCreditsDurable(token);}
  pendingDeathRecipes(limit:number):readonly OutcomeCapture[] {this.boundary(true);return this.worldRules.pendingDeathRecipes(limit);}
  planStagedOutcomePage(capture:OutcomeCapture,credits:readonly ContributionSnapshot[]):PlannedPage {this.sourceDrainBoundary();return this.worldRules.planStagedOutcomePage(capture,credits);}
  acceptStagedOutcomePage(capture:OutcomeCapture,page:PlannedPage,credits:readonly ContributionSnapshot[]):void {this.sourceDrainBoundary();this.worldRules.acceptStagedOutcomePage(capture,page,credits);}
  stagedOutcomeResult(capture:OutcomeCapture):StagedOutcomeResult {this.boundary(true);return this.worldRules.stagedOutcomeResult(capture);}
  retireJournaledOutcome(capture:OutcomeCapture,seal:PagedOutcomeSeal):void {this.sourceDrainBoundary();this.worldRules.retireJournaledOutcome(capture,seal);}
  private getUnit(ref:EntityRef):SimUnit|null {if(!ref||ref.area!==this.services.id)return null;const u=this.unitMap.get(ref.id);return u&&sameRef(u.ref,ref)?u:null;}
  private makeUnit(archetype:string,kind:SimUnit['kind'],reaction:SimUnit['reaction'],position:{x:number;y:number;z:number}):SimUnit {const unit=createUnit({area:this.services.id,id:this.ids.next(),life:1},archetype,kind,reaction,this.options.actionData,position);teleport(unit,this.options.query,position.x,position.z);return unit;}
  private npcContext():NpcFeatureContext {const self=this;return {get time(){return self.clock;},rng:this.rng,query:this.options.query,authority:true,endingActive:false,players:()=>this.services.players(),externallyOwned:r=>this.village.ownsNpc(r)||this.getUnit(r)?.kind==='freed',hasAction:u=>u.actions.some(a=>a.targetWeight>0),playAction:(u,id)=>playAction(this.services,u,id),emit:e=>this.services.emit({type:'feature',event:e})};}
  private populate():void {
    for(const n of this.options.definition.npcs){const u=this.makeUnit(n.archetype??'human','npc','friendly',n.position);u.npcId=n.id;u.targetable=n.targetable??true;teleport(u,this.options.query,u.x,u.z,n.yaw);this.unitMap.set(u.ref.id,u);if(['brinebeard','silvermoon','coralline','grukk','hoofclaw','rattlebolt','pip'].includes(n.id))this.npcMap.set(u.ref.id,new NumericNpc(this.npcContext(),u,{npcId:n.id,homeYaw:n.yaw}));}
    for(const n of this.options.definition.townsfolk??[]){const u=this.makeUnit(n.archetype,'townsfolk','friendly',n.position);teleport(u,this.options.query,u.x,u.z,n.yaw??0);this.unitMap.set(u.ref.id,u);this.ambientMap.set(u.ref.id,new NumericTownsfolk(this.npcContext(),u,{...n,relocated:this.services.world!=='w1'}));}
    for(const spawn of this.options.definition.enemies){const u=this.makeUnit(spawn.role==='echo'?'echo':spawn.kind,spawn.kind,'hostile',spawn.home);this.unitMap.set(u.ref.id,u);const e=new Enemy(this.services,u,spawn);this.enemyMap.set(u.ref.id,e);this.controllerMap.set(u.ref.id,e);if(spawn.role!=='ordinary'||validatePopulation(this.options.policy.enemyPopulation(spawn,0)).desired===0)e.despawn();}
    for(const e of this.enemyMap.values())e.pack=[...this.enemyMap.values()].filter(other=>this.options.definition.enemies.find(s=>s.id===other.spawnId)?.pack===this.options.definition.enemies.find(s=>s.id===e.spawnId)?.pack);
    for(const config of this.options.definition.bosses){const freed=this.makeUnit(config.freedArchetype??'human','freed','friendly',config.freedPosition??config.arena.position);freed.npcId=config.freedNpcId;freed.hidden=true;freed.targetable=false;this.unitMap.set(freed.ref.id,freed);const u=this.makeUnit(`boss-${config.profile}`,'boss','hostile',config.arena.position);u.yaw=config.arena.yaw;this.unitMap.set(u.ref.id,u);const b=new Boss(this.services,u,config.arena,freed,config.profile);if(config.captiveBeforeVictory)freed.hidden=false;this.bossMap.set(u.ref.id,b);this.controllerMap.set(u.ref.id,b);}
  }
  private clearControls(u:SimUnit):void {const p=this.playerMap.get(u.ref.id);p?.neutralizeInput();if(p){p.state.target=null;p.state.talkTarget=null;}u.pendingHit=null;u.pushTime=0;if(u.actions.some(a=>a.targetWeight>0))this.actions.stop(u,undefined,0);}
  private featureEvent(e:FeatureEvent):void {if(e.type==='boatAchievement'){const p=this.playerMap.get(e.actor.id);if(p&&sameRef(p.unit.ref,e.actor)){p.state.achievements.distance=Math.max(p.state.achievements.distance,e.distance);if(!p.state.achievements.earned.includes(e.achievement))p.state.achievements.earned.push(e.achievement);else return;}}this.services.emit({type:'feature',event:e});}
  private syncMembership():void {this.context=immutable({...this.context,members:this.context.members.map(m=>({...m,villagePlaying:this.village.playing,featureLocked:this.village.locked(m.unit),seatedBoat:this.boat.seated(m.unit)?'shore':null}))});}
  private command(ref:EntityRef,c:PlayerCommand):boolean {const p=this.playerMap.get(ref.id);if(!p||!sameRef(p.unit.ref,ref))return false;
    if(c.kind==='talk'){const target=this.getUnit(c.target),m=this.context.members.find(m=>sameRef(m.unit,ref));if(!p.unit.alive||p.state.controlsLocked||m?.seatedBoat||m?.villagePlaying||!target?.alive||target.hidden||!target.targetable||Math.hypot(target.x-p.unit.x,target.y-p.unit.y,target.z-p.unit.z)>=7||!this.services.policy.canInteract(this.context,p.state,`actor:${target.ref.id}`))return false;if(target.npcId)return this.worldRules.command(ref,{kind:'interact',targetId:`npc:${target.npcId}`});const resident=this.ambientMap.get(target.ref.id);if(!resident)return false;return resident.bark(ref,this.services.world==='w2'?(p.state.flags.trueCleared?'starVictory':'star'):'shore');}
    if(c.kind==='talkEnd'){p.state.talkTarget=null;return true;}
    if(c.kind==='boat'||c.kind==='village'){const result=c.kind==='boat'?this.boat.request(ref,c.command):this.village.request(ref,c.mode);this.syncMembership();return result;}
    return this.worldRules.command(ref,c);
  }
  private updateFeatures():void {
    this.boat.step(DT);this.village.step(DT);this.syncMembership();for(const p of this.playerMap.values())p.state.achievements.distance=Math.max(p.state.achievements.distance,this.boat.progress(`actor:${p.unit.ref.id}`).distance);
    for(const n of this.npcMap.values()){const speaker=[...this.playerMap.values()].find(p=>p.state.talkTarget&&sameRef(p.state.talkTarget,n.unit.ref));n.setConversation(speaker?.unit.ref??null);n.step(DT);feedLocomotion(n.unit,DT);}
    for(const n of this.ambientMap.values())n.step(DT);
  }
  private updateRecovery():void {
    for(const record of this.events.peek()){
      if(record.order<=this.recoveryOrder)continue;this.recoveryOrder=record.order;const event=record.event;
      if(event.type==='boss'&&this.getUnit(event.boss)){const key=JSON.stringify(event.boss);if(event.stage==='engage')this.bossFrames.set(key,true);else if(event.stage==='reset')this.bossFrames.set(key,false);else if(event.stage==='frame')this.bossFrames.set(key,!!event.show);}
      else if(event.type==='victory'&&event.stage==='end'&&this.getUnit(event.boss))this.bossFrames.set(JSON.stringify(event.boss),false);
      if(event.type==='telegraph'&&this.getUnit(event.src))this.telegraphs.set(JSON.stringify(event.src),record);
      else if(event.type==='telegraphEnd')this.telegraphs.delete(JSON.stringify(event.src));
      else if(event.type==='endingReady'&&this.getUnit(event.unit))this.endings.set(event.unit.id,{unit:event.unit,chapter:event.chapter,replay:event.replay});
    }
  }

  private targetFor(ref:EntityRef):SimUnit|null {const source=this.getUnit(ref);if(!source)return null;let best:SimUnit|null=null,distance=Infinity;for(const p of this.playerMap.values()){const u=this.getUnit(p.state.unit)!;if(!u.alive||u.hidden||!u.targetable||this.options.dungeon&&!dungeonPlayerEligible(u,this.options.dungeon.tier))continue;const d=Math.hypot(source.x-u.x,source.z-u.z);if(d<distance){best=u;distance=d;}}return best;}
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
  private respawnUnit(ref:EntityRef):EntityRef {const u=this.getUnit(ref);if(!u)throw new Error('Stale respawn');if(ref.life>=0xffffffff)throw new RangeError('Life exhausted');const next=immutable({...ref,life:ref.life+1});const p=this.playerMap.get(ref.id),ledger=this.durableLedger&&p?this.receiptLedger.prepare(next,p.state.character,this.receiptLedger.current(ref,p.state.character).durableRevision):undefined;this.events.assertRoom(u.actions.length+this.playerMap.size*2+2);if(p&&this.options.characters&&!this.options.characters.compareAndSwap(p.state.character,ref,next))throw new Error('Character registry mismatch');if(u.actions.length)this.actions.stop(u,undefined,0);u.actions=[];u.pendingHit=null;this.purgeReferences(ref);u.ref=next;u.pose={...initializeNumericPose(),previousX:u.x,previousZ:u.z,previousYaw:u.yaw};if(p)p.state.unit=u.ref;if(ledger)this.receiptLedger.activate(ledger);this.context=immutable({...this.context,members:this.context.members.map(m=>sameRef(m.unit,ref)?{...m,unit:u.ref}:m)});this.syncMembership();return u.ref;}
  private purgeReferences(ref:EntityRef):void {
    this.worldRules.purgeActor(ref);this.boat.detach(ref);this.village.detach(ref);this.endings.delete(ref.id);this.telegraphs.delete(JSON.stringify(ref));this.bossFrames.delete(JSON.stringify(ref));
    for(const p of this.playerMap.values()){const s=p.state;if(s.target&&sameRef(s.target,ref))s.target=null;if(s.talkTarget&&sameRef(s.talkTarget,ref))s.talkTarget=null;if(s.cast?.target&&sameRef(s.cast.target,ref))p.interruptCast();if(s.dash&&sameRef(s.dash.target,ref))s.dash=null;}
    for(const u of this.unitMap.values()){const plan=u.pendingHit?.plan;if(plan&&(sameRef(plan.source,ref)||'target' in plan&&sameRef(plan.target,ref)))u.pendingHit=null;}
    this.flights.purge(ref);
    this.timers.removeWhere(a=>a.kind==='respawn'?sameRef(a.player,ref):a.kind==='bossWake'?sameRef(a.boss,ref):false);
  }
  private timer(action:TimerAction):void {if(action.kind==='respawn'){const p=this.services.player(action.player);if(p&&!this.getUnit(action.player)?.alive)p.respawn();}else if(action.kind==='bossWake'){if(this.getUnit(action.boss))this.bossMap.get(action.boss.id)?.wake();}else if(action.kind==='echoSpawn'){const e=[...this.enemyMap.values()].find(e=>e.spawnId===action.spawnId),spawn=this.options.definition.enemies.find(s=>s.id===action.spawnId);if(e&&spawn)e.respawnAt(spawn.home.x,spawn.home.z);}else this.worldRules.onTimer(action);}
  step(inputs:ReadonlyMap<EntityId,PlayerIntent>):readonly CommandOutcome[] {
    this.boundary();if(this.instanceExits.size||this.departures.size||this.arrivals.size||this.restoredArrivals.size)throw new Error('Transfer transaction active');
    // Fail before actor work when undrained history leaves no room for even the first observation.
    this.events.assertRoom(1);
    const readiness=this.prepareLedgerStep();if(!readiness.ready)throw new Error(`Ledger IO required: ${readiness.reason}`);
    for(const [id,input] of inputs)if(!this.playerMap.has(id)||!Array.isArray(input.commands)||input.commands.length>this.options.limits.inputCommandsPerTick)throw new RangeError('Invalid/oversized actor input');
    this.running=true;this.inputStage=true;this.commandOutcomes=[];
    try {
      for(const [id,p] of this.playerMap){const input=inputs.get(id);if(!input)continue;p.applyIntent(input);}
      this.inputStage=false;this.clock+=DT;this.stepId++;
      this.timers.update(this.clock,a=>this.timer(a));
      for(const p of this.playerMap.values()){p.update(DT);feedLocomotion(p.unit,DT);}
      for(const e of [...this.enemyMap.values()]){e.update(DT);const u=this.getUnit(e.unit);if(u)feedLocomotion(u,DT);}
      for(const b of this.bossMap.values()){b.update(DT);const u=this.getUnit(b.unit);if(u)feedLocomotion(u,DT);}
      this.worldRules.update();this.separate();
      if(this.services.world==='w2'&&this.clock>=this.nextEcho&&!this.services.encounterActive()){for(const e of this.enemyMap.values())if(e.isEcho&&e.state==='gone'&&(!this.options.policy.populationRadius||this.services.players().every(p=>!p.alive||p.hidden||Math.hypot(p.x-e.spawn.home.x,p.z-e.spawn.home.z)>=22))&&validatePopulation(this.options.policy.enemyPopulation(e.spawn,this.services.players().filter(p=>p.alive&&!p.hidden&&Math.hypot(p.x-e.spawn.home.x,p.z-e.spawn.home.z)<(this.options.policy.populationRadius?populationRadius(this.options.policy.populationRadius(e.spawn)):22)).length)).desired===1){e.respawnAt(e.spawn.home.x,e.spawn.home.z);this.nextEcho=this.clock+120;}}
      for(const u of this.unitMap.values())if(u.alive&&!u.hidden&&u.rustUntil&&this.clock>=u.rustUntil){u.rust=0;u.rustUntil=0;}
      this.updateFeatures();
      this.dungeon?.step();
      for(const u of this.unitMap.values())this.actions.updateHit(u,DT);
      this.flights.update(DT);
      for(const u of this.unitMap.values()){this.actions.update(u,DT);advanceNumericPose(u,DT);}
    }catch(error){this.failed=true;throw error;}finally{this.running=false;this.inputStage=false;}return immutable(this.commandOutcomes);
  }
  private separate():void {const list=[...this.unitMap.values()].filter(u=>u.alive&&!u.hidden&&(u.reaction==='hostile'||u.kind==='player'));for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i]!,b=list[j]!,dx=b.x-a.x,dz=b.z-a.z,min=(a.radius+b.radius)*.85,d2=dx*dx+dz*dz;if(d2>=min*min||d2<1e-6)continue;const d=Math.sqrt(d2),push=(min-d)/d,wa=a.kind==='boss'?0:a.kind==='player'?.2:.5,wb=b.kind==='boss'?0:b.kind==='player'?.2:.5,sum=wa+wb||1;a.x-=dx*push*wa/sum;a.z-=dz*push*wa/sum;b.x+=dx*push*wb/sum;b.z+=dz*push*wb/sum;}}
  bootstrapEncounter(profile:BossSim['profile'],facts:{beaconLit:boolean}):void {this.boundary();if(this.context.mode!=='party-encounter'||this.playerMap.size||this.reservations.size||this.options.definition.bosses.length!==1||this.options.definition.bosses[0].profile!==profile||typeof facts.beaconLit!=='boolean')throw new Error('Invalid encounter bootstrap');this.worldRules.beaconLit=facts.beaconLit;}
  beginDurabilityBarrier(reason:string):string {this.boundary(false,true);if(!reason||reason.length>256)throw new Error('Invalid barrier reason');if(this.instanceExits.size||this.departures.size||this.arrivals.size||this.restoredArrivals.size)throw new Error('Transfer transaction active');if(this.barriers.size>=128)throw new Error('Barrier capacity exceeded');const token=JSON.stringify([this.services.id,'durability',this.tokenIds.next()]);this.barriers.set(token,reason);return token;}
  releaseDurabilityBarrier(token:string):void {this.boundary(false,true);if(this.retirements.has(token))throw new Error('Retirement owns barrier');this.barriers.delete(token);if(!this.barriers.size){this.receiptLedger.cancelAll();this.summaryRead=null;}}
  neutralizeInput(ref:EntityRef):void {this.boundary(false,true);const p=this.playerMap.get(ref.id);if(!p||!sameRef(p.unit.ref,ref))throw new Error('Stale player');this.events.assertRoom(p.unit.actions.length+4);p.neutralizeInput();}
  resetInputSession(ref:EntityRef):void {this.neutralizeInput(ref);this.playerMap.get(ref.id)!.neutralizeInput(true);this.invalidateGrantRead(ref);}
  appliedGrantIds(character:CharacterId):readonly string[] {this.boundary(true);const durable=this.durableIds.get(character);return Object.freeze(this.worldRules.appliedGrantIds(character).filter(id=>!durable?.has(id)));}
  private checkpointFor(p:PlayerController):CharacterCheckpointV1 {const ref=p.unit.ref,m=this.context.members.find(m=>sameRef(m.unit,ref)),progress=this.boat.progress(`actor:${ref.id}`),state={...p.state,achievements:{...p.state.achievements,distance:Math.max(p.state.achievements.distance,progress.distance)}};const checkpoint=projectCheckpoint({unit:p.unit,state,world:this.services.world,time:this.clock,activity:{seated:!!m?.seatedBoat,village:!!m?.villagePlaying}});if(!this.options.dungeon)return checkpoint;const returning=this.dungeonReturns.get(p.state.character);if(!returning)throw new Error('Dungeon safe return binding required');return validateCheckpoint({...checkpoint,location:returning.location});}
  capturePlayerCheckpoint(ref:EntityRef):CapturedPlayer {this.boundary(true);if(this.durableLedger)this.durableCaptureBoundary();const p=this.playerMap.get(ref.id);if(!p||!sameRef(p.unit.ref,ref))throw new Error('Stale player');if(this.captures.size>=256)throw new Error('Checkpoint capture capacity exceeded');const ids=this.appliedGrantIds(p.state.character);if(ids.length>256)throw new Error('Checkpoint receipt capacity exceeded');const checkpoint=this.checkpointFor(p),ledger=this.durableLedger?this.receiptLedger.current(ref,p.state.character):undefined,capture=immutable({...(this.options.featureAwards?{appliedFeatureAwardIds:this.appliedFeatureAwardIds(p.state.character)}:{}),...(this.options.dungeon?{dungeonCapture:this.dungeonCaptureFor(p)}:{}),...(ledger?{ledger}:{}),captureId:JSON.stringify([this.services.id,'capture',this.tokenIds.next()]),ref,checkpoint,appliedGrantIds:ids});this.captures.set(capture.captureId,capture);return capture;}
  /** A capture whose checkpoint was never written (its save round gave up before the commit) is forgotten. A retirement keeps its own. */
  discardCheckpointCapture(captureId:string):void {this.boundary(true);if([...this.retirements.values()].some(r=>r.capture.captureId===captureId))throw new Error('Retirement owns capture');if(!this.captures.delete(captureId))throw new Error('Unknown checkpoint capture');}
  markCheckpointDurable(captureId:string,revision:number,ids:readonly string[],featureIds?:readonly string[]):void {
    this.boundary(false,true);const c=this.captures.get(captureId);if(!c)throw new Error('Unknown checkpoint capture');
    if(!Number.isSafeInteger(revision)||revision<0||revision<(this.revisions.get(c.checkpoint.character)??0))throw new Error('Invalid checkpoint revision');
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length!==c.appliedGrantIds.length||ids.some(id=>!c.appliedGrantIds.includes(id)))throw new Error('Checkpoint receipt mismatch');
    const expectedFeature=c.appliedFeatureAwardIds;
    if(expectedFeature?(!Array.isArray(featureIds)||featureIds.length!==expectedFeature.length||new Set(featureIds).size!==featureIds.length||featureIds.some(id=>!expectedFeature.includes(id))):featureIds!==undefined&&featureIds.length>0)throw new Error('Feature checkpoint receipt mismatch');
    if(c.dungeonCapture){const p=this.ledgerPlayer(c.ref);if(canonicalValue(c.dungeonCapture)!==canonicalValue(this.dungeonCaptureFor(p)))throw new Error('Dungeon capture changed');}
    if(this.durableLedger){
      this.durableCaptureBoundary();this.ledgerPlayer(c.ref);if(!c.ledger)throw new Error('Missing checkpoint ledger capture');if((featureIds?.length||this.externalLedger&&ids.length)&&revision<=c.ledger.durableRevision)throw new Error('Receipts require advancing durable revision');
      const binding=this.receiptLedger.prepareMark(c.ledger,revision);
      if(this.externalLedger)this.worldRules.pruneAppliedGrantIds(c.checkpoint.character,ids);this.receiptLedger.activate(binding);
      for(const [token,r]of this.retirements)if(r.capture.captureId===captureId)this.retirementLedger.set(token,binding);
    }
    if(!this.externalLedger){const set=this.durableIds.get(c.checkpoint.character)??new Set<string>();for(const id of ids)set.add(id);this.durableIds.set(c.checkpoint.character,set);this.revisions.set(c.checkpoint.character,revision);}
    if(featureIds){const pending=this.featureApplied.get(c.checkpoint.character);for(const id of featureIds)pending?.delete(id);if(!pending?.size)this.featureApplied.delete(c.checkpoint.character);}
    this.captures.delete(captureId);
  }

  quiescePlayer(ref:EntityRef,reason:string):PlayerRetirement {this.boundary(false,true);const old=[...this.retirements.values()].find(r=>sameRef(r.capture.ref,ref));if(old)return old;const p=this.playerMap.get(ref.id);if(!p||!sameRef(p.unit.ref,ref))throw new Error('Stale player');const token=this.beginDurabilityBarrier(reason);try{this.neutralizeInput(ref);if(p.unit.actions.length)this.actions.stop(p.unit,undefined,0);const capture=this.capturePlayerCheckpoint(ref),retirement=immutable({token,capture});this.retirements.set(token,retirement);return retirement;}catch(error){this.barriers.delete(token);throw error;}}
  abortPlayerRetirement(token:string):void {this.boundary(false,true);const r=this.retirements.get(token);if(!r)return;this.captures.delete(r.capture.captureId);this.retirementLedger.delete(token);this.retirements.delete(token);this.barriers.delete(token);if(!this.barriers.size){this.receiptLedger.cancelAll();this.summaryRead=null;}}
  private removePlayer(ref:EntityRef):void {const p=this.playerMap.get(ref.id);this.dungeonReturns.delete(p?.state.character??'');if(p)this.featureApplied.delete(p.state.character);if(this.durableLedger&&p){this.receiptLedger.remove(p.state.character);this.durableIds.delete(p.state.character);this.revisions.delete(p.state.character);for(const [id,c]of this.captures)if(c.checkpoint.character===p.state.character)this.captures.delete(id);}this.purgeReferences(ref);this.playerMap.delete(ref.id);this.controllerMap.delete(ref.id);this.unitMap.delete(ref.id);this.context=immutable({...this.context,members:this.context.members.filter(m=>!sameRef(m.unit,ref))});this.syncMembership();}
  commitPlayerRetirement(token:string):void {this.boundary(false,true);const r=this.retirements.get(token);if(!r)return;const p=this.playerMap.get(r.capture.ref.id);if(!p||!sameRef(p.unit.ref,r.capture.ref))throw new Error('Stale retirement');if(this.captures.has(r.capture.captureId))throw new Error('Checkpoint not durable');if(this.durableLedger&&canonicalValue(this.retirementLedger.get(token))!==canonicalValue(this.receiptLedger.current(p.unit.ref,p.state.character)))throw new Error('Stale retirement ledger');if(canonicalValue(this.checkpointFor(p))!==canonicalValue(r.capture.checkpoint)||this.appliedGrantIds(p.state.character).length||this.appliedFeatureAwardIds(p.state.character).length||r.capture.dungeonCapture&&canonicalValue(r.capture.dungeonCapture)!==canonicalValue(this.dungeonCaptureFor(p)))throw new Error('Retirement changed after durable capture');this.events.assertRoom(this.playerMap.size*3+4);if(this.options.characters&&!this.options.characters.compareAndSwap(p.state.character,p.unit.ref,null))throw new Error('Character registry mismatch');this.removePlayer(p.unit.ref);this.retirementLedger.delete(token);this.retirements.delete(token);this.barriers.delete(token);if(!this.barriers.size){this.receiptLedger.cancelAll();this.summaryRead=null;}}
  private buildRestored(checkpoint:CharacterCheckpointV1,restored:RestoredPlayerData):{unit:SimUnit;player:PlayerController} {if(this.options.dungeon)throw new Error('Safe checkpoint cannot restore inside dungeon');const c=validateCheckpoint(checkpoint),d=validateCheckpoint(restored);if(c.character!==d.character||c.classId!==d.classId||c.archetype!==d.archetype||canonicalValue(c.progress)!==canonicalValue(d.progress)||d.world!==this.services.world)throw new Error('Restored identity/world/progression mismatch');if(d.activity.seated||d.activity.village||d.activity.cast||d.activity.channel||d.activity.dash||d.activity.pendingHit||d.activity.rootPending)throw new Error('Restore policy must resolve interrupted activity');if(Object.entries(d.activity.motion).some(([k,v])=>k==='dashElapsed'?v!==null:v!==0))throw new Error('Restore policy must resolve interrupted motion');const unit=this.makeUnit(d.archetype,'player','player',d.location),state=createPlayerState(d.character,unit,d.classId,this.clock),p=d.progress,v=d.survival,st=v.statuses,h=v.history,n=this.clock;
    teleport(unit,this.options.query,d.location.x,d.location.z,d.location.yaw);
    // The saved height stands only where the ground still is: a save inside what is now a building is pushed out by
    // teleport(), and one over ground whose height has changed since keeps the ground's, so nobody restores stuck or floating.
    if(unit.x===d.location.x&&unit.z===d.location.z&&Math.abs(unit.y-d.location.y)<.5)unit.y=d.location.y;
    Object.assign(unit,{alive:v.alive,hp:v.hp,maxHp:v.maxHp,level:levelForXp(p.xp),stunUntil:n+st.stunRemaining,slowUntil:n+st.slowRemaining,slowPct:st.slowPct,rustUntil:n+st.rustRemaining,rust:st.rust,absorbUntil:n+st.absorbRemaining,absorb:st.absorb,absorbMax:st.absorbMax,blessingUntil:n+st.blessingRemaining,encounterBlessing:st.encounterBlessing,lastCombat:n-h.combatAge});
    Object.assign(state,copyValue(p),{resource:v.resource,maxResource:v.maxResource,deadUntil:v.respawnRemaining===null?null:n+v.respawnRemaining,gcdStart:n-v.gcd.startAge,gcdEnd:n+v.gcd.endRemaining,cooldowns:Object.fromEntries(Object.entries(v.cooldowns).map(([id,c])=>[id,{start:n-c.startAge,end:n+c.endRemaining}])),warded:st.warded,lastSpend:n-h.spendAge,lastAttack:n-h.attackAge,nextSwing:n+h.nextSwingRemaining,controlsLocked:d.activity.controlsLocked});return {unit,player:createPlayer(this.services,unit,state)};
  }
  stageRestoredArrival(admission:Admission,checkpoint:CharacterCheckpointV1,restored:RestoredPlayerData,ledger?:{revision:number}):StagedArrival {this.boundary(false,true);const a=this.reservations.get(admission.token);if(!a||JSON.stringify(a)!==JSON.stringify(admission)||a.character!==checkpoint.character||this.arrivals.has(a.token)||this.restoredArrivals.has(a.token)||this.services.playerByCharacter(a.character))throw new Error('Invalid restored arrival');if(this.durableLedger)durableRevision(ledger?.revision);const created=this.buildRestored(checkpoint,restored),binding=this.durableLedger?this.receiptLedger.prepare(created.unit.ref,checkpoint.character,ledger!.revision):undefined;this.restoredArrivals.set(a.token,{token:a.token,admission:a,...created,ledger:binding});return immutable({token:a.token,admission:a,newRef:created.unit.ref});}
  activateRestoredArrival(token:string):EntityRef {this.boundary(false,true);if(this.instanceArrivals.has(token))throw new Error('Use instance arrival activation');const a=this.restoredArrivals.get(token);if(!a)throw new Error('Unknown restored arrival');this.activate(a.unit,a.player,a.ledger);this.restoredArrivals.delete(token);this.reservations.delete(token);return a.unit.ref;}
  restorePlayerCheckpoint(ref:EntityRef,checkpoint:CharacterCheckpointV1,restored:RestoredPlayerData,receiptIds:readonly string[]=[],revision?:number):EntityRef {this.boundary(false,true);if(!this.barriers.size)throw new Error('Recovery requires durability barrier');const p=this.playerMap.get(ref.id);if(!p||!sameRef(p.unit.ref,ref)||p.state.character!==checkpoint.character)throw new Error('Invalid recovery owner');if(receiptIds.some(id=>typeof id!=='string'||!id)||new Set(receiptIds).size!==receiptIds.length)throw new Error('Invalid recovery receipts');if(this.durableLedger)durableRevision(revision);const created=this.buildRestored(checkpoint,restored),binding=this.durableLedger?this.receiptLedger.prepare(created.unit.ref,checkpoint.character,revision):undefined;this.events.assertRoom(p.unit.actions.length+this.playerMap.size*3+4);if(this.options.characters&&!this.options.characters.compareAndSwap(p.state.character,ref,created.unit.ref))throw new Error('Character registry mismatch');this.removePlayer(ref);this.activate(created.unit,created.player,binding);this.worldRules.replaceAppliedGrantIds(checkpoint.character,this.externalLedger?[]:receiptIds);if(!this.externalLedger)this.durableIds.set(checkpoint.character,new Set(receiptIds));for(const [id,c]of this.captures)if(c.checkpoint.character===checkpoint.character)this.captures.delete(id);for(const [id,r]of this.retirements)if(r.capture.checkpoint.character===checkpoint.character){this.retirements.delete(id);this.retirementLedger.delete(id);this.barriers.delete(id);}return created.unit.ref;}
  snapshot():AreaSnapshot {this.boundary(true);this.updateRecovery();return immutable({area:this.services.id,world:this.services.world,tick:this.stepId,time:this.clock,units:[...this.unitMap.values()].sort((a,b)=>a.ref.id-b.ref.id),players:[...this.playerMap.values()].map(p=>p.state).sort((a,b)=>a.unit.id-b.unit.id),projectiles:[...this.flights.states.values()].sort((a,b)=>a.id-b.id),features:{mode:this.context.mode,pvp:this.context.pvp,beaconLit:this.worldRules.beaconLit,exploration:this.worldRules.explorationSnapshot(),boat:this.boat.snapshot(),village:this.village.snapshot(),bindings:Object.fromEntries([...this.unitMap.values()].filter(u=>u.kind==='player'||u.kind==='townsfolk').map(u=>[`actor:${u.ref.id}`,u.ref]))},recovery:{bosses:[...this.bossMap.values()].map(b=>({unit:b.unit,profile:b.profile,state:b.state,phase:b.phase,enraged:b.enraged,stateTime:b.stateTime,freed:b.freed.ref,freedTime:b.freedTime,showFrame:this.bossFrames.get(JSON.stringify(b.unit))??false})),telegraphs:[...this.telegraphs.values()],endings:[...this.endings.values()]}});}
  debugState():AreaDebugState {this.boundary(true);const w=this.worldRules.debugState();return immutable({schema:'s2-debug-v1',definitionVersion:JSON.stringify(this.options.definition),actionDataVersion:this.options.actionData.version,snapshot:this.snapshot(),rng:{algorithm:this.rng.algorithm,state:this.rng.state()},allocators:{entity:this.ids.nextValue,action:this.actions.nextGeneration,projectile:this.flights.nextId,timer:this.timers.nextId,event:this.events.nextOrder},playerControllers:[...this.playerMap.values()].map(p=>p.debugState()) as DebugValue[],enemies:[...this.enemyMap.values()].map(e=>e.debugState()) as DebugValue[],bosses:[...this.bossMap.values()].map(b=>b.debugState()) as DebugValue[],timers:this.timers.snapshot(),contributions:w.contributions,grants:w.grants,acknowledgedGrantIds:w.acknowledgedGrantIds,heldIntents:[...this.playerMap.values()].map(p=>({actor:p.state.unit,intent:p.heldIntent,lastConsumedSeq:p.lastConsumedSeq})),features:{...(this.dungeon?{dungeon:this.dungeon.debug()}:{}),boat:this.boat.debug(),village:this.village.debug(),npcs:[...this.npcMap.values()].map(n=>n.debug()),townsfolk:[...this.ambientMap.values()].map(n=>n.debug())} as unknown as DebugValue,lifecycle:{...(this.externalLedger?{receiptLedger:this.receiptLedger.debug(),summaryRead:this.summaryRead}:{}),barriers:[...this.barriers],captures:[...this.captures.values()],retirements:[...this.retirements.values()],durableIds:[...this.durableIds].map(([character,ids])=>({character,ids:[...ids]})),revisions:[...this.revisions],restoredArrivals:[...this.restoredArrivals.values()].map(a=>({token:a.token,admission:a.admission,unit:a.unit,state:a.player.state})),nextEcho:this.nextEcho,nextToken:this.tokenIds.nextValue,reservations:[...this.reservations.values()],departures:[...this.departures.values()],arrivals:[...this.arrivals.values()].map(a=>({token:a.token,admission:a.admission,unit:a.unit,state:a.player.state,dto:a.dto}))} as unknown as DebugValue,interactions:w.interactions as unknown as DebugValue,context:this.context});}
  drainEvents(){this.boundary(true);this.updateRecovery();return this.events.drain();}
  applyContext(context:AreaContext):void {this.boundary();if(this.options.dungeon?context.mode!=='dungeon'||context.pvp!=='disabled':context.mode==='dungeon')throw new Error('Invalid dungeon context');if(this.externalLedger)validateSourceLedgerCapacity(this.services.id,this.services.world,this.options.ledgerLimits!,baseStepVictimLives(this.options.definition),capacity(context));if(this.playerMap.size+this.reservations.size>capacity(context))throw new Error('Membership exceeds area capacity');const ids=new Set<number>(),characters=new Set<string>();for(const m of context.members){const p=this.services.player(m.unit);if(!p||p.state.character!==m.character||ids.has(m.unit.id)||characters.has(m.character))throw new Error('Invalid membership');ids.add(m.unit.id);characters.add(m.character);}if(ids.size!==this.playerMap.size)throw new Error('Missing membership');this.context=immutable(context);}
  private spawn(id:string){const d=this.options.definition;const p=id===d.spawn.id?d.spawn:id===d.recall.id?d.recall:d.pois[id]??Object.values(d.pois).find(p=>p.id===id);if(!p)throw new Error('Unknown spawn');return p;}
  private createCharacter(character:CharacterId,classId:ClassId,archetype:string,spawnId:string){const spawn=this.spawn(spawnId),u=this.makeUnit(archetype,'player','player',spawn.position);teleport(u,this.options.query,spawn.position.x,spawn.position.z,spawn.yaw);const state=createPlayerState(character,u,classId,this.clock);state.quests=freshQuests();setQuestChapter(state.quests,worldChapter(this.services.world));return {unit:u,player:createPlayer(this.services,u,state)};}
  private activate(unit:SimUnit,player:PlayerController,ledger?:DurableLedgerBinding):void {if(ledger)this.receiptLedger.activate(ledger);this.unitMap.set(unit.ref.id,unit);this.playerMap.set(unit.ref.id,player);this.controllerMap.set(unit.ref.id,player);this.context=immutable({...this.context,members:[...this.context.members,{character:player.state.character,unit:unit.ref,party:null,villagePlaying:false,seatedBoat:null}]});this.boat.restoreProgress(`actor:${unit.ref.id}`,player.state.achievements);}
  attachFresh(character:CharacterId,classId:ClassId,archetype:string,spawn:string,revision?:number):EntityRef {this.boundary();if(this.durableLedger){externalCharacter(character);durableRevision(revision);}if(!character||this.services.playerByCharacter(character)||this.playerMap.size+this.reservations.size>=capacity(this.context))throw new Error('Character admission rejected');if(this.options.characters?.owner(character))throw new Error('Character already owned');const created=this.createCharacter(character,classId,archetype,spawn),ledger=this.durableLedger?this.receiptLedger.prepare(created.unit.ref,character,revision):undefined;if(this.options.characters&&!this.options.characters.compareAndSwap(character,null,created.unit.ref))throw new Error('Character registry mismatch');this.activate(created.unit,created.player,ledger);return created.unit.ref;}
  reserveAdmission(character:CharacterId,spawn:string,hostTick:number):Admission|null {this.boundary();if(this.durableLedger)externalCharacter(character);if(!Number.isSafeInteger(hostTick)||hostTick<0)throw new Error('Invalid host tick');for(const a of this.reservations.values())if(a.expiresAtHostTick<hostTick)this.releaseAdmission(a.token);this.spawn(spawn);if(this.services.playerByCharacter(character)||[...this.reservations.values()].some(a=>a.character===character)||this.playerMap.size+this.reservations.size>=capacity(this.context))return null;const a=immutable({token:JSON.stringify([this.services.id,'admission',this.tokenIds.next()]),character,destination:this.services.id,spawn,expiresAtHostTick:hostTick+30});this.reservations.set(a.token,a);return a;}
  releaseAdmission(token:string):void {this.boundary(false,true);this.instanceArrivals.delete(token);this.arrivals.delete(token);this.restoredArrivals.delete(token);this.reservations.delete(token);}
  stageDeparture(ref:EntityRef):StagedDeparture {
    this.boundary();if(this.options.dungeon)throw new Error('Dungeon exit requires checkpoint stage');const p=this.services.player(ref);if(!p||[...this.departures.values()].some(d=>d.character===p.state.character))throw new Error('Invalid departure');
    const binding=this.durableLedger?this.receiptLedger.current(ref,p.state.character):undefined;
    if(binding&&(this.appliedFeatureAwardIds(p.state.character).length||this.appliedGrantIds(p.state.character).length||this.receiptLedger.hasRead(p.state.character)||[...this.captures.values()].some(c=>c.checkpoint.character===p.state.character)))throw new Error('Ledger must be durable before transfer');
    const u=this.getUnit(ref)!;this.events.assertRoom(u.actions.length+this.playerMap.size*3+4);
    const dto={...captureTransfer(this.services,p,this.externalLedger?[]:this.worldRules.appliedGrantIds(p.state.character)),...(this.options.featureAwards?{featureLedger:{revision:binding!.durableRevision}}:{}),...(this.externalLedger?{ledger:{mode:'external-durable' as const,revision:binding!.durableRevision}}:{durableGrantIds:[...(this.durableIds.get(p.state.character)??[])]})};
    const d=immutable({token:JSON.stringify([this.services.id,'departure',this.tokenIds.next()]),character:p.state.character,source:this.services.id,sourceRef:ref,dto});this.departures.set(d.token,d);return d;
  }
  stageArrival(admission:Admission,dto:TransferDTO):StagedArrival {
    this.boundary();const a=this.reservations.get(admission.token);if(!a||JSON.stringify(a)!==JSON.stringify(admission)||a.character!==dto.character||this.arrivals.has(a.token))throw new Error('Invalid arrival');
    if(!!this.options.featureAwards!==!!dto.featureLedger)throw new Error('Transfer feature ledger mismatch');
    if(dto.featureLedger){durableRevision(dto.featureLedger.revision);if(dto.ledger&&dto.featureLedger.revision!==dto.ledger.revision)throw new Error('Transfer revision mismatch');}
    if(this.externalLedger!==!!dto.ledger||dto.ledger&&dto.ledger.mode!=='external-durable')throw new Error('Transfer ledger mode mismatch');
    if(dto.ledger){durableRevision(dto.ledger.revision);if(dto.appliedGrantIds.length||dto.durableGrantIds?.length)throw new Error('External transfer carries receipt history');}
    if(dto.durableGrantIds&&(new Set(dto.durableGrantIds).size!==dto.durableGrantIds.length||dto.durableGrantIds.some(id=>!dto.appliedGrantIds.includes(id))))throw new Error('Invalid durable transfer receipts');
    const owned=copyValue(dto),created=this.createCharacter(dto.character,dto.classId,dto.archetype,a.spawn),ledger=this.durableLedger?this.receiptLedger.prepare(created.unit.ref,dto.character,dto.ledger?.revision??dto.featureLedger!.revision):undefined;
    restoreTransfer(owned,created.unit,created.player.state,this.clock,this.services.world);this.arrivals.set(a.token,{token:a.token,admission:a,...created,dto:owned,ledger});return immutable({token:a.token,admission:a,newRef:created.unit.ref});
  }

  abortDeparture(token:string):void {this.boundary();this.departures.delete(token);}
  abortArrival(token:string):void {this.boundary(false,true);this.instanceArrivals.delete(token);this.arrivals.delete(token);this.restoredArrivals.delete(token);}
  commitDeparture(token:string):void {this.boundary();const d=this.departures.get(token);if(!d)throw new Error('Unknown departure');const u=this.getUnit(d.sourceRef)!;this.actions.stop(u,undefined,0);u.pendingHit=null;this.removePlayer(d.sourceRef);this.departures.delete(token);}
  activateArrival(token:string):EntityRef {this.boundary();const a=this.arrivals.get(token);if(!a)throw new Error('Unknown arrival');this.activate(a.unit,a.player,a.ledger);if(!this.externalLedger){this.worldRules.restoreAppliedGrantIds(a.dto.character,a.dto.appliedGrantIds);const durable=this.durableIds.get(a.dto.character)??new Set<string>();for(const id of a.dto.durableGrantIds??[])durable.add(id);this.durableIds.set(a.dto.character,durable);}this.instanceArrivals.delete(token);this.arrivals.delete(token);this.restoredArrivals.delete(token);this.reservations.delete(token);return a.unit.ref;}
  dungeonObservation(){this.boundary(true);return this.dungeon?.observation()??null;}
  pendingDungeonCompletion(){this.boundary(true);return this.dungeon?.pending()??null;}
  acknowledgeDungeonCompletion(token:string):void {this.boundary(true);if(!this.dungeon)throw new Error('Not a dungeon Area');this.dungeon.acknowledge(token);}
  pendingGrants(){return immutable(this.worldRules.pendingGrants());}
  acknowledgeGrant(id:string):void {this.boundary(true);this.worldRules.acknowledgeGrant(id);}
  receiveGrant(grant:EarnedGrant){this.boundary(false,true);if(this.externalLedger)throw new Error('External ledger requires certified delivery');return this.worldRules.applyGrant(grant);}
  dispose():void {if(this.running)throw new Error('Requires between-tick boundary');if(this.disposed)return;if(this.dungeon?.pending())throw new Error('Unacknowledged dungeon completion');if([...this.featureApplied.values()].some(p=>p.size))throw new Error('Unacknowledged feature receipts');if(this.pendingGrants().length)throw new Error('Unacknowledged grants');if(this.instanceExits.size||this.departures.size||this.arrivals.size||this.restoredArrivals.size)throw new Error('Transfer active');if(this.externalLedger){const usage=this.worldRules.externalResourceUsage();if(usage.dirtyCreditEntries||usage.pendingDeaths)throw new Error('Undrained source ledger');}if(this.options.characters){for(const p of this.playerMap.values())if(!sameRef(this.options.characters.owner(p.state.character)??{area:'',id:0,life:0},p.state.unit))throw new Error('Character registry mismatch');for(const p of this.playerMap.values())this.options.characters.compareAndSwap(p.state.character,p.state.unit,null);}this.disposed=true;this.summaryRead=null;this.featureApplied.clear();this.dungeonReturns.clear();this.instanceExits.clear();this.instanceArrivals.clear();this.receiptLedger.clear();this.retirementLedger.clear();this.captures.clear();this.durableIds.clear();this.revisions.clear();this.unitMap.clear();this.playerMap.clear();this.enemyMap.clear();this.bossMap.clear();this.controllerMap.clear();this.flights.clear();this.timers.clear();this.reservations.clear();}
}
export {SimulationArea as Area};
export function createArea(options:AreaOptions):SimulationArea{return new SimulationArea(options);}
