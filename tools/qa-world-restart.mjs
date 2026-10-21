// Keep one renderer alive through real game/title transitions and check owned GPU cleanup.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
const probe=process.env.CC_QA_PROBE==='1';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');
 const rounds=[];
 for(let i=0;i<(probe?2:4);i++){
  if(i)await page.evaluate(()=>window.app.go('game'));
  await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
  if(i)assert.deepEqual(await page.evaluate(()=>{const g=window.app.current.game;return {chapter:g.world2.chapter,quest:g.quests.status.w1,xp:g.player.xp};}),{chapter:2,quest:'active',xp:1000000},'World II and progress restore on the same renderer');
  await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();g.quests.accept('w1');g.player.restoreXp(1000000);g.journey.save();});await page.waitForTimeout(1200);
  if(!probe&&i===3){
   await page.evaluate(()=>{const m=window.app.current.game.hud.menu;m.show();m.settings();});const samples=[];
   for(let q=0;q<3;q++){for(const name of ['높음','낮음']){await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(300);}samples.push(await page.evaluate(async()=>{const e=window.app.engine;e.composer.render(0);const bitmap=await createImageBitmap(e.canvas),c=new OffscreenCanvas(64,40),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0,64,40);bitmap.close();const d=ctx.getImageData(0,0,64,40).data;let min=255,max=0;for(let j=0;j<d.length;j+=4){const v=(d[j]+d[j+1]+d[j+2])/3;min=Math.min(min,v);max=Math.max(max,v);}return {memory:{...e.renderer.info.memory},range:max-min,setting:e.setting};}));}
   for(const sample of samples){assert.equal(sample.setting,'low');assert.ok(sample.range>30,'rebuilt effects render a visible world');assert.ok(sample.memory.textures<=samples[0].memory.textures+1);assert.ok(sample.memory.geometries<=samples[0].memory.geometries+1);}console.log('quality rebuilds',JSON.stringify(samples));await page.evaluate(()=>window.app.current.game.hud.menu.close());
  }
  const before=await page.evaluate(()=>{
   const app=window.app,g=app.current.game,owner={batches:0,instances:0,textures:0,textureEvents:0,instanceEvents:0,batchEvents:0};window.restartOwner=owner;
   g.scene.traverse(o=>{if(o.isBatchedMesh){owner.batches++;o.addEventListener('dispose',()=>owner.batchEvents++);for(const key of ['_matricesTexture','_indirectTexture','_colorsTexture'])if(o[key]){owner.textures++;o[key].addEventListener('dispose',()=>owner.textureEvents++);}}else if(o.isInstancedMesh){owner.instances++;o.addEventListener('dispose',()=>owner.instanceEvents++);}});
   return {memory:{...app.engine.renderer.info.memory},chapter:g.world2.chapter,level:g.player.level};
  });
  await page.evaluate(()=>window.app.go('title'));await page.waitForTimeout(400);
  const after=await page.evaluate(()=>({memory:{...window.app.engine.renderer.info.memory},owner:window.restartOwner,title:window.app.currentId}));
  rounds.push({before,after});console.log('restart',i,JSON.stringify(rounds.at(-1)));
  if(!probe){assert.equal(after.title,'title');assert.equal(after.owner.textureEvents,after.owner.textures,'all owned batch textures released');assert.equal(after.owner.batchEvents,after.owner.batches,'all batch lifecycle resources released');assert.equal(after.owner.instanceEvents,after.owner.instances,'all instance lifecycle resources released');}
 }
 if(!probe){const baseline=rounds[1].after.memory;for(const r of rounds.slice(2)){assert.ok(r.after.memory.textures<=baseline.textures+1,'restarting must not accumulate GPU textures');assert.ok(r.after.memory.geometries<=baseline.geometries+1,'restarting must not accumulate GPU geometry');}assert.deepEqual(errors,[]);}
 console.log(probe?'Restart resource probe finished':'PASS: actual game/title restarts release batch/instance resources and stable GPU memory',JSON.stringify({rounds,errors}));
}finally{await browser.close();}
