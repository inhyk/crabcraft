// Focused real-browser regression: quest completion uses the actual event/reward pipeline.
// Quest objectives are injected to isolate the 2.6-second reveal race, rather than replay the whole shore.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 for(const scenario of ['off','travel','lit']){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('cc.hintsSeen','1'));
  await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
  const immediate=await page.evaluate(scenario=>{const g=window.app.current.game;g.god=true;g.player.restoreXp(1400);g.quests.accept('q3');g.quests.bump('kill-scavenger',3);g.setLighthouse(true);g.quests.complete('q3');const reward={q4:g.quests.status.q4,blessed:g.player.unit.blessingUntil===Infinity};if(scenario==='off')g.setLighthouse(false);if(scenario==='travel')g.world2.enter();return {...reward,environment:g.world.getEnvironment()};},scenario);
  assert.equal(immediate.q4,'active');assert.equal(immediate.blessed,true);await page.waitForTimeout(3100);
  const result=await page.evaluate(()=>{const g=window.app.current.game;return {chapter:g.world2.chapter,environment:g.world.getEnvironment(),boss:g.boss.state,q4:g.quests.status.q4,warning:document.querySelector('.msg-warn').textContent};});
  assert.deepEqual(result.environment,immediate.environment);assert.equal(result.q4,'active');
  if(scenario==='off'){assert.equal(result.boss,'dormant');assert.equal(result.warning,'');assert.deepEqual(result.environment,{mood:3,beacon:false});}
  if(scenario==='travel'){assert.equal(result.chapter,2);assert.equal(result.warning,'');await page.evaluate(()=>window.app.current.game.world2.returnToShore());assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.q4),'active');}
  if(scenario==='lit')assert.match(result.warning,/코로디우스/);
  await page.evaluate(()=>window.app.current.game.journey.save());await page.reload();await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});assert.equal(await page.evaluate(()=>window.app.current.game.quests.status.q4),'active');assert.deepEqual(errors,[]);
  console.log('PASS beacon reveal:',scenario,result);await context.close();
 }
}finally{await browser.close();}
