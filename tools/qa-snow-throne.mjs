// Frostlight's story landmarks: Boreas's throne and the glacial citadel behind the arena (dressed granite, ice
// crowns, slate roofs, frozen banners, aurora windows), the crowned arena pillars, Mira's grown-ice prison, the
// hunter's lean-to, the ice overlook, the aurora ridge stones and the processional way. Asserts the structure,
// that no placeholder primitive is left in those places, that the solids are solid while the arena disc, the
// road and every quest point stay open, zero page and shader errors, and that the low-quality page builds the
// same. Writes tmp/qa/snow-throne*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|merge|geometr|frost|throne|prison/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Throne walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:240000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>{const w=window.app.current.game.world2;return w.chapter===4&&!document.querySelector('.loading')&&!!w.fourth.village&&!!w.fourth.root.getObjectByName('frostlight-aurora-sites');},null,{timeout:240000});await p.waitForTimeout(2000);return p;
}
async function shot(p,path,cam,at){
 await p.evaluate(([cam,at])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,cam[0]+3,cam[2]+3,Math.PI);
  const c=[cam[0],h(cam[0],cam[2])+cam[1],cam[2]],t=[at[0],h(at[0],at[2])+at[1],at[2]];g.follow.update=function(){this.camera.position.set(...c);this.camera.lookAt(...t);};},[cam,at]);
 await p.waitForTimeout(1500);await p.screenshot({path});
}
const inspect=async p=>p.evaluate(async()=>{
 const g=window.app.current.game,w=g.world2.fourth,L=await import('/src/game/frostThroneLayout.ts'),Q=await import('/src/sim/data/quests.ts');
 const root=w.root.getObjectByName('frostlight-throne-citadel'),sites=w.root.getObjectByName('frostlight-aurora-sites'),prison=w.prison;
 const names=o=>{const out=[];o?.traverse(c=>{if(c.isMesh||c.isPoints)out.push(c.name);});return out;};
 // Placeholder primitives (three's stock box, cone, cylinder, torus, octahedron, sphere) anywhere in the lane's
 // places: north of the arena's centre line, on the arena and its pillar ring, the prison, and round each site.
 // Two shared systems are not this lane's scenery and are left out: the travel gates and the quest markers.
 const prim=[],at=new (w.root.position.constructor)();
 const shared=o=>{for(let q=o;q&&q!==w.root;q=q.parent)if(q.name.includes('→')||q.name==='Island village requests')return true;return false;};
 const near=(x,z)=>z<-78||Math.hypot(x-L.ARENA.x,z-L.ARENA.z)<L.ARENA.r+6||Math.hypot(x+50,z-26)<12||Math.hypot(x-61,z-22)<12||Math.abs(x)<14&&z<-24&&z>-56;
 w.root.updateMatrixWorld(true);
 w.root.traverse(o=>{if(!o.isMesh||!/^(Box|Cone|Cylinder|Torus|Octahedron|Sphere)Geometry$/.test(o.geometry.type)||shared(o))return;o.getWorldPosition(at);if(near(at.x,at.z))prim.push(`${o.name||'?'}:${o.geometry.type}@${at.x.toFixed(0)},${at.z.toFixed(0)}`);});
 const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};
 const free=(x,z,r)=>{w.collision.resolve(x,z,r,out);return Math.hypot(out.x-x,out.y-z)<.05;};
 // Solid where something stands.
 const S=L.SHELTER,O=L.OVERLOOK,st=L.ridgeStones()[0],pil=L.arenaPillars()[0];
 const solidAt={throne:[0,L.THRONE.z],wall:[10,L.CITADEL.wall.z-1],gate:[0,L.CITADEL.gate.z-.5],tower:[L.CITADEL.towers[0].x,L.CITADEL.towers[0].z],pillar:[pil.x,pil.z],
  leanTo:[S.x-Math.sin(S.yaw)*1.3,S.z-Math.cos(S.yaw)*1.3],fire:[S.fire.x,S.fire.z],parapet:[O.x+Math.cos((O.a0+O.a1)/2)*O.r,O.z+Math.sin((O.a0+O.a1)/2)*O.r],ridgeStone:[st.x,st.z],
  obelisk:[L.PROCESSION.obelisk.x,L.PROCESSION.obelisk.z],standard:[L.PROCESSION.side,L.PROCESSION.standards[0]]};
 // A little off each centre: a circle cannot push out a point that sits exactly on its centre.
 const notSolid=Object.entries(solidAt).filter(([,[x,z]])=>free(x+.13,z+.07,.3)).map(([n])=>n);
 // Open: no collider of this lane comes within reach of any quest point (the server resolves them with radius 1;
 // the lane keeps 4 m), the visit and seal points are open in the whole world, and so are the arena disc and the
 // road from the village to the arena gate.
 const C=await import('/src/world/collision.ts');
 const lane=new C.Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:(x,z)=>g.world.heightAt(x,z)});
 L.registerFrostThrone(lane);for(const q of L.arenaPillars())lane.addCircle(q.x,q.z,1.9);
 const laneFree=(x,z,r)=>{lane.resolve(x,z,r,out);return Math.hypot(out.x-x,out.y-z)<.05;};
 const blockedPoints=Object.entries(Q.SNOW_POINTS).filter(([,[x,z]])=>!laneFree(x,z,4)).map(([n])=>n);
 const storyPoints=Object.entries(Q.SNOW_POINTS).filter(([n])=>/visit|seal/.test(n)).filter(([,[x,z]])=>!free(x,z,1)).map(([n])=>n);
 const disc=[];for(let x=-21;x<=21;x+=1.5)for(let z=-99;z<=-57;z+=1.5)if(Math.hypot(x,z+78)<=21.5&&!free(x,z,.5))disc.push([x,z]);
 // The road from the village gate to the arena gate (snowLayout.ts), across its paved width.
 const P=await import('/src/sim/world/snowLayout.ts'),road=[];
 for(const wy of P.FROST_ROAD_WAYS)for(let k=1;k<wy.points.length;k++){const [ax,az]=wy.points[k-1],[bx,bz]=wy.points[k],Lk=Math.hypot(bx-ax,bz-az),nx=(bz-az)/Lk,nz=-(bx-ax)/Lk;
  for(let t=0;t<1;t+=.5/Lk)for(let d=-(wy.width/2-.5);d<=wy.width/2-.5+1e-9;d+=.5){const x=ax+(bx-ax)*t+nx*d,z=az+(bz-az)*t+nz*d;if(!free(x,z,.3))road.push([+x.toFixed(1),+z.toFixed(1)]);}}
 return {throne:root?.userData.throne,prison:prison.userData.prison,sites:sites?.userData.sites,prim,notSolid,blockedPoints,storyPoints,disc:disc.length,discAt:disc.slice(0,4),road:road.length,roadAt:road.slice(0,4),
  throneMeshes:names(root),prisonMeshes:names(prison),siteMeshes:names(sites),prisonName:prison.name,prisonVisible:prison.visible};
});
try{
 const p=await load('high');
 const r=await inspect(p);
 console.log(JSON.stringify({...r,throneMeshes:r.throneMeshes.length,siteMeshes:r.siteMeshes.length}));
 const t=r.throne;
 assert.ok(t.blocks>3000,`${t.blocks} dressed blocks`);assert.ok(t.farTriangles<t.nearTriangles/10,`far LOD ${t.farTriangles} of ${t.nearTriangles} triangles`);assert.ok(t.crystals>150,`${t.crystals} crystals`);assert.ok(t.icicles>150,`${t.icicles} icicles`);
 assert.equal(t.pillars,8,'eight crowned pillars, the ninth gave way to the throne');assert.ok(t.flames>=10,`${t.flames} cold flames`);assert.ok(t.windows>100,'aurora windows');
 assert.equal(t.roofs,8,'slate roofs on the rear towers, keep turrets and bartizans');assert.ok(t.banners>=6,`${t.banners} frozen banners`);
 for(const n of ['frostlight-citadel-granite','frostlight-citadel-granite-far','frostlight-citadel-ice','frostlight-aurora-glass','frostlight-braziers','frostlight-citadel-drifts','frostlight-cold-fire-tongues','frostlight-cold-fire-halos'])assert.ok(r.throneMeshes.includes(n),`throne has ${n}`);
 assert.ok(r.throneMeshes.some(n=>n.startsWith('frostlight-citadel-roofs:')),'kit roofs');assert.ok(r.throneMeshes.some(n=>n.startsWith('frostlight-citadel-banners:')),'kit banners');
 assert.equal(r.prisonName,'mira-ice-prison');assert.equal(r.prison.bars,10);
 for(const n of ['mira-prison-stone','mira-prison-bars','mira-prison-runes'])assert.ok(r.prisonMeshes.includes(n),`prison has ${n}`);
 assert.ok(r.sites.stones>=6&&r.sites.standards===4,JSON.stringify(r.sites));
 for(const n of ['frostlight-sites-logs','frostlight-sites-firelogs','frostlight-sites-stone','frostlight-sites-ice','frostlight-sites-brass','frostlight-sites-runes','frostlight-sites-snowcaps','frostlight-sites-fire-tongues'])assert.ok(r.siteMeshes.includes(n),`sites have ${n}`);
 assert.deepEqual(r.prim,[],'no placeholder primitive left at the throne, citadel, arena, prison or the three sites');
 assert.deepEqual(r.notSolid,[],'throne, citadel, pillars and site structures are solid');
 assert.deepEqual(r.blockedPoints,[],'no collider of this lane within 4 m of a quest point');assert.deepEqual(r.storyPoints,[],'visit and seal points open');
 assert.equal(r.disc,0,`arena disc open: ${JSON.stringify(r.discAt)}`);assert.equal(r.road,0,`road open: ${JSON.stringify(r.roadAt)}`);
 console.log(`PASS ${t.blocks} blocks, ${t.crystals} crystals, ${t.roofs} roofs, ${t.banners} banners, ${t.pillars} crowned pillars, prison of ${r.prison.bars} bars, ${r.sites.stones} ridge stones; no primitives; solids solid, points, disc and road open`);
 const programs=await p.evaluate(()=>window.app.engine.renderer.info.programs.map(q=>q.cacheKey).join('\n'));
 for(const k of ['frostlight-masonry','frostlight-night-cloth'])assert.ok(programs.includes(k),`${k} shader compiled`);
 await shot(p,'tmp/qa/snow-throne-gate.png',[2,2.6,-48],[0,8,-104]);
 await shot(p,'tmp/qa/snow-throne-vista.png',[0,8,92],[0,14,-110]);
 await shot(p,'tmp/qa/snow-throne-prison.png',[19,3.2,-53],[13,1.6,-62]);
 await shot(p,'tmp/qa/snow-throne-shelter.png',[-50.5,3.5,26.5],[-56.5,1.2,22]);
 await shot(p,'tmp/qa/snow-throne-overlook.png',[57,3,19],[64,1,25]);
 await shot(p,'tmp/qa/snow-throne-ridge.png',[0,5,-18],[0,3,-58]);
 console.log('PASS masonry and night-cloth shaders compiled; wrote tmp/qa/snow-throne-{gate,vista,prison,shelter,overlook,ridge}.png');
 await p.close();
 const low=await load('low');
 const lr=await inspect(low);
 assert.equal(lr.throne.blocks,t.blocks);assert.equal(lr.throne.roofs,8);assert.equal(lr.prison.bars,10);assert.equal(lr.sites.stones,r.sites.stones);
 assert.deepEqual(lr.prim,[]);
 await shot(low,'tmp/qa/snow-throne-low.png',[2,2.6,-48],[0,8,-104]);
 console.log('PASS low quality builds the same throne, citadel, prison and sites');
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
