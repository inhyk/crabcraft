import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {launchBrowser} from './lib/browser.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5219';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 async function open(name){
  const ctx=await browser.newContext({viewport:{width:1280,height:800}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
  await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
  await p.evaluate(()=>{const g=window.app.current.game;g.multiplayer.connect('create');g.god=true;g.player.nextSwing=Infinity;g.journey.firstEndingSeen=true;g.ending.cancel();});await p.waitForFunction(()=>!!window.app.current.game.multiplayer.room);return p;
 }
 const host=await open('World Host QA');
 await host.evaluate(()=>{const g=window.app.current.game;g.player.restoreXp(900);g.world.setBeaconLit(true);g.beaconLit=true;g.boss.wake();});
 await host.waitForFunction(()=>window.app.current.game.boss.state==='idle');
 await host.evaluate(()=>{const g=window.app.current.game;g.journey.firstEndingSeen=false;void g.ending.start('chapter');});
 await host.waitForFunction(()=>{const g=window.app.current.game;return g.ending.started&&g.enemies.some(e=>!e.isAdd&&!e.isEcho&&e.state==='gone')},null,{timeout:15000});
 // Same callback as the dedicated button; a cinematic hides that button while running.
 await host.evaluate(()=>window.app.current.game.multiplayer.connect('create','',true));
 await host.waitForFunction(()=>{const g=window.app.current.game;return g.multiplayer.room&&g.multiplayer.battle.mode==='pvp'&&!g.ending.active&&g.enemies.some(e=>!e.isAdd&&!e.isEcho&&e.state==='idle')});
 const code=await host.evaluate(()=>window.app.current.game.multiplayer.room);
 assert.equal(await host.evaluate(()=>window.app.current.game.journey.firstEndingSeen),false);
 assert.equal(await host.evaluate(()=>window.app.current.game.boss.unit.hidden),false);
 const guest=await open('World Guest QA');await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);
 await guest.waitForFunction(()=>{const g=window.app.current.game;return g.multiplayer.battle.mode==='pvp'&&g.multiplayer.peers.size===1&&!g.ending.active});
 const index=await host.evaluate(()=>{const g=window.app.current.game,i=g.enemies.findIndex(e=>!e.isAdd&&!e.isEcho&&e.kind==='scrapling');const e=g.enemies[i];g.player.unit.teleport(g.world,e.unit.pos.x+6,e.unit.pos.z);return i});
 await host.waitForFunction(i=>window.app.current.game.enemies[i].state==='chase',index);
 const before=await host.evaluate(i=>window.app.current.game.enemies[i].unit.pos.toArray(),index);
 await host.waitForFunction(({i,x,z})=>{const u=window.app.current.game.enemies[i].unit;return Math.hypot(u.pos.x-x,u.pos.z-z)>.5},{i:index,x:before[0],z:before[2]});
 await guest.waitForFunction(i=>window.app.current.game.enemies[i].state==='chase'&&!window.app.current.game.enemies[i].unit.hidden,index);
 for(const p of [host,guest])assert.equal(await p.evaluate(()=>window.app.current.game.boss.unit.hidden),false);
 console.log('PASS public/celebration to fresh PvP restores monsters, AI chase, visible boss and guest synchronization without marking the ending seen');
 const tiers=await host.evaluate(()=>{const g=window.app.current.game;return [1,2,3,4].map(chapter=>{g.creatorTravel=true;g.world2.go(chapter);const e=g.enemies.find(e=>!e.isAdd&&!e.isEcho&&e.kind==='scrapling');g.player.restoreXp(900);e.respawnAt(e.home.x,e.home.z);const a=[e.unit.level,e.unit.maxHp,...e.stats.dmg];g.player.restoreXp(0);g.player.unit.level=10000;e.respawnAt(e.home.x,e.home.z);return [chapter,a,[e.unit.level,e.unit.maxHp,...e.stats.dmg]]})});
 for(const [chapter,a,b] of tiers){assert.deepEqual(a,b);assert.equal(a[0],{1:1,2:10,3:20,4:100}[chapter]);}
 console.log('PASS fixed enemy levels and strength in all four worlds despite player level changes');
 const map=await host.evaluate(()=>{const g=window.app.current.game;g.world2.go(1);const objects=[];g.scene.traverse(o=>objects.push([o,o.visible]));const snap=g.takeMapSnapshot();const restored=objects.every(([o,v])=>o.visible===v);g.hud.minimap.setSnapshot(snap);g.hud.minimap.toggle(true);return {restored,particles:objects.filter(([o])=>o.isPoints).length,png:snap.canvas.toDataURL('image/png').split(',')[1]}});
 assert.equal(map.restored,true);assert.ok(map.particles>0);writeFileSync('tmp/qa/shore-map-clean.png',Buffer.from(map.png,'base64'));console.log('PASS clean World I map preserves all world effect visibility');
 await host.screenshot({path:'tmp/qa/duel-world-host.png'});await guest.screenshot({path:'tmp/qa/duel-world-guest.png'});assert.deepEqual(errors,[]);console.log('PASS zero browser errors');
}finally{await browser.close()}
