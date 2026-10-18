import test from 'node:test';
import assert from 'node:assert/strict';
import {createArea} from '../src/sim/area.ts';
import {createDungeonDefinition,createDungeonQuery} from '../src/sim/areas/dungeon.ts';
import {DUNGEONS,dungeonFor,dungeonDanger,dungeonHazards,DUNGEON_CAPTAIN_SCALE} from '../src/sim/data/dungeons.ts';
import * as legacy from '../src/game/dungeonData.ts';
import {dungeonPlayerEligible} from '../src/sim/features/dungeon.ts';
import {dungeonEnemyStats} from '../src/sim/data/dungeon-enemies.ts';
import {realActionData} from '../src/sim/data/actions.ts';
import {xpForLevel} from '../src/sim/data/progression.ts';
import {flatWorld,intent,tick,worldArea} from './core/worldHarness.mjs';
const policy={enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>{throw new Error('Dungeon must not use population policy');},damageAllowed:()=>true,canInteract:()=>true};
let next=0;
function fixture(tier=35,{external=false,classId='mage',level=tier,...overrides}={}){
 const area=createArea({id:`dungeon-test-${++next}`,dungeon:{runId:`run-${next}`,tier},definition:createDungeonDefinition(tier),query:createDungeonQuery(flatWorld),seed:15,policy,actionData:realActionData,context:{mode:'dungeon',members:[],pvp:'disabled'},limits:{eventCount:100000,inputCommandsPerTick:32,timers:1000,projectiles:1000},...(external?{ledgerMode:'external-durable',ledgerLimits:{maxDirtyCreditEntries:1000,maxDirtyCreditBytes:1000000,maxPendingDeaths:100,maxStagedBytes:1000000}}:{}),...overrides});
 const ref=area.attachFresh(external?'00000000-0000-4000-8000-000000000001':'hero',classId,'human','spawn',...(external?[0]:[])),p=area.services.player(ref),u=area.services.getUnit(ref);p.restoreXp(xpForLevel(level));p.state.nextSwing=1e9;
 return {area,p,u};
}
function until(a,predicate,max=1000){for(let i=0;i<max;i++){if(predicate())return i;tick(a);}assert.fail(`Condition not reached: ${JSON.stringify(a.dungeonObservation())}`);}
const wave=a=>until(a,()=>a.dungeonObservation().phase==='wave');
const live=a=>[...a.enemies.values()].filter(e=>a.services.getUnit(e.unit)?.alive);
function killWave(a,u){for(const e of live(a))a.services.combat.damage(u.ref,e.unit,1e9);tick(a);}
function finalWave(f){wave(f.area);killWave(f.area,f.u);wave(f.area);killWave(f.area,f.u);wave(f.area);}
function progress(p){return structuredClone({xp:p.state.xp,coins:p.state.coins,quests:p.state.quests,cogMisses:p.state.cogMisses,flags:p.state.flags});}

// Values are captured from canonical 2aa6a511, independent of the source table under test.
test('all ten canonical tiers retain legacy exports and removed selections stay unavailable',()=>{
 assert.deepEqual(DUNGEONS.map(d=>[d.level,d.chapter,d.xp,d.coins]),[[35,3,1800,1800],[50,3,3000,3000],[75,3,6000,5000],[150,4,22000,11000],[200,4,40000,16000],[250,4,65000,23000],[350,5,100000,32000],[450,5,150000,43000],[550,6,280000,70000],[650,6,380000,90000]]);
 assert.equal(legacy.DUNGEONS,DUNGEONS);assert.equal(legacy.dungeonDanger,dungeonDanger);assert.equal(legacy.dungeonHazards,dungeonHazards);assert.equal(DUNGEON_CAPTAIN_SCALE,1.65);
 for(const tier of [425,500,750,0,36]){assert.equal(dungeonFor(tier),undefined);assert.throws(()=>createDungeonDefinition(tier),/tier/);}
});
const expectedHazards=(i,s)=>{switch(i){case 0:return [{shape:'circle',x:0,z:0,radius:6}];case 1:return [{shape:'rect',x:0,z:0,width:5.2,depth:34,yaw:0},{shape:'rect',x:0,z:0,width:34,depth:5.2,yaw:0}];case 2:return [[-8,-6],[7,-3],[0,8]].map(([x,z])=>({shape:'circle',x,z,radius:4.2}));case 3:return [{shape:'rect',x:s%2?7:-7,z:0,width:9,depth:34,yaw:0},{shape:'rect',x:s%2?-7:7,z:0,width:3.6,depth:34,yaw:0}];case 4:return [{shape:'rect',x:0,z:0,width:34,depth:5,yaw:s%8*Math.PI/4}];case 5:return [{shape:s%2?'circle':'ring',x:0,z:0,radius:s%2?10:18,inner:7}];case 6:return [-9,0,9].map((x,j)=>({shape:'circle',x,z:s%2?j*5-5:5-j*5,radius:4}));case 7:return [-9,0,9].map((x,j)=>({shape:'rect',x,z:0,width:3.8,depth:32,yaw:(s+j)%2?Math.PI/2:0}));case 8:return [-10,0,10].map(z=>({shape:'rect',x:s%2?6:-6,z,width:24,depth:3.2,yaw:0}));case 9:return Array.from({length:5},(_,j)=>{const angle=j*Math.PI*2/5+s*.4;return {shape:'circle',x:Math.sin(angle)*9,z:Math.cos(angle)*9,radius:4};});}};
test('all ten hazard warning geometries preserve rotating and alternating strict footprints',()=>{
 for(let i=0;i<10;i++)for(let s=0;s<9;s++){const hs=expectedHazards(i,s);assert.deepEqual(dungeonHazards(i,s),hs);for(let x=-18;x<=18;x+=1.125)for(let z=-18;z<=18;z+=1.125){const danger=hs.some(h=>{const dx=x-h.x,dz=z-h.z;if(h.shape==='rect'){const a=dx*Math.cos(h.yaw)+dz*Math.sin(h.yaw),b=-dx*Math.sin(h.yaw)+dz*Math.cos(h.yaw);return Math.abs(a)<h.width/2&&Math.abs(b)<h.depth/2;}const r=Math.hypot(dx,dz);return r<h.radius&&(h.shape!=='ring'||r>h.inner);});assert.equal(dungeonDanger(i,s,x,z),danger);}}
 assert.equal(dungeonDanger(0,0,6,0),false);assert.equal(dungeonDanger(1,0,2.6,2.6),false);assert.equal(dungeonDanger(5,0,7,0),false);assert.equal(dungeonDanger(5,0,18,0),false);
});
test('pure chamber query preserves exact footprint, collision and parent fallback',()=>{
 const parent={heightAt:()=>-3,resolveCollision:(x,z,r,out)=>out.set(-1,-2),raycastSolid:()=>7},q=createDungeonQuery(parent),out={set(x,y){this.x=x;this.y=y;return this;}};
 assert.equal(q.heightAt(25.999,125),80);assert.equal(q.heightAt(26,125),-3);assert.equal(q.resolveCollision(25,125,1,out),out);assert.equal(out.x,16.75);assert.equal(out.y,125);q.resolveCollision(26,125,1,out);assert.deepEqual([out.x,out.y],[-1,-2]);assert.equal(q.raycastSolid({x:0,y:78.001,z:125},{x:0,y:0,z:0}),null);assert.equal(q.raycastSolid({x:0,y:78,z:125},{x:0,y:0,z:0}),7);
});
test('dungeon Area rejects mismatched definition/query/context and preserves default Area API',()=>{
 for(const overrides of [{query:flatWorld},{context:{mode:'public',pvp:'disabled',members:[]}},{context:{mode:'dungeon',pvp:'party-only',members:[]}},{definition:createDungeonDefinition(50)},{dungeon:{runId:'x',tier:425}},{dungeon:{runId:'x',tier:35,extra:true}}])assert.throws(()=>fixture(35,overrides));
 const a=worldArea('ordinary-no-dungeon');assert.equal(a.dungeonObservation(),null);assert.equal(a.pendingDungeonCompletion(),null);assert.throws(()=>a.acknowledgeDungeonCompletion('x'));a.dispose();
});
test('actual six dedicated slots spawn3/5/3 with fresh lives, exact captain stats and unchanged collider',()=>{
 for(const d of DUNGEONS){const f=fixture(d.level),a=f.area,slots=[...a.enemies.values()];assert.equal(slots.length,6);assert.ok(slots.every(e=>e.state==='gone'));const collider=slots.map(e=>{const u=a.services.getUnit(e.unit);return [u.radius,u.height];});
 for(const [stage,count]of [[1,3],[2,5],[3,3]]){wave(a);const o=a.dungeonObservation();assert.equal(o.stage,stage);assert.equal(live(a).length,count);assert.ok(Object.isFrozen(o));for(let i=0;i<count;i++){const e=slots[i],u=a.services.getUnit(e.unit),captain=stage===3&&i===0;assert.deepEqual(e.stats,{level:d.level,hp:Math.round((180+d.level*8)*(captain?4:1)),xp:0,speed:captain?3.4:4.1,aggro:40,leash:45,swing:captain?2.8:2.4,dmg:[(8+d.level*.18)*1.25,(12+d.level*.23)*(captain?1.5:1)*1.25],respawn:45});assert.deepEqual(dungeonEnemyStats(d.level,captain),e.stats);assert.equal(e.stats.hp,Math.round((180+d.level*8)*(captain?4:1)));assert.deepEqual([u.radius,u.height],collider[i]);assert.equal(e.isAdd,false);assert.equal(e.unit.life,stage===1?2:stage===2?i<3?3:2:4);assert.ok(Math.abs(Math.hypot(u.x,u.z-125)-11)<1e-12);}
 killWave(a,f.u);}
 assert.equal(a.dungeonObservation().phase,'clear');const c=a.pendingDungeonCompletion();assert.equal(c.candidate.baseXp,d.xp);assert.equal(c.candidate.coins,d.coins);a.acknowledgeDungeonCompletion(c.token);a.dispose();}
});
for(const order of ['captain-first','captain-last'])test(`stage3 ${order} clears only when all three real actors die and keeps immutable completion`,()=>{
 const f=fixture(),a=f.area;finalWave(f);const refs=a.dungeonObservation().activeEnemies,captain=a.dungeonObservation().captain;assert.deepEqual(captain,refs[0]);const sorted=order==='captain-first'?refs:[...refs.slice(1),refs[0]];
 for(let i=0;i<3;i++){a.services.combat.damage(f.u.ref,sorted[i],1e9);tick(a);assert.equal(a.dungeonObservation().phase,i===2?'clear':'wave');if(i<2)assert.equal(a.pendingDungeonCompletion(),null);}
 const captured=a.pendingDungeonCompletion();assert.deepEqual(captured.candidate.finalWave,refs);assert.equal(captured.candidate.completedTick,a.services.tick);assert.ok(Object.isFrozen(captured.candidate.finalWave[0]));assert.throws(()=>{captured.candidate.coins=0;});
 tick(a,10);assert.equal(a.pendingDungeonCompletion(),captured);for(const wrong of [null,undefined,'',captured.token+'old'])assert.throws(()=>a.acknowledgeDungeonCompletion(wrong));assert.throws(()=>a.dispose(),/completion/);assert.equal(a.pendingDungeonCompletion(),captured);a.acknowledgeDungeonCompletion(captured.token);a.acknowledgeDungeonCompletion(captured.token);assert.equal(a.dungeonObservation().completionPending,false);assert.equal(a.dungeonObservation().phase,'clear');a.dispose();
});
for(const external of [false,true])test(`${external?'external':'retained'} dungeon deaths bypass ordinary XP/coins/quests/cogs/coop and source contributions`,()=>{
 const f=fixture(35,{external}),a=f.area,before=progress(f.p);for(let stage=1;stage<=3;stage++){wave(a);for(const e of live(a)){a.services.combat.damage(f.u.ref,e.unit,1);a.services.combat.damage(f.u.ref,e.unit,1e9);}tick(a);}
 assert.deepEqual(progress(f.p),before);assert.deepEqual(a.pendingGrants(),[]);assert.deepEqual(a.debugState().contributions,[]);const usage=a.resourceUsage();for(const k of ['contributionEntries','settledVictims','dirtyCreditEntries','pendingDeaths'])if(k in usage)assert.equal(usage[k],0,k);assert.ok(!a.drainEvents().some(r=>['xp','coin','quest','coop'].includes(r.event.type)));a.acknowledgeDungeonCompletion(a.pendingDungeonCompletion().token);a.dispose();
});
for(const [i,d]of DUNGEONS.entries())test(`tier${d.level} real hazard hits once per serial at canonical warning crossing and snapshot is inert`,()=>{
 const f=fixture(d.level,{level:650}),a=f.area;wave(a);const hs=expectedHazards(i,0),h=hs[0],x=h.shape==='ring'?h.inner+1:h.x,z=h.shape==='ring'?0:h.z;Object.assign(f.u,{x,y:80,z:125+z});for(const e of a.enemies.values())a.services.getUnit(e.unit).stunUntil=1e9;
 let clock=0,previousSerial=0,hit=-1;const expected=[],actual=[];a.drainEvents();
 for(let n=0;n<460;n++){const before=clock;clock=Math.min(9999999,clock+1/30);const serial=Math.floor(clock/7);if(Math.floor(before/7)===serial&&before%7<2.5&&clock%7>=2.5&&hit!==serial){hit=serial;if(dungeonDanger(i,serial,x,z))expected.push(n+1);}tick(a);const es=a.drainEvents();for(const e of es)if(e.event.type==='damage'&&e.event.dst.id===f.u.ref.id){actual.push(n+1);assert.equal(e.event.amount,Math.round((18+d.level*.42)*1.25));}
 if(n===0||serial!==previousSerial){const beforeRead=a.debugState();for(let j=0;j<3;j++){a.dungeonObservation();a.pendingDungeonCompletion();a.snapshot();a.drainEvents();}assert.deepEqual(a.debugState(),beforeRead);}previousSerial=serial;}
 assert.deepEqual(actual,expected);assert.ok(actual.length>0);assert.equal(a.dungeonObservation().hazardSerial,2);a.dispose();
});
test('dead member respawns with fresh life in chamber while survivor continues; all-dead failure remains terminal',()=>{
 const f=fixture(),a=f.area,r=a.attachFresh('teammate','priest','human','spawn'),p=a.services.player(r),u=a.services.getUnit(r);p.restoreXp(xpForLevel(35));p.state.nextSwing=1e9;wave(a);for(const e of a.enemies.values())a.services.getUnit(e.unit).stunUntil=1e9;
 const old=f.u.ref;a.services.combat.kill(old,null);tick(a);assert.equal(a.dungeonObservation().phase,'wave');tick(a,110);assert.equal(f.u.alive,true);assert.equal(f.u.ref.life,old.life+1);assert.equal(f.u.y,80);assert.ok(Math.hypot(f.u.x,f.u.z-136)<1);
 a.services.combat.kill(f.u.ref,null);a.services.combat.kill(u.ref,null);tick(a);assert.equal(a.dungeonObservation().phase,'failed');assert.equal(live(a).length,0);tick(a,300);assert.equal(a.dungeonObservation().phase,'failed');assert.equal(a.pendingDungeonCompletion(),null);a.dispose();
});
test('final all-dead wave clear precedes simultaneous player wipe; no source yields no hazard strike',()=>{
 const f=fixture(),a=f.area;finalWave(f);for(const e of live(a))a.services.combat.damage(f.u.ref,e.unit,1e9);a.services.combat.kill(f.u.ref,null);tick(a);assert.equal(a.dungeonObservation().phase,'clear');assert.ok(a.pendingDungeonCompletion());a.acknowledgeDungeonCompletion(a.pendingDungeonCompletion().token);a.dispose();
});
test('underlevel/hidden/outside members cannot sustain run or damage dedicated enemies; public PvP stays off',()=>{
 for(const invalid of ['level','hidden','distance']){const f=fixture(),a=f.area;wave(a);const target=live(a)[0].unit;if(invalid==='level'){f.p.restoreXp(0);const hp=a.services.getUnit(target).hp;assert.equal(a.services.combat.damage(f.u.ref,target,100),0);assert.equal(a.services.getUnit(target).hp,hp);}if(invalid==='hidden')f.u.hidden=true;if(invalid==='distance')f.u.x=26;tick(a);assert.equal(a.dungeonObservation().phase,'failed',invalid);a.dispose();}
 const edge=fixture();for(const delta of [{y:84},{y:76},{x:24,z:125},{x:-24,z:125}])assert.equal(dungeonPlayerEligible({...edge.u,...delta},35),false);edge.area.dispose();
 const f=fixture(),r=f.area.attachFresh('peer','mage','human','spawn'),peer=f.area.services.getUnit(r);assert.equal(f.area.services.combat.damage(f.u.ref,r,100),0);assert.equal(peer.hp,peer.maxHp);assert.throws(()=>f.area.applyContext({mode:'dungeon',pvp:'party-only',members:f.area.context.members}));f.area.dispose();
});

test('real ordered mage casts and actual Enemy AI complete3/5/3 without reward/heal/resource resets',()=>{
 // Explicit overlevel source fixture isolates mechanics; this is not a level35 survival/campaign claim.
 const f=fixture(35,{level:650}),a=f.area,before=progress(f.p);let seq=0,releases=0,enemyAttacks=0,damage=0,casts=0,minResource=f.p.state.resource;const spawned=[];
 for(let n=0;n<6000&&a.dungeonObservation().phase!=='clear';n++){
  const o=a.dungeonObservation();if(o.phase==='failed')assert.fail('Overlevel real-combat fixture wiped');
  if(o.phase==='wave'&&!spawned.includes(o.stage))spawned.push(o.stage);
  const target=live(a)[0];if(target&&!f.p.state.cast&&a.services.time>=Math.max(f.p.state.gcdEnd,f.p.state.cooldowns['bubble-bolt']?.end??0)){const paid=f.p.state.resource;a.step(new Map([[f.u.ref.id,intent(++seq,[{kind:'target',target:target.unit},{kind:'ability',slot:1}])]]));assert.ok(f.p.state.cast);assert.equal(f.p.state.resource,paid);casts++;}else tick(a);
  minResource=Math.min(minResource,f.p.state.resource);for(const {event:e}of a.drainEvents()){if(e.type==='castEnd'&&!e.channel&&e.result==='done')releases++;if(e.type==='attack'&&e.src.id!==f.u.ref.id)enemyAttacks++;if(e.type==='damage'&&e.dst.id===f.u.ref.id)damage+=e.amount;}
 }
 assert.equal(a.dungeonObservation().phase,'clear');assert.deepEqual(spawned,[1,2,3]);assert.equal(casts,11);assert.equal(releases,11);assert.ok(enemyAttacks>0);assert.ok(damage>0);assert.ok(f.u.alive);assert.deepEqual(progress(f.p),before);assert.ok(minResource<f.p.state.maxResource);assert.equal(a.pendingGrants().length,0);a.acknowledgeDungeonCompletion(a.pendingDungeonCompletion().token);a.dispose();
});

test('pending actual player impact is resolved after the dungeon stage and advances only on next step',()=>{
 const f=fixture(35,{classId:'warrior',level:650}),a=f.area;wave(a);const [target,...others]=live(a);for(const e of others)a.services.combat.damage(f.u.ref,e.unit,1e9);const u=a.services.getUnit(target.unit);Object.assign(f.u,{x:u.x+u.radius+f.u.radius+.5,z:u.z,y:80});u.stunUntil=1e9;f.p.state.resource=100;
 a.step(new Map([[f.u.ref.id,intent(1,[{kind:'target',target:target.unit},{kind:'ability',slot:1}])]]));assert.ok(f.u.pendingHit);assert.ok(u.alive);let ticks=0;while(u.alive&&ticks++<30)tick(a);assert.equal(u.alive,false);assert.equal(a.dungeonObservation().phase,'wave');assert.equal(a.pendingDungeonCompletion(),null);tick(a);assert.equal(a.dungeonObservation().phase,'rest');assert.equal(a.dungeonObservation().stage,2);wave(a);assert.equal(f.p.state.target,null);assert.equal(f.u.pendingHit,null);assert.equal(a.services.getUnit({...target.unit,life:target.unit.life-1}),null);a.dispose();
});

test('real scavenger leap preserves .75s impact and canonical8..11 damage independently of tier',()=>{
 const f=fixture(650),a=f.area;wave(a);const [e,...other]=live(a);for(const o of other)a.services.getUnit(o.unit).stunUntil=1e9;const u=a.services.getUnit(e.unit);Object.assign(u,{x:0,z:129,y:80});Object.assign(f.u,{x:0,z:136,y:80});a.drainEvents();let start=null,hit=null,amount=null;
 for(let i=0;i<100&&hit===null;i++){tick(a);for(const {event:x}of a.drainEvents()){if(x.type==='attack'&&x.src.id===e.unit.id&&x.attack==='enemy-leap'){if(x.stage==='start')start=a.services.tick;else hit=a.services.tick;}if(x.type==='damage'&&x.src?.id===e.unit.id&&x.dst.id===f.u.ref.id)amount=x.amount;}}
 assert.ok(start!==null&&hit!==null);assert.equal(hit-start,23);assert.ok(amount>=8&&amount<=11);a.dispose();
});

test('hazards use real armor/absorb authority while wave transitions preserve existing status/resource/cooldown',()=>{
 const f=fixture(35,{classId:'priest'}),a=f.area;wave(a);Object.assign(f.u,{x:0,z:125,y:80});for(const e of a.enemies.values())a.services.getUnit(e.unit).stunUntil=1e9;f.p.state.armorRank=25;f.u.absorb=10;f.u.absorbMax=10;f.u.absorbUntil=a.services.time+20;f.u.slowPct=.2;f.u.slowUntil=a.services.time+20;f.p.state.cooldowns.test={start:a.services.time,end:a.services.time+100};a.drainEvents();tick(a,76);const damage=a.drainEvents().filter(r=>r.event.type==='damage'&&r.event.dst.id===f.u.ref.id);assert.equal(damage.length,1);assert.equal(damage[0].event.amount,Math.round(Math.round((18+35*.42)*1.25)/2)-10);assert.equal(f.u.absorb,0);f.p.state.resource=17;const hp=f.u.hp,resource=f.p.state.resource,cooldown={...f.p.state.cooldowns.test};killWave(a,f.u);assert.equal(f.u.hp,hp);assert.ok(f.p.state.resource>=resource&&f.p.state.resource<resource+1);assert.equal(f.u.slowPct,.2);assert.deepEqual(f.p.state.cooldowns.test,cooldown);a.dispose();
});

test('dead dungeon slots never respawn autonomously and future waves purge old-life pending hits',()=>{
 const f=fixture(35,{level:650}),a=f.area;wave(a);const [dead,...survivors]=live(a),old=dead.unit;for(const e of survivors)a.services.getUnit(e.unit).stunUntil=1e9;a.services.combat.damage(f.u.ref,old,1e9);tick(a,1500);assert.equal(a.services.getUnit(old).alive,false);assert.equal(dead.unit.life,old.life);assert.equal(a.dungeonObservation().stage,1);
 f.p.state.target=old;f.u.pendingHit={left:10,plan:{attack:'warrior-auto',source:f.u.ref,target:old}};killWave(a,f.u);wave(a);assert.equal(f.u.pendingHit,null);assert.equal(f.p.state.target,null);assert.equal(a.services.getUnit(old),null);assert.ok(dead.unit.life>old.life);a.dispose();
});

for(const [i,d]of DUNGEONS.entries())test(`tier${d.level} real warning crossing excludes a live member on safe ground`,()=>{
 const f=fixture(d.level,{level:650}),a=f.area;wave(a);for(const e of a.enemies.values())a.services.getUnit(e.unit).stunUntil=1e9;
 const safe=[];for(let x=-15;x<=15;x++)for(let z=-15;z<=15;z++)if(Math.hypot(x,z)<17&&!dungeonDanger(i,0,x,z)&&live(a).every(e=>{const u=a.services.getUnit(e.unit);return Math.hypot(x-u.x,z+125-u.z)>4;}))safe.push([x,z]);assert.ok(safe.length);const [x,z]=safe[0];Object.assign(f.u,{x,y:80,z:z+125});a.drainEvents();tick(a,76);assert.equal(a.drainEvents().filter(r=>r.event.type==='damage'&&r.event.dst.id===f.u.ref.id).length,0);a.dispose();
});
