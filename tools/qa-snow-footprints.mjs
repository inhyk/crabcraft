// Frostlight snow: a crab that walks across the field leaves prints with berms in the deformation buffer,
// the ice formations replaced the cones, and the low-quality field compiles too. Writes tmp/qa/snow-*.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(30000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Snow walker'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:90000});await p.waitForTimeout(2500);return p;
}
try{
 const p=await load('high');
 // Open snow east of the village, away from the paved roads that cover the field.
 await p.evaluate(()=>{const g=window.app.current.game;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);g.player.unit.teleport(g.world,34,6,Math.PI/2);g.follow.yaw=-Math.PI/2;g.follow.pitch=.45;g.follow.cut();});
 await p.waitForTimeout(600);await p.keyboard.down('w');await p.waitForTimeout(2600);await p.keyboard.up('w');await p.waitForTimeout(700);
 const r=await p.evaluate(()=>{const g=window.app.current.game,w=g.world2.fourth,d=w.deform,ren=window.app.engine.renderer;
  // Search a strip along the walked line for the deepest print and the tallest berm.
  let dep=0,berm=0;for(let x=36;x<=48;x+=.06)for(let z=4.6;z<=7.4;z+=.06){const v=d.sample(ren,x,z);dep=Math.max(dep,v[0]);berm=Math.max(berm,v[1]);}
  const far=d.sample(ren,40,-8);
  const names=['frostlight-ice-cliffs','frostlight-arena-crystals','snow-fountain-sculpture'].map(n=>!!g.scene.getObjectByName(n));
  const spike=g.scene.getObjectByName('snow-fountain-sculpture').position;
  return {supported:d.supported,res:d.res,stamps:d.stats.stamps,dep,berm,far,names,spike:[spike.x,spike.z],pines:w.root.userData.snowPines};});
 assert.equal(r.supported,true);assert.equal(r.res,1024);
 assert.ok(r.stamps>20,`walking should stamp feet: ${JSON.stringify(r)}`);
 assert.ok(r.dep>.02&&r.berm>.005,`prints have depth and berms: ${JSON.stringify(r)}`);
 assert.ok(r.far.every(v=>v===0),`untouched snow stays flat: ${JSON.stringify(r)}`);
 assert.deepEqual(r.names,[true,true,true]);assert.deepEqual(r.spike,[-13,65]);assert.equal(r.pines,91);
 await p.evaluate(()=>{const g=window.app.current.game;g.follow.yaw=-Math.PI/2-.5;g.follow.pitch=.55;g.follow.cut();});await p.waitForTimeout(800);
 await p.screenshot({path:'tmp/qa/snow-footprints.png'});
 console.log('PASS walking crab prints the snow',JSON.stringify(r));
 await p.close();
 const low=await load('low');
 const lr=await low.evaluate(()=>({res:window.app.current.game.world2.fourth.deform.res,steps:window.app.current.game.world2.fourth.deform.stats.steps}));
 assert.equal(lr.res,512);assert.ok(lr.steps>10);
 await low.screenshot({path:'tmp/qa/snow-low.png'});
 console.log('PASS low quality runs a 512 field',JSON.stringify(lr));
 assert.deepEqual(errors,[]);console.log('PASS zero browser or shader errors');
}finally{await browser.close();}
