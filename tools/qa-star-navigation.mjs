// Exercise island guidance against actual player collision, then walk a tracked quest with W.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');
 await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
 const routes=await page.evaluate(()=>{
  const g=window.app.current.game;g.god=true;g.world2.enter();const u=g.player.unit;
  const points=[...g.world2.nodes.map(n=>[n.kind,n.position.x,n.position.z+(n.kind.startsWith('lamp')?2.8:0)]),...g.world2.memories.map(n=>[n.kind,n.star.position.x,n.star.position.z]),['throne',0,-75]];
  // A solid lantern is approached within its 3.5-unit F interaction radius, not walked through.
  for(const n of g.world2.nodes.filter(n=>n.kind.startsWith('lamp'))){const p=points.find(p=>p[0]===n.kind);if(Math.hypot(p[1]-n.position.x,p[2]-n.position.z)>=3.5)throw Error('Waystone approach exceeds interaction reach');}
  const jobs=[...g.npcs.map(n=>[n.def.id,0,86,n.unit.pos.x,n.unit.pos.z])];
  for(const [name,x,z] of points){jobs.push([name,0,24,x,z],[name+' return',x,z,0,24]);}
  jobs.push(['arrival to throne',0,86,0,-75]);let now=100;const results=[];
  for(const [name,fx,fz,tx,tz] of jobs){
   u.teleport(g.world,fx,fz);const goal=u.pos.clone().set(tx,g.world.heightAt(tx,tz),tz);const lamp=g.world2.nodes.find(n=>n.kind===name&&n.kind.startsWith('lamp'));const tolerance=lamp ? .3 : 1;let count=0,blocked=null,distance=0;now+=1000;
   for(;count<1800&&Math.hypot(u.pos.x-goal.x,u.pos.z-goal.z)>tolerance;count++){
    const via=g.world2.waypoint(u.pos,goal,now),dx=via.x-u.pos.x,dz=via.z-u.pos.z,d=Math.hypot(dx,dz),step=Math.min(.25,d);
    if(d<.001){blocked='stationary waypoint';break;}
    const x=u.pos.x+dx/d*step,z=u.pos.z+dz/d*step;u.moveTo(g.world,x,z,.05);
    if(Math.hypot(u.pos.x-x,u.pos.z-z)>.08){blocked={x,z,actual:[u.pos.x,u.pos.z],via:via.toArray()};break;}
    distance+=step;now+=.05;
   }
   results.push({name,count,distance,remaining:Math.hypot(u.pos.x-goal.x,u.pos.z-goal.z),interactionDistance:lamp?u.pos.distanceTo(lamp.position):null,blocked});
  }
  return {radius:u.radius,graphNodes:g.world2.nav.nodes.length,results};
 });
 for(const r of routes.results){assert.equal(r.blocked,null,JSON.stringify(r));assert.ok(r.remaining<=1.01,JSON.stringify(r));if(r.interactionDistance!==null)assert.ok(r.interactionDistance<3.5,JSON.stringify(r));}
 console.log('collision routes',JSON.stringify(routes));
 await page.evaluate(()=>{
  const g=window.app.current.game;g.player.unit.teleport(g.world,0,86,Math.PI);g.world2.resetPortalArrival();g.follow.cut();g.quests.accept('w5');g.quests.track('w5');
  // Isolate navigation from combat; keyboard movement, quest exploration and frame guidance stay real.
  for(const e of g.enemies)e.unit.hidden=true;
  window.navWalk={turns:0,detours:0,start:g.player.unit.pos.clone(),lastVia:null};
  window.stopNavWalk=g.engine.onFrame(()=>{
   const goal=g.objectivePos(),via=g.hintVia,u=g.player.unit,s=window.navWalk;
   if(!goal||!via||g.quests.progress.get('w5-west')>=1)return;
   if(via.distanceTo(goal)>1)s.detours++;
   if(!s.lastVia||via.distanceTo(s.lastVia)>2){s.turns++;s.lastVia=via.clone();}
   u.setYaw(Math.atan2(via.x-u.pos.x,via.z-u.pos.z));
  });
 });
 await page.keyboard.down('w');
 await page.waitForFunction(()=>window.app.current.game.quests.progress.get('w5-west')>=1,null,{timeout:120000});
 await page.keyboard.up('w');await page.evaluate(()=>window.stopNavWalk());await page.waitForTimeout(250);
 const walk=await page.evaluate(()=>{const g=window.app.current.game,s=window.navWalk;return {turns:s.turns,detours:s.detours,position:g.player.unit.pos.toArray(),next:g.quests.current().objective.kind,chapter:g.world2.chapter};});
 assert.ok(walk.detours>10,'the frame guidance must take a detour instead of pointing through buildings');assert.ok(walk.turns>=2);assert.equal(walk.next,'explore-east');assert.equal(walk.chapter,2);
 await page.screenshot({path:'tmp/qa/star-navigation-west.png'});
 const travel=await page.evaluate(()=>{const g=window.app.current.game,shoreNav=g.nav;g.world2.returnToShore();const preserved=g.nav===shoreNav;g.world2.enter();const from=g.player.unit.pos,goal=g.world2.arena.position,via=g.world2.waypoint(from,goal,g.time);return {preserved,chapter:g.world2.chapter,detour:via.distanceTo(goal),walkable:g.world2.nav.walkable(from,via)};});
 assert.deepEqual({...travel,detour:undefined},{preserved:true,chapter:2,walkable:true,detour:undefined});assert.ok(travel.detour>1);assert.deepEqual(errors,[]);
 console.log('PASS: all island destination/return routes, actual W-key tracked exploration, chapter travel and visible guidance',JSON.stringify({walk,travel,errors}));
}finally{await browser.close();}
