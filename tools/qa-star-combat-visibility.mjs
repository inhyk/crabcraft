// Real boss telegraphs, native quality buttons, and actual framebuffer coverage.
// Boss phase/position are fixtures; this does not claim a naturally won fight.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try {
 const p=await browser.newPage({viewport:{width:1280,height:800}});
 p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('cc.quality','high');localStorage.setItem('cc.hintsSeen','1');});
 await p.goto('http://127.0.0.1:5192/?screen=game');
 await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 await p.waitForFunction(()=>!document.querySelector('.loading'));
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();g.player.restoreXp(22000);g.player.unit.teleport(g.world,0,-62,Math.PI);g.follow.cut();g.follow.distance=24;g.follow.pitch=.55;const b=g.worldBoss;b.wake();b.unit.lift=0;b.engage();b.phase=2;b.unit.invulnerable=false;b.unit.targetable=true;b.nextMech=g.time+999;});
 await p.waitForTimeout(1400);
 for(const [quality,label] of [['high','높음'],['low','낮음']]) {
  await p.evaluate(()=>{const g=window.app.current.game;g.worldBoss.clearMech();g.hud.menu.show();g.hud.menu.settings();});
  await p.getByRole('button',{name:label,exact:true}).click();
  await p.getByRole('button',{name:'뒤로',exact:true}).click();
  await p.getByRole('button',{name:'계속하기',exact:true}).click();
  for(const [index,kind] of [[0,'eclipse'],[1,'nova']]) {
   const result=await p.evaluate(index=>{
    const g=window.app.current.game,b=g.worldBoss;
    // Use the same pause flag as the real solo menu, without obscuring the canvas.
    g.hud.menu.open=true;b.clearMech();b.mechIndex=index;b.startMech();g.vfx.update(.3);
    const r=g.engine.renderer,gl=r.getContext(),w=g.engine.canvas.width,h=g.engine.canvas.height;
    const capture=()=>{r.setRenderTarget(null);r.render(g.scene,g.camera);const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
    const visible=capture(),png=g.engine.canvas.toDataURL();
    for(const f of b.mech.fx)f.mesh.visible=false;
    const hidden=capture();
    for(const f of b.mech.fx)f.mesh.visible=true;
    let changed=0,green=0,purple=0;
    for(let i=0;i<visible.length;i+=4){const R=visible[i],G=visible[i+1],B=visible[i+2];if(Math.max(Math.abs(R-hidden[i]),Math.abs(G-hidden[i+1]),Math.abs(B-hidden[i+2]))<12)continue;changed++;if(G>R+20&&G>B+5)green++;if(B>G+20&&R>G+8)purple++;}
    return {kind:b.mech.kind,quality:g.engine.setting,density:g.vfx.density,buffer:[w,h],changed,green,purple,playerVisible:g.player.unit.rig.root.visible,bossVisible:b.unit.rig.root.visible,warning:document.querySelector('.msg-warn')?.textContent,png};
   },index);
   const {png,...stats}=result;
   await writeFile(`tmp/qa/star-combat-${quality}-${kind}.png`,Buffer.from(png.split(',')[1],'base64'));
   await p.locator('.mechanic-warning').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
   assert.equal(await p.locator('.mechanic-warning').evaluate(el=>getComputedStyle(el).opacity),'1');
   await p.screenshot({path:`tmp/qa/star-combat-${quality}-${kind}-hud.png`});
   console.log('FRAMEBUFFER',stats);
   assert.equal(result.kind,kind);assert.equal(result.quality,quality);assert.equal(result.density,quality==='low'?.55:1);
   assert.ok(result.warning?.length>10,JSON.stringify(stats));
   assert.equal(result.playerVisible,true);assert.equal(result.bossVisible,true);
   assert.ok(result.changed>1000,JSON.stringify(stats));assert.ok(result.purple>300,JSON.stringify(stats));
   if(kind==='eclipse')assert.ok(result.green>100,JSON.stringify(stats));
  }
  await p.evaluate(()=>{const g=window.app.current.game;g.worldBoss.clearMech();g.hud.menu.open=false;});
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: actual high/low settings preserve visibly distinct Eclipse safe/danger colours and Nova danger area with player/boss present; no page errors');
}finally{await browser.close();}
