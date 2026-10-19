import type { AreaServices, Chapter, PlayerSim, QuestState } from '../types.ts';
/** No dialogue, locale code or browser state. Values from canonical gameplay 60df24f. */
export interface QuestDefinition { readonly id:string; readonly chapter:Chapter; readonly giver:string; readonly turnIn:string|null; readonly xp:number; readonly objectives:readonly {readonly id:string;readonly kind:string;readonly count:number}[] }
const q=(id:string,chapter:Chapter,giver:string,turnIn:string|null,xp:number,objectives:readonly (readonly [string,string,number])[]):QuestDefinition=>Object.freeze({id,chapter,giver,turnIn,xp,objectives:Object.freeze(objectives.map(([id,kind,count])=>Object.freeze({id,kind,count})))});
export const QUEST_ORDER:readonly string[]=Object.freeze(['q1','q2','q3','q4','w1','w2','w3','w4','w5','w6','w7','d1','d2','d3','d4','d5','d6','d7','d8','d9','d10','d11','d12','s1','s2','s3','s4','s5','s6','s7','s8','s9','s10','s11','s12','r5q1','r5q2','r5q3','r5q4','r5q5','r5q6','r5q7','r5q8','r5q9','r5q10','r5q11','r5q12','r6q1','r6q2','r6q3','r6q4','r6q5','r6q6','r6q7','r6q8','r6q9','r6q10','r6q11','r6q12']);
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
q('d2',3,'brinebeard','brinebeard',3500,[['d2-boss','dawn-boss',1]]),
q("d3",3,"brinebeard","coralline",6000,[["d3-a","dawn-crate-a",1],["d3-b","dawn-crate-b",1],["d3-c","dawn-crate-c",1]]),
q("d4",3,"coralline","coralline",6500,[["d4-a","dawn-herb-a",1],["d4-b","dawn-herb-b",1],["d4-c","dawn-herb-c",1]]),
q("d5",3,"rattlebolt","rattlebolt",7000,[["d5-a","dawn-lamp-a",1],["d5-b","dawn-lamp-b",1],["d5-c","dawn-lamp-c",1]]),
q("d6",3,"silvermoon","silvermoon",7500,[["d6-garden","dawn-visit-garden",1],["d6-coast","dawn-visit-coast",1],["d6-watch","dawn-visit-watch",1]]),
q("d7",3,"grukk","grukk",8000,[["d7-kill","kill-scrapling",8]]),
q("d8",3,"pip","pip",8500,[["d8-a","dawn-ore-a",1],["d8-b","dawn-ore-b",1],["d8-c","dawn-ore-c",1]]),
q("d9",3,"hoofclaw","hoofclaw",8000,[["d9-a","dawn-pearl-a",1],["d9-b","dawn-pearl-b",1],["d9-c","dawn-pearl-c",1]]),
q("d10",3,"rattlebolt","brinebeard",6500,[["d10-letter","dawn-letter",1]]),
q("d11",3,"silvermoon","silvermoon",9500,[["d11-a","dawn-seal-a",1],["d11-b","dawn-seal-b",1],["d11-c","dawn-seal-c",1]]),
q("d12",3,"grukk","grukk",12000,[["d12-kill","kill-scavenger",12]]),
q('s1',4,'grukk','grukk',18000,[['s1-kill','kill-scavenger',8]]),
q('s2',4,'brinebeard',null,24000,[['s2-boss','frost-boss',1]]),
q("s3",4,"brinebeard","coralline",22000,[["s3-1","snow-crate-a",1],["s3-2","snow-crate-b",1],["s3-3","snow-crate-c",1]]),
q("s4",4,"coralline","coralline",24000,[["s4-1","snow-herb-a",1],["s4-2","snow-herb-b",1],["s4-3","snow-herb-c",1]]),
q("s5",4,"rattlebolt","rattlebolt",28000,[["s5-1","snow-lamp-a",1],["s5-2","snow-lamp-b",1],["s5-3","snow-lamp-c",1]]),
q("s6",4,"silvermoon","silvermoon",30000,[["s6-1","snow-visit-forest",1],["s6-2","snow-visit-overlook",1],["s6-3","snow-visit-aurora",1]]),
q("s7",4,"pip","pip",35000,[["s7-1","snow-ore-a",1],["s7-2","snow-ore-b",1],["s7-3","snow-ore-c",1]]),
q("s8",4,"hoofclaw","hoofclaw",32000,[["s8-1","snow-pearl-a",1],["s8-2","snow-pearl-b",1],["s8-3","snow-pearl-c",1]]),
q("s9",4,"rattlebolt","brinebeard",26000,[["s9-1","snow-letter",1]]),
q("s10",4,"grukk","grukk",40000,[["s10-1","kill-scrapling",8]]),
q("s11",4,"silvermoon","silvermoon",50000,[["s11-1","snow-seal-a",1],["s11-2","snow-seal-b",1],["s11-3","snow-seal-c",1]]),
q("s12",4,"grukk","grukk",65000,[["s12-1","kill-scavenger",12]]),
q("r5q1",5,"brinebeard","coralline",66000,[["r5q1-a", "ember-crate-a", 1], ["r5q1-b", "ember-crate-b", 1], ["r5q1-c", "ember-crate-c", 1]]),
q("r5q2",5,"coralline","coralline",72000,[["r5q2-a", "ember-herb-a", 1], ["r5q2-b", "ember-herb-b", 1], ["r5q2-c", "ember-herb-c", 1]]),
q("r5q3",5,"rattlebolt","rattlebolt",84000,[["r5q3-a", "ember-lamp-a", 1], ["r5q3-b", "ember-lamp-b", 1], ["r5q3-c", "ember-lamp-c", 1]]),
q("r5q4",5,"silvermoon","silvermoon",90000,[["r5q4-a", "ember-visit-a", 1], ["r5q4-b", "ember-visit-b", 1], ["r5q4-c", "ember-visit-c", 1]]),
q("r5q5",5,"pip","pip",105000,[["r5q5-a", "ember-ore-a", 1], ["r5q5-b", "ember-ore-b", 1], ["r5q5-c", "ember-ore-c", 1]]),
q("r5q6",5,"hoofclaw","hoofclaw",96000,[["r5q6-a", "ember-pearl-a", 1], ["r5q6-b", "ember-pearl-b", 1], ["r5q6-c", "ember-pearl-c", 1]]),
q("r5q7",5,"rattlebolt","brinebeard",78000,[["r5q7-letter", "ember-letter", 1]]),
q("r5q8",5,"grukk","grukk",120000,[["r5q8-kill", "kill-scrapling", 8]]),
q("r5q9",5,"silvermoon","silvermoon",150000,[["r5q9-a", "ember-seal-a", 1], ["r5q9-b", "ember-seal-b", 1], ["r5q9-c", "ember-seal-c", 1]]),
q("r5q10",5,"grukk","grukk",165000,[["r5q10-kill", "kill-scavenger", 10]]),
q("r5q11",5,"brinebeard","brinebeard",180000,[["r5q11-kill", "kill-scrapling", 12]]),
q("r5q12",5,"grukk","grukk",225000,[["r5q12-kill", "kill-scavenger", 14]]),
q("r6q1",6,"brinebeard","coralline",110000,[["r6q1-a", "sky-crate-a", 1], ["r6q1-b", "sky-crate-b", 1], ["r6q1-c", "sky-crate-c", 1]]),
q("r6q2",6,"coralline","coralline",120000,[["r6q2-a", "sky-herb-a", 1], ["r6q2-b", "sky-herb-b", 1], ["r6q2-c", "sky-herb-c", 1]]),
q("r6q3",6,"rattlebolt","rattlebolt",140000,[["r6q3-a", "sky-lamp-a", 1], ["r6q3-b", "sky-lamp-b", 1], ["r6q3-c", "sky-lamp-c", 1]]),
q("r6q4",6,"silvermoon","silvermoon",150000,[["r6q4-a", "sky-visit-a", 1], ["r6q4-b", "sky-visit-b", 1], ["r6q4-c", "sky-visit-c", 1]]),
q("r6q5",6,"pip","pip",175000,[["r6q5-a", "sky-ore-a", 1], ["r6q5-b", "sky-ore-b", 1], ["r6q5-c", "sky-ore-c", 1]]),
q("r6q6",6,"hoofclaw","hoofclaw",160000,[["r6q6-a", "sky-pearl-a", 1], ["r6q6-b", "sky-pearl-b", 1], ["r6q6-c", "sky-pearl-c", 1]]),
q("r6q7",6,"rattlebolt","brinebeard",130000,[["r6q7-letter", "sky-letter", 1]]),
q("r6q8",6,"grukk","grukk",200000,[["r6q8-kill", "kill-scrapling", 8]]),
q("r6q9",6,"silvermoon","silvermoon",250000,[["r6q9-a", "sky-seal-a", 1], ["r6q9-b", "sky-seal-b", 1], ["r6q9-c", "sky-seal-c", 1]]),
q("r6q10",6,"grukk","grukk",275000,[["r6q10-kill", "kill-scavenger", 10]]),
q("r6q11",6,"brinebeard","brinebeard",300000,[["r6q11-kill", "kill-scrapling", 12]]),
q("r6q12",6,"grukk","grukk",375000,[["r6q12-kill", "kill-scavenger", 14]])].map(d=>[d.id,d])));
export function freshQuests(chapter:Chapter=1):QuestState {const state:QuestState={chapter:1,status:Object.fromEntries(QUEST_ORDER.map(id=>[id,id==='q1'?'available':'locked'])),progress:{},cogs:0,tracked:{}};setQuestChapter(state,chapter);return state;}
export function setQuestChapter(state:QuestState,chapter:Chapter):void {state.chapter=chapter;for(const id of QUEST_ORDER)if(state.status[id]===undefined)state.status[id]=id==='q1'?'available':'locked';if(chapter>=2)for(const id of QUEST_ORDER)if(QUESTS[id].chapter===chapter&&state.status[id]==='locked')state.status[id]='available';}
export function questComplete(player:PlayerSim,services:AreaServices,id:string):boolean {const state=player.state.quests,def=QUESTS[id];if(!def||state.status[id]==='done')return false;state.status[id]='done';const next=QUEST_ORDER[QUEST_ORDER.indexOf(id)+1];if(next&&QUESTS[next].chapter===def.chapter&&state.status[next]==='locked')state.status[next]='available';player.gainXp(def.xp);services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'completed'});if(id==='q3'){const unit=services.getUnit(player.state.unit);if(unit&&services.world==='w1')unit.encounterBlessing=true;questAccept(player,services,'q4',true);}return true;}
function checkReady(player:PlayerSim,services:AreaServices,id:string):void {const state=player.state.quests,def=QUESTS[id];if(state.status[id]!=='active'||!def.objectives.every(o=>(state.progress[o.id]??0)>=o.count))return;if(def.turnIn===null)questComplete(player,services,id);else{state.status[id]='ready';services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'ready'});}}
export function questAccept(player:PlayerSim,services:AreaServices,id:string,earnedContinuation=false):boolean {const state=player.state.quests,def=QUESTS[id];if(!def||!earnedContinuation&&def.chapter!==state.chapter||!['available','locked'].includes(state.status[id]))return false;state.status[id]='active';services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'accepted'});const flag=id==='q4'?'rustCleared':id==='w7'?'trueCleared':id==='d2'?'finalCleared':id==='q3'?'beaconLit':null;if(flag&&player.state.flags[flag])for(const o of def.objectives)if(['boss','eclipse-boss','dawn-boss','frost-boss','beacon'].includes(o.kind))state.progress[o.id]=o.count;checkReady(player,services,id);return true;}
/** Earned objectives retain eligibility when their owner travels before the victim dies. */
export function questBump(player:PlayerSim,services:AreaServices,kind:string,amount=1,earned=false):void {const state=player.state.quests;if(!Number.isFinite(amount)||amount<=0)return;for(const id of QUEST_ORDER){const def=QUESTS[id];if((!earned&&def.chapter!==state.chapter)||state.status[id]!=='active')continue;for(const o of def.objectives){if(o.kind!==kind)continue;const old=state.progress[o.id]??0,value=Math.min(o.count,old+amount);if(value===old)continue;state.progress[o.id]=value;if(kind==='collect-cog')state.cogs+=value-old;services.emit({type:'quest',unit:player.state.unit,quest:id,stage:'progress',objective:o.id,value});}checkReady(player,services,id);}}
export function activeObjective(state:QuestState,kind:string):boolean {return QUEST_ORDER.some(id=>QUESTS[id].chapter===state.chapter&&state.status[id]==='active'&&QUESTS[id].objectives.some(o=>o.kind===kind&&(state.progress[o.id]??0)<o.count));}

/** Ground anchors; World III resolves radius-one collision before sampling height. */
export const DAWN_POINTS:Readonly<Record<string,readonly [number,number]>>=Object.freeze(Object.fromEntries(Object.entries({"dawn-crate-a":[-12,76],"dawn-crate-b":[12,70],"dawn-crate-c":[-12,62],"dawn-herb-a":[-55,44],"dawn-herb-b":[-62,38],"dawn-herb-c":[-56,30],"dawn-lamp-a":[-7,20],"dawn-lamp-b":[7,0],"dawn-lamp-c":[-7,-22],"dawn-ore-a":[24,6],"dawn-ore-b":[32,-8],"dawn-ore-c":[22,-25],"dawn-pearl-a":[68,30],"dawn-pearl-b":[72,18],"dawn-pearl-c":[64,4],"dawn-seal-a":[-18,-20],"dawn-seal-b":[18,-35],"dawn-seal-c":[-16,-44],"dawn-visit-garden":[-54,40],"dawn-visit-coast":[69,20],"dawn-visit-watch":[62,68]}).map(([id,point])=>[id,Object.freeze(point)]))) as Readonly<Record<string,readonly [number,number]>>;
/** Personal navigation follows the same chapter/status gates as current QuestLog.track. */
export function questTrack(state:QuestState,id:string):boolean {const def=QUESTS[id],status=state.status[id];if(!def||def.chapter!==state.chapter||!(['active','ready'].includes(status)||state.chapter>=2&&status==='available'))return false;state.tracked[state.chapter]=id;return true;}

export const SNOW_POINTS:Readonly<Record<string,readonly [number,number]>>=Object.freeze(Object.fromEntries(Object.entries({"snow-crate-a":[-4.6,93.2],"snow-crate-b":[17.2,70.4],"snow-crate-c":[-8.2,56.2],"snow-herb-a":[-47,40],"snow-herb-b":[-52,28],"snow-herb-c":[-44,14],"snow-lamp-a":[-7,26],"snow-lamp-b":[7,4],"snow-lamp-c":[-7,-22],"snow-visit-forest":[-50,26],"snow-visit-overlook":[61,22],"snow-visit-aurora":[0,-34],"snow-ore-a":[36,8],"snow-ore-b":[44,-6],"snow-ore-c":[34,-22],"snow-pearl-a":[62,34],"snow-pearl-b":[68,20],"snow-pearl-c":[60,4],"snow-seal-a":[-17,-34],"snow-seal-b":[17,-42],"snow-seal-c":[-16,-54]}).map(([id,point])=>[id,Object.freeze(point)]))) as Readonly<Record<string,readonly [number,number]>>;

export const FRONTIER_POINTS={"5": {"ember-crate-a": [-12, 78], "ember-crate-b": [12, 72], "ember-crate-c": [-12, 56], "ember-herb-a": [-47, 40], "ember-herb-b": [-52, 28], "ember-herb-c": [-44, 14], "ember-lamp-a": [-7, 26], "ember-lamp-b": [7, 4], "ember-lamp-c": [-7, -22], "ember-visit-a": [-50, 26], "ember-visit-b": [61, 22], "ember-visit-c": [0, -34], "ember-ore-a": [36, 8], "ember-ore-b": [44, -6], "ember-ore-c": [34, -22], "ember-pearl-a": [62, 34], "ember-pearl-b": [68, 20], "ember-pearl-c": [60, 4], "ember-seal-a": [-17, -34], "ember-seal-b": [17, -42], "ember-seal-c": [-16, -54]}, "6": {"sky-crate-a": [-12, 78], "sky-crate-b": [12, 72], "sky-crate-c": [-12, 56], "sky-herb-a": [-47, 40], "sky-herb-b": [-52, 28], "sky-herb-c": [-44, 14], "sky-lamp-a": [-7, 26], "sky-lamp-b": [7, 4], "sky-lamp-c": [-7, -22], "sky-visit-a": [-50, 26], "sky-visit-b": [61, 22], "sky-visit-c": [0, -34], "sky-ore-a": [36, 8], "sky-ore-b": [44, -6], "sky-ore-c": [34, -22], "sky-pearl-a": [62, 34], "sky-pearl-b": [68, 20], "sky-pearl-c": [60, 4], "sky-seal-a": [-17, -34], "sky-seal-b": [17, -42], "sky-seal-c": [-16, -54]}} as const;
