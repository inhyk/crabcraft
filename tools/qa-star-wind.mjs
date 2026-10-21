// Frozen GPU comparison: only the island wind clock changes, including real PCF shadows.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto((process.env.CC_QA_URL||'http://127.0.0.1:5192')+'/?screen=game');await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();g.player.unit.teleport(g.world,-60,-10,Math.PI);g.follow.cut();});await page.waitForTimeout(1700);
 const result=await page.evaluate(async()=>{
  const g=window.app.current.game,e=g.engine,w=g.world2.wind,forest=g.world2.root.getObjectByName('star-island-forests');
  e.renderer.setAnimationLoop(null);e.renderer.setPixelRatio(1);e.renderer.setSize(1440,900,false);e.composer.setSize(1440,900);
  g.camera.position.set(-48,12,8);g.camera.lookAt(-72,7,-20);g.camera.updateMatrixWorld();g.world2.sky.update(120,g.camera,1);g.world2.sea.update(120);g.vfx.group.visible=false;g.objective.group.visible=false;g.player.unit.rig.root.visible=false;
  const plants=forest.children.filter(m=>m.customDepthMaterial?.name==='star-wind-shadow');
  const render=time=>{w.update(time);e.renderer.setRenderTarget(null);e.renderer.clear();e.renderer.render(g.scene,g.camera);return e.canvas.toDataURL();};
  const full=render(0),later=render(3);
  for(const m of plants){m.material.colorWrite=false;m.material.depthWrite=false;}
  const shadowA=render(0),shadowB=render(3);
  for(const m of plants)m.castShadow=false;
  const staticA=render(0),staticB=render(3);
  for(const m of plants){m.castShadow=true;m.material.colorWrite=true;m.material.depthWrite=true;}
  const pixels=async(url)=>{const image=new Image();image.src=url;await image.decode();const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,image.width,image.height).data;};
  const diff=async(a,b)=>{a=await pixels(a);b=await pixels(b);let count=0,total=0;for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(d>6)count++;total+=d;}return {pixels:count,total};};
  const animation=await diff(full,later),shadow=await diff(shadowA,shadowB),staticScene=await diff(staticA,staticB);
  let geometries=0,minPadding=Infinity;
  for(const mesh of forest.children){const ids=new Set();for(let i=0;i<mesh.instanceCount;i++)ids.add(mesh.getGeometryIdAt(i));for(const id of ids){const box=mesh.boundingBox.clone();mesh.getBoundingBoxAt(id,box);const range=mesh.getGeometryRangeAt(id),p=mesh.geometry.attributes.position,raw=box.clone().makeEmpty(),v=g.camera.position.clone();for(let i=range.vertexStart;i<range.vertexStart+range.vertexCount;i++)raw.expandByPoint(v.fromBufferAttribute(p,i));minPadding=Math.min(minPadding,raw.min.x-box.min.x,raw.min.y-box.min.y,raw.min.z-box.min.z,box.max.x-raw.max.x,box.max.y-raw.max.y,box.max.z-raw.max.z);geometries++;}}
  return {full,later,shadowA,shadowB,animation,shadow,staticScene,geometries,minPadding,plants:plants.map(m=>({name:m.name,instances:m.instanceCount})),clock:w.time.value};
 });
 assert.equal(result.plants.length,5);assert.ok(result.animation.pixels>500,JSON.stringify(result.animation));assert.ok(result.shadow.pixels>50,JSON.stringify(result.shadow));assert.equal(result.staticScene.total,0,'without visible plants or their shadows, wind must change nothing');assert.ok(result.geometries>5);assert.ok(result.minPadding>.1999);
 for(const name of ['full','later','shadowA','shadowB'])await writeFile(`tmp/qa/star-wind-${name}.png`,Buffer.from(result[name].split(',')[1],'base64'));
 const disposal=await page.evaluate(()=>{const g=window.app.current.game,forest=g.world2.root.getObjectByName('star-island-forests'),materials=forest.children.map(m=>m.customDepthMaterial).filter(Boolean);let disposed=0;for(const m of materials)m.addEventListener('dispose',()=>disposed++);g.world2.returnToShore();const visible=forest.parent.parent.visible;g.world2.dispose();return {owned:materials.length,disposed,visible};});
 assert.equal(disposal.owned,5);assert.equal(disposal.disposed,5);assert.equal(disposal.visible,false);assert.deepEqual(errors,[]);
 console.log('PASS: actual plant sway, matching animated PCF shadows, static-scene isolation, conservative batch bounds, shore hide and depth-material disposal',{animation:result.animation,shadow:result.shadow,staticScene:result.staticScene,geometries:result.geometries,minPadding:result.minPadding,plants:result.plants,disposal});
}finally{await browser.close();}
