import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const errors=[],base=process.env.CC_QA_BASE??'http://127.0.0.1:5223';
 async function enter(name){const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');},name);await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});return p;}
 const host=await enter('Same Roster');await host.evaluate(()=>window.app.current.game.multiplayer.connect('create'));await host.waitForFunction(()=>!!window.app.current.game.multiplayer.room);const code=await host.evaluate(()=>window.app.current.game.multiplayer.room);
 const guest=await enter('Same Roster');await guest.evaluate(code=>window.app.current.game.multiplayer.connect('join',code),code);
 await guest.waitForFunction(()=>window.app.current.game.player.unit.name==='Same Roster #2');assert.equal(await guest.evaluate(()=>JSON.parse(localStorage.getItem('cc.spec')).name),'Same Roster');
 await host.waitForFunction(()=>document.querySelectorAll('.mp-party-hud .mp-member').length===2);
 await host.evaluate(()=>{const g=window.app.current.game;g.multiplayer.root.open=false;g.player.unit.teleport(g.world,0,75,Math.PI);g.follow.yaw=0;g.follow.cut();});await guest.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,3,68,Math.PI);});
 await host.waitForFunction(()=>[...document.querySelectorAll('.plate.remote-player')].some(e=>e.style.display!=='none'&&e.textContent.includes('Same Roster #2')));
 assert.equal(await guest.evaluate(()=>window.app.current.game.player.unit.rig.spec.name),'Same Roster');
 assert.ok((await host.locator('.mp-party-hud').textContent()).includes('Same Roster #2'));
 await guest.evaluate(()=>{const g=window.app.current.game;g.journey.save();g.multiplayer.send({type:'chat',text:'Unique name check'});});
 await host.waitForFunction(()=>[...document.querySelectorAll('.mp-line')].some(e=>e.dataset.name==='Same Roster #2'&&e.textContent.includes('Unique name check')));
 assert.ok(await guest.evaluate(()=>localStorage.getItem('cc.journey.v1:human:male:mage:Same Roster')));
 await host.screenshot({path:'tmp/qa/unique-names.png'});
 assert.deepEqual(errors,[]);console.log('PASS two same-name real clients receive distinct labels on both screens, party roster and chat; original spec and save key preserved; zero browser errors');
}finally{await browser.close()}
