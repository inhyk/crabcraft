// Compare off-grid gameplay height with the actual rendered terrain triangles.
import {launchBrowser} from './lib/browser.mjs';import assert from 'node:assert/strict';import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','low');});await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 const result=await page.evaluate(()=>{
  const g=window.app.current.game;g.god=true;g.world2.enter();const p=g.world2.root.getObjectByName('star-island-ground').geometry.attributes.position;let maxError=0,worst=null,checked=0;
  const rendered=(x,z)=>{const gx=(x-p.getX(0))/2,gz=(z-p.getZ(0))/2,ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,a=iz*141+ix,b=a+141,d=a+1,c=b+1;return u+v<=1?p.getY(a)+(p.getY(d)-p.getY(a))*u+(p.getY(b)-p.getY(a))*v:p.getY(c)+(p.getY(b)-p.getY(c))*(1-u)+(p.getY(d)-p.getY(c))*(1-v);};
  for(let i=0;i<12000;i++){const x=Math.sin(i*127.1)*98,z=Math.cos(i*311.7)*115+10;if(Math.hypot(x/110,(z-10)/132)>.9)continue;const error=Math.abs(g.world.heightAt(x,z)-rendered(x,z));checked++;if(error>maxError){maxError=error;worst={x,z,error};}}
  const boundaries=[[9,-20],[54,50],[30,3],[30,100],[24,-75]],jumps=boundaries.map(([x,z],i)=>({x,z,jump:Math.abs(i===2||i===3?g.world.heightAt(x,z-.001)-g.world.heightAt(x,z+.001):g.world.heightAt(x-.001,z)-g.world.heightAt(x+.001,z))}));
  let plateauError=0;for(let z=-72;z<=92;z+=.5)for(let x=-4;x<=4;x+=1)plateauError=Math.max(plateauError,Math.abs(g.world.heightAt(x,z)-3));
  const moves=[];for(const [ax,az,bx,bz] of [[50,5,62,5],[30,9,30,-5],[3,-20,16,-20],[18,-70,32,-70]]){const u=g.player.unit;u.teleport(g.world,ax,az);let maxStep=0,previous=u.pos.y;for(let i=1;i<=56;i++){const t=i/56,x=ax+(bx-ax)*t,z=az+(bz-az)*t;u.moveTo(g.world,x,z,1/30);maxStep=Math.max(maxStep,Math.abs(u.pos.y-previous));previous=u.pos.y;}moves.push({x:u.pos.x,z:u.pos.z,maxStep,arrived:Math.hypot(u.pos.x-bx,u.pos.z-bz)<.01});}
  return {checked,maxError,worst,jumps,plateauError,moves};
 });console.log(JSON.stringify(result));
 if(!process.env.CC_QA_PROBE){assert.ok(result.checked>6000);assert.ok(result.maxError<.00002);assert.ok(result.jumps.every(p=>p.jump<.005));assert.equal(result.plateauError,0);assert.ok(result.moves.every(m=>m.arrived&&m.maxStep<.2));}
 assert.deepEqual(errors,[]);console.log(process.env.CC_QA_PROBE?'PROBE: recorded off-grid surface and flattening boundaries':'PASS: off-grid triangle agreement, continuous boundaries, unchanged flat avenue and actual movement across four transitions');
}finally{await browser.close();}
