import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Snow Path QA'}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');});
 await p.goto((process.env.CC_QA_BASE??'http://127.0.0.1:5220')+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.multiplayer.connect('create');g.journey.firstEndingSeen=true;g.ending.cancel();g.creatorTravel=true;g.god=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!!window.app.current.game.multiplayer.room);
 const result=await p.evaluate(()=>{
  const g=window.app.current.game,u=g.player.unit,basin=g.scene.getObjectByName('snow-fountain-basin'),spike=g.scene.getObjectByName('snow-fountain-sculpture'),routes=[];
  for(const z of [38,56,74]){
   u.teleport(g.world,-22,z);let blocked=false;
   for(let x=-21.75;x<=22;x+=.25){u.moveTo(g.world,x,z,.05);if(Math.hypot(u.pos.x-x,u.pos.z-z)>.05){blocked=true;break;}}
   routes.push({z,blocked});
  }
  u.teleport(g.world,0,90);let mainBlocked=false;
  for(let z=89.75;z>=-45;z-=.25){u.moveTo(g.world,0,z,.05);if(Math.hypot(u.pos.x,u.pos.z-z)>.05){mainBlocked=true;break;}}
  const at=u.pos.clone();at.set(-13,0,65);const out=g.world.resolveCollision(-12.5,65,u.radius,{set(x,y){this.x=x;this.y=y;return this;}});
  const solid=Math.hypot(out.x+12.5,out.y-65)>1;
  u.teleport(g.world,0,73,Math.PI);g.follow.cut();g.follow.yaw=0;
  return {basin:basin?.position.toArray(),spike:spike?.position.toArray(),routes,mainBlocked,solid};
 });
 assert.deepEqual(result.basin?.filter((_,i)=>i!==1),[-13,65]);assert.deepEqual(result.spike?.filter((_,i)=>i!==1),[-13,65]);
 assert.ok(result.routes.every(r=>!r.blocked),JSON.stringify(result));assert.equal(result.mainBlocked,false);assert.equal(result.solid,true);
 await p.waitForTimeout(1200);await p.screenshot({path:'tmp/qa/snow-fountain-moved.png'});assert.deepEqual(errors,[]);console.log('PASS moved snow fountain, all three cross streets and main road pass actual player collision; new fountain stays solid; zero browser errors',JSON.stringify(result));
}finally{await browser.close()}
