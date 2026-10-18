import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {realActionData as data,actionRequest,actionHitDelay,BREAK_ROUTINE} from '../src/sim/data/actions.ts';
import {initializeNumericPose,advanceNumericPose} from '../src/sim/pose.ts';
import {createUnit,centre} from '../src/sim/unit.ts';
import {Actions} from '../src/sim/actions.ts';
import {rigCatalog,rigCatalogIds,rigCatalogVersion,rigCatalogMotionVersion} from '../src/sim/data/rig-catalog.ts';
import {Projectiles} from '../src/sim/projectiles.ts';
function unit(id=1,archetype='human'){
 const u=createUnit({area:'motion-test',id,life:1},archetype,'player','player',data);
 u.pose=initializeNumericPose();return u;
}
const near=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
test('every derivation source and packed payload still match content hashes',async()=>{
 const {version,...payload}=JSON.parse(await readFile(new URL('../src/sim/data/pose-data.json',import.meta.url),'utf8'));
 assert.equal(version,'shipped-motion-v1-'+createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0,20));
 const results=await Promise.all(Object.entries(data.sourceHashes).map(async([path,expected])=>[path,createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),expected]));
 for(const [path,actual,expected]of results)assert.equal(actual,expected,path);
});
test('real attack and channel windows match independent shipped policy moments',()=>{
 near(actionHitDelay(data,actionRequest(data,'attack_swipe')),.28);
 near(actionHitDelay(data,actionRequest(data,'attack_slam')),.46/1.2);
 near(actionHitDelay(data,actionRequest(data,'cast',{part:'release'})),.04);
 assert.deepEqual(actionRequest(data,'cast',{loop:true}),{id:'cast',part:'channel',upper:false,from:1.23,to:3.03,loopFrom:1.83,loop:true,speed:1.25,fade:.12,carryRoot:false});
 near(actionHitDelay(data,actionRequest(data,'attack_slam',{speed:1.3})),.46/1.3);
 assert.equal(actionHitDelay(data,actionRequest(data,'jump')),null);
 assert.equal(data.clip('death').hold,true);
 assert.deepEqual(BREAK_ROUTINE.map(x=>x.id),['break_toprock','break_sixstep','break_spin','break_jumpspin','break_backflip','break_oneclaw']);
 assert.throws(()=>data.root('absent',1),/Unknown shipped/);assert.throws(()=>data.archetype('absent'),/Unknown shipped/);
});
test('all real routine roots carry exactly once on natural fade and cancellation',()=>{
 for(const step of BREAK_ROUTINE)for(const cancel of [false,true]){
  const u=unit(1,'orc'),events=[],actions=new Actions(data,e=>events.push(e),()=>{});u.yaw=.71;
  actions.play(u,actionRequest(data,step.id,{...step,carryRoot:true}));
  const count=cancel?9:Math.ceil((step.to-step.from-step.fade)*30);
  for(let i=0;i<count;i++)actions.update(u,1/30);
  if(cancel)actions.stop(u);
  const a=u.actions[0],sample=data.root(step.id,a.root.committedClipTime),m=data.archetype('orc').metersToUnits;
  near(u.x,(sample.x*Math.cos(.71)+sample.z*Math.sin(.71))*m);near(u.z,(-sample.x*Math.sin(.71)+sample.z*Math.cos(.71))*m);near(u.yaw,.71+sample.yaw);
  const after=[u.x,u.z,u.yaw];actions.stop(u);actions.stop(u);for(let i=0;i<20;i++)actions.update(u,1/30);
  assert.deepEqual([u.x,u.z,u.yaw],after);assert.equal(events.filter(e=>e.type==='rootRebase').length,1);
  assert.ok(Math.abs(sample.x)+Math.abs(sample.z)+Math.abs(sample.yaw)>1e-5,`${step.id} must carry its recorded trajectory`);
 }
});
test('canonical moving cast origin and flight deadline use numeric pose, never presentation callbacks',()=>{
 const a=unit(),b=unit(2);b.x=10;b.z=3;
 const actions=new Actions(data,()=>{},()=>{});
 for(let i=0;i<35;i++){a.pose.localVx=.7;a.pose.localVz=2;a.pose.yawRate=.3;advanceNumericPose(a,1/30);}
 actions.play(a,actionRequest(data,'cast',{part:'release',upper:true}));
 for(let i=0;i<4;i++){actions.update(a,1/30);advanceNumericPose(a,1/30);}
 const from=data.launchAnchor(a,a.pose),target=centre(b),distance=Math.hypot(target.x-from.x,target.y-from.y,target.z-from.z),ticks=Math.ceil(distance/17*30);let hits=0;
 const projectiles=new Projectiles(10,ref=>ref.id===a.ref.id?a:b,()=>{},()=>hits++);
 projectiles.launch({...from,source:a.ref,target:b.ref,style:'bubble',speed:17,anchorVersion:data.version,hit:{attack:'bubble-bolt',source:a.ref,target:b.ref}},0);
 for(let tick=1;tick<ticks;tick++){projectiles.update(1/30);assert.equal(hits,0);}
 projectiles.update(1/30);assert.equal(hits,1);assert.equal(projectiles.states.size,0);
});
test('interleaved units and extra anchor readers cannot advance pose or alter a replay',()=>{
 function run(interleave){const a=unit(),b=unit(2,'tauren');for(let i=0;i<200;i++){
  a.pose.localVx=Math.sin(i/10);a.pose.localVz=2;a.pose.yawRate=.4;advanceNumericPose(a,1/30);
  if(interleave){b.pose.localVz=3;advanceNumericPose(b,1/60);const before=structuredClone(a);for(let j=0;j<3;j++)data.launchAnchor(a,a.pose);assert.deepEqual(a,before);}
 }return {pose:a.pose,anchor:data.launchAnchor(a,a.pose)};}
 assert.deepEqual(run(false),run(true));
});
test('immutable provider rejects mutation and never substitutes missing data',()=>{
 assert.throws(()=>data.clip('cast').events.hit.push(99),TypeError);
 assert.throws(()=>{data.archetype('human').height=99;},TypeError);
 assert.throws(()=>data.launchAnchor({...unit(),pose:{}},{}),TypeError);
});

test('Boreas numeric rig is derived from the actual shipped mage and resolves boss-frost',async()=>{
 const raw=JSON.parse(await readFile(new URL('../src/sim/data/pose-data.json',import.meta.url),'utf8'));
 assert.deepEqual(raw.rigSources.frost,{factory:'createCrab',spec:{race:'undead',sex:'male',classId:'mage',shell:3,crest:1,led:2,name:'Boreas'},rootMultiplier:4.5});
 assert.equal(data.archetype('boss-frost'),data.archetype('frost'));
 assert.equal(Object.keys(raw.archetypes).length,39);
 for(let axis=0;axis<3;axis++)near(data.archetype('frost').rootScale[axis],data.archetype('undead').rootScale[axis]*4.5);
});

test('named NPC and rescue rigs retain their shipped identities and equipment provenance',async()=>{
 const raw=JSON.parse(await readFile(new URL('../src/sim/data/pose-data.json',import.meta.url),'utf8'));
 const expected={
  'npc:brinebeard':['dwarf','male','warrior',0,3,1], 'npc:silvermoon':['nightelf','female','priest',0,2,1],
  'npc:coralline':['human','female','priest',2,2,0], 'npc:grukk':['orc','male','warrior',0,1,0],
  'npc:hoofclaw':['tauren','female','priest',1,2,1], 'npc:rattlebolt':['undead','male','mage',0,3,0],
  'npc:pip':['dwarf','female','warrior',1,2,2],
  'freed-rust':['human','male','warrior',0,1,0], 'freed-abyss':['nightelf','female','priest',2,1,2],
  'freed-eclipse':['undead','female','priest',2,2,2], 'freed-dawn':['human','female','mage',1,2,1],
  'freed-frost':['human','female','mage',1,2,1],
 };
 for(const [id,fields] of Object.entries(expected)){
  const source=raw.rigSources[id];assert.equal(source.factory,'createCrab');assert.equal(source.rootMultiplier,1);
  assert.deepEqual(['race','sex','classId','shell','crest','led'].map(k=>source.spec[k]),fields,id);
  assert.equal(data.archetype(id).height,raw.archetypes[id].height);
 }
 assert.deepEqual(raw.rigSources['npc:brinebeard'].extras,['captain-hat']);
 assert.notEqual(data.archetype('npc:brinebeard').height,data.archetype('human').height);
 assert.notEqual(data.archetype('freed-abyss').height,data.archetype('human').height);
});

test('eight townsfolk specs preserve Game seed1337 draw order and varied identities',async()=>{
 const raw=JSON.parse(await readFile(new URL('../src/sim/data/pose-data.json',import.meta.url),'utf8'));
 const expected=[
  ['human','male','warrior',0,3,1,'Clawdia'],['orc','female','mage',1,2,1,'Shelldon'],
  ['dwarf','male','mage',2,2,0,'Pinchy'],['undead','female','mage',1,0,2,'Barnaby'],
  ['nightelf','male','mage',3,2,0,'Coral'],['tauren','female','warrior',0,1,0,'Sandy'],
  ['nightelf','male','mage',2,2,0,'Scuttles'],['undead','female','warrior',2,0,2,'Nippy'],
 ];
 for(const [i,fields] of expected.entries()){
  const id=`townsfolk:${i}`,source=raw.rigSources[id];
  assert.deepEqual(['race','sex','classId','shell','crest','led','name'].map(k=>source.spec[k]),fields,id);
  assert.equal(source.seed,1337);assert.equal(source.drawOffset,i*4);assert.equal(source.rootMultiplier,1);
  assert.equal(data.archetype(id).height,raw.archetypes[id].height);
 }
});

test('small presentation catalog shares the exact factory pass, content hashes and motion version',async()=>{
 const raw=JSON.parse(await readFile(new URL('../src/sim/data/pose-data.json',import.meta.url),'utf8'));
 const text=await readFile(new URL('../src/sim/data/rig-catalog.json',import.meta.url),'utf8'),{version,...catalog}=JSON.parse(text);
 assert.equal(version,'shipped-rigs-v1-'+createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0,20));
 assert.equal(version,rigCatalogVersion);assert.equal(catalog.motionVersion,raw.version);assert.equal(rigCatalogMotionVersion,data.version);
 assert.deepEqual(catalog.sourceHashes,raw.sourceHashes);assert.deepEqual(rigCatalogIds,Object.keys(raw.archetypes));
 assert.ok(Buffer.byteLength(text)<50000,'presentation metadata must not embed motion clips');
 for(const id of rigCatalogIds){
  assert.deepEqual(catalog.rigs[id],{...raw.rigSources[id],rootScale:raw.archetypes[id].rootScale,metersToUnits:raw.archetypes[id].metersToUnits});
  assert.deepEqual(rigCatalog(id),catalog.rigs[id]);assert.ok(Object.isFrozen(rigCatalog(id).rootScale));
 }
 assert.equal(rigCatalog('boss-frost'),rigCatalog('frost'));assert.throws(()=>rigCatalog('missing'),/Unknown shipped rig/);
 assert.throws(()=>{rigCatalog('npc:brinebeard').spec.crest=0;},TypeError);
 assert.throws(()=>{rigCatalog('npc:brinebeard').extras.push('invented');},TypeError);
});

test('presentation accessor bundles without the packed clips or numeric pose runtime',async()=>{
 const {build}=await import('esbuild');
 const result=await build({entryPoints:[new URL('../src/sim/data/rig-catalog.ts',import.meta.url).pathname],bundle:true,platform:'browser',format:'esm',minify:true,write:false,metafile:true});
 const inputs=Object.keys(result.metafile.inputs);
 assert.ok(inputs.some(p=>p.endsWith('rig-catalog.json')));
 assert.ok(inputs.every(p=>!p.endsWith('pose-data.json')&&!p.endsWith('/pose.ts')),inputs.join('\n'));
 assert.ok(result.outputFiles[0].contents.length<30000);
});
