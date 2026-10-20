import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5250',out=process.env.CC_QA_SHOTS??'tmp/qa/tidecrown-residents';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});const errors=[];
try{
 const p=await browser.newPage({viewport:{width:1600,height:900}});p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Capital visitor'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','high');});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:240000});
 const entry=await p.evaluate(async()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;g.ending.cancel();g.player.nextSwing=Infinity;window.__capitalBefore={quest:JSON.stringify(g.quests.status),chapter:g.quests.chapter,units:g.units.length};await g.world2.enterTidecrown();return {count:g.world2.tidecrownPeople.people.length,names:g.world2.tidecrownPeople.people.map(p=>p.unit.name),visible:g.world2.tidecrownPeople.people.filter(p=>!p.unit.hidden).length};});
assert.equal(entry.count,56);assert.equal(entry.visible,56);assert.equal(new Set(entry.names).size,56);await p.waitForFunction(()=>!document.querySelector('.tidecrown-loading'));
 console.log('PASS 56 unique, visible residents loaded lazily on capital entry');
 const reveal=async()=>{await p.locator('.dlg-text').click();await p.waitForFunction(()=>{const d=window.app.current.game.hud.dialogue;return !d.typing&&document.querySelector('.dlg-text').textContent===d.paras.map(p=>p.text).join('');});};
 // Each resident is reached through the actual F interaction, rather than calling a dialogue helper.
 if(!process.env.CC_QA_SHOTS_ONLY){
 for(let i=0;i<56;i++){
  const name=await p.evaluate(i=>{const g=window.app.current.game,u=g.world2.tidecrownPeople.people[i].unit;g.hud.dialogue.close();g.player.unit.teleport(g.world,u.pos.x,u.pos.z+1.4);g.player.setTarget(null);return u.name;},i);
  await p.keyboard.press('KeyF');await p.waitForFunction(name=>window.app.current.game.hud.dialogue.unit?.name===name,name);
  assert.equal(await p.locator('.dlg-name').textContent(),name);await reveal();const first=await p.locator('.dlg-text').textContent();
  await p.getByRole('button',{name:'다른 이야기 듣기',exact:true}).click();await reveal();assert.notEqual(await p.locator('.dlg-text').textContent(),first);
  await p.getByRole('button',{name:'이곳에 대해 알려 주세요',exact:true}).click();await reveal();assert.ok((await p.locator('.dlg-text').textContent()).length>15);
  if(i===2)await p.screenshot({path:`${out}/market-conversation.png`});
  await p.getByRole('button',{name:'다음에 만나요',exact:true}).click();assert.equal(await p.locator('.dlg').isVisible(),false);if((i+1)%8===0)console.log(`PASS ${i+1}/56 resident conversations`);
 }
 console.log('PASS all 56 residents: F opens their own dialogue, another story and district topic work, Goodbye closes');
 await p.evaluate(async()=>{const {setLanguage}=await import('/src/i18n.ts');setLanguage('en');const g=window.app.current.game,u=g.world2.tidecrownPeople.people[0].unit;g.player.unit.teleport(g.world,u.pos.x,u.pos.z+1.4);});await p.keyboard.press('KeyF');await p.getByRole('button',{name:'Tell me about this district',exact:true}).click();await reveal();assert.match(await p.locator('.dlg-text').textContent(),/Moult Market/);await p.getByRole('button',{name:'Goodbye',exact:true}).click();await p.evaluate(async()=>{const {setLanguage}=await import('/src/i18n.ts');setLanguage('ko');});console.log('PASS English names, dialogue and district guidance');
 }
 // Real shop entry from the resident dialogue, purchases, insufficient funds and persisted equipment.
 const shops=await p.evaluate(()=>window.app.current.game.world2.tidecrownPeople.people.flatMap((p,i)=>p.def.shop?[i]:[]));
 assert.equal(shops.length,3);
 for(const index of shops){
  await p.evaluate(i=>{const g=window.app.current.game,u=g.world2.tidecrownPeople.people[i].unit;g.hud.dialogue.close();g.player.unit.teleport(g.world,u.pos.x,u.pos.z+1.4);g.player.unit.lastCombat=-100;},index);
  await p.keyboard.press('KeyF');await p.getByRole('button',{name:'🪙 장비 상점 열기',exact:true}).click();await p.getByRole('heading',{name:'타이드크라운 장비상점'}).waitFor();
  await p.getByRole('button',{name:'상인과 대화하기',exact:true}).click();assert.equal(await p.locator('.dlg').isVisible(),true);
 }
 console.log('PASS all three merchants open the shop through F and return to conversation');
 await p.evaluate(()=>{const g=window.app.current.game,p=g.player;p.coins=99;p.attackRank=p.armorRank=0;p.weaponOwned=p.armorOwned=false;});
 await p.getByRole('button',{name:'🪙 장비 상점 열기',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('[data-slot="weapon"]').disabled);assert.equal(await p.locator('[data-slot="armor"]').isDisabled(),true);
 await p.evaluate(()=>window.app.current.game.player.coins=500);await p.getByRole('button',{name:'무기 구매 · 100 코인',exact:true}).click();
 await p.waitForFunction(()=>window.app.current.game.player.attackRank===1);assert.equal(await p.evaluate(()=>window.app.current.game.player.coins),400);
 await p.getByRole('button',{name:'방어구 구매 · 100 코인',exact:true}).click();await p.getByRole('button',{name:'무기 강화 · 200 코인',exact:true}).click();
 assert.deepEqual(await p.evaluate(()=>{const p=window.app.current.game.player;return [p.coins,p.attackRank,p.armorRank,p.weaponOwned,p.armorOwned];}),[100,2,1,true,true]);
 const saved=await p.evaluate(()=>{const g=window.app.current.game;return JSON.parse(localStorage.getItem(g.journey.key));});assert.equal(saved.coins,100);assert.equal(saved.attackRank,2);assert.equal(saved.armorRank,1);
 const restored=await p.evaluate(()=>{const g=window.app.current.game;g.player.coins=g.player.attackRank=g.player.armorRank=0;g.player.weaponOwned=g.player.armorOwned=false;g.journey.restore();const p=g.player;return [p.coins,p.attackRank,p.armorRank,p.weaponOwned,p.armorOwned];});assert.deepEqual(restored,[100,2,1,true,true]);
 await p.evaluate(async()=>{const {setLanguage}=await import('/src/i18n.ts');setLanguage('en');});await p.getByRole('heading',{name:'Tidecrown Outfitters'}).waitFor();
 await p.setViewportSize({width:480,height:800});assert.equal(await p.locator('.forge-panel').evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true);await p.getByRole('button',{name:'Close forge'}).waitFor();
 await p.setViewportSize({width:1600,height:900});await p.evaluate(async()=>{const {setLanguage}=await import('/src/i18n.ts');setLanguage('ko');});await p.getByRole('heading',{name:'타이드크라운 장비상점'}).waitFor();console.log('PASS saved purchases restore, English shop and narrow layout');
 await p.screenshot({path:`${out}/equipment-shop.png`});console.log('PASS correct coin deductions, equipment ownership, upgrade, insufficient funds and saved purchase');
 // Eligibility is rechecked at the actual transaction, even if the view has not updated yet.
 const rejected=await p.evaluate(async()=>{const g=window.app.current.game;g.player.coins=1000;g.player.unit.lastCombat=g.time;await g.hud.forge.buy('armor');return [g.player.coins,g.player.armorRank];});assert.deepEqual(rejected,[1000,1]);
 await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.lastCombat=-100;g.player.unit.teleport(g.world,g.player.unit.pos.x+30,g.player.unit.pos.z);});
 await p.waitForFunction(()=>!window.app.current.game.hud.forge.open);console.log('PASS combat blocks spending and walking away closes the shop');
 await p.evaluate(()=>window.app.current.game.hud.dialogue.close());
 // Fixed cameras: original 32 residents before, expanded 56-person population after.
 for(const [name,cam,at,near]of [
  ['market',[101,16,104],[91,7,77],[95,80]],['works',[-62.6,12,63],[-62.45,8,53.5],[-62.5,55]],['harbour',[216,19,54],[204,7,25],[204,30]],
 ]){
  await p.evaluate(({cam,at,near})=>{const g=window.app.current.game;cam[1]=g.world.heightAt(cam[0],cam[2])+5;at[1]=g.world.heightAt(at[0],at[2])+1;g.player.unit.teleport(g.world,...near);g.player.unit.hidden=true;g.follow.update=function(){this.camera.position.set(...cam);this.camera.lookAt(...at);};const c=document.querySelector('canvas');for(let a=c;a&&a!==document.body;a=a.parentElement)for(const el of a.parentElement.children)if(el!==a&&!el.contains(c))el.style.visibility='hidden';}, {cam,at,near});
  await p.evaluate(()=>window.app.current.game.world2.tidecrownPeople.people.forEach((p,i)=>p.unit.hidden=i>=32));await p.waitForTimeout(300);await p.screenshot({path:`${out}/${name}-before.png`});
  await p.evaluate(()=>window.app.current.game.world2.tidecrownPeople.show());await p.waitForTimeout(1000);await p.screenshot({path:`${out}/${name}-after.png`});
 }
 const lifecycle=await p.evaluate(async()=>{const g=window.app.current.game,people=g.world2.tidecrownPeople,before=window.__capitalBefore;g.player.unit.hidden=false;g.world2.exitTidecrown();const hidden=people.people.every(p=>p.unit.hidden),restored=g.world.root.visible,quest=JSON.stringify(g.quests.status)===before.quest&&g.quests.chapter===before.chapter;await g.world2.enterTidecrown();return {hidden,restored,quest,count:g.units.length-before.units,same:people===g.world2.tidecrownPeople};});
 assert.deepEqual(lifecycle,{hidden:true,restored:true,quest:true,count:56,same:true});console.log('PASS leaving hides residents and restores original world/quests; re-entry reuses the 56 actors without duplicates');
 assert.deepEqual(errors,[]);console.log('PASS zero browser errors; same-camera market, works and harbour comparisons saved');
}finally{await browser.close();}
