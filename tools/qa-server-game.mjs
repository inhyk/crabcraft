// Real Chrome -> authenticated loopback host -> actual Area -> production rig observation.
// This exercises the actual Game route against disposable local PG, never the production VM.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserPort=Number(process.env.WORLD_QA_BROWSER_PORT??5277),hostPort=Number(process.env.WORLD_QA_HOST_PORT??5288),clientOrigin=`http://127.0.0.1:${browserPort}`;
if(![browserPort,hostPort].every(p=>Number.isInteger(p)&&p>0&&p<65536))throw new Error('Invalid loopback QA port');
const qaWorld=process.env.WORLD_QA_WORLD??'w1';if(!['w1','w2','w3','w4'].includes(qaWorld))throw new Error('Invalid QA world');
const providedMetadata = process.env.WORLD_QA_METADATA;
const scratch = providedMetadata ? null : await mkdtemp('/private/tmp/crabcraft-browser-world-');
const metadataPath = providedMetadata ?? join(scratch, 'host.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let host, server, browser;
const handshakeStatuses = [];
const websocketErrors = [];
try {
  if (!providedMetadata) {
    host = spawn(process.execPath, ['tools/qa-world-host-server.mjs', '--port', String(hostPort), '--metadata', metadataPath, '--client-origin', clientOrigin,'--world',qaWorld], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    // Launcher errors may include driver configuration; print no launcher output or credentials.
    host.stderr.on('data', () => {});
  }
  let metadata;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); break; }
    catch { if (host?.exitCode !== null && host?.exitCode !== undefined) throw new Error('QA host exited before readiness'); await pause(100); }
  }
  if (!metadata) throw new Error('QA host readiness timed out');
  const origin = new URL(metadata.origin);
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || metadata.clientOrigin !== clientOrigin) throw new Error('QA host must use the expected loopback origins');
  server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: browserPort, strictPort: true, proxy: { '/world': { target: origin.origin, ws: true }, '/api/account': { target: origin.origin } } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.grantPermissions(['local-network-access'], { origin: clientOrigin });
  await context.addCookies([{ name: metadata.cookie.name, value: metadata.cookie.value, domain: '127.0.0.1', path: metadata.cookie.path, httpOnly: true, sameSite: 'Strict', secure: false }]);
  const page = await context.newPage(), errors = [];let legacySaveRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/account/save')legacySaveRequests++;});
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  network.on('Network.webSocketHandshakeResponseReceived', event => handshakeStatuses.push(event.response.status));
  network.on('Network.webSocketFrameError', event => websocketErrors.push(event.errorMessage));
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('cc.language','en');localStorage.setItem('cc.lighthouseSecret.v1','found');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Legacy fixture'}));localStorage.setItem('cc.journey.v1:human:male:warrior:Legacy fixture',JSON.stringify({xp:999999,coins:9999,frostCleared:true}));});
  await page.goto(`${clientOrigin}/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`,{waitUntil:'load'});
  await page.locator('.launch-notice-start').click();
  await page.waitForFunction(()=>window.__ready&&window.cc?.game?.server?.ready,undefined,{timeout:120000});
  await page.locator('.loading').waitFor({state:'detached'});
  await page.waitForFunction(()=>getComputedStyle(window.cc.game.hud.root).opacity==='1');
  await page.evaluate(async()=>{localStorage.setItem('cc.account.pending',`${Date.now()}:game`);await window.cc.game.app.account.init();await window.cc.game.app.account.flush();});
  const before=await page.evaluate(()=>{const g=window.cc.game;return {diagnostics:g.server.diagnostics(),position:g.player.unit.pos.toArray(),kind:g.player.unit.kind,observed:g.player.unit.observed,core:g.core,legacy:!!g.multiplayer,closest:g.units.filter(u=>u.hostile&&u.alive).map(u=>({ref:u.ref,position:u.pos.toArray(),gap:g.player.unit.distTo(u)})).sort((a,b)=>a.gap-b.gap).slice(0,3)};});
  if(before.diagnostics.self.player.xp!==0||before.diagnostics.self.player.coins!==0)throw new Error('Legacy progression entered the new character');
  await page.keyboard.down('KeyW');await page.waitForFunction(p=>window.cc.game.player.unit.pos.distanceTo({x:p[0],y:p[1],z:p[2]})>.3,before.position,{timeout:10000});await page.keyboard.up('KeyW');
  await page.keyboard.press('Space',{delay:5});
  await page.waitForFunction(()=>window.cc.game.server.client.inputWatermarks.consumed>1,undefined,{timeout:10000});
  await page.evaluate(()=>{const g=window.cc.game,forbidden=()=>{throw new Error('Legacy gameplay executed in server mode');};g.player.update=forbidden;g.timers.update=forbidden;g.projectiles.update=forbidden;g.combat.damage=forbidden;if(g.boats){g.boats.update=forbidden;g.boats.request=forbidden;}if(g.achievements){g.achievements.update=forbidden;g.achievements.unlock=forbidden;}for(const enemy of g.enemies)enemy.update=forbidden;for(const boss of [g.boss,g.finalBoss,g.worldBoss,g.dawnBoss,g.frostBoss])boss.update=forbidden;const records=[];const present=g.server.presentation.events.bind(g.server.presentation);g.server.presentation.events=batch=>{for(const {event:e}of batch)if(['press','castStart','damage','death','xp','error'].includes(e.type))records.push({type:e.type,time:g.time,amount:e.amount,reason:e.reason,unit:e.unit??e.dst});present(batch);};const fx={projectileCreated:0,positionUpdates:0,castObserved:0,deathPoof:0};const projectile=g.vfx.observedProjectile.bind(g.vfx);g.vfx.observedProjectile=(...args)=>{fx.projectileCreated++;const handle=projectile(...args),set=handle.setPosition.bind(handle);handle.setPosition=(...p)=>{fx.positionUpdates++;return set(...p);};return handle;};const cast=g.hud.castBar.observe.bind(g.hud.castBar);g.hud.castBar.observe=(...args)=>{if(args[0]!==null)fx.castObserved++;return cast(...args);};const death=g.vfx.deathPoof.bind(g.vfx);g.vfx.deathPoof=(...args)=>{fx.deathPoof++;return death(...args);};window.serverTrace={records,fx,xp:g.player.xp,coins:g.player.coins};});
  await page.locator('.ab-slot').first().hover();await page.waitForFunction(()=>window.cc.game.scene.getObjectByName('ability-range-preview')?.visible);const skillRange=await page.evaluate(()=>window.cc.game.scene.getObjectByName('ability-range-preview').userData);if(skillRange.ability!=='bubble-bolt'||skillRange.radius!==24)throw new Error('Current mage skill range preview was not preserved');await page.mouse.move(640,360);
  let combat=null;
  if(qaWorld==='w1'){
  await page.mouse.move(640,360);await page.mouse.down({button:'right'});await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');
  for(const point of [[18,0],[60,0],[90,-8],[96,-8]]){
    await page.evaluate(([x,z])=>{const g=window.cc.game;g.follow.yaw=Math.atan2(x-g.player.unit.pos.x,z-g.player.unit.pos.z)-Math.PI;},point);
    await page.waitForFunction(([x,z])=>{const g=window.cc.game;g.follow.yaw=Math.atan2(x-g.player.unit.pos.x,z-g.player.unit.pos.z)-Math.PI;return Math.hypot(g.player.unit.pos.x-x,g.player.unit.pos.z-z)<3;},point,{timeout:30000});
  }
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.mouse.up({button:'right'});
  await page.waitForFunction(()=>{const g=window.cc.game;return g.units.some(u=>u.hostile&&u.alive&&g.player.unit.distTo(u)<24);},undefined,{timeout:10000});
  await page.evaluate(()=>{const g=window.cc.game,u=g.units.filter(u=>u.hostile&&u.alive).sort((a,b)=>g.player.unit.distTo(a)-g.player.unit.distTo(b))[0];g.player.setTarget(u);window.serverTrace.target={...u.ref};});
  await page.waitForFunction(()=>window.cc.game.player.target!==null);await page.keyboard.press('Digit1');
  for(let i=0;i<8;i++){try{await page.waitForFunction(()=>window.cc.game.player.xp>window.serverTrace.xp,undefined,{timeout:3500});break;}catch{await page.keyboard.press('Digit1');}}
  await page.waitForFunction(()=>window.cc.game.player.xp>window.serverTrace.xp,undefined,{timeout:10000});
  combat=await page.evaluate(()=>({before:{xp:window.serverTrace.xp,coins:window.serverTrace.coins},after:{xp:window.cc.game.player.xp,coins:window.cc.game.player.coins},records:window.serverTrace.records,fx:window.serverTrace.fx,alive:window.cc.game.player.unit.alive}));
  if(!combat.records.some(r=>r.type==='castStart')||!combat.records.some(r=>r.type==='damage')||!combat.records.some(r=>r.type==='death')||combat.after.coins<=combat.before.coins)throw new Error('Missing actual server combat progression');
  if(Object.values(combat.fx).some(count=>count<=0))throw new Error('Actual observed VFX was not invoked');await page.screenshot({path:join(root,'output','playwright','server-game','combat-w1.png')});
  }
  const expected=await page.evaluate(()=>({xp:window.cc.game.player.xp,coins:window.cc.game.player.coins}));
  const originalSession=await page.evaluate(()=>window.cc.game.server.client.view.header.session);await page.evaluate(character=>window.cc.game.server.client.connect(character),metadata.characterId);await page.waitForFunction(()=>window.cc.game.server.ready,undefined,{timeout:30000});
  const recovered=await page.evaluate(()=>({xp:window.cc.game.player.xp,coins:window.cc.game.player.coins,session:window.cc.game.server.client.view.header.session}));if(recovered.xp!==expected.xp||recovered.coins!==expected.coins||recovered.session===originalSession)throw new Error('Reconnect lost or duplicated earned progression');
  const result=await page.evaluate(()=>{const g=window.cc.game,u=g.player.unit,s=g.server.client.view,a=s.actors.find(a=>a.ref.id===s.selfRef.id);return {diagnostics:g.server.diagnostics(),observed:u.observed,personalView:{secret:g.lighthouseSecret?.found,secretAuthority:s.self.player.lighthouseSecretFound,achievements:g.achievements?.snapshot(),achievementAuthority:s.self.achievements},position:u.pos.toArray(),rootError:Math.hypot(u.rig.root.position.x-a.x,u.rig.root.position.y-a.y,u.rig.root.position.z-a.z),core:g.core,legacy:!!g.multiplayer,appearance:u.rig.spec,scenes:{chapter:g.world2.chapter,shore:g.world.root.visible,star:g.world2.root.visible,dawn:g.world2.third.root.visible,snow:g.world2.fourth.root.visible},oldRules:{enemies:g.enemies.length,serverActors:g.units.length}};});
  if(legacySaveRequests!==0)throw new Error('Server route wrote the legacy save API');
  if(result.personalView.secret!==result.personalView.secretAuthority||JSON.stringify(result.personalView.achievements.earned)!==JSON.stringify(result.personalView.achievementAuthority.earned))throw new Error('Personal view imported legacy state');
  if(errors.length||result.core!==null||result.legacy||!result.observed||result.rootError>1e-8)throw new Error(JSON.stringify({errors,result}));
  if(result.diagnostics.world!==qaWorld||result.scenes.chapter!==Number(qaWorld.slice(1))||Object.values(result.scenes).filter(v=>v===true).length!==1)throw new Error('Wrong observed world scene');
  const screenshot=join(root,'output','playwright','server-game',`trace-${qaWorld}.png`);await page.screenshot({path:screenshot});
  console.log(JSON.stringify({before,result,combat,recovered,skillRange,legacySaveRequests,errors,screenshot,renderFixture:metadata.renderFixture,earnedTravel:metadata.earnedTravel,scope:qaWorld==='w1'?'Actual Game with local PG/auth/Node Area; normal combat, rewards and reconnect without combat-state modification':'Actual Game with local PG/auth/Node Area; trusted world render fixture, movement and reconnect only; no earned travel claim'},null,2));
} catch(error) {
  const pages=browser?.contexts()[0]?.pages()??[];const page=pages[0];if(page){await page.screenshot({path:join(root,'output','playwright','server-game','failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({ready:window.__ready,loaded:window.cc?.game?.loaded,server:window.cc?.game?.server?.diagnostics?.(),status:document.querySelector('.world-connection-status')?.textContent})).catch(()=>null));}throw error;
} finally {
  if (handshakeStatuses.some(status => status !== 101)) console.error(JSON.stringify({ websocketHandshakeStatuses: handshakeStatuses }));
  if (websocketErrors.length) console.error(JSON.stringify({ websocketErrors }));
  if(browser){for(const context of browser.contexts())for(const page of context.pages())await page.evaluate(()=>window.cc?.game?.server?.client.dispose()).catch(()=>{});await pause(150);}
  await browser?.close(); await server?.close();
  if (host) {
    host.kill('SIGTERM');
    for (let attempt = 0; host.exitCode === null && attempt < 100; attempt++) await pause(100);
    if (host.exitCode === null) host.kill('SIGKILL');
  }
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
