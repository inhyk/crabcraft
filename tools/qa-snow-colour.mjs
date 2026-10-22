// Frostlight colour: the six rubric views carry more than white, blue and grey (hue diversity: 12-bin hue entropy
// of the pixels with chroma over 0.08, times their share, averaged; dev 0.80, World I 2.04); the six way-cairns
// stand with a lantern and dyed streamers; the quest ore rocks and the camp's fire ring are the field boulders'
// rock, and no kit Rock_Medium is left anywhere in Frostlight. High and low quality, zero page or shader errors.
// Writes tmp/qa/snow-colour-*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir,readdir,readFile} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1600,height:900}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Colour'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:120000});
 // The settlement, fields and camps build after the kits load.
 await p.waitForFunction(()=>!!window.app.current.game.world2.fourth.root.getObjectByName('frostlight-aurora-sites'),null,{timeout:120000});await p.waitForTimeout(6000);
 // The rubric's free camera (capture2.mjs): orbit a target at yaw, pitch and distance; HUD hidden.
 await p.evaluate(()=>{const g=window.app.current.game,c=window.app.engine.renderer.domElement;c.id='qa-colour-canvas';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-colour-canvas{visibility:visible!important}';document.head.appendChild(s);
  g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};});
 return p;
}
// The six rubric views that are not the arrival or the aerial: [name, x, z, yaw, pitch, distance] (capture2.mjs STD).
const VIEWS=[['village',0,55,.5,.5,40],['street',0,45,.3,.12,9],['wild-east',45,-15,-.6,.28,22],['wild-west',-45,-15,.6,.28,22],['landmark',0,-45,0,.3,26],['arena',0,-75,0,.5,34]];
async function view(p,[name,x,z,yaw,pitch,dist],tag){
 await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);
 await p.waitForTimeout(2200);
 const png=await p.screenshot({path:`tmp/qa/snow-colour-${tag}${name}.png`});
 return p.evaluate(async b64=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
  const d=x.getImageData(0,0,img.width,img.height).data,hist=new Array(12).fill(0);let sel=0;
  for(let i=0;i<d.length;i+=4){const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),ch=mx-mn;if(ch<=.08)continue;sel++;
   let h=mx===r?(((g-b)/ch)%6+6)%6:mx===g?(b-r)/ch+2:(r-g)/ch+4;hist[Math.min(11,Math.floor(h/6*12))]++;}
  let H=0;for(const n of hist)if(n){const q=n/sel;H-=q*Math.log2(q);}
  const share=sel/(d.length/4);return {H:+H.toFixed(3),share:+share.toFixed(3),div:+(H*share).toFixed(3)};},png.toString('base64'));
}
/** The cairns, their lanterns and streamers, and which rock the ore and the fire ring are made of. */
const parts=p=>p.evaluate(async()=>{
 const {WAY_CAIRNS}=await import('/src/game/frostCairnsLayout.ts'),{SHELTER}=await import('/src/game/frostThroneLayout.ts'),{SNOW_POINTS}=await import('/src/sim/data/quests.ts');
 const g=window.app.current.game,w=g.world2.fourth,root=w.root,sites=root.getObjectByName('frostlight-aurora-sites'),h=(x,z)=>g.world.heightAt(x,z);
 const near=(mesh,x,z,r)=>{if(!mesh)return 0;const a=mesh.geometry.getAttribute('position'),v=new mesh.position.constructor();mesh.updateMatrixWorld();let n=0;for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);if(Math.hypot(v.x-x,v.z-z)<r)n++;}return n;};
 const ring=root.getObjectByName('frostlight-sites-firering'),cloth=root.getObjectByName('frostlight-cairn-cloth'),halos=root.getObjectByName('frostlight-sites-fire-halos');
 const rocks=g.scene.getObjectByName('frostlight-quest-rocks'),chips=g.scene.getObjectByName('frostlight-quest-stones');
 const seeds=new Map();{const c=cloth.geometry.getAttribute('aCloth');for(let i=0;i<c.count;i++)seeds.set(c.getZ(i),Math.floor(c.getZ(i)/10));}
 const cairns=WAY_CAIRNS.map(c=>{const gy=h(c.x,c.z),hp=halos.geometry.getAttribute('position');let lantern=false;
  for(let i=0;i<hp.count;i++)if(Math.hypot(hp.getX(i)-c.x,hp.getZ(i)-c.z)<1.4&&hp.getY(i)-gy>1.2&&hp.getY(i)-gy<2.8)lantern=true;
  return {x:c.x,z:c.z,stones:near(ring,c.x,c.z,c.r*1.3),lantern,streamers:[...seeds.values()].filter(s=>s===c.seed).length,cloth:near(cloth,c.x,c.z,4)};});
 const F=SHELTER.fire,ore=['snow-ore-a','snow-ore-b','snow-ore-c'].map(id=>{const [x,z]=SNOW_POINTS[id];return {id,rock:near(rocks,x,z,1.6),chip:near(chips,x,z,1.6)};});
 // Kit rock anywhere in Frostlight: a batch of the nature kit's rock, or a piece named for it.
 const kitRock=[];g.scene.traverse(o=>{let up=o,inFrost=false;while(up){if(up===root||/^frostlight-quest|^Island village requests/.test(up.name))inFrost=true;up=up.parent;}
  if(inFrost&&(/Rock_Medium|sites-rocks/.test(o.name)||(o.isBatchedMesh||o.isInstancedMesh)&&/^Rocks?$/.test(o.material?.name??'')))kitRock.push(o.name);});
 return {sites:sites?.userData.sites,cairns,ring:{material:ring?.material.name,stones:near(ring,F.x,F.z,1.2)},ore,rockMaterial:rocks?.material.name,kitRock,
  cloth:{material:cloth?.material.name,dyed:!!cloth?.geometry.getAttribute('color')&&!!cloth?.geometry.getAttribute('aCloth')}};
});
try{
 // Frostlight's own source carries no kit Rock_Medium (the ring, the ore, the cairns are boulders now).
 const src=(await readdir('src/game')).filter(f=>/^(frost|snow|world4|iceCrystals)/.test(f));
 const kitRef=[];for(const f of src)if(/Rock_Medium/.test(await readFile(`src/game/${f}`,'utf8')))kitRef.push(f);
 assert.deepEqual(kitRef,[],`no Frostlight source names the kit rock: ${kitRef}`);
 console.log('PASS no Frostlight source uses kit Rock_Medium',JSON.stringify({files:src.length}));

 const p=await load('high');
 const r=await parts(p);
 assert.equal(r.sites?.cairns,6,`six way-cairns: ${JSON.stringify(r.sites)}`);
 for(const c of r.cairns)assert.ok(c.stones>200&&c.lantern&&c.streamers>=2&&c.cloth>0,`each cairn has stones, a lantern and two or more streamers: ${JSON.stringify(c)}`);
 assert.ok(r.sites.streamers===r.cairns.reduce((n,c)=>n+c.streamers,0),`every streamer hangs on a cairn: ${JSON.stringify(r.sites)}`);
 assert.ok(r.cloth.material==='frostlight-cairn-cloth'&&r.cloth.dyed,`the streamers are the dyed, wind-driven cloth: ${JSON.stringify(r.cloth)}`);
 console.log('PASS six way-cairns with lantern and dyed streamers',JSON.stringify(r.cairns));
 assert.equal(r.ring.material,'frostlight-rock',`the fire ring is the boulders' rock material: ${JSON.stringify(r.ring)}`);assert.ok(r.ring.stones>300,`the fire ring stands round the fire: ${JSON.stringify(r.ring)}`);
 assert.equal(r.rockMaterial,'frostlight-rock');
 for(const o of r.ore)assert.ok(o.rock>300&&o.chip===0,`ore ${o.id} is a boulder of the field's rock, no chipped stone: ${JSON.stringify(o)}`);
 assert.deepEqual(r.kitRock,[],`no kit rock in Frostlight: ${r.kitRock}`);
 console.log('PASS the ore rocks and the fire ring are the field boulders\' rock',JSON.stringify({ring:r.ring,ore:r.ore}));

 const div={};for(const v of VIEWS)div[v[0]]=await view(p,v,'');
 const mean=Object.values(div).reduce((s,v)=>s+v.div,0)/VIEWS.length;
 assert.ok(mean>=1.1,`hue diversity over the six rubric views at or over 1.1 (dev 0.80): ${mean.toFixed(3)} ${JSON.stringify(div)}`);
 console.log(`PASS hue diversity ${mean.toFixed(3)} over the six rubric views`,JSON.stringify(div));
 await p.close();

 const low=await load('low');
 const lr=await parts(low);
 assert.equal(await low.evaluate(()=>window.app.engine.quality),'low');
 assert.ok(lr.sites?.cairns===6&&lr.cairns.every(c=>c.lantern&&c.streamers>=2),`low quality keeps the cairns: ${JSON.stringify(lr.cairns)}`);
 const ld={};for(const v of [VIEWS[2],VIEWS[0]])ld[v[0]]=await view(low,v,'low-');
 assert.ok(Object.values(ld).every(v=>v.div>.7),`low quality keeps the colour: ${JSON.stringify(ld)}`);
 console.log('PASS low quality keeps the cairns and the colour',JSON.stringify(ld));
 await low.close();
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
