import test from 'node:test';
import assert from 'node:assert/strict';
import { Boss } from '../src/sim/boss.ts';
import { BOSS_PROFILES } from '../src/sim/data/bosses.ts';
import { creatureHarness, realCreatureArea } from './core-enemy.test.mjs';

function fight(profile='rust',levels=[100,100]){
  const h=creatureHarness(),ps=levels.map(level=>{const p=h.unit('player',{x:0,y:0,z:3});p.level=level;p.maxHp=p.hp=10000;return p;}),u=h.unit('boss',{x:0,y:0,z:0},profile),f=h.unit('freed');
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
  for(let i=0;i<60;i++)h.step([h.b]);assert.equal(h.b.debugState().freedBowed,true);assert.ok(h.b.freed.actions.some(a=>a.id==='gesture_bow'));for(let i=0;i<400;i++)h.step([h.b]);assert.equal(h.b.state,'dead');assert.equal(h.b.actor.hidden,true);assert.equal(h.b.freed.hidden,true);assert.equal(h.b.freed.alive,false);
});
test('empty and ineligible encounters never fabricate targets or crash',()=>{
  const h=creatureHarness(),u=h.unit('boss',{x:0,y:0,z:0},'dawn'),f=h.unit('freed'),b=new Boss(h.s,u,{id:'arena',position:{x:0,y:0,z:0},yaw:0,radius:17},f,'dawn');b.wake();for(let i=0;i<200;i++)h.step([b]);assert.equal(b.state,'dormant');assert.equal(u.hidden,true);
});

test('Dawn seven mechanics preserve profile damage fractions, geometry and minimum warning time',()=>{
  const cases=[['slam',1,.5,1.6],['spray',1,null,1.3],['undertow',2,.45,3],['cross',1,.48,2.6],['barrage',1,.42,2.6],['nova',1,.58,2.4],['eclipse',2,.62,2.8]];
  for(const [kind,phase,fraction,warning] of cases){
    const h=fight('dawn',[99,100]),w=advanceTo(h,kind,phase),shape=w.shapes[0],at=shape.at;
    assert.equal(w.seconds,warning,kind);assert.equal(w.shapes.length,kind==='cross'?4:kind==='barrage'?5:kind==='eclipse'||kind==='undertow'?2:1);
    const x=kind==='eclipse'?at.x+5:kind==='spray'?at.x+Math.sin(shape.yaw)*5:at.x;
    const z=kind==='spray'?at.z+Math.cos(shape.yaw)*5:at.z;
    for(const p of h.ps){p.x=x;p.z=z;}const delta=finish(h);
    assert.equal(delta[0],0,`${kind} excludes99`);
    if(fraction!==null)assert.equal(delta[1],10000*fraction,kind);else{assert.ok(delta[1]>=192&&delta[1]<=288);assert.equal(h.ps[1].rust,1);}
  }
});

test('mechanic boundaries are strict and use half player radius padding',()=>{
  const slam=fight(),sw=advanceTo(slam,'slam'),sat=sw.shapes[0].at;
  // Circle and lane padding is half the canonical player's actual radius.
  slam.ps[0].x=sat.x+3.4+slam.ps[0].radius*.5-.001;slam.ps[0].z=sat.z;slam.ps[1].x=sat.x+3.4+slam.ps[1].radius*.5+.001;slam.ps[1].z=sat.z;assert.deepEqual(finish(slam),[2600,0]);
  const eclipse=fight('eclipse'),ew=advanceTo(eclipse,'eclipse'),eat=ew.shapes[0].at;
  eclipse.ps[0].x=eat.x+4.501;eclipse.ps[0].z=eat.z;eclipse.ps[1].x=eat.x+4.5;eclipse.ps[1].z=eat.z;assert.deepEqual(finish(eclipse),[3800,0]);
  const cross=fight(),cw=advanceTo(cross,'cross',2),lane=cw.shapes[0],a=lane.yaw;
  // Local z=8 is clear of the perpendicular lane.
  const place=(p,x,z)=>{p.x=lane.at.x+x*Math.cos(a)+z*Math.sin(a);p.z=lane.at.z-x*Math.sin(a)+z*Math.cos(a);};
  place(cross.ps[0],1.8+cross.ps[0].radius*.5-.001,8);place(cross.ps[1],1.8+cross.ps[1].radius*.5+.001,8);assert.deepEqual(finish(cross),[2800,0]);
});

test('boss claw samples enrage at impact, respects2.4 edge range and stale lives',()=>{
  const h=fight('abyss'),p=h.ps[0],u=h.b.actor;p.x=u.x;p.z=u.z;
  const before=p.hp;h.b.enraged=true;h.b.resolveHit({attack:'boss-claw',source:u.ref,target:p.ref});assert.ok(before-p.hp>=18&&before-p.hp<=26);
  const hp=p.hp;p.x=u.x+u.radius+p.radius+2.401;h.b.resolveHit({attack:'boss-claw',source:u.ref,target:p.ref});assert.equal(p.hp,hp);
  const stale={...p.ref};h.s.respawnUnit(p.ref);p.x=u.x;h.b.resolveHit({attack:'boss-claw',source:u.ref,target:stale});assert.equal(p.hp,hp);
});

test('unavailable beacon blocks wake and engage; outside arena resets after4s grace',()=>{
  const h=creatureHarness(),p=h.unit(),u=h.unit('boss'),f=h.unit('freed');p.level=3;
  const b=new Boss(h.s,u,{id:'arena',position:{x:0,y:0,z:0},yaw:0,radius:17},f);h.s.bossAvailable=()=>false;b.wake();assert.equal(b.state,'dormant');
  const h2=fight();h2.ps.forEach(p=>p.x=100);for(let i=0;i<120;i++)h2.step([h2.b]);assert.equal(h2.b.state,'fight');h2.step([h2.b]);assert.equal(h2.b.state,'idle');
});


test('real Combat rejects incoming level99 Dawn damage but accepts level100',()=>{
  const h=fight('dawn',[99,100]),hp=h.b.actor.hp;
  assert.equal(h.s.combat.damage(h.ps[0].ref,h.b.unit,100),0);assert.equal(h.b.actor.hp,hp);
  assert.equal(h.s.combat.damage(h.ps[1].ref,h.b.unit,100),100);assert.equal(h.b.actor.hp,hp-100);
});

test('hidden live players receive no encounter blessing, pull, rust or damage',()=>{
  const h=fight(),hidden=h.unit();hidden.hidden=true;hidden.level=100;hidden.hp=hidden.maxHp=10000;
  const w=advanceTo(h,'undertow',2),at=w.shapes[0].at;hidden.x=at.x+4;hidden.z=at.z;
  h.step([h.b]);assert.equal(hidden.pushTime,0);assert.equal(hidden.encounterBlessing,false);finish(h);assert.equal(hidden.hp,10000);
});


test('actual Dawn Area mixed99/100 combat, death grants and freed bow use all real rules',()=>{
  const area=realCreatureArea('real-dawn','w3','dawn'),a=area.attachFresh('underlevel','priest','human','spawn'),b=area.attachFresh('eligible','priest','human','spawn');
  const p99=area.services.player(a),p100=area.services.player(b),u99=area.services.getUnit(a),u100=area.services.getUnit(b);u99.level=99;u100.level=100;p99.state.flags.abyssCleared=p100.state.flags.abyssCleared=true;
  const boss=[...area.bosses.values()][0];boss.wake();for(let i=0;i<74;i++)area.step(new Map());assert.equal(boss.state,'fight');assert.equal(u99.encounterBlessing,false);assert.equal(u100.encounterBlessing,true);
  const hp=boss.actor.hp;area.services.combat.damage(a,boss.unit,100);assert.equal(boss.actor.hp,hp);area.services.combat.damage(b,boss.unit,hp+1);assert.equal(boss.state,'dying');
  assert.equal(p100.state.flags.finalCleared,true);assert.equal(p99.state.flags.finalCleared,undefined);assert.equal(area.pendingGrants().length,1);
  for(let i=0;i<120;i++)area.step(new Map());assert.equal(boss.freed.npcId,'mira');assert.equal(boss.debugState().freedBowed,true);assert.ok(area.drainEvents().some(r=>r.event.type==='say'&&r.event.textKey==='boss.freed.thanks'));
});

test('actual assembled Area applies all seven mechanic damages with canonical clocks and player updates',()=>{
  for(const [kind,profile,world,phase,fraction] of [['slam','rust','w1',1,.26],['spray','rust','w1',1,null],['undertow','rust','w1',2,.24],['cross','rust','w1',2,.28],['barrage','rust','w1',3,.24],['nova','abyss','w1',1,.32],['eclipse','eclipse','w2',1,.38]]){
    const area=realCreatureArea(`mechanic-${kind}`,world,profile),ref=area.attachFresh('fighter','priest','human','spawn'),p=area.services.player(ref),u=area.services.getUnit(ref),boss=[...area.bosses.values()][0];
    u.level=100;u.hp=u.maxHp=10000;p.state.flags.abyssCleared=p.state.flags.rustCleared=true;p.state.quests.status.q3='active';
    if(world==='w1'){
      const input={seq:1,forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:'beacon',commands:[{kind:'channelStart',channel:'beacon',targetId:'beacon'}]};
      area.step(new Map([[ref.id,input]]));for(let i=0;i<65;i++)area.step(new Map());assert.equal(p.state.flags.beaconLit,true);
    }
    boss.wake();for(let i=0;i<75;i++)area.step(new Map());assert.equal(boss.state,'fight');
    if(phase>1)boss.actor.hp=boss.actor.maxHp*(phase===2?.5:.2);
    area.drainEvents();let warning;
    for(let i=0;i<10000&&!warning;i++){
      area.step(new Map());warning=area.drainEvents().map(r=>r.event).find(e=>e.type==='telegraph'&&e.mech===kind);u.hp=u.maxHp;
    }
    assert.ok(warning,kind);area.services.cancelPendingHit(boss.unit);
    const shape=warning.shapes[0],at=shape.at;u.x=at.x+(kind==='eclipse'?6:kind==='spray'?Math.sin(shape.yaw)*5:0);u.z=at.z+(kind==='spray'?Math.cos(shape.yaw)*5:0);u.hp=u.maxHp;
    let damage;
    for(let i=0;i<200&&!damage;i++){area.step(new Map());damage=area.drainEvents().map(r=>r.event).find(e=>e.type==='damage'&&e.src?.id===boss.unit.id&&e.dst.id===u.ref.id);}
    assert.ok(damage,kind);if(fraction!==null)assert.equal(damage.amount,Math.round(u.maxHp*fraction),kind);else assert.ok(damage.amount>=6&&damage.amount<=9);
    assert.equal(u.hp,u.maxHp-damage.amount,`${kind} HP changed through real Combat`);
  }
});

test('actual Area rust add pool stays three level1 attackers across resets with fresh lives',()=>{
  const area=realCreatureArea('real-add-pool','w1','rust'),ref=area.attachFresh('fighter','priest','human','spawn'),p=area.services.player(ref),u=area.services.getUnit(ref),boss=[...area.bosses.values()][0];
  u.level=3;u.hp=u.maxHp=10000;p.state.quests.status.q3='done';
  area.services.completeChannel(ref,{kind:'beacon',start:0,end:2,targetId:'beacon',to:{x:0,y:0,z:0}});
  boss.wake();for(let i=0;i<75;i++)area.step(new Map());boss.actor.hp=boss.actor.maxHp*.5;area.step(new Map());
  const first=boss.adds.map(e=>({...e.unit}));assert.equal(first.length,3);assert.ok(boss.adds.every(e=>e.state==='chase'&&area.services.getUnit(e.unit).level===1));assert.equal(area.enemies.size,3);
  for(let round=0;round<3;round++){
    const old=boss.adds.map(e=>({...e.unit}));boss.reset();assert.ok([...area.enemies.values()].every(e=>e.state==='gone'));
    area.step(new Map());boss.actor.hp=boss.actor.maxHp*.5;area.step(new Map());assert.equal(boss.adds.length,3);assert.equal(area.enemies.size,3);
    assert.deepEqual(boss.adds.map(e=>e.unit.id),first.map(r=>r.id));assert.ok(boss.adds.every((e,i)=>e.unit.life===old[i].life+1));assert.ok(old.every(r=>area.services.getUnit(r)===null));
  }
});
