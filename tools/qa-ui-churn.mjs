// Real-browser idle DOM churn and live level/party rendering; no HP/combat fixtures.
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
const output=process.argv[2]??'tmp/qa/ui-churn.json',strict=process.argv.includes('--optimized');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(relay=>{const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(url,protocols){super(String(url).includes('/multiplayer')?relay:url,protocols);}};localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','high');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'UI Performance'}));},new URL('/multiplayer',base).href.replace(/^http/,'ws'));
 await page.goto(base+'/?screen=game&multiplayer');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.getByRole('button',{name:'방 만들기',exact:true}).click();await page.waitForFunction(()=>window.app.current.game.multiplayer.battle.active);await page.waitForTimeout(700);
 const counts=await page.evaluate(async()=>{const result={durationMs:3000,partyChildChanges:0,levelChildChanges:0,partyAddedNodes:0,levelAddedNodes:0};const targets=[['party',document.querySelector('.mp-party')],['level',document.querySelector('.uf-player .uf-level')]];const observers=targets.map(([key,node])=>{const o=new MutationObserver(records=>{for(const r of records)if(r.type==='childList'){result[key+'ChildChanges']++;result[key+'AddedNodes']+=r.addedNodes.length;}});o.observe(node,{childList:true,subtree:true});return o;});await new Promise(r=>setTimeout(r,3000));for(const o of observers)o.disconnect();return result;});
 console.log('IDLE',JSON.stringify(counts));
 await page.mouse.click(640,496);await page.keyboard.type('13570');await page.getByRole('button',{name:'레벨 +1',exact:true}).click();await page.getByRole('button',{name:'제작자 화면 닫기',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.uf-player .uf-level').textContent==='2');
 await page.locator('[data-party="3"]').click();await page.waitForFunction(()=>document.querySelector('.mp-party .mp-member').classList.contains('party-3'));await page.waitForFunction(()=>document.querySelector('.mp-party .mp-member small').textContent===`${Math.ceil(window.app.current.game.player.unit.hp)} / ${Math.ceil(window.app.current.game.player.unit.maxHp)}`);
 await page.mouse.click(640,496);await page.keyboard.press('Escape');await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mp-party').textContent.includes('Party 3'));await page.getByRole('button',{name:'한국어',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mp-party').textContent.includes('파티 3'));
 const dynamic=await page.evaluate(()=>({level:document.querySelector('.uf-player .uf-level').textContent,party:document.querySelector('.mp-party').textContent,hp:window.app.current.game.player.unit.hp}));
 if(strict){assert.equal(counts.partyChildChanges,0);assert.equal(counts.levelChildChanges,0);}assert.deepEqual(errors,[]);const result={counts,dynamic,errors};writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
