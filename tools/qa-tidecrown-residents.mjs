import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5248',out=process.env.CC_QA_SHOTS??'tmp/qa/tidecrown-residents';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});const errors=[];
try{
 const p=await browser.newPage({viewport:{width:1600,height:900}});p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));await p.routeWebSocket('**/multiplayer*',ws=>ws.close());
 await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Capital visitor'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','high');});
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:240000});
 const entry=await p.evaluate(async()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;g.ending.cancel();g.player.nextSwing=Infinity;window.__capitalBefore={quest:JSON.stringify(g.quests.status),chapter:g.quests.chapter,units:g.units.length};await g.world2.enterTidecrown();return {count:g.world2.tidecrownPeople.people.length,names:g.world2.tidecrownPeople.people.map(p=>p.unit.name),visible:g.world2.tidecrownPeople.people.filter(p=>!p.unit.hidden).length};});
 assert.equal(entry.count,32);assert.equal(entry.visible,32);assert.equal(new Set(entry.names).size,32);await p.waitForFunction(()=>!document.querySelector('.tidecrown-loading'));
 console.log('PASS 32 unique, visible residents loaded lazily on capital entry');
 const reveal=async()=>{await p.locator('.dlg-text').click();await p.waitForFunction(()=>{const d=window.app.current.game.hud.dialogue;return !d.typing&&document.querySelector('.dlg-text').textContent===d.paras.map(p=>p.text).join('');});};
 // Each resident is reached through the actual F interaction, rather than calling a dialogue helper.
 if(!process.env.CC_QA_SHOTS_ONLY){
 for(let i=0;i<32;i++){
  const name=await p.evaluate(i=>{const g=window.app.current.game,u=g.world2.tidecrownPeople.people[i].unit;g.hud.dialogue.close();g.player.unit.teleport(g.world,u.pos.x,u.pos.z+1.4);g.player.setTarget(null);return u.name;},i);
  await p.keyboard.press('KeyF');await p.waitForFunction(name=>window.app.current.game.hud.dialogue.unit?.name===name,name);
  assert.equal(await p.locator('.dlg-name').textContent(),name);await reveal();const first=await p.locator('.dlg-text').textContent();
  await p.getByRole('button',{name:'다른 이야기 듣기',exact:true}).click();await reveal();assert.notEqual(await p.locator('.dlg-text').textContent(),first);
  await p.getByRole('button',{name:'이곳에 대해 알려 주세요',exact:true}).click();await reveal();assert.ok((await p.locator('.dlg-text').textContent()).length>15);
  if(i===2)await p.screenshot({path:`${out}/market-conversation.png`});
  await p.getByRole('button',{name:'다음에 만나요',exact:true}).click();assert.equal(await p.locator('.dlg').isVisible(),false);if((i+1)%8===0)console.log(`PASS ${i+1}/32 resident conversations`);
 }
 console.log('PASS all 32 residents: F opens their own dialogue, another story and district topic work, Goodbye closes');
 await p.evaluate(async()=>{const {setLanguage}=await import('/src/i18n.ts');setLanguage('en');const g=window.app.current.game,u=g.world2.tidecrownPeople.people[0].unit;g.player.unit.teleport(g.world,u.pos.x,u.pos.z+1.4);});await p.keyboard.press('KeyF');await p.getByRole('button',{name:'Tell me about this district',exact:true}).click();await reveal();assert.match(await p.locator('.dlg-text').textContent(),/Moult Market/);await p.getByRole('button',{name:'Goodbye',exact:true}).click();await p.evaluate(async()=>{const {setLanguage}=await import('/src/i18n.ts');setLanguage('ko');});console.log('PASS English names, dialogue and district guidance');
 }
 // Fixed cameras, same scenery before/after; hiding only our population gives the before image.
 for(const [name,cam,at,near]of [
  ['market',[101,16,104],[91,7,77],[95,80]],['works',[-62.6,12,63],[-62.45,8,53.5],[-62.5,55]],['harbour',[216,19,54],[204,7,25],[204,30]],
 ]){
  await p.evaluate(({cam,at,near})=>{const g=window.app.current.game;cam[1]=g.world.heightAt(cam[0],cam[2])+5;at[1]=g.world.heightAt(at[0],at[2])+1;g.player.unit.teleport(g.world,...near);g.player.unit.hidden=true;g.follow.update=function(){this.camera.position.set(...cam);this.camera.lookAt(...at);};const c=document.querySelector('canvas');for(let a=c;a&&a!==document.body;a=a.parentElement)for(const el of a.parentElement.children)if(el!==a&&!el.contains(c))el.style.visibility='hidden';}, {cam,at,near});
  await p.evaluate(()=>window.app.current.game.world2.tidecrownPeople.hide());await p.waitForTimeout(300);await p.screenshot({path:`${out}/${name}-before.png`});
  await p.evaluate(()=>window.app.current.game.world2.tidecrownPeople.show());await p.waitForTimeout(1000);await p.screenshot({path:`${out}/${name}-after.png`});
 }
 const lifecycle=await p.evaluate(async()=>{const g=window.app.current.game,people=g.world2.tidecrownPeople,before=window.__capitalBefore;g.player.unit.hidden=false;g.world2.exitTidecrown();const hidden=people.people.every(p=>p.unit.hidden),restored=g.world.root.visible,quest=JSON.stringify(g.quests.status)===before.quest&&g.quests.chapter===before.chapter;await g.world2.enterTidecrown();return {hidden,restored,quest,count:g.units.length-before.units,same:people===g.world2.tidecrownPeople};});
 assert.deepEqual(lifecycle,{hidden:true,restored:true,quest:true,count:32,same:true});console.log('PASS leaving hides residents and restores original world/quests; re-entry reuses the 32 actors without duplicates');
 assert.deepEqual(errors,[]);console.log('PASS zero browser errors; same-camera market, works and harbour comparisons saved');
}finally{await browser.close();}
