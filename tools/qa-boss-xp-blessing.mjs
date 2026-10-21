import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5232';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});await p.routeWebSocket('**/multiplayer*',ws=>ws.close());p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});await p.waitForTimeout(1000);await p.keyboard.press('Space');return p;
}
try {
 const p=await load('XP blessing QA');
 const result=await p.evaluate(()=>{
  const g=window.app.current.game,out=[];g.god=true;g.ending.cancel();
  for(const b of [g.boss,g.finalBoss,g.worldBoss,g.dawnBoss,g.frostBoss]){
   g.player.xpBlessingUntil=0;const before=g.player.xp;b.coinsClaimed=false;b.state='dying';b.unit.alive=false;
   g.journey.onBossDefeated(b);const until=g.player.xpBlessingUntil,killXp=g.player.xp-before;
   const next=g.player.xp;g.player.gainXp(100);const laterXp=g.player.xp-next;
   g.journey.onBossDefeated(b);out.push({level:b.profile.level,killXp,laterXp,remaining:Math.ceil((until-Date.now())/1000),duplicateDidNotRefresh:g.player.xpBlessingUntil===until});
  }
  g.dawnBoss.coinsClaimed=false;g.journey.onBossDefeated(g.dawnBoss);g.journey.save();return out;
 });
 assert.deepEqual(result.map(r=>[r.killXp,r.laterXp]),[[500,100],[1000,100],[5000,150],[100000,150],[18000,100]]);
 assert.ok(result.every(r=>r.duplicateDidNotRefresh));assert.ok(result.filter(r=>r.level===20||r.level===100).every(r=>r.remaining>=599&&r.remaining<=600));
 await p.waitForTimeout(1200);assert.match(await p.locator('.coin-wallet').innerText(),/XP 1.5배/);
 await p.screenshot({path:'tmp/qa/boss-xp-blessing.png'});
 await p.reload();await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 const saved=await p.evaluate(()=>{const g=window.app.current.game;const before=g.player.xp;g.player.gainXp(100);const active=g.player.xp-before;g.player.xpBlessingUntil=Date.now()-1;const after=g.player.xp;g.player.gainXp(100);return {active,expired:g.player.xp-after};});
 assert.deepEqual(saved,{active:150,expired:100});assert.deepEqual(errors,[]);
 console.log('PASS only Astra/Solarkan grant 10-minute all-XP blessing; no stacking/duplicate refresh; countdown, save/reload and expiry',JSON.stringify(result));
}finally{await browser.close();}
