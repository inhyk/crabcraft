import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DUNGEONS,dungeonDanger} from '../src/game/dungeonData.ts';
test('six fixed tiers bridge the gaps between story bosses with increasing rewards',()=>{
 assert.deepEqual(DUNGEONS.map(d=>d.level),[35,50,75,150,200,250]);
 for(const [i,d]of DUNGEONS.entries()){assert.equal(d.chapter,d.level<100?3:4);assert.ok(d.name[0]&&d.name[1]);if(i){assert.ok(d.coins>DUNGEONS[i-1].coins);assert.ok(d.xp>DUNGEONS[i-1].xp);}}
});
test('each telegraphed hazard has matching safe ground and a distinct footprint',()=>{
 const samples=[];
 for(let index=0;index<6;index++){let hits=0,safe=0;const footprint=[];for(let x=-16;x<=16;x+=2)for(let z=-16;z<=16;z+=2){if(Math.hypot(x,z)>17)continue;const danger=dungeonDanger(index,0,x,z);danger?hits++:safe++;footprint.push(danger);}assert.ok(hits>0&&safe>0,`hazard ${index} must be avoidable`);samples.push(JSON.stringify(footprint));}
 assert.equal(new Set(samples).size,6);
 assert.notEqual(dungeonDanger(3,0,-10,0),dungeonDanger(3,1,-10,0));
 assert.notEqual(dungeonDanger(4,0,12,0),dungeonDanger(4,2,12,0));
 assert.notEqual(dungeonDanger(5,0,0,0),dungeonDanger(5,1,0,0));
});
