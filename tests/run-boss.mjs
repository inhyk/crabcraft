import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler')]}));
esbuild.buildSync({entryPoints:['src/game/boss.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outdir:'tmp/test-modules'});
const result=spawnSync(process.execPath,['--experimental-strip-types','--test','tests/boss.test.mjs'],{stdio:'inherit'});
process.exit(result.status??1);
