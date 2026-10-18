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
  if(phase>1)h.b.actor.hp=h.b.actor.maxHp*(phase===2?(h.b.isEndgame?.7:.5):(h.b.isEndgame?.3:.2));
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

for(const [profile,expected] of Object.entries({rust:[3,1300,1,1],abyss:[10,2600,2.1,.85],eclipse:[20,6200,3.2,.78],dawn:[100,24000,20,.95]})){
  test(`${profile} actual HP, level, damage/tempo, phases and timing`,()=>{
    const h=fight(profile);assert.deepEqual([h.b.actor.level,h.b.actor.maxHp,h.b.stats.damage,h.b.stats.tempo],expected);
    const at=advanceTo(h,profile==='dawn'?'cross':'slam');
    assert.equal(at.level,expected[0]);assert.ok(Math.abs(at.seconds-(profile==='dawn'?3.1*.95:1.5*expected[3]))<1e-12);
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
  const w=advanceTo(h,'cross'),at=w.shapes[0].at;for(const p of h.ps){p.x=at.x;p.z=at.z;}assert.deepEqual(finish(h),[0,2400]);
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
  const cases=[['slam',1,.26,2],['spray',1,null,1.8],['undertow',2,.24,3],['cross',1,.24,3.1*.95],['barrage',1,.22,3*.95],['nova',1,.30,2.4],['eclipse',2,.34,2.8]];
  for(const [kind,phase,fraction,warning] of cases){
    const h=fight('dawn',[99,100]),w=advanceTo(h,kind,phase),shape=w.shapes[0],at=shape.at;
    assert.equal(w.seconds,warning,kind);assert.equal(w.shapes.length,kind==='cross'?4:kind==='barrage'?5:kind==='eclipse'||kind==='undertow'?2:1);
    const x=kind==='eclipse'?at.x+5:kind==='spray'?at.x+Math.sin(shape.yaw)*5:at.x;
    const z=kind==='spray'?at.z+Math.cos(shape.yaw)*5:at.z;
    for(const p of h.ps){p.x=x;p.z=z;}const delta=finish(h);
    assert.equal(delta[0],0,`${kind} excludes99`);
    if(fraction!==null)assert.equal(delta[1],Math.round(10000*fraction),kind);else{assert.ok(delta[1]>=120&&delta[1]<=180);assert.equal(h.ps[1].rust,1);}
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

function actualFrost(){
  const area=realCreatureArea('frost-real','w4','frost');
  const low=area.attachFresh('frost-299','priest','human','spawn'),high=area.attachFresh('frost-300','priest','human','spawn');
  const p299=area.services.player(low),p300=area.services.player(high),u299=area.services.getUnit(low),u300=area.services.getUnit(high);
  u299.level=299;u300.level=300;u299.hp=u299.maxHp=u300.hp=u300.maxHp=10000;
  p299.state.flags.abyssCleared=p300.state.flags.abyssCleared=true;
  const boss=[...area.bosses.values()][0];boss.wake();for(let i=0;i<75;i++)area.step(new Map());
  assert.equal(boss.state,'fight');return {area,boss,p299,p300,u299,u300};
}
function frostWarning(h,kind,phase){
  if(phase>1)h.boss.actor.hp=h.boss.actor.maxHp*(phase===2?.7:.3);
  h.area.drainEvents();
  for(let i=0;i<10000;i++){
    h.area.step(new Map());h.u300.hp=h.u300.maxHp;h.u299.hp=h.u299.maxHp;
    const event=h.area.drainEvents().map(r=>r.event).find(e=>e.type==='telegraph'&&e.mech===kind);
    if(event){h.area.services.cancelPendingHit(h.boss.unit);return event;}
  }
  throw Error(`No actual Frost ${kind}`);
}
test('five current profiles preserve independent HP, damage, tempo, coins and XP values',()=>{
  const values={rust:[3,1300,1,1,150,500],abyss:[10,2600,2.1,.85,500,1000],eclipse:[20,6200,3.2,.78,1200,1500],dawn:[100,24000,20,.95,5000,3200],frost:[300,90000,38,.9,15000,18000]};
  for(const [profile,want]of Object.entries(values)){const p=BOSS_PROFILES[profile];assert.deepEqual([p.level,p.hp,p.damage,p.tempo,p.coins,p.reward],want);assert.ok(Object.isFrozen(p));}
});
test('actual Frost excludes 299 from both combat directions, targeting and blessing alongside 300',()=>{
  const h=actualFrost(),{area,boss,u299,u300}=h;assert.equal(u299.encounterBlessing,false);assert.equal(u300.encounterBlessing,true);
  const hp=boss.actor.hp;assert.equal(area.services.combat.damage(u299.ref,boss.unit,100),0);assert.equal(boss.actor.hp,hp);
  assert.equal(area.services.combat.damage(u300.ref,boss.unit,100),100);assert.equal(boss.actor.hp,hp-100);
  const lowHp=u299.hp;assert.equal(area.services.combat.damage(boss.unit,u299.ref,100),0);assert.equal(u299.hp,lowHp);
  assert.equal(area.services.combat.damage(boss.unit,u300.ref,100),100);
  boss.actor.stunUntil=area.services.time+100;const warning=frostWarning(h,'eclipse',1);assert.equal(warning.level,300);assert.equal(boss.state,'fight');
});
test('actual Frost seven mechanics use exact warnings, fractions and three-axis/seven-circle shapes',()=>{
  const cases=[['slam',1,.26,2],['spray',1,null,1.8],['undertow',1,.24,3],['cross',2,.24,3.1*.9],['barrage',1,.22,3*.9],['nova',2,.30,2.4],['eclipse',1,.34,2.8]];
  for(const [kind,phase,fraction,seconds]of cases){
    const h=actualFrost(),w=frostWarning(h,kind,phase),shape=w.shapes[0],at=shape.at;
    assert.equal(w.seconds,seconds,kind);assert.equal(w.shapes.length,kind==='cross'?3:kind==='barrage'?7:kind==='eclipse'||kind==='undertow'?2:1,kind);
    if(kind==='cross'){for(let i=0;i<3;i++){assert.ok(Math.abs(w.shapes[i].yaw-shape.yaw-i*Math.PI/3)<1e-12);assert.equal(w.shapes[i].color,'#75e9ff');assert.equal(w.shapes[i].halfLength,15);assert.equal(w.shapes[i].halfWidth,1.4);}}
    if(kind==='barrage'){const yaw=h.boss.debugState().mech.yaw,offsets=[[0,0],[7,0],[-7,0],[3.5,6],[-3.5,6],[3.5,-6],[-3.5,-6]];for(let i=0;i<7;i++){const p=w.shapes[i],dx=p.at.x-at.x,dz=p.at.z-at.z;assert.ok(Math.abs(dx*Math.cos(yaw)-dz*Math.sin(yaw)-offsets[i][0])<1e-10);assert.ok(Math.abs(dx*Math.sin(yaw)+dz*Math.cos(yaw)-offsets[i][1])<1e-10);assert.equal(p.radius,3);}}
    const x=at.x+(kind==='eclipse'?5:kind==='spray'?Math.sin(shape.yaw)*5:0),z=at.z+(kind==='spray'?Math.cos(shape.yaw)*5:0);
    Object.assign(h.u299,{x,z});Object.assign(h.u300,{x,z});h.u299.hp=h.u300.hp=10000;
    let hit;for(let i=0;i<200&&!hit;i++){h.area.step(new Map());const events=h.area.drainEvents().map(r=>r.event);assert.ok(!events.some(e=>e.type==='damage'&&e.src?.id===h.boss.unit.id&&e.dst.id===h.u299.ref.id),`${kind} never damages299`);hit=events.find(e=>e.type==='damage'&&e.src?.id===h.boss.unit.id&&e.dst.id===h.u300.ref.id);}
    assert.ok(hit,kind);if(fraction===null){assert.ok(hit.amount>=228&&hit.amount<=342);assert.equal(h.u300.rust,1);}else assert.equal(hit.amount,Math.round(10000*fraction),kind);
  }
});

test('actual dead-to-rematch allocates one fresh boss life and invalidates old transient references',()=>{
  const area=realCreatureArea('rematch-life','w3','dawn'),ref=area.attachFresh('hero','priest','human','spawn'),other=area.attachFresh('other','priest','human','spawn'),p=area.services.player(ref),q=area.services.player(other),u=area.services.getUnit(ref),boss=[...area.bosses.values()][0];
  u.level=100;u.hp=u.maxHp=10000;p.state.flags.abyssCleared=true;p.state.nextSwing=q.state.nextSwing=1e6;
  boss.wake();for(let i=0;i<75;i++)area.step(new Map());const initial=boss.unit;assert.equal(initial.life,1);
  area.services.combat.damage(ref,boss.unit,boss.actor.hp+1);for(let i=0;i<320;i++)area.step(new Map());assert.equal(boss.state,'dead');assert.equal(area.pendingGrants().length,1);
  const old={...boss.unit};p.state.target=old;p.state.cast={ability:'smite',start:area.services.time,end:area.services.time+100,target:old};
  u.pendingHit={left:10,plan:{attack:'warrior-auto',source:ref,target:old}};
  const unrelated={attack:'warrior-auto',source:other,target:ref};area.services.getUnit(other).pendingHit={left:20,plan:unrelated};
  const flight=(source,target)=>area.services.launch({source,target,x:-100,y:1,z:-100,style:'holy',speed:1,hit:{attack:'ranged-auto',source,target,school:'holy'},anchorVersion:area.services.actionData.version});
  flight(ref,old);flight(old,ref);const keep=flight(ref,other);
  area.timers.schedule(area.services.time+100,{kind:'bossWake',boss:old});const keepTimer=area.timers.schedule(area.services.time+100,{kind:'echoSpawn',spawnId:'unrelated'});
  boss.actor.stunUntil=boss.actor.slowUntil=boss.actor.rustUntil=boss.actor.absorbUntil=boss.actor.pushTime=100;
  boss.actor.rust=4;boss.actor.absorb=200;boss.actor.pushX=3;boss.actor.pushZ=4;boss.phase=3;boss.enraged=true;
  boss.wake();assert.equal(boss.state,'waking');assert.equal(boss.unit.id,old.id);assert.equal(boss.unit.life,old.life+1);assert.equal(area.services.getUnit(old),null);assert.equal(area.services.controller(boss.unit),boss);
  assert.equal(p.state.target,null);assert.equal(p.state.cast,null);assert.equal(u.pendingHit,null);assert.deepEqual(area.services.getUnit(other).pendingHit.plan,unrelated);
  assert.deepEqual([...area.projectiles.keys()],[keep]);assert.deepEqual(area.timers.snapshot().map(t=>t.id),[keepTimer]);assert.equal(boss.actor.actions.length,0);assert.equal(boss.actor.hp,24000);assert.equal(boss.actor.alive,true);assert.equal(boss.phase,1);assert.equal(boss.enraged,false);assert.deepEqual([boss.actor.stunUntil,boss.actor.slowUntil,boss.actor.rustUntil,boss.actor.rust,boss.actor.absorb,boss.actor.pushTime,boss.actor.pushX,boss.actor.pushZ],[0,0,0,0,0,0,0,0]);
  const life=boss.unit.life;boss.wake();assert.equal(boss.unit.life,life,'repeated wake while waking cannot allocate another life');assert.equal(area.pendingGrants().length,1,'earned previous-life grant remains retained');assert.equal(p.state.flags.finalCleared,true);
  const hp=u.hp;area.services.resolveHit({attack:'boss-claw',source:old,target:ref});assert.equal(u.hp,hp,'stale old-life attack cannot land');
});

test('actual Area baseline retains boss controller and frame observation after transient events drain',()=>{
 const {area,boss}=actualFrost();const events=area.drainEvents();assert.ok(events.some(r=>r.event.type==='boss'&&r.event.stage==='engage'));
 const observed=area.snapshot().recovery.bosses[0];assert.equal(observed.profile,'frost');assert.equal(observed.state,'fight');assert.equal(observed.showFrame,true);assert.equal(observed.phase,1);assert.deepEqual(observed.freed,boss.freed.ref);assert.ok(Object.isFrozen(observed));
 boss.actor.hp=boss.actor.maxHp*.3;area.step(new Map());area.drainEvents();const phase=area.snapshot().recovery.bosses[0];assert.equal(phase.phase,3);assert.equal(phase.enraged,true);assert.equal(observed.phase,1);
 boss.reset();area.drainEvents();assert.equal(area.snapshot().recovery.bosses[0].showFrame,false);
});
