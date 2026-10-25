// Frostlight's fields, second pass (snowDrifts.ts, snowDriftsLayout.ts, snowFieldsLayout.ts, frostPaving.ts,
// frostCliffsLayout.ts), measured in the rubric's own views (the capture2 cameras):
//  - the wild views hold less featureless snow than PR #147 did where the judges found a third of the frame empty
//    (wild-east's lower left, wild-west's lower right) and over the whole lower half;
//  - the paving's edge no longer fades out stone by stone: fewer lone stones beyond it along the procession and the street;
//  - nothing solid stands on a way, a quest point or any monster start the server's World IV definition places;
//  - low quality keeps the wind's drifts and drops their fine pieces; zero page or shader errors.
// Baseline: the numbers measured with this script on PR #147 (1e88a5a), or live from CC_QA_BASELINE.
// Writes tmp/qa/snow-fields2-*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {bundle} from './collision-bake-lib.mjs';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230',baseline=process.env.CC_QA_BASELINE;

// ---- Layout, in Node, on the modules the bake reads.
const L=await import((await bundle('src/game/snowFieldsLayout.ts','qa-fields2')).url);
const D=await import((await bundle('src/game/snowDriftsLayout.ts','qa-fields2-drifts')).url);
const K=await import((await bundle('src/game/frostCliffsLayout.ts','qa-fields2-cliffs')).url);
const Q=await import((await bundle('src/sim/data/quests.ts','qa-fields2-quests')).url);
const W=await import((await bundle('src/sim/world/snowLayout.ts','qa-fields2-ways')).url);
const S=await import((await bundle('src/sim/world/baked.ts','qa-fields2-baked')).url);
const A=await import((await bundle('src/sim/areas/world4.ts','qa-fields2-w4')).url);
// The new solids: half-buried sleds, wheels and fence lengths, and the buried spruce.
const solids=[
 ...L.snowStory().filter(t=>t.solid).map(t=>({kind:t.kind,x:t.x,z:t.z,r:'r' in t.solid?t.solid.r:Math.hypot(t.solid.hx,t.solid.hz)})),
 ...L.snowSaplings().map(t=>({kind:'sapling',x:t.x,z:t.z,r:.35})),
];
assert.ok(solids.length>=20,`new field solids: ${solids.length}`);
for(const s of solids){
 if(s.kind!=='fence')assert.equal(L.fieldBlock(s.x,s.z,Math.min(s.r,1.2),true),null,`${s.kind} at ${s.x},${s.z} is clear (${L.fieldBlock(s.x,s.z,Math.min(s.r,1.2),true)})`);
 for(const [id,[qx,qz]] of Object.entries(Q.SNOW_POINTS))assert.ok(Math.hypot(s.x-qx,s.z-qz)-s.r>=4,`${s.kind} keeps 4 m from ${id}`);
 for(const [hx,hz] of L.FIELD_HOMES)assert.ok(Math.hypot(s.x-hx,s.z-hz)-s.r>=6,`${s.kind} keeps 6 m from the monster home ${hx},${hz}`);
}
// The monster homes the fields keep clear of are the server's own.
assert.ok(L.FIELD_HOMES.length>=20&&L.FIELD_HOMES.some(([x,z])=>x===-44&&z===-100),`FIELD_HOMES read from the World IV definition: ${L.FIELD_HOMES.length}`);
// The ice cliffs keep off every start point.
for(const c of K.iceCliffs())for(const [hx,hz] of K.frostEnemyHomes())assert.ok(Math.hypot(c.x-hx,c.z-hz)>=K.CLIFF_R+1.5-1e-6,`ice cliff ${c.i} keeps clear of the start point ${hx},${hz}`);
// Drifts are never solid and lie on open field.
const drifts={tails:D.snowTails().length,sastrugi:D.snowSastrugi().length,cornices:D.snowCornices().length,scoops:D.snowScoops().length};
assert.ok(drifts.tails>=200&&drifts.sastrugi>=150&&drifts.cornices>=3&&drifts.scoops>=40,`drifts laid: ${JSON.stringify(drifts)}`);
for(const r of D.snowSastrugi())assert.ok([null,'quest'].includes(L.fieldBlock(r.x,r.z,0,false)),`sastrugi at ${r.x},${r.z} lie on open field`);

// Against the baked collision the server loads.
const query=S.loadBakedWorld(JSON.parse(await readFile('public/world/collision-w4.json','utf8')));
const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};
const pushed=(x,z,r)=>{query.collision.resolve(x,z,r,out);return Math.hypot(out.x-x,out.y-z);};
// Every way's centreline, metre by metre: no field solid within a crab's half width.
const fieldShapes=new Set();
{const C=await import((await bundle('src/world/collision.ts','qa-fields2-col')).url),G=await import((await bundle('src/sim/world/ground.ts','qa-fields2-ground')).url);
 const col=new C.Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:G.snowHeight});L.registerSnowFields(col,G.snowHeight);
 for(const w of W.FROST_WAYS)for(let k=1;k<w.points.length;k++){const [ax,az]=w.points[k-1],[bx,bz]=w.points[k],n=Math.ceil(Math.hypot(bx-ax,bz-az));
  for(let i=0;i<=n;i++){const x=ax+(bx-ax)*i/n,z=az+(bz-az)*i/n;col.resolve(x,z,.5,out);assert.ok(Math.hypot(out.x-x,out.y-z)<1e-6,`no field solid on the way at ${x.toFixed(1)},${z.toFixed(1)}`);}}
 for(const [id,[x,z]] of Object.entries(Q.SNOW_POINTS)){col.resolve(x,z,1,out);assert.ok(Math.hypot(out.x-x,out.y-z)<1e-6,`${id} is not pushed by a field collider`);}
}
// Every point the server places (POIs, NPCs, monster starts, quest interactions, the boss), for the hosted population,
// the review's and the largest slot pool (on the island): a crab's half metre at each is pushed by nothing.
const dev=JSON.parse(await readFile('deploy/vm/world-dev.json','utf8')).worlds.w4.population;
let points=0;const blocked=[];
for(const population of [dev,{scrapling:8,scavenger:8,jellyfish:0,shallowPatrols:6},{scrapling:16,scavenger:16,jellyfish:0,shallowPatrols:16}]){
 const d=A.createWorld4Definition({query,personalProps:{heightAt:query.heightAt,resolveCollision:(x,z,r,o)=>query.collision.resolve(x,z,r,o)},fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population});
 const pts=[...Object.entries(d.pois).map(([id,p])=>[`poi:${id}`,p.position]),...d.npcs.map(n=>[`npc:${n.id}`,n.position]),...d.enemies.map(e=>[`enemy:${e.id}`,e.home]),...d.interactions.map(i=>[`int:${i.id}`,i.position]),...d.bosses.map(b=>[`boss:${b.profile}`,b.arena.position])];
 // Slots past the island's walkable edge (the largest pool's last) are the server's to clamp, not a collider's.
 for(const [id,p] of pts){if(L.fieldEdge(p.x,p.z)>.8)continue;points++;const m=pushed(p.x,p.z,.5);if(m>.05)blocked.push(`${id} ${p.x.toFixed(1)},${p.z.toFixed(1)} pushed ${m.toFixed(2)}`);}
}
assert.deepEqual(blocked,[],'no server point is pushed by a collider');
console.log('PASS layout:',solids.length,'new solids clear of quest points (4 m) and monster starts (6 m); drifts',JSON.stringify(drifts),`; ${points} server points, blocked 0; nothing solid on any way`);

// ---- In the browser: the rubric's views.
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(url,quality){const p=await browser.newPage({viewport:{width:1600,height:900}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Field walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(url+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading')&&window.app.current.game.world2.fourth.fields,null,{timeout:120000});await p.waitForTimeout(3000);
 // The 3D view alone, on a free camera.
 await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='qa-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-main{visibility:visible!important}';document.head.appendChild(s);
  const g=window.app.current.game;g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};});
 return p;
}
// capture2.mjs's cameras: [x, z, yaw, pitch, distance] round the player.
const VIEWS={'wild-east':[45,-15,-.6,.28,22],'wild-west':[-45,-15,.6,.28,22],landmark:[0,-45,0,.3,26],street:[0,45,.3,.12,9]};
async function shot(p,name,tag){
 const [x,z,yaw,pitch,dist]=VIEWS[name];
 await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);
 await p.waitForTimeout(2600);
 const buf=await p.screenshot();await writeFile(`tmp/qa/snow-fields2-${name}-${tag}.png`,buf);
 return buf.toString('base64');
}
// Pixel measures, in the page. emptyShare: the share of 32 px blocks in the lower half whose blurred luminance hardly
// varies (featureless snow or shadow). lone: dark blobs in a box (12 px or more) cut off from the largest one, the paving.
async function measure(p,b64,name){
 return p.evaluate(async([b64,name])=>{
  const img=await createImageBitmap(await (await fetch('data:image/png;base64,'+b64)).blob()),c=new OffscreenCanvas(img.width,img.height),x2=c.getContext('2d');x2.drawImage(img,0,0);
  const W=img.width,H=img.height,d=x2.getImageData(0,0,W,H).data,lum=new Float32Array(W*H),blue=new Float32Array(W*H);
  for(let i=0;i<W*H;i++){lum[i]=(.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2])/255;blue[i]=(d[i*4+2]-d[i*4])/255;}
  if(name.startsWith('wild')){
   const B=32,bl=new Float32Array(W*H);
   for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){let s=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)s+=lum[(y+j)*W+x+i];bl[y*W+x]=s/9;}
   const share=(x0,y0,x1,y1)=>{let e=0,t=0;
    for(let by=y0;by+B<=y1;by+=B)for(let bx=x0;bx+B<=x1;bx+=B){let s=0,s2=0;for(let y=by;y<by+B;y++)for(let x=bx;x<bx+B;x++){const v=bl[y*W+x];s+=v;s2+=v*v;}const n=B*B,m=s/n;t++;if(Math.sqrt(Math.max(0,s2/n-m*m))<.022)e++;}
    return +(e/t).toFixed(3);};
   // The judges' empty third: wild-east's lower left, wild-west's lower right; and the whole lower half.
   return {emptyShare:name==='wild-east'?share(0,550,650,900):share(900,450,1600,900),lowerHalf:share(0,450,1600,900)};
  }
  // The street's lower right lies in blue shade (stones darker than .3); the procession is sunlit (stones under .58,
  // and not the blue of a post's shadow).
  const [x0,y0,x1,y1,thr,useBlue]=name==='street'?[900,600,1600,900,.3,false]:[640,420,960,900,.58,true];
  const w=x1-x0,h=y1-y0,mask=new Uint8Array(w*h),lab=new Int32Array(w*h),sizes=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y+y0)*W+x+x0;mask[y*w+x]=lum[i]<thr&&(!useBlue||blue[i]<.12)?1:0;}
  for(let k=0;k<w*h;k++){if(!mask[k]||lab[k])continue;const id=sizes.length+1;let n=0;const st=[k];lab[k]=id;
   while(st.length){const q=st.pop();n++;const x=q%w,y=(q-x)/w;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const r=ny*w+nx;if(mask[r]&&!lab[r]){lab[r]=id;st.push(r);}}}
   sizes.push(n);}
  sizes.sort((a,b)=>b-a);
  return {lone:sizes.slice(1).filter(s=>s>=12).length,paving:sizes[0]??0};
 },[b64,name]);
}
async function measureAll(url,tag){
 const p=await load(url,'high'),r={};
 for(const name of Object.keys(VIEWS)){
  // The street has townsfolk walking across it: the fewest lone blobs of two shots.
  const m=await measure(p,await shot(p,name,tag),name);
  if(name==='street'){const m2=await measure(p,await shot(p,name,tag+'-2'),name);if(m2.lone<m.lone)Object.assign(m,m2);}
  r[name]=m;
 }
 await p.close();return r;
}
// Measured with this script on PR #147 (1e88a5a, base147) at 1600x900, the lower of two runs (blowing snow moves).
const BASE147={'wild-east':{emptyShare:.83,lowerHalf:.57},'wild-west':{emptyShare:.75,lowerHalf:.69},landmark:{lone:36},street:{lone:17}};
try{
 const before=baseline?await measureAll(baseline,'base'):BASE147,after=await measureAll(base,'after');
 console.log('views',JSON.stringify({before,after}));
 for(const v of ['wild-east','wild-west']){
  assert.ok(after[v].emptyShare<=before[v].emptyShare-.12,`${v}: featureless snow where the judges found it empty ${after[v].emptyShare} against ${before[v].emptyShare}`);
  assert.ok(after[v].lowerHalf<before[v].lowerHalf,`${v}: featureless snow in the lower half ${after[v].lowerHalf} against ${before[v].lowerHalf}`);
 }
 for(const v of ['landmark','street'])assert.ok(after[v].lone<=Math.floor(before[v].lone*.6),`${v}: lone stones past the paving's edge ${after[v].lone} against ${before[v].lone}`);
 assert.ok(after.landmark.paving>20000&&after.street.paving>20000,'the paving itself is still there');
 console.log('PASS the wide views hold less empty snow; the paving edge keeps its stones; wrote tmp/qa/snow-fields2-*.png');
 // The drifts and their quality switch.
 const p=await load(base,'high');
 const hi=await p.evaluate(()=>{const f=window.app.current.game.world2.fourth.root.getObjectByName('frostlight-fields'),d=f.getObjectByName('frostlight-drifts');let v=0;d.traverse(o=>{if(o.isBatchedMesh)for(let i=0;i<o.instanceCount;i++)v+=o.getVisibleAt(i)?1:0;});return {drifts:!!d,stats:f.userData.fields,visible:v};});
 assert.ok(hi.drifts&&hi.stats.tails>0&&hi.stats.ridges>0&&hi.stats.cornices>0,`drifts built in the fields: ${JSON.stringify(hi.stats)}`);
 await p.close();
 const low=await load(base,'low');
 const lo=await low.evaluate(()=>{const f=window.app.current.game.world2.fourth.root.getObjectByName('frostlight-fields'),d=f.getObjectByName('frostlight-drifts');let v=0;d.traverse(o=>{if(o.isBatchedMesh)for(let i=0;i<o.instanceCount;i++)v+=o.getVisibleAt(i)?1:0;});return {visible:v,quality:localStorage.getItem('cc.quality')};});
 await measure(low,await shot(low,'wild-east','low'),'wild-east');
 assert.equal(lo.quality,'low');assert.ok(lo.visible>0&&lo.visible<hi.visible,`low quality keeps the large drifts and drops the fine ones: ${lo.visible} of ${hi.visible} near the player`);
 console.log('PASS low quality: drifts shown',lo.visible,'of',hi.visible);
 assert.deepEqual(errors,[]);console.log('PASS zero page or shader errors');
}finally{await browser.close();}
