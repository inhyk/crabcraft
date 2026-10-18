import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld1Definition} from '../src/sim/areas/world1.ts';
import {createWorld2Definition} from '../src/sim/areas/world2.ts';
import {createWorld3Definition} from '../src/sim/areas/world3.ts';
const query={heightAt:(x,z)=>2+Math.sin(x/20)+Math.cos(z/20),resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
const config={query,fixedLevels:{scrapling:3,scavenger:5,jellyfish:4,echo:11},population:{scrapling:12,scavenger:4,jellyfish:0}};
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
