// Independent production-rig/controller parity, plus byte-for-byte source freshness.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=JSON.parse(await readFile(root+'src/sim/data/pose-data.json','utf8'));
const {version,...payload}=data;if(version!=='shipped-motion-v1-'+createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0,20))throw new Error('Numeric motion artifact content hash mismatch');
const stale=[];for(const [path,hash] of Object.entries(data.sourceHashes))if(createHash('sha256').update(await readFile(root+path)).digest('hex')!==hash)stale.push(path);
if(stale.length)throw new Error(`Stale numeric motion derivation: ${stale.join(', ')}`);
if(process.argv.includes('--freshness-only')){console.log(`PASS: ${Object.keys(data.sourceHashes).length} source hashes match ${data.version}`);process.exit(0);}
const server=await createServer({root,server:{host:'127.0.0.1',port:5266,strictPort:true},logLevel:'error'});await server.listen();let browser;
try{
 browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();
 await page.route('**/__sim_parity__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Motion numeric parity</title>'}));
 await page.goto('http://127.0.0.1:5266/__sim_parity__');
 const result=await page.evaluate(async()=>{
  const [THREE,{initAssets},{createCrab,createEnemyCrab},{createJellyfishRig},{MotionLibrary},{createMotionController},legacy,{realActionData,actionRequest,BREAK_ROUTINE},numeric,{Actions},{numericClip},{numericArchetype}]=await Promise.all([
   import('/node_modules/three/build/three.module.js'),import('/src/core/assets.ts'),import('/src/crab/index.ts'),import('/src/crab/jellyfish.ts'),import('/src/motion/library.ts'),import('/src/motion/controller.ts'),import('/src/motion/pose.ts'),import('/src/sim/data/actions.ts'),import('/src/sim/pose.ts'),import('/src/sim/actions.ts'),import('/src/sim/data/pose.ts'),import('/src/sim/data/archetypes.ts')]);
  const renderer=new THREE.WebGLRenderer();initAssets(renderer);
  const lib=new MotionLibrary('/motions/');await lib.ready;await Promise.all(lib.list().map(e=>lib.load(e.id)));
  let maxSampleDelta=0,samples=0,maxAnchorDelta=0,anchors=0,maxRootDelta=0,roots=0,specVariants=0;
  const near=(a,b,label,tol=1e-6)=>{const d=Math.abs(a-b);if(!Number.isFinite(d)||d>tol)throw new Error(`${label}: ${a} vs ${b} delta ${d}`);return d;};
  for(const entry of lib.list()){
   const old=await lib.load(entry.id),fresh=numericClip(entry.id);
   for(const time of [0,.013,old.length*.17,old.length*.53,old.length-.001,old.length,old.length+.12])for(const loop of [false,true])for(const keep of [false,true]){
    const a=new legacy.Pose(),b=new numeric.Pose();legacy.sampleClip(old,time,loop,a,keep);numeric.sampleClip(fresh,time,loop,b,keep);
    for(const key of ['q','pos','rot'])for(let i=0;i<a[key].length;i++)maxSampleDelta=Math.max(maxSampleDelta,near(a[key][i],b[key][i],`${entry.id} ${time} ${key}`,0));samples++;
   }
  }
  const spec=race=>({race,sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'parity'});
  const {NPCS}=await import('/src/game/quests.ts');
  // Independent exact Game.init specs, not artifact or sim data used as its own oracle.
  const folkSpecs=[
   {race:'human',sex:'male',classId:'warrior',shell:0,crest:3,led:1,name:'Clawdia'},
   {race:'orc',sex:'female',classId:'mage',shell:1,crest:2,led:1,name:'Shelldon'},
   {race:'dwarf',sex:'male',classId:'mage',shell:2,crest:2,led:0,name:'Pinchy'},
   {race:'undead',sex:'female',classId:'mage',shell:1,crest:0,led:2,name:'Barnaby'},
   {race:'nightelf',sex:'male',classId:'mage',shell:3,crest:2,led:0,name:'Coral'},
   {race:'tauren',sex:'female',classId:'warrior',shell:0,crest:1,led:0,name:'Sandy'},
   {race:'nightelf',sex:'male',classId:'mage',shell:2,crest:2,led:0,name:'Scuttles'},
   {race:'undead',sex:'female',classId:'warrior',shell:2,crest:0,led:2,name:'Nippy'},
  ];
  const freedSpecs={
   'freed-rust':{race:'human',sex:'male',classId:'warrior',shell:0,crest:1,led:0,name:'Little Red'},
   'freed-abyss':{race:'nightelf',sex:'female',classId:'priest',shell:2,crest:1,led:2,name:'Pearl'},
   'freed-eclipse':{race:'undead',sex:'female',classId:'priest',shell:2,crest:2,led:2,name:'Star'},
   'freed-dawn':{race:'human',sex:'female',classId:'mage',shell:1,crest:2,led:1,name:'Dawnkeeper'},
   'freed-frost':{race:'human',sex:'female',classId:'mage',shell:1,crest:2,led:1,name:'Mira'},
  };
  const makeRig=async id=>{
   if(id.startsWith('townsfolk:'))return createCrab(folkSpecs[Number(id.slice(10))]);
   if(id.startsWith('npc:')){const n=NPCS.find(n=>id===`npc:${n.id}`);if(!n)throw new Error(`Unknown named NPC ${id}`);return createCrab({race:n.race,sex:n.sex,classId:n.classId,shell:n.shell,crest:n.crest,led:n.led,name:n.name},n.extras);}
   if(freedSpecs[id])return createCrab(freedSpecs[id]);
   if(id==='jellyfish')return createJellyfishRig();
   if(['scrapling','scavenger','corrodius','echo'].includes(id)){const r=await createEnemyCrab(id==='echo'?'corrodius':id);if(id==='echo')r.root.scale.multiplyScalar(.55);return r;}
   const scaled={
    abyss:[{race:'nightelf',sex:'female',classId:'mage',shell:2,crest:3,led:2,name:'Nereid'},3.5],
    eclipse:[{race:'undead',sex:'female',classId:'priest',shell:3,crest:3,led:2,name:'Astra'},4.5],
    dawn:[{race:'orc',sex:'male',classId:'warrior',shell:2,crest:3,led:1,name:'Solarkan'},4],
    frost:[{race:'undead',sex:'male',classId:'mage',shell:3,crest:1,led:2,name:'Boreas'},4.5],
   }[id];const r=await createCrab(scaled?.[0]??spec(id));if(scaled)r.root.scale.multiplyScalar(scaled[1]);return r;
  };
  const newUnit=id=>({ref:{area:'parity',id:1,life:1},archetype:id,x:7,y:2,z:-3,yaw:.63,pose:numeric.initializeNumericPose(),actions:[],pendingHit:null});
  const checkAnchor=(u,r)=>{
   r.root.updateMatrixWorld(true);const expected=r.getSocket('clawR').getWorldPosition(new THREE.Vector3()),got=realActionData.launchAnchor(u,u.pose);
   for(const key of ['x','y','z'])maxAnchorDelta=Math.max(maxAnchorDelta,near(expected[key],got[key],`${u.archetype} ${key}`));anchors++;
  };
  const rigs=['human','orc','dwarf','undead','nightelf','tauren','scrapling','scavenger','corrodius','jellyfish','abyss','eclipse','dawn','frost','echo',...NPCS.map(n=>`npc:${n.id}`),...Object.keys(freedSpecs),...folkSpecs.map((_,i)=>`townsfolk:${i}`)];
  for(const id of rigs){
   const rig=await makeRig(id),u=newUnit(id);rig.root.position.set(u.x,u.y,u.z);rig.root.rotation.y=u.yaw;
   const height=rig.getSocket('head').getWorldPosition(new THREE.Vector3()).y-u.y;
   near(height,realActionData.archetype(id).height,`${id} collider`,1e-12);
   if(id==='jellyfish'){checkAnchor(u,rig);rig.dispose();continue;}
   const ctrl=createMotionController(rig,lib),actions=new Actions(realActionData,()=>{},()=>{});
   const play=(id,o={})=>{const request=actionRequest(realActionData,id,o);actions.play(u,request);ctrl.play(id,{from:request.from,to:request.to??undefined,loopFrom:request.loopFrom??undefined,speed:request.speed,loop:request.loop,fade:request.fade,upperBodyOnly:request.upper,carryRoot:request.carryRoot?(x,z,yaw)=>{const c=Math.cos(rig.root.rotation.y),s=Math.sin(rig.root.rotation.y),m=rig.metersToUnits;rig.root.position.x+=(x*c+z*s)*m;rig.root.position.z+=(-x*s+z*c)*m;rig.root.rotation.y+=yaw;roots++;}:undefined});};
   const step=(dt,vx,vz,w)=>{u.pose.localVx=vx;u.pose.localVz=vz;u.pose.yawRate=w;const tiny=Math.abs(vx)<.05&&Math.abs(vz)<.05&&Math.abs(w)<.05;ctrl.setLocomotion(tiny?0:vx,tiny?0:vz,tiny?0:w);actions.update(u,dt);numeric.advanceNumericPose(u,dt);ctrl.update(dt);for(const key of ['x','z'])maxRootDelta=Math.max(maxRootDelta,near(u[key],rig.root.position[key],`${id} carry ${key}`,1e-12));maxRootDelta=Math.max(maxRootDelta,near(u.yaw,rig.root.rotation.y,`${id} carry yaw`,1e-12));checkAnchor(u,rig);};
   for(let frame=0;frame<180;frame++)step(1/30,Math.sin(frame*.09)*2.2,Math.cos(frame*.05)*4,Math.sin(frame*.033)*1.8);
   for(const [action,opts] of [['attack_swipe',{}],['attack_slam',{speed:1.6}],['cast',{part:'channel',loop:true,upper:true}],['cast',{part:'release',upper:true}],['jump',{}],['death',{}],['sit',{}],['hit_react',{}]]){play(action,opts);for(let frame=0;frame<25;frame++)step(1/30,.7,2,.4);}
   for(const move of BREAK_ROUTINE){play(move.id,{...move,carryRoot:true});for(let frame=0;frame<Math.ceil((move.to-move.from)*30)+4;frame++)step(1/30,0,0,0);}
   // Root cancellation then immediate projectile launch must read previous applied pose.
   play('break_sixstep',{from:.835,to:5.235,carryRoot:true});for(let frame=0;frame<55;frame++)step(1/30,0,0,0);
   actions.stop(u);ctrl.stop();checkAnchor(u,rig);actions.stop(u);ctrl.stop();checkAnchor(u,rig);
   for(let frame=0;frame<10;frame++)step(1/30,0,0,0);
   ctrl.dispose();rig.dispose();
  }
  // Sex and class change gear/face, but must not silently change numerical colliders/sockets.
  for(const race of ['human','orc','dwarf','undead','nightelf','tauren'])for(const sex of ['male','female'])for(const classId of ['warrior','mage','priest']){
   const rig=await createCrab({...spec(race),sex,classId}),u=newUnit(race),p=new legacy.Pose();
   rig.root.position.set(u.x,u.y,u.z);rig.root.rotation.y=u.yaw;
   near(rig.getSocket('head').getWorldPosition(new THREE.Vector3()).y-u.y,realActionData.archetype(race).height,`${race}/${sex}/${classId} height`,1e-12);
   legacy.sampleClip(lib.get('cast'),3.27,false,p);rig.setPose(p.q);rig.body.position.fromArray(p.pos).multiplyScalar(rig.metersToUnits);rig.body.quaternion.fromArray(p.rot);
   u.pose.appliedQ=Array.from(p.q);u.pose.appliedPosition=Array.from(p.pos);u.pose.appliedRotation=Array.from(p.rot);checkAnchor(u,rig);specVariants++;rig.dispose();
  }
  // Deterministic envelope of the view-only random twitch: source maximum amplitude is .075.
  const twitch=[];
  for(const id of ['undead','eclipse','frost','npc:rattlebolt','freed-eclipse','townsfolk:3','townsfolk:7']){
   const rig=await makeRig(id),u=newUnit(id),basePitch=rig.posture.rotation.x;
   rig.root.position.set(u.x,u.y,u.z);rig.root.rotation.y=u.yaw;
   let maxOrigin=0,maxHead=0,maxRadius=0,maxFlightSeconds=0,maxArrivalTicks=0,worst=null,checks=0;
   const examine=(name,p)=>{
    rig.setPose(p.q);rig.body.position.fromArray(p.pos).multiplyScalar(rig.metersToUnits);rig.body.quaternion.fromArray(p.rot);
    rig.posture.rotation.set(basePitch,0,0);rig.root.updateMatrixWorld(true);
    const claw=rig.getSocket('clawR').getWorldPosition(new THREE.Vector3()),head=rig.getSocket('head').getWorldPosition(new THREE.Vector3());
    const radius=h=>Math.min(2.6,Math.max(.35,(h>.2?h:1)*.58));
    for(const axis of [1,2])for(const amount of [-.075,.075]){
     rig.posture.rotation.set(basePitch,axis===1?amount:0,axis===2?amount:0);rig.root.updateMatrixWorld(true);
     const moved=rig.getSocket('clawR').getWorldPosition(new THREE.Vector3()),headMoved=rig.getSocket('head').getWorldPosition(new THREE.Vector3()),delta=moved.distanceTo(claw);
     if(delta>maxOrigin){maxOrigin=delta;worst={clip:name,axis,amount};}
     maxHead=Math.max(maxHead,Math.abs(headMoved.y-head.y));
     if(name==='spawn')maxRadius=Math.max(maxRadius,Math.abs(radius(headMoved.y-u.y)-radius(head.y-u.y)));
     for(const speed of [17,22])for(const distance of [1,3,7,15,30])for(let direction=0;direction<12;direction++){
      const target=new THREE.Vector3(u.x+Math.cos(direction*Math.PI/6)*distance,u.y+1,u.z+Math.sin(direction*Math.PI/6)*distance);
      const a=target.distanceTo(claw)/speed,b=target.distanceTo(moved)/speed;
      maxFlightSeconds=Math.max(maxFlightSeconds,Math.abs(a-b));maxArrivalTicks=Math.max(maxArrivalTicks,Math.abs(Math.ceil(a*30)-Math.ceil(b*30)));
     }
     checks++;
    }
   };
   examine('spawn',new legacy.Pose());
   for(const e of lib.list()){const c=lib.get(e.id);for(const t of [0,c.length*.17,c.length*.53,c.length]){const p=new legacy.Pose();legacy.sampleClip(c,t,false,p,true);examine(`${e.id}@${t}`,p);}}
   if(maxArrivalTicks>1)throw new Error(`${id} visual twitch changes arrival by ${maxArrivalTicks} ticks`);
   twitch.push({archetype:id,checks,maxOrigin,maxHead,maxSpawnRadiusDelta:maxRadius,maxFlightSeconds,maxArrivalTicks,worst});rig.dispose();
  }
  renderer.dispose();
  return {version:realActionData.version,clips:lib.list().length,rigs:rigs.length,specVariants,samples,anchors,roots,maxSampleDelta,maxAnchorDelta,maxRootDelta,twitch};
 });
 const output=process.argv.indexOf('--output');if(output>=0){if(!process.argv[output+1])throw new Error('--output needs a path');await writeFile(process.argv[output+1],JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();await server.close();}
