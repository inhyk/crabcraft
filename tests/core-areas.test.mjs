import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld1Definition} from '../src/sim/areas/world1.ts';
import {createWorld2Definition} from '../src/sim/areas/world2.ts';
import {createWorld3Definition} from '../src/sim/areas/world3.ts';
const query={heightAt:(x,z)=>2+Math.sin(x/20)+Math.cos(z/20),resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
const config={query,personalProps:query,fixedLevels:{scrapling:3,scavenger:5,jellyfish:4,echo:11},population:{scrapling:12,scavenger:4,jellyfish:0}};
test('three worlds have independent immutable spawn, NPC, arena and interaction definitions',()=>{
 const [w1,w2,w3]=[createWorld1Definition(config),createWorld2Definition(config),createWorld3Definition(config)];
 assert.deepEqual([w1.world,w2.world,w3.world],['w1','w2','w3']);assert.deepEqual([w1.spawn.position.x,w2.spawn.position.x,w3.spawn.position.z],[-.5,0,84]);
 assert.deepEqual([w1.bosses.map(b=>b.profile),w2.bosses.map(b=>b.profile),w3.bosses.map(b=>b.profile)],[['rust','abyss'],['eclipse'],['dawn']]);
 assert.equal(w1.enemies.length,16);assert.equal(w2.enemies.length,17);assert.equal(w3.enemies.length,16);assert.equal(w2.enemies.find(e=>e.role==='echo').fixedLevel,11);
 assert.ok(w2.interactions.some(i=>i.id==='lamp-c'));assert.ok(!w1.interactions.some(i=>i.id==='lamp-c'));assert.ok(!w3.interactions.some(i=>i.id==='lamp-c'));
 assert.notEqual(w1.enemies,w2.enemies);assert.notDeepEqual(w1.enemies[0].home,w2.enemies[0].home);assert.notDeepEqual(w2.npcs[0].position,w3.npcs[0].position);
 assert.throws(()=>{w2.enemies[0].home.x=0;},TypeError);assert.throws(()=>{w3.npcs[0].position.z=0;},TypeError);
 assert.equal(w1.interactions.find(i=>i.id==='gate:w2').position.x,121);assert.equal(w1.interactions.find(i=>i.id==='gate:w2').position.z,106);
});
test('host supplies balance explicitly and invalid level/population fails before construction',()=>{
 assert.throws(()=>createWorld1Definition({...config,fixedLevels:{...config.fixedLevels,scrapling:0}}),/fixed-level/);
 assert.throws(()=>createWorld2Definition({...config,population:{...config.population,scavenger:-1}}),/population/);
 assert.throws(()=>createWorld3Definition({...config,population:{...config.population,scrapling:1.5}}),/population/);
 const world=createWorld2Definition({...config,population:{scrapling:0,scavenger:0,jellyfish:0}});assert.equal(world.enemies.length,1);assert.equal(world.enemies[0].role,'echo');
});
test('W1 retains shipped pack layout and terrain-selected shallow patrol templates under explicit config',()=>{
 const query={heightAt:(x,z)=>Math.abs(x-115)<3?.4:1,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
 const world=createWorld1Definition({...config,query,population:{...config.population,shallowPatrols:3}}),normal=world.enemies.filter(e=>e.id.startsWith('w1:scrapling:')),patrols=world.enemies.filter(e=>e.id.startsWith('w1:shallow:'));
 assert.deepEqual([...new Set(normal.map(e=>e.pack))].map(pack=>normal.filter(e=>e.pack===pack).length),[3,2,2,3,2]);assert.equal(patrols.length,3);for(const p of patrols){assert.equal(p.home.y,.4);assert.equal(p.wanderRadius,2);assert.equal(p.fixedLevel,3);assert.ok(Math.hypot(p.home.x-world.pois.shore.position.x,p.home.z-world.pois.shore.position.z)>6);}
});
test('real three-world replay is unchanged by interleaving and snapshot/event observation cadence',async()=>{
 const {worldArea,addActor,intent}=await import('./core/worldHarness.mjs');
 const run=(order,observe)=>{const areas=[worldArea('replay-w1'),worldArea('replay-w2','w2'),worldArea('replay-w3','w3')],actors=areas.map((a,i)=>addActor(a,`c${i}`)),history=areas.map(()=>[]);const victim=[...areas[0].enemies.values()][0];const target=areas[0].services.getUnit(victim.unit);Object.assign(actors[0].u,{x:target.x-2,y:target.y,z:target.z});
 // Direct fixture placement retains the actual Player, Enemy and Combat controllers.
 for(let frame=0;frame<180;frame++)for(const i of order){const area=areas[i],actor=actors[i],commands=frame===0&&i===0?[{kind:'ability',slot:5}]:[];area.step(new Map([[actor.ref.id,intent(frame,commands,{forward:i===2?.2:0})]]));if(observe){area.snapshot();area.debugState();history[i].push(...area.drainEvents());}}for(let i=0;i<3;i++)history[i].push(...areas[i].drainEvents());return {states:areas.map(a=>a.debugState()),history};};
 const first=run([0,1,2],false),second=run([2,0,1],true);assert.deepEqual(first,second);assert.equal(first.states[0].snapshot.players[0].xp,20);assert.equal(first.states[1].snapshot.players[0].xp,0);assert.equal(first.states[2].snapshot.players[0].xp,0);
});
test('World II echo spawns on its own clock and does not postpone an elapsed respawn deadline while alive',async()=>{
 const {worldArea,tick}=await import('./core/worldHarness.mjs'),island=worldArea('echo-world','w2'),shore=worldArea('echo-shore'),echo=[...island.enemies.values()].find(e=>e.isEcho);assert.equal(echo.state,'gone');tick(island,1349);assert.equal(echo.state,'gone');tick(island,2);assert.equal(echo.state,'idle');assert.equal(island.services.getUnit(echo.unit).archetype,'echo');const firstLife=echo.unit.life;tick(island,3601);assert.equal(echo.unit.life,firstLife);echo.despawn();tick(island);assert.equal(echo.state,'idle');assert.equal(echo.unit.life,firstLife+1);assert.equal(shore.services.time,0);assert.equal(shore.enemies.size,1);
});
test('World IV separates nominal recall from arrival and retains independent Frostlight definitions',async()=>{
 const{createWorld4Definition}=await import('../src/sim/areas/world4.ts'),w4=createWorld4Definition(config),w3=createWorld3Definition(config);assert.equal(w4.world,'w4');assert.deepEqual(w4.spawn.position,{x:-12,y:5,z:90});assert.equal(w4.recall,w4.spawn);assert.equal(w4.pois.arrival.position.x,0);assert.equal(w4.pois.arrival.position.z,82);assert.deepEqual(w4.bosses.map(b=>[b.profile,b.freedNpcId]),[['frost','mira']]);assert.deepEqual(w3.bosses.map(b=>b.freedNpcId),['dawnkeeper']);assert.equal(w3.interactions.find(i=>i.id==='gate:w4').position.x,14);assert.equal(w4.interactions[0].destination,'w3');assert.deepEqual(w4.enemies.slice(0,4).map(e=>[e.home.x,e.home.z]),[[-44,20],[51,20],[-58,8],[65,8]]);assert.equal(w4.enemies.some(e=>e.kind==='jellyfish'||e.role==='echo'),false);
});
test('all twenty-one Dawn props require explicit raw placement and sample height after radius-one resolution',()=>{
 assert.throws(()=>createWorld3Definition({...config,personalProps:undefined}),/personal-prop-query-required/);const calls=[],actorQuery={...query,resolveCollision:(x,z,r,out)=>out.set(999,999)},raw={heightAt:(x,z)=>x*2+z,resolveCollision(x,z,r,out){calls.push([x,z,r]);return out.set(x+2,z-3);}},world=createWorld3Definition({...config,query:actorQuery,personalProps:raw}),nodes=world.interactions.filter(i=>i.objective?.startsWith('dawn-'));assert.equal(nodes.length,21);assert.equal(calls.length,21);assert.ok(calls.every(c=>c[2]===1));for(let i=0;i<nodes.length;i++){const[x,z]=calls[i];assert.deepEqual(nodes[i].position,{x:x+2,y:(x+2)*2+z-3,z:z-3});}assert.equal(nodes.filter(i=>i.kind==='waystone').length,3);assert.equal(nodes.filter(i=>i.kind==='explore').length,3);
});
test('fresh Frostlight owns captive Mira at the prison independently of Dawnkeeper',async()=>{
 const{worldArea}=await import('./core/worldHarness.mjs'),dawn=worldArea('captivity-dawn','w3'),snow=worldArea('captivity-snow','w4'),mira=[...snow.units.values()].find(u=>u.npcId==='mira'),keeper=[...dawn.units.values()].find(u=>u.npcId==='dawnkeeper');assert.deepEqual([mira.x,mira.z],[13,-62]);assert.equal(mira.hidden,false);assert.equal(mira.targetable,false);assert.equal(keeper.hidden,true);assert.notEqual(mira.ref.area,keeper.ref.area);
});
