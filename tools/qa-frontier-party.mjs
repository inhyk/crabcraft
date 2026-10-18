import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5231';
const errors=[];
async function load(name,solo=false){const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(e.message));if(solo)await p.routeWebSocket('**/multiplayer*',ws=>ws.close());await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');},name);await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});await p.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.god=true;g.ending.cancel();g.journey.rustCleared=true;g.journey.abyssCleared=true;g.journey.trueCleared=true;g.journey.finalCleared=true;g.journey.firstEndingSeen=true;});return p;}
const xp=level=>22000+2200*(level-20)+100*(level-20)*(level-21);
async function prepare(p,level,chapter){await p.evaluate(({xp,chapter})=>{const g=window.app.current.game;g.dungeons.leave(false);g.world2.go(chapter);g.player.restoreXp(xp);g.player.unit.lastCombat=-100;g.player.unit.teleport(g.world,0,80,0);}, {xp:xp(level),chapter});}
async function kill(p){return p.evaluate(()=>{const g=window.app.current.game;const enemies=g.enemies.filter(e=>e.isDungeonOnly&&e.unit.alive);for(const e of enemies)g.combat.damage(g.player.unit,e.unit,e.unit.hp*3);return enemies.length;});}
try{
 const host=await load('Frontier host'),guest=await load('Frontier guest');
 for(const p of [host,guest])await p.evaluate(()=>{const g=window.app.current.game;g.journey.frostCleared=true;g.world2.go(5);});
 await host.evaluate(()=>window.app.current.game.multiplayer.createDungeonRoom());
 await host.waitForFunction(()=>!!window.app.current.game.multiplayer.room);
 const code=await host.evaluate(()=>window.app.current.game.multiplayer.room);
 await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);
 await guest.waitForFunction(()=>{const b=window.app.current.game.multiplayer.battle;return b.active&&!b.authority&&!b.sharedArea;});
 for(const chapter of [5,6]){
  await host.evaluate(chapter=>{const g=window.app.current.game;g.world2.go(chapter);g.multiplayer.battle.publish();},chapter);
  await guest.waitForFunction(chapter=>window.app.current.game.world2.chapter===chapter,chapter);
  await host.waitForFunction(()=>window.app.current.game.combatPlayers().length===2);
  const result=await host.evaluate(()=>{const g=window.app.current.game,e=g.enemies.find(e=>!e.isAdd&&!e.isEcho&&e.kind==='scrapling');e.respawnAt(e.home.x,e.home.z);g.combat.damage(g.player.unit,e.unit,100);g.multiplayer.battle.publish();return {index:g.enemies.indexOf(e),hp:e.unit.hp,max:e.unit.maxHp};});
  await guest.waitForFunction(({index,hp,max})=>{const u=window.app.current.game.enemies[index].unit;return Math.abs(u.hp-hp)<.01&&u.maxHp===max;},result);
  assert.ok(result.hp<result.max);console.log(`PASS World ${chapter}: party two, host travel checkpoint and enemy HP synchronized`);
 }
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}finally{await browser.close();}
