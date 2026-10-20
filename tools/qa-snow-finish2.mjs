// Frostlight finish, second pass: looking toward the low sun from the village hearth, the sun's halo is not cut by
// the far ranges (the luma step across their silhouette near the sun is no larger than away from it); the bloom
// knee that does it is on only in Frostlight and World I keeps its view options; the roof snow seen from above is
// modelled by the wind, not flat white. High and low quality, zero page or shader errors. Writes tmp/qa/snow-finish2-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
const W=1600,H=900;
async function load(quality){const p=await browser.newPage({viewport:{width:W,height:H}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Finish'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;});await p.waitForTimeout(1000);return p;
}
async function go(p,chapter){
 await p.evaluate(c=>window.app.current.game.world2.go(c),chapter);
 await p.waitForFunction(c=>window.app.current.game.world2.chapter===c&&!document.querySelector('.loading'),chapter,{timeout:120000});await p.waitForTimeout(3000);
}
/** What the engine's bloom does in the shown world: its options and whether the luminance pass has the knee. */
const bloom=p=>p.evaluate(()=>{const e=window.app.engine,f=e.bloom?.luminanceMaterial?.fragmentShader??'';return {view:JSON.parse(JSON.stringify(e.viewOptions)),knee:/mask=max\(s\*s/.test(f),stock:f.includes('mask=smoothstep(threshold,threshold+smoothing,l);')};});
/** Fixed free camera, HUD and snowfall hidden, crabs sent away. */
const freeCam=p=>p.evaluate(()=>{const g=window.app.current.game,c=window.app.engine.renderer.domElement;c.id='qa-finish2-canvas';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-finish2-canvas{visibility:visible!important}';document.head.appendChild(s);
 g.scene.getObjectByName('gpu-snowfall').visible=false;
 g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);this.camera.position.set(...s.p);this.camera.lookAt(...s.t);};});
const pixels=(p,b64)=>p.evaluate(async b64=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return Array.from(x.getImageData(0,0,img.width,img.height).data);},b64);
/** Shoot the frame, then again with `flat` objects drawn in one flat colour each (their own uniforms kept). */
async function shoot(p,name,flat){
 const a=(await p.screenshot({path:`tmp/qa/snow-finish2-${name}.png`})).toString('base64');
 await p.evaluate(flat=>{const s=window.app.current.game.scene;for(const [n,c] of flat){const o=s.getObjectByName(n),m=o.material.clone();
  if(m.isShaderMaterial){m.uniforms=o.material.uniforms;m.fragmentShader=`void main(){gl_FragColor=vec4(${c.join(',')},1.);}`;}else{m.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace(/#include <dithering_fragment>/,`gl_FragColor=vec4(${c.join(',')},1.);`);};m.customProgramCacheKey=()=>'qa-flat'+c.join();}
  o.userData.qaMaterial=o.material;o.material=m;}},flat);
 await p.waitForTimeout(400);
 const m=(await p.screenshot()).toString('base64');
 await p.evaluate(flat=>{const s=window.app.current.game.scene;for(const [n] of flat){const o=s.getObjectByName(n);o.material.dispose();o.material=o.userData.qaMaterial;}},flat);
 return {a:await pixels(p,a),m:await pixels(p,m)};
}
const magenta=(d,i)=>d[i]-d[i+1]>70&&d[i+2]-d[i+1]>70,green=(d,i)=>d[i+1]-d[i]>70&&d[i+1]-d[i+2]>70,luma=(d,i)=>.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
const stats=s=>{const q=[...s].sort((x,y)=>x-y);return {n:s.length,mean:+(s.reduce((x,y)=>x+y,0)/Math.max(1,s.length)).toFixed(2),p90:+(q[Math.floor(q.length*.9)]??0).toFixed(2)};};
/**
 * From the forge hearth, eye height, toward the sun (azimuth offset `az` degrees) and a little up: the luma step
 * across the ranges' silhouette, 5 px outside against 5 px inside, in columns where open sky meets a range. Near is
 * within 260 px of the sun's place on screen.
 */
async function halo(p,name,az){
 await p.evaluate(az=>{const g=window.app.current.game,s=g.world2.fourth.sky.sunDir,x=20.5,z=66,y=g.world.heightAt(x,z)+1.8,a=Math.atan2(s.x,s.z)+az*Math.PI/180,pr=5.5*Math.PI/180;
  for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,x,z,0);window.__cam={p:[x,y,z],t:[x+Math.sin(a)*Math.cos(pr)*100,y+Math.sin(pr)*100,z+Math.cos(a)*Math.cos(pr)*100]};},az);
 await p.waitForTimeout(1600);
 const {a,m}=await shoot(p,name,[['frostlight-far-ridges',[1,0,1]],['snowflow-sky',[0,1,0]]]);
 const sun=await p.evaluate(()=>{const g=window.app.current.game,v=g.camera.position.clone().addScaledVector(g.world2.fourth.sky.sunDir,1000).project(g.camera);return [(v.x*.5+.5)*innerWidth,(.5-v.y*.5)*innerHeight];});
 const near=[],far=[];
 for(let x=0;x<W;x++){
  let y0=-1;for(let y=9;y<H-9;y++){if(!magenta(m,(y*W+x)*4))continue;let ok=true;for(let k=2;k<=8&&ok;k++)ok=magenta(m,((y+k)*W+x)*4)&&green(m,((y-k)*W+x)*4);if(ok)y0=y;break;}
  if(y0<0)continue;
  let o=0,i=0;for(let k=3;k<=7;k++){o+=luma(a,((y0-k)*W+x)*4)/5;i+=luma(a,((y0+k)*W+x)*4)/5;}
  (Math.hypot(x-sun[0],y0-sun[1])<260?near:far).push(Math.abs(o-i));
 }
 return {sun:sun.map(Math.round),near:stats(near),far:stats(far)};
}
/** High over the village roofs: the roof snow's local relief (mean luma step to the next pixel) and its blown-out share. */
async function roofs(p,name,[tx,tz,yaw,pitch,dist]){
 await p.evaluate(([tx,tz,yaw,pitch,dist])=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,tx,tz,0);const ty=g.world.heightAt(tx,tz)+1.2,cp=Math.cos(pitch);
  window.__cam={p:[tx+Math.sin(yaw)*cp*dist,ty+Math.sin(pitch)*dist,tz+Math.cos(yaw)*cp*dist],t:[tx,ty,tz]};},[tx,tz,yaw,pitch,dist]);
 await p.waitForTimeout(1800);
 const {a,m}=await shoot(p,name,[['frostlight-roof-snow',[1,0,1]]]);
 let n=0,grad=0,white=0;
 for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=(y*W+x)*4;if(!magenta(m,i)||!magenta(m,i+4)||!magenta(m,i-4)||!magenta(m,i+W*4)||!magenta(m,i-W*4))continue;
  n++;grad+=(Math.abs(luma(a,i+4)-luma(a,i))+Math.abs(luma(a,i+W*4)-luma(a,i)))/2;if(a[i]>=250&&a[i+1]>=250&&a[i+2]>=250)white++;}
 return {pixels:n,grad:+(grad/Math.max(1,n)).toFixed(3),white:+(white/Math.max(1,n)).toFixed(4)};
}
// [name, orbit (target x, z, yaw, pitch, distance), least local step]: the rubric's village view and one high over
// the roofs. dev (06f9446): 0.55 and 0.77; the wind-carved snow 0.92 and 1.36.
const ROOF_VIEWS=[['roofs-village',[0,55,.5,.5,40],.75],['roofs-high',[-4,62,.4,.95,46],1.1]];
try{
 const p=await load('high');
 // World I: the stock view, the stock bloom pass.
 const w1=await bloom(p);
 assert.deepEqual(w1.view,{bloom:{intensity:.9,threshold:.9},vignette:{offset:.3,darkness:.5}},`World I keeps its view options: ${JSON.stringify(w1.view)}`);
 assert.ok(!w1.knee&&w1.stock,`World I's bloom has no knee: ${JSON.stringify(w1)}`);
 await go(p,4);
 const w4=await bloom(p);
 assert.ok(w4.view.bloom?.knee===true&&w4.knee&&!w4.stock,`Frostlight's bloom keys with a knee: ${JSON.stringify(w4)}`);
 await go(p,1);
 const back=await bloom(p);
 assert.ok(!back.knee&&back.stock&&!back.view.bloom.knee,`back in World I the knee is gone: ${JSON.stringify(back)}`);
 console.log('PASS the bloom knee is on only in Frostlight',JSON.stringify({w1:w1.view,w4:w4.view.bloom}));

 await go(p,4);await p.waitForFunction(()=>!!window.app.current.game.scene.getObjectByName('frostlight-roof-snow'),null,{timeout:120000});await p.waitForTimeout(3000);
 await freeCam(p);
 const halos={};for(const [name,az] of [['hearth-sun',0],['hearth-sun-right',20]])halos[name]=await halo(p,name,az);
 for(const [name,h] of Object.entries(halos)){
  assert.ok(h.near.n>=100,`the ranges meet open sky near the sun in ${name}: ${JSON.stringify(h)}`);
  // dev (06f9446): mean 18 to 21, p90 28 to 31; with the knee and the ranges' aureole: mean about 4, p90 about 7.
  assert.ok(h.near.mean<=7&&h.near.p90<=13,`the halo is not cut by the ranges in ${name} (step mean <= 7, p90 <= 13): ${JSON.stringify(h)}`);
 }
 console.log('PASS the sun\'s halo carries over the far ranges',JSON.stringify(halos));
 const roof={};for(const [name,v,least] of ROOF_VIEWS)roof[name]={...await roofs(p,name,v),least};
 for(const [name,r] of Object.entries(roof)){
  assert.ok(r.pixels>20000,`roof snow fills the view in ${name}: ${JSON.stringify(r)}`);
  assert.ok(r.grad>=r.least&&r.white<=.01,`roof snow is modelled, not flat white, in ${name} (local step >= ${r.least}, white <= 1%): ${JSON.stringify(r)}`);
 }
 console.log('PASS roof snow from above is modelled by the wind',JSON.stringify(roof));
 await p.close();

 const low=await load('low');
 await go(low,4);await low.waitForFunction(()=>!!window.app.current.game.scene.getObjectByName('frostlight-roof-snow'),null,{timeout:120000});await low.waitForTimeout(3000);
 const lb=await bloom(low);
 assert.equal(await low.evaluate(()=>window.app.engine.quality),'low');
 await freeCam(low);
 const lh=await halo(low,'low-hearth-sun',0),lr=await roofs(low,'low-roofs-high',ROOF_VIEWS[1][1]);
 assert.ok(lh.near.n>=100&&lh.near.mean<=7&&lh.near.p90<=13,`low quality: the halo is not cut: ${JSON.stringify(lh)}`);
 assert.ok(lr.pixels>20000&&lr.white<=.01,`low quality: roof snow is not blown out: ${JSON.stringify(lr)}`);
 console.log('PASS low quality',JSON.stringify({knee:lb.knee,halo:lh,roof:lr}));
 await low.close();
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
