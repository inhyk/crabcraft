// Exercise the real quest/dialogue/settings windows in isolated compact browsers.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_URL||'http://127.0.0.1:5192';
const probe=process.env.CC_QA_PROBE==='1';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 for(const [width,height,lang] of [[718,492,'ko'],[390,844,'en']]) {
  const page=await browser.newPage({viewport:{width,height}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(lang=>{localStorage.setItem('cc.language',lang);localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');},lang);
  await page.goto(base+'/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
  await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();});
  const inside=async selector=>{const bounds=await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight};});if(!probe)assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.w&&bounds.bottom<=bounds.h,selector+JSON.stringify(bounds));return bounds;};
  for(const id of ['brinebeard','pip','rattlebolt','grukk','silvermoon','coralline','hoofclaw']) {
   await page.evaluate(id=>{const g=window.app.current.game,n=g.npcById(id);g.hud.dialogue.close();g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z+3,Math.PI);g.follow.cut();g.talkTo(n.unit);g.hud.dialogue.skipTyping();},id);await page.waitForTimeout(350);
   const bounds=await inside('.dlg');
   if(id==='brinebeard'){console.log({width,lang,dialogue:bounds});await page.screenshot({path:`tmp/qa/compact-dialogue-${lang}${probe?'-before':''}.png`});}
   if(probe) {await page.evaluate(()=>window.app.current.game.hud.dialogue.choosePrimary());}
   else {await page.getByRole('button',{name:lang==='ko'?'퀘스트 받기':'Accept quest',exact:true}).click();}
  }
  assert.equal(await page.evaluate(()=>Object.entries(window.app.current.game.quests.status).filter(([id,s])=>id.startsWith('w')&&s==='active').length),7);
  await page.evaluate(()=>window.app.current.game.hud.questLog.toggle(true,'w7'));
  await page.waitForTimeout(250);console.log({width,lang,questLog:await inside('.qlog')});await page.screenshot({path:`tmp/qa/compact-questlog-${lang}${probe?'-before':''}.png`});
  if(!probe){await page.locator('.qlog-detail').hover();await page.mouse.wheel(0,320);await page.waitForTimeout(250);assert.ok(await page.locator('.qlog-detail').evaluate(e=>e.scrollTop)>0,'quest story scrolls with the mouse wheel');await page.locator('.qlog-item').last().scrollIntoViewIfNeeded();const scrollBefore=await page.locator('.qlog-list').evaluate(e=>e.scrollTop);await page.locator('.qlog-item').last().click();assert.equal(await page.locator('.qlog-list').evaluate(e=>e.scrollTop),scrollBefore,'selection preserves quest list position');await page.locator('.qlog-track').scrollIntoViewIfNeeded();await page.locator('.qlog-track').click();assert.equal(await page.evaluate(()=>window.app.current.game.quests.trackedQuest),'w7');await page.locator('.qlog .dlg-x').click();}
  else await page.evaluate(()=>window.app.current.game.hud.questLog.toggle(false));
  await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await page.waitForTimeout(250);
  console.log({width,lang,settings:await inside('.menu')});await page.screenshot({path:`tmp/qa/compact-settings-${lang}${probe?'-before':''}.png`});
  if(!probe){await page.getByRole('button',{name:lang==='ko'?'뒤로':'Back',exact:true}).click();await page.getByRole('button',{name:lang==='ko'?'조작 방법':'Controls',exact:true}).click();await inside('.menu');await page.getByRole('button',{name:lang==='ko'?'뒤로':'Back',exact:true}).click();}
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(probe?'Compact window probe finished':'Compact quest acceptance, tracking, settings and controls PASS');
} finally {await browser.close();}
