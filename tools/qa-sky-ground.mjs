// World VI ground lane: the meadow ground shader (skyGround.ts), the camera-following grass and wildflowers
// (skyMeadow.ts), the limestone paving (skyPaving.ts) and the recoloured kit forest with its boulders and logs
// (skyForest.ts) replace the vertex-colour terrain with its speck canvas, the checker islandPaths tiles, the
// cylinder-and-icosahedron trees, the triangle grass and the icosahedron gardens. Checks, in Node: the W6-only
// colliders stay clear of every quest, NPC and enemy point and of the ways, and World V's layout has none of them.
// In the browser at high and low quality: the new parts are there with sane counts, none of the old primitives is
// left, the terrain sits on the gameplay heights, every W6 collider is in the client's collision, zero errors.
// Writes tmp/qa/sky-ground-*.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
import {bundle} from './collision-bake-lib.mjs';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5642';

// --- Node: layout and colliders.
const layout=await import((await bundle('src/game/skyGroundLayout.ts','qa-sky-layout')).url);
const realm=await import((await bundle('src/game/realmLayout.ts','qa-sky-realm')).url);
const quests=await import((await bundle('src/game/frontierQuests.ts','qa-sky-quests')).url);
const solids=layout.skySolids(),points=Object.entries(quests.FRONTIER_POINTS[6]);
for(const s of solids){
 for(const [id,[x,z]] of points)assert.ok(Math.hypot(s.x-x,s.z-z)>s.r+1.5,`solid at ${s.x.toFixed(1)},${s.z.toFixed(1)} too close to ${id}`);
 assert.ok(layout.skyPathDistance(s.x,s.z)>s.r+1,`solid at ${s.x.toFixed(1)},${s.z.toFixed(1)} on a way`);
 assert.ok(layout.skyEdge(s.x,s.z)<.78,'solid off the playable island');
 assert.ok(Math.hypot(s.x,s.z+72)>26,'solid in the sanctuary');
}
for(const [id,x,z] of [['spawn',0,82],['forge',16,68],['chapel',16,56],['tavern',-16,74],['grove',-50,26],['shore',61,22],['wreck',44,-6],['lighthouse',0,-44]])for(const s of solids)assert.ok(Math.hypot(s.x-x,s.z-z)>s.r+1.5,`solid inside POI ${id}`);
const w5=realm.layoutFrontier(5),w6=realm.layoutFrontier(6),trees=layout.skyTrees();
const grove=trees.filter(t=>t.i>=100).length,kinds=c=>c.shapes.length;
assert.equal(kinds(w6)-kinds(w5),realm.frontierTrees(6).length-realm.frontierTrees(5).length+solids.length,'W6 adds exactly its own solids; W5 keeps its layout');
assert.ok(grove>=4&&grove<=6,`grove trees ${grove}`);
const species=new Set(trees.map(t=>t.species));assert.deepEqual([...species].sort(),['blossom','jade','silver','white']);
console.log('PASS layout',{trees:trees.length,grove,solids:solids.length,w5:kinds(w5),w6:kinds(w6),points:points.length});

// --- Browser.
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){
 const p=await browser.newPage({viewport:{width:1280,height:800}});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(m.text().slice(0,300));});
 p.setDefaultTimeout(120000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Sky QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(6);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===6&&!document.querySelector('.loading')&&window.app.current.game.world2.sixth.root.userData.skyForest,null,{timeout:180000});
 await p.evaluate(()=>{const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}canvas{visibility:visible!important}';document.head.appendChild(s);});
 return p;
}
try{
 for(const quality of ['high','low']){
  const p=await load(quality);
  // Into the east field, the camera behind the crab looking at the blossom grove.
  await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,60,-5,-Math.PI/2);g.follow.yaw=-Math.PI/2;g.follow.pitch=.28;g.follow.distance=14;g.follow.cut();});
  await p.waitForTimeout(3000);
  const s=await p.evaluate(solids=>{
   const r=window.app.current.game.world2.sixth.root,find=n=>r.getObjectByName(n);
   const ground=find('skybloom-ground'),paving=find('world6-skybloom-paving'),meadow=find('skybloom-meadow'),forest=find('skybloom-forest');
   // Old primitives in this lane's scope, by their geometry.
   const old=[];r.traverse(o=>{const g=o.geometry,t=g?.type,q=g?.parameters??{};
    if(o.name==='frontier-terrain'||o.name==='world6-flagstone-paths'||o.name==='weathered-bevelled-paving')old.push(o.name);
    if(o.isInstancedMesh&&t==='CylinderGeometry'&&q.height===12)old.push('cylinder trunks');
    if(o.isInstancedMesh&&t==='IcosahedronGeometry'&&(q.radius===3.8||q.radius===.65||q.radius===.25))old.push(`icosahedron ${q.radius}`);
    if(o.isInstancedMesh&&o.count===2200)old.push('triangle grass');
    if(o.isMesh&&t==='CylinderGeometry'&&q.radiusTop===4&&q.radiusBottom===4.3)old.push('planter');
    if(o.material?.map?.isCanvasTexture&&o.name.includes('terrain'))old.push('speck canvas');});
   // The terrain sits on the gameplay heights.
   const pos=ground.geometry.getAttribute('position');let maxErr=0;for(let i=0;i<pos.count;i+=97){const d=Math.abs(pos.getY(i)-window.app.current.game.world2.sixth.height(pos.getX(i),pos.getZ(i)));if(d>maxErr)maxErr=d;}
   // Every W6 solid is in the client's collision (a circle at its spot).
   const col=window.app.current.game.world2.sixth.collision,missing=solids.filter(q=>!col.shapes.some(c=>c.kind===0&&Math.hypot(c.c.x-q.x,c.c.z-q.z)<1e-3&&Math.abs(c.c.r-q.r)<1e-3)).length;
   const grass=meadow.children.find(m=>m.name==='skybloom-meadow-grass'),flowers=meadow.children.find(m=>m.name==='skybloom-meadow-flowers');
   const i=window.app.engine.renderer.info;
   return {old,maxErr,missing,shapes:col.shapes.length,forest:r.userData.skyForest,batches:forest.children.map(b=>b.name.split(':')[1]),paving:r.userData.skyPaving,grass:grass.geometry.instanceCount,flowers:flowers.geometry.instanceCount,groundProgram:ground.material.name,calls:i.render.calls,tris:i.render.triangles};
  },solids);
  console.log(quality,JSON.stringify(s));
  assert.deepEqual(s.old,[],`old primitives left: ${s.old}`);
  assert.ok(s.maxErr<1e-4,`terrain off the gameplay heights by ${s.maxErr}`);
  assert.equal(s.missing,0,'W6 solids missing from the client collision');
  assert.ok(s.forest.trees>=54&&s.forest.boulders>=8&&s.forest.logs>=4&&s.forest.shrubs>=60&&s.forest.ferns>=50&&s.forest.flowers>=15,'forest counts');
  assert.deepEqual(Object.keys(s.forest.species).sort(),['blossom','jade','silver','white']);
  assert.ok(s.batches.length<=9,`forest draws ${s.batches.length}`);
  assert.ok(s.paving.segments===6&&s.paving.cells>3000,'paving');
  if(quality==='high')assert.ok(s.grass===150*150&&s.flowers===96*96,'high meadow');
  else assert.ok(s.grass===90*90&&s.flowers===56*56,'low meadow is cheaper');
  await p.screenshot({path:`tmp/qa/sky-ground-${quality}-east.png`});
  // The avenue, close: flags, grassy joints, the meadow up to the stones.
  await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,45,Math.PI);g.follow.yaw=.3;g.follow.pitch=.2;g.follow.distance=8;g.follow.cut();});
  await p.waitForTimeout(1500);await p.screenshot({path:`tmp/qa/sky-ground-${quality}-avenue.png`});
  await p.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS sky ground: meadow, paving, forest and colliders at high and low, zero errors');
}finally{await browser.close();}
