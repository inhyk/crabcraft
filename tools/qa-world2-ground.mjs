// Isolated GPU replay: ensure the painted terrain matches collision and inspect actual boss telegraphs.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cc.hintsSeen','1'));
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');await page.locator('.launch-notice-start').click();await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 const terrain=await page.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.world2.enter();g.god=true;const mesh=g.world2.root.getObjectByName('star-island-ground'),p=mesh.geometry.attributes.position,c=mesh.geometry.attributes.color;let maxError=0,nonFinite=0;for(let i=0;i<p.count;i++){maxError=Math.max(maxError,Math.abs(p.getY(i)-g.world.heightAt(p.getX(i),p.getZ(i))));if(!Number.isFinite(c.getX(i)+c.getY(i)+c.getZ(i)))nonFinite++;}return {vertices:p.count,maxError,nonFinite,anisotropy:mesh.material.map.anisotropy,maxAnisotropy:g.engine.renderer.capabilities.getMaxAnisotropy(),geometryCount:g.engine.renderer.info.memory.geometries};});
 assert.equal(terrain.vertices,141*161);assert.ok(terrain.maxError<.00001);assert.equal(terrain.nonFinite,0);assert.equal(terrain.anisotropy,Math.min(8,terrain.maxAnisotropy));
 await page.evaluate(()=>{const g=window.app.current.game;g.player.restoreXp(22000);g.player.unit.teleport(g.world,0,-62,Math.PI);g.follow.cut();g.follow.yaw=0;g.follow.distance=24;g.follow.pitch=.55;const b=g.worldBoss;b.wake();b.unit.lift=0;b.engage();b.phase=2;b.unit.invulnerable=false;b.unit.targetable=true;b.nextMech=g.time+999;});
 await page.waitForTimeout(2000);
 for(const [index,kind] of [[0,'eclipse'],[1,'nova']]){
  const mechanic=await page.evaluate(index=>{const g=window.app.current.game,b=g.worldBoss;b.clearMech();b.mechIndex=index;b.startMech();return {kind:b.mech.kind,warning:document.querySelector('.msg-warn').textContent,fx:b.mech.fx.length};},index);
  assert.equal(mechanic.kind,kind);assert.ok(mechanic.fx>0);await page.waitForTimeout(200);await page.screenshot({path:`tmp/qa/ground-${kind}.png`});console.log('Actual terrain mechanic',mechanic);
 }
 await page.evaluate(()=>{const g=window.app.current.game;g.worldBoss.sleep();g.world2.returnToShore();});assert.deepEqual(errors,[]);
 console.log('PASS: every painted terrain vertex matches collision, bounded anisotropy, real Eclipse/Starfall effects and clean shore return',terrain);
}finally{await browser.close();}
