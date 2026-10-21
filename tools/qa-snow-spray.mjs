// Frostlight snow spray: walking kicks powder, running kicks more, it all settles after the crab stops, paved
// roads throw none, a monster's feet throw it too, and low quality runs a smaller pool. Writes tmp/qa/snow-spray-*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Snow runner'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:90000});await p.waitForTimeout(2500);
 // Monsters out of the way; each run gets its own lane of open snow east of the village.
 await p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);});return p;
}
const stats=p=>p.evaluate(()=>{const s=window.app.current.game.world2.fourth.spray;return {live:s.live,visible:s.mesh.visible,instances:s.mesh.geometry.instanceCount,...s.stats};});
const place=(p,x,z,yaw)=>p.evaluate(([x,z,yaw])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw);g.follow.yaw=yaw+Math.PI;g.follow.pitch=.3;g.follow.cut();},[x,z,yaw]);
// Hold keys for `ms`, sampling the live count; optionally screenshot mid-move.
async function move(p,keys,ms,shot){const a=await stats(p);for(const k of keys)await p.keyboard.down(k);let max=0;const t=Date.now();let shotDone=!shot;
 while(Date.now()-t<ms){max=Math.max(max,(await stats(p)).live);if(!shotDone&&Date.now()-t>ms*.7){await p.screenshot({path:shot});shotDone=true;}await p.waitForTimeout(80);}
 for(const k of [...keys].reverse())await p.keyboard.up(k);const b=await stats(p);return {max,emitted:b.emitted-a.emitted,kicks:b.kicks-a.kicks,onPaving:b.onPaving-a.onPaving};}
try{
 const p=await load('high');
 await place(p,30,6,Math.PI/2);await p.waitForTimeout(1500);
 const idle=await stats(p);
 assert.ok(idle.live<=5,`nothing moving, nothing in the air: ${JSON.stringify(idle)}`);
 const walk=await move(p,['w'],1800);
 assert.ok(walk.max>40&&walk.emitted>80,`walking kicks powder: ${JSON.stringify(walk)}`);
 await p.waitForTimeout(2500);const settled=await stats(p);
 assert.ok(settled.live<=5&&settled.visible===(settled.live>0),`powder settles after stopping: ${JSON.stringify(settled)}`);
 await place(p,30,12,Math.PI/2);await p.waitForTimeout(600);
 const run=await move(p,['Shift','w'],1800,'tmp/qa/snow-spray-run.png');
 assert.ok(run.max>walk.max*1.3&&run.emitted>walk.emitted*1.3,`running throws more: walk ${JSON.stringify(walk)} run ${JSON.stringify(run)}`);
 await p.waitForTimeout(2500);const settled2=await stats(p);
 assert.ok(settled2.live<=5,`run spray settles: ${JSON.stringify(settled2)}`);
 assert.equal(settled2.recycled,0,'one runner never fills the ring');
 console.log('PASS walking and running kick powder that settles',JSON.stringify({walk,run,settled:settled2.live}));
 // The processional way runs straight north on x=0 from the ring of stones; prints are hidden under paving, so is spray.
 await place(p,0,-28,Math.PI);await p.waitForTimeout(600);
 const road=await move(p,['w'],1500);
 assert.ok(road.onPaving>10&&road.emitted===0,`no spray off paving: ${JSON.stringify(road)}`);
 console.log('PASS paved road throws no spray',JSON.stringify(road));
 // A monster walking up to an idle player kicks powder too: every unit's feet feed the same emitter.
 await place(p,34,18,Math.PI/2);await p.waitForTimeout(1500);
 const before=await stats(p);
 await p.evaluate(()=>{const g=window.app.current.game;const e=g.enemies.find(e=>e.unit.alive&&!e.unit.hidden);e.unit.teleport(g.world,44,18);});
 await p.waitForTimeout(3000);const after=await stats(p);
 assert.ok(after.emitted-before.emitted>20,`monster feet kick spray: ${after.emitted-before.emitted}`);
 console.log('PASS monster footfalls kick spray',after.emitted-before.emitted);
 const lit=await p.evaluate(()=>{const g=window.app.current.game,s=g.world2.fourth.spray,u=s.mesh.material.uniforms;return {sun:u.spraySunColor.value.toArray().map(v=>+v.toFixed(3)),dir:u.spraySunDir.value.toArray().map(v=>+v.toFixed(3)),lights:s.mesh.material.lights,draws:s.mesh.isMesh&&s.mesh.geometry.isInstancedBufferGeometry};});
 // The sun only has to be above the horizon: the snow-sky sun sits low (13 degrees).
 assert.ok(lit.sun.some(v=>v>.5)&&lit.dir[1]>.05&&lit.lights&&lit.draws,`one instanced draw lit by the island sun: ${JSON.stringify(lit)}`);
 await p.close();
 const low=await load('low');
 await place(low,30,6,Math.PI/2);await low.waitForTimeout(800);
 const lr=await move(low,['Shift','w'],1800,'tmp/qa/snow-spray-low.png');
 assert.ok(lr.max>15&&lr.max<=640&&lr.max<run.max,`low quality runs a smaller pool: ${JSON.stringify(lr)}`);
 console.log('PASS low quality kicks a lighter spray',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
