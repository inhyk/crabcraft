// node tools/qa-skill-fx.mjs — other players and the monitor's spectator view draw a player's skill effects, against
// the real local stack: a throwaway Postgres, server-dist/main.mjs on 8797 with MONITOR_IPS=127.0.0.1, and `vite preview`
// of dist/ on 5232 proxying /api/account and /multiplayer to it. A mage and a warrior share a public World I shard; the
// mage casts Bubble Bolt at a scrapling, then Frost Spray, Tidal Nova and Steam Blink. The warrior's game and a spectator
// view following the mage must draw the cast, the bolt in flight and each ability. Run `pnpm build` first.
// Screenshots go to CC_QA_SHOTS (default tmp/qa).
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {mkdirSync} from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {launchBrowser} from './lib/browser.mjs';
import {startPostgres} from '../server/node/local-postgres.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),shots=process.env.CC_QA_SHOTS??join(root,'tmp/qa'),shot=name=>join(shots,name);mkdirSync(shots,{recursive:true});
const API=8797,WEB=5232,base=`http://127.0.0.1:${WEB}`;
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
async function player(name,classId){
 const p=await browser.newPage({viewport:{width:1280,height:720}});p.on('pageerror',e=>errors.push(`${name}: ${e.message}`));
 await p.addInitScript(({name,classId})=>{if(localStorage.getItem('cc.qaSeeded'))return;localStorage.setItem('cc.qaSeeded','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId,shell:0,crest:0,led:0,name}));localStorage.setItem('cc.language','ko');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','low');},{name,classId});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
 await p.waitForFunction(()=>window.app.current.game.multiplayer.shard,null,{timeout:30000});
 return p;
}
const game=(p,fn,arg)=>p.evaluate(fn,arg);
// Counts, in a watching game, the effects drawn and the peer skills it was handed.
const spy=()=>{const g=window.app.current.game,fx=window.__fx={};
 for(const k of ['projectile','frostSpray','tidalNova','castMotes','steamPuff']){const f=g.vfx[k].bind(g.vfx);g.vfx[k]=(...a)=>{fx[k]=(fx[k]??0)+1;return f(...a);};}
 const r=g.sink.remote.bind(g.sink);g.sink.remote=(peer,caster,s,target)=>{const k=`remote:${s.fx}:${s.ability??s.stage}`;fx[k]=(fx[k]??0)+1;if(s.target)fx[`${k}:target`]=target?'found':'missing';return r(peer,caster,s,target);};};
try{
 await run([join(root,'server-dist/main.mjs')],{PORT:String(API),HOST:'127.0.0.1',DATABASE_URL:postgres.url,MONITOR_IPS:'127.0.0.1'},/listening on/);
 await run([join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',String(WEB),'--strictPort'],{CC_SERVER_URL:`http://127.0.0.1:${API}`},new RegExp(String(WEB)));
 browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows']});
 // The mage entered first, so its browser runs the shard's monsters; the warrior mirrors them.
 const mage=await player('Skill Mage','mage'),warrior=await player('Watching Warrior','warrior');
 const shard=await game(mage,()=>window.app.current.game.multiplayer.shard);
 assert.equal(await game(warrior,()=>window.app.current.game.multiplayer.shard),shard);
 await mage.waitForFunction(()=>window.app.current.game.multiplayer.battle.authority);
 const mageId=await game(mage,()=>window.app.current.game.multiplayer.ownId);
 const view=await browser.newPage({viewport:{width:960,height:540}});view.on('pageerror',e=>errors.push(`spectator: ${e.message}`));
 await view.goto(`${base}/?observe=${shard}&follow=${mageId}&area=1`);
 await view.waitForFunction(id=>window.app?.current?.game?.multiplayer?.peerUnit(id),mageId,{timeout:180000});
 await warrior.waitForFunction(id=>window.app.current.game.multiplayer.peerUnit(id),mageId,{timeout:30000});
 console.log(`SHARD ${shard} mage=${mageId}`);

 // The mage stands 9 m from the nearest scrapling, facing it, and targets it; both watchers start counting.
 const target=await game(mage,()=>{const g=window.app.current.game;g.god=true;const p=g.player.unit;
  const e=g.enemies.filter(e=>e.kind==='scrapling'&&!e.isAdd&&e.unit.alive&&!e.unit.hidden).sort((a,b)=>a.unit.pos.distanceTo(p.pos)-b.unit.pos.distanceTo(p.pos))[0];
  const u=e.unit,dx=p.pos.x-u.pos.x,dz=p.pos.z-u.pos.z,d=Math.hypot(dx,dz)||1;
  p.teleport(g.world,u.pos.x+dx/d*9,u.pos.z+dz/d*9,Math.atan2(-dx,-dz));g.player.setTarget(u);return g.enemies.indexOf(e);});
 await sleep(2500);
 for(const p of [warrior,view])await game(p,spy);
 const cast=async slot=>{await game(mage,s=>{const g=window.app.current.game;g.player.resource=g.player.maxResource??999;g.player.useAbility(s);},slot);};
 await cast(1);await sleep(700);
 await view.screenshot({path:shot('skill-fx-spectator-cast.png')});
 await sleep(1600);
 await view.screenshot({path:shot('skill-fx-spectator-bolt.png')});
 await sleep(1200);
 for(const [slot,name] of [[2,'frost'],[4,'nova'],[3,'blink']]){await cast(slot);await sleep(250);await view.screenshot({path:shot(`skill-fx-spectator-${name}.png`)});await sleep(1500);}
 await warrior.screenshot({path:shot('skill-fx-warrior.png')});
 const sent=await game(mage,i=>({hp:window.app.current.game.enemies[i].unit.hp,max:window.app.current.game.enemies[i].unit.maxHp}),target);
 for(const [p,who] of [[warrior,'warrior'],[view,'spectator']]){
  const fx=await game(p,()=>window.__fx);
  console.log(`${who.toUpperCase()}_FX ${JSON.stringify(fx)}`);
  assert.ok(fx['remote:cast:bubble-bolt']>=1,`${who}: told of the cast`);
  assert.ok(fx.castMotes>=1,`${who}: draws the casting motes`);
  assert.equal(fx['remote:projectile:spawn:target'],'found',`${who}: finds the bolt's target`);
  assert.ok(fx.projectile>=1,`${who}: draws the bolt`);
  assert.ok(fx['remote:projectile:hit']>=1,`${who}: sees the bolt land`);
  assert.ok(fx.frostSpray>=1,`${who}: draws Frost Spray`);
  assert.ok(fx.tidalNova>=1,`${who}: draws Tidal Nova`);
  assert.ok(fx.steamPuff>=2,`${who}: draws both Steam Blink puffs`);
 }
 console.log(`SCRAPLING ${sent.hp}/${sent.max}`);
 assert.deepEqual(errors,[]);
 console.log('PASS a warrior and a spectator view draw the mage\'s cast, bolt, Frost Spray, Tidal Nova and Steam Blink; zero page errors');
}catch(e){
 console.error(log.slice(-4000));console.error('page errors:',errors);
 throw e;}
finally{await browser?.close();for(const c of children)c.kill('SIGTERM');postgres.stop();}
