// Run a preview on 5192. Click the real tracking button and verify navigation and persistence.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cc.hintsSeen','1'));
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');
 await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 await page.waitForFunction(()=>!document.querySelector('.loading')&&getComputedStyle(window.app.current.game.hud.root).opacity==='1');
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.quests.accept('q1');g.quests.track('q1');g.world2.enter();for(const id of ['w1','w2','w5'])g.quests.accept(id);g.hud.questLog.toggle(true,'w5');});
 await page.getByRole('button',{name:'◇ 이 퀘스트 길 안내',exact:true}).click();
 assert.equal(await page.locator('.qlog-track').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.qt-q.tracked').getAttribute('data-q'),'w5');
 assert.deepEqual(await page.evaluate(()=>{const g=window.app.current.game,p=g.objectivePos();return {quest:g.quests.current().quest,x:p.x,z:p.z};}),{quest:'w5',x:-75,z:-35});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.qlog')).opacity==='1');
 await page.screenshot({path:'tmp/qa/quest-tracking-ko.png'});
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,-75,-35,0);g.follow.cut();});
 await page.waitForFunction(()=>window.app.current.game.quests.current().objective?.kind==='explore-east');
 await page.evaluate(()=>window.app.current.game.journey.save());
 await page.reload();await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 assert.deepEqual(await page.evaluate(()=>{const g=window.app.current.game;g.god=true;return {chapter:g.world2.chapter,quest:g.quests.current().quest,objective:g.quests.current().objective.kind};}),{chapter:2,quest:'w5',objective:'explore-east'});
 await page.evaluate(()=>{const g=window.app.current.game;g.world2.returnToShore();});
 assert.equal(await page.evaluate(()=>window.app.current.game.quests.current().quest),'q1');
 await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();g.toggleMenu();g.hud.menu.settings();});
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.close();g.hud.questLog.toggle(true,'w2');});
 await page.getByRole('button',{name:'◇ Track this quest',exact:true}).click();
 assert.equal(await page.locator('.qlog-track').textContent(),'◆ Tracking this quest');
 assert.equal(await page.evaluate(()=>window.app.current.game.quests.current().objective.kind),'crystal-a');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,80,-24,Math.PI);g.follow.cut();g.follow.yaw=0;g.follow.distance=9;g.follow.pitch=.28;});
 await page.waitForTimeout(1500);
 const fade=await page.evaluate(()=>{const g=window.app.current.game,n=g.world2.nodes.find(n=>n.kind==='crystal-d');return {distance:n.mesh.position.distanceTo(g.camera.position),opacity:n.mesh.material.opacity};});
 assert.ok(fade.distance<8,'replay must put the collectible close to the camera');assert.ok(fade.opacity<.05,'a collectible covering the shell must become nearly invisible');
 await page.screenshot({path:'tmp/qa/collectible-camera-fade.png'});
 const views=[];
 for(const [view,x,z,distance] of [['ahead',80,-13,9],['side',83,-24,9],['long-sightline',80,-24,18]]){
  await page.evaluate(([x,z,distance])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,Math.PI);g.follow.cut();g.follow.yaw=0;g.follow.distance=distance;g.follow.pitch=.28;},[x,z,distance]);await page.waitForTimeout(1500);
  const sample=await page.evaluate(()=>{const g=window.app.current.game,n=g.world2.nodes.find(n=>n.kind==='crystal-d');return {distance:n.mesh.position.distanceTo(g.camera.position),opacity:n.mesh.material.opacity};});
  if(view==='ahead')assert.ok(sample.opacity>.95,'a collectible ahead remains clearly visible');
  if(view==='side')assert.ok(sample.opacity>.2,'an off-center collectible remains visible');
  if(view==='long-sightline'){assert.ok(sample.distance>8,'long view must exceed the old distance-only fade');assert.ok(sample.opacity<.05,'even distant intervening crystals must clear the shell');}
  views.push({view,...sample});
 }
 console.log('collectible camera sightline cases',views);
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,80,-21,Math.PI);g.follow.cut();});
 await page.waitForTimeout(250);await page.keyboard.press('KeyF');
 await page.waitForFunction(()=>window.app.current.game.quests.progress.get('w2-gem-3')===1);
 console.log('near-camera collectible fades and remains collectable',fade);
 assert.deepEqual(errors,[]);
 console.log('PASS: actual bilingual tracking buttons, selected tracker, changing navigation, save/reload and separate world choices; no page errors');
}finally{await browser.close();}
