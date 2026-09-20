import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

export async function runFileCreationRecurrenceTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 const names = ['createFileTaskFromCreatorDraft', 'createFileSubtaskFromCreatorDraft', 'finalizeTaskCreatorCreatedTask', 'syncRepeatSeriesEntryIfNeeded', 'finalizeCreatedFileTask'];
 const methods = names.flatMap(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  if (name !== 'finalizeCreatedFileTask') assert.ok(method, name);
  return method ? [method.getText(ast)] : [];
 }).join('\n');
 const indexSource = await readFile(path.join(rootDir, 'src/indexer/indexer.ts'), 'utf8');
 const indexAst = ts.createSourceFile('indexer.ts', indexSource, ts.ScriptTarget.Latest, true);
 const indexClass = indexAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonIndexer');
 const forceMethod = indexClass.members.find(member => member.name?.getText(indexAst) === 'forceReindexFilePathAfterMutation').getText(indexAst);
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-file-creation-recurrence-'));
 try {
  const outfile = path.join(dir, 'test.mjs');
  await build({stdin: {resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { RepeatSeriesStore } from './src/storage/repeat-series-store';
import { WriteQueue } from './src/storage/write-queue';
import { RecurrenceService } from './src/systems/recurrence-service';
import { parseRepeatRule } from './src/core/repeat-rule';
const cloneTaskCreatorDraft = draft => structuredClone(draft);
const findFileTaskTemplateOptionById = () => ({});
const buildTaskCreatorSubmitFieldSeed = draft => ({fieldValues:draft.fieldValues,fieldPresence:[],explicitEmptyFieldKeys:[]});
const t = (_namespace,key) => key;
let notices=[];
class Notice { constructor(message) { notices.push(message); } }
class Probe { ${methods} }
class IndexProbe { ${forceMethod} }
let finishOldScan;
const oldScan=new Promise(resolve=>{finishOldScan=resolve});
const order=[];
const actualIndex=new IndexProbe();
Object.assign(actualIndex,{shuttingDown:false,inFlightReindexPaths:new Set(['Tasks/Test.md']),pendingFiles:new Set(),reindexTimer:null,awaitTrackedReindexPath:()=>oldScan,noteMarkdownEvent:()=>order.push('fresh'),enqueueIndexOperation:async fn=>fn(),doReindexFilePath:async()=>order.push('scan'),finishTrackedReindexPath:()=>order.push('finished')});
const waiting=actualIndex.forceReindexFilePathAfterMutation('Tasks/Test.md');
await Promise.resolve();assert.deepEqual(order,[],'Fresh scan must await older scan');
finishOldScan();await waiting;assert.deepEqual(order,['fresh','scan','finished']);

for(const kind of ['task','subtask']) for(const mode of ['normal','older-scan','missing','wrong-path','changed-repeat','duplicate-id','index-failure','write-failure','existing-series','missing-series-id','null-series','wrong-series','changed-after-followup']) {
 notices=[];let visible=null, freshScans=0, attempts=0, reopened=0;
 const files=new Map();
 const adapter={exists:async p=>files.has(p),read:async p=>files.get(p),write:async(p,s)=>{attempts++;if(mode==='write-failure')throw Error('injected-write-failure');files.set(p,s)},remove:async p=>files.delete(p)};
 const app={vault:{configDir:'.obsidian',adapter,getAbstractFileByPath:()=>null}};
 const store=new RepeatSeriesStore(app,new WriteQueue());await store.load();
 const fields={operonId:'recur01',repeat:'mode=schedule|freq=day|interval=5',repeatSeriesId:'series1',repeatOccurrenceDate:'2026-09-16',dateDue:'2026-09-17'};
 if(mode==='missing-series-id')fields.repeatSeriesId='';
 const task={operonId:'recur01',description:'Test',checkbox:'open',primary:{format:'yaml',filePath:'Tasks/Test.md'},fieldValues:{...fields}};
 const scan=()=>{freshScans++;visible=mode==='missing'?null:structuredClone(task);if(mode==='wrong-path')visible.primary.filePath='Other.md';if(mode==='changed-repeat')visible.fieldValues.repeat='mode=done|freq=day|interval=1'};
 const index={getTask:()=>visible,hasDuplicateOperonIdConflict:()=>mode==='duplicate-id',secondary:{getChildIds:()=>[]},reindexFilePath:async()=>{if(mode!=='older-scan')scan()},forceReindexFilePathAfterMutation:async()=>{if(mode==='index-failure')throw Error('injected-index-failure');scan()}};
 const probe=new Probe();
 Object.assign(probe,{app,indexer:index,recurrenceService:new RecurrenceService(app,index,{}, {repeatSeries:store},()=>({})),prepareSubtaskCreation:async()=>true,notifySubtaskCreated:async()=>{},openFileSubtaskCreator:()=>{reopened++},getFileTaskTemplateOptions:()=>[],normalizeTaskCreatorText:x=>x,resolveTaskCreatorFileTargetFolderOverride:()=>null,createFileTaskFromTemplateSelection:async()=>({file:{path:'Tasks/Test.md',basename:'Test'},fieldValues:fields}),applyCreatorDependencyLinks:async()=>{if(mode==='changed-after-followup')visible.fieldValues.repeat='mode=done|freq=day|interval=1'},applyCreatorPinnedState:async()=>{},applyInlineRepeatCompletionModeIfRequested:async()=>{},refreshViews:()=>{},showTaskNotice:()=>notices.push('success'),getCreatedFileTaskForFilterDraft:()=>visible});
 if(mode==='existing-series')await probe.recurrenceService.ensureSeriesEntry(task,'series1');
 const previous=mode==='existing-series'?structuredClone(store.getEntry('series1')):null;
 if(mode==='null-series')probe.recurrenceService.ensureSeriesEntry=async()=>null;
 if(mode==='wrong-series')probe.recurrenceService.ensureSeriesEntry=async()=>({seriesId:'other'});
 const draft={description:'Test',fieldValues:fields,tags:[],explicitFieldKeys:[],subtaskIds:[]};
 const result=kind==='task'?await probe.createFileTaskFromCreatorDraft(draft,{reopenCreator:async()=>{reopened++}}):await probe.createFileSubtaskFromCreatorDraft(draft,null);
 assert.equal(result,true,'Created source must not be retried: '+mode);
 assert.equal(reopened,0,mode);
 if(mode==='normal'||mode==='older-scan'||mode==='existing-series') {
  assert.equal(freshScans,1,mode);
  if(previous)assert.deepEqual(store.getEntry('series1'),previous,'Existing series preserved');
  assert.equal(store.getAllEntries().length,1,'Missing series after creation: '+mode);
  assert.equal(notices.includes('success'),true,mode);
 } else {
  assert.equal(store.getAllEntries().length,0,mode);
  assert.equal(notices.includes('creatorPostCreateFinalizeFailed'),true,'Missing failure notice: '+mode);
  assert.equal(notices.includes('success'),false,mode);
  if(mode!=='write-failure')assert.equal(attempts,0,mode);
 }
}
console.log('File creation recurrence: 26 task/subtask scenarios passed');
`},bundle:true,format:'esm',platform:'node',outfile,logLevel:'silent',alias:{obsidian:path.join(rootDir,'scripts/test-support/obsidian.ts')}});
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir,{recursive:true,force:true}); }
}
