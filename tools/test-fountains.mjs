import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
await mkdir('tmp/qa/fountains',{recursive:true});
await build({entryPoints:['tests/fountains.test.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'tmp/qa/fountains/tests.mjs'});
const r=spawnSync(process.execPath,['--test','tmp/qa/fountains/tests.mjs'],{stdio:'inherit'});process.exitCode=r.status??1;
