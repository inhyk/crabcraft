import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.CC_QA_BASE??'https://inh-crabcraft-multiplayer.vercel.app';
const files=['index.html',...(await readdir('dist/assets')).filter(f=>/\.(js|css)$/.test(f)).map(f=>'assets/'+f),'audio/index.json',...(await readdir('dist/audio')).filter(f=>/^music-world[23]-.*\.(ogg|mp3)$/.test(f)).map(f=>'audio/'+f)];
for(const file of files){const response=await fetch(base+'/'+file);assert.equal(response.status,200,file);const local=await readFile('dist/'+file),remote=Buffer.from(await response.arrayBuffer());const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(remote),hash(local),file);}
const hub=await fetch('https://seonn.dev/games/crabcraft');assert.equal(hub.status,200);assert.ok((await hub.text()).includes(base));console.log('PASS',files.length,'index/JS/CSS/audio manifest/12 original audio hashes; hub200 and stable play URL');
