import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5236';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'priest',shell:0,crest:0,led:0,name:'Dungeon damage QA'}));localStorage.setItem('cc.hintsSeen','1');});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 const result=await p.evaluate(()=>{
  const g=window.app.current.game;g.god=true;g.creatorTravel=true;g.ending.cancel();g.journey.rustCleared=g.journey.abyssCleared=g.journey.trueCleared=g.journey.finalCleared=g.journey.frostCleared=true;
  const n=750-20;g.player.restoreXp(22000+2200*n+100*n*(n-1));const ordinary=g.enemies.find(e=>!e.isDungeonOnly&&!e.isAdd&&!e.isEcho);g.world2.go(3);const ordinaryDamage=[...ordinary.stats.dmg];g.player.unit.lastCombat=-100;if(!g.dungeons.start(35))throw Error('Cannot enter dungeon');g.dungeons.update(4);
  const sentinel=g.enemies.find(e=>e.isDungeonOnly&&e.unit.alive);const normal=[...sentinel.stats.dmg];
  const source=sentinel.unit;g.player.unit.pos.copy(sentinel.home);const hits=[],damage=g.combat.damage;g.combat.damage=(s,t,v)=>{if(s===source&&t===g.player.unit)hits.push(v);};
  try{g.dungeons.strike();g.player.unit.pos.x+=12;g.dungeons.strike();}finally{g.combat.damage=damage;}
  g.dungeons.state.stage=3;g.dungeons.configure();const warden=g.enemies.find(e=>e.isDungeonOnly&&e.dungeonCaptain);const captain=[...warden.stats.dmg];g.dungeons.leave();
  return {normal,captain,hits,ordinaryDamage,ordinaryAfter:[...ordinary.stats.dmg]};
 });
 assert.deepEqual(result.normal,[17.875,25.0625]);assert.deepEqual(result.captain,[17.875,37.59375]);assert.deepEqual(result.hits,[41]);assert.deepEqual(result.ordinaryAfter,result.ordinaryDamage);
 console.log('PASS real dungeon sentinel and warden attacks +25%, telegraphed hit 41, safe ground avoids damage, outside enemies unchanged');
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}finally{await browser.close();}
