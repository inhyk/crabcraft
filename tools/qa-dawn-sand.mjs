// Goldsand (World III as a desert harbour): the sand, the dunes and the desert light. Checks, in numbers, that the
// server's dawnHeight() keeps every piece of gameplay ground at the dawn coast's exact height (town, roads, quest
// points, NPC spots, harbour, citadel climb, arena), that walkable ground stays walkable, and that the open ground
// carries wind-shaped dunes: a dune sea with slip faces at the angle of repose past the walkable ellipse. In the
// game: the clipmap replaced the fixed ground mesh, its GLSL twin and bakes agree with dawnHeight() to centimetres,
// a walking crab prints the sand and the wind fills the prints back in, running kicks sand while paving takes no
// print and throws none, sand blows off the crests in one draw, and high and low quality render without page, shader or GL errors. Writes tmp/qa/dawn-sand-*.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
import {dawnHeight,DAWN_ARENA_HEIGHT} from '../src/sim/world/ground.ts';
import {dawnCoastHeight,sandOpen,DAWN_WIND,DUNE_SEA} from '../src/sim/world/dawnGround.ts';
import {DAWN_BOUNDS} from '../src/sim/world/queries.ts';
import {DAWN_POINTS} from '../src/sim/data/quests.ts';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5616';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
const layout=await (async()=>{const p=await browser.newPage();await p.goto(base+'/');const l=await p.evaluate(async()=>{const m=await import('/src/game/world3Colliders.ts');return {paths:m.DAWN_PATHS,lots:m.dawnLots().map(l=>({x:l.x,z:l.z}))};});await p.close();return l;})();

// --- The ground, numbers only -------------------------------------------------------------------------------------
const inBounds=(x,z)=>Math.hypot(x/DAWN_BOUNDS.rx,(z-DAWN_BOUNDS.cz)/DAWN_BOUNDS.rz)<DAWN_BOUNDS.max;
const coast=(x,z)=>dawnCoastHeight(x,z,DAWN_ARENA_HEIGHT);
// Gameplay ground: NPC spots, POIs, quest points, every lot, every road across its width, the market rows, the
// harbour box, the citadel climb and plateau, the arena.
const keep=[[-12,84],[0,82],[14,84],[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64],[-55,36],[55,36],[55,-25],[0,-40],[0,-44],[67,72],...Object.values(DAWN_POINTS)];
for(const l of layout.lots)for(const dx of [-6,0,6])for(const dz of [-6,0,6])keep.push([l.x+dx,l.z+dz]);
for(const w of layout.paths)for(let k=1;k<w.points.length;k++){const [ax,az]=w.points[k-1],[bx,bz]=w.points[k],L=Math.hypot(bx-ax,bz-az),nx=(bz-az)/L,nz=-(bx-ax)/L;
 for(let t=0;t<=1;t+=1/Math.ceil(L))for(const a of [-1,-.5,0,.5,1]){const d=a*w.width/2;keep.push([ax+(bx-ax)*t+nx*d,az+(bz-az)*t+nz*d]);}}
for(const side of [-1,1])for(const z of [37,57,74])keep.push([side*23,z],[side*25,z+1],[side*25,z-2]);
for(let x=-40;x<=20;x+=1)for(let z=90;z<=160;z+=1)keep.push([x,z]);
for(let x=-60;x<=60;x+=2)for(let z=-110;z<=-30;z+=2)if(Math.hypot(x/122,(z-3)/149)<.84)keep.push([x,z]);
let kept=0,open=0;for(const [x,z] of keep){kept=Math.max(kept,Math.abs(dawnHeight(x,z)-coast(x,z)));open=Math.max(open,sandOpen(x,z));}
assert.equal(kept,0,'gameplay ground keeps the dawn coast\'s exact height');
assert.equal(open,0,'no gameplay point is open to the desert');
for(let r=0;r<=21;r+=3)for(let i=0;i<24;i++){const a=i/24*Math.PI*2;assert.equal(dawnHeight(Math.sin(a)*r,-72+Math.cos(a)*r),DAWN_ARENA_HEIGHT);}
// Walkable ground stays walkable and dry; the open part of it carries new relief.
let slope=0,below=0,changed=0,fields=0;
for(let x=-100;x<=100;x+=.5)for(let z=-120;z<=125;z+=.5){if(!inBounds(x,z))continue;const h=dawnHeight(x,z);if(h<.8)below++;
 if(sandOpen(x,z)>=1){fields++;if(Math.abs(h-coast(x,z))>.3)changed++;}
 if(Math.hypot(x,z+72)>32){const g=Math.hypot(dawnHeight(x+.25,z)-dawnHeight(x-.25,z),dawnHeight(x,z+.25)-dawnHeight(x,z-.25))/.5;slope=Math.max(slope,g);}}
assert.ok(slope<.85,`walkable ground stays under 40 degrees: ${slope.toFixed(2)}`);
assert.equal(below,0,'no walkable ground drowns');
assert.ok(changed/fields>.5,`the open fields are reshaped by the sand: ${changed}/${fields}`);
// The dune sea past the walkable ellipse: tall crests, slip faces at the angle of repose falling downwind, long
// gentle windward slopes. Sampled along the wind across the mainland.
let crest=0,lee=0,stoss=0,leeSteep=0,stossSteep=0;
for(let c=-300;c<=0;c+=6)for(let a=-520;a<=-160;a+=.5){const x=a*DAWN_WIND[0]-c*DAWN_WIND[1],z=a*DAWN_WIND[1]+c*DAWN_WIND[0];if(inBounds(x,z))continue;
 const h=dawnHeight(x,z);if(h<1)continue;crest=Math.max(crest,h);const dh=(dawnHeight(x+DAWN_WIND[0]*.25,z+DAWN_WIND[1]*.25)-dawnHeight(x-DAWN_WIND[0]*.25,z-DAWN_WIND[1]*.25))/.5;
 if(dh<-.55){lee++;}if(dh>0){stoss++;}if(dh<-.95)leeSteep++;if(dh>.45)stossSteep++;}
assert.ok(crest>14&&lee>200&&stoss>lee*3&&leeSteep<lee*.02&&stossSteep<stoss*.05,`a dune sea with slip faces at repose: crest ${crest.toFixed(1)} m, ${lee} slip samples (${leeSteep} past 44 deg), ${stoss} windward (${stossSteep} past 24 deg)`);
console.log('PASS ground: kept',keep.length,'points exactly, walkable max slope',slope.toFixed(2),'reshaped',(changed/fields*100).toFixed(0)+'% of the open fields, dune sea crest',crest.toFixed(1),'m, slip/windward',lee,'/',stoss,'wind',DAWN_WIND.join(','),'sea dunes',DUNE_SEA.lambda,'m');

// --- In the game --------------------------------------------------------------------------------------------------
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(90000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Sand walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(3);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===3&&!document.querySelector('.loading'),null,{timeout:180000});await p.waitForTimeout(2500);
 await p.evaluate(()=>{const g=window.app.current.game;const away=()=>{for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);for(const u of g.units)if(u!==g.player.unit&&!u.hidden)u.teleport?.(g.world,210,200,0);requestAnimationFrame(away);};away();});
 return p;
}
const place=(p,x,z,yaw)=>p.evaluate(([x,z,yaw])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw);g.follow.yaw=yaw+Math.PI;g.follow.pitch=.4;g.follow.cut();},[x,z,yaw]);
const stats=p=>p.evaluate(()=>{const w=window.app.current.game.world2.third;return {live:w.spray.live,...w.spray.stats,stamps:w.deform.stats.stamps};});
async function move(p,keys,ms){const a=await stats(p);for(const k of keys)await p.keyboard.down(k);let max=0;const t=Date.now();while(Date.now()-t<ms){max=Math.max(max,(await stats(p)).live);await p.waitForTimeout(80);}
 for(const k of [...keys].reverse())await p.keyboard.up(k);const b=await stats(p);return {max,emitted:b.emitted-a.emitted,kicks:b.kicks-a.kicks,stamps:b.stamps-a.stamps};}
const inspect=p=>p.evaluate(async()=>{const g=window.app.current.game,w=g.world2.third,root=w.root,ren=window.app.engine.renderer;
 const t=w.terrain,clip=root.getObjectByName('goldsand-clipmap');
 const {dawnHeight}=await import('/src/sim/world/ground.ts'),{sandOpen}=await import('/src/sim/world/dawnGround.ts');
 // The fixed ground mesh is gone; nothing large and flat stands in for sand.
 const leftovers=[];root.traverse(o=>{if(!o.isMesh)return;const q=o.geometry.parameters??{};if(o.name==='dawn-ground'||(o.geometry.type==='PlaneGeometry'&&q.width>=200&&o.name!=='dawn-sea'))leftovers.push(o.name||o.geometry.type);});
 // Twin and bakes against the server: walkable ground on a 1 m lattice jittered, the mainland's dunes further out.
 const pts=[];let s=7;const rnd=()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;
 while(pts.length<3000){const x=(rnd()-.5)*200,z=(rnd()-.5)*250;if(Math.hypot(x/122,(z-3)/149)<.81)pts.push([x,z]);}
 const far=[];while(far.length<1000){const x=-140-rnd()*500,z=-200+rnd()*300;far.push([x,z]);}
 const pr=t.probe(ren,pts),fr=t.probe(ren,far);
 let twin=0,bake=0,farTwin=0,farBake=0,openErr=0,steep=0;
 pr.forEach((v,i)=>{const h=dawnHeight(...pts[i]);twin=Math.max(twin,Math.abs(v[0]-h));bake=Math.max(bake,Math.abs(v[1]-h));openErr=Math.max(openErr,Math.abs(v[4]-sandOpen(...pts[i])));});
 fr.forEach((v,i)=>{const h=dawnHeight(...far[i]);farTwin=Math.max(farTwin,Math.abs(v[0]-h));farBake=Math.max(farBake,Math.abs(v[1]-h));steep=Math.max(steep,Math.hypot(v[2],v[3]));});
 const hemi=[];root.traverse(o=>{if(o.isHemisphereLight)hemi.push(o);});
 const drift=root.getObjectByName('goldsand-blowing-sand');
 return {drift:drift?{visible:drift.visible,streamers:drift.userData.streamers,drawn:drift.userData.drawn??drift.userData.streamers,index:drift.geometry.drawRange.count}:null,clip:!!clip,visible:clip?.visible,layout:t.mesh.userData.layout,res:t.mesh.userData.groundRes,leftovers,twin,bake,farTwin,farBake,openErr,steep,
  draws:clip?1:0,low:'SAND_LOW' in (clip.material.defines??{}),sea:!!root.getObjectByName('dawn-sea'),hemi:hemi.length,view:g.engine.viewOptions?.agxLook?.saturation};});
try{
 for(const quality of ['high','low']){
  const p=await load(quality);const s=await inspect(p);
  assert.ok(s.clip&&s.visible&&s.sea,`the sand clipmap and the sea are built: ${JSON.stringify(s)}`);
  assert.deepEqual(s.leftovers,[],'no fixed ground mesh or flat plane is left');
  assert.equal(s.layout.levels,9);assert.equal(s.layout.spacing,quality==='high'?.08:.16);assert.equal(s.res,quality==='high'?2048:1024);
  assert.equal(s.low,quality==='low',`${quality} quality define`);
  assert.ok(s.twin<.01&&s.openErr<1e-3,`the GLSL twin is dawnHeight(): ${s.twin.toFixed(4)} m, open ${s.openErr.toExponential(1)}`);
  assert.ok(s.bake<(quality==='high'?.02:.05),`the baked ground the sand stands on is dawnHeight() on walkable ground: ${s.bake.toFixed(4)} m`);
  assert.ok(s.farTwin<.02&&s.farBake<(quality==='high'?.6:1.2)&&s.steep>.55,`the dune sea's bake: twin ${s.farTwin.toFixed(3)} m, bake ${s.farBake.toFixed(3)} m, steepest ${s.steep.toFixed(2)}`);
  assert.ok(s.view>1.3,'Goldsand\'s own post look is on');
  assert.ok(s.drift&&s.drift.visible&&s.drift.drawn===(quality==='low'?s.drift.streamers/2:s.drift.streamers),`sand blows off the crests in one draw, half the streamers on low: ${JSON.stringify(s.drift)}`);
  console.log(`PASS ${quality}: clipmap ${s.layout.levels} rings from ${s.layout.spacing} m, bake ${s.res}, twin ${(s.twin*100).toFixed(2)} cm and bake ${(s.bake*100).toFixed(2)} cm off dawnHeight on walkable ground, dune sea bake ${(s.farBake*100).toFixed(1)} cm`);
  if(quality==='high'){
   // Open sand west of the town, well clear of paving: walk it, then let the wind work.
   await place(p,-64,-8,-Math.PI/2);await p.waitForTimeout(1500);
   const idle=await stats(p);
   const walk=await move(p,['w'],2600);
   const prints=await p.evaluate(()=>{const g=window.app.current.game,w=g.world2.third,d=w.deform,ren=window.app.engine.renderer,u=g.player.unit.pos;
    let dep=0,at=null;for(let x=u.x;x<=-62;x+=.05)for(let z=-9.6;z<=-6.4;z+=.05){const v=d.sample(ren,x,z);if(v[0]>dep){dep=v[0];at=[x,z];}}
    return {dep,at,player:[u.x,u.z]};});
   assert.ok(walk.stamps>20&&prints.dep>.02,`walking prints the sand: ${JSON.stringify({walk,prints})}`);
   await p.screenshot({path:'tmp/qa/dawn-sand-prints.png'});
   // The wind refills them: a minute of relaxation steps at the walker's place.
   const refill=await p.evaluate(([x,z])=>{const g=window.app.current.game,w=g.world2.third,d=w.deform,ren=window.app.engine.renderer,u=g.player.unit.pos;
    const before=d.sample(ren,x,z)[0];const t0=[];for(let i=0;i<10;i++)d.step(ren,.4,u.x,u.z);const after10=d.sample(ren,x,z)[0];for(let i=0;i<140;i++)d.step(ren,.4,u.x,u.z);return {before,after4s:after10,after60s:d.sample(ren,x,z)[0]};},prints.at);
   assert.ok(refill.after60s<refill.before*.35&&refill.after4s>refill.before*.6,`the wind fills prints back in over a minute: ${JSON.stringify(refill)}`);
   await place(p,-64,-2,-Math.PI/2);await p.waitForTimeout(600);
   const run=await move(p,['Shift','w'],2000);
   assert.ok(run.kicks>15&&run.emitted>150&&run.max>60,`running kicks sand: ${JSON.stringify(run)}`);
   await p.screenshot({path:'tmp/qa/dawn-sand-run.png'});
   await p.waitForTimeout(3000);const settled=await stats(p);
   assert.ok(settled.live<=5&&settled.recycled===0,`kicked sand settles: ${JSON.stringify(settled)}`);
   // The avenue is paved: no prints, no sand thrown.
   await place(p,0,62,Math.PI);await p.waitForTimeout(800);
   const road=await move(p,['Shift','w'],1600);
   const bare=await p.evaluate(()=>window.app.current.game.world2.third.footfalls.stats.bare);
   assert.ok(road.stamps===0&&road.emitted===0&&bare>10,`paving takes no print and throws no sand: ${JSON.stringify({road,bare})}`);
   console.log('PASS prints and kicked sand',JSON.stringify({idle:idle.live,walk,prints:+prints.dep.toFixed(3),refill:Object.fromEntries(Object.entries(refill).map(([k,v])=>[k,+v.toFixed(4)])),run,road,bare}));
  }else{
   await place(p,-64,-2,-Math.PI/2);await p.waitForTimeout(600);
   const run=await move(p,['Shift','w'],1800);
   assert.ok(run.stamps>10&&run.max>10&&run.max<=640,`low quality prints and kicks a lighter spray: ${JSON.stringify(run)}`);
   await p.screenshot({path:'tmp/qa/dawn-sand-low.png'});
   console.log('PASS low quality prints and kicks sand',JSON.stringify(run));
  }
  await p.close();
 }
 assert.deepEqual(errors,[],'no page, shader or GL errors');
 console.log('PASS dawn sand: no page, shader or GL errors at high and low quality');
}finally{await browser.close();}
