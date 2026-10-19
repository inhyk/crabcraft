// Frostlight forest: the kit pines stand on every snowTrees() trunk and every grove pine of the fields
// (snowGroves(), batched in the same two draws), the old cone boughs are gone, the snow patch compiles, and the
// low-quality page loads too. Writes tmp/qa/snow-pines*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Pine walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:90000});await p.waitForTimeout(2000);return p;
}
// Frame a stand of pines on the west slope with a fixed camera, then let a few frames render.
async function frame(p){
 await p.evaluate(()=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,-40,6,0);
  const cam=[-47,h(-47,4)+3.5,4],at=[-60.5,h(-60.5,-3.9)+4.5,-3.9];g.follow.update=function(){this.camera.position.set(...cam);this.camera.lookAt(...at);};});
 await p.waitForTimeout(1200);
}
try{
 const p=await load('high');
 const r=await p.evaluate(async()=>{const g=window.app.current.game,w=g.world2.fourth,ren=window.app.engine.renderer;
  const {snowTrees}=await import('/src/game/world4Colliders.ts');
  const {snowGroves}=await import('/src/game/snowFieldsLayout.ts');
  const forest=w.root.getObjectByName('frostlight-snow-pines'),m=new window.app.current.game.camera.matrixWorld.constructor();
  const meshes=forest?forest.children.map(b=>{const xz=[];for(let i=0;i<b.instanceCount;i++){b.getMatrixAt(i,m);xz.push([+m.elements[12].toFixed(3),+m.elements[14].toFixed(3)]);}
   let verts=0;b.geometry&&(verts=b.geometry.getAttribute('position').count);
   return {name:b.name,batched:!!b.isBatchedMesh,instances:b.instanceCount,verts,map:!!b.material.map,shadow:b.castShadow,xz:xz.sort((a,c)=>a[0]-c[0]||a[1]-c[1])};}):[];
  const want=[...snowTrees(),...snowGroves()].map(t=>[+t.x.toFixed(3),+t.z.toFixed(3)]).sort((a,c)=>a[0]-c[0]||a[1]-c[1]);
  // The primitive forest used Cylinder/Cone InstancedMeshes; nothing of that kind may remain.
  let cones=0;w.root.traverse(o=>{if(o.isInstancedMesh&&/Cone|Cylinder/.test(o.geometry.type))cones++;});
  return {found:!!forest,pines:forest?.userData.pines,snowPines:w.root.userData.snowPines,meshes:meshes.map(({xz,...rest})=>rest),
   positionsMatch:meshes.length>0&&meshes.every(b=>JSON.stringify(b.xz)===JSON.stringify(want)),cones,trees:snowTrees().length,all:want.length};});
 assert.equal(r.found,true,'forest group exists');
 assert.equal(r.snowPines,91);assert.equal(r.trees,91);assert.ok(r.all>=141,`91 trunks and the groves: ${r.all}`);assert.equal(r.pines,r.all);
 assert.deepEqual(r.meshes.map(b=>b.name).sort(),['frostlight-snow-pines:Bark_NormalTree','frostlight-snow-pines:Leaves_Pine']);
 for(const b of r.meshes){assert.equal(b.batched,true);assert.equal(b.instances,r.all);assert.equal(b.map,true,`${b.name} keeps the kit texture`);assert.equal(b.shadow,true);assert.ok(b.verts>2000,`${b.name} holds kit geometry: ${b.verts} vertices`);}
 assert.equal(r.positionsMatch,true,'every pine stands on a snowTrees() trunk or a snowGroves() spot');
 assert.equal(r.cones,0,'no primitive trees remain');
 console.log(`PASS kit pines on all 91 trunks and ${r.all-91} grove spots`,JSON.stringify(r));
 await frame(p);
 const programs=await p.evaluate(()=>window.app.engine.renderer.info.programs.filter(q=>q.cacheKey.includes('snow-laden')).length);
 assert.ok(programs>=2,`snow patch compiled for needles and bark: ${programs}`);
 await p.screenshot({path:'tmp/qa/snow-pines.png'});
 console.log('PASS snow-laden shader compiled',programs,'programs; wrote tmp/qa/snow-pines.png');
 await p.close();
 const low=await load('low');
 const lr=await low.evaluate(()=>{const f=window.app.current.game.world2.fourth.root.getObjectByName('frostlight-snow-pines');return {pines:f?.userData.pines,instances:f?.children.map(b=>b.instanceCount)};});
 assert.equal(lr.pines,r.all);assert.deepEqual(lr.instances,[r.all,r.all]);
 await frame(low);await low.screenshot({path:'tmp/qa/snow-pines-low.png'});
 console.log('PASS low quality loads the same forest',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
