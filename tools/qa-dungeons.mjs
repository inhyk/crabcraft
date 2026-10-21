import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5228';
const errors=[];
async function load(name,solo=false){const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(e.message));if(solo)await p.routeWebSocket('**/multiplayer*',ws=>ws.close());await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');},name);await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});await p.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.god=true;g.ending.cancel();g.journey.rustCleared=true;g.journey.abyssCleared=true;g.journey.trueCleared=true;g.journey.finalCleared=true;g.journey.firstEndingSeen=true;});return p;}
const xp=level=>22000+2200*(level-20)+100*(level-20)*(level-21);
async function prepare(p,level,chapter){await p.evaluate(({xp,chapter})=>{const g=window.app.current.game;g.dungeons.leave(false);g.world2.go(chapter);g.player.restoreXp(xp);g.player.unit.lastCombat=-100;g.player.unit.teleport(g.world,0,80,0);}, {xp:xp(level),chapter});}
async function kill(p){return p.evaluate(()=>{const g=window.app.current.game;const enemies=g.enemies.filter(e=>e.isDungeonOnly&&e.unit.alive);for(const e of enemies)g.combat.damage(g.player.unit,e.unit,e.unit.hp*3);return enemies.length;});}
try{
 const p=await load('Dungeon solo QA',true);
 await prepare(p,34,3);assert.equal(await p.evaluate(()=>window.app.current.game.dungeons.start(35)),false);
 await prepare(p,35,4);assert.equal(await p.evaluate(()=>window.app.current.game.dungeons.start(35)),false);
 for(const level of[35,50,75,150,200,250]){
  await prepare(p,level,level<100?3:4);
  const before=await p.evaluate(()=>{const g=window.app.current.game;return{coins:g.player.coins,xp:g.player.xp,level:g.player.level,back:g.player.unit.pos.toArray()};});
  assert.equal(await p.evaluate(l=>window.app.current.game.dungeons.start(l),level),true);
  assert.equal(await p.evaluate(()=>window.app.current.game.player.level),level);
  for(let stage=1;stage<=3;stage++){
   await p.waitForFunction(s=>{const d=window.app.current.game.dungeons;return d.state?.phase==='wave'&&d.state.stage===s;},stage);
   const stats=await p.evaluate(()=>{const g=window.app.current.game,d=g.dungeons;return{count:g.enemies.filter(e=>e.isDungeonOnly&&e.unit.alive).length,levels:g.enemies.filter(e=>e.isDungeonOnly&&e.unit.alive).map(e=>e.unit.level),ground:g.world.heightAt(0,125),warnings:d.warning.children.length,warningY:d.warning.children[0]?.position.y};});
   assert.equal(stats.count,stage===2?5:3);assert.ok(stats.levels.every(l=>l===level));assert.equal(stats.ground,80);assert.ok(stats.warnings>0);assert.ok(stats.warningY>80);
   if(stage===3){await p.evaluate(()=>{const g=window.app.current.game;g.follow.pitch=.7;g.follow.distance=26;g.follow.cut();});await p.screenshot({path:`tmp/qa/dungeon-${level}.png`});}
   await kill(p);
  }
  await p.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='clear');
  const result=await p.evaluate(()=>{const g=window.app.current.game,d=g.dungeons;const coins=g.player.coins,xp=g.player.xp;d.apply(d.networkState());d.apply(d.networkState());return{coins,xp,again:g.player.coins,againXp:g.player.xp};});
  assert.ok(result.coins>before.coins);assert.ok(result.xp>before.xp);assert.equal(result.again,result.coins);assert.equal(result.againXp,result.xp);
  await p.evaluate(()=>window.app.current.game.dungeons.leave());
  assert.equal(await p.evaluate(()=>window.app.current.game.world.heightAt(0,125)===80),false);
  console.log(`PASS Lv.${level}: entry gate, fixed level, 3 waves, raised hazard, reward once, return terrain`);
 }
 await p.locator('.dungeon-menu').click();await p.screenshot({path:'tmp/qa/dungeons-menu.png'});await p.close();
 const host=await load('Dungeon host'),guest=await load('Dungeon guest');await prepare(host,50,3);await prepare(guest,50,3);
 const code=await host.evaluate(async()=>{const m=window.app.current.game.multiplayer;m.createDungeonRoom();for(let i=0;i<100&&!m.room;i++)await new Promise(r=>setTimeout(r,100));return m.room;});assert.ok(code);
 await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);
 await guest.waitForFunction(()=>{const b=window.app.current.game.multiplayer.battle;return b.active&&!b.authority&&!b.sharedArea;});
 await host.waitForFunction(()=>window.app.current.game.combatPlayers().length===2);
 assert.equal(await host.evaluate(()=>window.app.current.game.dungeons.start(50)),true);
 await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='wave');
 const sync=await guest.evaluate(()=>{const g=window.app.current.game;return{level:g.dungeons.state.level,y:g.player.unit.pos.y,count:g.enemies.filter(e=>e.isDungeonOnly&&e.unit.alive).length};});assert.equal(sync.level,50);assert.equal(sync.y,80);assert.equal(sync.count,3);
 await guest.evaluate(()=>{const g=window.app.current.game,e=g.enemies.find(e=>e.isDungeonOnly&&e.unit.alive);g.player.unit.teleport(g.world,e.unit.pos.x+1,e.unit.pos.z,0);g.combat.damage(g.player.unit,e.unit,100);});
 await host.waitForFunction(()=>window.app.current.game.enemies.some(e=>e.isDungeonOnly&&e.unit.alive&&e.unit.hp<e.unit.maxHp));
 for(let stage=1;stage<=3;stage++){await host.waitForFunction(s=>{const d=window.app.current.game.dungeons;return d.state?.phase==='wave'&&d.state.stage===s;},stage);await kill(host);}
 await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='clear');
 assert.ok(await guest.evaluate(()=>window.app.current.game.player.coins>0));
 await host.evaluate(()=>window.app.current.game.dungeons.leave());await guest.waitForFunction(()=>!window.app.current.game.dungeons.active);
 console.log('PASS private co-op: shared room, guest enters, guest damage reaches host, 3 waves and rewards sync, exit sync');
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}catch(error){console.error('BROWSER ERRORS',errors);for(const c of browser.contexts())for(const p of c.pages()){console.error(await p.evaluate(()=>{const g=window.app?.current?.game;return {state:g?.dungeons?.state,time:g?.time,menu:g?.hud.menu.open,account:g?.app.account.open,loaded:g?.loaded};}));await p.screenshot({path:'tmp/qa/dungeon-failure.png'});}throw error;}finally{await browser.close();}
