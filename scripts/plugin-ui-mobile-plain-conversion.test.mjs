import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobilePlainConversionTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['isPluginTaskWritePathContained', 'convertInlineTaskToPlainFromCommand', 'syncPlainConversionOpenViews'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-plain-conversion-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { TFile,TFolder } from 'obsidian';
import { TaskWriter } from './src/core/task-writer';
import { validateVaultRelativePathV1 } from './src/agent-runtime/contracts/v1/identity';
import { parseTaskLine } from './src/core/parser';
import { planInlineTaskToPlain } from './src/core/plain-task-conversion';
const Platform={isDesktop:false,isMobile:true};const t=(d,k)=>k;const notices=[];class Notice{constructor(s){notices.push(s)}}
let confirm=true;class ConfirmActionModal{constructor(app,opts,done){this.done=done}open(){this.done(confirm)}}
class Probe { ${methods} }
const original='- [ ] Plain me {{operonId:: plain01}} {{status:: task.todo}}';const file=new TFile('Tasks.md');
let content=original,writes=0,stale=false,diverged=false,finished=false,buffer=original;
const parsed=parseTaskLine(original,0,file.path,[]);const task={...parsed,fieldValues:Object.fromEntries(parsed.fields.map(f=>[f.key,f.value])),primary:{format:'inline',filePath:file.path,lineNumber:0}};
const view={editor:{getValue:()=>buffer,setValue:v=>{buffer=v}}};
const app={vault:{getAbstractFileByPath:p=>p===file.path?file:null,read:async()=>content,process:async(f,cb)=>{if(stale)content=original+' External';const next=cb(content);content=next;writes++;if(diverged&&writes===1)buffer='User edit';return next;}}};
const indexer={getTask:()=>task,hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true};
const probe=new Probe();Object.assign(probe,{app,indexer,settings:{keyMappings:[]},isAgentRuntimeMutationPathContained:async()=>false,timeTracker:{runWithTransitionLock:op=>op()},getFreshTaskForPlainConversion:()=>task,getPlainConversionSourceSnapshot:async()=>({task,file,content,views:[view]}),getConvertToPlainBlockers:()=>[],parseInlineTaskLine:(s,n,p)=>parseTaskLine(s,n,p,[]),createPlainConversionMutationGuard:()=>()=>true,getMarkdownViewsForPath:()=>[view],finishPlainTaskConversion:async()=>{finished=true}});
probe.writer=new TaskWriter(app,indexer,[],{validateWritePath:()=>false,validatePluginWritePath:(p,a)=>probe.isPluginTaskWritePathContained(p,a)});
const reset=()=>{content=original;buffer=original;writes=0;stale=false;diverged=false;finished=false;notices.length=0;confirm=true;};
await probe.convertInlineTaskToPlainFromCommand({task});assert.equal(content,'- [ ] Plain me');assert.equal(buffer,content);assert.equal(finished,true);assert.equal(notices.at(-1),'convertToPlainCheckboxSuccess');
reset();confirm=false;await probe.convertInlineTaskToPlainFromCommand({task});assert.equal(writes,0);
reset();stale=true;await probe.convertInlineTaskToPlainFromCommand({task});assert.equal(content,original+' External');assert.equal(writes,0);assert.equal(finished,false);
reset();diverged=true;await probe.convertInlineTaskToPlainFromCommand({task});assert.equal(content,original);assert.equal(buffer,'User edit');assert.equal(writes,2);assert.equal(finished,false);
console.log('mobile-plain-conversion: conversion, cancel, source conflict and buffer rollback passed');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
