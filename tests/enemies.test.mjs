import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Enemy,ENEMY_STATS} from '../tmp/test-modules/enemies.js';

function make(kind='scrapling'){
 const unit={pos:new THREE.Vector3(),level:1,hp:1,maxHp:1,alive:true,hidden:false,invulnerable:false,baseTint:null,
  rig:{root:{visible:true}},motion:{stop(){}},express(){},cancelPendingHit(){},teleport(_world,x,z){this.pos.set(x,3,z)},setBaseTint(color){this.baseTint=color}};
 const game={time:10,partyLevel:20,world2:{chapter:2},journey:{rustCleared:false},world:{heightAt:()=>3},vfx:{burrow(){}}};
 return {game,unit,enemy:new Enemy(game,unit,kind,new THREE.Vector3(),4)};
}

test('taking authority reconstructs scaled damage without changing checkpoint HP or level',()=>{
 const host=make(),guest=make();host.enemy.respawnAt(0,0);
 Object.assign(guest.unit,{level:host.unit.level,hp:23,maxHp:host.unit.maxHp});guest.enemy.state='chase';
 assert.notDeepEqual(guest.enemy.stats.dmg,host.enemy.stats.dmg);
 guest.enemy.resumeAuthority();
 assert.equal(guest.unit.hp,23);assert.equal(guest.unit.maxHp,host.unit.maxHp);assert.equal(guest.unit.level,host.unit.level);
 assert.deepEqual(guest.enemy.stats.dmg,host.enemy.stats.dmg);assert.equal(guest.enemy.stats.xp,host.enemy.stats.xp);assert.equal(guest.enemy.stats.respawn,12);
 assert.equal(guest.enemy.state,'chase');
});

test('a direct World II visitor returning to an uncleared shore restores the original enemy stats',()=>{
 const {game,unit,enemy}=make();enemy.respawnAt(0,0);assert.ok(unit.level>=10);assert.equal(enemy.stats.respawn,12);
 game.world2.chapter=1;enemy.respawnAt(0,0);
 assert.equal(unit.level,ENEMY_STATS.scrapling.level);assert.deepEqual(enemy.stats,ENEMY_STATS.scrapling);assert.equal(unit.baseTint,'#ff2a1a');
});

test('a post-boss shore retains level scaling but restores its slower respawn timer',()=>{
 const {game,unit,enemy}=make('scavenger');enemy.respawnAt(0,0);game.journey.rustCleared=true;game.world2.chapter=1;enemy.respawnAt(0,0);
 assert.equal(unit.level,20);assert.equal(enemy.stats.respawn,ENEMY_STATS.scavenger.respawn);
 const before={hp:unit.hp,maxHp:unit.maxHp};unit.hp-=5;enemy.resumeAuthority();assert.equal(unit.hp,before.hp-5);assert.equal(unit.maxHp,before.maxHp);
 assert.equal(unit.baseTint,'#ffb020');
});

test('guest chapter appearance refresh does not resurrect or heal a mirrored dead enemy',()=>{
 const {game,unit,enemy}=make();enemy.respawnAt(0,0);unit.hp=0;unit.alive=false;enemy.state='dead';
 game.world2.chapter=1;enemy.refreshAppearance();
 assert.equal(unit.baseTint,'#ff2a1a');assert.equal(unit.hp,0);assert.equal(unit.alive,false);assert.equal(enemy.state,'dead');
});
