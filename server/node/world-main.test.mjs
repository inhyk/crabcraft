import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
import {startPostgres} from './local-postgres.mjs';
import {createPool,migrate} from './db.ts';
import {CharacterStore} from '../world/character-store.ts';
import {createCoreCharacterCodec} from '../../src/sim/persistence.ts';
import {loadBakedWorld} from '../../src/sim/world/baked.ts';
import {createWorld1Definition} from '../../src/sim/areas/world1.ts';
import {GameplayReceiver} from '../world/gameplay/protocol.ts';
import {encodeInput} from '../world/gameplay/intents.ts';

const main=new URL('../../server-dist/main.mjs',import.meta.url);
const manifestURL=new URL('../../server-dist/world/world-manifest.json',import.meta.url);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,ms=8000){const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw Error('bundled world main timeout');await delay(10);}}
function fixtureConfig(source){return {schema:'world-startup-v1',victimOutcome:{maxEntries:1024,maxPayloadBytes:4194304,timeoutMs:3000},chat:{maxPending:16},ownership:{key:'bundled-main-qa',heartbeatMs:100,queryTimeoutMs:1000},assets:{source,manifest:'world-manifest.json'},
 worlds:Object.fromEntries(['w1','w2','w3','w4'].map((world,i)=>[world,{seed:i+1,populationMode:'fixed-slots',fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:1,scavenger:0,jellyfish:0,shallowPatrols:0},respawnSeconds:{scrapling:300,scavenger:300,jellyfish:300,echo:120}}])),
 restore:{cooldowns:'pause',statuses:'pause',death:'pause',history:'pause',hp:'preserve',resource:'preserve',location:'saved',activity:'cancel'},limits:{maxConnections:16,maxConnectionsPerIp:8,maxWaiting:16,checkpointIntervalMs:100},party:{enabled:false},characters:{maxCharactersPerAccount:2}};}
function start(database,config,ledgerConfig){
 const child=spawn(process.execPath,[main.pathname],{env:{...process.env,DATABASE_URL:database,HOST:'127.0.0.1',PORT:'0',ALLOWED_ORIGINS:'http://localhost',WORLD_ENABLED:'1',WORLD_CONFIG_JSON:config,WORLD_LEDGER_CONFIG_JSON:ledgerConfig===undefined?undefined:JSON.stringify(ledgerConfig)},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
 const exit=once(child,'exit');
 return {child,exit,get output(){return output;},get errors(){return errors;},async ready(){await until(()=>/crabcraft server listening on 127\.0\.0\.1:\d+/.test(output)||child.exitCode!==null);assert.equal(child.exitCode,null,'configured main must remain alive');return 'http://'+output.match(/listening on (127\.0\.0\.1:\d+)/)[1];},async stop(){if(child.exitCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),9000);try{return await exit;}finally{clearTimeout(timer);}}};
}
async function connect(url,origin,catalog,ticket,characterId){
 const ws=new WebSocket(url.replace('http:','ws:')+'/world',{headers:{Origin:origin}}),bot={ws,view:null,binding:null,receiver:null,errors:[]};
 ws.on('error',e=>bot.errors.push(e.message));
 ws.on('message',(bytes,binary)=>{try{if(binary){const update=bot.receiver.accept(bytes,performance.now()/1000);if(update?.kind==='snapshot')bot.view=update.state;}else{const value=JSON.parse(bytes.toString());if(value.type==='world-bound'){const{type,...binding}=value;bot.binding=binding;bot.receiver=new GameplayReceiver(binding,catalog);}else if(value.type==='error')bot.errors.push(value.code??'world error');}}catch(e){bot.errors.push(e.message);}});
 await once(ws,'open');ws.send(JSON.stringify({type:'authenticate',ticket,characterId}));await until(()=>bot.view||bot.errors.length);assert.deepEqual(bot.errors,[]);assert.ok(bot.view);return bot;
}

for(const externalLedger of [false,true]) test(`bundled ${externalLedger?'external':'retained'} main packages real assets and multiplexes account, legacy and authenticated Area routes`,{timeout:30000},async()=>{
 const manifest=JSON.parse(await readFile(manifestURL,'utf8'));
 assert.equal(manifest.format,'crabcraft-world-manifest');assert.equal(manifest.version,1);
 for(const world of ['w1','w2','w3','w4']){const entry=manifest.artifacts[world],bytes=await readFile(new URL(entry.file,manifestURL));assert.equal(bytes.byteLength,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.deepEqual(bytes,await readFile(new URL(`../../public/world/${entry.file}`,import.meta.url)));}
 const cluster=await startPostgres(),pool=createPool(cluster.url),liveClients=new Set();pool.on('connect',client=>{liveClients.add(client);client.once('end',()=>liveClients.delete(client));});let processState,bot,legacy;
 try{
  await migrate(pool);const account='g'+'7'.repeat(23),token=randomBytes(32).toString('hex'),cookie=`cc_account=${account}.${token}`;
  const oldSave=JSON.stringify({'cc.journey.v1:old':JSON.stringify({xp:9999})});
  await pool.query('INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,$2,47,123,100)',[account,oldSave]);
  await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)',[createHash('sha256').update(token).digest('hex'),account,Date.now()+60000]);
  const data=JSON.parse(await readFile(new URL('../../public/world/collision-w1.json',import.meta.url),'utf8')),query=loadBakedWorld(data),definition=createWorld1Definition({query,personalProps:{heightAt:query.heightAt,resolveCollision:(x,z,r,out)=>query.collision.resolve(x,z,r,out)},fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:1,scavenger:0,jellyfish:0,shallowPatrols:0}});
  const codec=createCoreCharacterCodec({identities:[{classId:'mage',archetype:'human'},{classId:'priest',archetype:'human'}],freshLocation:{...definition.spawn.position,yaw:definition.spawn.yaw}}),store=new CharacterStore(pool,codec);
  const identity={schema:'world-identity-v1',classId:'mage',archetype:'human',appearance:{race:'human',sex:'female',classId:'mage',shell:1,crest:2,led:2,name:'Main QA'}};
  const character=await store.create(account,identity);
  processState=start(cluster.url,JSON.stringify(fixtureConfig(manifest.source)),externalLedger?{schema:'world-ledger-v1',queryTimeoutMs:3000,sourceLimits:{maxDirtyCreditEntries:102400,maxDirtyCreditBytes:67108864,maxPendingDeaths:512,maxStagedBytes:67108864},drainLimits:{pageSize:100,creditBatchesPerSlice:4,outcomesPerSlice:4,summaryVictimsPerSlice:4,writeAttempts:3},recoveryLimits:{draftsPerSlice:4,pageSize:100},recoveryIntervalMs:100}:undefined);const origin=await processState.ready();
  assert.equal((await fetch(origin+'/healthz')).status,200);assert.equal((await fetch(origin+'/world')).status,426);
  const catalogResponse=await fetch(origin+'/api/account/world-catalog');assert.equal(catalogResponse.status,200);assert.equal(catalogResponse.headers.get('cache-control'),'no-store');const catalog=await catalogResponse.json();
  const characterHeaders={Origin:origin,'X-Crabcraft-Account':'1',Cookie:cookie,'Content-Type':'application/json'};
  const listed=await fetch(origin+'/api/account/world-characters',{headers:characterHeaders});assert.equal(listed.status,200);assert.deepEqual((await listed.json()).characters.map(c=>c.characterId),[character.characterId]);
  const appearance={...identity.appearance,classId:'priest',name:'Created Main QA'};
  const created=await fetch(origin+'/api/account/world-characters',{method:'POST',headers:characterHeaders,body:JSON.stringify({appearance})});assert.equal(created.status,201);const createdCharacter=(await created.json()).character;
  assert.deepEqual(createdCharacter.identity.appearance,appearance);assert.equal((await store.getOwned(account,createdCharacter.characterId)).checkpoint.progress.xp,0);
  const overLimit=await fetch(origin+'/api/account/world-characters',{method:'POST',headers:characterHeaders,body:JSON.stringify({appearance})});assert.equal(overLimit.status,409);
  assert.equal((await fetch(origin+'/api/account/world-ticket',{method:'POST',headers:{Origin:origin,'X-Crabcraft-Account':'1'}})).status,401);
  const issued=await fetch(origin+'/api/account/world-ticket',{method:'POST',headers:{Origin:origin,'X-Crabcraft-Account':'1',Cookie:cookie}});assert.equal(issued.status,200);const {ticket}=await issued.json();
  bot=await connect(origin,origin,catalog,ticket,character.characterId);
  assert.equal(bot.view.self.player.xp,0);assert.equal(bot.view.self.player.coins,0);assert.deepEqual(bot.view.self.appearance??bot.view.actors.find(a=>a.ref.id===bot.view.selfRef.id).appearance,identity.appearance);
  const startActor=bot.view.actors.find(a=>a.ref.id===bot.view.selfRef.id),before={x:startActor.x,z:startActor.z};
  bot.ws.send(encodeInput({binding:bot.binding,intent:{seq:1,forward:1,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null,commands:[]}},catalog));
  await until(()=>{const actor=bot.view.actors.find(a=>a.ref.id===bot.view.selfRef.id);return Math.hypot(actor.x-before.x,actor.z-before.z)>.01;});
  legacy=new WebSocket(origin.replace('http:','ws:')+'/multiplayer',{headers:{Origin:origin}});const welcome=once(legacy,'message');await once(legacy,'open');legacy.send(JSON.stringify({type:'create',spec:identity.appearance}));assert.equal(JSON.parse((await welcome)[0].toString()).type,'welcome');legacy.close();await once(legacy,'close');legacy=null;
  bot.ws.close();await once(bot.ws,'close');bot=null;
  const exit=await processState.stop();assert.equal(exit[0],0);assert.equal(exit[1],null);
  const saved=await store.getOwned(account,character.characterId);assert.ok(saved.revision>0);assert.equal(saved.checkpoint.progress.xp,0);assert.equal(saved.checkpoint.progress.coins,0);
  assert.deepEqual((await pool.query('SELECT save,revision,updated FROM accounts WHERE username=$1',[account])).rows[0],{save:oldSave,revision:'47',updated:'123'});
  assert.equal(processState.output.includes(token)||processState.errors.includes(token)||processState.output.includes(ticket)||processState.errors.includes(ticket),false);
 }finally{bot?.ws.terminate();legacy?.terminate();if(processState?.child.exitCode===null)await processState.stop();const ended=[...liveClients].map(c=>once(c,'end'));await pool.end();await Promise.all(ended);cluster.stop();}
});

test('bundled main fails before listening when enabled world policy is missing or asset version is wrong',{timeout:15000},async()=>{
 const cluster=await startPostgres();try{const manifest=JSON.parse(await readFile(manifestURL,'utf8'));for(const value of ['',JSON.stringify(fixtureConfig('0'.repeat(64)))]){const p=start(cluster.url,value);const [code,signal]=await p.exit;assert.equal(code,1);assert.equal(signal,null);assert.equal(p.output.includes('server listening'),false);assert.match(p.errors,/world startup failed/);}}finally{cluster.stop();}
});
