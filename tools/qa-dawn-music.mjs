import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5205',errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(25000);
async function song(id){await p.waitForFunction(id=>window.app.audio.music?.id===id,id);return p.evaluate(()=>{const a=window.app.audio,b=a.music.src.buffer;let rms=0;const d=b.getChannelData(0);for(let i=0;i<d.length;i+=100)rms+=d[i]*d[i];return {id:a.music.id,state:a.ctx.state,duration:b.duration,rms:Math.sqrt(rms/(d.length/100)),loop:a.music.src.loop};});}
try{
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Dawn Music Explorer'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','high');});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;});
 const decoded=[];
 for(const chapter of [1,2,3]){
  await p.evaluate(ch=>{const g=window.app.current.game;g.player.unit.lastCombat=-999;g.world2.go(ch);if(ch===1){g.player.unit.teleport(g.world,143,19);g.zone='The Brine Shore';}g.combatMusicUntil=0;g.updateMusic(true);},chapter);
  const explore=chapter===1?'music-town':`music-world${chapter}-explore`;decoded.push(await song(explore));
  await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=g.time;});decoded.push(await song(chapter===1?'music-combat':`music-world${chapter}-combat`));
  await p.evaluate(()=>{const g=window.app.current.game;Object.defineProperty(g.encounter,'engaged',{value:true,configurable:true});g.updateMusic(true);});decoded.push(await song(chapter===1?'music-boss':`music-world${chapter}-boss`));
  await p.evaluate(()=>{const g=window.app.current.game;delete g.encounter.engaged;g.player.unit.lastCombat=-999;g.combatMusicUntil=0;g.updateMusic(true);});await song(explore);console.log('PASS decoded exploration/combat/boss and return',chapter);
 }
 assert.equal(new Set(decoded.map(x=>x.id)).size,9);for(const d of decoded){assert.ok(d.duration>20&&d.rms>.005&&d.loop);assert.equal(d.state,'running');}console.log('AUDIO',decoded);
 // Native music toggle keeps the current realm, and the volume/mute buses still apply.
 await p.keyboard.press('KeyM');await p.waitForFunction(()=>!window.app.audio.music);await p.keyboard.press('KeyM');await song('music-world3-explore');
 await p.evaluate(()=>{const a=window.app.audio;a.setMusicVolume(.23);if(!a.muted)a.toggleMute();});assert.deepEqual(await p.evaluate(()=>({volume:window.app.audio.musicBus.gain.value,muted:window.app.audio.master.gain.value})),{volume:Math.fround(.23),muted:0});await p.evaluate(()=>window.app.audio.toggleMute());
 const view=async(x,z,yaw,name)=>{await p.evaluate(({x,z,yaw})=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw);g.follow.yaw=yaw+Math.PI;g.follow.distance=14;g.follow.cut();},{x,z,yaw});await p.waitForTimeout(1500);await p.screenshot({path:`tmp/qa/dawn-${name}.png`});};
 await view(0,82,Math.PI,'harbor');await view(-58,65,Math.PI,'gardens');await view(43,106,Math.atan2(24,-34),'lighthouse');await view(0,-16,Math.PI,'citadel');
 // Follow the actual avenue with W; added walls/planting must leave the route open.
 await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,28,Math.PI);g.follow.yaw=0;g.follow.cut();});await p.keyboard.down('KeyW');await p.waitForFunction(()=>window.app.current.game.player.unit.pos.z< -46,null,{timeout:25000});await p.keyboard.up('KeyW');assert.ok(await p.evaluate(()=>Math.abs(window.app.current.game.player.unit.pos.x)<3));
 const checks=await p.evaluate(()=>{const g=window.app.current.game,t=g.world2.third,out=g.player.unit.pos.clone();g.world.resolveCollision(67.5,72,g.player.unit.radius,out);return {lighthouseClearance:Math.hypot(out.x-67,out.y-72),region:g.world2.regionAt(-62,48),landmarks:!!t.root.getObjectByName('dawnreach-landmarks'),gulls:t.root.getObjectsByProperty('name','dawn-gull').length,draws:g.engine.renderer.info.render.calls};});assert.ok(checks.lighthouseClearance>3);assert.equal(checks.region,'Seabreeze Gardens');assert.ok(checks.landmarks&&checks.gulls===6);console.log('PASS native ascent and solid landmark',checks);
 // Return travel must choose the realm's score, retain level/coins and keep GPU allocations bounded.
 const progress=await p.evaluate(()=>{const g=window.app.current.game;return [g.player.level,g.player.xp,g.player.coins];});const memories=[];
 for(let i=0;i<4;i++){for(const ch of [2,1,3]){await p.evaluate(ch=>{const g=window.app.current.game;g.player.unit.lastCombat=-999;g.world2.go(ch);},ch);await song(ch===1?'music-town':`music-world${ch}-explore`);}memories.push(await p.evaluate(()=>({...window.app.current.game.engine.renderer.info.memory})));}
 assert.deepEqual(await p.evaluate(()=>{const g=window.app.current.game;return [g.player.level,g.player.xp,g.player.coins];}),progress);assert.ok(memories.at(-1).geometries<=memories[1].geometries+2&&memories.at(-1).textures<=memories[1].textures+2);assert.deepEqual(errors,[]);console.log('PASS distinct 9 decoded scores, cross-world exploration/combat/boss routing, native M toggle, volume/mute, native citadel ascent, scenery/collision and 12 return journeys with stable GPU allocations; page errors0',memories);
}finally{if(errors.length)console.log('PAGE_ERRORS',errors);await browser.close();}
