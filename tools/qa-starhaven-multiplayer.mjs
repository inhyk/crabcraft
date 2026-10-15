// GPU browser QA: run Vite preview with the room relay on port 5192.
// Two independent browser contexts exercise real room packets and UI controls.
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const errors=[];
await (await import('node:fs/promises')).mkdir('tmp/qa',{recursive:true});
async function open(name){const ctx=await browser.newContext({viewport:{width:1440,height:900}});const page=await ctx.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});await page.addInitScript(name=>{
 localStorage.clear();localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.quality','low');
 const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(url,protocols){super(String(url).includes('/multiplayer')?'ws://127.0.0.1:5192/multiplayer':url,protocols);}};
},name);await page.goto('http://127.0.0.1:5192/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.multiplayer,null,{timeout:90000});return page;}
try{
 const a=await open('Star Host'),b=await open('Star Friend');
 await a.evaluate(()=>window.app.current.game.multiplayer.connect('create'));await a.waitForFunction(()=>window.app.current.game.multiplayer.room,null,{timeout:10000});const room=await a.evaluate(()=>window.app.current.game.multiplayer.room);
 await b.evaluate(room=>window.app.current.game.multiplayer.connect('join',room),room);await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.active,null,{timeout:10000});
 await a.waitForFunction(()=>[...window.app.current.game.multiplayer.peers.values()][0]?.unit,null,{timeout:30000});await b.waitForFunction(()=>[...window.app.current.game.multiplayer.peers.values()][0]?.unit,null,{timeout:30000});
 await Promise.all([a,b].map(p=>p.evaluate(()=>window.app.current.game.multiplayer.root.open=true)));
 await b.evaluate(()=>{const g=window.app.current.game;g.toggleMenu();g.hud.menu.settings();});await b.getByRole('button',{name:'English',exact:true}).click();await b.evaluate(()=>window.app.current.game.hud.menu.close());
 assert.equal(await b.locator('.mp-panel summary').textContent(),'🦀 Multiplayer');
 assert.equal(await b.getByRole('button',{name:'⚔ PvP',exact:true}).isDisabled(),true);
 await a.getByRole('button',{name:'⚔ 싸우기 모드',exact:true}).click();await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='pvp');
 await Promise.all([a,b].map((p,i)=>p.evaluate(i=>{const g=window.app.current.game;g.player.unit.teleport(g.world,12+i*2,0,0);g.player.unit.hp=g.player.unit.maxHp;g.player.unit.lastCombat=-100;},i)));await a.waitForTimeout(600);
 const hp=await b.evaluate(()=>window.app.current.game.player.unit.hp);
 await a.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,[...g.multiplayer.peers.values()][0].unit,20);});
 await b.waitForFunction(hp=>window.app.current.game.player.unit.hp<=hp-20,hp,{timeout:5000});
 await a.getByRole('button',{name:'파티 2',exact:true}).click();await b.getByRole('button',{name:'Party 2',exact:true}).click();await a.waitForFunction(()=>{const b=window.app.current.game.multiplayer.battle;return Object.values(b.parties).length===2&&Object.values(b.parties).every(p=>p===2);},null,{timeout:10000});
 await a.waitForTimeout(300);assert.equal(await a.locator('[data-party="2"]').getAttribute('aria-pressed'),'true');assert.equal(await b.locator('[data-party="2"]').getAttribute('aria-pressed'),'true');
 console.log('PARTIES',await a.evaluate(()=>window.app.current.game.multiplayer.battle.parties));
 const before=await b.evaluate(()=>window.app.current.game.player.unit.hp);await a.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,[...g.multiplayer.peers.values()][0].unit,20);});await a.waitForTimeout(500);assert.equal(await b.evaluate(()=>window.app.current.game.player.unit.hp),before);
 await a.getByRole('button',{name:'협동 모드',exact:true}).click();await a.evaluate(()=>window.app.current.game.setLighthouse(true));await b.waitForFunction(()=>window.app.current.game.beaconLit===true);
 await b.evaluate(()=>window.app.current.game.setLighthouse(false));await a.waitForFunction(()=>window.app.current.game.world.getEnvironment().mood===3);await b.waitForFunction(()=>window.app.current.game.world.getEnvironment().mood===3);
 await b.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-999;g.multiplayer.battle.travel(2);});await a.waitForFunction(()=>window.app.current.game.world2.chapter===2);await b.waitForFunction(()=>window.app.current.game.world2.chapter===2);
 await a.waitForTimeout(800);
 const locations=await Promise.all([a,b].map(p=>p.evaluate(()=>{const g=window.app.current.game;return {chapter:g.world2.chapter,npcs:g.npcs.map(n=>({id:n.def.id,hidden:n.unit.hidden,x:n.unit.pos.x,z:n.unit.pos.z})),town:g.townsfolk.map(t=>[t.unit.pos.x,t.unit.pos.z])};})));
 assert.equal(locations[0].npcs.length,7);assert.deepEqual(locations[0].npcs,locations[1].npcs);assert.ok(locations[0].town.every((p,i)=>Math.hypot(p[0]-locations[1].town[i][0],p[1]-locations[1].town[i][1])<1));
 // Inject the phase-II encounter setup, then use the real mechanic and room checkpoint pipeline.
 await Promise.all([a,b].map(p=>p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.unit.teleport(g.world,0,-68,0);g.follow.cut();})));
 await a.evaluate(()=>{const g=window.app.current.game,boss=g.worldBoss;g.player.restoreXp(22000);boss.wake();boss.state='fight';boss.phase=2;boss.unit.invulnerable=false;boss.unit.targetable=true;boss.mechIndex=0;boss.startMech();});
 await a.waitForFunction(()=>document.querySelector('.msg-warn').textContent.includes('초록 원'));
 await b.waitForFunction(()=>document.querySelector('.msg-warn').textContent.includes('Enter the green circle'));
 assert.match(await b.evaluate(()=>window.app.current.game.worldBoss.unit.name),/Astra/);
 assert.match(await b.evaluate(()=>window.app.current.game.worldBoss.unit.title),/Guardian/);
 console.log('PASS: same Eclipse mechanic gives Korean host / English guest the same inner-circle safety instruction');
 await a.evaluate(()=>window.app.current.game.worldBoss.sleep());await b.waitForFunction(()=>window.app.current.game.worldBoss.state==='dormant');
 await a.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,72,Math.PI);g.follow.cut();g.multiplayer.root.open=true;});await a.waitForTimeout(1500);await a.screenshot({path:'tmp/qa/star-party.png'});
 await b.evaluate(()=>window.app.current.game.multiplayer.battle.travel(1));await a.waitForFunction(()=>window.app.current.game.world2.chapter===1);await b.waitForFunction(()=>window.app.current.game.world2.chapter===1);
 assert.deepEqual(await b.evaluate(()=>window.app.current.game.enemies.filter(e=>!e.isAdd).map(e=>e.unit.baseTint)),await a.evaluate(()=>window.app.current.game.enemies.filter(e=>!e.isAdd).map(e=>e.unit.baseTint)),'guest shore LEDs match the host');
 // A new host must inherit combat coefficients as well as the mirrored health/level.
 await a.evaluate(()=>{const g=window.app.current.game;g.player.restoreXp(22000);g.world2.enter();});
 await b.waitForFunction(()=>window.app.current.game.world2.chapter===2&&window.app.current.game.enemies[0].unit.level>=19);
 const checkpoint=await a.evaluate(()=>{const g=window.app.current.game,e=g.enemies[0];e.unit.hp=Math.round(e.unit.maxHp*.6);e.state='idle';e.unit.stunUntil=g.time+1000;return {hp:e.unit.hp,maxHp:e.unit.maxHp,level:e.unit.level,damage:[...e.stats.dmg],xp:e.stats.xp,respawn:e.stats.respawn};});
 await b.waitForFunction(hp=>window.app.current.game.enemies[0].unit.hp===hp,checkpoint.hp);
 await a.getByRole('button',{name:'나가기',exact:true}).click();
 await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.authority===true);
 const inherited=await b.evaluate(()=>{const e=window.app.current.game.enemies[0];return {hp:e.unit.hp,maxHp:e.unit.maxHp,level:e.unit.level,damage:[...e.stats.dmg],xp:e.stats.xp,respawn:e.stats.respawn};});
 assert.deepEqual(inherited,checkpoint);
 await b.evaluate(()=>window.app.current.game.world2.returnToShore());await b.waitForFunction(()=>window.app.current.game.world2.chapter===1);
 assert.deepEqual(await b.evaluate(()=>{const e=window.app.current.game.enemies[0];return {level:e.unit.level,respawn:e.stats.respawn,tint:e.unit.baseTint};}),{level:1,respawn:30,tint:'#ff2a1a'});
 console.log('PASS host departure: injured enemy checkpoint, scaled damage/XP, island respawn and original shore restoration',inherited);
 console.log('PASS two browsers: bilingual UI, host-only mode buttons, selected parties, PvP damage, party protection, co-op, guest morning toggle, two-way portals, all seven NPCs, synchronized walking villagers');console.log('ERRORS',errors);assert.deepEqual(errors,[]);
}finally{await browser.close();}
