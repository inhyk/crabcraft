import test from 'node:test';
import assert from 'node:assert/strict';
import {worldArea,addActor,intent,tick} from './core/worldHarness.mjs';
import {questAccept} from '../src/sim/data/quests.ts';
import {xpForLevel} from '../src/sim/data/progression.ts';
function command(area,actor,seq,commands,extra={}){area.step(new Map([[actor.ref.id,intent(seq,commands,extra)]]));}
test('actual NPC quest and forge commands validate identity, range, giver and personal balance',()=>{
 const area=worldArea('npc'),a=addActor(area);command(area,a,1,[{kind:'questAccept',questId:'q1',npcId:'pip'}]);assert.equal(a.p.state.quests.status.q1,'available');command(area,a,2,[{kind:'questAccept',questId:'q1',npcId:'brinebeard'}]);assert.equal(a.p.state.quests.status.q1,'active');
 a.p.state.coins=250;command(area,a,3,[{kind:'forgeBuy',npcId:'pip'}]);assert.equal(a.p.state.attackRank,0);Object.assign(a.u,area.services.definition.npcs.find(n=>n.id==='pip').position);command(area,a,4,[{kind:'forgeBuy',npcId:'pip'},{kind:'forgeBuy',npcId:'pip'}]);assert.equal(a.p.state.attackRank,1);assert.equal(a.p.state.coins,150);command(area,a,4,[{kind:'forgeBuy',npcId:'pip'}]);assert.equal(a.p.state.coins,150);
 const before=structuredClone(a.p.state);command(area,a,5,[{kind:'questAccept',questId:'does-not-exist',npcId:'pip'}]);assert.deepEqual(a.p.state.quests,before.quests);
});
test('two real players channel independently; movement interrupts one and held input survives missing frames',()=>{
 const area=worldArea('channels','w2'),a=addActor(area,'a'),b=addActor(area,'b');questAccept(a.p,area.services,'w3');questAccept(b.p,area.services,'w3');Object.assign(a.u,area.services.definition.interactions.find(i=>i.id==='lamp-a').position);Object.assign(b.u,area.services.definition.interactions.find(i=>i.id==='lamp-b').position);
 area.step(new Map([[a.ref.id,intent(1,[{kind:'channelStart',channel:'waystone',targetId:'lamp-a'}],{heldChannel:'waystone'})],[b.ref.id,intent(1,[{kind:'channelStart',channel:'waystone',targetId:'lamp-b'}],{heldChannel:'waystone'})]]));assert.ok(a.p.state.channel);assert.ok(b.p.state.channel);command(area,a,2,[],{forward:1,heldChannel:'waystone'});assert.equal(a.p.state.channel,null);tick(area,46);assert.equal(a.p.state.quests.progress['w3-lamp-0'],undefined);assert.equal(b.p.state.quests.progress['w3-lamp-1'],1);assert.equal(b.p.state.channel,null);
});
test('initial and completed interaction reject unknown, distant or unmet objective prerequisites',()=>{
 const area=worldArea('validation','w2'),a=addActor(area);Object.assign(a.u,area.services.definition.interactions.find(i=>i.id==='lamp-a').position);command(area,a,1,[{kind:'channelStart',channel:'waystone',targetId:'lamp-a'}],{heldChannel:'waystone'});assert.equal(a.p.state.channel,null);questAccept(a.p,area.services,'w3');command(area,a,2,[{kind:'channelStart',channel:'waystone',targetId:'unknown'}],{heldChannel:'waystone'});assert.equal(a.p.state.channel,null);
 command(area,a,3,[{kind:'channelStart',channel:'waystone',targetId:'lamp-a'}],{heldChannel:'waystone'});assert.ok(a.p.state.channel);a.u.x+=20;tick(area,46);assert.equal(a.p.state.quests.progress['w3-lamp-0'],undefined);
 Object.assign(a.u,area.services.definition.interactions.find(i=>i.id==='crystal-a').position);command(area,a,4,[{kind:'interact',targetId:'crystal-a'}]);assert.equal(a.p.state.quests.progress['w2-gem-0'],undefined);
});
test('exploration and crystal progress remain personal while all three actual Areas coexist',()=>{
 const areas=[worldArea('coexist-1'),worldArea('coexist-2','w2'),worldArea('coexist-3','w3')],a=addActor(areas[1],'explorer'),b=addActor(areas[1],'observer');questAccept(a.p,areas[1].services,'w5');questAccept(b.p,areas[1].services,'w5');Object.assign(a.u,areas[1].services.definition.interactions.find(i=>i.id==='explore-west').position);for(let i=0;i<3;i++)for(const area of areas)area.step(new Map());assert.equal(a.p.state.quests.progress['w5-west'],1);assert.equal(b.p.state.quests.progress['w5-west'],undefined);assert.equal(areas[0].players.size,0);assert.equal(areas[2].players.size,0);
 questAccept(a.p,areas[1].services,'w2');Object.assign(a.u,areas[1].services.definition.interactions.find(i=>i.id==='crystal-a').position);command(areas[1],a,1,[{kind:'interact',targetId:'crystal-a'}]);assert.equal(a.p.state.quests.progress['w2-gem-0'],1);assert.equal(b.p.state.quests.progress['w2-gem-0'],undefined);
});
test('boss challenge validates chapter, personal level/flags and active encounter before actual teleport/reset',()=>{
 const area=worldArea('challenge','w2'),a=addActor(area);a.p.state.flags.abyssCleared=true;const boss=area.services.bossByProfile('eclipse');assert.equal(boss.state,'dormant');assert.equal(area.services.runCommand(a.ref,{kind:'bossChallenge',profile:'eclipse'}),false);a.p.gainXp(xpForLevel(20));a.p.state.cooldowns['crown-burst']={start:0,end:60};a.u.lastCombat=-10;const oldRef={...a.ref};assert.equal(area.services.runCommand(a.ref,{kind:'bossChallenge',profile:'eclipse'}),true);assert.equal(boss.state,'waking');assert.equal(a.p.state.unit.life,oldRef.life+1);assert.equal(area.services.getUnit(oldRef),null);assert.equal(a.p.state.cooldowns['crown-burst'].end,60);assert.ok(Math.abs(a.u.x)<1e-8);assert.equal(a.u.z,-66);assert.ok(Math.abs(a.u.yaw-Math.PI)<1e-8);
 const src=worldArea('challenge-shore'),low=addActor(src);low.p.gainXp(xpForLevel(10));low.p.state.flags.rustCleared=true;low.u.lastCombat=-10;assert.equal(src.services.runCommand(low.ref,{kind:'bossChallenge',profile:'abyss'}),false);
});
