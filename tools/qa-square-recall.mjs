import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5205';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});const errors=[];
try {
 const p=await browser.newPage({viewport:{width:1280,height:800}});p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Recall QA'}));if(!localStorage.getItem('cc.language'))localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','high');localStorage.setItem('cc.hintsSeen','1');});
 await p.goto(base);await p.locator('.launch-notice').waitFor();assert.match(await p.locator('.launch-notice').innerText(),/충전하면서[\s\S]*컴퓨터/);await p.screenshot({path:'tmp/qa/startup-notice-ko.png'});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));
 // Explicit progression fixtures unlock the islands; travel and recall use the real game APIs and keyboard.
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.journey.rustCleared=g.journey.abyssCleared=g.journey.firstEndingSeen=g.journey.trueCleared=true;g.quests.accept('q1');g.player.restoreXp(137);});
 for(const [width,height] of [[1280,800],[834,600],[718,492]]) {
  await p.setViewportSize({width,height});
  for(const open of [false,true]) {
   await p.locator('.mp-panel').evaluate((e,open)=>{e.open=open;},open);await p.waitForTimeout(400);
   const rects=await p.evaluate(()=>{const b=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {quest:b('.qt'),mp:b('.mp-panel'),map:b('.mm-ring'),wallet:b('.coin-wallet'),stack:b('.hud-side-panels')};});
   assert.ok(rects.quest.bottom+5<=rects.mp.top,JSON.stringify(rects));assert.ok(rects.map.bottom<rects.quest.top);assert.ok(rects.mp.right<=width&&rects.quest.left>=0);assert.ok(rects.wallet.top>=rects.mp.bottom);assert.ok(rects.quest.bottom<=rects.stack.bottom);
   console.log('LAYOUT_PASS',JSON.stringify({width,height,open,rects}));
   await p.screenshot({path:`tmp/qa/recall-layout-${width}-${open?'open':'closed'}.png`});
  }
 }
 await p.setViewportSize({width:1280,height:800});await p.locator('.mp-panel').evaluate(e=>{e.open=false;});
 for(const chapter of [1,2,3]) {
  await p.evaluate(ch=>{const g=window.app.current.game;if(g.world2.chapter!==ch)assertTravel(g,ch);function assertTravel(g,ch){if(!g.world2.go(ch))throw Error('Travel blocked');}g.player.unit.teleport(g.world,10,78);g.player.velX=g.player.velZ=0;g.player.unit.lastCombat=g.time+1000;g.player.unit.hp=Math.min(g.player.unit.hp,70);g.follow.cut();},chapter);
  const before=await p.evaluate(()=>{const g=window.app.current.game;return {xp:g.player.xp,level:g.player.level,hp:g.player.unit.hp};});
  await p.keyboard.down('KeyT');await p.waitForFunction(()=>!!window.app.current.game.player.channel);await p.waitForTimeout(200);await p.keyboard.up('KeyT');await p.waitForFunction(()=>!window.app.current.game.player.channel);assert.ok(await p.evaluate(()=>window.app.current.game.player.unit.pos.z>70));
  await p.keyboard.down('KeyT');await p.waitForFunction(()=>!!window.app.current.game.player.channel);await p.keyboard.down('KeyW');await p.waitForTimeout(150);await p.keyboard.up('KeyW');await p.keyboard.up('KeyT');await p.waitForFunction(()=>!window.app.current.game.player.channel);assert.ok(await p.evaluate(()=>window.app.current.game.player.unit.pos.z>70));
  await p.keyboard.down('KeyT');await p.waitForFunction(()=>!!window.app.current.game.player.channel);await p.waitForFunction(()=>!window.app.current.game.player.channel,null,{timeout:15000});await p.keyboard.up('KeyT');
  const result=await p.evaluate(()=>{const g=window.app.current.game,u=g.player.unit,out=u.pos.clone();g.world.resolveCollision(u.pos.x,u.pos.z,u.radius,out);return {chapter:g.world2.chapter,x:u.pos.x,z:u.pos.z,xp:g.player.xp,level:g.player.level,hp:u.hp,clearance:Math.hypot(out.x-u.pos.x,out.y-u.pos.z),spawn:{x:g.world.pois.spawn.position.x,z:g.world.pois.spawn.position.z}};});
  assert.equal(result.chapter,chapter);assert.equal(result.xp,before.xp);assert.equal(result.level,before.level);assert.equal(result.hp,before.hp);assert.ok(result.clearance<.5);assert.ok(Math.abs(result.x-(chapter===1?result.spawn.x:0))<.2);assert.ok(Math.abs(result.z-(chapter===1?result.spawn.z:chapter===2?63:60))<.2);console.log('RECALL_PASS',JSON.stringify(result));
 }
 // Typing T in the multiplayer textbox must not start a recall.
 await p.locator('.mp-panel').evaluate(e=>{e.open=true;});const input=p.locator('.mp-panel input').first();await input.focus();await p.keyboard.down('KeyT');await p.waitForTimeout(2500);assert.equal(await p.evaluate(()=>!!window.app.current.game.player.channel),false);await p.keyboard.up('KeyT');
 console.log('TYPING_PASS');await input.evaluate(e=>e.blur());await p.locator('.mp-panel').evaluate(e=>{e.open=false;});await p.evaluate(()=>window.app.current.game.hud.messages.closeDiscovery());await p.keyboard.press('Escape');await p.waitForFunction(()=>window.app.current.game.hud.menu.open);await p.keyboard.down('KeyT');await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>!!window.app.current.game.player.channel),false);await p.keyboard.up('KeyT');await p.keyboard.press('Escape');await p.waitForFunction(()=>!window.app.current.game.hud.menu.open);console.log('MENU_PASS');
 await p.keyboard.down('KeyT');await p.waitForFunction(()=>!!window.app.current.game.player.channel);await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await p.waitForFunction(()=>!window.app.current.game.player.channel);await p.keyboard.up('KeyT');console.log('TYPING_MENU_BLUR_CANCEL_PASS');
 await p.evaluate(()=>localStorage.setItem('cc.language','en'));await p.goto(base);await p.locator('.launch-notice').waitFor();assert.match(await p.locator('.launch-notice').innerText(),/plugged in[\s\S]*computer/);await p.setViewportSize({width:718,height:492});const notice=await p.locator('.launch-notice').boundingBox();assert.ok(notice.y>=0&&notice.y+notice.height<=492);await p.screenshot({path:'tmp/qa/startup-notice-en-compact.png'});assert.deepEqual(errors,[]);console.log('PASS: bilingual startup, six layouts, native hold/release/movement/blur/menu/text input, three squares, unchanged XP/level/HP, collision clearance, zero page errors');
} finally {await browser.close();}
