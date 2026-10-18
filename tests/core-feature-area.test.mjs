import test from 'node:test';
import assert from 'node:assert/strict';
import {worldArea,addActor,intent,tick} from './core/worldHarness.mjs';
import {teleport} from '../src/sim/unit.ts';

test('real Area owns all eight residents and advances their actual numeric controllers once',()=>{
 const a=worldArea('ambient'),b=worldArea('ambient');
 assert.equal([...a.units.values()].filter(u=>u.kind==='townsfolk').length,8);
 const before=a.snapshot().units.filter(u=>u.kind==='townsfolk').map(u=>[u.x,u.z]);
 tick(a,150);tick(b,150);
 const after=a.snapshot();assert.deepEqual(after,b.snapshot());
 assert.ok(after.units.filter(u=>u.kind==='townsfolk').some((u,i)=>Math.hypot(u.x-before[i][0],u.z-before[i][1])>.1));
 assert.ok(after.units.filter(u=>u.kind==='townsfolk').every(u=>u.pose.appliedQ.length===22));
});

test('real Area boat owns rider position, village permits runner movement and blocks player damage',()=>{
 const a=worldArea('features','w1',{query:{heightAt:()=>1,resolveCollision:(x,z,r,o)=>o.set(x,z),raycastSolid:()=>null}});
 const {u,p}=addActor(a);teleport(u,a.services.query,145,20);
 a.step(new Map([[u.ref.id,intent(1,[{kind:'boat',command:{action:'board',throttle:0,steer:0}}],{forward:1})]]));
 assert.equal(a.snapshot().features.boat.seats[0],`actor:${u.ref.id}`);
 assert.equal(a.services.context.members[0].seatedBoat,'shore');p.useAbility(5);assert.equal(p.state.cooldowns['crown-burst'],undefined);
 const pos=[u.x,u.z];a.step(new Map([[u.ref.id,intent(2,[],{forward:1})]]));assert.deepEqual([u.x,u.z],pos);
 a.step(new Map([[u.ref.id,intent(3,[{kind:'boat',command:{action:'leave',throttle:0,steer:0}},{kind:'village',mode:'tag'}])]]));
 assert.equal(a.snapshot().features.village.phase,'ready');assert.equal(a.services.context.members[0].featureLocked,false);p.useAbility(5);assert.equal(p.state.cooldowns['crown-burst'],undefined);
 const start=[u.x,u.z];a.step(new Map([[u.ref.id,intent(4,[],{forward:1})]]));assert.ok(Math.hypot(u.x-start[0],u.z-start[1])>0);
 const enemy=[...a.enemies.values()][0],hp=u.hp;assert.equal(a.services.combat.damage(enemy.unit,u.ref,10),0);assert.equal(u.hp,hp);
 const old=u.ref;p.respawn();assert.notDeepEqual(u.ref,old);assert.equal(a.snapshot().features.village,null);
 assert.deepEqual(a.snapshot().features.boat.seats,[null,null]);
});
