// GPU browser regression: run Vite preview on port 5192.
import {launchBrowser} from './lib/browser.mjs';import assert from 'node:assert/strict';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5192/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.setLighthouse(false);g.quests.accept('q1');g.quests.bump('kill-scrapling',2);});
 const samples=[];
 for(let i=0;i<24;i++){
  await page.evaluate(()=>window.app.current.game.world2.enter());await page.waitForTimeout(200);
  await page.evaluate(()=>window.app.current.game.world2.returnToShore());await page.waitForTimeout(350);
  const sample=await page.evaluate(()=>{const g=window.app.current.game;return {memory:{...g.engine.renderer.info.memory},chapter:g.world2.chapter,environment:g.world.getEnvironment(),q1:g.quests.progress.get('q1-kill'),npcs:g.npcs.map(n=>[n.unit.pos.x,n.unit.pos.z])};});
  assert.equal(sample.chapter,1);assert.equal(sample.q1,2);assert.deepEqual(sample.environment,{mood:3,beacon:false});samples.push(sample);
  if(i%6===5)console.log('travel cycles',i+1,sample.memory);
 }
 const baseline=samples[3].memory,last=samples.at(-1).memory;assert.ok(last.geometries<=baseline.geometries+2);assert.ok(last.textures<=baseline.textures+2);assert.deepEqual(errors,[]);
 console.log('PASS: 24 return journeys; stable GPU geometry/texture counts; morning and quest progress retained', {baseline,last,errors});
}finally{await browser.close();}
