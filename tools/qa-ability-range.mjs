import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5219';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Range QA'}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');});
 await page.goto(base+'/?screen=game');await page.locator('.launch-notice-start').click();await page.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await page.evaluate(()=>{const g=window.app.current.game;g.multiplayer.connect('create');g.god=true;g.journey.firstEndingSeen=true;g.ending.cancel();g.player.unit.teleport(g.world,8,8);g.follow.yaw=0;});
 await page.waitForFunction(()=>!!window.app.current.game.multiplayer.room);
 const slots=page.locator('.ab-slot');
 await slots.nth(3).hover();await page.waitForFunction(()=>window.app.current.game.scene.getObjectByName('ability-range-preview')?.visible);
 const stats=await page.evaluate(()=>{const g=window.app.current.game,r=g.scene.getObjectByName('ability-range-preview'),geo=r.children[1].geometry,a=geo.getAttribute('position');let max=0,min=Infinity;for(let i=0;i<192;i++){const d=Math.hypot(a.getX(i)-g.player.unit.pos.x,a.getZ(i)-g.player.unit.pos.z);max=Math.max(max,d);min=Math.min(min,d);}return {radius:r.userData.radius,max,min,count:geo.drawRange.count,resource:g.player.resource,hp:g.player.unit.hp}});
 assert.equal(stats.radius,6);assert.ok(Math.abs(stats.max-6)<.001);assert.ok(Math.abs(stats.min-6)<.001);assert.match(await page.locator('.cc-tooltip').innerText(),/반경 6m/);await page.screenshot({path:'tmp/qa/ability-range-six.png'});
 await slots.nth(1).hover();assert.match(await page.locator('.cc-tooltip').innerText(),/부채꼴/);
 assert.equal(await page.evaluate(()=>window.app.current.game.scene.getObjectByName('ability-range-preview').userData.radius),8);
 await slots.nth(2).hover();assert.match(await page.locator('.cc-tooltip').innerText(),/최대 이동 8m/);
 assert.equal(await page.evaluate(()=>window.app.current.game.scene.getObjectByName('ability-range-preview').children[0].geometry.drawRange.count),0);
 await slots.nth(4).hover();assert.equal(await page.evaluate(()=>window.app.current.game.scene.getObjectByName('ability-range-preview').userData.radius),10);
 await page.mouse.move(10,450);await page.waitForFunction(()=>!window.app.current.game.scene.getObjectByName('ability-range-preview').visible);
 assert.equal(await page.locator('.cc-tooltip').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS real hover: exact 6 m radius, 8 m cone, blink distance, 10 m ultimate, mouse-leave cleanup and zero browser errors');
}finally{await browser.close()}
