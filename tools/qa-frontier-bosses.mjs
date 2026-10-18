import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5233';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 const p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(()=>{new MutationObserver(()=>{const e=document.querySelector('.loading .ld-art');if(e)window.__loadingArt=e.style.backgroundImage;}).observe(document,{childList:true,subtree:true});localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Frontier bosses QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');});
 async function ready(){await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;g.journey.rustCleared=g.journey.abyssCleared=g.journey.trueCleared=g.journey.finalCleared=g.journey.frostCleared=true;g.journey.firstEndingSeen=true;g.ending.cancel();});await p.waitForTimeout(500);await p.keyboard.press('Space');}
 await p.goto(base+'/?screen=game');await ready();
 for(const [chapter,level,field,name,xp,coins]of [[5,500,'emberBoss','이그니스',350000,30000],[6,750,'skyBoss','제피로스',600000,50000]]){
  await p.evaluate(({chapter,level})=>{const g=window.app.current.game;g.world2.go(chapter);g.player.restoreXp(22000+2200*(level-21)+100*(level-21)*(level-22));g.player.xpBlessingUntil=0;g.journey.root.open=true;g.journey.refreshLanguage();},{chapter,level});
  const card=p.locator('.bj-card').filter({hasText:name});assert.equal(await p.locator('.bj-card').count(),7);
  assert.equal(await card.locator('button').isDisabled(),true,'underlevel boss gate');
  await p.evaluate(level=>{const g=window.app.current.game,n=level-20;g.player.restoreXp(22000+2200*n+100*n*(n-1));g.journey.refreshLanguage();},level);
  await card.locator('button').click();await p.waitForFunction(field=>window.app.current.game[field].engaged,field);
  await p.evaluate(field=>{const g=window.app.current.game,b=g[field];b.nextSwing=Infinity;g.player.unit.teleport(g.world,b.arena.position.x+9,b.arena.position.z+6);g.follow.yaw=0;g.follow.pitch=.48;g.follow.distance=22;const sink=g.events.sink;window.bossWarnings=[];g.events.sink=e=>{if(e.type==='telegraph'&&e.src===b.unit)window.bossWarnings.push({kind:e.mech,seconds:e.seconds,count:e.shapes.length});sink(e);};},field);
  await p.waitForFunction(()=>window.bossWarnings.length>0);await p.screenshot({path:`tmp/qa/frontier-${chapter}-boss.png`});
  const pattern=await p.evaluate(()=>window.bossWarnings[0]);assert.equal(pattern.kind,chapter===5?'barrage':'eclipse');assert.ok(pattern.seconds>=2.8);
  const result=await p.evaluate(field=>{const g=window.app.current.game,b=g[field],before=[g.player.xp,g.player.coins];g.combat.damage(g.player.unit,b.unit,b.unit.maxHp*10);const reward=[g.player.xp-before[0],g.player.coins-before[1]];g.journey.onBossDefeated(b);return {reward,duplicate:[g.player.xp-before[0],g.player.coins-before[1]],clear:field==='emberBoss'?g.journey.emberCleared:g.journey.skyCleared};},field);
  assert.deepEqual(result,{reward:[xp,coins],duplicate:[xp,coins],clear:true});
  await p.waitForFunction(field=>window.app.current.game[field].state==='dead',field);
  await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-100;g.journey.root.open=true;g.journey.refreshLanguage();});await card.locator('button').click();await p.waitForFunction(field=>window.app.current.game[field].engaged,field);
  assert.equal(await p.evaluate(field=>{const b=window.app.current.game[field];return b.unit.hp===b.unit.maxHp;},field),true);
  await p.evaluate(field=>{const g=window.app.current.game,b=g[field];g.combat.damage(g.player.unit,b.unit,b.unit.maxHp*10);g.journey.save();},field);
  await p.waitForFunction(field=>window.app.current.game[field].state==='dead',field);
  await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,83);g.follow.yaw=0;g.follow.pitch=.35;g.follow.distance=24;g.follow.cut();});await p.waitForTimeout(800);await p.screenshot({path:`tmp/qa/frontier-${chapter}-village.png`});
  await p.reload();await ready();assert.deepEqual(await p.evaluate(field=>{const g=window.app.current.game;return [g.world2.chapter,field==='emberBoss'?g.journey.emberCleared:g.journey.skyCleared];},field),[chapter,true]);
  const seen=await p.evaluate(()=>window.__loadingArt);const art='art/'+(chapter===5?'loading-emberreach.webp':'loading-skybloom.webp');assert.ok(seen.includes(art));const img=await p.request.get(base+'/'+art);assert.equal(img.status(),200);assert.match(img.headers()['content-type'],/webp/);
  console.log(`PASS W${chapter}: Lv${level} admission, real ${pattern.kind} warning, exact ${xp} XP/${coins} coins, duplicate prevention, fresh rematch, save/reload and correct WebP loading art`);
 }
 for(const [chapter,level]of [[5,350],[5,450],[6,550],[6,650]]){
  const result=await p.evaluate(({chapter,level})=>{const g=window.app.current.game,n=750-20;g.world2.go(chapter);g.player.restoreXp(22000+2200*n+100*n*(n-1));g.player.unit.lastCombat=-100;g.player.xpBlessingUntil=0;g.dungeons.open();const count=document.querySelectorAll('.dungeon-cards article').length;g.dungeons.close();const before=[g.player.xp,g.player.coins];if(!g.dungeons.start(level))throw Error('entry failed '+level);const d=g.dungeons;for(let wave=0;wave<3;wave++){d.update(4);for(const e of g.enemies.filter(e=>e.isDungeonOnly&&e.unit.alive))g.combat.damage(g.player.unit,e.unit,e.unit.maxHp*10);d.update(.01);}const state=d.state.phase,reward=[g.player.xp-before[0],g.player.coins-before[1]];d.update(.1);const duplicate=[g.player.xp-before[0],g.player.coins-before[1]];d.leave();return {count,state,reward,duplicate,left:!d.active};},{chapter,level});
  assert.equal(result.count,10);assert.equal(result.state,'clear');assert.equal(result.left,true);assert.ok(result.reward[0]>0&&result.reward[1]>0);assert.deepEqual(result.reward,result.duplicate);console.log(`PASS Lv${level} dungeon: actual three waves, clear reward once and return`);
 }
 assert.deepEqual(errors,[]);console.log('PASS zero native Chrome errors');
}finally{await browser.close();}
