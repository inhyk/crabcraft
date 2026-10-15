import WebSocket from 'ws';
import assert from 'node:assert/strict';
import {once} from 'node:events';
const base='wss://inh-crabcraft-rooms.seonn.workers.dev/multiplayer';
const spec={race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Live test'};
const state={x:3,y:0,z:5,yaw:1,hp:80,maxHp:100,alive:true};
const clients=[];
async function connect(mode,room=''){
 const ws=new WebSocket(`${base}?mode=${mode}&room=${room}`,{origin:'https://inh-crabcraft-multiplayer.vercel.app'});
 const queue=[];ws.on('message',raw=>queue.push(JSON.parse(raw.toString()))); await once(ws,'open');
 const c={ws,queue,send:data=>ws.send(JSON.stringify(data)),async next(type){const until=Date.now()+10000;while(Date.now()<until){const i=queue.findIndex(m=>m.type===type);if(i>=0)return queue.splice(i,1)[0];await new Promise(r=>setTimeout(r,10));}throw new Error('Timeout '+type+' '+JSON.stringify(queue));}};
 clients.push(c); c.send({type:mode,room,spec,combatVersion:1});return c;
}
try {
 const a=await connect('create');const r=await a.next('welcome');assert.match(r.room,/^[A-F0-9]{6}$/);
 a.send({type:'state',state});
 const b=await connect('join',r.room);const joined=await b.next('welcome');assert.equal(joined.players.length,1);assert.deepEqual(joined.players[0].state,state);await a.next('joined');
 const isolated=await connect('create');await isolated.next('welcome');
 b.send({type:'state',state:{...state,x:7}});assert.equal((await a.next('state')).state.x,7);
 b.send({type:'action',action:'jump'});assert.equal((await a.next('action')).action,'jump');
 b.send({type:'chat',text:'Internet multiplayer works'});assert.equal((await a.next('chat')).text,'Internet multiplayer works');await b.next('chat');
 assert.equal(isolated.queue.some(m=>m.type!=='authority'),false);b.ws.close();assert.equal((await a.next('left')).id,joined.id);
 const c=await connect('join',r.room);const rejoined=await c.next('welcome');assert.notEqual(rejoined.id,joined.id);assert.deepEqual(rejoined.players[0].state,state);
 const world={weather:{mood:1,beacon:true,clock:123},entities:[{id:'e0',...state,level:1,hidden:false,invulnerable:false,targetable:true,stun:0,slow:0,slowPct:0,rust:0,rustFor:0,enemyState:'chase',xp:20}],bosses:[{id:'b3',state:'fight',phase:2,enraged:false,mech:{id:2,kind:'slam',at:[3,0,5],yaw:1,left:1}},{id:'b10',state:'dormant',phase:1,enraged:false,mech:null},{id:'b20',state:'dormant',phase:1,enraged:false,mech:null}],rust:false,abyss:false,chapter:1,firstEnding:false,trueCleared:false};
 a.send({type:'world',world});assert.deepEqual((await c.next('world')).world,world);
 c.send({type:'combat',event:{kind:'attack',target:'e0',amount:23}});const attack=await a.next('combat');assert.equal(attack.id,rejoined.id);assert.equal(attack.event.amount,23);
 c.send({type:'combat',event:{kind:'environment',target:'world',environment:{mood:1,beacon:true}}});assert.deepEqual((await a.next('combat')).event.environment,{mood:1,beacon:true});
 c.send({type:'world',world:{...world,rust:true}});
 a.send({type:'combat',event:{kind:'hit',target:'e0',amount:23}});assert.equal((await c.next('combat')).event.amount,23);
 a.send({type:'combat',event:{kind:'death',target:'e0',serial:1}});assert.equal((await c.next('combat')).event.kind,'death');
 const late=await connect('join',r.room);const checkpoint=await late.next('welcome');assert.deepEqual(checkpoint.world,world);assert.equal(checkpoint.host,r.id);
 a.ws.close();await c.next('left');let authority;do{authority=await c.next('authority');}while(authority.host!==rejoined.id);
 late.send({type:'combat',event:{kind:'environment',target:'world',environment:{mood:1,beacon:true}}});assert.deepEqual((await c.next('combat')).event.environment,{mood:1,beacon:true});
 c.send({type:'world',world:{...world,rust:true}});assert.equal((await late.next('world')).world.rust,true);
 late.send({type:'combat',event:{kind:'chapter',target:'world'}});assert.equal((await c.next('combat')).event.kind,'chapter');
 const chapter2={...world,chapter:2,firstEnding:true,rust:true,abyss:true,trueCleared:true,entities:world.entities.map(e=>({...e,level:20})),bosses:world.bosses.map(b=>({...b,state:'dead',mech:null}))};
 c.send({type:'world',world:chapter2});const shared=await late.next('world');assert.equal(shared.world.chapter,2);assert.equal(shared.world.trueCleared,true);assert.equal(shared.world.entities[0].level,20);
 const finalJoin=await connect('join',r.room);assert.deepEqual((await finalJoin.next('welcome')).world,chapter2);
 console.log('PASS: live World II request, level 20, true ending and late join chapter checkpoint');
 assert.equal(isolated.queue.some(m=>['world','combat'].includes(m.type)),false);
 console.log('PASS: live combat host election, shared world/HP/boss telegraph, authenticated attacks/hits/deaths, late join checkpoint and host transfer');
 console.log('PASS: live internet create/join, appearance, state, action, chat, isolation, departure and reconnect');
} finally {for(const c of clients)c.ws.close();}
