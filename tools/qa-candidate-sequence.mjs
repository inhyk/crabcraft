// One-off sequential verification: a live baseline PID, focused repaired movement, repaired hour.
// Does not deploy, restart a timed-out run, or treat baseline resource results as correct movement.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';

const pid=Number(process.env.CC_QA_BASELINE_PID);assert.ok(Number.isInteger(pid)&&pid>1);
const base='http://127.0.0.1:5196',prefix='tmp/qa/candidate-b569006';
const start=JSON.parse(await readFile('tmp/qa/combat-endurance-start.json','utf8'));
assert.equal(start.minutes,60);assert.equal(start.base,'http://127.0.0.1:5194');
const command=()=>{try{return execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();}catch{return null;}};
assert.equal(command(),'node tools/qa-combat-endurance.mjs','baseline must be the live original process');
let phase='waiting-baseline',child=null,stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;child?.kill(signal);});
const record=async extra=>{const state={phase,utc:new Date().toISOString(),baselinePid:pid,baselineStartedUTC:start.startedUTC,candidateBuild:'b569006',base,...extra};await writeFile(prefix+'-sequence.json',JSON.stringify(state,null,2)+'\n');console.log('STATE',JSON.stringify(state));};
async function verifyArtifact(){const hashes=JSON.parse(await readFile('tmp/qa/endurance-b569006-manifest.json','utf8'));assert.equal(Object.keys(hashes).length,33);for(const [file,hash] of Object.entries(hashes)){const bytes=await readFile('tmp/qa/endurance-b569006/'+file);assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,file);}const served=await fetch(base+'/');assert.equal(served.status,200);assert.equal(createHash('sha256').update(Buffer.from(await served.arrayBuffer())).digest('hex'),hashes['index.html'],'preview must serve the frozen candidate entry');}
async function run(script,log,env){const fd=openSync(log,'wx');try{await new Promise((resolve,reject)=>{child=spawn(process.execPath,[script],{env:{...process.env,...env},stdio:['ignore',fd,fd]});child.once('error',reject);child.once('exit',(code,signal)=>{child=null;code===0?resolve():reject(new Error(`${script} exited ${code??signal}; inspect ${log}`));});});}finally{closeSync(fd);}}
try{
 await record({note:'original live baseline is known to have the stale movement defect; resource evidence only'});
 while(true){assert.equal(stopping,false,'sequence stopped');const cmd=command();if(cmd===null)break;assert.equal(cmd,'node tools/qa-combat-endurance.mjs','PID changed identity');assert.ok(Date.now()<Date.parse(start.expectedEndUTC)+600000,'original baseline still live beyond its expected end; inspect without restarting');await new Promise(r=>setTimeout(r,3000));}
 const previous=JSON.parse(await readFile('tmp/qa/combat-endurance-final.json','utf8'));assert.equal(previous.startedUTC,start.startedUTC);assert.ok(previous.elapsedSeconds>=3600);assert.deepEqual(previous.errors,[]);
 await verifyArtifact();phase='focused-movement';await record({baselineElapsedSeconds:previous.elapsedSeconds,baselineResult:'resource-only; known stale-force defect'});
 await run('tools/qa-remote-push.mjs',prefix+'-movement.log',{CC_QA_BASE:base});
 assert.equal(stopping,false);await verifyArtifact();phase='repaired-endurance';await record({movementResult:'passed focused real local clients; see separate log',maxPostWarmDriftMetres:.1});
 await run('tools/qa-combat-endurance.mjs',prefix+'-endurance.log',{CC_QA_BASE:base,CC_QA_BUILD:'b569006 frozen production source',CC_QA_OUTPUT:prefix+'-endurance',CC_QA_MINUTES:'60',CC_QA_MAX_DRIFT:'.1'});
 const final=JSON.parse(await readFile(prefix+'-endurance-final.json','utf8'));assert.ok(final.elapsedSeconds>=3600);assert.deepEqual(final.errors,[]);phase='passed';await record({elapsedSeconds:final.elapsedSeconds,note:'local staged combat only; publication and whole-goal completion are separate'});
}catch(error){phase=stopping?'stopped':'failed';await record({error:error.message});throw error;}
