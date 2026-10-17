// GPU browser QA: defaults to preview + room relay on 5192.
// Set CC_QA_URL to the public game URL to use its real Internet backend without interception.
// Two independent browser contexts exercise real room packets and UI controls.
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
const baseUrl=process.env.CC_QA_URL??'http://127.0.0.1:5192/';
const localRelay=new URL(baseUrl).hostname==='127.0.0.1';
await (await import('node:fs/promises')).mkdir('tmp/qa',{recursive:true});
async function open(name){const ctx=await browser.newContext({viewport:{width:1440,height:900}});const page=await ctx.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});await page.addInitScript(({name,localRelay})=>{
 localStorage.clear();localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.quality','low');
 if(localRelay){const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(url,protocols){super(String(url).includes('/multiplayer')?'ws://127.0.0.1:5192/multiplayer':url,protocols);}};}
},{name,localRelay});await page.goto(baseUrl+'?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.multiplayer,null,{timeout:90000});return page;}
try{
 const a=await open('Star Host'),b=await open('Star Friend');
 const shoreMap=await a.evaluate(()=>{const s=window.app.current.game.hud.minimap.snap;return {size:s.size,minX:s.minX,minZ:s.minZ};});
 await a.evaluate(()=>window.app.current.game.multiplayer.connect('create'));await a.waitForFunction(()=>window.app.current.game.multiplayer.room,null,{timeout:10000});const room=await a.evaluate(()=>window.app.current.game.multiplayer.room);
 await b.evaluate(room=>window.app.current.game.multiplayer.connect('join',room),room);await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.active,null,{timeout:10000});
 await a.waitForFunction(()=>[...window.app.current.game.multiplayer.peers.values()][0]?.unit,null,{timeout:30000});await b.waitForFunction(()=>[...window.app.current.game.multiplayer.peers.values()][0]?.unit,null,{timeout:30000});
 await Promise.all([a,b].map(p=>p.evaluate(()=>window.app.current.game.multiplayer.root.open=true)));
 await b.evaluate(()=>{const g=window.app.current.game;g.toggleMenu();g.hud.menu.settings();});await b.getByRole('button',{name:'English',exact:true}).click();await b.evaluate(()=>window.app.current.game.hud.menu.close());
 assert.equal(await b.locator('.mp-panel summary').textContent(),'🦀 Room with friends · 2');
 assert.equal(await b.getByRole('button',{name:'⚔ PvP',exact:true}).isDisabled(),true);
 await a.getByRole('button',{name:'⚔ 싸우기 모드',exact:true}).click();await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='pvp');
 await Promise.all([a,b].map((p,i)=>p.evaluate(i=>{const g=window.app.current.game;g.player.unit.teleport(g.world,12+i*2,0,0);g.player.unit.hp=g.player.unit.maxHp;g.player.unit.lastCombat=-100;},i)));await a.waitForTimeout(600);
 const hp=await b.evaluate(()=>window.app.current.game.player.unit.hp);
 await a.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,[...g.multiplayer.peers.values()][0].unit,20);});
 await b.waitForFunction(hp=>window.app.current.game.player.unit.hp<=hp-20,hp,{timeout:5000});
 await a.getByRole('button',{name:'파티 2',exact:true}).click();await b.getByRole('button',{name:'Party 2',exact:true}).click();await a.waitForFunction(()=>{const b=window.app.current.game.multiplayer.battle;return Object.values(b.parties).length===2&&Object.values(b.parties).every(p=>p===2);},null,{timeout:10000});
 for(const p of [a,b])await p.waitForFunction(()=>document.querySelector('[data-party="2"]').getAttribute('aria-pressed')==='true');
 console.log('PARTIES',await a.evaluate(()=>window.app.current.game.multiplayer.battle.parties));
 const before=await b.evaluate(()=>window.app.current.game.player.unit.hp);await a.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,[...g.multiplayer.peers.values()][0].unit,20);});await a.waitForTimeout(500);assert.equal(await b.evaluate(()=>window.app.current.game.player.unit.hp),before);
 await a.getByRole('button',{name:'협동 모드',exact:true}).click();await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='coop');
 for(const p of [a,b])assert.ok(await p.evaluate(()=>Object.values(window.app.current.game.multiplayer.battle.parties).length===2&&Object.values(window.app.current.game.multiplayer.battle.parties).every(p=>p===2)),'explicit party selections survive the co-op switch');
 await a.getByRole('button',{name:'⚔ 싸우기 모드',exact:true}).click();await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='pvp');
 for(const p of [a,b])await p.waitForFunction(()=>document.querySelector('[data-party="2"]').getAttribute('aria-pressed')==='true');
 const protectedHp=await b.evaluate(()=>window.app.current.game.player.unit.hp);await a.evaluate(()=>{const g=window.app.current.game;g.combat.damage(g.player.unit,[...g.multiplayer.peers.values()][0].unit,20);});await a.waitForTimeout(400);assert.equal(await b.evaluate(()=>window.app.current.game.player.unit.hp),protectedHp);
 await a.getByRole('button',{name:'협동 모드',exact:true}).click();await b.waitForFunction(()=>window.app.current.game.multiplayer.battle.mode==='coop');
 console.log('PASS: explicit parties survive co-op/PvP/co-op switches and teammates remain protected');await a.evaluate(()=>window.app.current.game.setLighthouse(true));await b.waitForFunction(()=>window.app.current.game.beaconLit===true);
 await b.evaluate(()=>window.app.current.game.setLighthouse(false));await a.waitForFunction(()=>window.app.current.game.world.getEnvironment().mood===3);await b.waitForFunction(()=>window.app.current.game.world.getEnvironment().mood===3);
 await b.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-999;g.multiplayer.battle.travel(2);});await a.waitForFunction(()=>window.app.current.game.world2.chapter===2);await b.waitForFunction(()=>window.app.current.game.world2.chapter===2);
 await a.waitForTimeout(800);
 const locations=await Promise.all([a,b].map(p=>p.evaluate(()=>{const g=window.app.current.game;return {chapter:g.world2.chapter,moths:Array.from(g.world2.life.moths.bodies.instanceMatrix.array),clock:{sky:g.world2.sky.time.value,sea:g.world2.sea.time.value,wind:g.world2.wind.time.value},npcs:g.npcs.map(n=>({id:n.def.id,hidden:n.unit.hidden,x:n.unit.pos.x,z:n.unit.pos.z})),town:g.townsfolk.map(t=>[t.unit.pos.x,t.unit.pos.z])};})));
 assert.equal(locations[0].npcs.length,7);assert.deepEqual(locations[0].npcs,locations[1].npcs);assert.ok(locations[0].town.every((p,i)=>Math.hypot(p[0]-locations[1].town[i][0],p[1]-locations[1].town[i][1])<1));
 for(const state of locations){assert.equal(state.clock.sky,state.clock.sea);assert.equal(state.clock.sky,state.clock.wind);}assert.ok(Math.abs(locations[0].clock.sky-locations[1].clock.sky)<.75);console.log('PASS: sky, ocean and plants share the room clock on both peers',locations.map(s=>s.clock));
 for(let i=0;i<24;i++){const offset=i*16;assert.ok(Math.hypot(...[12,13,14].map(j=>locations[0].moths[offset+j]-locations[1].moths[offset+j]))<1,'moth positions agree across independently rendered peers');}console.log('PASS: all 24 moths follow the synchronized room clock');
 // New island equipment must follow the locally animated head on both peers.
 const sentry=await a.evaluate(()=>{const g=window.app.current.game,e=g.enemies.find(e=>!e.isAdd&&e.kind==='scrapling');e.unit.stunUntil=g.time+100;return {x:e.unit.pos.x,z:e.unit.pos.z};});
 await Promise.all([a,b].map(p=>p.evaluate(pos=>{const g=window.app.current.game;g.god=true;g.player.unit.teleport(g.world,pos.x+6,pos.z+6);g.follow.cut();},sentry)));await a.waitForTimeout(800);
 const armour=await Promise.all([a,b].map(p=>p.evaluate(()=>{const g=window.app.current.game,kit=g.world2.armour;kit.update(g.time);const group=kit.groups.find(x=>x.kind==='scrapling'),u=group.enemies[0].unit,s=u.rig.getSocket('head'),m=s.matrixWorld.clone();s.updateWorldMatrix(true,false);group.armour.getMatrixAt(0,m);return {draws:kit.root.children.length,colours:kit.groups.map(x=>x.core.material.color.getHexString()),hidden:u.hidden,culled:u.culled,attached:Math.hypot(...[12,13,14].map(i=>m.elements[i]-s.matrixWorld.elements[i])),position:[12,13,14].map(i=>m.elements[i]),finite:kit.groups.every(x=>[x.armour,x.core].every(mesh=>Array.from(mesh.instanceMatrix.array).every(Number.isFinite)))};})));
 for(const state of armour){assert.equal(state.draws,4);assert.deepEqual(state.colours,['8debdc','bca0ff']);assert.equal(state.hidden,false);assert.equal(state.culled,false);assert.ok(state.attached<.0001);assert.equal(state.finite,true);}assert.ok(Math.hypot(...armour[0].position.map((v,i)=>v-armour[1].position[i]))<.35);
 console.log('PASS: both peers render distinct island equipment attached to the mirrored animated sentry',armour);
 // Observe real host-simulated movement, then match the guest's network interpolation.
 await a.waitForFunction(start=>{const ts=window.app.current.game.townsfolk;return ts.filter((t,i)=>Math.hypot(t.unit.pos.x-start[i][0],t.unit.pos.z-start[i][1])>2).length>=4;},locations[0].town,{timeout:20000});
 const walkers=await a.evaluate(()=>window.app.current.game.townsfolk.map(t=>[t.unit.pos.x,t.unit.pos.z]));
 await b.waitForFunction(expected=>window.app.current.game.townsfolk.every((t,i)=>Math.hypot(t.unit.pos.x-expected[i][0],t.unit.pos.z-expected[i][1])<1),walkers,{timeout:5000});
 console.log('PASS: at least four residents actually stroll and guest mirrors their network positions');
 // Both players can respawn beside the World II portal without sending the room back to shore.
 await Promise.all([a,b].map(p=>p.evaluate(()=>{const g=window.app.current.game;g.god=false;g.player.unit.teleport(g.world,0,50,0);})));await a.waitForTimeout(300);
 await Promise.all([a,b].map(p=>p.evaluate(()=>{const g=window.app.current.game;g.combat.damage(null,g.player.unit,g.player.unit.maxHp*10);})));
 for(const p of [a,b])await p.waitForSelector('.death');
 assert.match(await a.locator('.death').innerText(),/별빛 항구/);assert.match(await b.locator('.death').innerText(),/Starhaven/);
 for(const p of [a,b])await p.waitForFunction(()=>{const g=window.app.current.game;return g.player.unit.alive&&!g.respawning&&!document.querySelector('.death');},null,{timeout:30000});
 await a.waitForTimeout(3500);
 for(const p of [a,b])assert.deepEqual(await p.evaluate(()=>{const g=window.app.current.game,u=g.player.unit;return {chapter:g.world2.chapter,x:u.pos.x,z:u.pos.z,full:u.hp===u.maxHp};}),{chapter:2,x:0,z:86,full:true});
 console.log('PASS: host and guest respawn at Starhaven with no portal bounce or shared chapter change');
 // Inject the phase-II encounter setup, then use the real mechanic and room checkpoint pipeline.
 await Promise.all([a,b].map(p=>p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.unit.teleport(g.world,0,-68,0);g.follow.cut();})));
 await a.evaluate(()=>{const g=window.app.current.game,boss=g.worldBoss;g.player.restoreXp(22000);boss.wake();boss.state='fight';boss.phase=2;boss.unit.invulnerable=false;boss.unit.targetable=true;boss.mechIndex=0;boss.startMech();});
 await a.waitForFunction(()=>document.querySelector('.msg-warn').textContent.includes('초록 원'));
 await b.waitForFunction(()=>document.querySelector('.msg-warn').textContent.includes('Enter the green circle'));
 assert.match(await b.evaluate(()=>window.app.current.game.worldBoss.unit.name),/Astra/);
 assert.match(await b.evaluate(()=>window.app.current.game.worldBoss.unit.title),/Guardian/);
 const colours=await Promise.all([a,b].map(p=>p.evaluate(()=>window.app.current.game.worldBoss.mech.fx.map(f=>f.u.uColor.value.getHexString()))));assert.deepEqual(colours[0],['a050ff','71ffca']);assert.deepEqual(colours[1],colours[0]);
 console.log('PASS: same Eclipse safety instruction and purple/green telegraph colours on both peers',colours);
 await a.evaluate(()=>window.app.current.game.worldBoss.sleep());await b.waitForFunction(()=>window.app.current.game.worldBoss.state==='dormant');
 for(const p of [a,b]){assert.equal(await p.locator('.msg-warn').textContent(),'');assert.equal(await p.locator('.messages').evaluate(el=>el.classList.contains('combat-warning')),false);}
 console.log('PASS: host cancellation removes the mechanic instruction in both browsers');
 await a.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,72,Math.PI);g.follow.cut();g.multiplayer.root.open=true;});await a.waitForTimeout(1500);await a.screenshot({path:'tmp/qa/star-party.png'});
 await b.evaluate(()=>window.app.current.game.multiplayer.battle.travel(1));await a.waitForFunction(()=>window.app.current.game.world2.chapter===1);await b.waitForFunction(()=>window.app.current.game.world2.chapter===1);
 for(const p of [a,b])assert.deepEqual(await p.evaluate(()=>{const s=window.app.current.game.hud.minimap.snap;return {size:s.size,minX:s.minX,minZ:s.minZ};}),shoreMap);console.log('PASS: host and guest both restore the original shore map after shared portal travel');
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
