import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobileTaskDeleteTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['isPluginTaskWritePathContained', 'persistTaskEditorDeleteOpenSources', 'applyTaskEditorDeleteTarget', 'deleteTaskFromEditor'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-task-delete-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { TFile, TFolder } from 'obsidian';
import { TaskWriter } from './src/core/task-writer';
import { validateVaultRelativePathV1 } from './src/agent-runtime/contracts/v1/identity';
import { executeTaskEditorDeleteTransaction } from './src/systems/task-editor-delete-transaction';
const Platform={isDesktop:false,isMobile:true};
class Probe { ${methods} }
const original='- [ ] Parent {{operonId:: parent1}}';
const related='- [ ] Child {{operonId:: child01}} {{parentTask:: parent1}}';
const detached='- [ ] Child {{operonId:: child01}}';
const target=new TFile('Parent.md'), companion=new TFile('Child.md');
const files=new Map(), contents=new Map();
let conflict=false,writes=0,closed=true; const feedback=[];
function reset(){files.clear();contents.clear();files.set(target.path,target);files.set(companion.path,companion);contents.set(target.path,original);contents.set(companion.path,related);writes=0;conflict=false;feedback.length=0;}
reset();
const app={vault:{getAbstractFileByPath:p=>files.get(p)??null,read:async f=>contents.get(f.path),process:async(f,cb)=>{if(conflict&&f===target)contents.set(f.path,original+' External');const next=cb(contents.get(f.path));contents.set(f.path,next);writes++;return next;},modify:async(f,c)=>{contents.set(f.path,c);writes++;}},fileManager:{trashFile:async f=>{files.delete(f.path);contents.delete(f.path);writes++;}}};
const task={operonId:'parent1',primary:{format:'inline',filePath:target.path}};
const indexer={getTask:()=>task,hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,reindexFilesBatch:async()=>{}};
const probe=new Probe();let action='modify';
const buffer={editor:{getValue:()=>original+' Buffer'}};
Object.assign(probe,{app,indexer,isAgentRuntimeMutationPathContained:async()=>false,redirectDuplicateOperonIdAction:()=>false,getMarkdownViewsForPath:()=>closed?[]:[buffer],persistMarkdownViewBuffer:async()=>{},
 resolveTaskEditorDeleteRelationPlan:()=>({sourcePaths:['Parent.md','Child.md']}),
 prepareTaskEditorDeleteMutation:async()=>({target:{action,filePath:'Parent.md',expectedContent:original,nextContent:''},companions:[{filePath:'Child.md',expectedContent:related,nextContent:detached}]}),
 taskEditorDeleteOpenViewsMatch:()=>true,syncTaskEditorDeleteOpenViews:()=>true,settleCommittedTaskEditorDelete:async()=>false,scheduleTaskEditorDeleteReindexRepair:()=>{},showPluginUiMutationOutcome:value=>feedback.push(value),
});
probe.writer=new TaskWriter(app,indexer,[],{validateWritePath:()=>false,validatePluginWritePath:(p,a)=>probe.isPluginTaskWritePathContained(p,a)});
for(const kind of ['modify','trash']){reset();action=kind;assert.equal(await probe.deleteTaskFromEditor(task,1),true);assert.equal(contents.get('Child.md'),detached);assert.equal(kind==='trash'?files.has('Parent.md'):contents.get('Parent.md'),kind==='trash'?false:'');assert.equal(writes,2);}
reset();action='modify';conflict=true;
const oldError=console.error;try{console.error=()=>{};assert.equal(await probe.deleteTaskFromEditor(task,1),false);}finally{console.error=oldError;}
assert.equal(contents.get('Parent.md'),original+' External');assert.equal(contents.get('Child.md'),related,'Companion rollback must work on mobile');
reset();closed=false;
assert.equal(await probe.persistTaskEditorDeleteOpenSources(['Parent.md']),true);
assert.equal(contents.get('Parent.md'),original+' Buffer');
console.log('mobile-task-delete: inline/file deletion, companion cleanup and rollback, open-buffer fallback passed');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
