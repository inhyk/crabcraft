// World VI town (skyTown.ts, skyHarbour.ts, skyTownLayout.ts): the town's colliders are in World VI's layout in place of
// the shared house boxes and World V keeps its own; every town solid stays off the ways, the quest points, POIs, NPC
// spots and house doors; no lantern post stands in an evenly spaced line; the mooring mast's airship shows in the
// arrival view; the greyscale of the village and street keeps wall, roof, grass, path and crab apart (roofs a step
// under the grass); both graphics tiers render without page or GL errors.
//   CC_QA_BASE=http://127.0.0.1:5643 node tools/qa-sky-town.mjs
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
import {bundle} from './collision-bake-lib.mjs';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5643';
await mkdir('tmp/qa',{recursive:true});

// --- Node: layout and colliders.
const town=await import((await bundle('src/game/skyTownLayout.ts','qa-sky-town-layout')).url);
const ground=await import((await bundle('src/game/skyGroundLayout.ts','qa-sky-town-ground')).url);
const realm=await import((await bundle('src/game/realmLayout.ts','qa-sky-town-realm')).url);
const quests=await import((await bundle('src/game/frontierQuests.ts','qa-sky-town-quests')).url);
const folk=await import((await bundle('src/sim/data/townsfolk.ts','qa-sky-town-folk')).url);
const {Collision}=await import((await bundle('src/world/collision.ts','qa-sky-town-collision')).url);
const h=(x,z)=>ground.skyHeight(x,z);
const col=new Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:h});
town.layoutSkyTown(col,h);
const solids=col.shapes,w5=realm.layoutFrontier(5),w6=realm.layoutFrontier(6);
// World V still has the six shared house boxes; World VI has none of them and all of the town's solids.
const oldBox=s=>s.kind===1&&Math.abs(s.b.hx-5.3)<1e-9&&Math.abs(s.b.hz-5.8)<1e-9;
assert.equal(w5.shapes.filter(oldBox).length,6,'World V house boxes');
assert.equal(w6.shapes.filter(oldBox).length,0,'World VI still has the shared house boxes');
const key=s=>JSON.stringify(s);
const w6keys=new Set(w6.shapes.map(key));for(const s of solids)assert.ok(w6keys.has(key(s)),'town solid missing from layoutFrontier(6)');
// Footprint of a solid as a circle (boxes: their half diagonal) for the clearance checks.
const foot=s=>s.kind===0?{x:s.c.x,z:s.c.z,r:s.c.r,box:false}:{x:s.b.x,z:s.b.z,r:Math.hypot(s.b.hx,s.b.hz),box:true,b:s.b};
const inside=(s,x,z,m)=>{if(s.kind===0)return Math.hypot(x-s.c.x,z-s.c.z)<s.c.r+m;const b=s.b,dx=x-b.x,dz=z-b.z,lx=b.c*dx-b.s*dz,lz=b.s*dx+b.c*dz;return Math.abs(lx)<b.hx+m&&Math.abs(lz)<b.hz+m;};
const houses=town.SKY_HOUSES.map(hs=>solids.find(s=>s.kind===1&&Math.abs(s.b.x-hs.x)<1e-9&&Math.abs(s.b.z-hs.z)<1e-9));
assert.ok(houses.every(Boolean),'a house box per house');
const gateRope=solids.find(s=>s.kind===1&&Math.abs(s.b.z-town.SKY_PIER.gateZ)<1e-9&&Math.abs(s.b.hz-.2)<1e-9);
const points=[...Object.entries(quests.FRONTIER_POINTS[6]).map(([id,[x,z]])=>[id,x,z,1.5]),
 ...[['spawn',0,82,6],['portal',-12,84,3.5],['forge',16,68,5],['chapel',16,56,5],['tavern',-16,74,5],['grove',-50,26,9],['shore',61,22,24],['wreck',44,-6,8],['lighthouse',0,-44,6]],
 ...folk.SNOW_TOWN_POINTS.flatMap(([x,z],i)=>[[`npc${i}`,x,z,1.5],[`folk${i}`,x,z+2,1.5]])];
const bad=[];
for(const s of solids){
 const f=foot(s);
 for(const [id,x,z,r] of points)if(inside(s,x,z,r))bad.push(`${f.x.toFixed(1)},${f.z.toFixed(1)} in ${id}`);
 if(houses.includes(s))continue;
 // Off the paving: posts and yards clear the curb (.3 m past the paved edge); boxes keep .6 m from the edge.
 const clear=s===gateRope?ground.skyPathDistance(f.x,f.z)>-.01:f.box?[[-1,-1],[1,-1],[1,1],[-1,1],[0,0]].every(([i,j])=>{const b=f.b,lx=i*b.hx,lz=j*b.hz;return ground.skyPathDistance(b.x+b.c*lx+b.s*lz,b.z-b.s*lx+b.c*lz)>.3+.3;}):ground.skyPathDistance(f.x,f.z)>f.r+.35;
 if(!clear)bad.push(`${f.x.toFixed(1)},${f.z.toFixed(1)} on a way`);
}
// Doors: the step in front of each door is free of every solid but its own house.
for(const [i,hs] of town.SKY_HOUSES.entries()){const [x,z]=town.houseToWorld(hs,0,town.HOUSE.WZ+1.3);for(const s of w6.shapes)if(inside(s,x,z,.55))bad.push(`door of ${hs.role} blocked`);void i;}
// The ground lane's solids and the town's never overlap.
for(const g of ground.skySolids())for(const s of solids)if(inside(s,g.x,g.z,g.r))bad.push(`town solid on ground solid at ${g.x.toFixed(1)},${g.z.toFixed(1)}`);
assert.deepEqual(bad,[],'town solids clash');
// No evenly spaced line of lantern posts: no post halfway (within 20%) between two others on a straight run under 60 m.
const L=town.skyTownPlan().lanterns;let lines=0;
for(let a=0;a<L.length;a++)for(let b=0;b<L.length;b++)for(let c=0;c<L.length;c++){if(a===b||b===c||a===c)continue;const ab=Math.hypot(L[b][0]-L[a][0],L[b][1]-L[a][1]),bc=Math.hypot(L[c][0]-L[b][0],L[c][1]-L[b][1]);const ac=Math.hypot(L[c][0]-L[a][0],L[c][1]-L[a][1]);if(ab>4&&ab<30&&Math.abs(ab-bc)/ab<.2&&ab+bc-ac<.03*ac)lines++;}
assert.equal(lines,0,'lantern posts in an evenly spaced line');
// Quest points another solid already covers (a frontier tree sits on sky-visit-b) are that solid's business.
const townKeys=new Set(solids.map(key)),otherBlocked=Object.entries(quests.FRONTIER_POINTS[6]).filter(([,[x,z]])=>w6.shapes.some(s=>!townKeys.has(key(s))&&inside(s,x,z,.6))).map(([id])=>id);
console.log('PASS layout',{otherBlocked,townSolids:solids.length,w5:w5.shapes.length,w6:w6.shapes.length,lanterns:L.length,banners:town.skyTownPlan().banners.length,festoons:town.SKY_FESTOONS.length});

// --- Browser.
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
const VIEWS={arrivalF:[-3,68,-.75,.28,20],village:[0,55,.5,.5,40],street:[0,45,.3,.12,9]};
try{
 for(const quality of ['high','low']){
  const p=await browser.newPage({viewport:{width:1600,height:900}});
  p.on('pageerror',e=>errors.push(`${quality}: ${e.message}`));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(`${quality}: ${m.text().slice(0,300)}`);});
  p.setDefaultTimeout(120000);await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
  await p.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Sky town'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',q);},quality);
  await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
  await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
  await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(6);});
  await p.waitForFunction(()=>window.app.current.game.world2.chapter===6&&!document.querySelector('.loading'),null,{timeout:180000});
  await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='qa-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-main{visibility:visible!important}';document.head.appendChild(s);
   const g=window.app.current.game;g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
   const away=()=>{for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);let i=0;for(const u of g.units)if(u!==g.player.unit){i++;u.teleport?.(g.world,210,200+i*3,0);}requestAnimationFrame(away);};away();});
  const r=await p.evaluate(points=>{
   const g=window.app.current.game,island=g.world2.sixth,t=island.root.getObjectByName('skybloom-town'),col=island.collision;
   const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}},blocked=[];
   for(const [id,x,z] of points){g.world.resolveCollision(x,z,.6,out);if(Math.hypot(out.x-x,out.y-z)>1e-3)blocked.push(id);}
   return {meshes:t?t.children.map(c=>c.name):[],stats:t?.userData??null,shapes:col.shapes.length,blocked};
  },Object.entries(quests.FRONTIER_POINTS[6]).filter(([id])=>!otherBlocked.includes(id)).map(([id,[x,z]])=>[id,x,z]));
  console.log(quality,JSON.stringify({meshes:r.meshes.length,shapes:r.shapes,blocked:r.blocked}));
  assert.equal(r.shapes,w6.shapes.length,'client collision is layoutFrontier(6)');
  assert.deepEqual(r.blocked,[],'quest points inside solids');
  for(const want of ['skybloom-town-stone','skybloom-town-timber','skybloom-town-roof','skybloom-town-metal','skybloom-town-glow','skybloom-town-cloth','skybloom-harbour'])assert.ok(r.meshes.includes(want),`missing ${want}`);
  const values={};
  for(const [name,[x,z,yaw,pitch,dist]] of Object.entries(VIEWS)){
   await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);
   await p.waitForTimeout(3000);
   // A class mask from the same camera (flat colours, no fog or post), then the real frame: grey medians per class.
   const mask=await p.evaluate(()=>{
    const g=window.app.current.game,island=g.world2.sixth,cam=g.follow.camera,renderer=window.app.engine.renderer;
    let scene=island.root;while(scene.parent)scene=scene.parent;
    const town=island.root.getObjectByName('skybloom-town'),meadow=island.root.getObjectByName('skybloom-meadow');
    const crab=g.player.unit.rig.root;
    const C={roof:[255,0,0],wall:[0,255,0],grass:[0,0,255],path:[255,255,0],crab:[255,0,255],none:[0,0,0]};
    const mats={};
    const Basic=town.children.find(m=>m.name.endsWith('-glow')).material.constructor;
    for(const [k,[r,gg,b]] of Object.entries(C)){mats[k]=new Basic({fog:false});mats[k].color.setRGB(r/255,gg/255,b/255,'srgb-linear');}
    const under=(o,root)=>{for(let q=o;q;q=q.parent)if(q===root)return true;return false;};
    const kindOf=o=>{if(crab&&under(o,crab))return 'crab';if(o.parent===town||o.parent?.parent===town&&o.parent?.name?.startsWith('skybloom-town-')){return o.name.endsWith('-roof')?'roof':o.name.endsWith('-stone')?'wall':'none';}
     if(o.name==='skybloom-ground'||meadow&&under(o,meadow))return 'grass';if(o.name==='skybloom-paving-surface'||/paving/.test(o.name))return 'path';return 'none';};
    const saved=[];scene.traverse(o=>{if(!o.isMesh&&!o.isPoints&&!o.isLine&&!o.isSprite)return;saved.push([o,o.material]);o.material=mats[o.isMesh?kindOf(o):'none'];});
    const bg=scene.background,fog=scene.fog,env=scene.environment;scene.background=null;scene.fog=null;scene.environment=null;
    const W=800,H=450,RT=renderer.getRenderTarget(),Target=window.app.engine.composer.inputBuffer.constructor,target=new Target(W,H);
    const aspect=cam.aspect;cam.aspect=1600/900;cam.updateProjectionMatrix();
    const tm=renderer.toneMapping,oc=renderer.outputColorSpace;renderer.toneMapping=0;
    renderer.setRenderTarget(target);renderer.setClearColor(0x000000,1);renderer.clear();renderer.render(scene,cam);
    const buf=new Uint8Array(W*H*4);renderer.readRenderTargetPixels(target,0,0,W,H,buf);renderer.setRenderTarget(RT);renderer.toneMapping=tm;renderer.outputColorSpace=oc;
    cam.aspect=aspect;cam.updateProjectionMatrix();target.dispose();
    for(const [o,m] of saved)o.material=m;scene.background=bg;scene.fog=fog;scene.environment=env;
    const names=Object.keys(C),cls=new Uint8Array(W*H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=((H-1-y)*W+x)*4;let best=5,bd=1e9;for(let k=0;k<names.length;k++){const c=C[names[k]],d=Math.abs(buf[i]-c[0])+Math.abs(buf[i+1]-c[1])+Math.abs(buf[i+2]-c[2]);if(d<bd){bd=d;best=k;}}cls[y*W+x]=bd<60?best:5;}
    return {W,H,names,cls:Array.from(cls)};
   });
   await p.waitForTimeout(400);
   const shot=(await p.screenshot()).toString('base64');
   const v=await p.evaluate(async([shot,mask])=>{
    const img=new Image();img.src='data:image/png;base64,'+shot;await img.decode();
    const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const cx=cv.getContext('2d');cx.drawImage(img,0,0);const px=cx.getImageData(0,0,cv.width,cv.height).data;
    const {W,H,names,cls}=mask,sx=cv.width/W,sy=cv.height/H,g={};for(const n of names)g[n]=[];
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const k=cls[y*W+x];if(cls[y*W+x-1]!==k||cls[y*W+x+1]!==k||cls[(y-1)*W+x]!==k||cls[(y+1)*W+x]!==k)continue;
     const i=(Math.floor((y+.5)*sy)*cv.width+Math.floor((x+.5)*sx))*4;g[names[k]].push(.2126*px[i]+.7152*px[i+1]+.0722*px[i+2]);}
    const out={};for(const n of names){if(n==='none')continue;const a=g[n].sort((p,q)=>p-q);out[n]=a.length<20?null:{n:a.length,p50:+a[a.length>>1].toFixed(1),p25:+a[Math.floor(a.length*.25)].toFixed(1),p75:+a[Math.floor(a.length*.75)].toFixed(1)};}
    return out;
   },[shot,mask]);
   values[name]=v;console.log(quality,name,JSON.stringify(v));
   if(quality==='high'&&name==='arrivalF'){
    // The mooring mast's airship is in the arrival frame (its envelope's centre projects inside the picture).
    const seen=await p.evaluate(()=>{const g=window.app.current.game,island=g.world2.sixth,cam=g.follow.camera;let n=0,inside=0;island.root.getObjectByName('skybloom-town').traverse(o=>{if(o.name==='skybloom-airship-propeller'){n++;const v=o.getWorldPosition(new (o.position.constructor)()).project(cam);if(Math.abs(v.x)<.97&&Math.abs(v.y)<.97&&v.z<1)inside++;}});return {n,inside};});
    assert.equal(seen.n,2,'two airships');assert.ok(seen.inside>=1,'no airship in the arrival frame');
   }
  }
  // Greyscale separation (style-w6 values): roofs a step under the grass, walls and path above it, the crab apart.
  for(const name of ['arrivalF','village','street']){
   const v=values[name],m=k=>v[k]?.p50;
   assert.ok(m('roof')!=null&&m('grass')!=null&&m('wall')!=null&&m('path')!=null,`${quality} ${name}: classes missing ${JSON.stringify(v)}`);
   assert.ok(m('roof')<=m('grass')-25,`${quality} ${name}: roof ${m('roof')} not a step under grass ${m('grass')}`);
   // The band applies where roofs are seen from above; the street's low camera sees the far glaze at a grazing angle.
   if(name!=='street')assert.ok(m('roof')>=45&&m('roof')<=90,`${quality} ${name}: roof grey ${m('roof')}`);
   const ks=['roof','wall','grass','path','crab'].filter(k=>m(k)!=null);
   // Walls against grass get 5: the sun stands in the north-west (sky-air), so the south and east faces these views see
   // are in shade; the albedos stay at the style sheet's cream. Every other pair needs 8.
   for(let a=0;a<ks.length;a++)for(let b=a+1;b<ks.length;b++){const need=[ks[a],ks[b]].sort().join()==='grass,wall'?5:8;assert.ok(Math.abs(m(ks[a])-m(ks[b]))>=need,`${quality} ${name}: ${ks[a]} ${m(ks[a])} and ${ks[b]} ${m(ks[b])} too close`);}
  }
  await p.close();
 }
 assert.deepEqual(errors,[]);
 console.log('qa-sky-town: PASS');
}finally{await browser.close();}
