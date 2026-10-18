// Production browser bundle -> bundled Node main -> disposable PG. No pre-created character.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { startPostgres, freePort } from '../server/node/local-postgres.mjs';
import { createPool, migrate } from '../server/node/db.ts';
import { GameplayReceiver } from '../server/world/gameplay/protocol.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,timeout=15000){const end=performance.now()+timeout;while(!check()){if(performance.now()>end)throw Error('Production world QA timed out');await pause(25);}}
let cluster,pool,child,exit,frontend,browser;
const clients=new Set();
try{
 cluster=await startPostgres();pool=createPool(cluster.url);pool.on('connect',c=>{clients.add(c);c.once('end',()=>clients.delete(c));});await migrate(pool);
 const account='g'+randomBytes(12).toString('hex').slice(0,23),token=randomBytes(32).toString('hex');
 const legacy=JSON.stringify({legacyProgress:{xp:999999,coins:9999}});
 await pool.query('INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,$2,47,1,1)',[account,legacy]);
 await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)',[createHash('sha256').update(token).digest('hex'),account,Date.now()+600000]);
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;
 const manifest=JSON.parse(await readFile(new URL('../server-dist/world/world-manifest.json',import.meta.url),'utf8'));
 const config={schema:'world-startup-v1',ownership:{key:'production-browser-qa'},assets:{source:manifest.source,manifest:'world-manifest.json'},
  worlds:Object.fromEntries(['w1','w2','w3','w4'].map((w,i)=>[w,{seed:i+1,populationMode:'fixed-slots',fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:1,scavenger:0,jellyfish:0,shallowPatrols:0},respawnSeconds:{scrapling:300,scavenger:300,jellyfish:300,echo:120}}])),
  restore:{cooldowns:'pause',statuses:'pause',death:'pause',history:'pause',hp:'preserve',resource:'preserve',location:'saved',activity:'cancel'},
  victimOutcome:{maxEntries:1024,maxPayloadBytes:4194304,timeoutMs:3000},chat:{maxPending:16},characters:{maxCharactersPerAccount:2},party:{enabled:false}};
 child=spawn(process.execPath,['server-dist/main.mjs'],{cwd:root,env:{...process.env,DATABASE_URL:cluster.url,HOST:'127.0.0.1',PORT:'0',ALLOWED_ORIGINS:origin,WORLD_ENABLED:'1',WORLD_CONFIG_JSON:JSON.stringify(config)},stdio:['ignore','pipe','pipe']});exit=once(child,'exit');
 let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
 await until(()=>/listening on 127\.0\.0\.1:\d+/.test(output)||child.exitCode!==null);assert.equal(child.exitCode,null,'bundled server startup');
 const backend='http://'+output.match(/listening on (127\.0\.0\.1:\d+)/)[1];
 frontend=await preview({root,configFile:false,preview:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api/account':{target:backend},'/world':{target:backend,ws:true}}},logLevel:'error'});
 const catalog=await (await fetch(backend+'/api/account/world-catalog')).json();
 browser=await chromium.launch({headless:true,channel:'chrome'});const context=await browser.newContext({viewport:{width:1280,height:720}});
 await context.grantPermissions(['local-network-access'],{origin});
 await context.addCookies([{name:'cc_account',value:`${account}.${token}`,domain:'127.0.0.1',path:'/api/account',httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage(),pageErrors=[],wireErrors=[],streams=[];let legacyPosts=0,characterPosts=0;
 page.on('pageerror',e=>pageErrors.push(e.message));page.on('request',r=>{if(r.method()==='POST'){const p=new URL(r.url()).pathname;if(p==='/api/account/save')legacyPosts++;if(p==='/api/account/world-characters')characterPosts++;}});
 page.on('websocket',ws=>{if(new URL(ws.url()).pathname!=='/world')return;const stream={view:null,binding:null,receiver:null};streams.push(stream);ws.on('framereceived',({payload})=>{try{if(typeof payload==='string'){const message=JSON.parse(payload);if(message.type==='world-bound'){const {type,...binding}=message;stream.binding=binding;stream.receiver=new GameplayReceiver(binding,catalog);}}else if(stream.receiver){const update=stream.receiver.accept(payload,performance.now()/1000);if(update?.kind==='snapshot')stream.view=update.state;}}catch(e){wireErrors.push(e.message);}});});
 await page.addInitScript(()=>{localStorage.setItem('cc.language','en');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'female',classId:'mage',shell:1,crest:2,led:2,name:'Fresh Main'}));localStorage.setItem('cc.journey.v1:human:female:mage:Fresh Main',JSON.stringify({xp:999999,coins:9999}));});
 await page.goto(origin+'/?screen=game&world=server',{waitUntil:'load'});await page.locator('.launch-notice-start').click();
 await page.locator('.world-character-select').waitFor({timeout:120000});
 await page.getByRole('button',{name:'Create a new character with this appearance',exact:true}).click();
 await until(()=>streams.at(-1)?.view,120000);await page.locator('.world-character-select').waitFor({state:'detached'});await page.locator('.world-connection-status').waitFor({state:'hidden'});await page.locator('.loading').waitFor({state:'detached'});await page.waitForFunction(()=>{const hud=document.querySelector('.hud');return hud&&getComputedStyle(hud).opacity==='1';});
 assert.equal(await page.locator('.dungeon-menu').count(),0,'Server mode must not expose the browser-authoritative dungeon entrance');
 const character=new URL(page.url()).searchParams.get('character');assert(character,'selection updates current URL');assert.equal(characterPosts,1);
 const first=streams.at(-1),start=first.view.actors.find(a=>a.ref.id===first.view.selfRef.id),position={x:start.x,z:start.z};
 assert.equal(first.view.self.player.xp,0);assert.equal(first.view.self.player.coins,0);
 await page.keyboard.down('KeyW');await until(()=>{const view=streams.at(-1).view,a=view.actors.find(a=>a.ref.id===view.selfRef.id);return Math.hypot(a.x-position.x,a.z-position.z)>.3;});await page.keyboard.up('KeyW');
 await page.reload({waitUntil:'load'});const notice=page.locator('.launch-notice-start');if(await notice.isVisible())await notice.click();
 await until(()=>streams.length>=2&&streams.at(-1).view,120000);await page.locator('.world-connection-status').waitFor({state:'hidden'});await page.locator('.loading').waitFor({state:'detached'});await page.waitForFunction(()=>{const hud=document.querySelector('.hud');return hud&&getComputedStyle(hud).opacity==='1';});
 assert.equal(new URL(page.url()).searchParams.get('character'),character);assert.equal(streams.at(-1).view.self.player.xp,0);assert.equal(characterPosts,1);assert.equal(legacyPosts,0);assert.deepEqual(pageErrors,[]);assert.deepEqual(wireErrors,[]);
 const records=(await pool.query('SELECT character_id,revision,checkpoint_json FROM world_characters WHERE account_id=$1',[account])).rows;assert.equal(records.length,1);assert.equal(records[0].character_id,character);assert.equal(JSON.parse(records[0].checkpoint_json).progress.xp,0);
 const old=(await pool.query('SELECT save,revision FROM accounts WHERE username=$1',[account])).rows[0];assert.equal(old.save,legacy);assert.equal(Number(old.revision),47);
 const dir=new URL('../output/playwright/world-main/',import.meta.url);await mkdir(dir,{recursive:true});const screenshot=fileURLToPath(new URL('production-create-reconnect.png',dir));await page.screenshot({path:screenshot});
 console.log(JSON.stringify({scope:'Production dist + actual bundled Node main + real throwaway PG; HTTP session fixture only, no seeded character or progress import',characterPosts,legacyPosts,streams:streams.length,characterRows:records.length,freshXp:0,pageErrors,wireErrors,screenshot}));
 await browser.close();browser=null;child.kill('SIGTERM');const [code,signal]=await exit;assert.equal(code,0);assert.equal(signal,null);assert(!output.includes(token)&&!errors.includes(token),'credential-free server logs');
}finally{
 await browser?.close();if(frontend){frontend.httpServer.closeAllConnections();await new Promise(resolve=>frontend.httpServer.close(resolve));}
 if(child?.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),10000);try{await exit;}finally{clearTimeout(timer);}}
 const ended=[...clients].map(c=>once(c,'end'));await pool?.end();await Promise.all(ended);cluster?.stop();
}
