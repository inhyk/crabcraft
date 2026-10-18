// Actual Game route -> matched binary codec -> actual loopback host/PG.
// The approved launcher seeds a trusted W4 clear flag. This is not earned story completion.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {freePort} from '../server/node/local-postgres.mjs';
import {GameplayReceiver,WIRE_SCHEMA_REVISION} from '../server/world/gameplay/protocol.ts';
import {decodeInput} from '../server/world/gameplay/intents.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,process.env.ENDING_QA_OUTPUT??'tmp/qa/world-ending-controlled');
const width=Number(process.env.ENDING_QA_WIDTH??1280),height=Number(process.env.ENDING_QA_HEIGHT??800),quality=process.env.ENDING_QA_QUALITY??'low';
assert.ok(['low','high'].includes(quality));
assert.ok(Number.isSafeInteger(width)&&width>=320&&Number.isSafeInteger(height)&&height>=540);
const provided=process.env.WORLD_QA_METADATA,scratch=provided?null:await mkdtemp('/private/tmp/crabcraft-ending-client-'),metadataPath=provided??join(scratch,'host.json');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Cut contract (src/multiplayer/endingPresentationView.ts endingShot): wide cuts and the routine moves that may use each hero cut.
const CAPTURE_COUNT=7,WIDE_CUTS=['crane','landmark','farewell'],HERO_CUTS={close:['break_sixstep','break_oneclaw'],low:['break_spin','break_jumpspin','break_backflip']};
async function until(fn,timeout=15000){const end=performance.now()+timeout;while(!await fn()){if(performance.now()>end)throw Error('Ending client QA timed out');await pause(25);}}
let host,server,browser,hostExited,debugTimer,cleanupProof;
const wireErrors=[],commands=[],streams=[],authRevisions=[],captures=[];
const originalArtifacts=await Promise.all(['game-celebration.png','game-credits.png','report.json'].map(async name=>{const path=join(root,'tmp/qa/world-ending-client',name);try{return{path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}catch{return null;}}));
try{
 await mkdir(output,{recursive:true});
 const baseline=process.env.ENDING_QA_BASELINE??'9d93b91d218871b4de8f546a722df12a3699a536';
 if(!/^[0-9a-f]{40}$/.test(baseline))throw Error('Expected exact baseline commit');
 const baselineBundle=`ending-baseline-${baseline}.mjs`,baselineModule=`/tmp/qa/${baselineBundle}`;
 await build({entryPoints:[join(root,'src/multiplayer/worldEndingPresentation.ts')],bundle:true,packages:'external',platform:'browser',format:'esm',outfile:join(root,'tmp/qa',baselineBundle),define:{'import.meta.env.BASE_URL':"'/'"},loader:{'.md':'text','.css':'empty'},logLevel:'silent',plugins:[{name:'accepted-ending-baseline',setup(build){build.onResolve({filter:/^\.\.\//},args=>{if(!['endingPresentationView.ts','endingStage.ts'].some(name=>args.importer.endsWith('/src/multiplayer/'+name)))return;return{path:'/'+resolve(dirname(args.importer),args.path).slice(root.length),external:true};});build.onLoad({filter:/src\/multiplayer\/(worldEndingPresentation|endingPresentationView|endingStage)\.ts$/},args=>({contents:execFileSync('git',['show',`${baseline}:${args.path.slice(root.length)}`],{cwd:root,encoding:'utf8'}),loader:'ts'}));}}]});
 const port=await freePort();
 if(!provided){host=spawn(process.execPath,['tools/qa-world-host-server.mjs','--port','0','--client-origin',`http://127.0.0.1:${port}`,'--metadata',metadataPath,'--world','w4','--ending','1','--ledger','1'],{cwd:root,stdio:['ignore','pipe','ignore']});host.stdout.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){try{const value=JSON.parse(line);if(value.stopped===true)cleanupProof={durable:value.durable,unresolved:value.unresolved};}catch{}}});hostExited=new Promise(resolve=>host.once('exit',(code,signal)=>resolve({code,signal})));}
 let metadata;await until(async()=>{try{metadata=JSON.parse(await readFile(metadataPath,'utf8'));return true;}catch{if(host?.exitCode!==null&&host?.exitCode!==undefined)throw Error('Ending QA launcher exited before readiness');return false;}},120000);
 const origin=new URL(metadata.clientOrigin),backend=new URL(metadata.origin);
 if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||backend.protocol!=='http:'||backend.hostname!=='127.0.0.1'||metadata.endingIntegrationFixture!==true||metadata.earnedEnding!==false||metadata.world!=='w4'||metadata.catalog.wireSchemaRevision!==WIRE_SCHEMA_REVISION)throw Error('Expected explicit trusted W4 ending integration fixture');
 server=await createServer({root,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:Number(origin.port),strictPort:true,hmr:false,proxy:{'/api/account':{target:backend.origin},'/world':{target:backend.origin,ws:true}}}});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width,height}});await context.grantPermissions(['local-network-access'],{origin:origin.origin});await context.addCookies([{name:metadata.cookie.name,value:metadata.cookie.value,domain:'127.0.0.1',path:metadata.cookie.path,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('websocket',ws=>{if(new URL(ws.url()).pathname!=='/world')return;const stream={binding:null,receiver:null,state:null};streams.push(stream);
  ws.on('framereceived',({payload})=>{try{if(typeof payload==='string'){const value=JSON.parse(payload);if(value.type==='world-bound'){const{type,...binding}=value;stream.binding=binding;stream.receiver=new GameplayReceiver(binding,metadata.catalog);}}else if(stream.receiver){const result=stream.receiver.accept(payload,performance.now()/1000);if(result?.kind==='snapshot')stream.state=result.state;}}catch(error){wireErrors.push(error.message);}});
  ws.on('framesent',({payload})=>{if(typeof payload==='string'){const value=JSON.parse(payload);if(value.type==='authenticate')authRevisions.push(value.schemaRevision??null);return;}if(!stream.binding)return;try{const input=decodeInput(payload,stream.binding,metadata.catalog);for(const command of input.commands)if(command.kind==='endingControl')commands.push({seq:input.seq,...command});}catch{/* Non-input resync/control frames use their own parser. */}});
 });
 await page.addInitScript(({appearance,quality})=>{localStorage.setItem('cc.language','en');localStorage.setItem('cc.quality',quality);localStorage.setItem('cc.spec',JSON.stringify(appearance));},{appearance:metadata.appearance,quality});
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
  const details=await page.evaluate(async()=>{const g=window.app.current.game,e=g.serverEnding,c=e.camera,h=g.server.state.header,THREE=await import('/node_modules/three/build/three.module.js');const observation=structuredClone(e.current),projected=[],lights=[];
   // Exact posed hero silhouette: every third skinned vertex through its leading bone, as the shader skins it.
   const heroRig=e.view?.rigs.get(0);let heroSilhouette=null;if(heroRig){heroRig.root.updateMatrixWorld(true);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;const p=new THREE.Vector3(),m=new THREE.Matrix4();heroRig.root.traverse(o=>{if(!o.isSkinnedMesh||!o.visible)return;const pos=o.geometry.attributes.position,idx=o.geometry.attributes.skinIndex,w=o.geometry.attributes.skinWeight;for(let i=0;i<pos.count;i+=3){let lead=0;for(let k=1;k<4;k++)if(w.getComponent(i,k)>w.getComponent(i,lead))lead=k;const b=idx.getComponent(i,lead);m.multiplyMatrices(o.matrixWorld,o.bindMatrixInverse).multiply(o.skeleton.bones[b].matrixWorld).multiply(o.skeleton.boneInverses[b]).multiply(o.bindMatrix);p.fromBufferAttribute(pos,i).applyMatrix4(m).project(c);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}});heroSilhouette={minX,minY,maxX,maxY};}let casters=0,receivers=0;e.scene.updateMatrixWorld(true);e.scene.traverse(o=>{if(o.isMesh&&o.visible){if(o.castShadow)casters++;if(o.receiveShadow)receivers++;}if(o.isDirectionalLight){const pos=new THREE.Vector3(),target=new THREE.Vector3();o.getWorldPosition(pos);o.target.getWorldPosition(target);o.shadow.updateMatrices(o);lights.push({position:pos.toArray(),target:target.toArray(),castShadow:o.castShadow,mapSize:o.shadow.mapSize.toArray(),mapReady:!!o.shadow.map,mapFormat:o.shadow.map?.texture.format??null,mapType:o.shadow.map?.texture.type??null,depthType:o.shadow.map?.depthTexture?.type??null,cameraPosition:o.shadow.camera.position.toArray(),cameraBounds:[o.shadow.camera.left,o.shadow.camera.right,o.shadow.camera.top,o.shadow.camera.bottom],bias:o.shadow.bias,normalBias:o.shadow.normalBias});}});for(const [slot,rig]of e.view?.rigs??[]){rig.root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(rig.root);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(let i=0;i<8;i++){const p=new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).project(c);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}projected.push({slot,minX,minY,maxX,maxY,worldMinY:box.min.y,worldMaxY:box.max.y,sourceY:observation.cast.find(a=>a.ref.slot===slot)?.position.y});}return{shot:e.view?.shot??null,framed:e.view?.framed??null,heroSilhouette,shadowDiagnostics:{rendererEnabled:g.app.engine.renderer.shadowMap.enabled,casters,receivers,lights,contacts:e.view?.contacts?.root.children.length??0,fps:g.app.engine.fps,gpuMs:g.app.engine.gpuMs,rendererMemory:{...g.app.engine.renderer.info.memory},renderCalls:g.app.engine.renderer.info.render.calls,renderTriangles:g.app.engine.renderer.info.render.triangles},observation,frame:{session:h.session,area:h.area,epoch:h.epoch,catalog:h.catalog,sequence:h.sequence,selfRef:g.server.state.selfRef},camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,aspect:c.aspect,near:c.near,far:c.far},projected};});
  // Frame contract: wide cuts hold the whole observed cast; hero cuts (close, low) are allowed only during
  // their bounded routine moves and must hold the hero's exact posed silhouette.
  const inside=b=>b.minX>-.91&&b.maxX<.91&&b.minY>-.61&&b.maxY<.61;
  if(!details.observation.cast.length)assert.equal(details.projected.length,0);
  else if(WIDE_CUTS.includes(details.shot))for(const actor of details.projected)assert.ok(inside(actor),`Full observed cast must fit the ${details.shot} frame`);
  else{assert.ok(HERO_CUTS[details.shot]?.includes(details.observation.move)&&details.observation.phase==='routine',`Unexpected cut ${details.shot} in ${details.observation.phase}/${details.observation.move}`);assert.ok(details.heroSilhouette&&inside(details.heroSilhouette),`Hero must fit the ${details.shot} frame`);}
  captures.push({file:path,label,...details,png:{width,height,sha256:createHash('sha256').update(png).digest('hex')},originalRenderedCapture:true,imageEditing:false});
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
 await page.waitForFunction(()=>window.app.current.game.serverEnding.stage!==null,null,{timeout:45000});
 console.error('QA celebration ready',await page.evaluate(()=>({phase:window.app.current.game.serverEnding.current.phase,tick:window.app.current.game.serverEnding.current.tick})));
 await capture('celebration-trusted-fixture.png');
 const camera=await page.evaluate(()=>window.app.current.game.serverEnding.camera.position.toArray());assert.ok(camera.every(Number.isFinite));
 const npc=()=>streams.at(-1)?.state?.actors.filter(a=>a.kind==='townsfolk').map(a=>({id:a.ref.id,x:a.x,z:a.z}))??[];const initialNpc=npc();
 await page.evaluate(()=>window.app.current.game.server.command({kind:'chatSay',channel:'area',text:'Ending integration chat remains active'}));await page.locator('.hud .chat .line.say').filter({hasText:'Ending integration chat remains active'}).last().waitFor({timeout:15000});
 assert.equal(await page.evaluate(()=>{const el=window.app.current.game.hud.chat.el;return el.classList.contains('hud-keep')&&getComputedStyle(el).opacity!=='0';}),true);
 // One capture per cut, each inside its server-tick window: six-step cypher, spin low sky, one-claw close-up,
 // finale landmark and the farewell crane.
 const cut=async(name,range)=>{await page.waitForFunction(w=>{const e=window.app.current.game.serverEnding,s=e?.current;if(!s||!e.view||e.readyCount!==s.cast.length||e.stage===null)return false;const local=s.tick-s.phaseStartedTick;return s.phase===w.phase&&(w.move===undefined||s.move===w.move)&&s.tick>=(w.from??0)&&local>=(w.local??0)&&local<(w.until??Infinity);},range,{timeout:45000});await capture(name);};
 await cut('cypher-trusted-fixture.png',{phase:'routine',move:'break_sixstep',from:306});
 await cut('low-sky-trusted-fixture.png',{phase:'routine',move:'break_spin',from:480});
 await until(()=>{const next=npc();return initialNpc.some(a=>next.some(b=>a.id===b.id&&Math.hypot(a.x-b.x,a.z-b.z)>.03));},15000);
 await cut('freeze-closeup-trusted-fixture.png',{phase:'routine',move:'break_oneclaw',from:640});
 // Retain an old DOM listener while the transport generation changes. It must never send a command.
 console.error('QA before skip wait',await page.evaluate(()=>({phase:window.app.current.game.serverEnding.current?.phase,tick:window.app.current.game.serverEnding.current?.tick,button:document.querySelector('.ending-control')?.outerHTML})));
 debugTimer=setInterval(()=>{void page.evaluate(()=>({phase:window.app.current.game.serverEnding.current?.phase,tick:window.app.current.game.serverEnding.current?.tick,client:window.app.current.game.server.client.state,wirePhase:window.app.current.game.server.state.recovery.endingPresentation?.phase,wireTick:window.app.current.game.server.state.recovery.endingPresentation?.tick,hidden:document.querySelector('.ending-control')?.hidden})).then(value=>console.error('QA wait',value,'errors',errors,'wireErrors',wireErrors)).catch(()=>{});},5000);
 await page.getByRole('button',{name:'Skip celebration',exact:true}).waitFor({state:'visible',timeout:45000});clearInterval(debugTimer);
 const reconnectBefore=await page.evaluate(()=>{const g=window.app.current.game;window.oldEndingButton=document.querySelector('.ending-presentation button');const s=g.serverEnding.current;g.server.client.socket.close();return{id:s.id,tick:s.tick};});
 await until(()=>streams.length>=2&&streams.at(-1).state,20000);await page.waitForFunction(()=>window.app.current.game.server.client.state==='admitted'&&window.app.current.game.serverEndingActive,null,{timeout:20000});
 const resumed=await page.evaluate(()=>{const g=window.app.current.game,s=g.serverEnding.current;return{id:s.id,tick:s.tick};});assert.equal(resumed.id,reconnectBefore.id);assert.ok(resumed.tick>=reconnectBefore.tick);
 const priorCommands=commands.length;await page.evaluate(()=>window.oldEndingButton.click());await pause(150);assert.equal(commands.length,priorCommands,'Retired view listener sent a control');
 await cut('landmark-trusted-fixture.png',{phase:'finale',local:24,until:200});
 await cut('farewell-trusted-fixture.png',{phase:'finale',local:270,until:360});
 await page.getByRole('button',{name:'Skip celebration',exact:true}).waitFor({state:'visible',timeout:15000});
 const clickControl=async name=>{const button=page.getByRole('button',{name,exact:true});await button.evaluate(el=>{el.addEventListener('click',()=>window.endingClickBefore=structuredClone(window.app.current.game.serverEnding.current),{capture:true,once:true});el.addEventListener('click',()=>window.endingClickAfter=structuredClone(window.app.current.game.serverEnding.current),{once:true});});await button.click();return page.evaluate(()=>({before:window.endingClickBefore,after:window.endingClickAfter}));};
 const skip=await clickControl('Skip celebration');assert.deepEqual(skip.after,skip.before,'Click advanced the browser ending clock');
 await page.getByRole('heading',{name:'Credits',exact:true}).waitFor({timeout:15000});await page.waitForFunction(()=>getComputedStyle(window.app.current.game.hud.playerFrame.el).opacity==='0');await capture('credits-trusted-fixture.png');assert.equal(commands.filter(c=>c.id===resumed.id&&c.action==='skip').length,1);
 const finish=await clickControl('Continue adventure');assert.deepEqual(finish.after,finish.before);
 await page.waitForFunction(()=>!window.app.current.game.serverEndingActive,null,{timeout:15000});assert.equal(commands.filter(c=>c.id===resumed.id&&c.action==='continue').length,1);
 assert.equal(await page.evaluate(()=>{const g=window.app.current.game;return window.app.engine.scene===g.scene&&!g.hud.root.classList.contains('cinematic')&&!g.hud.chat.el.classList.contains('hud-keep');}),true);
 const after=await progress();assert.deepEqual(after,before);assert.deepEqual(wireErrors,[]);assert.deepEqual(errors,[]);assert.ok(authRevisions.length>=2&&authRevisions.every(r=>r===WIRE_SCHEMA_REVISION));
 // Same accepted observation, exact shared camera matrix: stage/UI comparison only.
 // This does not synthesize a phase, advance a clock, or send any input.
 await page.mouse.move(2,2);await pause(350);
 const pairs=[],cutPairs=[];const sample=captures.find(c=>c.observation.cast.length);
 // Opens the accepted observation in a private preview built from the baseline commit ('before') or this tree ('after').
 const openPreview=async(version,sample)=>{
  await page.evaluate(async({version,sample,baselineModule})=>{
   const g=window.app.current.game,{WorldEndingPresentation}=await import(version==='before'?baselineModule:'/src/multiplayer/worldEndingPresentation.ts');
   let prior=null;
   const preview=new WorldEndingPresentation({parent:g.app.ui,
    activate:(scene,camera)=>g.app.engine.setView(scene,camera,{bloom:{intensity:.9,threshold:.9},vignette:{offset:.3,darkness:.5}}),
    restore:()=>g.app.engine.setView(g.scene,g.camera,{bloom:{intensity:.9,threshold:.9},vignette:{offset:.3,darkness:.5}}),
    // Same port semantics as actual Game: preserve prior state and retain chat only.
    cinematic:on=>{if(on&&!prior){prior={cinematic:g.hud.root.classList.contains('cinematic'),chatKeep:g.hud.chat.el.classList.contains('hud-keep')};g.hud.chat.el.classList.add('hud-keep');g.hud.setCinematic(true);}else if(!on&&prior){g.hud.setCinematic(prior.cinematic);if(!prior.chatKeep)g.hud.chat.el.classList.remove('hud-keep');prior=null;}},
    command:()=>false,alive:()=>true});
   window.endingVisualComparison=preview;preview.commit(sample.observation,sample.frame);
  }, {version,sample,baselineModule});
  await page.waitForFunction(()=>{const e=window.endingVisualComparison;return e.readyCount===e.current.cast.length&&e.stage!==null;},null,{timeout:45000});
  // Class assignment alone is insufficient: HUD opacity transitions last0.8s and bars1.2s.
  // Wait for the real CSS transition, without changing CSS or postprocessing the screenshot.
  await page.waitForFunction(()=>{
   const g=window.app.current.game;
   return g.hud.root.classList.contains('cinematic')&&g.hud.chat.el.classList.contains('hud-keep')&&
    [...g.hud.root.children].filter(el=>!el.classList.contains('hud-keep')).every(el=>Number(getComputedStyle(el).opacity)===0)&&
    [...g.hud.root.querySelectorAll('.letterbox')].every(el=>Math.abs(el.getBoundingClientRect().height-innerHeight*.11)<.5);
  },null,{timeout:10000});
 };
 const closePreview=()=>page.evaluate(()=>{window.endingVisualComparison.dispose();window.endingVisualComparison=null;});
 for(const version of ['before','after']){
  await openPreview(version,sample);
  await page.evaluate(sample=>{const e=window.endingVisualComparison,c=e.camera;e.render();c.position.fromArray(sample.camera.position);c.quaternion.fromArray(sample.camera.quaternion);c.fov=sample.camera.fov;c.aspect=sample.camera.aspect;c.near=sample.camera.near;c.far=sample.camera.far;c.updateProjectionMatrix();c.updateMatrixWorld();},sample);
  await markFixture();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const conditions=await page.evaluate(()=>{
   const g=window.app.current.game,e=window.endingVisualComparison,c=e.camera;
   const inspect=el=>{const style=getComputedStyle(el),r=el.getBoundingClientRect();let effectiveOpacity=1,hidden=false;for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);effectiveOpacity*=Number(s.opacity);hidden||=s.display==='none'||s.visibility==='hidden'||p.hidden;}return{opacity:Number(style.opacity),effectiveOpacity,display:style.display,visibility:style.visibility,visible:!hidden&&effectiveOpacity>.001&&r.width>0&&r.height>0};};
   const overlays=Object.fromEntries(Object.entries({player:g.hud.playerFrame.el,minimap:g.hud.minimap.el,actionbar:g.hud.actionBar.el,prompt:g.hud.prompt.el,npcLabels:g.hud.plates.el,bubbles:g.hud.bubbles.el,floats:g.hud.floats.el,chat:g.hud.chat.el}).map(([key,el])=>[key,inspect(el)]));
   return{observation:structuredClone(e.current),camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,aspect:c.aspect,near:c.near,far:c.far},quality:{setting:g.app.engine.setting,tier:g.app.engine.quality,pixelRatio:g.app.engine.pixelRatio},viewOptions:structuredClone(g.app.engine.viewOptions),hud:{classes:g.hud.root.className,chatClasses:g.hud.chat.el.className,overlays,letterboxes:[...g.hud.root.querySelectorAll('.letterbox')].map(el=>({classes:el.className,height:el.getBoundingClientRect().height})),nonKeepVisible:[...g.hud.root.children].filter(el=>!el.classList.contains('hud-keep')&&inspect(el).visible).map(el=>el.className),visibleTooltips:[...document.querySelectorAll('.cc-tooltip')].filter(el=>inspect(el).visible).length}};
  });
  assert.deepEqual(conditions.observation,sample.observation);assert.deepEqual(conditions.camera,sample.camera);
  assert.equal(conditions.quality.setting,quality);assert.deepEqual(conditions.hud.nonKeepVisible,[]);assert.equal(conditions.hud.visibleTooltips,0);
  for(const [name,value]of Object.entries(conditions.hud.overlays))assert.equal(value.visible,name==='chat',`Unexpected cinematic overlay ${name}`);
  if(pairs.length)assert.deepEqual(conditions,pairs[0].conditions,'Controlled pair HUD/DTO/camera/quality/view conditions differ');
  const file=join(output,`same-camera-${version}-trusted-fixture.png`),png=await page.screenshot({path:file});
  pairs.push({file,sha256:createHash('sha256').update(png).digest('hex'),version,acceptedTick:sample.observation.tick,camera:sample.camera,conditions,conditionsDigest:createHash('sha256').update(JSON.stringify(conditions)).digest('hex')});
  await closePreview();
 }
 // Same accepted observation per cut, each version framing it with its own camera: the cut comparison.
 for(const shot of captures.filter(c=>c.observation.cast.length)){
  const name=shot.file.split('/').at(-1).replace('-trusted-fixture.png','');
  for(const version of ['before','after']){
   await openPreview(version,shot);
   await page.evaluate(()=>window.endingVisualComparison.render());
   await markFixture();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const info=await page.evaluate(()=>{const e=window.endingVisualComparison,c=e.camera;return{observation:structuredClone(e.current),shot:e.view?.shot??null,camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,aspect:c.aspect}};});
   assert.deepEqual(info.observation,shot.observation);if(version==='after')assert.equal(info.shot,shot.shot);
   const file=join(output,`cut-${name}-${version}-trusted-fixture.png`),png=await page.screenshot({path:file});
   cutPairs.push({file,sha256:createHash('sha256').update(png).digest('hex'),version,name,acceptedTick:shot.observation.tick,phase:shot.observation.phase,move:shot.observation.move,shot:info.shot,camera:info.camera});
   await closePreview();
  }
 }
 await page.evaluate(async()=>{window.oldEndingGame=window.app.current.game;window.oldEndingScene=window.oldEndingGame.serverEnding.scene;await window.app.go('title');});await pause(250);assert.deepEqual(await page.evaluate(()=>{const g=window.oldEndingGame;return{alive:g.alive,endingCleared:g.serverEnding===null,hudCount:document.querySelectorAll('.ending-presentation').length,worldHidden:!g.scene.visible,endingHidden:!window.oldEndingScene.visible,cameraReleased:window.app.engine.scene!==window.oldEndingScene};}),{alive:false,endingCleared:true,hudCount:0,worldHidden:true,endingHidden:true,cameraReleased:true});
 for(const original of originalArtifacts)if(original)assert.equal(createHash('sha256').update(await readFile(original.path)).digest('hex'),original.sha256,'Prior artifact was modified');
 const lateSceneryDisposed=await page.evaluate(async()=>{const{WorldEndingPresentation}=await import('/src/multiplayer/worldEndingPresentation.ts');const scene=new WorldEndingPresentation({parent:document.body,activate:()=>{},restore:()=>{},cinematic:()=>{},command:()=>false,alive:()=>true});scene.dispose();await new Promise(resolve=>setTimeout(resolve,250));return scene.stage===null&&scene.scene.children.length===0&&!scene.scene.visible;});assert.equal(lateSceneryDisposed,true);
 const report={quality,controlledBaseline:baseline,controlledBundleSha256:createHash('sha256').update(await readFile(join(root,'tmp/qa',baselineBundle))).digest('hex'),scope:'Actual Game route, real typed binary WS and actual local PG host. Trusted W4 frostCleared checkpoint fixture, not earned story completion.',checks:{separateScene:true,actualCast:presentation.cast,orderedSkipAndContinue:true,clickDoesNotAdvance:true,fullReconnectSameId:true,oldListenerInert:true,chatContinues:true,otherActorsContinue:true,gameplayProgressUnchanged:true,cameraReturned:true,disposeClears:true,matchingSchemaHandshake:true,visibleFixtureWatermark:captures.length===CAPTURE_COUNT,wideCutsHoldFullCast:true,heroCutsHoldHero:true,cutsCaptured:captures.map(c=>c.shot),sameAcceptedObservationCamera:true,identicalCinematicHudConditions:true,sameObservationOwnCameraCuts:cutPairs.length,lateSceneryDisposed},captures,pairs,cutPairs,originalArtifacts,fixtureQualification:'Trusted stored W4 frostCleared checkpoint; not earned story completion.',authRevisions,commands:commands.map(({seq,action})=>({seq,action})),errors,wireErrors};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
 clearInterval(debugTimer);await browser?.close();await server?.close();if(host?.exitCode===null){host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),10000);await hostExited;clearTimeout(timer);}if(scratch){assert.deepEqual(cleanupProof,{durable:true,unresolved:0},'Owned QA host failed its durable cleanup');const reportFile=join(output,'report.json');try{const report=JSON.parse(await readFile(reportFile,'utf8'));report.ownedHostCleanup=cleanupProof;await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');}catch{}await rm(scratch,{recursive:true,force:true});}
}
