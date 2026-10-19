// Frostlight finish: its own quest guidance (a lantern shaft with a pool of light on the ground's height, lantern
// motes over the snow) only while Frostlight is shown, the gold pillar and crumbs everywhere else; the frame
// budget (draw calls in the village and on the north road at or under 619 and 288, crab shadow proxies drawn
// only into shadow maps, far crabs in one body draw, gear shadows merged). High and low quality, zero page or
// shader errors. Writes tmp/qa/snow-finish-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1600,height:900}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(60000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Finish'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;});await p.waitForTimeout(1000);return p;
}
async function go(p,chapter){
 await p.evaluate(c=>window.app.current.game.world2.go(c),chapter);
 await p.waitForFunction(c=>window.app.current.game.world2.chapter===c&&!document.querySelector('.loading'),chapter,{timeout:120000});await p.waitForTimeout(3000);
}
const hush=p=>p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);});
/** Stand at (x,z) facing a fixed objective at (tx,tz), camera behind; return what the guidance draws. */
const guide=async(p,[x,z],[tx,tz],shot)=>{
 await hush(p);
 await p.evaluate(([x,z,tx,tz])=>{const g=window.app.current.game,V=g.player.unit.pos.constructor,ty=g.world.heightAt(tx,tz);g.objectivePos=()=>new V(tx,ty,tz);
  const dx=tx-x,dz=tz-z,l=Math.hypot(dx,dz);g.player.unit.teleport(g.world,x,z,Math.atan2(dx,dz));g.follow.yaw=Math.atan2(-dx/l,-dz/l);g.follow.pitch=.22;g.follow.cut();},[x,z,tx,tz]);
 await p.waitForTimeout(1800);
 if(shot)await p.screenshot({path:`tmp/qa/snow-finish-${shot}.png`});
 return p.evaluate(()=>{const g=window.app.current.game,o=g.objective,fg=o.frostGuide,w=g.world;
  const out={frost:o.frost,pillar:o.beam.mesh.visible,chevron:o.chevron.visible,crumbs:o.crumbs.visible,guide:!!fg&&fg.group.visible};
  if(fg&&fg.group.visible){
   out.shaft=fg.shaft.visible;out.motes=fg.motes.visible;out.patches=fg.patches.visible;
   // The pool's grid lies a few cm over the ground at every vertex.
   const pa=fg.pool.geometry.getAttribute('position'),v=new fg.pool.position.constructor();let worst=0;
   fg.pool.updateMatrixWorld();for(let i=0;i<pa.count;i++){v.fromBufferAttribute(pa,i).applyMatrix4(fg.pool.matrixWorld);worst=Math.max(worst,Math.abs(v.y-w.heightAt(v.x,v.z)-0.05));}
   out.poolOff=+worst.toFixed(3);
   // Motes hover a hand over the snow; drawn motes are those with brightness.
   const mp=fg.motes.geometry.getAttribute('position'),mb=fg.motes.geometry.getAttribute('aBright');let lit=0,lo=Infinity,hi=-Infinity;
   for(let i=0;i<mp.count;i++){if(mb.getX(i)<=0.01)continue;lit++;const h=mp.getY(i)-w.heightAt(mp.getX(i),mp.getZ(i));lo=Math.min(lo,h);hi=Math.max(hi,h);}
   out.lit=lit;out.moteLo=+lo.toFixed(2);out.moteHi=+hi.toFixed(2);
   out.kinds=[fg.shaft,fg.pool,fg.motes,fg.patches].map(m=>m.material.type);
  }
  return out;});
};
/** Draw calls at drawstats' views: player teleported, enemies away, the median of 12 frames. */
const calls=(p,[x,z,uy,fy,pitch])=>p.evaluate(([x,z,uy,fy,pitch])=>new Promise(res=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,x,z,uy);g.follow.yaw=fy;g.follow.pitch=pitch;g.follow.cut();
 setTimeout(()=>{const r=window.app.engine.renderer,s=[];const f=()=>requestAnimationFrame(()=>{s.push(r.info.render.calls);if(s.length<12)f();else{s.sort((a,b)=>a-b);res(s[6]);}});f();},2500);}),[x,z,uy,fy,pitch]);
/** One frame's crab draws by pass: proxies, far bodies, per-class far meshes and gear shadows. */
const crabPasses=p=>p.evaluate(()=>new Promise(res=>{const r=window.app.engine.renderer,o=r.renderBufferDirect.bind(r),n={};
 r.renderBufferDirect=function(c,s,geo,mat,obj,gr){if(/^crab-|^gear-shadow/.test(obj.name)){const k=(s?'main:':'shadow:')+obj.name.replace(/-without-.*/,'');n[k]=(n[k]??0)+1;}return o(c,s,geo,mat,obj,gr);};
 requestAnimationFrame(()=>requestAnimationFrame(()=>{r.renderBufferDirect=o;res(n);}));}));
try{
 const p=await load('high');
 // World I and World III keep the gold pillar, chevron and crumbs; nothing of Frostlight's guidance.
 for(const [c,from,to] of [[1,[0,20],[60,30]],[3,[0,45],[45,-15]]]){
  if(c!==1)await go(p,c);
  const g=await guide(p,from,to,`w${c}`);
  assert.ok(!g.frost&&g.pillar&&g.crumbs&&!g.guide,`World ${c} keeps its guidance: ${JSON.stringify(g)}`);
  console.log(`PASS World ${c} keeps the gold pillar and crumbs`,JSON.stringify(g));
 }
 await go(p,4);
 const field=await guide(p,[20,12],[44,-6],'w4-field');
 assert.ok(field.frost&&field.guide&&!field.pillar&&!field.chevron&&!field.crumbs,`Frostlight draws its own guidance only: ${JSON.stringify(field)}`);
 assert.ok(field.shaft&&field.motes&&field.patches&&field.lit>=3,`shaft, motes and their patches show 30 m out: ${JSON.stringify(field)}`);
 assert.ok(field.poolOff<0.01,`the pool lies on the ground's height: ${field.poolOff}`);
 assert.ok(field.moteLo>0.25&&field.moteHi<0.65,`motes hover 0.3 to 0.6 m over the snow: ${JSON.stringify(field)}`);
 assert.ok(field.kinds.every(k=>k==='ShaderMaterial'||k==='PointsMaterial'),`no placeholder primitives: ${field.kinds}`);
 const near=await guide(p,[38,-2],[44,-6],'w4-near');
 assert.ok(near.shaft&&!near.motes,`close by, the shaft stays and the motes rest: ${JSON.stringify(near)}`);
 const street=await guide(p,[0,45],[-7,26],'w4-street');
 assert.ok(street.guide&&street.lit>=2,`motes lead down the high street: ${JSON.stringify(street)}`);
 console.log('PASS Frostlight guidance',JSON.stringify({field,near,street}));
 // No objective: nothing drawn.
 const none=await p.evaluate(()=>{const g=window.app.current.game;g.objectivePos=()=>null;return new Promise(r=>setTimeout(()=>r({guide:g.objective.frostGuide.group.visible,pillar:g.objective.beam.mesh.visible}),300));});
 assert.ok(!none.guide&&!none.pillar,`no objective, no guidance: ${JSON.stringify(none)}`);

 // Frame budget: draw calls at drawstats' views.
 const budget={village:await calls(p,[0,88,Math.PI,0,.3]),road:await calls(p,[0,20,Math.PI,0,.3]),field:await calls(p,[30,0,Math.PI/2,-Math.PI/2+.4,.3]),arena:await calls(p,[0,-50,Math.PI,0,.3])};
 assert.ok(budget.village<=619&&budget.road<=288,`village <= 619 and road <= 288 draw calls: ${JSON.stringify(budget)}`);
 await calls(p,[0,88,Math.PI,0,.3]);await p.screenshot({path:'tmp/qa/snow-finish-village.png'});
 const passes=await crabPasses(p);
 assert.ok(!passes['main:crab-shadow-proxy']&&passes['shadow:crab-shadow-proxy']>0,`proxies cast but are not drawn: ${JSON.stringify(passes)}`);
 assert.ok(passes['main:crab-body-lod']>=5&&!['dark','visor','metal','joint','rubber'].some(c=>passes[`main:crab-${c}-lod`]),`far crabs draw one body: ${JSON.stringify(passes)}`);
 assert.ok(passes['shadow:gear-shadow']>0,`gear casts from merged shadows: ${JSON.stringify(passes)}`);
 const gear=await p.evaluate(()=>{const g=window.app.current.game;let pieces=0,merged=0,loose=0;for(const u of g.units)for(const piece of u.rig.gearMeshes??[]){pieces++;let m=0,cast=0;piece.traverse(o=>{if(o.name==='gear-shadow')m++;else if(o.isMesh&&o.castShadow&&o.userData.gearShadowMerged)cast++;});merged+=m;loose+=cast;}return {pieces,merged,loose};});
 assert.ok(gear.merged>0&&gear.loose===0,`merged pieces leave no sub-mesh casting: ${JSON.stringify(gear)}`);
 console.log('PASS frame budget',JSON.stringify({budget,passes,gear}));
 await p.close();

 // Low quality: the same guidance, no errors.
 const lp=await load('low');
 await go(lp,4);
 const low=await guide(lp,[20,12],[44,-6],'w4-low');
 assert.ok(low.frost&&low.guide&&low.shaft&&low.motes,`low quality guidance: ${JSON.stringify(low)}`);
 console.log('PASS low quality',JSON.stringify(low));
 await lp.close();
 assert.deepEqual(errors,[],'no page or shader errors');
 console.log('PASS zero errors');
}finally{await browser.close();}
