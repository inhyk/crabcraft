import test from 'node:test';
import assert from 'node:assert/strict';
import { Boss } from '../src/sim/boss.ts';
import { BOSS_PROFILES } from '../src/sim/data/bosses.ts';
import { creatureHarness } from './core-enemy.test.mjs';

function fight(profile='rust',levels=[100,100]){
  const h=creatureHarness(),ps=levels.map(level=>{const p=h.unit('player',{x:0,y:0,z:3});p.level=level;p.maxHp=p.hp=10000;return p;}),u=h.unit('boss'),f=h.unit('freed');
  const arena={id:'arena',position:{x:0,y:0,z:0},yaw:0,radius:17},b=new Boss(h.s,u,arena,f,profile);h.controllers.set(u.ref.id,b);
  b.wake();for(let i=0;i<74;i++)h.step([b]);assert.equal(b.state,'fight');return {...h,b,ps};
}
function advanceTo(h,kind,phase=1){
  if(phase>1)h.b.actor.hp=h.b.actor.maxHp*(phase===2?(h.b.isDawn?.7:.5):(h.b.isDawn?.3:.2));
  for(let i=0;i<10000;i++){
    h.step([h.b]);const e=h.events.at(-1);const warning=h.events.findLast(e=>e.type==='telegraph'&&e.mech===kind);
    if(warning&&h.b.mechName===kind&&h.b.telegraphActive){
      // Isolate geometry from a legitimately overlapping pre-warning claw, through real cancellation API.
      h.s.cancelPendingHit(h.b.unit);return warning;
    }
    for(const p of h.ps){p.hp=p.maxHp;p.stunUntil=0;}
  }
  throw Error(`No ${kind} scheduled`);
}
function finish(h){const before=h.ps.map(p=>p.hp),start=h.s.time;while(h.b.mechName&&h.s.time-start<5)h.step([h.b]);return before.map((hp,i)=>hp-h.ps[i].hp);}

for(const [profile,expected] of Object.entries({rust:[3,1300,1,1],abyss:[10,2600,2.1,.85],eclipse:[20,6200,3.2,.78],dawn:[100,180000,32,.68]})){
  test(`${profile} actual HP, level, damage/tempo, phases and timing`,()=>{
    const h=fight(profile);assert.deepEqual([h.b.actor.level,h.b.actor.maxHp,h.b.stats.damage,h.b.stats.tempo],expected);
    const at=advanceTo(h,profile==='dawn'?'cross':'slam');
    assert.equal(at.level,expected[0]);assert.ok(Math.abs(at.seconds-(profile==='dawn'?2.6:1.5*expected[3]))<1e-12);
    h.b.actor.hp=h.b.actor.maxHp*(profile==='dawn'?.7:.5);h.step([h.b]);assert.equal(h.b.phase,2);
    h.b.actor.hp=h.b.actor.maxHp*(profile==='dawn'?.3:.2);h.step([h.b]);assert.equal(h.b.phase,3);assert.equal(h.b.enraged,true);
  });
}
test('slam .26HP circle with half radius padding and .5s stun, safe outside',()=>{
  const h=fight(),w=advanceTo(h,'slam'),c=w.shapes[0].at;Object.assign(h.ps[0],{x:c.x,z:c.z});Object.assign(h.ps[1],{x:c.x+4,z:c.z});
  const start=h.s.time,delta=finish(h);assert.deepEqual(delta,[2600,0]);assert.ok(h.ps[0].stunUntil>=h.s.time+.5-1e-10);assert.ok(h.s.time-start>=w.seconds-1/30&&h.s.time-start<=w.seconds+1/30);
});
test('spray real angular geometry, random damage and five-stack rust refresh',()=>{
  const h=fight(),w=advanceTo(h,'spray'),shape=w.shapes[0];const p=h.ps[0];p.x=shape.at.x+Math.sin(shape.yaw)*5;p.z=shape.at.z+Math.cos(shape.yaw)*5;p.rust=4;p.rustUntil=h.s.time+10;
  h.ps[1].x=shape.at.x+Math.sin(shape.yaw+Math.PI)*5;h.ps[1].z=shape.at.z+Math.cos(shape.yaw+Math.PI)*5;
  const delta=finish(h);assert.ok(delta[0]>=6&&delta[0]<=9);assert.equal(delta[1],0);assert.equal(p.rust,5);assert.equal(p.rustUntil,h.s.time+10);
});
test('undertow applies real3.2 push until final .3s then .24HP impact',()=>{
  const h=fight(),w=advanceTo(h,'undertow',2),at=w.shapes[0].at,p=h.ps[0];p.x=at.x+4;p.z=at.z;h.ps[1].x=at.x+30;h.ps[1].z=at.z;
  h.step([h.b]);assert.equal(p.pushTime,.05);assert.ok(Math.abs(Math.hypot(p.pushX,p.pushZ)-3.2)<1e-12);assert.ok(p.pushX<0);
  const delta=finish(h);assert.deepEqual(delta,[2400,0]);
});
test('cross lanes and barrage separate circles use real hit/miss geometry',()=>{
  for(const [kind,phase,fraction] of [['cross',2,.28],['barrage',3,.24]]){
    const h=fight(),w=advanceTo(h,kind,phase),at=w.shapes[0].at;
    h.ps[0].x=at.x;h.ps[0].z=at.z;h.ps[1].x=at.x+40;h.ps[1].z=at.z+40;
    const delta=finish(h);assert.deepEqual(delta,[Math.round(10000*fraction),0]);
  }
});
test('nova .32HP circle and eclipse .38HP donut exclude inner safe radius',()=>{
  const nova=fight('abyss'),nw=advanceTo(nova,'nova'),at=nw.shapes[0].at;nova.ps[0].x=at.x;nova.ps[0].z=at.z;nova.ps[1].x=at.x+7;nova.ps[1].z=at.z;assert.deepEqual(finish(nova),[3200,0]);
  const eclipse=fight('eclipse'),ew=advanceTo(eclipse,'eclipse'),c=ew.shapes[0].at;eclipse.ps[0].x=c.x+6;eclipse.ps[0].z=c.z;eclipse.ps[1].x=c.x;eclipse.ps[1].z=c.z;assert.deepEqual(finish(eclipse),[3800,0]);
});
test('Dawn mixed99/100 participants filter target, blessing, all mechanics and claw',()=>{
  const h=fight('dawn',[99,100]);assert.equal(h.ps[0].encounterBlessing,false);assert.equal(h.ps[1].encounterBlessing,true);
  const w=advanceTo(h,'cross'),at=w.shapes[0].at;for(const p of h.ps){p.x=at.x;p.z=at.z;}assert.deepEqual(finish(h),[0,4800]);
  const before=h.ps[0].hp;h.b.resolveHit({attack:'boss-claw',source:h.b.unit,target:h.ps[0].ref});assert.equal(h.ps[0].hp,before);
  const empty=fight('dawn',[100]);empty.ps[0].level=99;empty.step([empty.b]);assert.equal(empty.b.state,'idle');
});
test('rust phase2 spawns three real pooled adds, reset despawns and wipes cancel mechanics',()=>{
  const h=fight(),pool=[0,1,2].map(()=>h.enemy('scrapling',{x:0,y:0,z:0},'add'));for(const e of pool)e.despawn();let taken=0;
  h.s.spawnAdd=(boss,x,z)=>{const e=pool[taken++];if(!e)return null;e.respawnAt(x,z);e.aggro(false);return e;};
  h.b.actor.hp=h.b.actor.maxHp*.5;h.step([h.b]);assert.equal(h.b.adds.length,3);assert.ok(pool.every(e=>e.actor.alive));advanceTo(h,'undertow',2);for(const p of h.ps)p.alive=false;h.step([h.b]);assert.equal(h.b.state,'idle');assert.equal(h.b.actor.hp,h.b.actor.maxHp);assert.ok(pool.every(e=>e.state==='gone'));assert.equal(h.b.telegraphActive,false);
});
test('real Combat death kills living adds, frees crab at2.2s, bows and leaves by12s',()=>{
  const h=fight(),add=h.enemy('scrapling',{x:0,y:0,z:0},'add');h.b.adds.push(add);
  h.s.combat.damage(h.ps[0].ref,h.b.unit,h.b.actor.hp+1);assert.equal(h.b.state,'dying');assert.equal(add.state,'dead');
  for(let i=0;i<65;i++)h.step([h.b]);assert.equal(h.b.freedStarted,false);h.step([h.b]);h.step([h.b]);assert.equal(h.b.freed.hidden,false);assert.ok(h.events.some(e=>e.type==='freed'));
  for(let i=0;i<60;i++)h.step([h.b]);assert.equal(h.b.freed.npcId,'bowed');for(let i=0;i<400;i++)h.step([h.b]);assert.equal(h.b.state,'dead');assert.equal(h.b.actor.hidden,true);assert.equal(h.b.freed.hidden,true);assert.equal(h.b.freed.alive,false);
});
test('empty and ineligible encounters never fabricate targets or crash',()=>{
  const h=creatureHarness(),u=h.unit('boss'),f=h.unit('freed'),b=new Boss(h.s,u,{id:'arena',position:{x:0,y:0,z:0},yaw:0,radius:17},f,'dawn');b.wake();for(let i=0;i<200;i++)h.step([b]);assert.equal(b.state,'dormant');assert.equal(u.hidden,true);
});
