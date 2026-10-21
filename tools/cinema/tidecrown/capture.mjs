#!/usr/bin/env node
// Real game capture using the existing fixed-step cinema stage and safe browser launcher.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openApp, advance, grab, record } from '../../trailer/lib.mjs';
import { shots, lights } from './program.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const out = resolve(opt('--out', 'tmp/tidecrown-film'));
const fps = Number(opt('--fps', 24));
const stills = args.includes('--stills');
const audit = args.includes('--audit');
const only = opt('--shots', '').split(',').filter(Boolean);
const [w, h] = opt('--size', '1920x1080').split('x').map(Number);
mkdirSync(out, { recursive: true });
const app = await openApp({ base: opt('--url', 'http://127.0.0.1:5379'), query: 'screen=game', size: [w,h], dsf: Number(opt('--dsf', 1)),
  spec: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Camera' },
  storage: { 'cc.language': 'ko', 'cc.musicVol': '0', 'cc.sfxVol': '0' } });
try {
  const p = app.page;
  console.log('Page opened');
  await p.waitForFunction(() => window.app?.current?.game?.loaded || document.querySelector('.launch-notice-start'), null, { timeout: 240000 });
  if(await p.locator('.launch-notice-start').count()) await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
  console.log('Base world loaded');
  await p.evaluate(async () => { (await import('/src/capture/cinema/index.ts')).default.init(); window.__capture.begin(); window.__cinema.travel(7); });
  let ready = false;
  for (let i=0; i<200 && !ready; i++) {
    await advance(app, .5, 24);
    ready = await p.evaluate(() => window.__cinema.chapter === 7 && !document.querySelector('.tidecrown-loading'));
    if(i%20===0)console.log(`Capital loading: step ${i}`);
  }
  if (!ready) throw new Error('Tidecrown did not finish loading');
  await advance(app, 2, 24);
  // Capture-only light rig, registered after the game and stage. Keeps sea, sky, key light,
  // shadows and reflection environment coherent. Nothing is imported by the production app.
  await p.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { createSky } = await import('/src/world/sky.ts');
    const g = window.app.current.game, tc = g.world2.tidecrown, a = tc.atmosphere;
    const hemi = a.group.children.find(x => x.isHemisphereLight);
    const envs = new Map();
    let config;
    window.__film = {
      setLight(name, c) {
        config = c;
        const u = a.skyU;
        ['uZenith','uMid','uHorizon','uGround','uSunColor','uGlow','uCloudLit','uCloudShade'].forEach((k,i) => u[k].value.set(c.sky[i]));
        u.uSunDir.value.set(...c.sun).normalize(); u.uMoonDir.value.copy(u.uSunDir.value);
        u.uStars.value=c.stars; u.uMoon.value=c.moon; u.uSunVis.value=c.sunVis; u.uCloudCover.value=c.clouds;
        a.water.uniforms.uDeep.value.set(c.deep); a.water.uniforms.uShallow.value.set(c.shallow);
        a.water.uniforms.uSunLight.value.set(c.key).multiplyScalar(c.sunVis ? 1 : .15);
        a.sun.color.set(c.key); a.sun.intensity=c.power;
        hemi.color.set(c.hemi); hemi.groundColor.set(c.bounce);
        if (!envs.has(name)) {
          const scene = new THREE.Scene(), sky = createSky(u), pmrem = new THREE.PMREMGenerator(g.engine.renderer);
          scene.add(sky); envs.set(name, pmrem.fromScene(scene,0,.1,100));
          pmrem.dispose(); sky.geometry.dispose(); sky.material.dispose();
        }
        g.scene.environment=envs.get(name).texture; g.scene.environmentIntensity=c.env;
      },
      probe() {
        const c=g.camera.position;
        return { ...window.__cinema.probe(), camera:c.toArray(), clearance:c.y-g.world.heightAt(c.x,c.z), chapter:window.__cinema.chapter };
      },
      dispose() { for(const x of envs.values()) x.dispose(); }
    };
    g.engine.onFrame(() => {
      if (!config) return;
      a.sun.position.copy(a.sun.target.position).addScaledVector(a.skyU.uSunDir.value,300);
      hemi.intensity=config.fill;
      a.sky.position.copy(g.camera.position);
    });
  });
  console.log('Tidecrown ready');
  for (const s of shots.filter(s => !only.length || only.includes(s.id))) {
    await p.evaluate(async ([s,c]) => { await window.__cinema.stage(s); window.__film.setLight(s.light,c); }, [s,lights[s.light]]);
    if (audit) {
      const result = await p.evaluate(([s,fps]) => {
        const g=window.app.current.game, stage=window.__cinema, col=g.world2.tidecrown.layout.col;
        let minClearance=Infinity, maxStep=0, previous;
        const intersections=[];
        for(let f=0;f<Math.round(s.length*fps);f++) {
          stage.placeCamera(s,f/fps,0);
          const c=g.camera.position;
          minClearance=Math.min(minClearance,c.y-g.world.heightAt(c.x,c.z));
          if(previous)maxStep=Math.max(maxStep,c.distanceTo(previous));
          previous=c.clone();
          if([[0,0,0],[.25,0,0],[-.25,0,0],[0,.25,0],[0,-.25,0],[0,0,.25],[0,0,-.25]].some(([x,y,z])=>col.solidAt(c.x+x,c.y+y,c.z+z)))
            intersections.push({frame:f,position:c.toArray()});
        }
        return {frames:Math.round(s.length*fps),minClearance,maxStep,intersections};
      },[s,fps]);
      writeFileSync(`${out}/${s.id}-audit.json`,JSON.stringify(result,null,2));
      console.log(`${s.id}: ${result.frames} camera samples, clearance ${result.minClearance.toFixed(2)}, intersections ${result.intersections.length}`);
      if(result.intersections.length || result.minClearance<1)throw new Error(`${s.id}: camera clearance audit failed`);
    } else if (stills) {
      const probes=[];
      for (const t of [0, s.length*.25, s.length*.5, s.length*.75, s.length-1/fps]) {
        await p.evaluate(t=>window.__cinema.seek(t),t);
        // Settle LOD and shadows without advancing the shot's clock.
        for(let i=0;i<12;i++) await p.evaluate(()=>window.__capture.step(1,0));
        writeFileSync(`${out}/${s.id}-${t.toFixed(2)}.jpg`,await grab(app,94));
        probes.push(await p.evaluate(()=>window.__film.probe()));
      }
      writeFileSync(`${out}/${s.id}.json`,JSON.stringify({shot:s,probes,errors:app.errors},null,2));
      console.log(`${s.id}: 5 stills`);
    } else {
      await p.evaluate(()=>window.__cinema.seek(0));
      for(let i=0;i<24;i++) await p.evaluate(()=>window.__capture.step(1,0));
      // Preroll compensates record()'s three initial clock steps at the selected frame rate.
      await p.evaluate(f=>window.__cinema.seek(-3/f),fps);
      const meta=await record(app,`${out}/${s.id}`,{duration:s.length,fps,log:true,probe:()=>window.__film.probe()});
      if(meta.frames!==Math.round(s.length*fps))throw new Error(`${s.id}: frame count mismatch`);
      if(Math.abs(meta.probe[0].t)>0.5/fps)throw new Error(`${s.id}: first frame is off the edit clock`);
      if(meta.errors.length)throw new Error(`${s.id}: page errors: ${meta.errors.join('\n')}`);
      if(meta.blanks.length)throw new Error(`${s.id}: blank frames need recapture`);
      if(meta.probe.some(p=>p.chapter!==7||p.clearance<1))throw new Error(`${s.id}: camera below ground`);
    }
  }
  if(app.errors.length)throw new Error(app.errors.join('\n'));
  await p.evaluate(()=>window.__film.dispose());
} finally { await app.browser.close(); }
