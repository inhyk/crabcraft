// Actual PCF render comparison in an isolated browser; all samples use one frozen scene instant.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 await page.goto((process.env.CC_QA_URL??'http://127.0.0.1:5192/')+'?screen=game');
 await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
 await page.evaluate(()=>{const g=window.app.current.game;g.world2.enter();g.god=true;g.player.unit.teleport(g.world,80,-24,Math.PI);g.follow.cut();g.follow.yaw=0;g.follow.distance=9;g.follow.pitch=.28;});
 await page.waitForTimeout(1700);
 const automatic=await page.evaluate(()=>{const n=window.app.current.game.world2.nodes.find(n=>n.kind==='crystal-d');return {opacity:n.mesh.material.opacity,shadow:n.shadowOpacity.value,casts:n.mesh.castShadow};});
 assert.ok(automatic.opacity<.05);assert.equal(automatic.shadow,automatic.opacity);assert.equal(automatic.casts,false);
 const result=await page.evaluate(async()=>{
  const g=window.app.current.game,n=g.world2.nodes.find(n=>n.kind==='crystal-d'),r=g.engine.renderer;
  g.hud.menu.show();
  const original={opacity:n.mesh.material.opacity,shadow:n.shadowOpacity.value,casts:n.mesh.castShadow};
  n.mesh.material.opacity=0; // Isolate shadow shading from the visible crystal surface.
  const images={};
  for(const [name,opacity,casts] of [['none',0,false],['zero',0,true],['half',.5,true],['full',1,true]]){
   n.shadowOpacity.value=opacity;n.mesh.castShadow=casts;r.render(g.scene,g.camera);images[name]=r.domElement.toDataURL();
  }
  n.mesh.material.opacity=original.opacity;n.shadowOpacity.value=original.shadow;n.mesh.castShadow=original.casts;
  const decoded={};
  for(const [name,url] of Object.entries(images)){
   const bitmap=await createImageBitmap(await (await fetch(url)).blob());
   const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);decoded[name]=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;bitmap.close();
  }
  let zeroDifference=0,halfDarkening=0,fullDarkening=0,shadowPixels=0;
  for(let i=0;i<decoded.none.length;i+=4){
   const full=decoded.none[i]+decoded.none[i+1]+decoded.none[i+2]-decoded.full[i]-decoded.full[i+1]-decoded.full[i+2];
   zeroDifference+=Math.abs(decoded.none[i]-decoded.zero[i])+Math.abs(decoded.none[i+1]-decoded.zero[i+1])+Math.abs(decoded.none[i+2]-decoded.zero[i+2]);
   if(full>3){shadowPixels++;fullDarkening+=full;halfDarkening+=Math.max(0,decoded.none[i]+decoded.none[i+1]+decoded.none[i+2]-decoded.half[i]-decoded.half[i+1]-decoded.half[i+2]);}
  }
  return {zeroDifference,halfDarkening,fullDarkening,shadowPixels,images};
 });
 assert.equal(result.zeroDifference,0,'an invisible crystal must have no shadow pixels');
 assert.ok(result.shadowPixels>100,'the full-opacity reference must actually cast a visible shadow');
 const fraction=result.halfDarkening/result.fullDarkening;assert.ok(fraction>.15&&fraction<.85,'half visibility must produce an intermediate shadow, not an opaque silhouette');
 for(const [name,url] of Object.entries(result.images))await writeFile(`tmp/qa/collectible-shadow-${name}.png`,Buffer.from(url.split(',')[1],'base64'));
 const disposal=await page.evaluate(()=>{const g=window.app.current.game,materials=g.world2.nodes.map(n=>n.mesh.customDepthMaterial);let disposed=0;for(const m of materials)m.addEventListener('dispose',()=>disposed++);g.dispose();return {owned:materials.length,disposed};});
 assert.equal(disposal.owned,7);assert.equal(disposal.disposed,disposal.owned);assert.deepEqual(errors,[]);
 console.log('PASS: transparent shadow absent, partial shadow fades, full shadow preserved, all owned depth materials disposed',{automatic,zeroDifference:result.zeroDifference,shadowPixels:result.shadowPixels,halfShadowFraction:fraction,disposal});
}finally{await browser.close();}
