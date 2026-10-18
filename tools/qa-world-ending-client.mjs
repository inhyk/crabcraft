// Actual Game route -> matched binary codec -> actual loopback host/PG.
// The approved launcher seeds a trusted W4 clear flag. This is not earned story completion.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {freePort} from '../server/node/local-postgres.mjs';
import {GameplayReceiver,WIRE_SCHEMA_REVISION} from '../server/world/gameplay/protocol.ts';
import {decodeInput} from '../server/world/gameplay/intents.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'tmp/qa/world-ending-client-labelled');
const provided=process.env.WORLD_QA_METADATA,scratch=provided?null:await mkdtemp('/private/tmp/crabcraft-ending-client-'),metadataPath=provided??join(scratch,'host.json');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=15000){const end=performance.now()+timeout;while(!await fn()){if(performance.now()>end)throw Error('Ending client QA timed out');await pause(25);}}
let host,server,browser,hostExited;
const wireErrors=[],commands=[],streams=[],authRevisions=[],captures=[];
const originalArtifacts=await Promise.all(['game-celebration.png','game-credits.png','report.json'].map(async name=>{const path=join(root,'tmp/qa/world-ending-client',name);try{return{path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}catch{return null;}}));
try{
 await mkdir(output,{recursive:true});const port=await freePort();
 if(!provided){host=spawn(process.execPath,['tools/qa-world-host-server.mjs','--port','0','--client-origin',`http://127.0.0.1:${port}`,'--metadata',metadataPath,'--world','w4','--ending','1','--ledger','1'],{cwd:root,stdio:['ignore','ignore','ignore']});hostExited=new Promise(resolve=>host.once('exit',(code,signal)=>resolve({code,signal})));}
 let metadata;await until(async()=>{try{metadata=JSON.parse(await readFile(metadataPath,'utf8'));return true;}catch{if(host?.exitCode!==null&&host?.exitCode!==undefined)throw Error('Ending QA launcher exited before readiness');return false;}},120000);
 const origin=new URL(metadata.clientOrigin),backend=new URL(metadata.origin);
 if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||backend.protocol!=='http:'||backend.hostname!=='127.0.0.1'||metadata.endingIntegrationFixture!==true||metadata.earnedEnding!==false||metadata.world!=='w4'||metadata.catalog.wireSchemaRevision!==WIRE_SCHEMA_REVISION)throw Error('Expected explicit trusted W4 ending integration fixture');
 server=await createServer({root,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:Number(origin.port),strictPort:true,hmr:false,proxy:{'/api/account':{target:backend.origin},'/world':{target:backend.origin,ws:true}}}});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1280,height:800}});await context.grantPermissions(['local-network-access'],{origin:origin.origin});await context.addCookies([{name:metadata.cookie.name,value:metadata.cookie.value,domain:'127.0.0.1',path:metadata.cookie.path,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('websocket',ws=>{if(new URL(ws.url()).pathname!=='/world')return;const stream={binding:null,receiver:null,state:null};streams.push(stream);
  ws.on('framereceived',({payload})=>{try{if(typeof payload==='string'){const value=JSON.parse(payload);if(value.type==='world-bound'){const{type,...binding}=value;stream.binding=binding;stream.receiver=new GameplayReceiver(binding,metadata.catalog);}}else if(stream.receiver){const result=stream.receiver.accept(payload,performance.now()/1000);if(result?.kind==='snapshot')stream.state=result.state;}}catch(error){wireErrors.push(error.message);}});
  ws.on('framesent',({payload})=>{if(typeof payload==='string'){const value=JSON.parse(payload);if(value.type==='authenticate')authRevisions.push(value.schemaRevision??null);return;}if(!stream.binding)return;try{const input=decodeInput(payload,stream.binding,metadata.catalog);for(const command of input.commands)if(command.kind==='endingControl')commands.push({seq:input.seq,...command});}catch{/* Non-input resync/control frames use their own parser. */}});
 });
 await page.addInitScript(appearance=>{localStorage.setItem('cc.language','en');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.spec',JSON.stringify(appearance));},metadata.appearance);
 await page.goto(`${origin.origin}/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`);await page.locator('.launch-notice-start').click();
 await page.waitForFunction(()=>window.app?.current?.game?.server?.ready&&!document.querySelector('.loading'),null,{timeout:120000});
 const markFixture=async()=>{
  await page.evaluate(()=>{const mark=document.querySelector('.ending-client-fixture-watermark')??document.createElement('div');mark.className='ending-client-fixture-watermark';mark.textContent='INTEGRATION FIXTURE - TRUSTED W4 CLEAR FLAG - NOT EARNED STORY COMPLETION';mark.style.cssText='position:fixed;top:52px;left:16px;right:16px;box-sizing:border-box;padding:8px 12px;border:1px solid #f6d58e;background:#722;color:white;text-align:center;font:700 14px/20px sans-serif;z-index:2147483647;pointer-events:none';document.body.append(mark);});
  const label=page.locator('.ending-client-fixture-watermark');await label.waitFor({state:'visible'});
  return label.evaluate(el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);return{text:el.textContent,rectangle:{left:r.left,top:r.top,width:r.width,height:r.height,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,background:style.backgroundColor,color:style.color,zIndex:style.zIndex,phase:window.app.current.game.serverEnding.current?.phase??null};});
 };
 const capture=async name=>{
  const label=await markFixture();assert.ok(label.rectangle.top>=0&&label.rectangle.bottom<180,'Fixture label must be inside the upper preview-safe region');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const path=join(output,name),png=await page.screenshot({path,fullPage:false});assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);assert.equal(width,label.viewport.width);assert.equal(height,label.viewport.height);
  captures.push({file:path,label,png:{width,height,sha256:createHash('sha256').update(png).digest('hex')},originalRenderedCapture:true,imageEditing:false});
 };
 await markFixture();
 // A previous aborted QA run may have retired the actor. Restore cancels activity;
 // use the real earned manual-replay command instead of editing flags or client phases.
 await pause(1000);
 const phase=await page.evaluate(()=>window.app.current.game.serverEnding?.current?.phase??null);
 if(phase==='credits'){
  await page.getByRole('button',{name:'Continue adventure',exact:true}).click();
  await page.waitForFunction(()=>window.app.current.game.server.state.recovery.endingPresentation?.phase==='finished',null,{timeout:15000});
 }
 if(phase==='credits'||!await page.evaluate(()=>window.app.current.game.serverEndingActive)){
  assert.equal(await page.evaluate(()=>window.app.current.game.server.command({kind:'endingReplay'})),true);
 }
 await page.waitForFunction(()=>window.app.current.game.serverEndingActive,null,{timeout:45000});
 const progress=()=>page.evaluate(()=>{const g=window.app.current.game,p=g.player;return{hp:p.unit.hp,maxHp:p.unit.maxHp,xp:p.xp,coins:p.coins,flags:{...g.server.state.self.player.flags}};});
 const before=await progress();assert.equal(before.xp,0);assert.equal(before.coins,0);
 const presentation=await page.evaluate(()=>{const g=window.app.current.game;return{id:g.serverEnding.current.id,phase:g.serverEnding.current.phase,tick:g.serverEnding.current.tick,cast:g.serverEnding.current.cast.length,ownsScene:window.app.engine.scene===g.serverEnding.scene};});assert.equal(presentation.ownsScene,true);
 await page.waitForFunction(()=>{const e=window.app.current.game.serverEnding;return ['opening','routine','finale'].includes(e.current?.phase)&&e.current?.cast.length&&e.readyCount===e.current.cast.length;},null,{timeout:45000});
 await capture('celebration-trusted-fixture.png');
 const camera=await page.evaluate(()=>window.app.current.game.serverEnding.camera.position.toArray());assert.ok(camera.every(Number.isFinite));
 const npc=()=>streams.at(-1)?.state?.actors.filter(a=>a.kind==='townsfolk').map(a=>({id:a.ref.id,x:a.x,z:a.z}))??[];const initialNpc=npc();
 await page.evaluate(()=>window.app.current.game.server.command({kind:'chatSay',channel:'area',text:'Ending integration chat remains active'}));await page.locator('.hud .chat .line.say').filter({hasText:'Ending integration chat remains active'}).last().waitFor({timeout:15000});
 assert.equal(await page.evaluate(()=>{const el=window.app.current.game.hud.chat.el;return el.classList.contains('hud-keep')&&getComputedStyle(el).opacity!=='0';}),true);
 await until(()=>{const next=npc();return initialNpc.some(a=>next.some(b=>a.id===b.id&&Math.hypot(a.x-b.x,a.z-b.z)>.03));},15000);
 // Retain an old DOM listener while the transport generation changes. It must never send a command.
 await page.getByRole('button',{name:'Skip celebration',exact:true}).waitFor({state:'visible',timeout:45000});
 const reconnectBefore=await page.evaluate(()=>{const g=window.app.current.game;window.oldEndingButton=document.querySelector('.ending-presentation button');const s=g.serverEnding.current;g.server.client.socket.close();return{id:s.id,tick:s.tick};});
 await until(()=>streams.length>=2&&streams.at(-1).state,20000);await page.waitForFunction(()=>window.app.current.game.server.client.state==='admitted'&&window.app.current.game.serverEndingActive,null,{timeout:20000});
 const resumed=await page.evaluate(()=>{const g=window.app.current.game,s=g.serverEnding.current;return{id:s.id,tick:s.tick};});assert.equal(resumed.id,reconnectBefore.id);assert.ok(resumed.tick>=reconnectBefore.tick);
 const priorCommands=commands.length;await page.evaluate(()=>window.oldEndingButton.click());await pause(150);assert.equal(commands.length,priorCommands,'Retired view listener sent a control');
 await page.getByRole('button',{name:'Skip celebration',exact:true}).waitFor({state:'visible',timeout:15000});
 const clickControl=async name=>{const button=page.getByRole('button',{name,exact:true});await button.evaluate(el=>{el.addEventListener('click',()=>window.endingClickBefore=structuredClone(window.app.current.game.serverEnding.current),{capture:true,once:true});el.addEventListener('click',()=>window.endingClickAfter=structuredClone(window.app.current.game.serverEnding.current),{once:true});});await button.click();return page.evaluate(()=>({before:window.endingClickBefore,after:window.endingClickAfter}));};
 const skip=await clickControl('Skip celebration');assert.deepEqual(skip.after,skip.before,'Click advanced the browser ending clock');
 await page.getByRole('heading',{name:'Credits',exact:true}).waitFor({timeout:15000});await page.waitForFunction(()=>getComputedStyle(window.app.current.game.hud.playerFrame.el).opacity==='0');await capture('credits-trusted-fixture.png');assert.equal(commands.filter(c=>c.id===resumed.id&&c.action==='skip').length,1);
 const finish=await clickControl('Continue adventure');assert.deepEqual(finish.after,finish.before);
 await page.waitForFunction(()=>!window.app.current.game.serverEndingActive,null,{timeout:15000});assert.equal(commands.filter(c=>c.id===resumed.id&&c.action==='continue').length,1);
 assert.equal(await page.evaluate(()=>{const g=window.app.current.game;return window.app.engine.scene===g.scene&&!g.hud.root.classList.contains('cinematic')&&!g.hud.chat.el.classList.contains('hud-keep');}),true);
 const after=await progress();assert.deepEqual(after,before);assert.deepEqual(wireErrors,[]);assert.deepEqual(errors,[]);assert.ok(authRevisions.length>=2&&authRevisions.every(r=>r===WIRE_SCHEMA_REVISION));
 await page.evaluate(async()=>{window.oldEndingGame=window.app.current.game;window.oldEndingScene=window.oldEndingGame.serverEnding.scene;await window.app.go('title');});await pause(250);assert.deepEqual(await page.evaluate(()=>{const g=window.oldEndingGame;return{alive:g.alive,endingCleared:g.serverEnding===null,hudCount:document.querySelectorAll('.ending-presentation').length,worldHidden:!g.scene.visible,endingHidden:!window.oldEndingScene.visible,cameraReleased:window.app.engine.scene!==window.oldEndingScene};}),{alive:false,endingCleared:true,hudCount:0,worldHidden:true,endingHidden:true,cameraReleased:true});
 for(const original of originalArtifacts)if(original)assert.equal(createHash('sha256').update(await readFile(original.path)).digest('hex'),original.sha256,'Prior artifact was modified');
 const report={scope:'Actual Game route, real typed binary WS and actual local PG host. Trusted W4 frostCleared checkpoint fixture, not earned story completion.',checks:{separateScene:true,actualCast:presentation.cast,orderedSkipAndContinue:true,clickDoesNotAdvance:true,fullReconnectSameId:true,oldListenerInert:true,chatContinues:true,otherActorsContinue:true,gameplayProgressUnchanged:true,cameraReturned:true,disposeClears:true,matchingSchemaHandshake:true,visibleFixtureWatermark:captures.length===2},captures,originalArtifacts,fixtureQualification:'Trusted stored W4 frostCleared checkpoint; not earned story completion.',authRevisions,commands:commands.map(({seq,action})=>({seq,action})),errors,wireErrors};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
 await browser?.close();await server?.close();if(host?.exitCode===null){host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),10000);await hostExited;clearTimeout(timer);}if(scratch)await rm(scratch,{recursive:true,force:true});
}
