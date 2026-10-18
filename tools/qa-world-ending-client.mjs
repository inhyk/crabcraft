// Actual Game route -> matched binary codec -> actual loopback host/PG.
// The approved launcher seeds a trusted W4 clear flag. This is not earned story completion.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {freePort} from '../server/node/local-postgres.mjs';
import {GameplayReceiver} from '../server/world/gameplay/protocol.ts';
import {decodeInput} from '../server/world/gameplay/intents.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'output/playwright/world-ending-client');
const provided=process.env.WORLD_QA_METADATA,scratch=provided?null:await mkdtemp('/private/tmp/crabcraft-ending-client-'),metadataPath=provided??join(scratch,'host.json');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=15000){const end=performance.now()+timeout;while(!await fn()){if(performance.now()>end)throw Error('Ending client QA timed out');await pause(25);}}
let host,server,browser,hostExited;
const pages=[],wireErrors=[],commands=[],streams=[];
try{
 await mkdir(output,{recursive:true});const port=await freePort();
 if(!provided){host=spawn(process.execPath,['tools/qa-world-host-server.mjs','--port','0','--client-origin',`http://127.0.0.1:${port}`,'--metadata',metadataPath,'--world','w4','--ending','1','--ledger','1'],{cwd:root,stdio:['ignore','ignore','ignore']});hostExited=new Promise(resolve=>host.once('exit',(code,signal)=>resolve({code,signal})));}
 let metadata;await until(async()=>{try{metadata=JSON.parse(await readFile(metadataPath,'utf8'));return true;}catch{if(host?.exitCode!==null&&host?.exitCode!==undefined)throw Error('Ending QA launcher exited before readiness');return false;}},120000);
 const origin=new URL(metadata.clientOrigin),backend=new URL(metadata.origin);
 if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||backend.protocol!=='http:'||backend.hostname!=='127.0.0.1'||metadata.endingIntegrationFixture!==true||metadata.earnedEnding!==false||metadata.world!=='w4')throw Error('Expected explicit trusted W4 ending integration fixture');
 server=await createServer({root,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:Number(origin.port),strictPort:true,hmr:false,proxy:{'/api/account':{target:backend.origin},'/world':{target:backend.origin,ws:true}}}});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1280,height:800}});await context.grantPermissions(['local-network-access'],{origin:origin.origin});await context.addCookies([{name:metadata.cookie.name,value:metadata.cookie.value,domain:'127.0.0.1',path:metadata.cookie.path,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();pages.push(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('websocket',ws=>{if(new URL(ws.url()).pathname!=='/world')return;const stream={binding:null,receiver:null,state:null};streams.push(stream);
  ws.on('framereceived',({payload})=>{try{if(typeof payload==='string'){const value=JSON.parse(payload);if(value.type==='world-bound'){const{type,...binding}=value;stream.binding=binding;stream.receiver=new GameplayReceiver(binding,metadata.catalog);}}else if(stream.receiver){const result=stream.receiver.accept(payload,performance.now()/1000);if(result?.kind==='snapshot')stream.state=result.state;}}catch(error){wireErrors.push(error.message);}});
  ws.on('framesent',({payload})=>{if(typeof payload==='string'||!stream.binding)return;try{const input=decodeInput(payload,stream.binding,metadata.catalog);for(const command of input.commands)if(command.kind==='endingControl')commands.push({seq:input.seq,...command});}catch{/* Non-input resync/control frames use their own parser. */}});
 });
 await page.addInitScript(appearance=>{localStorage.setItem('cc.language','en');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.spec',JSON.stringify(appearance));},metadata.appearance);
 await page.goto(`${origin.origin}/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`);await page.locator('.launch-notice-start').click();
 await page.waitForFunction(()=>window.app?.current?.game?.server?.ready&&!document.querySelector('.loading'),null,{timeout:120000});
 await page.evaluate(()=>{const mark=document.createElement('div');mark.className='ending-client-fixture-watermark';mark.textContent='INTEGRATION FIXTURE - TRUSTED W4 CLEAR FLAG - NOT EARNED STORY COMPLETION';mark.style.cssText='position:fixed;bottom:0;left:0;right:0;padding:8px;background:#722;color:white;text-align:center;font:13px sans-serif;z-index:1000;pointer-events:none';document.body.append(mark);});
 await page.waitForFunction(()=>window.app.current.game.serverEndingActive,null,{timeout:45000});
 const progress=()=>page.evaluate(()=>{const g=window.app.current.game,p=g.player;return{hp:p.unit.hp,maxHp:p.unit.maxHp,xp:p.xp,coins:p.coins,flags:{...g.server.state.self.player.flags}};});
 const before=await progress();assert.equal(before.xp,0);assert.equal(before.coins,0);
 const presentation=await page.evaluate(()=>{const g=window.app.current.game;return{id:g.serverEnding.current.id,phase:g.serverEnding.current.phase,tick:g.serverEnding.current.tick,cast:g.serverEnding.current.cast.length,ownsScene:window.app.engine.scene===g.serverEnding.scene};});assert.equal(presentation.ownsScene,true);
 await page.waitForFunction(()=>{const e=window.app.current.game.serverEnding;return e.current?.cast.length&&e.readyCount===e.current.cast.length;},null,{timeout:45000});
 await page.screenshot({path:join(output,'game-celebration.png')});
 const camera=await page.evaluate(()=>window.app.current.game.serverEnding.camera.position.toArray());assert.ok(camera.every(Number.isFinite));
 const npc=()=>streams.at(-1)?.state?.actors.filter(a=>a.kind==='townsfolk').map(a=>({id:a.ref.id,x:a.x,z:a.z}))??[];const initialNpc=npc();
 await page.evaluate(()=>window.app.current.game.server.command({kind:'chatSay',channel:'area',text:'Ending integration chat remains active'}));await page.getByText('Ending integration chat remains active',{exact:false}).waitFor({timeout:15000});
 assert.equal(await page.evaluate(()=>{const el=window.app.current.game.hud.chat.el;return el.classList.contains('hud-keep')&&getComputedStyle(el).opacity!=='0';}),true);
 await until(()=>{const next=npc();return initialNpc.some(a=>next.some(b=>a.id===b.id&&Math.hypot(a.x-b.x,a.z-b.z)>.03));},15000);
 // Retain an old DOM listener while the transport generation changes. It must never send a command.
 await page.getByRole('button',{name:'Skip celebration',exact:true}).waitFor({state:'visible',timeout:45000});
 const reconnectBefore=await page.evaluate(()=>{const g=window.app.current.game;window.oldEndingButton=document.querySelector('.ending-presentation button');const s=g.serverEnding.current;g.server.client.socket.close();return{id:s.id,tick:s.tick};});
 await until(()=>streams.length>=2&&streams.at(-1).state,20000);await page.waitForFunction(()=>window.app.current.game.server.client.state==='admitted'&&window.app.current.game.serverEndingActive,null,{timeout:20000});
 const resumed=await page.evaluate(()=>{const g=window.app.current.game,s=g.serverEnding.current;return{id:s.id,tick:s.tick};});assert.equal(resumed.id,reconnectBefore.id);assert.ok(resumed.tick>=reconnectBefore.tick);
 const priorCommands=commands.length;await page.evaluate(()=>window.oldEndingButton.click());await pause(150);assert.equal(commands.length,priorCommands,'Retired view listener sent a control');
 await page.getByRole('button',{name:'Skip celebration',exact:true}).waitFor({state:'visible',timeout:15000});
 const skip=await page.getByRole('button',{name:'Skip celebration',exact:true}).evaluate(button=>{const e=window.app.current.game.serverEnding,before=structuredClone(e.current);button.click();return{before,after:structuredClone(e.current)};});assert.deepEqual(skip.after,skip.before,'Click advanced the browser ending clock');
 await page.getByRole('heading',{name:'Credits',exact:true}).waitFor({timeout:15000});await page.screenshot({path:join(output,'game-credits.png')});assert.equal(commands.filter(c=>c.id===resumed.id&&c.action==='skip').length,1);
 const finish=await page.getByRole('button',{name:'Continue adventure',exact:true}).evaluate(button=>{const e=window.app.current.game.serverEnding,before=structuredClone(e.current);button.click();return{before,after:structuredClone(e.current)};});assert.deepEqual(finish.after,finish.before);
 await page.waitForFunction(()=>!window.app.current.game.serverEndingActive,null,{timeout:15000});assert.equal(commands.filter(c=>c.id===resumed.id&&c.action==='continue').length,1);
 assert.equal(await page.evaluate(()=>{const g=window.app.current.game;return window.app.engine.scene===g.scene&&!g.hud.root.classList.contains('cinematic')&&!g.hud.chat.el.classList.contains('hud-keep');}),true);
 const after=await progress();assert.deepEqual(after,before);assert.deepEqual(wireErrors,[]);assert.deepEqual(errors,[]);
 await page.evaluate(async()=>{window.oldEndingGame=window.app.current.game;await window.app.go('title');});await pause(250);assert.equal(await page.evaluate(()=>{const g=window.oldEndingGame;return !g.alive&&!g.serverEnding&&document.querySelectorAll('.ending-presentation').length===0&&window.app.engine.scene!==g.scene;}),true);
 const report={scope:'Actual Game route, real typed binary WS and actual local PG host. Trusted W4 frostCleared checkpoint fixture, not earned story completion.',checks:{separateScene:true,actualCast:presentation.cast,orderedSkipAndContinue:true,clickDoesNotAdvance:true,fullReconnectSameId:true,oldListenerInert:true,chatContinues:true,otherActorsContinue:true,gameplayProgressUnchanged:true,cameraReturned:true,disposeClears:true},commands:commands.map(({seq,action})=>({seq,action})),errors,wireErrors};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
 await browser?.close();await server?.close();if(host?.exitCode===null){host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),10000);await hostExited;clearTimeout(timer);}if(scratch)await rm(scratch,{recursive:true,force:true});
}
