// node tools/qa-accounts.mjs — Google sign-in in headless Chrome, with no real Google account: a throwaway Postgres,
// server-dist/main.mjs on 8795 (the /api/account proxy target in vite.config.ts) pointed at a fake Google, and
// `vite preview` of dist/ on 5205. Run `pnpm build` first. Screenshots go to CC_QA_SHOTS (default tmp/qa).
import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';import {mkdirSync} from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {launchBrowser} from './lib/browser.mjs';
import {fakeGoogle} from '../server/node/fake-google.mjs';import {startPostgres} from '../server/node/local-postgres.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),shots=process.env.CC_QA_SHOTS??join(root,'tmp/qa'),shot=name=>join(shots,name);mkdirSync(shots,{recursive:true});
const base='http://127.0.0.1:5205',clientId='qa-client.apps.googleusercontent.com',clientSecret='GOCSPX-'+randomBytes(18).toString('base64url');
execFileSync(process.execPath,[join(root,'server/node/build.mjs')],{stdio:'inherit'});
const postgres=await startPostgres();
// Advertised as localhost while the game is on 127.0.0.1, so the round trip is cross-site as with the real Google.
const google=await fakeGoogle({clientId,clientSecret,name:'localhost',sub:'qa-'+randomBytes(6).toString('hex')});
const children=[];let log='';
async function run(args,env,ready){
 const child=spawn(process.execPath,args,{cwd:root,env:{PATH:process.env.PATH,...env},stdio:['ignore','pipe','pipe']});children.push(child);
 let out='';child.stdout.on('data',d=>{out+=d;log+=d;});child.stderr.on('data',d=>{out+=d;log+=d;});
 for(const until=Date.now()+30000;!ready.test(out);await new Promise(r=>setTimeout(r,100)))if(child.exitCode!==null||Date.now()>until)throw new Error(`${args[0]} did not start:\n${out}`);
}
let browser;const errors=[],consoleErrors=[];
// A visit: the launch notice, then the title.
async function start(p){await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.currentId==='title');assert.equal(await p.evaluate(()=>window.__qaNotices),1);}
async function open(guest=false,en=false){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 // Every launch notice each document shows, counted from its first node.
 await p.addInitScript(()=>{window.__qaNotices=0;new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.classList?.contains('launch-notice'))window.__qaNotices++;}).observe(document,{childList:true,subtree:true});});
 await p.addInitScript(({guest,en})=>{
 // Seed once: the Google round trip reloads the page and must find what the player had, not a fresh fixture.
 if(location.origin!=='http://127.0.0.1:5205'||localStorage.getItem('cc.qaSeeded'))return;localStorage.setItem('cc.qaSeeded','1');
 localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');if(en)localStorage.setItem('cc.language','en');if(guest){localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Account Explorer'}));localStorage.setItem('cc.journey.v1:human:male:mage:Account Explorer',JSON.stringify({xp:137,coins:73,chapter:1}));}},{guest,en});await p.goto(base);await start(p);return p;}
// The button leaves for start, the fake Google and the callback as full-page redirects; the game reloads behind them.
// The flag marks the page that leaves, so the wait ends on the document the callback loads, which skips the launch notice.
async function viaGoogle(p,en=false,screen='title'){await p.evaluate(()=>{window.__qaLeaving=true;});await p.getByRole('button',{name:en?'Sign in with Google':'Google로 로그인',exact:true}).click();await p.waitForFunction(s=>!window.__qaLeaving&&window.app?.currentId===s,screen,{timeout:90000});assert.equal(await p.evaluate(()=>window.__qaNotices),0);assert.equal(await p.locator('.launch-notice').count(),0);assert.ok(!new URL(p.url()).searchParams.has('account'));}
// Back from Google signed in: the screen the player left, a short note, and no dialog.
async function welcomed(p,en=false){await p.getByText(en?'Signed in with Google':'Google 계정으로 로그인했어요',{exact:true}).waitFor();assert.equal(await p.locator('.account-dialog').count(),0);}
async function signedIn(p){await p.waitForFunction(()=>/^g[a-f0-9]{23}$/.test(window.app.account.username));}
async function game(p){await p.getByRole('button',{name:/^(입장하기|Enter World)$/}).click();await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));}
try{
 await run([join(root,'server-dist/main.mjs')],{PORT:'8795',HOST:'127.0.0.1',DATABASE_URL:postgres.url,GOOGLE_CLIENT_ID:clientId,GOOGLE_CLIENT_SECRET:clientSecret,GOOGLE_AUTH_URL:google.authUrl,GOOGLE_TOKEN_URL:google.tokenUrl},/listening on/);
 await run([join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','5205','--strictPort'],{},/5205/);
 browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
 const p=await open(true);
 // A guest's session check answers 200 {signedIn:false}: booting logs no console error.
 assert.deepEqual(consoleErrors,[]);console.log('GUEST_BOOT_NO_CONSOLE_ERROR_PASS');
 await p.getByRole('button',{name:'로그인',exact:true}).click();await p.getByRole('button',{name:'Google로 로그인',exact:true}).waitFor();assert.equal(await p.locator('.account-dialog input').count(),0);
 await p.setViewportSize({width:718,height:492});assert.ok(await p.locator('.account-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));await p.screenshot({path:shot('account-signin-compact.png')});await p.setViewportSize({width:1280,height:800});await p.screenshot({path:shot('account-signin.png')});
 // A server without GOOGLE_CLIENT_ID answers 503 before the page leaves.
 await p.route('**/api/account/google/start**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"google"}'}));await p.getByRole('button',{name:'Google로 로그인',exact:true}).click();await p.getByText('로그인 준비 중이에요.',{exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,'/');await p.screenshot({path:shot('account-not-ready.png')});await p.unroute('**/api/account/google/start**');
 // A token Google issued for another app comes back as ?account=error, shown and then removed from the address.
 google.claims.aud='someone-else.apps.googleusercontent.com';await viaGoogle(p);delete google.claims.aud;await p.getByText('Google 로그인을 마치지 못했어요. 다시 해 주세요.',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.app.account.username),'');await p.screenshot({path:shot('account-error.png')});console.log('NOT_READY_AND_CALLBACK_ERROR_MESSAGES_PASS');
 // First sign-in: the new account takes this device's guest adventure, as signup did.
 await viaGoogle(p);await signedIn(p);await welcomed(p);await p.waitForFunction(()=>window.app.account.revision>=1&&Object.entries(JSON.parse(window.app.account.saved||'{}')).some(([k,v])=>k.startsWith('cc.journey.v1:')&&JSON.parse(v).xp===137));
 assert.ok(!/cc_account|cc_oauth/.test(await p.evaluate(()=>document.cookie)));await p.screenshot({path:shot('account-signed-in.png')});
 await game(p);assert.deepEqual(await p.evaluate(()=>{const g=window.app.current.game;return {xp:g.player.xp,coins:g.player.coins};}),{xp:137,coins:73});
 // Explicit progress fixture, then the real save listener and cloud request.
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.restoreXp(487);g.player.coins=99;g.achievements.restore({earned:['sail','island','landfall','treasure'],distance:63});g.journey.save();});await p.waitForFunction(()=>{const a=window.app.account;return a.revision>=2&&Object.entries(JSON.parse(a.saved||'{}')).some(([k,v])=>k.startsWith('cc.journey.v1:')&&JSON.parse(v).xp===487&&JSON.parse(v).achievements?.earned.includes('treasure'));});await p.keyboard.press('Escape');await p.getByRole('button',{name:'계정 · Google',exact:true}).click();await p.screenshot({path:shot('account-saved.png')});await p.getByRole('button',{name:'닫기',exact:true}).click();
 // Second device, in English: the same Google account loads the cloud save, as login did.
 const b=await open(false,true);await b.getByRole('button',{name:'Sign in',exact:true}).click();await viaGoogle(b,true);await signedIn(b);assert.equal(await b.evaluate(()=>window.app.account.username),await p.evaluate(()=>window.app.account.username));await welcomed(b,true);await b.screenshot({path:shot('account-second-device.png')});
 await game(b);assert.deepEqual(await b.evaluate(()=>{const g=window.app.current.game;return {xp:g.player.xp,coins:g.player.coins};}),{xp:487,coins:99});assert.ok(await b.evaluate(()=>['sail','island','landfall','treasure'].every(id=>window.app.current.game.achievements.has(id))));await b.keyboard.press('KeyJ');await b.getByText('🏆 Pearl Treasure',{exact:true}).waitFor();await b.keyboard.press('Escape');console.log('GOOGLE_FIRST_SIGNIN_IMPORT_AND_SECOND_DEVICE_CONTINUE_WITH_ACHIEVEMENTS_PASS');
 // A second device advances; a stale first device must retain its local cache, without overwriting cloud.
 await b.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.restoreXp(700);g.player.coins=123;g.journey.save();});await b.waitForFunction(()=>{const a=window.app.account;return a.revision>=3&&Object.entries(JSON.parse(a.saved||'{}')).some(([k,v])=>k.startsWith('cc.journey.v1:')&&JSON.parse(v).xp===700);});await p.keyboard.press('Escape');await p.evaluate(()=>{const g=window.app.current.game;g.player.coins=100;g.journey.save();});await p.waitForFunction(()=>window.app.account.conflict);assert.equal(await p.evaluate(()=>window.app.current.game.player.coins),100);console.log('CONCURRENT_SAVE_CONFLICT_KEEPS_LOCAL_PASS');
 // Reload first device chooses the newer cloud revision while keeping its displaced local copy. A sign-in left
 // unfinished more than 15 minutes ago does not count as a return from Google: the launch notice shows as on any visit.
 await p.evaluate(()=>localStorage.setItem('cc.account.pending',`${Date.now()-16*60000}:title`));await p.reload();await start(p);await signedIn(p);assert.equal(await p.locator('.account-dialog').count(),0);await game(p);assert.deepEqual(await p.evaluate(()=>{const g=window.app.current.game;return {xp:g.player.xp,coins:g.player.coins};}),{xp:700,coins:123});
 await p.keyboard.press('Escape');await p.getByRole('button',{name:'계정 · Google',exact:true}).click();await p.getByRole('button',{name:'로그아웃',exact:true}).click();await p.waitForFunction(()=>!window.app.account.username);await p.getByRole('button',{name:'Google로 로그인',exact:true}).waitFor();await p.screenshot({path:shot('account-signed-out.png')});await p.getByRole('button',{name:'닫기',exact:true}).click();await game(p);assert.deepEqual(await p.evaluate(()=>{const g=window.app.current.game;return {xp:g.player.xp,coins:g.player.coins};}),{xp:137,coins:73});assert.equal(await p.evaluate(()=>window.app.current.game.achievements.has('treasure')),false);console.log('SESSION_RELOAD_AND_LOGOUT_GUEST_ISOLATION_PASS');
 // Signing in from the game menu lands back in the game, on the account's save.
 await p.keyboard.press('Escape');await p.getByRole('button',{name:'로그인',exact:true}).click();await viaGoogle(p,false,'game');await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await welcomed(p);await signedIn(p);assert.equal(await p.evaluate(()=>window.app.currentId),'game');await p.screenshot({path:shot('account-signed-in-game.png')});assert.deepEqual(await p.evaluate(()=>{const g=window.app.current.game;return {xp:g.player.xp,coins:g.player.coins};}),{xp:700,coins:123});
 // Nothing on this document was clicked, launch notice included: the keyboard still reaches the game.
 await p.keyboard.press('KeyJ');await p.locator('.achievement-menu').waitFor();await p.keyboard.press('Escape');console.log('SIGNIN_FROM_GAME_RETURNS_TO_GAME_PASS');
 for(const secret of [clientSecret,...google.issued])assert.ok(!log.includes(secret),'a secret reached the server log');
 assert.deepEqual(errors,[]);console.log(`PASS: guest boot without console errors, launch notice on every visit and none after the Google round trip, Google-only dialog, compact dialog, not-ready and error messages, cross-site fake Google round trip, HttpOnly session, guest import into a new account, no dialog after the round trip (title or game, with a note), automatic cloud save, English second device on the same account, exact XP/coins restore, conflict protection, session reload, logout and unchanged guest, no secrets in the server log; page errors 0; screenshots in ${shots}`);
}catch(e){for(const [i,page] of (browser?.contexts()??[]).flatMap(c=>c.pages()).entries())await page.screenshot({path:shot(`account-failure-${i}.png`)}).catch(()=>{});throw e;}finally{await browser?.close();for(const c of children)c.kill('SIGTERM');await google.close();postgres.stop();}
