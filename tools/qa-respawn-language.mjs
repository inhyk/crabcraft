// Isolated GPU replay of lethal damage, bilingual death UI and actual chapter-specific respawn.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');});
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');
 await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 await page.waitForFunction(()=>!document.querySelector('.loading'));
 const language=async(name)=>{
  await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});
  await page.getByRole('button',{name,exact:true}).click({force:true});
  await page.evaluate(()=>window.app.current.game.hud.menu.close());
 };
 const results=[];
 for(const chapter of [2,1])for(const lang of ['ko','en']){
  await language(lang==='ko'?'한국어':'English');
  const before=await page.evaluate(chapter=>{
   const g=window.app.current.game;if(chapter===2)g.world2.enter();else g.world2.returnToShore();
   const quest=chapter===2?'w1':'q1';g.quests.accept(quest);g.quests.track(quest);
   g.player.unit.teleport(g.world,chapter===2?0:40,chapter===2?40:0,0);g.follow.cut();g.god=false;
   const xp=g.player.xp,level=g.player.level,status=g.quests.status[quest],spawn=g.world.pois.spawn.position.toArray();
   g.combat.damage(null,g.player.unit,g.player.unit.maxHp*10);
   return {xp,level,quest,status,spawn};
  },chapter);
  await page.waitForSelector('.death');
  const death=await page.locator('.death').innerText();
  assert.match(death,lang==='ko'?/쓰러졌어요/:/You have fallen/i);
  assert.match(death,chapter===2?(lang==='ko'?/별빛 항구/:/Starhaven/):(lang==='ko'?/클로헤이븐/:/Clawhaven/));
  if(chapter===2&&lang==='ko'){
   // Actual settings switch while down: the existing overlay must update in place.
   await language('English');assert.match(await page.locator('.death').innerText(),/Starhaven/);
   await language('한국어');assert.match(await page.locator('.death').innerText(),/별빛 항구/);
  }
  await page.waitForFunction(()=>{const g=window.app.current.game;return g.player.unit.alive&&!g.respawning&&!document.querySelector('.death')&&g.engine.canvas.style.filter==='';},null,{timeout:20000});
  const after=await page.evaluate(quest=>{const g=window.app.current.game,p=g.player.unit;return {chapter:g.world2.chapter,x:p.pos.x,z:p.pos.z,hp:p.hp,maxHp:p.maxHp,xp:g.player.xp,level:g.player.level,status:g.quests.status[quest]};},before.quest);
  assert.equal(after.chapter,chapter);assert.ok(Math.hypot(after.x-before.spawn[0],after.z-before.spawn[2])<.1);
  assert.equal(after.hp,after.maxHp);assert.equal(after.xp,before.xp);assert.equal(after.level,before.level);assert.equal(after.status,before.status);
  await page.waitForFunction(text=>[...document.querySelectorAll('.msg-errors .info')].some(el=>el.textContent===text),chapter===2?(lang==='ko'?'껍질을 회복하고 별빛 항구의 포탈 곁으로 돌아왔어요.':'Shell mended, you return to the portal in Starhaven.'):(lang==='ko'?'껍질을 회복하고 클로헤이븐 광장으로 돌아왔어요.':'Shell mended, you return to Clawhaven Square.'),{timeout:10000});
  await page.waitForTimeout(3200);assert.equal(await page.evaluate(()=>window.app.current.game.world2.chapter),chapter,'Respawn must not bounce through the portal after cooldown');
  results.push({chapter,lang,death,after});
 }
 // Leaving the arrival radius must still re-arm ordinary walk-through travel.
 await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();g.god=true;g.player.unit.teleport(g.world,0,78,Math.PI);});
 await page.waitForTimeout(3400);
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,86,Math.PI);});
 await page.waitForFunction(()=>window.app.current.game.world2.chapter===1);
 assert.deepEqual(errors,[]);console.log('PASS: four lethal-damage respawns, real bilingual settings while dead, chapter spawn, full HP and preserved XP/quests',results);
}finally{await browser.close();}
