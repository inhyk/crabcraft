import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5231';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});await p.waitForTimeout(1000);await p.keyboard.press('Space');return p;
}
/** Heat haze A/B on one frozen frame: rendered with the haze allowed, then barred (engine.hazeAllowed), same instant. */
async function hazeAB(p){return p.evaluate(async()=>{
 const e=window.app.current.game.engine,gl=e.renderer.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,t=e.timer,upd=t.update,get=t.getDelta;
 let dt=1/30;e.renderer.setAnimationLoop(null);t.update=()=>t;t.getDelta=()=>dt;
 const step=async()=>{await new Promise(requestAnimationFrame);e.frame();};
 const read=()=>{const px=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
 try{
  e.hazeAllowed=true;for(let i=0;i<4;i++)await step();
  const active=e.hazeActive,quality=e.quality,effects=e.fxPass.effects.map(x=>x.name),shader=e.fxPass.fullscreenMaterial.fragmentShader;
  dt=0;await step();const a=read();
  e.hazeAllowed=false;await step();await step();const b=read();
  const same=shader===e.fxPass.fullscreenMaterial.fragmentShader;
  let diff=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])diff++;
  return {active,quality,effects,sameShader:same,diffFraction:+(diff/(W*H)).toFixed(5)};
 }finally{e.hazeAllowed=true;t.update=upd;t.getDelta=get;e.renderer.setAnimationLoop(e.frame);}
});}
function checkHaze(chapter,h){
 if(chapter===5&&h.quality==='high'){
  assert.ok(h.active&&h.effects.includes('HeatHazeEffect'),`chapter 5 at high quality draws the heat haze: ${JSON.stringify(h)}`);
  assert.ok(!h.sameShader&&h.diffFraction>.001,`the heat haze moves some pixels in chapter 5: ${h.diffFraction}`);
 }else{
  assert.ok(!h.active&&!h.effects.includes('HeatHazeEffect'),`no heat haze in chapter ${chapter}: ${JSON.stringify(h)}`);
  assert.ok(h.sameShader&&h.diffFraction===0,`chapter ${chapter} renders exactly as without the haze: ${h.diffFraction}`);
 }
}
try{
 const p=await load('Frontier scenery');
 for(const chapter of [5,6]){
 await p.evaluate(chapter=>{const g=window.app.current.game;g.creatorTravel=true;g.world2.go(chapter);g.player.unit.teleport(g.world,0,83);g.follow.yaw=0;g.follow.pitch=.35;g.follow.distance=24;g.follow.cut();},chapter);
 await p.waitForTimeout(6500);await p.screenshot({path:`tmp/qa/frontier-${chapter}-village.png`});
 await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,-22);g.follow.yaw=0;g.follow.pitch=.3;g.follow.distance=24;g.follow.cut();});
 await p.waitForTimeout(1000);await p.screenshot({path:`tmp/qa/frontier-${chapter}-sanctuary.png`});
 const h=await hazeAB(p);console.log(`heat haze chapter ${chapter}`,JSON.stringify(h));checkHaze(chapter,h);
 }
 // Other worlds: no haze in the chain, and a frame with the haze allowed is pixel-identical to one with it barred.
 for(const chapter of [4,3]){
 await p.evaluate(chapter=>{const g=window.app.current.game;g.creatorTravel=true;g.world2.go(chapter);},chapter);
 await p.waitForTimeout(6500);
 const h=await hazeAB(p);console.log(`heat haze chapter ${chapter}`,JSON.stringify(h));checkHaze(chapter,h);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
