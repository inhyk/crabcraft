// Native Settings switches during a paused, fixture-staged island boss encounter.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await p.goto('http://127.0.0.1:5192/?screen=game');await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();g.player.restoreXp(22000);g.player.unit.teleport(g.world,0,-62,Math.PI);const b=g.worldBoss;b.wake();b.unit.lift=0;b.engage();b.phase=2;b.unit.invulnerable=false;b.unit.targetable=true;b.mechIndex=0;b.startMech();g.player.setTarget(b.unit);const u=g.player.unit;u.absorb=100;u.absorbUntil=g.time+60;u.blessingUntil=Infinity;u.stunUntil=g.time+60;u.slowUntil=g.time+60;u.rustUntil=g.time+60;u.rust=2;g.hud.menu.show();g.hud.menu.settings();});
 const before=await p.evaluate(()=>{const g=window.app.current.game;return {time:g.time,mech:g.worldBoss.mech.t};});
 for(const [language,button] of [['ko','한국어'],['en','English'],['ko','한국어']]){
  await p.getByRole('button',{name:button,exact:true}).click();
  // Wait for real rendering/HUD update, without manually calling frame update methods.
  await p.waitForTimeout(100);
  const state=await p.evaluate(()=>{const g=window.app.current.game;return {lang:localStorage.getItem('cc.language'),time:g.time,mech:g.worldBoss.mech.t,auras:[...document.querySelectorAll('.uf-player .aura')].map(e=>e.title),auraTimes:[...document.querySelectorAll('.uf-player .aura .time')].map(e=>e.textContent),bossNames:[g.boss.unit.name,g.finalBoss.unit.name,g.worldBoss.unit.name],target:document.querySelector('.uf-target .uf-name').textContent,subtitle:document.querySelector('.bf-sub').textContent,warning:document.querySelector('.msg-warn').textContent,stacks:document.querySelector('.uf-player .aura .stack')?.textContent};});
  console.log('LIVE_COMBAT_LANGUAGE',state);
  if(!process.env.CC_QA_PROBE){assert.equal(state.lang,language);assert.equal(state.time,before.time);assert.equal(state.mech,before.mech);assert.equal(state.stacks,'2');assert.deepEqual(state.auraTimes,language==='ko'?['60초','','60초','60초','60초']:['60s','','60s','60s','60s']);assert.deepEqual(state.auras,language==='ko'?['따개비 보호막','달빛 연못의 축복','기절','서리 분사','녹']:['Barnacle Ward','Moonwater Blessing','Stunned','Frost Spray','Rust']);assert.match(state.target,language==='ko'?/아스트라.*보스/:/Astra.*Boss/);assert.ok(state.bossNames.every(n=>/[가-힣]/.test(n)===(language==='ko')));assert.match(state.subtitle,language==='ko'?/^레벨 20/:/^LEVEL 20/);assert.match(state.warning,language==='ko'?/초록 원/:/green circle/);}
  await p.evaluate(()=>window.app.current.game.hud.menu.el.classList.add('hidden'));
  await p.locator('.mechanic-warning').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  for(const [width,height] of [[1280,800],[718,492]]){
   await p.setViewportSize({width,height});
   await p.waitForFunction(()=>{const c=window.app.current.game.engine.canvas;return c.clientWidth===innerWidth&&c.clientHeight===innerHeight;});
   await p.locator('.bf').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const layout=await p.evaluate(()=>{const row=document.querySelector('.uf-target .uf-name'),name=row.firstElementChild,tag=row.querySelector('.tag'),r=row.getBoundingClientRect(),n=name.getBoundingClientRect(),b=tag.getBoundingClientRect();return {row:[r.x,r.right],name:[n.x,n.right],tag:[b.x,b.right],fullName:name.title,unitName:window.app.current.game.player.target.name,overflow:getComputedStyle(name).textOverflow};});
   console.log('TARGET_NAME_LAYOUT',language,width,layout);
   if(!process.env.CC_QA_PROBE){assert.ok(layout.tag[1]<=layout.row[1]+.5);assert.ok(layout.tag[0]>=layout.name[1]+5);assert.equal(layout.fullName,layout.unitName);assert.equal(layout.overflow,'ellipsis');}
   await p.screenshot({path:`tmp/qa/combat-language-${language}-${width}${process.env.CC_QA_PROBE?'-before':''}.png`});
  }
  await p.setViewportSize({width:1280,height:800});
  await p.evaluate(()=>window.app.current.game.hud.menu.el.classList.remove('hidden'));
 }
 // Dead target/boss status uses the same real HUD cache, without claiming a combat kill.
 await p.evaluate(()=>{const b=window.app.current.game.worldBoss;b.unit.alive=false;b.unit.hp=0;});
 for(const [language,button] of [['en','English'],['ko','한국어']]){
  await p.getByRole('button',{name:button,exact:true}).click();await p.waitForTimeout(100);
  const state=await p.evaluate(()=>({target:document.querySelector('.uf-target .hp .label').textContent,boss:document.querySelector('.bf-bar .label').textContent,phase:document.querySelector('.bf-phase').textContent}));console.log('DEAD_TARGET_LANGUAGE',language,state);
  if(!process.env.CC_QA_PROBE){assert.equal(state.target,language==='ko'?'처치됨':'Dead');assert.equal(state.boss,language==='ko'?'처치 완료':'Defeated');assert.match(state.phase,language==='ko'?/보스 처치/:/Boss defeated/);}
 }
 await p.evaluate(()=>{const g=window.app.current.game;g.player.setTarget(g.npcById('pip').unit);});
 for(const [language,button] of [['en','English'],['ko','한국어']]){
  await p.getByRole('button',{name:button,exact:true}).click();await p.waitForTimeout(100);const name=await p.locator('.uf-target .uf-name').textContent();console.log('NPC_TARGET_LANGUAGE',language,name);if(!process.env.CC_QA_PROBE)assert.match(name,language==='ko'?/핍/:/Pip/);
 }
 assert.deepEqual(errors,[]);console.log(process.env.CC_QA_PROBE?'PROBE: native live combat-language behavior recorded':'PASS: native Settings refreshes five persistent aura titles, all three boss identities, live target name/tag, level subtitle, owned mechanic warning, dead statuses and selected NPC without altering paused simulation');
}finally{await browser.close();}
