// Frostlight rendering polish: the far sun shadow (baked once, read past the live box), the cobbles' distance
// filtering on the far road, spindrift off the crests (one draw, never over the arena ice), wind-blown snowfall,
// and Frostlight's own colour grade, which no other world carries. High and low quality, zero page or shader
// errors. Writes tmp/qa/snow-polish-*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Polish'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;});return p;
}
async function go(p,chapter){
 await p.evaluate(c=>window.app.current.game.world2.go(c),chapter);
 await p.waitForFunction(c=>window.app.current.game.world2.chapter===c&&!document.querySelector('.loading'),chapter,{timeout:120000});await p.waitForTimeout(2500);
 await p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);});
}
// The post chain the engine is drawing with: effect names and the bloom threshold.
const chain=p=>p.evaluate(()=>{const e=window.app.engine,fx=e.composer.passes.flatMap(s=>s.effects??[]);const bloom=fx.find(f=>f.name==='BloomEffect');
 return {effects:fx.map(f=>f.name),threshold:+bloom.luminanceMaterial.threshold.toFixed(3),intensity:+bloom.intensity.toFixed(3),grade:!!e.viewOptions.grade};});
const place=(p,x,z)=>p.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);
/**
 * Draw the scene raw (no post) from fixed cameras, once per [camera, setup] pair, all in one task so nothing
 * animates in between; return each frame's mean luminance and per-pixel luminance (every 4th pixel).
 */
const raw=(p,shots)=>p.evaluate(shots=>{const g=window.app.current.game,r=window.app.engine.renderer,gl=r.getContext(),f=g.world2.fourth,c=g.camera;
 const s=r.getDrawingBufferSize(c.position.clone()),w=s.x,h=s.y,a=new Uint8Array(w*h*4);
 return shots.map(([cam,setup])=>{
  // eslint-disable-next-line no-new-func
  new Function('f','g',setup)(f,g);
  c.position.set(...cam.p);c.lookAt(...cam.t);c.updateMatrixWorld();
  r.setRenderTarget(null);r.render(g.scene,c);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);
  const lum=[];let sum=0;for(let i=0;i<w*h;i+=4){const v=a[i*4]*.2126+a[i*4+1]*.7152+a[i*4+2]*.0722;lum.push(v);sum+=v;}
  return {w,h,mean:sum/lum.length,lum};
 });},shots);
const diff=(a,b,mask=()=>true)=>{let n=0,changed=0,abs=0;for(let i=0;i<a.lum.length;i++){if(!mask(i))continue;n++;const d=Math.abs(a.lum[i]-b.lum[i]);abs+=d;if(d>3)changed++;}return {changed:changed/Math.max(n,1),mean:abs/Math.max(n,1)};};
try{
 const p=await load('high');
 // Every other world keeps the shared game view: same effects, same bloom, no grade.
 const w1=await chain(p);
 assert.ok(!w1.effects.includes('GradeEffect')&&!w1.grade&&w1.threshold===.9&&w1.intensity===.9,`World I keeps the shared view: ${JSON.stringify(w1)}`);
 await p.screenshot({path:'tmp/qa/snow-polish-w1.png'});
 await go(p,4);
 const w4=await chain(p);
 assert.ok(w4.effects.includes('GradeEffect')&&w4.grade&&w4.threshold>1&&w4.intensity>1,`Frostlight carries its own grade and lamp-keyed bloom: ${JSON.stringify(w4)}`);
 assert.deepEqual(w4.effects.filter(n=>n!=='GradeEffect'),w1.effects,'the grade is the only effect Frostlight adds');
 console.log('PASS Frostlight has its own grade',JSON.stringify(w4));

 // Far shadow: baked once, island-wide, on the snow and on both floors.
 const far=await p.evaluate(()=>{const f=window.app.current.game.world2.fourth,u=f.farShadow.uniforms,mats=[];
  f.root.traverse(o=>{if(o.isMesh&&['frostlight-paving-surface','frostlight-arena-ice','snowdrift-terrain'].includes(o.name))mats.push([o.name,o.material.customProgramCacheKey()]);});
  return {baked:f.farShadow.baked,on:u.snowFarInfo.value.x,size:u.snowFarMap.value?.image?.width??0,mats};});
 assert.ok(far.baked&&far.on===1&&far.size===2048,`far sun map baked at 2048: ${JSON.stringify(far)}`);
 assert.ok(far.mats.filter(([n,k])=>n!=='snowdrift-terrain'&&k.includes('frostlight-far-shadow')).length===2,`paving and arena ice read the far map: ${JSON.stringify(far.mats)}`);
 // From the eastern field, look across the sun's bearing at the village and the western woods, well past the
 // live box (70 m either side of the player across the sun): the far map shades them, while the snow round the
 // player, inside the box, is unchanged by it.
 await place(p,60,-40);await p.waitForTimeout(1500);
 const west={p:[20,60,-10],t:[-60,0,60]},nearCam={p:[68,12,-28],t:[60,8,-42]};
 // Spindrift reads the far map too (its streamers darken in shade), so it stays out of this comparison.
 const off='f.spindrift.mesh.visible=false;f.farShadow.uniforms.snowFarInfo.value.x=0;',on='f.farShadow.uniforms.snowFarInfo.value.x=1;';
 const [wOff,wOn,nOff,nOn]=await raw(p,[[west,off],[west,on],[nearCam,off],[nearCam,on]]);
 const dw=diff(wOff,wOn),dn=diff(nOff,nOn);
 assert.ok(dw.changed>.05&&wOn.mean<wOff.mean-2,`far woods gain the sun's shadow: ${JSON.stringify({dw,off:wOff.mean.toFixed(1),on:wOn.mean.toFixed(1)})}`);
 assert.ok(dn.changed<.01,`inside the live box the far map changes nothing: ${JSON.stringify(dn)}`);
 console.log('PASS far shadow past the live box',JSON.stringify({far:dw,near:dn}));
 await p.evaluate(()=>{const f=window.app.current.game.world2.fourth;f.farShadow.uniforms.snowFarInfo.value.x=1;f.spindrift.mesh.visible=true;});
 // The same view with the full post chain.
 await p.evaluate(()=>{const g=window.app.current.game;g.follow.__orig??=g.follow.update;g.follow.update=function(){this.camera.position.set(20,60,-10);this.camera.lookAt(-60,0,60);};});
 await p.waitForTimeout(1500);await p.screenshot({path:'tmp/qa/snow-polish-far-shadow.png'});

 // The far road, from the landmark view, 14 to 30 m ahead: seven frames a half centimetre apart down the road, as
 // a walk would move the camera. Filtered cobbles change smoothly (a small second difference per pixel); aliased
 // ones snap from stone to stone. The frame must also keep the spread of stones and joints, not settle to a smear.
 await place(p,0,-45);await p.waitForTimeout(1200);
 const walk=await p.evaluate(()=>{const g=window.app.current.game,r=window.app.engine.renderer,c=g.camera,V=c.position.constructor,f=g.world2.fourth;
  const RT=window.app.engine.composer.inputBuffer.constructor,y=g.world.heightAt(0,-45),s=r.getDrawingBufferSize(new V()),w=s.x,h=s.y;
  f.spindrift.mesh.visible=false;
  c.position.set(0,y+8.9,-20.2);c.lookAt(0,y+1.2,-45);c.updateMatrixWorld();
  const pts=[[-2,-34],[2,-34],[-2,-50],[2,-50]].map(([x,z])=>{const v=new V(x,g.world.heightAt(x,z),z).project(c);return [(v.x*.5+.5)*w,(v.y*.5+.5)*h];});
  const x0=Math.max(0,Math.ceil(Math.min(...pts.map(q=>q[0])))+6),x1=Math.min(w,Math.floor(Math.max(...pts.map(q=>q[0])))-6);
  const y0=Math.max(0,Math.ceil(Math.min(...pts.map(q=>q[1])))),y1=Math.min(h,Math.floor(Math.max(...pts.map(q=>q[1]))));
  const bw=x1-x0,bh=y1-y0,one=new RT(w,h),frames=[],L=(a,i)=>a[i]*.2126+a[i+1]*.7152+a[i+2]*.0722;
  for(let k=0;k<7;k++){const dz=-k*.005,a=new Uint8Array(bw*bh*4);c.position.set(0,y+8.9,-20.2+dz);c.lookAt(0,y+1.2,-45+dz);c.updateMatrixWorld();r.setRenderTarget(one);r.render(g.scene,c);r.readRenderTargetPixels(one,x0,y0,bw,bh,a);frames.push(a);}
  r.setRenderTarget(null);one.dispose();f.spindrift.mesh.visible=true;
  let flick=0,n=0,sum=0,sum2=0;
  for(let k=1;k<6;k++)for(let i=0;i<bw*bh;i++){const q=i*4,l=L(frames[k],q);flick+=Math.abs(L(frames[k+1],q)-2*l+L(frames[k-1],q));sum+=l;sum2+=l*l;n++;}
  return {pixels:bw*bh,flicker:flick/n,mean:sum/n,sd:Math.sqrt(sum2/n-(sum/n)**2)};});
 assert.ok(walk.pixels>5000,`road box covers the far cobbles: ${JSON.stringify(walk)}`);
 assert.ok(walk.flicker<1.5,`far cobbles hold still as the camera walks (mean second difference under 1.5 levels): ${JSON.stringify(walk)}`);
 assert.ok(walk.sd>walk.mean*.25,`far road still reads as stones and joints, not a smear: ${JSON.stringify(walk)}`);
 console.log('PASS far road filtered, still cobbled',JSON.stringify(walk));
 await p.waitForTimeout(800);await p.screenshot({path:'tmp/qa/snow-polish-road.png'});

 // Spindrift: one draw of ribbons, no primitives, never on the arena ice; it shows over the western crest.
 const sp=await p.evaluate(()=>{const s=window.app.current.game.world2.fourth.spindrift,m=s.mesh,geo=m.geometry;
  return {draws:m.isMesh&&!Array.isArray(m.material),type:geo.type,attrs:Object.keys(geo.attributes),drawn:s.mesh.userData.drawn,count:geo.drawRange.count,transparent:m.material.transparent,depthWrite:m.material.depthWrite,cast:m.castShadow};});
 assert.ok(sp.draws&&sp.type==='BufferGeometry'&&sp.attrs.includes('aDrift')&&sp.transparent&&!sp.depthWrite&&!sp.cast&&sp.drawn===420,`one transparent draw of 420 ribbons: ${JSON.stringify(sp)}`);
 await place(p,0,-58);await p.waitForTimeout(1500);
 const yA=await p.evaluate(()=>window.app.current.game.world.heightAt(0,-78));
 const top={p:[0,yA+40,-77],t:[0,yA,-78]};
 const hide='f.spindrift.mesh.visible=false;f.spindrift.mesh.material.uniforms.sdStrength.value=8;',show='f.spindrift.mesh.visible=true;';
 const [aOff,aOn]=await raw(p,[[top,hide],[top,show]]);
 const da=diff(aOff,aOn,i=>{const k=i*4,x=k%aOff.w,yy=Math.floor(k/aOff.w);return Math.hypot(x-aOff.w/2,yy-aOff.h/2)<aOff.h*.32;});
 assert.ok(da.changed<.002,`no spindrift over the arena ice, even at 8x strength: ${JSON.stringify(da)}`);
 await place(p,-30,-12);await p.waitForTimeout(1500);
 const yC=await p.evaluate(()=>window.app.current.game.world.heightAt(-34,-26));
 const crest={p:[-31,yC+3.5,-13],t:[-34,yC+.5,-26]};
 const [cOff,cOn]=await raw(p,[[crest,hide],[crest,show]]);
 const dc=diff(cOff,cOn);
 assert.ok(dc.changed>.002,`spindrift streams over the crest: ${JSON.stringify(dc)}`);
 await p.evaluate(()=>{window.app.current.game.world2.fourth.spindrift.mesh.material.uniforms.sdStrength.value=2.2;});
 console.log('PASS spindrift on the crests, none on the ice',JSON.stringify({arena:da,crest:dc}));
 await p.evaluate(([c])=>{const g=window.app.current.game;g.follow.update=function(){this.camera.position.set(...c.p);this.camera.lookAt(...c.t);};},[crest]);
 await p.waitForTimeout(1200);await p.screenshot({path:'tmp/qa/snow-polish-spindrift.png'});
 await p.evaluate(()=>{const g=window.app.current.game;g.follow.update=g.follow.__orig;});
 // Snowfall rides the wind and is anchored in the world.
 const fall=await p.evaluate(()=>{const g=window.app.current.game,f=g.world2.fourth;let m=null;f.root.traverse(o=>{if(o.name==='gpu-snowfall')m=o;});return {wind:m?.material.uniforms.wind?.value.toArray(),anchored:/origin\.xz\+mod/.test(m?.material.vertexShader??'')};});
 assert.ok(fall.wind&&fall.wind[0]>.9&&fall.anchored,`snowfall drifts with SNOW_WIND, wrapped round the player: ${JSON.stringify(fall)}`);
 console.log('PASS snowfall rides the wind',JSON.stringify(fall));

 // Back to World III: the shared view again.
 await go(p,3);
 const w3=await chain(p);
 assert.deepEqual(w3.effects,w1.effects,'World III draws with the shared effect chain');
 assert.ok(!w3.grade&&w3.threshold===.9,`World III keeps the shared bloom: ${JSON.stringify(w3)}`);
 await p.screenshot({path:'tmp/qa/snow-polish-w3.png'});
 console.log('PASS other worlds keep the shared view',JSON.stringify(w3));
 await p.close();

 const low=await load('low');
 await go(low,4);
 const lw=await low.evaluate(()=>{const f=window.app.current.game.world2.fourth;return {baked:f.farShadow.baked,size:f.farShadow.uniforms.snowFarMap.value?.image?.width??0,drawn:f.spindrift.mesh.userData.drawn,count:f.spindrift.mesh.geometry.drawRange.count};});
 assert.ok(lw.baked&&lw.size===1024&&lw.drawn===210,`low bakes a coarser far map and draws half the spindrift: ${JSON.stringify(lw)}`);
 const lc=await chain(low);
 assert.ok(lc.effects.includes('GradeEffect'),`low keeps the grade: ${JSON.stringify(lc)}`);
 await place(low,0,-45);await low.waitForTimeout(2000);await low.screenshot({path:'tmp/qa/snow-polish-low.png'});
 console.log('PASS low quality',JSON.stringify(lw));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
