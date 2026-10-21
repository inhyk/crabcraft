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
 const host=await load('Expedition leader');await prepare(host,35,3);
 await host.waitForFunction(()=>{const b=window.app.current.game.multiplayer.battle;return b.active&&b.sharedArea;});
 assert.equal(await host.evaluate(()=>window.app.current.game.dungeons.start(35)),true);
 await host.waitForFunction(()=>{const g=window.app.current.game;return !!g.multiplayer.room&&g.dungeons.state?.phase==='wave';});
 const code=await host.evaluate(()=>window.app.current.game.multiplayer.room);assert.ok(code);
 await host.evaluate(()=>{const g=window.app.current.game,e=g.enemies.find(e=>e.isDungeonOnly&&e.unit.alive);for(const e of g.enemies.filter(e=>e.isDungeonOnly))e.unit.stunUntil=g.time+20;g.player.unit.teleport(g.world,e.unit.pos.x+7,e.unit.pos.z,0);g.player.setTarget(e.unit);});
 await host.keyboard.press('1');await host.waitForFunction(()=>window.app.current.game.enemies.some(e=>e.isDungeonOnly&&e.unit.alive&&e.unit.hp<e.unit.maxHp));
 console.log('PASS public-world entry creates a private expedition; real keyboard skill damages a dungeon sentinel');
 const hp=await host.evaluate(()=>{const g=window.app.current.game;g.god=false;g.player.unit.absorb=0;g.player.unit.teleport(g.world,0,125,0);g.dungeons.state.clock=2.4;g.dungeons.hit=-1;return g.player.unit.hp;});
 await host.waitForTimeout(400);assert.ok(await host.evaluate(hp=>window.app.current.game.player.unit.hp<hp,hp));
 const safeHp=await host.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,14,125,0);g.dungeons.state.clock=9.4;g.dungeons.hit=-1;return g.player.unit.hp;});
 await host.waitForTimeout(400);assert.equal(await host.evaluate(()=>window.app.current.game.player.unit.hp),safeHp);
 await host.evaluate(()=>{const g=window.app.current.game,e=g.enemies.find(e=>e.isDungeonOnly&&e.unit.alive);g.combat.damage(e.unit,g.player.unit,100000);});
 await host.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='failed');
 await host.waitForFunction(()=>window.app.current.game.player.unit.alive);
 assert.equal(await host.evaluate(()=>window.app.current.game.player.unit.pos.y),80);
 console.log('PASS actual hazard hits red ground, safe ground avoids it, party wipe fails the run, respawn stays inside');
 await prepare(host,35,3);await host.evaluate(()=>{const g=window.app.current.game;g.god=true;g.dungeons.start(35);});
 await host.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='wave');
 const guest=await load('Expedition successor');await prepare(guest,34,3);await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);
 await guest.waitForTimeout(1000);await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.sharedArea);
 assert.equal(await guest.evaluate(()=>window.app.current.game.dungeons.active),false);
 await guest.evaluate(xp=>window.app.current.game.player.restoreXp(xp),xp(35));await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='wave');
 await host.waitForFunction(()=>window.app.current.game.dungeons.state.members.includes('Expedition successor'));
 await host.close();await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.authority);
 assert.equal(await guest.evaluate(()=>window.app.current.game.dungeons.state.level),35);
 for(let stage=1;stage<=3;stage++){await guest.waitForFunction(s=>{const d=window.app.current.game.dungeons;return d.state?.phase==='wave'&&d.state.stage===s;},stage);await kill(guest);}
 await guest.waitForFunction(()=>window.app.current.game.dungeons.state?.phase==='clear');assert.ok(await guest.evaluate(()=>window.app.current.game.player.coins>0));
 console.log('PASS late-join level gate, qualified late entry, host migration resumes waves and pays the remaining participant');
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}catch(error){console.error('BROWSER ERRORS',errors);for(const c of browser.contexts())for(const p of c.pages()){console.error(await p.evaluate(()=>{const g=window.app?.current?.game;return{state:g?.dungeons?.state,time:g?.time,locked:g?.controlsLocked,hp:g?.player.unit.hp};}));await p.screenshot({path:'tmp/qa/dungeon-edge-failure.png'});}throw error;}finally{await browser.close();}
