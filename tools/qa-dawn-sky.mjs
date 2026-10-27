// Dawnharbor's dawn (World III): the baked dawn sky with the sun low in the east, the depth-coloured sea, the
// reshaped coast and fields, and the shader ground. Checks that the server's dawnHeight() keeps every piece of
// gameplay ground at its old height and the fields stay walkable; that the old gradient sphere, flat metallic sea
// plane, vertex-colour plate, sun ball, cloud blobs and foam rings are gone; that sun, hemisphere and fog read the
// one sky; and that high and low quality both render without errors. Writes tmp/qa/dawn-sky-*.png.
// Since Goldsand (the desert harbour) the ground is the sand clipmap: tools/qa-dawn-sand.mjs holds it to
// dawnHeight() on the GPU, so this script checks only that it is the ground drawn here.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
import {dawnHeight,DAWN_ARENA_HEIGHT} from '../src/sim/world/ground.ts';
import {DAWN_POINTS} from '../src/sim/data/quests.ts';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5611';

// The town's roads and lots come from the game's own layout (world3Colliders.ts), read through vite.
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
const layout=await (async()=>{const p=await browser.newPage();await p.goto(base+'/');const l=await p.evaluate(async()=>{const m=await import('/src/game/world3Colliders.ts');return {paths:m.DAWN_PATHS,lots:m.dawnLots().map(l=>({x:l.x,z:l.z}))};});await p.close();return l;})();
const DAWN_PATHS=layout.paths,dawnLots=()=>layout.lots;

// --- The ground, numbers only -------------------------------------------------------------------------------------
const ss=(x,a,b)=>{if(x<=a)return 0;if(x>=b)return 1;x=(x-a)/(b-a);return x*x*(3-2*x);};
// The island before this change (dev 997d68a), for the ground gameplay stands on.
const old=(x,z)=>{const r=Math.hypot(x/122,(z-3)/149),shore=4-Math.max(0,r-.83)*65,upland=13*ss(-z,5,55),hills=Math.sin(x*.045)*Math.sin(z*.04)*2*(1-Math.exp(-x*x/400));const n=r>.86?shore:4+upland+hills,a=1-ss(Math.hypot(x,z+72),21,31);return n+(19-n)*a;};
const keep=[[-12,84],[0,82],[14,84],[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64],[20,64],[16,48],[-20,64],[-55,36],[55,36],[55,-25],[0,-40],[0,-44],[67,72],...Object.values(DAWN_POINTS)];
for(const l of dawnLots())for(const dx of [-6,0,6])for(const dz of [-6,0,6])keep.push([l.x+dx,l.z+dz]);
// Every road across its whole width, the harbour front and the market rows.
for(const w of DAWN_PATHS)for(let k=1;k<w.points.length;k++){const [ax,az]=w.points[k-1],[bx,bz]=w.points[k],L=Math.hypot(bx-ax,bz-az),nx=(bz-az)/L,nz=-(bx-ax)/L;
 for(let t=0;t<=1;t+=1/Math.ceil(L))for(const a of [-1,-.5,0,.5,1]){const d=a*w.width/2;keep.push([ax+(bx-ax)*t+nx*d,az+(bz-az)*t+nz*d]);}}
for(let x=-30;x<=30;x+=2)for(let z=85;z<=120;z+=2)keep.push([x,z]);
for(const side of [-1,1])for(const z of [37,57,74])keep.push([side*23,z],[side*25,z+1],[side*25,z-2]);
// The climb, the gate and the citadel plateau with the arena: everything north of z = -40.
for(let x=-60;x<=60;x+=3)for(let z=-110;z<=-40;z+=3)if(Math.hypot(x/122,(z-3)/149)<.84)keep.push([x,z]);
let kept=0;for(const [x,z] of keep)kept=Math.max(kept,Math.abs(dawnHeight(x,z)-old(x,z)));
assert.equal(kept,0,'gameplay ground keeps its exact old height');
for(let r=0;r<=21;r+=3)for(let i=0;i<24;i++){const a=i/24*Math.PI*2;assert.equal(dawnHeight(Math.sin(a)*r,-72+Math.cos(a)*r),DAWN_ARENA_HEIGHT);}
// The open fields changed (relief and dunes), and stay walkable inside the island's bounds (queries.ts DAWN_BOUNDS).
let changed=0,fields=0,slope=0,below=0;
for(let x=-98;x<=98;x+=1)for(let z=-140;z<=150;z+=1){const r=Math.hypot(x/122,(z-3)/149);if(r>.81)continue;const h=dawnHeight(x,z);fields++;if(Math.abs(h-old(x,z))>.25)changed++;if(h<.8)below++;
 if(Math.hypot(x,z+72)>32){const g=Math.hypot(dawnHeight(x+.25,z)-dawnHeight(x-.25,z),dawnHeight(x,z+.25)-dawnHeight(x,z-.25))/.5;slope=Math.max(slope,g);}}
assert.ok(changed/fields>.15,`the open fields carry new relief: ${changed}/${fields}`);
assert.ok(slope<.85,`walkable ground stays under 40 degrees: ${slope.toFixed(2)}`);
assert.equal(below,0,'no walkable ground drowns');
// The coast is not an ellipse: where it meets the sea wanders by several metres around the island.
const coast=[];for(let i=0;i<180;i++){const a=i/180*Math.PI*2;let t=.75;while(t<1.2&&dawnHeight(Math.sin(a)*122*t,3+Math.cos(a)*149*t)>.25)t+=.002;coast.push(t);}
const spread=Math.max(...coast)-Math.min(...coast);
assert.ok(spread>.04&&Math.min(...coast)>.82,`a wandering shoreline outside the walkable ellipse: ${Math.min(...coast).toFixed(3)}..${Math.max(...coast).toFixed(3)}`);
// High land breaks off in bluffs to the north (the citadel's escarpment above the desert), low land shelves into the south as beach.
const drop=(x,z,dx,dz)=>{let best=0;for(let s=0;s<30;s+=.5)best=Math.max(best,(dawnHeight(x+dx*s,z+dz*s)-dawnHeight(x+dx*(s+1),z+dz*(s+1))));return best;};
const north=drop(0,-118,0,-1),south=drop(0,118,0,1);
assert.ok(north>2.5&&south<1.2,`bluffs north (${north.toFixed(2)} m per m), beach south (${south.toFixed(2)})`);
console.log('PASS ground: kept',keep.length,'points exactly, relief on',(changed/fields*100).toFixed(0)+'% of the fields, max slope',slope.toFixed(2),'coast',Math.min(...coast).toFixed(3)+'..'+Math.max(...coast).toFixed(3),'bluff',north.toFixed(2),'beach',south.toFixed(2));

// --- In the game --------------------------------------------------------------------------------------------------
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Dawn surveyor'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(3);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===3&&!document.querySelector('.loading'),null,{timeout:180000});await p.waitForTimeout(2500);
 await p.evaluate(()=>{const g=window.app.current.game;const away=()=>{for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);requestAnimationFrame(away);};away();
  g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);this.camera.position.set(...s.p);this.camera.lookAt(...s.t);};});
 return p;
}
async function shot(p,at,eye,look,path){await p.evaluate(([at,eye,look])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);g.player.unit.teleport(g.world,at[0],at[1],0);
 window.__cam={p:[eye[0],Math.max(h(eye[0],eye[2]),.25)+eye[1],eye[2]],t:[look[0],Math.max(h(look[0],look[2]),.25)+look[1],look[2]]};},[at,eye,look]);await p.waitForTimeout(1600);await p.screenshot({path});}
const inspect=p=>p.evaluate(()=>{const g=window.app.current.game,w=g.world2.third,root=w.root,find=n=>root.getObjectByName(n);
 const ground=find('goldsand-clipmap'),sea=find('dawn-sea'),sky=find('dawn-sky'),sun=find('dawnreach-sun');
 // Old primitives: the gradient sphere, the flat sea and plate, the sun ball, the cloud blobs, the foam rings.
 const leftovers=[];root.traverse(o=>{if(!o.isMesh)return;const t=o.geometry.type,q=o.geometry.parameters??{};
  if(t==='PlaneGeometry'&&q.width>=200&&o!==sea&&o!==ground)leftovers.push('plane '+(o.name||t));
  if(t==='SphereGeometry'&&q.radius>=14&&o!==sky)leftovers.push('sphere '+q.radius);
  if(t==='PlaneGeometry'&&o.material?.vertexColors)leftovers.push('vertex-colour ground');
  if(o.material?.isMeshBasicMaterial&&o.material.transparent&&t==='BufferGeometry'&&o.geometry.attributes.position.count===768)leftovers.push('foam ring');
  if(o.material?.isMeshBasicMaterial&&o.material.transparent&&t==='SphereGeometry'&&o.scale.y<=3.01&&o.scale.x>=17)leftovers.push('cloud blob');});
 const hemi=[];root.traverse(o=>{if(o.isHemisphereLight)hemi.push(o);});
 const sd=sun.position.clone().sub(sun.target.position).normalize();
 // Fog toward the sun is warm, away from it cool, and the dome's haze band follows it.
 const fog=g.scene.fog,cam=g.camera,warm=[],fogOf=(dx,dz)=>{cam.position.set(0,10,0);cam.lookAt(dx,10,dz);cam.updateMatrixWorld();w.fog(cam,fog);return fog.color.clone();};
 const east=fogOf(w.sky.sunDir.x,w.sky.sunDir.z),west=fogOf(-w.sky.sunDir.x,-w.sky.sunDir.z);
 return {ground:!!ground&&ground.visible,sea:!!sea,sky:sky?.material?.name,leftovers,rings:ground.userData.layout?.levels,
  sunDot:sd.dot(w.sky.sunDir),sunEl:Math.asin(w.sky.sunDir.y)*180/Math.PI,sunAz:Math.atan2(w.sky.sunDir.x,w.sky.sunDir.z)*180/Math.PI,shadow:sun.castShadow,map:sun.shadow.mapSize.x,
  hemi:hemi.length,hemiSky:hemi[0]?.color.equals(w.sky.hemiSky),hemiGround:hemi[0]?.groundColor.equals(w.sky.hemiGround),
  east:[east.r,east.g,east.b],west:[west.r,west.g,west.b],seaLUT:sea.material.uniforms.dawnSkyLUT.value===sky.material.uniforms.dawnSkyLUT.value,
  low:['SAND_LOW' in (ground.material.defines??{}),'DAWN_LOW' in sea.material.defines,'DAWN_LOW' in sky.material.defines],calls:g.engine.renderer.info.render.calls};});
try{
 for(const quality of ['high','low']){
  const p=await load(quality);const s=await inspect(p);
  assert.ok(s.ground&&s.sea&&s.sky==='dawn-sky',`the dawn ground, sea and sky are built: ${JSON.stringify(s)}`);
  assert.deepEqual(s.leftovers,[],'no old sky sphere, sea plane, vertex-colour plate, sun ball, cloud blob or foam ring is left');
  assert.equal(s.rings,9,'the sand clipmap is the ground');
  assert.ok(s.sunDot>.999&&s.sunEl>5&&s.sunEl<16&&s.sunAz>80&&s.sunAz<130&&s.shadow,`a low sun in the east casts the shadows: ${s.sunEl.toFixed(1)} deg up, bearing ${s.sunAz.toFixed(0)}`);
  assert.ok(s.hemi===1&&s.hemiSky&&s.hemiGround&&s.seaLUT,'hemisphere light and the sea read the same sky');
  assert.ok(s.east[0]>s.west[0]*1.1&&s.east[0]/s.east[2]>s.west[0]/s.west[2],`fog is warm toward the sun, cool away: ${JSON.stringify([s.east,s.west])}`);
  assert.deepEqual(s.low,quality==='low'?[true,true,true]:[false,false,false],`${quality} quality defines`);
  assert.equal(s.map,quality==='low'?1024:2048,'shadow map follows quality');
  console.log(`PASS ${quality}: sand clipmap ${s.rings} rings, sun ${s.sunEl.toFixed(1)} deg at bearing ${s.sunAz.toFixed(0)}, map ${s.map}, ${s.calls} calls`);
  if(quality==='high'){
   await shot(p,[0,60],[-14,9,40],[10,2,72],'tmp/qa/dawn-sky-town.png');
   await shot(p,[60,98],[50,7,86],[80,0,120],'tmp/qa/dawn-sky-shore.png');
   await shot(p,[92,30],[78,6,30],[200,8,-20],'tmp/qa/dawn-sky-sunrise.png');
   await shot(p,[-60,90],[-50,6,80],[-80,0,108],'tmp/qa/dawn-sky-dunes.png');
   await shot(p,[0,0],[0,175,40],[0,0,-10],'tmp/qa/dawn-sky-aerial.png');
  }else await shot(p,[0,60],[-14,9,40],[10,2,72],'tmp/qa/dawn-sky-town-low.png');
  await p.close();
 }
 assert.deepEqual(errors,[],'no page, shader or GL errors');
 console.log('PASS dawn sky: no page, shader or GL errors at high and low quality');
}finally{await browser.close();}
