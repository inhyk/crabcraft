// GPU browser QA: run a Vite preview on port 5192, then node tools/qa-starhaven.mjs.
// Uses isolated browser storage; battle kills are injected through the real combat pipeline.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,{},{timeout:90000});
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();});
 const talk=async id=>{await page.evaluate(id=>{const g=window.app.current.game,n=g.npcById(id);g.hud.dialogue.close();g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z+3,Math.PI);g.follow.cut();g.talkTo(n.unit);g.hud.dialogue.skipTyping();},id);};
 for(const id of ['brinebeard','pip','rattlebolt','grukk','silvermoon','coralline','hoofclaw']){await talk(id);console.log('accept',id,await page.locator('.dlg-buttons').innerText());await page.getByRole('button',{name:'퀘스트 받기',exact:true}).click();}
 assert.deepEqual(await page.evaluate(()=>Object.entries(window.app.current.game.quests.status).filter(([id])=>id.startsWith('w')).map(([,s])=>s)),Array(7).fill('active'));
 // Killing uses the real combat damage -> death -> quest pipeline, with immediate respawn to avoid waiting for timers.
 await page.evaluate(()=>{const g=window.app.current.game;for(const [kind,count] of [['scrapling',6],['scavenger',8]]){const e=g.enemies.find(e=>e.kind===kind&&!e.isAdd);for(let i=0;i<count;i++){e.respawnAt(e.home.x,e.home.z);g.combat.damage(g.player.unit,e.unit,e.unit.maxHp*2);}}});
 assert.deepEqual(await page.evaluate(()=>{const q=window.app.current.game.quests;return [q.status.w1,q.status.w4];}),['ready','ready']);
 for(const [x,z] of [[-65,22],[-80,-10],[65,12],[80,-20]]){await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);await page.waitForTimeout(200);await page.keyboard.press('KeyF');await page.waitForTimeout(200);}
 assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.w2),'ready');
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,15,0);g.follow.cut();});await page.waitForTimeout(300);
 await page.keyboard.down('KeyF');await page.waitForTimeout(350);await page.keyboard.up('KeyF');await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>window.app.current.game.quests.progress.get('w3-lamp-0')??0),0,'early release must not light the waystone');
 for(const [x,z] of [[0,15],[25,-15],[0,-45]]){await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);await page.waitForTimeout(200);await page.keyboard.down('KeyF');await page.waitForTimeout(1800);await page.keyboard.up('KeyF');await page.waitForTimeout(200);}
 assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.w3),'ready');
 for(const [x,z] of [[-75,-35],[80,-40],[0,-48]]){await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);await page.waitForTimeout(250);}
 assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.w5),'ready');
 for(const id of ['brinebeard','pip','rattlebolt','grukk','silvermoon','coralline']){await talk(id);await page.getByRole('button',{name:'보상 받기',exact:true}).click();}
 const before=await page.evaluate(()=>{const g=window.app.current.game;g.journey.save();return {xp:g.player.xp,level:g.player.level,status:{...g.quests.status}};});
 for(let i=1;i<=6;i++)assert.equal(before.status['w'+i],'done');
 await page.reload();await page.waitForFunction(()=>window.app?.current?.game?.loaded,{},{timeout:90000});
 assert.deepEqual(await page.evaluate(()=>{const g=window.app.current.game;g.god=true;return {xp:g.player.xp,level:g.player.level,status:{...g.quests.status}};}),before);
 // Portals trigger by walking through the center, without invoking the travel API.
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-999;g.player.unit.teleport(g.world,0,93,0);g.follow.cut();});await page.waitForTimeout(3500);
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,86,0);});await page.waitForFunction(()=>window.app.current.game.world2.chapter===1);
 await page.evaluate(()=>window.app.current.game.setLighthouse(false));await page.waitForTimeout(3500);console.log('shore arrival',await page.evaluate(()=>{const g=window.app.current.game;return {position:g.player.unit.pos.toArray(),portal:g.world2.portalPosition.toArray(),armed:g.world2.travelArmed,locked:g.controlsLocked,combat:g.player.inCombat};}));await page.evaluate(()=>{const g=window.app.current.game,p=g.world2.portalPosition;g.player.unit.teleport(g.world,p.x,p.z,0);});await page.waitForFunction(()=>window.app.current.game.world2.chapter===2);
 await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.app.current.game.world2.chapter),2,'arrival must not bounce back');
 assert.deepEqual(await page.evaluate(()=>window.app.current.game.world.getEnvironment()),{mood:3,beacon:false},'World II must preserve shore morning');
 await page.evaluate(()=>window.app.current.game.world2.returnToShore());assert.deepEqual(await page.evaluate(()=>window.app.current.game.world.getEnvironment()),{mood:3,beacon:false});await page.evaluate(()=>window.app.current.game.world2.enter());
 await page.evaluate(()=>{const g=window.app.current.game;g.toggleMenu();g.hud.menu.settings();});await page.getByRole('button',{name:'English',exact:true}).click();
 assert.equal(await page.locator('.hints-head').textContent(),'Getting started');assert.match(await page.locator('.menu').innerText(),/Return to World I to control the lighthouse/);
 await page.getByRole('button',{name:'한국어',exact:true}).click();assert.equal(await page.locator('.hints-head').textContent(),'처음 시작하기');
 await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.close();g.player.restoreXp(22000);g.player.unit.lastCombat=-999;g.journey.root.open=true;});
 await page.locator('.bj-card').last().getByRole('button',{name:'도전하기 →',exact:true}).click();
 await page.waitForFunction(()=>window.app.current.game.worldBoss.unit.alive&&!window.app.current.game.worldBoss.unit.hidden);
 await page.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,g.worldBoss.unit,g.worldBoss.unit.maxHp*2);});
 await page.waitForFunction(()=>window.app.current.game.ending.started,{},{timeout:15000});
 assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.w7),'done');
 assert.equal(await page.evaluate(()=>window.app.current.game.ending.dancers.length),16);
 await page.waitForTimeout(5000);await page.screenshot({path:'tmp/qa/star-true-dance.png'});await page.keyboard.press('Space');
 await page.waitForFunction(()=>window.app.current&&!window.app.current.game,{},{timeout:15000});
 console.log({quests:'all seven complete; six persisted before boss; true ending dances',level:before.level,lamp:'early release cancels; full hold completes',portals:'automatic both ways, no bounce',errors});assert.deepEqual(errors,[]);
}finally{await browser.close();}
