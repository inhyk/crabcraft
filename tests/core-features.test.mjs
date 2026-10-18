import test from 'node:test';
import assert from 'node:assert/strict';
import {NumericBoat} from '../src/sim/features/boat.ts';
import {NumericVillageGames} from '../src/sim/features/village.ts';
import {FeatureNavigation} from '../src/sim/features/nav.ts';
import {createUnit} from '../src/sim/unit.ts';
import {Actions} from '../src/sim/actions.ts';
import {Random} from '../src/sim/random.ts';
import {realActionData} from '../src/sim/data/actions.ts';
import {worldArea,addActor} from './core/worldHarness.mjs';
const command=(action,throttle=0,steer=0)=>({action,throttle,steer});
const near=(actual,expected,epsilon=1e-10)=>assert.ok(Math.abs(actual-expected)<epsilon,`${actual} != ${expected}`);
function fixture(count=2){
 const humans=new Map(),npcs=new Map(),events=[],actions=new Actions(realActionData,()=>{},()=>{});
 const query={heightAt:x=>x<146?.85:-2,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
 const context={areaId:'feature-area',chapter:1,time:1,authority:true,authorityEpoch:1,rng:new Random(37),query,encounterEngaged:false,endingActive:false,authorityId:'a',navPoints:[],
  actors:()=>[...humans].map(([id,unit])=>({id,unit})),resolve:id=>humans.get(id)??npcs.get(id)??null,townsfolk:()=>[...npcs].map(([id,unit])=>({id,unit})),
  clearControls:u=>{u.pendingHit=null;u.pushTime=0;actions.stop(u,undefined,0);},stopActions:u=>actions.stop(u,undefined,0),emit:e=>events.push(structuredClone(e))};
 for(let i=0;i<count;i++)humans.set(String.fromCharCode(97+i),createUnit({area:context.areaId,id:i+1,life:1},'human','player','player',realActionData,{x:143,y:.85,z:19}));
 const npc=createUnit({area:context.areaId,id:99,life:1},'human','townsfolk','friendly',realActionData,{x:10,y:.85,z:10});npcs.set('npc0',npc);
 let village;const boat=new NumericBoat(context,{villagePlaying:()=>village.playing});village=new NumericVillageGames(context,{boatOccupied:()=>boat.snapshot().seats.some(Boolean)});
 const step=(dt=1/30)=>{context.time+=dt;village.step(dt);boat.step(dt);};
 const ref=id=>humans.get(id).ref;
 const bindings=()=>Object.fromEntries([...humans,...npcs].map(([id,u])=>[id,{...u.ref}]));
 const observeBoat=boat.applyObservation.bind(boat),observeVillage=village.applyObservation.bind(village);
 boat.applyObservation=o=>observeBoat({bindings:bindings(),...o});village.applyObservation=o=>observeVillage({bindings:bindings(),...o});
 const seedBoat=state=>{context.authority=false;assert.equal(boat.applyObservation({area:context.areaId,epoch:context.authorityEpoch,sequence:0,state:{...boat.snapshot(),...state}}),true);context.authority=true;context.authorityEpoch++;};
 return {context,humans,npcs,npc,events,boat,village,actions,step,ref,seedBoat};
}
test('two-seat reservations validate life, distance, death, encounter and boat/village exclusion',()=>{
 const f=fixture(3),{boat,humans,context,ref}=f;
 assert.equal(boat.request({...ref('a'),life:2},command('board')),false);
 assert.equal(boat.request({...ref('a'),area:'other'},command('board')),false);
 context.encounterEngaged=true;assert.equal(boat.request(ref('a'),command('board')),false);context.encounterEngaged=false;
 assert.equal(boat.request(ref('a'),command('board')),true);assert.equal(boat.request(ref('a'),command('board')),false);
 assert.equal(boat.request(ref('b'),command('board')),true);assert.equal(boat.request(ref('c'),command('board')),false);
 assert.deepEqual(boat.snapshot().seats,['a','b']);assert.equal(f.village.request(ref('a'),'tag'),false);
 boat.request(ref('b'),command('leave'));humans.get('c').x=0;assert.equal(boat.request(ref('c'),command('board')),false);
 humans.get('c').x=143;humans.get('c').alive=false;assert.equal(boat.request(ref('c'),command('board')),false);
});
test('pilot-only steering uses the actual .4s timeout, 6m/s target, 2.5 acceleration and .9 turn',()=>{
 const {boat,context,ref}=fixture();boat.request(ref('a'),command('board'));boat.request(ref('b'),command('board'));
 assert.equal(boat.request(ref('b'),command('drive',1,1)),false);boat.step(.1);near(boat.snapshot().x,151);
 context.time=0;boat.request(ref('a'),command('drive',1,1));boat.step(.1);
 near(boat.snapshot().speed,1.5);near(boat.snapshot().yaw,Math.PI/2+.09);near(boat.snapshot().x,151+Math.sin(Math.PI/2+.09)*.15);
 context.time=.399999;boat.step(.1);near(boat.snapshot().speed,2.625);
 context.time=.4;const yaw=boat.snapshot().yaw;boat.step(.1);near(boat.snapshot().speed,1.96875);near(boat.snapshot().yaw,yaw);
 assert.equal(boat.request(ref('a'),command('drive',NaN)),false);assert.equal(boat.request(ref('a'),command('drive',2)),false);
});
test('hull tests all nine samples and strict water bounds before advancing position',()=>{
 const {boat,context,ref,seedBoat}=fixture(1);boat.request(ref('a'),command('board'));
 const points=[];context.query.heightAt=(x,z)=>{points.push([x,z]);return x>154.9?1:-2;};boat.request(ref('a'),command('drive',1));boat.step(.1);
 assert.equal(boat.snapshot().x,151);assert.equal(boat.snapshot().speed,0);assert.ok(points.some(([x])=>x>154.9));
 context.query.heightAt=()=>-2;seedBoat({x:264.99});boat.request(ref('a'),command('drive',1));boat.step(.1);assert.equal(boat.snapshot().x,264.99);assert.equal(boat.snapshot().speed,0);
});
test('passenger positions use real pose, cancel pending attack and push, and compact pilot on departure',()=>{
 const {boat,humans,actions,ref}=fixture();const u=humans.get('a');
 actions.play(u,{id:'claw_right',part:'move',upper:false,from:0,to:null,loopFrom:null,loop:false,speed:1,fade:.1,carryRoot:false});
 u.pendingHit={left:1,plan:{attack:'warrior-auto',source:u.ref,target:ref('b')}};u.pushTime=1;
 boat.request(ref('a'),command('board'));boat.request(ref('b'),command('board'));boat.step(1/30);
 near(u.x,152.65);near(humans.get('b').x,149.35);near(u.z,18.5);near(u.y,.88+Math.sin(1.8)*.055);
 assert.equal(u.pendingHit,null);assert.equal(u.pushTime,0);assert.equal(actions.effective(u),null);assert.equal(u.pose.localVx,0);
 boat.request(ref('a'),command('leave'));assert.deepEqual(boat.snapshot().seats,['b',null]);assert.equal(boat.snapshot().speed,0);
 assert.equal(boat.request(ref('b'),command('drive',1)),true);
});
test('landing refuses cliffs, walls, water-edge footprints and other people; successful landfall leaves boat',()=>{
 const {boat,context,humans,ref,seedBoat,events}=fixture(2);
 seedBoat({x:200,z:0,yaw:Math.PI/2});context.query.heightAt=x=>x>=205?1:-2;
 Object.assign(humans.get('a'),{x:206,y:1,z:0});Object.assign(humans.get('b'),{x:230,y:1,z:0});
 boat.request(ref('a'),command('board'));const land=boat.landing(humans.get('a').radius);assert.ok(land.x>205);
 boat.request(ref('a'),command('leave'));assert.equal(boat.snapshot().x,200);assert.equal(boat.snapshot().exits.a.shore,true);near(humans.get('a').x,land.x);
 assert.equal(events.filter(e=>e.type==='boatAchievement'&&e.achievement==='landfall').length,1);
 context.query.heightAt=()=>12;assert.equal(boat.landing(),null);context.query.heightAt=()=>1;context.query.resolveCollision=(x,z,r,o)=>o.set(x+1,z);assert.equal(boat.landing(),null);
 context.query.resolveCollision=(x,z,r,o)=>o.set(x,z);humans.get('b').radius=100;Object.assign(humans.get('b'),{x:200,z:0});assert.equal(boat.landing(),null);
});
test('empty offshore departure docks and returns skiff; occupied recall and distant recall reject',()=>{
 const {boat,context,humans,ref,seedBoat}=fixture();boat.request(ref('a'),command('board'));boat.request(ref('b'),command('board'));seedBoat({x:190});
 assert.equal(boat.request(ref('a'),command('call')),false);boat.request(ref('a'),command('leave'));assert.equal(boat.snapshot().x,190);near(humans.get('a').x,143);
 boat.request(ref('b'),command('leave'));assert.equal(boat.snapshot().x,151);assert.equal(boat.snapshot().exits.b.shore,false);
 seedBoat({x:210});humans.get('a').x=200;assert.equal(boat.request(ref('a'),command('call')),false);humans.get('a').x=143;assert.equal(boat.request(ref('a'),command('call')),true);assert.equal(boat.snapshot().x,151);
 context.chapter=2;assert.equal(boat.request(ref('a'),command('board')),false);
});
test('departed or respawned actors lose seats; world travel never teleports the new spawn',()=>{
 const {boat,context,humans,ref}=fixture();boat.request(ref('a'),command('board'));boat.request(ref('b'),command('board'));boat.step(.1);
 humans.get('a').ref={...ref('a'),life:2};boat.step(.1);assert.deepEqual(boat.snapshot().seats,['b',null]);assert.equal(boat.seated(ref('a')),false);
 context.chapter=2;Object.assign(humans.get('b'),{x:0,y:3,z:86});boat.step(.1);assert.deepEqual(boat.snapshot().seats,[null,null]);assert.equal(humans.get('b').z,86);
});
test('follower snapshot is copied, monotonic and epoch-scoped; followers cannot drive or advance boat',()=>{
 const {boat,context,humans,ref}=fixture();context.authority=false;const state={...boat.snapshot(),x:190,speed:4,seats:['a',null]};
 assert.equal(boat.applyObservation({area:'wrong',epoch:1,sequence:1,state}),false);assert.equal(boat.applyObservation({area:context.areaId,epoch:0,sequence:1,state}),false);
 assert.equal(boat.applyObservation({area:context.areaId,epoch:1,sequence:1,state}),true);state.x=999;
 boat.step(10);assert.equal(boat.snapshot().x,190);assert.equal(boat.snapshot().speed,4);near(humans.get('a').x,191.65);
 assert.equal(boat.request(ref('a'),command('drive',1)),false);assert.equal(boat.applyObservation({area:context.areaId,epoch:1,sequence:1,state}),false);
 context.authorityEpoch=2;assert.equal(boat.applyObservation({area:context.areaId,epoch:1,sequence:2,state}),false);
 context.authority=true;boat.step(.1);near(boat.snapshot().speed,3); // stale pilot input does not survive promotion
});
test('actual sailing and crew achievement requests dedupe across steps and voyages',()=>{
 const {boat,context,ref,events,step}=fixture();boat.request(ref('a'),command('board'));boat.request(ref('b'),command('board'));step();
 for(let i=0;i<130;i++){boat.request(ref('a'),command('drive',1));step();}
 const achievements=events.filter(e=>e.type==='boatAchievement');assert.deepEqual(achievements.map(e=>[e.id,e.achievement]),[['a','crew'],['b','crew'],['a','sail'],['b','sail']]);
 assert.equal(new Set(achievements.map(e=>e.key)).size,4);assert.ok(achievements.find(e=>e.achievement==='sail').distance>=10);
 boat.request(ref('a'),command('leave'));boat.request(ref('b'),command('leave'));
 boat.request(ref('a'),command('board'));boat.request(ref('b'),command('board'));step();assert.equal(events.filter(e=>e.type==='boatAchievement'&&e.achievement==='crew').length,2);
 assert.ok(context.time>5);
});
test('village includes living visible humans, uses starter seeker, and locks only ready seeker/caught',()=>{
 const {village,humans,ref,context}=fixture(4);humans.get('c').hidden=true;humans.get('d').alive=false;
 assert.equal(village.request(ref('b'),'hide'),true);const r=village.snapshot();assert.deepEqual(r.members,['a','b']);assert.equal(r.seeker,'b');assert.equal(r.left,15);
 assert.equal(village.locked(ref('a')),false);assert.equal(village.locked(ref('b')),true);
 near(humans.get('a').x,4.5);near(humans.get('b').x,-.5+Math.cos(2.39996)*5);assert.equal(humans.get('b').yaw,Math.PI);
 assert.equal(village.concealMap(humans.get('b'),ref('a')),true);assert.equal(village.concealMap(humans.get('a'),ref('a')),false);
 assert.equal(village.request(ref('c'),'stop'),false);assert.equal(village.request(ref('a'),'stop'),true);assert.equal(village.snapshot().result,'cancelled');assert.equal(village.playing,false);
 context.authority=false;assert.equal(village.request(ref('b'),'tag'),false);
});
test('village start blocks encounter, ending, another round, wrong world and missing solo resident',()=>{
 const {village,context,npcs,ref}=fixture(1);context.encounterEngaged=true;assert.equal(village.request(ref('a'),'tag'),false);context.encounterEngaged=false;
 context.endingActive=true;assert.equal(village.request(ref('a'),'tag'),false);context.endingActive=false;context.chapter=2;assert.equal(village.request(ref('a'),'tag'),false);context.chapter=1;
 npcs.clear();assert.equal(village.request(ref('a'),'tag'),false);
});
test('NPC tag seeker moves 4.9m/s through numeric navigation, restores actual home and emits one result',()=>{
 const {village,npc,humans,ref,events}=fixture(1);const original={x:npc.x,z:npc.z};village.request(ref('a'),'tag');
 assert.equal(village.snapshot().seeker,'npc0');near(npc.x,-.5);near(npc.z,12.5);assert.equal(village.ownsNpc(npc.ref),true);assert.equal(village.locked(ref('a')),false);
 Object.assign(humans.get('a'),{x:35,y:.85,z:12.5});village.step(5); // legacy transition consumes a full step for first navigation
 near(npc.x,24);near(npc.z,12.5);assert.ok(npc.pose.localVz>0);assert.equal(village.snapshot().left,90);
 Object.assign(humans.get('a'),{x:npc.x+.2,z:npc.z});village.step(1/30);
 assert.equal(village.snapshot().result,'seekers');near(npc.x,original.x);near(npc.z,original.z);assert.equal(village.ownsNpc(npc.ref),false);
 village.step(.2);village.request(ref('a'),'stop');assert.equal(events.filter(e=>e.type==='villageFinished').length,1);
 village.step(8);assert.equal(village.snapshot(),null);
});
test('hide NPC patrols unseen runners at 3.7m/s and uses .7-height line of sight',()=>{
 const {village,npc,humans,ref,context}=fixture(1);village.request(ref('a'),'hide');Object.assign(humans.get('a'),{x:30,z:12.5});
 const rays=[];context.query.raycastSolid=(from,to)=>{rays.push([from,to]);return 0;};context.time=14;
 // Promote an accepted play snapshot to isolate one fixed movement tick, preserving the real resident and pose.
 const state={...village.snapshot(),phase:'play',left:100};context.authority=false;village.applyObservation({area:context.areaId,epoch:1,sequence:0,state});context.authority=true;
 const before={x:npc.x,z:npc.z};village.step(1/30);near(Math.hypot(npc.x-before.x,npc.z-before.z),3.7/30);
 near(rays[0][0].y,.85+npc.height*.7);assert.ok(npc.x>before.x);assert.ok(npc.z<before.z);
});
test('contact requires sight and strict radii while leaving 60m catches irrespective of walls',()=>{
 const {village,context,humans,ref}=fixture(3);village.request(ref('a'),'tag');const a=humans.get('a'),b=humans.get('b'),c=humans.get('c');
 Object.assign(a,{x:0,z:0});Object.assign(b,{x:a.radius+b.radius+.75,z:0});Object.assign(c,{x:10,z:0});village.step(5);assert.deepEqual(village.snapshot().caught,[]);
 b.x-=.01;context.query.raycastSolid=()=>0;village.step(1/30);assert.deepEqual(village.snapshot().caught,[]);
 context.query.raycastSolid=()=>null;village.step(1/30);assert.deepEqual(village.snapshot().caught,['b']);assert.equal(village.locked(ref('b')),true);assert.equal(village.locked(ref('c')),false);
 Object.assign(c,{x:59.5,z:12.5});village.step(1/30);assert.deepEqual(village.snapshot().caught,['b']);c.x+=.001;context.query.raycastSolid=()=>0;village.step(1/30);assert.equal(village.snapshot().result,'seekers');
});
test('tag and hide clocks retain 5/15 preparation, 90/120 play and 8 done; timeout runners win',()=>{
 for(const [mode,ready,play] of [['tag',5,90],['hide',15,120]]){
  const {village,ref,humans}=fixture();village.request(ref('a'),mode);Object.assign(humans.get('a'),{x:0,z:0});Object.assign(humans.get('b'),{x:30,z:0});
  village.step(ready-.1);assert.equal(village.snapshot().phase,'ready');village.step(.11);assert.equal(village.snapshot().phase,'play');assert.equal(village.snapshot().left,play);
  village.step(play);assert.equal(village.snapshot().result,'runners');assert.equal(village.snapshot().left,8);village.step(8);assert.equal(village.snapshot(),null);
 }
});
test('village cancellation and presence bind to exact actor life; disconnected runners do not prolong game',()=>{
 const f=fixture(3);f.village.request(f.ref('a'),'tag');f.humans.delete('b');f.humans.delete('c');f.village.step(5);assert.equal(f.village.snapshot().result,'seekers');
 const g=fixture();g.village.request(g.ref('a'),'hide');g.humans.get('a').ref={...g.ref('a'),life:2};g.village.step(.1);assert.equal(g.village.snapshot().result,'cancelled');
 const h=fixture(1);h.village.request(h.ref('a'),'tag');h.context.chapter=2;Object.assign(h.npc,{x:0,z:86});h.village.step(.1);assert.equal(h.village.snapshot().result,'cancelled');assert.equal(h.npc.z,86);
});
test('follower village observations never advance clock or contact and repeated rounds do not teleport/reward',()=>{
 const {village,context,humans,ref,events}=fixture();context.authority=false;const state={id:'round-remote',mode:'tag',phase:'play',left:40,starter:'a',seeker:'a',members:['a','b'],caught:[],result:''};
 const obs={area:context.areaId,epoch:1,sequence:1,state};assert.equal(village.applyObservation(obs),true);humans.get('a').x=42;
 assert.equal(village.applyObservation({...obs,sequence:2}),true);assert.equal(humans.get('a').x,42);village.step(100);assert.equal(village.snapshot().left,40);
 assert.equal(village.applyObservation({...obs,sequence:1}),false);assert.equal(village.request(ref('a'),'stop'),false);
 const done={...state,phase:'done',result:'runners',left:8};village.applyObservation({...obs,sequence:3,state:done});village.applyObservation({...obs,sequence:4,state:done});
 assert.equal(events.filter(e=>e.type==='villageStarted').length,1);assert.equal(events.filter(e=>e.type==='villageFinished').length,1);
 state.members.push('c');assert.deepEqual(village.snapshot().members,['a','b']);assert.equal(events.some(e=>e.type==='boatAchievement'),false);
});
test('real Combat blocks incoming/outgoing player damage including spectators only while village plays',()=>{
 const f=fixture();f.village.request(f.ref('a'),'tag');
 const area=worldArea('damage-features','w1',{policy:{enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>({desired:1,respawnSeconds:30}),damageAllowed:(_ctx,src,dst)=>!f.village.blocksDamage(src,dst),canInteract:()=>true}}),a=addActor(area,'a'),b=addActor(area,'b');
 const enemy=area.services.getUnit([...area.enemies.values()][0].unit),before=enemy.hp,playerBefore=a.u.hp;
 assert.equal(area.services.combat.damage(a.ref,enemy.ref,5),0);assert.equal(enemy.hp,before);assert.equal(area.services.combat.damage(enemy.ref,a.ref,5),0);assert.equal(a.u.hp,playerBefore);
 assert.equal(area.services.combat.damage(null,b.ref,5),0);f.village.request(f.ref('a'),'stop');assert.equal(area.services.combat.damage(a.ref,enemy.ref,5,{noReact:true}),5);assert.equal(enemy.hp,before-5);
});
test('numeric nav takes a graph detour around a wall and rejects steep ground segments',()=>{
 const query={heightAt:()=>0,raycastSolid:()=>null,resolveCollision:(x,z,r,out)=>out.set(Math.abs(x)<1&&Math.abs(z)<4?2:x,z)};
 const nav=new FeatureNavigation(query,{points:[{x:-3,y:0,z:6},{x:3,y:0,z:6}],radius:1,step:.6});
 const from={x:-6,y:0,z:0},to={x:6,y:0,z:0};assert.equal(nav.walkable(from,to),false);assert.deepEqual(nav.waypoint(from,to,0),{x:-3,y:0,z:6});
 query.heightAt=x=>x*2;assert.equal(nav.walkable({x:0,y:0,z:0},{x:2,y:0,z:0}),false);
});
test('identical seeded inputs replay every feature state and event without shared Area state',()=>{
 const run=()=>{const f=fixture(1);f.village.request(f.ref('a'),'hide');for(let i=0;i<460;i++)f.step();f.village.request(f.ref('a'),'stop');f.village.step(8);f.village.request(f.ref('a'),'tag');return {village:f.village.debug(),boat:f.boat.debug(),events:f.events,rng:f.context.rng.state()};};
 assert.deepEqual(run(),run());const a=fixture(),b=fixture();a.boat.request(a.ref('a'),command('board'));a.step();assert.deepEqual(b.boat.snapshot().seats,[null,null]);
});
test('same ID reboards with a new life after missed empty snapshot; stale lifetime is rejected',()=>{
 const {boat,context,humans,ref,events}=fixture(1);context.authority=false;
 const state={...boat.snapshot(),seats:['a',null]},old={...ref('a')};
 assert.equal(boat.applyObservation({area:context.areaId,epoch:1,sequence:1,state,bindings:{a:old}}),true);boat.step(.1);
 const u=humans.get('a');u.ref={...old,life:2};u.x=0;
 assert.equal(boat.applyObservation({area:context.areaId,epoch:1,sequence:2,state,bindings:{a:old}}),false);boat.step(.1);assert.equal(u.x,0);
 assert.equal(boat.applyObservation({area:context.areaId,epoch:1,sequence:2,state,bindings:{a:{...u.ref}}}),true);boat.step(.1);near(u.x,152.65);assert.equal(boat.seated(u.ref),true);
 assert.equal(events.filter(e=>e.type==='boatBoarded').length,2);assert.equal(events.at(-1).actor.life,2);
});
test('host promotion uses unique voyage and round incarnations despite identical RNG and serial counters',()=>{
 const old=fixture(),next=fixture();old.village.request(old.ref('a'),'tag');const first=old.village.snapshot();
 next.context.authority=false;next.village.applyObservation({area:next.context.areaId,epoch:1,sequence:1,state:first});
 next.context.authority=true;next.context.authorityEpoch=2;next.village.request(next.ref('a'),'stop');next.village.step(8);next.village.request(next.ref('a'),'tag');
 assert.notEqual(next.village.snapshot().id,first.id);assert.equal(next.events.filter(e=>e.type==='villageStarted').length,2);
 const b=fixture();b.boat.request(b.ref('a'),command('board'));b.step();const voyage=b.boat.debug().voyage;
 b.context.authorityEpoch=2;b.boat.step(.1);assert.notEqual(b.boat.debug().voyage,voyage);
});
test('departed historical exits and done-round actors remain inert without blocking cleanup snapshots',()=>{
 const f=fixture();f.context.authority=false;f.humans.delete('b');
 assert.equal(f.boat.applyObservation({area:f.context.areaId,epoch:1,sequence:1,bindings:{},state:{...f.boat.snapshot(),exits:{b:{x:143,z:23,shore:false}}}}),true);
 const done={id:'departed-round',mode:'tag',phase:'done',left:8,starter:'a',seeker:'a',members:['a','b'],caught:['b'],result:'seekers'};
 assert.equal(f.village.applyObservation({area:f.context.areaId,epoch:1,sequence:1,bindings:{a:f.ref('a'),b:{area:f.context.areaId,id:2,life:1}},state:done}),true);
 assert.deepEqual(f.village.snapshot(),done);assert.equal(f.village.playing,false);
});
test('debug exposes every feature-owned timing, identity, navigation and dedupe state as detached finite values',()=>{
 const {boat,village,ref}=fixture(1);village.request(ref('a'),'hide');const vd=village.debug();
 for(const key of ['epoch','sequence','serial','started','finished','bindings','npcHome','nav'])assert.ok(key in vd,key);
 for(const key of ['nodes','adj','path','goal','replanAt','checkAt','radius','step'])assert.ok(key in vd.nav,key);
 assert.equal(vd.nav.goal,null);vd.state.members.length=0;assert.equal(village.snapshot().members.length,1);
 const bd=boat.debug();for(const key of ['sequence','epoch','seatedBefore','previous','distance','earned','inputAt','throttle','steer','voyage','serial','bindings'])assert.ok(key in bd,key);
 assert.doesNotThrow(()=>JSON.stringify({vd,bd}));
});
