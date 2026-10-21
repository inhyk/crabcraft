import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5231';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(name){const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(name=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'mage',shell:0,crest:0,led:0,name}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},name);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:90000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;});await p.waitForTimeout(1000);await p.keyboard.press('Space');return p;
}
try{
 const p=await load('Frontier scenery');
 for(const chapter of [5,6]){
 await p.evaluate(chapter=>{const g=window.app.current.game;g.creatorTravel=true;g.world2.go(chapter);g.player.unit.teleport(g.world,0,83);g.follow.yaw=0;g.follow.pitch=.35;g.follow.distance=24;g.follow.cut();},chapter);
 await p.waitForTimeout(6500);await p.screenshot({path:`tmp/qa/frontier-${chapter}-village.png`});
 await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,-22);g.follow.yaw=0;g.follow.pitch=.3;g.follow.distance=24;g.follow.cut();});
 await p.waitForTimeout(1000);await p.screenshot({path:`tmp/qa/frontier-${chapter}-sanctuary.png`});
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
