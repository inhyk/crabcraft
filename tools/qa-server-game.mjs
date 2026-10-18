// Real Chrome -> authenticated loopback host -> actual Area -> production rig observation.
// This exercises the actual Game route against disposable local PG, never the production VM.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const providedMetadata = process.env.WORLD_QA_METADATA;
const scratch = providedMetadata ? null : await mkdtemp('/private/tmp/crabcraft-browser-world-');
const metadataPath = providedMetadata ?? join(scratch, 'host.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let host, server, browser;
const handshakeStatuses = [];
const websocketErrors = [];
try {
  if (!providedMetadata) {
    host = spawn(process.execPath, ['tools/qa-world-host-server.mjs', '--port', '5288', '--metadata', metadataPath, '--client-origin', 'http://127.0.0.1:5277'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
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
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || metadata.clientOrigin !== 'http://127.0.0.1:5277') throw new Error('QA host must use the expected loopback origins');
  server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 5277, strictPort: true, proxy: { '/world': { target: origin.origin, ws: true }, '/api/account': { target: origin.origin } } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.grantPermissions(['local-network-access'], { origin: 'http://127.0.0.1:5277' });
  await context.addCookies([{ name: metadata.cookie.name, value: metadata.cookie.value, domain: '127.0.0.1', path: metadata.cookie.path, httpOnly: true, sameSite: 'Strict', secure: false }]);
  const page = await context.newPage(), errors = [];
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  network.on('Network.webSocketHandshakeResponseReceived', event => handshakeStatuses.push(event.response.status));
  network.on('Network.webSocketFrameError', event => websocketErrors.push(event.errorMessage));
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('cc.language','en'));
  await page.goto(`http://127.0.0.1:5277/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`,{waitUntil:'load'});
  await page.locator('.launch-notice-start').click();
  await page.waitForFunction(()=>window.__ready&&window.cc?.game?.server?.ready,undefined,{timeout:120000});
  await page.locator('.loading').waitFor({state:'detached'});
  await page.waitForFunction(()=>getComputedStyle(window.cc.game.hud.root).opacity==='1');
  const before=await page.evaluate(()=>{const g=window.cc.game;return {diagnostics:g.server.diagnostics(),position:g.player.unit.pos.toArray(),kind:g.player.unit.kind,observed:g.player.unit.observed,core:g.core,legacy:!!g.multiplayer,closest:g.units.filter(u=>u.hostile&&u.alive).map(u=>({ref:u.ref,position:u.pos.toArray(),gap:g.player.unit.distTo(u)})).sort((a,b)=>a.gap-b.gap).slice(0,3)};});
  await page.keyboard.down('KeyW');await page.waitForFunction(p=>window.cc.game.player.unit.pos.distanceTo({x:p[0],y:p[1],z:p[2]})>.3,before.position,{timeout:10000});await page.keyboard.up('KeyW');
  await page.keyboard.press('Space',{delay:5});
  await page.waitForFunction(()=>window.cc.game.server.client.inputWatermarks.consumed>1,undefined,{timeout:10000});
  await page.evaluate(()=>{const g=window.cc.game,forbidden=()=>{throw new Error('Legacy gameplay executed in server mode');};g.player.update=forbidden;g.timers.update=forbidden;g.projectiles.update=forbidden;g.combat.damage=forbidden;for(const enemy of g.enemies)enemy.update=forbidden;for(const boss of [g.boss,g.finalBoss,g.worldBoss,g.dawnBoss,g.frostBoss])boss.update=forbidden;const records=[];const present=g.server.presentation.events.bind(g.server.presentation);g.server.presentation.events=batch=>{for(const {event:e}of batch)if(['press','castStart','damage','death','xp','error'].includes(e.type))records.push({type:e.type,time:g.time,amount:e.amount,reason:e.reason,unit:e.unit??e.dst});present(batch);};window.serverTrace={records,xp:g.player.xp,coins:g.player.coins};});
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
  const combat=await page.evaluate(()=>({before:{xp:window.serverTrace.xp,coins:window.serverTrace.coins},after:{xp:window.cc.game.player.xp,coins:window.cc.game.player.coins},records:window.serverTrace.records,alive:window.cc.game.player.unit.alive}));
  if(!combat.records.some(r=>r.type==='castStart')||!combat.records.some(r=>r.type==='damage')||!combat.records.some(r=>r.type==='death')||combat.after.coins<=combat.before.coins)throw new Error('Missing actual server combat progression');
  const originalSession=await page.evaluate(()=>window.cc.game.server.client.view.header.session);await page.evaluate(character=>window.cc.game.server.client.connect(character),metadata.characterId);await page.waitForFunction(()=>window.cc.game.server.ready,undefined,{timeout:30000});
  const recovered=await page.evaluate(()=>({xp:window.cc.game.player.xp,coins:window.cc.game.player.coins,session:window.cc.game.server.client.view.header.session}));if(recovered.xp!==combat.after.xp||recovered.coins!==combat.after.coins||recovered.session===originalSession)throw new Error('Reconnect lost or duplicated earned progression');
  const result=await page.evaluate(()=>{const g=window.cc.game,u=g.player.unit,s=g.server.client.view,a=s.actors.find(a=>a.ref.id===s.selfRef.id);return {diagnostics:g.server.diagnostics(),observed:u.observed,position:u.pos.toArray(),rootError:Math.hypot(u.rig.root.position.x-a.x,u.rig.root.position.y-a.y,u.rig.root.position.z-a.z),core:g.core,legacy:!!g.multiplayer,appearance:u.rig.spec,oldRules:{enemies:g.enemies.length,serverActors:g.units.length}};});
  if(errors.length||result.core!==null||result.legacy||!result.observed||result.rootError>1e-8)throw new Error(JSON.stringify({errors,result}));
  const screenshot=join(root,'output','playwright','server-game','trace.png');await page.screenshot({path:screenshot});
  console.log(JSON.stringify({before,result,combat,recovered,errors,screenshot,scope:'Actual Game route with local PG/auth/Node Area; normal move/cast/projectile/hit/death/XP/coins, no modified combat state'},null,2));
} catch(error) {
  const pages=browser?.contexts()[0]?.pages()??[];const page=pages[0];if(page){await page.screenshot({path:join(root,'output','playwright','server-game','failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({ready:window.__ready,loaded:window.cc?.game?.loaded,server:window.cc?.game?.server?.diagnostics?.(),status:document.querySelector('.world-connection-status')?.textContent})).catch(()=>null));}throw error;
} finally {
  if (handshakeStatuses.some(status => status !== 101)) console.error(JSON.stringify({ websocketHandshakeStatuses: handshakeStatuses }));
  if (websocketErrors.length) console.error(JSON.stringify({ websocketErrors }));
  await browser?.close(); await server?.close();
  if (host) {
    host.kill('SIGTERM');
    for (let attempt = 0; host.exitCode === null && attempt < 100; attempt++) await pause(100);
    if (host.exitCode === null) host.kill('SIGKILL');
  }
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
