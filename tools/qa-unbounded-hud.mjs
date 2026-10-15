// Saved high-level fixtures exercise the real HUD; no XP grind is claimed.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try {
 const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'nightelf',sex:'female',classId:'mage',shell:1,crest:1,led:1,name:'Infinite Crab'}));localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await p.goto('http://127.0.0.1:5192/?screen=game');
 const loaded=async()=>{await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));};await loaded();
 for(const [width,height] of [[1280,800],[718,492],[390,844]]) {
  await p.setViewportSize({width,height});
  for(const level of [20,108,1000,100000,'max']) {
   const expected=await p.evaluate(level=>{const g=window.app.current.game;g.god=true;const n=level-20,xp=level==='max'?Number.MAX_SAFE_INTEGER:22000+2200*n+100*n*(n-1);g.player.restoreXp(xp);return g.player.unit.level;},level);
   await p.waitForFunction(expected=>document.querySelector('.uf-player .uf-level').textContent===String(expected),expected);
   const report=await p.evaluate(()=>{
    const fit=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const t=range.getBoundingClientRect();return {text:el.textContent,box:[r.x,r.y,r.right,r.bottom],textBox:[t.x,t.y,t.right,t.bottom],fits:t.x>=r.x-.5&&t.right<=r.right+.5};};
    return {level:window.app.current.game.player.unit.level,badge:fit('.uf-player .uf-level'),hp:fit('.uf-player .hp .label'),resource:fit('.uf-player .res .label'),xp:fit('.ab-xp-label')};
   });
   console.log('HUD',width,height,JSON.stringify(report));
   if(level===100000||level==='max')await p.screenshot({path:`tmp/qa/unbounded-hud-${width}-${level}${process.env.CC_QA_PROBE?'-before':''}.png`});
   if(!process.env.CC_QA_PROBE){for(const key of ['badge','hp','resource','xp'])assert.equal(report[key].fits,true,JSON.stringify({width,height,key,...report}));assert.ok(report.badge.box[0]>=0&&report.badge.box[2]<report.hp.box[0]);assert.ok(report.xp.box[0]>=0&&report.xp.box[2]<=width);}
  }
 }
 if(!process.env.CC_QA_PROBE){await p.setViewportSize({width:1280,height:800});await p.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});for(const [name,prefix] of [['English','Level '],['한국어','레벨 ']]){await p.getByRole('button',{name,exact:true}).click();await p.waitForFunction(prefix=>document.querySelector('.ab-xp-label').textContent.startsWith(prefix),prefix);}await p.getByRole('button',{name:'뒤로',exact:true}).click();await p.getByRole('button',{name:'계속하기',exact:true}).click();console.log('PASS native Settings immediately updates high-level KO/EN XP label');}
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.save();});await p.reload();await loaded();
 assert.equal(await p.evaluate(()=>window.app.current.game.player.xp),Number.MAX_SAFE_INTEGER);
 assert.deepEqual(errors,[]);
 console.log(process.env.CC_QA_PROBE?'PROBE: actual high-level HUD geometry recorded; max XP persistence passes':'PASS: high levels through max saved XP fit real badge/bars/XP label at three viewports and survive reload; no page errors');
}finally{await browser.close();}
