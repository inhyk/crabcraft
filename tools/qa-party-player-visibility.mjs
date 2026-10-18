import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const errors=[],base=process.env.CC_QA_BASE??'http://127.0.0.1:5222';
 async function enter(name){const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');},name);await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});return p;}
 const host=await enter('Roster Host');await host.evaluate(()=>window.app.current.game.multiplayer.connect('create'));await host.waitForFunction(()=>!!window.app.current.game.multiplayer.room);const code=await host.evaluate(()=>window.app.current.game.multiplayer.room);
 const guest=await enter('Roster Friend');await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);
 await host.waitForFunction(()=>document.querySelectorAll('.mp-party-hud .mp-member').length===2);
 await host.evaluate(()=>{const g=window.app.current.game;g.multiplayer.root.open=false;g.player.unit.teleport(g.world,0,75,Math.PI);g.follow.yaw=0;g.follow.cut();});await guest.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,3,68,Math.PI);});
 await host.waitForFunction(()=>[...document.querySelectorAll('.plate.remote-player')].some(e=>e.style.display!=='none'&&e.textContent.includes('Roster Friend')));
 const panel=host.locator('.mp-party-hud');assert.equal(await panel.isVisible(),true);assert.equal(await host.locator('.mp-panel').getAttribute('open'),null);
 const box=await panel.boundingBox();assert.ok(box.x<40&&box.y>100&&box.x+box.width<350,JSON.stringify(box));
 const journal=await host.locator('.boss-journey:not(.creator-tools)').boundingBox();assert.ok(journal.y>=box.y+box.height,JSON.stringify({box,journal}));
 assert.equal(await host.locator('.plate.remote-player .player-badge').textContent(),'◆ 플레이어');assert.equal(await host.locator('.plate.remote-player .hpbar').isVisible(),true);
 await guest.evaluate(()=>{const g=window.app.current.game;g.player.unit.hp=37;g.player.unit.lastCombat=g.time+10;g.player.unit.blessingUntil=0});await host.waitForFunction(()=>[...document.querySelectorAll('.mp-party-hud .mp-member')].some(e=>e.textContent.includes('Roster Friend')&&e.querySelector('meter').value===37));
 await host.screenshot({path:'tmp/qa/party-left-player-badge.png'});
 for(const viewport of [{width:800,height:700},{width:390,height:700}]){await host.setViewportSize(viewport);const r=await panel.boundingBox();assert.ok(r.x>=0&&r.x+r.width<viewport.width*.6&&r.y+r.height<viewport.height,JSON.stringify(r));const j=await host.locator('.boss-journey:not(.creator-tools)').boundingBox();assert.ok(j.y>=r.y+r.height,JSON.stringify({r,j}));}
 await host.setViewportSize({width:1440,height:1000});await host.evaluate(()=>{window.app.current.game.multiplayer.battle.setMode('pvp')});await host.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='pvp');await host.waitForFunction(()=>document.querySelector('.mp-party-hud').textContent.includes('싸우기'));
 if(base.includes('127.0.0.1')){await host.evaluate(async()=>{const {setLanguage}=await import('/src/i18n.ts');setLanguage('en');window.app.current.game.multiplayer.refreshLanguage();});await host.waitForFunction(()=>document.querySelector('.player-badge')?.textContent==='◆ Player'&&document.querySelector('.mp-party-hud h3')?.textContent==='Party members');}
 await guest.evaluate(()=>window.app.current.game.multiplayer.disconnect());await host.waitForFunction(()=>document.querySelectorAll('.mp-party-hud .mp-member').length===1);await host.evaluate(()=>window.app.current.game.multiplayer.disconnect());await host.waitForFunction(()=>document.querySelector('.mp-party-hud').hidden);
 assert.deepEqual(errors,[]);console.log('PASS two real clients: left party roster with chat collapsed, player badge and HP, synchronized health, PvP, compact layouts, join/leave; zero browser errors');
}finally{await browser.close()}
