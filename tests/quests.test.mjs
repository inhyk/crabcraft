import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QuestLog,QUESTS,QUEST_ORDER,setQuestLanguage} from '../tmp/test-modules/quests.js';

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


test('language changes preserve objective identity and active progress in both worlds',()=>{
 const q=new QuestLog();q.accept('q1');q.bump('collect-cog',2);q.setChapter(2);q.accept('w3');q.bump('lamp-a');
 const shape=()=>QUEST_ORDER.map(id=>({id,objectives:QUESTS[id].objectives.map(({id,kind,count,poi})=>({id,kind,count,poi})),xp:QUESTS[id].xp}));
 const before=shape();
 setQuestLanguage('en');assert.match(QUESTS.w3.offer.join(' '),/hold F/);assert.equal(q.value(QUESTS.w3.objectives[0]),1);assert.deepEqual(shape(),before);
 setQuestLanguage('ko');assert.deepEqual(shape(),before);assert.equal(QUESTS.q1.objectives[1].label,'녹슨 톱니 모으기');assert.match(QUESTS.q2.objectives[0].label,/전달/);assert.equal(q.value(QUESTS.q1.objectives[1]),2);
});

test('a personal quest choice guides its remaining objectives and turn-in, then falls back after completion',()=>{
 const q=new QuestLog();q.setChapter(2);q.accept('w1');q.accept('w5');
 assert.equal(q.current().quest,'w1');assert.equal(q.track('w5'),true);
 assert.equal(q.current().objective.kind,'explore-west');q.bump('explore-west');
 assert.equal(q.current().objective.kind,'explore-east');q.bump('explore-east');q.bump('explore-north');
 assert.equal(q.current().quest,'w5');assert.equal(q.current().step,'turnin');
 q.complete('w5');assert.equal(q.trackedQuest,null);assert.equal(q.current().quest,'w1');
 assert.equal(q.track('w5'),false);assert.equal(q.track('q4'),false);
});

test('quest choices persist separately by world and reject invalid or cross-world saved values',()=>{
 const q=new QuestLog();q.accept('q1');q.track('q1');q.setChapter(2);q.accept('w2');q.accept('w5');q.track('w5');
 assert.equal(q.track('q1'),false);assert.equal(q.current().quest,'w5');
 q.setChapter(1);assert.equal(q.current().quest,'q1');q.setChapter(2);assert.equal(q.current().quest,'w5');
 const restored=new QuestLog();Object.assign(restored.status,q.status);restored.restoreTracking(JSON.parse(JSON.stringify(q.tracked)));restored.setChapter(2);
 assert.equal(restored.current().quest,'w5');restored.setChapter(1);assert.equal(restored.current().quest,'q1');
 const malformed=new QuestLog();malformed.restoreTracking({1:'w5',2:'constructor'});assert.deepEqual(malformed.tracked,{});
});

test('repeated KO/EN switches clear translated fallback reward buttons and keep the final shore action English',()=>{
 for(let i=0;i<3;i++){
  setQuestLanguage('ko');assert.equal(QUESTS.q1.completeButton,'보상 받기');assert.equal(QUESTS.w1.completeButton,'보상 받기');
  setQuestLanguage('en');assert.equal(QUESTS.q1.completeButton,undefined);assert.equal(QUESTS.q2.completeButton,undefined);assert.equal(QUESTS.q3.completeButton,undefined);assert.equal(QUESTS.q4.completeButton,'Keep exploring toward level 10');assert.equal(QUESTS.w1.completeButton,'Claim reward');
 }
 setQuestLanguage('ko');
});

test('an unaccepted island request can guide to its giver, persist, then guide its accepted objectives',()=>{
 const q=new QuestLog();q.setChapter(2);q.accept('w1');assert.equal(q.current().quest,'w1');
 assert.equal(q.track('w2'),true);assert.equal(q.status.w2,'available');assert.equal(q.current().step,'accept');assert.equal(q.current().poi,'npc:pip');
 const restored=new QuestLog();Object.assign(restored.status,q.status);restored.restoreTracking(JSON.parse(JSON.stringify(q.tracked)));restored.setChapter(2);
 assert.equal(restored.current().quest,'w2');assert.equal(restored.current().step,'accept');restored.accept('w2');assert.equal(restored.current().objective.kind,'crystal-a');
 for(const kind of ['crystal-a','crystal-b','crystal-c','crystal-d'])restored.bump(kind);assert.equal(restored.current().step,'turnin');assert.equal(restored.current().poi,'npc:pip');restored.complete('w2');assert.equal(restored.current().quest,'w1');
 restored.setChapter(1);assert.equal(restored.track('q1'),false);assert.equal(restored.track('q4'),false);assert.equal(restored.track('w3'),false);
});

test('existing World III saves gain ten requests without resetting earlier progress',()=>{
 const q=new QuestLog();q.status.d1='done';q.status.d2='active';q.setChapter(3);
 const ids=QUEST_ORDER.filter(id=>q.inChapter(id));assert.equal(ids.length,12);
 assert.equal(q.status.d1,'done');assert.equal(q.status.d2,'active');
 for(const id of ids.slice(2))assert.equal(q.status[id],'available');
 q.accept('w1');assert.equal(q.status.w1,'locked');
});

test('all ten new requests have attainable objectives, distinct items and exactly one reward',()=>{
 const q=new QuestLog();q.setChapter(3);let rewards=0;q.events.on('completed',()=>rewards++);
 for(const id of QUEST_ORDER.filter(id=>/^d(?:[3-9]|1[0-2])$/.test(id))){
  const def=QUESTS[id];q.accept(id);q.track(id);assert.equal(q.current().quest,id);
  for(const o of def.objectives){q.bump(o.kind,o.count);q.bump(o.kind,o.count);assert.equal(q.value(o),o.count);}
  assert.equal(q.status[id],'ready');assert.equal(q.current().step,'turnin');
  q.complete(id);q.complete(id);assert.equal(q.status[id],'done');
 }
 assert.equal(rewards,10);
});

test('World III collections are personal, chapter-filtered and guide each remaining landmark',()=>{
 const a=new QuestLog(),b=new QuestLog();a.setChapter(3);b.setChapter(3);a.accept('d3');b.accept('d3');
 a.bump('dawn-crate-a');assert.equal(a.value(QUESTS.d3.objectives[0]),1);assert.equal(b.value(QUESTS.d3.objectives[0]),0);
 a.setChapter(2);a.bump('dawn-crate-b');assert.equal(a.value(QUESTS.d3.objectives[1]),0);
 a.setChapter(3);a.accept('d6');a.track('d6');
 for(const o of QUESTS.d6.objectives){assert.equal(a.current().objective.kind,o.kind);a.bump(o.kind);}
 assert.equal(a.current().step,'turnin');
});

test('World III Korean and English copy retain objective progress and tracked requests',()=>{
 const q=new QuestLog();q.setChapter(3);q.accept('d5');q.bump('dawn-lamp-a');q.track('d5');
 const shape=()=>QUESTS.d5.objectives.map(({id,kind,count})=>({id,kind,count}));const before=shape();
 setQuestLanguage('en');assert.match(QUESTS.d5.title,/Lanterns/);assert.match(QUESTS.d5.offer.join(' '),/hold F/i);
 setQuestLanguage('ko');assert.match(QUESTS.d5.title,/등불/);assert.deepEqual(shape(),before);
 assert.equal(q.value(QUESTS.d5.objectives[0]),1);assert.equal(q.current().quest,'d5');
});


test('existing snow saves gain ten requests without losing patrol or boss progress',()=>{
 const q=new QuestLog();q.status.s1='done';q.status.s2='active';q.progress.set('s2-boss',0);q.setChapter(4);
 const ids=QUEST_ORDER.filter(id=>q.inChapter(id));assert.equal(ids.length,12);
 assert.equal(q.status.s1,'done');assert.equal(q.status.s2,'active');
 for(const id of ids.slice(2))assert.equal(q.status[id],'available');
 assert.equal(q.track('s3'),true);assert.equal(q.current().step,'accept');assert.equal(q.current().poi,'npc:brinebeard');
});
test('all ten snow requests can be completed and award their reward only once',()=>{
 const q=new QuestLog();q.setChapter(4);let rewards=0;q.events.on('completed',()=>rewards++);
 for(const id of QUEST_ORDER.filter(id=>/^s(?:[3-9]|1[0-2])$/.test(id))){
  q.accept(id);q.track(id);const def=QUESTS[id];assert.equal(q.current().quest,id);
  for(const o of def.objectives){q.bump(o.kind,o.count);q.bump(o.kind,o.count);assert.equal(q.value(o),o.count);}
  assert.equal(q.status[id],'ready');assert.equal(q.current().step,'turnin');assert.equal(q.current().poi,`npc:${def.turnIn}`);
  q.complete(id);q.complete(id);assert.equal(q.status[id],'done');
 }
 assert.equal(rewards,10);
});
test('snow items remain personal and do not advance in another world; navigation resumes each saved item',()=>{
 const a=new QuestLog(),b=new QuestLog();a.setChapter(4);b.setChapter(4);a.accept('s3');b.accept('s3');a.track('s3');
 a.bump('snow-crate-a');assert.equal(a.value(QUESTS.s3.objectives[0]),1);assert.equal(b.value(QUESTS.s3.objectives[0]),0);
 a.setChapter(3);a.bump('snow-crate-b');assert.equal(a.value(QUESTS.s3.objectives[1]),0);
 a.setChapter(4);assert.equal(a.current().objective.kind,'snow-crate-b');
 const restored=new QuestLog();Object.assign(restored.status,a.status);for(const [id,n]of a.progress)restored.progress.set(id,n);restored.restoreTracking(a.tracked);restored.setChapter(4);
 assert.equal(restored.current().objective.kind,'snow-crate-b');
});
test('snow request localization preserves objectives, rewards and tracked progress',()=>{
 const q=new QuestLog();q.setChapter(4);q.accept('s5');q.bump('snow-lamp-a');q.track('s5');
 const shape=()=>QUEST_ORDER.filter(id=>QUESTS[id].chapter===4).map(id=>({id,xp:QUESTS[id].xp,objectives:QUESTS[id].objectives.map(({id,kind,count,poi})=>({id,kind,count,poi}))}));
 const before=shape();setQuestLanguage('en');assert.match(QUESTS.s5.title,/Blizzard/);assert.match(QUESTS.s5.offer[0],/Hold F/);
 setQuestLanguage('ko');assert.match(QUESTS.s5.title,/귀갓길/);assert.equal(q.value(QUESTS.s5.objectives[0]),1);assert.equal(q.current().quest,'s5');assert.deepEqual(shape(),before);
});
