import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5192/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();});await page.waitForTimeout(1700);
 const result=await page.evaluate(async()=>{
  const g=window.app.current.game,e=g.engine,m=g.world2.life.moths,meshes=[...m.wings,m.bodies];
  e.renderer.setAnimationLoop(null);e.renderer.setPixelRatio(1);e.renderer.setSize(1440,900,false);
  const matrix=g.camera.matrix.clone(),v=g.camera.position.clone();let samples=0,minDet=Infinity,minLift=Infinity,maxLift=-Infinity;
  for(let t=0;t<=240;t+=.5){m.update(t);for(let i=0;i<24;i++){m.bodies.getMatrixAt(i,matrix);v.setFromMatrixPosition(matrix);const west=i<12,r=Math.hypot(v.x-(west?-75:80),v.z-(west?-35:-40));if(r<(west?2.99:4.79)||r>(west?4.37:6.17))throw Error('Moth left its clear landmark ring');const lift=v.y-m.height(v.x,v.z);minLift=Math.min(minLift,lift);maxLift=Math.max(maxLift,lift);for(const mesh of meshes){mesh.getMatrixAt(i,matrix);minDet=Math.min(minDet,matrix.determinant());if(!matrix.elements.every(Number.isFinite))throw Error('Non-finite instance');if(!mesh.boundingBox.containsPoint(v))throw Error('Bounds omit animated moth');}samples++;}}
  m.update(10000);const a=meshes.map(x=>Array.from(x.instanceMatrix.array));m.update(10000);const deterministic=a.every((v,i)=>v.every((x,j)=>x===meshes[i].instanceMatrix.array[j]));
  g.player.unit.rig.root.visible=false;g.vfx.group.visible=false;g.objective.group.visible=false;
  const render=()=>{e.renderer.setRenderTarget(null);e.renderer.clear();e.renderer.info.reset();e.renderer.render(g.scene,g.camera);return e.canvas.toDataURL();};
  const views={};
  for(const [name,x,z] of [['forest',-75,-35],['observatory',80,-40]]){g.camera.position.set(x+7,m.height(x,z)+5,z+8);g.camera.lookAt(x,m.height(x,z)+1,z);g.camera.updateMatrixWorld();m.update(40);views[name]=render();}
  // Hide all other renderable objects while preserving lights and moth parent groups.
  g.scene.traverse(o=>{if((o.isMesh||o.isPoints||o.isLine||o.isSprite)&&!meshes.includes(o))o.visible=false;});g.scene.background=null;g.scene.fog=null;
  g.camera.position.set(-69,m.height(-75,-35)+4,-29);g.camera.lookAt(-75,m.height(-75,-35)+1.5,-35);g.camera.updateMatrixWorld();
  m.update(0);const first=render();const calls=e.renderer.info.render.calls;m.update(1.4);const second=render();
  const pixels=async(url)=>{const img=new Image();img.src=url;await img.decode();const c=new OffscreenCanvas(img.width,img.height),ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,img.width,img.height).data;};
  const p=await pixels(first),q=await pixels(second);let changed=0;for(let i=0;i<p.length;i+=4)if(Math.abs(p[i]-q[i])+Math.abs(p[i+1]-q[i+1])+Math.abs(p[i+2]-q[i+2])>6)changed++;
  let geometries=0,materials=0,instances=0;for(const geo of new Set(meshes.map(x=>x.geometry)))geo.addEventListener('dispose',()=>geometries++);for(const mat of new Set(meshes.map(x=>x.material)))mat.addEventListener('dispose',()=>materials++);for(const mesh of meshes)mesh.addEventListener('dispose',()=>instances++);
  const counts=meshes.map(x=>x.count),shadows=meshes.some(x=>x.castShadow);g.world2.returnToShore();g.world2.dispose();
  return {views,first,second,samples,minDet,minLift,maxLift,deterministic,calls,changed,counts,shadows,disposal:{geometries,materials,instances}};
 });
 assert.deepEqual(result.counts,[24,24,24]);assert.equal(result.shadows,false);assert.equal(result.deterministic,true);assert.ok(result.minDet>0);assert.ok(result.minLift>.77&&result.maxLift<2.13);assert.equal(result.calls,3);assert.ok(result.changed>300);assert.deepEqual(result.disposal,{geometries:3,materials:2,instances:3});assert.deepEqual(errors,[]);
 for(const [name,url] of Object.entries({...result.views,isolated:result.first,flap:result.second}))await writeFile(`tmp/qa/star-moths-${name}.png`,Buffer.from(url.split(',')[1],'base64'));
 delete result.views;delete result.first;delete result.second;console.log('PASS: native moth motion, clear landmark rings, deterministic shared-clock poses, finite positive matrices, conservative bounds, three GPU draws and full disposal',result);
}finally{await browser.close();}
