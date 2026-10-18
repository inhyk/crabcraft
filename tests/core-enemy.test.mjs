import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createArea } from '../src/sim/area.ts';
import { Enemy } from '../src/sim/enemy.ts';
import { enemyStats } from '../src/sim/data/enemies.ts';
import { Combat } from '../src/sim/combat.ts';
import { Actions } from '../src/sim/actions.ts';
import { Random } from '../src/sim/random.ts';
import { realActionData } from '../src/sim/data/actions.ts';
import { createUnit } from '../src/sim/unit.ts';

// Real controllers, Actions, Combat, numeric canonical motion and archetypes with injected terrain.
export function creatureHarness(seed=7,height=0){
  const units=new Map(),controllers=new Map(),events=[],players=[],contributions=[],deaths=[];
  const data=realActionData;
  const query={heightAt:()=>height,resolveCollision(x,z,r,out){return out.set(x,z);},raycastSolid:()=>null};
  const definition={world:'w1',spawn:{id:'spawn',position:{x:0,y:0,z:0},yaw:0,radius:2},recall:{id:'spawn',position:{x:0,y:0,z:0},yaw:0,radius:2},pois:{wreck:{id:'wreck',position:{x:0,y:0,z:100},yaw:0,radius:10}},enemies:[],bosses:[],npcs:[],interactions:[]};
  const ref=(id,life=1)=>({area:'test',id,life});let nextId=1;
  const s={id:'test',world:'w1',time:0,tick:0,query,actionData:data,definition,context:{mode:'public',members:[],pvp:'disabled'},random:new Random(seed),ids:{next:()=>nextId++},policy:{enemyLevel:spawn=>spawn.fixedLevel,enemyPopulation:()=>({desired:1,respawnSeconds:30}),damageAllowed:()=>true,canInteract:()=>true},timers:{schedule(){throw Error('Timer unused');},cancel(){}},getUnit(r){const u=units.get(r.id);return u&&r.area===u.ref.area&&r.life===u.ref.life?u:null;},controller:r=>controllers.get(r.id)??null,player:()=>null,playerByCharacter:()=>null,applyEarnedGrant(){throw Error('Rewards not owned by creatures');},players:()=>players,targetFor(r){const u=s.getUnit(r);return players.filter(p=>p.alive&&!p.hidden).slice().sort((a,b)=>Math.hypot(a.x-u.x,a.z-u.z)-Math.hypot(b.x-u.x,b.z-u.z)||a.ref.id-b.ref.id)[0]??null;},hostilesNear:()=>[],emit:e=>events.push(structuredClone(e)),startAction(r,a,h){actions.play(s.getUnit(r),a,h);},stopAction(r,id,fade){actions.stop(s.getUnit(r),id,fade);},resolveHit(plan){const c=s.controller(plan.source);if(!c?.resolveHit(plan))throw Error('Unhandled creature plan');},cancelPendingHit(r){const u=s.getUnit(r);if(u)u.pendingHit=null;},launch(){throw Error('No fake projectile');},spawnAdd:()=>null,recordContribution:(...args)=>contributions.push(args),onUnitDied:(...args)=>deaths.push(args),bossAvailable:()=>true,respawnUnit(r){const u=s.getUnit(r);u.ref=ref(r.id,r.life+1);return u.ref;},completeChannel(){throw Error('Channel unused');}};
  const actions=new Actions(data,s.emit,s.resolveHit);s.combat=new Combat(s);
  function unit(kind='player',position={x:0,y:height,z:0},archetype=['scrapling','scavenger','jellyfish'].includes(kind)?kind:kind==='boss'?'corrodius':'human'){const u=createUnit(ref(nextId++),archetype,kind,kind==='player'?'player':'hostile',data,position);units.set(u.ref.id,u);if(kind==='player')players.push(u);return u;}
  function enemy(kind='scrapling',position={x:0,y:height,z:0},role='ordinary',level=kind==='scrapling'?1:2){const u=unit(kind,position),spawn={id:`spawn-${u.ref.id}`,kind,home:{...position},wanderRadius:4,pack:'pack',fixedLevel:level,role},e=new Enemy(s,u,spawn);controllers.set(u.ref.id,e);return e;}
  function step(actors,dt=1/30){s.time+=dt;s.tick++;for(const a of actors)a.update(dt);for(const u of units.values())actions.updateHit(u,dt);for(const u of units.values())actions.update(u,dt);}
  return {s,unit,enemy,step,units,controllers,events,players,contributions,deaths,actions};
}

export function realCreatureArea(id='real-creatures',world='w1',profile=null,enemyKind=null){
  const position={x:0,y:0,z:0},spawn={id:'spawn',position,yaw:0,radius:20};
  const definition={world,spawn,recall:spawn,pois:{wreck:{id:'wreck',position:{x:0,y:0,z:100},yaw:0,radius:10}},npcs:[],interactions:[{id:'beacon',kind:'beacon',position,range:4}],enemies:enemyKind?[{id:'test-enemy',kind:enemyKind,home:{x:0,y:0,z:1.5},wanderRadius:1,pack:'one',fixedLevel:1,role:'ordinary'}]:[],bosses:profile?[{profile,arena:{id:'arena',position,yaw:0,radius:17},freedNpcId:'mira'}]:[]};
  const query={heightAt:()=>0,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
  const policy={enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>({desired:1,respawnSeconds:30}),damageAllowed:()=>true,canInteract:()=>true};
  return createArea({id,definition,query,policy,actionData:realActionData,context:{mode:'public',members:[],pvp:'disabled'},seed:19,limits:{eventCount:100000,inputCommandsPerTick:32,timers:1000,projectiles:1000}});
}
const input=(seq,commands=[],heldChannel=null)=>({seq,forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel,commands});

if(fileURLToPath(import.meta.url)===process.argv[1]){
  test('enemy claw uses real delayed Actions and Combat HP, .28s hit crossing',()=>{const h=creatureHarness(),p=h.unit('player',{x:0,y:0,z:1}),e=h.enemy();e.aggro(false);for(let i=0;i<17;i++)h.step([e]);assert.equal(p.hp,100);h.step([e]);const created=h.s.time;assert.ok(e.actor.pendingHit);for(let i=0;i<7;i++)h.step([e]);assert.equal(p.hp,100);h.step([e]);assert.ok(p.hp>=94&&p.hp<=96);assert.ok(h.s.time-created>=.28-1/30&&h.s.time-created<=.28+1/30);assert.equal(h.contributions.length,1);});
  test('pack aggro, empty Area wander, leash heal and return are real states',()=>{const h=creatureHarness(),a=h.enemy(),b=h.enemy();a.pack=[a,b];a.aggro(true);assert.equal(b.state,'chase');h.step([a,b]);assert.equal(a.state,'leash');a.actor.x=10;a.actor.hp=1;for(let i=0;i<120;i++)h.step([a]);assert.equal(a.state,'idle');assert.equal(a.actor.hp,a.actor.maxHp);for(let i=0;i<400;i++)h.step([a,b]);assert.ok(Number.isFinite(a.actor.x));});
  test('death sinks, proximity blocks respawn, successful respawn invalidates life',()=>{const h=creatureHarness(),p=h.unit(),e=h.enemy();const old=e.unit;h.s.combat.damage(p.ref,e.unit,1000);assert.equal(e.state,'dead');for(let i=0;i<1000;i++)h.step([e]);assert.equal(e.state,'dead');assert.equal(e.actor.hidden,true);p.x=100;h.step([e]);assert.equal(e.state,'idle');assert.equal(e.unit.life,old.life+1);assert.equal(h.s.getUnit(old),null);assert.equal(e.actor.hp,e.actor.maxHp);});
  test('adds never respawn and fixed level never follows highest player',()=>{const h=creatureHarness(),p=h.unit();p.level=100;const e=h.enemy('scavenger',{x:0,y:0,z:0},'add',2);assert.equal(e.actor.level,2);h.s.combat.kill(e.unit,p.ref);p.x=100;for(let i=0;i<4000;i++)h.step([e]);assert.equal(e.state,'dead');assert.equal(enemyStats('scavenger',10,2,'ordinary').hp,206);});
  test('sea cast captures ground and hits only inside1.7m at .28s',()=>{const h=creatureHarness(11,-.4),p=h.unit('player',{x:0,y:-.4,z:3}),e=h.enemy('jellyfish');e.aggro(false);while(h.s.time<.61)h.step([e]);assert.equal(h.events.filter(e=>e.type==='attack'&&e.attack==='enemy-sea-cast'&&e.stage==='start').length,1);p.x=2;for(let i=0;i<10;i++)h.step([e]);assert.equal(p.hp,100);assert.ok(h.events.some(e=>e.type==='attack'&&e.stage==='hit'));});
  test('scavenger .75s leap lands real damage and bounded arc',()=>{const h=creatureHarness(),p=h.unit('player',{x:0,y:0,z:7}),e=h.enemy('scavenger');h.s.time=3;e.aggro(false);h.step([e]);assert.equal(e.actor.actions.at(-1).id,'jump');let maxLift=0;for(let i=0;i<23;i++){h.step([e]);maxLift=Math.max(maxLift,e.actor.lift);}assert.ok(maxLift>2.19&&maxLift<=2.2);assert.ok(p.hp>=89&&p.hp<=92);assert.equal(e.actor.lift,0);});
  test('seeded constructors and wander preserve full future state without observers drawing RNG',()=>{const a=creatureHarness(3),b=creatureHarness(3),c=creatureHarness(4),ea=a.enemy(),eb=b.enemy(),ec=c.enemy();for(let i=0;i<500;i++){a.step([ea]);a.s.random.state();ea.debugState();b.step([eb]);c.step([ec]);}assert.deepEqual(ea.debugState(),eb.debugState());assert.equal(a.s.random.state(),b.s.random.state());assert.notDeepEqual(ea.debugState(),ec.debugState());});
  test('stale source and target plans cannot mutate HP after respawn',()=>{const h=creatureHarness(),p=h.unit('player',{x:0,y:0,z:1}),e=h.enemy(),old=e.unit;e.respawnAt(0,0);e.resolveHit({attack:'enemy-claw',source:old,target:p.ref});assert.equal(p.hp,100);h.s.respawnUnit(p.ref);e.resolveHit({attack:'enemy-claw',source:e.unit,target:{...p.ref,life:1}});assert.equal(p.hp,100);});
  test('sea cast actual damage, stun, chapter and range guards use impact state',()=>{
    for(const mode of ['hit','stun','chapter','range']){
      const h=creatureHarness(12,-.4),p=h.unit('player',{x:0,y:-.4,z:3}),e=h.enemy('jellyfish');e.aggro(false);
      while(!e.actor.pendingHit)h.step([e]);const plan=structuredClone(e.actor.pendingHit.plan);
      if(mode==='stun')e.actor.stunUntil=h.s.time+2;
      if(mode==='chapter')h.s.world='w2';if(mode==='range')p.z=30;
      for(let i=0;i<9;i++)h.step([e]);
      if(mode==='hit')assert.ok(p.hp>=91&&p.hp<=94);else assert.equal(p.hp,100);
      assert.equal(plan.at.z,3);
    }
  });
  test('jellyfish cannot pursue onto dry terrain and returns home through leash',()=>{
    const h=creatureHarness(4,-.4),p=h.unit('player',{x:0,y:0,z:8}),e=h.enemy('jellyfish');
    h.s.query.heightAt=(x,z)=>z>1?0:-.4;e.aggro(false);for(let i=0;i<100;i++)h.step([e]);
    assert.ok(e.actor.z<=1);assert.ok(['idle','chase','leash'].includes(e.state));assert.equal(p.hp,100);
  });

  test('explicit host population zero suppresses ordinary respawn',()=>{
    const h=creatureHarness(),e=h.enemy();h.s.policy.enemyPopulation=()=>({desired:0,respawnSeconds:0});h.s.combat.kill(e.unit,null);
    for(let i=0;i<300;i++)h.step([e]);assert.equal(e.state,'dead');h.s.policy.enemyPopulation=()=>({desired:1,respawnSeconds:0});h.step([e]);assert.equal(e.state,'idle');
  });

  test('actual Area intent to real enemy HP, death and full rewards uses canonical motion data',()=>{
    const area=realCreatureArea('trace','w1',null,'scrapling'),ref=area.attachFresh('hero','warrior','human','spawn'),p=area.services.player(ref),e=[...area.enemies.values()][0];
    p.state.resource=100;const target=e.unit;area.step(new Map([[ref.id,input(1,[{kind:'target',target}])]]));
    assert.equal(area.services.getUnit(target).hp,42);
    for(let i=0;i<400&&e.state!=='dead';i++)area.step(new Map());
    assert.equal(e.state,'dead');assert.equal(p.state.xp,20);assert.equal(p.state.coins,5);const events=area.drainEvents();assert.ok(events.some(r=>r.event.type==='damage'));assert.ok(events.some(r=>r.event.type==='death'));assert.ok(events.some(r=>r.event.type==='reward'));assert.equal(area.pendingGrants().length,1);
  });
  test('actual Areas interleave seeded AI with read-only debug and independent empty populations',()=>{
    const a=realCreatureArea('independent','w1',null,'scavenger'),b=realCreatureArea('independent','w1',null,'scavenger'),noise=realCreatureArea('noise','w1',null,'scrapling');
    for(let i=0;i<200;i++){a.step(new Map());a.snapshot();a.debugState();noise.step(new Map());b.step(new Map());}
    assert.deepEqual(a.debugState(),b.debugState());assert.deepEqual(a.drainEvents(),b.drainEvents());
  });

}
