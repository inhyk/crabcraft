// node tools/qa-monitor-spectator.mjs — the developer monitor's live spectator views against the real local stack:
// a throwaway Postgres, server-dist/main.mjs on 8796 with MONITOR_IPS=127.0.0.1, and `vite preview` of dist/ on 5231
// proxying /api/account and /multiplayer to it. Two real Chrome players share a public World I shard; one walks to the
// scraplings and fights. The monitor at 1920x1080 must show that player's tile as the real game (monsters, the attack)
// while neither player ever sees the observer. Run `pnpm build` first. Screenshots go to CC_QA_SHOTS (default tmp/qa).
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {mkdirSync} from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';
import {startPostgres} from '../server/node/local-postgres.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),shots=process.env.CC_QA_SHOTS??join(root,'tmp/qa'),shot=name=>join(shots,name);mkdirSync(shots,{recursive:true});
const API=8796,WEB=5231,base=`http://127.0.0.1:${WEB}`;
execFileSync(process.execPath,[join(root,'server/node/build.mjs')],{stdio:'inherit'});
const postgres=await startPostgres();
const children=[];let log='';
async function run(args,env,ready){
 const child=spawn(process.execPath,args,{cwd:root,env:{PATH:process.env.PATH,...env},stdio:['ignore','pipe','pipe']});children.push(child);
 let out='';child.stdout.on('data',d=>{out+=d;log+=d;});child.stderr.on('data',d=>{out+=d;log+=d;});
 for(const until=Date.now()+30000;!ready.test(out);await new Promise(r=>setTimeout(r,100)))if(child.exitCode!==null||Date.now()>until)throw new Error(`${args[0]} did not start:\n${out}`);
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;const errors=[];
// Uncaught errors of every frame, the spectator iframes included, kept where the page can be asked for them.
const trap=()=>{window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason?.message??e.reason)));};
async function frameErrors(p){const out=[];for(const f of p.frames()){try{out.push(...await f.evaluate(()=>window.__qaErrors??[]));}catch{/* detached */}}return out;}
async function player(name,classId){
 const p=await browser.newPage({viewport:{width:1280,height:720}});p.on('pageerror',e=>errors.push(`${name}: ${e.message}`));await p.addInitScript(trap);
 await p.addInitScript(({name,classId})=>{if(localStorage.getItem('cc.qaSeeded'))return;localStorage.setItem('cc.qaSeeded','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId,shell:0,crest:0,led:0,name}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','low');},{name,classId});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.waitForFunction(()=>window.app.current.game.multiplayer.shard,null,{timeout:30000});
 return p;
}
const game=(p,fn,arg)=>p.evaluate(fn,arg);
try{
 await run([join(root,'server-dist/main.mjs')],{PORT:String(API),HOST:'127.0.0.1',DATABASE_URL:postgres.url,MONITOR_IPS:'127.0.0.1'},/listening on/);
 await run([join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',String(WEB),'--strictPort'],{CC_SERVER_URL:`http://127.0.0.1:${API}`},new RegExp(String(WEB)));
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows']});
 // Two players in one public World I shard; the fighter entered first, so its browser runs the shard's monsters.
 const fighter=await player('Spectated Fighter','warrior'),friend=await player('Second Crab','mage');
 const shard=await game(fighter,()=>window.app.current.game.multiplayer.shard);
 assert.match(shard,/^W1[0-9A-F]{4}$/);assert.equal(await game(friend,()=>window.app.current.game.multiplayer.shard),shard);
 const fighterId=await game(fighter,()=>window.app.current.game.multiplayer.ownId);
 await fighter.waitForFunction(()=>window.app.current.game.multiplayer.battle.authority);
 console.log(`PLAYERS_IN_SHARD ${shard} fighter=${fighterId}`);

 // The wall: both players' tiles start their live views.
 const monitor=await browser.newPage({viewport:{width:1920,height:1080}});monitor.on('pageerror',e=>errors.push(`monitor: ${e.message}`));await monitor.addInitScript(trap);
 await monitor.goto(base+'/monitor/');
 await monitor.waitForFunction(()=>document.querySelectorAll('.tile').length===2,null,{timeout:30000});
 await monitor.waitForFunction(()=>document.querySelectorAll('.tile iframe.feed').length===2,null,{timeout:30000});
 await monitor.waitForFunction(()=>document.querySelectorAll('.tile.live-feed').length===2,null,{timeout:240000});
 const tile=monitor.locator(`#player-${fighterId}`),view=monitor.frames().find(f=>f.url().includes(`follow=${fighterId}`));
 assert.ok(view,'the fighter tile has its spectator frame');
 assert.equal(await view.evaluate(()=>window.app.current.game.multiplayer.battle.authority),false);
 // Only the canvas shows inside a live view.
 assert.deepEqual(await view.evaluate(()=>[...document.querySelectorAll('#app > *, body > :not(#app)')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.tagName+'.'+e.className)),['CANVAS.cc-canvas']);
 console.log('LIVE_VIEWS_READY_CANVAS_ONLY_PASS');

 // The fighter walks to the nearest scrapling and fights it.
 const target=await game(fighter,()=>{const g=window.app.current.game;g.god=true;const p=g.player.unit;
  const e=g.enemies.filter(e=>e.kind==='scrapling'&&!e.isAdd&&e.unit.alive&&!e.unit.hidden).sort((a,b)=>a.unit.pos.distanceTo(p.pos)-b.unit.pos.distanceTo(p.pos))[0];
  const u=e.unit,dx=p.pos.x-u.pos.x,dz=p.pos.z-u.pos.z,d=Math.hypot(dx,dz)||1;
  p.teleport(g.world,u.pos.x+dx/d*7,u.pos.z+dz/d*7,Math.atan2(-dx,-dz));g.follow.yaw=p.yaw+Math.PI;g.follow.cut();
  return g.enemies.indexOf(e);});
 await sleep(1500);
 await fighter.keyboard.down('KeyW');await sleep(900);await fighter.keyboard.up('KeyW');
 assert.ok(await game(fighter,i=>{const g=window.app.current.game,u=g.enemies[i].unit;g.player.unit.setYaw(Math.atan2(u.pos.x-g.player.unit.pos.x,u.pos.z-g.player.unit.pos.z));g.player.setTarget(u);return g.player.target===u;},target));
 // Sample the live view while the fight goes on: the monsters in its camera, the attack clip on the fighter's crab, hits landing.
 const seen={monsters:0,actions:new Set(),hurt:false,shots:0};
 const before=await view.evaluate(i=>window.app.current.game.enemies[i].unit.hp,target);
 for(let i=0;i<14;i++){
  await fighter.keyboard.press(['Digit1','Digit2','Digit1','Digit3'][i%4]);
  await sleep(350);
  const s=await view.evaluate(i=>{const g=window.app.current.game,me=g.multiplayer.peerUnit(g.spectator.follow);
   const inView=u=>{const v=u.pos.clone();v.y+=u.height*.5;v.project(g.camera);return Math.abs(v.x)<1&&Math.abs(v.y)<1&&v.z<1;};
   return {monsters:g.units.filter(u=>u.hostile&&u.alive&&!u.hidden&&u.rig.root.visible&&inView(u)).length,action:me?.motion.action??null,hp:g.enemies[i].unit.hp,alive:g.enemies[i].unit.alive,followed:!!me&&inView(me)};},target);
  seen.monsters=Math.max(seen.monsters,s.monsters);if(s.action)seen.actions.add(s.action);if(s.hp<before||!s.alive)seen.hurt=true;
  if(s.action&&/attack|cast/.test(s.action)&&s.monsters&&seen.shots<2){await monitor.screenshot({path:shot(seen.shots?'monitor-spectator-attack-2.png':'monitor-spectator-attack.png')});await tile.screenshot({path:shot('monitor-spectator-fighter-tile.png')});seen.shots++;}
  assert.ok(s.followed,'the follow camera keeps the fighter in frame');
 }
 console.log(`SPECTATOR_SAMPLES monsters<=${seen.monsters} actions=${[...seen.actions].join(',')} hurt=${seen.hurt}`);
 assert.ok(seen.monsters>=1,'monsters are visible in the fighter tile');
 assert.ok([...seen.actions].some(a=>/attack|cast/.test(a)),'the fighter attack clip plays in the live view');
 assert.ok(seen.hurt,'the fighter hits reach the live view');
 assert.ok(seen.shots>=1,'a screenshot caught the attack');
 await monitor.screenshot({path:shot('monitor-spectator-wall.png')});
 console.log('MONSTERS_AND_ATTACK_IN_LIVE_VIEW_PASS');

 // Neither player ever sees the observer: one other crab each, nobody joined, rosters of two.
 for(const [p,other] of [[fighter,'Second Crab'],[friend,'Spectated Fighter']]){
  const r=await game(p,()=>{const g=window.app.current.game;return {remotes:g.units.filter(u=>u.kind==='remote').map(u=>u.name),peers:g.multiplayer.peers.size,roster:document.querySelector('.mp-roster')?.textContent??''};});
  assert.deepEqual(r.remotes,[other]);assert.equal(r.peers,1);assert.match(r.roster,/^2\/8/);
 }
 await fighter.screenshot({path:shot('monitor-spectator-player-fighter.png')});await friend.screenshot({path:shot('monitor-spectator-player-friend.png')});
 console.log('PLAYERS_NEVER_SEE_OBSERVER_PASS');
 // The monitor polls and its views draw only while it is the page on screen, as on the TV.
 await monitor.bringToFront();

 // The fighter travels to World II: a new shard and, since travel reconnects, a new relay id under the same name.
 // The same tile keeps the same live view, which follows into the new world without reloading.
 await view.evaluate(()=>{window.__qaSameDocument=true;});
 await game(fighter,()=>{const g=window.app.current.game;g.creatorTravel=true;g.world2.go(2);});
 await fighter.waitForFunction(()=>/^W2/.test(window.app.current.game.multiplayer.shard??''),null,{timeout:30000});
 const shard2=await game(fighter,()=>window.app.current.game.multiplayer.shard),fighterId2=await game(fighter,()=>window.app.current.game.multiplayer.ownId);
 assert.notEqual(fighterId2,fighterId);
 await monitor.waitForFunction(([id,s])=>document.querySelector(`#player-${id} .player-meta`)?.textContent.includes(s),[fighterId2,shard2],{timeout:15000,polling:200});
 await view.waitForFunction(([s,id])=>{const g=window.app.current.game;return g.multiplayer.shard===s&&g.spectator.follow===id&&g.world2.chapter===2&&!!g.multiplayer.peerUnit(id);},[shard2,fighterId2],{timeout:60000,polling:200});
 await monitor.waitForFunction(id=>document.querySelector(`#player-${id}`)?.classList.contains('live-feed'),fighterId2,{timeout:30000,polling:200});
 assert.equal(await view.evaluate(()=>window.__qaSameDocument),true,'the live view was not reloaded');
 assert.equal(await monitor.locator('.tile').count(),2);assert.equal(await monitor.locator('.tile iframe.feed').count(),2);
 await sleep(1500);await monitor.locator(`#player-${fighterId2}`).screenshot({path:shot('monitor-spectator-world2-tile.png')});
 console.log(`FOLLOWS_INTO_${shard2}_WITHOUT_RELOAD_PASS`);

 // A spectator page on its own follows the friend; when the friend leaves it shows NO SIGNAL.
 const friendId=await game(friend,()=>window.app.current.game.multiplayer.ownId);
 const lone=await browser.newPage({viewport:{width:960,height:540}});lone.on('pageerror',e=>errors.push(`spectator: ${e.message}`));await lone.addInitScript(trap);
 await lone.goto(`${base}/?observe=${shard}&follow=${friendId}&area=1`);
 await lone.waitForFunction(id=>window.app?.current?.game?.multiplayer?.peerUnit(id),friendId,{timeout:180000});await sleep(1500);
 await lone.screenshot({path:shot('monitor-spectator-direct.png')});
 assert.equal(await lone.locator('.cc-spectate-signal').isVisible(),false);
 await friend.close();
 await lone.locator('.cc-spectate-signal').waitFor({state:'visible',timeout:15000});
 await lone.screenshot({path:shot('monitor-spectator-no-signal.png')});
 await monitor.bringToFront();
 await monitor.waitForFunction(()=>document.querySelectorAll('.tile').length===1&&document.querySelectorAll('.tile iframe.feed').length===1,null,{timeout:15000,polling:200});
 console.log('NO_SIGNAL_AFTER_LEAVE_PASS');

 // The cap: ?live=1 runs one live view and leaves the rest to the light renderer.
 const extra=await player('Third Crab','priest');
 const capped=await browser.newPage({viewport:{width:1920,height:1080}});capped.on('pageerror',e=>errors.push(`capped monitor: ${e.message}`));await capped.addInitScript(trap);
 await capped.goto(base+'/monitor/?live=1');
 await capped.waitForFunction(()=>document.querySelectorAll('.tile').length===2,null,{timeout:30000});
 await capped.waitForFunction(()=>document.querySelectorAll('.tile iframe.feed').length===1,null,{timeout:30000});
 await sleep(1000);assert.equal(await capped.locator('.tile iframe.feed').count(),1);
 // Expanding the other tile moves the one live view to it.
 const other=await capped.locator('.tile:not(:has(iframe))').first();const otherId=await other.getAttribute('id');await other.click();
 await capped.waitForFunction(id=>!!document.querySelector(`#${id} iframe.feed`)&&document.querySelectorAll('.tile iframe.feed').length===1,otherId,{timeout:15000});
 await capped.screenshot({path:shot('monitor-spectator-capped.png')});
 await extra.close();
 console.log('LIVE_CAP_AND_EXPANDED_TILE_PASS');

 for(const p of [fighter,monitor,lone,capped])errors.push(...(await frameErrors(p)).map(m=>`frame: ${m}`));
 assert.deepEqual(errors,[]);
 console.log('PASS live spectator views show monsters and the fight; observers stay invisible; NO SIGNAL on leave; cap honoured; zero page errors');
}catch(e){
 console.error(log.slice(-4000));console.error('page errors:',errors);
 for(const p of browser?.contexts().flatMap(c=>c.pages())??[])try{console.error(p.url(),await p.evaluate(()=>({wall:document.querySelector('#wall')?.innerText.slice(0,600),shard:window.app?.current?.game?.multiplayer?.shard,errors:window.__qaErrors})));}catch{/* closed */}
 throw e;}
finally{await browser?.close();for(const c of children)c.kill('SIGTERM');postgres.stop();}
