// Exports the actual Three.js settlement, including its existing postprocessing, as loading art.
// Run after a production build with the preview listening on port 5192.
import {launchBrowser} from './lib/browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';

const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1600,height:900}});
  await page.addInitScript(()=>localStorage.setItem('cc.hintsSeen','1'));
  await page.goto('http://127.0.0.1:5192/?screen=game');
  await page.waitForFunction(()=>window.app?.current?.game?.loaded,null,{timeout:90000});
  await page.evaluate(()=>{
    const g=window.app.current.game;
    g.god=true;g.world2.enter();g.player.unit.teleport(g.world,0,55,0);
  });
  await page.waitForTimeout(2200);
  const image=await page.evaluate(()=>{
    const g=window.app.current.game,e=g.engine;
    e.renderer.setAnimationLoop(null);
    e.renderer.setPixelRatio(1);e.renderer.setSize(1600,900,false);e.composer.setSize(1600,900);
    g.vfx.group.visible=false;g.objective.group.visible=false;
    g.camera.aspect=1600/900;g.camera.updateProjectionMatrix();
    g.camera.position.set(34,25,104);g.camera.lookAt(0,6,43);g.camera.updateMatrixWorld();
    const sceneTime=g.world2.sky.time.value;
    g.world2.sky.update(sceneTime,g.camera,e.renderer.getPixelRatio());g.world2.sea.update(sceneTime);
    e.composer.render(0);
    return e.canvas.toDataURL('image/webp',.88);
  });
  await mkdir('public/art',{recursive:true});
  await writeFile('public/art/loading-starhaven.webp',Buffer.from(image.split(',')[1],'base64'));
  console.log('Exported actual Starhaven scene to public/art/loading-starhaven.webp');
} finally { await browser.close(); }
