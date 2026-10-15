// Creator UI sets only the starting level/world. From Challenge onward, this pilot uses
// native keyboard input and reads state; no god mode, HP edits, teleports or combat calls.
// Run only after the sequential GPU endurance job has completely exited.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
const relay=process.env.CC_QA_RELAY??new URL('/multiplayer',base).href.replace(/^http/,'ws');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[],heldByPage=new WeakMap(),inputs=[],pages=[];let page;
async function keys(next){
 const held=heldByPage.get(page)??new Set();heldByPage.set(page,held);
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
 async function prepare(name,language){
  const p=await browser.newPage({viewport:{width:1280,height:800}});pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(({name,language,relay})=>{const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(url,protocols){super(String(url).includes('/multiplayer')?relay:url,protocols);}};localStorage.setItem('cc.language',language);localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'priest',shell:0,crest:0,led:0,name}));},{name,language,relay});
  await p.goto(base+'/?screen=game&multiplayer');await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));await p.keyboard.type('13570');await p.getByRole('button',{name:language==='ko'?'레벨 +10':'Level +10',exact:true}).click();for(let i=0;i<9;i++)await p.getByRole('button',{name:language==='ko'?'레벨 +1':'Level +1',exact:true}).click();await p.getByRole('button',{name:language==='ko'?'제작자 화면 닫기':'Close creator tools',exact:true}).click();return p;
 }
 const host=await prepare('Coop Host','ko'),friend=await prepare('Coop Friend','en');
 await host.getByRole('button',{name:'방 만들기',exact:true}).click();await host.waitForFunction(()=>window.app.current.game.multiplayer.room);const room=await host.evaluate(()=>window.app.current.game.multiplayer.room);await friend.getByRole('textbox',{name:'Room code',exact:true}).fill(room);await friend.getByRole('button',{name:'Join',exact:true}).click();await friend.waitForFunction(()=>window.app.current.game.multiplayer.battle.active);await host.waitForFunction(()=>{const players=window.app.current.game.combatPlayers();return players.length===2&&players.every(p=>p.level===20);});
 await host.keyboard.type('13570');await host.getByRole('button',{name:'월드 2로 이동',exact:true}).click();await host.getByRole('button',{name:'제작자 화면 닫기',exact:true}).click();for(const p of pages)await p.waitForFunction(()=>window.app.current.game.world2.chapter===2);
 await host.locator('.boss-journey:has(.bj-card.eclipse) > summary').click();await host.locator('.bj-card.eclipse button').click();await host.waitForFunction(()=>window.app.current.game.worldBoss.state==='fight',null,{timeout:10000});
 const fullHealth=await host.evaluate(()=>{const b=window.app.current.game.worldBoss;return {hp:b.unit.hp,max:b.unit.maxHp};});assert.equal(fullHealth.hp,fullHealth.max);
 await friend.waitForFunction(()=>window.app.current.game.worldBoss.state==='fight');await friend.locator('.boss-journey:has(.bj-card.eclipse) > summary').click();await friend.locator('.bj-card.eclipse button').click();
 for(const p of pages){await p.mouse.click(640,496);for(let i=0;i<24;i++){if(await p.evaluate(()=>window.app.current.game.player.target===window.app.current.game.worldBoss.unit))break;await p.keyboard.press('Tab');await p.waitForTimeout(35);}assert.equal(await p.evaluate(()=>window.app.current.game.player.target===window.app.current.game.worldBoss.unit),true);}
 const read=()=>page.evaluate(()=>{const g=window.app.current.game,p=g.player,u=p.unit,b=g.worldBoss,m=b.mech;return {connected:g.multiplayer.battle.active,time:g.time,god:g.god,alive:u.alive,hp:u.hp,maxHp:u.maxHp,absorb:u.absorb,resource:p.resource,cast:p.cast?.ability.id,channel:!!p.channel,gcd:p.gcdEnd,abilities:p.cls.abilities.map(a=>({id:a.id,cost:a.cost,cd:p.cooldownLeft(a),cast:a.castTime})),target:p.target?.id,bossTarget:p.target===b.unit,p:[u.pos.x,u.pos.z],yaw:u.yaw,b:[b.unit.pos.x,b.unit.pos.z],bossHp:b.unit.hp,bossMax:b.unit.maxHp,phase:b.phase,state:b.state,arena:[b.arena.position.x,b.arena.position.z],mech:m?{id:b.mechIndex,kind:m.kind,at:[m.at.x,m.at.z],left:m.dur-m.t}:null,ending:{active:g.ending.active,started:g.ending.started,mode:g.ending.mode,dancers:g.ending.dancers.length},cleared:g.journey.trueCleared,adds:g.units.filter(v=>v.hostile&&v.alive&&!v.hidden&&v!==b.unit&&Math.hypot(v.pos.x-u.pos.x,v.pos.z-u.pos.z)-v.radius<=6).length};});

 const pilots=pages.map((page,i)=>({page,name:i?'friend':'host',lang:i?'en':'ko',mechId:null,goal:null,kiting:false,lastLog:-Infinity,lastAbility:-Infinity,won:false}));
 async function tick(pilot){page=pilot.page;let {mechId,goal,kiting,lastLog,lastAbility}=pilot;
  const s=await read();assert.equal(s.connected,true);assert.equal(s.god,false);assert.equal(s.alive,true,'pilot died; inspect tactics before changing game balance');
  if(s.ending.started){assert.equal(s.ending.mode,'final');assert.equal(s.ending.dancers,16);assert.equal(s.cleared,true);pilot.won=true;await keys([]);return;}
  if(s.time-lastLog>=15){console.log('COMBAT',JSON.stringify({name:pilot.name,...s,abilityPresses:inputs.length,goal}));lastLog=s.time;}
  const distance=Math.hypot(s.p[0]-s.b[0],s.p[1]-s.b[1]);
  if(s.mech){
   kiting=false;
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
   // Complete a safe cast. Start kiting below 10m, then create breathing room
   // to 14m before another cast, rather than interrupting at every tiny approach.
   if(!s.cast&&(distance<10||(kiting&&distance<14))){
    kiting=true;
    const a=Math.atan2(s.p[1]-s.arena[1],s.p[0]-s.arena[0]);
    const options=[-.65,.65].map(v=>[s.arena[0]+14*Math.cos(a+v),s.arena[1]+14*Math.sin(a+v)]);
    goal=options.sort((a,b)=>Math.hypot(b[0]-s.b[0],b[1]-s.b[1])-Math.hypot(a[0]-s.b[0],a[1]-s.b[1]))[0];
   }else {goal=null;kiting=false;}
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
  Object.assign(pilot,{mechId,goal,kiting,lastLog,lastAbility});
 }
 const deadline=Date.now()+600000;console.log('FULL_HEALTH',JSON.stringify(fullHealth));
 while(Date.now()<deadline&&!pilots.every(p=>p.won)){for(const p of pilots)if(!p.won)await tick(p);await new Promise(r=>setTimeout(r,60));}
 assert.equal(pilots.every(p=>p.won),true,'native coop pilot did not finish');
 for(const p of pilots){page=p.page;await keys([]);await page.waitForFunction(()=>window.app.current.game.ending.t>5);await page.screenshot({path:`tmp/qa/real-coop-${p.name}-dance.png`});await page.waitForFunction(()=>window.app.current.game.ending.t>4);await page.keyboard.press('Space');}
 for(const p of pilots){page=p.page;await page.locator('.credits').waitFor({state:'visible',timeout:45000});await page.keyboard.press('Space');await page.getByRole('button',{name:p.lang==='ko'?'계속 모험하기':'Continue Adventure',exact:true}).click();await page.waitForFunction(()=>window.app.currentId==='game'&&window.app.current.game.loaded,null,{timeout:90000});const resumed=await read();assert.equal(resumed.cleared,true);assert.equal(resumed.state,'dead');assert.equal(resumed.god,false);assert.equal(resumed.ending.active,false);console.log('RESUMED',p.name,JSON.stringify(resumed));}
 assert.deepEqual(errors,[]);console.log('PASS: two actual native-input KO/EN level-20 priests defeat full-health shared boss without god/HP/damage/position injection after Challenge; both 16-dancer true endings and saved return; local relay and creator level/world setup');
}catch(e){console.log('COOP_PILOT_FAILURE',e.message);for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`tmp/qa/real-coop-failure-${i}.png`}).catch(()=>{});throw e;}
finally{for(const p of pages){page=p;await keys([]).catch(()=>{});}await browser.close();}
