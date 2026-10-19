// Frostlight terrain: the snowfield is a clipmap under 10 cm at the player, not a plane; the GPU ground it bakes is
// the server's snowHeight(); the village, road, arena, spawn, NPCs and quest points stand on the ground they always
// had; the open field carries wind relief; the crags are real meshes the player cannot walk into; the far ranges
// are baked; and low quality keeps all of it on a coarser lattice. Writes tmp/qa/snow-terrain-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Snow surveyor'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:90000});await p.waitForTimeout(2500);
 await p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);
  g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);this.camera.position.set(...s.p);this.camera.lookAt(...s.t);};});
 return p;
}
// Free camera: player (the rings' centre) at `at`, eye `eye` metres over the ground, looking at `look`.
async function shot(p,at,eye,look,path){await p.evaluate(([at,eye,look])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);g.player.unit.teleport(g.world,at[0],at[1],0);
 window.__cam={p:[eye[0],h(eye[0],eye[2])+eye[1],eye[2]],t:[look[0],h(look[0],look[2])+look[1],look[2]]};},[at,eye,look]);await p.waitForTimeout(1400);await p.screenshot({path});}
const structure=p=>p.evaluate(()=>{const g=window.app.current.game,w=g.world2.fourth,t=w.terrain,m=t.mesh;
 const planes=[];w.root.traverse(o=>{const q=o.geometry?.parameters;if(o.isMesh&&o.geometry.type==='PlaneGeometry'&&q.width>=200&&q.height>=200)planes.push(o.name||'(unnamed)');});
 const rocks=[];w.root.traverse(o=>{if(o.name==='frostlight-rock')rocks.push({verts:o.geometry.getAttribute('position').count,x:o.position.x,z:o.position.z});});
 const ridges=w.root.getObjectByName('frostlight-far-ridges');
 return {name:m.name,visible:m.visible,layout:m.userData.layout,groundRes:m.userData.groundRes,verts:m.geometry.getAttribute('position').count,tris:m.geometry.index.count/3,
  depth:!!m.customDepthMaterial,shadows:[m.castShadow,m.receiveShadow],culled:m.frustumCulled,planes,rocks,
  ridges:{visible:ridges?.visible,verts:ridges?.userData.vertices,map:ridges?.material.uniforms.ridgeMap.value?.image?.width}};});
try{
 const p=await load('high');
 const s=await structure(p);
 assert.equal(s.visible,true,'the clipmap draws once the ground is baked');
 assert.ok(s.layout.spacing<0.1&&s.layout.levels>=8&&s.layout.half>=64,`inner rings under 10 cm, 8 levels: ${JSON.stringify(s.layout)}`);
 assert.ok(s.verts>100000&&s.tris>200000&&s.groundRes===2048,`one dense clipmap draw over a 2048 bake: ${JSON.stringify(s)}`);
 assert.ok(s.depth&&s.shadows.every(Boolean)&&s.culled===false,'the shadow pass runs the clipmap placement');
 assert.deepEqual(s.planes,[],'no flat ground or sea plane is left');
 console.log('PASS the snowfield is a nested-ring clipmap, not a plane',JSON.stringify({layout:s.layout,verts:s.verts,tris:s.tris,groundRes:s.groundRes}));

 // The GPU ground (shader twin and bake) is the server's snowHeight(), height and slope.
 const probe=await p.evaluate(()=>{const g=window.app.current.game,f=g.world2.fourth,pts=[];for(let i=0;i<600;i++)pts.push([Math.sin(i*12.9898)*150,Math.sin(i*78.233)*155]);
  const r=f.terrain.probe(g.engine.renderer,pts),h=(x,z)=>g.world.heightAt(x,z);let twin=0,baked=0,slope=0;
  pts.forEach(([x,z],i)=>{const want=h(x,z);twin=Math.max(twin,Math.abs(r[i][0]-want));baked=Math.max(baked,Math.abs(r[i][1]-want));
   const gx=(h(x+.05,z)-h(x-.05,z))/.1,gz=(h(x,z+.05)-h(x,z-.05))/.1;slope=Math.max(slope,Math.abs(r[i][2]-gx),Math.abs(r[i][3]-gz));});
  return {twin,baked,slope};});
 assert.ok(probe.twin<2e-3&&probe.baked<.04&&probe.slope<.05,`GPU ground matches snowHeight(): ${JSON.stringify(probe)}`);
 console.log('PASS the GPU ground is snowHeight()',JSON.stringify(probe));

 // Gameplay ground is untouched where gameplay needs it; the field carries relief.
 const ground=await p.evaluate(()=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);
  const ss=(x,a,b)=>x<=a?0:x>=b?1:((x-a)/(b-a))**2*(3-2*(x-a)/(b-a));
  const old=(x,z)=>{const edge=Math.hypot(x/128,(z-2)/155),plateau=5+14*ss(-z,5,55),hills=Math.sin(x*.052)*Math.sin(z*.037)*2.5*(1-Math.exp(-x*x/600)),t=ss(Math.hypot(x,z+78),22,32);return edge>.83?5-(edge-.83)*70:(1-t)*19+t*(plateau+hills);};
  // Spawn, arrival, the W5 gate, NPCs, the fountain, the village crates, Mira's prison and the arena.
  const keep=[[-12,90],[0,82],[14,84],[-16,56],[16,56],[-16,38],[16,38],[-16,74],[16,80],[16,68],[-13,65],[-12,78],[12,72],[-12,56],[13,-62],[0,-78],[18,-78],[0,-100]];
  for(let z=94;z>=-53;z-=3)for(const x of [-4,0,4])keep.push([x,z]);
  for(const z of [38,56,74])for(let x=-22;x<=22;x+=2)keep.push([x,z]);
  let drift=0;for(const [x,z] of keep)drift=Math.max(drift,Math.abs(h(x,z)-old(x,z)));
  // Quest points out in the field ride the new ground; it must stay walkable under them.
  const quests=[[-47,40],[-52,28],[-44,14],[-7,26],[7,4],[-7,-22],[-50,26],[61,22],[0,-34],[36,8],[44,-6],[34,-22],[62,34],[68,20],[60,4],[-17,-34],[17,-42],[-16,-54]];
  let steep=0;for(const [x,z] of quests)steep=Math.max(steep,Math.hypot(h(x+.5,z)-h(x-.5,z),h(x,z+.5)-h(x,z-.5)));
  // Relief of the open field: how far the ground stands off the mean of four points 10 m around it.
  const field=[];for(let x=-110;x<=110;x+=3)for(let z=-130;z<=130;z+=3){if(Math.hypot(x/128,(z-2)/155)>.78||Math.abs(x)<55&&z>20||Math.hypot(x,z+78)<46||Math.abs(x)<20)continue;
   field.push(Math.abs(h(x,z)-(h(x+10,z)+h(x-10,z)+h(x,z+10)+h(x,z-10))/4));}
  field.sort((a,b)=>a-b);const p90=field[Math.floor(field.length*.9)],sd=field.reduce((a,b)=>a+b,0)/field.length;
  return {points:keep.length,drift,questSlope:+steep.toFixed(3),samples:field.length,mean:+sd.toFixed(2),p90:+p90.toFixed(2),max:+field[field.length-1].toFixed(2)};});
 assert.ok(ground.drift<1e-9,`village, roads, arena, spawn, NPCs and village quest points keep their ground: ${JSON.stringify(ground)}`);
 assert.ok(ground.questSlope<.6,`field quest points stand on walkable snow: ${JSON.stringify(ground)}`);
 assert.ok(ground.p90>.6&&ground.max>2,`the open field has wind-carved relief: ${JSON.stringify(ground)}`);
 console.log('PASS gameplay ground kept, field carved',JSON.stringify(ground));

 // Crags: real meshes, sunk into their drifts, solid to the player.
 assert.ok(s.rocks.length>=5&&s.rocks.length<=8,`a few crags, sparse: ${s.rocks.length}`);
 assert.ok(s.rocks.every(r=>r.verts>2000),`crags are dense meshes, not primitives: ${JSON.stringify(s.rocks.map(r=>r.verts))}`);
 const solid=await p.evaluate(()=>{const g=window.app.current.game,u=g.player.unit;return g.world2.fourth.root.children.find(o=>o.name==='frostlight-rock-outcrops').children.map(o=>{const k=o.userData.rock;
  const out=g.world.resolveCollision(k.x,k.z,u.radius,{set(x,y){this.x=x;this.y=y;return this;}});return +Math.hypot(out.x-k.x,out.y-k.z).toFixed(2)/k.r;});});
 assert.ok(solid.every(d=>d>.45),`the player is pushed out of every crag: ${JSON.stringify(solid)}`);
 assert.ok(s.ridges.visible&&s.ridges.verts>100000&&s.ridges.map===4096,`the far ranges are baked and drawn: ${JSON.stringify(s.ridges)}`);
 console.log('PASS crags are solid meshes and the far ranges are baked',JSON.stringify({rocks:s.rocks.map(r=>[r.x,r.z,r.verts]),solid,ridges:s.ridges}));

 await shot(p,[52,10],[46,2.6,22],[70,1.5,-20],'tmp/qa/snow-terrain-hills.png');
 await shot(p,[-70,10],[-66,2.5,24],[-90,3,14],'tmp/qa/snow-terrain-crag.png');
 await shot(p,[-60,0],[-60,5,0],[-800,40,-200],'tmp/qa/snow-terrain-ranges.png');
 await shot(p,[40,0],[40,2.2,3.2],[40,0,0],'tmp/qa/snow-terrain-close.png');
 await p.close();

 const low=await load('low');
 const l=await structure(low);
 assert.ok(l.visible&&l.layout.spacing>s.layout.spacing&&l.verts<s.verts/2&&l.groundRes===1024,`low quality: coarser rings and bake: ${JSON.stringify({layout:l.layout,verts:l.verts,groundRes:l.groundRes})}`);
 assert.deepEqual(l.planes,[],'low quality has no flat plane either');
 assert.ok(l.rocks.length===s.rocks.length&&l.ridges.visible,'low quality keeps the crags and ranges');
 await shot(low,[52,10],[46,2.6,22],[70,1.5,-20],'tmp/qa/snow-terrain-low.png');
 console.log('PASS low quality runs the same terrain on a coarser lattice',JSON.stringify({layout:l.layout,verts:l.verts,groundRes:l.groundRes}));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
