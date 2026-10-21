import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5218';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 async function open(name){
  const ctx=await browser.newContext({viewport:{width:1280,height:800}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
  await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
  await p.evaluate(()=>{const g=window.app.current.game;g.player.nextSwing=Infinity;g.player.unit.hp=g.player.unit.maxHp=200;g.player.unit.lastCombat=-100;});await p.waitForTimeout(500);await p.keyboard.press('Space');
  return p;
 }
 const host=await open('Duel Host QA'),guest=await open('Duel Guest QA');
 await host.locator('.mp-panel > summary').click();await host.getByRole('button',{name:'⚔ 친구랑 싸우기',exact:true}).click();
 await host.waitForFunction(()=>{const m=window.app.current.game.multiplayer;return m.room&&m.battle.mode==='pvp'});
 const code=await host.locator('.mp-code').innerText();assert.match(code,/^[A-F0-9]{6}$/);
 await guest.locator('.mp-panel > summary').click();await guest.getByRole('textbox',{name:'방 코드',exact:true}).fill(code);await guest.getByRole('button',{name:'참가',exact:true}).click();
 for(const p of [host,guest])await p.waitForFunction(()=>{const m=window.app.current.game.multiplayer;return m.room&&m.battle.mode==='pvp'&&[...m.peers.values()].some(p=>p.unit)});
 for(const [p,x] of [[host,2],[guest,5]])await p.evaluate(x=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,0);g.player.unit.invulnerable=false;g.player.armorRank=0;g.god=false;},x);
 for(const p of [host,guest])await p.waitForFunction(()=>{const g=window.app.current.game,u=[...g.multiplayer.peers.values()][0]?.unit;return u?.hostile&&u.distTo(g.player.unit)<8});
 async function hp(p){return p.evaluate(()=>window.app.current.game.player.unit.hp)}
 async function hit(p,n){await p.evaluate(n=>{const g=window.app.current.game,u=[...g.multiplayer.peers.values()][0].unit;g.combat.damage(g.player.unit,u,n,{noReact:true});},n)}
 let h=await hp(host),v=await hp(guest);await hit(host,20);await guest.waitForFunction(v=>window.app.current.game.player.unit.hp===v-20,v);await host.waitForFunction(v=>[...window.app.current.game.multiplayer.peers.values()][0].unit.hp===v-20,v);
 assert.equal(await hp(host),h);await hit(guest,18);await host.waitForFunction(h=>window.app.current.game.player.unit.hp===h-18,h);
 console.log('PASS dedicated PvP creation, room-code join, rival targeting, bidirectional damage and mirrored health');
 await guest.evaluate(()=>{window.app.current.game.player.armorRank=25});v=await hp(guest);await host.waitForTimeout(150);await hit(host,40);await guest.waitForFunction(v=>window.app.current.game.player.unit.hp===v-20,v);
 console.log('PASS recipient armor applies once over real room transport');
 await host.locator('[data-party="2"]').click();await guest.locator('[data-party="2"]').click();
 for(const p of [host,guest])await p.waitForFunction(()=>{const m=window.app.current.game.multiplayer;return m.battle.sameParty(m.ownId,[...m.peers.keys()][0])});
 v=await hp(guest);await hit(host,40);await host.waitForTimeout(300);assert.equal(await hp(guest),v);
 await guest.locator('[data-party="0"]').click();await host.locator('[data-mode="coop"]').click();await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='coop');await hit(host,40);await host.waitForTimeout(300);assert.equal(await hp(guest),v);
 console.log('PASS same-party immunity, host Co-op switch and friendly-fire protection');
 await host.locator('[data-mode="pvp"]').click();await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='pvp');await guest.waitForTimeout(150);
 // Use the real ability input path as well as fixed damage checks above.
 await host.evaluate(()=>{const g=window.app.current.game,u=[...g.multiplayer.peers.values()][0].unit;g.player.setTarget(u);g.player.resource=100;g.player.gcdEnd=0;g.player.cooldowns.clear();});v=await hp(guest);await host.locator('.mp-panel > summary').click();await host.evaluate(()=>document.activeElement?.blur());await host.keyboard.press('Digit1');
 await guest.waitForFunction(v=>window.app.current.game.player.unit.hp<v,v,{timeout:10000});
 await host.screenshot({path:'tmp/qa/duel-host.png'});await guest.screenshot({path:'tmp/qa/duel-guest.png'});
 assert.deepEqual(errors,[]);console.log('PASS keyboard attack skill damages friend; zero browser errors');
}finally{await browser.close()}
