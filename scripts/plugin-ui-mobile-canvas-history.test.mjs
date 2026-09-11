import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobileCanvasHistoryTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['isPluginTaskWritePathContained', 'persistTaskEditorDeleteOpenSources', 'applyTaskEditorDeleteTarget', 'deleteTaskFromEditor', 'canvasConversionTaskKey', 'canvasConversionEligible', 'captureCanvasConversion', 'removeCanvasConversionTask', 'restoreCanvasConversionTask'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-canvas-history-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import {TFile,TFolder} from 'obsidian';
import {TaskWriter} from './src/core/task-writer';
import {validateVaultRelativePathV1} from './src/agent-runtime/contracts/v1/identity';
import {executeTaskEditorDeleteTransaction} from './src/systems/task-editor-delete-transaction';
import {parseTaskLine} from './src/core/parser';
import {scanFileWithMappings} from './src/indexer/file-scanner';
const Platform={isDesktop:false,isMobile:true};const t=(d,k)=>k;class Notice{constructor(s){}}
class Probe { ${methods} }
const inline='- [ ] Canvas task {{operonId:: canvas1}}';const yaml='---\\noperonId: canvas1\\nstatus: task.todo\\n---\\n';const root=new TFolder('');
let file=null,content='',task=null,writes=0,pinned=false,duplicate=false;
async function reindex(){task=null;if(!file)return;const scan=await scanFileWithMappings(app,file,[],content);if(scan.yamlTask)task={...scan.yamlTask,checkbox:'open',primary:{format:'yaml',filePath:file.path,lineNumber:0}};else {const p=parseTaskLine(content,0,file.path,[]);if(p)task={...p,fieldValues:Object.fromEntries(p.fields.map(f=>[f.key,f.value])),primary:{format:'inline',filePath:file.path,lineNumber:0}};}}
const app={vault:{getAbstractFileByPath:p=>p===''?root:p==='Task.md'?file:null,read:async()=>content,process:async(f,cb)=>{content=cb(content);writes++;return content},create:async(p,c)=>{file=new TFile(p);file.stat={mtime:0,ctime:0,size:c.length};content=c;writes++;return file},modify:async(f,c)=>{content=c;writes++;}},fileManager:{trashFile:async()=>{file=null;content='';writes++;}}};
const indexer={getTask:()=>task,hasDuplicateOperonIdConflict:()=>duplicate,isPathIndexable:()=>true,reindexFilesBatch:reindex,forceReindexFilePathAfterMutation:reindex,getAllTasks:()=>task?[task]:[],getChildIdsSnapshot:()=>[]};
const probe=new Probe();Object.assign(probe,{app,indexer,timeTracker:{isTimerRunning:()=>false},pinnedCache:{isPinned:()=>pinned,pin:async()=>{pinned=true}},isAgentRuntimeMutationPathContained:async()=>false,redirectDuplicateOperonIdAction:()=>false,getMarkdownViewsForPath:()=>[],taskEditorDeleteOpenViewsMatch:()=>true,syncTaskEditorDeleteOpenViews:()=>true,
 resolveTaskEditorDeleteRelationPlan:()=>({sourcePaths:['Task.md'],updatesByPath:new Map(),detachedChildren:[],clearedDependencyReferences:[]}),
 prepareTaskEditorDeleteMutation:async()=>({target:{action:task.primary.format==='yaml'?'trash':'modify',filePath:'Task.md',expectedContent:content,nextContent:task.primary.format==='inline'?'':undefined},companions:[]}),
 settleCommittedTaskEditorDelete:async()=>{pinned=false;await reindex();return false},scheduleTaskEditorDeleteReindexRepair:()=>{},showPluginUiMutationOutcome:()=>{},refreshViews:()=>{},
});
probe.writer=new TaskWriter(app,indexer,[],{validateWritePath:()=>false,validatePluginWritePath:(p,a)=>probe.isPluginTaskWritePathContained(p,a)});
async function reset(format){file=new TFile('Task.md');file.stat={mtime:0,ctime:0,size:0};content=format==='yaml'?yaml:inline;writes=0;pinned=false;duplicate=false;await reindex();}
for(const format of ['inline','yaml']){
 await reset(format);pinned=true;const receipt=await probe.captureCanvasConversion('canvas1');assert.ok(receipt);
 assert.equal(await probe.removeCanvasConversionTask(receipt,()=>true),true,'Undo '+format);assert.equal(task,null);assert.equal(pinned,false);
 assert.equal(await probe.restoreCanvasConversionTask(receipt,()=>true),true,'Redo '+format);assert.equal(task.operonId,'canvas1');assert.equal(task.primary.format,format);assert.equal(pinned,true);assert.equal(content,receipt.content);
 assert.equal(await probe.removeCanvasConversionTask(receipt,()=>false),false);
}
await reset('inline');let receipt=await probe.captureCanvasConversion('canvas1');await probe.removeCanvasConversionTask(receipt,()=>true);content='User changed source';assert.equal(await probe.restoreCanvasConversionTask(receipt,()=>true),false);assert.equal(content,'User changed source');
await reset('yaml');receipt=await probe.captureCanvasConversion('canvas1');await probe.removeCanvasConversionTask(receipt,()=>true);const beforeWrites=writes;assert.equal(await probe.restoreCanvasConversionTask(receipt,()=>false),false);assert.equal(writes,beforeWrites);file=new TFile('Task.md');content='Existing unrelated file';assert.equal(await probe.restoreCanvasConversionTask(receipt,()=>true),false);assert.equal(content,'Existing unrelated file');
console.log('mobile-canvas-history: inline/file undo-redo, pin restoration, cancellation and source collision preservation passed');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
