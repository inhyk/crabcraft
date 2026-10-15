// Real delayed model response plus an overlap at the settlement's async boundary.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 let releaseAsset;const assetGate=new Promise(r=>releaseAsset=r);let held=false;
 await page.route('**/models/crab/jumper.glb',async route=>{held=true;await assetGate;await route.continue();});
 await page.addInitScript(()=>{localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');
 await page.waitForFunction(()=>!!window.app?.current?.game?.vfx,null,{timeout:90000});assert.ok(held,'the actual crab model response is delayed');
 await page.evaluate(()=>{window.canceledModelGame=window.app.current.game;return window.app.go('title');});releaseAsset();
 await page.waitForFunction(()=>window.canceledModelGame.resourcesReleased,null,{timeout:90000});
 const model=await page.evaluate(()=>{const g=window.canceledModelGame;g.dispose();return {units:g.units.length,pending:g.loadingRigs.size,hud:!!g.hud,children:g.scene.children.length,title:window.app.currentId};});
 assert.deepEqual(model,{units:0,pending:0,hud:false,children:0,title:'title'});
 await page.unroute('**/models/crab/jumper.glb');
 await page.evaluate(()=>window.app.go('game'));await page.waitForFunction(()=>window.app.current?.game?.loaded,null,{timeout:90000});
 await page.evaluate(()=>{
  const g=window.app.current.game;g.god=true;g.world2.enter();g.quests.accept('w1');g.player.restoreXp(1000000);g.journey.save();
  const proto=Object.getPrototypeOf(g.world2),original=proto.buildSettlement;let armed=true;
  const gate=new Promise(resolve=>window.releaseSettlement=resolve);
  proto.buildSettlement=async function(){await original.call(this);if(armed){armed=false;window.settlementHeld=true;await gate;}};
 });
 await page.evaluate(()=>window.app.go('title'));await page.evaluate(()=>window.app.go('game'));
 await page.waitForFunction(()=>window.settlementHeld,null,{timeout:90000});
 await page.evaluate(()=>{window.canceledSettlementGame=window.app.current.game;return window.app.go('title');});
 await page.evaluate(()=>window.app.go('game'));await page.waitForFunction(()=>window.app.current?.game?.loaded,null,{timeout:90000});
 await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.evaluate(()=>window.releaseSettlement());await page.waitForFunction(()=>window.canceledSettlementGame.resourcesReleased);
 await page.waitForTimeout(1000);
 const overlap=await page.evaluate(async()=>{
  const app=window.app,g=app.current.game,old=window.canceledSettlementGame;old.dispose();
  app.engine.composer.render(0);const bitmap=await createImageBitmap(app.engine.canvas),c=new OffscreenCanvas(64,40),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0,64,40);bitmap.close();
  const d=ctx.getImageData(0,0,64,40).data;let min=255,max=0;for(let i=0;i<d.length;i+=4){const v=(d[i]+d[i+1]+d[i+2])/3;min=Math.min(min,v);max=Math.max(max,v);}
  return {sameScene:app.engine.scene===g.scene,alive:g.alive,chapter:g.world2.chapter,xp:g.player.xp,quest:g.quests.status.w1,oldUnits:old.units.length,oldPending:old.loadingRigs.size,oldChildren:old.scene.children.length,huds:document.querySelectorAll('.hud').length,visible:max-min};
 });
 assert.deepEqual({...overlap,visible:undefined},{sameScene:true,alive:true,chapter:2,xp:1000000,quest:'active',oldUnits:0,oldPending:0,oldChildren:0,huds:1,visible:undefined});assert.ok(overlap.visible>30,'the surviving game actually renders');assert.deepEqual(errors,[]);
 console.log('PASS: delayed model cancellation, overlapping settlement cancellation, idempotent teardown and saved World II recovery',JSON.stringify({model,overlap,errors}));
}finally{await browser.close();}
