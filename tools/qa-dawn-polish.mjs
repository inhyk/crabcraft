// Goldsand Harbor (World III) second-round polish: the light model, the arena, the shade, the plaster, the granite
// obelisks, the portals' sunbursts, the brass guidance discs, the shore and the paving edges. Measures the drawn
// frames from fixed cameras (the same orbit the review sheets use) and the scene's own data:
//  - the sun-dial arena reads as three value levels (dark basalt bands, mid stone, bright gilt) and its stone is
//    never navy: the mid stone's blue does not run away from its red;
//  - shade on the ground keeps at least 35 % of the lit ground's luminance in the arrival and a dune view, and
//    the arrival foreground is mostly sunlit; shade is cool but not saturated blue;
//  - no plaster pixel clips to white; Goldsand reflects its own dawn (environment map) and gives World I's back;
//  - the avenue obelisks are red granite (the masonry channel GRANITE) with gilt pyramidions, black basalt only on the
//    arena pillars; the portals carry the carved sunburst and no gilt spikes;
//  - the guidance is the brass sun discs and arrowhead, the old additive discs hidden;
//  - the beach shelves gently through the waterline so the wet band is metres wide (dawnHeight, the server's too);
//  - two arena fire lights on high quality, none on low; zero page, shader or GL errors at high and low.
// Writes tmp/qa/dawn-polish-*.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
import {dawnHeight} from '../src/sim/world/ground.ts';
import {DAWN_SEA} from '../src/sim/world/dawnGround.ts';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5619';

// --- The shore, numbers only: wherever the land comes down low to a beach (not the bluffs, not the harbour, which
// keeps dev's ground), from the waterline to half a metre up is at least 2 m across, out from the island's centre.
{
 const widths=[];
 for(let a=0;a<360;a+=10){
  const dx=Math.sin(a*Math.PI/180),dz=Math.cos(a*Math.PI/180);let wet=null,dry=null,top=0,harbour=false;
  for(let t=60;t<260;t+=.05){const x=dx*t,z=3+dz*t,h=dawnHeight(x,z);if(x>-52&&x<32&&z>78)harbour=true;if(dry===null)top=Math.max(top,h);if(dry===null&&h<DAWN_SEA+.5)dry=t;if(h<DAWN_SEA){wet=t;break;}}
  if(wet!==null&&dry!==null&&top<7&&!harbour)widths.push(+(wet-dry).toFixed(2));
 }
 assert.ok(widths.length>=4&&Math.min(...widths)>=2,`the swash zone (sea to +0.5 m) is at least 2 m wide on every beach: ${widths}`);
 console.log('PASS shore: swash zone widths (m) on',widths.length,'beach bearings',widths.join(', '));
}

const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const VIEWS={arena:[0,-75,0,.5,34],arrival:[-12,66,0,.28,12],east:[60,-5,-1.57,.3,26],village:[0,55,.5,.5,40],approach:[0,-30,0,.22,26]};
const lin=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const hsv=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d>1e-6)h=mx===r?((g-b)/d+6)%6:mx===g?(b-r)/d+2:(r-g)/d+4;return {h:h*60,s:mx>0?d/mx:0,v:mx};};
let decoder;
/** Pixels of a PNG screenshot in a rectangle, as [r,g,b] 0..1 (decoded in a blank page). */
async function pixels(buf,[x0,y0,x1,y1]){
 decoder??=await browser.newPage();
 const data=await decoder.evaluate(async([b64,r])=>{const img=await createImageBitmap(await (await fetch('data:image/png;base64,'+b64)).blob());const c=new OffscreenCanvas(img.width,img.height),g=c.getContext('2d');g.drawImage(img,0,0);return Array.from(g.getImageData(r[0],r[1],r[2]-r[0],r[3]-r[1]).data);},[buf.toString('base64'),[x0,y0,x1,y1]]);
 const out=[];for(let i=0;i<data.length;i+=4)out.push([data[i]/255,data[i+1]/255,data[i+2]/255]);return out;
}
const lum=p=>.2126*lin(p[0])+.7152*lin(p[1])+.0722*lin(p[2]);
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const mean3=ps=>[0,1,2].map(c=>mean(ps.map(p=>p[c])));
/** Otsu split of luminance into shade and sun: means, fractions, the shade's mean colour. */
function split(ps){
 const L=ps.map(lum);let lo=Infinity,hi=-Infinity;for(const l of L){if(l<lo)lo=l;if(l>hi)hi=l;}let best=-1,t=lo;
 for(let k=1;k<199;k++){const th=lo+(hi-lo)*k/200;let n0=0,n1=0,s0=0,s1=0;for(const l of L)if(l<th){n0++;s0+=l;}else{n1++;s1+=l;}if(!n0||!n1)continue;const v=n0*n1*(s0/n0-s1/n1)**2;if(v>best){best=v;t=th;}}
 const sh=ps.filter((_,i)=>L[i]<t),li=ps.filter((_,i)=>L[i]>=t);
 return {shade:mean(L.filter(l=>l<t)),lit:mean(L.filter(l=>l>=t)),shadeFrac:sh.length/ps.length,shadeRGB:mean3(sh),litRGB:mean3(li)};
}

async function open(quality){
 const errors=[];
 const p=await browser.newPage({viewport:{width:1600,height:900}});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(180000);
 await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Polish QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',q);},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 const w1env=await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;window.__w1k=g.scene.environmentIntensity;g.world2.go(3);return !!g.scene.environment;});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===3&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.waitForTimeout(2500);
 await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='qa-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-main{visibility:visible!important}';document.head.appendChild(s);
  const g=window.app.current.game;g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
  const away=()=>{let i=0;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);for(const u of g.units)if(u!==g.player.unit){i++;if(Math.hypot(u.pos.x-210,u.pos.z-200-i*3)>1)u.teleport?.(g.world,210,200+i*3,0);}requestAnimationFrame(away);};away();});
 const shot=async name=>{const [x,z,yaw,pitch,dist]=VIEWS[name];await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);await p.waitForTimeout(2600);const buf=await p.screenshot();await p.screenshot({path:`tmp/qa/dawn-polish-${quality}-${name}.png`});return buf;};
 return {p,errors,shot,w1env};
}

// --- High quality -------------------------------------------------------------------------------------------------
{
 const {p,errors,shot,w1env}=await open('high');
 const scene=await p.evaluate(()=>{
  const g=window.app.current.game,third=g.world2.third,root=third.root;
  const fire=[];root.traverse(o=>{if(o.isPointLight&&o.name==='dawn-arena-fire')fire.push(o.visible);});
  const portals=[];g.scene.traverse(o=>{if(o.userData?.sunburst)portals.push({...o.userData.sunburst,gilt:(()=>{const m=o.getObjectByName('dawn-gate-gilt');m.geometry.computeBoundingBox();return m.geometry.boundingBox.max.y;})()});});
  // Masonry channels: granite on the avenue obelisks, its colour red.
  const stone=root.getObjectByName('dawn-citadel-stone'),sn=stone.geometry.getAttribute('aSnow'),col=stone.geometry.getAttribute('color');let gran=0,r=0,gg=0,b=0;
  for(let i=0;i<sn.count;i++)if(Math.abs(sn.getX(i)-.25)<1e-3){gran++;r+=col.getX(i);gg+=col.getY(i);b+=col.getZ(i);}
  const discs=g.objective.group.getObjectByName('goldsand-guide-discs'),arrow=g.objective.group.getObjectByName('goldsand-guide-arrow');
  return {fire,portals,gran,granRGB:[r/gran,gg/gran,b/gran],env:g.scene.environment===third.sky.environment(g.engine.renderer),envK:g.scene.environmentIntensity,
   dawn:g.objective.dawn,discs:discs?{count:discs.count,metal:discs.material.metalness}:null,arrow:!!arrow,sun:third.sky.sunElevation*180/Math.PI,hemi:third.sky.hemiSky.toArray()};
 });
 assert.deepEqual(scene.fire,[true,true],'two arena fire lights on high quality');
 assert.equal(scene.portals.length,2,'both Goldsand portals carry the carved sunburst');
 for(const s of scene.portals){assert.equal(s.spikes,0);assert.ok(s.gilt<2.15+3.5+.75,`no gilt spike reaches past the sunburst: ${s.gilt.toFixed(2)}`);}
 assert.ok(scene.gran>0&&scene.granRGB[0]>2*scene.granRGB[1]&&scene.granRGB[0]>.18,`red granite obelisks: ${scene.gran} vertices ${scene.granRGB.map(v=>v.toFixed(3))}`);
 assert.ok(scene.env&&w1env,'Goldsand reflects its own dawn while it is shown');
 assert.ok(scene.dawn&&scene.discs?.count===9&&scene.discs.metal>.5&&scene.arrow,'brass sun-disc guidance replaces the additive discs');
 const [hr,hg,hb]=scene.hemi;assert.ok(hr/hb>.45&&hg/hb>.5,`the sky fill is lilac blue, not saturated navy: ${scene.hemi.map(v=>v.toFixed(3))}`);
 console.log('PASS scene: fire lights',scene.fire.length,'portals',scene.portals.length,'granite vertices',scene.gran,'env',scene.envK,'sun',scene.sun.toFixed(1)+'°','hemi',scene.hemi.map(v=>v.toFixed(3)).join(','));

 // The arena from the review camera: the dial floor, inside the curb, below the keep.
 const arena=await pixels(await shot('arena'),[260,420,1340,880]);
 const L=arena.map(lum).sort((a,b)=>a-b),q=k=>L[Math.floor(L.length*k)];
 const mid=arena.filter(px=>{const l=lum(px);return l>q(.3)&&l<q(.8);}),m=mean3(mid),mh=hsv(...m);
 assert.ok(q(.08)<.03,`dark basalt bands: p8 ${q(.08).toFixed(3)}`);
 assert.ok(q(.5)>.045&&q(.5)<.3,`mid stone: p50 ${q(.5).toFixed(3)}`);
 assert.ok(q(.995)>.25,`bright gilt inlay: p99.5 ${q(.995).toFixed(3)}`);
 assert.ok(m[2]-m[0]<.04&&!(mh.h>200&&mh.h<260&&mh.s>.2),`the arena stone is never navy: mid ${m.map(v=>v.toFixed(3))} hue ${mh.h.toFixed(0)} sat ${mh.s.toFixed(2)}`);
 console.log(`PASS arena: value levels p8 ${q(.08).toFixed(3)} p50 ${q(.5).toFixed(3)} p99.5 ${q(.995).toFixed(3)}, mid stone rgb ${m.map(v=>v.toFixed(3))} hue ${mh.h.toFixed(0)} sat ${mh.s.toFixed(2)}`);

 // Shade against sun on the ground: the arrival foreground and a dune view.
 for(const [name,rect,most] of [['arrival',[0,560,1600,900],true],['east',[0,560,1600,900],false]]){
  const s=split(await pixels(await shot(name),rect)),sh=hsv(...s.shadeRGB),ratio=s.shade/s.lit;
  assert.ok(ratio>=.35,`${name}: shaded ground keeps >= 35 % of the lit ground: ${ratio.toFixed(3)}`);
  assert.ok(sh.s<.3,`${name}: shade is cool, not saturated: ${s.shadeRGB.map(v=>v.toFixed(3))}`);
  if(most)assert.ok(s.shadeFrac<.5,`${name}: the first view is mostly sunlit: shade ${s.shadeFrac.toFixed(2)}`);
  console.log(`PASS ${name}: shade/lit ${ratio.toFixed(3)}, shade fraction ${s.shadeFrac.toFixed(2)}, shade rgb ${s.shadeRGB.map(v=>v.toFixed(3))} lit rgb ${s.litRGB.map(v=>v.toFixed(3))}`);
 }
 // Plaster never clips: the arrival and the village views, every pixel.
 for(const name of ['arrival','village']){
  const px=await pixels(await shot(name),[0,0,1600,900]),clip=px.filter(c=>c[0]>.985&&c[1]>.985&&c[2]>.985).length;
  assert.ok(clip/px.length<.0005,`${name}: no plaster clipped to white: ${clip} px`);
  console.log(`PASS ${name}: ${clip} clipped white pixels`);
 }
 await shot('approach');
 // Back to World I: its own environment map again.
 const back=await p.evaluate(async()=>{const g=window.app.current.game;g.world2.go(1);await new Promise(r=>setTimeout(r,1500));return !!g.scene.environment&&g.scene.environment!==g.world2.third.sky.environment(g.engine.renderer)&&g.scene.environmentIntensity===window.__w1k;});
 assert.ok(back,'World I gets its own environment map back');
 assert.deepEqual(errors,[],'no page, shader or GL errors (high)');
 console.log('PASS high: World I environment restored, zero errors');
 await p.close();
}
// --- Low quality: no fire lights, the same guidance, zero errors ---------------------------------------------------
{
 const {p,errors,shot}=await open('low');
 await shot('arena');await shot('arrival');
 const low=await p.evaluate(()=>{const g=window.app.current.game,f=[];g.world2.third.root.traverse(o=>{if(o.isPointLight&&o.name==='dawn-arena-fire')f.push(o.visible);});return {fire:f,discs:!!g.objective.group.getObjectByName('goldsand-guide-discs')};});
 assert.deepEqual(low.fire,[false,false],'low quality drops the arena fire lights');
 assert.ok(low.discs,'low quality keeps the brass guidance');
 assert.deepEqual(errors,[],'no page, shader or GL errors (low)');
 console.log('PASS low: fire lights off, brass guidance kept, zero errors');
}
await browser.close();
console.log('PASS dawn polish');
