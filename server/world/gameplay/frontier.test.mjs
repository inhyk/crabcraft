import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {actualWorld,catalog as fourCatalog,appearance} from '../../../tests/world-client-fixture.mjs';
import {worldArea,addActor,intent} from '../../../tests/core/worldHarness.mjs';
import {createGameplayProtocol,GameplayReceiver,encodeControl,validateControl,projectObservationExtras} from './protocol.ts';
import {encodeInput,decodeInput} from './intents.ts';
import {encodeEvents} from './events.ts';
const catalog={...fourCatalog,archetypes:[...fourCatalog.archetypes,'boss-ember','boss-sky'],flags:[...fourCatalog.flags,'emberCleared','skyCleared'],gates:['gate:w4','gate:w5','gate:w6']};
const digest=packets=>createHash('sha256').update(Buffer.concat(packets)).digest('hex');
test('the four-world full snapshot bytes match the exact pre-capability 2aa6a51 fixture',()=>{
 const expected={w1:'5514acfcb49020806147faf19fedfc13428492bd213a246418184297bb452481',w2:'f7b6733da2d161a5f0fe129b22ed27459083a372f1b758b7bae3c678159351e3',w3:'823c711b0ec5ccd699f1a37a83a78c71be953f5a537a50d545f0f58810e0414d',w4:'69b9f3817af3250c6aaac1335ef86ab3c052b8924633b670260ce822d419c87e'};
 for(const world of Object.keys(expected)){const f=actualWorld();try{const o=f.observation(1,{full:true});o.snapshot={...o.snapshot,world};assert.equal(digest(f.codec.encodeObservation(o)),expected[world],world);}finally{f.area.dispose();}}
});
for(const [world,profile,chapter]of [['w5','ember',5],['w6','sky',6]])test(`${world} actual Area full/fragments/delta and boss recovery preserve private six-chapter state`,()=>{
 const area=worldArea(`wire-${world}`,world),hero=addActor(area,'hero'),other=addActor(area,'other'),binding={session:'six-session',area:`wire-${world}`,epoch:1,catalog:catalog.version},codec=createGameplayProtocol(catalog),receiver=new GameplayReceiver(binding,catalog);
 for(let i=0;i<38;i++)addActor(area,`extra-${i}`);
 hero.p.state.quests.tracked[chapter]=`r${chapter}q1`;hero.p.state.coins=1234;other.p.state.coins=9999;
 const obs=(sequence,full)=>{const snapshot=area.snapshot(),visibleIds=new Set([...snapshot.players.map(p=>p.unit.id),...snapshot.recovery.bosses.map(b=>b.unit.id)]);return{binding,sequence,tick:snapshot.tick,acceptedInput:0,consumedInput:0,selfRef:hero.ref,snapshot,events:[],visibleIds,full,eventWatermark:-1,...projectObservationExtras(snapshot,'hero',visibleIds),appearances:Object.fromEntries(snapshot.players.map(p=>[`${p.unit.id}:${p.unit.life}`,appearance]))};};
 const apply=packets=>{let result;for(const packet of packets)result=receiver.accept(packet,0);return result;};
 try{
  const full=codec.encodeObservation(obs(1,true));assert(full.length>1,'actual pose payload fragments');const first=apply(full);assert.equal(first.state.world,world);assert.equal(first.state.self.player.quests.chapter,chapter);assert.equal(first.state.self.player.quests.tracked[chapter],`r${chapter}q1`);assert.equal(first.state.self.player.coins,1234);assert.equal(first.state.features.environment.pvp,'disabled');assert.equal(first.state.recovery.bosses[0].profile,profile);assert(!('coins'in first.state.actors.find(a=>a.ref.id===other.ref.id)));
  area.step(new Map([[hero.ref.id,intent(1,[],{forward:1})]]));const next=apply(codec.encodeObservation(obs(2,false)));assert.equal(next.state.sequence,2);assert.equal(next.state.self.player.coins,1234);assert.deepEqual(next.state.actors.map(a=>a.ref),first.state.actors.map(a=>a.ref));
  for(const invalid of [o=>{o.snapshot.players[0].quests.chapter=7;},o=>{o.snapshot.players[0].quests.tracked['7']='r6q1';}]){const bad=structuredClone(obs(3,true));invalid(bad);assert.throws(()=>createGameplayProtocol(catalog).encodeObservation(bad));}
  const broken=obs(3,true);broken.snapshot={...broken.snapshot,world:'w7'};assert.throws(()=>codec.encodeObservation(broken),/unknown discriminator/);
 }finally{area.dispose();}
});
test('frontier inputs require the active boss/gate catalog and reject forged authority and unknown variants',()=>{
 const binding={session:'inputs',area:'input-area',epoch:1,catalog:catalog.version};
 for(const profile of ['ember','sky']){const intentValue=intent(1,[{kind:'bossChallenge',profile}]);assert.equal(decodeInput(encodeInput({binding,intent:intentValue},catalog),binding,catalog).commands[0].profile,profile);assert.throws(()=>encodeInput({binding,intent:intentValue},fourCatalog),/unavailable/);}
 for(const command of [{kind:'bossChallenge',profile:'unknown'},{kind:'bossChallenge',profile:'ember',xp:100},{kind:'travel',gateId:'gate:w7'}])assert.throws(()=>encodeInput({binding,intent:intent(1,[command])},catalog));
 assert.throws(()=>encodeInput({binding,intent:intent(1,[{kind:'travel',gateId:'gate:w5'}])},fourCatalog));
});
test('frontier queued/party/travel controls roundtrip while world7 and non-Frost endings reject',()=>{
 const h={session:'controls',area:'control-area',epoch:1,catalog:catalog.version,sequence:1,tick:0,acceptedInput:0,consumedInput:0},ref={area:h.area,id:1,life:1};
 for(const world of ['w5','w6']){const receiver=new GameplayReceiver({session:h.session,area:h.area,epoch:h.epoch,catalog:h.catalog},catalog),queued={type:'queued',world,position:1};assert.equal(receiver.accept(encodeControl(h,queued)[0],0).control.world,world);const party={type:'party',state:{code:'ABCDEF',leader:'hero',members:[{id:'hero',name:'Hero',ref,world,online:true}],pvp:false}};validateControl(party);const events={baselineSequence:1,events:[{tick:0,order:0,event:{type:'travelReady',unit:ref,destination:world,gate:`gate:${world}`}}],results:[]};assert(encodeEvents(h,events,catalog).length);}
 assert.throws(()=>validateControl({type:'queued',world:'w7',position:1}));assert.throws(()=>encodeEvents(h,{baselineSequence:1,events:[{tick:0,order:0,event:{type:'endingReady',unit:ref,chapter:5,replay:false}}],results:[]},catalog));
});
