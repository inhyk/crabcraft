import assert from 'node:assert/strict';
import test from 'node:test';
import {DAWN_ARENA_HEIGHT,dawnHeight} from '../src/sim/world/ground.ts';
test('the complete Solarkan platform is a raised level combat floor',()=>{assert.equal(DAWN_ARENA_HEIGHT,19);for(let r=0;r<=21;r+=3)for(let i=0;i<48;i++){const a=i/48*Math.PI*2;assert.ok(Math.abs(dawnHeight(Math.sin(a)*r,-72+Math.cos(a)*r)-19)<1e-10);}});
test('the arena joins its approach without a height step',()=>{for(const radius of [21,31])for(let i=0;i<48;i++){const a=i/48*Math.PI*2;assert.ok(Math.abs(dawnHeight(Math.sin(a)*(radius-.001),-72+Math.cos(a)*(radius-.001))-dawnHeight(Math.sin(a)*(radius+.001),-72+Math.cos(a)*(radius+.001)))<.01);}});
test('raising the arena leaves the harbor and central village unchanged',()=>{assert.equal(dawnHeight(0,82),4);assert.equal(dawnHeight(0,53),4);assert.equal(dawnHeight(0,0),4);});
