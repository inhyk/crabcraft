import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Paving QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');});
 await p.goto((process.env.CC_QA_BASE??'http://127.0.0.1:5226')+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.god=true;g.ending.cancel();g.journey.firstEndingSeen=true;});
 for(const chapter of [2,3,4]){
  const stats=await p.evaluate(chapter=>{const g=window.app.current.game;g.world2.go(chapter);const root=chapter===2?g.world2.root:chapter===3?g.world2.third.root:g.world2.fourth.root,paths=root.getObjectByName(chapter===2?'world2-moonlit-paving':`world${chapter}-flagstone-paths`);let finite=true;paths.traverse(m=>{if(!m.geometry)return;for(const v of m.geometry.attributes.position.array)if(!Number.isFinite(v))finite=false;});g.player.unit.teleport(g.world,0,chapter===2?55:chapter===3?53:56,Math.PI);g.follow.raycast=undefined;g.follow.pitch=1.25;g.follow.distance=24;g.follow.yaw=.25;g.follow.cut();return{...paths.userData,...paths.userData.stats,covers:undefined,trees:g.world2.third.root.userData.leafyTrees,finite};},chapter);
  if(chapter===2)assert.ok(stats.segments>=20&&stats.cells>10000,JSON.stringify(stats));
  else{assert.ok(stats.pavers>500,JSON.stringify(stats));assert.ok(stats.clippedJunctionStones>0);}assert.ok(stats.finite);if(chapter===3)assert.equal(stats.trees,32);
  await p.waitForTimeout(1400);await p.screenshot({path:`tmp/qa/paving-world-${chapter}-junction.png`});
  await p.evaluate(()=>{const f=window.app.current.game.follow;f.pitch=.55;f.distance=9;f.cut();});await p.waitForTimeout(500);await p.screenshot({path:`tmp/qa/paving-world-${chapter}-close.png`});
  console.log(`PASS World ${chapter}: ${chapter===2?`shader paving over ${stats.segments} segments`:`junction clipping active, ${stats.pavers} paving fragments`}, finite geometry; World III canopy ${stats.trees}`);
 }
 assert.deepEqual(errors,[]);console.log('PASS zero browser errors');
}finally{await browser.close();}
