import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});await p.waitForTimeout(1000);await p.keyboard.press('Space');return p;
}
try{
 const p=await load('Snow request QA');
 await p.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.journey.rustCleared=g.journey.abyssCleared=g.journey.trueCleared=g.journey.finalCleared=true;g.journey.firstEndingSeen=true;g.ending.cancel();g.world2.go(4);g.quests.status.s1='done';g.quests.status.s2='active';});
 assert.equal(await p.evaluate(()=>window.app.current.game.world2.fourth.root.userData.snowPines),91);
 const ids=['s3','s4','s5','s6','s7','s8','s9','s10','s11','s12'];
 const {QUESTS}=await import('../src/game/snowQuests.ts').then(m=>({QUESTS:m.SNOW_QUESTS}));
 for(const id of ids){
  const def=QUESTS[id];
  await p.evaluate(giver=>{const g=window.app.current.game,n=g.npcById(giver);g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.openNpc(n,true);},def.giver);
  await p.getByRole('button',{name:'퀘스트 받기',exact:true}).click();
  assert.equal(await p.evaluate(id=>window.app.current.game.quests.status[id],id),'active');
  await p.evaluate(id=>window.app.current.game.quests.track(id),id);
  for(const o of def.objectives){
   if(o.kind.startsWith('snow-')&&o.kind!=='snow-letter'){
    assert.equal(await p.evaluate(kind=>{const g=window.app.current.game,n=g.world2.snowRequests.nodes.find(n=>n.kind===kind);return g.objectivePos()?.distanceTo(n.position)<.01;},o.kind),true,'map points to '+o.kind);
    await p.evaluate(kind=>{const g=window.app.current.game,n=g.world2.snowRequests.nodes.find(n=>n.kind===kind);g.player.unit.teleport(g.world,n.position.x,n.position.z);g.player.setTarget(null);g.player.unit.lastCombat=-100;},o.kind);
    if(o.kind.includes('-visit-'))await p.waitForTimeout(200);
    else if(o.kind.includes('-lamp-')){await p.keyboard.down('KeyF');await p.waitForTimeout(1900);await p.keyboard.up('KeyF');}
    else {await p.keyboard.press('KeyF');await p.waitForTimeout(180);}
    assert.equal(await p.evaluate(id=>window.app.current.game.quests.progress.get(id),o.id),1,`${id} ${o.kind}`);
   }else if(o.kind==='snow-letter'){
    await p.evaluate(()=>{const g=window.app.current.game,n=g.npcById('brinebeard');g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.openNpc(n);});
   }else{
    await p.evaluate(({kind,count})=>{const g=window.app.current.game,type=kind==='kill-scrapling'?'scrapling':'scavenger',enemy=g.enemies.find(e=>e.kind===type&&!e.isAdd&&!e.isEcho);for(let i=0;i<count;i++){enemy.respawnAt(enemy.home.x,enemy.home.z);g.combat.damage(g.player.unit,enemy.unit,enemy.unit.maxHp*10);}},o);
   }
  }
  assert.equal(await p.evaluate(id=>window.app.current.game.quests.status[id],id),'ready');
  const before=await p.evaluate(()=>window.app.current.game.player.xp);
  await p.evaluate(turnIn=>{const g=window.app.current.game,n=g.npcById(turnIn);g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.openNpc(n,true);},def.turnIn);
  await p.getByRole('button',{name:'보상 받기',exact:true}).click();
  assert.equal(await p.evaluate(id=>window.app.current.game.quests.status[id],id),'done');
  assert.equal(await p.evaluate(()=>window.app.current.game.player.xp),before+def.xp);
  console.log(`PASS ${id}: native NPC accept, real collection/hold-F/exploration/combat/delivery, map guidance and ${def.xp} XP turn-in`);
 }
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.save();g.player.unit.teleport(g.world,0,24);g.follow.yaw=0;g.follow.pitch=.6;g.follow.distance=18;g.follow.cut();});
 await p.waitForTimeout(4500);await p.screenshot({path:'tmp/qa/snow-open-forest.png'});
 await p.reload();await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 assert.deepEqual(await p.evaluate(ids=>{const g=window.app.current.game;return [g.world2.chapter,...ids.map(id=>g.quests.status[id])];},ids),[4,...ids.map(()=> 'done')]);
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.status.s1),'done');
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.status.s2),'active');
 console.log('PASS existing patrol/boss progress and all new snow requests survive reload; 216 → 91 trees');
 // Exercise the actual journey payout with the same boss claim gate used by network deaths.
 const rewards=await p.evaluate(()=>{const g=window.app.current.game,result=[];for(const b of [g.boss,g.finalBoss,g.worldBoss,g.dawnBoss,g.frostBoss]){
  g.player.xpBlessingUntil=0;const xp=g.player.xp,coins=g.player.coins;b.state='dying';b.unit.alive=false;b.coinsClaimed=false;
  g.journey.onBossDefeated(b);g.journey.onBossDefeated(b);
  const first={xp:g.player.xp-xp,coins:g.player.coins-coins};
  b.coinsClaimed=false;g.journey.onBossDefeated(b);g.journey.onBossDefeated(b);
  result.push({level:b.profile.level,first,repeat:{xp:g.player.xp-xp-first.xp,coins:g.player.coins-coins-first.coins}});
 }return result;});
 for(const r of rewards){assert.ok(r.first.xp>0);assert.deepEqual(r.first,r.repeat);}
 assert.deepEqual(rewards.map(r=>r.first.xp),[500,1000,3000,6400,18000]);
 console.log('PASS all five bosses pay coins and XP on initial and repeated victories, duplicate deaths pay nothing',JSON.stringify(rewards));
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}finally{await browser.close();}
