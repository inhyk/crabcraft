// Frostlight's open fields (snowFields.ts, snowFieldsLayout.ts): every layout entry is built, kit pieces are batched,
// no placeholder primitive is left, every solid has its collider and keeps clear of the village, roads, arena, quest
// points, monster homes and the throne sites, the shaders compile without errors, and the low-quality page drops only
// the fine dressing. Writes tmp/qa/snow-fields-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {bundle} from './collision-bake-lib.mjs';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';

// Layout checks in Node, on the same module the bake reads.
const L=await import((await bundle('src/game/snowFieldsLayout.ts','qa-fields')).url);
const G=await import((await bundle('src/sim/world/ground.ts','qa-fields-ground')).url);
const Q=await import((await bundle('src/sim/data/quests.ts','qa-fields-quests')).url);
const solids=[
 ...L.snowGroves().map(t=>({kind:'pine',x:t.x,z:t.z,r:.6*t.s})),
 ...L.snowBoulders().map(b=>({kind:'boulder',x:b.x,z:b.z,r:b.r})),
 ...L.snowFieldPieces().filter(p=>p.solid).map(p=>({kind:p.piece,x:p.x,z:p.z,r:'r' in p.solid?p.solid.r:Math.hypot(p.solid.hx,p.solid.hz)})),
 ...L.snowLogs().map(l=>({kind:'log',x:l.x,z:l.z,r:l.len/2})),
 ...L.snowStumps().map(s=>({kind:'stump',x:s.x,z:s.z,r:s.r})),
];
for(const s of solids){
 assert.equal(L.fieldBlock(s.x,s.z,Math.min(s.r,1.2),true),null,`${s.kind} at ${s.x},${s.z} is clear (${L.fieldBlock(s.x,s.z,Math.min(s.r,1.2),true)})`);
 for(const [id,[qx,qz]] of Object.entries(Q.SNOW_POINTS))assert.ok(Math.hypot(s.x-qx,s.z-qz)-s.r>=4,`${s.kind} keeps 4 m from ${id}`);
 for(const [hx,hz] of L.FIELD_HOMES)assert.ok(Math.hypot(s.x-hx,s.z-hz)-s.r>=6,`${s.kind} keeps 6 m from the monster home ${hx},${hz}`);
 for(const [sx,sz] of L.FIELD_SITES)assert.ok(Math.hypot(s.x-sx,s.z-sz)>=10,`${s.kind} keeps 10 m from the throne site ${sx},${sz}`);
 assert.ok(s.z>-90,`${s.kind} stays south of z=-90`);
}
for(const p of L.snowFieldPieces())assert.equal(L.fieldBlock(p.x,p.z,.3,false),null,`${p.piece} at ${p.x},${p.z} is outside the village, roads, arena and quest points`);
// The fields stand on the gameplay ground, which they must not change.
assert.equal(G.snowHeight(0,-78),19);
// Quest points stay reachable: the server resolves each with radius 1, and no field collider may push it.
const C=await import((await bundle('src/world/collision.ts','qa-fields-collision')).url);
const fieldsOnly=new C.Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:G.snowHeight});
L.registerSnowFields(fieldsOnly,G.snowHeight);
const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};
for(const [id,[x,z]] of Object.entries(Q.SNOW_POINTS)){fieldsOnly.resolve(x,z,1,out);assert.ok(Math.hypot(out.x-x,out.y-z)<1e-6,`${id} is not pushed by a field collider`);}
console.log('PASS layout:',solids.length,'solids clear of village, roads, arena, quest points (4 m), homes (6 m), throne sites (10 m) and the north');

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Field walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading')&&window.app.current.game.world2.fourth.fields,null,{timeout:120000});await p.waitForTimeout(2500);return p;
}
// A fixed camera: [target x, z, lift], [camera x, lift, z].
async function view(p,name,[tx,tz,to],[cx,co,cz]){
 await p.evaluate(([tx,tz,to,cx,co,cz])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,cx+2,cz+2,0);
  const cam=[cx,h(cx,cz)+co,cz],at=[tx,h(tx,tz)+to,tz];g.follow.update=function(){this.camera.position.set(...cam);this.camera.lookAt(...at);};},[tx,tz,to,cx,co,cz]);
 await p.waitForTimeout(1500);await p.screenshot({path:`tmp/qa/snow-fields-${name}.png`});
}
try{
 const p=await load('high');
 const r=await p.evaluate(async()=>{
  const w=window.app.current.game.world2.fourth,f=w.root.getObjectByName('frostlight-fields');
  const L=await import('/src/game/snowFieldsLayout.ts');
  const m=new window.app.current.game.camera.matrixWorld.constructor();
  const groves=w.root.getObjectByName('frostlight-groves');
  const xz=b=>{const out=[];for(let i=0;i<b.instanceCount;i++){b.getMatrixAt(i,m);out.push([+m.elements[12].toFixed(2),+m.elements[14].toFixed(2)]);}return out.sort((a,c)=>a[0]-c[0]||a[1]-c[1]);};
  const want=L.snowGroves().map(t=>[+t.x.toFixed(2),+t.z.toFixed(2)]).sort((a,c)=>a[0]-c[0]||a[1]-c[1]);
  // Placeholder primitives: three's stock shapes, or one mesh per piece outside a batch.
  const stock=/^(Box|Cylinder|Cone|Sphere|Plane|Circle|Torus|Octahedron|Icosahedron|Capsule|Dodecahedron|Tetrahedron)Geometry$/;
  let primitives=[],meshes=0,batched=0,instances=0;
  f.traverse(o=>{if(o.isMesh){meshes++;if(stock.test(o.geometry.type))primitives.push(o.name+':'+o.geometry.type);}if(o.isBatchedMesh){batched++;instances+=o.instanceCount;}});
  // Every solid's collider is in the island's collision, at its own position.
  const shapes=w.collision.shapes,has=(x,z)=>shapes.some(s=>{const c=s.kind===0?s.c:s.b;return Math.abs(c.x-x)<1e-6&&Math.abs(c.z-z)<1e-6;});
  const solids=[...L.snowGroves(),...L.snowBoulders(),...L.snowFieldPieces().filter(p=>p.solid),...L.snowLogs(),...L.snowStumps()];
  const missing=solids.filter(s=>!has(s.x,s.z)).map(s=>[s.x,s.z]);
  return {found:!!f,data:f?.userData.fields,groves:groves?.userData.groves,groveMatch:groves?groves.children.every(b=>JSON.stringify(xz(b))===JSON.stringify(want)):false,
   groveMeshes:groves?.children.length,primitives,meshes,batched,instances,missing,solids:solids.length,
   names:f.children.map(c=>c.name)};
 });
 assert.equal(r.found,true,'frostlight-fields group exists');
 assert.equal(r.groves,r.data.groves);assert.ok(r.groves>=50,`groves hold ${r.groves} extra pines`);assert.equal(r.groveMatch,true,'every grove pine stands on its snowGroves() spot');
 for(const k of ['boulders','logs','stumps','ponds','tracks','scours','slabs'])assert.ok(r.data[k]>0,`${k}: ${r.data[k]}`);
 assert.ok(r.data.pieces>=150,`kit pieces placed: ${r.data.pieces}`);
 assert.deepEqual(r.primitives,[],'no stock primitive geometry in the fields');
 assert.ok(r.batched>=8,`kit pieces batched: ${r.batched} BatchedMeshes, ${r.instances} instances`);
 assert.deepEqual(r.missing,[],'every solid has a collider at its position');
 for(const n of ['frostlight-groves','frostlight-field-boulders','frostlight-field-wood','frostlight-field-trails','frostlight-field-scours','frostlight-ice-shelves','frostlight-field-fine'])assert.ok(r.names.includes(n),`${n} built`);
 console.log('PASS fields built',JSON.stringify({data:r.data,meshes:r.meshes,batched:r.batched,instances:r.instances,solids:r.solids}));
 const programs=await p.evaluate(()=>window.app.engine.renderer.info.programs.map(q=>q.cacheKey));
 await view(p,'east',[44,-36.5,.8],[33,2.6,-22]);
 await view(p,'west',[-35,-28,.5],[-24,3,-18]);
 await view(p,'pond',[54,-11,0],[44,2.4,-1]);
 await view(p,'shore',[114,52,0],[97,5,30]);
 const after=await p.evaluate(()=>window.app.engine.renderer.info.programs.map(q=>q.cacheKey));
 for(const k of ['frostlight-field-bark','frostlight-field-pond','frostlight-sea-ice','-skirt'])assert.ok(after.some(c=>c.includes(k)),`${k} shader compiled`);
 assert.ok(after.length>=programs.length);
 console.log('PASS field shaders compiled; wrote tmp/qa/snow-fields-{east,west,pond,shore}.png');
 await p.close();
 const low=await load('low');
 const lr=await low.evaluate(()=>{const f=window.app.current.game.world2.fourth.root.getObjectByName('frostlight-fields');return {fine:f.getObjectByName('frostlight-field-fine').visible,trails:f.getObjectByName('frostlight-field-trails').visible,groves:f.getObjectByName('frostlight-groves').visible,boulders:f.getObjectByName('frostlight-field-boulders').visible};});
 assert.deepEqual(lr,{fine:false,trails:false,groves:true,boulders:true},'low quality drops only the fine dressing and the trails');
 await view(low,'east-low',[44,-36.5,.8],[33,2.6,-22]);
 console.log('PASS low quality keeps every solid and drops the fine dressing',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero page or shader errors');
}finally{await browser.close();}
