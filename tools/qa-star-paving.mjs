// Verify rendered low-plant geometry, including wind clearance, stays off the paved roads.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 const result=await page.evaluate(()=>{
  const g=window.app.current.game;g.god=true;g.world2.enter();const forest=g.world2.root.getObjectByName('star-island-forests'),violations=[];let checked=0,vertices=0;
  const rectDistance=(x,z,ax,bx,az,bz)=>Math.hypot(Math.max(ax-x,0,x-bx),Math.max(az-z,0,z-bz));
  const personClearance=(x,z)=>Math.min(...g.npcs.map(n=>Math.hypot(x-n.unit.pos.x,z-n.unit.pos.z)-1.8));
  const trailDistance=(x,z)=>{let best=Infinity;for(const path of g.world2.trails)for(let i=1;i<path.length;i++){const [ax,az]=path[i-1],[bx,bz]=path[i],dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-ax-t*dx,z-az-t*dz));}return best;};
  for(const mesh of forest.children.filter(m=>/:(Leaves|Flowers|Grass)$/.test(m.name))){const p=mesh.geometry.attributes.position,m=mesh.matrix.clone(),v=g.player.unit.pos.clone();for(let i=0;i<mesh.instanceCount;i++){mesh.getMatrixAt(i,m);const range=mesh.getGeometryRangeAt(mesh.getGeometryIdAt(i)),x=m.elements[12],z=m.elements[14];let radius=0;for(let j=range.vertexStart;j<range.vertexStart+range.vertexCount;j++){v.fromBufferAttribute(p,j).applyMatrix4(m);radius=Math.max(radius,Math.hypot(v.x-x,v.z-z));vertices++;}const scale=Math.hypot(m.elements[0],m.elements[1],m.elements[2]),clearance=Math.min(rectDistance(x,z,-4.9,4.9,-72.9,92.9),rectDistance(x,z,-26.9,26.9,51.1,58.9),Math.max(0,trailDistance(x,z)-1.15),personClearance(x,z))-radius-.2*scale;checked++;if(clearance<-.001)violations.push({name:mesh.name,x,z,radius,clearance});}}
  let propVertices=0,propViolations=0;g.world2.root.getObjectByName('starhaven-market').traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position,v=g.player.unit.pos.clone();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);propVertices++;if(personClearance(v.x,v.z)<-.001)propViolations++;}});
  return {checked,vertices,violations,propVertices,propViolations,meadowPlants:g.world2.root.getObjectByName('starhaven-settlement').userData.meadowPlants};
 });
 console.log(JSON.stringify(result));assert.ok(result.checked>150);assert.ok(result.meadowPlants>100);if(!process.env.CC_QA_PROBE){assert.equal(result.violations.length,0);assert.equal(result.propViolations,0);}
 for(const [name,x,z] of [['north',0,-32],['square',0,71]]){await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,Math.PI);g.follow.cut();g.follow.yaw=0;g.follow.distance=9;g.follow.pitch=.42;},[x,z]);await page.waitForTimeout(1200);await page.screenshot({path:`tmp/qa/paving-${process.env.CC_QA_PROBE?'before':'after'}-${name}.png`});}
 assert.deepEqual(errors,[]);console.log(process.env.CC_QA_PROBE?'PROBE: recorded existing vegetation overlap and native views':'PASS: low plants, wind envelope and market props clear resident positions; paving and exploration paths remain clear; meadow density retained; no page errors');
}finally{await browser.close();}
