import test from 'node:test';import assert from 'node:assert/strict';
import {createArea} from '../src/sim/area.ts';import {realActionData} from '../src/sim/data/actions.ts';import {isAttackTarget} from '../src/sim/unit.ts';
const query={heightAt:()=>0,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
const definition={world:'w1',spawn:{id:'spawn',position:{x:0,y:0,z:0},yaw:0,radius:2},recall:{id:'recall',position:{x:0,y:0,z:0},yaw:0,radius:2},pois:{},enemies:[],bosses:[],npcs:[],interactions:[]};
function setup(pvp='party-only',mode='party-encounter'){
 const area=createArea({id:`heal-${mode}-${pvp}`,definition,query,seed:42,actionData:realActionData,policy:{enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>({desired:0,respawnSeconds:60}),damageAllowed:()=>true,canInteract:()=>true},context:{mode,members:[],pvp},limits:{eventCount:10000,inputCommandsPerTick:32,timers:100,projectiles:100}});
 const aRef=area.attachFresh('healer','priest','human','spawn'),bRef=area.attachFresh('friend','warrior','human','spawn'),a=area.services.getUnit(aRef),b=area.services.getUnit(bRef),player=area.services.player(aRef);a.hp=b.hp=40;a.lastCombat=b.lastCombat=0;b.z=3;
 area.applyContext({...area.services.context,members:area.services.context.members.map(m=>({...m,party:'party-a'}))});area.drainEvents();return{area,a,b,player};
}
const step=(area,n)=>{for(let i=0;i<n;i++)area.step(new Map());};
test('party-only PvP opponent damage lands but central healing has no health/event/RNG side effects',()=>{
 const{area,a,b}=setup();assert.equal(isAttackTarget(area.services,a,b),true);assert.equal(area.services.combat.damage(a.ref,b.ref,7),7);assert.equal(b.hp,33);assert(area.drainEvents().some(r=>r.event.type==='damage'));
 const before={hp:b.hp,combat:a.lastCombat,rng:area.services.random.state()};assert.equal(area.services.combat.heal(a.ref,b.ref,20),0);assert.deepEqual({hp:b.hp,combat:a.lastCombat,rng:area.services.random.state()},before);assert.equal(area.drainEvents().length,0);
 assert.equal(area.services.combat.heal(a.ref,a.ref,10),10);assert.equal(a.hp,50);assert.equal(area.drainEvents().filter(r=>r.event.type==='heal').length,1);
});
for(const[slot,ticks,fraction,cost,cooldown]of[[2,61,.35,18,10],[4,2,.15,20,15]])test(`lantern slot${slot} preserves self healing/payment while opponents receive no ally healing`,()=>{
 const{area,a,b,player}=setup(),hp=a.hp,beforeResource=player.state.resource,calls=[],heal=area.services.combat.heal.bind(area.services.combat);area.services.combat.heal=(src,dst,...args)=>{calls.push(dst.id);return heal(src,dst,...args);};player.useAbility(slot);step(area,ticks);const events=area.drainEvents().map(r=>r.event),selfHeals=events.filter(e=>e.type==='heal'&&e.dst.id===a.ref.id),opponentHeals=events.filter(e=>e.type==='heal'&&e.dst.id===b.ref.id);
 assert.equal(selfHeals.length,1);assert(a.hp>hp);assert.equal(opponentHeals.length,0);assert(Math.abs(player.state.resource-(beforeResource-cost+2.8*2/30))<1e-10);assert.equal(calls.includes(b.ref.id),false,'ally helper must skip opponents before calling heal');const cd=player.state.cooldowns[slot===2?'mend-shell':'holy-tide'];assert.equal(cd.end-cd.start,cooldown);
 if(slot===2)assert.equal(b.hp,40);else{assert(b.hp<40);assert(events.some(e=>e.type==='damage'&&e.dst.id===b.ref.id));assert.equal(selfHeals[0].amount,a.maxHp*fraction);}
});
for(const mode of['public','party-encounter'])for(const[slot,ticks,fraction]of[[2,61,.35],[4,2,.15]])test(`${mode} disabled-PvP same-party friends keep canonical lantern slot${slot} healing`,()=>{
 const{area,a,b,player}=setup('disabled',mode);assert.equal(isAttackTarget(area.services,a,b),false);assert.equal(area.services.combat.damage(a.ref,b.ref,7),0);player.useAbility(slot);step(area,ticks);assert.equal(b.hp,40+Math.round(b.maxHp*fraction));const events=area.drainEvents().map(r=>r.event);assert.equal(events.filter(e=>e.type==='heal'&&e.dst.id===b.ref.id).length,1);assert.equal(events.filter(e=>e.type==='damage').length,0);
});
test('central ally healing retains exact source/target life binding and delayed Holy Tide rejects dead source',()=>{
 const{area,a,b,player}=setup('disabled'),old={...a.ref};player.respawn();area.drainEvents();const hp=b.hp;assert.equal(area.services.combat.heal(old,b.ref,20),0);assert.equal(area.services.combat.heal({...a.ref,area:'another-area'},b.ref,20),0);assert.equal(area.services.combat.heal(a.ref,{...b.ref,life:b.ref.life+1},20),0);assert.equal(b.hp,hp);assert.equal(area.drainEvents().length,0);
 area.services.combat.kill(a.ref,null);area.drainEvents();area.services.resolveHit({attack:'holy-tide',source:a.ref});assert.equal(b.hp,hp);assert.equal(area.drainEvents().filter(r=>r.event.type==='heal').length,0);
});
