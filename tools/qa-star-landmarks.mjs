// Run a Vite preview on port 5192. Uses an isolated browser and captures the three exploration landmarks.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto('http://127.0.0.1:5192/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});const result=await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();const trails=g.world2.trails,blocked=[];for(const [route,path] of trails.entries())for(let i=1;i<path.length;i++){const [ax,az]=path[i-1],[bx,bz]=path[i],steps=Math.ceil(Math.hypot(bx-ax,bz-az));for(let j=0;j<=steps;j++){const u=j/steps,x=ax+(bx-ax)*u,z=az+(bz-az)*u,out=g.player.unit.pos.clone();g.world.resolveCollision(x,z,1,out);const displacement=Math.hypot(out.x-x,out.y-z);if(displacement>1)blocked.push({route,x,z,displacement});}}return {blocked:blocked.slice(0,30),count:blocked.length};});console.log(result);assert.equal(result.count,0);
await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.hud.hints.dismiss();});
for(const [name,x,z] of [['west',-75,-35],['east',80,-40],['north',0,-48]]){await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z+16,Math.PI);g.follow.cut();g.follow.yaw=0;g.follow.distance=9;g.follow.pitch=.28;},[x,z]);await page.waitForTimeout(5000);await page.screenshot({path:`tmp/qa/landmark-${name}.png`});}
console.log('PASS: every trail centerline clear for a one-unit player radius; captured all landmarks');}finally{await browser.close();}
