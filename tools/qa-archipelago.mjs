import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5205',errors=[];
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const p=await browser.newPage({viewport:{width:1200,height:800}});p.on('pageerror',e=>errors.push(e.message));
try{
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Three Island Explorer'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','low');
 // Existing Coralwind save is a compatibility fixture, not a claimed full voyage.
 if(!localStorage.getItem('cc.journey.v1:human:male:mage:Three Island Explorer'))localStorage.setItem('cc.journey.v1:human:male:mage:Three Island Explorer',JSON.stringify({xp:137,coins:73,chapter:1,achievements:{earned:['island','treasure'],distance:63}}));});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));
 assert.ok(await p.evaluate(()=>{const g=window.app.current.game;return [[231,-61],[222,65]].every(([x,z])=>g.world.heightAt(x,z)>3)&&g.world.heightAt(230,-43)<0&&g.world.heightAt(222,33)<0&&g.achievements.has('treasure')&&g.achievements.has('island');}));
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.unit.teleport(g.world,143,19);});await p.keyboard.press('KeyF');await p.waitForFunction(()=>window.app.current.game.boats.seated);
 const before=await p.evaluate(()=>window.app.current.game.player.coins);
 for(const site of [{id:'moon',treasure:'moonTreasure',x:231,z:-61,r:12,coins:100},{id:'sunset',treasure:'sunsetTreasure',x:222,z:65,r:18,coins:125}]){
  // Offshore starting pose isolates each new approach. Sailing, collision, landing, walking and F interactions are native inputs.
  await p.evaluate(s=>{const g=window.app.current.game,b=g.boats.state;b.x=s.x-s.r-15;b.z=s.z;b.speed=0;b.yaw=Math.PI/2;g.follow.yaw=-Math.PI/2;g.follow.cut();},site);
  await p.keyboard.down('KeyW');await p.waitForFunction(()=>!!window.app.current.game.boats.landing(),null,{timeout:20000});await p.keyboard.up('KeyW');await p.waitForFunction(()=>Math.abs(window.app.current.game.boats.state.speed)<.3);
  await p.keyboard.press('KeyF');await p.waitForFunction(id=>!window.app.current.game.boats.seated&&window.app.current.game.achievements.has(id),site.id);
  assert.ok(await p.evaluate(()=>window.app.current.game.player.unit.pos.y>.15));
  await p.evaluate(s=>{const g=window.app.current.game,u=g.player.unit;u.setYaw(Math.atan2(s.x-2-u.pos.x,s.z+2-u.pos.z));g.follow.yaw=u.yaw+Math.PI;g.follow.cut();},site);
  await p.keyboard.down('KeyW');await p.waitForFunction(()=>window.app.current.game.voyageIsland.nearby());await p.keyboard.up('KeyW');await p.keyboard.press('KeyF');await p.waitForFunction(id=>window.app.current.game.achievements.has(id),site.treasure);const coins=await p.evaluate(()=>window.app.current.game.player.coins);await p.keyboard.press('KeyF');assert.equal(await p.evaluate(()=>window.app.current.game.player.coins),coins);
  await p.screenshot({path:`tmp/qa/archipelago-${site.id}.png`});
  await p.evaluate(()=>{const g=window.app.current.game,u=g.player.unit,b=g.boats.state;u.setYaw(Math.atan2(b.x-u.pos.x,b.z-u.pos.z));g.follow.yaw=u.yaw+Math.PI;g.follow.cut();});await p.keyboard.down('KeyW');await p.waitForFunction(()=>window.app.current.game.boats.nearby());await p.keyboard.up('KeyW');await p.keyboard.press('KeyF');await p.waitForFunction(()=>window.app.current.game.boats.seated);console.log('PASS native approach/shore landing/walk/chest once/reboard',site.id);
 }
 assert.equal(await p.evaluate(()=>window.app.current.game.player.coins),before+225);assert.ok(await p.evaluate(()=>window.app.current.game.achievements.has('archipelago')));
 await p.keyboard.press('KeyJ');await p.waitForFunction(()=>document.querySelectorAll('.achievement-row').length===15);await p.setViewportSize({width:718,height:492});assert.ok(await p.getByRole('button',{name:'뒤로',exact:true}).evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));await p.keyboard.press('Escape');await p.reload();await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});assert.ok(await p.evaluate(()=>['island','treasure','moon','sunset','moonTreasure','sunsetTreasure','archipelago'].every(id=>window.app.current.game.achievements.has(id))));assert.equal(await p.evaluate(()=>window.app.current.game.player.coins),before+225);
 assert.deepEqual(errors,[]);console.log('PASS separated terrain, old save compatibility, both new native island approaches, 225 coins once, 15 achievement rows, compact menu and reload persistence; page errors0');
}finally{await browser.close();}
