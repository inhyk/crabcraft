import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Arena QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');});
 await p.goto((process.env.CC_QA_BASE??'http://127.0.0.1:5227')+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 const floor=await p.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.god=true;g.ending.cancel();g.world2.go(3);g.player.unit.level=100;g.player.unit.teleport(g.world,0,-54,Math.PI);g.follow.yaw=0;g.follow.pitch=.85;g.follow.distance=30;g.follow.raycast=undefined;g.follow.cut();const platform=g.world2.third.root.getObjectByName('dawn-boss-platform');return{ground:g.world.heightAt(0,-72),arena:g.dawnBoss.arena.position.y,top:platform.position.y+platform.geometry.parameters.height/2};});
 assert.equal(floor.ground,19);assert.equal(floor.arena,19);assert.ok(Math.abs(floor.top-19.05)<1e-8);
 await p.keyboard.down('w');await p.waitForTimeout(1600);await p.keyboard.up('w');
 const player=await p.evaluate(()=>{const g=window.app.current.game;return{x:g.player.unit.pos.x,y:g.player.unit.pos.y,z:g.player.unit.pos.z};});assert.ok(player.z< -55,JSON.stringify(player));assert.ok(Math.abs(player.y-19)<.001,JSON.stringify(player));
 await p.evaluate(()=>window.app.current.game.dawnBoss.wake());await p.waitForFunction(()=>window.app.current.game.dawnBoss.state==='idle'||window.app.current.game.dawnBoss.state==='fight');
 const boss=await p.evaluate(()=>{const b=window.app.current.game.dawnBoss;return{y:b.unit.pos.y,hidden:b.unit.hidden};});assert.equal(boss.y,19);assert.equal(boss.hidden,false);
 await p.screenshot({path:'tmp/qa/dawn-raised-arena.png'});assert.deepEqual(errors,[]);console.log('PASS platform raised from 17.05m to 19.05m, playable floor and boss at 19m, keyboard approach traversable, zero browser errors');
}finally{await browser.close();}
