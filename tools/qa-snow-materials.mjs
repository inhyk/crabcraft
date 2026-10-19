// Frostlight's open fields, materials and form (snowFields.ts, snowRocks.ts, snowScrub.ts): no kit rock, pebble,
// bush or fern is left in the fields, every boulder is a sculpted mesh standing solid where it was, the pond rims
// are snow with no dark block (sampled pixels round each pond), the colour accents are built (trail cloth, the
// woodcutter's lantern, lichen on the stone), the field view stays under its draw-call budget, low quality works,
// and nothing logs an error. Writes tmp/qa/snow-materials-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {bundle} from './collision-bake-lib.mjs';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
/** Draw calls per frame at drawstats.mjs's field view: the whole frame, and the fields' own dressing (with the forest batch). */
const FIELD_CALLS=205,FIELD_LANE=32;

const L=await import((await bundle('src/game/snowFieldsLayout.ts','qa-materials')).url);
const kitRock=/^(Rock|Pebble|RockPath|Bush|Fern|Grass|Plant|Mushroom|Flower)/;
const left=L.snowFieldPieces().filter(p=>kitRock.test(p.piece)).map(p=>p.piece);
assert.deepEqual(left,[],'no kit rock, pebble, bush, fern or grass card is placed in the fields');
const scrub=L.snowScrubItems();
assert.ok(scrub.filter(s=>s.kind==='cloth').length>=4,'cloth is tied to the miners\' trail posts');
console.log('PASS layout: no kit rock or scrub piece;',L.snowBoulders().length,'boulders,',L.snowPebbles().length,'pebbles,',scrub.length,'scrub items');

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Stone reader'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading')&&window.app.current.game.world2.fourth.fields,null,{timeout:120000});await p.waitForTimeout(2500);
 await p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);this.camera.position.set(...s.p);this.camera.lookAt(...s.t);};});
 return p;
}
// A fixed camera: target [x, z, lift], eye [x, lift, z]; the player (the clipmap's centre) stands just behind the eye.
async function view(p,[tx,tz,to],[cx,co,cz]){
 await p.evaluate(([tx,tz,to,cx,co,cz])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z),l=Math.hypot(tx-cx,tz-cz)||1;
  g.player.unit.teleport(g.world,cx-(tx-cx)/l*1.6,cz-(tz-cz)/l*1.6,0);window.__cam={p:[cx,h(cx,cz)+co,cz],t:[tx,h(tx,tz)+to,tz]};},[tx,tz,to,cx,co,cz]);
 await p.waitForTimeout(1600);
}
async function shot(p,name,t,c){await view(p,t,c);await p.screenshot({path:`tmp/qa/snow-materials-${name}.png`});}
/** Luminance (0..1) of the screenshot at world points, projected with the live camera. */
async function lumaAt(p,points){
 const proj=await p.evaluate(pts=>{const g=window.app.current.game,cam=g.camera,V=cam.position.constructor,c=window.app.engine.renderer.domElement.getBoundingClientRect();
  return pts.map(([x,y,z])=>{const v=new V(x,y,z).project(cam);return [(v.x*.5+.5)*c.width,(1-(v.y*.5+.5))*c.height,v.z];});},points);
 const png=(await p.screenshot()).toString('base64');
 return p.evaluate(async([png,proj])=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
  return proj.map(([u,v,z])=>{if(z>1||u<0||v<0||u>=c.width||v>=c.height)return null;const d=x.getImageData(Math.round(u),Math.round(v),1,1).data;return (.2126*d[0]+.7152*d[1]+.0722*d[2])/255;});},[png,proj]);
}
try{
 const p=await load('high');
 const r=await p.evaluate(async()=>{
  const g=window.app.current.game,w=g.world2.fourth,f=w.root.getObjectByName('frostlight-fields'),u=g.player.unit;
  const L=await import('/src/game/snowFieldsLayout.ts');
  // Kit materials of nature.glb's rocks must not appear anywhere in the fields.
  const mats=new Set();f.traverse(o=>{if(o.material)mats.add(o.material.name);});
  const rockMesh=f.getObjectByName('frostlight-field-boulders').children[0],pos=rockMesh.geometry.getAttribute('position');
  // Each boulder: a vertex of the merged mesh stands over its spot, well clear of the snow, and the collider pushes the player out.
  const boulders=L.snowBoulders().map(b=>{const y0=g.world.heightAt(b.x,b.z);let top=-1e9;for(let i=0;i<pos.count;i++){const dx=pos.getX(i)-b.x,dz=pos.getZ(i)-b.z;if(dx*dx+dz*dz<.09)top=Math.max(top,pos.getY(i));}
   // A step off the centre, where the push has a direction.
   const out=g.world.resolveCollision(b.x+.05,b.z,u.radius,{set(x,y){this.x=x;this.y=y;return this;}});
   return {rise:+((top-y0)/b.h).toFixed(2),push:+(Math.hypot(out.x-b.x,out.y-b.z)/b.r).toFixed(2)};});
  return {mats:[...mats],verts:pos.count,boulders,
   kit:f.getObjectByName('frostlight-field-kit').children.map(m=>m.material.name),
   scrub:f.userData.fields.scrub,lantern:!!f.getObjectByName('frostlight-field-lantern'),ponds:f.getObjectByName('frostlight-field-ponds')?.material.transparent};
 });
 assert.ok(!r.mats.some(n=>/^(Rocks|PathRocks)$/.test(n)),`no kit rock material in the fields: ${r.mats.join(',')}`);
 assert.ok(r.verts>60000,`the boulders are dense sculpted meshes: ${r.verts} vertices`);
 const low=r.boulders.filter(b=>b.rise<.35),loose=r.boulders.filter(b=>b.push<.6);
 assert.deepEqual(low,[],'every boulder stands over its spot');assert.deepEqual(loose,[],'every boulder is solid to the player');
 assert.ok(r.kit.every(n=>!/^(Leaves|Grass)/.test(n)),`no leaf or grass card material left: ${r.kit}`);
 assert.equal(r.lantern,true,'the woodcutter\'s lantern burns');assert.equal(r.ponds,true,'the ponds are one faded sheet');
 console.log('PASS boulders sculpted and solid where they were',JSON.stringify({boulders:r.boulders.length,minRise:Math.min(...r.boulders.map(b=>b.rise)),minPush:Math.min(...r.boulders.map(b=>b.push)),verts:r.verts,kit:r.kit,scrub:r.scrub}));

 // Pond rims: from above, the drift band round each sheet (its outer vertices) is snow, never a dark block, and the
 // ice inside reads darker. The page's HUD is hidden so only the world is sampled.
 await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='qa-main';const s=document.createElement('style');s.id='qa-hide';s.textContent='body *{visibility:hidden!important}#qa-main{visibility:visible!important}';document.head.appendChild(s);});
 for(const [i,pd] of L.SNOW_PONDS.entries()){
  await view(p,[pd.x,pd.z,0],[pd.x-4,11,pd.z+7]);
  await p.screenshot({path:`tmp/qa/snow-materials-pond-${i}.png`});
  const pts=await p.evaluate(pd=>{const m=window.app.current.game.world2.fourth.root.getObjectByName('frostlight-field-ponds'),pos=m.geometry.getAttribute('position'),ice=m.geometry.getAttribute('aIce'),rim=[],inner=[];
   for(let k=0;k<pos.count;k++){const x=pos.getX(k),z=pos.getZ(k);if(Math.hypot(x-pd.x,z-pd.z)>pd.r*2.2)continue;const sh=ice.getX(k),band=ice.getY(k);
    if(band>.62&&band<.8)rim.push([x,pos.getY(k)+.02,z]);else if(band===0&&sh<.55&&sh>.1)inner.push([x,pos.getY(k)+.02,z]);}
   const pick=(l,n)=>l.filter((_,k)=>k%Math.max(1,Math.floor(l.length/n))===0);return {rim:pick(rim,96),inner:pick(inner,24)};},pd);
  const l=await lumaAt(p,[...pts.rim,...pts.inner]),rim=l.slice(0,pts.rim.length).filter(v=>v!==null),ice=l.slice(pts.rim.length).filter(v=>v!==null);
  const dark=rim.filter(v=>v<.3).length,rimMin=Math.min(...rim),iceMean=ice.reduce((a,b)=>a+b,0)/ice.length,rimMean=rim.reduce((a,b)=>a+b,0)/rim.length;
  assert.ok(rim.length>=60&&ice.length>=10,`pond ${i} in view: ${rim.length} rim, ${ice.length} ice samples`);
  assert.equal(dark,0,`pond ${i}: no dark block on the rim (min luma ${rimMin.toFixed(3)})`);
  assert.ok(iceMean<rimMean-.08,`pond ${i}: the ice reads darker than its snow rim (${iceMean.toFixed(3)} vs ${rimMean.toFixed(3)})`);
  console.log(`PASS pond ${i} rim is snow: ${rim.length} samples, min luma ${rimMin.toFixed(3)}, mean ${rimMean.toFixed(3)}; ice mean ${iceMean.toFixed(3)} over ${ice.length}`);
 }

 // Draw calls at drawstats.mjs's field view, and how many of them the fields' dressing takes.
 const calls=await p.evaluate(()=>new Promise(res=>{const g=window.app.current.game;window.__cam=null;g.follow.update=g.follow.__orig;
  g.player.unit.teleport(g.world,30,0,Math.PI/2);g.follow.yaw=-Math.PI/2+.4;g.follow.pitch=.3;g.follow.cut();
  setTimeout(()=>{const r=window.app.engine.renderer,orig=r.renderBufferDirect.bind(r),s=[];let lane=0,on=false;
   r.renderBufferDirect=function(cam,scene,geo,mat,obj,grp){if(on){let o=obj;while(o){if(o.name==='frostlight-fields'||o.name==='frostlight-snow-pines'){lane++;break;}o=o.parent;}}return orig(cam,scene,geo,mat,obj,grp);};
   const f=()=>requestAnimationFrame(()=>{s.push(r.info.render.calls);if(s.length===6)on=true;if(s.length===7){on=false;}if(s.length<12)f();else{r.renderBufferDirect=orig;s.sort((a,b)=>a-b);res({calls:s[6],lane});}});f();},2500);}));
 assert.ok(calls.calls<=FIELD_CALLS,`field view draws ${calls.calls} calls per frame (budget ${FIELD_CALLS})`);
 assert.ok(calls.lane<=FIELD_LANE,`the fields' dressing and pines take ${calls.lane} calls (budget ${FIELD_LANE})`);
 console.log('PASS field draw calls',JSON.stringify(calls));
 await p.evaluate(()=>{const g=window.app.current.game;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);this.camera.position.set(...s.p);this.camera.lookAt(...s.t);};});

 await shot(p,'wild-east',[45,-15,1.2],[39.5,3.2,-7.5]);
 await shot(p,'wild-west',[-45,-15,1.2],[-39.5,3.2,-7.5]);
 await shot(p,'rock-sun',[39.6,-14.6,.6],[42.4,1.4,-10.9]);
 await shot(p,'rock-shade',[39.6,-14.6,.6],[36.6,1.4,-18.6]);
 await shot(p,'pond',[54,-11,.2],[46.5,2.6,-5]);
 await shot(p,'trail',[23,-24,.5],[20.5,1.4,-20.5]);
 await shot(p,'woodcut',[-35,-28,.5],[-29.5,2.2,-21]);
 console.log('PASS wrote tmp/qa/snow-materials-{wild-east,wild-west,rock-sun,rock-shade,pond,pond-0,pond-1,trail,woodcut}.png');
 const progs=await p.evaluate(()=>window.app.engine.renderer.info.programs.map(q=>q.cacheKey));
 for(const k of ['frostlight-rock','frostlight-field-pond','frostlight-field-scrub','frostlight-field-bark'])assert.ok(progs.some(c=>c.includes(k)),`${k} shader compiled`);
 await p.close();

 const lo=await load('low');
 const lr=await lo.evaluate(()=>{const f=window.app.current.game.world2.fourth.root.getObjectByName('frostlight-fields'),s=f.getObjectByName('frostlight-field-scrub').geometry;
  return {boulders:f.getObjectByName('frostlight-field-boulders').visible,ponds:f.getObjectByName('frostlight-field-ponds').visible,scrub:s.drawRange.count<s.index.count&&s.drawRange.count>0,lantern:f.getObjectByName('frostlight-field-lantern').visible};});
 assert.deepEqual(lr,{boulders:true,ponds:true,scrub:true,lantern:true},'low quality keeps the stone, the ice and the lantern and thins the scrub');
 await shot(lo,'wild-east-low',[45,-15,1.2],[39.5,3.2,-7.5]);
 console.log('PASS low quality',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero page or shader errors');
}finally{await browser.close();}
