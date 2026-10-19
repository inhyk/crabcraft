// Frostlight's own plan (src/sim/world/snowLayout.ts): its residents stand where World V's and VI's do not, every
// open cell of the village is reachable on foot from the arrival, nothing solid stands on any street, lane or road,
// the guide lanterns stand 2.5 to 5 m off the road's paved edge, and the server's ground, its baked copy and the GPU
// twin agree along every way. The low-quality page builds the same plan; zero page or shader errors.
// Writes tmp/qa/snow-layout-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|geometr/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Plan walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:240000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading')&&!!window.app.current.game.world2.fourth.village,null,{timeout:240000});await p.waitForTimeout(2000);return p;
}
async function shot(p,path,cam,at){
 await p.evaluate(([cam,at])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,at[0],at[2],0);
  const c=[cam[0],h(cam[0],cam[2])+cam[1],cam[2]],t=[at[0],h(at[0],at[2])+at[1],at[2]];g.follow.update=function(){this.camera.position.set(...c);this.camera.lookAt(...t);};},[cam,at]);
 await p.waitForTimeout(2500);await p.screenshot({path});
}
try{
 const p=await load('high');
 const r=await p.evaluate(async()=>{
  const g=window.app.current.game,w2=g.world2,f=w2.fourth,P=await import('/src/sim/world/snowLayout.ts'),T=await import('/src/sim/data/townsfolk.ts');
  const Q=(await import('/src/sim/data/quests.ts')).SNOW_POINTS,F=await import('/src/game/frostPropsLayout.ts'),V=await import('/src/game/snowVillageLayout.ts');
  const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};
  const free=(x,z,rad)=>{g.world.resolveCollision(x,z,rad,out);return Math.hypot(out.x-x,out.y-z)<.05;};
  // Residents: Frostlight's own, not the frontier's grid, and standing where the plan puts them.
  const w4=P.FROST_NPCS.map(n=>[n.x,n.z]),frontier=[w2.fifth.town,w2.sixth.town,T.SNOW_TOWN_POINTS];
  const sameAsFrontier=frontier.map(town=>w4.filter(([x,z],i)=>Math.hypot(x-town[i][0],z-town[i][1])<3).length);
  const npcAt=g.npcs.map((n,i)=>+Math.hypot(n.unit.pos.x-w4[i][0],n.unit.pos.z-w4[i][1]).toFixed(2));
  const townDiff=P.FROST_TOWN_POINTS.some(([x,z],i)=>Math.hypot(x-T.SNOW_TOWN_POINTS[i][0],z-T.SNOW_TOWN_POINTS[i][1])>3);
  // Nothing solid on any way, kerb to kerb (squares may carry their benches, stall and fountain).
  const onWay=[];
  for(const w of P.FROST_WAYS)for(let k=1;k<w.points.length;k++){const [ax,az]=w.points[k-1],[bx,bz]=w.points[k],L=Math.hypot(bx-ax,bz-az),nx=(bz-az)/L,nz=-(bx-ax)/L;
   for(let t=0;t<1;t+=.5/L)for(let d=-(w.width/2-.3);d<=w.width/2-.3+1e-9;d+=.5){const x=ax+(bx-ax)*t+nx*d,z=az+(bz-az)*t+nz*d;if(!free(x,z,.3))onWay.push([w.id,+x.toFixed(1),+z.toFixed(1)]);}}
  // The village's lamps stand off the stones.
  const lampsOnStone=V.snowLamps().filter(l=>P.frostPavedDist(l.x,l.z)<.3).map(l=>[+l.x.toFixed(1),+l.z.toFixed(1)]);
  // Guide-lantern posts: 2.5 to 5 m off the road's paved edge, set back from their quest points, facing the road.
  const posts=F.FROST_LAMP_POSTS.map(([x,z,yaw],i)=>{const q=Q[`snow-lamp-${'abc'[i]}`],edge=P.frostRoadEdgeDist(x,z),back=P.frostRoadEdgeDist(x+Math.sin(yaw)*2,z+Math.cos(yaw)*2);
   return {edge:+edge.toFixed(2),set:+Math.hypot(x-q[0],z-q[1]).toFixed(2),facesRoad:back<edge,quest:+P.frostRoadEdgeDist(q[0],q[1]).toFixed(2)};});
  // Flood fill on a 0.5 m grid from the arrival with a crab-sized body: every open cell of the village is reachable.
  // The grid sits a hair off round numbers: resolve() cannot push out a point exactly on a circle's centre.
  const S=.5,X0=-46.013,Z0=22.007,NX=185,NZ=160,open=new Uint8Array(NX*NZ),seen=new Uint8Array(NX*NZ);
  for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++)open[j*NX+i]=free(X0+i*S,Z0+j*S,.55)?1:0;
  const start=Math.round((82-Z0)/S)*NX+Math.round((0-X0)/S),q=[start];seen[start]=1;
  while(q.length){const k=q.pop(),i=k%NX,j=(k-i)/NX;for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=i+di,b=j+dj;if(a<0||b<0||a>=NX||b>=NZ)continue;const n=b*NX+a;if(!seen[n]&&open[n]){seen[n]=1;q.push(n);}}}
  const trapped=[];let openCells=0;
  for(let n=0;n<NX*NZ;n++){if(!open[n])continue;openCells++;if(!seen[n])trapped.push([+(X0+(n%NX)*S).toFixed(1),+(Z0+Math.floor(n/NX)*S).toFixed(1)]);}
  // The ground along every way: the server's snowHeight(), the server's baked world and the GPU twin and bake.
  const pts=[];for(const w of P.FROST_WAYS)for(let k=1;k<w.points.length;k++){const [ax,az]=w.points[k-1],[bx,bz]=w.points[k],L=Math.hypot(bx-ax,bz-az),nx=(bz-az)/L,nz=-(bx-ax)/L;
   for(const t of [0,.5])for(const a of [-1,0,1])pts.push([ax+(bx-ax)*t+nx*a*w.width/2,az+(bz-az)*t+nz*a*w.width/2]);}
  const B=await import('/src/sim/world/baked.ts'),baked=B.loadBakedWorld(await (await fetch('/world/collision-w4.json')).json());
  const gpu=f.terrain.probe(window.app.engine.renderer,pts);let server=0,twin=0,bake=0;
  pts.forEach(([x,z],i)=>{const h=g.world.heightAt(x,z);server=Math.max(server,Math.abs(baked.heightAt(x,z)-h));twin=Math.max(twin,Math.abs(gpu[i][0]-h));bake=Math.max(bake,Math.abs(gpu[i][1]-h));});
  const stats=f.root.getObjectByName('world4-snow-paving').userData.stats;
  return {sameAsFrontier,npcAt,townDiff,onWay:onWay.slice(0,6),onWayN:onWay.length,lampsOnStone,posts,trapped:trapped.slice(0,6),trappedN:trapped.length,openCells,
   ground:{points:pts.length,server,twin:+twin.toExponential(2),bake:+bake.toFixed(4)},stats,ways:P.FROST_WAYS.map(w=>w.id)};
 });
 console.log(JSON.stringify(r));
 assert.deepEqual(r.sameAsFrontier,[0,0,0],'no Frostlight resident stands where World V or VI puts one');
 assert.ok(r.npcAt.every(d=>d<.6),`the residents stand on their plan points: ${JSON.stringify(r.npcAt)}`);
 assert.ok(r.townDiff,'Frostlight\'s townsfolk follow its own plan');
 assert.equal(r.onWayN,0,`nothing solid on a street, lane or road: ${JSON.stringify(r.onWay)}`);
 assert.deepEqual(r.lampsOnStone,[],'every lamp post stands off the stones');
 for(const [i,q] of r.posts.entries()){assert.ok(q.edge>=2.5&&q.edge<=5,`guide lantern ${'abc'[i]} stands ${q.edge} m off the paved edge`);assert.ok(q.facesRoad,`guide lantern ${'abc'[i]} looks over the road`);}
 assert.ok(r.openCells>15000&&r.trappedN===0,`every open village cell reachable from the arrival (${r.openCells} open): ${JSON.stringify(r.trapped)}`);
 assert.ok(r.ground.server<1e-9&&r.ground.twin<2e-3&&r.ground.bake<.04,`server, baked and GPU ground agree along every way: ${JSON.stringify(r.ground)}`);
 assert.ok(r.stats.maxPerTile<=16&&r.stats.pads===5,`paving tiles: ${JSON.stringify(r.stats)}`);
 console.log(`PASS Frostlight's own plan: ${r.ways.length} ways, residents off the frontier grid, ${r.openCells} open village cells all reachable, nothing solid on the stones, lanterns ${r.posts.map(q=>q.edge).join('/')} m off the edge, ground agrees at ${r.ground.points} points`);
 await shot(p,'tmp/qa/snow-layout-village.png',[2,95,63],[0,0,62]);
 await shot(p,'tmp/qa/snow-layout-road.png',[24,60,-2],[0,0,0]);
 await shot(p,'tmp/qa/snow-layout-gate.png',[1.5,3.2,40],[-1,2.5,22]);
 await p.close();
 const low=await load('low');
 const lr=await low.evaluate(()=>{const g=window.app.current.game,f=g.world2.fourth,ren=window.app.engine.renderer,surf=f.root.getObjectByName('frostlight-paving-surface');return {quality:window.app.engine.quality,stats:f.root.getObjectByName('world4-snow-paving').userData.stats,lots:f.village.group.userData.village.lots};});
 await shot(low,'tmp/qa/snow-layout-low.png',[1.5,3.2,40],[-1,2.5,22]);
 const compiled=await low.evaluate(()=>{const f=window.app.current.game.world2.fourth,ren=window.app.engine.renderer;return !!ren.properties.get(f.root.getObjectByName('frostlight-paving-surface').material).currentProgram;});
 assert.equal(lr.quality,'low');assert.equal(lr.stats.segments,r.stats.segments);assert.equal(compiled,true,'the paving compiles at low quality');
 console.log('PASS low quality lays the same plan',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero page or shader errors');
}finally{await browser.close();}
