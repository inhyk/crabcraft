import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=readdirSync(new URL('../tests/',import.meta.url)).filter(f=>/^core-.*\.test\.mjs$/.test(f)).sort().map(f=>`tests/${f}`);
if(!tests.length)throw new Error('No simulation core tests discovered');
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
