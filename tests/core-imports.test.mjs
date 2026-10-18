import test from 'node:test';import assert from 'node:assert/strict';
import {readdirSync,readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {after} from 'node:test';import {resolve,dirname,relative} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import * as ts from 'typescript/unstable/ast';import {API} from 'typescript/unstable/sync';
const root=fileURLToPath(new URL('../',import.meta.url)),sim=resolve(root,'src/sim');
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):e.name.endsWith('.ts')?[resolve(dir,e.name)]:[]);}
const api=new API(),temporary=mkdtempSync(resolve(tmpdir(),'sim-import-guard-'));let parsed=0;after(()=>{api.close();rmSync(temporary,{recursive:true,force:true});});
function violations(source,file=resolve(sim,'fixture.ts')){
 const temporaryFile=resolve(temporary,`fixture-${parsed++}.ts`);writeFileSync(temporaryFile,source);const snapshot=api.updateSnapshot({openFiles:[temporaryFile]}),ast=snapshot.getDefaultProjectForFile(temporaryFile).program.getSourceFile(temporaryFile),errors=[];
 const specifier=n=>{if(!n||!(ts.isStringLiteral(n)||n.kind===ts.SyntaxKind.NoSubstitutionTemplateLiteral)){errors.push('nonliteral module');return;}if(!n.text.startsWith('.')||!resolve(dirname(file),n.text).startsWith(sim+'/'))errors.push(`external module ${n.text}`);};
 function visit(n){
  if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)){if(n.moduleSpecifier)specifier(n.moduleSpecifier);}
  if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)specifier(n.arguments[0]);
  if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&['require','eval','Function','setTimeout','setInterval','requestAnimationFrame'].includes(n.expression.text))errors.push(`ambient call ${n.expression.text}`);
  if(ts.isIdentifier(n)&&['Date','performance','document','window','process','globalThis','global','navigator','crypto'].includes(n.text)){
   const p=n.parent;const isProperty=(ts.isPropertyAccessExpression(p)&&p.name===n)||(ts.isPropertyAssignment(p)&&p.name===n);
   if(!isProperty)errors.push(`ambient identifier ${n.text}`);
  }
  if(ts.isPropertyAccessExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='Math'&&n.name.text==='random')errors.push('ambient random');
  if(ts.isElementAccessExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='Math'&&(!(ts.isStringLiteral(n.argumentExpression)||n.argumentExpression.kind===ts.SyntaxKind.NoSubstitutionTemplateLiteral)||n.argumentExpression.text==='random'))errors.push('ambient random');
  n.forEachChild(visit);
 }
 visit(ast);snapshot.dispose();return errors;
}
test('guard recognizes transitive import edges and executable globals, not comments or string text',()=>{
 for(const bad of ["import 'three';","export * from '../game/unit.ts';","import('../game/unit.ts')","import(variable)","import type {Unit} from '../game/unit.ts';",'Math.random()','Math["random"]()','Date.now()','window.innerWidth','globalThis.Math.random()'])assert.ok(violations(bad).length,bad);
 assert.deepEqual(violations("const harmless='Invalid action window/rate/fade'; // Date.now()\nimport type {Vec3} from './types.ts';"),[]);
});
test('all simulation imports including type edges stay inside numeric core without ambient RNG or clocks',()=>{for(const file of files(sim))assert.deepEqual(violations(readFileSync(file,'utf8'),file),[],relative(root,file));});
test('entire production simulation graph imports directly under Node',async()=>{for(const file of files(sim))await import(pathToFileURL(file).href);});
