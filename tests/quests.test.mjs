import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QuestLog,QUESTS,QUEST_ORDER} from '../tmp/test-modules/quests.js';

test('legacy World II saves unlock all seven island quests with no World I offers',()=>{
 const q=new QuestLog();q.setChapter(2);const ids=QUEST_ORDER.filter(id=>q.inChapter(id));assert.equal(ids.length,7);
 for(const id of ids){assert.equal(q.status[id],'available');assert.equal(q.offeredBy(QUESTS[id].giver),id);}
 assert.equal(q.current().quest,'w1');q.accept('q1');assert.equal(q.status.q1,'available');
});
test('unique crystals and lanterns cannot count twice; turn-in rewards fire once',()=>{
 const q=new QuestLog();q.setChapter(2);q.accept('w2');let rewards=0;q.events.on('completed',()=>rewards++);
 q.bump('crystal-a');q.bump('crystal-a');assert.equal(q.value(QUESTS.w2.objectives[0]),1);assert.equal(q.status.w2,'active');
 for(const k of ['crystal-b','crystal-c','crystal-d'])q.bump(k);assert.equal(q.readyAt('pip'),'w2');
 q.complete('w2');q.complete('w2');assert.equal(rewards,1);q.accept('w3');for(const k of ['lamp-a','lamp-b','lamp-c'])q.bump(k);assert.equal(q.readyAt('rattlebolt'),'w3');
});
test('switching worlds retains personal objectives and filters chapter events',()=>{
 const q=new QuestLog();q.accept('q1');q.setChapter(2);q.accept('w1');q.bump('kill-scrapling',3);
 assert.equal(q.value(QUESTS.q1.objectives[0]),0);assert.equal(q.value(QUESTS.w1.objectives[0]),3);
 q.setChapter(1);q.bump('kill-scrapling');assert.equal(q.value(QUESTS.w1.objectives[0]),3);q.setChapter(2);assert.equal(q.current().quest,'w1');
});
test('the island final-boss quest completes automatically exactly once',()=>{
 const q=new QuestLog();q.setChapter(2);q.accept('w7');let count=0;q.events.on('completed',()=>count++);
 q.bump('eclipse-boss');q.bump('eclipse-boss');assert.equal(q.status.w7,'done');assert.equal(count,1);
});
