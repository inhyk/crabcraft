#!/usr/bin/env node
/** Matched local host compositions: same P1-fixed host/input/rules, only the encoder changes. */
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(process.argv[2]??'/tmp/crabcraft-snapshot-p1-compositions');
const baseline='5702ae9df9db1b5a80b60c81ada278b94730af37';
const p1='5a7abc9971cb99c13da7fe2ee075c7e27e097b46';
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
git('merge-base','--is-ancestor',p1,'HEAD');
const protocol=join(root,'server/world/gameplay/protocol.ts');
const original=git('show',`${baseline}:server/world/gameplay/protocol.ts`);
// The old encoder has the same prepared-token WeakMap. Apply identical end-of-batch
// lifetime management without changing its validation, projection, or serialization.
const shim='\nexport function releasePreparedObservation(token: PreparedObservation): void { preparedObservations.delete(token); }\n';
const source=await readFile(protocol,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
await mkdir(out,{recursive:true});
for(const variant of ['before','after'])await build({
 entryPoints:[join(root,'tools/bench-snapshot-host.mjs')],outfile:join(out,`${variant}.mjs`),
 bundle:true,platform:'node',format:'esm',target:'node24',logLevel:'warning',
 external:['pg-native','bufferutil','utf-8-validate'],
 banner:{js:"import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);"},
 plugins:variant==='before'?[{name:'frozen-before-encoder',setup(b){b.onLoad({filter:/\/server\/world\/gameplay\/protocol\.ts$/},async a=>a.path===protocol?{contents:original+shim,loader:'ts',resolveDir:join(root,'server/world/gameplay')}:null);}}]:[],
});
await cp(join(root,'server/node/migrations'),join(out,'migrations'),{recursive:true});
const files={};for(const file of ['server/world/host.ts','server/world/gameplay/intents.ts','tools/bench-snapshot-host.mjs','tools/snapshot-batch-fixture.mjs','src/sim/data/pose-data.json','src/sim/data/rig-catalog.json']){
 files[file]=hash(await readFile(join(root,file)));
}
const manifest={head:git('rev-parse','HEAD'),baseline,p1,node:process.version,files,before:{protocol:hash(original),shim,composed:hash(original+shim)},after:{protocol:hash(source)},assets:pathToFileURL(join(root,'public/world/')).href,bundles:{}};
for(const v of ['before','after'])manifest.bundles[v]=hash(await readFile(join(out,`${v}.mjs`)));
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({out,assets:manifest.assets,head:manifest.head}));
