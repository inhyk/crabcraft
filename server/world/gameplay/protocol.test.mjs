import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGameplayProtocol,GameplayReceiver,FragmentAssembler,encodeValue,decodeValue,encodeMessage,LIMITS,projectObservationExtras,projectActor} from './protocol.ts';
import {encodeInput,decodeInput,InputSession} from './intents.ts';
import {encodeEvents} from './events.ts';
import {worldArea,addActor,intent} from '../../../tests/core/worldHarness.mjs';
import {QUESTS} from '../../../src/sim/data/quests.ts';
import {RACES} from '../../../src/data/races.ts';
const motion=JSON.parse(readFileSync(new URL('../../../src/sim/data/pose-data.json',import.meta.url),'utf8'));
const catalog={version:motion.version,archetypes:[...Object.keys(motion.archetypes),'boss-rust','boss-abyss','boss-eclipse','boss-dawn','boss-frost'],actions:Object.keys(motion.clips),abilities:['pincer-strike','shell-bash','sideways-charge','whirlpool','bubble-bolt','frost-spray','steam-blink','tidal-nova','smite','mend-shell','barnacle-ward','holy-tide','crown-burst'],quests:Object.keys(QUESTS),npcs:['brinebeard','silvermoon','coralline','grukk','hoofclaw','rattlebolt','pip'],interactions:['npc:brinebeard','beacon','lamp-a','lighthouse-secret','treasure','moonTreasure','sunsetTreasure'],gates:['gate:w2'],objectives:Object.values(QUESTS).flatMap(q=>q.objectives.map(o=>o.id)),flags:['beaconLit','rustCleared','abyssCleared','trueCleared','finalCleared','frostCleared'],jointCount:22,appearanceLimits:Object.fromEntries(Object.entries(RACES).map(([id,r])=>[id,{shell:r.shellColors.length,crest:r.crestStyles.length,led:r.ledColors.length}]))};
const binding={session:'session-unique',area:'wire-area',epoch:1,catalog:catalog.version};
const appearance={race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Hero'};
const header=(sequence=1)=>({...binding,sequence,tick:0,acceptedInput:0,consumedInput:0});
const input=(seq=1,commands=[])=>({...intent(seq,commands),steeringYaw:.3});
function fixture(count=1){const area=worldArea(binding.area),actors=Array.from({length:count},(_,i)=>addActor(area,`private-character-${i}`));const codec=createGameplayProtocol(catalog),receiver=new GameplayReceiver(binding,catalog);return {area,actors,codec,receiver};}
function observation(f,sequence=1,full=false){const snapshot=f.area.snapshot();return {binding,sequence,tick:snapshot.tick,acceptedInput:0,consumedInput:0,selfRef:f.actors[0].p.state.unit,snapshot,events:[],visibleIds:new Set(snapshot.units.map(u=>u.ref.id)),full,eventWatermark:-1,...projectObservationExtras(snapshot,f.actors[0].p.state.character,new Set(snapshot.units.map(u=>u.ref.id))),appearances:Object.fromEntries(f.actors.map(a=>[`${a.u.ref.id}:${a.u.ref.life}`,appearance]))};}
function apply(receiver,fragments){let result=null;for(const f of fragments)result=receiver.accept(f,0);return result;}
test('bounded binary values preserve safe integers and all finite numbers without growth clamps',()=>{
 const v={large:2**48+123,hp:2**40,amount:1000000001,values:[-1,.001,Math.PI],text:'한글🦀',nested:{a:null,b:true}};
 assert.deepEqual(decodeValue(encodeValue(v)),v);for(const bad of [NaN,Infinity,Number.MAX_SAFE_INTEGER+1,()=>{},new Set()])assert.throws(()=>encodeValue(bad));
 const cycle={};cycle.self=cycle;assert.throws(()=>encodeValue(cycle));assert.throws(()=>decodeValue(new Uint8Array([255])));
});
test('actual Area public baseline is detached, exact life and appearance complete; other personal state never leaks',()=>{
 const f=fixture(2);f.actors[1].p.state.coins=777;f.actors[1].p.state.flags.frostCleared=true;const source=observation(f),packets=f.codec.encodeObservation(source),result=apply(f.receiver,packets);
 assert.equal(result.kind,'snapshot');assert.equal(result.state.actors.length,source.snapshot.units.length);assert.deepEqual(result.state.actors.find(a=>a.ref.id===f.actors[0].ref.id).pose,projectActor(f.actors[0].u,appearance).pose);
 assert.deepEqual(result.state.actors.find(a=>a.ref.id===f.actors[0].ref.id).appearance,appearance);assert.equal(result.state.self.player.coins,0);
 const serialized=JSON.stringify(result.state);assert.equal(serialized.includes('private-character-'),false);assert.equal(serialized.includes('pendingHit'),false);assert.equal(serialized.includes('"frostCleared":true'),false);
 result.state.actors[0].hp=999;assert.notEqual(f.receiver.state.actors[0].hp,999);
});
test('real movement/action produces lossless delta and complete recovery state with full target life',()=>{
 const f=fixture();apply(f.receiver,f.codec.encodeObservation(observation(f)));
 f.area.step(new Map([[f.actors[0].ref.id,intent(1,[{kind:'jump'}],{forward:1})]]));const next=observation(f,2),packets=f.codec.encodeObservation(next),result=apply(f.receiver,packets);
 const self=result.state.actors.find(a=>a.ref.id===f.actors[0].ref.id);assert.equal(self.x,f.actors[0].u.x);assert.deepEqual(self.pose,projectActor(f.actors[0].u,appearance).pose);assert.deepEqual(self.actions,f.actors[0].u.actions);assert.equal(result.state.sequence,2);
});
test('fragment groups are bounded and atomic on truncation, duplicate, loss, checksum and stale incarnation',()=>{
 const h=header(),value={content:'x'.repeat(4000),list:Array.from({length:10},()=>Array(500).fill(1))},chunks=encodeMessage(17,h,value);assert.ok(chunks.length>1);
 const a=new FragmentAssembler(binding);assert.equal(a.accept(chunks[1],0),null);assert.throws(()=>a.accept(chunks[1],0),/duplicate/);assert.ok(a.retainedBytes<=LIMITS.messageBytes);
 const b=new FragmentAssembler(binding);for(const c of chunks.slice(0,-1))assert.equal(b.accept(c,0),null);assert.throws(()=>b.accept(chunks.at(-1),6),/timeout/);assert.equal(b.retainedBytes,0);
 const corrupted=chunks.map(c=>c.slice());corrupted.at(-1)[corrupted.at(-1).length-1]^=1;const c=new FragmentAssembler(binding);assert.throws(()=>corrupted.forEach(x=>c.accept(x,0)),/checksum/);
 assert.throws(()=>new FragmentAssembler({...binding,epoch:2}).accept(chunks[0],0),/binding/);assert.throws(()=>new FragmentAssembler(binding).accept(chunks[0].slice(0,8),0),/truncated/);
 const complete=new FragmentAssembler(binding);let decoded;for(const packet of chunks.toReversed())decoded=complete.accept(packet,0);assert.deepEqual(decoded.payload,value);
});
test('missing baseline, unknown actor delta field, old life and forged self reject without partial commit',()=>{
 const f=fixture(),base=f.codec.encodeObservation(observation(f));apply(f.receiver,base);const original=f.receiver.state;
 f.area.step(new Map());const next=observation(f,2),chunks=f.codec.encodeObservation(next);const assembler=new FragmentAssembler(binding);let message;for(const p of chunks)message=assembler.accept(p,0);
 message.payload.actors[0].fields.forged=99;assert.throws(()=>apply(f.receiver,encodeMessage(1,message.header,message.payload)),/unknown/);assert.deepEqual(f.receiver.state,original);assert.equal(f.receiver.needsResync,true);
 const reset=observation(f,3,true);apply(f.receiver,f.codec.encodeObservation(reset));assert.equal(f.receiver.needsResync,false);
 f.area.step(new Map());const after=f.codec.encodeObservation(observation(f,5));assert.throws(()=>apply(f.receiver,after),/gap/);assert.equal(f.receiver.state.sequence,3);
});
test('all ordered core and feature commands roundtrip, unknown/forged fields and targets reject',()=>{
 const ref={area:binding.area,id:3,life:7};const commands=[{kind:'ability',slot:5},{kind:'target',target:ref},{kind:'target',target:null},{kind:'jump'},{kind:'dance'},{kind:'cancel'},{kind:'channelStart',channel:'beacon',targetId:'beacon'},{kind:'interact',targetId:'npc:brinebeard'},{kind:'questAccept',questId:'q1',npcId:'brinebeard'},{kind:'questTurnIn',questId:'q1',npcId:'brinebeard'},{kind:'questTrack',questId:'q1'},{kind:'forgeBuy',npcId:'pip',slot:'armor',request:2},{kind:'forgeUpgrade',npcId:'pip',slot:'weapon',request:3},{kind:'travel',gateId:'gate:w2'},{kind:'bossChallenge',profile:'frost'},{kind:'endingReplay'},{kind:'talkEnd'},{kind:'boat',command:{action:'drive',throttle:1,steer:-1}},{kind:'village',mode:'hide'}];
 const frame={...input(1,commands),forward:.4,strafe:-1,turn:.8,heldChannel:'beacon'};assert.deepEqual(decodeInput(encodeInput({binding,intent:frame},catalog),binding,catalog),frame);
 for(const extra of [{hp:100},{position:{x:0,z:0}},{reward:100}])assert.throws(()=>encodeInput({binding,intent:{...frame,...extra}},catalog),/unknown/);
 for(const c of [{kind:'ability',slot:6},{kind:'target',target:{...ref,life:0}},{kind:'target',target:{...ref,area:'other'}},{kind:'forgeBuy',npcId:'pip',coins:0},{kind:'questTrack',questId:'unknown'}])assert.throws(()=>encodeInput({binding,intent:input(1,[c])},catalog));
 assert.throws(()=>decodeInput(encodeInput({binding,intent:frame},catalog),{...binding,session:'prior'},catalog),/binding/);
});
test('input acceptance differs from successful consumption; coalescing retains every earlier ordered command',()=>{
 const s=new InputSession(binding,catalog,{now:0});for(const [seq,slot]of [[1,1],[2,2],[3,3]])s.accept(encodeInput({binding,intent:input(seq,[{kind:'ability',slot}])},catalog),seq*.01);
 assert.equal(s.acceptedInput,3);assert.equal(s.consumedInput,0);const prepared=s.prepareTick(.04);assert.deepEqual(prepared.intent.commands.map(c=>c.slot),[1,2,3]);assert.deepEqual(s.prepareTick(.05),prepared);
 s.accept(encodeInput({binding,intent:input(4,[{kind:'jump'}])},catalog),.06);s.commitConsumed(prepared.token);assert.equal(s.consumedInput,3);assert.equal(s.pendingCount,1);assert.throws(()=>s.commitConsumed(prepared.token));
 const second=s.prepareTick(.5);assert.equal(second.intent.forward,0);assert.equal(second.intent.heldChannel,null);assert.deepEqual(second.intent.commands,[{kind:'jump'}]);s.commitConsumed(second.token);assert.equal(s.consumedInput,4);assert.equal(s.prepareTick(1),null);assert.equal(s.heldState(1).heldChannel,null);assert.equal(s.consumedInput,4);
});
test('event codec preserves real CoreEvent ordering and distinguishes durable command outcome from input ACK',()=>{
 const f=fixture(),initial=observation(f);apply(f.receiver,f.codec.encodeObservation(initial));const source=f.actors[0],target=[...f.area.enemies.values()][0].unit;
 f.area.services.combat.damage(source.ref,target,5,{noReact:true});const events=f.area.drainEvents(),next=observation(f,2);next.events=events;next.eventWatermark=Math.max(...events.map(e=>e.order));const result=apply(f.receiver,f.codec.encodeObservation(next));assert.ok(result.events.some(e=>e.event.type==='damage'));assert.equal(f.receiver.header.consumedInput,0);
 const p={baselineSequence:2,events:[],results:[{inputSequence:4,commandIndex:0,status:'durable',code:'equipment-bought',request:8,revision:2}]};const response=apply(f.receiver,encodeEvents({...header(3),tick:f.area.snapshot().tick},p,catalog));assert.deepEqual(response.results,p.results);assert.equal(f.receiver.header.consumedInput,0);
 assert.throws(()=>encodeEvents(header(4),{...p,results:[{inputSequence:4,commandIndex:0,status:'durable',code:'x'}]},catalog),/revision/);
});
test('numeric widths exceed v2 without truncation and rejected growth leaves sender baseline intact',()=>{
 const f=fixture();const view=observation(f);const wide=structuredClone(view.snapshot);wide.units.find(u=>u.ref.id===f.actors[0].ref.id).hp=2**40;wide.units.find(u=>u.ref.id===f.actors[0].ref.id).maxHp=2**41;wide.players[0].coins=2**48;view.snapshot=wide;
 const result=apply(f.receiver,f.codec.encodeObservation(view));assert.equal(result.state.self.player.coins,2**48);assert.equal(result.state.actors.find(a=>a.ref.id===f.actors[0].ref.id).hp,2**40);
 const bad=observation(f,2);bad.snapshot=structuredClone(wide);bad.snapshot.players[0].coins=Number.MAX_SAFE_INTEGER+1;assert.throws(()=>f.codec.encodeObservation(bad),/numeric/);
});

test('measure initial lossless pose bandwidth with one real 100-player Area at 20 snapshots per second',t=>{
 const f=fixture(100);const bytes=p=>p.reduce((n,b)=>n+b.byteLength,0);let sequence=1;
 const baseline=bytes(f.codec.encodeObservation(observation(f,sequence++)));let total=0,count=0,ms=0;
 for(let tick=1;tick<=30;tick++){
  f.area.step(new Map(f.actors.map(a=>[a.u.ref.id,intent(tick,[],{forward:1,steeringYaw:Math.PI/2})])));
  f.area.drainEvents();
  for(const u of f.area.snapshot().units)for(const key of ['appliedQ','appliedPosition','appliedRotation'])assert.ok(u.pose[key].every(v=>Object.is(Math.fround(v),v)));
  if(Math.floor(tick*2/3)===Math.floor((tick-1)*2/3))continue;
  const started=performance.now(),chunks=f.codec.encodeObservation(observation(f,sequence++));ms+=performance.now()-started;total+=bytes(chunks);count++;
 }
 assert.equal(count,20);assert.ok(baseline<LIMITS.messageBytes);assert.ok(total>0);
 t.diagnostic(JSON.stringify({representation:'minimal-render-pose-exact-f32-sparse-delta',actualPlayers:100,totalActors:f.area.snapshot().units.length,baselineBytes:baseline,movingBytesPerClientSecond:total,meanDeltaBytes:total/count,estimated100ViewersBytesPerSecond:total*100,encodeMsPerSnapshot:ms/count}));
});

test('float32 vector encoding is selected only when every source component is bit-exact',()=>{
 const exact=Array.from(new Float32Array([.1,-0,Math.PI,1e-20]));const bytes=encodeValue(exact);assert.equal(bytes[0],8);assert.deepEqual(decodeValue(bytes),exact);
 const wide=[.1,2**48+123];const preserved=encodeValue(wide);assert.equal(preserved[0],7);assert.deepEqual(decodeValue(preserved),wide);
});
test('sparse pose patches reject cardinality and joint overflow without changing the committed actor',()=>{
 const f=fixture();apply(f.receiver,f.codec.encodeObservation(observation(f)));const before=f.receiver.state;
 f.area.step(new Map([[f.actors[0].ref.id,intent(1,[],{forward:1})]]));const packets=f.codec.encodeObservation(observation(f,2)),a=new FragmentAssembler(binding);let m;for(const p of packets)m=a.accept(p,0);
 const actor=m.payload.actors.find(a=>a.ref.id===f.actors[0].ref.id);delete actor.fields.pose;actor.poseDelta={appliedQ:{mask:2**22,values:[1]}};
 assert.throws(()=>apply(f.receiver,encodeMessage(1,m.header,m.payload)),/integer/);assert.deepEqual(f.receiver.state,before);
});

test('lighthouse channel and private discovery/achievement events preserve actual new core contract',()=>{
 const f=fixture(2),first=observation(f);apply(f.receiver,f.codec.encodeObservation(first));
 const frame=input(1,[{kind:'channelStart',channel:'lighthouse-secret',targetId:'lighthouse-secret'}]);frame.heldChannel='lighthouse-secret';assert.deepEqual(decodeInput(encodeInput({binding,intent:frame},catalog),binding,catalog),frame);
 const events=[{tick:0,order:0,event:{type:'achievement',unit:f.actors[0].ref,achievement:'secret'}},{tick:0,order:1,event:{type:'discovery',unit:f.actors[0].ref,discovery:'lighthouse-secret',id:'lighthouse-secret',first:true,coins:50,activeUntil:60}},{tick:0,order:2,event:{type:'discovery',unit:f.actors[1].ref,discovery:'treasure',id:'island',first:true,coins:75,activeUntil:null}}];
 const next=observation(f,2);next.events=events;next.eventWatermark=2;const result=apply(f.receiver,f.codec.encodeObservation(next));assert.deepEqual(result.events,events.slice(0,2));
 f.actors[0].u.lastCombat=-4.999;const combat=observation(f,3);combat.eventWatermark=2;assert.equal(apply(f.receiver,f.codec.encodeObservation(combat)).state.self.inCombat,true);
});

test('actual chest and held secret source outcomes roundtrip exact 75/100/125/50 coins and personal recovery',async()=>{
 const {TREASURES}=await import('../../../src/sim/features/exploration.ts');const f=fixture(2),hero=f.actors[0];apply(f.receiver,f.codec.encodeObservation(observation(f)));let sequence=2,watermark=-1;const paid=[];
 const publish=()=>{const events=f.area.drainEvents();if(events.length)watermark=events.at(-1).order;const o=observation(f,sequence++);o.events=events;o.eventWatermark=watermark;const r=apply(f.receiver,f.codec.encodeObservation(o));paid.push(...r.events.filter(e=>e.event.type==='discovery').map(e=>e.event.coins));return r;};
 for(const [i,treasure]of TREASURES.entries()){const point=f.area.services.definition.interactions.find(p=>p.id===treasure.id);Object.assign(hero.u,point.position);f.area.step(new Map([[hero.ref.id,intent(i+1,[{kind:'interact',targetId:treasure.id}])]]));publish();}
 Object.assign(hero.u,f.area.services.definition.interactions.find(p=>p.id==='lighthouse-secret').position);f.area.step(new Map([[hero.ref.id,intent(4,[{kind:'interact',targetId:'lighthouse-secret'}],{heldChannel:'lighthouse-secret'})]]));publish();
 for(let i=0;i<47;i++)f.area.step(new Map());const completed=publish();assert.deepEqual(paid,[75,100,125,50]);assert.equal(completed.state.self.player.coins,350);assert.equal(completed.state.self.player.lighthouseSecretFound,true);assert.equal(completed.state.features.exploration.length,1);
 const other=f.actors[1],otherInput=observation(f,1,true);otherInput.selfRef=other.ref;Object.assign(otherInput,projectObservationExtras(f.area.snapshot(),other.p.state.character,otherInput.visibleIds));otherInput.eventWatermark=watermark;
 const otherView=apply(new GameplayReceiver(binding,catalog),createGameplayProtocol(catalog).encodeObservation(otherInput));assert.equal(otherView.state.self.player.coins,0);assert.deepEqual(otherView.state.self.achievements.earned,[]);assert.deepEqual(otherView.state.features.exploration,[]);
});
test('host party commands remain ordered single-command frames and party view supports cross-Area refs',()=>{
 for(const command of [{kind:'partyCreate'},{kind:'partyJoin',code:'A1B2C3'},{kind:'partyLeave'},{kind:'partyPvp',enabled:true},{kind:'encounterLeave'}]){
  const frame=input(1,[command]);assert.deepEqual(decodeInput(encodeInput({binding,intent:frame},catalog),binding,catalog),frame);
  assert.throws(()=>encodeInput({binding,intent:input(1,[command,{kind:'jump'}])},catalog),/cannot mix/);
 }
 assert.throws(()=>encodeInput({binding,intent:input(1,[{kind:'partyJoin',code:'abcdef'}])},catalog),/party code/);
 const f=fixture();apply(f.receiver,f.codec.encodeObservation(observation(f)));const control={type:'party',state:{code:'A1B2C3',leader:'member-a',members:[{id:'member-a',name:'Alice',ref:f.actors[0].ref,world:'w1',online:true},{id:'member-b',name:'Bob',ref:{area:'other-area',id:4,life:2},world:'w2',online:true}],pvp:false}};
 const result=apply(f.receiver,f.codec.encodeControl(header(2),control));assert.deepEqual(result.control,control);
 assert.throws(()=>f.codec.encodeControl(header(3),{...control,state:{...control.state,members:[control.state.members[0],control.state.members[0]]}}),/membership/);
});
