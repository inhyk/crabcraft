import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
  const errors=[],base=process.env.CC_QA_BASE??'http://127.0.0.1:5225';
  async function enter(name){
    const p=await browser.newPage({viewport:{width:1440,height:1000}});
    p.on('pageerror',e=>errors.push(e.message));
    await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');},name);
    await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
    await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
    await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;g.ending.cancel();});
    return p;
  }
  const host=await enter('Guard Test');await host.evaluate(()=>window.app.current.game.multiplayer.connect('create'));
  await host.waitForFunction(()=>!!window.app.current.game.multiplayer.room);
  const room=await host.evaluate(()=>window.app.current.game.multiplayer.room);
  const guest=await enter('Guard Test');await guest.evaluate(room=>window.app.current.game.multiplayer.connect('join',room),room);
  await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.active);
  const shore=await host.evaluate(()=>window.app.current.game.enemies.filter(e=>e.kind==='scavenger'&&!e.isEcho&&!e.isAdd&&!e.isIslandOnly).length);
  const names={2:'별빛 유적 수호자',3:'황혼 성채 파수병',4:'빙하 성채 파수병'};
  for(const chapter of [2,3,4]){
    await host.evaluate(chapter=>window.app.current.game.world2.go(chapter),chapter);
    try{await guest.waitForFunction(chapter=>{const g=window.app.current.game;return g.world2.chapter===chapter&&g.enemies.filter(e=>e.isIslandOnly&&e.unit.alive&&!e.unit.hidden).length===6;},chapter,{timeout:30000});}
    catch(error){for(const [label,p] of [['host',host],['guest',guest]]){console.log(label,await p.evaluate(()=>{const g=window.app.current.game,b=g.multiplayer.battle;return{chapter:g.world2.chapter,active:b.active,authority:b.authority,room:g.multiplayer.room,enemies:g.enemies.length,extra:g.enemies.filter(e=>e.isIslandOnly).map(e=>({alive:e.unit.alive,hidden:e.unit.hidden,state:e.state})),messages:g.multiplayer.root.textContent};}));await p.screenshot({path:`tmp/qa/guardian-${label}-failure.png`});}throw error;}
    for(const p of [host,guest]){
      const data=await p.evaluate(()=>window.app.current.game.enemies.filter(e=>e.kind==='scavenger'&&!e.isEcho&&!e.isAdd).map(e=>({name:e.unit.name,alive:e.unit.alive,hidden:e.unit.hidden,level:e.unit.level})));
      assert.equal(data.length,shore+6);assert.ok(data.every(e=>e.alive&&!e.hidden&&e.name===names[chapter]));
      assert.ok(data.every(e=>e.level===({2:12,3:22,4:102})[chapter]));
    }
    await host.evaluate(()=>{const g=window.app.current.game,e=g.enemies.find(e=>e.islandSlot===0);e.unit.hp=Math.floor(e.unit.maxHp*.6);});
    const hp=await host.evaluate(()=>window.app.current.game.enemies.find(e=>e.islandSlot===0).unit.hp);
    await guest.waitForFunction(hp=>window.app.current.game.enemies.find(e=>e.islandSlot===0).unit.hp===hp,hp);
    await host.evaluate(()=>{const g=window.app.current.game,e=g.enemies.find(e=>e.islandSlot===0);g.player.unit.teleport(g.world,e.home.x,e.home.z+8,Math.PI);g.follow.yaw=0;g.follow.cut();});
    await host.screenshot({path:`tmp/qa/guardians-world-${chapter}.png`});
    console.log(`PASS World ${chapter}: ${shore} → ${shore+6} guardians, six extra alive on both clients, fixed levels and HP synchronized`);
  }
  await host.evaluate(()=>window.app.current.game.world2.go(1));
  await guest.waitForFunction(()=>window.app.current.game.world2.chapter===1);
  await host.evaluate(()=>window.app.current.game.multiplayer.battle.setMode('pvp'));
  await guest.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='pvp');
  for(const p of [host,guest])assert.ok(await p.evaluate(()=>window.app.current.game.enemies.filter(e=>e.isIslandOnly).every(e=>e.unit.hidden&&e.state==='gone')));
  assert.equal(await guest.evaluate(()=>window.app.current.game.player.unit.name),'Guard Test #2');
  assert.deepEqual(errors,[]);
  console.log('PASS shore population unchanged in co-op and PvP; duplicate names distinct; zero browser errors');
}finally{await browser.close();}
