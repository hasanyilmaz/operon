import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobileGanttTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['isPluginTaskWritePathContained'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 let transaction;
 function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'executeTableGanttCascadeTransaction') transaction = node.getText(ast);
  ts.forEachChild(node, visit);
 }
 visit(ast); assert.ok(transaction);
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-gantt-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import {TFile,TFolder} from 'obsidian';
import {TaskWriter} from './src/core/task-writer';
import {validateVaultRelativePathV1} from './src/agent-runtime/contracts/v1/identity';
import {executeTableGanttCascadeTransaction} from './src/ui/table/table-gantt-cascade-transaction';
const Platform={isDesktop:false,isMobile:true};
class Probe { ${methods} async run(){return ${transaction};} }
const files=new Map([['A.md',new TFile('A.md')],['B.md',new TFile('B.md')]]);const contents=new Map();
let writes=0,fail=false,external=false,series='before';
const filePlans=[{filePath:'A.md',expectedContent:'a before',nextContent:'a after'},{filePath:'B.md',expectedContent:'b before',nextContent:'b after'}];
const recurrencePlans=[{seriesId:'series1',begin:async()=>{series='after';return {before:'before'}},rollback:async()=>{series='before';return true}}];
const app={vault:{getAbstractFileByPath:p=>files.get(p)??null,read:async f=>contents.get(f.path),process:async(f,cb)=>{if(fail&&f.path==='B.md'){if(external)contents.set('A.md','User change');throw Error('Injected failure')}const next=cb(contents.get(f.path));contents.set(f.path,next);writes++;return next;}}};
const indexer={hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true};
const probe=new Probe();Object.assign(probe,{app,isAgentRuntimeMutationPathContained:async()=>false});probe.writer=new TaskWriter(app,indexer,[],{validateWritePath:()=>false,validatePluginWritePath:(p,a)=>probe.isPluginTaskWritePathContained(p,a)});
const reset=()=>{contents.set('A.md','a before');contents.set('B.md','b before');writes=0;fail=false;external=false;series='before';};
reset();assert.equal(await probe.run(),'committed');assert.equal(contents.get('A.md'),'a after');assert.equal(contents.get('B.md'),'b after');assert.equal(series,'after');assert.equal(writes,2);
const oldError=console.error;try{console.error=()=>{};
 reset();fail=true;assert.equal(await probe.run(),'rolled-back');assert.equal(contents.get('A.md'),'a before');assert.equal(contents.get('B.md'),'b before');assert.equal(series,'before');
 reset();fail=true;external=true;assert.equal(await probe.run(),'recovery-required');assert.equal(contents.get('A.md'),'User change');assert.equal(contents.get('B.md'),'b before');
}finally{console.error=oldError;}
console.log('mobile-gantt: production cascade callbacks commit, compensate recurrence and preserve concurrent changes');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
