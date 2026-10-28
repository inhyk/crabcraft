// World VI air (skybloomAir.ts): sky, cloud sea, cliff skirt, floating isles, falls, mist, petals, gulls; none of the
// old primitives (inverted cones, sin-stripe cloud plane, gradient sphere, spark points); the terrain ends on the lip
// with play heights untouched; the environment map is bound only in World VI; high and low quality render cleanly.
// CC_QA_BASE=http://127.0.0.1:5641 node tools/qa-sky-air.mjs
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5641';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){
 const p=await browser.newPage({viewport:{width:1280,height:720}});p.setDefaultTimeout(60000);
 p.on('pageerror',e=>errors.push(`${quality}: ${e.message}`));
 p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(`${quality}: ${m.text().slice(0,300)}`);});
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Sky air'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(6);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===6&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.waitForTimeout(2500);
 return p;
}
const report={};
try{
 for(const quality of ['high','low']){
  const p=await load(quality);
  const r=await p.evaluate(()=>{
   const g=window.app.current.game,w=g.world2,root=w.sixth.root,scene=g.scene,air=w.sixth.air;
   const names=['skybloom-sky','skybloom-cloud-sea','skybloom-cliffs-and-isles','skybloom-waterfalls','skybloom-mist','skybloom-petals','skybloom-gulls'];
   const present=Object.fromEntries(names.map(n=>[n,!!root.getObjectByName(n)]));
   let cones=0,points=0,dirs=0,hemis=0,oldSea=0,gradientSky=0;
   root.traverse(o=>{
    if(o.isMesh&&o.geometry?.type==='ConeGeometry'&&Math.abs(Math.abs(o.rotation.z)-Math.PI)<.01)cones++;
    if(o.isPoints&&o.material?.uniforms?.tint)points++;if(o.isDirectionalLight)dirs++;if(o.isHemisphereLight)hemis++;
    if(o.name==='sea-of-clouds')oldSea++;
    if(o.isMesh&&o.material?.uniforms?.top&&o.material?.uniforms?.bottom)gradientSky++;
   });
   // Terrain: nothing past the lip, and every vertex inside it on the simulation's own height.
   const t=root.getObjectByName('frontier-terrain'),pos=t.geometry.getAttribute('position');let maxEdge=0,maxDiff=0,inside=0;
   for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),e=Math.hypot(x/128,(z-2)/155);maxEdge=Math.max(maxEdge,e);if(e<.829){inside++;maxDiff=Math.max(maxDiff,Math.abs(pos.getY(i)-g.world.heightAt(x,z)));}}
   const env=scene.environment,envI=scene.environmentIntensity,fog=scene.fog;
   return {present,cones,points,dirs,hemis,oldSea,gradientSky,maxEdge,maxDiff,inside,stats:root.userData.skybloomAir,envBound:!!env&&env===air.sky.environment(g.engine.renderer),envI,fogDensity:fog?.density,fogColor:fog?.color.getHexString(),
    skyLow:'SKY_LOW' in air.sky.material.defines,petals:root.getObjectByName('skybloom-petals').geometry.drawRange.count,calls:window.app.engine.renderer.info.render.calls};
  });
  await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,-30);g.follow.yaw=0;g.follow.pitch=.3;g.follow.distance=26;g.follow.cut();});
  await p.waitForTimeout(1500);await p.screenshot({path:`tmp/qa/sky-air-${quality}.png`});
  // Leaving World VI gives the previous environment map back.
  const after=await p.evaluate(async()=>{const g=window.app.current.game,w=g.world2;w.go(5);await new Promise(r=>setTimeout(r,2500));return {chapter:w.chapter,envStill:g.scene.environment===w.sixth.air.sky.environment(g.engine.renderer)};});
  report[quality]={...r,after};
  assert.ok(Object.values(r.present).every(Boolean),`${quality}: missing ${JSON.stringify(r.present)}`);
  assert.equal(r.cones,0,'inverted cones left');assert.equal(r.oldSea,0,'old sea-of-clouds plane left');assert.equal(r.gradientSky,0,'old gradient sky sphere left');
  assert.equal(r.points,0,'old spark points removed');assert.equal(r.dirs,1);assert.equal(r.hemis,1);
  assert.ok(r.stats.isles>=6&&r.stats.isles<=10,'6 to 10 isles');assert.ok(r.stats.falls>=4,'falls off the island and isles');assert.ok(r.stats.terrainClipped>0);
  assert.ok(r.maxEdge<=.8302,`terrain past the lip: ${r.maxEdge}`);assert.ok(r.inside>10000&&r.maxDiff<1e-3,`play heights moved: ${r.maxDiff}`);
  assert.ok(r.envBound,'World VI environment map bound');assert.ok(Math.abs(r.envI-.45)<1e-6);assert.ok(r.fogDensity>0&&r.fogDensity<.003);
  assert.equal(r.skyLow,quality==='low');assert.equal(r.petals,quality==='low'?300:900);
  assert.equal(after.chapter,5);assert.equal(after.envStill,false,'environment map restored after leaving');
  await p.close();
 }
 console.log(JSON.stringify(report,null,1));
 assert.deepEqual(errors,[]);
 console.log('qa-sky-air PASS');
}finally{await browser.close();}
