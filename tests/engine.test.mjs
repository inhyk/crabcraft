import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../tmp/test-modules/engine.js';

globalThis.window={devicePixelRatio:2};globalThis.document={hidden:false};globalThis.localStorage={setItem(){}};
function controller(ratio=2){
 const e=Object.create(Engine.prototype);
 Object.assign(e,{quality:'high',setting:'auto',elapsed:0,autoPr:ratio,pixelRatio:ratio,dtWin:[],gpuWin:[],winT:0,settleUntil:0,slowWins:0,fastWins:0,ceilingPr:2,lastUpAt:-1e9,upBlockedUntil:0,saveAt:0,gpuMs:-1,onResolutionChange:null,resize(){this.pixelRatio=this.autoPr;}});
 return e;
}
function workload(e,hz,gpu,seconds){for(let i=0;i<hz*seconds;i++){e.elapsed+=1/hz;if(gpu!==null)e.gpuWin.push(gpu);e.updateDynamic(1/hz);}}

test('sustained GPU-bound slow frames lower Auto resolution',()=>{
 const e=controller();workload(e,30,24,6);assert.ok(e.pixelRatio<2,'a sustained GPU-bound 30 Hz workload must lower resolution');assert.ok(e.pixelRatio>=.5);
});
test('CPU-bound frame cap keeps full resolution despite slow callbacks',()=>{
 const e=controller();workload(e,30,2,6);assert.equal(e.pixelRatio,2);
});
test('stable fast frames with GPU headroom recover resolution',()=>{
 const e=controller(1);workload(e,60,3,12);assert.ok(e.pixelRatio>1,'available GPU headroom must recover image quality');assert.ok(e.pixelRatio<=2);
});
