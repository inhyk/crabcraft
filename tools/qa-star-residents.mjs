import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','low');});
 await page.goto('http://127.0.0.1:5192/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 const result=await page.evaluate(()=>{
  const g=window.app.current.game;g.god=true;g.world2.enter();g.engine.renderer.setAnimationLoop(null);g.player.unit.teleport(g.world,40,90);
  const routes=[[0,72,0,36],[0,36,0,72],[-15,62,15,44]],results=[];
  for(const fps of [30,60,144])for(const t of g.townsfolk)for(const [ax,az,bx,bz] of routes){const u=t.unit;u.teleport(g.world,ax,az);t.walking=true;t.frozen=false;t.dest.set(bx,0,bz);t.velX=t.velZ=0;t.stuckFor=0;t.speed=1.7;let frames=0,minClearance=Infinity;
   for(;frames<fps*100&&t.walking;frames++){g.time+=1/fps;t.update(1/fps);minClearance=Math.min(minClearance,Math.hypot(u.pos.x,u.pos.z-55)-3.6-u.radius);}
   results.push({fps,name:u.name,radius:u.radius,route:[ax,az,bx,bz],x:u.pos.x,z:u.pos.z,frames,arrived:Math.hypot(u.pos.x-bx,u.pos.z-bz)<.55,minClearance,finite:Number.isFinite(u.pos.y)});
  }
  return results;
 });console.log(JSON.stringify(result));
 if(!process.env.CC_QA_PROBE){assert.equal(result.length,72);assert.ok(result.every(r=>r.arrived&&r.finite&&r.minClearance>-.1));}
 const stroll=await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();g.player.unit.teleport(g.world,40,90);const stats=g.townsfolk.map(t=>({name:t.unit.name,arrivals:0,abandoned:0,distance:0}));for(let frame=0;frame<5400;frame++){g.time+=1/30;g.townsfolk.forEach((t,i)=>{const was=t.walking,x=t.unit.pos.x,z=t.unit.pos.z;t.update(1/30);stats[i].distance+=Math.hypot(t.unit.pos.x-x,t.unit.pos.z-z);if(was&&!t.walking){if(Math.hypot(t.unit.pos.x-t.dest.x,t.unit.pos.z-t.dest.z)<.6)stats[i].arrivals++;else stats[i].abandoned++;}});}return stats;});console.log('NATURAL_STROLLS',JSON.stringify(stroll));assert.ok(stroll.every(t=>t.arrivals>=3&&t.distance>40));
 const lifecycle=await page.evaluate(()=>{const g=window.app.current.game,t=g.townsfolk[0],u=t.unit;const independent=new Set(g.townsfolk.map(t=>t.route)).size===8&&!g.townsfolk.some(t=>t.route===g.world2.nav);t.walking=true;t.dest.set(0,0,24);t.frozen=true;const before=u.pos.clone();g.time+=1;t.update(1);const frozen=u.pos.distanceTo(before)===0;t.frozen=false;g.world2.returnToShore();return {independent,frozen,shoreRoutesCleared:g.townsfolk.every(t=>t.route===null)};});
 assert.deepEqual(lifecycle,{independent:true,frozen:true,shoreRoutesCleared:true});
 await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();g.hud.menu.show();g.hud.menu.settings();});
 async function dialogue(){return page.evaluate(()=>{const g=window.app.current.game,lines=g.npcs.map(n=>n.nextLine()),spoken=[],say=g.say,random=Math.random;try{g.say=(u,line)=>spoken.push(line);Math.random=()=>0;for(const t of g.townsfolk){t.barkCd=-1;t.bark();}}finally{g.say=say;Math.random=random;}return {lines,spoken};});}
 const ko=await dialogue();await page.getByRole('button',{name:'English',exact:true}).click();const en=await dialogue();assert.ok(ko.lines.every(s=>/[가-힣]/.test(s)));assert.ok(en.lines.every(s=>!/[가-힣]/.test(s)));assert.ok(ko.spoken.every(s=>s==='별빛 항구에 오신 걸 환영해요!'));assert.ok(en.spoken.every(s=>s==='Welcome to Starhaven!'));console.log('PASS: independent routes, ending freeze, shore reset and real language settings for seven NPCs/eight residents',JSON.stringify(lifecycle));
 assert.deepEqual(errors,[]);console.log(process.env.CC_QA_PROBE?'PROBE: resident routes across the fountain':'PASS: 72 resident routes at 30/60/144 Hz arrive with fountain clearance and finite heights');
}finally{await browser.close();}
