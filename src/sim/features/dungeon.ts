import type {AreaId,AreaServices,EntityRef,SimUnit} from '../types.ts';
import {immutable} from '../events.ts';
import {Enemy} from '../enemy.ts';
import {DUNGEONS,DUNGEON_CHAMBER as C,DUNGEON_WAVES,dungeonFor,dungeonDanger,dungeonHazards,type DungeonTier,type DungeonHazard} from '../data/dungeons.ts';
export interface DungeonOptions {readonly runId:string;readonly tier:DungeonTier}
export interface DungeonRunKey {readonly area:AreaId;readonly runId:string}
export interface DungeonObservation {readonly run:DungeonRunKey;readonly tier:DungeonTier;readonly stage:1|2|3;readonly phase:'rest'|'wave'|'clear'|'failed';readonly clock:number;readonly restRemaining:number;readonly hazardSerial:number;/** Local X/Z metres around the shared chamber centre. */readonly warning:readonly DungeonHazard[];readonly activeEnemies:readonly EntityRef[];readonly captain:EntityRef|null;readonly completionPending:boolean}
export interface DungeonCompletionCandidate {readonly run:DungeonRunKey;readonly tier:DungeonTier;readonly completedTick:number;readonly finalWave:readonly EntityRef[];readonly baseXp:number;readonly coins:number}
export interface CapturedDungeonCompletion {readonly token:string;readonly candidate:Readonly<DungeonCompletionCandidate>}
export function dungeonPlayerEligible(unit:Readonly<SimUnit>,tier:DungeonTier):boolean{return unit.alive&&!unit.hidden&&unit.level>=tier&&Math.abs(unit.y-C.y)<4&&Math.hypot(unit.x-C.x,unit.z-C.z)<C.containment;}
/** One fixed-step run. No renderer, timers, entitlement roster or reward application. */
export class DungeonController {
 private readonly run:DungeonRunKey;private readonly options:DungeonOptions;private readonly services:AreaServices;private readonly pool:readonly Enemy[];
 private stage:1|2|3=1;private phase:DungeonObservation['phase']='rest';private left=2;private clock=0;private hazard=0;private hit=-1;
 private waveRefs:readonly EntityRef[]=[];private captain:EntityRef|null=null;private completion:CapturedDungeonCompletion|null=null;private acknowledged:string|null=null;
 constructor(services:AreaServices,options:DungeonOptions,pool:readonly Enemy[]){
  this.services=services;this.pool=pool;
  if(!options.runId||options.runId.length>128||!dungeonFor(options.tier)||pool.length!==6||pool.some((e,i)=>e.spawn.role!=='dungeon'||e.spawn.dungeonTier!==options.tier||e.spawn.dungeonSlot!==i))throw new Error('Invalid dungeon run');
  this.options=immutable(options);this.run=immutable({area:services.id,runId:options.runId});
 }
 private players():readonly SimUnit[]{return this.services.context.members.flatMap(m=>{const p=this.services.player(m.unit),u=p&&this.services.getUnit(p.state.unit);return u&&dungeonPlayerEligible(u,this.options.tier)?[u]:[];});}
 private wave():void {
  this.phase='wave';this.clock=0;this.hazard=0;this.hit=-1;for(const e of this.pool)e.despawn();
  const count=DUNGEON_WAVES[this.stage-1];for(const[i,e]of this.pool.entries()){e.configureDungeon(this.stage===3&&i===0);if(i>=count)continue;const angle=i/count*Math.PI*2;e.respawnAt(C.x+Math.cos(angle)*11,C.z+Math.sin(angle)*11);e.pack=[...this.pool.slice(0,count)];e.aggro(false);}
  this.waveRefs=immutable(this.pool.slice(0,count).map(e=>e.unit));this.captain=this.stage===3?this.waveRefs[0]:null;
 }
 private strike():void {const source=this.pool.find(e=>this.services.getUnit(e.unit)?.alive);if(!source)return;const index=DUNGEONS.findIndex(d=>d.level===this.options.tier);for(const p of this.players())if(dungeonDanger(index,this.hazard,p.x-C.x,p.z-C.z))this.services.combat.damage(source.unit,p.ref,Math.round((18+this.options.tier*.42)*1.25));}
 step():void {
  if(this.phase==='clear'||this.phase==='failed')return;
  if(this.phase==='rest'){this.left=Math.max(0,this.left-1/30);if(this.left===0)this.wave();return;}
  const before=this.clock;this.clock=Math.min(9999999,this.clock+1/30);this.hazard=Math.floor(this.clock/7);
  if(Math.floor(before/7)===this.hazard&&before%7<2.5&&this.clock%7>=2.5&&this.hit!==this.hazard){this.hit=this.hazard;this.strike();}
  if(this.pool.every(e=>!this.services.getUnit(e.unit)?.alive)){
   if(this.stage===3){const facts=dungeonFor(this.options.tier)!;this.phase='clear';this.completion=immutable({token:JSON.stringify([this.run.area,'dungeon-completion',this.run.runId]),candidate:{run:this.run,tier:this.options.tier,completedTick:this.services.tick,finalWave:this.waveRefs,baseXp:facts.xp,coins:facts.coins}});}
   else{this.stage=(this.stage+1) as 2|3;this.phase='rest';this.left=3;this.captain=null;}
  }else if(!this.players().length){this.phase='failed';for(const e of this.pool)e.despawn();}
 }
 observation():Readonly<DungeonObservation>{return immutable({run:this.run,tier:this.options.tier,stage:this.stage,phase:this.phase,clock:this.clock,restRemaining:this.left,hazardSerial:this.hazard,warning:this.phase==='wave'&&this.clock%7<2.5?dungeonHazards(DUNGEONS.findIndex(d=>d.level===this.options.tier),this.hazard):[],activeEnemies:this.pool.flatMap(e=>this.services.getUnit(e.unit)?.alive?[e.unit]:[]),captain:this.captain,completionPending:!!this.completion});}
 pending():Readonly<CapturedDungeonCompletion>|null{return this.completion;}
 acknowledge(token:string):void {if(typeof token!=='string'||!token)throw new Error('Unknown dungeon completion token');if(token===this.acknowledged)return;if(!this.completion||token!==this.completion.token)throw new Error('Unknown dungeon completion token');this.acknowledged=token;this.completion=null;}
 debug(){return immutable({observation:this.observation(),hit:this.hit,waveRefs:this.waveRefs,completion:this.completion,acknowledged:this.acknowledged});}
}
