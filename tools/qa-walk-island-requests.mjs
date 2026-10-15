// Native-input waystones, exploration memories and soup delivery; starting level/world only.
// Creator UI sets starting level/world only. The island planner is queried for clear paths;
// no player position/HP/quest progress, invulnerability or damage is injected.
// Run only after the sequential GPU endurance process has exited.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const held=new Set(),errors=[];let page;
async function keys(next){for(const k of [...held])if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
const read=()=>page.evaluate(()=>{const g=window.app.current.game,u=g.player.unit;return {time:g.time,god:g.god,alive:u.alive,hp:u.hp,maxHp:u.maxHp,p:[u.pos.x,u.pos.z],yaw:u.yaw,xp:g.player.xp,level:g.player.level,statuses:{...g.quests.status},progress:Object.fromEntries(g.quests.progress),chapter:g.world2.chapter};});
async function heal(){await keys([]);await page.keyboard.press('Digit2');await page.waitForFunction(()=>window.app.current.game.player.cast?.ability.id==='mend-shell',null,{timeout:1500});await page.waitForFunction(()=>!window.app.current.game.player.cast,null,{timeout:4000});}
async function walk(target){
 await keys([]);await page.waitForTimeout(150);
 const path=await page.evaluate(target=>{
  const g=window.app.current.game,nav=g.world2.nav,from=g.player.unit.pos.clone();
  const centre=g.npcById(target)?.unit.pos.clone()??g.world2.objectivePoint(target);
  if(!centre||!nav)throw Error('missing target/planner');
  const candidates=[];
  for(let i=0;i<8;i++){
   const goal=centre.clone();goal.x+=Math.sin(i*Math.PI/4)*2.4;goal.z+=Math.cos(i*Math.PI/4)*2.4;goal.y=g.world.heightAt(goal.x,goal.z);
   const points=nav.plan(from,goal);let prev=from,cost=0,clear=true;
   for(const p of points){clear&&=nav.walkable(prev,p);cost+=prev.distanceTo(p);prev=p;}
   if(clear)candidates.push({points:points.map(p=>[p.x,p.z]),cost});
  }
  candidates.sort((a,b)=>a.cost-b.cost);if(!candidates.length)throw Error('no verified clear path to '+target);
  return {target,centre:[centre.x,centre.z],...candidates[0]};
 },target);
 console.log('WALK_ROUTE',JSON.stringify(path));
 const until=Date.now()+180000;let index=0,lastLog=-Infinity,previous=null,previousAt=Date.now();
 while(Date.now()<until){
  const s=await read();assert.equal(s.god,false);assert.equal(s.alive,true);assert.equal(s.chapter,2);
  if(Math.hypot(s.p[0]-path.centre[0],s.p[1]-path.centre[1])<2.7){await keys([]);await page.waitForTimeout(180);return s;}
  while(index<path.points.length-1&&Math.hypot(s.p[0]-path.points[index][0],s.p[1]-path.points[index][1])<.8)index++;
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

 await page.mouse.click(640,496);const before=await read();assert.equal(before.god,false);assert.equal(before.level,20);
 async function talk(npc){await walk(npc);await page.keyboard.press('KeyF');await page.locator('.dlg').waitFor({state:'visible'});}
 async function accept(id,npc){await talk(npc);await page.getByRole('button',{name:'퀘스트 받기',exact:true}).click();await page.waitForFunction(id=>window.app.current.game.quests.status[id]==='active',id);}
 async function reward(id,npc,xp){await talk(npc);const prior=(await read()).xp;await page.getByRole('button',{name:'보상 받기',exact:true}).click();await page.waitForFunction(id=>window.app.current.game.quests.status[id]==='done',id);const after=await read();assert.equal(after.xp-prior,xp);console.log('NATIVE_REWARD',id,JSON.stringify(after));}
 await accept('w3','rattlebolt');
 for(const kind of ['lamp-a','lamp-b','lamp-c']){
  await walk(kind);await page.keyboard.down('KeyF');
  try{await page.waitForFunction(kind=>{const g=window.app.current.game;return g.quests.objectiveDone(g.world2.nodes.find(n=>n.kind===kind).objective);},kind,{timeout:4000});}finally{await page.keyboard.up('KeyF');}
  console.log('NATIVE_WAYSTONE',kind,JSON.stringify(await read()));
 }
 assert.equal((await read()).statuses.w3,'ready');await page.screenshot({path:'tmp/qa/walk-waystones-ready.png'});await reward('w3','rattlebolt',1700);
 await accept('w5','silvermoon');
 for(const kind of ['explore-west','explore-east','explore-north']){
  await walk(kind);const objective='w5-'+kind.slice(8);await page.waitForFunction(id=>window.app.current.game.quests.progress.get(id)>=1,objective,{timeout:2000});
  console.log('NATIVE_MEMORY',kind,JSON.stringify(await read()));if(await page.locator('.memory-close').isVisible())await page.locator('.memory-close').click();
 }
 assert.equal((await read()).statuses.w5,'ready');await page.screenshot({path:'tmp/qa/walk-memories-ready.png'});await reward('w5','silvermoon',2000);
 await accept('w6','hoofclaw');await reward('w6','coralline',1000);
 const rewarded=await read();assert.equal(rewarded.xp-before.xp,4700);await page.reload();await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));const restored=await read();for(const id of ['w3','w5','w6'])assert.equal(restored.statuses[id],'done');assert.equal(restored.xp,rewarded.xp);assert.equal(restored.chapter,2);assert.equal(restored.god,false);assert.deepEqual(errors,[]);
 console.log('PASS: native walking, three held-F waystones, three exploration memories, NPC soup delivery, rewards +4700 XP and reload; creator level/world setup only',JSON.stringify({before,rewarded,restored}));
}catch(e){console.log('ISLAND_WALK_FAILURE',e.message);if(page){console.log('STATE',JSON.stringify(await read().catch(()=>null)));await page.screenshot({path:'tmp/qa/walk-island-requests-failure.png'}).catch(()=>{});}throw e;}
finally{if(page)await keys([]).catch(()=>{});await browser.close();}
