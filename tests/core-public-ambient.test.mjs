import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {worldArea,intent} from './core/worldHarness.mjs';
import {createPublicDefinition} from '../src/sim/areas/variants.ts';
import {loadBakedWorld} from '../src/sim/world/baked.ts';

test('one personal Frost ending-ready record does not freeze eight shared townsfolk or another player',async()=>{
 const query=loadBakedWorld(JSON.parse(await readFile(new URL('../public/world/collision-w4.json',import.meta.url),'utf8')));
 function fixture(id){
  const template=worldArea(`${id}-layout`,'w4',{query}),definition=createPublicDefinition(template.services.definition);template.dispose();
  const area=worldArea(id,'w4',{query,definition}),first=area.attachFresh('first','mage','human','spawn'),second=area.attachFresh('second','mage','human','spawn');
  for(let i=0;i<60;i++){area.step(new Map());area.drainEvents();}return {area,first,second};
 }
 const subject=fixture('personal-ending'),control=fixture('ambient-control');
 const positions=area=>[...area.units.values()].filter(u=>u.kind==='townsfolk').map(u=>[u.x,u.z]);
 try{
  const beforePlayer={...subject.area.services.getUnit(subject.second)};
  subject.area.services.player(subject.first).state.flags.frostCleared=true;
  for(const f of [subject,control])f.area.step(new Map([[f.second.id,intent(1,[],{forward:1})]]));
  assert.equal(subject.area.bosses.size,0);assert.equal(subject.area.drainEvents().filter(r=>r.event.type==='endingReady').length,1);control.area.drainEvents();
  const before=positions(subject.area);assert.equal(before.length,8);
  for(let i=0;i<90;i++)for(const f of [subject,control]){f.area.step(new Map());f.area.drainEvents();}
  const after=positions(subject.area),reference=positions(control.area);
  assert.equal(after.filter((p,i)=>Math.hypot(p[0]-before[i][0],p[1]-before[i][1])>.001).length,8);
  assert.deepEqual(after,reference,'shared townsfolk retain the same deterministic path as the no-ending control');
  const player=subject.area.services.getUnit(subject.second);assert(Math.hypot(player.x-beforePlayer.x,player.z-beforePlayer.z)>10);
  assert.equal(subject.area.snapshot().recovery.endings.length,1,'personal recovery remains available');
 }finally{subject.area.dispose();control.area.dispose();}
});
