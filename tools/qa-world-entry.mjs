import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try {
 for(const language of ['ko','en'])for(const chapter of [1,2,3,4]){
  const p=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(({chapter,language})=>{const spec={race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name:'Entry QA'};localStorage.setItem('cc.spec',JSON.stringify(spec));localStorage.setItem('cc.language',language);localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.journey.v1:human:male:mage:Entry QA',JSON.stringify({chapter,xp:100000,rust:true,abyss:true,firstEnding:true,trueCleared:true,finalCleared:true}));},{chapter,language});
  // Hold model requests so the loading artwork can be checked before it fades out.
  let release;const gate=new Promise(resolve=>release=resolve);
  await p.route('**/*.glb',async route=>{await gate;await route.continue().catch(()=>{});});
  await p.goto((process.env.CC_QA_BASE??'http://127.0.0.1:5221')+'/?screen=game');await p.locator('.launch-notice-start').click();
  await p.waitForSelector(`.loading[data-chapter="${chapter}"]`);
  const expectedImage=['loading-','loading-starhaven.webp','loading-dawnharbor.webp','loading-frostlight.webp'][chapter-1];
  const expectedTitle=(language==='ko'?['클로헤이븐','별빛 항구','새벽 항구','눈꽃 마을']:['Clawhaven','Starhaven','Dawnharbor','Snowfall Village'])[chapter-1];
  assert.equal(await p.locator('.ld-title').textContent(),expectedTitle);
  const background=await p.locator('.ld-art').evaluate(el=>getComputedStyle(el).backgroundImage);assert.ok(background.includes(expectedImage),background);
  assert.equal(await p.evaluate(async()=>{const url=getComputedStyle(document.querySelector('.ld-art')).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];const im=new Image();im.src=url;await im.decode();return im.naturalWidth>500&&im.naturalHeight>300;}),true);
  if(chapter>=3)await p.screenshot({path:`tmp/qa/loading-${chapter}-${language}.png`});
  release();await p.waitForFunction(chapter=>window.app?.current?.game?.loaded&&!document.querySelector('.loading')&&window.app.current.game.world2.chapter===chapter,chapter,{timeout:120000});
  assert.deepEqual(errors,[]);console.log(`PASS ${language} world ${chapter}: correct loading artwork, title, decoded image and restored destination; zero browser errors`);await p.close();
 }
}finally{await browser.close()}
