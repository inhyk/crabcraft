#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openApp,advance} from '../../../trailer/lib.mjs';
import {shots,FPS} from './plan.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const out=resolve(opt('--out','scratch/cinema-audit'));mkdirSync(out,{recursive:true});
const only=opt('--shots','').split(',').filter(Boolean);
const app=await openApp({base:opt('--url','http://localhost:5297'),query:'screen=crowd',size:[540,960],dsf:1});
const reports=[];
try{
 await app.page.waitForFunction(()=>window.__crowd?.ready,null,{timeout:120000});
 await app.page.evaluate(()=>window.__capture.begin());
 for(const s of shots.filter(s=>s.program.cues.length&&(!only.length||only.includes(s.id)))){
  await app.page.evaluate(p=>window.__crowd.load(p,{layout:'port'}),s.program);
  await app.page.evaluate(async()=>{const {installAudit}=await import('/tools/crowd/sidestep-a4/cinema/audit-page.mjs');return installAudit(window.__crowd)});
  await app.page.evaluate(m=>{window.__crowd.seek(-2-1/60);window.__crowd.world.setMood(m,true)},s.program.fx[0].mood);
  await advance(app,2,FPS);
  const frames=[];
  for(let i=0;i<s.frames;i+=24){
   frames.push(...await app.page.evaluate(async n=>{const a=[];for(let k=0;k<n;k++){await window.__capture.step(1,1000/60);a.push(window.__crowd.auditFrame())}return a},Math.min(24,s.frames-i)));
  }
  const max=(key)=>Math.max(...frames.map(f=>f[key]??0));
  const min=(key)=>Math.min(...frames.map(f=>f[key]??Infinity));
  const summary={id:s.id,frames:frames.length,maxBodyStep:max('maxBodyStep'),maxBodyStepNormalized:max('maxBodyStepNormalized'),maxTurn:max('maxTurn'),frameMargin:min('frameMargin'),minWorldGap:min('minWorldGap'),maxScreenOverlap:max('maxScreenOverlap'),minScreenGap:min('minScreenGap'),
   discontinuities:frames.filter(f=>f.maxBodyStepNormalized>.18||f.maxTurn>20).map(f=>({t:f.t,step:f.maxBodyStepNormalized,turn:f.maxTurn})),
   overlapFrames:frames.filter(f=>f.pairs.length).length};
  writeFileSync(resolve(out,`${s.id}.json`),JSON.stringify({summary,frames},null,1));reports.push(summary);console.log(JSON.stringify(summary));
 }
 writeFileSync(resolve(out,'summary.json'),JSON.stringify({reports,errors:app.errors},null,2));
 if(app.errors.length)throw new Error(app.errors.join('\n'));
 const bad=reports.filter(r=>r.maxScreenOverlap>.001||r.frameMargin<8||r.maxBodyStepNormalized>.18||r.maxTurn>20);
 if(args.includes('--strict')&&bad.length)throw new Error(`Motion audit failed: ${bad.map(r=>r.id).join(', ')}`);
 console.log(bad.length?`AUDIT FINDINGS: ${bad.length} shots`:'MOTION AUDIT PASSED');
}finally{await app.browser.close()}
