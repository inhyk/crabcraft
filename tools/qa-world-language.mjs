// Runs in an isolated Chrome profile. Verifies real settings, region keys/music and persisted language.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if(!localStorage.getItem('cc.language'))localStorage.setItem('cc.language','ko');
  localStorage.setItem('cc.hintsSeen','1');
  window.loadingEvidence=[];
  new MutationObserver(()=>{const title=document.querySelector('.ld-title'),label=document.querySelector('.ld-label');if(title&&label){window.loadingMarkup=document.querySelector('.loading').outerHTML;window.loadingEvidence.push({title:title.textContent,label:label.textContent,subtitle:document.querySelector('.ld-sub').textContent,tip:document.querySelector('.ld-tip').textContent,art:document.querySelector('.ld-art').style.backgroundImage});}}).observe(document,{subtree:true,childList:true,characterData:true});
 });
 const loaded=async()=>{await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});await page.waitForFunction(()=>!document.querySelector('.loading'));};
 // Replay the actual loading DOM after model loading, so screenshots cannot race a fast cache hit.
 const captureLoading=async(name,width,height)=>{
  await page.setViewportSize({width,height});
  await page.evaluate(async()=>{const wrap=document.createElement('div');wrap.innerHTML=window.loadingMarkup;const el=wrap.firstElementChild;el.id='qa-loading';el.classList.remove('out');document.querySelector('#cc-ui').append(el);const image=new Image();image.src=new URL('art/loading-starhaven.webp',location.href).href;await image.decode();if(image.naturalWidth!==1600||image.naturalHeight!==900)throw new Error('Starhaven loading art failed to decode');});
  const style=await page.addStyleTag({content:'#qa-loading .ld-art,#qa-loading .ld-zone,#qa-loading .ld-tip{animation:none!important}'});
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('#qa-loading .ld-title,#qa-loading .ld-sub,#qa-loading .ld-tip')].map(el=>({kind:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,width:el.clientWidth})).filter(r=>r.left<-.5||r.right>innerWidth+.5||r.scroll>r.width+1));assert.deepEqual(overflow,[]);
  await page.screenshot({path:`tmp/qa/loading-${name}.png`});await page.evaluate(()=>document.querySelector('#qa-loading').remove());await style.evaluate(el=>el.remove());await page.setViewportSize({width:1440,height:900});
 };
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');await loaded();
 const loading=await page.evaluate(()=>window.loadingEvidence);assert.ok(loading.length);assert.ok(loading.every(x=>x.title==='클로헤이븐'));assert.ok(loading.some(x=>/준비 중|만드는 중|불러오는 중|환영/.test(x.label)));assert.ok(loading.every(x=>x.tip.startsWith('도움말')));
 await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='클로헤이븐');
 const change=async(language)=>{await page.evaluate(()=>{const g=window.app.current.game;g.hud.menu.show();g.hud.menu.settings();});await page.getByRole('button',{name:language,exact:true}).click();await page.evaluate(()=>window.app.current.game.hud.menu.close());};
 await change('English');await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='Clawhaven');
 await page.evaluate(()=>{const g=window.app.current.game;g.setLighthouse(false);});
 assert.match(await page.locator('.cc-banner').textContent(),/Lighthouse off.*Morning has returned/);
 const regions=[['Starhaven',0,55,'별빛 항구'],['Moonshade Crystalwood',-75,-35,'달그늘 수정 숲'],['The Fallen Star Ruins',80,-40,'무너진 별의 유적'],['The Pilgrim’s Starroad',0,-48,'순례자의 별길'],['The Star Throne',0,-75,'별의 왕좌']];
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();});
 for(const [id,x,z] of regions){console.log('English region',id);await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);await page.waitForFunction(id=>window.app.current.game.zone===id&&document.querySelector('.mm-zone').textContent===id,id);}
 await change('한국어');await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='별의 왕좌');assert.equal(await page.evaluate(()=>window.app.current.game.zone),'The Star Throne');
 for(const [id,x,z,ko] of regions){console.log('Korean region',ko);await page.evaluate(([x,z])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,0);g.follow.cut();},[x,z]);await page.waitForFunction(([id,ko])=>window.app.current.game.zone===id&&document.querySelector('.mm-zone').textContent===ko,[id,ko]);}
 await page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,55,0);g.journey.save();});
 await page.reload();await loaded();assert.equal(await page.evaluate(()=>localStorage.getItem('cc.language')),'ko');await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='별빛 항구');
 const savedKoreanLoading=await page.evaluate(()=>window.loadingEvidence);assert.ok(savedKoreanLoading.length);assert.ok(savedKoreanLoading.every(x=>x.title==='별빛 항구'&&x.subtitle.startsWith('월드 II')&&x.art.includes('loading-starhaven.webp')));assert.ok(savedKoreanLoading.some(x=>x.label==='별빛 항구에 다시 오신 걸 환영해요'));
 await captureLoading('starhaven-ko',1440,900);
 await change('English');await page.evaluate(()=>window.app.current.game.journey.save());await page.reload();await loaded();
 const savedEnglishLoading=await page.evaluate(()=>window.loadingEvidence);assert.ok(savedEnglishLoading.length);assert.ok(savedEnglishLoading.every(x=>x.title==='Starhaven'&&x.subtitle.startsWith('World II')&&x.tip.startsWith('Tip')&&x.art.includes('loading-starhaven.webp')));assert.ok(savedEnglishLoading.some(x=>x.label==='Welcome to Starhaven'));await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='Starhaven');
 await captureLoading('starhaven-en-narrow',390,844);
 await change('한국어');
 await page.evaluate(()=>window.app.current.game.world2.returnToShore());await page.waitForFunction(()=>document.querySelector('.mm-zone').textContent==='클로헤이븐');
 const music=await page.evaluate(()=>{const g=window.app.current.game;g.quests.accept('q4');g.zone='The Iron Wreck';g.updateMusic(true);return {zone:g.zone,music:g.music,beacon:g.beaconLit};});assert.equal(music.music,'music-boss');assert.equal(music.beacon,false);
 // Damaged/other-character saves must not advertise a hidden-world resume.
 await page.evaluate(()=>{const g=window.app.current.game;localStorage.setItem(g.journey.key,JSON.stringify({chapter:2,xp:'damaged'}));});await page.reload();await loaded();assert.equal(await page.evaluate(()=>window.app.current.game.world2.chapter),1);
 const damagedLoading=await page.evaluate(()=>window.loadingEvidence);assert.ok(damagedLoading.length);assert.ok(damagedLoading.every(x=>x.title==='클로헤이븐'&&!x.art.includes('loading-starhaven.webp')));
 assert.deepEqual(errors,[]);console.log('PASS: fresh shore loading, KO/EN World II resume loading/art, damaged-save fallback, actual language settings, stable region keys, all five island regions, saved language/chapter, lighthouse and original music logic',music);
}finally{await browser.close();}
