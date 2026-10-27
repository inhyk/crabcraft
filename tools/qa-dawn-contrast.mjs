// Goldsand Harbor (World III) value range: the bright warm shade fill flattened the frames (every shade the same pale
// blue, p10-p99 about 100 levels wide), so the round that follows brought the depth back without darkening the open
// shade: contact occlusion baked once (dawnContact.ts) under every lit material, cavities and heavy-mineral ripple
// lines in the sand, deeper window and door reveals, and a contrast curve in the desert grade that pivots at the
// shade fill (game.ts DESERT_VIEW, grade.ts contrast). Measures the drawn frames from the review cameras:
//  - on the seven standard views and a dune view, the greyscale (Rec. 601, 0-255) p10-p99 spread is at least 115
//    levels and p1 is 50 or darker (the junctions), and no pixel clips to pure white (plaster, sand, sky);
//  - the open shade keeps its value: the mean of the cool ground pixels stays between 85 and 115;
//  - the contact bake: the occlusion map exists, a few per cent of the town's square is occluded and the open sand is
//    not, a house foot is darker than open ground, and the island's lit materials (sand included) take it;
//  - the plaster carries corner wear: the wall geometry holds the distances to its corners;
//  - zero page, shader or GL errors at high and low quality, and low quality bakes the same contact shade.
// Writes tmp/qa/dawn-contrast-*.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5625';

const VIEWS={arrival:[-12,66,0,.28,12],village:[0,55,.5,.5,40],street:[0,45,.3,.12,9],east:[60,-5,-1.57,.3,26],west:[-60,-5,1.57,.3,26],approach:[0,-30,0,.22,26],arena:[0,-75,0,.5,34],dunes:[-95,-20,1.2,.15,14]};
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
let decoder;
/** Greyscale statistics of a PNG screenshot, decoded in a blank page. */
async function stats(buf){
 decoder??=await browser.newPage();
 return decoder.evaluate(async b64=>{
  const img=await createImageBitmap(await (await fetch('data:image/png;base64,'+b64)).blob());const c=new OffscreenCanvas(img.width,img.height),g=c.getContext('2d');g.drawImage(img,0,0);
  const d=g.getImageData(0,0,img.width,img.height).data,hist=new Float64Array(256);let white=0,shadeSum=0,shadeN=0;const top=Math.floor(img.height/3);
  for(let i=0,px=0;i<d.length;i+=4,px++){const r=d[i],gg=d[i+1],b=d[i+2],L=.299*r+.587*gg+.114*b;hist[Math.min(255,Math.round(L))]++;if(r>=255&&gg>=255&&b>=255)white++;
   // Cool ground in the lower two thirds: the shade fill.
   if(px>=top*img.width&&b>r*.92&&L>40&&L<170){shadeSum+=L;shadeN++;}}
  const n=img.width*img.height,pct=k=>{let acc=0;for(let v=0;v<256;v++){acc+=hist[v];if(acc>=n*k)return v;}return 255;};
  return {p1:pct(.01),p5:pct(.05),p10:pct(.1),p50:pct(.5),p99:pct(.99),white,shade:shadeN?shadeSum/shadeN:0};
 },buf.toString('base64'));
}

async function open(quality){
 const errors=[];
 const p=await browser.newPage({viewport:{width:1600,height:900}});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(180000);
 await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Contrast QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',q);},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(3);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===3&&!document.querySelector('.loading')&&window.app.current.game.world2.third.contact.baked,null,{timeout:180000});
 await p.waitForTimeout(2500);
 await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='qa-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-main{visibility:visible!important}';document.head.appendChild(s);
  const g=window.app.current.game;g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
  const away=()=>{let i=0;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);for(const u of g.units)if(u!==g.player.unit){i++;if(Math.hypot(u.pos.x-210,u.pos.z-200-i*3)>1)u.teleport?.(g.world,210,200+i*3,0);}requestAnimationFrame(away);};away();});
 const shot=async name=>{const [x,z,yaw,pitch,dist]=VIEWS[name];await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);await p.waitForTimeout(2600);const buf=await p.screenshot();await p.screenshot({path:`tmp/qa/dawn-contrast-${quality}-${name}.png`});return buf;};
 return {p,errors,shot};
}

/** The contact bake, read from the page: its stats, the occluded share of the map, a house foot against open sand. */
const contactProbe=p=>p.evaluate(()=>{
 const g=window.app.current.game,third=g.world2.third,c=third.contact,r=g.engine.renderer,buf=c.read(r),n=c.stats.res;
 let dark=0,deep=0;for(let i=0;i<n*n;i++){const v=buf[i*4]/255;if(v<.8)dark++;if(v<.5)deep++;}
 // A house foot: a step outside the middle of a quarter wall (the wall geometry's own vertices at ground level).
 const walls=third.root.getObjectByName('goldsand-walls'),pos=walls.geometry.getAttribute('position'),aux=walls.geometry.getAttribute('aPl'),nrm=walls.geometry.getAttribute('normal'),uv=walls.geometry.getAttribute('aPlUv');
 let foot=null,cornerVerts=0,farVerts=0;
 for(let i=0;i<pos.count;i++){const e=Math.min(uv.getX(i),uv.getY(i));if(e<.05)cornerVerts++;else if(e>=9)farVerts++;
  if(!foot&&aux.getX(i)<.05&&Math.abs(nrm.getY(i))<.3&&e>2&&e<9){const x=pos.getX(i)+nrm.getX(i)*.35,z=pos.getZ(i)+nrm.getZ(i)*.35;if(Math.abs(x)<60&&z>30&&z<90)foot=[x,z];}}
 const mats=new Set();let patched=0;third.root.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(mats.has(m))continue;mats.add(m);if(m.userData.contactPatched)patched++;}});
 const sand=third.terrain.mesh.material.customProgramCacheKey().includes('goldsand-contact');
 return {stats:c.stats,dark:dark/(n*n),deep:deep/(n*n),foot,footAO:foot?c.sample(r,foot[0],foot[1]):-1,openAO:c.sample(r,-120,-40),patched,sand,cornerVerts,farVerts,on:c.uniforms.dawnAOOn.value};
});

// --- High quality -------------------------------------------------------------------------------------------------
{
 const {p,errors,shot}=await open('high');
 const k=await contactProbe(p);
 assert.equal(k.on,1,'the contact shade is on once baked');
 assert.ok(k.stats.occluders>=60,`solids stand in the height field: ${k.stats.occluders}`);
 assert.ok(k.patched>=40&&k.sand,`the island's lit materials and the sand take the contact shade: ${k.patched} materials, sand ${k.sand}`);
 assert.ok(k.dark>.005&&k.dark<.2,`a few per cent of the square is occluded, not all of it: ${(k.dark*100).toFixed(2)} %`);
 assert.ok(k.foot&&k.footAO<k.openAO-.12&&k.openAO>.97,`a house foot is darker than open sand: foot ${k.footAO.toFixed(2)} at ${k.foot} open ${k.openAO.toFixed(2)}`);
 assert.ok(k.cornerVerts>500&&k.farVerts>500,`the plaster walls carry corner distances: ${k.cornerVerts} corner vertices, ${k.farVerts} far`);
 console.log(`PASS contact: ${k.stats.occluders} occluders, ${k.patched} materials patched (${k.stats.cloned} kit clones), sand ${k.sand}, occluded ${(k.dark*100).toFixed(2)} % (deep ${(k.deep*100).toFixed(2)} %), house foot ${k.footAO.toFixed(2)} vs open ${k.openAO.toFixed(2)}, corner vertices ${k.cornerVerts}`);
 console.log('view       p1   p5  p10  p50  p99  width  white  shade');
 for(const name of Object.keys(VIEWS)){
  const s=await stats(await shot(name)),w=s.p99-s.p10;
  console.log(`${name.padEnd(9)} ${String(s.p1).padStart(4)} ${String(s.p5).padStart(4)} ${String(s.p10).padStart(4)} ${String(s.p50).padStart(4)} ${String(s.p99).padStart(4)} ${String(w).padStart(6)} ${String(s.white).padStart(6)} ${s.shade.toFixed(1).padStart(6)}`);
  assert.ok(w>=115,`${name}: p10-p99 spread >= 115: ${w}`);
  assert.ok(s.p1<=50,`${name}: p1 <= 50: ${s.p1}`);
  assert.equal(s.white,0,`${name}: no pixel clips to white`);
  assert.ok(s.shade>=85&&s.shade<=115,`${name}: the open shade keeps its value: ${s.shade.toFixed(1)}`);
 }
 console.log('PASS views: every spread >= 115, p1 <= 50, no white clipping, shade mean 85..115');
 assert.deepEqual(errors,[],'no page, shader or GL errors (high)');
 console.log('PASS high: zero errors');
 await p.close();
}
// --- Low quality: the same bake, a frame, zero errors ---------------------------------------------------------------
{
 const {p,errors,shot}=await open('low');
 const k=await contactProbe(p);
 assert.ok(k.on===1&&k.patched>=40&&k.sand&&k.footAO<k.openAO-.12,`low quality bakes the contact shade too: ${k.patched} materials foot ${k.footAO.toFixed(2)} open ${k.openAO.toFixed(2)}`);
 const s=await stats(await shot('village'));
 assert.equal(s.white,0,'low: no pixel clips to white');
 assert.deepEqual(errors,[],'no page, shader or GL errors (low)');
 console.log(`PASS low: contact baked (${k.patched} materials), village p10 ${s.p10} p99 ${s.p99}, zero errors`);
 await p.close();
}
await browser.close();
console.log('PASS qa-dawn-contrast');
