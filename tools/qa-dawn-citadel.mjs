// Solarkan's desert sun temple (src/game/dawnCitadel.ts): built, batched, no primitives left in its footprint, its gate,
// court and arena open, its walls solid, quest points clear, zero browser and shader errors at high and low quality.
// Usage: CC_QA_BASE=http://127.0.0.1:5612 node tools/qa-dawn-citadel.mjs
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5612';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
async function visit(quality){
 const p=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_|THREE/i.test(m.text()))errors.push(m.text().slice(0,300));});
 await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Citadel QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',q);},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.evaluate(()=>{const g=window.app.current.game;g.creatorTravel=true;g.god=true;g.ending.cancel();g.world2.go(3);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===3&&!document.querySelector('.loading'),null,{timeout:180000});
 // The kit banners arrive with the settlement.
 await p.waitForFunction(()=>window.app.current.game.world2.third.root.getObjectByName('dawn-twilight-citadel')?.userData.citadel?.banners>0,null,{timeout:120000});
 return {p,errors};
}
try{
 const {p,errors}=await visit('high');
 const facts=await p.evaluate(()=>{
  const g=window.app.current.game,t=g.world2.third,root=t.root,c=root.getObjectByName('dawn-twilight-citadel'),s=c.userData.citadel;
  const platform=root.getObjectByName('dawn-boss-platform');
  // Primitive meshes or instances left inside the citadel's footprint (the platform is the arena's own floor).
  const inside=(x,z)=>Math.abs(x)<41&&z<-44&&z>-122,prims=[];
  const kinds=/^(Box|Cylinder|Cone|Torus|Dodecahedron|Octahedron|Sphere|Icosahedron)Geometry$/;
  root.traverse(o=>{
   if(!o.isMesh||c.getObjectById(o.id)||o===platform)return;
   if(!kinds.test(o.geometry?.type??''))return;
   const m=o.matrixWorld.elements;
   if(o.isInstancedMesh){const mi=new o.matrixWorld.constructor();for(let i=0;i<o.count;i++){o.getMatrixAt(i,mi);const x=mi.elements[12],z=mi.elements[14];if(inside(x,z))prims.push(`${o.geometry.type}#${i}@${x.toFixed(1)},${z.toFixed(1)}`);}}
   else if(inside(m[12],m[14]))prims.push(`${o.name||o.geometry.type}@${m[12].toFixed(1)},${m[14].toFixed(1)}`);
  });
  const col=t.collision,out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}},h=(x,z)=>t.height(x,z);
  const open=(x,z,r=.6)=>{col.resolve(x,z,r,out);return Math.hypot(out.x-x,out.y-z)<1e-6;};
  const ray=(ax,az,bx,bz,lift=1.2)=>{let hit=null;const n=Math.ceil(Math.hypot(bx-ax,bz-az));for(let i=0;i<n&&hit===null;i++){const x0=ax+(bx-ax)*i/n,z0=az+(bz-az)*i/n,x1=ax+(bx-ax)*(i+1)/n,z1=az+(bz-az)*(i+1)/n;hit=col.raycast({x:x0,y:h(x0,z0)+lift,z:z0},{x:x1,y:h(x1,z1)+lift,z:z1});}return hit;};
  // Every W3 quest, seal and lamp point must stay where it is (dawnRequests resolves them out of solids).
  const points={'dawn-seal-a':[-18,-20],'dawn-seal-b':[18,-35],'dawn-seal-c':[-16,-44],'dawn-lamp-c':[-7,-22],'dawn-ore-c':[22,-25],lighthouse:[0,-40],beacon:[0,-44]};
  const moved=Object.entries(points).filter(([,[x,z]])=>!open(x,z,1)).map(([k])=>k);
  const draws=[];c.traverse(o=>{if(o.isMesh||o.isPoints)draws.push(o.name);});
  // The style sheet forbids cone roofs and spires: no such mesh in the citadel.
  const spires=draws.filter(n=>/spire|roof|cone/i.test(n));
  return {stats:s,draws,spires,platform:{name:platform?.name,top:platform.position.y+platform.geometry.parameters.height/2,radius:platform.geometry.parameters.radiusTop,material:platform.material.name},prims,moved,
   gateOpen:ray(0,-28,0,-52),passage:[open(0,-41),open(0,-43),open(0,-45),open(2.4,-43)],arenaOpen:open(0,-72,3)&&open(0,-52.5)&&open(18,-72)&&open(-18,-72),
   eastWall:ray(10,-75,50,-75)!==null,backWall:ray(0,-90,0,-125)!==null,southWall:ray(20,-40,20,-52)!==null,lod:!!c.getObjectByName('dawn-citadel-lod'),court:!!c.getObjectByName('dawn-temple-court')};
 });
 console.log(JSON.stringify(facts));
 assert.equal(facts.platform.name,'dawn-boss-platform');assert.ok(Math.abs(facts.platform.top-19.05)<1e-8);assert.equal(facts.platform.radius,21);assert.equal(facts.platform.material,'dawn-sundial-floor');
 assert.deepEqual(facts.prims,[],'primitive meshes left in the citadel footprint');
 assert.ok(facts.stats.blocks>3000,`masonry blocks ${facts.stats.blocks}`);assert.ok(facts.stats.nearTriangles>facts.stats.farTriangles,'far LOD is lighter');
 assert.equal(facts.stats.obelisks,8);assert.equal(facts.stats.towers,6);assert.equal(facts.stats.columns,26);assert.ok(facts.stats.flames>=20,`flames ${facts.stats.flames}`);assert.ok(facts.stats.windows>0);assert.ok(facts.stats.banners>=10);
 assert.ok(facts.lod&&facts.court);assert.deepEqual(facts.spires,[]);assert.ok(facts.draws.length<=10,`citadel draws ${facts.draws.length}: ${facts.draws.join(', ')}`);
 assert.deepEqual(facts.moved,[],'quest points inside new solids');
 assert.equal(facts.gateOpen,null,'avenue through the gate is open');assert.deepEqual(facts.passage,[true,true,true,true]);assert.ok(facts.arenaOpen);
 assert.ok(facts.eastWall&&facts.backWall&&facts.southWall,'walls are solid');
 // The standard arena camera sees the floor (nothing of the gatehouse between it and the arena).
 const view=await p.evaluate(()=>{const g=window.app.current.game,t=g.world2.third,cam={x:0,y:19+1.2+34*Math.sin(.5),z:-75+34*Math.cos(.5)};return t.collision.raycast(cam,{x:0,y:20.2,z:-75});});
 assert.equal(view,null,'arena camera line is clear');
 await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,-60,Math.PI);g.follow.yaw=0;g.follow.pitch=.5;g.follow.distance=26;g.follow.cut();});
 await p.waitForTimeout(1500);await p.screenshot({path:'tmp/qa/dawn-citadel-high.png'});
 assert.deepEqual(errors,[]);await p.close();
 const low=await visit('low');
 await low.p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,-36,Math.PI);g.follow.yaw=0;g.follow.pitch=.25;g.follow.distance=20;g.follow.cut();});
 await low.p.waitForTimeout(2000);await low.p.screenshot({path:'tmp/qa/dawn-citadel-low.png'});
 const lowFacts=await low.p.evaluate(()=>({quality:window.app.engine.quality,calls:window.app.engine.renderer.info.render.calls}));
 assert.equal(lowFacts.quality,'low');assert.deepEqual(low.errors,[]);
 console.log('PASS citadel',facts.stats.blocks,'blocks',facts.stats.nearTriangles,'near tris',facts.stats.farTriangles,'far tris',facts.draws.length,'draws; gate, court and arena open, walls solid, quest points clear; zero errors high and low',JSON.stringify(lowFacts));
}finally{await browser.close();}
