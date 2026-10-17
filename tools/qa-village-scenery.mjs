import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5205';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
async function load(page,name){await page.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','high');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);await page.goto(base+'/?screen=game');await page.locator('.launch-notice-start').click();await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));}
const snap=page=>page.evaluate(()=>{const g=window.app.current.game,r=g.villageGames.state;return {r,own:g.villageGames.ownId,locked:g.controlsLocked,hp:g.player.unit.hp,x:g.player.unit.pos.x,z:g.player.unit.pos.z};});
try{
 await load(p,'Village Host');await p.keyboard.press('Escape');await p.getByRole('button',{name:/마을 놀이|Village games/}).click();await p.getByRole('button',{name:/술래잡기 시작|Start Tag/}).click();
 await p.waitForFunction(()=>window.app.current.game.villageGames.state?.mode==='tag');let s=await snap(p);assert.match(s.r.seeker,/^npc/);assert.equal(s.r.phase,'ready');
 await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,-7,7);});await p.waitForFunction(()=>window.app.current.game.villageGames.state.phase==='play');
 const npcBefore=await p.evaluate(()=>{const g=window.app.current.game,u=g.townsfolk[Number(g.villageGames.state.seeker.slice(3))].unit;return [u.pos.x,u.pos.z];});
 await p.waitForFunction(()=>window.app.current.game.villageGames.state?.phase==='done',null,{timeout:30000});s=await snap(p);assert.equal(s.r.result,'seekers');assert.ok(s.r.caught.includes('solo'));console.log('PASS actual solo villager chase and catch',npcBefore,s.r);
 await p.evaluate(()=>window.app.current.game.villageGames.command('hide'));await p.waitForFunction(()=>window.app.current.game.villageGames.state.mode==='hide');
 assert.match((await snap(p)).r.seeker,/^npc/);const hp=(await snap(p)).hp;
 await p.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.enemies[0].unit,g.player.unit,100);});assert.equal((await snap(p)).hp,hp);
 // Deterministic clock fixture exercises the time-out branch without two minutes of idle waiting.
 await p.evaluate(()=>{const g=window.app.current.game;g.villageGames.state.phase='play';g.villageGames.state.left=.1;g.player.unit.teleport(g.world,26,2);});await p.waitForFunction(()=>window.app.current.game.villageGames.state.phase==='done');assert.equal((await snap(p)).r.result,'runners');console.log('PASS solo hide timeout and combat safety');
 await p.evaluate(()=>window.app.current.game.villageGames.reset());
 // Two actual browser clients: guest is the initiator and must be the seeker.
 const q=await browser.newPage({viewport:{width:1280,height:800}});q.on('pageerror',e=>errors.push(e.message));await load(q,'Village Guest');
 await p.locator('.mp-panel > summary').click();await p.getByRole('button',{name:/방 만들기|Create room/}).click();await p.waitForFunction(()=>window.app.current.game.multiplayer.battle.active);console.log('HOST_ROOM_CREATED');
 const code=await p.evaluate(()=>window.app.current.game.multiplayer.room);
 await q.locator('.mp-panel > summary').click();await q.getByRole('textbox',{name:'방 코드',exact:true}).fill(code);await q.getByRole('button',{name:/참가|Join/,exact:true}).click();
 await q.waitForFunction(()=>window.app.current.game.multiplayer.battle.active&&[...window.app.current.game.multiplayer.peers.values()].some(p=>p.unit));await p.waitForFunction(()=>[...window.app.current.game.multiplayer.peers.values()].some(p=>p.unit&&!p.unit.hidden));
 await q.keyboard.press('Escape');await q.getByRole('button',{name:/마을 놀이|Village games/}).click();await q.getByRole('button',{name:/숨바꼭질 시작|Start Hide/}).click();
 await p.waitForFunction(()=>window.app.current.game.villageGames.state?.mode==='hide');await q.waitForFunction(()=>window.app.current.game.villageGames.state?.mode==='hide');
 const a=await snap(p),b=await snap(q);assert.equal(a.r.seeker,b.own);assert.equal(b.r.seeker,b.own);assert.equal(a.r.members.length,2);assert.ok(b.locked);assert.ok(!a.locked);await q.locator('.village-blind').waitFor({state:'visible'});
 await q.keyboard.down('KeyW');await q.waitForTimeout(500);await q.keyboard.up('KeyW');const still=await snap(q);assert.ok(Math.hypot(still.x-b.x,still.z-b.z)<.1);console.log('PASS guest-started hide: guest seeker, host runner, blind countdown and movement lock');
 // Advance only the authority's clock; both clients must receive its shared phase.
 await p.evaluate(()=>{window.app.current.game.villageGames.state.left=.1;});await q.waitForFunction(()=>window.app.current.game.villageGames.state.phase==='play');await q.locator('.village-blind').waitFor({state:'hidden'});
 await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,-7,7);});await q.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,-7,14,Math.PI);g.follow.yaw=0;g.follow.cut();});
 await p.waitForFunction(()=>{const g=window.app.current.game;return [...g.multiplayer.peers.values()].some(p=>p.unit&&Math.abs(p.unit.pos.z-14)<.5);});
 await q.keyboard.down('KeyW');await p.waitForFunction(()=>window.app.current.game.villageGames.state.phase==='done',null,{timeout:12000});await q.keyboard.up('KeyW');await q.waitForFunction(()=>window.app.current.game.villageGames.state.phase==='done');assert.equal((await snap(q)).r.result,'seekers');assert.ok((await snap(p)).locked===false);console.log('PASS real guest movement catches host and synchronized result');
 await q.evaluate(()=>window.app.current.game.villageGames.command('tag'));await p.waitForFunction(()=>window.app.current.game.villageGames.state.mode==='tag');assert.equal((await snap(p)).r.seeker,(await snap(q)).own);
 await q.close();await p.waitForFunction(()=>window.app.current.game.villageGames.state.phase==='done');assert.equal((await snap(p)).r.result,'cancelled');console.log('PASS starter disconnect cancels round');
 await p.evaluate(()=>{const g=window.app.current.game;g.villageGames.reset();g.creatorTravel=true;g.world2.go(2);document.querySelector('.mp-panel').open=false;});
 const view=async(ch,x,z,yaw,name)=>{await p.evaluate(({ch,x,z,yaw})=>{const g=window.app.current.game;g.creatorTravel=true;g.world2.go(ch);g.player.unit.teleport(g.world,x,z,yaw);g.follow.yaw=yaw+Math.PI;g.follow.distance=16;g.follow.pitch=.14;g.follow.cut();g.hud.messages.closeDiscovery();},{ch,x,z,yaw});await p.waitForTimeout(3800);await p.screenshot({path:`tmp/qa/village-${name}.png`});};
 await view(2,0,74,Math.PI,'world2-road');await view(2,-3,34,-1.8,'world2-leaves');await view(3,0,82,Math.PI,'world3-road');await view(3,-48,58,-1.3,'world3-leaves');
 const stats=await p.evaluate(()=>{const g=window.app.current.game;return {w2:g.world2.root.getObjectByName('world2-flagstone-paths').userData,w3:g.world2.third.root.getObjectByName('world3-flagstone-paths').userData,trees:g.world2.third.root.userData.leafyTrees,draws:g.engine.renderer.info.render.calls};});assert.ok(stats.w2.pavers>400&&stats.w3.pavers>400&&stats.trees>20);console.log('PASS textured paving and branching leafy trees',stats);
 await p.evaluate(()=>{const g=window.app.current.game;g.world2.go(1);g.villageGames.command('tag');});await p.setViewportSize({width:718,height:492});await p.waitForTimeout(400);
 const boxes=await p.evaluate(()=>{const a=document.querySelector('.village-round').getBoundingClientRect(),b=document.querySelector('.mm').getBoundingClientRect();return {overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,right:a.right,bottom:a.bottom};});assert.equal(boxes.overlap,false);assert.ok(boxes.right<718&&boxes.bottom<492);await p.screenshot({path:'tmp/qa/village-compact.png'});
 await p.locator('.village-round button').click();await p.waitForFunction(()=>window.app.current.game.villageGames.state.phase==='done');assert.equal((await snap(p)).r.result,'cancelled');assert.equal((await snap(p)).locked,false);console.log('PASS compact HUD avoids minimap and native stop unlocks movement',boxes);
 assert.deepEqual(errors,[]);console.log('PASS native solo/online games and scenery; zero page errors');
}finally{console.log('PAGE_ERRORS',errors);await browser.close();}
