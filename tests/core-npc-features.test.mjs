import test from 'node:test';
import assert from 'node:assert/strict';
import {NumericNpc,NumericTownsfolk} from '../src/sim/features/npc.ts';
import {NumericVillageGames} from '../src/sim/features/village.ts';
import {createUnit} from '../src/sim/unit.ts';
import {Actions} from '../src/sim/actions.ts';
import {actionRequest,realActionData} from '../src/sim/data/actions.ts';
import {Random} from '../src/sim/random.ts';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
function fixture(seed=1){
 const players=[],events=[],actionEvents=[],owned=new Set(),rng=new Random(seed),actions=new Actions(realActionData,e=>actionEvents.push(e),()=>{});
 const query={heightAt:()=>0,resolveCollision:(x,z,r,o)=>o.set(x,z),raycastSolid:()=>null};
 const context={time:0,rng,query,authority:true,endingActive:false,players:()=>players,externallyOwned:r=>owned.has(r.id),hasAction:u=>!!actions.effective(u),playAction:(u,id)=>actions.play(u,actionRequest(realActionData,id)),emit:e=>events.push(structuredClone(e))};
 const unit=createUnit({area:'ambient',id:10,life:1},'npc:brinebeard','npc','friendly',realActionData);
 const resident=createUnit({area:'ambient',id:20,life:1},'townsfolk:0','townsfolk','friendly',realActionData);
 const player=(id,x,z=0)=>{const p=createUnit({area:'ambient',id,life:1},'human','player','player',realActionData,{x,y:0,z});players.push(p);return p;};
 const npc=()=>new NumericNpc(context,unit,{npcId:'brinebeard',homeYaw:-1});
 const folk=(options={})=>new NumericTownsfolk(context,resident,{points:[{x:10,y:0,z:0}],wanderRadius:0,...options});
 return {context,unit,resident,player,players,events,actionEvents,actions,owned,npc,folk};
}
test('named NPC exact 9m look and 7m greeting thresholds use numeric yaw and shipped action',()=>{
 const f=fixture(),p=f.player(1,9),n=f.npc();f.context.time=1;n.step(.1);near(f.unit.yaw,-.26);assert.equal(f.events.length,0);
 p.x=8.999;f.unit.yaw=0;n.step(.1);near(f.unit.yaw,.26);assert.equal(f.events.length,0);
 p.x=7;n.step(.1);assert.equal(f.events.length,0);p.x=6.999;n.step(.1);
 assert.equal(f.actions.effective(f.unit).id,'gesture_hello');assert.deepEqual(f.events,[{type:'npcGreeting',unit:f.unit.ref,player:p.ref,expression:'happy',seconds:1.5}]);
 near(n.debug().helloCd,41);assert.equal(f.unit.pose.previousYaw,f.unit.yaw);
});
test('greeting cooldown is 40 seconds but leaving beyond 12m rearms in 3 seconds',()=>{
 const f=fixture(),p=f.player(1,3),n=f.npc();f.context.time=1;n.step(.1);f.actions.stop(f.unit);f.context.time=2;n.step(.1);assert.equal(f.events.length,1);
 p.x=12;n.step(.1);assert.equal(n.debug().helloCd,41);p.x=12.001;n.step(.1);assert.equal(n.debug().helloCd,5);
 p.x=3;f.context.time=5;n.step(.1);assert.equal(f.events.length,1);f.context.time=5.001;n.step(.1);assert.equal(f.events.length,2);
});
test('NPC selects nearest alive visible same-Area player and stable ID on equal distances',()=>{
 const f=fixture();f.player(5,6);const selected=f.player(1,-6);f.player(7,1).alive=false;f.player(8,2).hidden=true;f.player(9,0).ref={area:'other',id:9,life:1};
 const n=f.npc();f.context.time=1;n.step(.1);near(f.unit.yaw,-.26);assert.deepEqual(f.events[0].player,selected.ref);
});
test('idle gesture uses source 6..16 then 14..26 timers and each named NPC gesture catalog',()=>{
 const gestures={brinebeard:['gesture_salute','gesture_paw'],silvermoon:['gesture_bow','gesture_paw'],coralline:['gesture_bow','gesture_paw'],grukk:['claw_left','claw_right'],hoofclaw:['gesture_paw','gesture_hello'],rattlebolt:['gesture_paw','claw_left'],pip:['claw_right','gesture_salute']};
 for(const [npcId,allowed]of Object.entries(gestures)){
  const f=fixture(),n=new NumericNpc(f.context,f.unit,{npcId,homeYaw:0});near(n.debug().gestureAt,12.270739405881613);
  f.context.time=n.debug().gestureAt;n.step(.1);assert.equal(f.actions.effective(f.unit),null);
  f.context.time+=.001;n.step(.1);assert.equal(f.actions.effective(f.unit).id,allowed[1]);near(n.debug().gestureAt,f.context.time+14.032828654162586);
 }
});
test('conversation owns look direction without idle gestures and rejects stale speaker lives',()=>{
 const f=fixture(),p=f.player(1,6),n=f.npc();assert.equal(n.setConversation({...p.ref,life:2}),false);
 assert.equal(n.setConversation(p.ref,{x:-4,y:0,z:0}),true);f.context.time=100;n.step(.1);near(f.unit.yaw,-.26);assert.equal(f.events.length,0);assert.equal(f.actions.effective(f.unit),null);
 const copy=n.debug();copy.lookAt.x=100;assert.equal(n.debug().lookAt.x,-4);
 p.ref={...p.ref,life:2};n.step(.1);assert.equal(n.talking,false);assert.equal(f.events.length,1);
 assert.equal(n.setConversation(p.ref,{x:NaN,y:0,z:0}),false);assert.equal(n.setConversation(null),true);
});
test('ambient ownership guards do not mutate pose or consume RNG during village, boss or ending control',()=>{
 const f=fixture(),n=f.npc(),t=f.folk();f.player(1,1);f.context.time=50;
 const before=()=>({u:structuredClone(f.unit),r:structuredClone(f.resident),n:n.debug(),t:t.debug(),rng:f.context.rng.state()});
 for(const mode of ['external','ending','follower','hidden','dead','life']){
  if(mode==='external'){f.owned.add(10);f.owned.add(20);}if(mode==='ending')f.context.endingActive=true;if(mode==='follower')f.context.authority=false;
  if(mode==='hidden')f.unit.hidden=f.resident.hidden=true;if(mode==='dead')f.unit.alive=f.resident.alive=false;
  if(mode==='life'){f.unit.ref={...f.unit.ref,life:2};f.resident.ref={...f.resident.ref,life:2};}
  const expected=before();n.step(.1);t.step(.1);assert.deepEqual(before(),expected,mode);
  f.owned.clear();f.context.endingActive=false;f.context.authority=true;f.unit.hidden=f.resident.hidden=false;f.unit.alive=f.resident.alive=true;
 }
});
test('townsfolk initial pause and first sideways walk preserve seeded draw order and numeric acceleration',()=>{
 const f=fixture(),t=f.folk();near(t.debug().speed,1.801659152470529);near(t.debug().pauseUntil,.010942884720861912);
 f.context.time=t.debug().pauseUntil;t.step(.1);assert.equal(t.debug().walking,false);
 f.context.time=1;t.step(.1);const state=t.debug();assert.equal(state.walking,true);assert.equal(state.sideways,true);near(state.speed,1.7902710884809494);assert.deepEqual(state.dest,{x:10,y:0,z:0});
 near(f.resident.x,(1-Math.exp(-.6))*1.7902710884809494*.1);near(f.resident.z,0);near(f.resident.yaw,.3);assert.ok(f.resident.pose.localVx>0);
});
test('resident arrival within .5m chooses a 3..9s pause and stops pursuing',()=>{
 const f=fixture(),t=f.folk({points:[{x:.49,y:0,z:0}]});f.context.time=1;t.step(.1);
 assert.equal(t.debug().walking,false);near(t.debug().pauseUntil,1+3+.7207431411370635*6);assert.equal(f.resident.x,0);assert.equal(f.actions.effective(f.resident),null);
 const exact=fixture(),e=exact.folk({points:[{x:.5,y:0,z:0}]});exact.context.time=1;e.step(.1);assert.equal(e.debug().walking,true);
});
test('sustained collision stalls for over .5 seconds then schedules .5..2s retry',()=>{
 const f=fixture(),t=f.folk();f.context.query.resolveCollision=(_x,_z,_r,o)=>o.set(0,0);
 for(let i=0;i<5;i++){f.context.time=1+i*.1;t.step(.1);}near(t.debug().stuckFor,.5);assert.equal(t.debug().walking,true);
 f.context.time=1.5;t.step(.1);assert.equal(t.debug().walking,false);near(t.debug().pauseUntil,1.5+.5+.7207431411370635*1.5);near(f.resident.x,0);
});
test('resident avoidance uses nearest player, exact .01 minimum and radius+.4 boundary',()=>{
 const f=fixture(),t=f.folk();f.context.time=0;const p=f.player(1,-1);t.step(.1);near(f.resident.x,(1-Math.exp(-.6))*1.801659152470529*1.5*.1);
 const g=fixture(),s=g.folk();g.player(1,.01);s.step(.1);assert.equal(g.resident.x,0);
 const h=fixture(),r=h.folk(),other=h.player(1,0);other.x=h.resident.radius+other.radius+.4;r.step(.1);assert.equal(h.resident.x,0);
 assert.equal(p.alive,true);
});
test('World II-style navigation adjusts destination radius and follows obstacle detour',()=>{
 const f=fixture();f.resident.x=-6;f.resident.pose.previousX=-6;
 const radii=[];f.context.query.resolveCollision=(x,z,r,o)=>{radii.push(r);return o.set(Math.abs(x)<1&&Math.abs(z)<4?2:x,z);};
 const t=f.folk({points:[{x:6,y:0,z:0}],route:{points:[{x:-3,y:0,z:6},{x:3,y:0,z:6}],radiusPadding:.15,step:.5},relocated:true});
 assert.equal(t.debug().pauseUntil,1);f.context.time=1;t.step(.1);assert.equal(t.debug().walking,false);
 f.context.time=1.01;t.step(.1);assert.equal(t.debug().route.step,.5);near(t.debug().route.radius,f.resident.radius+.15);assert.ok(f.resident.z>0);assert.ok(f.resident.x>-6);assert.ok(radii.includes(f.resident.radius+.15));
});
test('relocate resets motion cursor and frozen state, preserving speed and bark cooldown',()=>{
 const f=fixture(),t=f.folk();const p=f.player(1,1);t.bark(p.ref,'shore');f.players.length=0;f.context.time=5;t.step(.1);t.frozen=true;const speed=t.debug().speed;
 t.relocate({points:[{x:4,y:0,z:8}],wanderRadius:1.5});const state=t.debug();assert.equal(state.walking,false);assert.equal(state.frozen,false);assert.equal(state.velX,0);assert.equal(state.velZ,0);assert.equal(state.stuckFor,0);assert.equal(state.pauseUntil,6);assert.equal(state.barkCd,4);assert.equal(state.speed,speed);
});
test('resident bark faces speaker, pauses four seconds and emits seeded personal-bank value keys',()=>{
 const f=fixture(),t=f.folk(),p=f.player(1,-3);assert.equal(t.bark(p.ref,'shore'),true);near(f.resident.yaw,-Math.PI/2);assert.equal(t.debug().pauseUntil,4);assert.equal(f.actions.effective(f.resident).id,'gesture_hello');
 assert.deepEqual(f.events[0],{type:'npcBark',unit:f.resident.ref,player:p.ref,bank:'shore',index:5});assert.equal(t.bark(p.ref,'star'),false);
 f.context.time=4;assert.equal(t.bark(p.ref,'star'),true);assert.equal(f.events[1].index,5);assert.equal(f.events[1].bank,'star');
 f.context.time=8;assert.equal(t.bark({...p.ref,life:2},'starVictory'),false);assert.equal(t.bark(p.ref,'starVictory'),true);assert.equal(f.events[2].index,3);
 f.owned.add(f.resident.ref.id);f.context.time=12;assert.equal(t.bark(p.ref,'shore'),false);
});
test('village seeker owns real resident motion exclusively and ambient resumes after round',()=>{
 const f=fixture(),p=f.player(1,30),folk=f.folk(),actors=[{id:'a',unit:p}];
 const vg={areaId:'ambient',chapter:1,time:0,authority:true,authorityEpoch:1,rng:f.context.rng,query:f.context.query,encounterEngaged:false,endingActive:false,authorityId:'a',navPoints:[],actors:()=>actors,resolve:id=>id==='a'?p:id==='npc0'?f.resident:null,townsfolk:()=>[{id:'npc0',unit:f.resident}],ownsProgression:()=>true,clearControls:u=>{u.pendingHit=null;f.actions.stop(u);},stopActions:u=>f.actions.stop(u),emit:()=>{}};
 const village=new NumericVillageGames(vg,{boatOccupied:()=>false});f.context.externallyOwned=ref=>village.ownsNpc(ref);assert.equal(village.request(p.ref,'tag'),true);
 p.x=35;p.z=12.5;vg.time=f.context.time=5;const state=folk.debug(),before={x:f.resident.x,z:f.resident.z};folk.step(.1);assert.deepEqual(folk.debug(),state);near(f.resident.x,before.x);near(f.resident.z,before.z);
 village.step(5);near(f.resident.x,24);assert.equal(village.ownsNpc(f.resident.ref),true);const moved=f.resident.x;folk.step(.1);near(f.resident.x,moved);
 village.request(p.ref,'stop');f.context.time=6;folk.step(.1);assert.equal(folk.debug().walking,true);
});
test('independent Areas replay the same seeded ambient trajectories and detached debug state',()=>{
 const run=()=>{const f=fixture(512),n=f.npc(),t=f.folk({points:[{x:3,y:0,z:2},{x:-4,y:0,z:6}],wanderRadius:2});f.player(1,5);for(let i=0;i<600;i++){f.context.time=(i+1)/30;n.step(1/30);t.step(1/30);f.actions.update(f.unit,1/30);f.actions.update(f.resident,1/30);}return {npc:n.debug(),folk:t.debug(),u:f.unit,r:f.resident,events:f.events,rng:f.context.rng.state()};};
 assert.deepEqual(run(),run());const f=fixture(),t=f.folk(),copy=t.debug();copy.dest.x=99;copy.points[0].x=42;assert.equal(t.debug().dest.x,0);assert.equal(t.debug().points[0].x,10);
 assert.throws(()=>f.folk({points:[]}),RangeError);assert.throws(()=>t.step(NaN),RangeError);
});
test('all eight real resident rigs walk and replay across all four baked world queries',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {loadBakedWorld}=await import('../src/sim/world/baked.ts');
 const {createTownsfolk,TOWNSFOLK_SPECS}=await import('../src/sim/data/townsfolk.ts');
 const {advanceNumericPose}=await import('../src/sim/pose.ts');
 const {teleport}=await import('../src/sim/unit.ts');
 const summaries=[];
 for(const world of ['w1','w2','w3','w4']){
  const query=loadBakedWorld(JSON.parse(await readFile(new URL(`../public/world/collision-${world}.json`,import.meta.url),'utf8')));
  const definitions=createTownsfolk(world,query);assert.equal(definitions.length,8);
  const run=()=>{
   const f=fixture(1337);f.context.query=query;
   const residents=definitions.map((d,i)=>{
    const u=createUnit({area:`ambient-${world}`,id:i+100,life:1},d.archetype,'townsfolk','friendly',realActionData,d.position);
    teleport(u,query,d.position.x,d.position.z,d.yaw??0);
    const start={x:u.x,z:u.z},controller=new NumericTownsfolk(f.context,u,{...d,relocated:world!=='w1'});
    assert.equal(u.archetype,`townsfolk:${i}`);assert.ok(u.radius>0&&u.height>0);
    return {u,controller,start,distance:0};
   });
   for(let i=0;i<300;i++){
    f.context.time=(i+1)/30;
    for(const r of residents){const x=r.u.x,z=r.u.z;r.controller.step(1/30);r.distance+=Math.hypot(r.u.x-x,r.u.z-z);f.actions.update(r.u,1/30);advanceNumericPose(r.u,1/30);}
   }
   return {rng:f.context.rng.state(),residents:residents.map(r=>({unit:r.u,state:r.controller.debug(),distance:r.distance,start:r.start}))};
  };
  const first=run();assert.deepEqual(first,run(),`${world} deterministic actual geometry`);
  for(const [i,r]of first.residents.entries()){
   assert.ok(r.distance>.01,`${world} resident ${i} actual movement`);
   assert.ok([r.unit.x,r.unit.y,r.unit.z,r.unit.yaw,...r.unit.pose.appliedQ,...r.unit.pose.appliedPosition].every(Number.isFinite));
   assert.equal(r.unit.pose.appliedQ.length,22);assert.equal(r.state.route!==null,world==='w2');
  }
  summaries.push({world,races:TOWNSFOLK_SPECS.map(s=>s.race),moving:first.residents.length});
 }
 assert.deepEqual(summaries.map(s=>s.moving),[8,8,8,8]);
 assert.deepEqual(summaries[0].races,['human','orc','dwarf','undead','nightelf','tauren','nightelf','undead']);
});
