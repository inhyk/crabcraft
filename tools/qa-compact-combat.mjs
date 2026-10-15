// Actual mechanics + native languages. Paused encounter/chat positions are fixtures.
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});const errors=[];
try{
 const p=await browser.newPage({viewport:{width:718,height:492}});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>{localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');});
 await p.goto('http://127.0.0.1:5192/?screen=game');await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.restoreXp(22000);});
 const cases=[['worldBoss',1,1,'eclipse'],['worldBoss',1,2,'nova'],['worldBoss',2,2,'undertow'],['worldBoss',1,0,'slam'],['boss',1,1,'spray'],['finalBoss',1,1,'nova']];let overlaps=0;
 for(const [language,label] of [['ko','한국어'],['en','English']]){
  await p.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await p.getByRole('button',{name:label,exact:true}).click();await p.getByRole('button',{name:language==='ko'?'뒤로':'Back',exact:true}).click();await p.getByRole('button',{name:language==='ko'?'계속하기':'Resume',exact:true}).click();
  for(const [id,phase,index,kind] of cases){
   await p.evaluate(({id,phase,index})=>{const g=window.app.current.game;for(const b of [g.boss,g.finalBoss,g.worldBoss])b.sleep();if(id==='worldBoss')g.world2.enter();else{g.world2.returnToShore();g.setLighthouse(true);}g.hud.menu.open=true;g.hud.menu.el.classList.add('hidden');g.hud.bubbles.clear();const b=g[id];g.player.unit.teleport(g.world,b.arena.position.x,b.arena.position.z+13,Math.PI);g.follow.distance=24;g.follow.pitch=.55;g.follow.cut();b.wake();b.unit.lift=0;b.engage();b.phase=phase;b.unit.invulnerable=false;b.unit.targetable=true;b.mechIndex=index;b.startMech();g.vfx.update(.2);g.say(g.player.unit,'Party ready');g.hud.chat.say('Friend','I am on my way to the boss. Please wait for everyone to arrive before starting.');g.hud.chat.say('Friend','The green circle is safe. Meet me near the arena and we will fight together.');},{id,phase,index});
   for(const [width,height] of [[640,492],[718,492],[890,620],[1280,800]]){
    await p.setViewportSize({width,height});await p.waitForFunction(()=>{const c=window.app.current.game.engine.canvas;return c.clientWidth===innerWidth&&c.clientHeight===innerHeight;});await p.locator('.bf').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));await p.locator('.mechanic-warning').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const layout=await p.evaluate(()=>{
     const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
     const warning=rect('.mechanic-warning'),chat=rect('.chat'),boss=rect('.bf'),map=rect('.mm-ring'),action=rect('.ab');const intersect=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
     const bubbles=window.app.current.game.hud.bubbles.list;return {kind:window.app.current.game.encounter.mechName,warning,chat,boss,map,action,warningChat:intersect(warning,chat),warningBoss:intersect(warning,boss),warningMap:intersect(warning,map),warningAction:intersect(warning,action),bossBubble:bubbles.filter(b=>b.unit.kind==='boss').map(b=>getComputedStyle(b.el).visibility),playerBubble:bubbles.filter(b=>b.unit.kind==='player').map(b=>({visibility:getComputedStyle(b.el).visibility,display:getComputedStyle(b.el).display})),warningText:document.querySelector('.mechanic-warning').textContent};
    });
    console.log('COMPACT_MECHANIC',language,id,kind,width,height,JSON.stringify(layout));
    if(layout.warningChat)overlaps++;
    if(!process.env.CC_QA_PROBE){assert.equal(layout.kind,kind);for(const key of ['warningChat','warningBoss','warningMap','warningAction'])assert.equal(layout[key],false,JSON.stringify({language,id,kind,width,key,layout}));assert.ok(layout.warning.x>=0&&layout.warning.right<=width&&layout.warning.y>=0&&layout.warning.bottom<=height);assert.ok(layout.bossBubble.length>0);assert.ok(layout.bossBubble.every(v=>v===(width<=900?'hidden':'visible')));assert.ok(layout.playerBubble.length>0&&layout.playerBubble.every(v=>v.visibility==='visible'&&v.display!=='none'));}
    if(kind==='eclipse'&&[640,718,1280].includes(width))await p.screenshot({path:`tmp/qa/compact-mechanics-${language}-${width}${process.env.CC_QA_PROBE?'-before':''}.png`});
   }
   // A surviving decorative yell must reappear as soon as its mechanic warning ends.
   await p.setViewportSize({width:718,height:492});await p.evaluate(()=>window.app.current.game.encounter.clearMech());await p.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));if(!process.env.CC_QA_PROBE)assert.ok(await p.evaluate(()=>window.app.current.game.hud.bubbles.list.filter(b=>b.unit.kind==='boss').every(b=>getComputedStyle(b.el).visibility==='visible')));
  }
 }
 assert.deepEqual(errors,[]);console.log(process.env.CC_QA_PROBE?`PROBE: ${overlaps} actual warning/chat overlaps recorded`:'PASS: all five mechanics across three actual bosses, two native languages and four viewports have separate warnings/chat/headers/map/action bar; only compact decorative boss yells yield temporarily, player bubble stays visible and boss yell returns after clear');
}finally{await browser.close();}
