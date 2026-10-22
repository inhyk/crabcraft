// Native-input western/eastern patrol requests; starting level/world only.
// Creator UI sets starting level/world only. The island planner is queried for clear paths;
// no player position/HP/quest progress, invulnerability or damage is injected.
// Run only after the sequential GPU endurance process has exited.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const held=new Set(),errors=[];let page;
async function keys(next){for(const k of [...held])if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
const read=()=>page.evaluate(()=>{const g=window.app.current.game,u=g.player.unit;return {time:g.time,god:g.god,alive:u.alive,hp:u.hp,maxHp:u.maxHp,p:[u.pos.x,u.pos.z],yaw:u.yaw,cameraYaw:g.follow.forwardYaw,resource:g.player.resource,gcd:g.player.gcdEnd,cast:!!g.player.cast,abilities:g.player.cls.abilities.map(a=>({cost:a.cost,cd:g.player.cooldownLeft(a)})),target:g.player.target?.id,foes:g.units.filter(v=>v.hostile&&v.alive&&!v.hidden&&![g.boss.unit,g.finalBoss.unit,g.worldBoss.unit].includes(v)&&Math.hypot(v.pos.x-u.pos.x,v.pos.z-u.pos.z)<15).map(v=>({id:v.id,x:v.pos.x,z:v.pos.z,d:Math.hypot(v.pos.x-u.pos.x,v.pos.z-u.pos.z)})),xp:g.player.xp,level:g.player.level,statuses:{...g.quests.status},progress:Object.fromEntries(g.quests.progress),chapter:g.world2.chapter};});
async function heal(){await keys([]);await page.waitForFunction(()=>{const g=window.app.current.game;return g.time>=g.player.gcdEnd&&!g.player.cast;},null,{timeout:4000});await page.keyboard.press('Digit2');await page.waitForFunction(()=>window.app.current.game.player.cast?.ability.id==='mend-shell',null,{timeout:1500});await page.waitForFunction(()=>!window.app.current.game.player.cast,null,{timeout:4000});}
// Fight nearby road guardians with actual controls instead of trying to heal under a crowd.
async function clearRoad(){
 await keys([]);const deadline=Date.now()+90000;let lastLog=-Infinity;
 while(Date.now()<deadline){
  const s=await read();assert.equal(s.god,false);assert.equal(s.alive,true);
  if(!s.foes.some(f=>f.d<9)){await keys([]);return;}
  if(s.time-lastLog>5){console.log('ROAD_COMBAT',JSON.stringify(s));lastLog=s.time;}
  if(!s.foes.some(f=>f.id===s.target&&f.d<12)){
   const nearest=[...s.foes].sort((a,b)=>a.d-b.d)[0];const desired=Math.atan2(nearest.x-s.p[0],nearest.z-s.p[1]);const delta=Math.atan2(Math.sin(desired-s.cameraYaw),Math.cos(desired-s.cameraYaw));
   if(Math.abs(delta)>.8){await keys([delta>0?'KeyQ':'KeyE']);await page.waitForTimeout(70);continue;}
   await keys([]);await page.keyboard.press('Tab');await page.waitForTimeout(50);continue;
  }
  await keys([]);
  if(!s.cast&&s.time>=s.gcd){const ready=i=>s.resource>=s.abilities[i].cost&&s.abilities[i].cd<=0;
   const slot=s.hp<s.maxHp*.9&&ready(2)?3:s.hp<s.maxHp*.7&&ready(1)?2:s.foes.some(f=>f.d<6)&&ready(3)?4:ready(0)?1:0;
   if(slot)await page.keyboard.press('Digit'+slot);
  }
  await page.waitForTimeout(70);
 }
 throw Error('native road combat timed out');
}
async function walk(target){
 await keys([]);await page.waitForTimeout(150);
 const path=await page.evaluate(target=>{
  const g=window.app.current.game,nav=g.world2.nav,from=g.player.unit.pos.clone();
  const centre=target.startsWith('enemy:')?g.units.find(u=>u.id===Number(target.slice(6)))?.pos.clone():g.npcById(target)?.unit.pos.clone()??g.world2.objectivePoint(target);
  if(!centre||!nav)throw Error('missing target/planner');
  const candidates=[];
  for(let i=0;i<8;i++){
   const goal=centre.clone();goal.x+=Math.sin(i*Math.PI/4)*2.4;goal.z+=Math.cos(i*Math.PI/4)*2.4;goal.y=g.world.heightAt(goal.x,goal.z);
   const points=nav.plan(from,goal);let prev=from,cost=0,clear=true;
   for(const p of points){clear&&=nav.walkable(prev,p);cost+=prev.distanceTo(p);prev=p;}
   if(clear){
    // Native eight-direction walking follows short intermediate points, not a long chord
    // whose discrete headings can drift into a house beside the verified route.
    const dense=[];let previous=from;
    for(const point of points){const steps=Math.max(1,Math.ceil(previous.distanceTo(point)/1.5));for(let j=1;j<=steps;j++){const f=j/steps;dense.push([previous.x+(point.x-previous.x)*f,previous.z+(point.z-previous.z)*f]);}previous=point;}
    candidates.push({points:dense,cost});
   }
  }
  candidates.sort((a,b)=>a.cost-b.cost);if(!candidates.length)throw Error('no verified clear path to '+target);
  return {target,centre:[centre.x,centre.z],...candidates[0]};
 },target);
 console.log('WALK_ROUTE',JSON.stringify(path));
 const until=Date.now()+180000;let index=0,lastLog=-Infinity,previous=null,previousAt=Date.now();
 while(Date.now()<until){
  const s=await read();assert.equal(s.god,false);assert.equal(s.alive,true);assert.equal(s.chapter,2);
  if(s.foes.some(f=>f.d<6)||(s.hp<s.maxHp*.65&&s.foes.some(f=>f.d<12))){await clearRoad();previous=null;previousAt=Date.now();continue;}
  if(Math.hypot(s.p[0]-path.centre[0],s.p[1]-path.centre[1])<2.7){await keys([]);await page.waitForTimeout(180);return s;}
  while(index<path.points.length-1&&Math.hypot(s.p[0]-path.points[index][0],s.p[1]-path.points[index][1])<.3)index++;
  const goal=path.points[index],dx=goal[0]-s.p[0],dz=goal[1]-s.p[1],d=Math.hypot(dx,dz)||1;
  const x=(dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw))/d,z=(dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw))/d;
  if(s.hp<s.maxHp*.55){await heal();previous=null;previousAt=Date.now();continue;}
  await keys([...(Math.abs(x)>.3?[x>0?'KeyA':'KeyD']:[]),...(Math.abs(z)>.3?[z>0?'KeyW':'KeyS']:[])]);
  if(s.time-lastLog>10){console.log('WALK',JSON.stringify({target,index,state:s}));lastLog=s.time;}
  if(Date.now()-previousAt>5000){if(previous)assert.ok(Math.hypot(s.p[0]-previous[0],s.p[1]-previous[1])>.3,'native walker stuck; inspect path/collision');previous=s.p;previousAt=Date.now();}
  await page.waitForTimeout(65);
 }
 throw Error('native walk timed out: '+target);
}
try{
 page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'priest',shell:0,crest:0,led:0,name:'Ore Walker'}));});
 await page.goto(base+'/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.keyboard.type('13570');await page.getByRole('button',{name:'레벨 +10',exact:true}).click();for(let i=0;i<9;i++)await page.getByRole('button',{name:'레벨 +1',exact:true}).click();await page.getByRole('button',{name:'월드 2로 이동',exact:true}).click();await page.waitForFunction(()=>window.app.current.game.world2.chapter===2);await page.getByRole('button',{name:'제작자 화면 닫기',exact:true}).click();


 await page.mouse.click(640,496);const before=await read();assert.equal(before.god,false);
 async function talk(npc){await walk(npc);await page.keyboard.press('KeyF');await page.locator('.dlg').waitFor({state:'visible'});}
 for(const [id,npc,kind,xp] of [['w1','brinebeard','scrapling',1100],['w4','grukk','scavenger',1800]]){
  await talk(npc);await page.getByRole('button',{name:'퀘스트 받기',exact:true}).click();await page.waitForFunction(id=>window.app.current.game.quests.status[id]==='active',id);
  const deadline=Date.now()+300000;
  while((await read()).statuses[id]==='active'&&Date.now()<deadline){
   const target=await page.evaluate(kind=>{const g=window.app.current.game,u=g.player.unit;return g.units.filter(v=>v.kind===kind&&v.alive&&!v.hidden&&v.targetable).sort((a,b)=>u.distTo(a)-u.distTo(b))[0]?.id;},kind);
   if(!target){console.log('NATIVE_PATROL_WAIT_UNSEEN',id);await walk(npc);await page.waitForTimeout(14000);continue;}await walk('enemy:'+target);await clearRoad();console.log('NATIVE_PATROL',id,JSON.stringify(await read()));
  }
  assert.equal((await read()).statuses[id],'ready');await talk(npc);const prior=await read();await page.getByRole('button',{name:'보상 받기',exact:true}).click();await page.waitForFunction(id=>window.app.current.game.quests.status[id]==='done',id);assert.equal((await read()).xp-prior.xp,xp);console.log('NATIVE_PATROL_REWARD',id,JSON.stringify(await read()));
 }
 const rewarded=await read();assert.ok(rewarded.level>20);await page.screenshot({path:'tmp/qa/walk-patrol-rewarded.png'});await page.reload();await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));const restored=await read();for(const id of ['w1','w4'])assert.equal(restored.statuses[id],'done');assert.equal(restored.xp,rewarded.xp);assert.equal(restored.chapter,2);assert.equal(restored.god,false);assert.deepEqual(errors,[]);
 console.log('PASS: actual native walking/targeting/abilities defeat six western sentries and eight eastern guardians; both NPC rewards, natural levels beyond20 and reload; creator level/world setup only',JSON.stringify({before,rewarded,restored}));
}catch(e){console.log('PATROL_WALK_FAILURE',e.message);if(page){console.log('STATE',JSON.stringify(await read().catch(()=>null)));await page.screenshot({path:'tmp/qa/walk-patrol-failure.png'}).catch(()=>{});}throw e;}
finally{if(page)await keys([]).catch(()=>{});await browser.close();}
