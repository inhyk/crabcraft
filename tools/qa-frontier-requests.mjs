import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5231';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});await p.waitForTimeout(1000);await p.keyboard.press('Space');return p;
}
try{
 const p=await load('Frontier QA');
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.frostCleared=false;g.creatorTravel=false;if(g.world2.canTravel(5)||g.world2.canTravel(6))throw Error('frontier gate unlocked before Boreas');g.journey.rustCleared=g.journey.abyssCleared=g.journey.trueCleared=g.journey.finalCleared=g.journey.frostCleared=true;g.journey.firstEndingSeen=true;g.ending.cancel();});
 for(const chapter of [5,6]){
 await p.evaluate(chapter=>{const g=window.app.current.game;g.world2.go(chapter);g.player.xpBlessingUntil=0;},chapter);
 const ids=Array.from({length:12},(_,i)=>`r${chapter}q${i+1}`);
 const {FRONTIER_QUESTS:QUESTS}=await import('../src/game/frontierQuests.ts');
 for(const id of ids){
  const def=QUESTS[id];
  await p.evaluate(giver=>{const g=window.app.current.game,n=g.npcById(giver);g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.openNpc(n,true);},def.giver);
  await p.getByRole('button',{name:'퀘스트 받기',exact:true}).click();
  assert.equal(await p.evaluate(id=>window.app.current.game.quests.status[id],id),'active');
  await p.evaluate(id=>window.app.current.game.quests.track(id),id);
  for(const o of def.objectives){
   if(/^(ember|sky)-/.test(o.kind)&&!o.kind.endsWith('-letter')){
    assert.equal(await p.evaluate(kind=>{const g=window.app.current.game,n=(g.world2.chapter===5?g.world2.emberRequests:g.world2.skyRequests).nodes.find(n=>n.kind===kind);return g.objectivePos()?.distanceTo(n.position)<.01;},o.kind),true,'map points to '+o.kind);
    await p.evaluate(kind=>{const g=window.app.current.game,n=(g.world2.chapter===5?g.world2.emberRequests:g.world2.skyRequests).nodes.find(n=>n.kind===kind);g.player.unit.teleport(g.world,n.position.x,n.position.z);g.player.setTarget(null);g.player.unit.lastCombat=-100;},o.kind);
    if(o.kind.includes('-visit-'))await p.waitForTimeout(200);
    else if(o.kind.includes('-lamp-')){await p.keyboard.down('KeyF');await p.waitForTimeout(1900);await p.keyboard.up('KeyF');}
    else {await p.keyboard.press('KeyF');await p.waitForTimeout(180);}
    assert.equal(await p.evaluate(id=>window.app.current.game.quests.progress.get(id),o.id),1,`${id} ${o.kind}`);
   }else if(o.kind.endsWith('-letter')){
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
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.save();g.player.unit.teleport(g.world,0,80);g.follow.yaw=0;g.follow.pitch=.5;g.follow.distance=22;g.follow.cut();});
 await p.waitForTimeout(1500);await p.screenshot({path:`tmp/qa/frontier-${chapter}.png`});
 await p.reload();await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 assert.deepEqual(await p.evaluate(ids=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;return [g.world2.chapter,...ids.map(id=>g.quests.status[id])];},ids),[chapter,...ids.map(()=> 'done')]);
 console.log(`PASS World ${chapter} and all 12 completed requests survive reload`);
 }
 const route=await p.evaluate(()=>{const g=window.app.current.game,w=g.world2,out=[];g.player.unit.teleport(g.world,w.portalPosition.x,w.portalPosition.z);w.travel();out.push(w.chapter);g.player.unit.teleport(g.world,w.fifth.spawn.x,w.fifth.spawn.z);w.travel();out.push(w.chapter);g.player.unit.teleport(g.world,14,84);w.travel();out.push(w.chapter);g.player.unit.teleport(g.world,0,-72);w.travel();out.push(w.chapter);return out;});assert.deepEqual(route,[5,4,5,6]);console.log('PASS actual portal round trip VI → V → IV → V → VI');
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}finally{await browser.close();}
