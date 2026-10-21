import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5218';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});return p;
}
try{
 const p=await load('Rematch host'),q=await load('Rematch friend');
 await q.waitForFunction(()=>window.app.current.game.multiplayer.battle.active&&!window.app.current.game.multiplayer.battle.authority);
 for(const v of [p,q])await v.evaluate(()=>{const g=window.app.current.game;g.player.gainXp(6500);g.journey.rustCleared=true;g.player.unit.lastCombat=-100;g.player.nextSwing=Infinity;});
 await p.evaluate(()=>{const g=window.app.current.game;g.boss.state='dead';g.boss.unit.alive=false;g.boss.unit.hp=0;g.boss.unit.hidden=true;g.setLighthouse(true);});
 await q.waitForFunction(()=>window.app.current.game.boss.state==='dead');
 const before=await Promise.all([p,q].map(v=>v.evaluate(()=>window.app.current.game.player.coins)));
 for(let round=1;round<=2;round++){
  await q.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-100;g.player.unit.teleport(g.world,0,0);g.journey.root.open=true;});
  const button=q.locator('.bj-card.rust button');await button.waitFor();await button.click();
  for(const v of [p,q])await v.waitForFunction(()=>{const b=window.app.current.game.boss;return b.unit.alive&&b.unit.hp===b.unit.maxHp&&b.state!=='dead';});
  await p.waitForFunction(()=>window.app.current.game.boss.state==='fight');
  await p.evaluate(()=>{const g=window.app.current.game;g.combat.kill(g.boss.unit,g.player.unit);});
  for(let i=0;i<2;i++)await [p,q][i].waitForFunction(coins=>window.app.current.game.player.coins===coins,before[i]+round*150);
  await p.waitForFunction(()=>window.app.current.game.boss.state==='dead');await q.waitForFunction(()=>window.app.current.game.boss.state==='dead');
  console.log(`PASS rematch ${round}: guest button revives full shared boss; both players receive exactly 150 coins`);
 }
 await q.evaluate(()=>window.app.current.game.journey.save());
 await q.reload();await q.locator('.launch-notice-start').click();await q.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 assert.equal(await q.evaluate(()=>window.app.current.game.player.coins),before[1]+300);
 await q.evaluate(()=>{window.app.current.game.journey.root.open=true;});await q.screenshot({path:'tmp/qa/boss-rematch-coins.png'});
 console.log('PASS earned coins persist after reload; first crown remains earned');assert.deepEqual(errors,[]);console.log('PASS zero browser errors');
}finally{await browser.close();}
