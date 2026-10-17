// Actual hover tooltips and Settings buttons. Run after the GPU endurance chain is terminal.
import {chromium} from 'playwright';import assert from 'node:assert/strict';
import {CLASSES} from '../src/data/classes.ts';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192',probe=process.env.CC_QA_PROBE==='1';
const ko={warrior:['집게 강타','껍질 방패치기','옆걸음 돌진','소용돌이'],mage:['물거품 화살','서리 분사','증기 점멸','해일 폭발'],priest:['성스러운 일격','껍질 치유','따개비 보호막','성스러운 파도']};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});const errors=[],views=[];
async function settings(p,lang){await p.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await p.getByRole('button',{name:lang==='ko'?'한국어':'English',exact:true}).click();}
async function resume(p,lang){await p.getByRole('button',{name:lang==='ko'?'뒤로':'Back',exact:true}).click();await p.getByRole('button',{name:lang==='ko'?'계속하기':'Resume',exact:true}).click();}
const cast=p=>p.evaluate(()=>{const g=window.app.current.game,c=g.player.cast;return {time:g.time,id:c?.ability.id??null,start:c?.start,end:c?.end,gcd:g.player.gcdEnd,label:document.querySelector('.castbar .label').textContent};});
try{
 for(const cls of ['warrior','mage','priest']){
  const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(cls=>{localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality','low');localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:cls,shell:0,crest:0,led:0,name:'Ability Reader'}));},cls);await p.goto(base+'/?screen=game');await p.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await p.waitForFunction(()=>!document.querySelector('.loading'));
  for(const lang of ['ko','en']){await settings(p,lang);await resume(p,lang);for(const width of [1280,718]){await p.setViewportSize({width,height:width===1280?800:492});await p.waitForTimeout(200);for(let i=0;i<4;i++){
   await p.locator('.ab-slot').nth(i).hover();await p.locator('.cc-tooltip').waitFor({state:'visible'});const text=await p.locator('.cc-tooltip').innerText(),box=await p.locator('.cc-tooltip').boundingBox();views.push({cls,lang,width,slot:i+1,text,box});
   if(!probe){assert.ok(text.includes(lang==='ko'?ko[cls][i]:CLASSES[cls].abilities[i].name),text);if(lang==='ko'){assert.match(text,/[가-힣]/);assert.doesNotMatch(text,/\b(Rage|Mana|Instant|sec|range|radius|Self)\b/);}else assert.ok(text.includes(CLASSES[cls].abilities[i].description));assert.ok(text.includes(lang==='ko'?`재사용 ${CLASSES[cls].abilities[i].cooldown}초`:`${CLASSES[cls].abilities[i].cooldown} sec cooldown`),text);assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<= (width===1280?800:492));}
   if(i===0)await p.screenshot({path:`tmp/qa/ability-${probe?'before':'final'}-${cls}-${lang}-${width}.png`});await p.mouse.move(2,2);
  }}}
  if(cls==='priest'){
   await p.setViewportSize({width:1280,height:800});await settings(p,'ko');await resume(p,'ko');await p.keyboard.press('Digit2');await p.waitForFunction(()=>window.app.current.game.player.cast?.ability.id==='mend-shell');await p.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});const initial=await cast(p);await p.getByRole('button',{name:'English',exact:true}).click();const english=await cast(p);await p.getByRole('button',{name:'한국어',exact:true}).click();const korean=await cast(p);
   if(!probe){assert.equal(initial.label,'껍질 치유');assert.equal(english.label,'Mend Shell');assert.equal(korean.label,'껍질 치유');for(const s of [english,korean])for(const key of ['time','id','start','end','gcd'])assert.equal(s[key],initial[key],key);}
   console.log('LIVE_CAST',JSON.stringify({initial,english,korean}));await resume(p,'ko');await p.waitForFunction(()=>!window.app.current.game.player.cast);assert.equal(await p.evaluate(()=>window.app.current.game.player.unit.alive),true);
   for(const [key,koreanReason,englishReason] of [['KeyW','중단됨','Interrupted'],['Escape','취소됨','Cancelled']]){
    await p.waitForFunction(()=>{const p=window.app.current.game.player;return !p.cast&&p.cooldownLeft(p.cls.abilities[1])===0;});await p.keyboard.press('Digit2');await p.waitForFunction(()=>window.app.current.game.player.cast?.ability.id==='mend-shell');await p.keyboard.down(key);try{await p.waitForFunction(()=>!window.app.current.game.player.cast,null,{timeout:1000});}finally{await p.keyboard.up(key);}await p.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});
    const failState=()=>p.evaluate(()=>{const g=window.app.current.game,c=g.hud.castBar;return {label:document.querySelector('.castbar .label').textContent,classes:c.el.className,hideAt:c.hideAt,time:g.time,gcd:g.player.gcdEnd,cast:g.player.cast};});const failedKo=await failState();await p.getByRole('button',{name:'English',exact:true}).click();const failedEn=await failState();
    if(!probe){assert.equal(failedKo.label,koreanReason);assert.equal(failedEn.label,englishReason);assert.equal(failedEn.classes,failedKo.classes);assert.match(failedEn.classes,/fail/);for(const field of ['hideAt','time','gcd','cast'])assert.equal(failedEn[field],failedKo[field],field);}
    console.log('LIVE_INTERRUPT',JSON.stringify({key,failedKo,failedEn}));await p.getByRole('button',{name:'한국어',exact:true}).click();await resume(p,'ko');await p.waitForFunction(()=>window.app.current.game.time>=window.app.current.game.player.gcdEnd);await p.waitForTimeout(900);
   }
  }
  await p.close();
 }
 assert.deepEqual(errors,[]);console.log('TOOLTIP_VIEWS',JSON.stringify(views));console.log(probe?'PROBE: actual tooltip/cast language output only; no localized-success assertion':'PASS: 48 actual KO/EN tooltip views fit two viewports; native Settings updates active casts and movement/Escape interruptions without changing their timing; no page errors');
}finally{await browser.close();}
