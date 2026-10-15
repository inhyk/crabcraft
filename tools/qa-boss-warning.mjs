// Runs an actual isolated browser. A paused solo encounter must retain its mechanic instruction.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cc.hintsSeen','1'));
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();g.god=true;g.player.restoreXp(22000);g.player.unit.teleport(g.world,0,-62,Math.PI);const b=g.worldBoss;b.wake();b.unit.lift=0;b.engage();b.phase=2;b.unit.invulnerable=false;b.mechIndex=0;b.startMech();g.hud.messages.banner('별의 왕좌','지역 안내는 공격 경고를 가리지 않습니다','zone');});
 await page.waitForTimeout(250);
 assert.equal(await page.locator('.cc-banner.zone').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 await page.evaluate(()=>window.app.current.game.hud.menu.show());
 const before=await page.evaluate(()=>window.app.current.game.worldBoss.mech.t);await page.waitForTimeout(3100);
 const paused=await page.evaluate(()=>({time:window.app.current.game.worldBoss.mech.t,warning:document.querySelector('.msg-warn').textContent,opacity:getComputedStyle(document.querySelector('.mechanic-warning')).opacity}));assert.equal(paused.time,before);assert.equal(paused.opacity,'1');assert.match(paused.warning,/초록 원/);
 await page.evaluate(()=>window.app.current.game.hud.menu.close());
 await page.screenshot({path:'tmp/qa/boss-warning-priority.png'});
 await page.waitForFunction(()=>!window.app.current.game.worldBoss.mech);assert.equal(await page.locator('.msg-warn').textContent(),'');assert.equal(await page.locator('.messages').evaluate(el=>el.classList.contains('combat-warning')),false);
 await page.evaluate(()=>{const g=window.app.current.game;g.worldBoss.mechIndex=1;g.worldBoss.startMech();g.hud.menu.show();g.hud.menu.settings();});
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.bf-name').textContent.includes('Astra')&&document.querySelector('.bf-phase').textContent==='Phase 2');
 assert.match(await page.locator('.msg-warn').textContent(),/Starfall! Leave the purple circle/);
 await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.close();g.worldBoss.sleep();});assert.equal(await page.locator('.msg-warn').textContent(),'');
 // Clearing an older warning cannot erase a newer message owned by another encounter.
 assert.equal(await page.evaluate(()=>{const m=window.app.current.game.hud.messages,old=m.warn('old',{persistent:true});m.warn('new',{persistent:true});m.clearWarning(old);const text=document.querySelector('.msg-warn').textContent;m.clearWarning();return text;}),'new');
 assert.deepEqual(errors,[]);console.log('PASS: mechanic warning survives >3 seconds of solo pause, suppresses region clutter, ends with attack, clears on sleep, keeps newer ownership and live bilingual boss header/phase',paused);
}finally{await browser.close();}
