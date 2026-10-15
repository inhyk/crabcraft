// Native GPU regression: real coast foam stays on the island, and only water animates.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');
  await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
  await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();g.god=true;g.player.unit.teleport(g.world,-92,-20,Math.PI*.5);});
  await page.waitForTimeout(1800);
  const frames=await page.evaluate(()=>{
    const g=window.app.current.game,e=g.engine,sea=g.world2.sea.root;
    e.renderer.setAnimationLoop(null);e.renderer.setPixelRatio(1);e.renderer.setSize(1440,900,false);e.composer.setSize(1440,900);
    // Look down over the cliff so the terrain does not hide the narrow foam at its foot.
    g.camera.position.set(-90,36,10);g.camera.lookAt(-113,-3,-12);g.camera.updateMatrixWorld();g.world2.sky.update(120,g.camera,1);
    g.vfx.group.visible=false;g.objective.group.visible=false;
    g.world2.sea.update(120);e.composer.render(0);const first=e.canvas.toDataURL();
    g.world2.sea.update(123);e.composer.render(0);const later=e.canvas.toDataURL();
    const original=sea.material;
    const raw=()=>{e.renderer.setRenderTarget(null);e.renderer.clear();e.renderer.render(g.scene,g.camera);return e.canvas.toDataURL();};
    const mask=new original.constructor({uniforms:{shade:{value:0}},vertexShader:original.vertexShader,fragmentShader:'uniform float shade;void main(){gl_FragColor=vec4(vec3(shade),1.);}'});
    sea.material=mask;const black=raw();mask.uniforms.shade.value=1;const white=raw();
    // Observe the real shader's foam output without adding a diagnostic mode to production.
    const foam=original.clone();foam.fragmentShader=foam.fragmentShader.replace('gl_FragColor=vec4(color,1.);','gl_FragColor=vec4(vec3(foam),1.);');sea.material=foam;const foamFrame=raw();
    sea.material=original;mask.dispose();foam.dispose();
    return {first,later,black,white,foamFrame,geometry:{vertices:sea.geometry.attributes.position.count,triangles:sea.geometry.index.count/3,y:sea.position.y},memory:{...e.renderer.info.memory}};
  });
  const evidence=await page.evaluate(async frames=>{
    const pixels=async url=>{const image=new Image();image.src=url;await image.decode();const canvas=new OffscreenCanvas(1440,900),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,1440,900).data;};
    const first=await pixels(frames.first),later=await pixels(frames.later),black=await pixels(frames.black),white=await pixels(frames.white),foam=await pixels(frames.foamFrame);
    const water=new Uint8Array(1440*900);let waterPixels=0;
    for(let p=0;p<water.length;p++){const i=p*4;if(Math.abs(black[i]-white[i])>100){water[p]=1;waterPixels++;}}
    let animated=0,outside=0,foamPixels=0,offshoreFoam=0,minRadius=Infinity,maxRadius=0,foamMax=0;
    const g=window.app.current.game,v=g.player.unit.pos.clone();
    for(let p=0;p<water.length;p++){
      const i=p*4,x=p%1440,y=Math.floor(p/1440);
      if(Math.abs(first[i]-later[i])+Math.abs(first[i+1]-later[i+1])+Math.abs(first[i+2]-later[i+2])>12){
        if(water[p])animated++;else {let edge=false;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const q=(y+dy)*1440+x+dx;if(x+dx>=0&&x+dx<1440&&q>=0&&q<water.length&&water[q])edge=true;}if(!edge)outside++;}
      }
      if(water[p])foamMax=Math.max(foamMax,foam[i]);
      if(water[p]&&foam[i]>51){
        v.set((x+.5)/1440*2-1,1-(y+.5)/900*2,.5).unproject(g.camera).sub(g.camera.position).normalize();
        const t=(-3-g.camera.position.y)/v.y,wx=g.camera.position.x+v.x*t,wz=g.camera.position.z+v.z*t,r=Math.hypot(wx/115,(wz-10)/140);
        foamPixels++;minRadius=Math.min(minRadius,r);maxRadius=Math.max(maxRadius,r);if(r>1.15)offshoreFoam++;
      }
    }
    const borders=[];for(const x of [400,700,1000]){let y=899;while(y>0&&!water[y*1440+x])y--;v.set((x+.5)/1440*2-1,1-(y+.5)/900*2,.5).unproject(g.camera).sub(g.camera.position).normalize();const t=(-3-g.camera.position.y)/v.y,wx=g.camera.position.x+v.x*t,wz=g.camera.position.z+v.z*t;borders.push({x,y,wx,wz,height:g.world.heightAt(wx,wz),depth:-3-g.world.heightAt(wx,wz)});}
    return {waterPixels,animated,outside,foamPixels,offshoreFoam,minRadius,maxRadius,foamMax,borders};
  },frames);
  console.log('Water GPU evidence',evidence);
  await writeFile('tmp/qa/star-sea-coast.png',Buffer.from(frames.first.split(',')[1],'base64'));
  await writeFile('tmp/qa/star-sea-foam.png',Buffer.from(frames.foamFrame.split(',')[1],'base64'));
  assert.equal(frames.geometry.vertices,4);assert.equal(frames.geometry.triangles,2);assert.equal(frames.geometry.y,-3);
  assert.ok(evidence.waterPixels>10000);assert.ok(evidence.animated>1000);assert.equal(evidence.outside,0);
  assert.ok(evidence.foamPixels>20);assert.equal(evidence.offshoreFoam,0);assert.ok(evidence.minRadius>.8&&evidence.maxRadius<1.15);
  const disposed=await page.evaluate(()=>{const g=window.app.current.game,sea=g.world2.sea.root;let geometry=0,material=0;sea.geometry.addEventListener('dispose',()=>geometry++);sea.material.addEventListener('dispose',()=>material++);g.world2.returnToShore();const hidden=!sea.parent.visible;g.world2.dispose();return {geometry,material,hidden};});
  assert.deepEqual(disposed,{geometry:1,material:1,hidden:true});assert.deepEqual(errors,[]);
  console.log('PASS: animated water only, visible shore foam with no offshore ring, fixed level/geometry, clean shore hide and disposal', {evidence,geometry:frames.geometry,memory:frames.memory});
} finally {await browser.close();}
