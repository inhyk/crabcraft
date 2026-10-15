// Reach all three exploration sites through gameplay, then inspect the reading card and controls.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();g.quests.accept('w5');g.quests.track('w5');g.player.unit.teleport(g.world,-75,-35);g.follow.cut();for(const e of g.enemies)e.unit.hidden=true;});
 await page.locator('.memory-discovery').waitFor({state:'visible'});assert.equal(await page.locator('.memory-title').textContent(),'수정에 남은 노래');
 const matrix=[];
 async function checkViews(lang){
  for(const [width,height] of [[1280,800],[1024,768],[718,492],[390,844]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(180);
   const layout=await page.evaluate(()=>{
    const card=document.querySelector('.memory-discovery'),body=card.querySelector('.memory-body'),close=card.querySelector('button'),map=document.querySelector('.mm-ring'),bar=document.querySelector('.ab'),r=card.getBoundingClientRect();
    const overlap=el=>{const b=el.getBoundingClientRect();return Math.max(0,Math.min(r.right,b.right)-Math.max(r.left,b.left))*Math.max(0,Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top));};
    const b=body.getBoundingClientRect(),c=close.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+Math.min(8,b.height/2));
    return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,mapOverlap:overlap(map),actionsOverlap:overlap(bar),bodyWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,bodyHeight:body.clientHeight,bodyScrollHeight:body.scrollHeight,closeInside:c.left>=r.left&&c.right<=r.right&&c.top>=r.top&&c.bottom<=r.bottom,readable:!!hit?.closest('.memory-discovery'),title:card.querySelector('.memory-title').textContent};
   });
   assert.ok(layout.x>=0&&layout.y>=0&&layout.right<=width&&layout.bottom<=height,JSON.stringify(layout));assert.equal(layout.mapOverlap,0,JSON.stringify(layout));assert.equal(layout.actionsOverlap,0,JSON.stringify(layout));assert.ok(layout.closeInside&&layout.readable,JSON.stringify(layout));assert.ok(layout.bodyScrollWidth<=layout.bodyWidth+1,JSON.stringify(layout));assert.ok(layout.bodyHeight>20,JSON.stringify(layout));
   if(layout.bodyScrollHeight>layout.bodyHeight+1){await page.locator('.memory-body').hover();await page.mouse.wheel(0,600);await page.waitForTimeout(120);assert.ok(await page.locator('.memory-body').evaluate(el=>el.scrollTop)>0,'a compact story scrolls with the actual wheel');}
   matrix.push({lang,...layout});await page.screenshot({path:`tmp/qa/memory-${lang}-${width}.png`});
  }
 }
 await checkViews('ko');
 await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await page.getByRole('button',{name:'English',exact:true}).click();await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.app.current.game.hud.menu.open);
 assert.equal(await page.locator('.memory-title').textContent(),'A Song in the Crystals');assert.equal(await page.locator('.memory-close').getAttribute('aria-label'),'Close discovery');await checkViews('en');
 await page.keyboard.press('Escape');await page.locator('.memory-discovery').waitFor({state:'hidden'});assert.equal(await page.locator('.memory-discovery').isVisible(),false);assert.equal(await page.evaluate(()=>window.app.current.game.hud.menu.open),false,'Escape dismisses the story before opening the menu');
 await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,80,-40);g.follow.cut();});await page.locator('.memory-discovery').waitFor({state:'visible'});assert.equal(await page.locator('.memory-title').textContent(),'The Observatory Between Worlds');await checkViews('en-east');await page.getByRole('button',{name:'Close discovery',exact:true}).click();assert.equal(await page.locator('.memory-discovery').isVisible(),false);
 await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,-48);g.follow.cut();});await page.locator('.memory-discovery').waitFor({state:'visible'});assert.equal(await page.locator('.memory-title').textContent(),'A Promise Carved in Stone');assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.w5),'ready','the final memory also completes the quest');await checkViews('en-north');await page.setViewportSize({width:1280,height:800});
 await page.evaluate(()=>{const g=window.app.current.game,n=g.npcById('silvermoon');g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z+3,Math.PI);g.follow.cut();g.talkTo(n.unit);g.hud.dialogue.skipTyping();});await page.getByRole('button',{name:'Claim reward',exact:true}).click();await page.waitForFunction(()=>window.app.current.game.quests.status.w5==='done');await page.waitForFunction(()=>!window.app.current.game.hud.dialogue.isOpen);
 assert.equal(await page.locator('.memory-title').textContent(),'A Promise Carved in Stone');assert.equal(await page.locator('.cc-banner').evaluate(el=>getComputedStyle(el).visibility),'hidden','quest turn-in or level banners cannot overwrite the final story');
 await page.waitForTimeout(5000);assert.equal(await page.locator('.memory-discovery').isVisible(),true,'story reading lasts longer than an incidental 4-second banner');await page.locator('.memory-discovery').waitFor({state:'hidden',timeout:9000});
 // Repeat one genuine exploration event to verify travel clears a current discovery.
 await page.evaluate(()=>{const g=window.app.current.game;g.quests.status.w5='active';g.quests.progress.delete('w5-west');g.player.unit.teleport(g.world,-75,-35);});await page.locator('.memory-discovery').waitFor({state:'visible'});await page.evaluate(()=>window.app.current.game.hud.messages.warn('Priority warning',{persistent:true}));assert.equal(await page.locator('.memory-discovery').isVisible(),false,'persistent combat warnings take priority over story reading');await page.evaluate(()=>window.app.current.game.hud.messages.clearWarning());assert.equal(await page.locator('.memory-discovery').isVisible(),true);await page.evaluate(()=>window.app.current.game.world2.returnToShore());assert.equal(await page.locator('.memory-discovery').isVisible(),false);assert.equal(await page.evaluate(()=>window.app.current.game.world2.chapter),1);assert.deepEqual(errors,[]);
 console.log('PASS: three real exploration stories, bilingual responsive reading, live language, Escape/click/timeout, final-quest priority and chapter cleanup',JSON.stringify({matrix,errors}));
}finally{await browser.close();}
