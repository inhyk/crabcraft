import type { AreaServices, PlayerSim, QuestState } from '../types.ts';
/** No dialogue, locale code or browser state. Values from S1 quests.ts 28816e2. */
export interface QuestDefinition { readonly id:string; readonly chapter:1|2|3; readonly giver:string; readonly turnIn:string|null; readonly xp:number; readonly objectives:readonly {readonly id:string;readonly kind:string;readonly count:number}[] }
const q=(id:string,chapter:1|2|3,giver:string,turnIn:string|null,xp:number,objectives:readonly (readonly [string,string,number])[]):QuestDefinition=>Object.freeze({id,chapter,giver,turnIn,xp,objectives:Object.freeze(objectives.map(([id,kind,count])=>Object.freeze({id,kind,count})))});
export const QUEST_ORDER:readonly string[]=Object.freeze(['q1','q2','q3','q4','w1','w2','w3','w4','w5','w6','w7','d1','d2']);
export const QUESTS:Readonly<Record<string,QuestDefinition>>=Object.freeze(Object.fromEntries([
q('q1',1,'brinebeard','brinebeard',250,[['q1-kill','kill-scrapling',6],['q1-cog','collect-cog',4]]),
q('q2',1,'brinebeard','silvermoon',120,[['q2-deliver','deliver',1]]),
q('q3',1,'silvermoon',null,330,[['q3-kill','kill-scavenger',3],['q3-beacon','beacon',1]]),
q('q4',1,'silvermoon','brinebeard',600,[['q4-boss','boss',1]]),
q('w1',2,'brinebeard','brinebeard',1100,[['w1-kill','kill-scrapling',6]]),
q('w2',2,'pip','pip',1500,[['w2-gem-0','crystal-a',1],['w2-gem-1','crystal-b',1],['w2-gem-2','crystal-c',1],['w2-gem-3','crystal-d',1]]),
q('w3',2,'rattlebolt','rattlebolt',1700,[['w3-lamp-0','lamp-a',1],['w3-lamp-1','lamp-b',1],['w3-lamp-2','lamp-c',1]]),
q('w4',2,'grukk','grukk',1800,[['w4-kill','kill-scavenger',8]]),
q('w5',2,'silvermoon','silvermoon',2000,[['w5-west','explore-west',1],['w5-east','explore-east',1],['w5-north','explore-north',1]]),
q('w6',2,'hoofclaw','coralline',1000,[['w6-deliver','deliver-supplies',1]]),
q('w7',2,'coralline',null,2600,[['w7-boss','eclipse-boss',1]]),
q('d1',3,'brinebeard','brinebeard',2800,[['d1-kill','kill-scavenger',6]]),
q('d2',3,'brinebeard','brinebeard',3500,[['d2-boss','dawn-boss',1]])].map(d=>[d.id,d])));
export function freshQuests(chapter:1|2|3=1):QuestState {const state:QuestState={chapter:1,status:Object.fromEntries(QUEST_ORDER.map(id=>[id,id==='q1'?'available':'locked'])),progress:{},cogs:0,tracked:{}};setQuestChapter(state,chapter);return state;}
export function setQuestChapter(state:QuestState,chapter:1|2|3):void {state.chapter=chapter;if(chapter>=2)for(const id of QUEST_ORDER)if(QUESTS[id].chapter===chapter&&state.status[id]==='locked')state.status[id]='available';}
export function questComplete(player:PlayerSim,services:AreaServices,id:string):boolean {const state=player.state.quests,def=QUESTS[id];if(!def||state.status[id]==='done')return false;state.status[id]='done';const next=QUEST_ORDER[QUEST_ORDER.indexOf(id)+1];if(next&&QUESTS[next].chapter===def.chapter&&state.status[next]==='locked')state.status[next]='available';player.gainXp(def.xp);services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'completed'});if(id==='q3'){const unit=services.getUnit(player.state.unit);if(unit&&services.world==='w1')unit.encounterBlessing=true;questAccept(player,services,'q4',true);}return true;}
function checkReady(player:PlayerSim,services:AreaServices,id:string):void {const state=player.state.quests,def=QUESTS[id];if(state.status[id]!=='active'||!def.objectives.every(o=>(state.progress[o.id]??0)>=o.count))return;if(def.turnIn===null)questComplete(player,services,id);else{state.status[id]='ready';services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'ready'});}}
export function questAccept(player:PlayerSim,services:AreaServices,id:string,earnedContinuation=false):boolean {const state=player.state.quests,def=QUESTS[id];if(!def||!earnedContinuation&&def.chapter!==state.chapter||!['available','locked'].includes(state.status[id]))return false;state.status[id]='active';services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'accepted'});const flag=id==='q4'?'rustCleared':id==='w7'?'trueCleared':id==='d2'?'finalCleared':id==='q3'?'beaconLit':null;if(flag&&player.state.flags[flag])for(const o of def.objectives)if(['boss','eclipse-boss','dawn-boss','beacon'].includes(o.kind))state.progress[o.id]=o.count;checkReady(player,services,id);return true;}
/** Earned objectives retain eligibility when their owner travels before the victim dies. */
export function questBump(player:PlayerSim,services:AreaServices,kind:string,amount=1,earned=false):void {const state=player.state.quests;if(!Number.isFinite(amount)||amount<=0)return;for(const id of QUEST_ORDER){const def=QUESTS[id];if((!earned&&def.chapter!==state.chapter)||state.status[id]!=='active')continue;for(const o of def.objectives){if(o.kind!==kind)continue;const old=state.progress[o.id]??0,value=Math.min(o.count,old+amount);if(value===old)continue;state.progress[o.id]=value;if(kind==='collect-cog')state.cogs+=value-old;services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'progress',objective:o.id,value});}checkReady(player,services,id);}}
export function activeObjective(state:QuestState,kind:string):boolean {return QUEST_ORDER.some(id=>QUESTS[id].chapter===state.chapter&&state.status[id]==='active'&&QUESTS[id].objectives.some(o=>o.kind===kind&&(state.progress[o.id]??0)<o.count));}
