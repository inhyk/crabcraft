// Creator UI sets only the starting level/world. From Challenge onward, this pilot uses
// native keyboard input and reads state; no god mode, HP edits, teleports or combat calls.
// Run only after the sequential GPU endurance job has completely exited.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[],held=new Set(),inputs=[];let page;
async function keys(next){
 for(const key of [...held])if(!next.includes(key)){await page.keyboard.up(key);held.delete(key);}
 for(const key of next)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}
}
function toward(s,goal){
 const dx=goal[0]-s.p[0],dz=goal[1]-s.p[1],d=Math.hypot(dx,dz);
 if(d<.35)return [];
 const x=(dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw))/d,z=(dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw))/d;
 return [...(Math.abs(x)>.3?[x>0?'KeyA':'KeyD']:[]),...(Math.abs(z)>.3?[z>0?'KeyW':'KeyS']:[])];
}
function tangent(s,at,length){
 const dx=s.p[0]-s.b[0],dz=s.p[1]-s.b[1],d=Math.hypot(dx,dz)||1;
 const candidates=[1,-1].map(sign=>[at[0]+sign*dz/d*length,at[1]-sign*dx/d*length]);
 return candidates.sort((a,b)=>Math.hypot(a[0]-s.arena[0],a[1]-s.arena[1])-Math.hypot(b[0]-s.arena[0],b[1]-s.arena[1]))[0];
}
try{
 page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'priest',shell:0,crest:0,led:0,name:'Real Combat Pilot'}));});
 await page.goto(base+'/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.keyboard.type('13570');await page.getByRole('button',{name:'레벨 +10',exact:true}).click();for(let i=0;i<9;i++)await page.getByRole('button',{name:'레벨 +1',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.app.current.game.player.level),20);
 await page.getByRole('button',{name:'월드 2로 이동',exact:true}).click();await page.waitForFunction(()=>window.app.current.game.world2.chapter===2);await page.getByRole('button',{name:'제작자 화면 닫기',exact:true}).click();
 await page.locator('.boss-journey:has(.bj-card.eclipse) > summary').first().click();await page.locator('.bj-card.eclipse button').click();await page.waitForFunction(()=>window.app.current.game.worldBoss.state==='fight',null,{timeout:10000});
 const fullHealth=await page.evaluate(()=>{const b=window.app.current.game.worldBoss;return {hp:b.unit.hp,max:b.unit.maxHp};});assert.equal(fullHealth.hp,fullHealth.max,'Challenge must start a full-health boss');
 await page.mouse.click(640,496);
 for(let i=0;i<24;i++){if(await page.evaluate(()=>window.app.current.game.player.target===window.app.current.game.worldBoss.unit))break;await page.keyboard.press('Tab');await page.waitForTimeout(35);}
 assert.equal(await page.evaluate(()=>window.app.current.game.player.target===window.app.current.game.worldBoss.unit),true,'native targeting must select the actual boss');
 const read=()=>page.evaluate(()=>{const g=window.app.current.game,p=g.player,u=p.unit,b=g.worldBoss,m=b.mech;return {time:g.time,god:g.god,alive:u.alive,hp:u.hp,maxHp:u.maxHp,absorb:u.absorb,resource:p.resource,cast:p.cast?.ability.id,channel:!!p.channel,gcd:p.gcdEnd,abilities:p.cls.abilities.map(a=>({id:a.id,cost:a.cost,cd:p.cooldownLeft(a),cast:a.castTime})),target:p.target?.id,bossTarget:p.target===b.unit,p:[u.pos.x,u.pos.z],yaw:u.yaw,b:[b.unit.pos.x,b.unit.pos.z],bossHp:b.unit.hp,bossMax:b.unit.maxHp,phase:b.phase,state:b.state,arena:[b.arena.position.x,b.arena.position.z],mech:m?{id:b.mechIndex,kind:m.kind,at:[m.at.x,m.at.z],left:m.dur-m.t}:null,ending:{active:g.ending.active,started:g.ending.started,mode:g.ending.mode,dancers:g.ending.dancers.length},cleared:g.journey.trueCleared,adds:g.units.filter(v=>v.hostile&&v.alive&&!v.hidden&&v!==b.unit&&Math.hypot(v.pos.x-u.pos.x,v.pos.z-u.pos.z)-v.radius<=6).length};});
 const start=await read();assert.equal(start.god,false);console.log('START',JSON.stringify({...start,fullHealth}));
 let mechId=null,goal=null,lastLog=-Infinity,lastAbility=-Infinity,won=false;
 const deadline=Date.now()+600000;
 while(Date.now()<deadline){
  const s=await read();assert.equal(s.god,false);assert.equal(s.alive,true,'pilot died; inspect tactics before changing game balance');
  if(s.ending.started){assert.equal(s.ending.mode,'final');assert.equal(s.ending.dancers,16);assert.equal(s.cleared,true);won=true;break;}
  if(s.time-lastLog>=15){console.log('COMBAT',JSON.stringify({...s,abilityPresses:inputs.length,goal}));lastLog=s.time;}
  const distance=Math.hypot(s.p[0]-s.b[0],s.p[1]-s.b[1]);
  if(s.mech){
   if(mechId!==s.mech.id){
    mechId=s.mech.id;
    if(s.mech.kind==='nova'||s.mech.kind==='slam')goal=tangent(s,s.mech.at,s.mech.kind==='nova'?7.4:4.4);
    else if(s.mech.kind==='undertow')goal=tangent(s,s.p,10);
    else if(s.mech.kind==='eclipse'){
     const dx=s.p[0]-s.mech.at[0],dz=s.p[1]-s.mech.at[1],d=Math.hypot(dx,dz)||1,r=d<8.2?4.2:12.5;
     goal=[s.mech.at[0]+dx/d*r,s.mech.at[1]+dz/d*r];
    }
   }
  }else{
   mechId=null;
   if(distance<11.5){
    const a=Math.atan2(s.p[1]-s.arena[1],s.p[0]-s.arena[0]);
    const options=[-.65,.65].map(v=>[s.arena[0]+14*Math.cos(a+v),s.arena[1]+14*Math.sin(a+v)]);
    goal=options.sort((a,b)=>Math.hypot(b[0]-s.b[0],b[1]-s.b[1])-Math.hypot(a[0]-s.b[0],a[1]-s.b[1]))[0];
   }else goal=null;
  }
  const next=goal?toward(s,goal):[];await keys(next);
  if(!s.cast&&!s.channel&&s.time>=s.gcd&&s.time-lastAbility>.15){
   const ready=i=>s.resource>=s.abilities[i].cost&&s.abilities[i].cd<=0;
   let slot=0;
   if((!s.absorb||s.absorb<=0)&&s.hp<s.maxHp*.85&&ready(2))slot=3;
   else if((s.adds>0||s.hp<s.maxHp*.7)&&ready(3))slot=4;
   else if(next.length===0&&s.hp<s.maxHp*.65&&ready(1))slot=2;
   else if(next.length===0&&ready(0))slot=1;
   if(slot){await page.keyboard.press('Digit'+slot);inputs.push({time:s.time,slot});lastAbility=s.time;}
  }
  await page.waitForTimeout(60);
 }
 await keys([]);assert.equal(won,true,'native-input pilot did not finish within ten minutes');
 await page.screenshot({path:'tmp/qa/real-boss-run-dance.png'});
 await page.waitForFunction(()=>window.app.current.game.ending.t>4);await page.keyboard.press('Space');await page.locator('.credits').waitFor({state:'visible',timeout:45000});
 await page.keyboard.press('Space');await page.getByRole('button',{name:'계속 모험하기',exact:true}).click();await page.waitForFunction(()=>window.app.currentId==='game'&&window.app.current.game.loaded,null,{timeout:90000});
 const resumed=await read();assert.equal(resumed.cleared,true);assert.equal(resumed.state,'dead');assert.equal(resumed.ending.active,false);assert.equal(resumed.god,false);assert.deepEqual(errors,[]);
 console.log('PASS: actual native-input full-health level-20 priest boss victory, 16-dancer true ending and saved return; creator-level/world setup, not natural quest progression',JSON.stringify({abilityPresses:inputs.length,resumed}));
}catch(e){console.log('PILOT_FAILURE',e.message);if(page)await page.screenshot({path:'tmp/qa/real-boss-run-failure.png'}).catch(()=>{});throw e;}
finally{if(page)await keys([]).catch(()=>{});await browser.close();}
