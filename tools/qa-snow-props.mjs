// Frostlight quest props and gateways (frostRequests.ts, frostPortal.ts): all 21 request sites dressed in finished
// pieces, no placeholder primitive left on them or on the two Frostlight portals, posts, rune stones and piers solid
// while every quest point stays where the server resolves it and open to the player, the props change with the quest
// (a crate goes, a lantern lights, a seal goes dark), World III keeps its own look, zero page and shader errors, and
// the same on low quality. Writes tmp/qa/snow-props*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|merge|geometr|undefined|null/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Prop finder'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:240000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>{const w=window.app.current.game.world2;return w.chapter===4&&!document.querySelector('.loading')&&w.snowRequests.root.userData.frostDressed;},null,{timeout:240000});
 await p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);});
 await p.waitForTimeout(1500);return p;
}
/** Fixed camera over a site; `at` and `cam` are [x, dy, z] over the ground. */
async function shot(p,path,cam,at){
 await p.evaluate(([cam,at])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z);
  const c=[cam[0],h(cam[0],cam[2])+cam[1],cam[2]],t=[at[0],h(at[0],at[2])+at[1],at[2]];g.follow.update=function(){this.camera.position.set(...c);this.camera.lookAt(...t);};},[cam,at]);
 await p.waitForTimeout(1500);await p.screenshot({path});
}
// Everything the lane builds, and the shapes that may not be in it.
const inspect=()=>{const g=window.app.current.game,w2=g.world2,w=w2.fourth,req=w2.snowRequests;
 const gate=w.root.children.find(o=>o.name==='설원 → 잿불 군도');
 const roots={requests:req.root,spawnPortal:w.portal.root,emberGate:gate};
 const PRIM=/^(Box|Octahedron|Icosahedron|Dodecahedron|Torus|Cone|Cylinder|Sphere|Tetrahedron)Geometry$/;
 const prim=[],names=new Set();
 for(const [k,r] of Object.entries(roots))r?.traverse(o=>{if(o.name)names.add(o.name);if((o.isMesh||o.isPoints)&&PRIM.test(o.geometry.type))prim.push(`${k}:${o.name||'?'}:${o.geometry.type}`);});
 const styles={};for(const n of req.nodes){const s=n.kind.split('-')[1];styles[s]=(styles[s]??0)+1;}
 const meshes=r=>{let n=0;r?.traverse(o=>{if(o.isMesh)n++;});return n;};
 const props={};for(const l of ['a','b','c'])for(const s of ['relief','frost-blossom','guide-lantern','guide-post','frostiron','ice-pearl','guide-flame']){const o=req.root.getObjectByName(`frostlight-${s}-${l}`);props[`${s}-${l}`]=o?o.isMesh?1:meshes(o):0;}
 // World III keeps the shared placeholder look; its gate to Frostlight is still a StarPortal.
 const w3=w2.dawnRequests.nodes.map(n=>n.mesh.geometry?.type);
 return {sites:req.root.userData.frostSites,nodes:req.nodes.length,styles,props,prim,names:[...names].filter(n=>n.startsWith('frostlight-')).sort(),
  portals:[w.portal.root.userData.frostPortal,gate?.userData.frostPortal],gateAt:gate&&[gate.position.x,gate.position.z],w3:[...new Set(w3)].sort()};};
try{
 const p=await load('high');
 const r=await p.evaluate(inspect);
 console.log(JSON.stringify({...r,names:r.names.length}));
 assert.equal(r.nodes,21);assert.equal(r.sites,21);
 assert.deepEqual(r.styles,{crate:3,herb:3,lamp:3,visit:3,ore:3,pearl:3,seal:3});
 for(const [k,n] of Object.entries(r.props))assert.ok(n>0,`prop ${k} is built (${n})`);
 assert.deepEqual(r.prim,[],'no placeholder primitive on the quest props or the Frostlight portals');
 for(const n of ['frostlight-quest-stones','frostlight-quest-drifts','frostlight-pearl-shells','frostlight-pearl-ice-crystals','frostlight-seal-runes','frostlight-quest-glints','frostlight-quest-cue-glow','frostlight-lantern-pools','frostlight-quest-halos','frostlight-portal-stone','frostlight-portal-snow','frostlight-portal-ice','frostlight-portal-runes','frostlight-portal-aurora','frostlight-portal-motes'])assert.ok(r.names.includes(n),n);
 assert.deepEqual(r.portals.map(x=>x?.voussoirs),[11,11]);assert.deepEqual(r.gateAt,[14,84]);
 assert.deepEqual(r.w3,['BoxGeometry','DodecahedronGeometry','IcosahedronGeometry','OctahedronGeometry','SphereGeometry','TorusGeometry'],'World III keeps its own request shapes');
 console.log('PASS 21 sites dressed (3 each of crate, herb, lamp, visit, ore, pearl, seal), both portals carved, no placeholder primitive, World III unchanged');
 // Solid where solid; every quest point unmoved by the new solids and open to the player.
 const c=await p.evaluate(async()=>{const g=window.app.current.game,L=await import('/src/game/frostPropsLayout.ts'),Q=await import('/src/sim/data/quests.ts');
  const out={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};
  const moved=(x,z,r)=>{g.world.resolveCollision(x,z,r,out);return Math.hypot(out.x-x,out.y-z);};
  const mine=[...L.FROST_LAMP_POSTS.map(([x,z])=>[x,z,.45]),...L.FROST_SEAL_STONES.map(([x,z])=>[x,z,.6]),...L.FROST_PORTALS.flatMap(({x,z})=>[[x-L.FROST_PIER_X,z,L.FROST_PIER_R],[x+L.FROST_PIER_X,z,L.FROST_PIER_R]])];
  // A body just off each centre is pushed out to the collider's edge.
  const notSolid=mine.filter(([x,z,r])=>moved(x+.05,z,.3)<r+.3-.05-.02).map(p=>p.slice(0,2).join());
  // The server resolves each point with radius 1: none of the new solids reaches that circle, so no point moves.
  const points=Object.entries(Q.SNOW_POINTS);
  const crowded=points.filter(([,[x,z]])=>mine.some(([mx,mz,r])=>Math.hypot(x-mx,z-mz)<r+1.05)).map(([k])=>k);
  // The client's node is where the collision resolves its point, and a crab fits there.
  const nodes=g.world2.snowRequests.nodes.filter(n=>{const [x,z]=Q.SNOW_POINTS[n.kind];g.world.resolveCollision(x,z,1,out);return Math.hypot(n.position.x-out.x,n.position.z-out.y)>.01;}).map(n=>n.kind);
  const blocked=g.world2.snowRequests.nodes.filter(n=>moved(n.position.x,n.position.z,g.player.unit.radius)>.01).map(n=>n.kind);
  // The travel points stay open: spawn and the gate's centre.
  const gates=L.FROST_PORTALS.filter(({x,z})=>moved(x,z,g.player.unit.radius)>.01).map(({x,z})=>`${x},${z}`);
  return {notSolid,crowded,nodes,blocked,gates};});
 assert.deepEqual(c,{notSolid:[],crowded:[],nodes:[],blocked:[],gates:[]},JSON.stringify(c));
 console.log('PASS lantern posts, rune stones and portal piers are solid; every quest point and both travel points stay where they were and open');
 // Quest state drives the props: pending glints, a crate taken, a lantern lit by hold-F, a seal recovered.
 await p.evaluate(()=>{const g=window.app.current.game;for(const id of ['s3','s5','s11'])g.quests.status[id]='active';g.player.setTarget(null);g.player.unit.lastCombat=-100;});
 await p.waitForTimeout(300);
 const state=()=>p.evaluate(()=>{const g=window.app.current.game,req=g.world2.snowRequests,root=req.root,i=k=>req.nodes.findIndex(n=>n.kind===k);
  const glints=root.getObjectByName('frostlight-quest-glints').material.uniforms.uOn.value,runes=root.getObjectByName('frostlight-seal-runes').material.uniforms.uGlow.value,halos=root.getObjectByName('frostlight-quest-halos').material.uniforms.uOn.value;
  return {crate:root.getObjectByName('frostlight-relief-a').visible,flame:root.getObjectByName('frostlight-guide-flame-a').visible,lampHalo:halos[i('snow-lamp-a')],seal:runes[i('snow-seal-a')],
   cueCrate:glints[i('snow-crate-a')],cueOre:glints[i('snow-ore-a')],anchor:req.nodes[i('snow-lamp-a')].mesh.position.toArray().map(v=>+v.toFixed(2))};});
 const before=await state();
 assert.deepEqual({...before,anchor:undefined},{crate:true,flame:false,lampHalo:0,seal:1,cueCrate:1,cueOre:0,anchor:undefined},JSON.stringify(before));
 await shot(p,'tmp/qa/snow-props-crate.png',[-15.5,3,82.5],[-12,.6,78]);
 const go=kind=>p.evaluate(kind=>{const g=window.app.current.game,n=g.world2.snowRequests.nodes.find(n=>n.kind===kind);g.player.unit.teleport(g.world,n.position.x,n.position.z);g.player.setTarget(null);g.player.unit.lastCombat=-100;},kind);
 await go('snow-crate-a');await p.waitForTimeout(200);await p.keyboard.press('KeyF');await p.waitForTimeout(300);
 await go('snow-lamp-a');await p.waitForTimeout(200);await p.keyboard.down('KeyF');await p.waitForTimeout(1900);await p.keyboard.up('KeyF');
 await go('snow-seal-a');await p.waitForTimeout(200);await p.keyboard.press('KeyF');await p.waitForTimeout(300);
 const after=await state();
 assert.deepEqual({crate:after.crate,flame:after.flame,lampHalo:after.lampHalo,seal:after.seal,cueCrate:after.cueCrate},{crate:false,flame:true,lampHalo:1,seal:0,cueCrate:0},JSON.stringify(after));
 assert.equal(await p.evaluate(()=>['s3-1','s5-1','s11-1'].map(id=>window.app.current.game.quests.progress.get(id)).join()),'1,1,1');
 console.log('PASS pending glints, crate taken, guide lantern lit by hold-F at its lantern, aurora seal recovered and dark',JSON.stringify(before.anchor));
 await shot(p,'tmp/qa/snow-props-lantern-lit.png',[-3,2.6,29],[-8.9,1.8,24.5]);
 await shot(p,'tmp/qa/snow-props-seal-dark.png',[-12,2.2,-31],[-18.5,1.1,-34]);
 await shot(p,'tmp/qa/snow-props-portal.png',[-12,3.8,101],[-12,2.8,90]);
 await shot(p,'tmp/qa/snow-props-ore-pearl.png',[40,4,16],[36,.6,8]);
 await p.close();
 // Low quality: the same props and gates, no errors.
 const q=await load('low');
 const rl=await q.evaluate(inspect);
 assert.equal(rl.nodes,21);assert.deepEqual(rl.prim,[]);for(const [k,n] of Object.entries(rl.props))assert.ok(n>0,`low: prop ${k}`);
 assert.equal(await q.evaluate(()=>window.app.engine.quality),'low');
 await shot(q,'tmp/qa/snow-props-low.png',[-15,3.8,101],[-12,2.8,90]);
 console.log('PASS low quality builds the same props and gateways');
 assert.deepEqual(errors,[]);console.log('PASS zero page and shader errors');
}finally{await browser.close();}
