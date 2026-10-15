// Two real Internet players accept the same quest but explore different landmarks.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const url=process.env.CC_QA_URL||'https://inh-crabcraft-multiplayer.vercel.app/',errors=[];
try {
 async function open(name){const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(name=>{localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name}));},name);await page.goto(url+'?screen=game');await loaded(page);return page;}
 async function loaded(page){await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));}
 const host=await open('Memory Host'),guest=await open('Memory Friend');
 await host.evaluate(()=>window.app.current.game.multiplayer.connect('create'));await host.waitForFunction(()=>window.app.current.game.multiplayer.room);const room=await host.evaluate(()=>window.app.current.game.multiplayer.room);
 await guest.evaluate(room=>window.app.current.game.multiplayer.connect('join',room),room);await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.active);await host.waitForFunction(()=>[...window.app.current.game.multiplayer.peers.values()][0]?.unit);
 await guest.evaluate(()=>window.app.current.game.multiplayer.battle.travel(2));for(const page of [host,guest])await page.waitForFunction(()=>window.app.current.game.world2.chapter===2);
 for(const page of [host,guest]){
  await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.unit.teleport(g.world,25,58,Math.PI);g.follow.cut();});await page.keyboard.press('KeyF');await page.locator('.dlg').waitFor({state:'visible'});await page.evaluate(()=>window.app.current.game.hud.dialogue.skipTyping());await page.getByRole('button',{name:'퀘스트 받기',exact:true}).click();await page.waitForFunction(()=>window.app.current.game.quests.status.w5==='active');
 }
 await host.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,80,-40);g.follow.cut();});await guest.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,-75,-35);g.follow.cut();});
 await host.waitForFunction(()=>window.app.current.game.quests.progress.get('w5-east')===1);await guest.waitForFunction(()=>window.app.current.game.quests.progress.get('w5-west')===1);
 const state=async page=>page.evaluate(()=>{const g=window.app.current.game,q=g.quests;return {west:q.progress.get('w5-west')||0,east:q.progress.get('w5-east')||0,north:q.progress.get('w5-north')||0,sources:g.world2.ambience.sources.length};});
 assert.deepEqual(await state(host),{west:0,east:1,north:0,sources:2});assert.deepEqual(await state(guest),{west:1,east:0,north:0,sources:2});
 for(const [page,title,x,z] of [[host,'별을 잇던 관측소',-75,-35],[guest,'수정에 남은 노래',80,-40]]){
  await page.keyboard.press('KeyL');await page.locator('.qlog').waitFor({state:'visible'});assert.deepEqual(await page.locator('.qlog-memory h3').allTextContents(),[title]);await page.getByRole('button',{name:'◇ 이 퀘스트 길 안내',exact:true}).click();assert.deepEqual(await page.evaluate(()=>{const p=window.app.current.game.objectivePos();return [p.x,p.z];}),[x,z]);await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.app.current.game.hud.questLog.open);await page.evaluate(()=>window.app.current.game.journey.save());
 }
 // Each player controls their own effects volume, even though their world is shared.
 await guest.evaluate(()=>{const m=window.app.current.game.hud.menu;m.show();m.settings();});await guest.locator('input[type=range]').nth(1).fill('0');await guest.keyboard.press('Escape');assert.equal(await guest.evaluate(()=>window.app.current.game.audio.sfxVolume),0);assert.equal(await host.evaluate(()=>window.app.current.game.audio.sfxVolume),.8);
 await guest.goto(url+'?screen=game&room='+room);await loaded(guest);await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.active);assert.deepEqual(await state(guest),{west:1,east:0,north:0,sources:2});assert.equal(await guest.evaluate(()=>window.app.current.game.audio.sfxVolume),0);assert.deepEqual(await state(host),{west:0,east:1,north:0,sources:2});
 await guest.evaluate(()=>window.app.current.game.multiplayer.battle.travel(1));for(const page of [host,guest]){await page.waitForFunction(()=>window.app.current.game.world2.chapter===1);assert.equal(await page.evaluate(()=>window.app.current.game.world2.ambience.sources.length),0);}
 await guest.evaluate(()=>window.app.current.game.multiplayer.battle.travel(2));for(const page of [host,guest])await page.waitForFunction(()=>window.app.current.game.world2.chapter===2);
 assert.deepEqual(await state(host),{west:0,east:1,north:0,sources:2});assert.deepEqual(await state(guest),{west:1,east:0,north:0,sources:2});
 assert.deepEqual(errors,[]);console.log('PASS: two Internet players accept with F/real buttons, independent discoveries/journals/navigation, local audio preference, guest reload/rejoin, shared two-way travel and ambience lifecycle',JSON.stringify({host:await state(host),guest:await state(guest),errors}));
}finally{await browser.close();}
