// Real browser projection of shipped static worlds. No host/catalog activation or numeric authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {launchBrowser} from '../tools/lib/browser.mjs';
const bootstrap=String.raw`
import * as THREE from '/node_modules/.vite/deps/three.js';
import {HiddenWorld} from '/src/game/world2.ts';
import {FrontierIsland} from '/src/game/frontierIsland.ts';
import {SnowIsland} from '/src/game/world4.ts';
import {DawnIsland} from '/src/game/world3.ts';
import {ServerGameBridge} from '/src/game/serverBridge.ts';
import {createWorld5Definition,createWorld6Definition} from '/src/sim/areas/frontier.ts';
import {POI_DEFS} from '/src/world/layout.ts';
const check=(ok,message)=>{if(!ok)throw new Error(message);};
let authorityCalls=0;const fail=()=>{authorityCalls++;throw new Error('browser attempted numeric authority');};
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,640);document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#829aa6');scene.add(new THREE.HemisphereLight('#fff8df','#45566c',3));const sun=new THREE.DirectionalLight('#fff4d2',3);sun.position.set(70,100,60);scene.add(sun);
const camera=new THREE.PerspectiveCamera(48,1.5,.1,1000);camera.position.set(145,145,170);camera.lookAt(0,0,-5);
const pois=Object.fromEntries(Object.entries(POI_DEFS).map(([id,p])=>[id,{id,position:new THREE.Vector3(p.x,0,p.z),yaw:p.yaw,radius:p.radius}]));
const actor={pos:new THREE.Vector3(0,8,82),xp:123,coins:456,hp:70,life:9,teleport:fail,respawn:fail};
const before=JSON.stringify(actor),maps=[],g={world:{root:new THREE.Group(),pois,heightAt:()=>0,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null},scene,camera,engine:{renderer},units:[],vfx:{group:new THREE.Group()},objective:{group:new THREE.Group()},time:100,player:{unit:actor,gainXp:fail,respawn:fail},quests:{setChapter:fail},journey:{save:fail},enemies:[],npcs:[],townsfolk:[],follow:{cut(){}},hud:{hints:{setChapter(){}},dialogue:{close(){}},messages:{closeDiscovery(){}},minimap:{setSnapshot(map){maps.push({size:map.size,minX:map.minX,minZ:map.minZ});}}},takeMapSnapshot:()=>({base:true})};
const view=Object.assign(Object.create(HiddenWorld.prototype),{game:g,go:fail,enterFrontier:fail,travel:fail,chapter:1,baseRoot:g.world.root,root:new THREE.Group(),third:new DawnIsland(),fourth:new SnowIsland(),fifth:new FrontierIsland(5),sixth:new FrontierIsland(6),basePois:new Map(),originalHeight:g.world.heightAt,originalCollision:g.world.resolveCollision,originalRay:g.world.raycastSolid,ambience:{start(){},stop(){}},spawn:new THREE.Vector3(0,3,86),nav:null});g.world2=view;
scene.add(view.baseRoot,view.root,view.third.root,view.fourth.root,view.fifth.root,view.sixth.root);
let current=5;const frames=[];
function observe(chapter){view.observeChapter(chapter);const once=maps.length;view.observeChapter(chapter);check(maps.length===once,'same chapter rebuilt minimap');check(JSON.stringify(actor)===before,'projection changed actor/progression');const roots=[view.baseRoot,view.root,view.third.root,view.fourth.root,view.fifth.root,view.sixth.root];check(roots.every((root,i)=>root.visible===(i+1===chapter)),'wrong static world visibility');if(chapter>=5){const island=chapter===5?view.fifth:view.sixth,query={heightAt:(x,z)=>island.height(x,z),resolveCollision:(x,z,r,out)=>island.collision.resolve(x,z,r,out)},def=(chapter===5?createWorld5Definition:createWorld6Definition)({query,fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:0,scavenger:0,jellyfish:0}});for(const[id,p]of Object.entries(def.pois)){if(id.startsWith('npc:'))continue;check(p.position.x===pois[id].position.x&&p.position.y===pois[id].position.y&&p.position.z===pois[id].position.z,'canonical POI mismatch '+id);}const out=new THREE.Vector2(),raw=new THREE.Vector2();g.world.resolveCollision(32,74,1,out);island.collision.resolve(32,74,1,raw);check(out.distanceTo(raw)<1e-12,'frontier collision differs');check(maps.at(-1).size===330,'wrong frontier map bounds');}current=chapter;renderer.render(scene,camera);frames.push({chapter,actorUnchanged:true,map:maps.at(-1)});return frames.at(-1);}
for(const chapter of [4,5,6,5,4,1,5,6])observe(chapter);
const commands=[],bridge=Object.assign(Object.create(ServerGameBridge.prototype),{game:g,self:actor,hostedGates:new Set(['gate:w1','gate:w2','gate:w3','gate:w4']),hostedBosses:new Set(['rust','abyss','eclipse','dawn','frost']),client:{command:c=>{commands.push(c);return true;}}});
view.emberGate={root:{position:new THREE.Vector3(14,0,84)}};observe(4);actor.pos.set(14,0,84);check(bridge.portalGate()===null,'inactive frontier gate advertised');actor.pos.copy(new THREE.Vector3(0,8,82));check(!bridge.command({kind:'bossChallenge',profile:'ember'})&&!bridge.command({kind:'bossChallenge',profile:'sky'})&&commands.length===0,'inactive boss challenge escaped');
bridge.hostedGates.add('gate:w5');bridge.hostedGates.add('gate:w6');check(bridge.command({kind:'bossChallenge',profile:'ember'})===false,'gate alone enabled boss');bridge.hostedBosses.add('ember');bridge.hostedBosses.add('sky');check(bridge.command({kind:'bossChallenge',profile:'ember'})&&commands.length===1,'active boss not emitted');
for(const [chapter,next]of [[5,4],[6,5]]){observe(chapter);actor.pos.copy(view[chapter===5?'fifth':'sixth'].spawn);check(bridge.portalGate()==='gate:w'+next,'back gate mismatch');if(chapter===5){actor.pos.copy(view.fifth.next.root.position);check(bridge.portalGate()==='gate:w6','forward gate mismatch');}actor.pos.set(0,8,82);}
bridge.partyPanel=document.createElement('section');bridge.party=null;bridge.state={world:'w5',self:{player:{flags:{}}}};bridge.renderParty();check(bridge.partyPanel.textContent.includes('500')&&!bridge.partyPanel.textContent.includes('300'),'frontier party UI frost fallback');
bridge.hostedBosses.delete('ember');bridge.renderParty();check(!bridge.partyPanel.textContent.includes('500'),'unconfigured frontier button');
const keeper={};bridge.labelUnit(keeper,{archetype:'freed-ember',kind:'npc'});check(keeper.name.includes('수호자'),'keeper label');
window.frontierQA={frames,commands:commands.length,actorUnchanged:JSON.stringify(actor)===before,authorityCalls,ready:true};
window.advanceTime=()=>renderer.render(scene,camera);window.render_game_to_text=()=>JSON.stringify({...window.frontierQA,world:current});window.frontierObserve=observe;observe(Number(new URL(location.href).searchParams.get('chapter')??6));
`;
test('actual Chrome readonly W4/W5/W6 scene, canonical POIs, catalog gates and no browser authority',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),artifacts=await mkdtemp('/private/tmp/crabcraft-a6-view-');let server,browser;const errors=[];
 try{
  server=await createServer({root,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'frontier-readonly-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/__frontier-test')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0"><script type="module" src="/__frontier-entry"></script></body></html>');}else if(req.url==='/__frontier-entry'){res.setHeader('Content-Type','text/javascript');res.end(bootstrap);}else next();});}}]});await server.listen();
  browser=await launchBrowser({headless:true});const page=await browser.newPage({viewport:{width:960,height:640}});page.on('pageerror',e=>errors.push(e.message));const url=server.resolvedUrls.local[0]+'__frontier-test';await page.goto(url);await page.waitForFunction(()=>window.frontierQA?.ready,null,{timeout:90000});
  for(const chapter of [5,6]){const state=await page.evaluate(chapter=>window.frontierObserve(chapter),chapter);assert.equal(state.actorUnchanged,true);await page.screenshot({path:`${artifacts}/w${chapter}.png`});}
  const result=await page.evaluate(()=>window.frontierQA);assert.equal(result.actorUnchanged,true);assert.equal(result.authorityCalls,0);assert.equal(result.commands,1);assert.deepEqual(errors,[]);await writeFile(`${artifacts}/result.json`,JSON.stringify(result,null,2));console.log(`frontier browser evidence: ${artifacts}`);
 }finally{await browser?.close();await server?.close();}
});
