import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5229';
const errors=[];
async function load(name,solo=false){const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(e.message));if(solo)await p.routeWebSocket('**/multiplayer*',ws=>ws.close());await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');},name);await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});await p.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.god=true;g.ending.cancel();g.journey.rustCleared=true;g.journey.abyssCleared=true;g.journey.trueCleared=true;g.journey.finalCleared=true;g.journey.firstEndingSeen=true;});return p;}
const xp=level=>22000+2200*(level-20)+100*(level-20)*(level-21);
async function prepare(p,level,chapter){await p.evaluate(({xp,chapter})=>{const g=window.app.current.game;g.dungeons.leave(false);g.world2.go(chapter);g.player.restoreXp(xp);g.player.unit.lastCombat=-100;g.player.unit.teleport(g.world,0,80,0);}, {xp:xp(level),chapter});}
async function kill(p){return p.evaluate(()=>{const g=window.app.current.game;const enemies=g.enemies.filter(e=>e.isDungeonOnly&&e.unit.alive);for(const e of enemies)g.combat.damage(g.player.unit,e.unit,e.unit.hp*3);return enemies.length;});}
try{
 const host=await load('Party return host'),guest=await load('Party return guest');
 await prepare(host,50,3);await prepare(guest,50,3);
 await host.evaluate(()=>window.app.current.game.multiplayer.createDungeonRoom());
 await host.waitForFunction(()=>!!window.app.current.game.multiplayer.room);
 const code=await host.evaluate(()=>window.app.current.game.multiplayer.room);
 await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);
 await guest.waitForFunction(()=>{const b=window.app.current.game.multiplayer.battle;return b.active&&!b.authority&&!b.sharedArea;});
 await host.waitForFunction(()=>{const p=window.app.current.game.combatPlayers();return p.length===2&&p.every(p=>p.level>=50);});
 for(const p of[host,guest])await p.evaluate(()=>window.app.current.game.multiplayer.battle.setParty(2));
 for(const p of[host,guest])await p.waitForFunction(()=>{const b=window.app.current.game.multiplayer.battle;return Object.keys(b.parties).length===2&&Object.values(b.parties).every(p=>p===2);});
 const identity=async p=>p.evaluate(()=>{const m=window.app.current.game.multiplayer,b=m.battle;return {room:m.room,id:b.ownId,host:b.host,parties:b.parties,active:b.active,shared:b.sharedArea};});
 const before=[await identity(host),await identity(guest)];
 async function assertParty(){for(const [i,p]of[host,guest].entries())assert.deepEqual(await identity(p),before[i]);}
 for(const [i,exitPage]of[guest,host].entries()){
  await host.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-100;});
  assert.equal(await host.evaluate(()=>window.app.current.game.dungeons.start(50)),true);
  await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='wave');
  if(i===0){await guest.locator('.dungeon-status button').click();await guest.waitForTimeout(300);assert.ok(await guest.evaluate(()=>window.app.current.game.dungeons.active));await assertParty();}
  for(let stage=1;stage<=3;stage++){
   await host.waitForFunction(s=>{const d=window.app.current.game.dungeons;return d.state?.phase==='wave'&&d.state.stage===s;},stage);
   await kill(host);
  }
  await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='clear');
  const rewards=await guest.evaluate(()=>{const g=window.app.current.game;return {coins:g.player.coins,xp:g.player.xp};});
  await exitPage.locator('.dungeon-status button').click();
  for(const p of[host,guest])await p.waitForFunction(()=>!window.app.current.game.dungeons.active);
  await guest.waitForTimeout(600);await assertParty();
  assert.deepEqual(await guest.evaluate(()=>{const g=window.app.current.game;return {coins:g.player.coins,xp:g.player.xp};}),rewards);
  for(const p of[host,guest])assert.notEqual(await p.evaluate(()=>window.app.current.game.world.heightAt(0,125)),80);
  console.log(`PASS run ${i+1}: ${i?'host':'guest'} returns; same private room, connection IDs, party 2, rewards and terrain; re-entry works`);
 }
 await host.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-100;g.dungeons.start(50);});
 await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='wave');
 for(const p of[host,guest])await p.evaluate(()=>{const g=window.app.current.game;g.god=false;g.combat.kill(g.player.unit,null);});
 await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='failed');
 await guest.locator('.dungeon-status button').click();
 for(const p of[host,guest])await p.waitForFunction(()=>!window.app.current.game.dungeons.active);
 await assertParty();console.log('PASS defeated guest returns after party wipe without leaving room or party');
 await guest.screenshot({path:'tmp/qa/dungeon-party-return.png'});
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}finally{await browser.close();}
