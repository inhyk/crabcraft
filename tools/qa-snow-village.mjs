// Frostlight village: kit houses on every layout lot (with a tavern, a chapel, a forge and the gate's watchtower), lamp posts, props,
// snowmen, string lights and snow on roofs; nothing primitive left in the village frame; NPCs, spawn, arrival and
// the portal stand in the open and every NPC is reachable on foot from the arrival; paving stays clear; the
// low-quality page loads the same village. Writes tmp/qa/snow-village*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|merge|geometr/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Village walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:240000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading')&&!!window.app.current.game.world2.fourth.village,null,{timeout:240000});await p.waitForTimeout(2000);return p;
}
async function shot(p,path,cam,at){
 await p.evaluate(([cam,at])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,0,20,Math.PI);
  const c=[cam[0],h(cam[0],cam[2])+cam[1],cam[2]],t=[at[0],h(at[0],at[2])+at[1],at[2]];g.follow.update=function(){this.camera.position.set(...c);this.camera.lookAt(...t);};},[cam,at]);
 await p.waitForTimeout(1500);await p.screenshot({path});
}
try{
 const p=await load('high');
 const r=await p.evaluate(async()=>{const g=window.app.current.game,w=g.world2.fourth,v=w.village;
  const L=await import('/src/game/snowVillageLayout.ts'),P=await import('/src/sim/world/snowLayout.ts');
  const info=v.group.userData.village;
  // Kit batches: one draw per kit material, holding real kit geometry.
  const homes=v.group.children.find(o=>o.name==='frostlight-homes');let kitVerts=0,kitDraws=0;homes?.traverse(o=>{if(o.isMesh){kitDraws++;kitVerts+=o.geometry.getAttribute('position').count;}});
  // No box, cone or cylinder may stand anywhere in the village frame. Two shared systems are not scenery and
  // are left out: the travel gates (StarPortal, named for their route) and the quest markers (DawnRequests).
  const prim=[],box=new (w.root.position.constructor)();
  const shared=o=>{for(let q=o;q&&q!==w.root;q=q.parent)if(q.name.includes('→')||q.name==='Island village requests')return true;return false;};
  w.root.updateMatrixWorld(true);
  w.root.traverse(o=>{if(!o.isMesh||!/^(Box|Cone|Cylinder)Geometry$/.test(o.geometry.type)||shared(o))return;o.getWorldPosition(box);if(Math.abs(box.x)<46&&box.z>18&&box.z<100)prim.push(`${o.name||'?'}:${o.geometry.type}`);});
  // Open ground: resolveCollision leaves the point where it is.
  const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};
  const free=(x,z,rad)=>{g.world.resolveCollision(x,z,rad,out);return Math.hypot(out.x-x,out.y-z)<.05;};
  const npcs=P.FROST_NPCS.map(n=>[n.x,n.z]),walks=P.FROST_TOWN_POINTS.map(([x,z])=>[x,z]);
  const named={spawn:[-12,90],arrival:[0,82],portal:[14,84],...Object.fromEntries(npcs.map(([x,z])=>[`npc(${x},${z})`,[x,z]])),...Object.fromEntries(walks.map(([x,z])=>[`townsfolk(${x},${z})`,[x,z]]))};
  const blockedPoints=Object.entries(named).filter(([,[x,z]])=>!free(x,z,.6)).map(([n])=>n);
  // Paving: every street and lane of the plan (snowLayout.ts) is clear from kerb to kerb, and its centre line for the
  // player's own body from end to end.
  const body=g.player.unit.radius,paving=[];
  for(const w of P.FROST_WAYS.filter(w=>w.points.some(([,z])=>z>24)))for(let k=1;k<w.points.length;k++){const [ax,az]=w.points[k-1],[bx,bz]=w.points[k],L2=Math.hypot(bx-ax,bz-az),nx=(bz-az)/L2,nz=-(bx-ax)/L2;
   for(let t=0;t<1;t+=.5/L2){const cx=ax+(bx-ax)*t,cz=az+(bz-az)*t;for(let d=-(w.width/2-.5);d<=w.width/2-.5+1e-9;d+=.5)if(!free(cx+nx*d,cz+nz*d,.3))paving.push([w.id,+(cx+nx*d).toFixed(1),+(cz+nz*d).toFixed(1)]);if(!free(cx,cz,body))paving.push([w.id,+cx.toFixed(1),+cz.toFixed(1),'body']);}}
  // Flood fill on a 0.5 m grid from the arrival: every NPC must be reachable on foot by a crab-sized body.
  const S=.5,X0=-46,Z0=18,NX=185,NZ=165,open=new Uint8Array(NX*NZ),seen=new Uint8Array(NX*NZ);
  for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++)open[j*NX+i]=free(X0+i*S,Z0+j*S,.55)?1:0;
  const idx=(x,z)=>Math.round((z-Z0)/S)*NX+Math.round((x-X0)/S);
  const q=[idx(0,82)];seen[q[0]]=1;
  while(q.length){const k=q.pop(),i=k%NX,j=(k-i)/NX;for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=i+di,b=j+dj;if(a<0||b<0||a>=NX||b>=NZ)continue;const n=b*NX+a;if(!seen[n]&&open[n]){seen[n]=1;q.push(n);}}}
  const unreachable=[...npcs,...walks].filter(([x,z])=>!seen[idx(x,z)]).map(([x,z])=>`${x},${z}`);
  // Every open cell of the village is reachable from the arrival: a player restored or pushed out anywhere walks home.
  let trapped=0;for(let n=0;n<NX*NZ;n++)if(open[n]&&!seen[n]){const x=X0+(n%NX)*S,z=Z0+Math.floor(n/NX)*S;if(Math.abs(x)<44&&z>26&&z<96)trapped++;}
  const kinds=[...new Set(L.SNOW_LOTS.map(l=>l.kind))].sort();
  return {info,kinds,lots:L.SNOW_LOTS.length,lamps:L.snowLamps().length,props:L.snowProps().length,snowmen:L.SNOW_SNOWMEN.length,kitDraws,kitVerts,prim,blockedPoints,paving:paving.slice(0,8),pavingBlocked:paving.length,unreachable,trapped,
   names:v.group.children.map(o=>o.name).sort()};});
 console.log(JSON.stringify(r));
 assert.deepEqual(r.kinds,['chapel','forge','house','tavern','tower']);
 assert.equal(r.info.lots,r.lots);assert.ok(r.lots>=15,`${r.lots} lots`);
 assert.ok(r.info.roofs>=r.lots,`a snow cap per roof: ${r.info.roofs}`);assert.ok(r.info.chimneys>=r.lots,`${r.info.chimneys} chimneys`);
 assert.equal(r.info.lamps,r.lamps);assert.ok(r.lamps>=16,`${r.lamps} lamp posts`);
 assert.equal(r.info.props,r.props);assert.ok(r.props>=40,`${r.props} props`);
 assert.equal(r.info.snowmen,r.snowmen);assert.ok(r.info.garlands>=3&&r.info.bulbs>=100,`${r.info.garlands} light strings, ${r.info.bulbs} bulbs`);
 assert.ok(r.info.icicles>200,`${r.info.icicles} icicles`);assert.ok(r.info.woodpiles>=4);
 assert.ok(r.kitDraws>=10&&r.kitVerts>100000,`kit houses: ${r.kitDraws} draws, ${r.kitVerts} vertices`);
 for(const n of ['frostlight-homes','frostlight-roof-snow','frostlight-wall-drifts','frostlight-icicles','frostlight-lamp-posts','frostlight-props','frostlight-chimney-smoke','frostlight-string-lights','frostlight-snowmen-and-cables'])assert.ok(r.names.includes(n),`village has ${n}`);
 assert.deepEqual(r.prim,[],'no primitive box, cone or cylinder left in the village frame');
 assert.deepEqual(r.blockedPoints,[],'NPCs, townsfolk, spawn, arrival and portal stand in the open');
 assert.equal(r.pavingBlocked,0,`paving clear: ${JSON.stringify(r.paving)}`);
 assert.deepEqual(r.unreachable,[],'every NPC and townsfolk point reachable on foot from the arrival');
 console.log(`PASS ${r.lots} kit lots (tavern, chapel, forge), ${r.lamps} lamps, ${r.props} props, ${r.snowmen} snowmen, ${r.info.bulbs} bulbs; no primitives; NPCs open and reachable; paving clear`);
 const programs=await p.evaluate(()=>window.app.engine.renderer.info.programs.map(q=>q.cacheKey).join('\n'));
 for(const k of ['snow-mass','snow-laden','frostlight-window'])assert.ok(programs.includes(k),`${k} shader compiled`);
 await shot(p,'tmp/qa/snow-village.png',[16,16,80],[-2,2,56]);
 await shot(p,'tmp/qa/snow-village-square.png',[-2,3.2,57],[-18,1.2,67]);
 await shot(p,'tmp/qa/snow-village-street.png',[2.5,2.2,33],[-3,3,58]);
 console.log('PASS snow-mass, snow-laden and window shaders compiled; wrote tmp/qa/snow-village{,-square,-street}.png');
 await p.close();
 const low=await load('low');
 await low.waitForTimeout(1000);
 const lr=await low.evaluate(()=>{const v=window.app.current.game.world2.fourth.village,info=v.group.userData.village;
  const lights=v.group.children.filter(o=>o.name==='frostlight-lamp-light');const smoke=v.group.getObjectByName('frostlight-chimney-smoke');
  return {lots:info.lots,lamps:info.lamps,lit:lights.filter(l=>l.visible).length,pool:lights.length,smoke:smoke.geometry.drawRange.count,smokeAll:smoke.geometry.getAttribute('position').count};});
 assert.ok(lr.lots>=15&&lr.lamps>=16,JSON.stringify(lr));
 assert.equal(lr.lit,1,'low quality keeps one real lantern light');assert.ok(lr.smoke<lr.smokeAll,'low quality draws half the smoke');
 await shot(low,'tmp/qa/snow-village-low.png',[16,16,80],[-2,2,56]);
 console.log('PASS low quality loads the same village with one lantern light and half the smoke',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
