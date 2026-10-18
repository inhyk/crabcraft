// Frostlight ground: the snowed-in cobble streets (frostPaving.ts) and the carved ice arena floor (frostArena.ts)
// replace the square tile paving and the flat blue disc with its torus rings. Checks the structure, that covers()
// still means the old layout, that the paving hugs the ground, that the arena floor and its height are unchanged,
// that every program compiles at both qualities, that the low sun no longer blows the ice out, and zero errors.
// Writes tmp/qa/snow-ground-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){
 const p=await browser.newPage({viewport:{width:1280,height:800}});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});
 p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Ground QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(u,pr){const url=new URL(String(u));if(url.pathname==='/multiplayer'){url.host=location.host;url.protocol='ws:';}super(url.href,pr);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:120000});
 // Only the player in frame, HUD hidden.
 await p.evaluate(()=>{const g=window.app.current.game,c=window.app.engine.renderer.domElement;c.id='qa-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-main{visibility:visible!important}';document.head.appendChild(s);
  for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);
  const hide=()=>{for(const u of g.units)if(u!==g.player.unit&&u.rig?.root){u.rig.root.visible=false;u.rig.root.scale.setScalar(1e-4);}requestAnimationFrame(hide);};hide();});
 await p.waitForTimeout(2500);return p;
}
// The gameplay camera, 7.5 m behind the crab.
async function play(p,x,z,face,camYaw,pitch=.3){
 await p.evaluate(([x,z,face,camYaw,pitch])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,face);g.follow.yaw=camYaw;g.follow.pitch=pitch;g.follow.distance=7.5;g.follow.cut();},[x,z,face,camYaw,pitch]);
 await p.waitForTimeout(1500);
}
// A fixed camera (eye and target, metres above the ground at each).
async function fixed(p,[cx,cyo,cz],[tx,tz]){
 await p.evaluate(([cx,cyo,cz,tx,tz])=>{const g=window.app.current.game,H=(x,z)=>g.world.heightAt(x,z);
  g.player.unit.teleport(g.world,cx-2,cz-3,0);
  if(!g.follow.__qa){g.follow.__qa=g.follow.update;g.follow.update=function(){const s=window.__qaCam;if(!s)return this.__qa.apply(this,arguments);this.camera.position.set(s[0],s[1],s[2]);this.camera.lookAt(s[3],s[4],s[5]);};}
  window.__qaCam=[cx,H(cx,cz)+cyo,cz,tx,H(tx,tz),tz];},[cx,cyo,cz,tx,tz]);
 await p.waitForTimeout(1500);
}
// Share of blown-out pixels (every channel above 240) in the lower part of a screenshot, where the floor is.
async function blown(p,buf,top=.45){
 return p.evaluate(async([b64,top])=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
  const y0=Math.floor(img.height*top),d=x.getImageData(0,y0,img.width,img.height-y0).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>240&&d[i+1]>240&&d[i+2]>240)n++;return n/(d.length/4);},[buf.toString('base64'),top]);
}
const SUN=Math.atan2(-.65,-.72);
try{
 const p=await load('high');
 const r=await p.evaluate(()=>{
  const g=window.app.current.game,w=g.world2.fourth,root=w.root,H=(x,z)=>g.world.heightAt(x,z);
  const pav=root.getObjectByName('world4-snow-paving'),surf=root.getObjectByName('frostlight-paving-surface');
  const ice=root.getObjectByName('frostlight-arena-ice'),rim=root.getObjectByName('frostlight-arena-rim');
  // Nothing of the old placeholder ground may remain: tile paving, a wide cylinder floor, torus rings lying on the
  // arena floor (the prison's rings stand on it and stay).
  const old=[];let torus=0,discs=0,pavMeshes=0;
  root.updateMatrixWorld(true);
  root.traverse(o=>{
   if(o.name==='weathered-bevelled-paving'||o.name==='world4-flagstone-paths')old.push(o.name);
   if(!o.isMesh)return;let prison=false;for(let a=o;a;a=a.parent)if(a.name==='mira-ice-prison')prison=true;
   const e=o.matrixWorld.elements,x=e[12],y=e[13],z=e[14];
   if(!prison&&o.geometry.type==='TorusGeometry'&&Math.hypot(x,z+78)<23&&Math.abs(y-19.1)<.5)torus++;
   if(o.geometry.type==='CylinderGeometry'&&o.geometry.parameters.radiusTop>=15)discs++;
  });
  pav.traverse(o=>{if(o.isMesh)pavMeshes++;});
  const covers=pav.userData.covers;
  const on=[[0,93.9],[0,60],[4.25,30],[0,-52.9],[-21.9,38],[21.9,56],[10,74],[-2.2,75.9]].map(([x,z])=>covers(x,z));
  const off=[[0,94.2],[0,-53.2],[4.4,30],[-22.2,56],[10,76.4],[10,71.6],[12,0]].map(([x,z])=>covers(x,z));
  // The surface hugs the rendered ground: never under it, never floating.
  const pos=surf.geometry.attributes.position;let minLift=1e9,maxLift=-1e9;
  for(let i=0;i<pos.count;i++){const l=pos.getY(i)-H(pos.getX(i),pos.getZ(i));minLift=Math.min(minLift,l);maxLift=Math.max(maxLift,l);}
  // Gameplay height inside the arena is untouched.
  let arenaDev=0;for(let rr=0;rr<=21.5;rr+=3.5)for(let i=0;i<16;i++){const a=i/16*Math.PI*2;arenaDev=Math.max(arenaDev,Math.abs(H(Math.sin(a)*rr,-78+Math.cos(a)*rr)-19));}
  return {old,torus,discs,pavMeshes,on,off,minLift,maxLift,stats:pav.userData.stats,arenaDev,
   ice:ice&&{type:ice.geometry.type,radius:ice.geometry.parameters.radius,pos:ice.position.toArray(),shadow:ice.receiveShadow},rim:rim&&{blocks:root.getObjectByName("frostlight-arena-floor").userData.stats.rimBlocks,gate:root.getObjectByName("frostlight-arena-floor").userData.stats.gateBlocks,cast:rim.castShadow},
   floor:root.getObjectByName('frostlight-arena-floor').userData.stats,
   materials:[surf.material.name,ice?.material.name,rim?.material.name]};
 });
 assert.deepEqual(r.old,[],'old tile paving is gone');assert.equal(r.torus,0,'no torus rings left on the arena');assert.equal(r.discs,0,'no flat cylinder arena floor');
 assert.equal(r.pavMeshes,1,'the street network is one surface mesh');
 assert.ok(r.on.every(Boolean),`covers() holds on the paths: ${JSON.stringify(r.on)}`);assert.ok(!r.off.some(Boolean),`covers() is false off them: ${JSON.stringify(r.off)}`);
 assert.equal(r.stats.segments,5);assert.equal(r.stats.freeEnds,8);assert.equal(r.stats.plazas,3);
 assert.ok(r.minLift>=.029&&r.maxLift<.3,`paving sits on the ground: ${r.minLift} .. ${r.maxLift}`);
 assert.ok(r.arenaDev<1e-9,`arena floor height unchanged: ${r.arenaDev}`);
 assert.equal(r.ice.type,'CircleGeometry');assert.ok(Math.abs(r.ice.radius-22.05)<1e-6);assert.deepEqual(r.ice.pos.map(v=>+v.toFixed(3)),[0,19.035,-78]);assert.equal(r.ice.shadow,true);
 assert.equal(r.rim.blocks,38);assert.equal(r.rim.gate,2);
 assert.ok(r.floor.cracks>60&&r.floor.fine>0&&r.floor.dropped<r.floor.gridCells*.01,`the ice holds a crack web, baked for lookup: ${JSON.stringify(r.floor)}`);assert.equal(r.rim.cast,true);
 assert.deepEqual(r.materials,['frostlight-snow-paving','frostlight-arena-ice','frostlight-arena-rim']);
 console.log('PASS ground structure: one cobble surface on the old layout, ice disc and carved rim, no placeholder left',JSON.stringify({stats:r.stats,lift:[+r.minLift.toFixed(3),+r.maxLift.toFixed(3)],floor:r.floor}));
 await play(p,0,50,Math.PI,0);await p.screenshot({path:'tmp/qa/snow-ground-road.png'});
 await play(p,0,40,SUN+Math.PI,SUN);await p.screenshot({path:'tmp/qa/snow-ground-road-sun.png'});
 await play(p,0,-66,Math.PI,0);await p.screenshot({path:'tmp/qa/snow-ground-arena.png'});
 await play(p,-4,-90,SUN+Math.PI,SUN);await p.screenshot({path:'tmp/qa/snow-ground-arena-sun.png'});
 // Low across the ice into the sun, where the old glossy disc blew 4.5% of the floor out to white.
 await fixed(p,[-6,2.2,-94],[8,-66]);const sunShot=await p.screenshot({path:'tmp/qa/snow-ground-arena-glare.png'});
 const glare=await blown(p,sunShot);await p.evaluate(()=>{window.__qaCam=null;});
 assert.ok(glare<.005,`ice into the low sun keeps detail: ${(glare*100).toFixed(2)}% blown`);
 console.log('PASS the arena into the sun is not blown out',JSON.stringify({blownPercent:+(glare*100).toFixed(3)}));
 const compiled=await p.evaluate(()=>{const g=window.app.current.game,ren=window.app.engine.renderer,root=g.world2.fourth.root;
  return ['frostlight-paving-surface','frostlight-arena-ice','frostlight-arena-rim'].map(n=>!!ren.properties.get(root.getObjectByName(n).material).currentProgram);});
 assert.deepEqual(compiled,[true,true,true]);
 console.log('PASS high quality programs compiled');
 await p.close();
 const low=await load('low');
 await play(low,0,50,Math.PI,0);await low.screenshot({path:'tmp/qa/snow-ground-low-road.png'});
 await play(low,0,-66,Math.PI,0);await low.screenshot({path:'tmp/qa/snow-ground-low-arena.png'});
 const lr=await low.evaluate(()=>{const g=window.app.current.game,ren=window.app.engine.renderer,root=g.world2.fourth.root;
  return {quality:window.app.engine.quality,compiled:['frostlight-paving-surface','frostlight-arena-ice','frostlight-arena-rim'].map(n=>!!ren.properties.get(root.getObjectByName(n).material).currentProgram)};});
 assert.equal(lr.quality,'low');assert.deepEqual(lr.compiled,[true,true,true]);
 console.log('PASS low quality compiles and draws the ground',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
