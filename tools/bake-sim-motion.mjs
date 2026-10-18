// Bake real decoded shipped clips and real rig transforms through the production loaders.
// No synthetic fallback: missing assets or rigs fail this derivation.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = x => createHash('sha256').update(x).digest('hex');
const server = await createServer({root, server:{host:'127.0.0.1',port:5266,strictPort:true}, logLevel:'error'});
await server.listen();
let browser;
try {
 browser = await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage();
 await page.route('**/__sim_bake__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Numeric motion bake</title>'}));
 await page.goto('http://127.0.0.1:5266/__sim_bake__');
 const result=await page.evaluate(async()=>{
  const [{MotionLibrary},{SKILL_CLIPS},{skillWindow,SKILL_RATE},{ROUTINE},{createCrab,createEnemyCrab},{createJellyfishRig},{JOINT_NAMES},THREE] = await Promise.all([
   import('/src/motion/library.ts'),import('/src/motion/skillClips.ts'),import('/src/motion/skills.ts'),import('/src/motion/breakdance.ts'),import('/src/crab/index.ts'),import('/src/crab/jellyfish.ts'),import('/src/crab/types.ts'),import('/node_modules/three/build/three.module.js')]);
  const {initAssets}=await import('/src/core/assets.ts');initAssets(new THREE.WebGLRenderer());
  const lib=new MotionLibrary('/motions/'); await lib.ready;
  const clips={}; for(const e of lib.list()){const c=await lib.load(e.id); clips[e.id]={...c,q:Array.from(c.q),base:Array.from(c.base),local:c.local?Array.from(c.local):null};}
  const archetypes={};
  const specs=Object.fromEntries(['human','orc','dwarf','undead','nightelf','tauren'].map(race=>[race,{race,sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'numeric bake'}]));
  const capture=(id,rig)=>{
   rig.root.updateMatrixWorld(true);
   const height=rig.getSocket('head').getWorldPosition(new THREE.Vector3()).y;
   const chain=[]; for(let n=rig.getSocket('clawR');n&&n!==rig.body&&n!==rig.root;n=n.parent){
    const ji=rig.jointNodes?.indexOf(n)??-1;
    chain.push({name:n.name,position:n.position.toArray(),rotation:n.quaternion.toArray(),scale:n.scale.toArray(),joint:ji,axis:ji>=0?rig.axes[ji].toArray():null,bias:ji>=0?rig.jointBias[ji]:0});
   }
   archetypes[id]={height:height>.2?height:1,radius:Math.min(2.6,Math.max(.35,(height>.2?height:1)*.58)),metersToUnits:rig.metersToUnits,rootScale:rig.root.scale.toArray(),bodySocket:rig.getSocket('clawR').parent!==rig.root,chain:chain.reverse()};
   rig.dispose();
  };
  for(const [id,spec]of Object.entries(specs))capture(id,await createCrab(spec));
  for(const id of ['scrapling','scavenger','corrodius'])capture(id,await createEnemyCrab(id));
  capture('jellyfish',createJellyfishRig());
  for(const [id,race,scale] of [['abyss','nightelf',3.5],['eclipse','undead',4.5],['dawn','orc',4]]){const rig=await createCrab(specs[race]);rig.root.scale.multiplyScalar(scale);capture(id,rig);}
  {const rig=await createEnemyCrab('corrodius');rig.root.scale.multiplyScalar(.55);capture('echo',rig);}
  const windows={}; for(const id of Object.keys(SKILL_CLIPS))windows[id]={move:skillWindow(id),channel:skillWindow(id,'channel'),release:skillWindow(id,'release')};
  return {clips,archetypes,windows,routine:ROUTINE,rates:SKILL_RATE,joints:JOINT_NAMES};
 });
 const index=JSON.parse(await readFile(new URL('../public/motions/index.json',import.meta.url),'utf8'));
 const sources=['src/motion/library.ts','src/motion/pose.ts','src/motion/controller.ts','src/motion/skills.ts','src/motion/skillClips.ts','src/motion/breakdance.ts','src/motion/breakClips.ts','src/crab/index.ts','src/crab/rig.ts','src/crab/template.ts','src/crab/posture.ts','src/crab/pose.ts','src/crab/types.ts','src/crab/jellyfish.ts','src/data/races.ts','src/game/unit.ts','src/game/game.ts','public/models/crab/jumper.glb','public/motions/index.json'];
 for(const c of index.clips){sources.push(`public/motions/${c.id}.json`);const h=JSON.parse(await readFile(root+`public/motions/${c.id}.json`,'utf8'));sources.push('public/motions/'+h.bin);}
 for(const c of Object.values(result.clips))for(const key of ['q','base','local'])if(c[key]){const values=c[key],bytes=Buffer.alloc(values.length*4);values.forEach((v,i)=>bytes.writeFloatLE(v,i*4));c[key]=bytes.toString('base64');}
 result.encoding='float32-le-base64';
 const sourceHashes={};for(const path of sources.sort())sourceHashes[path]=sha(await readFile(root+path));
 result.sourceHashes=sourceHashes;result.version='shipped-motion-v1-'+sha(JSON.stringify(result)).slice(0,20);
 await mkdir(root+'src/sim/data',{recursive:true});
 await writeFile(root+'src/sim/data/pose-data.json',JSON.stringify(result)+'\n');
 console.log(JSON.stringify({version:result.version,clips:Object.keys(result.clips).length,archetypes:Object.keys(result.archetypes).length,bytes:JSON.stringify(result).length}));
}finally{await browser?.close();await server.close();}
