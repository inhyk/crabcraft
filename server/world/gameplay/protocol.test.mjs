import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGameplayProtocol,GameplayReceiver,FragmentAssembler,encodeValue,decodeValue,encodeMessage,LIMITS,projectObservationExtras,projectActor,prepareObservationSnapshot,releasePreparedObservation} from './protocol.ts';
import {encodeInput,decodeInput,InputSession,InputRateBudget} from './intents.ts';
import {encodeEvents} from './events.ts';
import {worldArea,addActor,intent,tick} from '../../../tests/core/worldHarness.mjs';
import {xpForLevel} from '../../../src/sim/data/progression.ts';
import {QUESTS} from '../../../src/sim/data/quests.ts';
import {RACES} from '../../../src/data/races.ts';
const motion=JSON.parse(readFileSync(new URL('../../../src/sim/data/pose-data.json',import.meta.url),'utf8'));
const catalog={version:motion.version,poseProviderVersion:motion.version,archetypes:[...Object.keys(motion.archetypes),'boss-rust','boss-abyss','boss-eclipse','boss-dawn','boss-frost'],actions:Object.keys(motion.clips),abilities:['pincer-strike','shell-bash','sideways-charge','whirlpool','bubble-bolt','frost-spray','steam-blink','tidal-nova','smite','mend-shell','barnacle-ward','holy-tide','crown-burst'],quests:Object.keys(QUESTS),npcs:['brinebeard','silvermoon','coralline','grukk','hoofclaw','rattlebolt','pip'],interactions:['npc:brinebeard','beacon','lamp-a','lighthouse-secret','treasure','moonTreasure','sunsetTreasure'],gates:['gate:w2'],objectives:Object.values(QUESTS).flatMap(q=>q.objectives.map(o=>o.id)),flags:['beaconLit','rustCleared','abyssCleared','trueCleared','finalCleared','frostCleared'],jointCount:22,appearanceLimits:Object.fromEntries(Object.entries(RACES).map(([id,r])=>[id,{shell:r.shellColors.length,crest:r.crestStyles.length,led:r.ledColors.length}]))};
const binding={session:'session-unique',area:'wire-area',epoch:1,catalog:catalog.version};
const appearance={race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Hero'};
const header=(sequence=1)=>({...binding,sequence,tick:0,acceptedInput:0,consumedInput:0});
const input=(seq=1,commands=[])=>({...intent(seq,commands),steeringYaw:.3});
function fixture(count=1,options={}){const area=worldArea(binding.area,'w1',options),actors=Array.from({length:count},(_,i)=>addActor(area,`private-character-${i}`));const codec=createGameplayProtocol(catalog),receiver=new GameplayReceiver(binding,catalog);return {area,actors,codec,receiver};}
function observation(f,sequence=1,full=false){const snapshot=f.area.snapshot();return {binding,sequence,tick:snapshot.tick,acceptedInput:0,consumedInput:0,selfRef:f.actors[0].p.state.unit,snapshot,events:[],visibleIds:new Set(snapshot.units.map(u=>u.ref.id)),full,eventWatermark:-1,...projectObservationExtras(snapshot,f.actors[0].p.state.character,new Set(snapshot.units.map(u=>u.ref.id))),appearances:Object.fromEntries(f.actors.map(a=>[`${a.u.ref.id}:${a.u.ref.life}`,appearance]))};}
function apply(receiver,fragments){let result=null;for(const f of fragments)result=receiver.accept(f,0);return result;}
test('actual Astra XP blessing survives private binary recovery without becoming a cast ability',()=>{
 const area=worldArea(binding.area,'w2'),actors=[addActor(area,'blessed'),addActor(area,'other')],codec=createGameplayProtocol(catalog),receiver=new GameplayReceiver(binding,catalog),f={area,actors,codec,receiver};
 try{
  const actor=actors[0];actor.p.gainXp(xpForLevel(20));actor.p.state.flags.abyssCleared=true;
  const boss=area.services.bossByProfile('eclipse');boss.wake();tick(area,74);area.services.combat.damage(actor.ref,boss.unit,1e8);
  const expected={...actor.p.state.cooldowns['boss-xp-blessing']};assert.equal(expected.end-expected.start,600);
  const result=apply(receiver,codec.encodeObservation(observation(f)));
  assert.deepEqual(result.state.self.player.cooldowns['boss-xp-blessing'],expected);
  const other=observation(f,1,true);other.selfRef=actors[1].ref;Object.assign(other,projectObservationExtras(area.snapshot(),actors[1].p.state.character,other.visibleIds));
  const otherResult=apply(new GameplayReceiver(binding,catalog),createGameplayProtocol(catalog).encodeObservation(other));
  assert.equal(otherResult.state.self.player.cooldowns['boss-xp-blessing'],undefined);
  actor.p.state.cast={ability:'boss-xp-blessing',start:area.services.time,end:area.services.time+1,target:null};
  assert.throws(()=>codec.encodeObservation(observation(f,2,true)));
 }finally{for(const p of area.pendingGrants())area.acknowledgeGrant(p.grant.id);area.dispose();}
});
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
 const p={baselineSequence:2,events:[],results:[{inputSequence:4,commandIndex:0,status:'durable',code:'equipment-bought',request:8,revision:2}]};const response=apply(f.receiver,encodeEvents({...header(3),tick:f.area.snapshot().tick,acceptedInput:4,consumedInput:4},p,catalog));assert.deepEqual(response.results,p.results);assert.equal(f.receiver.header.consumedInput,4);
 assert.throws(()=>encodeEvents(header(4),{...p,results:[{inputSequence:4,commandIndex:0,status:'durable',code:'x'}]},catalog),/revision/);
});
test('numeric widths exceed v2 without truncation and rejected growth leaves sender baseline intact',()=>{
 const f=fixture();const view=observation(f);const wide=structuredClone(view.snapshot);wide.units.find(u=>u.ref.id===f.actors[0].ref.id).hp=2**40;wide.units.find(u=>u.ref.id===f.actors[0].ref.id).maxHp=2**41;wide.players[0].coins=2**48;view.snapshot=wide;
 const result=apply(f.receiver,f.codec.encodeObservation(view));assert.equal(result.state.self.player.coins,2**48);assert.equal(result.state.actors.find(a=>a.ref.id===f.actors[0].ref.id).hp,2**40);
 const bad=observation(f,2);bad.snapshot=structuredClone(wide);bad.snapshot.players[0].coins=Number.MAX_SAFE_INTEGER+1;assert.throws(()=>f.codec.encodeObservation(bad),/invalid (numeric|integer)/);
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
 t.diagnostic(JSON.stringify({representation:'shared-exact-render-recipe-pooled-per-snapshot',actualPlayers:100,totalActors:f.area.snapshot().units.length,baselineBytes:baseline,movingBytesPerClientSecond:total,meanDeltaBytes:total/count,estimated100ViewersBytesPerSecond:total*100,encodeMsPerSnapshot:ms/count}));
});

test('float32 vector encoding is selected only when every source component is bit-exact',()=>{
 const exact=Array.from(new Float32Array([.1,-0,Math.PI,1e-20]));const bytes=encodeValue(exact);assert.equal(bytes[0],8);assert.deepEqual(decodeValue(bytes),exact);
 const wide=[.1,2**48+123];const preserved=encodeValue(wide);assert.equal(preserved[0],7);assert.deepEqual(decodeValue(preserved),wide);
});
test('sparse pose patches reject cardinality and joint overflow without changing the committed actor',()=>{
 const f=fixture();apply(f.receiver,f.codec.encodeObservation(observation(f)));const before=f.receiver.state;
 f.area.step(new Map([[f.actors[0].ref.id,intent(1,[],{forward:1})]]));const packets=f.codec.encodeObservation(observation(f,2)),a=new FragmentAssembler(binding);let m;for(const p of packets)m=a.accept(p,0);
 const actor=m.payload.actors.find(a=>a.ref.id===f.actors[0].ref.id);delete actor.fields.pose;delete actor.poseRecipe;actor.poseDelta={appliedQ:{mask:2**22,values:[1]}};
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

test('prepared commands preserve original frame correlation and never coalesce across host boundaries',()=>{
 const s=new InputSession(binding,catalog),commands=[[{kind:'ability',slot:1}],[{kind:'partyCreate'}],[{kind:'jump'}],[{kind:'dance'}]];
 commands.forEach((c,i)=>s.accept(encodeInput({binding,intent:input(i+1,c)},catalog),i*.01));
 const first=s.prepareTick(.1);assert.deepEqual(first.sequences,[1]);assert.deepEqual(first.commandOrigins,[{inputSequence:1,commandIndex:0}]);s.commitConsumed(first.token);
 const party=s.prepareTick(.1);assert.deepEqual(party.sequences,[2]);assert.deepEqual(party.intent.commands,[{kind:'partyCreate'}]);s.commitConsumed(party.token);
 const rest=s.prepareTick(.1);assert.deepEqual(rest.sequences,[3,4]);assert.deepEqual(rest.commandOrigins,[{inputSequence:3,commandIndex:0},{inputSequence:4,commandIndex:0}]);assert.deepEqual(rest.intent.commands,[{kind:'jump'},{kind:'dance'}]);
});
test('delivered cross-Area entitlement preserves its original victim ref and remains recipient-only',()=>{
 const f=fixture(2);apply(f.receiver,f.codec.encodeObservation(observation(f)));const grant={id:'["previous-area",77,3,"private-character-0"]',victim:{area:'previous-area',id:77,life:3},recipient:f.actors[0].p.state.character,xp:10,coins:5,objectives:[],flags:[]};
 assert.equal(f.area.receiveGrant(grant),'applied');const events=f.area.drainEvents(),o=observation(f,2);o.events=events;o.eventWatermark=events.at(-1).order;const result=apply(f.receiver,f.codec.encodeObservation(o));
 assert.ok(result.events.some(e=>e.event.type==='xp'&&e.event.amount===10));assert.equal(result.state.self.player.coins,5);assert.equal(result.state.self.player.xp,10);
 const carried={tick:0,order:o.eventWatermark+1,event:{type:'reward',grant,appliedHere:true}},packet=encodeEvents(header(3),{baselineSequence:2,events:[carried],results:[]},catalog);assert.deepEqual(apply(f.receiver,packet).events[0].event.grant.victim,grant.victim);
});
test('wire recipe reconstruction is component-exact for real movement, jump, dance and interrupted actions',()=>{
 const f=fixture(5);apply(f.receiver,f.codec.encodeObservation(observation(f)));let seq=2,observed=0;
 for(let tick=1;tick<=180;tick++){
  const inputs=new Map(f.actors.map((a,i)=>[a.u.ref.id,intent(tick,tick===1?(i===2?[{kind:'jump'}]:i===3?[{kind:'dance'}]:[]):tick===80&&i===3?[{kind:'cancel'}]:[],i===0?{forward:1,turn:.3}:i===1?{strafe:-1,sprint:true}:{} )]));
  f.area.step(inputs);f.area.drainEvents();if(tick%3===1)continue;
  const source=observation(f,seq++),state=apply(f.receiver,f.codec.encodeObservation(source)).state;
  for(const actor of state.actors){const unit=source.snapshot.units.find(u=>u.ref.id===actor.ref.id);assert.deepEqual(actor.pose,projectActor(unit,actor.appearance).pose);observed++;}
 }
 assert.ok(observed>=2500);
});
test('stale pose provider and malformed recipe versions fail before client baseline mutation',()=>{
 assert.throws(()=>createGameplayProtocol({...catalog,poseProviderVersion:'stale-motion'}),/provider mismatch/);
 assert.throws(()=>new GameplayReceiver(binding,{...catalog,poseProviderVersion:'stale-motion'}),/provider mismatch/);
 const f=fixture(),packets=f.codec.encodeObservation(observation(f)),assembler=new FragmentAssembler(binding);let m;for(const p of packets)m=assembler.accept(p,0);m.payload.poses[0].recipe.version=99;
 assert.throws(()=>apply(f.receiver,encodeMessage(1,m.header,m.payload)),/recipe/);assert.equal(f.receiver.state,null);
});
test('recipe pooling preserves negative zero in the owning actor locomotion fields',()=>{
 const f=fixture(2);f.actors[1].u.pose.localVx=-0;const state=apply(f.receiver,f.codec.encodeObservation(observation(f))).state;
 assert.equal(Object.is(state.actors.find(a=>a.ref.id===f.actors[0].ref.id).pose.localVx,0),true);assert.equal(Object.is(state.actors.find(a=>a.ref.id===f.actors[1].ref.id).pose.localVx,-0),true);
});

test('owned prepared snapshots are byte-identical, private per viewer, deeply immutable and unforgeable',()=>{
 const f=fixture(2);f.actors[1].p.state.coins=321;const source=observation(f);source.prepared=prepareObservationSnapshot(source.snapshot,source.appearances,catalog);
 assert.deepEqual(createGameplayProtocol(catalog).encodeObservation(source),createGameplayProtocol(catalog).encodeObservation({...source,prepared:undefined}));
 assert.deepEqual(Object.keys(source.prepared).sort(),['area','kind','tick']);assert.equal(JSON.stringify(source.prepared).includes('private-character'),false);
 const other={...source,selfRef:f.actors[1].ref,...projectObservationExtras(source.snapshot,f.actors[1].p.state.character,source.visibleIds)};
 assert.equal(apply(new GameplayReceiver(binding,catalog),createGameplayProtocol(catalog).encodeObservation(source)).state.self.player.coins,0);
 assert.equal(apply(new GameplayReceiver(binding,catalog),createGameplayProtocol(catalog).encodeObservation(other)).state.self.player.coins,321);
 assert.throws(()=>createGameplayProtocol(catalog).encodeObservation({...source,prepared:{...source.prepared}}),/prepared/);
 assert.throws(()=>createGameplayProtocol(catalog).encodeObservation({...source,snapshot:f.area.snapshot()}),/prepared/);
 assert.throws(()=>prepareObservationSnapshot(Object.freeze(structuredClone(source.snapshot)),source.appearances,catalog),/deeply frozen/);
 const bad=Object.freeze({...source.snapshot,get players(){return source.snapshot.players;}});assert.throws(()=>prepareObservationSnapshot(bad,source.appearances,catalog),/accessor/);
});
test('measure actual 100-viewer publication batch with and without owned shared preparation',t=>{
 const f=fixture(100),raw=Array.from({length:100},()=>createGameplayProtocol(catalog)),prepared=Array.from({length:100},()=>createGameplayProtocol(catalog));
 const inputFor=(common,i)=>({...common,selfRef:f.actors[i].ref,...projectObservationExtras(common.snapshot,f.actors[i].p.state.character,common.visibleIds)});
 const base=observation(f),first=prepareObservationSnapshot(base.snapshot,base.appearances,catalog);
 for(let i=0;i<100;i++){raw[i].encodeObservation(inputFor(base,i));prepared[i].encodeObservation({...inputFor(base,i),prepared:first});}
 let rawMs=0,preparedMs=0,preparationMs=0,rawBytes=0,preparedBytes=0;
 for(let tick=1;tick<=3;tick++){
  f.area.step(new Map(f.actors.map(a=>[a.u.ref.id,intent(tick,[],{forward:1,steeringYaw:Math.PI/2})])));f.area.drainEvents();const common=observation(f,tick+1);
  let started=performance.now();for(let i=0;i<100;i++)rawBytes+=raw[i].encodeObservation(inputFor(common,i)).reduce((n,b)=>n+b.length,0);rawMs+=performance.now()-started;
  started=performance.now();const token=prepareObservationSnapshot(common.snapshot,common.appearances,catalog);preparationMs+=performance.now()-started;
  started=performance.now();for(let i=0;i<100;i++)preparedBytes+=prepared[i].encodeObservation({...inputFor(common,i),prepared:token}).reduce((n,b)=>n+b.length,0);preparedMs+=performance.now()-started;
 }
 assert.equal(rawBytes,preparedBytes);t.diagnostic(JSON.stringify({measurement:'100-viewer-batch-3-moving-publications',viewers:100,actors:f.area.snapshot().units.length,rawMsPerBatch:rawMs/3,prepareMsPerBatch:preparationMs/3,preparedEncodeMsPerBatch:preparedMs/3,totalPreparedMsPerBatch:(preparationMs+preparedMs)/3,bytesPerBatch:preparedBytes/3}));
});
test('actual private boss frame, phase and freed recovery survive drained events and respect AOI',async()=>{
 const {createEncounterDefinition}=await import('../../../src/sim/areas/variants.ts');const {createWorld1Definition}=await import('../../../src/sim/areas/world1.ts');const {flatWorld}=await import('../../../tests/core/worldHarness.mjs');
 const definition=createEncounterDefinition(createWorld1Definition({query:flatWorld,fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:0,scavenger:0,jellyfish:0}}),'rust');
 const area=worldArea(binding.area,'w1',{definition,context:{mode:'party-encounter',members:[],pvp:'disabled'}});area.bootstrapEncounter('rust',{beaconLit:true});const ref=area.attachFresh('hero','mage','human','encounter:entry'),actor={ref,p:area.services.player(ref),u:area.services.getUnit(ref)},boss=area.services.bossByProfile('rust');actor.p.gainXp(900);boss.wake();for(let i=0;i<75;i++)area.step(new Map());area.drainEvents();
 const f={area,actors:[actor],codec:createGameplayProtocol(catalog),receiver:new GameplayReceiver(binding,catalog)},live=apply(f.receiver,f.codec.encodeObservation(observation(f))).state;
 const observed=live.recovery.bosses[0];assert.equal(observed.profile,'rust');assert.equal(observed.state,'fight');assert.equal(observed.showFrame,true);assert.deepEqual(observed,area.snapshot().recovery.bosses[0]);
 area.services.combat.damage(actor.ref,boss.unit,Math.round(boss.actor.maxHp*.8),{noReact:true});area.step(new Map());area.drainEvents();const phase=apply(f.receiver,f.codec.encodeObservation(observation(f,2))).state.recovery.bosses[0];assert.equal(phase.phase,3);assert.equal(phase.enraged,true);
 boss.reset();area.drainEvents();const reset=apply(f.receiver,f.codec.encodeObservation(observation(f,3))).state.recovery.bosses[0];assert.equal(reset.showFrame,false);
 const hidden=projectObservationExtras(area.snapshot(),actor.p.state.character,new Set([actor.ref.id]));assert.deepEqual(hidden.recovery.bosses,[]);
});

test('a newer full recovery replaces an incomplete older fragment group atomically',()=>{
 const f=fixture(40),initial=f.codec.encodeObservation(observation(f));assert.ok(initial.length>1);assert.equal(f.receiver.accept(initial[0],0),null);
 const recovery=f.codec.encodeObservation(observation(f,2,true));let result;for(const p of recovery)result=f.receiver.accept(p,.1);assert.equal(result.kind,'snapshot');assert.equal(result.state.sequence,2);assert.equal(f.receiver.needsResync,false);assert.equal(f.receiver.retainedBytes,0);
});
test('resync controls are monotonic and one outstanding request never advances input ACK',()=>{
 const f=fixture(),request=(seq)=>f.codec.encodeControl(header(seq),{type:'resync',lastSequence:0,reason:'fragment'})[0];
 const first=f.codec.decodeClientMessage(request(1),binding);assert.equal(first.sequence,1);assert.throws(()=>f.codec.decodeClientMessage(request(1),binding),/recovery/);assert.throws(()=>f.codec.decodeClientMessage(request(2),binding),/recovery/);
 f.codec.encodeObservation(observation(f));assert.throws(()=>f.codec.decodeClientMessage(request(1),binding),/recovery/);assert.equal(f.codec.decodeClientMessage(request(2),binding).kind,'resync');
 const result={inputSequence:1,commandIndex:0,status:'durable',code:'saved',revision:1};assert.throws(()=>encodeEvents(header(2),{baselineSequence:1,events:[],results:[result]},catalog),/consumption/);
});

test('measure mixed 100-player inputs on actual baked public World I with 80/88m AOI',async t=>{
 const {loadBakedWorld}=await import('../../../src/sim/world/baked.ts');const {createWorld1Definition}=await import('../../../src/sim/areas/world1.ts');const {createPublicDefinition,personalNpcVisible}=await import('../../../src/sim/areas/variants.ts');
 const query=loadBakedWorld(JSON.parse(readFileSync(new URL('../../../public/world/collision-w1.json',import.meta.url),'utf8')));
 const definition=createPublicDefinition(createWorld1Definition({query,fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:1,scavenger:0,jellyfish:0}}));
 const f=fixture(100,{query,definition});let previous=new Set(),sequence=1,total=0,frames=0,baseline=0,maxVisible=0;
 const publish=()=>{const o=observation(f,sequence++),self=f.actors[0].u;const visible=new Set(o.snapshot.units.filter(u=>u.ref.id===self.ref.id||!u.hidden&&(!u.npcId||personalNpcVisible(definition,u.npcId,f.actors[0].p.state.flags))&&Math.hypot(u.x-self.x,u.z-self.z)<=(previous.has(u.ref.id)?88:80)).map(u=>u.ref.id));previous=visible;maxVisible=Math.max(maxVisible,visible.size);o.visibleIds=visible;Object.assign(o,projectObservationExtras(o.snapshot,f.actors[0].p.state.character,visible));o.prepared=prepareObservationSnapshot(o.snapshot,o.appearances,catalog);return f.codec.encodeObservation(o).reduce((n,b)=>n+b.length,0);};
 baseline=publish();
 for(let tick=1;tick<=30;tick++){
  f.area.step(new Map(f.actors.map((a,i)=>{const angle=i*.17+tick*.003*(i%9+1);return[a.u.ref.id,intent(tick,[],{forward:Math.sin(i*.63+tick*.02),strafe:Math.cos(i*.63),sprint:i%4===0,steeringYaw:Math.atan2(Math.sin(angle),Math.cos(angle))})];})));f.area.drainEvents();
  if(Math.floor(tick*2/3)!==Math.floor((tick-1)*2/3)){total+=publish();frames++;}
 }
 assert.equal(frames,20);assert.equal(definition.bosses.length,0);assert.ok(maxVisible>=100);
 t.diagnostic(JSON.stringify({measurement:'actual-baked-public-w1-mixed-inputs-AOI80-88',actualPlayers:100,totalActors:f.area.snapshot().units.length,maxVisibleActors:maxVisible,populationPolicy:'test-one-scrapling',baselineBytes:baseline,movingBytesPerClientSecond:total,meanDeltaBytes:total/20,estimated100ViewersBytesPerSecond:total*100}));
});
test('shared codec browser graph contains no Area, player controller, DOM or Node adapter runtime',async()=>{
 const {build}=await import('esbuild');const result=await build({entryPoints:[new URL('./protocol.ts',import.meta.url).pathname],bundle:true,platform:'browser',format:'esm',write:false,metafile:true,logLevel:'silent'});
 const paths=Object.keys(result.metafile.inputs);assert.equal(paths.some(p=>/src\/game\/|src\/sim\/(area|player|combat|boss|enemy)\.ts$|server\/node\//.test(p)),false);
 assert.ok(paths.some(p=>p.endsWith('src/sim/renderPose.ts')));assert.ok(result.outputFiles[0].contents.length>0);
});

test('public and private PvP presentation uses explicit authority context rather than area names',()=>{
 const f=fixture(),publicState=apply(f.receiver,f.codec.encodeObservation(observation(f))).state;assert.equal(publicState.features.environment.mode,'public');assert.equal(publicState.features.environment.pvp,'disabled');
 f.area.applyContext({...f.area.services.context,mode:'party-encounter',pvp:'party-only'});const privateState=apply(f.receiver,f.codec.encodeObservation(observation(f,2))).state;assert.equal(privateState.header.area,'wire-area');assert.equal(privateState.features.environment.mode,'party-encounter');assert.equal(privateState.features.environment.pvp,'party-only');
 const missing=observation(f,3);delete missing.features.environment.mode;assert.throws(()=>f.codec.encodeObservation(missing),/missing mode/);
});

test('typed full-life talk reaches actual resident bark and rejects null or forged account targets',()=>{
 const f=fixture(),hero=f.actors[0],resident=[...f.area.units.values()].find(u=>u.kind==='townsfolk');Object.assign(hero.u,{x:resident.x,y:resident.y,z:resident.z+2});
 const frame=input(1,[{kind:'talk',target:resident.ref}]),session=new InputSession(binding,catalog);session.accept(encodeInput({binding,intent:frame},catalog),0);const prepared=session.prepareTick(0);const result=f.area.step(new Map([[hero.ref.id,prepared.intent]]));session.commitConsumed(prepared.token);assert.equal(result[0].success,true);
 const events=f.area.drainEvents();assert.ok(events.some(e=>e.event.type==='feature'&&e.event.event.type==='npcBark'));
 assert.throws(()=>encodeInput({binding,intent:input(2,[{kind:'talk',target:null}])},catalog));assert.throws(()=>encodeInput({binding,intent:input(2,[{kind:'talk',target:{...resident.ref,accountId:'forged'}}])},catalog),/unknown/);
});
test('chat commands preserve server-filter input while disallowing client account and delivery claims',()=>{
 const target={area:'other-party-world',id:42,life:3};const commands=[{kind:'chatSay',channel:'area',text:'x'.repeat(300)},{kind:'chatPreferences'},{kind:'chatPreferences',enabled:true,partyOnly:true},{kind:'chatBlock',target,blocked:true},{kind:'chatMute',target,muted:false},{kind:'chatReport',target,reason:'harassment'}];
 for(const command of commands){const frame=input(1,[command]);assert.deepEqual(decodeInput(encodeInput({binding,intent:frame},catalog),binding,catalog),frame);assert.throws(()=>encodeInput({binding,intent:input(1,[command,{kind:'jump'}])},catalog),/cannot mix/);}
 for(const command of [{kind:'chatSay',channel:'area',text:'hello',accountId:'forged'},{kind:'chatReport',target,reason:'forged'},{kind:'chatBlock',target:{...target,life:0},blocked:true},{kind:'chatMute',target,muted:true,ok:true}])assert.throws(()=>encodeInput({binding,intent:input(1,[command])},catalog));
});
test('account-free chat controls carry only filtered lines, preferences and explicit moderation outcomes',async()=>{
 const {filterText}=await import('../../chat/filter.ts');const f=fixture();apply(f.receiver,f.codec.encodeObservation(observation(f)));const sender={area:'party-other',id:7,life:2};
 const line={sender,name:'Crab',text:filterText('hello '+ 'x'.repeat(300)).text,at:1800000000000};assert.equal([...line.text].length,200);
 const controls=[{type:'chatLine',channel:'party',line},{type:'chatPreferences',enabled:true,partyOnly:false},{type:'chatResult',inputSequence:1,operation:'block',ok:true,target:sender,blocked:true},{type:'chatResult',inputSequence:2,operation:'report',ok:false,error:'target'}];
 controls.forEach((control,i)=>assert.deepEqual(apply(f.receiver,f.codec.encodeControl(header(i+2),control)).control,control));
 assert.throws(()=>f.codec.encodeControl(header(7),{type:'chatLine',channel:'party',line:{...line,accountId:'private'}}),/unknown/);assert.throws(()=>f.codec.encodeControl(header(7),{type:'chatResult',inputSequence:1,operation:'mute',ok:true,target:sender}),/missing state/);
 assert.throws(()=>f.codec.decodeClientMessage(f.codec.encodeControl(header(1),{type:'chatLine',channel:'party',line})[0],binding),/client cannot/);
});

test('report acknowledgments never expose internal global moderation decisions',()=>{
 const f=fixture(),target={area:binding.area,id:22,life:1},ack={type:'chatResult',inputSequence:1,operation:'report',ok:true,target};
 assert.doesNotThrow(()=>f.codec.encodeControl(header(1),ack));for(const muted of [true,false])assert.throws(()=>f.codec.encodeControl(header(1),{...ack,muted}),/moderation/);
});

test('shared public prefix preserves private event budgets and only advances successful recipient baselines',()=>{
 const f=fixture(2),a=createGameplayProtocol(catalog),b=createGameplayProtocol(catalog),first=observation(f),prepared=prepareObservationSnapshot(first.snapshot,first.appearances,catalog),receiverA=new GameplayReceiver(binding,catalog),receiverB=new GameplayReceiver(binding,catalog);
 apply(receiverA,a.encodeObservation({...first,prepared}));apply(receiverB,b.encodeObservation({...first,prepared,selfRef:f.actors[1].ref,...projectObservationExtras(first.snapshot,f.actors[1].p.state.character,first.visibleIds)}));
 const source={...first,sequence:2},events=Array.from({length:513},(_,order)=>({tick:source.tick,order,event:{type:'xp',unit:f.actors[0].ref,amount:1}}));assert.throws(()=>a.encodeObservation({...source,prepared,events,eventWatermark:512}),/list/);
 const other={...source,prepared,selfRef:f.actors[1].ref,...projectObservationExtras(source.snapshot,f.actors[1].p.state.character,source.visibleIds),events,eventWatermark:512},chunks=b.encodeObservation(other),preserved=chunks.map(c=>c.slice()),received=apply(receiverB,chunks);assert.deepEqual(received.events,[]);assert.equal(received.state.selfRef.id,f.actors[1].ref.id);
 const retry=a.encodeObservation({...source,prepared,events:events.slice(0,1),eventWatermark:512}),self=apply(receiverA,retry);assert.equal(self.state.sequence,2);assert.equal(self.events.length,1);assert.equal(self.events[0].event.unit.id,f.actors[0].ref.id);assert.deepEqual(chunks,preserved);
});
test('resetting one recipient cannot mutate another recipient shared public baseline or already returned packets',()=>{
 const f=fixture(2),a=createGameplayProtocol(catalog),b=createGameplayProtocol(catalog),source=observation(f),prepared=prepareObservationSnapshot(source.snapshot,source.appearances,catalog),receiver=new GameplayReceiver(binding,catalog),initial=b.encodeObservation({...source,prepared}),saved=initial.map(c=>c.slice());apply(receiver,initial);a.encodeObservation({...source,prepared});const rebound={...binding,epoch:2};a.reset(rebound);a.encodeObservation({...source,prepared,binding:rebound,full:true});const update=b.encodeObservation({...source,prepared,sequence:2});const state=apply(receiver,update).state;assert.deepEqual(state.actors,source.snapshot.units.map(u=>projectActor(u,source.appearances[`${u.ref.id}:${u.ref.life}`]??null)));assert.deepEqual(initial,saved);
});

test('revoked input is strictly decoded without apply/ACK and one rate budget survives resets and mixed epochs',()=>{
 const budget=new InputRateBudget(0),prior=new InputSession(binding,catalog,{now:0,budget});prior.accept(encodeInput({binding,intent:input(1,[{kind:'ability',slot:1}])},catalog),0);const prepared=prior.prepareTick(0);assert.ok(prepared);prior.revoke();assert.equal(prior.pendingCount,0);assert.equal(prior.prepareTick(0),null);assert.throws(()=>prior.commitConsumed(prepared.token));assert.throws(()=>prior.accept(encodeInput({binding,intent:input(2)},catalog),0),/revoked/);
 prior.discardRevoked(encodeInput({binding,intent:input(2,[{kind:'jump'}])},catalog),0);assert.equal(prior.acceptedInput,2);assert.equal(prior.consumedInput,0);assert.equal(prior.pendingCount,0);assert.equal(prior.heldState(0).forward,0);assert.throws(()=>prior.discardRevoked(encodeInput({binding:{...binding,area:'forged'},intent:input(3)},catalog),0),/binding/);assert.throws(()=>prior.discardRevoked(encodeInput({binding,intent:input(2)},catalog),0),/stale/);
 const next={...binding,epoch:2},current=new InputSession(next,catalog,{now:0,budget});for(let i=1;i<=118;i++)current.accept(encodeInput({binding:next,intent:input(i)},catalog),0);current.reset({...next,epoch:3},0);assert.throws(()=>current.accept(encodeInput({binding:{...next,epoch:3},intent:input(1)},catalog),0),/rate/);assert.throws(()=>prior.discardRevoked(encodeInput({binding,intent:input(3)},catalog),0),/rate/);assert.equal(prior.acceptedInput,2);assert.equal(current.acceptedInput,0);current.accept(encodeInput({binding:{...next,epoch:3},intent:input(1)},catalog),1/60);assert.equal(current.acceptedInput,1);

});


test('publication release invalidates only its prepared token without losing committed connection baselines',()=>{
 const f=fixture(2),source=observation(f),prepared=prepareObservationSnapshot(source.snapshot,source.appearances,catalog);const first=f.codec.encodeObservation({...source,prepared});apply(f.receiver,first);releasePreparedObservation(prepared);releasePreparedObservation(prepared);assert.throws(()=>f.codec.encodeObservation({...source,prepared,sequence:2}),/prepared/);const next=prepareObservationSnapshot(source.snapshot,source.appearances,catalog),chunks=f.codec.encodeObservation({...source,prepared:next,sequence:2});assert.equal(apply(f.receiver,chunks).state.sequence,2);releasePreparedObservation(next);
});
