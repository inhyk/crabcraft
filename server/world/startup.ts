/** Explicit server composition. This module does not read environment variables or open a listener. */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import { createCoreCharacterCodec, type CharacterCheckpointV1, type RestorePolicy } from '../../src/sim/persistence.ts';
import { createWorldVariants, personalNpcVisible } from '../../src/sim/areas/variants.ts';
import { canonicalEnemyRespawn, enemyRespawnClearance, enemyStats } from '../../src/sim/data/enemies.ts';
import { worldChapter } from '../../src/sim/math.ts';
import { CLASSES } from '../../src/sim/data/classes.ts';
import type { AreaPolicy, BossProfileId, EnemySpawn, PlayerState, SimUnit, WorldId } from '../../src/sim/types.ts';
import { WorldChatService } from './chat.ts';
import { CharacterStore } from './character-store.ts';
import { DurableOutcomeStore } from './contribution-store.ts';
import { createEndingStage } from '../../src/sim/features/worldRules.ts';
import { planOutcomePage } from '../../src/sim/ledger.ts';
import { type WorldTicketRegistry } from './admission.ts';
import { loadWorldCatalog, createGameplayCatalog, PUBLIC_WORLDS, HOSTED_BOSSES, type LoadedWorldDefinition, type HostedWorldId, type HostedBossProfileId } from './catalog.ts';
import { createGameplayProtocol, projectObservationExtras } from './gameplay/protocol.ts';
import { acquireHostOwnership } from './ownership.ts';
import { createActualWorldHost, type HostPolicies } from './host.ts';
import { WorldConfigError } from './startup-error.ts';

type TimingMode = 'pause' | 'elapse';
export type ConfiguredRestore = { cooldowns:TimingMode; statuses:TimingMode; death:TimingMode; history:TimingMode; hp:'preserve'; resource:'preserve'; location:'saved'|'arrival'; activity:'cancel' };
type Kinds = 'scrapling'|'scavenger'|'jellyfish'|'echo';
type PopulationGroup = 'scrapling'|'scavenger'|'jellyfish'|'shallowPatrols'|'echo';
export type NearbySlotRule = {radius:number;base:number;max:number;scale:number};
export type ConfiguredRegion = {seed:number;populationMode:'fixed-slots'|'nearby-slots-v1';fixedLevels:Record<Kinds,number>;population:Record<Exclude<PopulationGroup,'echo'>,number>;respawnSeconds:Record<Kinds,number>;nearby?:Record<PopulationGroup,NearbySlotRule>};
const HOST_DEFAULTS = Object.freeze({authTimeoutMs:5000,inputTimeoutMs:400,reconnectGraceMs:30000,sessionRevalidateMs:30000,checkpointIntervalMs:1000,maxConnections:2000,maxConnectionsPerIp:16,maxWaiting:1000,maxAuthFrameBytes:1024,maxFrameBytes:65536,maxBufferedBytes:4194304,maxQueuedInputs:128,maxMutationSourcesPerTick:128,loopIntervalMs:5});
const AREA_DEFAULTS = Object.freeze({eventCount:16384,inputCommandsPerTick:32,timers:4096,projectiles:4096});
const PERSISTENCE_DEFAULTS = Object.freeze({maxQueuedPerCharacter:1,maxAttempts:3,retryMs:100,maxRecoveryRounds:2});
export type ConfiguredParty = {enabled:false}|{enabled:true;maxParties:number;maxEncounters:number;returns:Record<HostedBossProfileId,{world:WorldId;spawn:string}>};
export type ValidatedWorldConfig = {
 schema:'world-startup-v1';
 ownership:{key:string;heartbeatMs:number;queryTimeoutMs:number};
 assets:{source:string;manifest:'world-manifest.json';maxBakeBytes:number;maxTotalBakeBytes:number;maxManifestBytes:number;maxCells:number};
 worlds:Record<HostedWorldId,ConfiguredRegion>;restore:ConfiguredRestore;
 limits:{[K in keyof typeof HOST_DEFAULTS]:number};areaLimits:{[K in keyof typeof AREA_DEFAULTS]:number};persistence:{[K in keyof typeof PERSISTENCE_DEFAULTS]:number};
 victimOutcome:HostPolicies['victimOutcome'];victimOutcomeRetryCeiling?:HostPolicies['victimOutcome'];chat:{maxPending:number};
 party:ConfiguredParty;characters?:{maxCharactersPerAccount?:number};
};
function fail(path:string):never {throw new WorldConfigError(path);}
function detached(value:unknown):unknown {
 let nodes=0;const active=new Set<object>();
 const visit=(v:unknown,depth:number):unknown=>{if(++nodes>4096||depth>16)fail('JSON complexity');if(v===null||typeof v==='boolean'||typeof v==='string')return v;if(typeof v==='number'&&Number.isFinite(v))return v;if(!v||typeof v!=='object'||active.has(v))fail('finite acyclic JSON required');const array=Array.isArray(v);if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('plain JSON required');if(Object.getOwnPropertySymbols(v).length)fail('symbol keys');active.add(v);const keys=Object.keys(v);if(array&&(keys.length!==v.length||keys.some(k=>String(Number(k))!==k||Number(k)<0||Number(k)>=v.length)))fail('dense arrays required');const out:Record<string,unknown>|unknown[]=array?[]:{};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k)!;if(!('value'in d)||k==='__proto__')fail('data fields required');Object.defineProperty(out,k,{value:visit(d.value,depth+1),enumerable:true,writable:true,configurable:true});}active.delete(v);return out;};
 const result=visit(value,0);if(Buffer.byteLength(JSON.stringify(result))>65536)fail('JSON bytes');return result;
}
function object(value:unknown,required:readonly string[],optional:readonly string[],path:string):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))fail(path);const o=value as Record<string,unknown>;if(required.some(k=>!Object.hasOwn(o,k))||Object.keys(o).some(k=>![...required,...optional].includes(k)))fail(path);return o;}
function integer(value:unknown,path:string,min:number,max:number):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail(path);return value;}
function seconds(value:unknown,path:string):number {if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>Number.MAX_SAFE_INTEGER)fail(path);return value;}
function choice<T extends string>(value:unknown,allowed:readonly T[],path:string):T {if(typeof value!=='string'||!allowed.includes(value as T))fail(path);return value as T;}
function hash(value:unknown,path:string):string {if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail(path);return value;}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function optional(o:Record<string,unknown>,key:string,fallback:unknown):unknown {return Object.hasOwn(o,key)?o[key]:fallback;}
function numericOverrides<T extends Record<string,number>>(raw:unknown,defaults:T,path:string,max:number):T {const o=raw===undefined?{}:object(raw,[],Object.keys(defaults),path);return Object.fromEntries(Object.entries(defaults).map(([k,n])=>[k,integer(optional(o,k,n),`${path}.${k}`,k==='reconnectGraceMs'||k==='maxRecoveryRounds'?0:1,max)])) as T;}
function validateRestore(value:unknown):ConfiguredRestore {
 const r=object(detached(value),['cooldowns','statuses','death','history','hp','resource','location','activity'],[],'restore'),timing=['pause','elapse'] as const;
 return freeze({cooldowns:choice(r.cooldowns,timing,'restore.cooldowns'),statuses:choice(r.statuses,timing,'restore.statuses'),death:choice(r.death,timing,'restore.death'),history:choice(r.history,timing,'restore.history'),hp:choice(r.hp,['preserve'],'restore.hp'),resource:choice(r.resource,['preserve'],'restore.resource'),location:choice(r.location,['saved','arrival'],'restore.location'),activity:choice(r.activity,['cancel'],'restore.activity')});
}
export function validateWorldConfig(value:unknown):ValidatedWorldConfig {
 const c=object(detached(value),['schema','ownership','assets','worlds','restore','victimOutcome','chat'],['limits','areaLimits','persistence','party','characters','victimOutcomeRetryCeiling'],'root');choice(c.schema,['world-startup-v1'],'schema');
 const own=object(c.ownership,['key'],['heartbeatMs','queryTimeoutMs'],'ownership');if(typeof own.key!=='string'||!own.key.length||Buffer.byteLength(own.key)>128||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(own.key))fail('ownership.key');
 const a=object(c.assets,['source','manifest'],['maxBakeBytes','maxTotalBakeBytes','maxManifestBytes','maxCells'],'assets');
 const assets={source:hash(a.source,'assets.source'),manifest:choice(a.manifest,['world-manifest.json'],'assets.manifest'),maxBakeBytes:integer(optional(a,'maxBakeBytes',16777216),'assets.maxBakeBytes',1,134217728),maxTotalBakeBytes:integer(optional(a,'maxTotalBakeBytes',67108864),'assets.maxTotalBakeBytes',1,268435456),maxManifestBytes:integer(optional(a,'maxManifestBytes',16384),'assets.maxManifestBytes',1,65536),maxCells:integer(optional(a,'maxCells',1000000),'assets.maxCells',4,4000000)};
 const worlds=object(c.worlds,PUBLIC_WORLDS,[],'worlds'),kinds=['scrapling','scavenger','jellyfish','echo'] as const,populations=['scrapling','scavenger','jellyfish','shallowPatrols'] as const;
 const regions=Object.fromEntries(PUBLIC_WORLDS.map(world=>{
  const w=object(worlds[world],['seed','populationMode','fixedLevels','population','respawnSeconds'],['nearby'],`worlds.${world}`),levels=object(w.fixedLevels,kinds,[],`${world}.fixedLevels`),pop=object(w.population,populations,[],`${world}.population`),respawn=object(w.respawnSeconds,kinds,[],`${world}.respawnSeconds`),mode=choice(w.populationMode,['fixed-slots','nearby-slots-v1'],`${world}.populationMode`);
  const population=Object.fromEntries(populations.map(k=>[k,integer(pop[k],`${world}.population.${k}`,0,256)])) as ConfiguredRegion['population'];let nearby:ConfiguredRegion['nearby'];
  if(mode==='nearby-slots-v1'){
   const groups=[...populations,'echo'] as const,rules=object(w.nearby,groups,[],`${world}.nearby`);nearby=Object.fromEntries(groups.map(group=>{const rule=object(rules[group],['radius','base','max','scale'],[],`${world}.nearby.${group}`),radius=seconds(rule.radius,`${world}.${group}.radius`),max=integer(rule.max,`${world}.${group}.max`,0,group==='echo'?1:256),base=integer(rule.base,`${world}.${group}.base`,0,max),scale=rule.scale;if(typeof scale!=='number'||!Number.isFinite(scale)||scale<0||scale>Number.MAX_SAFE_INTEGER)fail(`${world}.${group}.scale`);if(group!=='echo'&&max!==population[group])fail(`${world}.${group}.max must match pool population`);const clearance=enemyRespawnClearance(group==='shallowPatrols'||group==='echo'?'scrapling':group,worldChapter(world),group==='echo'?'echo':'ordinary');if(scale>0&&max>base&&radius<=clearance)fail(`${world}.${group}.radius has no safe scaling annulus`);return[group,{radius,base,max,scale}];})) as Record<PopulationGroup,NearbySlotRule>;
  }else if(w.nearby!==undefined)fail(`${world}.nearby requires nearby-slots-v1`);
  const respawnSeconds=Object.fromEntries(kinds.map(k=>[k,seconds(respawn[k],`${world}.respawnSeconds.${k}`)]));if(respawnSeconds.echo!==canonicalEnemyRespawn('scrapling',worldChapter(world),'echo'))fail(`${world}.echo respawn must match canonical timer`);return[world,{seed:integer(w.seed,`${world}.seed`,0,0xffffffff),populationMode:mode,fixedLevels:Object.fromEntries(kinds.map(k=>[k,integer(levels[k],`${world}.fixedLevels.${k}`,1,Number.MAX_SAFE_INTEGER)])),population,respawnSeconds,...(nearby?{nearby}:{})}];
 })) as Record<HostedWorldId,ConfiguredRegion>;
 const restore=validateRestore(c.restore);
 const resources=(raw:unknown,path:string)=>{const r=object(raw,['maxEntries','maxPayloadBytes','timeoutMs'],[],path);return{maxEntries:integer(r.maxEntries,`${path}.maxEntries`,1,Number.MAX_SAFE_INTEGER),maxPayloadBytes:integer(r.maxPayloadBytes,`${path}.maxPayloadBytes`,1,Number.MAX_SAFE_INTEGER),timeoutMs:integer(r.timeoutMs,`${path}.timeoutMs`,1,2147483647)};};
 const victimOutcome=resources(c.victimOutcome,'victimOutcome'),retry=c.victimOutcomeRetryCeiling===undefined?undefined:resources(c.victimOutcomeRetryCeiling,'victimOutcomeRetryCeiling');
 if(retry&&Object.keys(victimOutcome).some(k=>retry[k as keyof typeof retry]<victimOutcome[k as keyof typeof victimOutcome]))fail('victimOutcomeRetryCeiling below initial resources');
 const ch=object(c.chat,['maxPending'],[],'chat'),chat={maxPending:integer(ch.maxPending,'chat.maxPending',1,10000)};
 const limits=numericOverrides(c.limits,HOST_DEFAULTS,'limits',16777216),areaLimits=numericOverrides(c.areaLimits,AREA_DEFAULTS,'areaLimits',1048576),persistence=numericOverrides(c.persistence,PERSISTENCE_DEFAULTS,'persistence',60000);
 if(limits.maxMutationSourcesPerTick>256||limits.maxQueuedInputs>1024||limits.maxConnections>10000||limits.maxWaiting>10000||limits.maxConnectionsPerIp>limits.maxConnections||limits.maxAuthFrameBytes>limits.maxFrameBytes||limits.maxAuthFrameBytes>65536||limits.maxFrameBytes>2097152||limits.loopIntervalMs>1000||areaLimits.inputCommandsPerTick>32||persistence.maxQueuedPerCharacter>256||persistence.maxAttempts>100||persistence.maxRecoveryRounds>32)fail('unsupported operational bounds');
 for(const world of PUBLIC_WORLDS){const region=regions[world];if(Object.values(region.population).reduce((sum,n)=>sum+n,0)>limits.maxMutationSourcesPerTick)fail(`${world}.population exceeds receipt bound`);}
 let characters:{maxCharactersPerAccount?:number}|undefined;if(c.characters!==undefined){const p=object(c.characters,[],['maxCharactersPerAccount'],'characters');characters=Object.hasOwn(p,'maxCharactersPerAccount')?{maxCharactersPerAccount:integer(p.maxCharactersPerAccount,'characters.maxCharactersPerAccount',1,Number.MAX_SAFE_INTEGER)}:{};}
 let party:ConfiguredParty={enabled:false};if(c.party!==undefined){const p=object(c.party,['enabled'],['maxParties','maxEncounters','returns'],'party');if(p.enabled===false){object(p,['enabled'],[],'party disabled');}else if(p.enabled===true){const profiles=HOSTED_BOSSES,returns=object(p.returns,profiles,[],'party.returns'),maxParties=integer(p.maxParties,'party.maxParties',1,10000),maxEncounters=integer(p.maxEncounters,'party.maxEncounters',1,1024);if(maxEncounters>maxParties)fail('party encounter/party bounds');const destinations=Object.fromEntries(profiles.map(profile=>{const r=object(returns[profile],['world','spawn'],[],`party.returns.${profile}`);if(typeof r.spawn!=='string'||!r.spawn.length||r.spawn.length>128)fail(`party.returns.${profile}.spawn`);return[profile,{world:choice(r.world,PUBLIC_WORLDS,`party.returns.${profile}.world`),spawn:r.spawn}];})) as Extract<ConfiguredParty,{enabled:true}>['returns'];party={enabled:true,maxParties,maxEncounters,returns:destinations};}else fail('party.enabled');}

 return freeze({schema:'world-startup-v1',ownership:{key:own.key,heartbeatMs:integer(optional(own,'heartbeatMs',1000),'ownership.heartbeatMs',1,60000),queryTimeoutMs:integer(optional(own,'queryTimeoutMs',1000),'ownership.queryTimeoutMs',1,60000)},assets,worlds:regions,restore,limits,areaLimits,persistence,victimOutcome,chat,...(retry?{victimOutcomeRetryCeiling:retry}:{}),party,...(characters===undefined?{}:{characters})});
}
/** Separate composition envelope: old WORLD_CONFIG_JSON remains valid across a binary rollback. */
export type ConfiguredLedgerConfig = NonNullable<HostPolicies['ledger']>&{schema:'world-ledger-v1';queryTimeoutMs:number};
export function validateLedgerConfig(value:unknown):ConfiguredLedgerConfig {
 const c=object(detached(value),['schema','queryTimeoutMs','sourceLimits','drainLimits','recoveryLimits','recoveryIntervalMs'],[],'ledger');
 const group=<K extends string>(raw:unknown,keys:readonly K[],path:string,max:number):Record<K,number>=>{const fields=object(raw,keys,[],path);return Object.fromEntries(keys.map(k=>[k,integer(fields[k],`${path}.${k}`,1,max)])) as Record<K,number>;};
 return freeze({schema:choice(c.schema,['world-ledger-v1'],'ledger.schema'),queryTimeoutMs:integer(c.queryTimeoutMs,'ledger.queryTimeoutMs',1,2147483647),
  sourceLimits:group(c.sourceLimits,['maxDirtyCreditEntries','maxDirtyCreditBytes','maxPendingDeaths','maxStagedBytes'] as const,'ledger.sourceLimits',Number.MAX_SAFE_INTEGER),
  drainLimits:group(c.drainLimits,['pageSize','creditBatchesPerSlice','outcomesPerSlice','summaryVictimsPerSlice','writeAttempts'] as const,'ledger.drainLimits',100),
  recoveryLimits:group(c.recoveryLimits,['draftsPerSlice','pageSize'] as const,'ledger.recoveryLimits',100),recoveryIntervalMs:integer(c.recoveryIntervalMs,'ledger.recoveryIntervalMs',1,2147483647)});
}
export function createConfiguredAreaPolicy(region:ConfiguredRegion):AreaPolicy&{populationRadius?:(spawn:EnemySpawn)=>number} {
 const policy:AreaPolicy={enemyLevel:spawn=>spawn.fixedLevel,enemyPopulation:spawn=>({desired:1,respawnSeconds:region.respawnSeconds[spawn.role==='echo'?'echo':spawn.kind]}),damageAllowed:(context,source,target)=>{if(source?.kind!=='player'||target.kind!=='player')return true;if(context.mode!=='party-encounter'||context.pvp!=='party-only')return false;const same=(a:SimUnit['ref'],b:SimUnit['ref'])=>a.area===b.area&&a.id===b.id&&a.life===b.life;if(same(source.ref,target.ref))return false;const a=context.members.find(m=>same(m.unit,source.ref)),b=context.members.find(m=>same(m.unit,target.ref));return !!a?.party&&a.party===b?.party;},canInteract:()=>true};
 if(region.populationMode==='fixed-slots')return Object.freeze(policy);const rules=region.nearby;if(!rules)fail('missing nearby population rules');
 const job=(spawn:EnemySpawn):{group:PopulationGroup;index:number}=>{if(spawn.role==='echo')return{group:'echo',index:0};if(spawn.role==='add')return{group:'scrapling',index:0};const slot=/^(scrapling|scavenger|jellyfish|shallow):(0|[1-9][0-9]*)$/.exec(spawn.legacySlot??'');if(!slot||slot[1]!=='shallow'&&slot[1]!==spawn.kind||slot[1]==='shallow'&&spawn.kind!=='scrapling')fail('invalid population origin slot');return{group:slot[1]==='shallow'?'shallowPatrols':slot[1] as PopulationGroup,index:Number(slot[2])};};
 return Object.freeze({...policy,populationRadius:(spawn:EnemySpawn)=>rules[job(spawn).group].radius,enemyPopulation:(spawn:EnemySpawn,nearbyPlayers:number)=>{integer(nearbyPlayers,'nearby player count',0,Number.MAX_SAFE_INTEGER);const {group,index}=job(spawn),r=rules[group],desired=Math.min(r.max,r.base+Math.floor(nearbyPlayers*r.scale));return{desired:spawn.role==='add'||index<desired?1 as const:0 as const,respawnSeconds:region.respawnSeconds[spawn.role==='echo'?'echo':spawn.kind]};}});
}
/** Named choices preserve progression; elapsed death only readies the actual core respawn on its next tick. */
export function createConfiguredRestorePolicy(input:ConfiguredRestore,catalog:ReadonlyMap<WorldId,LoadedWorldDefinition>):RestorePolicy {
 const options=validateRestore(input);return Object.freeze({version:`world-restore-v1-${createHash('sha256').update(JSON.stringify(options)).digest('hex').slice(0,24)}`,restore(checkpoint:Readonly<CharacterCheckpointV1>,elapsed:number){
  if(!Number.isFinite(elapsed)||elapsed<0)fail('restore elapsed interval');const out:CharacterCheckpointV1=structuredClone(checkpoint),s=out.survival;
  if(options.cooldowns==='elapse'){for(const cycle of [s.gcd,...Object.values(s.cooldowns)]){cycle.startAge+=elapsed;cycle.endRemaining=Math.max(0,cycle.endRemaining-elapsed);}}
  if(options.history==='elapse'){s.history.combatAge+=elapsed;s.history.spendAge+=elapsed;s.history.attackAge+=elapsed;s.history.nextSwingRemaining=Math.max(0,s.history.nextSwingRemaining-elapsed);}
  if(options.statuses==='elapse'){const st=s.statuses;for(const k of ['stunRemaining','slowRemaining','rustRemaining','absorbRemaining','blessingRemaining'] as const)st[k]=Math.max(0,st[k]-elapsed);if(st.slowRemaining===0)st.slowPct=0;if(st.rustRemaining===0)st.rust=0;if(st.absorbRemaining===0){st.absorb=0;st.warded=false;}}
  if(options.death==='elapse'&&s.respawnRemaining!==null)s.respawnRemaining=Math.max(0,s.respawnRemaining-elapsed);
  if(options.location==='arrival'){const world=catalog.get(out.world);if(!world)fail('restore world');const p=world.publicDefinition.pois.arrival??world.publicDefinition.spawn;out.location={...p.position,yaw:p.yaw};}
  out.activity={seated:false,village:false,controlsLocked:false,cast:null,channel:null,dash:false,pendingHit:false,rootPending:false,motion:{velocityX:0,velocityZ:0,jumpRemaining:0,spinRemaining:0,pushX:0,pushZ:0,pushRemaining:0,lift:0,dashElapsed:null}};return out;
 }});
}
/** Public presentation metadata is personal; private boss-owned freed actors follow their real controller. */
export function createConfiguredVisibility(catalog:ReadonlyMap<WorldId,LoadedWorldDefinition>):HostPolicies['visible'] {
 return (unit:Readonly<SimUnit>,viewer:Readonly<PlayerState>)=>{if(unit.kind!=='npc'||unit.npcId===null)return true;const world=catalog.get(`w${viewer.quests.chapter}` as WorldId);return !!world&&personalNpcVisible(world.publicDefinition,unit.npcId,viewer.flags);};
}
export function createConfiguredPartyPolicy(config:ConfiguredParty,catalog:ReadonlyMap<WorldId,LoadedWorldDefinition>):HostPolicies['party'] {
 if(!config.enabled)return undefined;
 for(const profile of HOSTED_BOSSES){const r=config.returns[profile],world=catalog.get(r.world);if(!world||!world.encounterDefinitions.has(profile))fail(`party return world ${profile}`);const d=world.publicDefinition;if(![d.spawn.id,d.recall.id,...Object.values(d.pois).map(p=>p.id)].includes(r.spawn))fail(`party return POI ${profile}`);}
 return Object.freeze({maxParties:config.maxParties,maxEncounters:config.maxEncounters,returnSpawn:(world:WorldId,profile:BossProfileId)=>{const hosted=HOSTED_BOSSES.find(id=>id===profile);if(!hosted)fail('party profile unavailable');const r=config.returns[hosted];if(r.world!==world)fail('party return world mismatch');return r.spawn;}});
}
async function checkedRead(file:URL,maxBytes:number):Promise<Buffer> {const info=await stat(file);if(!info.isFile()||info.size>maxBytes)fail('asset byte budget');const bytes=await readFile(file);if(bytes.byteLength>maxBytes)fail('asset byte budget');return bytes;}
async function loadCheckedCatalog(assets:URL,c:ValidatedWorldConfig):Promise<ReadonlyMap<WorldId,LoadedWorldDefinition>> {
 if(!(assets instanceof URL)||assets.protocol!=='file:'||assets.search||assets.hash||!assets.pathname.endsWith('/'))fail('assets directory URL');
 const manifest=object(detached(JSON.parse((await checkedRead(new URL(c.assets.manifest,assets),c.assets.maxManifestBytes)).toString('utf8'))),['format','version','source','artifacts'],[],'asset manifest');
 if(manifest.format!=='crabcraft-world-manifest'||manifest.version!==1||manifest.source!==c.assets.source)fail('asset manifest version/source');const entries=object(manifest.artifacts,PUBLIC_WORLDS,[],'asset manifest artifacts');let total=0;
 const expected=new Map<WorldId,string>();for(const world of PUBLIC_WORLDS){const m=object(entries[world],['file','bytes','sha256'],[],`manifest.${world}`);if(m.file!==`collision-${world}.json`)fail(`manifest.${world}.file`);const size=integer(m.bytes,`manifest.${world}.bytes`,1,c.assets.maxBakeBytes);total+=size;if(total>c.assets.maxTotalBakeBytes)fail('asset total byte budget');const digest=hash(m.sha256,`manifest.${world}.sha256`),bytes=await checkedRead(new URL(m.file as string,assets),c.assets.maxBakeBytes);if(bytes.byteLength!==size||createHash('sha256').update(bytes).digest('hex')!==digest)fail(`asset integrity ${world}`);expected.set(world,digest);}
 const policies=Object.fromEntries(PUBLIC_WORLDS.map(world=>[world,createConfiguredAreaPolicy(c.worlds[world])])) as Record<HostedWorldId,AreaPolicy>;
 const catalog=await loadWorldCatalog({directory:assets,expectedBakeSource:c.assets.source,maxBakeBytes:c.assets.maxBakeBytes,maxCells:c.assets.maxCells,configs:c.worlds,policies,seeds:Object.fromEntries(PUBLIC_WORLDS.map(w=>[w,c.worlds[w].seed])) as Record<HostedWorldId,number>,variants:createWorldVariants});
 for(const [world,data]of catalog){if(data.artifactHash!==expected.get(world))fail(`asset changed while loading ${world}`);if(data.publicDefinition.enemies.length>c.limits.maxMutationSourcesPerTick)fail(`${world}.actual population exceeds receipt bound`);for(const spawn of data.publicDefinition.enemies){data.policy.enemyPopulation(spawn,0);for(const value of Object.values(enemyStats(spawn.kind,spawn.fixedLevel,worldChapter(world),spawn.role)))if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))fail(`${world}.unsafe derived enemy stats`);}}return catalog;
}
export interface ConfiguredWorldOptions {pool:Pool;admission:WorldTicketRegistry;assets:URL;config:unknown;ledgerConfig?:unknown;originAllowed(origin:string,req:IncomingMessage):boolean;clientIp(req:IncomingMessage):string}
export async function startConfiguredWorld(options:ConfiguredWorldOptions) {
 const config=validateWorldConfig(options.config),ledgerConfig=options.ledgerConfig===undefined?undefined:validateLedgerConfig(options.ledgerConfig);if(typeof options.originAllowed!=='function'||typeof options.clientIp!=='function')fail('HTTP callbacks');
 const catalog=await loadCheckedCatalog(options.assets,config),party=createConfiguredPartyPolicy(config.party,catalog),spawn=catalog.get('w1')!.publicDefinition.spawn;
 const frost=catalog.get('w4')!.encounterDefinitions.get('frost');if(!frost)fail('ending Frost metadata');
 const endingPresentation={stage:createEndingStage(catalog.get('w1')!.publicDefinition,frost)};
 const codec=createCoreCharacterCodec({identities:['human','orc','dwarf','undead','nightelf','tauren'].flatMap(archetype=>Object.keys(CLASSES).map(classId=>({classId:classId as keyof typeof CLASSES,archetype}))),freshLocation:{...spawn.position,yaw:spawn.yaw}}),characters=new CharacterStore(options.pool,codec),gameplayCatalog=createGameplayCatalog(catalog),restore=createConfiguredRestorePolicy(config.restore,catalog);
 // Construct/validate the concrete protocol before retaining a database ownership session.
 createGameplayProtocol(gameplayCatalog);
 const outcomes=ledgerConfig?new DurableOutcomeStore(options.pool,codec,{planOutcomePage,queryTimeoutMs:ledgerConfig.queryTimeoutMs}):undefined;
 const ownership=await acquireHostOwnership(options.pool,config.ownership.key,config.ownership);
 let host:ReturnType<typeof createActualWorldHost>|undefined;
 try{const policies:HostPolicies={...config.limits,endingPresentation,...(ledgerConfig?{ledger:{sourceLimits:ledgerConfig.sourceLimits,drainLimits:ledgerConfig.drainLimits,recoveryLimits:ledgerConfig.recoveryLimits,recoveryIntervalMs:ledgerConfig.recoveryIntervalMs}}:{}),victimOutcome:config.victimOutcome,...(config.victimOutcomeRetryCeiling?{victimOutcomeRetryCeiling:config.victimOutcomeRetryCeiling}:{}),chat:config.chat,...(party?{party}:{}),persistence:config.persistence,areaLimits:config.areaLimits,restore,offlineSeconds:(character,now)=>{if(!Number.isSafeInteger(now)||!Number.isSafeInteger(character.updatedAt)||character.updatedAt<0||now<character.updatedAt)fail('offline clock regression');return(now-character.updatedAt)/1000;},visible:createConfiguredVisibility(catalog),observationExtras:projectObservationExtras};
  host=createActualWorldHost({...(outcomes?{outcomes}:{}),chat:new WorldChatService(options.pool),admission:options.admission,characters,worlds:catalog,codec,gameplay:{catalog:gameplayCatalog,create:()=>createGameplayProtocol(gameplayCatalog)},ownership,policies,originAllowed:options.originAllowed,clientIp:options.clientIp,nowMonotonicMs:()=>performance.now(),nowWallMs:Date.now});
  await host.ready();
  return {host,catalog,ownership,characters,codec,gameplayCatalog,config,ledgerConfig};
 }catch(error){const errors=[error];if(host){try{host.stopAdmission();await host.shutdown(7000);}catch(shutdownError){errors.push(shutdownError);}}try{await ownership.release();}catch(releaseError){errors.push(releaseError);}if(errors.length>1)throw new AggregateError(errors,'World assembly cleanup reported errors');throw error;}
}
