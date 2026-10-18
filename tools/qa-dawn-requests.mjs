import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5218';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});await p.waitForTimeout(1000);await p.keyboard.press('Space');return p;
}
try{
 const p=await load('Dawn quest QA');
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.rustCleared=g.journey.abyssCleared=g.journey.trueCleared=true;g.journey.firstEndingSeen=true;g.journey.world2Celebrated=true;for(const b of [g.boss,g.finalBoss,g.worldBoss]){b.state='dead';b.unit.alive=false;b.unit.hidden=true;}g.world2.go(3);g.quests.status.d1='done';g.quests.status.d2='done';{const n=g.npcById('brinebeard');g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.openNpc(n);}});
 await p.getByRole('button',{name:'퀘스트 받기',exact:true}).click();
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.status.d3),'active');
 for(const kind of ['dawn-crate-a','dawn-crate-b','dawn-crate-c']){
  await p.evaluate(kind=>{const g=window.app.current.game;const n=g.world2.dawnRequests.nodes.find(n=>n.kind===kind);g.player.unit.teleport(g.world,n.position.x,n.position.z);},kind);
  await p.keyboard.press('KeyF');await p.waitForTimeout(150);
 }
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.status.d3),'ready');
 const xp=await p.evaluate(()=>window.app.current.game.player.xp);
 await p.evaluate(()=>{const g=window.app.current.game;{const n=g.npcById('coralline');g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.openNpc(n);}});
 await p.getByRole('button',{name:'보상 받기',exact:true}).click();
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.status.d3),'done');
 assert.equal(await p.evaluate(()=>window.app.current.game.player.xp),xp+6000);
 console.log('PASS native NPC acceptance, three F collections and 6,000 XP turn-in');
 await p.evaluate(()=>{const g=window.app.current.game;g.quests.accept('d5');g.quests.track('d5');const n=g.world2.dawnRequests.nodes.find(n=>n.kind==='dawn-lamp-a');g.player.unit.teleport(g.world,n.position.x,n.position.z);});
 await p.keyboard.down('KeyF');await p.waitForTimeout(1900);await p.keyboard.up('KeyF');
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.progress.get('d5-a')),1);
 await p.keyboard.down('KeyF');await p.waitForTimeout(1800);await p.keyboard.up('KeyF');
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.progress.get('d5-a')),1);
 console.log('PASS hold-F lantern completes once');
 await p.evaluate(()=>{const g=window.app.current.game;g.quests.accept('d6');g.quests.track('d6');});
 for(const kind of ['dawn-visit-garden','dawn-visit-coast','dawn-visit-watch']){
  await p.evaluate(kind=>{const g=window.app.current.game,n=g.world2.dawnRequests.nodes.find(n=>n.kind===kind);g.player.unit.teleport(g.world,n.position.x,n.position.z);},kind);await p.waitForTimeout(200);
 }
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.status.d6),'ready');
 await p.evaluate(()=>{const g=window.app.current.game;g.quests.accept('d10');{const n=g.npcById('brinebeard');g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.openNpc(n);}});
 assert.equal(await p.evaluate(()=>window.app.current.game.quests.status.d10),'ready');
 await p.getByRole('button',{name:'보상 받기',exact:true}).click();
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.save();g.player.unit.teleport(g.world,0,68);g.follow.cut();});
 await p.screenshot({path:'tmp/qa/dawn-requests.png'});
 console.log('PASS three exploration landmarks and letter delivery');
 const allProps=await p.evaluate(()=>{const g=window.app.current.game;for(const id of ['d4','d8','d9','d11'])g.quests.accept(id);return g.world2.dawnRequests.nodes.filter(n=>/^dawn-(herb|ore|pearl|seal)-/.test(n.kind)).map(n=>n.kind);});
 for(const kind of allProps){
  await p.evaluate(kind=>{const g=window.app.current.game,n=g.world2.dawnRequests.nodes.find(n=>n.kind===kind);g.player.unit.teleport(g.world,n.position.x,n.position.z);},kind);
  await p.keyboard.press('KeyF');await p.waitForTimeout(120);
 }
 assert.deepEqual(await p.evaluate(()=>['d4','d8','d9','d11'].map(id=>window.app.current.game.quests.status[id])),['ready','ready','ready','ready']);
 const accessible=await p.evaluate(()=>{const g=window.app.current.game;return g.world2.dawnRequests.nodes.every(n=>{const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};g.world.resolveCollision(n.position.x,n.position.z,g.player.unit.radius,out);return Math.hypot(out.x-n.position.x,out.y-n.position.z)<3;});});assert.equal(accessible,true);
 console.log('PASS all herb, ore, pearl and seal items are accessible and collectible');
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.save();});await p.reload();await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 assert.deepEqual(await p.evaluate(()=>{const g=window.app.current.game;return [g.world2.chapter,g.quests.status.d3,g.quests.status.d4,g.quests.progress.get('d5-a')];}),[3,'done','ready',1]);
 console.log('PASS saved World III requests survive reload');
 // Exercise the actual journey payout with the same boss claim gate used by network deaths.
 const rewards=await p.evaluate(()=>{const g=window.app.current.game,result=[];for(const b of [g.boss,g.finalBoss,g.worldBoss,g.dawnBoss,g.frostBoss]){
  const xp=g.player.xp,coins=g.player.coins;b.state='dying';b.unit.alive=false;b.coinsClaimed=false;
  g.journey.onBossDefeated(b);g.journey.onBossDefeated(b);
  const first={xp:g.player.xp-xp,coins:g.player.coins-coins};
  b.coinsClaimed=false;g.journey.onBossDefeated(b);g.journey.onBossDefeated(b);
  result.push({level:b.profile.level,first,repeat:{xp:g.player.xp-xp-first.xp,coins:g.player.coins-coins-first.coins}});
 }return result;});
 for(const r of rewards){assert.ok(r.first.xp>0);assert.deepEqual(r.first,r.repeat);}
 assert.deepEqual(rewards.map(r=>r.first.xp),[500,1000,1500,3200,18000]);
 console.log('PASS all five bosses pay coins and XP on initial and repeated victories, duplicate deaths pay nothing',JSON.stringify(rewards));
 assert.deepEqual(errors,[]);console.log('PASS zero browser errors');
}finally{await browser.close();}
