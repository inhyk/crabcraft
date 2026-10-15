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
 clients.push(c); c.send({type:mode,room,spec});return c;
}
try {
 const a=await connect('create');const r=await a.next('welcome');assert.match(r.room,/^[A-F0-9]{6}$/);
 a.send({type:'state',state});
 const b=await connect('join',r.room);const joined=await b.next('welcome');assert.equal(joined.players.length,1);assert.deepEqual(joined.players[0].state,state);await a.next('joined');
 const isolated=await connect('create');await isolated.next('welcome');
 b.send({type:'state',state:{...state,x:7}});assert.equal((await a.next('state')).state.x,7);
 b.send({type:'action',action:'jump'});assert.equal((await a.next('action')).action,'jump');
 b.send({type:'chat',text:'Internet multiplayer works'});assert.equal((await a.next('chat')).text,'Internet multiplayer works');await b.next('chat');
 assert.equal(isolated.queue.length,0);b.ws.close();assert.equal((await a.next('left')).id,joined.id);
 const c=await connect('join',r.room);const rejoined=await c.next('welcome');assert.notEqual(rejoined.id,joined.id);assert.deepEqual(rejoined.players[0].state,state);
 console.log('PASS: live internet create/join, appearance, state, action, chat, isolation, departure and reconnect');
} finally {for(const c of clients)c.ws.close();}
