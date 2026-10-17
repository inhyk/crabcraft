// Native keyboard + action-bar spam. Isolated immobile target / ample resources / God are fixtures.
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});const errors=[];
try{
 for(const cls of ['warrior','mage','priest']){
  const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(cls=>{localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:cls,shell:0,crest:0,led:0,name:'Recovery Tester'}));},cls);
  await p.goto(base+'/?screen=game');await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));
  await p.evaluate(()=>{const g=window.app.current.game,u=g.player.unit;g.god=true;const enemy=g.spawnAdd(u.pos.x,u.pos.z+1.5);if(!enemy)throw Error('No target fixture');enemy.update=()=>{};enemy.unit.hp=enemy.unit.maxHp=100000;g.player.setTarget(enemy.unit);g.player.maxResource=g.player.resource=10000;window.skillReleases=[];const commit=g.player.commit.bind(g.player);g.player.commit=(ab,target)=>{const before=g.player.cooldowns.get(ab.id)?.start;commit(ab,target);const cd=g.player.cooldowns.get(ab.id);if(cd&&cd.start!==before)window.skillReleases.push({id:ab.id,start:cd.start,end:cd.end,resource:g.player.resource,hp:u.hp});};});
  for(const slot of cls==='priest'?[1,2]:[1]){
   const ab=await p.evaluate(slot=>{const g=window.app.current.game;g.player.unit.hp=g.player.unit.maxHp*.1;g.player.unit.lastCombat=Infinity;return g.player.cls.abilities[slot-1];},slot);
   await p.locator('.ab-slot').nth(slot-1).hover();await p.locator('.cc-tooltip').waitFor({state:'visible'});assert.match(await p.locator('.cc-tooltip').innerText(),new RegExp(`재사용 ${ab.cooldown}초`));await p.mouse.move(2,2);
   const until=Date.now()+(ab.cooldown+2*ab.castTime+1)*1000;let count=0;
   while(Date.now()<until){if(count++%2)await p.keyboard.press(`Digit${slot}`);else await p.locator('.ab-slot').nth(slot-1).click();await p.waitForTimeout(45);}
   const records=await p.evaluate(id=>window.skillReleases.filter(r=>r.id===id),ab.id);if(records.length<2){await p.screenshot({path:'tmp/qa/cooldown-target-attempt.png'});console.log('SETUP_FAILURE',await p.evaluate(()=>{const g=window.app.current.game,p=g.player;return {time:g.time,locked:g.controlsLocked,resource:p.resource,target:p.target?{name:p.target.name,alive:p.target.alive,hostile:p.target.hostile,hidden:p.target.hidden,gap:p.unit.gapTo(p.target)}:null,error:document.querySelector('.msg-errors')?.textContent};}));}assert.ok(records.length>=2,JSON.stringify({ab,records}));
   for(let i=1;i<records.length;i++)assert.ok(records[i].start-records[i-1].start>=ab.cooldown+ab.castTime-.04,JSON.stringify({ab,records}));
   assert.ok(records.length<=2,JSON.stringify({ab,records}));
   console.log('NATIVE_REPEAT_LIMIT',JSON.stringify({base,cls,slot,id:ab.id,presses:count,cooldown:ab.cooldown,castTime:ab.castTime,records}));
   await p.screenshot({path:`tmp/qa/cooldown-${cls}-${slot}.png`});
  }
  await p.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: native rapid keys and action-bar clicks obey all four revised cooldowns with ample resources; real KO tooltips match; no page errors');
}finally{await browser.close();}
