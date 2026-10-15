// Discover actual landmarks, then read the saved journal through the real quest log.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');
 const loaded=async()=>{await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));};
 await loaded();
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();g.quests.accept('w5');g.hud.questLog.toggle(true,'w5');for(const e of g.enemies)e.unit.hidden=true;});
 assert.equal(await page.locator('.qlog-memory').count(),0);assert.match(await page.locator('.qlog-memories').textContent(),/0\/3/);assert.equal(await page.locator('.qlog-memories').getByText('수정에 남은 노래',{exact:true}).count(),0);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.app.current.game.hud.questLog.open);
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,-75,-35);g.follow.cut();});await page.waitForFunction(()=>window.app.current.game.quests.progress.get('w5-west')===1);
 await page.keyboard.press('KeyL');await page.locator('.qlog').waitFor({state:'visible'});
 assert.equal(await page.locator('.qlog-memory').count(),1);assert.equal(await page.locator('.qlog-memory h3').textContent(),'수정에 남은 노래');assert.match(await page.locator('.qlog-memory p').textContent(),/돌아올 친구/);assert.match(await page.locator('.qlog-memories').textContent(),/1\/3/);
 await page.evaluate(()=>window.app.current.game.journey.save());await page.reload();await loaded();await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.hud.questLog.toggle(true,'w5');for(const e of g.enemies)e.unit.hidden=true;});
 assert.equal(await page.locator('.qlog-memory').count(),1);assert.equal(await page.evaluate(()=>window.app.current.game.world2.chapter),2);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.app.current.game.hud.questLog.open);
 for(const [x,z,key] of [[80,-40,'w5-east'],[0,-48,'w5-north']]){await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z);g.follow.cut();},[x,z]);await page.waitForFunction(key=>window.app.current.game.quests.progress.get(key)===1,key);}
 await page.evaluate(()=>{const g=window.app.current.game,n=g.npcById('silvermoon');g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z+3,Math.PI);g.follow.cut();g.talkTo(n.unit);g.hud.dialogue.skipTyping();});await page.getByRole('button',{name:'보상 받기',exact:true}).click();await page.waitForFunction(()=>window.app.current.game.quests.status.w5==='done');
 await page.evaluate(()=>{const g=window.app.current.game;g.journey.save();g.hud.questLog.toggle(true,'w5');});assert.equal(await page.locator('.qlog-memory').count(),3);assert.match(await page.locator('.qlog-memories').textContent(),/3\/3/);
 const views=[];
 async function inspect(language){for(const [width,height] of [[1280,800],[718,492],[390,844]]){
  await page.setViewportSize({width,height});await page.locator('.qlog-detail').evaluate(el=>el.scrollTop=0);await page.locator('.qlog-detail').hover();await page.mouse.wheel(0,650);await page.waitForTimeout(180);await page.locator('.qlog-memory').last().scrollIntoViewIfNeeded();
  const sample=await page.locator('.qlog-detail').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,top:el.scrollTop,detailHeight:el.clientHeight,total:el.scrollHeight}));assert.ok(sample.scroll<=sample.client+1,JSON.stringify(sample));assert.ok(sample.top>0,'last memory is reachable in the scrollable detail');
  const r=await page.locator('.qlog').boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=height+1,JSON.stringify(r));
  await page.screenshot({path:`tmp/qa/journal-${language}-${width}.png`});views.push({language,width,height,...sample});
 }}
 await inspect('ko');await page.setViewportSize({width:1280,height:800});await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.app.current.game.hud.questLog.open);
 await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await page.getByRole('button',{name:'English',exact:true}).click();await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.app.current.game.hud.menu.open);await page.keyboard.press('KeyL');await page.locator('.qlog').waitFor({state:'visible'});
 assert.deepEqual(await page.locator('.qlog-memory h3').allTextContents(),['A Song in the Crystals','The Observatory Between Worlds','A Promise Carved in Stone']);await inspect('en');
 await page.evaluate(()=>window.app.current.game.journey.save());await page.reload();await loaded();await page.evaluate(()=>window.app.current.game.hud.questLog.toggle(true,'w5'));assert.equal(await page.locator('.qlog-memory').count(),3);assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.w5),'done');assert.equal(await page.locator('.qlog-memory h3').first().textContent(),'A Song in the Crystals');
 assert.deepEqual(errors,[]);console.log('PASS: unknown stories hidden, actual discoveries, partial and completed save/reload, real reward button, bilingual journal and six scrollable viewports',JSON.stringify({views,errors}));
} finally {await browser.close();}
