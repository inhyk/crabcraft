// Actual GPU evidence: celestial visibility, animated aurora, camera-relative sky and disposal.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>localStorage.setItem('cc.hintsSeen','1'));
  await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');
  await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
  await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.world2.enter();g.player.unit.teleport(g.world,0,55,0);});
  await page.waitForTimeout(1800);
  const result=await page.evaluate(()=>{
    const g=window.app.current.game,e=g.engine,sky=g.world2.sky;
    e.renderer.setAnimationLoop(null);e.renderer.setPixelRatio(1);e.renderer.setSize(1440,900,false);e.composer.setSize(1440,900);
    g.camera.position.set(34,25,104);g.camera.lookAt(0,6,43);g.camera.updateMatrixWorld();
    sky.update(120,g.camera,1);g.vfx.group.visible=false;g.objective.group.visible=false;
    const stars=sky.root.getObjectByName('star-celestial-points'),moon=sky.root.getObjectByName('star-crescent-moon');
    const render=()=>{e.composer.render(0);return e.canvas.toDataURL();};
    const raw=()=>{e.renderer.setRenderTarget(null);e.renderer.clear();e.renderer.render(g.scene,g.camera);return e.canvas.toDataURL();};
    const full=render(),rawFull=raw();stars.visible=false;const noStars=render(),rawNoStars=raw();stars.visible=true;
    moon.visible=false;const noMoon=render(),rawNoMoon=raw();moon.visible=true;
    sky.update(150,g.camera,1);const later=render(),rawLater=raw();
    const structure={count:stars.geometry.attributes.position.count,draws:sky.root.children.length,fog:sky.root.children.map(o=>o.material.fog),depth:stars.material.depthWrite};
    g.camera.position.addScalar(40);sky.update(150,g.camera,2);
    const tracked=sky.root.position.distanceTo(g.camera.position),ratio=stars.material.uniforms.pixelRatio.value;
    return {full,noStars,noMoon,later,rawFull,rawNoStars,rawNoMoon,rawLater,structure,tracked,ratio,memory:{...e.renderer.info.memory}};
  });
  const differences=await page.evaluate(async({full,noStars,noMoon,later,rawFull,rawNoStars,rawNoMoon,rawLater})=>{
    const pixels=async(url)=>{const image=new Image();image.src=url;await image.decode();const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,image.width,image.height).data;};
    const post=await pixels(full),unfiltered=await pixels(rawFull),answer={};
    for(const [name,url] of Object.entries({stars:noStars,moon:noMoon,animation:later,rawStars:rawNoStars,rawMoon:rawNoMoon,rawAnimation:rawLater})){
      const original=name.startsWith('raw')?unfiltered:post;
      const other=await pixels(url);let count=0,ground=0;
      for(let i=0;i<original.length;i+=4){const d=Math.abs(original[i]-other[i])+Math.abs(original[i+1]-other[i+1])+Math.abs(original[i+2]-other[i+2]);if(d>12){count++;if(i/(1440*4)>400)ground++;}}
      answer[name]={pixels:count,ground};
    }
    return answer;
  },result);
  assert.equal(result.structure.count,980);assert.equal(result.structure.draws,3);assert.deepEqual(result.structure.fog,[false,false,false]);assert.equal(result.structure.depth,false);
  assert.equal(result.tracked,0);assert.equal(result.ratio,2);
  assert.ok(differences.stars.pixels>100);assert.ok(differences.moon.pixels>100);assert.ok(differences.animation.pixels>1000);
  // Bloom can move a threshold in SMAA by a pixel. Require exact isolation before postprocessing.
  for(const name of ['rawStars','rawMoon','rawAnimation'])assert.equal(differences[name].ground,0);
  for(const name of ['stars','moon','animation'])assert.ok(differences[name].ground<=10);
  await writeFile('tmp/qa/star-sky-village.png',Buffer.from(result.full.split(',')[1],'base64'));
  // A real return journey hides the whole celestial layer; normal disposal releases its resources.
  const disposed=await page.evaluate(()=>{const g=window.app.current.game,sky=g.world2.sky;g.world2.returnToShore();const visible=sky.root.parent.visible,geometries=new Set(),materials=new Set();let geometryEvents=0,materialEvents=0;for(const mesh of sky.root.children){geometries.add(mesh.geometry);materials.add(mesh.material);}for(const geometry of geometries)geometry.addEventListener('dispose',()=>geometryEvents++);for(const material of materials)material.addEventListener('dispose',()=>materialEvents++);g.world2.dispose();return {visible,geometries:geometries.size,materials:materials.size,geometryEvents,materialEvents};});
  assert.equal(disposed.visible,false);assert.equal(disposed.geometryEvents,disposed.geometries);assert.equal(disposed.materialEvents,disposed.materials);assert.deepEqual(errors,[]);
  console.log('PASS: visible celestial layers, animated aurora only in sky, ground undisturbed, camera-relative dome, dynamic pixel ratio, shore hide and disposal', {structure:result.structure,differences,memory:result.memory,disposed});
} finally {await browser.close();}
