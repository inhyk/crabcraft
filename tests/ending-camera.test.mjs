// Camera cuts of the private ending: chosen from the accepted observation alone, wide cuts for the whole cast.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {EndingPresentationController} from '../src/sim/features/endingPresentation.ts';
mkdirSync('tmp/test-modules',{recursive:true});
buildSync({entryPoints:['src/multiplayer/endingPresentationView.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'tmp/test-modules/ending-camera-view.mjs',define:{'import.meta.env.BASE_URL':"'/'"},loader:{'.md':'text','.css':'empty'},logLevel:'silent'});
const {endingShot,endingStageFrame,endingRingStations,ENDING_WIDE_SHOTS,ENDING_LANDMARK_TICKS}=await import('../tmp/test-modules/ending-camera-view.mjs');
const options=(cast=18,yaw=2.0259)=>({id:'camera-a',owner:{area:'w1',id:1,life:1},centre:{x:3,y:4,z:12},yaw,cast:[{archetype:'human'},...Array.from({length:cast},(_,i)=>({archetype:`townsfolk:${i%8}`}))]});
const HERO_CUTS={close:['break_sixstep','break_oneclaw'],low:['break_spin','break_jumpspin','break_backflip']};
test('every cast observation maps to one cut; hero cuts only during their routine moves',()=>{
 const c=new EndingPresentationController(options()),seen=new Map();
 for(let i=0;i<1300;i++){const s=c.snapshot();const shot=endingShot(s);
  if(s.cast.length&&s.phase!=='blackout'){assert.ok(shot,`no cut at ${s.phase}`);if(!ENDING_WIDE_SHOTS.includes(shot))assert.ok(s.phase==='routine'&&HERO_CUTS[shot].includes(s.move),`${shot} during ${s.phase}/${s.move}`);seen.set(shot,(seen.get(shot)??0)+1);}
  else assert.equal(shot,null);
  if(s.phase==='credits')break;c.step();}
 assert.deepEqual([...seen.keys()].sort(),['close','crane','farewell','landmark','low']);
 // The finale holds the landmark for its first ticks, then rises into the farewell.
 assert.equal(seen.get('landmark'),ENDING_LANDMARK_TICKS);
});
test('cut choice depends only on the observation, never on wall time or call order',()=>{
 const a=new EndingPresentationController(options()),b=new EndingPresentationController(options());
 for(let i=0;i<1200;i++){a.step();b.step();assert.equal(endingShot(a.snapshot()),endingShot(structuredClone(b.snapshot())));}
});
test('stage frame and ring stations come from the fixed guest ring',()=>{
 for(const [count,yaw] of [[18,2.0259],[8,0],[11,-1.2]]){
  const c=new EndingPresentationController(options(count,yaw));for(let i=0;i<700;i++)c.step();const s=c.snapshot();
  const {centre,yaw:facing}=endingStageFrame(s.cast);
  assert.ok(Math.hypot(centre.x-3,centre.z-12)<1e-6&&Math.abs(centre.y-4)<1e-6,'centre is the stage centre');
  assert.ok(Math.abs(Math.atan2(Math.sin(facing-yaw),Math.cos(facing-yaw)))<1e-6,'slot 1 stands straight ahead of the hero');
  const stations=endingRingStations(s.cast,centre),inner=Math.ceil(count/2);assert.equal(stations.length,inner);
  for(const station of stations)for(const guest of s.cast.slice(1)){const x=centre.x+Math.sin(station.angle)*station.radius,z=centre.z+Math.cos(station.angle)*station.radius;assert.ok(Math.hypot(guest.position.x-x,guest.position.z-z)>1.2,'a station never stands on a guest');}
 }
});
