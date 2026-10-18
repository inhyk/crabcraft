import test from 'node:test';
import assert from 'node:assert/strict';
import { createArea } from '../src/sim/area.ts';
import { realActionData } from '../src/sim/data/actions.ts';
import { CLASSES } from '../src/sim/data/classes.ts';
import { Random } from '../src/sim/random.ts';
const query={heightAt:()=>0,resolveCollision(x,z,r,out){return out.set(x,z);},raycastSolid:()=>null};
const definition={world:'w1',spawn:{id:'spawn',position:{x:0,y:0,z:0},yaw:0,radius:2},recall:{id:'recall',position:{x:0,y:0,z:0},yaw:0,radius:2},pois:{},enemies:[{id:'target',kind:'scrapling',home:{x:0,y:0,z:2},wanderRadius:0,pack:'solo',fixedLevel:1,role:'ordinary'}],bosses:[],npcs:[],interactions:[]};
const policy={enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>({desired:1,respawnSeconds:60}),damageAllowed:()=>true,canInteract:()=>true};
function fixture(classId='warrior',customQuery=query,extraDefinition={}){const area=createArea({id:`ability-${classId}`,definition:{...definition,...extraDefinition},query:customQuery,seed:42,actionData:realActionData,policy,context:{mode:'public',members:[],pvp:'disabled'},limits:{eventCount:100000,inputCommandsPerTick:32,timers:1000,projectiles:1000}}),ref=area.attachFresh(`char-${classId}`,classId,'human','spawn'),player=area.players.get(ref.id),unit=area.services.getUnit(ref),target=[...area.units.values()].find(u=>u.reaction==='hostile');target.hp=target.maxHp=5000;target.stunUntil=1e6;player.state.resource=player.state.maxResource;player.state.nextSwing=1e6;player.setTarget(target);return {area,player,unit,target};}
const step=(a,n)=>{for(let i=0;i<n;i++)a.step(new Map());};

test('numeric class catalogs have all thirteen distinct abilities and fifteen slots, deep frozen',()=>{assert.equal(Object.values(CLASSES).flatMap(c=>c.abilities).length,15);assert.equal(new Set(Object.values(CLASSES).flatMap(c=>c.abilities.map(a=>a.id))).size,13);for(const cls of Object.values(CLASSES)){assert.equal(cls.abilities[4].id,'crown-burst');assert.equal(cls.abilities[4].cooldown,60);assert.ok(Object.isFrozen(cls));assert.ok(Object.isFrozen(cls.abilities));}});

for(const classId of ['warrior','mage','priest'])test(`${classId} ultimate applies immediate seeded95..115 water damage once and keeps60s recovery`,()=>{const {area,player,target}=fixture(classId),r=new Random(area.services.random.state()),crit=r.next()<.12,expected=Math.round((95+r.next()*20)*(crit?1.75:1));const hp=target.hp;player.useAbility(5);assert.equal(hp-target.hp,expected);assert.equal(player.state.cooldowns['crown-burst'].end,60);assert.equal(player.state.resource,player.state.maxResource);assert.ok(area.drainEvents().some(r=>r.event.type==='damage'&&r.event.school==='water'));player.useAbility(5);assert.equal(hp-target.hp,expected);});

test('ultimate excludes hidden, beyond10m edge and occluded enemies',()=>{for(const exclusion of ['hidden','distance','occluded']){const {player,target}=fixture('mage',exclusion==='occluded'?{...query,raycastSolid:()=>.01}:query);if(exclusion==='hidden')target.hidden=true;if(exclusion==='distance')target.z=10+target.radius+.01;player.useAbility(5);assert.equal(target.hp,5000,exclusion);}});

test('pincer pays once and hits only after actual skill delay',()=>{const {area,player,target,unit}=fixture();player.useAbility(1);assert.equal(player.state.resource,90);assert.equal(target.hp,5000);assert.ok(unit.pendingHit.left>.26&&unit.pendingHit.left<.28);step(area,7);assert.equal(target.hp,5000);step(area,2);assert.ok(target.hp<5000);assert.equal(player.state.cooldowns['pincer-strike'].end,3);assert.ok(player.state.resource<=90);});

test('shell bash damage and stun use impact time and cancel target pending hit',()=>{const {area,player,target}=fixture();target.stunUntil=0;player.useAbility(2);assert.equal(target.hp,5000);step(area,12);assert.ok(target.hp<5000);assert.ok(target.stunUntil>=area.services.time+1.9);assert.equal(target.pendingHit,null);assert.equal(player.state.cooldowns['shell-bash'].end,8);});

test('charge generates15 rage, advances at26m/s and terminates without its own damage',()=>{const {area,player,target,unit}=fixture();target.z=10;player.state.resource=0;player.useAbility(3);assert.equal(player.state.resource,15);assert.ok(player.state.dash);step(area,5);assert.ok(unit.z>4);while(player.state.dash)step(area,1);assert.equal(player.state.dash,null);assert.equal(unit.lift,0);assert.equal(target.hp,5000);});

test('whirlpool is immediate water damage with1.6m knockback, frost cone slows only inside cone',()=>{const a=fixture();a.player.useAbility(4);assert.ok(a.target.hp<5000);assert.ok(Math.abs(Math.hypot(a.target.pushX,a.target.pushZ)*a.target.pushTime-1.6)<1e-10);const b=fixture('mage');b.player.useAbility(2);assert.ok(b.target.hp<5000);assert.equal(b.target.slowPct,.5);assert.equal(b.target.slowUntil,4);const c=fixture('mage');c.target.z=-3;c.player.useAbility(2);assert.equal(c.target.hp,5000);});

test('bubble bolt release launches a real17m/s projectile; impact cannot pay again',()=>{const {area,player,target}=fixture('mage');target.z=12;player.useAbility(1);assert.ok(player.state.cast);assert.equal(player.state.resource,120);step(area,46);assert.equal(player.state.cast,null);assert.ok(area.projectiles.size>0);assert.equal(target.hp,5000);const resource=player.state.resource,cd={...player.state.cooldowns['bubble-bolt']};step(area,45);assert.ok(target.hp<5000);assert.deepEqual(player.state.cooldowns['bubble-bolt'],cd);assert.ok(player.state.resource>=resource);});

test('blink respects numeric collision and steep ground; nova stuns and knocks5m',()=>{const a=fixture('mage',{...query,resolveCollision(x,z,r,out){return out.set(x,Math.min(z,3));}});a.player.useAbility(3);assert.equal(a.unit.z,3);const b=fixture('mage');b.target.stunUntil=0;b.player.useAbility(4);assert.ok(b.target.hp<5000);assert.equal(b.target.stunUntil,.6);assert.ok(Math.abs(Math.hypot(b.target.pushX,b.target.pushZ)*b.target.pushTime-5)<1e-10);});

test('smite and mend commit cooldown/cost only on cast release, capped heal event preserves amount',()=>{const a=fixture('priest');a.player.useAbility(1);assert.equal(a.target.hp,5000);step(a.area,46);assert.ok(a.target.hp<5000);assert.ok(a.player.state.cooldowns.smite.end>4.49);const b=fixture('priest');b.player.setTarget(null);b.unit.hp=100;b.player.useAbility(2);step(b.area,61);assert.equal(b.unit.hp,b.unit.maxHp);const heal=b.area.drainEvents().find(r=>r.event.type==='heal').event;assert.ok(heal.amount>=38.5);});

test('barnacle ward absorbs before health, reports shield hit/down, then expires',()=>{const {area,player,unit,target}=fixture('priest');player.useAbility(3);assert.equal(unit.absorb,33);assert.equal(unit.absorbUntil,10);assert.equal(area.services.combat.damage(target.ref,unit.ref,20),0);assert.equal(unit.hp,110);assert.equal(unit.absorb,13);assert.equal(area.services.combat.damage(target.ref,unit.ref,20),7);assert.equal(unit.hp,103);assert.equal(player.state.warded,false);const events=area.drainEvents().map(r=>r.event);assert.ok(events.some(e=>e.type==='ward'&&e.stage==='hit'));assert.ok(events.some(e=>e.type==='ward'&&e.stage==='down'));});

test('holy tide resolves delayed actual AoE/heal once without repeating payment',()=>{const {area,player,unit,target}=fixture('priest');unit.hp=30;player.useAbility(4);assert.equal(target.hp,5000);assert.equal(player.state.resource,100);step(area,2);assert.ok(target.hp<5000);assert.ok(unit.hp>46);assert.equal(player.state.cooldowns['holy-tide'].end,15);assert.ok(player.state.resource<101);});

test('ranged auto flight survives source death but stale life and dead target reject arrival',()=>{const a=fixture('mage');a.target.z=12;a.player.state.nextSwing=0;step(a.area,1);assert.equal(a.area.projectiles.size,1);a.area.services.combat.kill(a.unit.ref,null);step(a.area,25);assert.ok(a.target.hp<5000);const b=fixture('mage');b.target.z=12;b.player.state.nextSwing=0;step(b.area,1);b.player.respawn();step(b.area,25);assert.equal(b.target.hp,5000);const c=fixture('mage');c.target.z=12;c.player.state.nextSwing=0;step(c.area,1);c.target.alive=false;step(c.area,25);assert.equal(c.target.hp,5000);});


test('ultimate includes exactly10m target edge and ward expires on the authoritative clock',()=>{const a=fixture('mage');a.target.z=10+a.target.radius;a.player.useAbility(5);assert.ok(a.target.hp<5000);const b=fixture('priest');b.player.setTarget(null);b.player.useAbility(3);step(b.area,301);assert.equal(b.unit.absorb,0);assert.equal(b.player.state.warded,false);assert.ok(b.area.drainEvents().some(r=>r.event.type==='ward'&&r.event.stage==='down'));});

test('queued skill waits for its own cooldown, then pays once and resolves another delayed hit',()=>{const {area,player,target}=fixture();player.useAbility(1);step(area,81);assert.ok(area.services.time>=2.69&&area.services.time<2.71);player.useAbility(1);assert.equal(player.state.queued,'pincer-strike');const firstRecovery=player.state.cooldowns['pincer-strike'].end;step(area,20);assert.equal(firstRecovery,3);assert.ok(player.state.cooldowns['pincer-strike'].start>=3&&player.state.cooldowns['pincer-strike'].start<3.034);assert.equal(player.state.queued,null);assert.equal(area.drainEvents().filter(r=>r.event.type==='damage'&&r.event.dst.id===target.ref.id).length,2);});

test('warrior auto checks impact reach; a stun cancels an existing actual swing',()=>{const a=fixture();a.player.state.nextSwing=0;step(a.area,1);assert.ok(a.unit.pendingHit);a.target.z=20;step(a.area,12);assert.equal(a.target.hp,5000);const b=fixture();b.player.state.nextSwing=0;step(b.area,1);assert.ok(b.unit.pendingHit);b.unit.stunUntil=10;step(b.area,12);assert.equal(b.unit.pendingHit,null);assert.equal(b.target.hp,5000);});

test('real combat crit-scaled lethal damage invokes death only once, heals preserve reported over-heal',()=>{const {area,unit,target}=fixture();target.hp=1;assert.equal(area.services.combat.damage(unit.ref,target.ref,25,{crit:true,school:'physical'}),25);assert.equal(target.alive,false);assert.equal(target.hp,0);area.services.combat.kill(target.ref,unit.ref);assert.equal(area.drainEvents().filter(r=>r.event.type==='death'&&r.event.unit.id===target.ref.id).length,1);unit.hp=unit.maxHp-2;assert.equal(area.services.combat.heal(unit.ref,unit.ref,10,true),2);const heal=area.drainEvents().find(r=>r.event.type==='heal').event;assert.equal(heal.amount,10);assert.equal(heal.crit,true);});


test('ordered real forge transactions affect later attacks and reject purchases after entering combat',()=>{
 for(const [operation,rank,cost]of [['forgeBuy',0,100],['forgeUpgrade',3,400]])for(const forgeFirst of [true,false]){
  const {area,player,unit,target}=fixture('mage',query,{npcs:[{id:'pip',position:{x:0,y:0,z:0},yaw:0}]});player.state.coins=cost;player.state.attackRank=rank;
  const r=new Random(area.services.random.state()),crit=r.next()<.12,damage=(95+r.next()*20)*(crit?1.75:1),forge={kind:operation,npcId:'pip',slot:'weapon',request:41},ability={kind:'ability',slot:5};
  area.step(new Map([[unit.ref.id,{seq:1,forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null,commands:forgeFirst?[forge,ability]:[ability,forge]}]]));
  const expectedRank=forgeFirst?rank+1:rank;assert.equal(player.state.attackRank,expectedRank);assert.equal(player.state.coins,forgeFirst?0:cost);assert.equal(5000-target.hp,Math.round(damage*(1+expectedRank*.08)));
  const result=area.drainEvents().find(r=>r.event.type==='equipment').event;assert.equal(result.request,41);assert.equal(result.result,forgeFirst?(operation==='forgeBuy'?'bought':'upgraded'):'busy');
 }
});

// Exercise the real Area Combat so event, health cap and payment contracts stay coupled.
test('steam blink heals10 after free or blocked travel, caps HP, and preserves cost/recovery',()=>{
 for(const [blocked,missingHp,expectedGain] of [[false,25,10],[true,25,10],[true,2,2],[false,0,0]]){
  const {area,player,unit}=fixture('mage',blocked?{...query,resolveCollision(x,z,r,out){return out.set(0,0);}}:query);
  unit.hp=unit.maxHp-missingHp;
  const hp=unit.hp,resource=player.state.resource;
  area.drainEvents();player.useAbility(3);
  assert.equal(unit.z,blocked?0:8);assert.equal(unit.hp-hp,expectedGain);
  assert.equal(player.state.resource,resource-10);assert.equal(player.state.cooldowns['steam-blink'].end,15);
  const events=area.drainEvents().map(r=>r.event),heals=events.filter(e=>e.type==='heal');
  assert.equal(heals.length,1);assert.equal(heals[0].amount,10);assert.deepEqual(heals[0].src,unit.ref);assert.deepEqual(heals[0].dst,unit.ref);
  assert.ok(events.findIndex(e=>e.type==='heal')<events.findIndex(e=>e.type==='ability'&&e.ability==='steam-blink'));
  player.useAbility(3);assert.equal(unit.hp,hp+expectedGain);assert.equal(player.state.resource,resource-10);
 }
});


for(const [slot,range,fraction,ticks]of [[2,12,.35,61],[4,6,.15,2]])test(`lantern skill ${slot} heals nearby living players, excludes range/LOS/dead/hidden, preserves cooldown`,()=>{
 const {area,player,unit}=fixture('priest');const allies=[];
 for(const [name,z]of [['near',range],['far',range+.1],['hidden',1],['dead',2]]){const ref=area.attachFresh(name,'warrior','human','spawn'),p=area.players.get(ref.id),u=area.services.getUnit(ref);p.state.nextSwing=Infinity;u.z=z;u.hp=10;u.lastCombat=1e6;u.hidden=name==='hidden';u.alive=name!=='dead';allies.push(u);}
 player.useAbility(slot);step(area,ticks);
 assert.equal(allies[0].hp,10+Math.round(allies[0].maxHp*fraction));for(const u of allies.slice(1))assert.equal(u.hp,10);
 const hp=allies[0].hp;player.useAbility(slot);step(area,2);assert.equal(allies[0].hp,hp);assert.ok(player.state.cooldowns[slot===2?'mend-shell':'holy-tide'].end>area.services.time);
 const w=fixture('priest',{...query,raycastSolid:()=>0});const r=w.area.attachFresh('behind-wall','warrior','human','spawn'),u=w.area.services.getUnit(r);u.z=3;u.hp=10;u.lastCombat=1e6;w.area.players.get(r.id).state.nextSwing=Infinity;w.player.useAbility(slot);step(w.area,ticks);assert.equal(u.hp,10);
});
