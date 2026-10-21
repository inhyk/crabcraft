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
 const p=await load('Boreas rescue');
 await p.waitForFunction(()=>window.app.current.game.multiplayer.battle.active&&window.app.current.game.multiplayer.battle.authority);
 await p.evaluate(()=>{const g=window.app.current.game;g.journey.rustCleared=g.journey.abyssCleared=g.journey.trueCleared=true;g.journey.firstEndingSeen=true;g.journey.world2Celebrated=true;for(const b of [g.boss,g.finalBoss,g.worldBoss]){b.state='dead';b.unit.alive=false;b.unit.hidden=true;}g.player.restoreXp(22000+2200*80+100*80*79);g.world2.go(3);g.journey.root.open=true;});
 await p.waitForFunction(()=>window.app.current.game.multiplayer.area===3&&window.app.current.game.multiplayer.battle.authority);
 assert.match(await p.evaluate(()=>window.app.current.game.dawnBoss.freed.name),/수호자|Dawnkeeper/);
 await p.locator('.bj-card.dawn button').click();await p.waitForFunction(()=>window.app.current.game.dawnBoss.state==='fight');
 await p.evaluate(()=>{const g=window.app.current.game;g.combat.kill(g.dawnBoss.unit,g.player.unit);});await p.waitForFunction(()=>window.app.current.game.dawnBoss.state==='dead');
 assert.equal(await p.evaluate(()=>window.app.current.game.ending.active),false);assert.equal(await p.evaluate(()=>window.app.current.game.journey.frostCleared),false);
 console.log('PASS Solarkan unlocks Frostlight without rescuing Mira or starting the true ending');
 await p.evaluate(()=>{const g=window.app.current.game;g.player.restoreXp(22000+2200*279+100*279*278);g.world2.go(4);g.journey.root.open=true;g.player.unit.teleport(g.world,13,-54,Math.PI);g.follow.cut();g.follow.yaw=0;});
 await p.waitForFunction(()=>window.app.current.game.multiplayer.area===4&&window.app.current.game.multiplayer.battle.authority);
 const captive=await p.evaluate(()=>{const g=window.app.current.game;return {name:g.frostBoss.freed.name,hidden:g.frostBoss.freed.hidden,x:g.frostBoss.freed.pos.x,z:g.frostBoss.freed.pos.z,cage:g.world2.fourth.prison.visible};});
 assert.match(captive.name,/미라|Mira/);assert.equal(captive.hidden,false);assert.equal(captive.x,13);assert.equal(captive.z,-62);assert.equal(captive.cage,true);
 assert.equal(await p.locator('.bj-card.frost button').isDisabled(),true);await p.screenshot({path:'tmp/qa/mira-ice-prison.png'});
 console.log('PASS Mira is held in Boreas’s ice prison in World IV; level 299 cannot challenge him');
 await p.evaluate(()=>{const g=window.app.current.game;g.player.restoreXp(22000+2200*280+100*280*279);g.quests.status.s1='done';g.quests.status.s2='active';g.journey.root.open=true;});
 const before=await p.evaluate(()=>window.app.current.game.player.coins);
 await p.locator('.bj-card.frost button').click();await p.waitForFunction(()=>window.app.current.game.frostBoss.state==='fight');
 await p.evaluate(()=>{const g=window.app.current.game;g.combat.kill(g.frostBoss.unit,g.player.unit);});
 await p.waitForFunction(()=>window.app.current.game.ending.active);await p.waitForFunction(()=>window.app.current.game.ending.started,null,{timeout:30000});
 const victory=await p.evaluate(()=>{const g=window.app.current.game;return {coins:g.player.coins,cleared:g.journey.frostCleared,cage:g.world2.fourth.prison.visible,quest:g.quests.status.s2,crowd:g.ending.crowdHomes.some(h=>h.unit===g.frostBoss.freed),caption:g.ending.caption(3)};});
 assert.equal(victory.coins,before+15000);assert.equal(victory.cleared,true);assert.equal(victory.cage,false);assert.equal(victory.quest,'done');assert.equal(victory.crowd,true);assert.match(victory.caption,/보레아스|Boreas/);
 await p.screenshot({path:'tmp/qa/boreas-rescue-ending.png'});console.log('PASS level 300 Boreas defeat rescues Mira, removes prison, completes quest, pays 15,000 coins and starts the dance ending with Mira');
 assert.deepEqual(errors,[]);console.log('PASS zero browser errors');
}finally{await browser.close();}
