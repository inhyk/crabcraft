import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulationArea} from '../src/sim/area.ts';
import {realActionData} from '../src/sim/data/actions.ts';
import {createWorld1Definition} from '../src/sim/areas/world1.ts';
import {createWorld3Definition} from '../src/sim/areas/world3.ts';
import {createWorld5Definition} from '../src/sim/areas/frontier.ts';
import {InMemoryTransferCoordinator} from '../src/sim/transfer.ts';
import {freshCheckpoint,prepareRestore,validateCheckpoint} from '../src/sim/persistence.ts';
import {questAccept,setQuestChapter} from '../src/sim/data/quests.ts';
import {flatWorld,intent,tick} from './core/worldHarness.mjs';

// Synthetic Tidecrown on a flat world. The hub's zone line to W1 runs along z=60 (outward +z);
// W1's zone line back runs along z=-238 (outward -z). Both bands are 10m either side and 12m deep.
const config={query:flatWorld,personalProps:flatWorld,fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:1,scavenger:0,jellyfish:0}};
const poi=(id,x,z,yaw=0,radius=1)=>({id,position:{x,y:0,z},yaw,radius});
const HARBOUR={x:-34,y:0,z:0};
function hubDefinition(extra={}){
 const spawn=poi('spawn',0,0,0,6);
 return {world:'tc',spawn,recall:spawn,pois:{spawn,plaza:poi('plaza',0,10)},arrivals:{'from:w1':poi('from:w1',0,52,Math.PI),harbour:poi('harbour',-30,0,Math.PI/2)},enemies:[],bosses:[],
  npcs:[{id:'tc-king',position:{x:0,y:0,z:-10},yaw:0,archetype:'npc:brinebeard'},{id:'tc-harbourmaster',position:{x:-36,y:0,z:2},yaw:Math.PI/2,archetype:'npc:silvermoon'}],
  interactions:[{id:'edge:w1',kind:'edge',position:{x:0,y:0,z:60},range:10,edge:{nx:0,nz:1,depth:12},destination:'w1',arrival:'from:tc'},...['w1','w3','w5'].map(w=>({id:`route:${w}`,kind:'route',position:HARBOUR,range:8,destination:w}))],...extra};
}
function linked(definition,edge){
 const route={id:'route:tc',kind:'route',position:{...definition.spawn.position},range:8,destination:'tc',arrival:'harbour'};
 return {...definition,...(edge?{arrivals:{'from:tc':poi('from:tc',-60,-230,0)}}:{}),interactions:[...definition.interactions,route,...(edge?[{id:'edge:tc',kind:'edge',position:{x:-60,y:0,z:-238},range:10,edge:{nx:0,nz:-1,depth:12},destination:'tc',arrival:'from:w1'}]:[])]};
}
const definitions={tc:()=>hubDefinition(),w1:()=>linked(createWorld1Definition(config),true),w3:()=>linked(createWorld3Definition(config)),w5:()=>linked(createWorld5Definition(config))};
function place(id,world,overrides={}){return new SimulationArea({id,definition:definitions[world](),query:flatWorld,seed:15,policy:{enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>({desired:1,respawnSeconds:30}),damageAllowed:()=>true,canInteract:()=>true},actionData:realActionData,context:{mode:'public',members:[],pvp:'disabled'},limits:{eventCount:100000,inputCommandsPerTick:32,timers:1000,projectiles:1000},...overrides});}
function actor(area,character='hero'){const p=area.services.playerByCharacter(character),u=area.services.getUnit(p.state.unit);return {ref:u.ref,p,u};}
function attach(area,character='hero'){area.attachFresh(character,'mage','human','spawn');return actor(area,character);}
function at(a,x,z){Object.assign(a.u,{x,z});}
const ready=area=>area.drainEvents().filter(e=>e.event.type==='travelReady').map(e=>e.event);
function run(area,a,seq,commands){return area.step(new Map([[a.ref.id,intent(seq,commands)]])).map(o=>o.success);}
const identity={schema:'world-identity-v1',classId:'mage',archetype:'human',appearance:{race:'human',sex:'female',classId:'mage',shell:3,crest:2,led:2,name:'Tide Crab'}};
const context={characterId:'77777777-7777-4777-8777-777777777777',identity};
const keep={version:'fixture-keep-v1',restore:c=>structuredClone(c)};
function restore(area,checkpoint){const admission=area.reserveAdmission(checkpoint.character,'spawn',0),staged=area.stageRestoredArrival(admission,checkpoint,prepareRestore(checkpoint,0,keep));return area.activateRestoredArrival(staged.token);}

test('W1 zone line arms inside, fires once on crossing and lands at the hub arrival with quests unchanged',()=>{
 const c=new InMemoryTransferCoordinator(),w1=place('hub-edge-w1','w1',{characters:c.characters}),tc=place('hub-edge-tc','tc',{characters:c.characters}),hero=attach(w1);
 hero.p.state.quests.progress['q1-kill']=2;hero.p.state.quests.tracked[1]='q1';hero.p.state.flags.rustCleared=true;
 at(hero,-60,-230);tick(w1);assert.deepEqual(w1.debugState().interactions.edges.map(e=>e.armed),[['edge:tc']]);
 at(hero,-60,-239);tick(w1);assert.deepEqual(ready(w1).map(e=>[e.destination,e.gate]),[['tc','edge:tc']]);
 tick(w1,60);assert.equal(ready(w1).length,0);
 const quests=structuredClone(hero.p.state.quests),flags=structuredClone(hero.p.state.flags),result=c.transfer('hero',w1,tc,'edge:tc',0);
 assert.equal(result.ok,true);const arrived=actor(tc);assert.deepEqual([arrived.u.x,arrived.u.z,arrived.u.yaw],[0,52,Math.PI]);
 assert.deepEqual(arrived.p.state.quests,quests);assert.equal(arrived.p.state.quests.chapter,1);assert.deepEqual(arrived.p.state.flags,flags);assert.equal(c.characters.owner('hero').area,'hub-edge-tc');
});

test('zone line ignores crossings outside the band or past its depth, waits out combat and never fires for a character restored past it',()=>{
 const w1=place('hub-edge-reject','w1'),hero=attach(w1);
 at(hero,-60,-230);tick(w1);at(hero,-49,-239);tick(w1,5);assert.equal(ready(w1).length,0);assert.deepEqual(w1.debugState().interactions.edges[0].armed,[]);at(hero,-55,-239);tick(w1,5);assert.equal(ready(w1).length,0);
 at(hero,-60,-230);tick(w1);at(hero,-60,-252);tick(w1);at(hero,-60,-245);tick(w1,5);assert.equal(ready(w1).length,0);
 at(hero,-60,-230);tick(w1);hero.u.lastCombat=w1.services.time;at(hero,-60,-239);tick(w1,140);assert.equal(ready(w1).length,0);
 tick(w1,20);assert.deepEqual(ready(w1).map(e=>e.gate),['edge:tc']);
 const login=place('hub-edge-login','w1'),checkpoint=freshCheckpoint(context,{x:-60,y:0,z:-239,yaw:0});restore(login,checkpoint);const back=actor(login,context.characterId);
 tick(login,30);assert.equal(ready(login).length,0);assert.deepEqual(login.debugState().interactions.edges[0].armed,[]);
 at(back,-60,-237);tick(login);assert.equal(ready(login).length,0);at(back,-60,-235);tick(login);at(back,-60,-238);tick(login);assert.deepEqual(ready(login).map(e=>e.gate),['edge:tc']);
});

test('hub zone line back to W1 lands at its own arrival, sets chapter one and explicit travel checks the same band',()=>{
 const c=new InMemoryTransferCoordinator(),tc=place('hub-back-tc','tc',{characters:c.characters}),w1=place('hub-back-w1','w1',{characters:c.characters}),hero=attach(tc);
 setQuestChapter(hero.p.state.quests,3);hero.p.state.quests.tracked[3]='d1';Object.assign(hero.p.state.flags,{abyssCleared:true,trueCleared:true});
 let seq=1;const travel=()=>run(tc,hero,seq++,[{kind:'travel',gateId:'edge:w1'}])[0];
 for(const [x,z] of [[0,58.5],[0,72.5],[10.5,61]]){at(hero,x,z);assert.equal(travel(),false,`${x},${z}`);}
 assert.equal(ready(tc).length,0);at(hero,0,60.5);assert.equal(travel(),true);assert.deepEqual(ready(tc).map(e=>[e.destination,e.gate]),[['w1','edge:w1']]);
 assert.equal(c.transfer('hero',tc,w1,'edge:w1',0).ok,true);const arrived=actor(w1);
 assert.deepEqual([arrived.u.x,arrived.u.z,arrived.u.yaw],[-60,-230,0]);assert.equal(arrived.p.state.quests.chapter,1);assert.equal(arrived.p.state.quests.tracked[3],'d1');
});

test('harbour routes keep story locks, set the destination chapter and bring the player back with quests exactly as they left',()=>{
 const c=new InMemoryTransferCoordinator(),tc=place('hub-route-tc','tc',{characters:c.characters}),w3=place('hub-route-w3','w3',{characters:c.characters}),w5=place('hub-route-w5','w5',{characters:c.characters}),hero=attach(tc);
 at(hero,HARBOUR.x,HARBOUR.z);tick(tc,120);assert.equal(ready(tc).length,0);
 let seq=1;for(const gate of ['route:w3','route:w5'])assert.deepEqual(run(tc,hero,seq++,[{kind:'travel',gateId:gate}]),[false]);
 assert.deepEqual(c.transfer('hero',tc,w3,'route:w3',0),{ok:false,reason:'locked-world'});assert.deepEqual(c.transfer('hero',tc,w5,'route:w5',0),{ok:false,reason:'locked-world'});
 Object.assign(hero.p.state.flags,{abyssCleared:true,trueCleared:true});assert.deepEqual(run(tc,hero,seq++,[{kind:'travel',gateId:'route:w3'}]),[true]);assert.deepEqual(ready(tc).map(e=>e.destination),['w3']);
 assert.equal(c.transfer('hero',tc,w3,'route:w3',0).ok,true);let p=actor(w3);assert.equal(p.p.state.quests.chapter,3);
 const arrival=w3.services.definition.pois.arrival??w3.services.definition.spawn;assert.deepEqual([p.u.x,p.u.z],[arrival.position.x,arrival.position.z]);
 questAccept(p.p,w3.services,'d1');p.p.state.quests.tracked[3]='d1';p.p.state.quests.progress['d1-kill']=1;
 const quests=structuredClone(p.p.state.quests);at(p,w3.services.definition.spawn.position.x,w3.services.definition.spawn.position.z);p.u.lastCombat=-10;
 assert.equal(c.transfer('hero',w3,tc,'route:tc',1).ok,true);p=actor(tc);assert.deepEqual(p.p.state.quests,quests);assert.deepEqual([p.u.x,p.u.z],[-30,0]);
 p.p.state.flags.frostCleared=true;at(p,HARBOUR.x,HARBOUR.z);assert.equal(c.transfer('hero',tc,w5,'route:w5',2).ok,true);assert.equal(actor(w5).p.state.quests.chapter,5);assert.deepEqual(actor(w5).p.state.quests.tracked,quests.tracked);
});

test('inside the hub quests are only tracked, nothing bumps them, and boat, village, PvP, bosses and endings stay off',()=>{
 // Chapter quest NPCs standing in the hub still give, take and bump nothing there.
 const npcs=['brinebeard','silvermoon'].map((id,i)=>({id,position:{x:2,y:0,z:i*2},yaw:0,archetype:`npc:${id}`}));
 const tc=place('hub-inside','tc',{definition:hubDefinition({npcs:[...hubDefinition().npcs,...npcs]})}),hero=attach(tc),other=attach(tc,'other');
 at(hero,0,0);at(other,1,0);let seq=1;
 assert.deepEqual(run(tc,hero,seq++,[{kind:'questAccept',questId:'q1',npcId:'brinebeard'}]),[false]);assert.equal(hero.p.state.quests.status.q1,'available');
 hero.p.state.quests.status.q2='active';assert.deepEqual(run(tc,hero,seq++,[{kind:'interact',targetId:'npc:silvermoon'}]),[true]);assert.equal(hero.p.state.quests.progress['q2-deliver'],undefined);assert.equal(hero.p.state.quests.status.q2,'active');
 setQuestChapter(hero.p.state.quests,3);assert.deepEqual(run(tc,hero,seq++,[{kind:'questTrack',questId:'d1'}]),[true]);assert.equal(hero.p.state.quests.tracked[3],'d1');
 hero.p.state.quests.status.d1='active';
 tc.receiveGrant({id:JSON.stringify(['w3-area',9,1,'hero']),victim:{area:'w3-area',id:9,life:1},recipient:'hero',xp:5,coins:1,objectives:[{kind:'kill-scavenger',amount:1}],flags:[]});assert.equal(hero.p.state.quests.progress['d1-kill'],1);tc.drainEvents();
 assert.equal(tc.boat.context.chapter,0);assert.deepEqual(run(tc,hero,seq++,[{kind:'boat',command:{action:'call',throttle:0,steer:0}},{kind:'village',mode:'hide'}]),[false,false]);assert.equal(tc.snapshot().features.village,null);
 assert.equal(tc.services.combat.damage(hero.ref,other.ref,30),0);assert.equal(other.u.hp,other.u.maxHp);
 Object.assign(hero.p.state.flags,{abyssCleared:true,frostCleared:true});assert.deepEqual(run(tc,hero,seq++,[{kind:'bossChallenge',profile:'rust'},{kind:'endingReplay'}]),[false,false]);
 tick(tc,10);assert.equal(tc.drainEvents().filter(e=>['endingReady','quest','travelReady'].includes(e.event.type)).length,0);
});

test('hub checkpoints keep the chapter the player brought and reject impossible chapters, old catalogs and the wrong Area',()=>{
 const base=freshCheckpoint(context,{x:0,y:0,z:0,yaw:0}),hub=structuredClone(base);hub.world='tc';setQuestChapter(hub.progress.quests,3);hub.progress.quests.tracked={1:'q1',3:'d1'};
 assert.deepEqual(validateCheckpoint(hub),hub);
 const tc=place('hub-restore','tc'),ref=restore(tc,hub),p=tc.services.player(ref);assert.equal(p.state.quests.chapter,3);assert.deepEqual(p.state.quests.tracked,{1:'q1',3:'d1'});
 const captured=tc.capturePlayerCheckpoint(ref).checkpoint;assert.equal(captured.world,'tc');assert.equal(captured.progress.quests.chapter,3);
 for(const mutate of [c=>c.progress.quests.chapter=7,c=>c.progress.quests.chapter=0,c=>c.progress.quests.chapter=2.5,c=>c.progress.quests.tracked[7]='d1',c=>{for(const id of Object.keys(c.progress.quests.status).filter(id=>/^r[56]q/.test(id)))delete c.progress.quests.status[id];},c=>c.world='tc2']){const bad=structuredClone(hub);mutate(bad);assert.throws(()=>validateCheckpoint(bad),/invalid-checkpoint/);}
 const chapterWorld=structuredClone(hub);chapterWorld.world='w2';assert.throws(()=>validateCheckpoint(chapterWorld),/quests.chapter/);chapterWorld.world='w3';assert.deepEqual(validateCheckpoint(chapterWorld),chapterWorld);
 const w3=place('hub-restore-w3','w3');assert.throws(()=>restore(w3,hub),/world/);
});

test('hub definitions reject enemies, bosses and malformed travel links',()=>{
 const w1=createWorld1Definition(config);
 assert.throws(()=>place('hub-enemies','tc',{definition:hubDefinition({enemies:[w1.enemies[0]]})}),/enemies or bosses/);
 assert.throws(()=>place('hub-bosses','tc',{definition:hubDefinition({bosses:[w1.bosses[0]]})}),/enemies or bosses/);
 const edge=hubDefinition().interactions[0];
 for(const bad of [{...edge,edge:undefined},{...edge,edge:{nx:1,nz:1,depth:12}},{...edge,edge:{nx:0,nz:1,depth:0}},{...edge,destination:undefined},{...edge,kind:'route'}])assert.throws(()=>place('hub-link','tc',{definition:hubDefinition({interactions:[bad]})}),/Invalid travel link/);
 assert.doesNotThrow(()=>place('hub-ok','tc'));
});
