// Frostlight sky: World IV draws SNOWFLOW's baked atmosphere, its sun, ambient, fog and ice are read off the same
// sky, the fogged sea meets the dome without a seam, and the low-quality game compiles it too. Writes tmp/qa/snow-sky-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Sky watcher'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:90000});await p.waitForTimeout(2500);
 // Fixed cameras: the follow camera is held, the HUD hidden, and snowfall paused off so flakes do not land in the samples.
 await p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);const c=window.app.engine.renderer.domElement;c.id='qa-sky-canvas';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-sky-canvas{visibility:visible!important}';document.head.appendChild(s);
  g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);this.camera.position.set(...s.p);this.camera.lookAt(...s.t);};});
 return p;
}
const aim=(p,pos,target)=>p.evaluate(([pos,target])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,pos[0],pos[2],0);window.__cam={p:pos,t:target};},[pos,target]);
// Largest step between neighbouring rows of the mean sRGB colour in a band around the horizon, in 8-bit units.
async function seam(p){
 const png=(await p.screenshot()).toString('base64');
 return p.evaluate(async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
  const w=300,h=120,x0=(img.width-w)>>1,y0=(img.height-h)>>1,d=x.getImageData(x0,y0,w,h).data,rows=[];
  for(let r=0;r<h;r++){const m=[0,0,0];for(let k=0;k<w;k++)for(let ch=0;ch<3;ch++)m[ch]+=d[(r*w+k)*4+ch]/w;rows.push(m);}
  let step=0;for(let r=1;r<h;r++)for(let ch=0;ch<3;ch++)step=Math.max(step,Math.abs(rows[r][ch]-rows[r-1][ch]));
  return {step:+step.toFixed(2),top:rows[0].map(v=>Math.round(v)),bottom:rows[h-1].map(v=>Math.round(v))};},png);
}
try{
 const p=await load('high');
 const r=await p.evaluate(()=>{const g=window.app.current.game,w=g.world2.fourth,sky=w.sky,dome=g.scene.getObjectByName('snowflow-sky');
  let oldGradient=false,sun=null,hemi=null,ice=null;
  w.root.traverse(o=>{const m=o.material;if(m?.fragmentShader?.includes('vec3(.32,.49,.65)'))oldGradient=true;if(o.isDirectionalLight)sun=o;if(o.isHemisphereLight)hemi=o;if(m?.uniforms?.skyHorizon)ice=m.uniforms;});
  const d=sun.position.clone().sub(sun.target.position).normalize();
  const near=(a,b)=>Math.max(Math.abs(a.r-b.r),Math.abs(a.g-b.g),Math.abs(a.b-b.b));
  return {dome:!!dome&&dome.visible&&dome.material.name==='snowflow-sky',lut:[dome.material.uniforms.skyLUT.value.image.width,dome.material.uniforms.skyLUT.value.image.height],oldGradient,
   sun:{shadow:sun.castShadow,elevation:+(Math.asin(d.y)*180/Math.PI).toFixed(2),color:sun.color.toArray().map(v=>+v.toFixed(3)),intensity:+sun.intensity.toFixed(3),alongSky:+d.dot(sky.sunDir).toFixed(5)},
   hemi:near(hemi.color,sky.hemiSky)+near(hemi.groundColor,sky.hemiGround),ice:near(ice.skyHorizon.value,sky.skyHorizon)+near(ice.skyZenith.value,sky.skyZenith)+near(ice.snowBounce.value,sky.snowBounce)};});
 assert.equal(r.dome,true,'the dome draws the SNOWFLOW sky material');assert.deepEqual(r.lut,[64,96]);assert.equal(r.oldGradient,false,'no material still carries the two-colour gradient');
 assert.equal(r.sun.shadow,true);assert.ok(Math.abs(r.sun.elevation-13)<.3,`low raking sun: ${JSON.stringify(r.sun)}`);assert.ok(r.sun.alongSky>.99999,'the light points down the sky\'s sun');
 assert.ok(r.sun.color[0]>=r.sun.color[1]&&r.sun.color[1]>r.sun.color[2],`the low sun is reddened: ${JSON.stringify(r.sun)}`);
 assert.ok(r.hemi<1e-6&&r.ice<1e-6,`hemisphere and ice read the sky's colours: ${JSON.stringify(r)}`);
 console.log('PASS World IV draws the baked sky and its sun, ambient and ice come from it',JSON.stringify(r));

 // Fog. The colour is the sky's own horizon in the view direction (SNOWFLOW's fully-hazed-equals-sky rule).
 // Away from the sun it must equal that horizon to 0.004 linear, under one 8-bit display step at these levels
 // (sRGB slope ~0.75 near 0.4 linear). Toward the sun the short-path roll-off caps it at twice the mean horizon.
 const east=await p.evaluate(()=>{const g=window.app.current.game,h=g.world.heightAt(140,0)+6;return h;});
 const anti=await p.evaluate(()=>{const s=window.app.current.game.world2.fourth.sky.sunDir;return [-s.x,-s.z];});
 const fogAt=async(pos,dx,dz)=>{await aim(p,pos,[pos[0]+dx*400,pos[1],pos[2]+dz*400]);await p.waitForTimeout(700);
  return p.evaluate(()=>{const g=window.app.current.game,sky=g.world2.fourth.sky,e=g.camera.matrixWorld.elements,f=g.scene.fog.color,want=sky.horizonToward(-e[8],-e[10],f.clone()),haze=sky.material.uniforms.hazeColor.value,h=sky.skyHorizon,L=c=>c.r*.2126+c.g*.7152+c.b*.0722;
   return {fog:f.toArray().map(v=>+v.toFixed(4)),horizon:want.toArray().map(v=>+v.toFixed(4)),diff:+Math.max(...['r','g','b'].map(k=>Math.abs(f[k]-want[k]))).toFixed(5),haze:Math.max(...['r','g','b'].map(k=>Math.abs(f[k]-haze[k]))),lum:+(L(f)/L(h)).toFixed(3)};});};
 const awayPos=await p.evaluate(()=>{const g=window.app.current.game;return [-140,g.world.heightAt(-140,-150)+6,-150];});
 const away=await fogAt(awayPos,anti[0],anti[1]);
 assert.ok(away.diff<=.004,`fog equals the sky horizon away from the sun: ${JSON.stringify(away)}`);assert.ok(away.haze<1e-6,'the dome haze band fades to the same fog colour');
 const sunward=await fogAt([140,east,0],-anti[0],-anti[1]);
 assert.ok(sunward.lum<=2.0001&&sunward.lum>1,`toward the sun the fog brightens and is capped: ${JSON.stringify(sunward)}`);assert.ok(sunward.haze<1e-6);
 console.log('PASS chapter-4 fog is the sky horizon in the view direction',JSON.stringify({away,sunward}));

 // Seam: looking out to sea, the fogged far sea and the dome above it must blend with no row-to-row jump.
 await p.evaluate(()=>{window.app.current.game.scene.getObjectByName('gpu-snowfall').visible=false;});
 const seams={};
 for(const [name,pos,dir] of [['east',[140,east,0],[1,0]],['away',awayPos,anti]]){await aim(p,pos,[pos[0]+dir[0]*400,pos[1],pos[2]+dir[1]*400]);await p.waitForTimeout(700);seams[name]=await seam(p);await p.screenshot({path:`tmp/qa/snow-sky-horizon-${name}.png`});}
 assert.ok(Object.values(seams).every(s=>s.step<=3),`no seam at the horizon (max 3/255 between rows): ${JSON.stringify(seams)}`);
 console.log('PASS the fogged sea dissolves into the dome without a seam',JSON.stringify(seams));
 await p.evaluate(()=>{window.app.current.game.scene.getObjectByName('gpu-snowfall').visible=true;});
 await aim(p,await p.evaluate(()=>{const g=window.app.current.game;return [0,g.world.heightAt(0,70)+4,70];}),[0,62,-200]);await p.waitForTimeout(900);
 await p.screenshot({path:'tmp/qa/snow-sky-aurora.png'});
 await aim(p,await p.evaluate(()=>{const g=window.app.current.game;return [-10,g.world.heightAt(-10,-10)+4,-10];}),[200,34,220]);await p.waitForTimeout(900);
 await p.screenshot({path:'tmp/qa/snow-sky-sun.png'});
 await p.close();

 const low=await load('low');
 const lr=await low.evaluate(()=>{const g=window.app.current.game,d=g.scene.getObjectByName('snowflow-sky');return {quality:window.app.engine.quality,dome:!!d&&d.visible&&d.material.name==='snowflow-sky',program:!!window.app.engine.renderer.properties.get(d.material).currentProgram};});
 assert.deepEqual(lr,{quality:'low',dome:true,program:true});
 await low.screenshot({path:'tmp/qa/snow-sky-low.png'});
 console.log('PASS low quality compiles and draws the sky',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
