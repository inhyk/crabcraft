import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler')]}));
esbuild.buildSync({entryPoints:['src/core/engine.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'tmp/test-modules/engine.js'});
const result=spawnSync(process.execPath,['--experimental-strip-types','--test','tests/engine.test.mjs','tests/star-sun.test.mjs'],{stdio:'inherit'});process.exit(result.status??1);
