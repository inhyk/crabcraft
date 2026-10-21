// node tools/qa-shard-restart.mjs — two guests in one public shard in headless Chrome, then a deploy-style restart of
// server-dist/main.mjs (SIGTERM, a new process on the same port): both must be back in a public shard by themselves
// within about 10 s. Also checks that a guest boots without a console error. A throwaway Postgres, the server on 8795
// (the /api/account proxy target in vite.config.ts) and `vite preview` of dist/ on 5208; the pages' /multiplayer
// socket is pointed at 8795, since the preview's own relay is not the one being restarted. Run `pnpm build` first.
// Screenshots go to CC_QA_SHOTS (default tmp/qa).
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {mkdirSync} from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {launchBrowser} from './lib/browser.mjs';
import {startPostgres} from '../server/node/local-postgres.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),shots=process.env.CC_QA_SHOTS??join(root,'tmp/qa'),shot=name=>join(shots,name);mkdirSync(shots,{recursive:true});
const base='http://127.0.0.1:5208';
execFileSync(process.execPath,[join(root,'server/node/build.mjs')],{stdio:'inherit'});
const postgres=await startPostgres();
const children=[];
async function run(args,env,ready){
 const child=spawn(process.execPath,args,{cwd:root,env:{PATH:process.env.PATH,...env},stdio:['ignore','pipe','pipe']});children.push(child);
 let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
 for(const until=Date.now()+30000;!ready.test(out);await new Promise(r=>setTimeout(r,100)))if(child.exitCode!==null||Date.now()>until)throw new Error(`${args[0]} did not start:\n${out}`);
 return child;
}
const serve=()=>run([join(root,'server-dist/main.mjs')],{PORT:'8795',HOST:'127.0.0.1',DATABASE_URL:postgres.url},/listening on/);
let browser;const pageErrors=[];
async function open(name){
 const p=await browser.newPage({viewport:{width:1280,height:800}});p.consoleErrors=[];
 p.on('pageerror',e=>pageErrors.push(`${name}: ${e.message}`));p.on('console',m=>{if(m.type()==='error')p.consoleErrors.push(m.text());});
 await p.addInitScript(name=>{
  localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');
  localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name}));
  const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){super(String(url).includes('/multiplayer')?'ws://127.0.0.1:8795/multiplayer':url,protocols);}};
 },name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();
 await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 // Every HUD info line, kept: the restart note lasts 2.5 s and may be gone before the other page is back.
 await p.evaluate(()=>{window.__notes=[];new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.classList?.contains('info'))window.__notes.push(n.textContent);}).observe(document.querySelector('.msg-errors'),{childList:true});});
 return p;
}
const shard=p=>p.evaluate(()=>{const m=window.app.current.game.multiplayer;return {id:m.ownId,shard:m.shard,open:m.ws?.readyState===1,peers:m.peers.size,status:m.status.textContent,summary:m.summary.textContent};});
const together=(p,timeout)=>p.waitForFunction(()=>{const m=window.app.current.game.multiplayer;return m.ws?.readyState===1&&m.shard&&m.peers.size===1;},null,{timeout,polling:100});
try{
 let server=await serve();
 await run([join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','5208','--strictPort'],{},/5208/);
 browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
 const a=await open('Shard Ada'),b=await open('Shard Bo');
 for(const p of [a,b])await together(p,15000);
 const before=[await shard(a),await shard(b)];
 assert.equal(before[0].shard,before[1].shard);assert.match(before[0].shard,/^W1/);
 // A guest's boot: session answers 200 {signedIn:false}, the shard welcome arrives; nothing in the console.
 assert.deepEqual([a.consoleErrors,b.consoleErrors],[[],[]]);console.log('GUEST_BOOT_NO_CONSOLE_ERROR_PASS',before);
 for(const p of [a,b])await p.evaluate(()=>{document.querySelector('.mp-panel').open=true;});
 await a.bringToFront();await a.screenshot({path:shot('shard-before-restart.png')});
 // A deploy: SIGTERM, the unit stops, a new process starts on the same port (`down` ms later). Nobody clicks anything.
 const results=[];
 async function deploy(label,down,budget){
  const ids=[(await shard(a)).id,(await shard(b)).id];
  const stopped=Date.now();server.kill('SIGTERM');const [code]=await new Promise(r=>server.once('exit',(...x)=>r(x)));assert.equal(code,0);const exitedIn=Date.now()-stopped;
  await new Promise(r=>setTimeout(r,Math.max(0,down-exitedIn)));
  server=await serve();const restartedIn=Date.now()-stopped;
  await Promise.all([a,b].map(p=>together(p,Math.max(1000,budget-(Date.now()-stopped)))));
  const backIn=Date.now()-stopped,after=[await shard(a),await shard(b)];
  // The note after a gap of more than 3 s, in the HUD's info line.
  const notes=await Promise.all([a,b].map(p=>p.evaluate(()=>window.__notes.splice(0))));
  for(const [p,name] of [[a,''],[b,'-b']]){await p.bringToFront();await p.screenshot({path:shot(`shard-after-${label}${name}.png`)});}
  assert.equal(after[0].shard,after[1].shard);assert.match(after[0].shard,/^W1/);
  assert.notDeepEqual([after[0].id,after[1].id],ids);
  assert.ok(backIn<budget,`back in ${backIn} ms`);
  const r={label,exitedIn,restartedIn,backIn,shard:after[0].shard,notes};results.push(r);console.log('SHARD_REJOIN_AFTER_RESTART_PASS',r);
  return r;
 }
 // systemctl restart, as deploy/vm/activate.sh does: the port is closed for well under a second.
 await deploy('quick-restart',0,10000);
 // A slower restart keeps everyone out for 4 s: they still come back alone (the backoff is at its 4 s step by then)
 // and are told why the crowd vanished.
 const slow=await deploy('slow-restart',4000,15000);
 for(const n of slow.notes)assert.ok(n.includes('서버가 다시 시작돼서 다시 연결했어요.'),JSON.stringify(slow.notes));
 // Retries that reached the stopped server are logged by Chrome as failed WebSocket connections; anything else fails.
 const all=[...a.consoleErrors,...b.consoleErrors],other=all.filter(e=>!/^WebSocket connection to 'ws:\/\/127\.0\.0\.1:8795\/multiplayer.*' failed/.test(e));
 console.log(`console errors after the restarts: ${all.length} failed WebSocket tries against the stopped server, ${other.length} other`);
 assert.deepEqual(other,[]);assert.deepEqual(pageErrors,[]);
 console.log(`PASS: guest boot without console errors; two players in one public shard back together after each restart without a click (${results.map(r=>`${r.label}: ${r.backIn} ms after SIGTERM, new process listening after ${r.restartedIn} ms`).join('; ')}); restart note after the slow one; page errors 0; screenshots in ${shots}`);
}catch(e){for(const [i,page] of (browser?.contexts()??[]).flatMap(c=>c.pages()).entries())await page.screenshot({path:shot(`shard-failure-${i}.png`)}).catch(()=>{});throw e;}
finally{await browser?.close();for(const c of children)c.kill('SIGTERM');postgres.stop();}
