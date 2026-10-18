/** Actual voyageIsland/achievements/lighthouseSecret rules, independent of view and localStorage. */
import type { AreaDefinition, AreaServices, ChannelState, EntityRef, PlayerSim, WorldQuery } from '../types.ts';
import { immutable, sameRef } from '../events.ts';
export const VOYAGE_SITES = immutable([
 {id:'island',x:230,z:-22,radius:19},
 {id:'moon',x:231,z:-61,radius:12},
 {id:'sunset',x:222,z:65,radius:18},
] as const);
export const TREASURES = immutable([
 {id:'treasure',x:229,z:-24,coins:75},
 {id:'moonTreasure',x:229,z:-59,coins:100},
 {id:'sunsetTreasure',x:220,z:67,coins:125},
] as const);
export const LIGHTHOUSE_SECRET = immutable({id:'lighthouse-secret',x:190,z:-120,range:3.3,verticalRange:2.5,channelSeconds:1.5,channelHeight:1.1,presentationSeconds:12,coins:50});
export function createExplorationInteractions(query:Pick<WorldQuery,'heightAt'>):AreaDefinition['interactions'] {
 const treasures=TREASURES.map(t=>({id:t.id,kind:'treasure' as const,position:{x:t.x,y:query.heightAt(t.x,t.z),z:t.z},range:3})),secret=LIGHTHOUSE_SECRET,position={x:secret.x,y:query.heightAt(secret.x,secret.z),z:secret.z};
 return immutable([...treasures,{id:secret.id,kind:'secret' as const,position,range:secret.range,channelTo:{...position,y:position.y+secret.channelHeight}}]);
}
type SecretState = {unit:EntityRef;activeUntil:number};
type SecretChannel = {unit:EntityRef;start:number;end:number};
const BOSS_ACHIEVEMENTS = Object.freeze([['rustCleared','rust'],['abyssCleared','abyss'],['trueCleared','eclipse'],['finalCleared','dawn']] as const);
export class NumericExploration {
 private readonly active=new Map<string,SecretState>();
 private readonly channels=new Map<string,SecretChannel>();
 private readonly services:AreaServices;
 constructor(services:AreaServices){this.services=services;}
 handles(id:string):boolean {return id===LIGHTHOUSE_SECRET.id||TREASURES.some(t=>t.id===id);}
 private point(id:string){return this.services.definition.interactions.find(p=>p.id===id&&(p.kind==='treasure'||p.kind==='secret'));}
 private eligible(ref:EntityRef,id:string):PlayerSim|null {
  const s=this.services,p=s.player(ref),u=s.getUnit(ref),point=this.point(id);if(s.world!=='w1'||!p||!u?.alive||u.hidden||p.state.controlsLocked||!point)return null;
  const member=s.context.members.find(m=>m.character===p.state.character);if(member?.seatedBoat||member?.villagePlaying||!s.policy.canInteract(s.context,p.state,id))return null;
  const dx=u.x-point.position.x,dy=u.y-point.position.y,dz=u.z-point.position.z;
  if(id===LIGHTHOUSE_SECRET.id){if(Math.hypot(dx,dz)>=LIGHTHOUSE_SECRET.range||Math.abs(dy)>=LIGHTHOUSE_SECRET.verticalRange)return null;}
  else if(Math.hypot(dx,dy,dz)>=3)return null;
  return p;
 }
 private transaction(player:PlayerSim,run:()=>void):void {
  const p=player.state,before={coins:p.coins,achievements:structuredClone(p.achievements),lighthouseSecretFound:p.lighthouseSecretFound},active=this.active.get(p.character);
  try{this.services.outcomeTransaction(run);}catch(error){Object.assign(p,before);if(active)this.active.set(p.character,active);else this.active.delete(p.character);throw error;}
 }
 private unlock(player:PlayerSim,id:string):boolean {
  if(player.state.achievements.earned.includes(id))return false;
  player.state.achievements.earned.push(id);this.services.emit({type:'achievement',unit:player.state.unit,achievement:id});return true;
 }
 /** Also used inside the award transaction, so a crown and its personal achievement are captured together. */
 observePlayer(player:PlayerSim,withinTransaction=false):void {
  const run=()=>{const p=player.state,u=this.services.getUnit(p.unit),member=this.services.context.members.find(m=>m.character===p.character);
   if(u?.alive&&this.services.world==='w1'&&!member?.seatedBoat){const site=VOYAGE_SITES.find(i=>i.radius-Math.hypot(u.x-i.x,(u.z-i.z)/.86)>.25);if(site)this.unlock(player,site.id);}
   if(VOYAGE_SITES.every(i=>p.achievements.earned.includes(i.id)))this.unlock(player,'archipelago');
   for(const [flag,id]of BOSS_ACHIEVEMENTS)if(p.flags[flag])this.unlock(player,id);
   if(p.lighthouseSecretFound)this.unlock(player,'secret');
  };if(withinTransaction)run();else this.transaction(player,run);
 }
 interact(ref:EntityRef,id:string):boolean {
  if(!this.handles(id))return false;const player=this.eligible(ref,id);if(!player)return false;const s=this.services,p=player.state;
  if(id===LIGHTHOUSE_SECRET.id){
   if(p.channel||(this.active.get(p.character)?.activeUntil??0)>s.time)return false;
   const point=this.point(id)!;if(p.target){p.target=null;p.targetDeadAt=0;s.emit({type:'target',unit:p.unit,target:null});}
   player.startChannel('lighthouse-secret',LIGHTHOUSE_SECRET.channelSeconds,point.channelTo??{...point.position,y:point.position.y+LIGHTHOUSE_SECRET.channelHeight},id);
   const channel=(()=>player.state.channel)();if(channel?.kind!=='lighthouse-secret')return false;
   this.channels.set(p.character,{unit:{...p.unit},start:channel.start,end:channel.end});return true;
  }
  const treasure=TREASURES.find(t=>t.id===id)!;
  this.transaction(player,()=>{const first=!p.achievements.earned.includes(id);if(first){if(!Number.isSafeInteger(p.coins)||p.coins<0)throw new Error('Invalid personal coin balance');this.unlock(player,id);p.coins=Math.min(Number.MAX_SAFE_INTEGER,p.coins+treasure.coins);}s.emit({type:'discovery',unit:p.unit,discovery:'treasure',id,first,coins:first?treasure.coins:0,activeUntil:null});});return true;
 }
 completeChannel(player:PlayerSim,channel:ChannelState):void {
  const s=this.services,p=player.state,started=this.channels.get(p.character);if(channel.kind!=='lighthouse-secret'||channel.targetId!==LIGHTHOUSE_SECRET.id||!started||!sameRef(started.unit,p.unit)||channel.start!==started.start||channel.end!==started.end||s.time<started.end)return;
  if(!this.eligible(p.unit,LIGHTHOUSE_SECRET.id)){this.channels.delete(p.character);return;}
  this.transaction(player,()=>{const first=!p.lighthouseSecretFound;if(first){if(!Number.isSafeInteger(p.coins)||p.coins<0)throw new Error('Invalid personal coin balance');p.coins=Math.min(Number.MAX_SAFE_INTEGER,p.coins+LIGHTHOUSE_SECRET.coins);}p.lighthouseSecretFound=true;this.unlock(player,'secret');const activeUntil=s.time+LIGHTHOUSE_SECRET.presentationSeconds;this.active.set(p.character,{unit:{...p.unit},activeUntil});s.emit({type:'discovery',unit:p.unit,discovery:'lighthouse-secret',id:LIGHTHOUSE_SECRET.id,first,coins:first?LIGHTHOUSE_SECRET.coins:0,activeUntil});});this.channels.delete(p.character);
 }
 update():void {
  const s=this.services;for(const u of s.players()){const p=s.player(u.ref);if(p)this.observePlayer(p);}
  for(const [character,state]of this.active)if(state.activeUntil<=s.time||!s.playerByCharacter(character))this.active.delete(character);
  for(const [character,ch]of this.channels){const p=s.playerByCharacter(character),live=p?.state.channel;if(!p||!sameRef(p.state.unit,ch.unit)||live?.kind!=='lighthouse-secret'||live.start!==ch.start||live.end!==ch.end)this.channels.delete(character);}
 }
 purgeActor(ref:EntityRef):void {for(const [character,state]of this.active)if(sameRef(state.unit,ref))this.active.delete(character);for(const [character,ch]of this.channels)if(sameRef(ch.unit,ref))this.channels.delete(character);}
 snapshot():readonly SecretState[] {return immutable([...this.active.values()]);}
 debugState(){return immutable({active:[...this.active].map(([character,state])=>({character,...state})),channels:[...this.channels].map(([character,state])=>({character,...state}))});}
}
