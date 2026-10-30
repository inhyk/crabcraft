// World VI world tree and sanctuary (skyWorldTree.ts, skySanctuary.ts): the meshes are there, one per material,
// the old primitives are gone from the sanctuary, the court floor sits flat at the arena height, quest points and
// POIs stay outside every solid, and both graphics tiers render without page or GL errors.
//   CC_QA_BASE=http://127.0.0.1:5644 node tools/qa-sky-tree.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5644';
await mkdir('tmp/qa',{recursive:true});
const quests=readFileSync('src/game/frontierQuests.ts','utf8'),start=quests.indexOf('export const FRONTIER_POINTS=')+29,points=JSON.parse(quests.slice(start,quests.indexOf(' as const',start)))['6'];
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 for(const quality of ['high','low']){
  const p=await browser.newPage({viewport:{width:1280,height:800}});
  p.on('pageerror',e=>errors.push(`${quality}: ${e.message}`));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(`${quality}: ${m.text().slice(0,300)}`);});
  p.setDefaultTimeout(90000);await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
  await p.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Sky tree'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',q);},quality);
  await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
  await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
  await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(6);});
  await p.waitForFunction(()=>window.app.current.game.world2.chapter===6&&!document.querySelector('.loading'));
  const r=await p.evaluate(points=>{
   const g=window.app.current.game,island=g.world2.sixth,THREE_TYPES=['CylinderGeometry','TorusGeometry','OctahedronGeometry','IcosahedronGeometry','ConeGeometry'];
   const sanctuary=island.root.getObjectByName('skybloom-sanctuary');
   const names=sanctuary?sanctuary.children.map(c=>c.name):[];
   const v=new (island.root.position.constructor)(),court={x:0,z:-72},y=island.height(0,-72);
   // Primitives left in the sanctuary and the tree's ground (the old octahedron road lamps are gone too).
   const left=[];
   island.root.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||o.parent===sanctuary)return;const t=o.geometry.type;if(!THREE_TYPES.includes(t)&&!(t==='BoxGeometry'))return;
    o.getWorldPosition(v);if(Object.values(points).some(([x,z])=>Math.hypot(v.x-x,v.z-z)<3))return;// quest props are not the sanctuary's
    const nearCourt=Math.hypot(v.x-court.x,v.z-court.z)<26,nearTree=Math.hypot(v.x,v.z+112)<32;
    if(nearCourt||nearTree)left.push(`${t}@${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`);
   });
   // Instanced scenery (paving, garden, grass) with an instance on the court.
   const onCourt=[],m=new (island.root.matrix.constructor)();
   island.root.traverse(o=>{if(!o.isInstancedMesh)return;for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);const sx=Math.hypot(m.elements[0],m.elements[1],m.elements[2]);if(sx<1e-6)continue;if(Math.hypot(m.elements[12]-court.x,m.elements[14]-court.z)<20){onCourt.push(o.geometry.type);break;}}});
   // The court disc's top is flat at the arena height plus the lift.
   const courtMesh=sanctuary?.getObjectByName('sky-sanctuary-court'),pos=courtMesh?.geometry.getAttribute('position');
   let discMin=Infinity,discMax=-Infinity;if(pos)for(let i=0;i<pos.count;i++){const d=Math.hypot(pos.getX(i)-court.x,pos.getZ(i)-court.z);if(d<19.9){discMin=Math.min(discMin,pos.getY(i));discMax=Math.max(discMax,pos.getY(i));}}
   let flat=0;for(let i=0;i<400;i++){const a=i*2.4,d=Math.sqrt(i/400)*19.9;flat=Math.max(flat,Math.abs(island.height(court.x+Math.cos(a)*d,court.z+Math.sin(a)*d)-y));}
   // Quest points, POIs and the road's centre line stay walkable.
   const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}},blocked=[];
   const check=(id,x,z,r=.6)=>{g.world.resolveCollision(x,z,r,out);if(Math.hypot(out.x-x,out.y-z)>1e-3)blocked.push(id);};
   for(const [id,[x,z]] of Object.entries(points))if(z<-15)check(id,x,z);// the north: the tree, the gate and the sanctuary
   for(const id of ['lighthouse','beacon','bossArena'])check(id,g.world.pois[id].position.x,g.world.pois[id].position.z);
   for(let z=-20;z>=-52;z-=1)check(`road${z}`,0,z,1.2);
   const stats=sanctuary?.userData.skySanctuary??{};
   return {names,left,onCourt,discMin:discMin-y,discMax:discMax-y,flat,blocked,stats,shapes:island.collision.shapes.length,
    lanternMat:sanctuary?.getObjectByName('sky-seed-lanterns')?.material.name,crownDepth:!!sanctuary?.getObjectByName('sky-world-tree-crown')?.customDepthMaterial};
  },points);
  console.log(quality,JSON.stringify(r));
  assert.deepEqual(r.names,['sky-world-tree-wood','sky-sanctuary-stone','sky-world-tree-crown','sky-world-tree-crown-core','sky-seed-lanterns','sky-sanctuary-court','sky-root-fall'],'one mesh per material');
  assert.deepEqual(r.left,[],'old sanctuary primitives remain');
  assert.deepEqual(r.onCourt,[],'instanced scenery on the court');
  assert.ok(Math.abs(r.discMin-.012)<1e-4&&Math.abs(r.discMax-.012)<1e-4,`court floor lift ${r.discMin}..${r.discMax}`);
  assert.ok(r.flat<1e-6,`arena ground not flat: ${r.flat}`);
  assert.deepEqual(r.blocked,[],'points inside solids');
  assert.equal(r.shapes,172,'W6 solids after r4 (57 sky-town with the loading stage and its cargo + 82 sky-ground without the west field stones + 1 trunk + 14 buttress flanks + 2 arch feet + 2 gate posts + 9 landmark columns + 5 overlook stones)');
  // The landmark: crown top 55-70 m over the trunk's foot in five masses, roots over the north lip.
  assert.ok(r.stats.crownTop>=55&&r.stats.crownTop<=70,`crown top ${r.stats.crownTop} m`);assert.equal(r.stats.limbs,5);assert.ok(r.stats.spills>=8,`roots over the lip ${r.stats.spills}`);
  assert.equal(r.stats.columns,8);assert.ok(r.stats.lanterns>=15,`lanterns ${r.stats.lanterns}`);assert.ok(r.stats.roots>=20,`roots ${r.stats.roots}`);
  assert.ok(r.stats.cards>(quality==='high'?900:450),`cards ${r.stats.cards}`);assert.ok(r.crownDepth,'crown casts leafy shadows');
  for(const [name,x,z,yaw,pitch,dist] of [['tree',0,-40,0,.12,30],['approach',0,-30,0,.22,26],['arena',0,-75,0,.5,34]]){
   await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);g.follow.yaw=yaw;g.follow.pitch=pitch;g.follow.distance=dist;g.follow.cut();},[x,z,yaw,pitch,dist]);
   await p.waitForTimeout(1500);await p.screenshot({path:`tmp/qa/sky-tree-${quality}-${name}.png`});
  }
  await p.close();
 }
 assert.deepEqual(errors,[]);
 console.log('qa-sky-tree: PASS');
}finally{await browser.close();}
