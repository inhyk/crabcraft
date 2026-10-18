import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5218';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
try{
 const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Forge QA'}));localStorage.setItem('cc.language','ko');
  const key='cc.journey.v1:human:male:warrior:Forge QA';if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({xp:0,coins:1000,attackRank:3,chapter:1}));
  if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}
 });
 async function ready(){await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});await p.waitForTimeout(1000);await p.keyboard.press('Space');}
 async function forge(){await p.evaluate(()=>{const g=window.app.current.game,n=g.npcById('pip');g.player.unit.teleport(g.world,n.unit.pos.x,n.unit.pos.z);g.player.unit.lastCombat=-100;});await p.keyboard.press('KeyF');await p.locator('.forge-panel').waitFor({state:'visible'});}
 await p.goto(base+'/?screen=game');await ready();
 assert.deepEqual(await p.evaluate(()=>{const p=window.app.current.game.player;return [p.attackRank,p.armorRank,p.coins]}),[3,0,1000]);
 await forge();assert.equal(await p.locator('.forge-card').count(),2);
 await p.screenshot({path:'tmp/qa/forge-before.png'});
 await p.getByRole('button',{name:'방어구 구매 · 100 코인',exact:true}).click();
 assert.match(await p.locator('.forge-notice').innerText(),/구매 완료/);
 await p.getByRole('button',{name:'무기 강화 · 400 코인',exact:true}).click();
 await p.getByRole('button',{name:'방어구 강화 · 200 코인',exact:true}).click();
 assert.deepEqual(await p.evaluate(()=>{const p=window.app.current.game.player;return [p.attackRank,p.armorRank,p.coins]}),[4,2,300]);
 assert.equal(await p.getByRole('button',{name:'무기 강화 · 500 코인',exact:true}).isDisabled(),true);
 assert.match(await p.locator('.forge-notice').innerText(),/강화 성공/);
 const before=await p.evaluate(()=>window.app.current.game.player.unit.pos.toArray());await p.keyboard.down('KeyW');await p.waitForTimeout(250);await p.keyboard.up('KeyW');
 assert.deepEqual(await p.evaluate(()=>window.app.current.game.player.unit.pos.toArray()),before);
 await p.screenshot({path:'tmp/qa/forge-upgraded.png'});
 await p.keyboard.press('Escape');assert.equal(await p.locator('.forge-panel').isVisible(),false);assert.equal(await p.evaluate(()=>window.app.current.game.hud.menu.open),false);
 const damage=await p.evaluate(()=>{const g=window.app.current.game,u=g.player.unit;g.god=false;g.player.armorRank=25;u.hp=u.maxHp=100;u.invulnerable=false;u.absorb=0;const n=g.combat.damage(null,u,40,{noReact:true});g.player.armorRank=2;g.god=true;g.player.unit.lastCombat=-100;g.journey.save();return n;});assert.equal(damage,20);
 await p.reload();await ready();assert.deepEqual(await p.evaluate(()=>{const p=window.app.current.game.player;return [p.attackRank,p.armorRank,p.coins]}),[4,2,300]);
 console.log('PASS legacy weapon save migration, actual NPC/F opening, independent purchases/costs, insufficient coins, input blocking, Escape, armor damage and reload');
 await forge();await p.getByRole('button',{name:'주민의 부탁 듣기',exact:true}).click();assert.equal(await p.locator('.forge-panel').isVisible(),false);assert.equal(await p.evaluate(()=>window.app.current.game.hud.dialogue.isOpen),true);
 await p.keyboard.press('Escape');await p.waitForTimeout(100);await p.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await p.getByRole('button',{name:'English',exact:true}).click();await p.evaluate(()=>window.app.current.game.hud.menu.close());
 await forge();assert.match(await p.locator('.forge-panel').innerText(),/Equipment Shop & Forge/);assert.match(await p.locator('.forge-panel').innerText(),/7.4%/);
 await p.setViewportSize({width:800,height:600});await p.screenshot({path:'tmp/qa/forge-english.png'});
 assert.equal(await p.evaluate(()=>{const el=document.querySelector('.forge-panel'),r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),true);
 await p.evaluate(()=>{const g=window.app.current.game;g.player.attackRank=g.player.armorRank=100;g.hud.forge.update();});
 assert.equal(await p.getByRole('button',{name:'Fully upgraded',exact:true}).count(),2);
 await p.keyboard.press('Escape');
 console.log('PASS villager quest access, English previews, small viewport scrolling and maximum-rank UI');
 assert.deepEqual(errors,[]);console.log('PASS zero browser errors');
}catch(e){console.error(e);for(const c of browser.contexts())for(const p of c.pages()){console.error(await p.locator('body').innerText().catch(()=>''));await p.screenshot({path:'tmp/qa/forge-failure.png'}).catch(()=>{});}throw e;}finally{await browser.close();}
