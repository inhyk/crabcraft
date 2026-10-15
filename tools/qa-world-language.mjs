// Runs in an isolated Chrome profile. Verifies real settings, region keys/music and persisted language.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if(!localStorage.getItem('cc.language'))localStorage.setItem('cc.language','ko');
  localStorage.setItem('cc.hintsSeen','1');
  window.loadingEvidence=[];
  new MutationObserver(()=>{const title=document.querySelector('.ld-title'),label=document.querySelector('.ld-label');if(title&&label)window.loadingEvidence.push({title:title.textContent,label:label.textContent,tip:document.querySelector('.ld-tip').textContent});}).observe(document,{subtree:true,childList:true,characterData:true});
 });
 const loaded=async()=>{await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));};
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');await loaded();
 const loading=await page.evaluate(()=>window.loadingEvidence);assert.ok(loading.length);assert.ok(loading.every(x=>x.title==='클로헤이븐'));assert.ok(loading.some(x=>/준비 중|만드는 중|불러오는 중|환영/.test(x.label)));assert.ok(loading.every(x=>x.tip.startsWith('도움말')));
 await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='클로헤이븐');
 const change=async(language)=>{await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await page.getByRole('button',{name:language,exact:true}).click();await page.evaluate(()=>window.app.current.game.hud.menu.close());};
 await change('English');await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='Clawhaven');
 await page.evaluate(()=>{const g=window.app.current.game;g.setLighthouse(false);});
 assert.match(await page.locator('.cc-banner').textContent(),/Lighthouse off.*Morning has returned/);
 const regions=[['Starhaven',0,55,'별빛 항구'],['Moonshade Crystalwood',-75,-35,'달그늘 수정 숲'],['The Fallen Star Ruins',80,-40,'무너진 별의 유적'],['The Pilgrim’s Starroad',0,-48,'순례자의 별길'],['The Star Throne',0,-75,'별의 왕좌']];
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();});
 for(const [id,x,z] of regions){console.log('English region',id);await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);await page.waitForFunction(id=>window.app.current.game.zone===id&&document.querySelector('.mm-zone').textContent===id,id);}
 await change('한국어');await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='별의 왕좌');assert.equal(await page.evaluate(()=>window.app.current.game.zone),'The Star Throne');
 for(const [id,x,z,ko] of regions){console.log('Korean region',ko);await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);await page.waitForFunction(([id,ko])=>window.app.current.game.zone===id&&document.querySelector('.mm-zone').textContent===ko,[id,ko]);}
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,55,0);g.journey.save();});
 await page.reload();await loaded();assert.equal(await page.evaluate(()=>localStorage.getItem('cc.language')),'ko');await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='별빛 항구');
 await page.evaluate(()=>window.app.current.game.world2.returnToShore());await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='클로헤이븐');
 const music=await page.evaluate(()=>{const g=window.app.current.game;g.quests.accept('q4');g.zone='The Iron Wreck';g.updateMusic(true);return {zone:g.zone,music:g.music,beacon:g.beaconLit};});assert.equal(music.music,'music-boss');assert.equal(music.beacon,false);
 assert.deepEqual(errors,[]);console.log('PASS: localized loading, actual language settings, stable region keys, all five island regions, saved language/chapter, lighthouse and original music logic',music);
}finally{await browser.close();}
