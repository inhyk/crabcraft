// Frostlight's streets (src/sim/world/snowLayout.ts): the player walks the high street, every lane, the road out of the
// gate and the processional way to the arena gate end to end under actual collision; the frozen fountain stays
// solid at the heart of the market. Writes tmp/qa/snow-fountain-moved.png.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Snow Path QA'}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');});
 await p.goto((process.env.CC_QA_BASE??'http://127.0.0.1:5220')+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.multiplayer.connect('create');g.journey.firstEndingSeen=true;g.ending.cancel();g.creatorTravel=true;g.god=true;g.world2.go(4);});
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!!window.app.current.game.multiplayer.room);
 const result=await p.evaluate(async()=>{
  const g=window.app.current.game,u=g.player.unit,basin=g.scene.getObjectByName('snow-fountain-basin'),spike=g.scene.getObjectByName('snow-fountain-sculpture'),routes=[];
  const P=await import('/src/sim/world/snowLayout.ts');
  // Walk every way of Frostlight's plan end to end with the player's own collision: the high street, each lane, the
  // north road out of the gate and the processional way to the arena gate.
  for(const w of P.FROST_WAYS){
   const [x0,z0]=w.points[0];u.teleport(g.world,x0,z0);let blocked=null,walked=0;
   for(let k=1;k<w.points.length&&!blocked;k++){const [ax,az]=w.points[k-1],[bx,bz]=w.points[k],L=Math.hypot(bx-ax,bz-az),n=Math.ceil(L/.25);
    for(let i=1;i<=n;i++){const x=ax+(bx-ax)*i/n,z=az+(bz-az)*i/n;u.moveTo(g.world,x,z,.05);if(Math.hypot(u.pos.x-x,u.pos.z-z)>.05){blocked=[+x.toFixed(2),+z.toFixed(2)];break;}walked+=L/n;}}
   routes.push({way:w.id,walked:+walked.toFixed(1),blocked});
  }
  const end=P.FROST_PROCESSION.points.at(-1);
  const out=g.world.resolveCollision(-12.5,65,u.radius,{set(x,y){this.x=x;this.y=y;return this;}});
  const solid=Math.hypot(out.x+12.5,out.y-65)>1;
  u.teleport(g.world,-4.6,72,Math.PI);g.follow.cut();g.follow.yaw=.4;
  return {basin:basin?.position.toArray(),spike:spike?.position.toArray(),routes,end,solid};
 });
 assert.deepEqual(result.basin?.filter((_,i)=>i!==1),[-13,65]);assert.deepEqual(result.spike?.filter((_,i)=>i!==1),[-13,65]);
 assert.ok(result.routes.length>=6&&result.routes.every(r=>!r.blocked),JSON.stringify(result.routes));assert.equal(result.solid,true);
 assert.deepEqual(result.end,[0,-53],'the processional way reaches the arena gate');
 await p.waitForTimeout(1200);await p.screenshot({path:'tmp/qa/snow-fountain-moved.png'});assert.deepEqual(errors,[]);console.log(`PASS the high street, every lane, the north road and the processional way to the arena gate walk end to end under actual player collision (${result.routes.map(r=>`${r.way} ${r.walked} m`).join(', ')}); the fountain stays solid; zero browser errors`);
}finally{await browser.close()}
