import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5218';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});return p;
}
try{
 for(const mode of ['public','room']){
  const p=await load(`Sync ${mode} host`),q=await load(`Sync ${mode} friend`);
  if(mode==='room'){
   await p.locator('.mp-panel > summary').click();await p.getByRole('button',{name:/방 만들기|Create room/}).click();await p.waitForFunction(()=>!!window.app.current.game.multiplayer.room);const room=await p.evaluate(()=>window.app.current.game.multiplayer.room);
   await q.locator('.mp-panel > summary').click();await q.getByRole('textbox',{name:'방 코드',exact:true}).fill(room);await q.getByRole('button',{name:/참가|Join/,exact:true}).click();
  }
  await q.waitForFunction(()=>window.app.current.game.multiplayer.battle.active&&!window.app.current.game.multiplayer.battle.authority);
  assert.equal(await q.evaluate(()=>window.app.current.game.multiplayer.battle.sharedArea),mode==='public');
  const home=await p.evaluate(()=>{const g=window.app.current.game,e=g.enemies[0];e.unit.stunUntil=g.time+50;e.unit.invulnerable=false;g.player.unit.teleport(g.world,e.unit.pos.x+2,e.unit.pos.z);return {x:e.unit.pos.x,z:e.unit.pos.z,hp:e.unit.hp};});
  await q.evaluate(({x,z})=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x-2,z);},home);await p.waitForTimeout(500);
  await q.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,g.enemies[0].unit,7);});
  await p.waitForFunction(hp=>window.app.current.game.enemies[0].unit.hp===hp-7,home.hp);await q.waitForFunction(hp=>window.app.current.game.enemies[0].unit.hp===hp-7,home.hp);
  await p.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,g.enemies[0].unit,5);});await q.waitForFunction(hp=>window.app.current.game.enemies[0].unit.hp===hp-12,home.hp);
  console.log(`PASS ${mode}: guest and host damage share exact monster HP`);
  // Use the real two-second lighthouse interaction from both sides.
  for(const [actor,lit] of [[q,true],[p,false],[q,true]]){
   await actor.evaluate(()=>{const g=window.app.current.game,b=g.world.pois.beacon;g.quests.status.q3='done';g.player.unit.teleport(g.world,b.position.x,b.position.z);g.player.unit.pos.y=Math.max(b.position.y,g.world.heightAt(b.position.x,b.position.z));document.activeElement?.blur();document.querySelector('.mp-panel').open=false;});
   await actor.keyboard.down('KeyF');await actor.waitForTimeout(2300);await actor.keyboard.up('KeyF');
   for(const v of [p,q])await v.waitForFunction(lit=>{const g=window.app.current.game,e=g.world.getEnvironment();return g.beaconLit===lit&&e.beacon===lit&&e.mood===(lit?1:3);},lit);
  }
  console.log(`PASS ${mode}: native hold-F lighthouse on/off/on synchronizes beacon and night/morning`);
  for(const v of [p,q])await v.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,143,23);document.activeElement?.blur();});await p.waitForTimeout(500);
  await p.keyboard.press('KeyF');await p.waitForFunction(()=>window.app.current.game.boats.seated);
  await q.keyboard.press('KeyF');await q.waitForFunction(()=>window.app.current.game.boats.seated);
  const before=await p.evaluate(()=>window.app.current.game.boats.state.x);await p.keyboard.down('KeyW');await p.waitForTimeout(1600);await p.keyboard.up('KeyW');await p.waitForTimeout(700);
  assert.ok(await p.evaluate(x=>window.app.current.game.boats.state.x>x+1,before));
  const boat=await p.evaluate(()=>window.app.current.game.boats.networkState());await q.waitForFunction(s=>{const b=window.app.current.game.boats.state;return Math.hypot(b.x-s.x,b.z-s.z)<1&&JSON.stringify(b.seats)===JSON.stringify(s.seats);},boat);
  await q.screenshot({path:`tmp/qa/shared-${mode}-boat.png`});console.log(`PASS ${mode}: native F two-seat boarding and W movement share boat position and seats`);
  if(mode==='public')await p.evaluate(()=>{const g=window.app.current.game;g.journey.rustCleared=true;g.boss.state='dead';g.boss.unit.alive=false;g.boss.unit.hp=0;g.boss.unit.hidden=true;});
  const c=await load(`Sync ${mode} late`);
  if(mode==='room'){
   const room=await p.evaluate(()=>window.app.current.game.multiplayer.room);await c.locator('.mp-panel > summary').click();await c.getByRole('textbox',{name:'방 코드',exact:true}).fill(room);await c.getByRole('button',{name:/참가|Join/,exact:true}).click();
  }
  await c.waitForFunction(()=>window.app.current.game.multiplayer.battle.active&&!window.app.current.game.multiplayer.battle.authority);
  await c.waitForFunction(()=>{const g=window.app.current.game;return g.beaconLit&&g.boats.state.seats.filter(Boolean).length===2;});
  if(mode==='public'){await c.waitForFunction(()=>window.app.current.game.journey.rustCleared);assert.notEqual(await c.evaluate(()=>window.app.current.game.quests.status.q1),'done');console.log('PASS public late arrival inherits defeated shared crown without completing personal quests');}
  await p.close();await q.waitForFunction(()=>window.app.current.game.multiplayer.battle.authority);
  await q.waitForFunction(()=>window.app.current.game.boats.state.seats[0]===window.app.current.game.multiplayer.battle.ownId);
  const x=await q.evaluate(()=>window.app.current.game.boats.state.x);await q.keyboard.down('KeyW');await q.waitForTimeout(1100);await q.keyboard.up('KeyW');assert.ok(await q.evaluate(x=>window.app.current.game.boats.state.x>x+.3,x));
  console.log(`PASS ${mode}: late join restores beacon/boat and passenger keeps driving after host leaves`);
  if(mode==='public'){
   await c.evaluate(()=>{const g=window.app.current.game;g.journey.abyssCleared=true;g.world2.go(2);});await c.waitForFunction(()=>window.app.current.game.multiplayer.area===2&&window.app.current.game.multiplayer.battle.active);assert.equal(await q.evaluate(()=>window.app.current.game.world2.chapter),1);
   console.log('PASS public portal travel changes only the traveler’s shard');
  }
  await q.close();await c.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS zero browser errors');
}finally{await browser.close();}
