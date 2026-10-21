import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5218';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Snow QA'}));localStorage.setItem('cc.hintsSeen','1');});
 async function loaded(){await page.locator('.launch-notice-start').click();await page.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});}
 await page.goto(base+'/?screen=game');await loaded();
 const before=await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.unit.teleport(g.world,0,70,0);g.player.nextSwing=Infinity;g.player.unit.hp=g.player.unit.maxHp-30;g.player.unit.lastCombat=g.time+1000;g.player.resource=g.player.maxResource;document.activeElement?.blur();return {hp:g.player.unit.hp,z:g.player.unit.pos.z};});
 await page.keyboard.press('Digit3');await page.waitForFunction(()=>window.app.current.game.player.cooldowns.has('steam-blink'));
 const blink=await page.evaluate(()=>{const g=window.app.current.game;return {hp:g.player.unit.hp,z:g.player.unit.pos.z,cd:g.player.cooldowns.get('steam-blink')};});assert.equal(blink.hp,before.hp+10);assert.equal(blink.z,before.z+8);assert.equal(blink.cd.end-blink.cd.start,15);
 await page.keyboard.press('Digit3');await page.locator('.ab-slot').nth(2).click();assert.equal(await page.evaluate(()=>window.app.current.game.player.unit.hp),blink.hp);
 console.log('PASS native mage 3 heals 10 HP, blinks 8m, repeat input/click blocked for 15s');
 const route=await page.evaluate(()=>{const g=window.app.current.game;const before=g.player.xp;const locked=g.world2.go(4);g.journey.rustCleared=g.journey.abyssCleared=g.journey.trueCleared=g.journey.finalCleared=true;g.player.restoreXp(22000+2200*279+100*279*278);const xp=g.player.xp;g.world2.go(3);g.player.unit.teleport(g.world,14,84);const label=g.world2.portalLabel();g.world2.travel();return {locked,before,chapter:g.world2.chapter,label,xp,after:g.player.xp,trees:g.world2.fourth.root.userData.snowPines};});
 assert.equal(route.locked,false);assert.equal(route.chapter,4);assert.equal(route.xp,route.after);assert.ok(route.label.includes('4'));assert.ok(route.trees>80);
 const card=page.locator('.bj-card.frost');await page.evaluate(()=>{const g=window.app.current.game;g.journey.root.open=true;g.journey.refreshLanguage();});await card.waitFor();assert.equal(await card.getByRole('button').isDisabled(),true);
 await page.evaluate(()=>{const g=window.app.current.game;g.frostBoss.wake();});assert.equal(await page.evaluate(()=>window.app.current.game.frostBoss.state),'dormant');
 await page.screenshot({path:'tmp/qa/snow-village.png'});
 // The actual NPC quest UI offers the snowfield patrol in this chapter.
 const quest=await page.evaluate(()=>{const g=window.app.current.game;return {chapter:g.quests.chapter,available:g.quests.status.s1,npcs:g.npcs.filter(n=>!n.unit.hidden).length,returnLabel:g.world2.portalLabel()};});assert.equal(quest.chapter,4);assert.equal(quest.available,'available');assert.ok(quest.npcs>0);assert.ok(quest.returnLabel.includes('3'));
 await page.evaluate(()=>{const g=window.app.current.game;g.journey.save();});await page.reload();await loaded();
 assert.equal(await page.evaluate(()=>window.app.current.game.world2.chapter),4);assert.equal(await page.evaluate(()=>window.app.current.game.player.level),299);
 const roundtrip=await page.evaluate(()=>{const g=window.app.current.game;g.god=true;const xp=g.player.xp;g.world2.go(3);const third=g.world2.chapter;g.world2.go(4);return {third,chapter:g.world2.chapter,xp,after:g.player.xp};});assert.equal(roundtrip.third,3);assert.equal(roundtrip.chapter,4);assert.equal(roundtrip.xp,roundtrip.after);
 console.log('PASS world IV story lock, snowy forest, NPC quests, level 299 lock, save/reload and 3↔4 travel preserve XP');
 await page.evaluate(()=>{const g=window.app.current.game;g.player.restoreXp(22000+2200*280+100*280*279);g.journey.root.open=true;g.journey.refreshLanguage();});
 await card.getByRole('button').click();await page.waitForFunction(()=>window.app.current.game.frostBoss.state==='fight',null,{timeout:15000});
 assert.equal(await page.evaluate(()=>window.app.current.game.frostBoss.unit.maxHp),620000);
 await page.evaluate(()=>{const g=window.app.current.game;g.frostBoss.mechIndex=0;g.frostBoss.startMech();g.follow.distance=17;});
 await page.waitForTimeout(300);await page.screenshot({path:'tmp/qa/snow-boss300.png'});
 assert.equal(await page.evaluate(()=>window.app.current.game.frostBoss.mechName),'eclipse');
 await page.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,g.frostBoss.unit,1000000);g.journey.save();});
 assert.equal(await page.evaluate(()=>window.app.current.game.journey.frostCleared),true);
 await page.reload();await loaded();assert.equal(await page.evaluate(()=>window.app.current.game.journey.frostCleared),true);assert.equal(await page.evaluate(()=>window.app.current.game.frostBoss.state),'dead');
 assert.deepEqual(errors,[]);console.log('PASS level 300 challenge, 620k HP, frost prison telegraph, victory saved, zero browser errors');
}finally{await browser.close();}
